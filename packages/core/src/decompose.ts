import {
  KIND_COUNT,
  chiMeld,
  handTotal,
  isNumberKind,
  isYaochuuKind,
  ponMeld,
} from './tiles.ts';
import type { Hand, Meld } from './tiles.ts';
import type { RuleConfig } from './config.ts';

export type PatternType = 'standard' | 'sevenPairs' | 'thirteenOrphans';

/**
 * 一种和牌拆解方案。
 * `sets` 恒为 4 副面子（副露在前、暗牌拆出的在后），杠按 4 张计；
 * 特殊和牌型没有面子与雀头。
 */
export interface HandPattern {
  readonly type: PatternType;
  readonly sets: readonly Meld[];
  readonly pair: readonly [number, number] | null;
}

/** 枚举所有能把 `concealed + melds` 解释成和牌的方案。 */
export function decompose(
  concealed: Hand,
  melds: readonly Meld[],
  cfg: RuleConfig,
): HandPattern[] {
  const patterns: HandPattern[] = [];
  const need = 4 - melds.length;

  if (need >= 0) {
    const counts = concealed.slice();
    for (let pairKind = 0; pairKind < KIND_COUNT; pairKind += 1) {
      if (counts[pairKind] < 2) continue;
      counts[pairKind] -= 2;
      const found: Meld[][] = [];
      collectSets(counts, need, [], found);
      for (const sets of found) {
        patterns.push({
          type: 'standard',
          sets: [...melds, ...sets],
          pair: [pairKind, pairKind],
        });
      }
      counts[pairKind] += 2;
    }
  }

  if (melds.length === 0 && handTotal(concealed) === 14) {
    if (cfg.allowSevenPairs && isSevenPairs(concealed, cfg)) {
      patterns.push({ type: 'sevenPairs', sets: [], pair: null });
    }
    if (cfg.allowThirteenOrphans && isThirteenOrphans(concealed)) {
      patterns.push({ type: 'thirteenOrphans', sets: [], pair: null });
    }
  }

  return patterns;
}

/**
 * 从最小的非零牌种开始，贪心式回溯：该牌种要么成刻，要么当顺子的头。
 * 这样每个拆解只会被枚举一次。
 */
function collectSets(
  counts: Hand,
  need: number,
  path: Meld[],
  sink: Meld[][],
): void {
  if (need === 0) {
    for (let kind = 0; kind < KIND_COUNT; kind += 1) {
      if (counts[kind] !== 0) return;
    }
    sink.push(path.slice());
    return;
  }

  let kind = 0;
  while (kind < KIND_COUNT && counts[kind] === 0) kind += 1;
  if (kind >= KIND_COUNT) return;

  if (counts[kind] >= 3) {
    counts[kind] -= 3;
    path.push(ponMeld(kind));
    collectSets(counts, need - 1, path, sink);
    path.pop();
    counts[kind] += 3;
  }

  if (
    isNumberKind(kind) &&
    kind % 9 <= 6 &&
    counts[kind + 1] > 0 &&
    counts[kind + 2] > 0
  ) {
    counts[kind] -= 1;
    counts[kind + 1] -= 1;
    counts[kind + 2] -= 1;
    path.push(chiMeld(kind));
    collectSets(counts, need - 1, path, sink);
    path.pop();
    counts[kind] += 1;
    counts[kind + 1] += 1;
    counts[kind + 2] += 1;
  }
}

export function isSevenPairs(hand: Hand, cfg: RuleConfig): boolean {
  let pairs = 0;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    const count = hand[kind];
    if (count === 0) continue;
    if (count === 2) {
      pairs += 1;
    } else if (count === 4) {
      if (!cfg.sevenPairsQuadAsTwoPairs) return false;
      pairs += 2;
    } else {
      return false;
    }
  }
  return pairs === 7;
}

export function isThirteenOrphans(hand: Hand): boolean {
  let total = 0;
  let doubled = 0;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    const count = hand[kind];
    if (count === 0) continue;
    if (!isYaochuuKind(kind)) return false;
    if (count === 1) total += 1;
    else if (count === 2) {
      total += 2;
      doubled += 1;
    } else {
      return false;
    }
  }
  return total === 14 && doubled === 1;
}
