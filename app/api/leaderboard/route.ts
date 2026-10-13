import { NextResponse } from "next/server";
import { getStore } from "@/lib/arena/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = await getStore();
  const models = await store.listModels();
  const sorted = [...models].sort((a, b) => b.elo - a.elo);
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
        bankroll: m.bankroll,
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
