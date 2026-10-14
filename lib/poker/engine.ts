// NLHE cash-game table engine. Pure, JSON-serializable state advanced step by step
// by an external decision provider (the arena asks LLMs; tests feed scripted actions).

import { makeDeck, shuffle, mulberry32, Rng, cardsStr } from "./cards";
import { evaluate, describe } from "./evaluator";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "payout";

export interface PlayerState {
  id: string;
  name: string;
  stack: number; // chips behind, at the table
  holeCards: number[]; // empty when not in a hand
  folded: boolean;
  allIn: boolean;
  betThisStreet: number; // chips currently in front (street-scoped)
  committedThisHand: number; // total chips put in across streets (side pots)
  hasActedSinceFullRaise: boolean;
  satOut: boolean; // busted from the table (stack 0 and left)
  disconnected?: boolean; // provider outage mid-hand: can't act, but cards/chips stay live for showdown
  lastAction?: string; // display hint for the UI
}

export interface HandAction {
  street: Street;
  seat: number;
  playerId: string;
  type: "post" | "fold" | "check" | "call" | "bet" | "raise" | "allin" | "deal" | "showdown" | "win";
  amount?: number; // chips
  note?: string; // e.g. hand description at showdown
}

export interface PotAward {
  amount: number;
  winners: string[]; // player ids
  handName?: string;
}

export interface HandResult {
  board: number[];
  awards: PotAward[];
  showdown: boolean;
  holeCardsRevealed: Record<string, number[]>;
}

export interface TableState {
  tableId: string;
  smallBlind: number;
  bigBlind: number;
  handNumber: number; // completed hands in this session
  maxHands: number; // session length
  dealerSeat: number;
  players: PlayerState[]; // fixed seats for the session; satOut when gone
  board: number[];
  deck: number[];
  street: Street;
  currentSeat: number; // whose decision is pending; -1 when none
  currentBet: number; // highest betThisStreet this street
  lastRaiseIncrement: number; // size of the last full bet/raise (min-raise base)
  minRaiseTo: number; // smallest legal raise-to total this street
  pot: number; // total chips in the middle (all streets, incl. live bets)
  actionLog: HandAction[];
  lastHandResult?: HandResult;
  rngState: number;
  sessionOver: boolean;
  awaitingDecision: boolean;
}

export interface LegalActions {
  seat: number;
  playerId: string;
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number; // all-in total
  potTotal: number;
}

export type Decision =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; toTotal: number } // raise-to amount in chips for this street
  | { type: "timeoutFold" };

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function nextRng(state: TableState): Rng {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  return mulberry32(state.rngState);
}

export function activePlayers(t: TableState): PlayerState[] {
  return t.players.filter((p) => !p.satOut && p.stack + p.committedThisHand > 0);
}

function inHand(t: TableState): PlayerState[] {
  // disconnected (mid-hand provider outage) players REMAIN contenders: their
  // committed chips are live and their cards go to showdown, like all-ins
  return t.players.filter((p) => !p.satOut && p.holeCards.length === 2 && !p.folded);
}

function canAct(p: PlayerState): boolean {
  return !p.satOut && !p.folded && !p.allIn && !p.disconnected;
}

function bettingComplete(t: TableState): boolean {
  const actors = t.players.filter((p) => !p.satOut && !p.disconnected && !p.folded && p.holeCards.length === 2);
  const live = actors.filter(canAct);
  if (live.length === 0) return true;
  if (live.length === 1 && actors.length > 1) {
    // one player left with chips, everyone else all-in or folded: still needs to match bets
    const p = live[0];
    return p.betThisStreet >= t.currentBet;
  }
  return live.every((p) => p.hasActedSinceFullRaise && p.betThisStreet === t.currentBet);
}

