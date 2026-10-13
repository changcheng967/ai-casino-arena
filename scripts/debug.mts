import "./loadEnv";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
process.env.ARENA_FAKE_LLM = "1";
process.env.ARENA_STORE_PATH = join("data", "dbg_store.json");
const p = join(process.cwd(), process.env.ARENA_STORE_PATH);
if (existsSync(p)) rmSync(p);

const { DevRepo } = await import("../lib/arena/store-dev");
const { runTick } = await import("../lib/arena/tick");
const { blankModel } = await import("../lib/arena/repo");

const repo = new DevRepo();
await repo.upsertModels(
  ["a", "b", "c", "d", "e", "f"].map((id) => ({ ...blankModel("demo/" + id, id, "demo"), chatCapable: true, status: "active" as const })),
);

// correct live-money invariant: pot already contains live street bets
const tableMoney = (t: any) => t.state.players.reduce((x: number, q: any) => x + q.stack, 0) + t.state.pot;

let lastHands = -1, stuckSince = 0;
for (let i = 1; i <= 400; i++) {
  const rep = await runTick(repo, { budgetMs: 300 });
  const st = await repo.getArenaState();
  const models = await repo.listModels();
  const bank = models.reduce((s, m) => s + m.bankroll, 0);
  const tbl = (st?.tables ?? []).reduce((s, t) => s + tableMoney(t), 0);
  const total = bank + tbl;
  const t0 = st?.tables?.[0];
  if (total !== 60000 || !rep.ran || (i % 40 === 0)) {
    console.log(`tick ${i}: ran=${rep.ran} reason=${rep.reason ?? "-"} dec=${rep.decisions} hands=${rep.handsRecorded} left=${rep.playersLeft} fill=${rep.seatsFilled} closed=${rep.tablesClosed} | tables=${st?.tables.length} handsEver=${st?.totalHandsEver} TOTAL=${total}${t0 ? ` | t0: seats=${t0.state.players.length} street=${t0.state.street} await=${t0.state.awaitingDecision} lastRes=${!!t0.state.lastHandResult} over=${t0.state.sessionOver} hand=${t0.state.handNumber} stacks=[${t0.state.players.map((q: any) => q.stack).join(",")}]` : ""}`);
  }
  if (total !== 60000) { console.log("CONSERVATION VIOLATION"); break; }
  if (st && st.totalHandsEver === lastHands) { stuckSince++; if (stuckSince === 30 && st.tables.length > 0) { console.log("STUCK 30 ticks, dumping table:", JSON.stringify(st.tables[0].state).slice(0, 1500)); break; } }
  else { stuckSince = 0; lastHands = st?.totalHandsEver ?? -1; }
}
console.log("done");
