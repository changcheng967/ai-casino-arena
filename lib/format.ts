// Shared display helpers for money, cards, and time.

export function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function moneyExact(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function signedMoney(n: number): string {
  return (n >= 0 ? "+" : "−") + money(Math.abs(n)).slice(1).replace("$", "$");
}

const RANKS = "23456789TJQKA";
const SUITS = ["c", "d", "h", "s"];
const SUIT_GLYPH: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };

export function cardParts(card: number): { rank: string; suit: string; glyph: string; red: boolean } {
  const rank = RANKS[card >> 2];
  const suit = SUITS[card & 3];
  return { rank, suit, glyph: SUIT_GLYPH[suit], red: suit === "d" || suit === "h" };
}

export function timeAgo(iso: string | number | null): string {
  if (!iso) return "—";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
