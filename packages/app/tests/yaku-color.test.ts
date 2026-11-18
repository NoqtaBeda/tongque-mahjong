import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { YAKU } from '../../core/src/index.ts';
import { sortYakuByPoints } from '../src/hand.ts';
import {
  TOP_TIER,
  YAKU_COLORS,
  YAKU_TIERS,
  needsGlow,
  yakuColorOf,
  yakuTierOf,
} from '../src/yaku-color.ts';

describe('番种分值色阶', () => {
  it('每个档位都有颜色，且互不相同', () => {
    for (const tier of YAKU_TIERS) {
      assert.match(
        YAKU_COLORS[tier],
        /^#[0-9a-f]{6}$/,
        `${tier} 分档颜色格式不对`,
      );
    }
    const unique = new Set(YAKU_TIERS.map((tier) => YAKU_COLORS[tier]));
    assert.equal(unique.size, YAKU_TIERS.length, '不同档位不应撞色');
  });

  it('引擎里出现的每个分值都能落到某一档上', () => {
    const points = new Set(Object.values(YAKU).map((yaku) => yaku.points));
    for (const value of points) {
      const tier = yakuTierOf(value);
      assert.ok(YAKU_TIERS.includes(tier), `${value} 分没有对应档位`);
      assert.ok(tier <= value, `${value} 分不该被抬到更高的档 ${tier}`);
    }
  });

  it('12 分与 13 分共用同一档', () => {
    assert.equal(yakuTierOf(13), yakuTierOf(12));
    assert.equal(yakuColorOf(13), yakuColorOf(12));
    // 十三幺是唯一的 13 分番种
    const thirteen = Object.values(YAKU).find((yaku) => yaku.points === 13);
    assert.equal(thirteen?.name, '十三幺');
  });

  it('12 分及以上才发光', () => {
    assert.equal(TOP_TIER, 24);
    assert.equal(yakuTierOf(24), 24);
    // 高于最高档也按最高档算
    assert.equal(yakuTierOf(99), 24);
    for (const points of [12, 13, 16, 24]) {
      assert.equal(needsGlow(points), true, `${points} 分应当发光`);
    }
    for (const points of [1, 2, 4, 6, 8]) {
      assert.equal(needsGlow(points), false, `${points} 分不应发光`);
    }
  });

  it('分值越高档位越靠后', () => {
    const ordered = [1, 2, 4, 6, 8, 12, 16, 24];
    for (let index = 1; index < ordered.length; index += 1) {
      assert.ok(
        YAKU_TIERS.indexOf(yakuTierOf(ordered[index])) >
          YAKU_TIERS.indexOf(yakuTierOf(ordered[index - 1])),
        `${ordered[index]} 分应当比 ${ordered[index - 1]} 分颜色更重`,
      );
    }
  });
});

describe('番种排序', () => {
  it('按分值从大到小排列，同分保持原顺序', () => {
    const input = [
      { name: '一杠', points: 1 },
      { name: '清一色', points: 6 },
      { name: '三步高', points: 4 },
      { name: '四连环', points: 8 },
      { name: '三色同顺', points: 2 },
      { name: '一般高', points: 1 },
    ];
    const names = sortYakuByPoints(input).map((hit) => hit.name);
    assert.deepEqual(names, [
      '四连环',
      '清一色',
      '三步高',
      '三色同顺',
      '一杠',
      '一般高',
    ]);
  });

  it('不会改动传入的数组', () => {
    const input = [
      { name: '一杠', points: 1 },
      { name: '清一色', points: 6 },
    ];
    sortYakuByPoints(input);
    assert.equal(input[0].name, '一杠');
  });
});
