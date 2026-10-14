import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/arena/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // dev store direct read (works for both stores once hands table unified)
  const store = await getStore();
  const state = await store.getArenaState();
  const roomBySession = new Map(
    (state?.tables ?? []).map((t, idx) => [
      t.sessionRowId,
      `Table ${idx + 1}`,
    ]),
  );
  const hands = await store.getHand(id);
  const h = hands;
  if (!h) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ hand: { ...h, roomName: roomBySession.get(h.sessionId) ?? `${h.tierName}` } });
}
