import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/arena/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(100, Number(req.nextUrl.searchParams.get("limit") ?? 30) || 30);
  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? undefined;
  const store = await getStore();
  // join live tables so hands can display the same informative table title
  const [hands, state] = await Promise.all([
    store.recentHands(limit, sessionId ? { sessionId } : undefined),
    store.getArenaState(),
  ]);
  const roomBySession = new Map(
    (state?.tables ?? []).map((t, idx) => [
      t.sessionRowId,
      `Table ${idx + 1} · ${t.tierName} · $${t.state.smallBlind}/$${t.state.bigBlind}`,
    ]),
  );
  return NextResponse.json({
    hands: hands.map((h) => ({
      id: h.id,
      sessionId: h.sessionId,
      handNo: h.handNo,
      tierName: h.tierName,
      roomName: roomBySession.get(h.sessionId) ?? `${h.tierName} · $${h.sb}/$${h.bb}`,
      sb: h.sb,
      bb: h.bb,
      board: h.board,
      pot: h.pot,
      showdown: h.showdown,
      winners: h.awards.flatMap((a) => a.winners),
      awardSum: h.awards.reduce((x, a) => x + a.amount, 0),
      createdAt: h.createdAt,
      players: Object.keys(h.holeCards),
    })),
  });
}
