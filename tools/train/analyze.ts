// 诊断：看看各个输入特征和标签到底有没有相关性。
// 如果所有特征的相关性都接近 0，说明这个标签从当前特征里根本学不出来，不必再训网络。
//
// 用法：node tools/train/analyze.ts [--data=.data/samples.bin]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const raw = readFileSync(DATA);
const buffer = raw.buffer.slice(
  raw.byteOffset,
  raw.byteOffset + raw.byteLength,
);
const view = new DataView(buffer);
const count = view.getUint32(0, true);
const dim = view.getUint32(4, true);

let offset = 8 + count * 4; // 跳过 group 区
const features = new Float32Array(count * dim);
const targets = new Float32Array(count);
for (let row = 0; row < count; row += 1) {
  for (let col = 0; col < dim; col += 1) {
    features[row * dim + col] = view.getFloat32(offset, true);
    offset += 4;
  }
  targets[row] = view.getFloat32(offset, true);
  offset += 4;
}

function stats(values: Float32Array): { mean: number; sd: number } {
  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / values.length;
  let sq = 0;
  for (const value of values) sq += (value - mean) * (value - mean);
  return { mean, sd: Math.sqrt(sq / values.length) };
}

const targetStats = stats(targets);
console.log(
  `样本 ${count} · 标签均值 ${targetStats.mean.toFixed(3)} · 标准差 ${targetStats.sd.toFixed(3)}`,
);
console.log('（标签 = 该座位本场净得分变化）\n');

const names: string[] = [];
for (let kind = 0; kind < 34; kind += 1) names.push(`手牌${kind}`);
for (let kind = 0; kind < 34; kind += 1) names.push(`副露牌${kind}`);
names.push('吃', '碰', '明杠', '暗杠', '加杠');
const tail = [
  '向听',
  '进张',
  '手写潜力',
  '剩余牌',
  '庄家',
  '自风东',
  '自风南',
  '自风西',
  '自风北',
  '点数',
  '局数',
];
names.push(...tail);

const results: { name: string; r: number }[] = [];
for (let col = 0; col < dim; col += 1) {
  const column = new Float32Array(count);
  for (let row = 0; row < count; row += 1)
    column[row] = features[row * dim + col];
  const columnStats = stats(column);
  if (columnStats.sd < 1e-6) {
    results.push({ name: names[col] ?? `f${col}`, r: 0 });
    continue;
  }
  let cov = 0;
  for (let row = 0; row < count; row += 1) {
    cov += (column[row] - columnStats.mean) * (targets[row] - targetStats.mean);
  }
  const r = cov / (count * columnStats.sd * targetStats.sd);
  results.push({ name: names[col] ?? `f${col}`, r });
}

results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
console.log('相关性最强的 15 个特征：');
for (const item of results.slice(0, 15)) {
  console.log(`  ${item.name.padEnd(10)} r = ${item.r.toFixed(4)}`);
}
console.log('\n尾部（上下文 / 聚合）特征：');
for (const name of tail) {
  const found = results.find((item) => item.name === name);
  if (found !== undefined)
    console.log(`  ${name.padEnd(10)} r = ${found.r.toFixed(4)}`);
}
