/**
 * 和牌手牌的分组：把一手和牌拆成「副露 → 手牌面子 → 雀头」。
 *
 * 这是**唯一**的实现。引擎在构造 `ScoringEntry` 时算一次并挂在记录上，
 * 结算面板 / 对局记录 / 本局大牌全都直接读 `entry.groups`，不再各算各的
 * （之前引擎和 UI 各有一份，七对子的 bug 就修了一处漏一处）。
 */
import type { Meld } from '../tiles.ts';
import type { HandPattern } from '../decompose.ts';
import type { GameState, RoundResult, Seat, WinGroup } from './types.ts';

function sameTiles(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((kind, index) => kind === right[index]);
}

/** 把暗牌张数展开成牌列表；铳和时要手动补上和牌张。 */
function handTiles(
  state: GameState,
  seat: Seat,
  extra: number | null,
): number[] {
  const tiles: number[] = [];
  const counts = state.hands[seat];
  for (let kind = 0; kind < counts.length; kind += 1) {
    for (let copy = 0; copy < counts[kind]; copy += 1) tiles.push(kind);
  }
  if (extra !== null) tiles.push(extra);
  return tiles.sort((a, b) => a - b);
}

/**
 * 拆分身法：
 * - 标准型：用 `pattern.sets` 与副露比对，认出来的算副露，剩下的是暗手面子，最后补雀头
 * - 七对子 / 十三幺：没有「面子 + 雀头」结构（`sets` 为空、`pair` 为 null），
 *   直接按牌张分组，否则会拆出空数组、结算面板一张牌都画不出来
 */
export function handGroups(
  state: GameState,
  seat: Seat,
  pattern: HandPattern,
  winTile: number,
  kind: RoundResult['kind'],
): WinGroup[] {
  if (pattern.type !== 'standard') {
    // 自摸时和牌张已经在手里，铳和时还没加进去
    const tiles = handTiles(state, seat, kind === 'tsumo' ? null : winTile);

    if (pattern.type === 'sevenPairs') {
      const pairs: WinGroup[] = [];
      for (let index = 0; index + 1 < tiles.length; index += 2) {
        pairs.push({
          tiles: [tiles[index], tiles[index + 1]],
          melded: false,
          pair: true,
        });
      }
      return pairs;
    }

    // 十三幺：成对的排在一起，其余按单张
    return [...new Set(tiles)].map((tile) => {
      const same = tiles.filter((value) => value === tile);
      return {
        tiles: same,
        melded: false,
        ...(same.length > 1 ? { pair: true } : {}),
      };
    });
  }

  const melds: readonly Meld[] = state.melds[seat];
  const unmatched: number[][] = melds.map((meld) => [...meld.tiles]);
  const concealed: number[][] = [];

  for (const set of pattern.sets) {
    const at = unmatched.findIndex((tiles) => sameTiles(tiles, set.tiles));
    if (at >= 0) unmatched.splice(at, 1);
    else concealed.push([...set.tiles]);
  }

  const groups: WinGroup[] = [
    ...melds.map((meld) => ({ tiles: [...meld.tiles], melded: true })),
    ...concealed.map((tiles) => ({ tiles, melded: false })),
  ];
  if (pattern.pair !== null) {
    groups.push({
      tiles: [pattern.pair[0], pattern.pair[1]],
      melded: false,
      pair: true,
    });
  }
  return groups;
}
