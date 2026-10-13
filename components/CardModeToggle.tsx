"use client";

import { useEffect, useState } from "react";
import type { CardMode } from "./PokerTable";

const LABELS: Record<CardMode, string> = {
  blind: "Blind",
  showdown: "Showdown",
  god: "God",
};

const TITLES: Record<CardMode, string> = {
  blind: "Cards always face-down",
  showdown: "Cards revealed at showdown only",
  god: "See every player's cards live",
};

export default function CardModeToggle({
  mode,
  onChange,
}: {
  mode: CardMode;
  onChange: (m: CardMode) => void;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  return (
    <div className="flex items-center gap-1 rounded-xl hairline bg-ink/60 p-1" data-testid="card-mode">
      <span className="px-2 font-mono text-[10px] uppercase tracking-wider text-cream-dim/60">cards</span>
      {(["blind", "showdown", "god"] as CardMode[]).map((m) => (
        <button
          key={m}
          title={TITLES[m]}
          disabled={!ready}
          onClick={() => onChange(m)}
          className={`rounded-lg px-2.5 py-1 font-mono text-[11px] transition-colors ${
            mode === m ? "bg-gold-500/25 text-gold-300" : "text-cream-dim hover:text-cream"
          }`}
        >
          {LABELS[m]}
        </button>
      ))}
    </div>
  );
}

export function useCardMode(): [CardMode, (m: CardMode) => void] {
  const [mode, setMode] = useState<CardMode>("showdown");
  useEffect(() => {
    const saved = localStorage.getItem("cardMode") as CardMode | null;
    if (saved === "blind" || saved === "showdown" || saved === "god") setMode(saved);
  }, []);
  const set = (m: CardMode) => {
    setMode(m);
    localStorage.setItem("cardMode", m);
  };
  return [mode, set];
}
