// Fair, money-blind multiplayer Elo — dynamic, z-filtered, realtime.
//
// Fairness properties:
// - Performance is ranked in big blinds (net BB over the stint), never dollars,
//   so a whale and a grinder are scored on the same scale.
// - Randomized seats + rotating dealer button already even out position.
// - Pairwise expected-score updates mean farming weaker tables cannot inflate
//   a rating: beating a 1100 pays almost nothing, beating a 1400 pays a lot.
// - K is fully dynamic: it decays smoothly with each player's CAREER HANDS
//   (fast when new, stable when established) — identical formula for everyone.
// - Settlements are z-filtered: the score is the statistical confidence that
//   the observed net-BB gap is skill, not luck. Pure luck barely moves ratings;
//   sustained dominance moves them fully. This keeps realtime movement fair.
// - Every pair exchanges with the AVERAGE of both K's → exactly zero-sum on
//   every single update. Ratings cannot inflate or deflate as a pool.

import { ELO_K_MAX, ELO_K_MIN, ELO_HANDS_HALF, POKER_SIGMA_BB } from "./config";

export interface EloPlayer {
  id: string;
  rating: number;
  sessionsPlayed: number;
  careerHands?: number; // drives the dynamic K
}

/** Continuous, evidence-adaptive K: K_max / (1 + hands/H_half), clamped. */
export function kDynamic(p: EloPlayer): number {
  const hands = Math.max(0, p.careerHands ?? 0);
  const k = ELO_K_MAX / (1 + hands / ELO_HANDS_HALF);
  return Math.max(ELO_K_MIN, Math.min(ELO_K_MAX, k));
}

/** Standard normal CDF Φ(z) via the Abramowitz–Stegun erf approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - (Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI)) * poly;
  return z >= 0 ? p : 1 - p;
}

/**
 * Confidence score that `a` is genuinely outperforming `b`, in [0,1].
 *
 * z = (netBB_a − netBB_b) / (σ · √(h_a + h_b)) — the gap measured in units of
 * poker's per-hand luck. A one-hand luck spike lands near z≈0.5·σ·√2 → small S;
 * the same gap sustained over dozens of hands → S→1. Symmetric: S(a,b) = 1 − S(b,a).
 */
export function pairwiseScore(
  netBBa: number,
  handsA: number,
  netBBb: number,
  handsB: number,
): number {
  const ha = Math.max(1, handsA);
  const hb = Math.max(1, handsB);
  const z = (netBBa - netBBb) / (POKER_SIGMA_BB * Math.sqrt(ha + hb));
  return Math.min(0.999, Math.max(0.001, normalCdf(z)));
}

/**
 * One pairwise settlement. `score` ∈ [0,1] is the z-filtered confidence that a
 * outperformed b (0.5 = no evidence). Both players move by the same magnitude
 * (pair K = average of their dynamic K's) → the update is exactly zero-sum.
 */
export function eloPairUpdate(a: EloPlayer, b: EloPlayer, score: number, weight = 1): [number, number] {
  const expA = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
  const kPair = ((kDynamic(a) + kDynamic(b)) / 2) * weight;
  const dA = kPair * (score - expA);
  const dB = kPair * ((1 - score) - (1 - expA)); // = −dA exactly
  return [Math.round(dA * 100) / 100, Math.round(dB * 100) / 100];
}

/** Rank players for a finished session. rank 1 = best. Ties share a rank. */
export function rankByNetBB(entries: Array<{ id: string; netBB: number }>): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.netBB - a.netBB);
  const ranks = new Map<string, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].netBB === sorted[i].netBB) j++;
    const rank = i + 1;
    for (let k = i; k <= j; k++) ranks.set(sorted[k].id, rank);
    i = j + 1;
  }
  return ranks;
}

/**
 * Pairwise multiplayer update over finishing ranks (1 = best).
 * Legacy batch form used by tests; sessions are also settled pairwise in the
 * live system. Every unordered pair is updated once with the standard formula.
 */
export function eloDeltas(players: EloPlayer[], ranks: Map<string, number>): Map<string, number> {
  const deltas = new Map<string, number>(players.map((p) => [p.id, 0]));
  for (let a = 0; a < players.length; a++) {
    for (let b = a + 1; b < players.length; b++) {
      const A = players[a];
      const B = players[b];
      const ra = ranks.get(A.id)!;
      const rb = ranks.get(B.id)!;
      if (ra === rb) continue; // tied: no exchange
      const [dA, dB] = eloPairUpdate(A, B, ra < rb ? 1 : 0);
      deltas.set(A.id, deltas.get(A.id)! + dA);
      deltas.set(B.id, deltas.get(B.id)! + dB);
    }
  }
  return deltas;
}

/** Zero-sum check helper: sum of deltas is exactly 0 (pair-averaged K). */
export function applyDeltas(players: EloPlayer[], deltas: Map<string, number>): EloPlayer[] {
  return players.map((p) => ({ ...p, rating: Math.round((p.rating + (deltas.get(p.id) ?? 0)) * 100) / 100 }));
}
