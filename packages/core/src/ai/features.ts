import { KIND_COUNT, isHonorKind, isYaochuuKind, kindRank } from '../tiles.ts';
import type { Hand, Meld } from '../tiles.ts';

/**
 * 从手牌直接读出的结构特征，供番种潜力评估使用。
 * 只依赖计数数组，不做完整拆解 —— 潜力评估是启发式，不需要精确分解。
 */
export interface HandFeatures {
  readonly concealed: Hand;
  readonly melds: readonly Meld[];
  /** 含副露在内的总张数 */
  readonly total: number;
  readonly suitTiles: readonly [number, number, number];
  readonly honorTiles: number;
  /** 暗牌里成刻（≥3 张）的牌种 */
  readonly tripletKinds: readonly number[];
  /** 暗牌里恰好一对的牌种 */
  readonly pairKinds: readonly number[];
  readonly kanCount: number;
  readonly yaochuuTiles: number;
  readonly yaochuuKinds: number;
  readonly rankMin: number | null;
  readonly rankMax: number | null;
  readonly seatWind: number;
}

export function extractFeatures(
  concealed: Hand,
  melds: readonly Meld[],
  seatWind = 0,
): HandFeatures {
  const suitTiles: [number, number, number] = [0, 0, 0];
  let honorTiles = 0;
  let yaochuuTiles = 0;
  let yaochuuKinds = 0;
  let rankMin = Number.POSITIVE_INFINITY;
  let rankMax = -1;
  let total = 0;

  const tripletKinds: number[] = [];
  const pairKinds: number[] = [];

  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    const count = concealed[kind];
    total += count;
    if (count === 0) continue;

    if (isHonorKind(kind)) {
      honorTiles += count;
    } else {
      suitTiles[Math.floor(kind / 9)] += count;
      const rank = kindRank(kind);
      if (rank < rankMin) rankMin = rank;
      if (rank > rankMax) rankMax = rank;
    }
    if (isYaochuuKind(kind)) {
      yaochuuTiles += count;
      yaochuuKinds += 1;
    }
    if (count >= 3) tripletKinds.push(kind);
    if (count === 2) pairKinds.push(kind);
  }

  let kanCount = 0;
  for (const meld of melds) {
    total += meld.tiles.length;
    if (meld.tiles.length === 4) kanCount += 1;
  }

  return {
    concealed,
    melds,
    total,
    suitTiles,
    honorTiles,
    tripletKinds,
    pairKinds,
    kanCount,
    yaochuuTiles,
    yaochuuKinds,
    rankMin: rankMax < 0 ? null : rankMin,
    rankMax: rankMax < 0 ? null : rankMax,
    seatWind,
  };
}

/** 同一花色里能凑出多少个 `[offset, offset+1, offset+2]` 顺子（按张数取最小值）。 */
export function runCopies(
  features: HandFeatures,
  suit: number,
  offset: number,
): number {
  if (suit < 0 || suit > 2) return 0;
  if (offset < 0 || offset > 6) return 0;
  const base = suit * 9 + offset;
  const hand = features.concealed;
  return Math.min(hand[base], hand[base + 1], hand[base + 2]);
}

/**
 * 某个顺子窗口的"成形度"（0..1）。
 *
 * `runCopies` 只在三张齐全时才算数，是分档的（0/1/2…），
 * 拿来做「离三色同顺还有多远」的进度太钝：手里有一副完整顺子时进度是 0.33，
 * 低于潜力阈值就完全看不见。这里按"窗口内出现了几张"给连续分。
 */
export function runShape(
  features: HandFeatures,
  suit: number,
  offset: number,
): number {
  if (suit < 0 || suit > 2) return 0;
  if (offset < 0 || offset > 6) return 0;
  const base = suit * 9 + offset;
  const hand = features.concealed;
  let have = 0;
  for (let step = 0; step < 3; step += 1) if (hand[base + step] > 0) have += 1;
  return have / 3;
}

/** 某牌种（含副露）的总张数。 */
export function tripletCount(features: HandFeatures, kind: number): number {
  let count = features.concealed[kind];
  for (const meld of features.melds) {
    if (meld.kind !== 'chi' && meld.tiles[0] === kind) count += 3;
  }
  return count;
}

export function hasTriplet(features: HandFeatures, kind: number): boolean {
  return tripletCount(features, kind) >= 3;
}

export function hasPair(features: HandFeatures, kind: number): boolean {
  return features.pairKinds.includes(kind);
}

/** 所有已经成刻的牌种（暗牌 + 副露）。 */
export function allTripletKinds(features: HandFeatures): number[] {
  const kinds = new Set<number>(features.tripletKinds);
  for (const meld of features.melds) {
    if (meld.kind !== 'chi') kinds.add(meld.tiles[0]);
  }
  return [...kinds].sort((a, b) => a - b);
}

export function countNumberSuits(features: HandFeatures): number {
  let suits = 0;
  for (let suit = 0; suit < 3; suit += 1)
    if (features.suitTiles[suit] > 0) suits += 1;
  return suits;
}

export function isNumberOnly(features: HandFeatures): boolean {
  return features.honorTiles === 0 && features.total > 0;
}

export function isHonorOnly(features: HandFeatures): boolean {
  return features.total > 0 && features.honorTiles === features.total;
}
