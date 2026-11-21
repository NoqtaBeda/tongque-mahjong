/**
 * 极小的三层 MLP：`dim0 -> dim1 -> dim2 -> 1`（回归）。
 *
 * 训练端（tools/train）和推理端共用这一份前向代码，所以不会出现
 * "训练时好好的、上线对不上"的数值漂移。模型只有几千参数，纯 JS 足够快。
 */
export interface MlpWeights {
  readonly dim1: number;
  readonly dim2: number;
  /** 输入维度 */
  readonly dim0: number;
  /** dim1 × dim0，行主序 */
  readonly w1: Float32Array;
  readonly b1: Float32Array;
  /** dim2 × dim1 */
  readonly w2: Float32Array;
  readonly b2: Float32Array;
  /** 1 × dim2 */
  readonly w3: Float32Array;
  readonly b3: Float32Array;
}

interface MlpActivation {
  readonly input: Float32Array;
  readonly z1: Float32Array;
  readonly a1: Float32Array;
  readonly z2: Float32Array;
  readonly a2: Float32Array;
  readonly out: number;
}

function reluInto(source: Float32Array, target: Float32Array): void {
  for (let index = 0; index < source.length; index += 1) {
    target[index] = source[index] > 0 ? source[index] : 0;
  }
}

/** 前向并保留中间量，训练时用。推理走 `predict` 即可。 */
export function activate(
  weights: MlpWeights,
  input: Float32Array,
): MlpActivation {
  const { dim0, dim1, dim2, w1, b1, w2, b2, w3, b3 } = weights;

  const z1 = new Float32Array(dim1);
  for (let row = 0; row < dim1; row += 1) {
    let sum = b1[row];
    const offset = row * dim0;
    for (let col = 0; col < dim0; col += 1)
      sum += w1[offset + col] * input[col];
    z1[row] = sum;
  }
  const a1 = new Float32Array(dim1);
  reluInto(z1, a1);

  const z2 = new Float32Array(dim2);
  for (let row = 0; row < dim2; row += 1) {
    let sum = b2[row];
    const offset = row * dim1;
    for (let col = 0; col < dim1; col += 1) sum += w2[offset + col] * a1[col];
    z2[row] = sum;
  }
  const a2 = new Float32Array(dim2);
  reluInto(z2, a2);

  let out = b3[0];
  for (let col = 0; col < dim2; col += 1) out += w3[col] * a2[col];

  return { input, z1, a1, z2, a2, out };
}

export function predict(weights: MlpWeights, input: Float32Array): number {
  return activate(weights, input).out;
}

/** 全零权重，用作占位（训练会覆盖它）。 */
export function zeroWeights(
  dim0: number,
  dim1: number,
  dim2: number,
): MlpWeights {
  return {
    dim0,
    dim1,
    dim2,
    w1: new Float32Array(dim1 * dim0),
    b1: new Float32Array(dim1),
    w2: new Float32Array(dim2 * dim1),
    b2: new Float32Array(dim2),
    w3: new Float32Array(dim2),
    b3: new Float32Array(1),
  };
}
