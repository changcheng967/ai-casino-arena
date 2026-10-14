"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { money, timeAgo, cardParts } from "@/lib/format";

interface ModelDetail {
  model: {
    id: string;
    name: string;
    publisher: string;
    elo: number;
    bankroll: number;
    bailouts: number;
    sessions: number;
    handsPlayed: number;
    handsWon: number;
    showdowns: number;
    showdownsWon: number;
    netProfit: number;
    biggestPot: number;
    malformed: number;
    timeouts: number;
    avgLatencyMs: number;
    probeLatencyMs: number | null;
  };
  vpip: number | null;
  pfr: number | null;
  eloHistory: { elo: number; delta: number; createdAt: string }[];
  sessions: {
    id: string;
    tierName: string;
    roomName?: string;
    sb: number;
    bb: number;
    hands: number;
    endedAt: string | null;
    seats: { rank: number; buyIn: number; finalStack: number; netDollars: number; netBB: number; eloAfter: number }[];
  }[];
}

function Sparkline({
  points,
  poolMean,
  poolSd,
}: {
  points: { elo: number; createdAt: string }[];
  poolMean: number;
  poolSd: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <div className="font-mono text-xs text-cream-dim/50">not enough history yet — the chart fills in live, one point per hand</div>;
  // plot the scaled Rating (the headline number), same transform as everywhere
  const scale = (e: number) => Math.round(1500 + (200 * (e - poolMean)) / Math.max(1, poolSd));
  const vals = points.map((p) => scale(p.elo));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const w = 720;
  const h = 160;
  const padX = 6;
  const x = (i: number) => padX + (i / (points.length - 1)) * (w - padX * 2);
  const y = (v: number) => h - 14 - ((v - min) / span) * (h - 28);
  const path = vals.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
  const up = vals[vals.length - 1] >= vals[0];
  const line = up ? "#3dffa0" : "#ff5d6e";
  const t0 = points[0].createdAt;
  const t1 = points[points.length - 1].createdAt;
  const step = (w - padX * 2) / Math.max(1, points.length - 1);
  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          const idx = Math.round((px - padX) / step);
          setHover(Math.max(0, Math.min(points.length - 1, idx)));
        }}
      >
        <defs>
          <linearGradient id="fillg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={line} stopOpacity="0.25" />
            <stop offset="100%" stopColor={line} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padX} y1={y(1200)} x2={w - padX} y2={y(1200)} stroke="#8a6f1f" strokeWidth="1" strokeDasharray="4 5" opacity="0.5" />
        <polygon points={`${padX},${h - 2} L ${path} L ${w - padX},${h - 2}`} fill="url(#fillg)" stroke="none" />
        <path d={`M ${path}`} fill="none" stroke={line} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <line x1={x(hover)} y1={4} x2={x(hover)} y2={h - 4} stroke="#d4af37" strokeWidth="1" opacity="0.6" />
        )}
        {hover !== null && <circle cx={x(hover)} cy={y(vals[hover])} r="4.5" fill="#d4af37" stroke="#0d0f0c" strokeWidth="1.5" />}
        <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r="3.5" fill={line} />
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-gold-500/30 bg-ink/95 px-2.5 py-1.5 font-mono text-[10px] text-cream shadow-lg"
          style={{ left: `${Math.min(85, Math.max(2, (x(hover!) / w) * 100))}%` }}
        >
          <div className="text-cream">Rating {scale(hp.elo)}</div>
          <div className="text-cream-dim/70">arena Elo {hp.elo.toFixed(1)}</div>
          <div className="text-cream-dim/80">
            {hover! > 0 ? (
              (() => {
                const d = scale(hp.elo) - scale(points[hover! - 1].elo);
                return (
                  <>
                    <span className={d >= 0 ? "text-neon" : "text-danger"}>
                      {d >= 0 ? "+" : ""}
                      {d.toFixed(1)}
                    </span>{" "}
                    vs previous
                  </>
                );
              })()
            ) : (
              "season start"
            )}{" "}
            · {timeAgo(hp.createdAt)}
          </div>
        </div>
      )}
      <div className="mt-1 flex justify-between font-mono text-[9px] text-cream-dim/50">
        <span>{timeAgo(t0)}</span>
        <span className="text-gold-500/70">··· 1500 = pool average ··· hover for values ···</span>
        <span>
          {vals[0].toFixed(0)} → <span className={up ? "text-neon" : "text-danger"}>{vals[vals.length - 1].toFixed(0)}</span> · {timeAgo(t1)}
        </span>
      </div>
    </div>
  );
}

function MiniCards({ cards }: { cards: number[] }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {cards.map((c, i) => {
        const p = cardParts(c);
        return (
          <span key={i} className={`font-mono text-xs font-bold ${p.red ? "text-danger" : "text-cream"}`}>
            {p.rank}
            {p.glyph}
          </span>
        );
      })}
    </span>
  );
}

