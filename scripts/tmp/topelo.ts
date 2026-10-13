import { neon } from "@neondatabase/serverless";
(async () => {
  const sql = neon(process.env.DATABASE_URL!);
  const top = await sql`SELECT model_id, COUNT(*)::int AS n FROM elo_history GROUP BY model_id ORDER BY n DESC LIMIT 5`;
  console.log("most rating settlements:");
  for (const r of top) console.log(" ", r.model_id, r.n);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
