// PyTorch → TypeScript 数值一致性校验（Node 侧）。
//
// 读 tools/torch/parity.py 产出的 weights.ts（base64 权重）和参考输入，用真正的 TS 推理代码
// 重算一遍，断言两边输出一致。解码走的是线上同一个 `decodeWeights`。
//
// 用法：npm run check:parity
import { readFileSync } from 'node:fs';

import { predict } from '../packages/core/src/ai/nn/mlp.ts';
import { decodeWeights } from '../packages/core/src/ai/nn/model.ts';
import {
  NN_DIM0,
  NN_DIM1,
  NN_DIM2,
  NN_WEIGHTS_B64,
} from '../.data/parity-weights.ts';

const TOLERANCE = 1e-5;

const weights = decodeWeights(NN_DIM0, NN_DIM1, NN_DIM2, NN_WEIGHTS_B64);
const payload = JSON.parse(readFileSync('.data/parity-vectors.json', 'utf8'));
const { cases } = payload;

let maxDiff = 0;
let maxOut = 0;
let worst = null;

for (const [index, item] of cases.entries()) {
  const actual = predict(weights, Float32Array.from(item.input));
  const diff = Math.abs(actual - item.expected);
  if (Math.abs(item.expected) > maxOut) maxOut = Math.abs(item.expected);
  if (diff > maxDiff) {
    maxDiff = diff;
    worst = { index, actual, expected: item.expected };
  }
}

const dims = `${weights.dim0}→${weights.dim1}→${weights.dim2}→1`;
console.log(
  `结构 ${dims} · 用例 ${cases.length} 个 · 输出量级 ${maxOut.toFixed(4)}`,
);
console.log(`最大绝对误差 ${maxDiff.toExponential(2)}`);

if (maxDiff > TOLERANCE) {
  console.error(
    `✖ 超出容差 ${TOLERANCE}：第 ${worst.index} 个用例 actual=${worst.actual} expected=${worst.expected}`,
  );
  process.exit(1);
}

console.log(`✓ PyTorch 与 TypeScript 前向一致（容差 ${TOLERANCE}）`);
