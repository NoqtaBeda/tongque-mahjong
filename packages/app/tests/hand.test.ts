import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeConfig, parseHand } from '../../core/src/index.ts';
import type { WinGroup } from '../../core/src/index.ts';
import { winTileIndex } from '../src/hand.ts';

/** 摊平后取第 index 张牌 */
function tileAt(groups: readonly WinGroup[], index: number): number | null {
  let cursor = 0;
  for (const group of groups) {
    if (index < cursor + group.tiles.length) return group.tiles[index - cursor];
    cursor += group.tiles.length;
  }
  return null;
}

describe('和牌张的标注位置', () => {
  it('牌同时在面子和雀头里时，标在面子上', () => {
    // 四连环 + 清一色：123 345 567 789 + 11，铳牌是 1s
    // 这张 1s 既是 111 里的一个、又能读成雀头，展示时要标在 123 里
    const groups: WinGroup[] = [
      { tiles: [18, 19, 20], melded: false },
      { tiles: [20, 21, 22], melded: false },
      { tiles: [22, 23, 24], melded: false },
      { tiles: [24, 25, 26], melded: false },
      { tiles: [18, 18], melded: false, pair: true },
    ];
    const at = winTileIndex(groups, 18);
    assert.equal(at, 0, '应当标在 123 这张顺子的第一张上');
    assert.equal(tileAt(groups, at), 18);
    // 没有落在雀头组里
    const pairStart = groups
      .slice(0, 4)
      .reduce((sum, group) => sum + group.tiles.length, 0);
    assert.ok(at < pairStart, '和牌张不应落在雀头组');
  });

  it('单骑听牌（只在雀头里出现）仍然标在雀头上', () => {
    const groups: WinGroup[] = [
      { tiles: [0, 1, 2], melded: false },
      { tiles: [9, 10, 11], melded: false },
      { tiles: [18, 19, 20], melded: false },
      { tiles: [27, 27, 27], melded: false },
      { tiles: [33, 33], melded: false, pair: true },
    ];
    assert.equal(winTileIndex(groups, 33), 13);
  });

  it('七对子：所有对子都标了 pair，和牌张落在其中一个对子上', () => {
    const groups: WinGroup[] = [
      { tiles: [0, 0], melded: false, pair: true },
      { tiles: [3, 3], melded: false, pair: true },
      { tiles: [6, 6], melded: false, pair: true },
      { tiles: [9, 9], melded: false, pair: true },
      { tiles: [12, 12], melded: false, pair: true },
      { tiles: [15, 15], melded: false, pair: true },
      { tiles: [18, 18], melded: false, pair: true },
    ];
    const at = winTileIndex(groups, 6);
    assert.ok(at >= 4 && at <= 5, '应当落在 6 万那一对里');
  });

  it('副露组里出现和牌张也能正确定位', () => {
    const groups: WinGroup[] = [
      { tiles: [0, 1, 2], melded: false },
      { tiles: [9, 9, 9], melded: true, pair: false },
      { tiles: [18, 19, 20], melded: false },
      { tiles: [27, 28, 29], melded: false },
      { tiles: [5, 5], melded: false, pair: true },
    ];
    assert.equal(tileAt(groups, winTileIndex(groups, 28)), 28);
  });

  it('不在手里的牌返回 -1', () => {
    const groups: WinGroup[] = [
      { tiles: [0, 1, 2], melded: false },
      { tiles: [3, 3], melded: false, pair: true },
    ];
    assert.equal(winTileIndex(groups, 20), -1);
  });
});

describe('引擎给雀头打的标记', () => {
  it('标准型的最后一组是雀头', async () => {
    const { evaluateWin } = await import('../../core/src/evaluate.ts');
    const { handGroups } = await import('../../core/src/engine/groups.ts');
    const cfg = makeConfig({ rounds: 4 });
    const concealed = parseHand('11123345567789s');
    const result = evaluateWin({
      concealed,
      melds: [],
      cfg,
      winTile: 18,
      isTsumo: false,
      seatWind: 0,
    });
    assert.ok(result.isWin && result.best !== null, '这手牌应当能和');
    const state = {
      hands: [concealed],
      melds: [[]],
      cfg,
    } as unknown as Parameters<typeof handGroups>[0];
    const groups = handGroups(state, 0, result.best.pattern, 18, 'ron');
    const pairGroups = groups.filter((group) => group.pair === true);
    assert.equal(pairGroups.length, 1, '标准型应当恰好有一个雀头组');
    assert.equal(pairGroups[0].tiles.length, 2);
    assert.equal(
      groups.filter((group) => group.pair !== true).length,
      4,
      '除雀头外应当有 4 个面子组',
    );
  });
});
