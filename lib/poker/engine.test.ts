import { describe, it, expect } from "vitest";
import { mulberry32 } from "./cards";
import {
  TableState,
  startHand,
  legalActions,
  apply,
  Decision,
} from "./engine";

function freshTable(overrides: Partial<TableState> = {}): TableState {
  const base: TableState = {
    tableId: "t1",
    smallBlind: 5,
    bigBlind: 10,
    handNumber: 0,
    maxHands: 1000,
    dealerSeat: 0,
    players: [
      { id: "A", name: "Alice", stack: 1000, holeCards: [], folded: false, allIn: false, betThisStreet: 0, committedThisHand: 0, hasActedSinceFullRaise: false, satOut: false },
      { id: "B", name: "Bob", stack: 1000, holeCards: [], folded: false, allIn: false, betThisStreet: 0, committedThisHand: 0, hasActedSinceFullRaise: false, satOut: false },
      { id: "C", name: "Carol", stack: 1000, holeCards: [], folded: false, allIn: false, betThisStreet: 0, committedThisHand: 0, hasActedSinceFullRaise: false, satOut: false },
    ],
    board: [],
    deck: [],
    street: "preflop",
    currentSeat: -1,
    currentBet: 0,
    lastRaiseIncrement: 10,
    minRaiseTo: 20,
    pot: 0,
    actionLog: [],
    rngState: 12345,
    sessionOver: false,
    awaitingDecision: false,
    ...overrides,
  };
  return base;
}

function chips(t: TableState): number {
  return t.players.reduce((s, p) => s + p.stack, 0) + t.pot;
}

// Random-bot driver: plays out the whole session legally, with sane bet sizing.
function playSession(t: TableState, seed: number, maxHands = 200): TableState {
  const rng = mulberry32(seed);
  let state = t;
  let guard = 0;
  while (!state.sessionOver && state.handNumber < maxHands && guard++ < 50000) {
    state = startHand(state);
    let inner = 0;
    while (state.awaitingDecision && inner++ < 500) {
      const la = legalActions(state);
      if (!la) break;
      const r = rng();
      let d: Decision;
      const saneRaiseCeiling = Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, la.potTotal * 2 + la.toCall * 2));
      if (la.toCall === 0) {
        if (r < 0.5) d = { type: "check" };
        else {
          const span = Math.max(1, saneRaiseCeiling - la.minRaiseTo);
          d = { type: "raise", toTotal: la.minRaiseTo + Math.floor(rng() * span) };
        }
      } else {
        if (r < 0.3) d = { type: "fold" };
        else if (r < 0.85 || la.maxRaiseTo <= la.minRaiseTo) d = { type: "call" };
        else {
          const span = Math.max(1, saneRaiseCeiling - la.minRaiseTo);
          d = { type: "raise", toTotal: la.minRaiseTo + Math.floor(rng() * span) };
        }
      }
      state = apply(state, d);
    }
  }
  return state;
}

describe("table engine mechanics", () => {
  it("posts blinds and sets first actor (UTG) preflop", () => {
    const t = startHand(freshTable());
    expect(t.pot).toBe(15);
    const sb = t.players.find((p) => p.betThisStreet === 5)!;
    const bb = t.players.find((p) => p.betThisStreet === 10)!;
    expect(sb.id).toBe("B"); // seat after dealer
    expect(bb.id).toBe("C");
    const la = legalActions(t)!;
    expect(t.players[la.seat].id).toBe("A"); // UTG
    expect(la.toCall).toBe(10);
  });

  it("BB can check when action comes back unraised", () => {
    let t = startHand(freshTable());
    t = apply(t, { type: "call" }); // A calls
    t = apply(t, { type: "call" }); // B(SB) calls
    expect(t.awaitingDecision).toBe(true);
    const la = legalActions(t)!;
    expect(t.players[la.seat].id).toBe("C");
    expect(la.canCheck).toBe(true);
    t = apply(t, { type: "check" });
    expect(t.street).toBe("flop");
    expect(t.board.length).toBe(3);
  });

  it("enforces min-raise by clamping", () => {
    let t = startHand(freshTable());
    const la0 = legalActions(t)!;
    expect(la0.minRaiseTo).toBe(20); // 2x BB
    t = apply(t, { type: "raise", toTotal: 15 }); // below min → clamped to 20
    const log = t.actionLog.find((a) => a.type === "raise" || a.type === "bet");
    expect(log?.amount).toBe(20);
  });

  it("re-raise reopens action: caller cannot just win yet", () => {
    let t = startHand(freshTable());
    t = apply(t, { type: "raise", toTotal: 30 }); // A raises
    t = apply(t, { type: "raise", toTotal: 90 }); // B re-raises
    t = apply(t, { type: "call" }); // C calls 90
    // A still must act
    expect(t.awaitingDecision).toBe(true);
    const la = legalActions(t)!;
    expect(t.players[la.seat].id).toBe("A");
    expect(la.toCall).toBe(60);
  });

  it("everyone folds → BB wins the pot", () => {
    let t = startHand(freshTable());
    t = apply(t, { type: "fold" });
    t = apply(t, { type: "fold" });
    expect(t.awaitingDecision).toBe(false);
    expect(t.lastHandResult?.awards[0].amount).toBe(15);
    expect(t.lastHandResult?.awards[0].winners).toEqual(["C"]);
    expect(t.players.find((p) => p.id === "C")!.stack).toBe(1000 + 15 - 10); // won pot incl own BB
    expect(t.handNumber).toBe(1);
  });

  it("heads-up: button is SB and acts first preflop, BB first postflop", () => {
    const two = freshTable();
    two.players = two.players.slice(0, 2);
    two.dealerSeat = 1;
    let t = startHand(two);
    const la1 = legalActions(t)!;
    expect(t.players[la1.seat].id).toBe("B"); // button/SB first preflop
    t = apply(t, { type: "call" });
    t = apply(t, { type: "check" }); // BB checks
    expect(t.street).toBe("flop");
    const la2 = legalActions(t)!;
    expect(t.players[la2.seat].id).toBe("A"); // non-button first postflop
  });
});

