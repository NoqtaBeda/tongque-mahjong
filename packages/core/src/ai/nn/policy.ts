/**
 * 策略头（P0）：`dim0 -> dim1 -> dim2 -> 34`，输出每张牌打出去的 logit。
 *
 * 和 `mlp.ts` 是同一套权重布局，只是输出层从 1 个标量变成 34 个。
 * 训练端见 `tools/torch/train-policy.py`，导出格式见 `write_policy_ts`。
 *
 * 用法上它是**附加项**：`discard.ts` 把 `logit[tile] * policyWeight` 加到价值里，
 * 而不是替换掉原来的启发式 + 价值网络，这样权重可以从 0 开始慢慢调。
 */
export interface PolicyWeights {
  readonly dim0: number;
  readonly dim1: number;
  readonly dim2: number;
  /** 输出维度（牌种数，34） */
  readonly tiles: number;
  /** dim1 × dim0，行主序 */
  readonly w1: Float32Array;
  readonly b1: Float32Array;
  /** dim2 × dim1 */
  readonly w2: Float32Array;
  readonly b2: Float32Array;
  /** tiles × dim2 */
  readonly w3: Float32Array;
  readonly b3: Float32Array;
}

/** 前向并返回 34 个 logit（未归一化，比较大小用不着 softmax） */
export function policyLogits(
  weights: PolicyWeights,
  input: Float32Array,
): Float32Array {
  const { dim0, dim1, dim2, tiles, w1, b1, w2, b2, w3, b3 } = weights;

  const a1 = new Float32Array(dim1);
  for (let row = 0; row < dim1; row += 1) {
    let sum = b1[row];
    const offset = row * dim0;
    for (let col = 0; col < dim0; col += 1) {
      sum += w1[offset + col] * input[col];
    }
    a1[row] = sum > 0 ? sum : 0;
  }

  const a2 = new Float32Array(dim2);
  for (let row = 0; row < dim2; row += 1) {
    let sum = b2[row];
    const offset = row * dim1;
    for (let col = 0; col < dim1; col += 1) sum += w2[offset + col] * a1[col];
    a2[row] = sum > 0 ? sum : 0;
  }

  const out = new Float32Array(tiles);
  for (let row = 0; row < tiles; row += 1) {
    let sum = b3[row];
    const offset = row * dim2;
    for (let col = 0; col < dim2; col += 1) sum += w3[offset + col] * a2[col];
    out[row] = sum;
  }
  return out;
}

/** 全零权重，用作占位与单测 */
export function zeroPolicyWeights(
  dim0: number,
  dim1: number,
  dim2: number,
  tiles = 34,
): PolicyWeights {
  return {
    dim0,
    dim1,
    dim2,
    tiles,
    w1: new Float32Array(dim1 * dim0),
    b1: new Float32Array(dim1),
    w2: new Float32Array(dim2 * dim1),
    b2: new Float32Array(dim2),
    w3: new Float32Array(tiles * dim2),
    b3: new Float32Array(tiles),
  };
}

/** 导出的 TS 文件里的原始形状（每层一段 base64） */
export interface RawPolicyWeights {
  readonly dim0: number;
  readonly dim1: number;
  readonly dim2: number;
  readonly tiles: number;
  readonly w1: string;
  readonly b1: string;
  readonly w2: string;
  readonly b2: string;
  readonly w3: string;
  readonly b3: string;
}

/** base64 → Float32Array。先复制到对齐的缓冲，原因同 nn/model.ts 的注释。 */
function decodeFloats(text: string, expected: number): Float32Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.length !== expected * 4) {
    throw new Error(
      `策略权重长度不符：期望 ${expected * 4} 字节，实际 ${bytes.length} 字节`,
    );
  }
  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  return new Float32Array(aligned.buffer, 0, expected);
}

/** 把导出的原始形状解成可用权重 */
export function decodePolicyWeights(raw: RawPolicyWeights): PolicyWeights {
  const { dim0, dim1, dim2, tiles } = raw;
  return {
    dim0,
    dim1,
    dim2,
    tiles,
    w1: decodeFloats(raw.w1, dim1 * dim0),
    b1: decodeFloats(raw.b1, dim1),
    w2: decodeFloats(raw.w2, dim2 * dim1),
    b2: decodeFloats(raw.b2, dim2),
    w3: decodeFloats(raw.w3, tiles * dim2),
    b3: decodeFloats(raw.b3, tiles),
  };
}
