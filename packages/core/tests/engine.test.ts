import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createGame,
  emptyHand,
  legalActions,
  makeConfig,
  observe,
  parseHand,
  parseTiles,
  reduce,
} from '../src/index.ts';
import type { Action, GameState } from '../src/index.ts';
import { decide } from '../src/ai/index.ts';

const cfg = makeConfig({ rounds: 4 });

/** 手牌 + 副露 + 牌河里的牌数（不含牌山） */
function placedTiles(state: GameState): number {
  let sum = 0;
  for (const hand of state.hands)
    for (let kind = 0; kind < 34; kind += 1) sum += hand[kind];
  for (const melds of state.melds)
    for (const meld of melds) sum += meld.tiles.length;
  for (const river of state.discards) sum += river.length;
  return sum;
}

function handSize(hand: Uint8Array): number {
  let sum = 0;
  for (let kind = 0; kind < hand.length; kind += 1) sum += hand[kind];
  return sum;
}

describe('配牌', () => {
  it('庄家 14 张、其余 13 张，共发 53 张', () => {
    const state = createGame(cfg, 42);
    assert.equal(placedTiles(state), 53);
    assert.equal(handSize(state.hands[state.dealer]), 14);
    for (let seat = 0; seat < 4; seat += 1) {
      if (seat === state.dealer) continue;
      assert.equal(handSize(state.hands[seat]), 13);
    }
  });

  it('同一 seed 配牌完全一致', () => {
    const a = createGame(cfg, 123);
    const b = createGame(cfg, 123);
    assert.deepEqual([...a.hands[0]], [...b.hands[0]]);
    assert.deepEqual(a.wall.slice(0, 8), b.wall.slice(0, 8));
  });

  it('不同 seed 配牌不同', () => {
    const a = createGame(cfg, 1);
    const b = createGame(cfg, 2);
    assert.notDeepEqual([...a.hands[0]], [...b.hands[0]]);
  });

  it('108 张模式不含二至八万', () => {
    const sanma = createGame(
      makeConfig({ players: 3, tileSet: 'sanma108', rounds: 3 }),
      7,
    );
    assert.equal(sanma.wall.length, 108);
    for (let offset = 1; offset <= 7; offset += 1) {
      assert.equal(sanma.wall.filter((tile) => tile === offset).length, 0);
    }
  });
});

describe('动作与观察', () => {
  it('只有当前行动者拥有合法动作', () => {
    const state = createGame(cfg, 9);
    const dealer = state.dealer;
    const actions = legalActions(state, dealer);
    const discards = actions.filter((action) => action.type === 'discard');
    let distinct = 0;
    for (let kind = 0; kind < 34; kind += 1)
      if (state.hands[dealer][kind] > 0) distinct += 1;
    assert.equal(discards.length, distinct);

    const other = (dealer + 1) % 4;
    assert.deepEqual(legalActions(state, other), []);
  });

  it('打牌后进入鸣牌或摸牌阶段，且手牌数正确', () => {
    const state = createGame(cfg, 9);
    const tile = parseTiles('1m')[0];
    const next = reduce(state, { type: 'discard', tile });
    if (next.phase === 'claim') {
      assert.ok(next.claim !== null);
    } else {
      assert.equal(next.phase, 'discard');
      assert.equal(handSize(next.hands[next.actor ?? 0]), 14);
    }
  });

  it('observe 只暴露自己的暗牌', () => {
    const state = createGame(cfg, 9);
    const obs = observe(state, 1);
    assert.deepEqual([...obs.hand], [...state.hands[1]]);
    assert.equal(obs.seat, 1);
    assert.equal(obs.seatWind, 1);
    assert.equal(obs.isActor, state.actor === 1);
    assert.ok(obs.wallRemaining > 0);
  });

  it('同一 seed 与同一动作序列得到相同状态', () => {
    const tile = parseTiles('1m')[0];
    const a = reduce(createGame(cfg, 55), { type: 'discard', tile });
    const b = reduce(createGame(cfg, 55), { type: 'discard', tile });
    assert.equal(a.actor, b.actor);
    assert.equal(a.phase, b.phase);
    assert.deepEqual([...a.hands[0]], [...b.hands[0]]);
  });

  it('resolve 不修改传入状态', () => {
    const state = createGame(cfg, 5);
    const snapshot = [...state.hands[0]];
    reduce(state, { type: 'discard', tile: parseTiles('1m')[0] });
    assert.deepEqual([...state.hands[0]], snapshot);
  });

  it('phase 为 over 时只有 next-round', () => {
    const state = createGame(cfg, 5);
    state.phase = 'over';
    state.actor = null;
    state.finished = false;
    state.result = { kind: 'draw', entries: [], discarder: null };
    const actions: Action[] = legalActions(state, 0);
    assert.deepEqual(actions, [{ type: 'next-round' }]);
  });
});

