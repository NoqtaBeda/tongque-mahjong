// 训练一个小 MLP 预测「该座位本场的净得分变化」，然后导出成 TypeScript 权重文件。
//
// 用法：node tools/train/train.ts --data=.data/samples.bin --epochs=20
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activate } from '../../packages/core/src/ai/nn/mlp.ts';
import type { MlpWeights } from '../../packages/core/src/ai/nn/mlp.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const body = raw.replace(/^--/, '');
  const index = body.indexOf('=');
  if (index < 0) args.set(body, '1');
  else args.set(body.slice(0, index), body.slice(index + 1));
}

const DATA = args.get('data') ?? join(root, '.data', 'samples.bin');
const EPOCHS = Number(args.get('epochs') ?? 20);
const BATCH = Number(args.get('batch') ?? 256);
const LR = Number(args.get('lr') ?? 0.003);
const DIM1 = Number(args.get('hidden1') ?? 64);
const DIM2 = Number(args.get('hidden2') ?? 32);
const OUT =
  args.get('out') ??
  join(root, 'packages', 'core', 'src', 'ai', 'nn', 'weights.ts');
const SEED = Number(args.get('seed') ?? 7);
const SCALE = 12;

// ---- 读数据（--data 支持逗号分隔的多个文件，按顺序拼起来）----
const FILES = DATA.split(',')
  .map((path) => path.trim())
  .filter((path) => path.length > 0);

let count = 0;
let dim = 0;
const parsed = FILES.map((path) => {
  const raw = readFileSync(path);
  const buffer = raw.buffer.slice(
    raw.byteOffset,
    raw.byteOffset + raw.byteLength,
  );
  const view = new DataView(buffer);
  const rows = view.getUint32(0, true);
  const width = view.getUint32(4, true);
  count += rows;
  if (dim === 0) dim = width;
  else if (dim !== width) {
    console.error(`维度不一致：${path} 是 ${width}，前面是 ${dim}`);
    process.exit(1);
  }
  return { view, rows };
});
if (count === 0) {
  console.error('样本为空，先跑 tools/train/gen.ts');
  process.exit(1);
}

const features = new Float32Array(count * dim);
const targets = new Float32Array(count);
const groups = new Uint32Array(count);

let rowCursor = 0;
let groupOffset = 0;
for (const part of parsed) {
  const { view, rows } = part;
  const base = rowCursor;
  let maxGroup = 0;
  let offset = 8;
  for (let index = 0; index < rows; index += 1) {
    const group = view.getUint32(offset, true);
    groups[base + index] = group + groupOffset;
    if (group > maxGroup) maxGroup = group;
    offset += 4;
  }
  offset = 8 + rows * 4;
  for (let index = 0; index < rows; index += 1) {
    const featureBase = (base + index) * dim;
    for (let col = 0; col < dim; col += 1) {
      features[featureBase + col] = view.getFloat32(offset, true);
      offset += 4;
    }
    targets[base + index] = view.getFloat32(offset, true) / SCALE;
    offset += 4;
  }
  rowCursor = base + rows;
  // 不同文件的 group 编号要错开，否则按 group 切分时会把两批数据混进同一组
  groupOffset += maxGroup + 1;
}

function mean(values: Float32Array): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function variance(values: Float32Array): number {
  const m = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - m) * (value - m);
  return sum / values.length;
}

console.log(
  `样本 ${count} · 维度 ${dim} · 标签均值 ${(mean(targets) * SCALE).toFixed(3)} 分 · 方差 ${variance(targets).toFixed(4)}`,
);

// ---- 打乱并切分 ----
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(SEED);

// 按"本场"分组切分：同场的样本共享标签，随机按样本切会让验证集泄漏。
const uniqueGroups = [...new Set(groups)];
for (let index = uniqueGroups.length - 1; index > 0; index -= 1) {
  const swap = Math.floor(random() * (index + 1));
  const tmp = uniqueGroups[index];
  uniqueGroups[index] = uniqueGroups[swap];
  uniqueGroups[swap] = tmp;
}
const trainGroupCount = Math.max(1, Math.floor(uniqueGroups.length * 0.8));
const trainGroups = new Set(uniqueGroups.slice(0, trainGroupCount));

const trainRows: number[] = [];
const valRows: number[] = [];
for (let row = 0; row < count; row += 1) {
  if (trainGroups.has(groups[row])) trainRows.push(row);
  else valRows.push(row);
}
const trainIdx = Uint32Array.from(trainRows);
const valIdx = Uint32Array.from(valRows);
console.log(
  `分组 ${uniqueGroups.length} 场 → 训练 ${trainGroupCount} 场 / 验证 ${uniqueGroups.length - trainGroupCount} 场` +
    `（样本 ${trainIdx.length} / ${valIdx.length}）`,
);

