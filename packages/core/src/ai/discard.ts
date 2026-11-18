import { KIND_COUNT } from '../tiles.ts';
import type { Hand, Meld } from '../tiles.ts';
import type { RuleConfig } from '../config.ts';
import type { Observation } from '../engine/types.ts';
import { MIN_WIN_POINTS } from '../yaku.ts';
import { extractFeatures } from './features.ts';
import { expectedUkeireAfterDraw } from './lookahead.ts';
import {
  predictValue,
  predictValueEnsemble,
  predictValueWith,
} from './nn/value.ts';
import type { MlpWeights } from './nn/mlp.ts';
import { biasScoreOf, scoreProspects, yakuProspects } from './potential.ts';
import { dangerTable } from './defense.ts';
import type { BiasGate, YakuBias } from './potential.ts';
import { shantenOf } from './shanten.ts';
import { improvingTiles } from './ukeire.ts';
import type { Ukeire } from './ukeire.ts';

export interface DiscardWeights {
  /** 向听数每降低 1 的收益 */
  readonly shanten: number;
  /** 每张有效牌的收益 */
  readonly ukeire: number;
  /** 潜在番种每 1 分的收益 */
  readonly potential: number;
  /** 手牌够不够起和分（不足 2 分根本和不了）的加成 */
  readonly winPath: number;
  /** `valueModel: 'heuristic+nn'` 时网络输出的叠加权重 */
  readonly nnBonus: number;
  /** 放铳风险的惩罚权重；0 表示完全不管防守（普通档） */
  readonly defense?: number;
  /** 牌河历史在危险度里的降权力度（0 表示忽略历史） */
  readonly defenseHistory?: number;
  /** 听牌时还保留多少防守力度（默认 0 = 听牌不防） */
  readonly foldTenpai?: number;
  /** 两向听时的防守力度（默认 0 = 不防） */
  readonly foldShanten2?: number;
  /** 三向听以上时的防守力度（默认 1） */
  readonly foldShanten3?: number;
  /** 鸣牌时"番种潜力"的权重；0 表示只看向听（普通档的旧行为） */
  readonly meldPotential?: number;
  /** 鸣牌需要超过的价值门槛，避免为小便宜拆掉门清 */
  readonly meldMargin?: number;
}

/**
 * 默认权重：向听数压倒一切，其次是进张，番种潜力作为微调。
 *
 * 之所以把向听权重放这么高，是因为规则里 `S` 只取决于和牌时的番种，
 * 而"能不能和"才是先决条件；番种潜力只在同等向听/进张时用于择优。
 *
 * `winPath` 单列一项，是因为规则要求原始和 ≥ 2 才能和牌（自摸也不行）：
 * 一手无论如何都凑不到 2 分的牌，做成了也是废牌，应该尽量避免。
 */
export const DEFAULT_WEIGHTS: DiscardWeights = {
  shanten: 1000,
  ukeire: 10,
  potential: 30,
  winPath: 400,
  // 普通档不走网络，这一项恒为 0；进阶档用 'heuristic+nn' 时才生效
  nnBonus: 0,
};

export interface DiscardCandidate {
  readonly tile: number;
  /** 打掉这张后的向听数 */
  readonly shanten: number;
  readonly ukeire: Ukeire;
  readonly potential: number;
  /** 一步前瞻分（期望的下一手进张数），未开启时为 0 */
  readonly deep: number;
  readonly value: number;
}

export interface DiscardOptions {
  readonly visible?: Hand;
  readonly weights?: DiscardWeights;
  readonly seatWind?: number;
  /** 前瞻步数，0 或 1 */
  readonly lookahead?: number;
  readonly lookaheadWeight?: number;
  readonly branch?: number;
  /** 潜力项用哪种模型：手写启发式，或训练出来的神经网络 */
  readonly valueModel?: 'heuristic' | 'nn' | 'heuristic+nn';
  /** 对指定番种的额外偏好（见 biasScore）；不传表示都不偏 */
  readonly yakuBias?: YakuBias;
  /** 指定网络权重（A/B 实验用），不传就用线上权重 */
  readonly nnWeights?: MlpWeights | readonly MlpWeights[];
  /** 条件偏好（一色组合类），不传表示全部无条件生效 */
  readonly biasGate?: BiasGate;
  /** 整局观察，用于放铳风险评估；不传则跳过防守项 */
  readonly defense?: Observation;
  /** `valueModel: 'nn'` 时需要的额外上下文 */
  readonly nnContext?: {
    readonly round: number;
    readonly isDealer: boolean;
    readonly wallRemaining: number;
    readonly score: number;
  };
}

