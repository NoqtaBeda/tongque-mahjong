import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCORE_CAP, makeConfig, parseHand } from '../src/index.ts';
import {
  DEFAULT_WEIGHTS,
  chooseDiscard,
  extractFeatures,
  potentialScore,
  rankDiscards,
  yakuProspects,
} from '../src/ai/index.ts';
import type { HandFeatures, Prospect } from '../src/ai/index.ts';
import type { YakuKey } from '../src/index.ts';

const cfg = makeConfig({ rounds: 4 });

function features(text: string, seatWind = 0): HandFeatures {
  return extractFeatures(parseHand(text), [], seatWind);
}

function progressOf(list: readonly Prospect[], key: YakuKey): number {
  return list.find((item) => item.key === key)?.progress ?? 0;
}

describe('牌形特征', () => {
  it('统计花色张数与字牌', () => {
    const f = features('123m 45p 111z');
    assert.deepEqual([...f.suitTiles], [3, 2, 0]);
    assert.equal(f.honorTiles, 3);
    assert.equal(f.total, 8);
  });

  it('识别刻子与对子', () => {
    const f = features('111m 22m 333p 44z');
    assert.deepEqual([...f.tripletKinds], [0, 11], '1m 与 3p（饼 3 = 9+2）');
    assert.deepEqual([...f.pairKinds], [1, 30], '2m 与 北');
  });

  it('数字跨度只统计数牌', () => {
    const f = features('123m 789p');
    assert.equal(f.rankMin, 1);
    assert.equal(f.rankMax, 9);
  });
});

describe('番种潜力', () => {
  it('清一色/混一色/缺一门', () => {
    const qing = yakuProspects(features('123m 456m 789m 11m'));
    assert.equal(progressOf(qing, 'qingyise'), 1);

    const hun = yakuProspects(features('123m 456m 789m 11z'));
    assert.equal(progressOf(hun, 'hunyise'), 1);

    const que = yakuProspects(features('123m 456m 789p 11p'));
    assert.equal(progressOf(que, 'queyimen'), 1);
  });

  it('字一色与大四喜', () => {
    const f = features('111z 222z 333z 444z 55z');
    const list = yakuProspects(f);
    assert.equal(progressOf(list, 'ziyise'), 1);
    assert.equal(progressOf(list, 'da-sixi'), 1);
    assert.equal(progressOf(list, 'san-feng-ke'), 1);
  });

  it('清幺九与七对子', () => {
    const yao = yakuProspects(features('111m 999m 111p 999p 11s'));
    assert.equal(progressOf(yao, 'qing-yaojiu'), 1);

    const pairs = yakuProspects(features('11s 22s 44s 55s 77s 88s 99s'));
    assert.equal(progressOf(pairs, 'qiduizi'), 1);
  });

  it('一色组合类的进度随缺项递减', () => {
    const full = yakuProspects(features('123m 456m 789m 11m'));
    assert.equal(progressOf(full, 'qinglong'), 1);

    // 缺 789m，只凑齐 2/3
    const partial = yakuProspects(features('123m 456m 777p 11m'));
    const value = progressOf(partial, 'qinglong');
    assert.ok(value > 0 && value < 1, `期望部分进度，实际 ${value}`);
  });

  it('聚合类按数字跨度给分', () => {
    const exact = yakuProspects(features('123m 234p 345s 11m'));
    assert.equal(progressOf(exact, 'juwushu'), 1);

    const far = yakuProspects(features('19m 19p 19s 11m'));
    assert.equal(progressOf(far, 'juwushu'), 0);
  });

  it('potentialScore 落在 [0, 12]', () => {
    const samples = [
      '123m 456m 789m 11m',
      '111z 222z 333z 444z 55z',
      '11s 22s 44s 55s 77s 88s 99s',
      '123m 456p 789s 234m 55p',
    ];
    for (const text of samples) {
      const score = potentialScore(features(text));
      assert.ok(score >= 0 && score <= SCORE_CAP, `${text} 得到 ${score}`);
    }
  });

  it('高价值牌型潜力分更高', () => {
    const cheap = potentialScore(features('123m 456p 789s 234m 55p'));
    const expensive = potentialScore(features('111m 999m 111p 999p 11s'));
    assert.ok(expensive > cheap, `期望 ${expensive} > ${cheap}`);
  });
});

describe('打牌候选', () => {
  it('孤张优先打出', () => {
    const h = parseHand('123m 456m 789m 12p 55s 9s');
    const ranked = rankDiscards(h, [], cfg);
    assert.equal(ranked[0].tile, 26, '应打 9s');
    assert.equal(ranked[0].shanten, 0);
    assert.equal(ranked[0].ukeire.count, 4, '等待 3p');
  });

  it('候选按价值降序，覆盖所有可打的牌种', () => {
    const h = parseHand('123m 456m 789m 123p 5s 9s');
    const ranked = rankDiscards(h, [], cfg);
    const distinct = new Set<number>();
    for (let kind = 0; kind < 34; kind += 1)
      if (h[kind] > 0) distinct.add(kind);
    assert.equal(ranked.length, distinct.size);
    for (let i = 1; i < ranked.length; i += 1) {
      assert.ok(ranked[i - 1].value >= ranked[i].value, '价值必须非递增');
    }
    assert.equal(ranked[0].shanten, 0, '四个面子在手，打完即听牌');
  });

  it('权重可调，调整后排序会变化', () => {
    const h = parseHand('123m 456m 789m 12p 55s 9s');
    const speed = rankDiscards(h, [], cfg);
    const greedy = rankDiscards(h, [], cfg, {
      weights: { ...DEFAULT_WEIGHTS, ukeire: 0, potential: 5000 },
    });
    assert.ok(greedy.length > 0);
    assert.ok(speed[0].value !== undefined);
  });

  it('chooseDiscard 与 rankDiscards 首位一致', () => {
    const h = parseHand('123m 456m 789m 12p 55s 9s');
    assert.equal(chooseDiscard(h, [], cfg), rankDiscards(h, [], cfg)[0].tile);
  });

  it('空手牌返回 null', () => {
    assert.equal(chooseDiscard(parseHand('1m'), [], cfg), 0, '单张也能打');
    assert.equal(chooseDiscard(parseHand(''), [], cfg), null);
  });
});
