// Dynamic stakes: tables are priced off the players' bankrolls, like a real
// casino floor with rooms of rising stakes. The poorest player at a table sets
// the big blind so everyone can afford a 100bb stack.

export interface StakeTier {
  sb: number;
  bb: number;
  name: string;
  minBuyIn: number;
  targetStack: number;
}

const TIER_NAMES: Array<{ maxBB: number; name: string }> = [
  { maxBB: 9, name: "Penny Rails" },
  { maxBB: 99, name: "Main Floor" },
  { maxBB: 999, name: "High Limit" },
  { maxBB: 99_999, name: "Whale Suite" },
  { maxBB: Number.MAX_SAFE_INTEGER, name: "Dragon's Den" },
];

// The big blind a player's bankroll comfortably supports (100bb = the target
// stack fraction of the roll — 50% means deep, aggressive games: 10k → 25/50).
import { TARGET_STACK_FRACTION } from "./config";

export function personalBB(bankroll: number): number {
  return Math.max(1, Math.round(bankroll * TARGET_STACK_FRACTION * 0.01));
}


export function tierFor(bb: number): StakeTier {
  const sb = Math.max(1, Math.floor(bb / 2));
  const name = TIER_NAMES.find((t) => bb <= t.maxBB)!.name;
  return {
    sb,
    bb,
    name,
    minBuyIn: bb * 40,
    targetStack: bb * 100,
  };
}

// A table's stakes: the poorest seated player's comfortable BB, so that
// everyone at the table can sit with a full 100bb stack if they want.
export function tableStakes(bankrolls: number[]): StakeTier {
  const bb = bankrolls.reduce((m, b) => Math.min(m, personalBB(b)), Number.MAX_SAFE_INTEGER);
  return tierFor(Math.max(1, bb));
}