function advanceStreet(t: TableState): void {
  for (const p of t.players) {
    p.betThisStreet = 0;
    p.hasActedSinceFullRaise = false;
  }
  t.currentBet = 0;
  t.lastRaiseIncrement = t.bigBlind;
  t.minRaiseTo = t.bigBlind;

  const live = t.players.filter((p) => !p.satOut && !p.disconnected && !p.folded && p.holeCards.length === 2);
  if (live.length <= 1) {
    finishHand(t);
    return;
  }
  // nobody left who can act → run out the board
  if (!live.some(canAct) || live.filter(canAct).length <= 1) {
    // only possible to have one actor if others all-in; run out board then showdown
    runOutBoard(t);
    finishHand(t);
    return;
  }

  switch (t.street) {
    case "preflop":
      t.street = "flop";
      burnDeal(t, 3);
      break;
    case "flop":
      t.street = "turn";
      burnDeal(t, 1);
      break;
    case "turn":
      t.street = "river";
      burnDeal(t, 1);
      break;
    case "river":
      finishHand(t);
      return;
  }
  t.actionLog.push({ street: t.street, seat: -1, playerId: "", type: "deal", note: cardsStr(t.board) });
  setFirstActorPostflop(t);
  if (!t.awaitingDecision) {
    // everyone checked through instantly is resolved by caller loop; if no actor pending, close street
  }
}

function burnDeal(t: TableState, n: number): void {
  for (let i = 0; i < n; i++) {
    t.board.push(t.deck.pop()!);
  }
}

function setFirstActorPostflop(t: TableState): void {
  const order = seatOrderFrom(t, t.dealerSeat);
  for (const idx of order) {
    if (canAct(t.players[idx]) && t.players[idx].holeCards.length === 2 && !t.players[idx].folded) {
      t.currentSeat = idx;
      t.awaitingDecision = true;
      return;
    }
  }
  // no one can act (all all-in) — run out
  runOutBoard(t);
  finishHand(t);
}

function seatOrderFrom(t: TableState, fromSeat: number): number[] {
  const n = t.players.length;
  const order: number[] = [];
  for (let i = 1; i <= n; i++) order.push((fromSeat + i) % n);
  return order;
}

function runOutBoard(t: TableState): void {
  while (t.board.length < 5) t.board.push(t.deck.pop()!);
}

function postBlinds(t: TableState): void {
  const live = t.players.filter((p) => !p.satOut && p.stack > 0);
  const n = t.players.length;

  let sbSeat: number, bbSeat: number, utgSeat: number;
  if (live.length === 2) {
    // heads-up: button posts SB, other posts BB, button acts first preflop
    const [a, b] = live;
    const buttonIsA = t.players[t.dealerSeat].id === a.id;
    sbSeat = t.players.indexOf(buttonIsA ? a : b);
    bbSeat = t.players.indexOf(buttonIsA ? b : a);
    utgSeat = sbSeat;
  } else {
    const order = seatOrderFrom(t, t.dealerSeat).filter((i) => !t.players[i].satOut && t.players[i].stack > 0);
    sbSeat = order[0];
    bbSeat = order[1];
    utgSeat = order[2] ?? order[0];
  }

  post(t, sbSeat, t.smallBlind, "SB");
  post(t, bbSeat, t.bigBlind, "BB");
  t.currentBet = t.bigBlind;
  t.minRaiseTo = t.bigBlind * 2;
  t.lastRaiseIncrement = t.bigBlind;

  const firstActor = t.players[utgSeat];
  const canFirstAct = !firstActor.satOut && firstActor.stack > 0 && !firstActor.allIn;
  if (canFirstAct) {
    t.currentSeat = utgSeat;
    t.awaitingDecision = true;
  } else {
    // first actor is all-in from posting (or out): betting is complete.
    // Resolve NOW — leaving awaitingDecision=false with no lastHandResult
    // would strand the pot (the caller's startHand would kill the hand).
    if (live.filter(canAct).length === 0) {
      runOutBoard(t);
      finishHand(t);
    }
  }
}

