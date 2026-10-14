// Seed the roster from data/roster.json (produced by scripts/probe.ts).
// Chat-capable models become active players; the rest are listed as ineligible.

import "./loadEnv";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getStore } from "../lib/arena/store";
import { shortName, blankModel, ModelRow } from "../lib/arena/repo";
import { ELO_START, START_BANKROLL } from "../lib/arena/config";

async function main() {
  const rosterPath = join(process.cwd(), "data", "roster.json");
  if (!existsSync(rosterPath)) {
    console.error("data/roster.json missing — run `npm run probe` first.");
    process.exit(1);
  }
  const roster = JSON.parse(readFileSync(rosterPath, "utf8")).results as Array<{
    id: string;
    modelRef?: string;
    provider?: "nim" | "groq" | "agnes" | "cline" | "ollama";
    chatCapable: boolean;
    latencyMs: number | null;
    error?: string;
    errorKind?: string;
    note?: string;
  }>;

  const store = await getStore();
  const existing = new Map((await store.listModels()).map((m) => [m.id, m]));
  // Every (provider, modelRef) pair is its OWN player — the same LLM served by
  // two providers sits as two seats. Player id is `provider:modelRef`, which is
  // globally unique and self-describing.
  const rows = roster.map((r) => {
    const modelRef = r.modelRef ?? r.id;
    const id = `${r.provider ?? "nim"}:${modelRef}`;
    const base = blankModel(id, shortName(modelRef), r.provider ?? "nim");
    // a flaky cold-start on a re-probe must not bench a playing model
    const keepActive = ["active", "quarantined"].includes(existing.get(id)?.status ?? "");
    const capNote =
      r.provider === "groq" && r.chatCapable && (r as any).rpd !== undefined && (r as any).rpd !== null && Number((r as any).rpd) < 2000
        ? `groq free tier: ~${(r as any).rpd} requests/day — may nap when quota runs out`
        : null;
    const note = r.chatCapable
      ? capNote ?? r.note ?? null
      : keepActive
        ? (existing.get(id) as any).probeNote ?? null
        : r.note ?? (r.errorKind === "http"
        ? (r.error ?? "").includes("404")
          ? "not available on this NIM account (404)"
          : (r.error ?? `HTTP error: ${r.errorKind}`).slice(0, 120)
        : r.errorKind === "timeout"
          ? "too slow for the arena (timeout)"
          : r.errorKind === "invalid"
            ? "not a chat model"
            : (r.errorKind ?? "unknown"));
    return {
      ...base,
      modelRef,
      provider: (r.provider ?? "nim") as ModelRow["provider"],
      elo: ELO_START,
      bankroll: START_BANKROLL,
      status: (r.chatCapable || keepActive ? "active" : "inactive") as "active" | "inactive",
      chatCapable: r.chatCapable || keepActive,
      probeLatencyMs: r.latencyMs,
      probeNote: note,
    };
  });

  // Only usable players live in the arena store — dead/unusable probe results
  // stay in roster.json as diagnostics but are pruned from the database.
  const keep = rows.filter((r) => r.status === "active");
  await store.upsertModels(keep);
  const keepIds = new Set(keep.map((r) => r.id));
  const deadIds = (await store.listModels()).filter((m) => !keepIds.has(m.id)).map((m) => m.id);
  let pruned = 0;
  if (deadIds.length > 0) pruned = await store.deleteModels(deadIds);
  console.log(`Seeded ${keep.length} active players (pruned ${pruned} dead models).`);
  for (const a of keep) console.log(`  ${a.probeLatencyMs}ms  ${a.id}`);
}

main();
