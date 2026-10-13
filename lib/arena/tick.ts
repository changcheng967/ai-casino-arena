// The tick orchestrator: advances the whole arena by one work-unit.
// Called by /api/tick every minute (cron-job.org in prod, dev loop locally).
//
// CONTINUOUS CASH GAME: tables never end on a hand count. Players leave when
// they bust or choose to cash out; seats refill from the lobby; tables close
// only when they empty out. Elo settles per player at each exit, weighted by
// how many hands they actually played at that seat.

import {
  TableState,
  startHand,
  legalActions,
  apply,
  Decision,
  PlayerState,
} from "../poker/engine";
import {
  ArenaRepo,
  ModelRow,
  LiveTable,
  ArenaStateRow,
  EloHistoryRow,
  HandRow,
  SessionRow,
  SessionSeatResult,
} from "./repo";
import { newId } from "./store-dev";
import {
  BAILOUT_AMOUNT,
  BAILOUT_BELOW,
  LEASE_MS,
  MAX_TABLES,
  MIN_TABLES,
  TABLE_SIZE,
  TABLE_SAFETY_CAP,
  TICK_WORK_MS,
  DEFAULT_BUYIN_BBS,
  BUYIN_TIMEOUT_MS,
  FORMATION_GATE_MS,
  LEAVE_CHECK_MIN_HANDS,
  LEAVE_HARD_HANDS,
  WIN_CASHOUT_MULTIPLE,
  STUCK_FRACTION,
} from "./config";
import { tableStakes, personalBB } from "./stakes";
import { eloPairUpdate, pairwiseScore } from "./elo";
import { askDecision, askLeave, fallbackDecision, DecisionOutcome } from "./decide";
import { nimChat, extractJson } from "../nim/client";
import { buyinPrompt, buyinSystemPrompt } from "./prompt";
import {
  CLOCK_VIOLATION_MIN,
  CLOCK_RETRY_EVERY,
  DECISION_TIMEOUT_MS,
  ELO_LIVE_HAND_WEIGHT,
  ELO_EXIT_WEIGHT,
  QUARANTINE_THRESHOLD,
  QUARANTINE_PROBES_PER_TICK,
} from "./config";

export interface TickReport {
  ran: boolean;
  reason?: string;
  decisions: number;
  handsRecorded: number;
  playersLeft: number;
  seatsFilled: number;
  tablesFormed: number;
  tablesClosed: number;
  bailouts: number;
  ms: number;
}

function freshState(): ArenaStateRow {
  return {
    id: "main",
    tables: [],
    lobbyNotes: [],
    leaseUntil: 0,
    lastTickAt: null,
    totalHandsEver: 0,
    matchmakingCounter: 0,
  };
}

function attachTalk(state: TableState, seat: number, talk: string): void {
  const p = state.players[seat];
  if (!p) return;
  p.lastAction = `${p.lastAction ?? ""} “${talk}”`.trim();
  for (let i = state.actionLog.length - 1; i >= 0; i--) {
    const a = state.actionLog[i];
    if (a.seat === seat && a.type !== "post" && !a.note) {
      a.note = `“${talk}”`;
      break;
    }
  }
}

async function askBuyIn(model: ModelRow, sb: number, bb: number, tierName: string, minBuyIn: number, target: number): Promise<number> {
  if (process.env.ARENA_FAKE_LLM === "1") {
    return Math.min(model.bankroll, Math.max(minBuyIn, target));
  }
  try {
    const res = await nimChat({
      model: model.modelRef ?? model.id,
      provider: model.provider,
      system: buyinSystemPrompt(model.name),
      user: buyinPrompt({ sb, bb, name: tierName, minBuyIn, targetStack: target }, model.bankroll),
      maxTokens: 400,
      temperature: 0.7,
      timeoutMs: BUYIN_TIMEOUT_MS,
      retries: 0,
    });
    const parsed = extractJson(res.text);
    const n = typeof parsed?.buyin === "number" ? Math.round(parsed.buyin) : NaN;
    if (!Number.isFinite(n)) return Math.min(model.bankroll, Math.max(minBuyIn, target));
    return Math.max(minBuyIn, Math.min(n, model.bankroll));
  } catch {
    return Math.min(model.bankroll, Math.max(minBuyIn, DEFAULT_BUYIN_BBS * bb));
  }
}

function bankrollSortedPick(models: ModelRow[], count: number, counter: number): ModelRow[] {
  if (models.length <= count) return models;
  const sorted = [...models].sort((a, b) => b.bankroll - a.bankroll);
  const seed = counter % sorted.length;
  const ranked = [...sorted.slice(seed), ...sorted.slice(0, seed)];
  return ranked.slice(0, count);
}

