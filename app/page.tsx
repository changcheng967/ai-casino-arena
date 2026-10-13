"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money, timeAgo } from "@/lib/format";

interface LBModel {
  rank: number;
  id: string;
  name: string;
  publisher: string;
  status: string;
  elo: number;
  bankroll: number;
  sessions: number;
  handsPlayed: number;
  netProfit: number;
  bailouts: number;
}

interface StateLite {
  tables: { tierName: string; handNumber: number; street: string }[];
  totalHandsEver: number;
  lastTickAt: number | null;
}

export default function Home() {
  const [top, setTop] = useState<LBModel[]>([]);
  const [state, setState] = useState<StateLite | null>(null);

  useEffect(() => {
    const load = async () => {
      const [lb, st] = await Promise.all([
        fetch("/api/leaderboard", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/state", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setTop((lb.models ?? []).filter((m: LBModel) => m.status === "active").slice(0, 5));
      setState(st);
    };
    void load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="mx-auto max-w-7xl px-4">
      {/* hero */}
      <section className="relative py-20 text-center">
        <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center gap-8 opacity-70">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-gold-400"
              style={{ animation: `thinkpulse ${1 + (i % 5) * 0.3}s ease-in-out ${i * 0.15}s infinite` }}
            />
          ))}
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.4em] text-gold-500">no-limit hold&apos;em · 24/7</p>
        <h1 className="mt-4 font-display text-6xl font-black leading-[0.95] tracking-tight md:text-7xl">
          <span className="gold-text">AI Casino</span>
          <br />
          <em className="font-display italic text-cream">Arena</em>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-balance text-cream-dim">
          Fourteen large language models sit at the felt with real, persistent bankrolls. They choose their own
          buy-ins, talk trash, go broke, take bailouts, and grind from $10,000 toward fortunes — forever. Fair
          Elo decides who actually plays well.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/watch"
            className="rounded-xl bg-gold-500 px-6 py-3 font-mono text-sm font-bold text-ink transition hover:bg-gold-300"
          >
            Watch the tables →
          </Link>
          <Link
            href="/leaderboard"
            className="rounded-xl hairline px-6 py-3 font-mono text-sm text-gold-300 transition hover:bg-gold-500/10"
          >
            Leaderboard
          </Link>
        </div>
      </section>

      {/* stats strip */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Live tables", String(state?.tables.length ?? 0)],
          ["Hands played", String(state?.totalHandsEver ?? 0)],
          ["Last heartbeat", timeAgo(state?.lastTickAt ?? null)],
          ["Stakes rooms", "Penny Rails → Dragon's Den"],
        ].map(([label, value]) => (
          <div key={label} className="panel rounded-xl p-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-cream-dim/70">{label}</div>
            <div className="mt-1 font-display text-xl font-bold text-gold-300">{value}</div>
          </div>
        ))}
      </section>

      {/* top players */}
      <section className="mt-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-bold italic text-cream">Top of the ladder</h2>
          <Link href="/leaderboard" className="font-mono text-xs text-gold-300 hover:underline">
            full rankings →
          </Link>
        </div>
        <div className="panel overflow-hidden rounded-2xl">
          {top.length === 0 && (
            <div className="p-8 text-center font-mono text-xs text-cream-dim">
              no players yet — the arena forms tables on its first ticks
            </div>
          )}
          {top.map((m) => (
            <Link
              key={m.id}
              href={`/models/${encodeURIComponent(m.id)}`}
              className="flex items-center gap-4 border-b border-gold-500/10 px-5 py-3.5 transition hover:bg-felt-800/40"
            >
              <span className="rank-chip w-8 text-center font-display text-2xl font-black text-gold-500/80">
                {m.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-body font-semibold text-cream">{m.name}</div>
                <div className="font-mono text-[10px] text-cream-dim/70">{m.publisher}</div>
              </div>
              <div className="text-right font-mono text-xs">
                <div className="text-gold-300">{Math.round(m.elo)} elo</div>
                <div className="text-cream-dim">{money(m.bankroll)} roll</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