export default function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<ModelDetail | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/models/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) {
        setErr(true);
        return;
      }
      setD(await res.json());
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [id]);

  if (err) return <main className="mx-auto max-w-3xl px-4 py-20 text-center font-mono text-sm text-danger">model not found</main>;
  if (!d) return <main className="mx-auto max-w-3xl px-4 py-20 text-center font-mono text-sm text-cream-dim">loading…</main>;

  const m = d.model;
  const stats: [string, string][] = [
    ["Sessions", String(m.sessions)],
    ["Hands played", String(m.handsPlayed)],
    ["Hands won", String(m.handsWon)],
    ["Win rate", m.handsPlayed ? `${Math.round((m.handsWon / m.handsPlayed) * 1000) / 10}%` : "—"],
    ["VPIP", d.vpip === null ? "—" : `${d.vpip}%`],
    ["PFR", d.pfr === null ? "—" : `${d.pfr}%`],
    ["Showdowns won", `${m.showdownsWon}/${m.showdowns}`],
    ["Biggest pot", money(m.biggestPot)],
    ["Net career", (m.netProfit >= 0 ? "+" : "−") + money(Math.abs(m.netProfit)).slice(0)],
    ["Bailouts", m.bailouts > 0 ? `${m.bailouts}× 💸` : "clean"],
    ["Malformed replies", String(m.malformed)],
    ["Timeouts", String(m.timeouts)],
    ["Avg decision", m.avgLatencyMs ? `${(m.avgLatencyMs / 1000).toFixed(1)}s` : "—"],
    ["Probe latency", m.probeLatencyMs ? `${m.probeLatencyMs}ms` : "—"],
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/leaderboard" className="font-mono text-xs text-cream-dim hover:text-gold-300">
        ← leaderboard
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-5xl font-black text-cream">{m.name}</h1>
          <p className="mt-1 font-mono text-xs text-cream-dim">{m.id}</p>
        </div>
        <div className="flex gap-8 text-right">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-cream-dim/60">Elo</div>
            <div className="font-display text-4xl font-black text-gold-300">{(d as any).rating ?? Math.round(m.elo)}</div>
            <div className="font-mono text-[9px] text-cream-dim/50">arena Elo {Math.round(m.elo)}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-cream-dim/60">Bankroll</div>
            <div className="font-display text-4xl font-black text-neon">{money(m.bankroll)}</div>
          </div>
        </div>
      </header>

      <section className="panel mt-6 rounded-2xl p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">Rating history</h2>
          <span className="font-mono text-[10px] text-cream-dim/60">
            {d.eloHistory.length > 0 ? `${d.eloHistory.length} settlements · updates every hand` : "awaiting first hand"}
          </span>
        </div>
        <Sparkline points={d.eloHistory.map((h) => ({ elo: h.elo, createdAt: h.createdAt }))} poolMean={(d as any).poolMean ?? 1200} poolSd={(d as any).poolSd ?? 25} />
      </section>

      <section className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map(([k, v]) => (
          <div key={k} className="panel rounded-lg p-3">
            <div className="font-mono text-[9px] uppercase tracking-wider text-cream-dim/60">{k}</div>
            <div className="mt-0.5 font-mono text-sm text-cream">{v}</div>
          </div>
        ))}
      </section>

      <section className="panel mt-6 overflow-x-auto rounded-2xl">
        <div className="border-b border-gold-500/15 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">
          Recent sessions
        </div>
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-gold-500/10 font-mono text-[10px] uppercase text-cream-dim/60">
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">Room</th>
              <th className="px-4 py-2 text-right">Hands</th>
              <th className="px-4 py-2 text-right">Rank</th>
              <th className="px-4 py-2 text-right">Net</th>
              <th className="px-4 py-2 text-right">bb/100</th>
              <th className="px-4 py-2 text-right">Elo after</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {d.sessions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-cream-dim/50">
                  no sessions yet
                </td>
              </tr>
            )}
            {d.sessions.map((s) => {
              const seat = s.seats[0];
              if (!seat) return null;
              return (
                <tr key={s.id} className="border-b border-gold-500/8">
                  <td className="px-4 py-2 text-cream-dim">{timeAgo(s.endedAt)}</td>
                  <td className="px-4 py-2 text-gold-300">{s.roomName ?? s.tierName}</td>
                  <td className="px-4 py-2 text-right text-cream-dim">{s.hands}</td>
                  <td className="px-4 py-2 text-right text-cream">#{seat.rank}</td>
                  <td className={`px-4 py-2 text-right ${seat.netDollars >= 0 ? "text-neon" : "text-danger"}`}>
                    {money(seat.netDollars)}
                  </td>
                  <td className="px-4 py-2 text-right text-cream-dim">
                    {Math.round((seat.netBB / Math.max(1, s.hands)) * 10000) / 100}
                  </td>
                  <td className="px-4 py-2 text-right text-gold-300">{seat.eloAfter}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
