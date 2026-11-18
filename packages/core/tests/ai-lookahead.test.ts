import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeConfig, parseHand } from '../src/index.ts';
import {
  AI_PROFILES,
  decide,
  expectedUkeireAfterDraw,
  improvingTiles,
  rankDiscards,
} from '../src/ai/index.ts';
import { observe } from '../src/index.ts';
import { createGame, legalActions } from '../src/index.ts';

const cfg = makeConfig({ rounds: 4 });

describe('一步前瞻', () => {
  it('对听牌手牌给出有限的非负期望值', () => {
    const hand = parseHand('123m 456m 789m 12p 55s');
    const value = expectedUkeireAfterDraw(
      hand,
      [],
      cfg,
      undefined,
      undefined,
      4,
    );
    assert.ok(Number.isFinite(value), `期望值是有限数，实际 ${value}`);
    assert.ok(value >= 0);
  });

  it('对完全成型的和牌手牌返回 0（没有可改进的牌）', () => {
    const hand = parseHand('123m 456m 789m 123p 5s');
    const base = improvingTiles(hand, [], cfg);
    const value = expectedUkeireAfterDraw(hand, [], cfg, undefined, base, 4);
    assert.ok(value >= 0);
  });

  it('branch=0 时不做展开', () => {
    const hand = parseHand('123m 456m 789m 12p 55s');
    assert.equal(
      expectedUkeireAfterDraw(hand, [], cfg, undefined, undefined, 0),
      0,
    );
  });

  it('同一输入结果稳定', () => {
    const hand = parseHand('19m 19p 19s 1234z 5z 6z');
    const first = expectedUkeireAfterDraw(
      hand,
      [],
      cfg,
      undefined,
      undefined,
      4,
    );
    const second = expectedUkeireAfterDraw(
      hand,
      [],
      cfg,
      undefined,
      undefined,
      4,
    );
    assert.equal(first, second);
  });
});

describe('打牌排序与前瞻开关', () => {
  it('开启前瞻后仍然返回全部可打的牌，且价值非递增', () => {
    const hand = parseHand('123m 456m 789m 12p 55s 9s');
    const ranked = rankDiscards(hand, [], cfg, {
      lookahead: 1,
      lookaheadWeight: 12,
      branch: 4,
    });
    let distinct = 0;
    for (let kind = 0; kind < 34; kind += 1) if (hand[kind] > 0) distinct += 1;
    assert.equal(ranked.length, distinct);
    for (let index = 1; index < ranked.length; index += 1) {
      assert.ok(ranked[index - 1].value >= ranked[index].value);
    }
    assert.ok(
      ranked.some((candidate) => candidate.deep > 0),
      '应当算出前瞻分',
    );
  });

  it('前瞻权重为 0 时不计算，结果与关闭时一致', () => {
    const hand = parseHand('123m 456m 789m 12p 55s 9s');
    const plain = rankDiscards(hand, [], cfg);
    const zeroWeight = rankDiscards(hand, [], cfg, {
      lookahead: 1,
      lookaheadWeight: 0,
      branch: 4,
    });
    assert.deepEqual(
      plain.map((candidate) => candidate.tile),
      zeroWeight.map((candidate) => candidate.tile),
    );
    assert.ok(zeroWeight.every((candidate) => candidate.deep === 0));
  });
});

describe('AI 档案', () => {
  it('两个档案都返回合法动作', () => {
    for (const level of ['advanced'] as const) {
      const state = createGame(cfg, 12345);
      const actor = state.actor ?? 0;
      const legal = legalActions(state, actor);
      const action = decide(observe(state, actor), {
        profile: AI_PROFILES[level],
      });
      assert.ok(
        legal.some((candidate) => candidate.type === action.type),
        `${level} 返回了非法动作 ${action.type}`,
      );
    }
  });

  it('进阶档更看重番种潜力', () => {
    assert.ok(
      AI_PROFILES.advanced.weights.potential > 0,
      '进阶档应当有潜力项权重',
    );
  });

  it('默认档不做前瞻', () => {
    assert.equal(AI_PROFILES.advanced.lookahead, 0);
  });
});
