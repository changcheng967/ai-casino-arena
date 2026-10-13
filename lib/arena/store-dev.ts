// Dev store: single JSON file backing the whole arena. Perfect for local runs
// and testing without any database. NOT for production scale.

import {
  ArenaRepo,
  ArenaStateRow,
  EloHistoryRow,
  HandRow,
  ModelRow,
  SessionRow,
} from "./repo";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

interface StoreShape {
  models: ModelRow[];
  arenaState: ArenaStateRow | null;
  sessions: SessionRow[];
  hands: HandRow[];
  eloHistory: EloHistoryRow[];
}

// Works under tsx scripts and the Next dev server (both run from the project root).
const STORE_PATH = join(process.cwd(), process.env.ARENA_STORE_PATH ?? "data/dev_store.json");

function emptyStore(): StoreShape {
  return { models: [], arenaState: null, sessions: [], hands: [], eloHistory: [] };
}

function load(): StoreShape {
  if (!existsSync(STORE_PATH)) return emptyStore();
  try {
    const data = JSON.parse(readFileSync(STORE_PATH, "utf8"));
    return { ...emptyStore(), ...data };
  } catch {
    // Corrupted primary (e.g. interrupted write): fall back to the backup.
    const bak = STORE_PATH + ".bak";
    if (existsSync(bak)) {
      try {
        return { ...emptyStore(), ...JSON.parse(readFileSync(bak, "utf8")) };
      } catch {
        /* fall through */
      }
    }
    return emptyStore();
  }
}

function persist(store: StoreShape): void {
  mkdirSync(join(STORE_PATH, ".."), { recursive: true });
  const json = JSON.stringify(store);
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const tmp = STORE_PATH + ".tmp";
      writeFileSync(tmp, json);
      renameSync(tmp, STORE_PATH);
      writeFileSync(STORE_PATH + ".bak", json);
      return;
    } catch (e) {
      lastErr = e;
      const until = Date.now() + 20;
      while (Date.now() < until) {}
    }
  }
  throw lastErr;
}

// Simple write-through cache so reads inside one tick don't hit the disk.
let cache: StoreShape | null = null;

function store(): StoreShape {
  if (!cache) cache = load();
  return cache;
}

// Every mutation re-reads from disk before writing. A stale whole-file
// snapshot must never clobber concurrent field-level writes: Next dev hot
// reload creates multiple module instances of this file (each with its own
// cache), and an overlapped tick can hold an older view — observed live as
// buy-in deductions being resurrected ($6k of phantom money). Read-modify-
// write per mutation makes each write atomic within the process (the fs ops
// are synchronous with no awaits in between).
function mutate(fn: (s: StoreShape) => void): void {
  const fresh = load();
  fn(fresh);
  cache = fresh;
  persist(fresh);
}

export class DevRepo implements ArenaRepo {
  async upsertModels(rows: (Partial<ModelRow> & { id: string })[]): Promise<void> {
    // Only roster identity fields are overwritten — never career stats
    // (a re-seed mid-season must not reset Elo/bankroll/hands).
    const ROSTER_FIELDS = [
      "modelRef",
      "provider",
      "name",
      "publisher",
      "status",
      "chatCapable",
      "probeLatencyMs",
      "probeNote",
    ] as const;
    mutate((s) => {
      for (const row of rows) {
        const idx = s.models.findIndex((m) => m.id === row.id);
        if (idx >= 0) {
          const patch: Partial<ModelRow> = {};
          for (const k of ROSTER_FIELDS) if (row[k] !== undefined) (patch as any)[k] = (row as any)[k];
          s.models[idx] = { ...s.models[idx], ...patch };
        } else {
          s.models.push({
            status: "active",
            chatCapable: true,
            probeLatencyMs: null,
            probeNote: null,
            elo: 1200,
            bankroll: 10_000,
            bailouts: 0,
            sessions: 0,
            handsPlayed: 0,
            handsWon: 0,
            vpipHands: 0,
            pfrHands: 0,
            aggressiveActions: 0,
            showdowns: 0,
            showdownsWon: 0,
            netProfit: 0,
            biggestPot: 0,
            malformed: 0,
            timeouts: 0,
            avgLatencyMs: 0,
            consecutiveFailures: 0,
            healthNote: null,
            lastSeenAt: null,
            name: row.id,
            publisher: row.id.split("/")[0],
            ...row,
          } as ModelRow);
        }
      }
    });
  }

  async listModels(): Promise<ModelRow[]> {
    return [...store().models];
  }

  async getModel(id: string): Promise<ModelRow | null> {
    return store().models.find((m) => m.id === id) ?? null;
  }

  async patchModel(id: string, patch: Partial<ModelRow>): Promise<void> {
    mutate((s) => {
      const idx = s.models.findIndex((m) => m.id === id);
      if (idx >= 0) s.models[idx] = { ...s.models[idx], ...patch };
    });
  }

  async getArenaState(): Promise<ArenaStateRow | null> {
    return store().arenaState;
  }

  async saveArenaState(state: ArenaStateRow): Promise<void> {
    mutate((s) => {
      s.arenaState = state;
    });
  }

  async insertSession(row: SessionRow): Promise<void> {
    mutate((s) => {
      const idx = s.sessions.findIndex((x) => x.id === row.id);
      if (idx >= 0) s.sessions[idx] = row;
      else s.sessions.unshift(row);
    });
  }

  async insertHand(row: HandRow): Promise<void> {
    mutate((s) => {
      s.hands.unshift(row);
      if (s.hands.length > 3000) s.hands.length = 3000; // keep dev store bounded
    });
  }

  async insertEloHistory(rows: EloHistoryRow[]): Promise<void> {
    mutate((s) => {
      s.eloHistory.unshift(...rows);
      if (s.eloHistory.length > 6000) s.eloHistory.length = 6000;
    });
  }

  async recentHands(limit: number, opts?: { sessionId?: string }): Promise<HandRow[]> {
    const hands = store().hands;
    if (opts?.sessionId) return hands.filter((h) => h.sessionId === opts.sessionId).slice(0, limit);
    return hands.slice(0, limit);
  }

  async handsForModel(modelId: string, limit: number): Promise<HandRow[]> {
    return store()
      .hands.filter((h) => modelId in h.holeCards || h.awards.some((a) => a.winners.includes(modelId)))
      .slice(0, limit);
  }

  async eloHistoryFor(modelId: string, limit: number): Promise<EloHistoryRow[]> {
    return store()
      .eloHistory.filter((h) => h.modelId === modelId)
      .slice(0, limit);
  }

  async listSessions(limit: number): Promise<SessionRow[]> {
    return store().sessions.slice(0, limit);
  }

  async arenaStats(): Promise<{ hands: number; sessions: number }> {
    const s = store();
    return { hands: s.hands.length, sessions: s.sessions.length };
  }

  async deleteModels(ids: string[]): Promise<number> {
    const kill = new Set(ids);
    let removed = 0;
    mutate((s) => {
      const before = s.models.length;
      s.models = s.models.filter((m) => !kill.has(m.id));
      removed = before - s.models.length;
    });
    return removed;
  }
}

export function newId(): string {
  return randomUUID();
}