describe('一铳多响', () => {
  function craftDoubleRon(): GameState {
    const state = createGame(cfg, 7);
    const fiveS = parseTiles('5s')[0];
    state.hands[0] = parseHand('1111z 2222z 3333z 4z');
    state.hands[1] = parseHand('123m 456m 789m 111p 5s');
    state.hands[2] = parseHand('123m 456m 789m 999p 5s');
    state.hands[3] = emptyHand();
    state.melds = [[], [], [], []];
    state.discards = [[fiveS], [], [], []];
    state.phase = 'claim';
    state.actor = 1;
    state.claim = {
      tile: fiveS,
      from: 0,
      pending: [1, 2],
      responses: [null, null, null, null],
      robKan: false,
    };
    state.scores = [0, 0, 0, 0];
    return state;
  }

  it('两家同时和了同一张铳牌时都记分', () => {
    let state = craftDoubleRon();
    assert.ok(legalActions(state, 1).some((action) => action.type === 'ron'));
    state = reduce(state, { type: 'ron' });
    assert.equal(state.actor, 2, '应轮到第二家表态');
    assert.ok(legalActions(state, 2).some((action) => action.type === 'ron'));
    state = reduce(state, { type: 'ron' });

    assert.equal(state.phase, 'over');
    const result = state.result;
    assert.ok(result !== null);
    assert.equal(result.kind, 'ron');
    assert.equal(result.discarder, 0);
    assert.equal(result.entries.length, 2);

    const gained = result.entries.reduce((sum, entry) => sum + entry.gain, 0);
    const paid = result.entries.reduce((sum, entry) => sum + entry.penalty, 0);
    // 用相加来避免 0 与 -0 的严格比较差异
    assert.equal(state.scores[0] + paid, 0);
    assert.equal(state.scores[1] + state.scores[2], gained);
    assert.ok(paid <= gained);
  });

  it('一家放弃不影响另一家', () => {
    let state = craftDoubleRon();
    state = reduce(state, { type: 'pass' });
    assert.equal(state.actor, 2);
    state = reduce(state, { type: 'ron' });
    assert.equal(state.phase, 'over');
    const result = state.result;
    assert.ok(result !== null);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].seat, 2);
  });

  it('全员放弃则打牌者的下家摸牌', () => {
    let state = craftDoubleRon();
    state = reduce(state, { type: 'pass' });
    state = reduce(state, { type: 'pass' });
    assert.notEqual(state.phase, 'over');
    assert.equal(state.actor, 1);
    assert.equal(handSize(state.hands[1]), 14);
  });
});

