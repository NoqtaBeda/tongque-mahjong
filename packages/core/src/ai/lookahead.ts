import { KIND_COUNT } from '../tiles.ts';
import type { Hand, Meld } from '../tiles.ts';
import type { RuleConfig } from '../config.ts';
import { shantenOf } from './shanten.ts';
import { improvingTiles } from './ukeire.ts';
import type { Ukeire } from './ukeire.ts';

function usedTiles(
  concealed: Hand,
  melds: readonly Meld[],
  visible: Hand | undefined,
): Hand {
  const used = concealed.slice();
  for (const meld of melds) {
    for (const tile of meld.tiles) used[tile] += 1;
  }
  if (visible !== undefined) {
    for (let kind = 0; kind < KIND_COUNT; kind += 1)
      used[kind] += visible[kind];
  }
  return used;
}

/** 在 14 张手牌里挑一个最优点数的打牌，返回打完后剩下的进张数。 */
function bestUkeireAfterDiscard(
  hand14: Hand,
  melds: readonly Meld[],
  cfg: RuleConfig,
  visible: Hand | undefined,
): number {
  let bestShanten = 99;
  let bestTile = -1;

  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (hand14[kind] === 0) continue;
    hand14[kind] -= 1;
    const value = shantenOf(hand14, melds.length, cfg).value;
    hand14[kind] += 1;
    if (value < bestShanten) {
      bestShanten = value;
      bestTile = kind;
    }
  }
  if (bestTile < 0) return 0;

  hand14[bestTile] -= 1;
  const ukeire = improvingTiles(hand14, melds, cfg, visible).count;
  hand14[bestTile] += 1;
  return ukeire;
}

/**
 * 一步前瞻：打掉某张后，按剩余张数加权地估"再摸一手、再打一手之后还剩多少进张"。
 *
 * 只看进张而不看番种，是因为番种潜力变化太慢，一步之内几乎不动；这一步主要为的是
 * 区分"进张面宽但很快会堵死"和"进张面窄但越摸越顺"这两种形状。
 *
 * `base` 是已经算好的 13 张手牌进张，避免重复计算。
 */
export function expectedUkeireAfterDraw(
  hand13: Hand,
  melds: readonly Meld[],
  cfg: RuleConfig,
  visible: Hand | undefined,
  base: Ukeire | undefined,
  branch = 4,
): number {
  if (branch <= 0) return 0;
  const ukeire = base ?? improvingTiles(hand13, melds, cfg, visible);
  if (ukeire.tiles.length === 0) return 0;

  const used = usedTiles(hand13, melds, visible);
  const branches = ukeire.tiles
    .map((tile) => ({ tile, remaining: Math.max(1, 4 - used[tile]) }))
    .sort((a, b) => b.remaining - a.remaining || a.tile - b.tile)
    .slice(0, branch);

  const hand14 = hand13.slice();
  let total = 0;
  let weightSum = 0;

  for (const { tile, remaining } of branches) {
    hand14[tile] += 1;
    const ukeireNext = bestUkeireAfterDiscard(hand14, melds, cfg, visible);
    hand14[tile] -= 1;
    total += remaining * ukeireNext;
    weightSum += remaining;
  }

  return weightSum === 0 ? 0 : total / weightSum;
}
