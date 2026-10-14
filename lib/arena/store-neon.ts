// Neon Postgres store (production). Requires DATABASE_URL (Neon serverless).
// Schema lives in db/schema.ts; apply with `npm run db:push`.

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, desc, sql, inArray } from "drizzle-orm";
import {
  ArenaRepo,
  ArenaStateRow,
  EloHistoryRow,
  HandRow,
  ModelRow,
  SessionRow,
} from "./repo";
import * as schema from "../../db/schema";

const HANDS_RETENTION_DAYS = 14;

// The repo speaks ISO strings; pg columns speak Date. Convert at the boundary.
const D = (s: string | null | undefined): Date | null => (s ? new Date(s) : null);
const S = (d: Date | string | null | undefined): string | null =>
  d instanceof Date ? d.toISOString() : (d ?? null);

export class NeonRepo implements ArenaRepo {
  private db: ReturnType<typeof drizzle<typeof schema>>;

  constructor(url: string) {
    const sqlClient = neon(url);
    this.db = drizzle(sqlClient, { schema });
  }

  async upsertModels(rows: (Partial<ModelRow> & { id: string })[]): Promise<void> {
    for (const row of rows) {
      const full: ModelRow = {
        status: "active",
        chatCapable: true,
        probeLatencyMs: null,
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
        lastSeenAt: null,
        name: row.id,
        publisher: row.id.split("/")[0],
        ...row,
      } as ModelRow;
      await this.db
        .insert(schema.models)
        .values({ ...full, lastSeenAt: D(full.lastSeenAt) })
        .onConflictDoUpdate({
          target: schema.models.id,
          set: {
            name: full.name,
            publisher: full.publisher,
            status: full.status,
            chatCapable: full.chatCapable,
            modelRef: full.modelRef,
            provider: full.provider,
            probeLatencyMs: full.probeLatencyMs,
            probeNote: full.probeNote ?? null,
          },
        });
    }
  }

  async listModels(): Promise<ModelRow[]> {
    const rows = await this.db.select().from(schema.models);
    return rows.map((r) => ({ ...r, lastSeenAt: S(r.lastSeenAt) })) as ModelRow[];
  }

  async getModel(id: string): Promise<ModelRow | null> {
    const rows = await this.db.select().from(schema.models).where(eq(schema.models.id, id)).limit(1);
    return rows[0] ? ({ ...rows[0], lastSeenAt: S(rows[0].lastSeenAt) } as ModelRow) : null;
  }

  async patchModel(id: string, patch: Partial<ModelRow>): Promise<void> {
    const p = { ...patch } as Record<string, unknown>;
    if (typeof p.lastSeenAt === "string") p.lastSeenAt = D(p.lastSeenAt);
    await this.db.update(schema.models).set(p).where(eq(schema.models.id, id));
  }

  async getArenaState(): Promise<ArenaStateRow | null> {
    const rows = await this.db.select().from(schema.arenaState).where(eq(schema.arenaState.id, "main")).limit(1);
    return (rows[0]?.data as ArenaStateRow) ?? null;
  }

  async saveArenaState(state: ArenaStateRow): Promise<void> {
    await this.db
      .insert(schema.arenaState)
      .values({ id: "main", data: state, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.arenaState.id,
        set: { data: state, updatedAt: new Date() },
      });
  }

  async insertSession(row: SessionRow): Promise<void> {
    const v = { ...row, startedAt: D(row.startedAt) ?? new Date(), endedAt: D(row.endedAt) };
    await this.db.insert(schema.sessions).values(v).onConflictDoUpdate({ target: schema.sessions.id, set: v });
  }

  async insertHand(row: HandRow): Promise<void> {
    await this.db.insert(schema.hands).values({ ...row, createdAt: D(row.createdAt) ?? new Date() });
    // opportunistic retention pruning (keeps the 0.5GB free tier safe)
    if (Math.random() < 0.02) {
      await this.db
        .delete(schema.hands)
        .where(sql`${schema.hands.createdAt} < now() - interval '${sql.raw(String(HANDS_RETENTION_DAYS))} days'`);
    }
  }

