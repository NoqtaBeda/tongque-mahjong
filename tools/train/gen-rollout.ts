// 生成「逐候选牌」的 rollout 标签：同一局面下每张候选打牌的真实期望得分。
//
// 与 gen.ts 的区别：标签不是"这一局最终得分"，而是"从这张牌打完后的局面出发、
// 用当前 AI 打完整局 K 次，平均拿到的本场净得分"。同一局面内的候选标签天然可比，
// 正好是价值网络做选牌时需要的量，且方差远小于单次结局。
//
// 用法：
//   node tools/train/gen-rollout.ts --decisions=2000 --rollouts=4 --seed=1 --out=.data/roll-a.bin
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runShards } from '../../scripts/parallel.ts';
import {
  createGame,
  legalActions,
  makeConfig,
  observe,
  randomRng,
  reduce,
  wallRemaining,
} from '../../packages/core/src/index.ts';
import type { GameState } from '../../packages/core/src/index.ts';
import {
  decide,
  extractFeatures,
  improvingTiles,
  potentialScore,
  profileOf,
  shantenOf,
  visibleTiles,
} from '../../packages/core/src/ai/index.ts';
import {
  encodeInput,
  NN_FEATURE_DIM,
} from '../../packages/core/src/ai/nn/features.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const body = raw.replace(/^--/, '');
  const index = body.indexOf('=');
  if (index < 0) args.set(body, '1');
  else args.set(body.slice(0, index), body.slice(index + 1));
}

const DECISIONS = Number(args.get('decisions') ?? 2000);
const ROLLOUTS = Number(args.get('rollouts') ?? 4);
const PER_DECISION = Number(args.get('per-decision') ?? 6);
const OUT = args.get('out') ?? join(root, '.data', 'rollout.bin');
const SEED = Number(args.get('seed') ?? 1);
const JOBS = Number(args.get('jobs') ?? 1);
const SHARD = args.get('shard')?.split('/')[0];
/** 每片 group id 的偏移步长，避免合并后重复 */
const GROUP_STRIDE = 10_000_000;

function shardPath(index: number): string {
  const dot = OUT.lastIndexOf('.');
  if (dot < 0) return `${OUT}.shard${index}`;
  return `${OUT.slice(0, dot)}.shard${index}${OUT.slice(dot)}`;
}

const cfg = makeConfig({ rounds: 4 });
const profile = profileOf('advanced');

/** 从某个局面打法到本场结束，返回四家的终局分数 */
function playToRoundEnd(start: GameState): number[] {
  let state = start;
  let guard = 0;
  while (state.phase !== 'over' && guard < 4000) {
    guard += 1;
    const actor = state.actor;
    if (actor === null) break;
    const legal = legalActions(state, actor);
    if (legal.length === 0) break;
    state = reduce(state, decide(observe(state, actor), { profile }));
  }
  return state.scores;
}

/** 某局面下「打掉 tile 之后」的特征（与 gen.ts 的 post 对齐保持一致） */
function featuresAfter(
  state: GameState,
  actor: number,
  tile: number,
): Float32Array {
  const observation = observe(state, actor);
  const melds = state.melds[actor];
  const visible = visibleTiles(observation);
  const after = observation.hand.slice();
  after[tile] -= 1;
  return encodeInput({
    concealed: after,
    melds,
    visible,
    seatWind: observation.seatWind,
    round: state.round,
    isDealer: state.dealer === actor,
    wallRemaining: wallRemaining(state),
    score: state.scores[actor],
    shanten: shantenOf(after, melds.length, cfg).value,
    ukeire: improvingTiles(after, melds, cfg, visible).count,
    potential: potentialScore(
      extractFeatures(after, melds, observation.seatWind),
    ),
  });
}

const rows: { features: Float32Array; label: number; group: number }[] = [];
let group = SHARD === undefined ? 0 : Number(SHARD) * GROUP_STRIDE;
const groupStart = group;
let game = 0;
const started = Date.now();

