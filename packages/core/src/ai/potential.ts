import { KIND_COUNT, isYaochuuKind } from '../tiles.ts';
import { SCORE_CAP, YAKU } from '../yaku.ts';
import type { YakuKey } from '../yaku.ts';
import {
  allTripletKinds,
  countNumberSuits,
  hasPair,
  hasTriplet,
  runCopies,
  runShape,
} from './features.ts';
import type { HandFeatures } from './features.ts';

export interface Prospect {
  readonly key: YakuKey;
  /** 0..1：当前手牌距离该番种有多近 */
  readonly progress: number;
}

export interface Potential {
  readonly prospects: readonly Prospect[];
  /** 加权后的潜在分值，用于比较不同打法 */
  readonly score: number;
}

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

const ratio = (have: number, need: number): number =>
  need <= 0 ? 1 : clamp01(have / need);

/**
 * 估算每个番种的"进度"。
 *
 * 这是启发式，不是精确判定：它只读计数数组与副露，不做完整拆解。
 * 目的是让 L0 AI 知道"这手牌大概值多少钱"，从而在 2 番起和的约束下做出取舍。
 * 未建模的番种（九莲宝灯、镜同、两般高以上的对称类）不会出现在结果里。
 */
export function yakuProspects(features: HandFeatures): Prospect[] {
  const f = features;
  const out: Prospect[] = [];
  const add = (key: YakuKey, progress: number): void => {
    if (progress > 0) out.push({ key, progress: clamp01(progress) });
  };

  const total = Math.max(1, f.total);
  const suits = f.suitTiles;
  const maxSuit = Math.max(suits[0], suits[1], suits[2]);
  const minSuit = Math.min(suits[0], suits[1], suits[2]);
  const honor = f.honorTiles;
  const numberSuits = countNumberSuits(f);
  const triplets = allTripletKinds(f);
  const pairs = f.pairKinds;

  // ── 花色类 ──
  add('qingyise', maxSuit / total);
  add('hunyise', ((maxSuit + honor) / total) * (honor > 0 ? 1 : 0.85));
  if (honor === 0 && numberSuits === 2) add('queyimen', 1);
  else if (honor === 0 && numberSuits === 3)
    add('queyimen', (total - minSuit) / total);
  add('ziyise', honor / total);

  // ── 数字聚合类 ──
  if (honor === 0 && f.rankMin !== null && f.rankMax !== null) {
    const span = f.rankMax - f.rankMin;
    add('juwushu', 1 - Math.abs(span - 4) / 3);
    add('jusishu', 1 - Math.abs(span - 3) / 3);
    add('jusanshu', 1 - Math.abs(span - 2) / 3);
    add('juliangshu', 1 - Math.abs(span - 1) / 3);
  }

  // ── 刻杠类 ──
  add('pengpenghe', (triplets.length + pairs.length * 0.5) / 4);
  add('yigang', f.kanCount === 1 ? 1 : 0);
  add('lianggang', f.kanCount === 2 ? 1 : 0);
  add('sangang', f.kanCount === 3 ? 1 : 0);
  add('sigang', f.kanCount === 4 ? 1 : 0);

  // ── 七对子 ──
  let pairSlots = 0;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    pairSlots += Math.floor(f.concealed[kind] / 2);
  }
  add('qiduizi', pairSlots / 7);

  // ── 幺九类 ──
  const yaochuuRatio = f.yaochuuTiles / total;
  add('hun-yaojiu', yaochuuRatio * (honor > 0 ? 1 : 0.8));
  add('qing-yaojiu', yaochuuRatio * (honor === 0 ? 1 : 0.4));
  add('hun-quan-dai-yaojiu', yaochuuRatio * (honor > 0 ? 1 : 0.7));
  add('chun-quan-dai-yaojiu', yaochuuRatio * (honor === 0 ? 1 : 0.4));

  // ── 字牌类 ──
  const windTriplets = triplets.filter(
    (kind) => kind >= 27 && kind <= 30,
  ).length;
  const windPairs = pairs.filter((kind) => kind >= 27 && kind <= 30).length;
  const dragonTriplets = triplets.filter((kind) => kind >= 31).length;
  const dragonPairs = pairs.filter((kind) => kind >= 31).length;
  const ownWind = 27 + f.seatWind;

  add('menfengke', hasTriplet(f, ownWind) ? 1 : hasPair(f, ownWind) ? 0.4 : 0);
  add('xiao-san-feng-ke', (ratio(windTriplets, 2) + ratio(windPairs, 1)) / 2);
  add('san-feng-ke', ratio(windTriplets, 3));
  add('xiao-sixi', (ratio(windTriplets, 3) + ratio(windPairs, 1)) / 2);
  add('da-sixi', ratio(windTriplets, 4));
  add('sanyuanke', dragonTriplets > 0 ? 1 : dragonPairs > 0 ? 0.4 : 0);
  add('xiao-sanyuan', (ratio(dragonTriplets, 2) + ratio(dragonPairs, 1)) / 2);
  add('da-sanyuan', ratio(dragonTriplets, 3));

  // ── 三色组合类 ──
  // 用"半成顺子"的连续度衡量：一副完整顺子 + 另一门快成时就有明显进度，
  // 而不是要等到两门都齐了（分档 0/0.33/0.67/1）才被发现。
  let bestThreeColourRun = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    let sum = 0;
    for (let suit = 0; suit < 3; suit += 1) sum += runShape(f, suit, offset);
    if (sum / 3 > bestThreeColourRun) bestThreeColourRun = sum / 3;
  }
  add('sanse-tongshun', bestThreeColourRun);

  let bestThreeColourTrip = 0;
  let bestDoubleTrip = 0;
  let bestSmallThreeColour = 0;
  for (let rank = 1; rank <= 9; rank += 1) {
    let suitsWithTriplet = 0;
    let hasRankPair = false;
    for (let suit = 0; suit < 3; suit += 1) {
      const kind = suit * 9 + (rank - 1);
      if (hasTriplet(f, kind)) suitsWithTriplet += 1;
      else if (hasPair(f, kind)) hasRankPair = true;
    }
    bestThreeColourTrip = Math.max(
      bestThreeColourTrip,
      ratio(suitsWithTriplet, 3),
    );
    bestDoubleTrip = Math.max(bestDoubleTrip, ratio(suitsWithTriplet, 2));
    const small = (ratio(suitsWithTriplet, 2) + (hasRankPair ? 1 : 0)) / 2;
    bestSmallThreeColour = Math.max(bestSmallThreeColour, small);
  }
  add('sanse-tongke', bestThreeColourTrip);
  add('ertongke', bestDoubleTrip);
  add('xiao-san-se-tongke', bestSmallThreeColour);

  // ── 一色组合类 ──
  let maxRunCopies = 0;
  let runGroups = 0;
  for (let suit = 0; suit < 3; suit += 1) {
    for (let offset = 0; offset < 7; offset += 1) {
      const copies = runCopies(f, suit, offset);
      if (copies > maxRunCopies) maxRunCopies = copies;
      if (copies >= 2) runGroups += 1;
    }
  }
  add('yibangao', ratio(maxRunCopies, 2));
  add('liangbangao', ratio(runGroups, 2));
  add('yise-santongshun', ratio(maxRunCopies, 3));
  add('yise-sitongshun', ratio(maxRunCopies, 4));

  const runPattern = (patterns: readonly (readonly number[])[]): number => {
    let best = 0;
    for (let suit = 0; suit < 3; suit += 1) {
      for (const pattern of patterns) {
        let sum = 0;
        for (const offset of pattern)
          sum += Math.min(1, runCopies(f, suit, offset));
        const progress = sum / pattern.length;
        if (progress > best) best = progress;
      }
    }
    return best;
  };

  add('qinglong', runPattern([[0, 3, 6]]));
  add(
    'sanlianhuan',
    runPattern([
      [0, 2, 4],
      [1, 3, 5],
      [2, 4, 6],
    ]),
  );
  add(
    'sanbugao',
    runPattern([
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 4],
      [3, 4, 5],
      [4, 5, 6],
    ]),
  );
  add('silianhuan', runPattern([[0, 2, 4, 6]]));
  add(
    'sibugao',
    runPattern([
      [0, 1, 2, 3],
      [1, 2, 3, 4],
      [2, 3, 4, 5],
      [3, 4, 5, 6],
    ]),
  );

  const tripletChain = (length: number): number => {
    let best = 0;
    for (let suit = 0; suit < 3; suit += 1) {
      const base = suit * 9;
      for (let from = 0; from + length <= 9; from += 1) {
        let sum = 0;
        for (let i = 0; i < length; i += 1)
          sum += hasTriplet(f, base + from + i) ? 1 : 0;
        const progress = sum / length;
        if (progress > best) best = progress;
      }
    }
    return best;
  };

  add('erlianke', tripletChain(2));
  add('sanlianke', tripletChain(3));
  add('silianke', tripletChain(4));

  // ── 特殊和牌型 ──
  const yaochuuPair = pairs.some((kind) => isYaochuuKind(kind));
  add('shisansan', (ratio(f.yaochuuKinds, 13) + (yaochuuPair ? 1 : 0)) / 2);

  return out;
}

