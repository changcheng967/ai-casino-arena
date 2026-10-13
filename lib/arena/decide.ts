// Ask a NIM model for a poker decision; robustly parse; fall back to a legal
// default so the table never stalls. Returns the engine decision + telemetry.

import { z } from "zod";
import { nimChat, extractJson, Provider } from "../nim/client";
import { TableState, LegalActions, Decision } from "../poker/engine";
import { systemPrompt, decisionPrompt, leaveSystemPrompt, leavePrompt } from "./prompt";
import { DECISION_TIMEOUT_MS, DECISION_RETRIES } from "./config";

// Offline/demo mode: instant scripted decisions, no API calls.
export const fakeLlm = () => process.env.ARENA_FAKE_LLM === "1";

/** Should this player leave the table? (LLM decision; deterministic in demo mode.) */
export async function askLeave(args: {
  modelId: string;
  modelRef?: string;
  provider?: Provider;
  modelName: string;
  sb: number;
  bb: number;
  buyIn: number;
  stack: number;
  handsThisSeat: number;
  bankrollOutside: number;
}): Promise<boolean> {
  if (fakeLlm()) {
    // demo: winners bank it, stuck players quit — churn keeps the demo lively
    const net = args.stack - args.buyIn;
    return net >= args.buyIn * 1.5 || net <= -args.buyIn * 0.6;
  }
  try {
    const res = await nimChat({
      model: args.modelRef ?? args.modelId,
      provider: args.provider,
      system: leaveSystemPrompt(args.modelName),
      user: leavePrompt(args),
      maxTokens: 300,
      temperature: 0.6,
      timeoutMs: 15_000,
      retries: 0,
    });
    const parsed = extractJson(res.text);
    return parsed?.leave === true;
  } catch {
    return false; // on failure, stay seated (safe default)
  }
}

const DecisionJson = z.object({
  action: z.union([z.literal("fold"), z.literal("check"), z.literal("call"), z.literal("raise"), z.literal("bet"), z.literal("allin"), z.literal("all-in"), z.literal("all in")]),
  amount: z.coerce.number().optional().nullable(),
  talk: z.string().max(120).optional().nullable(),
});

export interface DecisionOutcome {
  decision: Decision;
  talk?: string;
  ok: boolean; // true = valid JSON from the model
  latencyMs: number | null;
  error?: string;
}

export function fallbackDecision(la: LegalActions): Decision {
  return la.toCall === 0 ? { type: "check" } : { type: "fold" };
}

export async function askDecision(
  modelId: string,
  modelName: string,
  t: TableState,
  la: LegalActions,
  bankroll: number,
  modelRef?: string,
  provider?: Provider,
  timeoutMs?: number,
): Promise<DecisionOutcome> {
  if (fakeLlm()) {
    // deterministic-ish scripted player: uses the equity hint + noise
    const { equityVsRandom } = await import("../poker/equity");
    const me = t.players[la.seat];
    const opps = Math.max(1, t.players.filter((p, i) => i !== la.seat && p.holeCards.length === 2 && !p.folded).length);
    const eq = equityVsRandom(me.holeCards, t.board, opps, 60);
    const noise = ((me.stack * 2654435761) % 100) / 100;
    const r = eq * 0.75 + noise * 0.25;
    let decision: Decision;
    if (la.toCall === 0) {
      decision = r > 0.62 ? { type: "raise", toTotal: Math.min(la.maxRaiseTo, la.minRaiseTo + Math.floor(r * la.potTotal)) } : { type: "check" };
    } else {
      const potOdds = la.toCall / Math.max(1, la.potTotal + la.toCall);
      if (r > 0.7 && la.canRaise) decision = { type: "raise", toTotal: Math.min(la.maxRaiseTo, la.minRaiseTo + Math.floor(r * la.potTotal)) };
      else if (r > potOdds * 0.9) decision = { type: "call" };
      else decision = { type: "fold" };
    }
    return { decision, talk: r > 0.8 ? "monster hand incoming" : undefined, ok: true, latencyMs: 1 };
  }
  let raw = "";
  let latencyMs: number | null = null;
  let error: string | undefined;
  try {
    const res = await nimChat({
      model: modelRef ?? modelId,
      provider,
      system: systemPrompt(modelId, modelName),
      user: decisionPrompt(t, la, bankroll),
      maxTokens: 600,
      temperature: 0.6,
      timeoutMs: timeoutMs ?? DECISION_TIMEOUT_MS,
      retries: DECISION_RETRIES,
    });
    raw = res.text;
    latencyMs = res.latencyMs;
  } catch (e: any) {
    return { decision: fallbackDecision(la), ok: false, latencyMs: null, error: String(e?.message ?? e).slice(0, 200) };
  }

  const parsed = extractJson(raw);
  const check = DecisionJson.safeParse(parsed);
  if (!check.success) {
    return { decision: fallbackDecision(la), ok: false, latencyMs, error: "unparsable: " + raw.slice(0, 120) };
  }
  const { action, amount, talk } = check.data;
  const talkClean = (talk ?? "").slice(0, 80).trim() || undefined;

  // Map to a LEGAL action; every branch respects la constraints.
  switch (action) {
    case "fold":
      return { decision: { type: "fold" }, talk: talkClean, ok: true, latencyMs };
    case "check":
      if (la.toCall === 0) return { decision: { type: "check" }, talk: talkClean, ok: true, latencyMs };
      return { decision: { type: "fold" }, talk: talkClean, ok: true, latencyMs };
    case "call":
      if (la.toCall > 0) return { decision: { type: "call" }, talk: talkClean, ok: true, latencyMs };
      return { decision: { type: "check" }, talk: talkClean, ok: true, latencyMs };
    case "raise":
    case "bet": {
      if (la.toCall === 0 && la.canBet) {
        const target = Math.round(amount ?? la.minRaiseTo);
        return { decision: { type: "raise", toTotal: target }, talk: talkClean, ok: true, latencyMs };
      }
      if (la.canRaise) {
        const target = Math.round(amount ?? la.minRaiseTo);
        return { decision: { type: "raise", toTotal: target }, talk: talkClean, ok: true, latencyMs };
      }
      // can't raise (all-in shove less than min-raise is still allowed via clamp) → call
      return { decision: la.toCall > 0 ? { type: "call" } : { type: "check" }, talk: talkClean, ok: true, latencyMs };
    }
    case "allin":
    case "all-in":
    case "all in": {
      return { decision: { type: "raise", toTotal: la.maxRaiseTo }, talk: talkClean, ok: true, latencyMs };
    }
  }
}