describe("side pots", () => {
  it("short all-in creates main + side pot correctly", () => {
    // A 200, B 600, C 600; A shoves 200, B shoves 600, C calls 600.
    const t = freshTable({
      players: [
        { ...freshTable().players[0], id: "A", stack: 200 },
        { ...freshTable().players[1], id: "B", stack: 600 },
        { ...freshTable().players[2], id: "C", stack: 600 },
      ],
    });
    let s = startHand(t);
    // blinds 5/10 posted; A (UTG) shoves for 200 total
    s = apply(s, { type: "raise", toTotal: 200 });
    s = apply(s, { type: "raise", toTotal: 600 }); // B shoves
    s = apply(s, { type: "call" }); // C calls 600
    // A still to act on the 600? No: A is all-in (200 total < 600) → A's decision done;
    // betting complete when B and C matched. A cannot act further.
    expect(s.awaitingDecision).toBe(false);
    expect(s.street).toBe("showdown");
    expect(s.board.length).toBe(5);

    const totalPot = 200 + 600 + 600 + 0; // blinds are part of these totals
    const awardTotal = s.lastHandResult!.awards.reduce((x, a) => x + a.amount, 0);
    expect(awardTotal).toBe(totalPot);
    // main pot 3×200=600 (all eligible), side pot 2×400=800 (B,C only)
    const amounts = s.lastHandResult!.awards.map((a) => a.amount).sort((a, b) => a - b);
    expect(amounts).toEqual([600, 800]);
    expect(chips(s)).toBe(1400);
  });

  it("folded player's chips go into pots but they are never eligible", () => {
    // A raises 100, B folds, C all-in 60, A calls (60 into main, 40 side back? A gets side)
    const t = freshTable({
      players: [
        { ...freshTable().players[0], id: "A", stack: 1000 },
        { ...freshTable().players[1], id: "B", stack: 1000 },
        { ...freshTable().players[2], id: "C", stack: 60 },
      ],
    });
    let s = startHand(t); // A UTG 1000, B SB, C BB 60-stack
    // blinds: B 5, C 60? No—C posts 10 blind but stack 60. currentBet 10.
    s = apply(s, { type: "raise", toTotal: 100 }); // A raises to 100
    s = apply(s, { type: "fold" }); // B folds
    s = apply(s, { type: "call" }); // C calls all-in 60
    // A already bet 100 ≥ ... betting complete → runout, showdown
    // main pot: min(A 100, C 60) + B's fold 5 + ... A's excess 40 returns? NO —
    // in NLHE excess goes to side pot which only A is eligible for → returns to A.
    expect(s.street).toBe("showdown");
    // pot = A 60 + B fold 5 + C 60 = 125 (A's uncalled 40 was returned, not won)
    const awardTotal = s.lastHandResult!.awards.reduce((x, a) => x + a.amount, 0);
    expect(awardTotal).toBe(5 + 60 + 60);
    // A ends with either 940 (lost) or 1065 (won the 125 pot); both conserve chips
    const aStack = s.players.find((p) => p.id === "A")!.stack;
    expect([940, 1065]).toContain(aStack);
    expect(chips(s)).toBe(2060);
  });
});

describe("session invariants (property test)", () => {
  it("chips are conserved across a full random 3-handed session", () => {
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const deep = freshTable();
      deep.players = deep.players.map((p) => ({ ...p, stack: 50000 }));
      const s = playSession(deep, seed, 150);
      expect(s.handNumber).toBeGreaterThan(20);
      expect(chips(s)).toBe(150000);
    }
  });

  it("chips conserved for 6-handed with varied stacks", () => {
    const players = ["A", "B", "C", "D", "E", "F"].map((id, i) => ({
      ...freshTable().players[0],
      id,
      stack: [5000, 1200, 800, 300, 100, 50][i],
    }));
    const t = freshTable({ players, dealerSeat: 2 });
    const s = playSession(t, 999, 300);
    const expected = players.reduce((x, p) => x + p.stack, 0);
    expect(chips(s)).toBe(expected);
    expect(s.sessionOver).toBe(true);
  });

  it("stacks never go negative", () => {
    const players = ["A", "B", "C"].map((id) => ({
      ...freshTable().players[0],
      id,
      stack: 33,
    }));
    const s = playSession(freshTable({ players }), 5150, 50);
    for (const p of s.players) expect(p.stack).toBeGreaterThanOrEqual(0);
  });

  it("dealer button advances and hands are numbered", () => {
    const t = freshTable();
    t.players = t.players.map((p) => ({ ...p, stack: 50000 }));
    const s = playSession(t, 3, 10);
    expect(s.handNumber).toBeGreaterThanOrEqual(9);
    expect(s.handNumber).toBeLessThanOrEqual(10);
  });
});
