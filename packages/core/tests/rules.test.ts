import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SCORE_CAP,
  decompose,
  dropImplied,
  evaluateWin,
  makeConfig,
  parseHand,
  parseMeld,
  parseTiles,
} from '../src/index.ts';
import type { YakuHit } from '../src/index.ts';

const cfg = makeConfig({ rounds: 4 });

function hand(text: string) {
  return parseHand(text);
}

function evaluate(
  concealed: string,
  winTile: string,
  melds: ReturnType<typeof parseMeld>[] = [],
) {
  return evaluateWin({
    concealed: hand(concealed),
    melds,
    cfg,
    winTile: parseTiles(winTile)[0],
    isTsumo: false,
    seatWind: 0,
    flags: {},
  });
}

describe('拆解枚举', () => {
  it('标准型：四面子 + 雀头', () => {
    const patterns = decompose(hand('123m 456m 789m 123p 55s'), [], cfg);
    const standard = patterns.filter((p) => p.type === 'standard');
    assert.ok(standard.length >= 1);
    for (const pattern of standard) {
      assert.equal(pattern.sets.length, 4);
      assert.notEqual(pattern.pair, null);
    }
  });

  it('一副露的杠不改变面子数', () => {
    const patterns = decompose(
      hand('222m 234m 345m 55m'),
      [parseMeld('1111m', 'minkan')],
      cfg,
    );
    assert.ok(patterns.length >= 1);
    for (const pattern of patterns) assert.equal(pattern.sets.length, 4);
  });

  it('七对子', () => {
    const patterns = decompose(hand('11s 22s 33s 44s 55s 66s 77s'), [], cfg);
    assert.ok(patterns.some((p) => p.type === 'sevenPairs'));
  });

  it('四张相同的牌不能当两对（不支持龙七对）', () => {
    const text = '1111s 22s 33s 44s 55s 66s';
    const patterns = decompose(hand(text), [], makeConfig({ rounds: 4 }));
    assert.ok(
      !patterns.some((p) => p.type === 'sevenPairs'),
      '四张 + 六个对子不能和七对子',
    );
  });

  it('十三幺', () => {
    const patterns = decompose(hand('11m 9m 1p 9p 1s 9s 1234567z'), [], cfg);
    assert.ok(patterns.some((p) => p.type === 'thirteenOrphans'));
  });

  it('未成和的手牌没有拆解', () => {
    assert.equal(decompose(hand('123m 456m 789m 123p 56s'), [], cfg).length, 0);
  });
});

describe('蕴含剔除', () => {
  it('四连刻同时剔除三连刻、碰碰和', () => {
    const r = evaluate('111m 222m 333m 444m 55m', '4m');
    assert.ok(r.best !== null);
    const keys = r.best.hits.map((hit) => hit.key);
    assert.ok(keys.includes('silianke'));
    assert.ok(!keys.includes('sanlianke'));
    assert.ok(!keys.includes('pengpenghe'));
  });

  it('被剔除的番种也不会进入铳责', () => {
    const withDrop = dropImplied([
      fakeHit('silianke', 16, 0b1111),
      fakeHit('sanlianke', 6, 0b1111),
      fakeHit('qingyise', 6, 0b11111),
    ]);
    assert.deepEqual(
      withDrop.map((hit) => hit.key),
      ['silianke', 'qingyise'],
    );
  });

  it('传递闭包：四步高 ⇒ 三步高 不依赖中间项是否被剔除', () => {
    const dropped = dropImplied([
      fakeHit('sibugao', 12, 0b1111),
      fakeHit('sanbugao', 3, 0b0111),
    ]);
    assert.deepEqual(
      dropped.map((hit) => hit.key),
      ['sibugao'],
    );
  });
});

describe('计分与铳责的性质', () => {
  const hands: ReadonlyArray<readonly [string, string]> = [
    ['111m 222m 333m 555m 11z', '1z'],
    ['111m 222m 333m 444m 55m', '5m'],
    ['123m 234m 345m 567m 99m', '9m'],
    ['111m 111p 11s 888p 888s', '8s'],
    ['123s 555s 123p 555p 44p', '4p'],
    ['11s 22s 33s 44s 55s 66s 77s', '7s'],
    ['11m 9m 1p 9p 1s 9s 1234567z', '1m'],
  ];

  it('S ≤ max(12, 最大单番)，且 0 ≤ P ≤ 12', () => {
    for (const [concealed, winTile] of hands) {
      const r = evaluate(concealed, winTile);
      assert.ok(r.best !== null);
      const maxSingle = Math.max(...r.best.hits.map((hit) => hit.points));
      assert.ok(
        r.best.score <= Math.max(SCORE_CAP, maxSingle),
        `${concealed}: S 超上限`,
      );
      assert.ok(
        r.best.penalty >= 0 && r.best.penalty <= SCORE_CAP,
        `${concealed}: P 越界`,
      );
    }
  });

  it('P ≤ S 恒成立', () => {
    for (const [concealed, winTile] of hands) {
      const r = evaluate(concealed, winTile);
      assert.ok(r.best !== null);
      assert.ok(r.best.penalty <= r.best.score, `${concealed}: P 超过 S`);
    }
  });

  it('S_A ≤ 原始和', () => {
    for (const [concealed, winTile] of hands) {
      const r = evaluate(concealed, winTile);
      assert.ok(r.best !== null);
      assert.ok(
        r.best.liability <= r.best.rawSum,
        `${concealed}: S_A 超过原始和`,
      );
    }
  });
});

describe('起和门槛：不足 2 分不能和牌', () => {
  it('零番手牌不能和牌', () => {
    const r = evaluate('123m 456m 789p 234s 55z', '5z');
    assert.equal(r.isWin, false, '零番手牌不能和牌');
    assert.ok(r.best !== null, '仍应能拆出和牌型，便于调试');
    assert.equal(r.best.hits.length, 0);
    assert.equal(r.best.score, 0);
    assert.equal(r.ronAllowed, false);
  });

  it('1 分番种也不能和牌（自摸同样禁止）', () => {
    // 一般高 1 分
    const r = evaluate('123m 123m 456p 789s 55z', '5z');
    assert.ok(r.best !== null);
    assert.ok(r.best.rawSum < 2, `原始和应不足 2，实际 ${r.best.rawSum}`);
    assert.equal(r.isWin, false, '1 分不能和牌');
  });

  it('一杠不计入起和之和', () => {
    // 清一色已经 ≥2，这里只验证起和判定函数的分母口径。
    const r = evaluate('222m 234m 345m 55m', '5m', [
      parseMeld('1111m', 'minkan'),
    ]);
    assert.equal(r.ronAllowed, true);
  });
});

function fakeHit(
  key: YakuHit['key'],
  points: number,
  meldMask: number,
): YakuHit {
  return {
    id: 0,
    key,
    name: key,
    points,
    scope: 'combo',
    liability: 'by-meld',
    meldMask,
  };
}
