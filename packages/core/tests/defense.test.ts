import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGame, makeConfig, observe } from '../src/index.ts';
import type { Observation } from '../src/index.ts';
import {
  dangerTable,
  expectedLoss,
  seenTiles,
  threatOf,
} from '../src/ai/defense.ts';

const cfg = makeConfig({ rounds: 4 });

function fresh(): Observation {
  const state = createGame(cfg, 123);
  return observe(state, 0);
}

/** 测试里要往牌河/副露里塞数据，Observation 上的字段是只读的 */
function mutable(obs: Observation) {
  return {
    discards: obs.discards as number[][],
    melds: obs.melds as { kind: string; tiles: number[] }[][],
  };
}

describe('放铳风险评估', () => {
  it('seenTiles 汇总四家牌河与副露，且每个牌种不超过 4', () => {
    const obs = fresh();
    const view = mutable(obs);
    view.discards[0].push(0, 0, 1);
    view.discards[1].push(0);
    view.melds[2].push({ kind: 'pon', tiles: [5, 5, 5] });
    const seen = seenTiles(obs.discards, obs.melds);
    assert.equal(seen[0], 3, '0 号牌种：牌河里 3 张');
    assert.equal(seen[1], 1);
    assert.equal(seen[5], 3, '副露的 3 张也要算可见');
    for (let kind = 0; kind < seen.length; kind += 1) {
      assert.ok(seen[kind] <= 4, `牌种 ${kind} 的可见数超过 4`);
    }
  });

  it('威胁度随对手的副露与牌河推进而升高', () => {
    const obs = fresh();
    const base = threatOf(obs, 1);
    mutable(obs).melds[1].push({ kind: 'pon', tiles: [3, 3, 3] });
    const withMeld = threatOf(obs, 1);
    assert.ok(withMeld > base, '有副露的对手应当更危险');

    for (let index = 0; index < 10; index += 1)
      mutable(obs).discards[1].push(10 + index);
    assert.ok(threatOf(obs, 1) > withMeld, '牌河更长应当更危险');
  });

  it('四张全部可见的牌，风险为 0', () => {
    const obs = fresh();
    const view = mutable(obs);
    for (const river of view.discards) river.push(9, 9);
    // 9 这个牌种在四家牌河里凑满 4 张
    view.discards[0].push(9, 9);
    const seen = seenTiles(obs.discards, obs.melds);
    assert.ok(seen[9] >= 4, '测试前提：该牌种已全部可见');
    assert.equal(expectedLoss(obs, 9, seen, 4), 0, '没有剩余就不可能被铳和');
  });

  it('中张比端牌和字牌更危险（其余条件相同）', () => {
    const obs = fresh();
    const seen = seenTiles(obs.discards, obs.melds);
    const middle = expectedLoss(obs, 4, seen, 4); // 5m
    const terminal = expectedLoss(obs, 0, seen, 4); // 1m
    const honor = expectedLoss(obs, 27, seen, 4); // 东
    assert.ok(middle > terminal, '中张应当比端牌危险');
    assert.ok(middle > honor, '中张应当比字牌危险');
  });

  it('dangerTable 覆盖全部 34 个牌种', () => {
    const table = dangerTable(fresh());
    assert.equal(table.length, 34);
    for (const value of table) assert.ok(Number.isFinite(value) && value >= 0);
  });
});
