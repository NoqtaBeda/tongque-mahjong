import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sidewaysIndex } from '../src/meld.ts';
import type { Meld } from '../../core/src/index.ts';

const pon = (from?: number): Meld => ({
  kind: 'pon',
  tiles: [5, 5, 5],
  from,
  called: 5,
});
const minkan = (from?: number): Meld => ({
  kind: 'minkan',
  tiles: [5, 5, 5, 5],
  from,
  called: 5,
});
const kakan = (from?: number): Meld => ({
  kind: 'kakan',
  tiles: [5, 5, 5, 5],
  from,
  called: 5,
});
const chi = (from?: number): Meld => ({
  kind: 'chi',
  tiles: [0, 1, 2],
  from,
  called: 1,
});
const ankan: Meld = { kind: 'ankan', tiles: [5, 5, 5, 5] };

describe('副露摆放规范', () => {
  it('吃：鸣来的牌横置在左端', () => {
    assert.equal(sidewaysIndex(chi(3), 0, 4), 0);
  });

  it('碰：上家 → 左端、对家 → 中间、下家 → 右端', () => {
    // 我是 0 号位：上家 = 3、对家 = 2、下家 = 1
    assert.equal(sidewaysIndex(pon(3), 0, 4), 0, '碰上家应横置左端');
    assert.equal(sidewaysIndex(pon(2), 0, 4), 1, '碰对家应横置中间');
    assert.equal(sidewaysIndex(pon(1), 0, 4), 2, '碰下家应横置右端');
  });

  it('大明杠：四张里同样按来源放第 1 / 2 / 3 张', () => {
    assert.equal(sidewaysIndex(minkan(3), 0, 4), 0);
    assert.equal(sidewaysIndex(minkan(2), 0, 4), 1);
    assert.equal(sidewaysIndex(minkan(1), 0, 4), 2);
  });

  it('加杠沿用原碰的横置位置', () => {
    assert.equal(sidewaysIndex(kakan(3), 0, 4), 0);
    assert.equal(sidewaysIndex(kakan(1), 0, 4), 2);
  });

  it('暗杠没有横置牌（四张全部亮出）', () => {
    assert.equal(sidewaysIndex(ankan, 0, 4), -1);
  });

  it('三麻：只有上家 / 下家两个方向', () => {
    // 3 人桌，我是 0 号位：上家 = 2、下家 = 1
    assert.equal(sidewaysIndex(pon(2), 0, 3), 0, '三麻碰上家也是左端');
    assert.equal(sidewaysIndex(pon(1), 0, 3), 2, '三麻碰下家也是右端');
  });

  it('旧存档没有来源信息时不横置（不会瞎猜) ', () => {
    assert.equal(sidewaysIndex(pon(undefined), 0, 4), -1);
    assert.equal(
      sidewaysIndex(chi(undefined), 0, 4),
      0,
      '吃永远在左端，不依赖来源',
    );
  });
});
