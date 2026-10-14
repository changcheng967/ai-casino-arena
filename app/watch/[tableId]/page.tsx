"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import PokerTable, { TableView } from "@/components/PokerTable";
import CardModeToggle, { useCardMode } from "@/components/CardModeToggle";
import { money, timeAgo, cardParts, shortModelName } from "@/lib/format";

interface StateResponse {
  tables: TableView[];
  lastTickAt: number | null;
  totalHandsEver: number;
  devTick?: boolean;
}

interface FeedAction {
  street: string;
  seat: number;
  playerId: string;
  type: string;
  amount?: number;
  note?: string;
}

interface SessionHand {
  id: string;
  handNo: number;
  board: number[];
  pot: number;
  showdown: boolean;
  winners: string[];
  createdAt: string;
}

const STREET_LABEL: Record<string, string> = {
  preflop: "Pre-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
  payout: "Payout",
};

function shortName(pid: string): string {
  return shortModelName(pid);
}

function ActionLine({ a }: { a: FeedAction }) {
  const who = a.playerId ? shortName(a.playerId) : "dealer";
  const verb =
    a.type === "post"
      ? `${a.note === "SB" ? "posts small blind" : "posts big blind"}`
      : a.type === "deal"
        ? "deals"
        : a.type;
  return (
    <div className="flex items-baseline gap-2 px-2 py-1 font-mono text-[11px]">
      <span className="w-14 shrink-0 text-right text-gold-500/60">{(a.amount ?? 0) > 0 ? money(a.amount ?? 0) : ""}</span>
      <span className={a.type === "fold" ? "text-cream-dim/60" : "text-cream"}>
        <span className="text-cream-dim">{who}</span> {verb}
      </span>
      {a.type === "deal" && a.note && (
        <span className="inline-flex gap-0.5">
          {a.note
            .split(" ")
            .filter((c) => /^[AKQJT2-9][cdhs]$/.test(c))
            .map((c, i) => {
              const p = cardParts(
                "23456789TJQKA".indexOf(c[0]) * 4 + "cdhs".indexOf(c[1]),
              );
              return (
                <span key={i} className={`font-bold ${p.red ? "text-danger" : "text-cream"}`}>
                  {p.rank}
                  {p.glyph}
                </span>
              );
            })}
        </span>
      )}
      {a.note && a.note.startsWith("“") && <span className="text-talk italic">{a.note}</span>}
      {a.type === "showdown" && a.note && !a.note.startsWith("“") && (
        <span className="text-gold-300">{a.note}</span>
      )}
      {a.type === "win" && <span className="text-neon">takes the pot</span>}
    </div>
  );
}