if (JOBS > 1 && SHARD === undefined) {
  const passthrough: string[] = [];
  for (const [key, value] of args) {
    if (['jobs', 'shard', 'decisions', 'seed', 'out'].includes(key)) continue;
    passthrough.push(`--${key}=${value}`);
  }
  const perShard = Math.ceil(DECISIONS / JOBS);
  console.log(`分片打标：${JOBS} 片 × ${perShard} 局面 → ${OUT}.shard<i>.bin`);
  await runShards({
    script: fileURLToPath(import.meta.url),
    jobs: JOBS,
    argsFor: () => [
      ...passthrough,
      `--decisions=${Math.ceil(DECISIONS / JOBS)}`,
      `--seed=${SEED}`,
      `--out=${OUT}`,
    ],
    onTick: ({ finished, jobs, elapsed: seconds }) => {
      console.log(`  … 已完成 ${finished}/${jobs} 片（${seconds}s）`);
    },
  });
  console.log(`全部完成：${OUT}.shard0.bin … shard${JOBS - 1}.bin`);
  process.exit(0);
}

while (group - groupStart < DECISIONS) {
  game += 1;
  // 种子必须落在安全整数范围：先取模再加分片偏移
  const shardSeed =
    (SEED % 90000) + (SHARD === undefined ? 0 : Number(SHARD) * 791);
  let state = createGame(cfg, shardSeed * 100000 + game);
  while (state.phase !== 'over') {
    const actor = state.actor;
    if (actor === null) break;
    const legal = legalActions(state, actor);
    if (legal.length === 0) break;
    const discards = legal.filter((item) => item.type === 'discard');
    if (discards.length >= 2 && group - groupStart < DECISIONS) {
      group += 1;
      const before = state.scores[actor];
      for (const action of discards.slice(0, PER_DECISION)) {
        const tile = (action as { readonly tile: number }).tile;
        const branch = reduce(state, action);
        let sum = 0;
        for (let k = 0; k < ROLLOUTS; k += 1) {
          // 每个 rollout 用不同随机数：牌山剩余顺序重新抽
          const clone: GameState = { ...branch, rng: randomRng() };
          const scores = playToRoundEnd(clone);
          sum += scores[actor] - before;
        }
        rows.push({
          features: featuresAfter(state, actor, tile),
          label: sum / ROLLOUTS,
          group,
        });
      }
      if ((group - groupStart) % 200 === 0) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        console.log(
          `  ${group}/${DECISIONS} 局面 · ${rows.length} 样本 · ${elapsed}s`,
        );
      }
    }
    state = reduce(state, decide(observe(state, actor), { profile }));
  }
}

const dim = NN_FEATURE_DIM;
const buffer = new ArrayBuffer(
  16 + rows.length * 4 + rows.length * 4 + rows.length * (dim + 1) * 4,
);
const view = new DataView(buffer);
view.setUint32(0, 0x54513032, true); // magic "TQ02"
view.setUint32(4, rows.length, true);
view.setUint32(8, dim, true);
view.setUint32(12, 1, true); // 带权重列
let offset = 16;
for (const row of rows) {
  view.setUint32(offset, row.group, true);
  offset += 4;
}
for (let index = 0; index < rows.length; index += 1) {
  view.setFloat32(offset, 1, true);
  offset += 4;
}
for (const row of rows) {
  for (let index = 0; index < dim; index += 1) {
    view.setFloat32(offset, row.features[index], true);
    offset += 4;
  }
  view.setFloat32(offset, row.label, true);
  offset += 4;
}

const outPath = SHARD === undefined ? OUT : shardPath(Number(SHARD));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, new Uint8Array(buffer));
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `\n完成：${group - groupStart} 局面 · ${rows.length} 候选样本 · 用时 ${elapsed}s → ${outPath}`,
);
