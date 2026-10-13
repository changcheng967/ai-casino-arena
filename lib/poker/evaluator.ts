// 5..7 card hand evaluator. Pure and fast enough for Monte Carlo.
// Returns a single comparable integer: higher = better hand.

const CAT_HIGH = 0,
  CAT_PAIR = 1,
  CAT_TWOPAIR = 2,
  CAT_TRIPS = 3,
  CAT_STRAIGHT = 4,
  CAT_FLUSH = 5,
  CAT_FULLHOUSE = 6,
  CAT_QUADS = 7,
  CAT_STRAIGHTFLUSH = 8;

export const CATEGORY_NAMES = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
];

// Highest card of the best straight inside a rank bitmask, or -1.
// Wheel (A2345) counts as a 5-high straight. Bit r set = rank r present.
function straightHigh(mask: number): number {
  let run = 0;
  for (let r = 12; r >= 0; r--) {
    if ((mask >> r) & 1) {
      run++;
      // r is the run's lowest card; the straight's high card is r+4.
      if (run === 5) return r + 4;
    } else {
      run = 0;
    }
  }
  // Wheel: A + 2,3,4,5 → five-high, the lowest straight.
  if (((mask >> 12) & 1) === 1 && (mask & 0xf) === 0xf) return 3;
  return -1;
}

// Pack 5 tiebreak ranks (each 0..12) into 20 bits.
function tb(r1: number, r2 = 0, r3 = 0, r4 = 0, r5 = 0): number {
  return (r1 << 16) | (r2 << 12) | (r3 << 8) | (r4 << 4) | r5;
}

function score(cat: number, tiebreak: number): number {
  return (cat << 20) | tiebreak;
}

export function evaluate(cards: number[]): number {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluate expects 5..7 cards, got ${cards.length}`);
  }

  const rankCounts = new Array<number>(13).fill(0);
  const suitMasks = [0, 0, 0, 0];
  const suitCounts = [0, 0, 0, 0];

  for (const c of cards) {
    const r = c >> 2;
    const s = c & 3;
    rankCounts[r]++;
    suitMasks[s] |= 1 << r;
    suitCounts[s]++;
  }

  // Flush / straight flush
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCounts[s] >= 5) flushSuit = s;
  }
  if (flushSuit >= 0) {
    const fmask = suitMasks[flushSuit];
    const sfHigh = straightHigh(fmask);
    if (sfHigh >= 0) return score(CAT_STRAIGHTFLUSH, tb(sfHigh));
    // Regular flush: top 5 ranks of the flush suit
    const ranks: number[] = [];
    for (let r = 12; r >= 0 && ranks.length < 5; r--) {
      if ((fmask >> r) & 1) ranks.push(r);
    }
    return score(CAT_FLUSH, tb(ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]));
  }

  // Group ranks by count for pair-based hands
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (rankCounts[r] === 4) quads.push(r);
    else if (rankCounts[r] === 3) trips.push(r);
    else if (rankCounts[r] === 2) pairs.push(r);
    else if (rankCounts[r] === 1) singles.push(r);
  }

  if (quads.length > 0) {
    const q = quads[0];
    const kick = Math.max(...[...trips, ...pairs, ...singles, quads.length > 1 ? quads[1] : -1].filter((x) => x >= 0));
    return score(CAT_QUADS, tb(q, kick));
  }

  if (trips.length > 0 && (pairs.length > 0 || trips.length > 1)) {
    const t = trips[0];
    const p = trips.length > 1 ? Math.max(trips[1], pairs[0] ?? -1) : pairs[0];
    return score(CAT_FULLHOUSE, tb(t, p));
  }

  // Straight (no flush possible here)
  let allMask = 0;
  for (let r = 0; r < 13; r++) if (rankCounts[r] > 0) allMask |= 1 << r;
  const sh = straightHigh(allMask);
  if (sh >= 0) return score(CAT_STRAIGHT, tb(sh));

  if (trips.length > 0) {
    const t = trips[0];
    const kicks = [...trips.slice(1), ...pairs, ...singles].sort((a, b) => b - a);
    return score(CAT_TRIPS, tb(t, kicks[0], kicks[1]));
  }

  if (pairs.length >= 2) {
    const hi = pairs[0];
    const lo = pairs[1];
    // Kicker: best single from remaining cards, including a possible third pair's rank
    const rest = [...pairs.slice(2), ...singles];
    const kick = rest.length ? Math.max(...rest) : -1;
    return score(CAT_TWOPAIR, tb(hi, lo, kick));
  }

  if (pairs.length === 1) {
    const p = pairs[0];
    const kicks = singles.slice(0, 3);
    return score(CAT_PAIR, tb(p, kicks[0], kicks[1], kicks[2]));
  }

  const top = singles.slice(0, 5);
  return score(CAT_HIGH, tb(top[0], top[1], top[2], top[3], top[4]));
}

// Human-readable description of an evaluated score, e.g. "Full House, Aces full of Kings".
export function describe(score: number): string {
  const cat = score >>> 20;
  const t = (score >> 16) & 0xf,
    a = (score >> 12) & 0xf,
    b = (score >> 8) & 0xf,
    c = (score >> 4) & 0xf;
  const R = (r: number) => "23456789TJQKA"[r];
  switch (cat) {
    case 8:
      return t === 12 ? "Royal Flush" : `Straight Flush, ${R(t)}-high`;
    case 7:
      return `Four of a Kind, ${R(t)}s`;
    case 6:
      return `Full House, ${R(t)}s full of ${R(a)}s`;
    case 5:
      return `Flush, ${R(t)}-high`;
    case 4:
      return t === 3 ? "Straight (Wheel), A to 5" : `Straight, ${R(t - 4)} to ${R(t)}`;
    case 3:
      return `Three of a Kind, ${R(t)}s`;
    case 2:
      return `Two Pair, ${R(t)}s and ${R(a)}s`;
    case 1:
      return `Pair of ${R(t)}s`;
    default:
      return `High Card, ${R(t)}`;
  }
}
