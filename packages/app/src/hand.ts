/**
 * 结算面板里「哪一张是和牌张」的判定。
 *
 * 拆成独立函数是为了能单测：`WinGroup` 带没带 `pair` 标记、同一种牌同时出现在
 * 面子和雀头里时该标哪一张，都是容易出错的地方。
 */
import type { WinGroup } from '../../core/src/index.ts';

/**
 * 和牌张在「把所有组摊平后的牌序」里的下标；没找到返回 -1。
 *
 * 规则：**优先标在面子上**。铳牌经常既能读成某个面子的一部分、又能读成雀头
 * （例如 `123 345 567 789 + 11` 里的 1），这时标在雀头里会让人误以为
 * 「这张牌是用来凑对子的」，与实际计分的番种对不上。
 */
export function winTileIndex(
  groups: readonly WinGroup[],
  winTile: number,
): number {
  const offsets: number[] = [];
  let flat = 0;
  for (const group of groups) {
    offsets.push(flat);
    flat += group.tiles.length;
  }

  const found: { readonly index: number; readonly isPair: boolean }[] = [];
  groups.forEach((group, groupIndex) => {
    group.tiles.forEach((kind, tileIndex) => {
      if (kind === winTile)
        found.push({
          index: offsets[groupIndex] + tileIndex,
          isPair: group.pair === true,
        });
    });
  });
  if (found.length === 0) return -1;

  const onSet = found.filter((item) => !item.isPair);
  const pool = onSet.length > 0 ? onSet : found;
  return pool[pool.length - 1].index;
}

/** 番种按分值从大到小排列（同分保持原有顺序，方便阅读） */
export function sortYakuByPoints<T extends { readonly points: number }>(
  hits: readonly T[],
): readonly T[] {
  return [...hits].sort((a, b) => b.points - a.points);
}