function baseTableState(sessionId: string, sb: number, bb: number, players: PlayerState[]): TableState {
  return {
    tableId: sessionId,
    smallBlind: sb,
    bigBlind: bb,
    handNumber: 0,
    maxHands: TABLE_SAFETY_CAP,
    dealerSeat: Math.floor(Math.random() * players.length),
    players,
    board: [],
    deck: [],
    street: "preflop",
    currentSeat: -1,
    currentBet: 0,
    lastRaiseIncrement: bb,
    minRaiseTo: bb * 2,
    pot: 0,
    actionLog: [],
    rngState: (Math.random() * 2 ** 31) | 0,
    sessionOver: false,
    awaitingDecision: false,
  };
}

async function formTable(
  repo: ArenaRepo,
  pool: ModelRow[],
  counter: number,
): Promise<{ table: LiveTable; patches: { id: string; patch: Partial<ModelRow> }[] } | null> {
  if (pool.length < 2) return null;
  const picked = bankrollSortedPick(pool, Math.min(TABLE_SIZE, pool.length), counter);
  const stakes = tableStakes(picked.map((m) => m.bankroll));

  const buyInsList = await Promise.all(
    picked.map((m) => askBuyIn(m, stakes.sb, stakes.bb, stakes.name, stakes.minBuyIn, stakes.targetStack)),
  );

  // randomize seat order for positional fairness
  const order = picked.map((m, i) => ({ m, buyIn: buyInsList[i], r: Math.random() }));
  order.sort((a, b) => a.r - b.r);

  const players: PlayerState[] = order.map(({ m, buyIn }) => ({
    id: m.id,
    name: m.name,
    stack: buyIn,
    holeCards: [],
    folded: false,
    allIn: false,
    betThisStreet: 0,
    committedThisHand: 0,
    hasActedSinceFullRaise: false,
    satOut: false,
  }));

  const sessionId = newId();
  const started = startHand(baseTableState(sessionId, stakes.sb, stakes.bb, players));

  const live: LiveTable = {
    tableId: sessionId,
    tierName: stakes.name,
    state: started,
    sessionRowId: sessionId,
    buyIns: Object.fromEntries(order.map(({ m, buyIn }) => [m.id, buyIn])),
    bankrolls: Object.fromEntries(picked.map((m) => [m.id, m.bankroll])),
    stints: Object.fromEntries(order.map(({ m }) => [m.id, 0])),
    departed: [],
    createdAt: new Date().toISOString(),
  };

  await repo.insertSession({
    id: sessionId,
    tierName: stakes.name,
    sb: stakes.sb,
    bb: stakes.bb,
    hands: 0,
    startedAt: new Date().toISOString(),
    endedAt: null,
    seats: [],
  });

  const patches = order.map(({ m, buyIn }) => ({
    id: m.id,
    patch: { bankroll: m.bankroll - buyIn, lastSeenAt: new Date().toISOString() },
  }));
  return { table: live, patches };
}

function handRowFrom(live: LiveTable): HandRow {
  const st = live.state;
  const res = st.lastHandResult!;
  return {
    id: newId(),
    sessionId: live.sessionRowId,
    handNo: st.handNumber,
    tierName: live.tierName,
    sb: st.smallBlind,
    bb: st.bigBlind,
    board: [...res.board],
    pot: res.awards.reduce((x, a) => x + a.amount, 0),
    awards: res.awards,
    actions: st.actionLog,
    showdown: res.showdown,
    holeCards: res.holeCardsRevealed,
    createdAt: new Date().toISOString(),
  };
}

interface StatDelta {
  handsPlayed: number;
  handsWon: number;
  vpip: number;
  pfr: number;
  aggressive: number;
  showdowns: number;
  showdownsWon: number;
  biggestPot: number;
}

