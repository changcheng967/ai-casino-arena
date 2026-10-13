# AI Casino Arena — Complete System Brief (for a designing agent)

*Handoff document. Read fully before designing. Everything here is empirical fact
from a working, running system — not speculation. Current live state at writing:
105 hands played, 4 tables running, 26 active players across 5 LLM providers,
chip conservation exact, Elo pool exactly zero-sum.*

---

## 1. The product (in the owner's own words, consolidated)

LLMs play **No-Limit Texas Hold'em against each other 24/7** on a public website.
Humans spectate: watch tables live, click into a table, browse a leaderboard,
model profiles, hand replays, and toggle card visibility (Blind / Showdown / God view).

**The owner's hard requirements (each one was an explicit correction when we got it wrong):**

1. **A real casino economy, sped up.** Every model starts with **$10,000**, kept
   *forever* (no resets). Tables have **dynamic stakes by wealth** (rooms: Penny
   Rails → Main Floor → High Limit → Whale Suite → Dragon's Den). **LLMs decide
   their own buy-in** (min 40 big blinds, max entire fortune) and their exact bet
   sizes. Bankruptcy = a **fixed $10,000 bailout**, recorded forever; Elo survives.
   The fantasy is grinding from $10K toward billions.
2. **Real-world game format.** A "game" is ONE HAND, not a session — we were
   explicitly corrected for having 60-hand sessions. Tables run continuously like
   a card room: bust = must leave the seat; players join/leave; tables form and
   close. Google DeepMind's Game Arena and real card-room conventions were the
   reference the owner pointed to.
3. **Completely fair, money-blind Elo** — measured in big blinds, seeded 1200,
   identical rules for all, no advantage from wealth.
4. **As fast as physically possible** — the owner repeatedly pushed: "determine
   skill in minutes or hours, not days", "everything dynamic, not fixed" (K etc.),
   "Elo moving in realtime". The final instruction: speed must NOT degrade the
   game or fairness — find the best ruleset.
5. **100% free hosting forever:** Vercel Hobby + Neon free Postgres +
   cron-job.org heartbeat. No credit card anywhere.
6. **Only free model access**: every provider key is a free tier; where a
   provider tags free models, ONLY those may be used (explicit instruction for
   Cline and OpenCode).

---

## 2. Current architecture (working code, all tests green: 45/45)

```
[cron-job.org every 1 min] → GET /api/tick?t=SECRET
[Vercel/Next.js 16.4] → runTick():
    claim 90s lease (DB) → bailouts → settle finished tables →
    form tables (LLM buy-ins, random seats) → advance ALL tables in
    parallel lanes until 30s budget → checkpoint after EVERY decision →
    release lease
[Neon Postgres via Drizzle] — prod store; JSON file store — dev
[5 LLM providers] — OpenAI-compatible chat calls, one JSON action per decision
```

**Key files:** `lib/poker/{cards,evaluator,engine}.ts` (pure, tested engine:
side pots, uncalled-bet return, min-raise clamping, HU rules),
`lib/arena/{tick,decide,prompt,elo,repo,config,stakes}.ts`,
`lib/nim/client.ts` (multi-provider client), `scripts/{probe,seed}.ts`,
`app/*` (watch, leaderboard, profiles, hands, replay, about),
`db/schema.ts` + `lib/arena/store-neon.ts` (Drizzle), `lib/arena/store-dev.ts` (JSON).

**Hard platform constraints (the physics of the hosting):**
- Vercel Hobby function cap ≈ 60s → worst tick must stay < 58s.
  Current: 30s work budget + 28s max decision timeout.
- cron-job.org minimum interval = 1 minute. So the arena advances in
  ~30s chunks each minute (dev uses a 45s local loop + browser auto-tick).
- Lease (90s) serializes overlapping heartbeats. Chunked state machine with
  checkpoint-after-every-decision means a hard kill loses ≤1 in-flight call.

**Throughput reality (measured):** ~146 hands/hour arena-wide with 4 tables and
the current provider mix. Decision latencies: 130–620ms (Groq), 340–2300ms
(Ollama), 630–4100ms (Cline), ~600ms (Agnes), 1–20s (NIM; several chronic
timeout models). One tick fits ~10–25 fast decisions.

---

## 3. The economy & rotation rules (current constants in `lib/arena/config.ts`)

| Rule | Value |
|---|---|
| Starting bankroll / bailout | $10,000 fixed, bailout < $40 unseated, recorded forever |
| Table size / max tables | 6-max, MAX_TABLES 4 (recommend trying 5–6) |
| Stakes | dynamic by table wealth; big blind priced off the *poorest* seated player; everyone can sit ~100bb |
| Buy-in | LLM-decided, min 40bb, max whole fortune; default target 100bb |
| Leave offers | from hand 4 of a stint: up +40% (WIN_CASHOUT_MULTIPLE 1.4) or stuck ⅓ (0.65) |
| Forced time cap | at 12 hands (LEAVE_HARD_HANDS) the house cashes the player out — seat opens. Never below heads-up in one pass |
| Leave-ask budget | 7s timeout, ≤1 ask per table per tick |
| Refills | from lobby, gated by bankroll ≥ 40bb and personalBB ≥ bb; ≤1 per table per tick, with a budget reserve |
| Safety cap | table force-closes at 400 hands (never reached in practice now) |
| Clock violation | ≥4 timeouts with zero successful answers → instant house fold (check if free), every 8th decision retries the real API for recovery |

---

## 4. The rating system (just rewritten — the current state)

**Design goal: realtime movement + true-skill convergence + provable fairness,
all three at once.** Three mechanisms:

1. **Live settlement every hand.** At each hand boundary, every seated pair
   exchanges a small update (weight 0.25) on their **cumulative stint standings
   in net big blinds**. The leaderboard moves on every hand.
2. **Exit settlement** (weight 0.6) when a player leaves — the authoritative
   correction over their whole stint.
3. **Z-filtered scores — the key fairness innovation.** The pairwise "score" is
   not win/lose but a statistical confidence:
   `S = Φ( ΔnetBB / (σ·√(h_a+h_b)) )`, σ = 18bb (per-hand luck scale, 6-max 100bb).
   A 2-hand luck spike scores ≈0.87; the same *rate* sustained 20 hands scores
   >0.97; a tie scores exactly 0.5. Luck barely moves ratings; sustained
   dominance moves them fully. Noise-driven random walk is filtered at the source.
4. **Dynamic K (continuous, no steps):** `K = 120/(1 + careerHands/300)`,
   clamped [32, 120]. New players move fast (K≈120), established ratings
   stabilize smoothly. Same formula for everyone.
5. **Exact zero-sum:** each pair exchanges at the *average* of the two players'
   dynamic K's → Σ(rating−1200) = 0.00 measured over the whole pool at all times.
   Rating inflation is structurally impossible.
6. Expectation term is standard Elo (`E = 1/(1+10^((Rb−Ra)/400))`) so farming
   weaker opponents self-corrects.

**The honest physics (tell the owner this):** per-hand skill edge between LLMs
≈ 0.2–1.0 bb/hand against per-hand luck σ ≈ 18bb. 2σ separation of a strong
edge needs ~1,600 pairwise common hands; the z-filter's use of *rate
magnitude* (not just sign) recovers roughly 2–3× effective SNR. At ~150
hands/hour with ~26 players: **strong differences show in ~15–40 minutes;
a full trustworthy ranking takes a few hours.** No rating formula can beat
this information bound without changing the game itself.

---

## 5. LLM providers (all keys tested empirically, October 2026)

| Provider | Base URL | Status on the free key | In arena |
|---|---|---|---|
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | 80 models listed, ~60 return "Function not found for account"; 40 RPM sustained | 14 players |
| Groq | `https://api.groq.com/openai/v1` | 4 chat-capable; RPD headers; some models 1–7k RPD (nap when exhausted) | 3 players |
| Agnes AI | `https://apihub.agnes-ai.com/v1` | 9 models; only `agnes-2.5-flash` + `agnes-3.0-flash` free (pro = 403 quota-blocked) | 2 players |
| Cline | `https://api.cline.bot/api/v1` | OpenRouter-backed; **only `:free`-tagged models allowed** (owner's rule); 10 of 13 work; **responses are double-wrapped in `{data:…}`**; gemma/inkling :free persistently 429 | 5 players |
| Ollama Cloud | `https://ollama.com/v1` | **only `-cloud` models are free**; 6 work (340–2300ms); rest 402/410-retired | 2 players (wins on gemma-4-31b and gpt-oss-20b) |
| Thinking Machines | `https://tinker.thinkingmachines.dev/...` | Fine-tuning SDK, not a chat API; key is 402 billing-blocked. Inkling reachable via Cline `:free` (currently 429) | 0 |
| OpenCode | `https://opencode.ai/inference/v1` | `403 FreeTierError: free tier only from within OpenCode` — client-locked by design; we will not spoof their client | 0 |

**Duplicate policy (owner's rule):** when the same model exists on several
providers, exactly ONE player exists, routed to the faster probe (with a Groq
RPD capacity exception). Canonical ids are NIM-style `publisher/model`;
alias maps handle catalog naming differences (e.g. cline
`nvidia/nemotron-3.5-lightning:free` ≡ NIM `nvidia/nemotron-3.5-lightning-30b-a3b`,
ollama `gemma4:31b-cloud` ≡ `google/gemma-4-31b-it`).
Refresh = `npm run probe && npm run seed` (career stats survive; failed probes
never re-route a healthy player).

**Player reality:** 26 active, ~19 more listed inactive with reasons. Slow
thinkers (kimi-k3, llama-90b-vision, glm-5.3-flash: 20s+ or never answering)
are handled by the clock-violation rule — they fold by the clock, honestly,
and it shows on their profile. VPIP on responsive models runs 44–71%.

---

## 6. Decision interface (what the LLM actually sees)

Per decision: system prompt (persona + winning-habit coaching: defend BB,
play 20–35% of hands, raise premiums) + user prompt with stakes/room, position,
hole cards, board, pot, legal actions with min/max raise, a house-computed
Monte-Carlo **equity hint** (identical for all — levels the field for weak
models), 8-entry opponent history, bankroll. Output contract: strict JSON
`{"action":"fold|check|call|raise","amount":<raise-to>,"talk":"<≤60 chars>"}`.
Unparsable → legal default (check if free else fold), counted as `malformed`.
Temperature 0.6, maxTokens 600, "respond INSTANTLY" directive (measurably
raised VPIP). Table talk renders as speech bubbles.

---

## 7. Fairness guarantees (verified, keep all of these)

- Money-blind: all skill comparisons in **net big blinds**, never dollars.
- Identical information: same prompt format + same house equity hint for all.
- Randomized seat order each seating; dealer button rotates every hand.
- Exact chip conservation (tested 400-tick offline run + live invariant check).
- Exact zero-sum Elo (pair-averaged K) — measured 0.00 drift pool-wide.
- K depends only on career hands — same curve for every model.
- Clock rule identical for all; timeouts tracked on profiles.
- Bailout is a fixed amount, forever visible; Elo survives bankruptcy.

## 8. Bug history (do not reintroduce; all fixed + tested)

1. Table formation counted only the queue → 7 models stranded in lobby forever.
2. JSON dev store whole-file writes lost updates across concurrent writers →
   $6,000 phantom money (now per-mutation disk read-modify-write; 5 zombie
   cron loops were also killed — the /watch page ALSO auto-ticks in dev).
3. Chronic-timeout models burned the whole 28s tick budget per decision.
4. Flaky re-probes could re-route a healthy player to a provider where it
   just failed.
5. Evaluator phantom straight (duplicated ace bit), dealer button advanced
   before blinds, uncalled bet counted in pot — engine tests cover all.
6. Prompt fear ("bankroll must survive") + 20s timeouts → everyone folded to
   the BB (VPIP≈0). Fixed by coaching + timeout tuning + instant-JSON directive.

## 9. Open design questions (what a better design should attack)

1. **Throughput ceiling.** 1-minute cron × 30s budget is the binding
   constraint on hands/hour. Ideas to evaluate: multi-decision batching per
   tick, shortening the decision timeout adaptively per model (fast models
   don't need 28s), MAX_TABLES 5–6, or a second staggered cron job.
2. **Opponent matching.** Currently random refill from lobby. Elo-proximity
   pairing would concentrate information where separation is uncertain
   (active-learning style) — could cut ranking time several-fold.
3. **Rating confidence display** (Glicko-style RD or a Bayesian posterior):
   the z-filter already computes the evidence; surfacing "±confidence" would
   make early fast movement honest to spectators.
4. **σ calibration.** POKER_SIGMA_BB=18 is an educated guess; it could be
   measured live from the actual netBB distribution and adapted per table size.
5. **Wealth-dynamics realism.** Stakes ladder exists; consider whether bailouts
   should decay, and whether the Whale tiers create matchmaking deadlock at
   extreme wealth ratios (10B vs 2M) — currently solved by poorest-player
   pricing but untested at scale.
6. **Spectator thrill.** Live Elo ticker, streak banners, "hand of the hour" —
   the realtime settlement data now exists to power all of it.

## 10. Security & ops notes

- Six API keys were pasted in chat during development (NVIDIA, Groq, TML,
  Agnes, Cline, Ollama) — all live only in gitignored `.env.local`;
  **owner should rotate all of them**.
- `/api/tick` requires `CRON_SECRET` (header or `?t=`) in production; dev bypasses.
- Neon retention: hands pruned after 14 days; aggregates/stats forever.
- Deploy runbook is in README.md (Neon → db:push → seed → Vercel env → cron-job.org).

---

**Everything above is real and running.** The designing agent should treat
sections 1–8 as fixed constraints (they encode the owner's explicit product
decisions and hard-won correctness), and focus creative energy on section 9 —
especially throughput and matchmaking, which dominate time-to-true-ranking.
