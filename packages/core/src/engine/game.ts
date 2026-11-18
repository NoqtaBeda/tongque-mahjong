import { KIND_COUNT, emptyHand, isNumberKind } from '../tiles.ts';
import type { Hand } from '../tiles.ts';
import { activeKinds, seatWindOf } from '../config.ts';
import type { RuleConfig } from '../config.ts';
import { evaluateWin } from '../evaluate.ts';
import { handGroups } from './groups.ts';
import type { WinFlags } from '../detect.ts';
import type {
  Action,
  ClaimWindow,
  GameState,
  Observation,
  RoundRecord,
  RoundResult,
  ScoringEntry,
  Seat,
  YakuRecord,
} from './types.ts';

// ---------------------------------------------------------------- 随机与洗牌

function nextRandom(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

function buildWall(
  cfg: RuleConfig,
  seed: number,
): { wall: number[]; rngState: number } {
  const active = activeKinds(cfg);
  const wall: number[] = [];
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (active[kind] === 0) continue;
    for (let copy = 0; copy < 4; copy += 1) wall.push(kind);
  }
  let rngState = seed | 0;
  for (let index = wall.length - 1; index > 0; index -= 1) {
    const step = nextRandom(rngState);
    rngState = step.state;
    const swap = Math.floor(step.value * (index + 1));
    const tmp = wall[index];
    wall[index] = wall[swap];
    wall[swap] = tmp;
  }
  return { wall, rngState };
}

// ---------------------------------------------------------------- 开局

export function startRound(
  cfg: RuleConfig,
  scores: readonly number[],
  round: number,
  seed: number,
): GameState {
  const { wall, rngState } = buildWall(cfg, seed);
  const players = cfg.players;
  const hands: Hand[] = [];
  for (let seat = 0; seat < players; seat += 1) hands.push(emptyHand());

  let drawIndex = 0;
  for (let pass = 0; pass < 13; pass += 1) {
    for (let seat = 0; seat < players; seat += 1) {
      hands[seat][wall[drawIndex]] += 1;
      drawIndex += 1;
    }
  }

  const dealer = round % players;
  const dealerExtra = wall[drawIndex];
  drawIndex += 1;
  hands[dealer][dealerExtra] += 1;

  const liveEnd = Math.max(
    drawIndex,
    wall.length - (cfg.keepDeadWall ? 14 : 0),
  );

  return {
    cfg,
    rngState,
    round,
    dealer,
    phase: 'discard',
    actor: dealer,
    hands,
    melds: hands.map(() => []),
    discards: hands.map(() => []),
    tsumogiri: hands.map(() => []),
    scores: [...scores],
    wall,
    drawIndex,
    liveEnd,
    deadCursor: liveEnd,
    kanCounts: new Array<number>(players).fill(0),
    drawCounts: new Array<number>(players).fill(0),
    turnIndex: 0,
    lastDiscard: null,
    claim: null,
    result: null,
    drawnTile: dealerExtra,
    rinshan: false,
    finished: false,
    bestWin: null,
    history: [],
  };
}

export function createGame(cfg: RuleConfig, seed = 1): GameState {
  return startRound(cfg, new Array<number>(cfg.players).fill(0), 0, seed);
}

// ---------------------------------------------------------------- 查询

export function windOf(state: GameState, seat: Seat): number {
  return seatWindOf(state.cfg, state.round, seat);
}

export function wallRemaining(state: GameState): number {
  return Math.max(0, state.liveEnd - state.drawIndex);
}

function clone(state: GameState): GameState {
  return {
    ...state,
    hands: state.hands.map((hand) => hand.slice()),
    melds: state.melds.map((melds) => melds.slice()),
    discards: state.discards.map((river) => river.slice()),
    tsumogiri: state.tsumogiri.map((river) => river.slice()),
    scores: state.scores.slice(),
    kanCounts: state.kanCounts.slice(),
    drawCounts: state.drawCounts.slice(),
    claim:
      state.claim === null
        ? null
        : {
            ...state.claim,
            pending: state.claim.pending.slice(),
            responses: state.claim.responses.slice(),
          },
  };
}

function hasAnyMeld(state: GameState): boolean {
  return state.melds.some((melds) => melds.length > 0);
}

