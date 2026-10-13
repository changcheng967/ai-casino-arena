// Arena repository: the persistence seam. Two implementations:
// - store-dev.ts    JSON file on disk (local dev & testing, no database needed)
// - store-neon.ts   Drizzle + Neon Postgres (production)

import type { TableState } from "../poker/engine";

export interface ModelRow {
  id: string; // unique player id (may be the NIM/Groq model id)
  modelRef: string; // provider-side model id used for API calls
  provider: "nim" | "groq" | "agnes" | "cline" | "ollama";
  name: string; // short display name
  publisher: string;
  status: "active" | "inactive" | "quarantined";
  chatCapable: boolean;
  probeLatencyMs: number | null;
  probeNote: string | null; // why a model is ineligible (e.g. "404: not on this account")
  elo: number;
  bankroll: number;
  bailouts: number;
  sessions: number;
  handsPlayed: number;
  handsWon: number;
  vpipHands: number;
  pfrHands: number;
  aggressiveActions: number; // bets + raises
  showdowns: number;
  showdownsWon: number;
  netProfit: number; // career dollars won/lost at tables
  biggestPot: number;
  malformed: number; // unparsable decision replies
  timeouts: number; // network/timeout fallbacks
  avgLatencyMs: number; // rolling average of decision latency
  consecutiveFailures: number; // consecutive provider outages (quarantine at threshold)
  healthNote: string | null; // why a model is currently quarantined
  lastSeenAt: string | null;
}

export interface SessionSeatResult {
  modelId: string;
  buyIn: number;
  finalStack: number;
  netDollars: number;
  netBB: number;
  handsPlayed: number;
  rank: number;
  eloBefore: number;
  eloAfter: number;
}

export interface SessionRow {
  id: string;
  tierName: string;
  sb: number;
  bb: number;
  hands: number;
  startedAt: string;
  endedAt: string | null;
  seats: SessionSeatResult[];
}

export interface HandRow {
  id: string;
  sessionId: string;
  handNo: number;
  tierName: string;
  sb: number;
  bb: number;
  board: number[];
  pot: number;
  awards: { amount: number; winners: string[]; handName?: string }[];
  actions: unknown[]; // engine action log entries (with table talk in note)
  showdown: boolean;
  holeCards: Record<string, number[]>;
  createdAt: string;
}

export interface EloHistoryRow {
  id: string;
  modelId: string;
  elo: number;
  delta: number;
  sessionId: string | null;
  createdAt: string;
}

export interface LiveTable {
  tableId: string;
  tierName: string;
  state: TableState;
  sessionRowId: string;
  buyIns: Record<string, number>;
  bankrolls: Record<string, number>; // bankroll snapshot when seated
  stints?: Record<string, number>; // hands played at this seat (per stint)
  departed?: SessionSeatResult[]; // players who already left this table
  createdAt: string;
}

export interface ArenaStateRow {
  id: "main";
  tables: LiveTable[];
  lobbyNotes: string[];
  leaseUntil: number; // epoch ms
  lastTickAt: number | null;
  totalHandsEver: number;
  matchmakingCounter: number;
}

export interface ArenaRepo {
  upsertModels(rows: Partial<ModelRow> & { id: string }[]): Promise<void>;
  listModels(): Promise<ModelRow[]>;
  getModel(id: string): Promise<ModelRow | null>;
  patchModel(id: string, patch: Partial<ModelRow>): Promise<void>;

  getArenaState(): Promise<ArenaStateRow | null>;
  saveArenaState(state: ArenaStateRow): Promise<void>;

  insertSession(row: SessionRow): Promise<void>;
  insertHand(row: HandRow): Promise<void>;
  insertEloHistory(rows: EloHistoryRow[]): Promise<void>;

  recentHands(limit: number, opts?: { sessionId?: string }): Promise<HandRow[]>;
  handsForModel(modelId: string, limit: number): Promise<HandRow[]>;
  eloHistoryFor(modelId: string, limit: number): Promise<EloHistoryRow[]>;
  listSessions(limit: number): Promise<SessionRow[]>;
  arenaStats(): Promise<{ hands: number; sessions: number }>;
  deleteModels(ids: string[]): Promise<number>;
}

export function blankModel(id: string, name: string, publisher: string): ModelRow {
  return {
    id,
    modelRef: id,
    provider: "nim",
    name,
    publisher,
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
  };
}

export function shortName(modelId: string): string {
  const tail = modelId.split("/").pop() ?? modelId;
  return tail
    .replace(/-instruct.*$/i, "")
    .replace(/-it$/i, "")
    .replace(/-a\d+b.*$/i, "")
    .replace(/-\d+b.*$/i, "")
    .replace(/-v\d+.*$/i, "")
    .replace(/^agnes-/, "agnes ");
}