/** 押し引き：手牌越没前途越该防；具体门槛由权重控制（默认只在向听 ≥3 时防）。 */
function shadeFold(shanten: number, weights: DiscardWeights): number {
  if (shanten <= 1) return weights.foldTenpai ?? 0;
  if (shanten === 2) return weights.foldShanten2 ?? 0;
  return weights.foldShanten3 ?? 1;
}
/** 对 14 张手牌给出全部打牌候选，按价值降序。 */
export function rankDiscards(
  concealed: Hand,
  melds: readonly Meld[],
  cfg: RuleConfig,
  options: DiscardOptions = {},
): DiscardCandidate[] {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const seatWind = options.seatWind ?? 0;
  const lookahead = options.lookahead ?? 0;
  const lookaheadWeight = options.lookaheadWeight ?? 0;
  const branch = options.branch ?? 4;

  const counts = concealed.slice();
  const candidates: DiscardCandidate[] = [];
  // 危险表整手牌只算一次：只依赖公开信息（牌河 + 副露 + 威胁度）
  const danger =
    options.defense === undefined
      ? null
      : dangerTable(options.defense, 4, weights.defenseHistory ?? 0);

  for (let tile = 0; tile < KIND_COUNT; tile += 1) {
    if (counts[tile] === 0) continue;

    counts[tile] -= 1;
    const shanten = shantenOf(counts, melds.length, cfg).value;
    const ukeire = improvingTiles(counts, melds, cfg, options.visible);
    const prospects = yakuProspects(extractFeatures(counts, melds, seatWind));
    const heuristic = scoreProspects(prospects);
    const bias =
      options.yakuBias === undefined
        ? 0
        : biasScoreOf(prospects, options.yakuBias, options.biasGate);
    // 网络输出的是「期望得分」（±十几分），和手写潜力的「番数」量纲不同，
    // 所以有两种用法：直接替换潜力项（'nn'），或叠加在潜力项之外（'heuristic+nn'）。
    const nnInput =
      options.valueModel !== 'heuristic' &&
      options.nnContext !== undefined &&
      options.visible !== undefined
        ? {
            concealed: counts,
            melds,
            visible: options.visible,
            seatWind,
            round: options.nnContext.round,
            isDealer: options.nnContext.isDealer,
            wallRemaining: options.nnContext.wallRemaining,
            score: options.nnContext.score,
            shanten,
            ukeire: ukeire.count,
            potential: heuristic,
          }
        : null;
    const nnValue =
      nnInput === null
        ? 0
        : options.nnWeights === undefined
          ? predictValue(nnInput)
          : Array.isArray(options.nnWeights)
            ? predictValueEnsemble(options.nnWeights, nnInput)
            : predictValueWith(options.nnWeights as MlpWeights, nnInput);
    const potential = options.valueModel === 'nn' ? nnValue : heuristic;
    const nnBonus =
      options.valueModel === 'heuristic+nn' ? nnValue * weights.nnBonus : 0;
    const deep =
      lookahead > 0 && lookaheadWeight > 0
        ? expectedUkeireAfterDraw(
            counts,
            melds,
            cfg,
            options.visible,
            ukeire,
            branch,
          )
        : 0;
    counts[tile] += 1;

    // 押し引き：手牌越没前途越该防。本规则集"流局无成本、自摸凭空加分"，
    // 所以好牌（听牌 / 一向听）几乎不该为了避铳而拆掉 —— 全局一律防守会掉分（实测 3.40 → 1.37）。
    const fold = shadeFold(shanten, weights);
    const loss = danger === null ? 0 : danger[tile] * fold;

    const value =
      (8 - shanten) * weights.shanten +
      ukeire.count * weights.ukeire +
      potential * weights.potential +
      bias * weights.potential +
      nnBonus +
      (heuristic >= MIN_WIN_POINTS ? weights.winPath : 0) +
      deep * lookaheadWeight -
      loss * (weights.defense ?? 0);

    candidates.push({ tile, shanten, ukeire, potential, deep, value });
  }

  candidates.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    if (b.ukeire.count !== a.ukeire.count)
      return b.ukeire.count - a.ukeire.count;
    return a.tile - b.tile;
  });
  return candidates;
}

export function chooseDiscard(
  concealed: Hand,
  melds: readonly Meld[],
  cfg: RuleConfig,
  options: DiscardOptions = {},
): number | null {
  const ranked = rankDiscards(concealed, melds, cfg, options);
  return ranked.length === 0 ? null : ranked[0].tile;
}
