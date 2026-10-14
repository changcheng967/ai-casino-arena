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

// Edge prior: typical per-hand bb edges in this pool. Sane LLMs run 0.2–1bb/h;
// degenerate strategies (fold-bots, shove-bots) reach 10–20bb/h. τ0=9 leans
// hot: h0 = 2·(σ/τ0)² = 8 common hands to half-unshrink — chess-scale
// per-hand movement early, fixed-point guarantee and exact zero-sum intact.
export const EDGE_PRIOR_TAU = 9;

/**
 * Confidence score that `a` is genuinely outperforming `b`, in [0.5, 1) side.
 *
 * SHRUNK EFFECT-SIZE estimator (not a significance test): estimate the pair's
 * long-run per-hand edge from their CUMULATIVE common-hand history
 * (netBB diff / hands), shrink it toward the "no edge" prior by precision
 * weighting λ = τ0²/(τ0² + 2σ²/h), and convert to an implied single-hand win
 * probability with a FIXED noise scale σ_d = σ·√2. Because the divisor does
 * not shrink with evidence, S converges to a stable fixed point where S = E —
 * ratings between long-running pairs stop at the true gap instead of walking
 * to ±∞. A 2-hand luck spike shrinks to S≈0.50; a sustained 0.9bb/h edge
 * settles at S≈0.51; a 15bb/h degenerate reaches S≈0.56 and keeps paying.
 */
export function pairwiseScorePair(netDiffBB: number, commonHands: number): number {
  const h = Math.max(0, commonHands);
  if (h < 1) return 0.5;
  const raw = netDiffBB / h; // best point estimate of the per-hand edge
  const lambda = (EDGE_PRIOR_TAU * EDGE_PRIOR_TAU) / (EDGE_PRIOR_TAU * EDGE_PRIOR_TAU + (2 * POKER_SIGMA_BB * POKER_SIGMA_BB) / h);
  const sigmaD = POKER_SIGMA_BB * Math.SQRT2;
  const z = (lambda * raw) / sigmaD;
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
  // round ONCE and mirror — rounding both sides independently can net ±0.01
  // (round(12.5)=13 vs round(-12.5)=-12), breaking exact zero-sum
  const dAr = Math.round(dA * 100) / 100;
  return [dAr, -dAr];
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

/**
 * Spectator-facing FIDE-flavored scale, derived from the fair zero-sum arena
 * Elo: rating = 1500 + 200 · z where z is the model's standard score within
 * the active pool. Ordering is identical to arena Elo, but the numbers are
 * familiar and unbounded — a dominant model climbs past 2000+ as the pool's
 * skill spread grows, weak ones sink below 1300. Pure display: no drift, no
 * inflation, the raw zero-sum Elo remains the engine of record.
 */
export function fideScale(elo: number, poolMean: number, poolSd: number): number {
  return Math.round(1500 + (200 * (elo - poolMean)) / Math.max(1, poolSd));
}

export function poolStats(models: Array<{ elo: number }>): { mean: number; sd: number } {
  if (models.length === 0) return { mean: 1200, sd: 25 }; // respect the σ-floor
  const mean = models.reduce((a, m) => a + m.elo, 0) / models.length;
  const variance = models.reduce((a, m) => a + (m.elo - mean) ** 2, 0) / models.length;
  // σ floor 25: with chess-scale arena swings (±40/hand legit), a smaller
  // floor multiplied hot streaks into absurd display jumps (1240 arena ->
  // "2029 Rating"). 25 keeps the stretch honest (8x) and bounded.
  return { mean, sd: Math.max(25, Math.sqrt(variance)) };
}
