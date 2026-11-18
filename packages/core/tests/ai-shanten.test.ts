import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeConfig, parseHand, parseMeld } from '../src/index.ts';
import {
  improvingTiles,
  sevenPairsShanten,
  shantenOf,
  standardShanten,
  thirteenOrphansShanten,
  winningTiles,
} from '../src/ai/index.ts';

const cfg = makeConfig({ rounds: 4 });

function hand(text: string) {
  return parseHand(text);
}

describe('向听数：标准型', () => {
  const cases: ReadonlyArray<readonly [string, number]> = [
    ['123m 456m 789m 123p 55s', -1],
    ['123m 456m 789m 123p 5s', 0],
    ['123m 456m 789m 12p 55s', 0],
    ['123m 456m 789m 12p 5s 9s', 1],
    ['123m 456m 789m 1p 5s 9s', 2],
    ['111z 222z 333z 444z 5z', 0],
    // 13 张彼此无关的孤张，标准型是最坏情况
    ['19m 19p 19s 1234567z', 8],
    ['123m 456m 789m 11p 2s', 1],
  ];

  for (const [text, expected] of cases) {
    it(`${text} → ${expected}`, () => {
      assert.equal(standardShanten(hand(text), 0), expected);
    });
  }

  it('副露会让副数上限减少', () => {
    // 1 副露 + 222m 333m 45m 77m：三种面子缺一副，45m 是搭子 → 听牌
    assert.equal(standardShanten(hand('222m 333m 45m 77m'), 1), 0);
  });

  it('四副面子 + 雀头即和了', () => {
    assert.equal(standardShanten(hand('222m 333m 456m 77m'), 1), -1);
  });

  it('和了时向听数为 -1，且摸到和牌张才下降', () => {
    const tenpai = hand('123m 456m 789m 123p 5s');
    assert.equal(standardShanten(tenpai, 0), 0);
    tenpai[22] += 1; // 5s
    assert.equal(standardShanten(tenpai, 0), -1);
  });
});

describe('向听数：七对子 / 十三幺', () => {
  it('七对子', () => {
    assert.equal(
      sevenPairsShanten(hand('11s 22s 44s 55s 77s 88s 99s'), cfg),
      -1,
    );
    assert.equal(sevenPairsShanten(hand('11s 22s 44s 55s 77s 88s 9s'), cfg), 0);
  });

  it('十三幺', () => {
    assert.equal(thirteenOrphansShanten(hand('1m 9m 1p 9p 1s 9s 1234567z')), 0);
    assert.equal(
      thirteenOrphansShanten(hand('11m 9m 1p 9p 1s 9s 1234567z')),
      -1,
    );
  });

  it('shantenOf 取三种和牌型的最小值', () => {
    const info = shantenOf(hand('11s 22s 44s 55s 77s 88s 99s'), 0, cfg);
    assert.equal(info.sevenPairs, -1);
    assert.equal(info.value, -1);
    assert.ok(
      info.standard !== null && info.standard > -1,
      '标准型向听数应更差',
    );
  });

  it('七对子被关闭时不参与取最小', () => {
    const strict = makeConfig({ rounds: 4, allowSevenPairs: false });
    const info = shantenOf(hand('11s 22s 44s 55s 77s 88s 99s'), 0, strict);
    assert.equal(info.sevenPairs, null);
    assert.ok(info.value >= 0);
  });

  it('七对子 / 十三幺只在门清时参与', () => {
    const melds = [parseMeld('111m')];
    const info = shantenOf(hand('11s 22s 44s 55s 77s 88s 9s'), 1, cfg);
    assert.equal(info.sevenPairs, null);
    assert.equal(info.thirteenOrphans, null);
    void melds;
  });
});

describe('有效牌', () => {
  it('单骑听：只剩一种和牌张', () => {
    const uke = improvingTiles(hand('123m 456m 789m 123p 5s'), [], cfg);
    assert.deepEqual([...uke.tiles], [22], '5s');
    assert.equal(uke.count, 3, '自己手里 1 张，剩 3 张');
  });

  it('两面听：待牌 4 张', () => {
    const uke = improvingTiles(hand('123m 456m 789m 12p 55s'), [], cfg);
    assert.deepEqual([...uke.tiles], [11], '3p');
    assert.equal(uke.count, 4);
  });

  it('visible 会扣掉场上已打明的牌', () => {
    const visible = hand('33p');
    const uke = improvingTiles(
      hand('123m 456m 789m 12p 55s'),
      [],
      cfg,
      visible,
    );
    assert.equal(uke.count, 2);
  });

  it('未听牌时 winningTiles 为空', () => {
    const uke = winningTiles(hand('123m 456m 789m 1p 5s 9s'), [], cfg);
    assert.deepEqual([...uke.tiles], []);
  });

  it('听牌时 winningTiles 与 improvingTiles 一致', () => {
    const h = hand('123m 456m 789m 12p 55s');
    assert.deepEqual(
      [...winningTiles(h, [], cfg).tiles],
      [...improvingTiles(h, [], cfg).tiles],
    );
  });
});
