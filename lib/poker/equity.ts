// Monte Carlo equity estimate, used as a fairness hint in LLM prompts.
// Same hint rules for every model — computed locally, never by the LLM itself.

import { makeDeck, mulberry32 } from "./cards";
import { evaluate } from "./evaluator";

/**
 * Estimate hero's win probability vs `opponents` random hands given hole cards
 * and the current board. Returns 0..1 (ties count half).
 */
export function equityVsRandom(hole: number[], board: number[], opponents: number, rollouts = 150): number {
  if (opponents < 1) return 1;
  const used = new Set([...hole, ...board]);
  const remaining = makeDeck().filter((c) => !used.has(c));
  const needBoard = 5 - board.length;
  const rng = mulberry32((hole[0] * 733 + hole[1] * 41 + board.length * 977) >>> 0);

  let score = 0;
  for (let r = 0; r < rollouts; r++) {
    // partial Fisher-Yates on a copy-free index scheme: shuffle remaining in place each rollout
    const pool = remaining.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let idx = 0;
    const fullBoard = [...board];
    for (let b = 0; b < needBoard; b++) fullBoard.push(pool[idx++]);
    const heroScore = evaluate([...hole, ...fullBoard]);
    let beat = 1;
    for (let o = 0; o < opponents; o++) {
      const oppHole = [pool[idx++], pool[idx++]];
      const oppScore = evaluate([...oppHole, ...fullBoard]);
      if (oppScore > heroScore) {
        beat = 0;
        break;
      }
      if (oppScore === heroScore) beat = Math.min(beat, 0.5);
    }
    score += beat;
  }
  return score / rollouts;
}
