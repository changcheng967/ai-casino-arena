"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money, cardParts, shortModelName } from "@/lib/format";

interface Action {
  street: string;
  seat: number;
  playerId: string;
  type: string;
  amount?: number;
  note?: string;
}

interface HandDetail {
  id: string;
  sessionId: string;
  handNo: number;
  tierName: string;
  roomName?: string;
  sb: number;
  bb: number;
  board: number[];
  pot: number;
  awards: { amount: number; winners: string[]; handName?: string }[];
  actions: Action[];
  showdown: boolean;
  holeCards: Record<string, number[]>;
  createdAt: string;
}

const STREET_ORDER = ["preflop", "flop", "turn", "river", "showdown", "payout"];

function displayName(pid: string): string {
  return shortModelName(pid);
}

export default function HandReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [h, setH] = useState<HandDetail | null>(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState(false);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/hands/${id}`, { cache: "no-store" });
      if (!res.ok) {
        setErr(true);
        return;
      }
      setH((await res.json()).hand);
    })();
  }, [id]);

  const visible = useMemo(() => (h ? h.actions.slice(0, step) : []), [h, step]);

  // autoplay: step action-by-action; stops at the end
  useEffect(() => {
    if (!auto || !h) return;
    if (step >= h.actions.length) {
      setAuto(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(h.actions.length, s + 1)), 650);
    return () => clearTimeout(t);
  }, [auto, step, h]);

  // replay state at current step
  const snapshot = useMemo(() => {
    if (!h) return null;
    const players = new Map<string, { bet: number; folded: boolean; put: number; last: string }>();
    const board: number[] = [];
    let potTotal = 0;
    let prevStreet = "";
    const notes: string[] = [];
    for (const a of visible) {
      if (a.type === "deal") {
        // board grows by what the note shows; approximate by street
        if (a.street === "flop") board.push(-1, -1, -1);
        else if (a.street === "turn" || a.street === "river") board.push(-1);
      } else if (a.type === "showdown" || a.type === "win") {
        notes.push(`${displayName(a.playerId)} ${a.type} ${a.note ?? ""} ${a.amount ? money(a.amount) : ""}`);
      } else {
        // a new street resets the per-street bet tracking (call amounts are
        // the call SIZE, not the street total — without this reset the pot
        // replay undercounts by exactly the preflop money)
        if (a.street !== prevStreet) {
          for (const p of players.values()) p.bet = 0;
          prevStreet = a.street;
        }
        const p = players.get(a.playerId) ?? { bet: 0, folded: false, put: 0, last: "" };
        if (a.type === "fold") p.folded = true;
        if (a.amount) {
          // engine log semantics: post/call amounts are CHIPS MOVED this
          // action; raise amounts are the street TOTAL (raise-to). Blind
          // completion calls log the call size, not the street total.
          const isTotal = a.type === "raise" || a.type === "bet" || a.type === "allin";
          const add = isTotal ? Math.max(0, a.amount - p.bet) : a.amount;
          potTotal += add;
          p.put += add;
          p.bet = isTotal ? Math.max(p.bet, a.amount) : p.bet + a.amount;
        }
        p.last = `${a.type}${a.amount ? " " + money(a.amount) : ""}${a.note ? " " + a.note : ""}`;
        players.set(a.playerId, p);
      }
    }
    // uncalled-bet return: finishHand refunds the top committer's excess
    // over the second-largest commitment (folded or not) — subtract it at the
    // final step or the replayed pot overshoots the recorded one
    const puts = [...players.values()].map((pl) => pl.put).sort((a, b) => b - a);
    const uncalled = h.showdown && puts.length >= 2 ? Math.max(0, puts[0] - puts[1]) : 0;
    // real board for revealed streets
    const boardReal =
      board.length === 0 ? [] : board.length >= 3 ? h.board.slice(0, Math.min(5, board.length)) : h.board.slice(0, board.length);
    return { players, board: boardReal, potTotal, uncalled, notes, street: visible.at(-1)?.street ?? "preflop" };
  }, [h, visible]);

  if (err) return <main className="mx-auto max-w-3xl px-4 py-20 text-center font-mono text-sm text-danger">hand not found</main>;
  if (!h || !snapshot) return <main className="mx-auto max-w-3xl px-4 py-20 text-center font-mono text-sm text-cream-dim">loading replay…</main>;

  const seats = Object.entries(h.holeCards);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/hands" className="font-mono text-xs text-cream-dim hover:text-gold-300">
        ← hand archive
      </Link>
      <h1 className="mt-3 font-display text-3xl font-black text-cream">
        {h.roomName ?? h.tierName} <span className="text-cream-dim">· hand #{h.handNo}</span>
      </h1>
      <p className="mb-6 font-mono text-xs text-cream-dim">
        ${h.sb}/{h.bb} · pot {money(h.pot)} · {h.showdown ? "went to showdown" : "won without showdown"}
      </p>

      {/* board + controls */}
      <section className="panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-cream-dim/60">board</span>
            <div className="flex min-h-[3rem] items-center gap-1.5">
              {snapshot.board.length === 0 && <span className="font-mono text-[11px] text-cream-dim/40">pre-flop</span>}
              {snapshot.board.map((c, i) => {
                const p = cardParts(c);
                return (
                  <div key={i} className="poker-card small deal-in">
                    <span className={p.red ? "red" : ""}>
                      {p.rank}
                      {p.glyph}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="font-display text-lg font-bold text-gold-300">
            pot {money(step >= h.actions.length ? snapshot.potTotal - snapshot.uncalled : snapshot.potTotal)}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => setStep(0)}
            className="rounded-lg hairline px-3 py-1.5 font-mono text-xs text-cream-dim hover:text-gold-300"
          >
            ⟲ reset
          </button>
          <button
            onClick={() => {
              if (step >= (h?.actions.length ?? 0)) setStep(0);
              setAuto((a) => !a);
            }}
            className={`rounded-lg px-3 py-1.5 font-mono text-xs font-semibold ${auto ? "bg-gold-500/30 text-gold-300" : "hairline text-cream-dim hover:text-gold-300"}`}
          >
            {auto ? "❚❚ pause" : "▶ auto play"}
          </button>
          <input
            type="range"
            min={0}
            max={h.actions.length}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            className="flex-1 accent-[#d4af37]"
          />
          <span className="w-20 text-right font-mono text-xs text-cream-dim">
            {step}/{h.actions.length}
          </span>
        </div>
        {h.actions.length > 1 && (
          <button
            onClick={() => {
              if (step >= h.actions.length) return;
              setStep((s) => Math.min(h.actions.length, s + 1));
            }}
            className="mt-2 rounded-lg bg-gold-500/20 px-4 py-1.5 font-mono text-xs font-semibold text-gold-300 hover:bg-gold-500/30"
          >
            next action ▸
          </button>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* seats at end of hand */}
        <section className="panel rounded-2xl p-5">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">Cards</h2>
          <ul className="space-y-2">
            {seats.map(([pid, cards]) => {
              const p = snapshot.players.get(pid);
              const won = h.awards.some((a) => a.winners.includes(pid));
              return (
                <li
                  key={pid}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                    won ? "border-neon/40 bg-neon/5" : "border-gold-500/15"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-cream">
                    {displayName(pid)}
                    {p?.folded && <span className="ml-2 text-cream-dim/50">folded</span>}
                  </span>
                  <span className="inline-flex gap-1">
                    {cards.map((c, i) => {
                      const cp = cardParts(c);
                      return (
                        <span key={i} className={`font-mono text-sm font-bold ${cp.red ? "text-danger" : "text-cream"}`}>
                          {cp.rank}
                          {cp.glyph}
                        </span>
                      );
                    })}
                  </span>
                  {won && <span className="font-mono text-[10px] text-neon">WON</span>}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 space-y-1 font-mono text-[11px] text-gold-300">
            {h.awards.map((a, i) => {
              const share = a.amount / Math.max(1, a.winners.length);
              return (
                <div key={i}>
                  {a.winners.map((w) => displayName(w)).join(", ")} +{money(a.amount)}
                  {a.handName ? ` — ${a.handName}` : ""}
                  {a.winners.length === 1 && (() => {
                    const put = snapshot.players.get(a.winners[0])?.put ?? 0;
                    const puts = [...snapshot.players.values()].map((pl) => pl.put).sort((x, y) => y - x);
                    const isTop = put === puts[0];
                    const net = share + (isTop ? snapshot.uncalled : 0) - put;
                    return (
                      <span className="ml-2 text-neon">
                        net {net >= 0 ? "+" : "−"}
                        {money(Math.abs(net))}
                      </span>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </section>

        {/* action log */}
        <section className="panel rounded-2xl p-5">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">Action</h2>
          <ul className="max-h-[28rem] space-y-1 overflow-y-auto pr-1 font-mono text-[11px]">
            {h.actions.map((a, i) => {
              const past = i < step;
              const current = i === step - 1;
              const street = a.street;
              const showStreet = i === 0 || h.actions[i - 1].street !== street;
              return (
                <li key={i}>
                  {showStreet && (
                    <div className="mt-2 mb-1 text-[9px] uppercase tracking-[0.3em] text-gold-500/70">— {street}</div>
                  )}
                  <div
                    className={`rounded px-2 py-1 transition-colors ${
                      current ? "bg-gold-500/20 text-gold-300" : past ? "text-cream-dim" : "text-cream-dim/30"
                    }`}
                  >
                    {a.playerId ? `${displayName(a.playerId)} ` : ""}
                    {a.type}
                    {a.amount ? ` ${money(a.amount)}` : ""}
                    {a.note ? <span className="text-talk"> {a.note}</span> : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