function winFlags(state: GameState, seat: Seat, isTsumo: boolean): WinFlags {
  const flags: WinFlags = {};
  const remaining = state.liveEnd - state.drawIndex;
  if (isTsumo) {
    if (state.rinshan) flags.rinshan = true;
    if (remaining === 0) flags.haitei = true;
    if (state.turnIndex === 0 && seat === state.dealer) flags.tenhou = true;
    if (
      seat !== state.dealer &&
      state.drawCounts[seat] === 1 &&
      !hasAnyMeld(state)
    ) {
      flags.chiihou = true;
    }
  } else {
    if (state.claim !== null && state.claim.robKan) flags.chankan = true;
    if (remaining === 0) flags.houtei = true;
  }
  return flags;
}

function canRon(
  state: GameState,
  seat: Seat,
  tile: number,
  chankan: boolean,
): boolean {
  const hand = state.hands[seat].slice();
  if (hand[tile] >= 4) return false;
  hand[tile] += 1;
  const flags: WinFlags = {};
  if (chankan) flags.chankan = true;
  if (state.liveEnd - state.drawIndex === 0) flags.houtei = true;
  const result = evaluateWin({
    concealed: hand,
    melds: state.melds[seat],
    cfg: state.cfg,
    winTile: tile,
    isTsumo: false,
    seatWind: windOf(state, seat),
    flags,
  });
  return result.isWin && result.ronAllowed;
}

function chiOptions(hand: Hand, tile: number): Array<[number, number]> {
  if (!isNumberKind(tile)) return [];
  const suit = Math.floor(tile / 9);
  const options: Array<[number, number]> = [];
  const candidates: ReadonlyArray<readonly [number, number]> = [
    [tile - 2, tile - 1],
    [tile - 1, tile + 1],
    [tile + 1, tile + 2],
  ];
  for (const [a, b] of candidates) {
    if (a < 0 || b >= KIND_COUNT) continue;
    // 必须同花色，避免跨花色凑顺子
    if (Math.floor(a / 9) !== suit || Math.floor(b / 9) !== suit) continue;
    if (hand[a] > 0 && hand[b] > 0) options.push([a, b]);
  }
  return options;
}

function canChi(
  state: GameState,
  seat: Seat,
  tile: number,
  from: Seat,
): boolean {
  if (!state.cfg.allowChi) return false;
  if (seat !== (from + 1) % state.cfg.players) return false;
  return chiOptions(state.hands[seat], tile).length > 0;
}

function hasAnyClaim(
  state: GameState,
  seat: Seat,
  tile: number,
  from: Seat,
): boolean {
  if (canRon(state, seat, tile, false)) return true;
  if (state.hands[seat][tile] >= 2) return true;
  return canChi(state, seat, tile, from);
}

// ---------------------------------------------------------------- 合法动作

export function legalActions(state: GameState, seat: Seat): Action[] {
  if (state.phase === 'over') {
    return state.finished ? [] : [{ type: 'next-round' }];
  }
  if (state.actor !== seat) return [];
  if (state.phase === 'claim') return claimActions(state, seat);
  return discardActions(state, seat);
}

function discardActions(state: GameState, seat: Seat): Action[] {
  const actions: Action[] = [];
  const hand = state.hands[seat];
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (hand[kind] > 0) actions.push({ type: 'discard', tile: kind });
  }

  if (state.drawnTile !== null) {
    const result = evaluateWin({
      concealed: hand,
      melds: state.melds[seat],
      cfg: state.cfg,
      winTile: state.drawnTile,
      isTsumo: true,
      seatWind: windOf(state, seat),
      flags: winFlags(state, seat, true),
    });
    if (result.isWin && result.best !== null) actions.push({ type: 'tsumo' });
  }

  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (hand[kind] === 4) actions.push({ type: 'ankan', tile: kind });
  }
  for (const meld of state.melds[seat]) {
    if (meld.kind === 'pon' && hand[meld.tiles[0]] > 0) {
      actions.push({ type: 'kakan', tile: meld.tiles[0] });
    }
  }
  return actions;
}

function claimActions(state: GameState, seat: Seat): Action[] {
  const claim = state.claim;
  if (claim === null) return [];
  const actions: Action[] = [{ type: 'pass' }];
  const tile = claim.tile;

  if (canRon(state, seat, tile, claim.robKan)) actions.push({ type: 'ron' });

  if (!claim.robKan) {
    if (state.hands[seat][tile] >= 2) actions.push({ type: 'pon' });
    if (state.hands[seat][tile] >= 3) actions.push({ type: 'kan' });
    // 吃只能吃上家的舍牌。碰/杠没有这个限制，但窗口一旦为别人打开，
    // 这里也必须自己再判一次来源，否则会把非上家的牌也列成可吃。
    if (canChi(state, seat, tile, claim.from)) {
      for (const pair of chiOptions(state.hands[seat], tile)) {
        actions.push({ type: 'chi', tiles: pair });
      }
    }
  }
  return actions;
}