/** 单个番种的潜在分值（进度低于阈值的不计入，避免噪声）。 */
export const POTENTIAL_THRESHOLD = 0.35;

/** 按已算好的 prospects 求潜力分（避免每张候选牌重复跑一遍 yakuProspects）。 */
export function scoreProspects(prospects: readonly Prospect[]): number {
  let sum = 0;
  for (const prospect of prospects) {
    if (prospect.progress < POTENTIAL_THRESHOLD) continue;
    sum += YAKU[prospect.key].points * prospect.progress * prospect.progress;
  }
  return Math.min(SCORE_CAP, sum);
}

export function potentialScore(features: HandFeatures): number {
  return scoreProspects(yakuProspects(features));
}

/**
 * 对指定番种的偏好系数。`bias[key] = 2` 表示该番种的潜力按两倍计。
 *
 * 收窄到少数番种上，是因为统计发现 AI 达成三色 / 一色类番种的频率明显低于人类：
 * 这些番种需要"提前定型"，而通用潜力分不足以压过进张数。
 */
export type YakuBias = Partial<Record<YakuKey, number>>;

/**
 * 偏好带来的额外潜力分，量纲与 `potentialScore` 一致（番数）。
 *
 * 只累加 `bias` 里出现、且进度过阈值的番种；`bias[key] = 1` 等于不偏。
 */