export default function TableDetailPage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = use(params);
  const [table, setTable] = useState<TableView | null>(null);
  const [meta, setMeta] = useState<StateResponse | null>(null);
  const [buyIns, setBuyIns] = useState<Record<string, number>>({});
  const [sessionHands, setSessionHands] = useState<SessionHand[]>([]);
  const [gone, setGone] = useState(false);
  const [cardMode, setCardMode] = useCardMode();
  const feedRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [st, hd] = await Promise.all([
        fetch(`/api/state?log=200&t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/hands?limit=20&sessionId=${encodeURIComponent(tableId)}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setMeta(st);
      setSessionHands(hd.hands ?? []);
      const t = (st.tables ?? []).find((x: TableView) => x.tableId === tableId) ?? null;
      setGone(!t);
      setTable(t);
      if (t) setBuyIns((t.buyIns ?? {}) as Record<string, number>);
    } catch {
      /* transient */
    }
  }, [tableId]);

  useEffect(() => {
    void load();
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [table?.actionLog?.length]);

  if (!meta) {
    return <main className="mx-auto max-w-6xl px-4 py-20 text-center font-mono text-sm text-cream-dim">loading table…</main>;
  }
  if (!table) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <div className="font-display text-2xl italic text-cream-dim">
          {gone ? "This table broke up." : "Table not found."}
        </div>
        <p className="mt-2 font-mono text-xs text-cream-dim/60">
          Tables run until they empty out — this one has no players left. Seats open up on the floor as players bust or cash out.
        </p>
        <Link href="/watch" className="mt-6 inline-block rounded-xl bg-gold-500/20 px-5 py-2.5 font-mono text-xs text-gold-300 hover:bg-gold-500/30">
          ← back to the floor
        </Link>
      </main>
    );
  }

  const feed = (table.actionLog ?? []) as FeedAction[];

  return (
    <main className="mx-auto max-w-[100rem] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link href="/watch" className="rounded-lg hairline px-3 py-1.5 font-mono text-xs text-cream-dim hover:text-gold-300">
            ← floor
          </Link>
          <div>
            <h1 className="font-display text-3xl font-black gold-text">{table.roomName ?? table.tierName}</h1>
            <p className="font-mono text-[11px] text-cream-dim">
              <span className="text-neon">● live</span> · hand {table.handNumber + 1} · {table.street} · ${table.sb ?? '?'}/${table.bb ?? '?'} ·
              pot {money(table.potDisplay ?? table.pot)} · tick {timeAgo(meta.lastTickAt)}
            </p>
          </div>
        </div>
        {meta.devTick && (
          <span className="font-mono text-[10px] text-cream-dim/50">table {table.tableId.slice(0, 8)}</span>
        )}
        <CardModeToggle mode={cardMode} onChange={setCardMode} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* big table */}
        <div className="p-2">
          <div className="[.poker-card]:!w-[2.9rem] [.poker-card]:!h-[4.1rem] [.poker-card.small]:!w-[2.3rem] [.poker-card.small]:!h-[3.2rem]">
            <PokerTable table={table} cardMode={cardMode} />
          </div>

          {/* session ledger */}
          <section className="panel mt-5 overflow-x-auto rounded-2xl">
            <div className="border-b border-gold-500/15 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">
              Session ledger
            </div>
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-gold-500/10 font-mono text-[10px] uppercase text-cream-dim/60">
                  <th className="px-4 py-2 text-left">Player</th>
                  <th className="px-4 py-2 text-right">Buy-in</th>
                  <th className="px-4 py-2 text-right">Stack</th>
                  <th className="px-4 py-2 text-right">In play</th>
                  <th className="px-4 py-2 text-right">Session net</th>
                  <th className="px-4 py-2 text-right">Bankroll</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {table.players.map((p) => {
                  const buyIn = buyIns[p.id] ?? 0;
                  const inPlay = p.stack + p.bet;
                  const net = inPlay - buyIn;
                  return (
                    <tr key={p.id} className={`border-b border-gold-500/8 ${p.satOut ? "opacity-40" : ""}`}>
                      <td className="px-4 py-2">
                        <Link href={`/models/${encodeURIComponent(p.id)}`} className="font-body font-semibold text-cream hover:text-gold-300">
                          {p.name}
                        </Link>
                        <div className="font-mono text-[9px] text-cream-dim/50">{p.id}</div>
                        {p.satOut && <span className="ml-2 text-[10px] uppercase text-danger">busted</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-cream-dim">{money(buyIn)}</td>
                      <td className="px-4 py-2 text-right text-gold-300">{money(p.stack)}</td>
                      <td className="px-4 py-2 text-right text-cream-dim">{money(inPlay)}</td>
                      <td className={`px-4 py-2 text-right ${net > 0 ? "text-neon" : net < 0 ? "text-danger" : "text-cream-dim"}`}>
                        {net >= 0 ? "+" : "−"}
                        {money(Math.abs(net))}
                      </td>
                      <td className="px-4 py-2 text-right text-cream-dim">{money(p.bankroll + buyIn)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>

        {/* side column: live feed + hands */}
        <div className="space-y-5">
          <section className="panel rounded-2xl">
            <div className="flex items-center justify-between border-b border-gold-500/15 px-4 py-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">Live hand feed</span>
              <span className="font-mono text-[10px] text-neon">hand #{table.handNumber + 1}</span>
            </div>
            <div ref={feedRef} className="max-h-[26rem] overflow-y-auto py-1">
              {feed.length === 0 && <div className="p-4 font-mono text-[11px] text-cream-dim/50">waiting for the next hand…</div>}
              {feed.map((a, i) => {
                const prev = feed[i - 1];
                const newStreet = !prev || prev.street !== a.street;
                return (
                  <div key={i}>
                    {newStreet && (
                      <div className="mt-2 border-t border-gold-500/10 px-2 pb-0.5 pt-1.5 font-mono text-[9px] uppercase tracking-[0.35em] text-gold-500/70 first:border-0">
                        {STREET_LABEL[a.street] ?? a.street}
                      </div>
                    )}
                    <ActionLine a={a} />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel rounded-2xl">
            <div className="border-b border-gold-500/15 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">
              This table — recent hands
            </div>
            {sessionHands.length === 0 && (
              <div className="p-4 font-mono text-[11px] text-cream-dim/50">no completed hands yet</div>
            )}
            {sessionHands.map((h) => (
              <Link
                key={h.id}
                href={`/hands/${h.id}`}
                className="flex items-center gap-3 border-b border-gold-500/8 px-4 py-2 font-mono text-[11px] transition hover:bg-felt-800/40"
              >
                <span className="w-10 text-cream-dim/50">#{h.handNo}</span>
                <span className="inline-flex min-w-[4.5rem] gap-0.5">
                  {h.board.map((c, i) => {
                    const p = cardParts(c);
                    return (
                      <span key={i} className={`font-bold ${p.red ? "text-danger" : "text-cream"}`}>
                        {p.rank}
                        {p.glyph}
                      </span>
                    );
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate text-cream-dim">
                  {h.winners.map((w) => shortName(w)).join(", ")}{" "}
                  <span className="text-gold-300">{money(h.pot)}</span>
                </span>
                {h.showdown && <span className="rounded bg-gold-500/15 px-1 text-[9px] text-gold-300">SD</span>}
                <span className="text-cream-dim/40">replay</span>
              </Link>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
