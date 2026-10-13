// Continuous cash-game validation: scripted players, no API calls.
// Verifies money conservation, exits/settlements, refills happening.

import "./loadEnv";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";

process.env.ARENA_FAKE_LLM = "1";
process.env.ARENA_STORE_PATH = join("data", "demo_store.json");

const storePath = join(process.cwd(), process.env.ARENA_STORE_PATH);
if (existsSync(storePath)) rmSync(storePath);

const { DevRepo } = await import("../lib/arena/store-dev");
const { runTick } = await import("../lib/arena/tick");
const { blankModel } = await import("../lib/arena/repo");

const IDS = [
  "demo/alpha", "demo/bravo", "demo/charlie", "demo/delta", "demo/echo", "demo/foxtrot",
];

const repo = new DevRepo();
await repo.upsertModels(
  IDS.map((id) => ({ ...blankModel(id, id.split("/")[1], "demo"), chatCapable: true, status: "active" as const })),
);

const t0 = Date.now();
let ticks = 0;
let exits = 0, closes = 0, refills = 0, bailouts = 0;
while (ticks < 600 && Date.now() - t0 < 150_000) {
  const rep = await runTick(repo, { budgetMs: 350 });
  ticks++;
  exits += rep.playersLeft; closes += rep.tablesClosed; refills += rep.seatsFilled; bailouts += rep.bailouts;
  if (ticks % 100 === 0) {
    const st = await repo.getArenaState();
    console.log(`tick ${ticks}: tables=${st?.tables.length ?? 0} hands=${st?.totalHandsEver ?? 0} exits=${exits} closes=${closes} refills=${refills}`);
  }
}

const models = await repo.listModels();
const money = models.reduce((s, m) => s + m.bankroll, 0);
const st = await repo.getArenaState();
const tableMoney = (st?.tables ?? []).reduce(
  (s, t) => s + t.state.players.reduce((x, p) => x + p.stack, 0) + t.state.pot,
  0,
);
console.log(`\nticks=${ticks} exits=${exits} closes=${closes} refills=${refills} bailouts=${bailouts}`);
console.log(`money conservation: bankrolls(${money}) + tables(${tableMoney}) = ${money + tableMoney} (expected 60000)`);
for (const m of models.sort((a, b) => b.elo - a.elo)) {
  console.log(
    `${m.name.padEnd(8)} elo=${m.elo.toFixed(1).padStart(7)} roll=$${m.bankroll} stints=${m.sessions} hands=${m.handsPlayed} bailouts=${m.bailouts}`,
  );
}
const sessions = await repo.listSessions(5);
for (const s of sessions) {
  console.log(`table ${s.id.slice(0, 8)} ${s.tierName} ${s.sb}/${s.bb} hands=${s.hands} ended=${s.endedAt ? s.endedAt.slice(11, 19) : "LIVE"} seats=${s.seats.length}`);
}
const ok = money + tableMoney === 60_000 && exits > 0;
console.log(ok ? "\nCONTINUOUS-MODE VALIDATION PASSED" : "\nCONTINUOUS-MODE VALIDATION FAILED");
process.exit(ok ? 0 : 1);