/**
 * 条件偏好：只有当 `requires` 的进度达到 `minProgress` 时，`keys` 里的偏好才生效。
 *
 * 用于「一色组合」类（清龙 / 三连环 / 三步高）：这些番种本身只有在单色手里才有意义，
 * 全局硬推会让 AI 为了凑顺子去拆牌（实测 1200 局：和牌率 72.5% → 66.6%）。
 */
export interface BiasGate {
  readonly requires: YakuKey;
  readonly minProgress: number;
  readonly keys: readonly YakuKey[];
}

function gateOpen(
  prospects: readonly Prospect[],
  gate: BiasGate | undefined,
): boolean {
  if (gate === undefined) return true;
  for (const prospect of prospects) {
    if (prospect.key === gate.requires)
      return prospect.progress >= gate.minProgress;
  }
  return false;
}

export function biasScoreOf(
  prospects: readonly Prospect[],
  bias: YakuBias,
  gate?: BiasGate,
): number {
  let sum = 0;
  const open = gateOpen(prospects, gate);
  for (const prospect of prospects) {
    if (!open && gate !== undefined && gate.keys.includes(prospect.key))
      continue;
    const weight = bias[prospect.key];
    if (weight === undefined || weight <= 1) continue;
    // 这里**不套** POTENTIAL_THRESHOLD：偏好项本来就是用来"提前定型"的，
    // 一刀切掉低进度的手牌等于没起作用。
    if (prospect.progress <= 0) continue;
    sum +=
      YAKU[prospect.key].points *
      prospect.progress *
      prospect.progress *
      (weight - 1);
  }
  return sum;
}

export function biasScore(features: HandFeatures, bias: YakuBias): number {
  return biasScoreOf(yakuProspects(features), bias);
}

export function potentialOf(features: HandFeatures): Potential {
  return {
    prospects: yakuProspects(features),
    score: potentialScore(features),
  };
}
