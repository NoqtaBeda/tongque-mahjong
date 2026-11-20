// 随机性体检：牌山/配牌的均匀性、相邻种子的独立性、轮次之间的独立性。
//
// 用法：
//   node scripts/check-rng.ts --walls=8000
//   node scripts/check-rng.ts --walls=20000 --preset=3p
//
// 说明：
// - 引擎是 mulberry32 + Fisher–Yates（见 packages/core/src/engine/game.ts）。
// - 判据：34 种牌在「每一个牌山位置」上都应均匀（4/136），因此对每个位置做 33 自由度的卡方检验。
//   8000 个牌山时，136 个位置里按 p<0.01 期望有 1.36 个位置超标，多于 5 个才值得怀疑。
// - 独立性：相邻种子/相邻轮次的牌山在同一位置撞牌的概率应为 4/136 ≈ 2.94%。
// - 注意：同一种子 + 同长度牌山 + 每种 4 张 ⇒ 洗牌得到的位置置换完全相同，
//   只是牌种标签不同（例如 3p 与 3p-noword 都是 108 张，卡方会一模一样）。
import {
  activeKinds,
  createGame,
  makeConfig,
  startRound,
} from '../packages/core/src/index.ts';
import type { RuleConfig } from '../packages/core/src/index.ts';

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const body = raw.replace(/^--/, '');
  const index = body.indexOf('=');
  if (index < 0) args.set(body, '1');
  else args.set(body.slice(0, index), body.slice(index + 1));
}

const WALLS = Number(args.get('walls') ?? 8000);
const PRESET = args.get('preset') ?? '4p';
const BASE_SEED = Number(args.get('seed') ?? 20261120);

// 注意：makeConfig({players:3}) 仍然用 std136（136 张），三麻必须显式指定 tileSet
const CONFIGS: Record<string, RuleConfig> = {
  '4p': makeConfig({ rounds: 4 }),
  '3p': makeConfig({ players: 3, tileSet: 'sanma108', rounds: 3 }),
  '3p-noword': makeConfig({ players: 3, tileSet: 'sanma-noword', rounds: 3 }),
};
const cfg = CONFIGS[PRESET];
if (cfg === undefined) {
  console.error(`未知 preset: ${PRESET}`);
  process.exit(1);
}

/** 卡方上尾概率（Wilson–Hilferty 近似，够用来做体检） */
function chiSquareSf(x: number, df: number): number {
  if (df <= 0) return 1;
  const z = (Math.cbrt(x / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return 0.5 * (1 - erf(z / Math.SQRT2));
}

function erf(x: number): number {
  // Abramowitz-Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function wallOf(seed: number | bigint | string): number[] {
  return createGame(cfg, seed).wall;
}

const empty = createGame(cfg, BASE_SEED);
const positions = empty.wall.length;
const hands = empty.hands[0].reduce((sum, count) => sum + count, 0);
const players = cfg.players;

console.log(
  `随机性体检 · ${PRESET} · ${WALLS} 个牌山 · 每个牌山 ${positions} 张` +
    ` · 起手 ${hands} 张 × ${players} 家 · 基础种子 ${BASE_SEED}`,
);

// ── 1. 确定性 ──
const a = wallOf(BASE_SEED);
const b = wallOf(BASE_SEED);
const deterministic = a.every((tile, index) => tile === b[index]);
console.log(
  `\n[1] 同种子可复现：${deterministic ? '✓' : '✗'}（只允许差异来自随机源）`,
);

// ── 2. 种子宽度：number 只有 32 位；bigint/字符串可以用满 128 位 ──
const wrapped = wallOf(BASE_SEED + 2 ** 32);
const sameNumberWall = wrapped.every((tile, index) => tile === a[index]);
const bigA = wallOf(BigInt(BASE_SEED));
const bigB = wallOf(BigInt(BASE_SEED) + (1n << 96n));
const sameBigWall = bigA.every((tile, index) => tile === bigB[index]);
console.log(
  `[2] number 种子按 32 位处理（s 与 s+2^32 同牌山）：${sameNumberWall ? '是（数字种子的上限）' : '否'}`,
);
console.log(
  `     bigint 种子可用满 128 位（只改第 4 个 32 位字仍换牌山）：${sameBigWall ? '✗ 相同' : '✓ 不同'}`,
);

// ── 3. 每个位置的牌种均匀性（只算活跃牌种） ──
const kindCount = 34;
// 三麻会去掉部分牌种，它们永远不出现；必须排除，否则卡方统计量虚高
const active = activeKinds(cfg);
const activeList: number[] = [];
for (let kind = 0; kind < kindCount; kind += 1) {
  if (active[kind] !== 0) activeList.push(kind);
}
const cells = activeList.length;
const perPosition = Array.from(
  { length: positions },
  () => new Float64Array(kindCount),
);
const firstTileCounts = new Float64Array(kindCount);
const handCounts = new Float64Array(kindCount);
let handTiles = 0;
const walls: number[][] = [];

for (let index = 0; index < WALLS; index += 1) {
  const seed = BASE_SEED + index * 7919; // 用质数步长，避免自相关
  const state = createGame(cfg, seed);
  const wall = state.wall;
  walls.push(wall);
  for (let position = 0; position < positions; position += 1) {
    perPosition[position][wall[position] % kindCount] += 1;
  }
  firstTileCounts[wall[0]] += 1;
  for (let kind = 0; kind < kindCount; kind += 1) {
    handCounts[kind] += state.hands[0][kind];
    handTiles += state.hands[0][kind];
  }
}

/**
 * 只累加活跃牌种的卡方。每个活跃牌种在牌山里有 4 张，
 * 所以单个位置上它的期望出现概率是 4 / positions。
 */
function chiSquareActive(counts: Float64Array, samples: number): number {
  const expected = (samples * 4) / positions;
  let sum = 0;
  for (const kind of activeList) {
    const diff = counts[kind] - expected;
    sum += (diff * diff) / expected;
  }
  return sum;
}

let worstPosition = -1;
let worstP = 1;
let rejected = 0;
let pooled = 0;
for (let position = 0; position < positions; position += 1) {
  const stat = chiSquareActive(perPosition[position], WALLS);
  const p = chiSquareSf(stat, cells - 1);
  pooled += stat;
  if (p < 0.01) rejected += 1;
  if (p < worstP) {
    worstP = p;
    worstPosition = position;
  }
}
const pooledDf = positions * (cells - 1);
const pooledP = chiSquareSf(pooled, pooledDf);
console.log(
  `\n[3] 每个牌山位置上的牌种均匀性（卡方 df=${cells - 1}，活跃牌种 ${cells}）`,
);
console.log(
  `  超标位置（p<0.01）：${rejected}/${positions}　期望 ≈ ${(positions * 0.01).toFixed(1)}`,
);
console.log(`  最差的位置 #${worstPosition}：p = ${worstP.toFixed(4)}`);
console.log(
  `  整体汇总 χ² = ${pooled.toFixed(1)}（df=${pooledDf}）→ p = ${pooledP.toFixed(3)}`,
);

// ── 4. 第一张牌 / 起手牌分布的均匀性 ──
const firstStat = chiSquareActive(firstTileCounts, WALLS);
console.log(
  `\n[4] 牌山第 1 张的分布：χ² = ${firstStat.toFixed(1)}（df=${kindCount - 1}）` +
    ` → p = ${chiSquareSf(firstStat, cells - 1).toFixed(3)}`,
);
const handStat = chiSquareActive(handCounts, handTiles);
console.log(
  `[5] 自家起手 13 张累计分布：χ² = ${handStat.toFixed(1)}（df=${kindCount - 1}）` +
    ` → p = ${chiSquareSf(handStat, cells - 1).toFixed(3)}`,
);

// ── 6. 相邻种子 / 相邻轮次 的独立性 ──
function overlapRate(left: number[], right: number[]): number {
  let same = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) same += 1;
  }
  return same / left.length;
}

