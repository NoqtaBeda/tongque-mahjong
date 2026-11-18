import { KIND_COUNT, isYaochuuKind } from '../tiles.ts';
import type { Hand, Meld } from '../tiles.ts';
import type { RuleConfig } from '../config.ts';
import { shantenOf } from './shanten.ts';

export interface Ukeire {
  /** 能推进向听数的牌种 */
  readonly tiles: readonly number[];
  /** 这些牌种在牌山里的剩余张数合计 */
  readonly count: number;
}

/**
 * 统计"进张"：让向听数下降的牌，以及它们还剩多少张。
 *
 * `visible` 是场上已经打明、已知不在牌山里的牌（他家牌河、副露），
 * 自己的手牌与副露会自动计入。
 */
export function improvingTiles(
  concealed: Hand,
  melds: readonly Meld[],
  cfg: RuleConfig,
  visible?: Hand,
): Ukeire {
  const used = concealed.slice();
  for (const meld of melds) {
    for (const tile of meld.tiles) used[tile] += 1;
  }
  if (visible !== undefined) {
    for (let kind = 0; kind < KIND_COUNT; kind += 1)
      used[kind] += visible[kind];
  }

  const baseShanten = shantenOf(concealed, melds.length, cfg).value;
  const tiles: number[] = [];
  let count = 0;

  const probe = concealed.slice();
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (used[kind] >= 4) continue;
    probe[kind] += 1;
    const next = shantenOf(probe, melds.length, cfg).value;
    probe[kind] -= 1;
    if (next < baseShanten) {
      tiles.push(kind);
      count += 4 - used[kind];
    }
  }

  return { tiles, count };
}

/** 听牌时的和牌张；未听牌返回空。 */
export function winningTiles(
  concealed: Hand,
  melds: readonly Meld[],
  cfg: RuleConfig,
  visible?: Hand,
): Ukeire {
  if (shantenOf(concealed, melds.length, cfg).value > 0) {
    return { tiles: [], count: 0 };
  }
  return improvingTiles(concealed, melds, cfg, visible);
}

const YAOTSU: readonly number[] = (() => {
  const out: number[] = [];
  for (let kind = 0; kind < KIND_COUNT; kind += 1)
    if (isYaochuuKind(kind)) out.push(kind);
  return out;
})();

/** 十三幺的待牌种类（用于展示，不参与向听计算）。 */
export function terminalKinds(): readonly number[] {
  return YAOTSU;
}
