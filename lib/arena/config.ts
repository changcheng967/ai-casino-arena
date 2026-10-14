// Central economy/rules constants for the arena.

export const START_BANKROLL = 10_000; // realistic amateur roll, in dollars
export const BAILOUT_AMOUNT = 10_000; // fixed fresh stake, same as the start
export const BAILOUT_BELOW = 40; // cannot seat even the lowest tier's minimum buy-in
export const TABLE_SIZE = 6;
export const MIN_TABLES = 1;
export const MAX_TABLES = 4; // 30 players: 24 seated + 6 in the lobby queue for rotation
// Continuous cash game: tables never end on a hand count. This is only a
// distant safety net so a stale table can eventually be closed by the house.
export const TABLE_SAFETY_CAP = 400;
// Individual players rotate like in a real card room — tuned for lively
// rotation (more exits = more frequent rating settlement):
export const LEAVE_CHECK_MIN_HANDS = 4; // don't ask before this many hands of a stint
export const LEAVE_HARD_HANDS = 12; // the house calls time: FORCED cash-out — a seat can never farm forever
export const WIN_CASHOUT_MULTIPLE = 1.4; // up 40% on the buy-in → offered to cash out
export const STUCK_FRACTION = 0.65; // stuck a third → offered to quit/re-seat
export const TARGET_STACK_FRACTION = 0.05; // aim to sit with ~5% of bankroll (100bb)
export const MIN_BUYIN_BBS = 40; // table minimum: 40 big blinds
export const DEFAULT_BUYIN_BBS = 100;

// Elo — tuned to move fast so skill differences show within hours, not days.
export const ELO_START = 1200;
// Dynamic Elo — everything scales with evidence, no fixed steps:
// K = ELO_K_MAX / (1 + careerHands / ELO_HANDS_HALF), clamped to [ELO_K_MIN, ELO_K_MAX].
// New players move fast (K≈120); established ratings stabilize smoothly (K→32).
export const ELO_K_MAX = 120;
export const ELO_K_MIN = 32;
export const ELO_HANDS_HALF = 300; // career hands at which K has halved
export const POKER_SIGMA_BB = 18; // per-hand net-BB luck scale (6-max NLHE, 100bb)
// Live Elo: ratings settle a little at EVERY hand on cumulative stint standings
// (realtime movement), and the exit remains the authoritative correction.
// Settlements use the Bayesian-shrunk effect-size score (pairwiseScorePair):
// luck barely moves ratings and every pair converges to a stable gap. Exactly zero-sum.
export const ELO_LIVE_HAND_WEIGHT = 0.25;
export const ELO_EXIT_WEIGHT = 0.6;
export const ELO_WARMUP_SESSIONS = 20;

// Tick budget
export const TICK_WORK_MS = 30_000; // worst tick = 30s + capped timeout < 60s Vercel cap
// The lease MUST exceed a worst-case tick (30s budget + decision timeout
// headroom ≈ 58s) or two ticks overlap and patch model rows from stale
// snapshots — stats zeroing / counter inflation. 65s still lets a 1-minute
// cron chain immediately after a long tick.
export const LEASE_MS = 65_000;
export const DECISION_TIMEOUT_MS = 28_000; // thinking models need room; timeout = house folds
// Clock violation: a model with this many timeouts and ZERO successful answers
// has never played a hand in time — stop letting it burn the whole tick budget.
// Every CLOCK_RETRY_EVERY-th decision still tries the real API to detect recovery.
export const CLOCK_VIOLATION_MIN = 4;
export const CLOCK_RETRY_EVERY = 8;
export const DECISION_RETRIES = 0;
export const BUYIN_TIMEOUT_MS = 15_000;
export const FORMATION_GATE_MS = 20_000; // stop forming new tables past this point in a tick
export const LEAVE_TIMEOUT_MS = 7_000; // quick ask — rotation must not eat the tick
// Health quarantine: this many consecutive provider outages (timeout/network/
// HTTP) mid-game → the model cashes out and sits out in the lobby with a
// special status until a recovery probe succeeds again.
export const QUARANTINE_THRESHOLD = 3;
export const QUARANTINE_PROBES_PER_TICK = 2;
