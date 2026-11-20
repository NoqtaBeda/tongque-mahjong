import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  legalActions,
  makeConfig,
  observe,
  reduce,
  startRound,
} from '../src/index.ts';
import type { GameState } from '../src/index.ts';

const CFG = makeConfig({ duplicateWalls: true });

function round(seed: number): GameState {
  return startRound(CFG, [0, 0, 0, 0], 0, seed);
}

/** 用"每次打最左边的合法牌"的笨策略把本场打到底 */
function playOut(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 20000; guard += 1) {
    if (current.phase === 'over') return current;
    const actor = current.actor;
    if (actor === null) throw new Error('未结束却没有行动者');
    const legal = legalActions(current, actor);
    assert.ok(legal.length > 0);
    const action = legal.find((item) => item.type === 'discard') ?? legal[0];
    current = reduce(current, action);
  }
  throw new Error('对局没有收敛');
}

function handCount(hand: Uint8Array): number {
  let total = 0;
  for (const count of hand) total += count;
  return total;
}

describe('复式（duplicate）牌山', () => {
  it('四段牌山均分且覆盖整副牌', () => {
    const state = round(1);
    const segments = state.segments;
    assert.ok(segments !== undefined);
    assert.equal(segments.length, 4);
    assert.equal(state.wall.length, 136);
    const lengths = segments.map((seg) => seg.back - seg.start + 1);
    assert.deepEqual(lengths, [34, 34, 34, 34]);
    segments.forEach((seg, seat) => {
      assert.equal(seg.start, seat * 34, `座位 ${seat} 的段首`);
      const dealt = seat === state.dealer ? 14 : 13;
      assert.equal(seg.front, seg.start + dealt, `座位 ${seat} 发完牌后的游标`);
      assert.equal(seg.back, seg.start + 33);
    });
  });

  it('起手只从自己的牌山头部取，庄家多一张', () => {
    const state = round(2);
    const segments = state.segments;
    assert.ok(segments !== undefined);
    for (let seat = 0; seat < 4; seat += 1) {
      const expected = seat === state.dealer ? 14 : 13;
      assert.equal(
        handCount(state.hands[seat]),
        expected,
        `座位 ${seat} 起手张数`,
      );
      assert.equal(
        segments[seat].front,
        segments[seat].start + expected,
        `座位 ${seat} 的游标应推进 ${expected}`,
      );
      // 起手牌的每一张都必须落在自己的牌山段里
      const own = new Set<number>();
      for (
        let index = segments[seat].start;
        index < segments[seat].front;
        index += 1
      ) {
        own.add(state.wall[index]);
      }
      for (let kind = 0; kind < state.hands[seat].length; kind += 1) {
        if (state.hands[seat][kind] === 0) continue;
        assert.ok(own.has(kind), `座位 ${seat} 起手出现段外牌 ${kind}`);
      }
    }
  });

  it('同一种子两次开局：每座位的牌山与起手完全相同', () => {
    const left = round(3);
    const right = round(3);
    assert.deepEqual(
      left.segments?.map((seg) => [seg.start, seg.front, seg.back]),
      right.segments?.map((seg) => [seg.start, seg.front, seg.back]),
    );
    for (let seat = 0; seat < 4; seat += 1) {
      assert.deepEqual(
        Array.from(left.hands[seat]),
        Array.from(right.hands[seat]),
      );
    }
  });

  it('摸牌只从自己牌山推进，且庄家打牌后轮到下家摸自己的牌', () => {
    let state = round(4);
    const segments = state.segments;
    assert.ok(segments !== undefined);
    const dealer = state.dealer;
    // 庄家先打一张
    const discard = legalActions(state, dealer).find(
      (item) => item.type === 'discard',
    );
    assert.ok(discard !== undefined);
    state = reduce(state, discard);
    if (state.phase === 'over') return; // 极小概率直接流局
    const nextSeat = state.actor;
    if (nextSeat === null) throw new Error('没有下家行动者');
    const before = segments[nextSeat].front;
    const expectedTile = state.wall[before];
    assert.equal(
      state.drawnTile,
      expectedTile,
      '摸到的应是下家自己牌山的下一张',
    );
    assert.equal(state.segments?.[nextSeat].front, before + 1);
  });

  it('一局打完后没有人把自己的牌山摸穿', () => {
    for (const seed of [5, 6, 7]) {
      const final = playOut(round(seed));
      assert.equal(final.phase, 'over');
      for (const seg of final.segments ?? []) {
        assert.ok(seg.front >= seg.start, 'front 不应倒退到段首之前');
        assert.ok(
          seg.front <= seg.back + 1,
          `front 越过了 back：${seg.front} > ${seg.back + 1}`,
        );
      }
    }
  });

  it('牌山剩余取四家里最少的那家', () => {
    const state = round(8);
    const segments = state.segments;
    assert.ok(segments !== undefined);
    const expected = Math.min(
      ...segments.map((seg) => Math.max(0, seg.back - seg.front + 1)),
    );
    assert.equal(observe(state, state.dealer).wallRemaining, expected);
  });

  it('三人麻将不允许开启复式', () => {
    assert.throws(
      () => makeConfig({ duplicateWalls: true, players: 3 }),
      /复式牌山只支持四人麻将/,
    );
  });

  it('开启复式时自动取消王牌（否则会少 14 张可摸牌）', () => {
    const cfg = makeConfig({ duplicateWalls: true });
    assert.equal(cfg.keepDeadWall, false);
    const state = startRound(cfg, [0, 0, 0, 0], 0, 1);
    const total = (state.segments ?? []).reduce(
      (sum, seg) => sum + (seg.back - seg.start + 1),
      0,
    );
    assert.equal(total, 136);
  });
});