// ---------------------------------------------------------------- 观察

export function observe(state: GameState, seat: Seat): Observation {
  return {
    cfg: state.cfg,
    round: state.round,
    dealer: state.dealer,
    seat,
    seatWind: windOf(state, seat),
    phase: state.phase,
    isActor: state.actor === seat,
    hand: state.hands[seat].slice(),
    melds: state.melds,
    discards: state.discards,
    tsumogiri: state.tsumogiri,
    scores: state.scores,
    wallRemaining: wallRemaining(state),
    lastDiscard: state.lastDiscard,
    claim:
      state.claim === null
        ? null
        : { tile: state.claim.tile, from: state.claim.from },
    drawnTile: state.actor === seat ? state.drawnTile : null,
    legal: legalActions(state, seat),
  };
}

// ---------------------------------------------------------------- 状态迁移

function yakuRecords(entry: ScoringEntry): YakuRecord[] {
  const slot = entry.result.liabilitySlot;
  return entry.result.hits.map((hit) => ({
    name: hit.name,
    points: hit.points,
    liable:
      entry.result.liability > 0 &&
      (hit.liability === 'always' ||
        (hit.liability === 'by-meld' && (hit.meldMask & slot) !== 0)),
  }));
}

function finishRound(state: GameState, result: RoundResult): void {
  state.result = result;
  state.phase = 'over';
  state.actor = null;
  state.claim = null;
  state.drawnTile = null;
  state.rinshan = false;
  state.finished = state.round + 1 >= state.cfg.rounds;

  // 整场里分值最高的那次和牌，终局页面用来回顾（并列时保留先出现的）
  let best = state.bestWin;
  for (const entry of result.entries) {
    if (best !== null && entry.gain <= best.gain) continue;

    best = {
      seat: entry.seat,
      round: state.round,
      kind: result.kind === 'tsumo' ? 'tsumo' : 'ron',
      gain: entry.gain,
      rawSum: entry.result.rawSum,
      winTile: entry.winTile,
      groups: entry.groups,
      yaku: yakuRecords(entry),
    };
  }
  state.bestWin = best;

  // 对局记录：每局一条，流局也要记。累计分由本局的增减反推，避免再多存一份状态。
  const scoresAfter = [...state.scores];
  const delta = new Array<number>(state.cfg.players).fill(0);
  for (const entry of result.entries) delta[entry.seat] += entry.gain;
  if (result.discarder !== null) {
    let penalty = 0;
    for (const entry of result.entries) penalty += entry.penalty;
    delta[result.discarder] -= penalty;
  }
  const scoresBefore = scoresAfter.map((score, seat) => score - delta[seat]);

  const record: RoundRecord = {
    round: state.round,
    kind: result.kind,
    entries: result.entries.map((entry) => ({
      seat: entry.seat,
      gain: entry.gain,
      winTile: entry.winTile,
      groups: entry.groups,
      yaku: yakuRecords(entry),
      penalty: entry.penalty,
      discarder: result.discarder,
    })),
    scoresBefore,
    scoresAfter,
  };
  state.history = [...state.history, record];
}

function drawFor(state: GameState, seat: Seat): void {
  if (state.drawIndex >= state.liveEnd) {
    finishRound(state, { kind: 'draw', entries: [], discarder: null });
    return;
  }
  const tile = state.wall[state.drawIndex];
  state.drawIndex += 1;
  state.hands[seat][tile] += 1;
  state.drawnTile = tile;
  state.rinshan = false;
  state.drawCounts[seat] += 1;
  state.phase = 'discard';
  state.actor = seat;
  state.claim = null;
  state.lastDiscard = null;
}

function drawReplacement(state: GameState, seat: Seat): void {
  let tile: number | null = null;
  if (state.deadCursor < state.wall.length) {
    tile = state.wall[state.deadCursor];
    state.deadCursor += 1;
  } else if (state.drawIndex < state.liveEnd) {
    state.liveEnd -= 1;
    tile = state.wall[state.liveEnd];
  }
  if (tile === null) {
    finishRound(state, { kind: 'draw', entries: [], discarder: null });
    return;
  }
  state.hands[seat][tile] += 1;
  state.drawnTile = tile;
  state.rinshan = true;
  state.phase = 'discard';
  state.actor = seat;
  state.claim = null;
  state.lastDiscard = null;
}

