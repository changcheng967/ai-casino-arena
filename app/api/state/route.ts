import { NextResponse } from "next/server";
import { getStore } from "@/lib/arena/store";
import { fideScale, poolStats } from "@/lib/arena/elo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live snapshot of all tables for the watch pages.
// ?log=N controls how many action-log entries per table (default 12).
export async function GET(req: Request) {
  const logN = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("log") ?? 12) || 12));
  const store = await getStore();
  const [state, models] = await Promise.all([store.getArenaState(), store.listModels()]);
  const modelMap = new Map(models.map((m) => [m.id, m]));
  const { mean: poolMean, sd: poolSd } = poolStats(models.filter((m) => m.status === "active"));
  const ratingOf = (id: string) => {
    const m = modelMap.get(id);
    return m ? fideScale(m.elo, poolMean, poolSd) : 1500;
  };
  return NextResponse.json({
    tables:
      state?.tables.map((t, idx) => ({
        tableId: t.tableId,
        tierName: t.tierName,
        roomName: `Table ${idx + 1}`,
        sessionId: t.sessionRowId,
        sb: t.state.smallBlind,
        bb: t.state.bigBlind,
        handNumber: t.state.handNumber,
        maxHands: t.state.maxHands,
        street: t.state.street,
        board: t.state.board,
        pot: t.state.pot,
        // engine pot = all chips in the middle INCLUDING live street bets
        // (bets are added to pot as they're made), so display it directly
        potDisplay: t.state.pot,
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
          rating: ratingOf(p.id),
          bankroll: modelMap.get(p.id)?.bankroll ?? 0,
          stack: p.stack,
          bet: p.betThisStreet,
          committed: p.committedThisHand,
          folded: p.folded,
          allIn: p.allIn,
          satOut: p.satOut,
          lastAction: p.lastAction ?? null,
          holeCards: (() => {
            // revealed at hand end (showdown) — plus live all-in showdowns:
            // when every committed player is all-in, cards go on their backs
            // like a televised final table (showdown mode only; god sees all)
            const alive = t.state.players.filter((x) => !x.folded && x.holeCards.length === 2);
            const allInShowdown =
              alive.length === 2 && alive.every((x) => x.allIn);
            const atEnd = t.state.lastHandResult?.holeCardsRevealed?.[p.id];
            const revealSource =
              atEnd ?? (allInShowdown && !p.folded ? p.holeCards : null);
            return p.holeCards.length && (t.state.street === "payout" || !p.folded) && revealSource
              ? revealSource
              : null;
          })(),
          holeCardsLive: p.holeCards.length === 2 ? p.holeCards : null, // for god-view mode
        })),
        actionLog: t.state.actionLog.slice(-logN),
      })) ?? [],
    lobby: (() => {
      const waiting = models
        .filter((m) => m.status === "active" && m.chatCapable && !state?.tables.some((tb) => tb.state.players.some((p) => p.id === m.id)))
        .map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          bankroll: m.bankroll,
          elo: m.elo,
          since: state?.lobbySince?.[m.id] ?? null,
        }));
      // FIFO: queue order first (longest wait at the head), then any stragglers
      const order = new Map((state?.lobbyQueue ?? []).map((id, i) => [id, i]));
      return waiting.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) || (a.since ?? "").localeCompare(b.since ?? ""));
    })(),
    lobbyNotes: state?.lobbyNotes ?? [],
    lastTickAt: state?.lastTickAt ?? null,
    // a tick is actively working right now (lease held)
    ticking: (state?.leaseUntil ?? 0) > Date.now(),
    totalHandsEver: state?.totalHandsEver ?? 0,
    devTick: process.env.NODE_ENV !== "production",
  });
}
