import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGame, emptyHand, handGroups, makeConfig } from '../src/index.ts';
import type { GameState, HandPattern } from '../src/index.ts';

const cfg = makeConfig({ rounds: 4 });

function totalTiles(groups: ReturnType<typeof handGroups>): number {
  return groups.reduce((sum, group) => sum + group.tiles.length, 0);
}

function patternOf(
  type: HandPattern['type'],
  sets: HandPattern['sets'],
  pair: HandPattern['pair'],
): HandPattern {
  return { type, sets, pair };
}

describe('和牌手牌分组', () => {
  it('标准型按面子 + 雀头分组', () => {
    const state: GameState = createGame(cfg, 1);
    state.hands[0] = emptyHand();
    state.hands[0][0] = 3; // 1m ×3
    state.hands[0][1] = 3; // 2m ×3
    state.hands[0][2] = 3; // 3m ×3
    state.hands[0][9] = 3; // 1p ×3
    state.hands[0][18] = 2; // 1s ×2

    const pattern = patternOf(
      'standard',
      [
        { kind: 'pon', tiles: [0, 0, 0] },
        { kind: 'pon', tiles: [1, 1, 1] },
        { kind: 'pon', tiles: [2, 2, 2] },
        { kind: 'pon', tiles: [9, 9, 9] },
      ],
      [18, 18],
    );

    const groups = handGroups(state, 0, pattern, 9, 'tsumo');
    assert.equal(totalTiles(groups), 14);
    assert.equal(groups.length, 5, '四副面子 + 雀头');
    assert.ok(
      groups.every((group) => group.melded === false),
      '没有副露时每组都算暗手',
    );
  });

  it('七对子按对子分组，不能是空数组', () => {
    const state: GameState = createGame(cfg, 1);
    state.hands[0] = emptyHand();
    state.hands[0][0] = 2; // 1m ×2
    state.hands[0][1] = 2; // 2m ×2
    state.hands[0][2] = 2; // 3m ×2
    state.hands[0][9] = 2; // 1p ×2
    state.hands[0][18] = 2; // 1s ×2
    state.hands[0][27] = 2; // 东 ×2
    state.hands[0][31] = 1; // 白 ×1（铳和的那张还没进手牌）

    const pattern = patternOf('sevenPairs', [], null);
    const groups = handGroups(state, 0, pattern, 31, 'ron');

    assert.equal(
      totalTiles(groups),
      14,
      `七对子应当有 14 张牌，实际 ${totalTiles(groups)}`,
    );
    assert.equal(groups.length, 7, '应当分成 7 对');
    assert.ok(
      groups.every((group) => group.tiles.length === 2),
      '每一组都应当是对子',
    );
  });

  it('十三幺按牌种分组，成对的一组', () => {
    const state: GameState = createGame(cfg, 1);
    state.hands[0] = emptyHand();
    const orphans = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
    // 手里 13 张各一张；铳和的 1m 由 handGroups 补上，凑成那一对
    for (const kind of orphans) state.hands[0][kind] = 1;

    const pattern = patternOf('thirteenOrphans', [], null);
    const groups = handGroups(state, 0, pattern, 0, 'ron');

    assert.equal(totalTiles(groups), 14);
    const pair = groups.find((group) => group.tiles.length === 2);
    assert.ok(pair !== undefined, '应当有一组是对子');
    assert.equal(pair.tiles[0], 0, '成对的应当是和牌张 1m');
  });

  it('和牌者带着副露时，副露组标记为 melded', () => {
    const state: GameState = createGame(cfg, 1);
    state.hands[0] = emptyHand();
    state.hands[0][0] = 3; // 1m ×3 暗刻
    state.hands[0][1] = 3; // 2m ×3
    state.hands[0][2] = 3; // 3m ×3
    state.hands[0][18] = 2; // 1s 雀头
    state.melds[0] = [{ kind: 'pon', tiles: [9, 9, 9] }]; // 碰了 1p

    const pattern = patternOf(
      'standard',
      [
        { kind: 'pon', tiles: [9, 9, 9] },
        { kind: 'pon', tiles: [0, 0, 0] },
        { kind: 'pon', tiles: [1, 1, 1] },
        { kind: 'pon', tiles: [2, 2, 2] },
      ],
      [18, 18],
    );

    const groups = handGroups(state, 0, pattern, 2, 'tsumo');
    assert.equal(totalTiles(groups), 14);
    const melded = groups.filter((group) => group.melded);
    assert.equal(melded.length, 1, '只有那副碰是副露');
    assert.deepEqual(melded[0].tiles, [9, 9, 9]);
  });
});