  async insertEloHistory(rows: EloHistoryRow[]): Promise<void> {
    if (rows.length) {
      await this.db
        .insert(schema.eloHistory)
        .values(rows.map((r) => ({ ...r, createdAt: D(r.createdAt) ?? new Date() })));
    }
  }

  async recentHands(limit: number, opts?: { sessionId?: string }): Promise<HandRow[]> {
    const q = this.db.select().from(schema.hands);
    const rows = opts?.sessionId
      ? await q.where(eq(schema.hands.sessionId, opts.sessionId)).orderBy(desc(schema.hands.createdAt)).limit(limit)
      : await q.orderBy(desc(schema.hands.createdAt)).limit(limit);
    return rows.map((r) => ({ ...r, createdAt: S(r.createdAt) ?? "" })) as unknown as HandRow[];
  }

  async handsForModel(modelId: string, limit: number): Promise<HandRow[]> {
    const rows = await this.db
      .select()
      .from(schema.hands)
      .orderBy(desc(schema.hands.createdAt))
      .limit(limit * 6);
    return rows
      .filter((h) => {
        const holes = h.holeCards as Record<string, unknown> | null;
        const awards = (h.awards ?? []) as Array<{ winners?: string[] }>;
        return (
          (holes !== null && typeof holes === "object" && modelId in holes) ||
          awards.some((a) => Array.isArray(a?.winners) && a.winners.includes(modelId))
        );
      })
      .map((r) => ({ ...r, createdAt: S(r.createdAt) ?? "" })) as unknown as HandRow[];
  }

  async eloHistoryFor(modelId: string, limit: number): Promise<EloHistoryRow[]> {
    const rows = await this.db
      .select()
      .from(schema.eloHistory)
      .where(eq(schema.eloHistory.modelId, modelId))
      .orderBy(desc(schema.eloHistory.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, createdAt: S(r.createdAt) ?? "" })) as EloHistoryRow[];
  }

  async listSessions(limit: number): Promise<SessionRow[]> {
    const rows = await this.db.select().from(schema.sessions).orderBy(desc(schema.sessions.startedAt)).limit(limit);
    return rows.map((r) => ({
      ...r,
      startedAt: S(r.startedAt) ?? "",
      endedAt: S(r.endedAt),
    })) as SessionRow[];
  }

  async getHand(id: string): Promise<HandRow | null> {
    const rows = await this.db.select().from(schema.hands).where(eq(schema.hands.id, id)).limit(1);
    const r = rows[0];
    return r ? ({ ...r, createdAt: S(r.createdAt) ?? "" }) as unknown as HandRow : null;
  }

  async claimTickLease(leaseUntil: number): Promise<ArenaStateRow | null> {
    const now = Date.now();
    // single-statement atomic claim: the WHERE guard on the old lease makes
    // exactly one of N concurrent callers the winner
    const rows = await this.db.execute(sql`
      INSERT INTO arena_state (id, data, updated_at)
      VALUES ('main', ${JSON.stringify({ id: "main", tables: [], lobbyNotes: [], leaseUntil, lastTickAt: now, totalHandsEver: 0, matchmakingCounter: 0 })}::jsonb, now())
      ON CONFLICT (id) DO UPDATE
        SET data = jsonb_set(arena_state.data, '{leaseUntil}', ${JSON.stringify(leaseUntil)}::jsonb, true),
            updated_at = now()
        WHERE coalesce((arena_state.data->>'leaseUntil')::bigint, 0) < ${now}
      RETURNING data
    `);
    const row = (rows as any).rows?.[0] ?? (rows as any)[0];
    return row ? (row.data as ArenaStateRow) : null;
  }

  async deleteModels(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    await this.db.delete(schema.models).where(inArray(schema.models.id, ids));
    return ids.length;
  }

  async arenaStats(): Promise<{ hands: number; sessions: number }> {
    const [{ count: hands }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(schema.hands);
    const [{ count: sessions }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(schema.sessions);
    return { hands, sessions };
  }
}
