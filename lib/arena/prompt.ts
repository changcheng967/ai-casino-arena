// Prompt construction for LLM poker decisions and session buy-ins.

import { TableState, LegalActions } from "../poker/engine";
import { cardsStr } from "../poker/cards";
import { equityVsRandom } from "../poker/equity";
import { StakeTier } from "./stakes";
import { personaFor } from "./personas";

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

const POSITION_NAMES_6 = ["UTG", "MP", "CO", "BTN", "SB", "BB"];

export function positionLabel(t: TableState, seat: number): string {
  const active = t.players
    .map((p, i) => ({ p, i }))
    .filter((x) => !x.p.satOut && x.p.stack + x.p.committedThisHand > 0);
  const n = active.length;
  if (n === 2) return seat === t.dealerSeat ? "BTN/SB" : "BB";
  // order starting after the button
  const order = [...Array(t.players.length).keys()]
    .map((k) => (t.dealerSeat + 1 + k) % t.players.length)
    .filter((i) => !t.players[i].satOut && t.players[i].stack + t.players[i].committedThisHand > 0);
  const idx = order.indexOf(seat);
  // preflop order: first three are UTG/MP/CO, then BTN, SB, BB
  const map = ["UTG", "MP", "CO", "BTN", "SB", "BB"];
  return map[Math.min(idx, 5)] ?? "?";
}

export function systemPrompt(modelId: string, modelName: string): string {
  const persona = personaFor(modelId);
  return [
    `You are ${modelName}, a professional No-Limit Texas Hold'em cash-game player in the AI Casino Arena.`,
    `Your style: ${persona.style}`,
    `Play to WIN chips. Key habits of winners:`,
    `- Defend your big blind: facing a single raise with any pair, two broadways, or suited connectors is usually worth one call.`,
    `- Folding everything is a LOSING strategy — the blinds bleed you dry. Typical winners play 20-35% of hands.`,
    `- Raise your premium hands (big pairs, AK/AQ), bet strong made hands, and bluff occasionally in position.`,
    `- Use pot odds: if the call costs little relative to the pot and your equity hint is decent, take it.`,
    `Reply with ONLY one minified JSON object, no markdown, no explanations:`,
    `{"action":"fold"|"check"|"call"|"raise"|"allin","amount":<number>,"talk":"<max 60 chars of table banter>"}`,
    `"amount" is the raise-TO total in dollars for the current street (not the increment). Omit amount unless raising.`,
  ].join("\n");
}

export function decisionPrompt(t: TableState, la: LegalActions, bankroll: number): string {
  const me = t.players[la.seat];
  const opponents = t.players
    .filter((p, i) => i !== la.seat && p.holeCards.length === 2)
    .map((p, i) => {
      const status = p.folded ? "FOLDED" : p.allIn ? "ALL-IN" : "active";
      return `  seat${i}: ${p.name} — stack ${money(p.stack)}, bet ${money(p.betThisStreet)}, ${status}, last: ${p.lastAction ?? "-"}`;
    })
    .join("\n");

  const activeOpponents = t.players.filter(
    (p, i) => i !== la.seat && p.holeCards.length === 2 && !p.folded,
  ).length;
  const equity = equityVsRandom(me.holeCards, t.board, Math.max(1, activeOpponents));

  const history = t.actionLog
    .slice(-8)
    .map((a) => `${a.street}:${a.playerId ? a.playerId.replace(/:free$/, "").split("/").pop() : "table"} ${a.type}${a.amount ? " " + money(a.amount) : ""}`)
    .join(" | ");

  return [
    `Respond INSTANTLY with the JSON — no step-by-step reasoning, no deliberation, first instinct:`,
    `{"action":"fold"|"check"|"call"|"raise","amount":<raise-to total>,"talk":"<max 60 chars>"}`,
    ``,
    `Stakes ${money(t.smallBlind)}/${money(t.bigBlind)} | hand #${t.handNumber + 1} | ${t.street}`,
    `You: seat${la.seat} (${positionLabel(t, la.seat)}), stack ${money(me.stack)}, cards ${cardsStr(me.holeCards)}`,
    t.board.length ? `Board: ${cardsStr(t.board)}` : `Board: (pre-flop)`,
    `Pot ${money(la.potTotal)} | to call ${money(la.toCall)} | raise to ${money(la.minRaiseTo)}…${money(la.maxRaiseTo)} (all-in)`,
    `Equity ~${Math.round(equity * 100)}% vs ${activeOpponents} random hands (house Monte Carlo)`,
    `Opponents:`,
    opponents || "  (none)",
    `Recent: ${history || "(new hand)"}`,
    `Bankroll off-table: ${money(bankroll)}`,
    `JSON now.`,
  ].join("\n");
}

export function buyinSystemPrompt(modelName: string): string {
  return `You are ${modelName}, choosing your buy-in for a poker session. Reply ONLY with JSON: {"buyin": <number in dollars>}`;
}

export function buyinPrompt(tier: StakeTier, bankroll: number): string {
  return [
    `Stakes: ${money(tier.sb)}/${money(tier.bb)} (${tier.name} room).`,
    `Table minimum buy-in: ${money(tier.minBuyIn)} (40 big blinds).`,
    `Your total bankroll: ${money(bankroll)}. You may bring anything from the minimum up to your entire bankroll.`,
    `A standard session buy-in is 100bb = ${money(tier.targetStack)}. Bringing more means bigger swings but more pressure on opponents.`,
    `How much do you buy in for? JSON only.`,
  ].join("\n");
}

export function leaveSystemPrompt(modelName: string): string {
  return `You are ${modelName}, a poker pro deciding whether to keep playing at your current table or cash out. Reply ONLY with JSON: {"leave": true} or {"leave": false}`;
}

export function leavePrompt(args: {
  sb: number;
  bb: number;
  buyIn: number;
  stack: number;
  handsThisSeat: number;
  bankrollOutside: number;
}): string {
  const net = args.stack - args.buyIn;
  const netBB = Math.round((net / args.bb) * 10) / 10;
  return [
    `Stakes: ${money(args.sb)}/${money(args.bb)}.`,
    `You sat with ${money(args.buyIn)} and have played ${args.handsThisSeat} hands at this seat.`,
    `Current stack: ${money(args.stack)} (${net >= 0 ? "+" : "−"}${money(Math.abs(net))}, ${netBB} bb).`,
    `Your bankroll away from the table: ${money(args.bankrollOutside)}.`,
    `Cashing out locks your win/loss and frees you to pick a new table (possibly higher stakes). Staying means grinding on.`,
    `Do you leave the table now? JSON only.`,
  ].join("\n");
}
