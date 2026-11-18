import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KIND_COUNT, decompose, makeConfig } from '../src/index.ts';
import type { Hand } from '../src/index.ts';
import { improvingTiles, shantenOf, standardShanten } from '../src/ai/index.ts';

const cfg = makeConfig({ rounds: 4 });

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHand(random: () => number, tiles: number): Hand {
  const hand = new Uint8Array(KIND_COUNT);
  let placed = 0;
  let guard = 0;
  while (placed < tiles && guard < 10000) {
    guard += 1;
    const kind = Math.floor(random() * KIND_COUNT);
    if (hand[kind] >= 4) continue;
    hand[kind] += 1;
    placed += 1;
  }
  return hand;
}

function addRandomSet(hand: Hand, random: () => number): boolean {
  if (random() < 0.5) {
    const base = Math.floor(random() * 3) * 9 + Math.floor(random() * 7);
    if (hand[base] >= 4 || hand[base + 1] >= 4 || hand[base + 2] >= 4)
      return false;
    hand[base] += 1;
    hand[base + 1] += 1;
    hand[base + 2] += 1;
    return true;
  }
  const kind = Math.floor(random() * KIND_COUNT);
  if (hand[kind] > 1) return false;
  hand[kind] += 3;
  return true;
}

function addRandomPair(hand: Hand, random: () => number): boolean {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const kind = Math.floor(random() * KIND_COUNT);
    if (hand[kind] > 2) continue;
    hand[kind] += 2;
    return true;
  }
  return false;
}

/** 直接拼出"4 面子 + 雀头"，保证是一手能和的手牌。 */
function buildWinningHand(random: () => number): Hand {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const hand = new Uint8Array(KIND_COUNT);
    let ok = true;
    for (let set = 0; set < 4 && ok; set += 1) ok = addRandomSet(hand, random);
    if (!ok) continue;
    if (!addRandomPair(hand, random)) continue;
    return hand;
  }
  throw new Error('未能构造出和牌手牌');
}

/**
 * 未做任何剪枝的参考实现，用来验证正式实现里的两个剪枝没有改变结果。
 * 结构上和 `standardShanten` 同源，但分支全开。
 */ function referenceStandardShanten(
  concealed: Hand,
  meldCount: number,
): number {
  const limit = 4 - meldCount;
  const counts = concealed.slice();
  let best = 0;

  const walk = (
    kind: number,
    melds: number,
    partials: number,
    head: number,
  ): void => {
    const score = 2 * melds + partials + head;
    if (score > best) best = score;
    if (kind >= KIND_COUNT) return;
    if (counts[kind] === 0) {
      walk(kind + 1, melds, partials, head);
      return;
    }
    const canAdd = melds + partials < limit;

    if (canAdd && counts[kind] >= 3) {
      counts[kind] -= 3;
      walk(kind, melds + 1, partials, head);
      counts[kind] += 3;
    }
    if (
      canAdd &&
      kind < 27 &&
      kind % 9 <= 6 &&
      counts[kind + 1] > 0 &&
      counts[kind + 2] > 0
    ) {
      counts[kind] -= 1;
      counts[kind + 1] -= 1;
      counts[kind + 2] -= 1;
      walk(kind, melds + 1, partials, head);
      counts[kind] += 1;
      counts[kind + 1] += 1;
      counts[kind + 2] += 1;
    }
    if (head === 0 && counts[kind] >= 2) {
      counts[kind] -= 2;
      walk(kind, melds, partials, 1);
      counts[kind] += 2;
    }
    if (canAdd && counts[kind] >= 2) {
      counts[kind] -= 2;
      walk(kind, melds, partials + 1, head);
      counts[kind] += 2;
    }
    if (canAdd && kind < 27 && kind % 9 <= 7 && counts[kind + 1] > 0) {
      counts[kind] -= 1;
      counts[kind + 1] -= 1;
      walk(kind, melds, partials + 1, head);
      counts[kind] += 1;
      counts[kind + 1] += 1;
    }
    if (canAdd && kind < 27 && kind % 9 <= 6 && counts[kind + 2] > 0) {
      counts[kind] -= 1;
      counts[kind + 2] -= 1;
      walk(kind, melds, partials + 1, head);
      counts[kind] += 1;
      counts[kind + 2] += 1;
    }
    walk(kind + 1, melds, partials, head);
  };

  walk(0, 0, 0, 0);
  return 8 - 2 * meldCount - best;
}

describe('向听数：剪枝等价性', () => {
  it('正式实现与未剪枝参考实现在 300 手随机牌上结果一致', () => {
    const random = mulberry32(0x5eed);
    for (let index = 0; index < 300; index += 1) {
      const meldCount = index % 3;
      const tiles = 13 - meldCount * 3;
      const hand = randomHand(random, tiles);
      const actual = standardShanten(hand, meldCount);
      const expected = referenceStandardShanten(hand, meldCount);
      assert.equal(
        actual,
        expected,
        `第 ${index} 手不一致（副露 ${meldCount}）：实际 ${actual}，参考 ${expected}`,
      );
    }
  });
});

describe('向听数：不变量', () => {
  it('随机手牌的向听数不小于 -1', () => {
    const random = mulberry32(0xbeef);
    for (let index = 0; index < 200; index += 1) {
      const hand = randomHand(random, 13 + (index % 2));
      assert.ok(shantenOf(hand, 0, cfg).value >= -1);
    }
  });

  it('能和的 14 张手牌向听数必为 -1', () => {
    // 随机发牌凑出和牌的概率太低，这里直接构造"4 面子 + 雀头"
    const random = mulberry32(0xc0de);
    for (let index = 0; index < 200; index += 1) {
      const hand = buildWinningHand(random);
      assert.ok(decompose(hand, [], cfg).length > 0, '构造出来的手牌应当能和');
      assert.equal(standardShanten(hand, 0), -1);
      assert.equal(shantenOf(hand, 0, cfg).value, -1);
    }
  });

  it('未和牌的 13 张手牌一定有进张', () => {
    const random = mulberry32(0xf00d);
    let checked = 0;
    for (let index = 0; index < 120; index += 1) {
      const hand = randomHand(random, 13);
      const value = shantenOf(hand, 0, cfg).value;
      if (value < 0 || value > 6) continue; // 太远的牌进张可能全被别人摸走，跳过
      checked += 1;
      assert.ok(
        improvingTiles(hand, [], cfg).tiles.length > 0,
        `向听 ${value} 却没有进张`,
      );
    }
    assert.ok(checked > 0);
  });
});
