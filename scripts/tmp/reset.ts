import { neon } from "@neondatabase/serverless";
(async () => {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`DELETE FROM arena_state`;
  await sql`DELETE FROM elo_history`;
  await sql`DELETE FROM hands`;
  await sql`DELETE FROM sessions`;
  console.log("arena reset: tables/history wiped for fresh launch");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
