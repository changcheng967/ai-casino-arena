import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/arena/store";
import { fideScale, poolStats } from "@/lib/arena/elo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const store = await getStore();
  const decoded = id;
  const m = await store.getModel(decoded);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const state = await store.getArenaState();
  const roomBySession = new Map(
    (state?.tables ?? []).map((tb, idx) => [
      tb.sessionRowId,
      `Table ${idx + 1}`,
    ]),
  );
  const [eloHistory, hands, sessions] = await Promise.all([
    store.eloHistoryFor(decoded, 200),
    Promise.resolve([]),
    store.listSessions(100),
  ]);
  const all = await store.listModels();
  const { mean, sd } = poolStats(all.filter((x) => x.status === "active"));
  return NextResponse.json({
    rating: fideScale(m.elo, mean, sd),
    poolMean: mean,
    poolSd: sd,
    model: m,
    vpip: m.handsPlayed > 0 ? Math.round((m.vpipHands / m.handsPlayed) * 1000) / 10 : null,
    pfr: m.handsPlayed > 0 ? Math.round((m.pfrHands / m.handsPlayed) * 1000) / 10 : null,
    eloHistory: eloHistory.reverse(),
    handsCount: 0,
    sessions: sessions
      .map((s) => {
        const seats = [...s.seats].sort((a, b) => (b.netDollars ?? 0) - (a.netDollars ?? 0));
        const rankOf = new Map(seats.map((x, i) => [x.modelId, i + 1]));
        return {
          ...s,
          live: !s.endedAt,
          roomName: roomBySession.get(s.id) ?? `${s.tierName}`,
          seats: seats
            .filter((x) => x.modelId === id)
            .map((x) => ({ ...x, rank: rankOf.get(x.modelId) ?? 0 })),
        };
      })
      .filter((s) => s.seats.length > 0)
      .slice(0, 20),
  });
}
