/**
 * 权重解码。
 *
 * `weights.ts` 里只存一个 base64 字符串（float32 的小端字节流），这里一次性解成
 * `Float32Array`。相比原来把它写成 23809 个数字字面量：
 *
 * - 模块解析从 ~51ms 降到 ~2ms（数字字面量要逐个解析成 double 再转 float32）
 * - 源头文件从 22 万字符的一行数组变成一个字符串常量
 * - 网络传输几乎不变（gzip 后 86KB → 93KB）
 *
 * 布局顺序固定为 w1 → b1 → w2 → b2 → w3 → b3，长度由三个维度推出来，
 * 所以导出侧（tools/torch/export_weights.py、tools/train/train.ts）必须按同样顺序拼接。
 */
import type { MlpWeights } from './mlp.ts';
import { NN_DIM0, NN_DIM1, NN_DIM2, NN_WEIGHTS_B64 } from './weights.ts';

/** 各段长度，顺序与导出侧一致。 */
function layout(dim0: number, dim1: number, dim2: number): number[] {
  return [dim1 * dim0, dim1, dim2 * dim1, dim2, dim2, 1];
}

/** base64 → 字节。浏览器和 Node 都有全局 `atob`，不需要区分环境。 */
function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * 把 base64 权重解成 `MlpWeights`。
 *
 * 先复制到一块新缓冲再建 `Float32Array` 视图：`atob` 出来的 `Uint8Array` 起始偏移
 * 不保证 4 字节对齐，直接建 float32 视图会抛 RangeError。95KB 的拷贝可以忽略。
 */
export function decodeWeights(
  dim0: number,
  dim1: number,
  dim2: number,
  base64: string,
): MlpWeights {
  const sizes = layout(dim0, dim1, dim2);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const bytes = decodeBase64(base64);
  if (bytes.length !== total * 4) {
    throw new Error(
      `权重长度不符：期望 ${total * 4} 字节，实际 ${bytes.length} 字节`,
    );
  }

  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  const all = new Float32Array(aligned.buffer, 0, total);

  let cursor = 0;
  const take = (size: number): Float32Array => {
    const slice = all.subarray(cursor, cursor + size);
    cursor += size;
    return slice;
  };

  return {
    dim0,
    dim1,
    dim2,
    w1: take(sizes[0]),
    b1: take(sizes[1]),
    w2: take(sizes[2]),
    b2: take(sizes[3]),
    w3: take(sizes[4]),
    b3: take(sizes[5]),
  };
}

/** 线上权重，模块加载时解码一次。 */
export const NN_WEIGHTS: MlpWeights = decodeWeights(
  NN_DIM0,
  NN_DIM1,
  NN_DIM2,
  NN_WEIGHTS_B64,
);