describe('鸣牌约束', () => {
  it('吃只允许打牌者的下家', () => {
    // 之前这里只抽样 3 个窗口，漏掉了「窗口是为碰而开、但吃选项也一并列出」的情况，
    // 所以样本量放大到上千个窗口，并且覆盖多家同时可鸣的场合。
    let windows = 0;
    let chiSeen = 0;
    let ponWithChi = 0;

    for (let seed = 0; seed < 40; seed += 1) {
      let state = createGame(cfg, seed);
      for (let step = 0; step < 600; step += 1) {
        if (state.phase === 'over') break;
        if (state.phase === 'claim') {
          const claim = state.claim;
          assert.ok(claim !== null);
          windows += 1;
          for (let seat = 0; seat < 4; seat += 1) {
            const actions = legalActions(state, seat);
            const chis = actions.filter((action) => action.type === 'chi');
            if (chis.length === 0) continue;
            chiSeen += chis.length;
            if (actions.some((action) => action.type === 'pon'))
              ponWithChi += 1;
            assert.equal(seat, (claim.from + 1) % 4, '吃必须来自上家');
          }
          state = reduce(state, { type: 'pass' });
          continue;
        }
        const actor = state.actor;
        if (actor === null) break;
        // 用确定性的轮转选牌，比跑 AI 快一个量级，样本量才够大
        const picks = legalActions(state, actor).filter(
          (action) => action.type === 'discard',
        );
        if (picks.length === 0) break;
        state = reduce(state, picks[(seed + step) % picks.length]);
      }
    }

    assert.ok(windows > 500, `样本中应出现足够多的鸣牌窗口，实际 ${windows}`);
    assert.ok(chiSeen > 0, '样本中应至少出现一次可吃窗口');
  });

  it('非法打牌不推进状态', () => {
    const state = createGame(cfg, 3);
    const actor = state.actor ?? 0;
    let missing = -1;
    for (let kind = 0; kind < 34; kind += 1) {
      if (state.hands[actor][kind] === 0) {
        missing = kind;
        break;
      }
    }
    assert.ok(missing >= 0);
    const next = reduce(state, { type: 'discard', tile: missing });
    assert.equal(next.turnIndex, state.turnIndex);
    assert.equal(next.discards[actor].length, 0);
  });
});

describe('整场大牌记录', () => {
  it('记录的手牌是真正的牌列表，不是张数数组', () => {
    let record: GameState['bestWin'] = null;

    // 新规则下流局率很高，一场里可能没人和牌，所以多打几场直到出现
    for (let game = 0; game < 20 && record === null; game += 1) {
      let state = createGame(cfg, 20260101 + game);
      for (let step = 0; step < 12000; step += 1) {
        if (state.bestWin !== null) {
          record = state.bestWin;
          break;
        }
        if (state.phase === 'over') {
          if (state.finished) break;
          state = reduce(state, { type: 'next-round' });
          continue;
        }
        const actor = state.actor;
        if (actor === null) break;
        const legal = legalActions(state, actor);
        if (legal.length === 0) break;
        state = reduce(state, decide(observe(state, actor)));
      }
    }

    assert.ok(record !== null, '多场之内应当至少记录到一次和牌');
    const flat = record.groups.flatMap((group) => group.tiles);
    assert.ok(flat.length > 0 && flat.length <= 18);
    assert.ok(
      record.groups.some((group) => !group.melded),
      '暗手部分应当被拆成若干组',
    );

    const counts = new Map<number, number>();
    for (const tile of flat) {
      assert.ok(
        Number.isInteger(tile) && tile >= 0 && tile < 34,
        `牌种越界：${tile}`,
      );
      counts.set(tile, (counts.get(tile) ?? 0) + 1);
    }
    // 张数数组被当成牌列表时，同一个牌种会出现几十次
    for (const [kind, count] of counts) {
      assert.ok(count <= 4, `牌种 ${kind} 在同一次和牌里出现了 ${count} 次`);
    }
  });
});

