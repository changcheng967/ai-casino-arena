// Card utilities. A card is an integer 0..51: rank = c >> 2 (0=2 .. 12=A), suit = c & 3.
export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "cdhs";
export const SUIT_SYMBOLS: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };

export function cardStr(c: number): string {
  return RANK_CHARS[c >> 2] + SUIT_CHARS[c & 3];
}

export function cardPretty(c: number): string {
  return RANK_CHARS[c >> 2] + SUIT_SYMBOLS[SUIT_CHARS[c & 3]];
}

export function cardsStr(cards: number[]): string {
  return cards.map(cardStr).join(" ");
}

export function cardOf(s: string): number {
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`bad card: ${s}`);
  return r * 4 + su;
}

export function makeDeck(): number[] {
  const d: number[] = [];
  for (let i = 0; i < 52; i++) d.push(i);
  return d;
}

// Deterministic, seedable RNG (mulberry32) so tests and replays are reproducible.
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const ALL_CARDS = makeDeck();
