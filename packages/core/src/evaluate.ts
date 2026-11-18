import { KIND_COUNT } from './tiles.ts';
import type { Hand, Meld } from './tiles.ts';
import type { RuleConfig } from './config.ts';
import { decompose } from './decompose.ts';
import type { HandPattern } from './decompose.ts';
import { detectAll } from './detect.ts';
import type { DetectCtx, WinFlags, YakuHit } from './detect.ts';
import { implies } from './implication.ts';
import {
  LIABILITY_FLOOR,
  MIN_WIN_POINTS,
  SCORE_CAP,
  SINGLE_YAKU_THRESHOLD,
} from './yaku.ts';

export interface WinInput {
  /** 暗牌，含和牌张 */
  readonly concealed: Hand;
  readonly melds?: readonly Meld[];
  readonly cfg: RuleConfig;
  readonly winTile: number;
  readonly isTsumo: boolean;
  /** 0=东 1=南 2=西 3=北 */
  readonly seatWind: number;
  readonly flags?: WinFlags;
}

export interface PatternResult {
  readonly pattern: HandPattern;
  /** 蕴含剔除后的全部达成番种 */
  readonly hits: readonly YakuHit[];
  /** 和牌者得分 S */
  readonly score: number;
  /** 蕴含剔除后的原始和（未封顶），用于 2 番起和判定 */
  readonly rawSum: number;
  /** 关联铳责 S_A */
  readonly liability: number;
  /** 取到 S_A 的那个落点（位掩码），用来判断哪些番种实际触发了铳责 */
  readonly liabilitySlot: number;
  /** 放铳者扣分 P */
  readonly penalty: number;
}

export interface WinResult {
  readonly isWin: boolean;
  readonly best: PatternResult | null;
  /** 是否满足 2 番起和（不足则只能自摸） */
  readonly ronAllowed: boolean;
  readonly patternCount: number;
}

/**
 * 剔除被蕴含的番种。
 * 判定基于"原始命中集"而非边剔除边判断，否则 四连刻→三连刻→二连刻 这类链条会断。
 */
export function dropImplied(hits: readonly YakuHit[]): YakuHit[] {
  return hits.filter(
    (target) =>
      !hits.some((source) => source !== target && implies(source, target)),
  );
}

/** S：命中 ≥12 分单番时取最大单番，否则求和后封顶 12。 */
export function computeScore(hits: readonly YakuHit[]): {
  score: number;
  rawSum: number;
} {
  let rawSum = 0;
  let maxSingle = 0;
  let hasBigSingle = false;
  for (const hit of hits) {
    rawSum += hit.points;
    if (hit.points > maxSingle) maxSingle = hit.points;
    if (hit.points >= SINGLE_YAKU_THRESHOLD) hasBigSingle = true;
  }
  const score = hasBigSingle ? maxSingle : Math.min(SCORE_CAP, rawSum);
  return { score, rawSum };
}

/**
 * 和牌门槛：排除一杠与所有 1 分偶然事件后的原始和 ≥ 2。
 * 不足 2 分**完全不能和牌**（自摸也不行），不是只限制铳和。
 */
export function meetsWinThreshold(hits: readonly YakuHit[]): boolean {
  let sum = 0;
  for (const hit of hits) {
    if (hit.key === 'yigang') continue;
    if (hit.scope === 'chance' && hit.points === 1) continue;
    sum += hit.points;
  }
  return sum >= MIN_WIN_POINTS;
}

/** 铳牌可能落在哪些位置（面子的 bit0..3，雀头 bit4）。 */
export function winSlots(pattern: HandPattern, winTile: number): number[] {
  const slots: number[] = [];
  for (let index = 0; index < pattern.sets.length; index += 1) {
    if (pattern.sets[index].tiles.includes(winTile)) slots.push(1 << index);
  }
  if (pattern.pair !== null && pattern.pair[0] === winTile) slots.push(1 << 4);
  return slots;
}

export function liabilityFor(hits: readonly YakuHit[], slot: number): number {
  let sum = 0;
  for (const hit of hits) {
    if (hit.liability === 'always') sum += hit.points;
    else if (hit.liability === 'by-meld' && (hit.meldMask & slot) !== 0)
      sum += hit.points;
  }
  return sum;
}

export function penaltyOf(liability: number): number {
  const raw = liability - LIABILITY_FLOOR;
  if (raw < 0) return 0;
  if (raw > SCORE_CAP) return SCORE_CAP;
  return raw;
}

export function evaluateWin(input: WinInput): WinResult {
  const melds = input.melds ?? [];
  const patterns = decompose(input.concealed, melds, input.cfg);
  if (patterns.length === 0) {
    return { isWin: false, best: null, ronAllowed: false, patternCount: 0 };
  }

  const ctx: DetectCtx = {
    cfg: input.cfg,
    hand: mergeHands(input.concealed, melds),
    concealed: input.concealed,
    melds,
    seatWind: input.seatWind,
    winTile: input.winTile,
    isTsumo: input.isTsumo,
    isConcealed: melds.every((meld) => meld.kind === 'ankan'),
    flags: input.flags ?? {},
  };

  let best: PatternResult | null = null;
  for (const pattern of patterns) {
    const hits = dropImplied(detectAll(pattern, ctx));
    const { score, rawSum } = computeScore(hits);

    const slots = winSlots(pattern, input.winTile);
    let liability = 0;
    let liabilitySlot = 0;
    if (slots.length === 0) {
      liability = liabilityFor(hits, 0);
    } else {
      for (const slot of slots) {
        const candidate = liabilityFor(hits, slot);
        if (candidate > liability) {
          liability = candidate;
          liabilitySlot = slot;
        }
      }
    }

    const result: PatternResult = {
      pattern,
      hits,
      score,
      rawSum,
      liability,
      liabilitySlot,
      penalty: penaltyOf(liability),
    };
    if (best === null || better(result, best)) best = result;
  }

  const allowed = best !== null && meetsWinThreshold(best.hits);
  // `best` 仍然返回（方便看零番手牌拆成了什么），但 isWin 已经反映门槛
  return {
    isWin: allowed,
    best,
    ronAllowed: allowed,
    patternCount: patterns.length,
  };
}

/** 先比 S，再比 S_A（规则文档给出的"计分最高优先 → 铳责最高优先"）。 */
function better(candidate: PatternResult, incumbent: PatternResult): boolean {
  if (candidate.score !== incumbent.score)
    return candidate.score > incumbent.score;
  return candidate.liability > incumbent.liability;
}

export function mergeHands(concealed: Hand, melds: readonly Meld[]): Hand {
  const merged = concealed.slice();
  for (const meld of melds) {
    for (const tile of meld.tiles) merged[tile] += 1;
  }
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (merged[kind] > 4)
      throw new Error(`hand has more than 4 copies of kind ${kind}`);
  }
  return merged;
}
