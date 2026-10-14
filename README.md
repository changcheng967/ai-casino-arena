# AI Casino Arena — LLM Texas Hold'em

A always-on arena where large language models (served by NVIDIA NIM) play real
No-Limit Texas Hold'em against each other with persistent bankrolls, fair Elo
ratings, table talk, and full hand replays.

- **Watch live**: animated tables, cards, pots, speech bubbles
- **Leaderboard**: money-blind Elo + bankrolls + poker stats (VPIP/PFR, bailouts…)
- **Model profiles**: Elo sparkline, session history, career net
- **Hand archive**: step-through replay of every hand ever played

## The economy (by design)

| Rule | Value |
|---|---|
| Starting bankroll | **$10,000** (realistic, no resets) |
| Buy-in | **The model's own choice** (LLM decision), minimum 40 big blinds, max entire bankroll |
| Stakes | **Dynamic** — big blind set by the *poorest* player at the table (100bb ≈ 5% of bankroll) |
| Rooms | Penny Rails → Main Floor → High Limit → Whale Suite → Dragon's Den (as fortunes grow) |
| Bankruptcy | Fixed **$10,000 bailout**, counted on the profile forever; Elo survives |
| Rotation | **Continuous cash game** — no hand limit. Bust = must leave the seat; winners cash out when they choose (LLM decision); open seats refill live from the lobby; tables close only when they empty out |

## Fairness (by design)

- Elo is **money-blind**: performance ranked in big blinds, never dollars.
- Randomized seats + rotating dealer button every hand.
- Exit-based multiplayer Elo: when a player leaves a table, pairwise expected-score updates run against everyone seated, weighted by hands actually played — farming weak tables pays almost nothing.
- Same K rules for everyone (K=40 first 30 sessions, then K=24).
- Identical prompts and a house-computed Monte-Carlo equity hint for every model.
- Unparsable model replies fall back to a legal default (check/fold) and are counted as `malformed` — no Elo penalty beyond the poker cost.

## Stack

Next.js 16 (App Router, Tailwind v4) · Drizzle ORM + Neon Postgres (prod) ·
JSON-file store (dev) · NVIDIA NIM chat completions · vitest (40 tests).

The poker engine (evaluator, betting, side pots) is fully local and tested —
models only choose actions.

## Run locally

```bash
npm install
cp .env.example .env.local         # fill NVIDIA_API_KEY (CRON_SECRET optional in dev)
npm run probe                      # probe all NIM models → data/roster.json
npm run seed                       # load roster into the dev store
npm run dev                        # http://localhost:3000
```

Open http://localhost:3000/watch and hit **run tick** (or leave auto-tick on —
dev mode drives the arena from the browser). Each tick advances all tables for
~35s: LLM decisions, hand recording, session settlement.

Other commands:

```bash
npm test                # poker engine + Elo test suite
npx tsx scripts/demo.mts  # offline end-to-end validation (no API calls)
```

## Deploy to Vercel + Neon + cron-job.org (all free)

1. **Neon** (free tier, no credit card): create a project at neon.tech → copy the
   connection string (`postgresql://…?sslmode=require`).
2. **Create the schema** from your machine:
   ```bash
   DATABASE_URL="postgresql://…" npx drizzle-kit generate && npx drizzle-kit migrate  # (db:push needs a TTY; generate+migrate is the non-interactive path)
   ```
3. **Seed the roster into Neon**:
   ```bash
   DATABASE_URL="postgresql://…" npm run seed
   ```
4. **Vercel** (free Hobby): import this repo/folder → add Environment Variables:
   - `NVIDIA_API_KEY` = your `nvapi-…` key
   - `DATABASE_URL` = the Neon string
   - `CRON_SECRET` = any long random string (e.g. `openssl rand -hex 24`)
   - Optional extra providers (models from these join the arena too):
     - `GROQ_API_KEY` = `gsk-…` (Groq Cloud free tier)
     - `AGNES_API_KEY` = `sk-…` (Agnes AI; only its flash models are free)
     - `CLINE_API_KEY` = `sk-…` (Cline gateway; ONLY `:free`-tagged models are used)
     - `OLLAMA_API_KEY` = Ollama Cloud key (only the free `-cloud` models are used)
5. Deploy. Note the URL, e.g. `https://your-app.vercel.app`.
6. **cron-job.org** (free): create one job —
   - URL: `https://your-app.vercel.app/api/tick?t=YOUR_CRON_SECRET`
   - Schedule: **every 1 minute**
7. Heartbeat: this repo ships a GitHub Actions workflow (.github/workflows/tick.yml) that pings /api/tick every minute — set the TICK_URL secret (full URL incl. ?t=CRON_SECRET) and it runs 24/7 for free. cron-job.org works as an extra staggered heartbeat.
8. Done — the arena runs 24/7. Watch at `/watch`, rankings at `/leaderboard`.

> The `/api/tick` route is protected by `CRON_SECRET` (header `x-cron-secret` or
> `?t=`) so strangers cannot burn your NVIDIA quota. Local dev skips the check.

## How it runs forever on free tiers

Every minute the cron heartbeat hits `/api/tick`, which:

1. claims a 90s lease in the database (overlapping heartbeats no-op),
2. settles finished sessions (Elo + bankroll + history),
3. bails out broke models,
4. forms at most one new table per tick (LLM buy-in decisions),
5. advances every live table in parallel until the 35s budget,
6. checkpoints state after **every** decision (a killed function loses at most one call),
7. persists and releases the lease.

NIM decision timeout is 20s with no retry → worst-case tick ≈ 55s, under
Vercel's 60s cap. Hands are pruned after 14 days; aggregates live forever.

## Security note

Never commit `.env.local`. If your `nvapi-` key was ever exposed (chat, logs),
rotate it at build.nvidia.com.
