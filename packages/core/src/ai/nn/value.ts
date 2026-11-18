import { NN_WEIGHTS } from './model.ts';
import type { MlpWeights } from './mlp.ts';
import { predict } from './mlp.ts';
import { encodeInput } from './features.ts';
import type { EncodeInput } from './features.ts';

/** 网络输出的是"本局该座位的净得分变化 / VALUE_SCALE"，用回真实分值时乘回去。 */
export const VALUE_SCALE = 12;

/** 直接用编码好的向量推理（训练/评测脚本也会用）。 */
export function predictFromFeatures(input: Float32Array): number {
  return predict(NN_WEIGHTS, input) * VALUE_SCALE;
}

/** 用指定的权重推理，用于"两个网络同桌对抗"这类 A/B 实验。 */
export function predictFromFeaturesWith(
  weights: MlpWeights,
  input: Float32Array,
): number {
  return predict(weights, input) * VALUE_SCALE;
}

export function predictValueWith(
  weights: MlpWeights,
  input: EncodeInput,
): number {
  return predictFromFeaturesWith(weights, encodeInput(input));
}

/**
 * 多个网络的预测取平均（ensemble）。
 *
 * 单个 2.4 万参数的小网络方差偏大，几个独立训练的网络平均一下通常能稳定提升一点；
 * 推理成本是线性的（每个网络约 2.4 万次乘加，相对整手牌的向听/进张计算可忽略）。
 */
export function predictValueEnsemble(
  weights: readonly MlpWeights[],
  input: EncodeInput,
): number {
  const encoded = encodeInput(input);
  let sum = 0;
  for (const item of weights) sum += predictFromFeaturesWith(item, encoded);
  return sum / Math.max(1, weights.length);
}

/** 预测"从当前决策点出发，这一局该座位大概能净得多少分"。 */
export function predictValue(input: EncodeInput): number {
  return predictFromFeatures(encodeInput(input));
}