function post(t: TableState, seat: number, amount: number, label: string): void {
  const p = t.players[seat];
  const amt = Math.min(amount, p.stack);
  p.stack -= amt;
  p.betThisStreet += amt;
  p.committedThisHand += amt;
  if (p.stack === 0) p.allIn = true;
  t.pot += amt;
  t.actionLog.push({ street: t.street, seat, playerId: p.id, type: "post", amount: amt, note: label });
}

export function startHand(t0: TableState): TableState {
  const t = clone(t0);
  const seated = t.players.filter((p) => !p.satOut && p.stack > 0);
  // a disconnected seat only persists within the hand — the tick's rotation
  // cashes them out at the boundary, so startHand never sees them
  if (seated.length < 2 || t.sessionOver) {
    t.awaitingDecision = false;
    t.sessionOver = true;
    return t;
  }

  // reset per-hand state
  t.board = [];
  t.street = "preflop";
  t.actionLog = [];
  t.pot = 0;
  t.currentBet = 0;
  t.lastRaiseIncrement = t.bigBlind;
  t.minRaiseTo = t.bigBlind;
  t.lastHandResult = undefined;

  for (const p of t.players) {
    p.holeCards = [];
    p.folded = false;
    p.allIn = false;
    p.betThisStreet = 0;
    p.committedThisHand = 0;
    p.hasActedSinceFullRaise = false;
    p.lastAction = undefined;
  }

  const rng = nextRng(t);
  t.deck = shuffle(makeDeck(), rng);

  // deal 2 cards to each stack-holding seated player
  for (let round = 0; round < 2; round++) {
    for (const p of t.players) {
      if (!p.satOut && !p.disconnected && p.stack > 0) p.holeCards.push(t.deck.pop()!);
    }
  }


  postBlinds(t);
  return t;
}

export function legalActions(t0: TableState): LegalActions | null {
  const t = t0;
  if (!t.awaitingDecision) return null;
  const p = t.players[t.currentSeat];
  const toCall = Math.max(0, t.currentBet - p.betThisStreet);
  const callCost = Math.min(toCall, p.stack);
  const maxRaiseTo = p.betThisStreet + p.stack;
  const canWager = p.stack > callCost; // has chips beyond calling
  return {
    seat: t.currentSeat,
    playerId: p.id,
    toCall,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    canBet: toCall === 0 && p.stack > 0,
    canRaise: toCall > 0 && canWager,
    minRaiseTo: Math.min(t.minRaiseTo, maxRaiseTo),
    maxRaiseTo,
    potTotal: t.pot,
  };
}

