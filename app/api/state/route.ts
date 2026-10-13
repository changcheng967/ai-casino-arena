import { NextResponse } from "next/server";
import { getStore } from "@/lib/arena/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live snapshot of all tables for the watch pages.
// ?log=N controls how many action-log entries per table (default 12).
export async function GET(req: Request) {
  const logN = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("log") ?? 12) || 12));
  const store = await getStore();
  const [state, models] = await Promise.all([store.getArenaState(), store.listModels()]);
  const modelMap = new Map(models.map((m) => [m.id, m]));
  return NextResponse.json({
    tables:
      state?.tables.map((t, idx) => ({
        tableId: t.tableId,
        tierName: t.tierName,
        // informative table title: number + room + exact stakes,
        // e.g. "Table 2 · Penny Rails · $1/$2"
        roomName: `Table ${idx + 1} · ${t.tierName} · $${t.state.smallBlind}/$${t.state.bigBlind}`,
        sessionId: t.sessionRowId,
        handNumber: t.state.handNumber,
        maxHands: t.state.maxHands,
        street: t.state.street,
        board: t.state.board,
        pot: t.state.pot,
        // chips already committed this street are shown on the seats; the big
        // pot figure shows the middle without double-counting live bets
        potDisplay: t.state.pot - t.state.players.reduce((x, p) => x + p.betThisStreet, 0),
        dealerSeat: t.state.dealerSeat,
        currentSeat: t.state.awaitingDecision ? t.state.currentSeat : -1,
        lastHandResult: t.state.lastHandResult ?? null,
        buyIns: t.buyIns,
        players: t.state.players.map((p, seat) => ({
          seat,
          id: p.id,
          name: p.name,
          publisher: modelMap.get(p.id)?.publisher ?? "",
          elo: modelMap.get(p.id)?.elo ?? 1200,
          bankroll: modelMap.get(p.id)?.bankroll ?? 0,
          stack: p.stack,
          bet: p.betThisStreet,
          committed: p.committedThisHand,
          folded: p.folded,
          allIn: p.allIn,
          satOut: p.satOut,
          lastAction: p.lastAction ?? null,
          holeCards: p.holeCards.length && (t.state.street === "payout" || p.folded === false) && t.state.lastHandResult?.holeCardsRevealed?.[p.id]
            ? t.state.lastHandResult.holeCardsRevealed[p.id]
            : null,
          holeCardsLive: p.holeCards.length === 2 ? p.holeCards : null, // for god-view mode
        })),
        actionLog: t.state.actionLog.slice(-logN),
      })) ?? [],
    lobbyNotes: state?.lobbyNotes ?? [],
    lastTickAt: state?.lastTickAt ?? null,
    totalHandsEver: state?.totalHandsEver ?? 0,
    devTick: process.env.NODE_ENV !== "production",
  });
}
