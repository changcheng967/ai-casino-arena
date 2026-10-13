import { neon } from "@neondatabase/serverless";
(async () => {
  const sql = neon(process.env.DATABASE_URL!);
  const m = await sql`SELECT id, status FROM models ORDER BY id`;
  console.log("models rows:", m.length);
  for (const r of m) console.log(" ", r.id.slice(0, 44), r.status);
  const st = await sql`SELECT data FROM arena_state LIMIT 1`;
  const d = st[0]?.data;
  console.log("db arena_state tables:", d?.tables?.length ?? "none", "handsEver:", d?.totalHandsEver ?? "-");
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