export function apply(t0: TableState, decision: Decision): TableState {
  const t = clone(t0); // returned state is independent of the input
  if (!t.awaitingDecision) throw new Error("no decision pending");
  const seat = t.currentSeat;
  const p = t.players[seat];
  const la = legalActions(t)!;
  const street = t.street;

  const prevBet = p.betThisStreet;
  switch (decision.type) {
    case "fold":
    case "timeoutFold": {
      p.folded = true;
      p.hasActedSinceFullRaise = true;
      p.lastAction = "fold";
      t.actionLog.push({ street, seat, playerId: p.id, type: "fold" });
      break;
    }
    case "check": {
      if (la.toCall > 0) throw new Error("cannot check facing a bet");
      p.hasActedSinceFullRaise = true;
      p.lastAction = "check";
      t.actionLog.push({ street, seat, playerId: p.id, type: "check" });
      break;
    }
    case "call": {
      const cost = Math.min(la.toCall, p.stack);
      p.stack -= cost;
      p.betThisStreet += cost;
      p.committedThisHand += cost;
      t.pot += cost;
      p.hasActedSinceFullRaise = true;
      if (p.stack === 0) p.allIn = true;
      p.lastAction = p.allIn ? "call all-in" : `call ${fmt(cost)}`;
      // all-in CALLS log as "call" with chips moved — "allin" is reserved for
      // all-in RAISES whose amount is the street total (replay pot math relies
      // on this distinction)
      t.actionLog.push({ street, seat, playerId: p.id, type: "call", amount: cost });
      break;
    }
    case "raise": {
      let to = Math.round(Number.isFinite(decision.toTotal as number) ? (decision.toTotal as number) : la.minRaiseTo);
      to = Math.max(Math.min(to, la.maxRaiseTo), la.minRaiseTo);
      if (to <= prevBet) throw new Error("raise must exceed current bet");
      const cost = to - prevBet;
      p.stack -= cost;
      p.betThisStreet = to;
      p.committedThisHand += cost;
      t.pot += cost;
      const increment = to - t.currentBet;
      const isFullRaise = to >= t.minRaiseTo;
      if (isFullRaise) {
        t.lastRaiseIncrement = Math.max(increment, t.lastRaiseIncrement);
        t.currentBet = to;
        t.minRaiseTo = to + t.lastRaiseIncrement;
        // everyone else must act again
        for (const other of t.players) {
          if (other !== p && !other.satOut && !other.folded) other.hasActedSinceFullRaise = false;
        }
      } else {
        // short all-in: doesn't reopen betting, but currentBet AND minRaiseTo
        // must be rebased — a stale minRaiseTo would let the next "raise" be
        // smaller than a legal min-raise over the new currentBet
        if (to > t.currentBet) {
          t.currentBet = to;
          t.minRaiseTo = to + t.lastRaiseIncrement;
        }
      }
      if (p.stack === 0) p.allIn = true;
      p.hasActedSinceFullRaise = true;
      const firstBet = la.toCall === 0;
      const verb = p.allIn ? "all-in" : firstBet ? "bet" : "raise";
      p.lastAction = `${verb} ${fmt(to)}`;
      t.actionLog.push({
        street,
        seat,
        playerId: p.id,
        type: p.allIn ? "allin" : firstBet ? "bet" : "raise",
        amount: to,
      });
      break;
    }
  }

  // bust check: a player with 0 chips and 0 commitment is out of the hand only
  t.awaitingDecision = false;

  const liveUnfolded = t.players.filter((x) => !x.satOut && x.holeCards.length === 2 && !x.folded);
  if (liveUnfolded.length === 1) {
    finishHand(t);
    return t;
  }

  if (bettingComplete(t)) {
    advanceStreet(t);
    return t;
  }

  // find next actor
  const order = seatOrderFrom(t, seat);
  for (const idx of order) {
    const q = t.players[idx];
    if (q.satOut || q.folded || q.holeCards.length !== 2 || !canAct(q)) continue;
    if (q.hasActedSinceFullRaise && q.betThisStreet === t.currentBet) continue;
    t.currentSeat = idx;
    t.awaitingDecision = true;
    return t;
  }
  // no actor found but betting not flagged complete — force street advance
  advanceStreet(t);
  return t;
}