export function reduce(state: GameState, action: Action): GameState {
  const next = clone(state);

  if (next.phase === 'over') {
    if (action.type === 'next-round' && !next.finished) {
      const following = startRound(
        next.cfg,
        next.scores,
        next.round + 1,
        next.rngState,
      );
      // 整场最高和牌与对局记录都要跨局保留
      following.bestWin = next.bestWin;
      following.history = next.history;
      return following;
    }
    return next;
  }

  const actor = next.actor;
  if (actor === null) return next;

  switch (action.type) {
    case 'discard':
      return applyDiscard(next, actor, action.tile);
    case 'tsumo':
      return applyTsumo(next, actor);
    case 'ankan':
      return applyAnkan(next, actor, action.tile);
    case 'kakan':
      return applyKakan(next, actor, action.tile);
    case 'ron':
    case 'pass':
    case 'pon':
    case 'kan':
    case 'chi':
      return applyClaimResponse(next, actor, action);
    default:
      return next;
  }
}

function applyDiscard(state: GameState, seat: Seat, tile: number): GameState {
  if (state.hands[seat][tile] <= 0) return state;
  state.hands[seat][tile] -= 1;
  // 刚摸到就打出 = 摸切；手里另有一张同种牌不影响判定（日麻惯例看牌种）
  state.tsumogiri[seat].push(
    state.drawnTile !== null && tile === state.drawnTile,
  );
  state.discards[seat].push(tile);
  state.turnIndex += 1;
  state.lastDiscard = { tile, from: seat };
  state.drawnTile = null;
  state.rinshan = false;
  openClaimWindow(state, tile, seat, false);
  return state;
}

function openClaimWindow(
  state: GameState,
  tile: number,
  from: Seat,
  robKan: boolean,
): void {
  const pending: Seat[] = [];
  for (let step = 1; step < state.cfg.players; step += 1) {
    const seat = (from + step) % state.cfg.players;
    if (
      robKan
        ? canRon(state, seat, tile, true)
        : hasAnyClaim(state, seat, tile, from)
    ) {
      pending.push(seat);
    }
  }
  if (pending.length === 0) {
    if (robKan) drawReplacement(state, from);
    else drawFor(state, (from + 1) % state.cfg.players);
    return;
  }
  state.claim = {
    tile,
    from,
    pending,
    responses: new Array<Action | null>(state.cfg.players).fill(null),
    robKan,
  };
  state.phase = 'claim';
  state.actor = pending[0];
}

function applyTsumo(state: GameState, seat: Seat): GameState {
  const tile = state.drawnTile;
  if (tile === null) return state;
  const result = evaluateWin({
    concealed: state.hands[seat],
    melds: state.melds[seat],
    cfg: state.cfg,
    winTile: tile,
    isTsumo: true,
    seatWind: windOf(state, seat),
    flags: winFlags(state, seat, true),
  });
  if (!result.isWin || result.best === null) return state;

  const gain = result.best.score;
  state.scores[seat] += gain;
  const entry: ScoringEntry = {
    seat,
    result: result.best,
    winTile: tile,
    gain,
    penalty: 0,
    groups: handGroups(state, seat, result.best.pattern, tile, 'tsumo'),
  };
  finishRound(state, { kind: 'tsumo', entries: [entry], discarder: null });
  return state;
}

function applyAnkan(state: GameState, seat: Seat, tile: number): GameState {
  if (state.hands[seat][tile] !== 4) return state;
  state.hands[seat][tile] = 0;
  state.melds[seat].push({ kind: 'ankan', tiles: [tile, tile, tile, tile] });
  state.kanCounts[seat] += 1;
  state.drawnTile = null;
  drawReplacement(state, seat);
  return state;
}

function applyKakan(state: GameState, seat: Seat, tile: number): GameState {
  const melds = state.melds[seat];
  const index = melds.findIndex(
    (meld) => meld.kind === 'pon' && meld.tiles[0] === tile,
  );
  if (index < 0 || state.hands[seat][tile] <= 0) return state;
  state.hands[seat][tile] -= 1;
  // 加杠沿用原碰的横置位置：来源座位与鸣到的牌都保留下来
  const previous = melds[index];
  melds[index] = {
    kind: 'kakan',
    tiles: [tile, tile, tile, tile],
    from: previous.from,
    called: previous.called,
  };
  state.kanCounts[seat] += 1;
  state.drawnTile = null;
  state.lastDiscard = { tile, from: seat };
  openClaimWindow(state, tile, seat, true);
  return state;
}

