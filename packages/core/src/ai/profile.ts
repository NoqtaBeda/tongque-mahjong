import type { DiscardWeights } from './discard.ts';
import type { BiasGate, YakuBias } from './potential.ts';
import type { MlpWeights } from './nn/mlp.ts';
import type { PolicyWeights } from './nn/policy.ts';
import { DEFAULT_WEIGHTS } from './discard.ts';

export type AiLevel = 'advanced';

export interface AiProfile {
  readonly id: AiLevel;
  readonly label: string;
  readonly weights: DiscardWeights;
  /** 潜力项用哪种模型 */
  readonly valueModel: 'heuristic' | 'nn' | 'heuristic+nn';
  /** 前瞻步数；0 表示只看静态评估 */
  readonly lookahead: 0 | 1;
  /** 前瞻分数在总价值里的权重 */
  readonly lookaheadWeight: number;
  /** 前瞻时展开的进张分支数（越大越准越慢） */
  readonly branch: number;
  /** 策略头（P0）：每张候选打牌一个 logit，按 weights.policyWeight 加进价值里 */
  readonly policyWeights?: PolicyWeights;
  /** 对指定番种的额外偏好（三色 / 一色类），undefined 表示不偏 */
  readonly yakuBias?: YakuBias;
  /** 条件偏好：满足条件的那批番种才额外加权 */
  readonly biasGate?: BiasGate;
  /** 指定网络权重（A/B 实验用），不填用线上权重 */
  readonly nnWeights?: MlpWeights | readonly MlpWeights[];
}

/**
 * 进阶档 = 训练出来的神经网络估值（替换手写潜力项），系数 6000。
 *
 * 这个系数是**新规则下实测扫出来的**。强制 2 番起和之后一手做不成 2 分的牌等于废牌，
 * 打点的边际价值远比旧规则高，所以「潜力」这一项的权重被大幅放大：
 *
 *   只用启发式潜力（1024 局配对，普通档为基准）：
 *     系数 30 → 基准   800 → +0.44   1600 → +0.55   2000 → +0.55   5000 → +0.55
 *   接新网络（三个种子平均）：
 *     系数 2000 → +1.20   4000 → +1.48   5000 → +1.61   6000 → +1.74   8000 → +1.70
 *
 * 取 6000（平台峰值）。注意量纲：网络输出的是「本场期望得分」（±十几分），
 * 和手写潜力的「番数」（0..12）完全不同，所以数值上不可与普通档的 30 直接比较。
 */
export const ADVANCED_WEIGHTS: DiscardWeights = {
  ...DEFAULT_WEIGHTS,
  // 2026-11-20 番种表调整后重扫（4 万局配对 A/B，SE≈0.04）：
  //   6000 → 基准   9000 → +0.12（z=2.9）   12000 → +0.12（z=3.4）   16000 → +0.14（z=3.0）
  // 峰值在 12000 附近。原因：十三幺 13→8、混幺九 8→6、三步高 4→3、删除二连刻，
  // 手写潜力体系的绝对分值整体缩水，网络项需要更大权重才能保持量纲平衡。
  potential: 12000,
  // 放铳风险权重。**实测是负收益**：
  //   - 强强对拼 2400 局：开 6000 的一方每局少 0.86 分（SE≈0.22），
  //     200~600 局的小样本曾出现 +1.1 的假象，是噪声。
  //   - 对普通档 400 局：6000 与 0 基本持平。
  // 原因是本规则「流局无成本、自摸凭空加分」，弃和让掉的期望得分不小于省下的放铳。
  // 实现与开关保留（defense / defenseHistory / DiscardOptions.defense），默认关闭。
  defense: 0,
  // 牌河历史降权。实测是负收益（600 局 × 2 种子：关掉历史 +0.25 / +0.45），
  // 因为本规则没有振听，「对手打过的牌」根本不是安全牌，按日麻直觉降权会主动送铳。
  defenseHistory: 0,
  // 鸣牌价值评估：实测**负收益**（400 局 +3.62 → +2.95）。
  // 原因是价值函数里没有"鸣牌会损失灵活度 / 门清"这一项，只看番种潜力会过度鸣牌。
  // 保留实现与开关，默认关闭。
  meldPotential: 0,
  meldMargin: 0,
};

export const AI_PROFILES: Readonly<Record<AiLevel, AiProfile>> = {
  advanced: {
    id: 'advanced',
    label: '进阶',
    weights: ADVANCED_WEIGHTS,
    valueModel: 'nn',
    // 前瞻在评测里没有可测收益、却贵 4 倍，因此默认关闭；需要时可用
    // DiscardOptions.lookahead 单独打开（scripts/eval.ts 的 --lw / --branch）。
    lookahead: 0,
    lookaheadWeight: 0,
    branch: 0,
    // 三色 / 一色类番种的偏好（1200 局 × 多配置实测，见 tongque-plan.md）：
    //   三色同顺 6.37% → 13.07%   清一色 6.48% → 8.75%   混一色 37.43% → 38.86%
    //   平均打点 3.41 → 3.75      和牌率 73.3% → 71.4%（~1 SE）
    //   同桌对抗（400 番）：−0.21 分/番，194 胜 / 189 负 —— 统计上与基线持平
    yakuBias: {
      // 2026-11-20：pw 提到 12000 后，旧偏好（1.2~1.65）在 24000 局下是 −0.36 分/局；
      // 实测「轻偏好」（≈1.15）与完全关闭无差异（−0.02，噪声内），所以只保留三色/清龙/三连环的轻偏好。
      // 注意 biasScoreOf 里 weight ≤ 1 等于关闭，不要写 0.x 的值（会静默失效）。
      'sanse-tongshun': 1.16,
      // 一色组合类：只在单色手牌里追（见 biasGate）
      qinglong: 1.12,
      sanlianhuan: 1.12,
    },
    biasGate: {
      requires: 'qingyise',
      minProgress: 0.5,
      keys: ['qinglong', 'sanlianhuan'],
    },
  },
};

export function profileOf(level: AiLevel): AiProfile {
  return AI_PROFILES[level];
}
