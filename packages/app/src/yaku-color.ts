/**
 * 番种的「分值色阶」：1 分最淡（灰绿），24 分最重（亮紫 + 发光）。
 *
 * 结算面板的番种 tag、教程里的分值数字都用这套颜色，
 * 这样一眼就能看出这手牌的分主要来自哪几个大番种。
 *
 * 12 分与 13 分共用一个档位（十三幺是唯一 13 分的番种，单独一档意义不大）；
 * 12 分及以上额外加一层发光。
 */
export const YAKU_TIERS = [1, 2, 4, 6, 8, 12, 16, 24] as const;

export type YakuTier = (typeof YAKU_TIERS)[number];

export const YAKU_COLORS: Readonly<Record<YakuTier, string>> = {
  1: '#7c9a86',
  2: '#5cb98a',
  4: '#a9cf5c',
  6: '#e6c34a',
  8: '#f0a24a',
  12: '#f2725f',
  16: '#e05ca8',
  24: '#c884ff',
};

export const TOP_TIER: YakuTier = YAKU_TIERS[YAKU_TIERS.length - 1];

/**
 * 向下取档：取「不大于该分值的最近一档」，所以 13 分会落在 12 分档。
 * 低于 1 分的一律算最低档。
 */
export function yakuTierOf(points: number): YakuTier {
  if (points <= YAKU_TIERS[0]) return YAKU_TIERS[0];
  for (let index = YAKU_TIERS.length - 1; index >= 0; index -= 1) {
    if (points >= YAKU_TIERS[index]) return YAKU_TIERS[index];
  }
  return YAKU_TIERS[0];
}

export function yakuColorOf(points: number): string {
  return YAKU_COLORS[yakuTierOf(points)];
}

/** 12 分及以上（含 24 分）加同款发光，让大番种在视觉上压得住小番种 */
export function needsGlow(points: number): boolean {
  return yakuTierOf(points) >= 12;
}