describe('对局记录', () => {
  it('每局累积一条记录，和牌与流局都要记', () => {
    let state = createGame(cfg, 20260101);
    for (let step = 0; step < 20000; step += 1) {
      if (state.phase === 'over') {
        if (state.finished) break;
        state = reduce(state, { type: 'next-round' });
        continue;
      }
      const actor = state.actor;
      if (actor === null) break;
      const legal = legalActions(state, actor);
      if (legal.length === 0) break;
      state = reduce(state, decide(observe(state, actor)));
    }

    assert.equal(state.history.length, cfg.rounds, '每个本场一条记录');

    // 累计分：相邻两局要接得上，且 before → after 的差值必须与和牌记录一致
    let running = new Array<number>(cfg.players).fill(0);
    for (const record of state.history) {
      assert.deepEqual(
        [...record.scoresBefore],
        running,
        '本局开始前应当等于上一局结束后的分数',
      );

      const delta = new Array<number>(cfg.players).fill(0);
      for (const entry of record.entries) delta[entry.seat] += entry.gain;
      if (record.kind === 'ron' && record.entries.length > 0) {
        const discarder = record.entries[0].discarder;
        let penalty = 0;
        for (const entry of record.entries) penalty += entry.penalty;
        if (discarder !== null) delta[discarder] -= penalty;
      }
      for (let seat = 0; seat < cfg.players; seat += 1) {
        assert.equal(
          record.scoresAfter[seat] - record.scoresBefore[seat],
          delta[seat],
          `第 ${record.round + 1} 局 ${seat} 号位的分数变化对不上`,
        );
      }
      running = [...record.scoresAfter];
    }

    state.history.forEach((record, index) => {
      assert.equal(record.round, index, '记录顺序应当与局数一致');
      if (record.kind === 'draw') {
        assert.equal(record.entries.length, 0, '流局没有和牌者');
        return;
      }
      assert.ok(record.entries.length >= 1, '和牌局至少要有一名和牌者');
      for (const entry of record.entries) {
        assert.ok(entry.gain > 0, '和牌者应当得正分');
        // 标准型 14 张；带杠或七对子等也是 14 张起（杠多一张）
        const tiles = entry.groups.reduce(
          (sum, group) => sum + group.tiles.length,
          0,
        );
        assert.ok(tiles >= 14, `手牌张数异常：${tiles}`);
        assert.ok(entry.yaku.length >= 1, '至少要记录命中的番种');
        if (record.kind === 'tsumo') {
          assert.equal(entry.discarder, null, '自摸没有放铳者');
          assert.equal(entry.penalty, 0, '自摸不产生放铳失分');
        } else {
          assert.ok(entry.discarder !== null, '铳和必须有放铳者');
          assert.ok(entry.penalty >= 0, '放铳失分不应为负');
        }
      }
    });
  });

  it('七对子这类特殊和牌型也要记录完整手牌', () => {
    // 直接构造一个七对子和牌的局面：手里 14 张（已包含摸到的那张）
    const state = createGame(cfg, 1);
    state.hands[0] = emptyHand();
    state.hands[0][0] = 2; // 1m ×2
    state.hands[0][1] = 2; // 2m ×2
    state.hands[0][2] = 2; // 3m ×2
    state.hands[0][9] = 2; // 1p ×2
    state.hands[0][18] = 2; // 1s ×2
    state.hands[0][27] = 2; // 东 ×2
    state.hands[0][31] = 2; // 白 ×2（其中一张是刚摸到的）
    state.drawnTile = 31;
    state.phase = 'discard';
    state.actor = 0;

    const next = reduce(state, { type: 'tsumo' });
    assert.equal(next.phase, 'over', '应当和牌');
    const record = next.history[next.history.length - 1];
    assert.ok(record !== undefined);
    assert.equal(record.kind, 'tsumo');
    const entry = record.entries[0];
    assert.ok(entry !== undefined, '应当有和牌记录');
    const tiles = entry.groups.reduce(
      (sum, group) => sum + group.tiles.length,
      0,
    );
    assert.equal(tiles, 14, `七对子应当记录 14 张牌，实际 ${tiles}`);
    assert.ok(
      entry.groups.every((group) => group.tiles.length === 2),
      '七对子应当按对子分组',
    );
  });
});
