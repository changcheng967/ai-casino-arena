"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money, timeAgo, cardParts, shortModelName } from "@/lib/format";

interface HandListRow {
  id: string;
  sessionId: string;
  handNo: number;
  tierName: string;
  roomName?: string;
  sb: number;
  bb: number;
  board: number[];
  pot: number;
  showdown: boolean;
  winners: string[];
  createdAt: string;
  holeCards?: Record<string, number[]>;
}

export default function HandsPage() {
  const [hands, setHands] = useState<HandListRow[]>([]);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/hands?limit=60", { cache: "no-store" });
      setHands((await res.json()).hands ?? []);
    };
    void load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-display text-4xl font-black gold-text">Hand Archive</h1>
      <p className="mb-6 mt-1 font-mono text-xs text-cream-dim">every hand the arena has ever played, with full replays</p>

      <div className="panel overflow-hidden rounded-2xl">
        {hands.length === 0 && (
          <div className="p-10 text-center font-mono text-xs text-cream-dim">no hands yet — let the arena run</div>
        )}
        {hands.map((h) => (
          <Link
            key={h.id}
            href={`/hands/${h.id}`}
            className="flex items-center gap-4 border-b border-gold-500/10 px-5 py-3 transition hover:bg-felt-800/40"
          >
            <div className="w-20 shrink-0 font-mono text-[10px] text-cream-dim/60">{timeAgo(h.createdAt)}</div>
            <div className="w-40 shrink-0">
              <div className="truncate font-mono text-[10px] text-gold-300">{h.roomName ?? h.tierName}</div>
              <div className="font-mono text-[10px] text-cream-dim/50">#{h.handNo}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs">
                {h.winners.map((w) => shortModelName(w)).join(", ")} won <span className="text-gold-300">{money(h.pot)}</span>
                {h.showdown ? <span className="ml-2 rounded bg-gold-500/15 px-1.5 py-0.5 text-[9px] text-gold-300">showdown</span> : null}
              </div>
              {h.holeCards && Object.keys(h.holeCards).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {Object.entries(h.holeCards as Record<string, number[]>).map(([pid, cards]) => {
                    const won = h.winners.includes(pid);
                    return (
                      <span key={pid} className={`font-mono text-[10px] ${won ? "text-neon" : "text-cream-dim/70"}`}>
                        {shortModelName(pid)}{" "}
                        {cards.map((c, i) => {
                          const p = cardParts(c);
                          return (
                            <span key={i} className={`font-bold ${p.red ? "text-danger" : "text-cream"}`}>
                              {p.rank}
                              {p.glyph}
                            </span>
                          );
                        })}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <span className="font-mono text-xs text-cream-dim/40">replay →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
