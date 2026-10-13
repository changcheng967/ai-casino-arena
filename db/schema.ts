// Neon Postgres schema (production). Mirrors the ArenaRepo types exactly.

import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  serial,
} from "drizzle-orm/pg-core";

export const models = pgTable("models", {
  id: text("id").primaryKey(), // unique player id
  modelRef: text("model_ref").notNull(),
  provider: text("provider").notNull().default("nim"),
  name: text("name").notNull(),
  publisher: text("publisher").notNull(),
  status: text("status").notNull().default("active"),
  chatCapable: boolean("chat_capable").notNull().default(true),
  probeLatencyMs: integer("probe_latency_ms"),
  probeNote: text("probe_note"),
  elo: doublePrecision("elo").notNull().default(1200),
  bankroll: bigint("bankroll", { mode: "number" }).notNull().default(10000),
  bailouts: integer("bailouts").notNull().default(0),
  sessions: integer("sessions").notNull().default(0),
  handsPlayed: integer("hands_played").notNull().default(0),
  handsWon: integer("hands_won").notNull().default(0),
  vpipHands: integer("vpip_hands").notNull().default(0),
  pfrHands: integer("pfr_hands").notNull().default(0),
  aggressiveActions: integer("aggressive_actions").notNull().default(0),
  showdowns: integer("showdowns").notNull().default(0),
  showdownsWon: integer("showdowns_won").notNull().default(0),
  netProfit: bigint("net_profit", { mode: "number" }).notNull().default(0),
  biggestPot: bigint("biggest_pot", { mode: "number" }).notNull().default(0),
  malformed: integer("malformed").notNull().default(0),
  timeouts: integer("timeouts").notNull().default(0),
  avgLatencyMs: integer("avg_latency_ms").notNull().default(0),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  healthNote: text("health_note"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  tierName: text("tier_name").notNull(),
  sb: bigint("sb", { mode: "number" }).notNull(),
  bb: bigint("bb", { mode: "number" }).notNull(),
  hands: integer("hands").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  seats: jsonb("seats").notNull().default([]),
});

export const hands = pgTable("hands", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  handNo: integer("hand_no").notNull(),
  tierName: text("tier_name").notNull(),
  sb: bigint("sb", { mode: "number" }).notNull(),
  bb: bigint("bb", { mode: "number" }).notNull(),
  board: jsonb("board").notNull().default([]),
  pot: bigint("pot", { mode: "number" }).notNull(),
  awards: jsonb("awards").notNull().default([]),
  actions: jsonb("actions").notNull().default([]),
  showdown: boolean("showdown").notNull().default(false),
  holeCards: jsonb("hole_cards").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eloHistory = pgTable("elo_history", {
  id: text("id").primaryKey(),
  modelId: text("model_id").notNull(),
  elo: doublePrecision("elo").notNull(),
  delta: doublePrecision("delta").notNull(),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const arenaState = pgTable("arena_state", {
  id: text("id").primaryKey(), // always "main"
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schemaMeta = pgTable("schema_meta", {
  version: serial("version").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});
