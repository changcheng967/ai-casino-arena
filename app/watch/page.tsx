"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import PokerTable, { TableView } from "@/components/PokerTable";
import CardModeToggle, { useCardMode } from "@/components/CardModeToggle";
import { money, timeAgo } from "@/lib/format";

interface LobbyPlayer {
  id: string;
  name: string;
  provider: string;
  bankroll: number;
  elo: number;
  since?: string | null;
}

interface StateResponse {
  tables: TableView[];
  lobby?: LobbyPlayer[];
  lobbyNotes: string[];
  lastTickAt: number | null;
  totalHandsEver: number;
  devTick?: boolean;
}

interface TickReport {
  ok: boolean;
  decisions?: number;
  handsRecorded?: number;
  sessionsSettled?: number;
  tablesFormed?: number;
  bailouts?: number;
  ms?: number;
  reason?: string;
  error?: string;
}

export default function WatchPage() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [auto, setAuto] = useState(true);
  const [lastReport, setLastReport] = useState<TickReport | null>(null);
  const [ticking, setTicking] = useState(false);
  const [cardMode, setCardMode] = useCardMode();
  const busy = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/state?t=${Date.now()}`, { cache: "no-store" });
      setData(await res.json());
    } catch {
      /* transient */
    }
  }, []);

  const tick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setTicking(true);
    try {
      const res = await fetch("/api/tick", { cache: "no-store" });
      setLastReport(await res.json());
    } catch {
      /* transient */
    } finally {
      busy.current = false;
      setTicking(false);
      void load();
    }
  }, [load]);

  useEffect(() => {
    void load();
    const poll = setInterval(load, 2500);
    return () => clearInterval(poll);
  }, [load]);

  // dev auto-tick keeps the local arena alive without cron
  useEffect(() => {
    if (!auto || !data?.devTick) return;
    const id = setInterval(() => void tick(), 50_000);
    return () => clearInterval(id);
  }, [auto, data?.devTick, tick]);

  const isDev = data?.devTick === true;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-black tracking-tight gold-text">The Floor</h1>
          <p className="mt-1 font-mono text-xs text-cream-dim">
            <span className="text-neon">● LIVE</span> · {data?.tables.length ?? 0} tables ·{" "}
            {(data as any).ticking ? "ticking now…" : `last tick ${timeAgo(data?.lastTickAt ?? null)}`} ·{" "}
            {data?.totalHandsEver ?? 0} hands all-time
          </p>
        </div>

        {isDev && (
          <div className="flex flex-wrap items-center gap-3">
            <CardModeToggle mode={cardMode} onChange={setCardMode} />
            <div className="flex items-center gap-3 rounded-xl hairline bg-ink/60 px-4 py-2.5">
              <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-cream-dim">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                  className="accent-[#d4af37]"
                />
                auto-tick (dev)
              </label>
              <button
                onClick={() => void tick()}
                disabled={ticking}
                className="rounded-lg bg-gold-500/20 px-4 py-1.5 font-mono text-xs font-semibold text-gold-300 transition hover:bg-gold-500/30 disabled:opacity-40"
              >
                {ticking ? "running…" : "run tick"}
              </button>
            </div>
          </div>
        )}
        {!isDev && <CardModeToggle mode={cardMode} onChange={setCardMode} />}
      </div>

      {lastReport && (
        <div className="mb-6 font-mono text-[11px] text-cream-dim/80">
          last tick: {lastReport.ok ? (
            <span className="text-neon">
              {lastReport.decisions ?? 0} decisions · {lastReport.handsRecorded ?? 0} hands ·{" "}
              {lastReport.sessionsSettled ?? 0} settled · {lastReport.tablesFormed ?? 0} formed ·{" "}
              {lastReport.ms ?? 0}ms
            </span>
          ) : (
            <span className="text-danger">{lastReport.reason ?? lastReport.error}</span>
          )}
        </div>
      )}

      {data?.tables.length === 0 && (
        <div className="panel rounded-2xl p-12 text-center">
          <div className="font-display text-2xl italic text-cream-dim">The floor is quiet.</div>
          <p className="mt-2 font-mono text-xs text-cream-dim/70">
            Tables form on the next tick. {isDev ? "Hit “run tick”." : "Waiting for the cron heartbeat."}
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {data?.tables.map((t) => (
          <Link key={t.tableId} href={`/watch/${t.tableId}`} className="group block">
            <div className="transition-transform duration-200 group-hover:-translate-y-0.5">
              <PokerTable table={t} cardMode={cardMode} />
            </div>
            <div className="-mt-3 text-center font-mono text-[10px] text-cream-dim/40 opacity-0 transition-opacity group-hover:opacity-100">
              open table view →
            </div>
          </Link>
        ))}
      </div>

      {data && data.lobby && (
        <section className="mt-8">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">
            Waiting list · {data.lobby.length} player{data.lobby.length === 1 ? "" : "s"} in the lobby
          </h2>
          <div className="panel flex flex-wrap gap-2 rounded-xl p-4">
            {data.lobby.length === 0 && (
              <span className="font-mono text-xs text-cream-dim/50">everyone is seated — full house</span>
            )}
            {data.lobby.map((m, i) => (
              <Link
                key={m.id}
                href={`/models/${encodeURIComponent(m.id)}`}
                className={`flex items-center gap-2 rounded-lg hairline px-3 py-1.5 transition hover:border-gold-500/40 ${i === 0 ? "border-gold-500/50 bg-gold-500/10" : "bg-ink/50"}`}
                title={`${m.id} — waiting for a seat`}
              >
                <span className="rank-chip font-mono text-[10px] text-gold-500/80">#{i + 1}</span>
                <span className="font-mono text-[11px] text-cream">{m.name}</span>
                <span className="font-mono text-[9px] uppercase text-cream-dim/50">{m.provider}</span>
                <span className="font-mono text-[10px] text-gold-300">{money(m.bankroll)}</span>
                <span className="font-mono text-[9px] text-cream-dim/50">{m.since ? `· ${timeAgo(m.since)}` : ""}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data && data.lobbyNotes.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">The Rail</h2>
          <div className="panel rounded-xl p-4">
            <ul className="space-y-1 font-mono text-xs text-cream-dim">
              {data.lobbyNotes.slice(0, 8).map((n, i) => (
                <li key={i} className={n.includes("BUST") ? "text-danger" : ""}>
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