// ---- 初始化 ----
function init(weights: MlpWeights, rng: () => number): void {
  const fill = (array: Float32Array, scale: number): void => {
    for (let index = 0; index < array.length; index += 1) {
      array[index] = (rng() * 2 - 1) * scale;
    }
  };
  fill(weights.w1, Math.sqrt(2 / (weights.dim0 + weights.dim1)));
  fill(weights.b1, 0);
  fill(weights.w2, Math.sqrt(2 / (weights.dim1 + weights.dim2)));
  fill(weights.b2, 0);
  fill(weights.w3, Math.sqrt(1 / weights.dim2));
  fill(weights.b3, 0);
}

const weights: MlpWeights = {
  dim0: dim,
  dim1: DIM1,
  dim2: DIM2,
  w1: new Float32Array(DIM1 * dim),
  b1: new Float32Array(DIM1),
  w2: new Float32Array(DIM2 * DIM1),
  b2: new Float32Array(DIM2),
  w3: new Float32Array(DIM2),
  b3: new Float32Array(1),
};
init(weights, mulberry32(SEED + 1));

// ---- Adam ----
const lrState = [
  {
    param: weights.w1,
    m: new Float32Array(weights.w1.length),
    v: new Float32Array(weights.w1.length),
  },
  {
    param: weights.b1,
    m: new Float32Array(weights.b1.length),
    v: new Float32Array(weights.b1.length),
  },
  {
    param: weights.w2,
    m: new Float32Array(weights.w2.length),
    v: new Float32Array(weights.w2.length),
  },
  {
    param: weights.b2,
    m: new Float32Array(weights.b2.length),
    v: new Float32Array(weights.b2.length),
  },
  {
    param: weights.w3,
    m: new Float32Array(weights.w3.length),
    v: new Float32Array(weights.w3.length),
  },
  {
    param: weights.b3,
    m: new Float32Array(weights.b3.length),
    v: new Float32Array(weights.b3.length),
  },
];
const grads = lrState.map((entry) => new Float32Array(entry.param.length));

let step = 0;
const beta1 = 0.9;
const beta2 = 0.999;
const eps = 1e-8;

function adamStep(): void {
  step += 1;
  const a =
    (LR * Math.sqrt(1 - Math.pow(beta2, step))) / (1 - Math.pow(beta1, step));
  for (let group = 0; group < lrState.length; group += 1) {
    const { param, m, v } = lrState[group];
    const g = grads[group];
    for (let index = 0; index < param.length; index += 1) {
      m[index] = beta1 * m[index] + (1 - beta1) * g[index];
      v[index] = beta2 * v[index] + (1 - beta2) * g[index] * g[index];
      param[index] -= (a * m[index]) / (Math.sqrt(v[index]) + eps);
      g[index] = 0;
    }
  }
}

const input = new Float32Array(dim);

function accumulate(row: number): void {
  const base = row * dim;
  for (let col = 0; col < dim; col += 1) input[col] = features[base + col];
  const target = targets[row];
  const act = activate(weights, input);
  const dOut = (act.out - target) / SCALE; // 目标已是 /SCALE，这里保持量纲一致

  // dL/dout （MSE 的导数乘以 1/%SCALE 的缩放已并入）
  const g3 = grads[4];
  const gb3 = grads[5];
  for (let j = 0; j < DIM2; j += 1) g3[j] += dOut * act.a2[j];
  gb3[0] += dOut;

  const da2 = new Float32Array(DIM2);
  for (let j = 0; j < DIM2; j += 1) da2[j] = dOut * weights.w3[j];
  const dz2 = new Float32Array(DIM2);
  for (let j = 0; j < DIM2; j += 1) dz2[j] = act.z2[j] > 0 ? da2[j] : 0;

  const g2 = grads[2];
  const gb2 = grads[3];
  for (let j = 0; j < DIM2; j += 1) {
    const d = dz2[j];
    if (d === 0) continue;
    const rowOffset = j * DIM1;
    for (let i = 0; i < DIM1; i += 1) g2[rowOffset + i] += d * act.a1[i];
    gb2[j] += d;
  }

  const da1 = new Float32Array(DIM1);
  for (let i = 0; i < DIM1; i += 1) {
    let sum = 0;
    for (let j = 0; j < DIM2; j += 1) sum += dz2[j] * weights.w2[j * DIM1 + i];
    da1[i] = sum;
  }
  const dz1 = new Float32Array(DIM1);
  for (let i = 0; i < DIM1; i += 1) dz1[i] = act.z1[i] > 0 ? da1[i] : 0;

  const g1 = grads[0];
  const gb1 = grads[1];
  for (let i = 0; i < DIM1; i += 1) {
    const d = dz1[i];
    if (d === 0) continue;
    const rowOffset = i * dim;
    for (let c = 0; c < dim; c += 1) g1[rowOffset + c] += d * input[c];
    gb1[i] += d;
  }
}

