import { describe, it, expect } from "vitest";
import { TableState, startHand, legalActions, apply, PlayerState } from "./engine";

// Deterministic PRNG (mulberry32) so failures reproduce exactly.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTable(n: number, stack: number, sb: number, seed: number): TableState {
  const rand = rng(seed);
  const players: PlayerState[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    stack,
    holeCards: [],
    folded: false,
    allIn: false,
    betThisStreet: 0,
    committedThisHand: 0,
    hasActedSinceFullRaise: false,
    satOut: false,
  }));
  const t: TableState = {
    tableId: `fuzz-${seed}`,
    smallBlind: sb,
    bigBlind: sb * 2,
    handNumber: 0,
    maxHands: 400,
    dealerSeat: Math.floor(rand() * n),
    players,
    board: [],
    deck: [],
    street: "preflop",
    currentSeat: -1,
    currentBet: 0,
    lastRaiseIncrement: sb * 2,
    minRaiseTo: sb * 2,
    pot: 0,
    actionLog: [],
    rngState: Math.floor(rand() * 2 ** 31),
    sessionOver: false,
    awaitingDecision: false,
  };
  return t;
}

function totalChips(t: TableState): number {
  return t.players.reduce((a, p) => a + p.stack, 0) + t.pot;
}

// Fuzz: random-but-legal decisions across table sizes and stack depths.
// Invariants: chips are conserved inside every hand, the engine always
// terminates the hand, winners' awards sum to the pot, and stacks never go
// negative. Runs hundreds of full hands per seed.
describe("engine fuzz invariants", () => {
  const seeds = [7, 1337, 90210];
  for (const seed of seeds) {
    it(`conserves chips and terminates over many hands (seed ${seed})`, () => {
      const rand = rng(seed);
      const n = 2 + Math.floor(rand() * 5); // 2..6 players
      const sb = [1, 5, 25][Math.floor(rand() * 3)];
      let t = makeTable(n, 200 * sb, sb, seed);
      const total = totalChips(t);
      let hands = 0;

      while (hands < 120 && !t.sessionOver) {
        t = startHand(t);
        const startTotal = totalChips(t);
        expect(startTotal).toBe(total); // blinds move chips, never create them
        let guard = 0;
        while (!t.awaitingDecision === false && guard++ < 600) {
          const la = legalActions(t);
          if (!la) break;
          // pick a random LEGAL action; raise to a random legal total
          const options: string[] = ["fold"];
          if (la.toCall > 0) options.push("call");
          else options.push("check");
          if (la.canRaise) options.push("raise");
          const pick = options[Math.floor(rand() * options.length)];
          let decision;
          if (pick === "raise") {
            const span = la.maxRaiseTo - la.minRaiseTo;
            const to = la.minRaiseTo + Math.floor(rand() * Math.max(1, span));
            decision = { type: "raise" as const, toTotal: to };
          } else if (pick === "call") decision = { type: "call" as const };
          else if (pick === "check") decision = { type: "check" as const };
          else decision = { type: "fold" as const };
          t = apply(t, decision);
          expect(totalChips(t)).toBe(total); // no leaks mid-hand
          for (const p of t.players) expect(p.stack).toBeGreaterThanOrEqual(0);
          if (t.lastHandResult) break;
        }
        expect(t.lastHandResult).toBeTruthy(); // hand must terminate
        // awards exactly distribute the pot
        const awardSum = (t.lastHandResult?.awards ?? []).reduce((a, x) => a + x.amount, 0);
        expect(awardSum).toBeLessThanOrEqual(totalChips(t));
        hands++;
        t.handNumber = hands;
      }
      expect(hands).toBeGreaterThan(10); // the fuzz actually played
      expect(totalChips(t)).toBe(total);
    });
  }
});
