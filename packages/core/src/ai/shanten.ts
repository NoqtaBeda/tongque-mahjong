import { KIND_COUNT, isNumberKind, isYaochuuKind } from '../tiles.ts';
import type { Hand } from '../tiles.ts';
import type { RuleConfig } from '../config.ts';

/** 和了时的向听数 */
export const WIN_SHANTEN = -1;

/**
 * 标准型向听数：`8 - 2*(副露数 + 完整面子) - 搭子 - 雀头`。
 *
 * 单趟 DFS 同时决定面子 / 搭子 / 雀头，避免"对每个对子各跑一遍"带来的 34 倍开销。
 * 约束：面子 + 搭子 ≤ 4 − 副露数，再加一个雀头（合计 5 个块）。
 */
export function standardShanten(concealed: Hand, meldCount: number): number {
  const limit = 4 - meldCount;
  if (limit < 0) return 99;

  const counts = concealed.slice();
  let bestScore = 0;
  let tilesLeft = 0;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) tilesLeft += counts[kind];

  /**
   * @param left 还没被使用的张数，用来做上界剪枝
   *
   * 两个剪枝：
   * 1. 雀头位空着时，对子一律优先当雀头。因为"当雀头"和"当搭子"都是 +1，
   *    但雀头位只能由对子填，先用掉不会更差（等价解仍然可达）。
   * 2. 剩余牌数给出的铁上界：3m + 2p + 2h ≤ left，据此算 2m + p + h 的最大值。
   */
  const walk = (
    kind: number,
    melds: number,
    partials: number,
    head: number,
    left: number,
  ): void => {
    const score = 2 * melds + partials + head;
    if (score > bestScore) bestScore = score;

    const blockCap = limit - melds - partials;
    const structuralCap = 2 * blockCap + (1 - head);
    const tilesCap = 2 * Math.floor(left / 3) + (left % 3 === 2 ? 1 : 0);
    if (score + Math.min(structuralCap, tilesCap) <= bestScore) return;

    if (kind >= KIND_COUNT) return;
    if (counts[kind] === 0) {
      walk(kind + 1, melds, partials, head, left);
      return;
    }

    const canAddBlock = blockCap > 0;

    if (canAddBlock && counts[kind] >= 3) {
      counts[kind] -= 3;
      walk(kind, melds + 1, partials, head, left - 3);
      counts[kind] += 3;
    }
    if (
      canAddBlock &&
      isNumberKind(kind) &&
      kind % 9 <= 6 &&
      counts[kind + 1] > 0 &&
      counts[kind + 2] > 0
    ) {
      counts[kind] -= 1;
      counts[kind + 1] -= 1;
      counts[kind + 2] -= 1;
      walk(kind, melds + 1, partials, head, left - 3);
      counts[kind] += 1;
      counts[kind + 1] += 1;
      counts[kind + 2] += 1;
    }
    // 对子：雀头位空着就只试雀头（见上方剪枝说明）
    if (head === 0 && counts[kind] >= 2) {
      counts[kind] -= 2;
      walk(kind, melds, partials, 1, left - 2);
      counts[kind] += 2;
    } else if (canAddBlock && counts[kind] >= 2) {
      counts[kind] -= 2;
      walk(kind, melds, partials + 1, head, left - 2);
      counts[kind] += 2;
    }
    if (
      canAddBlock &&
      isNumberKind(kind) &&
      kind % 9 <= 7 &&
      counts[kind + 1] > 0
    ) {
      counts[kind] -= 1;
      counts[kind + 1] -= 1;
      walk(kind, melds, partials + 1, head, left - 2);
      counts[kind] += 1;
      counts[kind + 1] += 1;
    }
    if (
      canAddBlock &&
      isNumberKind(kind) &&
      kind % 9 <= 6 &&
      counts[kind + 2] > 0
    ) {
      counts[kind] -= 1;
      counts[kind + 2] -= 1;
      walk(kind, melds, partials + 1, head, left - 2);
      counts[kind] += 1;
      counts[kind + 2] += 1;
    }
    // 丢弃这一门剩下的牌
    walk(kind + 1, melds, partials, head, left - counts[kind]);
  };

  walk(0, 0, 0, 0, tilesLeft);
  return 8 - 2 * meldCount - bestScore;
}

/** 七对子向听数；`龙七对` 未开启时四张同牌只算一个对子。 */
export function sevenPairsShanten(concealed: Hand, cfg: RuleConfig): number {
  let pairs = 0;
  let kinds = 0;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    const count = concealed[kind];
    if (count === 0) continue;
    kinds += 1;
    if (count === 4 && !cfg.sevenPairsQuadAsTwoPairs) pairs += 1;
    else pairs += Math.floor(count / 2);
  }
  if (pairs > 7) pairs = 7;
  return 6 - pairs + Math.max(0, 7 - Math.min(kinds, 7));
}

/** 十三幺向听数 */
export function thirteenOrphansShanten(concealed: Hand): number {
  let kinds = 0;
  let hasPair = false;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (!isYaochuuKind(kind) || concealed[kind] === 0) continue;
    kinds += 1;
    if (concealed[kind] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

export interface ShantenInfo {
  /** 各和牌型里的最小值；-1 表示已经和了 */
  readonly value: number;
  readonly standard: number;
  readonly sevenPairs: number | null;
  readonly thirteenOrphans: number | null;
}

export function shantenOf(
  concealed: Hand,
  meldCount: number,
  cfg: RuleConfig,
): ShantenInfo {
  const standard = standardShanten(concealed, meldCount);
  // 七对子 / 十三幺 都要求门清
  const sevenPairs =
    meldCount === 0 && cfg.allowSevenPairs
      ? sevenPairsShanten(concealed, cfg)
      : null;
  const thirteenOrphans =
    meldCount === 0 && cfg.allowThirteenOrphans
      ? thirteenOrphansShanten(concealed)
      : null;

  let value = standard;
  if (sevenPairs !== null && sevenPairs < value) value = sevenPairs;
  if (thirteenOrphans !== null && thirteenOrphans < value)
    value = thirteenOrphans;
  return { value, standard, sevenPairs, thirteenOrphans };
}