function evaluate(indices: Uint32Array): { mse: number; correlation: number } {
  let sumSq = 0;
  let sumPred = 0;
  let sumTrue = 0;
  const predictions = new Float32Array(indices.length);
  const truths = new Float32Array(indices.length);
  for (let index = 0; index < indices.length; index += 1) {
    const row = indices[index];
    const base = row * dim;
    for (let col = 0; col < dim; col += 1) input[col] = features[base + col];
    const predicted = activate(weights, input).out;
    const truth = targets[row];
    predictions[index] = predicted;
    truths[index] = truth;
    sumSq += (predicted - truth) * (predicted - truth);
    sumPred += predicted;
    sumTrue += truth;
  }
  const n = indices.length;
  const meanPred = sumPred / n;
  const meanTrue = sumTrue / n;
  let cov = 0;
  let varPred = 0;
  let varTrue = 0;
  for (let index = 0; index < n; index += 1) {
    const dp = predictions[index] - meanPred;
    const dt = truths[index] - meanTrue;
    cov += dp * dt;
    varPred += dp * dp;
    varTrue += dt * dt;
  }
  const correlation =
    varPred > 0 && varTrue > 0 ? cov / Math.sqrt(varPred * varTrue) : 0;
  return { mse: sumSq / n, correlation };
}

// ---- 训练 ----
const started = Date.now();
const batchesPerEpoch = Math.ceil(trainIdx.length / BATCH);
let cursor = 0;

// 早停：数据量小的时候后几轮一定会过拟合，导出验证集最好的一轮而不是最后一轮
let bestR = Number.NEGATIVE_INFINITY;
let bestEpoch = 0;
let bestSnapshot: Float32Array[] | null = null;

for (let epoch = 1; epoch <= EPOCHS; epoch += 1) {
  cursor = 0;
  for (let batch = 0; batch < batchesPerEpoch; batch += 1) {
    const start = cursor;
    const end = Math.min(trainIdx.length, start + BATCH);
    cursor = end;
    for (let index = start; index < end; index += 1)
      accumulate(trainIdx[index]);
    const inv = 1 / (end - start);
    for (const g of grads)
      for (let index = 0; index < g.length; index += 1) g[index] *= inv;
    adamStep();
  }
  const train = evaluate(trainIdx);
  const val = evaluate(valIdx);
  if (val.correlation > bestR) {
    bestR = val.correlation;
    bestEpoch = epoch;
    bestSnapshot = lrState.map((entry) => entry.param.slice());
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `epoch ${String(epoch).padStart(2)} · train mse ${train.mse.toFixed(5)} · val mse ${val.mse.toFixed(5)} · val r ${val.correlation.toFixed(3)} · ${elapsed}s`,
  );
}

if (bestSnapshot !== null) {
  for (let index = 0; index < lrState.length; index += 1) {
    lrState[index].param.set(bestSnapshot[index]);
  }
}

const finalVal = evaluate(valIdx);
console.log(
  `\n验证集：mse ${finalVal.mse.toFixed(5)} · 相关系数 r=${finalVal.correlation.toFixed(3)}` +
    `　（标签方差 ${variance(targets).toFixed(5)} · 取第 ${bestEpoch}/${EPOCHS} 轮）`,
);

// ---- 导出 ----
// 权重按 w1 → b1 → w2 → b2 → w3 → b3 拼成 float32 小端字节流，再 base64。
// 解码在 packages/core/src/ai/nn/model.ts，布局必须一一对应。
const payload = Buffer.concat(
  [weights.w1, weights.b1, weights.w2, weights.b2, weights.w3, weights.b3].map(
    (values) =>
      Buffer.from(values.buffer, values.byteOffset, values.byteLength),
  ),
).toString('base64');

const file = `// AUTO-GENERATED by tools/train/train.ts —— 不要手改。
// ${count} 个样本训练 · 验证集相关系数 ${finalVal.correlation.toFixed(3)}
export const NN_DIM0 = ${dim};
export const NN_DIM1 = ${DIM1};
export const NN_DIM2 = ${DIM2};

// float32 小端字节流（布局 w1 → b1 → w2 → b2 → w3 → b3），解码见同目录 model.ts
export const NN_WEIGHTS_B64 =
  '${payload}';
`;

writeFileSync(OUT, file);
console.log(`权重已写入 ${OUT}`);
