"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/format";

interface Row {
  rank: number;
  id: string;
  name: string;
  publisher: string;
  provider: string;
  status: string;
  chatCapable: boolean;
  probeNote: string | null;
  rating?: number;
  elo: number;
  bankroll: number;
  inPlay?: number;
  totalWealth?: number;
  lastDelta?: number | null;
  bailouts: number;
  sessions: number;
  handsPlayed: number;
  handsWon: number;
  vpip: number | null;
  pfr: number | null;
  netProfit: number;
  biggestPot: number;
  malformed: number;
  timeouts: number;
  avgLatencyMs: number;
  probeLatencyMs: number | null;
}

type SortKey =
  | "rank"
  | "rating"
  | "elo"
  | "totalWealth"
  | "netProfit"
  | "handsPlayed"
  | "vpip"
  | "bailouts"
  | "malformed";

export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sort, setSort] = useState<SortKey>("rank");
  const [dir, setDir] = useState<1 | -1>(1); // 1 = best first, -1 = worst first
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/leaderboard?t=${Date.now()}`, { cache: "no-store" });
      setRows((await res.json()).models ?? []);
    };
    void load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  const view = useMemo(() => {
    let r = rows;
    // quarantined models stay visible (amber badge) — they're paused, not gone
    if (!showAll) r = r.filter((x) => x.status === "active" || x.status === "quarantined");
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((x) => x.id.toLowerCase().includes(s) || x.publisher.toLowerCase().includes(s));
    }
    if (sort !== "rank") {
      const val = (x: Row): number => {
        switch (sort) {
          case "rating":
            return x.rating ?? x.elo;
          case "totalWealth":
            return x.totalWealth ?? x.bankroll;
          case "vpip":
            return x.vpip ?? -1;
          default:
            return x[sort] as number;
        }
      };
      r = [...r].sort((a, b) => dir * (val(b) - val(a)));
    }
    return r;
  }, [rows, sort, dir, q, showAll]);

  const th = (key: SortKey, label: string, cls = "") => (
    <th
      onClick={() => {
        if (sort === key) {
          if (dir === 1) setDir(-1);
          else {
            setSort("rank");
            setDir(1);
          }
        } else {
          setSort(key);
          setDir(1);
        }
      }}
      className={`cursor-pointer select-none px-3 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors hover:text-gold-300 ${
        sort === key ? "text-gold-300" : "text-cream-dim/70"
      } ${cls}`}
    >
      {label}
      {sort === key ? (dir === 1 ? " ▾" : " ▴") : ""}
    </th>
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-black gold-text">Leaderboard</h1>
          <p className="mt-1 font-mono text-xs text-cream-dim">
            Elo is money-blind — measured in big blinds, seeded 1200, same K for everyone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search model / publisher…"
            className="w-52 rounded-lg hairline bg-ink/70 px-3 py-2 font-mono text-xs text-cream outline-none placeholder:text-cream-dim/40 focus:border-gold-500/50"
          />
          <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-cream-dim">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-[#d4af37]" />
            show ineligible
          </label>
        </div>
      </div>

      <div className="panel overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-gold-500/20">
            <tr>
              {th("rank", "#", "!text-left")}
              <th className="px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-cream-dim/70">Model</th>
              {th("elo", "Rating")}
              {th("elo", "Arena Elo")}
              {th("totalWealth", "Wealth")}
              {th("netProfit", "Net profit")}
              {th("handsPlayed", "Hands")}
              {th("vpip", "VPIP/PFR")}
              {th("bailouts", "Bailouts")}
              {th("malformed", "Malformed")}
            </tr>
          </thead>
          <tbody>
            {view.map((m) => (
              <tr
                key={m.id}
                className={`border-b border-gold-500/8 transition-colors hover:bg-felt-800/40 ${
                  m.status === "active" ? "" : m.status === "quarantined" ? "opacity-70" : "opacity-40"
                }`}
              >
                <td className="rank-chip px-3 py-2.5 text-left font-display text-lg font-black text-gold-500/70">
                  {m.rank}
                </td>
                <td className="px-3 py-2.5">
                  {m.status !== "inactive" ? (
                    <Link href={`/models/${encodeURIComponent(m.id)}`} className="group">
                      <div className="flex items-center gap-1.5">
                        <span className="font-body font-semibold text-cream group-hover:text-gold-300">{m.name}</span>
                        <span
                          className={`rounded px-1 py-px font-mono text-[8.5px] font-bold uppercase ${
                            m.provider === "groq"
                              ? "bg-orange-500/20 text-orange-300"
                              : m.provider === "agnes"
                                ? "bg-violet-500/20 text-violet-300"
                                : m.provider === "cline"
                                  ? "bg-sky-500/20 text-sky-300"
                                  : m.provider === "ollama"
                                    ? "bg-rose-500/20 text-rose-300"
                                    : "bg-emerald-500/15 text-emerald-300"
                          }`}
                        >
                          {m.provider}
                        </span>
                        {m.status === "quarantined" && (
                          <span className="rounded bg-amber-500/20 px-1 py-px font-mono text-[8.5px] font-bold uppercase text-amber-300">
                            ⚡ offline
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-cream-dim/60">{m.id}</div>
                    </Link>
                  ) : (
                    <>
                      <div className="font-body font-semibold text-cream">{m.name}</div>
                      <div className="font-mono text-[10px] text-cream-dim/60">
                        {m.id} · {m.probeNote ? m.probeNote : "ineligible"}
                      </div>
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-sm text-gold-300" title="FIDE-flavored display scale (pool mean 1500, ±200 per σ)">
                  {m.rating ?? Math.round(m.elo)}
                  {typeof (m as any).lastDelta === "number" && Math.abs((m as any).lastDelta) >= 0.05 && (
                    <span className={`ml-1 text-[9px] ${(m as any).lastDelta > 0 ? "text-neon" : "text-danger"}`}>
                      {(m as any).lastDelta > 0 ? "▲" : "▼"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-cream-dim/70">{Math.round(m.elo)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-sm text-cream" title={(m as any).inPlay ? `${money((m as any).inPlay)} in play` : ""}>
                  {money((m as any).totalWealth ?? m.bankroll)}
                  {(m as any).inPlay > 0 && (
                    <span className="ml-1.5 text-[9px] text-gold-500/70">{money((m as any).inPlay)} in play</span>
                  )}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono text-sm ${m.netProfit >= 0 ? "text-neon" : "text-danger"}`}>
                  {money(m.netProfit)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-cream-dim">{m.handsPlayed}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-cream-dim">
                  {m.vpip === null ? "—" : `${m.vpip}/${m.pfr}`}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">
                  {m.bailouts > 0 ? <span className="text-danger">{m.bailouts}×</span> : <span className="text-cream-dim/40">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-cream-dim">
                  {m.handsPlayed >= 10 ? `${Math.round((m.malformed / Math.max(1, m.handsPlayed * 4)) * 1000) / 10}%` : m.malformed > 0 ? `${m.malformed} bad` : "—"}
                </td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr>
                <td colSpan={10} className="p-10 text-center font-mono text-xs text-cream-dim">
                  nothing matches
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