function finishHand(t: TableState): void {
  t.awaitingDecision = false;
  t.street = "payout";

  const contenders = t.players.filter((p) => !p.satOut && p.holeCards.length === 2 && !p.folded);
  const awards: PotAward[] = [];
  const revealed: Record<string, number[]> = {};

  if (contenders.length === 1) {
    const w = contenders[0];
    awards.push({ amount: t.pot, winners: [w.id] });
    w.stack += t.pot;
    t.actionLog.push({ street: "payout", seat: -1, playerId: w.id, type: "win", amount: t.pot, note: "everyone folded" });
    t.pot = 0;
  } else {
    runOutBoard(t);
    t.street = "showdown";
    // First: return any uncalled excess to the largest committer.
    // (e.g. hero bets 100, short stack calls all-in 60 → 40 comes back, not a won pot)
    const committedPlayers = t.players
      .filter((p) => p.committedThisHand > 0)
      .sort((a, b) => b.committedThisHand - a.committedThisHand);
    if (committedPlayers.length >= 2) {
      const top = committedPlayers[0];
      const excess = top.committedThisHand - committedPlayers[1].committedThisHand;
      if (excess > 0) {
        top.stack += excess;
        top.committedThisHand -= excess;
        t.pot -= excess;
      }
    }
    // Side pots: walk commitment levels of the contenders (original amounts).
    const orig = new Map<string, number>(t.players.map((p) => [p.id, p.committedThisHand]));
    const levels = [...new Set(contenders.map((p) => orig.get(p.id)!))].sort((a, b) => a - b);
    const evals = new Map<string, number>();
    for (const p of contenders) {
      revealed[p.id] = p.holeCards;
      evals.set(p.id, evaluate([...p.holeCards, ...t.board]));
    }
    let prevLevel = 0;
    for (const level of levels) {
      let potAmount = 0;
      for (const p of t.players) {
        potAmount += Math.max(0, Math.min(orig.get(p.id)!, level) - prevLevel);
      }
      if (potAmount === 0) {
        prevLevel = level;
        continue;
      }
      const elig = contenders.filter((p) => orig.get(p.id)! >= level);
      const best = Math.max(...elig.map((p) => evals.get(p.id)!));
      const winners = elig.filter((p) => evals.get(p.id) === best);
      const each = Math.floor(potAmount / winners.length);
      let remainder = potAmount - each * winners.length;
      for (const w of winners) {
        let amt = each;
        if (remainder > 0) {
          amt += 1;
          remainder -= 1;
        }
        const seat = t.players.findIndex((x) => x.id === w.id);
        t.players[seat].stack += amt;
      }
      awards.push({ amount: potAmount, winners: winners.map((w) => w.id), handName: describe(best) });
      prevLevel = level;
    }
    // NOTE: committedThisHand is intentionally NOT reset here — recordHand
    // reads it to accrue per-hand netProfit (won − contributed). startHand
    // resets it for the next deal.

    // log showdown reveal
    for (const p of contenders) {
      t.actionLog.push({
        street: "showdown",
        seat: t.players.indexOf(p),
        playerId: p.id,
        type: "showdown",
        note: `${cardsStr(p.holeCards)} → ${describe(evals.get(p.id)!)}`,
      });
    }
    for (const a of awards) {
      t.actionLog.push({ street: "payout", seat: -1, playerId: a.winners[0], type: "win", amount: a.amount, note: a.handName });
    }
    // SELF-HEAL: the level walk must distribute the entire pot. Any residue
    // (possible when commitments exist above the top contender level after
    // the uncalled return — e.g. multiple disconnected players) is returned
    // to the highest committer rather than destroyed. Conservation over
    // elegance: chips are never deleted.
    const awarded = awards.reduce((x, a) => x + a.amount, 0);
    if (t.pot - awarded > 0) {
      const residue = t.pot - awarded;
      const topCommitter = [...t.players].sort((a, b) => b.committedThisHand - a.committedThisHand)[0];
      if (topCommitter) {
        topCommitter.stack += residue;
        t.actionLog.push({ street: "payout", seat: -1, playerId: topCommitter.id, type: "win", amount: residue, note: "uncalled residue returned" });
      }
    }
    t.pot = 0;
  }

  t.lastHandResult = { board: [...t.board], awards, showdown: contenders.length > 1, holeCardsRevealed: revealed };
  t.handNumber += 1;

  // bust players leave the seat
  for (const p of t.players) {
    if (!p.satOut && p.stack <= 0) {
      p.satOut = true;
      p.lastAction = "busted out";
    }
  }

  const remaining = t.players.filter((p) => !p.satOut && p.stack > 0);
  if (remaining.length <= 1 || t.handNumber >= t.maxHands) {
    t.sessionOver = true;
  }

  // advance the button to the next seat that will be in the next hand
  const order = seatOrderFrom(t, t.dealerSeat);
  const nextDealer = order.find((i) => !t.players[i].satOut && t.players[i].stack > 0);
  if (nextDealer !== undefined) t.dealerSeat = nextDealer;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
