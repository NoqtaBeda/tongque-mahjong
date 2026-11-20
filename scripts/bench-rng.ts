// RNG 性能对比：32 位整数版 vs BigInt 版（同一个 xoshiro128** 算法，状态都是 4×uint32）
//
// 用法：
//   node scripts/bench-rng.ts
//   node scripts/bench-rng.ts --draws=2000000 --walls=20000
//
// 端到端对比（对局吞吐）在脚本外做：
//   node scripts/yaku-stats.ts --games=400 --jobs=1 --seed=777001
//   $env:TONGQUE_RNG_MODE="bigint"; node scripts/yaku-stats.ts --games=400 --jobs=1 --seed=777001
import {
  RNG_MODE,
  describeRng,
  nextRng,
  nextRngBigInt,
  randomRng,
  toRng,
} from '../packages/core/src/index.ts';
import type { RngState } from '../packages/core/src/index.ts';

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const body = raw.replace(/^--/, '');
  const index = body.indexOf('=');
  if (index < 0) args.set(body, '1');
  else args.set(body.slice(0, index), body.slice(index + 1));
}

const DRAWS = Number(args.get('draws') ?? 2_000_000);
const WALLS = Number(args.get('walls') ?? 20_000);

type Step = (rng: RngState) => { rng: RngState; value: number };

let sink = 0;

function bench(label: string, run: () => number): number {
  run(); // 预热，别把 JIT 算进结果
  const started = performance.now();
  run();
  const ms = performance.now() - started;
  console.log(`  ${label.padEnd(14)} ${ms.toFixed(1).padStart(9)} ms`);
  return ms;
}

// ── 1. 纯抽样 ──
function drawLoop(draw: Step): number {
  let rng = toRng(20261120);
  let total = 0;
  for (let index = 0; index < DRAWS; index += 1) {
    const step = draw(rng);
    rng = step.rng;
    total += step.value;
  }
  sink += total;
  return total;
}

// ── 2. 洗牌山（与引擎同一套 Fisher–Yates，4 人 136 张 = 135 次抽样） ──
function wallLoop(draw: Step): number {
  let total = 0;
  for (let index = 0; index < WALLS; index += 1) {
    let rng = toRng(20261120 + index * 7919);
    const wall: number[] = [];
    for (let kind = 0; kind < 34; kind += 1) {
      for (let copy = 0; copy < 4; copy += 1) wall.push(kind);
    }
    for (let position = wall.length - 1; position > 0; position -= 1) {
      const step = draw(rng);
      rng = step.rng;
      const swap = Math.floor(step.value * (position + 1));
      const tmp = wall[position];
      wall[position] = wall[swap];
      wall[swap] = tmp;
    }
    total += wall[0];
  }
  sink += total;
  return total;
}

console.log(
  `RNG 性能对比 · ${DRAWS.toLocaleString()} 次抽样 · ${WALLS.toLocaleString()} 副牌山` +
    ` · 当前引擎模式 ${RNG_MODE} · 示例种子 ${describeRng(randomRng())}`,
);

console.log('\n[1] 纯抽样（每步一次状态推进）');
const numberDrawMs = bench('32 位整数', () => drawLoop(nextRng));
const bigintDrawMs = bench('BigInt', () => drawLoop(nextRngBigInt));

console.log('\n[2] 洗一副牌山（136 张 = 135 次抽样）');
const numberWallMs = bench('32 位整数', () => wallLoop(nextRng));
const bigintWallMs = bench('BigInt', () => wallLoop(nextRngBigInt));

const better = (
  numberMs: number,
  bigintMs: number,
  unit: string,
  count: number,
): void => {
  const numberRate = count / (numberMs / 1000);
  const bigintRate = count / (bigintMs / 1000);
  console.log(
    `  整数版 ${(numberRate / 1e6).toFixed(2)} 百万${unit}/秒 · ` +
      `BigInt 版 ${(bigintRate / 1e6).toFixed(2)} 百万${unit}/秒 · ` +
      `BigInt 慢 ${(bigintMs / Math.max(numberMs, 1e-6)).toFixed(1)}×`,
  );
};

console.log('\n结论');
better(numberDrawMs, bigintDrawMs, '次', DRAWS);
better(numberWallMs, bigintWallMs, '副', WALLS);
console.log(`  （校验值 ${sink.toExponential(3)}）`);