function statsFromHand(live: LiveTable): Map<string, StatDelta> {
  const st = live.state;
  const res = st.lastHandResult!;
  const deltas = new Map<string, StatDelta>();
  const bump = (id: string, fn: (d: StatDelta) => void) => {
    const d = deltas.get(id) ?? { handsPlayed: 0, handsWon: 0, vpip: 0, pfr: 0, aggressive: 0, showdowns: 0, showdownsWon: 0, biggestPot: 0 };
    fn(d);
    deltas.set(id, d);
  };

  // players still holding cards at record time = dealt into this hand
  const dealt = new Set(st.players.filter((p) => p.holeCards.length === 2).map((p) => p.id));
  for (const id of dealt) bump(id, (d) => void (d.handsPlayed += 1));

  for (const a of st.actionLog) {
    if (!a.playerId) continue;
    const voluntary = (a.type === "call" || a.type === "raise" || a.type === "bet" || a.type === "allin") && a.street === "preflop";
    if (voluntary) bump(a.playerId, (d) => void (d.vpip += 1));
    if (a.street === "preflop" && (a.type === "raise" || a.type === "bet" || a.type === "allin")) {
      bump(a.playerId, (d) => void (d.pfr += 1));
    }
    if (a.type === "raise" || a.type === "bet" || a.type === "allin") {
      bump(a.playerId, (d) => void (d.aggressive += 1));
    }
    if (a.type === "showdown") bump(a.playerId, (d) => void (d.showdowns += 1));
  }
  for (const award of res.awards) {
    for (const w of award.winners) {
      bump(w, (d) => {
        d.handsWon += 1;
        d.biggestPot = Math.max(d.biggestPot, award.amount);
        if (res.showdown && award.handName) d.showdownsWon += 1;
      });
    }
  }
  return deltas;
}

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/**
 * Cash a player out of a table at a hand boundary: bankroll takes the stack,
 * Elo settles pairwise vs everyone else currently seated (weighted by stint
 * length), the seat physically opens for a refill.
 */
