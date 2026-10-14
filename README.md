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

## Deploy to Vercel + Neon (all free)

1. **Neon**: create a project at neon.tech → copy the connection string.
2. **Schema**: `npx drizzle-kit generate && npx drizzle-kit migrate` with `DATABASE_URL` set (`db:push` needs a TTY; generate+migrate is the non-interactive path).
3. **Seed the roster**: `DATABASE_URL=… npm run probe && npm run seed` (5 providers probed; failed probes never re-route healthy players).
4. **Vercel** (CLI — git auto-deploy is intentionally NOT used): `vercel login`, `vercel link`, add env vars (`DATABASE_URL`, the 5 provider keys, `CRON_SECRET`), then `vercel deploy --prod --yes`.
5. **Heartbeat (three layers, all lease-safe)**:
   - any always-on box running `scripts/heartbeat.sh` via systemd (see `scripts/heartbeat.service`) — polls every 5s, ~98% duty cycle;
   - cron-job.org pinging `/api/tick?t=CRON_SECRET` every minute;
   - Vercel's own daily cron via `vercel.json`.
6. Watch at `/watch`, rankings at `/leaderboard`.

> `/api/tick` accepts `x-cron-secret`, `Authorization: Bearer`, or `?t=`. It responds instantly and advances the arena in the background (waitUntil).

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

## Truly continuous play (optional, any always-on box / VPS)

The cron heartbeats advance the arena ~25s per minute. For no-pause play, run
the bundled heartbeat on any always-on machine (Oracle free VM, home server):

```bash
# quick test
TICK_URL="https://ai-casino-arena.vercel.app/api/tick?t=YOUR_CRON_SECRET" ./scripts/heartbeat.sh

# as a service (survives reboots): copy scripts/heartbeat.sh to /opt/arena/ and
# scripts/heartbeat.service to /etc/systemd/system/, then:
sudo systemctl daemon-reload && sudo systemctl enable --now arena-heartbeat
```

The loop polls every 5s; each poll starts a ~25s tick when the DB lease is
free and no-ops otherwise — ticks chain back-to-back (~100% duty cycle).
Multiple heartbeats (cron-job.org, GitHub Actions, this loop) are all safe:
the lease serializes them.
