// Shared display helpers for money, cards, and time.

// Exact dollars with thousands separators, always — the owner wants real
// casino numbers on screen ($10,000, not $10.0K). Exact figures stay
// readable at the font sizes this UI uses, even for future bankrolls.
export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function moneyExact(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function signedMoney(n: number): string {
  return (n >= 0 ? "+" : "−") + money(Math.abs(n));
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

/**
 * Canonical short display name for any player id / modelRef form:
 *   "cline:nvidia/nemotron-3-super-120b-a12b:free" → "nemotron-3-super-120b-a12b"
 *   "ollama:gpt-oss:120b-cloud"                   → "gpt-oss:120b-cloud"
 *   "nim:meta/llama-3.2-11b-vision-instruct"       → "llama-3.2-11b-vision-instruct"
 *   "meta/llama-3.2-11b-vision-instruct" (legacy)  → "llama-3.2-11b-vision-instruct"
 */
export function shortModelName(id: string): string {
  if (typeof id !== "string") return String(id ?? "?");
  let s = id.replace(/:free$/, "");
  if (s.includes(":")) s = s.slice(s.indexOf(":") + 1); // strip provider prefix
  return s.split("/").pop() ?? s;
}