function applyClaimResponse(
  state: GameState,
  seat: Seat,
  action: Action,
): GameState {
  const claim = state.claim;
  if (claim === null) return state;
  claim.responses[seat] = action;
  claim.pending = claim.pending.filter((pending) => pending !== seat);
  if (claim.pending.length > 0) {
    state.actor = claim.pending[0];
    return state;
  }
  resolveClaims(state);
  return state;
}

function resolveClaims(state: GameState): void {
  const claim = state.claim;
  if (claim === null) return;

  const winners: Seat[] = [];
  for (let seat = 0; seat < state.cfg.players; seat += 1) {
    if (claim.responses[seat]?.type === 'ron') winners.push(seat);
  }
  if (winners.length > 0) {
    settleRon(state, winners, claim.tile, claim.from, claim.robKan);
    return;
  }

  // 碰 / 杠 优先于吃，且按距离打牌者由近到远取第一个
  let caller: Seat | null = null;
  let call: Action | null = null;
  for (let step = 1; step < state.cfg.players; step += 1) {
    const seat = (claim.from + step) % state.cfg.players;
    const response = claim.responses[seat];
    if (
      response !== null &&
      (response.type === 'pon' || response.type === 'kan')
    ) {
      caller = seat;
      call = response;
      break;
    }
  }
  if (caller === null) {
    const nextSeat = (claim.from + 1) % state.cfg.players;
    const response = claim.responses[nextSeat];
    if (response !== null && response.type === 'chi') {
      caller = nextSeat;
      call = response;
    }
  }

  if (caller === null || call === null) {
    state.claim = null;
    drawFor(state, (claim.from + 1) % state.cfg.players);
    return;
  }
  applyCall(state, caller, call, claim);
}

function applyCall(
  state: GameState,
  caller: Seat,
  call: Action,
  claim: ClaimWindow,
): void {
  const river = state.discards[claim.from];
  if (river.length > 0 && river[river.length - 1] === claim.tile) {
    river.pop();
    // 被鸣走的牌同时从摸切标记里移除，两个数组必须等长
    state.tsumogiri[claim.from].pop();
  }

  const tile = claim.tile;
  state.claim = null;
  state.lastDiscard = null;

  if (call.type === 'pon') {
    state.hands[caller][tile] -= 2;
    state.melds[caller].push({
      kind: 'pon',
      tiles: [tile, tile, tile],
      from: claim.from,
      called: tile,
    });
  } else if (call.type === 'kan') {
    state.hands[caller][tile] -= 3;
    state.melds[caller].push({
      kind: 'minkan',
      tiles: [tile, tile, tile, tile],
      from: claim.from,
      called: tile,
    });
    state.kanCounts[caller] += 1;
  } else if (call.type === 'chi') {
    const [a, b] = call.tiles;
    state.hands[caller][a] -= 1;
    state.hands[caller][b] -= 1;
    const tiles = [a, b, tile].sort((x, y) => x - y);
    state.melds[caller].push({
      kind: 'chi',
      tiles,
      from: claim.from,
      called: tile,
    });
  }

  state.phase = 'discard';
  state.actor = caller;
  state.drawnTile = null;
  state.rinshan = false;

  if (call.type === 'kan') drawReplacement(state, caller);
}

function settleRon(
  state: GameState,
  winners: readonly Seat[],
  tile: number,
  from: Seat,
  robKan: boolean,
): void {
  const entries: ScoringEntry[] = [];
  let totalPenalty = 0;

  for (const seat of winners) {
    const hand = state.hands[seat].slice();
    hand[tile] += 1;
    const flags: WinFlags = {};
    if (robKan) flags.chankan = true;
    if (state.liveEnd - state.drawIndex === 0) flags.houtei = true;

    const result = evaluateWin({
      concealed: hand,
      melds: state.melds[seat],
      cfg: state.cfg,
      winTile: tile,
      isTsumo: false,
      seatWind: windOf(state, seat),
      flags,
    });
    if (!result.isWin || result.best === null) continue;

    const gain = result.best.score;
    const penalty = result.best.penalty;
    state.scores[seat] += gain;
    totalPenalty += penalty;
    entries.push({
      seat,
      result: result.best,
      winTile: tile,
      gain,
      penalty,
      groups: handGroups(state, seat, result.best.pattern, tile, 'ron'),
    });
  }

  state.scores[from] -= totalPenalty;
  finishRound(state, { kind: 'ron', entries, discarder: from });
}