const pairs = Math.min(2000, WALLS - 1);
let consecutiveSum = 0;
let farSum = 0;
let strideOneSum = 0;
for (let index = 0; index < pairs; index += 1) {
  // 真实用法里 gen.ts / eval.ts 用的是连号种子（seed + 局号）
  const seed = BASE_SEED + index * 7919;
  strideOneSum += overlapRate(wallOf(seed), wallOf(seed + 1));
  consecutiveSum += overlapRate(walls[index], walls[index + 1]);
  farSum += overlapRate(walls[index], walls[((index + pairs / 2) % WALLS) | 0]);
}
const expected = 4 / positions;
console.log(
  `\n[6] 两张牌山同一位置撞牌的比例（独立时应为 4/${positions} = ${(expected * 100).toFixed(2)}%）`,
);
console.log(
  `  连号种子 seed 与 seed+1：${((strideOneSum / pairs) * 100).toFixed(3)}%`,
);
console.log(
  `  采样步长 seed 与 seed+7919：${((consecutiveSum / pairs) * 100).toFixed(3)}%`,
);
console.log(`  远隔牌山（对照）：${((farSum / pairs) * 100).toFixed(3)}%`);

// ── 7. 同一场里相邻轮次的独立性 ──
const roundChecks = Math.min(2000, WALLS);
let roundSum = 0;
for (let index = 0; index < roundChecks; index += 1) {
  const seed = BASE_SEED + index * 7919;
  const first = createGame(cfg, seed);
  const second = startRound(cfg, first.scores, 1, first.rng);
  roundSum += overlapRate(first.wall, second.wall);
}
console.log(
  `[7] 同一场相邻两轮的牌山撞牌率：${((roundSum / roundChecks) * 100).toFixed(3)}%` +
    `（独立时 ≈ ${(expected * 100).toFixed(2)}%）`,
);

// ── 8. 牌山去重 ──
const seen = new Set<string>();
for (const wall of walls) seen.add(wall.join(','));
console.log(
  `\n[8] ${WALLS} 个牌山中不同牌山数：${seen.size}` +
    `${seen.size === walls.length ? '（全部互不相同 ✓）' : `（有 ${walls.length - seen.size} 个重复 ✗）`}`,
);

// ── 结论 ──
const suspicious =
  !deterministic ||
  rejected > Math.max(5, positions * 0.02) ||
  pooledP < 0.001 ||
  Math.abs(strideOneSum / pairs - expected) > expected * 0.15;
console.log(
  `\n结论：${suspicious ? '⚠️ 有指标偏离，需要细看上面各项' : '✓ 各项都在随机范围内'}`,
);
