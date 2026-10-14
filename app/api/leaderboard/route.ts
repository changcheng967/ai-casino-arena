import { NextResponse } from "next/server";
import { getStore } from "@/lib/arena/store";
import { fideScale, poolStats } from "@/lib/arena/elo";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = await getStore();
  const models = await store.listModels();
  const sorted = [...models].sort((a, b) => b.elo - a.elo);
  // fair wealth: seated players' chips on the felt count too, otherwise a
  // model deep in a winning session looks poorer than a lobby idler
  const state = await store.getArenaState();
  // most recent settlement delta per model, for ▲/▼ movement arrows
  let lastDelta = new Map<string, number>();
  try {
    const hist = await (store as any).db?.execute?.(
      // Neon-only fast path; dev store simply shows no arrows
      Object.assign(sql`SELECT DISTINCT ON (model_id) model_id, delta FROM elo_history ORDER BY model_id, created_at DESC`),
    );
    const rows = (hist as any)?.rows ?? hist ?? [];
    for (const r of rows) lastDelta.set(r.model_id, Number(r.delta));
  } catch {
    lastDelta = new Map();
  }
  const inPlay = new Map<string, number>();
  for (const tb of state?.tables ?? []) {
    for (const pl of tb.state.players) {
      inPlay.set(pl.id, (inPlay.get(pl.id) ?? 0) + Math.max(0, pl.stack) + pl.betThisStreet);
    }
  }
  const { mean, sd } = poolStats(sorted.filter((m) => m.status === "active"));
  return NextResponse.json({
    models: sorted.map((m, i) => {
      const vpip = m.handsPlayed > 0 ? (m.vpipHands / m.handsPlayed) * 100 : null;
      const pfr = m.handsPlayed > 0 ? (m.pfrHands / m.handsPlayed) * 100 : null;
      return {
        rank: i + 1,
        id: m.id,
        name: m.name,
        publisher: m.publisher,
        provider: (m as any).provider ?? "nim",
        status: m.status,
        chatCapable: m.chatCapable,
        probeNote: (m as any).probeNote ?? null,
        elo: m.elo,
        rating: fideScale(m.elo, mean, sd),
        lastDelta: lastDelta.get(m.id) ?? null,
        bankroll: m.bankroll,
        inPlay: inPlay.get(m.id) ?? 0,
        totalWealth: m.bankroll + (inPlay.get(m.id) ?? 0),
        bailouts: m.bailouts,
        sessions: m.sessions,
        handsPlayed: m.handsPlayed,
        handsWon: m.handsWon,
        vpip: vpip === null ? null : Math.round(vpip * 10) / 10,
        pfr: pfr === null ? null : Math.round(pfr * 10) / 10,
        netProfit: m.netProfit,
        biggestPot: m.biggestPot,
        malformed: m.malformed,
        timeouts: m.timeouts,
        avgLatencyMs: m.avgLatencyMs,
        probeLatencyMs: m.probeLatencyMs,
      };
    }),
  });
}
