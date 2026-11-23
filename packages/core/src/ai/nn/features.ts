import { KIND_COUNT } from '../../tiles.ts';
import type { Hand, Meld } from '../../tiles.ts';

/** 输入向量维度：改这里必须同步训练脚本和导出的权重。 */
export const NN_FEATURE_DIM = 120;

export interface EncodeInput {
  readonly concealed: Hand;
  readonly melds: readonly Meld[];
  /** 场上已经打明的牌（各家牌河 + 别家副露）。之前漏了这一项，是特征最大的短板。 */
  readonly visible: Hand;
  readonly seatWind: number;
  readonly round: number;
  readonly isDealer: boolean;
  readonly wallRemaining: number;
  readonly score: number;
  /** 当前向听数 */
  readonly shanten: number;
  /** 进张数（应已扣除可见牌） */
  readonly ukeire: number;
  /** 手写启发式的番种潜力（0..12） */
  readonly potential: number;
  /**
   * 对手威胁 / 牌河节奏（P1）。缺省时对应维度填 0，
   * 这样旧的调用方不传也能跑（只是那 7 维没有信息量）。
   */
  readonly threat?: ThreatInput;
  /**
   * 屏蔽局面级维度（76..83：牌山余量 / 庄家 / 座位风 / 分数 / 巡目）。
   *
   * 动机：这些维度在一次决策内是常数，对"选哪张"毫无区分度，但网络会把大量容量
   * 花在它们身上去拟合"本场结局"。屏蔽后网络只能从手牌本身的差异里学价值。
   */
  readonly maskPosition?: boolean;
  /**
   * 8 条主线的进行度（各 0..1，缺省填 0）。
   * 用最大值表达"这手牌在走哪条线"，让网络分得清镜同/一色三同顺这类
   * 单一 `potential` 标量表达不出的差异。
   */
  readonly routeProgress?: readonly number[] | Float32Array;
}

interface ThreatInput {
  /** 每家副露的组数（下标是座位号） */
  readonly oppMelds: readonly number[];
  /** 每家牌河的张数 */
  readonly oppDiscards: readonly number[];
  /** 自己以外所有牌河的摸切比例 0..1 */
  readonly tsumogiriRatio: number;
  /** 手牌里"孤张"（同花色 ±2 内没有别的牌）的张数 */
  readonly isolated: number;
  /** 手牌平均危险度 0..1：他家牌河里出现过的同种牌越多越危险 */
  readonly danger: number;
}

const MELD_KINDS: readonly Meld['kind'][] = [
  'chi',
  'pon',
  'minkan',
  'ankan',
  'kakan',
];

/**
 * 把决策点编码成固定长度向量。
 *
 * 刻意把向听数 / 进张 / 手写潜力也喂进去：这几项计算便宜且已经相当准，
 * 让网络只学"残差"（怎么把它们换算成期望得分），比让它从零学牌效率容易得多。
 */
export function encodeInput(input: EncodeInput): Float32Array {
  const out = new Float32Array(NN_FEATURE_DIM);
  let cursor = 0;

  // 0..33 暗牌张数
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    out[cursor] = input.concealed[kind] / 4;
    cursor += 1;
  }

  // 34..67 副露里的牌张数
  const meldTiles = new Float32Array(KIND_COUNT);
  for (const meld of input.melds) {
    for (const tile of meld.tiles) meldTiles[tile] += 1;
  }
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    out[cursor] = Math.min(1, meldTiles[kind] / 4);
    cursor += 1;
  }

  // 68..72 副露类型计数
  for (const kind of MELD_KINDS) {
    let count = 0;
    for (const meld of input.melds) if (meld.kind === kind) count += 1;
    out[cursor] = count / 4;
    cursor += 1;
  }
  // 73.. 上下文
  out[cursor] = Math.max(0, input.shanten) / 8;
  cursor += 1;
  out[cursor] = Math.min(1, input.ukeire / 30);
  cursor += 1;
  out[cursor] = Math.min(1, Math.max(0, input.potential) / 12);
  cursor += 1;
  out[cursor] = Math.min(1, input.wallRemaining / 70);
  cursor += 1;
  out[cursor] = input.isDealer ? 1 : 0;
  cursor += 1;
  for (let wind = 0; wind < 4; wind += 1) {
    out[cursor] = input.seatWind === wind ? 1 : 0;
    cursor += 1;
  }
  out[cursor] = Math.max(-1, Math.min(1, input.score / 50));
  cursor += 1;
  out[cursor] = Math.min(1, input.round / 16);
  cursor += 1;

  // 局面级维度：--mask-position 时清零（训练与实战必须一致）
  if (input.maskPosition === true) {
    for (let dim = 76; dim <= 83; dim += 1) out[dim] = 0;
  }

  // 84..117 场上已打明的牌
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    out[cursor] = Math.min(1, input.visible[kind] / 4);
    cursor += 1;
  }

  // 118 总打牌数 / 119 别家副露总数
  let discards = 0;
  for (let kind = 0; kind < KIND_COUNT; kind += 1)
    discards += input.visible[kind];
  out[cursor] = Math.min(1, discards / 70);
  cursor += 1;
  out[cursor] = Math.min(1, input.melds.length / 4);
  cursor += 1;

  return out;
}
