// 生成训练样本：用当前启发式 AI 自对弈，记录每个决策点的特征，
// 并在本场结束时用「该座位的净得分变化」当标签（蒙特卡洛价值）。
//
// 用法：node tools/train/gen.ts --games=800 [--preset=4p] [--out=.data/samples.bin]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGame,
  legalActions,
  makeConfig,
  observe,
  reduce,
  wallRemaining,
} from '../../packages/core/src/index.ts';
import type { GameState, RuleConfig } from '../../packages/core/src/index.ts';
import {
  decide,
  extractFeatures,
  improvingTiles,
  potentialScore,
  profileOf,
  shantenOf,
  visibleTiles,
} from '../../packages/core/src/ai/index.ts';
import type { AiLevel } from '../../packages/core/src/ai/index.ts';
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

const GAMES = Number(args.get('games') ?? 800);
const PRESET = args.get('preset') ?? '4p';
// 自对弈用哪一档打牌：数据分布会跟着变，进阶档产的数据更接近它自己会遇到的局面
const LEVEL = (args.get('level') ?? 'normal') as AiLevel;
const OUT = args.get('out') ?? join(root, '.data', 'samples.bin');
const SEED = Number(args.get('seed') ?? 1);
/**
 * 每本场最多保留多少条样本。
 * 同一本场内的样本共享标签，有效样本量由"本场数"决定，所以按本场抽样不会损失信息，
 * 但能把文件从几个 GB 压到几十 MB。
 */
const PER_ROUND = Number(args.get('per-round') ?? 6);

const CONFIGS: Record<string, RuleConfig> = {
  '4p': makeConfig({ rounds: 4 }),
  '3p': makeConfig({ players: 3, rounds: 3 }),
};
const cfg = CONFIGS[PRESET];
if (cfg === undefined) {
  console.error(`未知 preset: ${PRESET}`);
  process.exit(1);
}

interface Pending {
  readonly features: Float32Array;
  readonly seat: number;
}

const labelled: { features: Float32Array; target: number; group: number }[] =
  [];
const started = Date.now();
let groupCounter = 0;

function playRound(state: GameState, pending: Pending[]): GameState {
  let current = state;
  let guard = 0;
  while (true) {
    guard += 1;
    if (guard > 20000)
      throw new Error(`对局没有收敛（第 ${current.round} 局）`);
    if (current.phase === 'over') return current;

    const actor = current.actor;
    if (actor === null) return current;
    const legal = legalActions(current, actor);
    if (legal.length === 0) return current;

    const observation = observe(current, actor);
    const melds = current.melds[actor];
    const visible = visibleTiles(observation);
    const shanten = shantenOf(
      observation.hand,
      melds.length,
      current.cfg,
    ).value;
    // 进张必须扣掉场上已打明的牌，否则会系统性高估
    const ukeire = improvingTiles(
      observation.hand,
      melds,
      current.cfg,
      visible,
    ).count;
    const potential = potentialScore(
      extractFeatures(observation.hand, melds, observation.seatWind),
    );

    pending.push({
      seat: actor,
      features: encodeInput({
        concealed: observation.hand,
        melds,
        visible,
        seatWind: observation.seatWind,
        round: current.round,
        isDealer: current.dealer === actor,
        wallRemaining: wallRemaining(current),
        score: current.scores[actor],
        shanten,
        ukeire,
        potential,
      }),
    });

    current = reduce(
      current,
      decide(observation, { profile: profileOf(LEVEL) }),
    );
  }
}

for (let game = 0; game < GAMES; game += 1) {
  let state = createGame(cfg, SEED + game);

  while (true) {
    const before = state.scores.slice();
    const pending: Pending[] = [];
    const over = playRound(state, pending);

    if (pending.length > 0) {
      const delta = over.scores.map((score, seat) => score - before[seat]);
      groupCounter += 1;
      // 同一本场内的样本高度相关（共享同一个标签），训练时必须按 group 切分，
      // 否则验证集会被同场的样本"泄漏"，相关系数虚高。
      // 同时也按本场抽样，避免文件随局数线性膨胀。
      const keep: Pending[] = [];
      if (pending.length <= PER_ROUND) {
        keep.push(...pending);
      } else {
        for (let index = 0; index < PER_ROUND; index += 1) {
          keep.push(pending[Math.floor((index * pending.length) / PER_ROUND)]);
        }
      }
      for (const entry of keep) {
        labelled.push({
          features: entry.features,
          target: delta[entry.seat],
          group: groupCounter,
        });
      }
    }

    if (over.finished) break;
    state = reduce(over, { type: 'next-round' });
  }

  if ((game + 1) % 50 === 0) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `  ${game + 1}/${GAMES} 局 · ${labelled.length} 样本 · ${elapsed}s`,
    );
  }
}

// 写二进制：uint32 count, uint32 dim, uint32 groups[count], 然后 count × (dim 个 float32 + 1 个 float32 目标)
const dim = NN_FEATURE_DIM;
const buffer = new ArrayBuffer(
  8 + labelled.length * 4 + labelled.length * (dim + 1) * 4,
);
const view = new DataView(buffer);
view.setUint32(0, labelled.length, true);
view.setUint32(4, dim, true);
let offset = 8;
for (const sample of labelled) {
  view.setUint32(offset, sample.group, true);
  offset += 4;
}
for (const sample of labelled) {
  for (let index = 0; index < dim; index += 1) {
    view.setFloat32(offset, sample.features[index], true);
    offset += 4;
  }
  view.setFloat32(offset, sample.target, true);
  offset += 4;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, new Uint8Array(buffer));

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const mean =
  labelled.reduce((sum, item) => sum + item.target, 0) /
  Math.max(1, labelled.length);
console.log(
  `\n完成：${GAMES} 局 · ${labelled.length} 样本 · 标签均值 ${mean.toFixed(3)} · 用时 ${elapsed}s`,
);
console.log(`输出：${OUT}`);