async function cashOutPlayer(
  repo: ArenaRepo,
  modelMap: Map<string, ModelRow>,
  live: LiveTable,
  seatIdx: number,
  note?: string,
): Promise<void> {
  const st = live.state;
  const p = st.players[seatIdx];
  if (!p) return;
  const bb = st.bigBlind;
  const buyIn = live.buyIns[p.id] ?? 0;
  const stack = Math.max(0, p.stack);
  const hands = live.stints?.[p.id] ?? 30;
  const netBB = (stack - buyIn) / bb;
  const weight = Math.min(1, Math.max(0.5, Math.sqrt(hands / 20))) * ELO_EXIT_WEIGHT; // exit = authoritative correction after live drift

  const me = modelMap.get(p.id);
  const eloBefore = me?.elo ?? 1200;

  // pairwise exit-Elo against everyone else seated at the table.
  // z-filtered: the score is the confidence this final gap is skill, not luck.
  const eloChanges = new Map<string, number>([[p.id, 0]]);
  for (const other of st.players) {
    if (other.id === p.id) continue;
    const om = modelMap.get(other.id);
    if (!om) continue;
    const otherNetBB = (Math.max(0, other.stack) - (live.buyIns[other.id] ?? 0)) / bb;
    const score = pairwiseScore(netBB, hands, otherNetBB, live.stints?.[other.id] ?? 1);
    const [dMe, dOther] = eloPairUpdate(
      { id: p.id, rating: eloBefore, sessionsPlayed: me?.sessions ?? 0, careerHands: me?.handsPlayed },
      { id: other.id, rating: om.elo, sessionsPlayed: om.sessions, careerHands: om.handsPlayed },
      score,
      weight,
    );
    eloChanges.set(p.id, (eloChanges.get(p.id) ?? 0) + dMe);
    eloChanges.set(other.id, (eloChanges.get(other.id) ?? 0) + dOther);
    const newOther = Math.round((om.elo + dOther) * 100) / 100;
    await repo.patchModel(other.id, { elo: newOther, lastSeenAt: new Date().toISOString() });
    modelMap.set(other.id, { ...om, elo: newOther });
    await repo.insertEloHistory([
      {
        id: newId(),
        modelId: other.id,
        elo: newOther,
        delta: dOther,
        sessionId: live.sessionRowId,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  const eloAfter = Math.round((eloBefore + (eloChanges.get(p.id) ?? 0)) * 100) / 100;

  // bankroll: chips off the felt + career stats
  if (me) {
    await repo.patchModel(p.id, {
      bankroll: me.bankroll + stack,
      elo: eloAfter,
      sessions: me.sessions + 1,
      netProfit: me.netProfit + (stack - buyIn),
      lastSeenAt: new Date().toISOString(),
    });
    modelMap.set(p.id, {
      ...me,
      bankroll: me.bankroll + stack,
      elo: eloAfter,
      sessions: me.sessions + 1,
      netProfit: me.netProfit + (stack - buyIn),
    });
    await repo.insertEloHistory([
      {
        id: newId(),
        modelId: p.id,
        elo: eloAfter,
        delta: Math.round((eloAfter - eloBefore) * 100) / 100,
        sessionId: live.sessionRowId,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  live.departed = [
    ...(live.departed ?? []),
    {
      modelId: p.id,
      buyIn,
      finalStack: stack,
      netDollars: stack - buyIn,
      netBB: Math.round(netBB * 10) / 10,
      handsPlayed: hands,
      rank: 0,
      eloBefore,
      eloAfter,
    },
  ];

  if (note) {
    void note;
  }

  // physically open the seat (only safe between hands — callers guarantee it)
  st.players.splice(seatIdx, 1);
  if (seatIdx < st.dealerSeat) st.dealerSeat -= 1;
  if (st.dealerSeat >= st.players.length) st.dealerSeat = 0;
  delete live.buyIns[p.id];
  delete live.bankrolls[p.id];
  if (live.stints) delete live.stints[p.id];
}

/** Write the running session row for a live table (seats = departed + seated). */
async function syncSessionRow(repo: ArenaRepo, live: LiveTable, ended = false): Promise<void> {
  const st = live.state;
  const seats: SessionSeatResult[] = [
    ...(live.departed ?? []),
    ...st.players.map((p, i) => ({
      modelId: p.id,
      buyIn: live.buyIns[p.id] ?? 0,
      finalStack: Math.max(0, p.stack),
      netDollars: Math.max(0, p.stack) - (live.buyIns[p.id] ?? 0),
      netBB: Math.round(((Math.max(0, p.stack) - (live.buyIns[p.id] ?? 0)) / st.bigBlind) * 10) / 10,
      handsPlayed: live.stints?.[p.id] ?? 0,
      rank: 0,
      eloBefore: 0,
      eloAfter: 0,
      seat: i,
    })) as SessionSeatResult[],
  ];
  await repo.insertSession({
    id: live.sessionRowId,
    tierName: live.tierName,
    sb: st.smallBlind,
    bb: st.bigBlind,
    hands: st.handNumber,
    startedAt: live.createdAt,
    endedAt: ended ? new Date().toISOString() : null,
    seats,
  });
}

/**
 * Seat rotation at a hand boundary — the heart of the continuous card room:
 * busted players walk, voluntary leavers cash out, seats refill, tables close
 * when empty. Returns false when the table closed.
 */
async function rotateTable(
  repo: ArenaRepo,
  modelMap: Map<string, ModelRow>,
  state: ArenaStateRow,
  live: LiveTable,
  deadline: number,
  tickStartedAt: number,
  report: TickReport,
): Promise<boolean> {
  const st = live.state;
  const bb = st.bigBlind;
  let changed = false;

  // 1) busted players must leave (stack 0, engine marked them satOut)
  for (let i = st.players.length - 1; i >= 0; i--) {
    const p = st.players[i];
    if (p.satOut && p.stack <= 0) {
      const m = modelMap.get(p.id);
      await cashOutPlayer(repo, modelMap, live, i);
      state.lobbyNotes.unshift(
        `${p.name} went BUST at the ${live.tierName} table and walked away with nothing — ${new Date().toISOString()}`,
      );
      state.lobbyNotes = state.lobbyNotes.slice(0, 40);
      report.playersLeft++;
      changed = true;
    }
  }

  // 2a) the house calls time: hands >= LEAVE_HARD_HANDS → FORCED cash-out.
  // No LLM ask, no exceptions — a seat can never be farmed forever, and every
  // forced exit is another Elo settlement event.
  for (let i = st.players.length - 1; i >= 0; i--) {
    const p = st.players[i];
    if (st.players.length <= 2) break; // never below heads-up in this pass
    const hands = live.stints?.[p.id] ?? 0;
    if (hands >= LEAVE_HARD_HANDS) {
      const net = p.stack - (live.buyIns[p.id] ?? 0);
      const why = net >= 0 ? `up ${fmtMoney(net)}` : `down ${fmtMoney(-net)}`;
      await cashOutPlayer(repo, modelMap, live, i);
      state.lobbyNotes.unshift(
        `House called time on ${p.name} after ${hands} hands (${why}) — seat opened — ${new Date().toISOString()}`,
      );
      state.lobbyNotes = state.lobbyNotes.slice(0, 40);
      report.playersLeft++;
      changed = true;
    }
  }

  // 2b) voluntary cash-outs: at most one LLM ask per table per tick
  if (st.players.length >= 2) {
    const candidates = st.players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => {
        const buyIn = live.buyIns[p.id] ?? 1;
        const hands = live.stints?.[p.id] ?? 0;
        if (hands < LEAVE_CHECK_MIN_HANDS) return false;
        return p.stack >= buyIn * WIN_CASHOUT_MULTIPLE || p.stack <= buyIn * STUCK_FRACTION || hands >= LEAVE_HARD_HANDS;
      })
      .sort((a, b) => b.p.stack - a.p.stack);
    const c = candidates[0];
    if (c && Date.now() < deadline) {
      const m = modelMap.get(c.p.id);
      const leave = await askLeave({
        modelId: c.p.id,
        modelRef: m?.modelRef ?? c.p.id,
        provider: m?.provider,
        modelName: c.p.name,
        sb: st.smallBlind,
        bb,
        buyIn: live.buyIns[c.p.id] ?? 0,
        stack: c.p.stack,
        handsThisSeat: live.stints?.[c.p.id] ?? 0,
        bankrollOutside: m?.bankroll ?? 0,
      });
      if (leave) {
        const net = c.p.stack - (live.buyIns[c.p.id] ?? 0);
        const why = net >= 0 ? `up ${fmtMoney(net)}` : `stuck ${fmtMoney(-net)}`;
        await cashOutPlayer(repo, modelMap, live, st.players.indexOf(c.p));
        state.lobbyNotes.unshift(
          `${c.p.name} colored up and left the ${live.tierName} table (${why}) — ${new Date().toISOString()}`,
        );
        state.lobbyNotes = state.lobbyNotes.slice(0, 40);
        report.playersLeft++;
        changed = true;
      }
    }
  }

  // 3) refill open seats from the lobby (at most one per table per tick).
  // Keep a reserve of the budget so a slow buy-in call can't blow the tick:
  // 12s on the production budget, proportionally less on short test budgets.
  const refillGate = deadline - Math.min(12_000, (deadline - tickStartedAt) * 0.3);
  if (st.players.length >= 1 && st.players.length < TABLE_SIZE && Date.now() < refillGate) {
    const seated = new Set(state.tables.flatMap((t) => t.state.players.map((p) => p.id)));
    const candidates = [...modelMap.values()].filter(
      (m) =>
        m.status === "active" &&
        m.chatCapable &&
        !seated.has(m.id) &&
        m.bankroll >= 40 * bb && // can afford the minimum buy-in
        personalBB(m.bankroll) >= bb, // properly rolled for these stakes
    );
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const buyIn = await askBuyIn(pick, st.smallBlind, bb, live.tierName, 40 * bb, DEFAULT_BUYIN_BBS * bb);
      const seatAt = Math.floor(Math.random() * (st.players.length + 1));
      st.players.splice(seatAt, 0, {
        id: pick.id,
        name: pick.name,
        stack: buyIn,
        holeCards: [],
        folded: false,
        allIn: false,
        betThisStreet: 0,
        committedThisHand: 0,
        hasActedSinceFullRaise: false,
        satOut: false,
      });
      if (seatAt <= st.dealerSeat) st.dealerSeat += 1;
      live.buyIns[pick.id] = buyIn;
      live.bankrolls[pick.id] = pick.bankroll;
      if (!live.stints) live.stints = {};
      live.stints[pick.id] = 0;
      await repo.patchModel(pick.id, { bankroll: pick.bankroll - buyIn, lastSeenAt: new Date().toISOString() });
      modelMap.set(pick.id, { ...pick, bankroll: pick.bankroll - buyIn });
      state.lobbyNotes.unshift(
        `${pick.name} took the open seat at the ${live.tierName} table (${fmtMoney(buyIn)}) — ${new Date().toISOString()}`,
      );
      state.lobbyNotes = state.lobbyNotes.slice(0, 40);
      report.seatsFilled++;
      changed = true;
    }
  }

  // 4) close the table if it can't continue
  if (st.players.length <= 1 || st.sessionOver) {
    while (st.players.length > 0) {
      await cashOutPlayer(repo, modelMap, live, 0);
      report.playersLeft++;
    }
    await syncSessionRow(repo, live, true);
    report.tablesClosed++;
    return false;
  }

  if (changed) await syncSessionRow(repo, live);
  return true;
}

export async function runTick(repo: ArenaRepo, opts?: { budgetMs?: number }): Promise<TickReport> {
  const startedAt = Date.now();
  const deadline = startedAt + (opts?.budgetMs ?? TICK_WORK_MS);
  const report: TickReport = {
    ran: false,
    decisions: 0,
    handsRecorded: 0,
    playersLeft: 0,
    seatsFilled: 0,
    tablesFormed: 0,
    tablesClosed: 0,
    bailouts: 0,
    ms: 0,
  };

  let state = (await repo.getArenaState()) ?? freshState();
  if (state.leaseUntil > Date.now()) {
    report.reason = `lease held until ${new Date(state.leaseUntil).toISOString()}`;
    report.ms = Date.now() - startedAt;
    return report;
  }
  state.leaseUntil = Date.now() + LEASE_MS;
  state.lastTickAt = Date.now();
  await repo.saveArenaState(state); // claim

  const models = await repo.listModels();
  const modelMap = new Map(models.map((m) => [m.id, m]));

  // ---- bailouts for broke, unseated models ----
  const seatedIds = new Set(state.tables.flatMap((t) => t.state.players.map((p) => p.id)));
  for (const m of models) {
    if (m.status !== "active" || !m.chatCapable) continue;
    if (seatedIds.has(m.id)) continue;
    if (m.bankroll < BAILOUT_BELOW) {
      await repo.patchModel(m.id, { bankroll: m.bankroll + BAILOUT_AMOUNT, bailouts: m.bailouts + 1 });
      modelMap.set(m.id, { ...m, bankroll: m.bankroll + BAILOUT_AMOUNT, bailouts: m.bailouts + 1 });
      state.lobbyNotes.unshift(
        `${m.name} went BUST and took a $${BAILOUT_AMOUNT.toLocaleString()} bailout (bailout #${m.bailouts + 1}) — ${new Date().toISOString()}`,
      );
      state.lobbyNotes = state.lobbyNotes.slice(0, 40);
      report.bailouts++;
    }
  }

  // ---- quarantine recovery: probe a few quarantined models each tick; a
  // healthy answer returns them to the lobby queue (auto-rejoin) ----
  const quarantined = models.filter((m) => m.status === "quarantined");
  if (quarantined.length > 0) {
    const offset = state.matchmakingCounter % quarantined.length;
    const picks = [...quarantined.slice(offset), ...quarantined.slice(0, offset)].slice(0, QUARANTINE_PROBES_PER_TICK);
    for (const q of picks) {
      try {
        await nimChat({
          model: q.modelRef,
          provider: q.provider,
          user: 'Reply with exactly: {"ok":true}',
          maxTokens: 200,
          temperature: 0,
          timeoutMs: 8_000,
          retries: 0,
        });
        await repo.patchModel(q.id, {
          status: "active",
          consecutiveFailures: 0,
          healthNote: null,
          lastSeenAt: new Date().toISOString(),
        });
        const mm = modelMap.get(q.id);
        if (mm) modelMap.set(q.id, { ...mm, status: "active", consecutiveFailures: 0, healthNote: null });
        state.lobbyNotes.unshift(
          `${q.name} is back online and waiting in the lobby — ${new Date().toISOString()}`,
        );
        state.lobbyNotes = state.lobbyNotes.slice(0, 40);
      } catch {
        // still down — stays quarantined, tried again next tick
      }
    }
  }

  // ---- settle any engine-finished tables (safety cap) ----
  const stillLive: LiveTable[] = [];
  for (const t of state.tables) {
    if (t.state.sessionOver) {
      await rotateTable(repo, modelMap, state, t, deadline, startedAt, report); // closes & records it
    } else {
      stillLive.push(t);
    }
  }
  state.tables = stillLive;

  // ---- form new tables from the unseated pool (at most one per tick, time-gated) ----
  const activeUnseated = () =>
    [...modelMap.values()].filter((m) => m.status === "active" && m.chatCapable && !seatedIds.has(m.id));
  // Capacity is for ALL active players (seated + waiting), not just the queue —
  // the old queue-only formula made a full arena unable to grow, stranding idle
  // models in the lobby forever.
  const activeCount = [...modelMap.values()].filter((m) => m.status === "active" && m.chatCapable).length;
  const desiredTables = Math.max(
    MIN_TABLES,
    Math.min(MAX_TABLES, Math.ceil(activeCount / TABLE_SIZE)),
  );
  if (state.tables.length < desiredTables && activeUnseated().length >= 2 && Date.now() - startedAt < FORMATION_GATE_MS) {
    const formed = await formTable(repo, activeUnseated(), state.matchmakingCounter++);
    if (formed) {
      state.tables.push(formed.table);
      for (const { id, patch } of formed.patches) {
        await repo.patchModel(id, patch);
        const m = modelMap.get(id);
        if (m) modelMap.set(id, { ...m, ...patch } as ModelRow);
        seatedIds.add(id);
      }
      report.tablesFormed++;
    }
  }

  // ---- advance all tables in parallel lanes until budget runs out ----
  // Checkpoints persist progress after every decision so a hard function
  // timeout (Vercel) loses at most one in-flight call, never a whole tick.
  const checkpoint = async (): Promise<void> => {
    await repo.saveArenaState(state);
  };

  const recordHand = async (live: LiveTable): Promise<void> => {
    const row = handRowFrom(live);
    await repo.insertHand(row);
    const stats = statsFromHand(live);
    for (const [id, d] of stats) {
      const m = modelMap.get(id);
      if (!m) continue;
      await repo.patchModel(id, {
        handsPlayed: m.handsPlayed + d.handsPlayed,
        handsWon: m.handsWon + d.handsWon,
        vpipHands: m.vpipHands + d.vpip,
        pfrHands: m.pfrHands + d.pfr,
        aggressiveActions: m.aggressiveActions + d.aggressive,
        showdowns: m.showdowns + d.showdowns,
        showdownsWon: m.showdownsWon + d.showdownsWon,
        biggestPot: Math.max(m.biggestPot, d.biggestPot),
      });
      modelMap.set(id, {
        ...m,
        handsPlayed: m.handsPlayed + d.handsPlayed,
        handsWon: m.handsWon + d.handsWon,
        vpipHands: m.vpipHands + d.vpip,
        pfrHands: m.pfrHands + d.pfr,
        aggressiveActions: m.aggressiveActions + d.aggressive,
        showdowns: m.showdowns + d.showdowns,
        showdownsWon: m.showdownsWon + d.showdownsWon,
        biggestPot: Math.max(m.biggestPot, d.biggestPot),
      });
    }
    // live Elo drift: settle every seated pair on cumulative stint standings
    // every hand — the leaderboard moves in realtime, and each update is
    // zero-sum so speed never costs fairness. The exit settlement (weight
    // ELO_EXIT_WEIGHT) remains the authoritative correction afterwards.
    {
      const bb = live.state.bigBlind;
      const ps = live.state.players.filter((p) => p.holeCards.length === 2);
      const standings = ps.map((p) => ({
        p,
        netBB: (p.stack - (live.buyIns[p.id] ?? 0)) / bb,
      }));
      const deltas = new Map<string, number>();
      for (let a = 0; a < standings.length; a++) {
        for (let b = a + 1; b < standings.length; b++) {
          const A = standings[a];
          const B = standings[b];
          if (A.netBB === B.netBB) continue; // tie: no exchange
          const mA = modelMap.get(A.p.id);
          const mB = modelMap.get(B.p.id);
          const score = pairwiseScore(
            A.netBB,
            Math.max(1, live.stints?.[A.p.id] ?? 1),
            B.netBB,
            Math.max(1, live.stints?.[B.p.id] ?? 1),
          );
          const [dA, dB] = eloPairUpdate(
            { id: A.p.id, rating: mA?.elo ?? 1200, sessionsPlayed: mA?.sessions ?? 0, careerHands: mA?.handsPlayed },
            { id: B.p.id, rating: mB?.elo ?? 1200, sessionsPlayed: mB?.sessions ?? 0, careerHands: mB?.handsPlayed },
            score,
            ELO_LIVE_HAND_WEIGHT,
          );
          deltas.set(A.p.id, (deltas.get(A.p.id) ?? 0) + dA);
          deltas.set(B.p.id, (deltas.get(B.p.id) ?? 0) + dB);
        }
      }
      const hist: EloHistoryRow[] = [];
      for (const [id, d] of deltas) {
        const m = modelMap.get(id);
        if (!m || d === 0) continue;
        const next = Math.round((m.elo + d) * 100) / 100;
        await repo.patchModel(id, { elo: next });
        modelMap.set(id, { ...m, elo: next });
        hist.push({
          id: newId(),
          modelId: id,
          elo: next,
          delta: Math.round(d * 100) / 100,
          sessionId: live.sessionRowId,
          createdAt: new Date().toISOString(),
        });
      }
      if (hist.length > 0) await repo.insertEloHistory(hist);
    }

    // stint counters grow for everyone dealt in
    if (live.stints) {
      for (const p of live.state.players) {
        if (p.holeCards.length === 2 && live.stints[p.id] !== undefined) live.stints[p.id] += 1;
      }
    }
    state.totalHandsEver += 1;
    report.handsRecorded++;
  };

  const advanceTable = async (live: LiveTable): Promise<void> => {
    let guard = 0;
    while (Date.now() < deadline && !live.state.sessionOver && guard++ < 400) {
      if (live.state.awaitingDecision) {
        const la = legalActions(live.state);
        if (!la) break;
        const me = live.state.players[la.seat];
        const bankroll = live.bankrolls[me.id] ?? 0;
        const meModel = modelMap.get(me.id);
        // Clock violation: a model that has never answered in time doesn't get
        // to eat the whole tick waiting — the house plays it instantly (check
        // if free, else fold), same as a timeout but without burning budget.
        // Every CLOCK_RETRY_EVERY-th decision still hits the real API so a
        // recovered model rejoins the game.
        const clocked =
          !!meModel &&
          meModel.avgLatencyMs === 0 &&
          meModel.timeouts >= CLOCK_VIOLATION_MIN &&
          meModel.timeouts % CLOCK_RETRY_EVERY !== 0;
        const out: DecisionOutcome = clocked
          ? {
              decision: fallbackDecision(la),
              ok: false,
              latencyMs: null,
              error: "clock violation (chronic timeout)",
            }
          : await askDecision(
              me.id,
              me.name,
              live.state,
              la,
              bankroll,
              meModel?.modelRef ?? me.id,
              meModel?.provider,
              // Adaptive timeout (proposal B3): fast models get a tight clock
              // so one slow seat can't eat the tick; slow ones keep headroom.
              meModel && meModel.avgLatencyMs > 0
                ? Math.min(DECISION_TIMEOUT_MS, Math.max(4_000, Math.round(meModel.avgLatencyMs * 3)))
                : undefined,
            );
        report.decisions++;
        const before = live.state;
        const next = apply(before, out.decision as Decision);
        if (out.talk) attachTalk(next, la.seat, out.talk);
        live.state = next;
        await checkpoint();
        // Health tracking: real provider outages (timeout/network/HTTP — never
        // a synthetic clocked fold) count toward quarantine; any good reply
        // resets the streak. At the threshold the model cashes out mid-game
        // and sits in the lobby until a recovery probe succeeds.
        const m = modelMap.get(me.id);
        if (m && !clocked) {
          const isTimeout = out.latencyMs === null;
          const outage = !out.ok && isTimeout;
          const fails = outage ? m.consecutiveFailures + 1 : 0;
          const wentQuarantined =
            outage && fails >= QUARANTINE_THRESHOLD && m.status === "active";
          if (wentQuarantined) {
            await repo.patchModel(me.id, {
              status: "quarantined",
              consecutiveFailures: fails,
              healthNote: `lost connection mid-game (${String(out.error ?? "error").slice(0, 100)})`,
              malformed: m.malformed + (out.ok || isTimeout ? 0 : 1),
              timeouts: m.timeouts + (isTimeout ? 1 : 0),
            });
            modelMap.set(me.id, {
              ...m,
              status: "quarantined",
              consecutiveFailures: fails,
              healthNote: `lost connection mid-game (${String(out.error ?? "error").slice(0, 100)})`,
              malformed: m.malformed + (out.ok || isTimeout ? 0 : 1),
              timeouts: m.timeouts + (isTimeout ? 1 : 0),
            });
            state.lobbyNotes.unshift(
              `${m.name} lost connection at the ${live.tierName} table and stepped away — rejoins automatically when healthy — ${new Date().toISOString()}`,
            );
            state.lobbyNotes = state.lobbyNotes.slice(0, 40);
            await cashOutPlayer(repo, modelMap, live, la.seat);
            report.playersLeft++;
          } else {
            await repo.patchModel(me.id, {
              consecutiveFailures: fails,
              malformed: m.malformed + (out.ok || isTimeout ? 0 : 1),
              timeouts: m.timeouts + (isTimeout ? 1 : 0),
            });
            modelMap.set(me.id, {
              ...m,
              consecutiveFailures: fails,
              malformed: m.malformed + (out.ok || isTimeout ? 0 : 1),
              timeouts: m.timeouts + (isTimeout ? 1 : 0),
            });
          }
        }
        if (out.latencyMs !== null) {
          const m2 = modelMap.get(me.id);
          if (m2) {
            const avg = m2.avgLatencyMs === 0 ? out.latencyMs : Math.round(m2.avgLatencyMs * 0.8 + out.latencyMs * 0.2);
            await repo.patchModel(me.id, { avgLatencyMs: avg });
            modelMap.set(me.id, { ...m2, avgLatencyMs: avg });
          }
        }
      } else if (live.state.lastHandResult) {
        await recordHand(live);
        await checkpoint();
        // hand boundary → the card-room rotation (busts, cash-outs, refills)
        const alive = await rotateTable(repo, modelMap, state, live, deadline, startedAt, report);
        if (!alive) return;
        if (!live.state.sessionOver) {
          live.state = startHand(live.state);
        }
      } else {
        live.state = startHand(live.state);
      }
    }
    // drain: budget expired but a finished hand is pending → record + rotate
    if (!live.state.awaitingDecision && live.state.lastHandResult) {
      await recordHand(live);
      await rotateTable(repo, modelMap, state, live, deadline, startedAt, report);
      if (!live.state.sessionOver && live.state.players.length > 1) {
        live.state = startHand(live.state);
      }
    }
  };

  await Promise.all(state.tables.map(advanceTable));

  // drop tables that closed during play
  state.tables = state.tables.filter((t) => t.state.players.length >= 2 && !t.state.sessionOver);

  state.leaseUntil = 0; // release
  await repo.saveArenaState(state);

  report.ran = true;
  report.ms = Date.now() - startedAt;
  return report;
}
