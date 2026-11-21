// 生成训练样本：用当前启发式 AI 自对弈，记录每个决策点的特征，
// 并在本场结束时用「该座位的净得分变化」当标签（蒙特卡洛价值）。
//
// 用法：
//   node tools/train/gen.ts --games=800 [--preset=4p] [--out=.data/samples.bin]
//   node tools/train/gen.ts --games=24000 --jobs=16 --out=.data/samples-x.bin   # 16 片并行
// 并行时每片写 `xxx.shard<i>.bin`，全部结束后自动合并成一个文件并发完就删分片。
// 分片的 group id 带高位偏移，合并后训练时按 group 切验证集仍然安全。
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { runShards } from '../../scripts/parallel.ts';
import { formatSeed, offsetSeed, parseSeed } from '../../scripts/seed.ts';
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
const SEED = parseSeed(args.get('seed'));
/**
 * 每本场最多保留多少条样本。
 * 同一本场内的样本共享标签，有效样本量由"本场数"决定，所以按本场抽样不会损失信息，
 * 但能把文件从几个 GB 压到几十 MB。
 */
const PER_ROUND = Number(args.get('per-round') ?? 6);
/** 采样方式：stride = 整场决策序列等距取；per-seat = 按座位分层，每家各取 PER_ROUND/n 条 */
const SAMPLE = args.get('sample') ?? 'stride';
/**
 * 逐决策折扣标签：第 i 个决策的标签 = gamma^(该座位之后还有几个决策) × 本场分数变化。
 * 离终局越近权重越大，早巡的"正确打法"不会被终局结果污染。
 */
const GAMMA = Number(args.get('gamma') ?? 0.6);
/** 折扣地平线：离终局超过 K 个决策的样本直接丢弃（只对分数有变化的座位生效） */
const HORIZON = Number(args.get('horizon') ?? 6);
/**
 * 零标签样本（第三家/流局）每家最多保留几条。
 * 它们是"这条路不值分"的锚点，但每本场 4 家 × 3 条会把非零信号淹没，默认限 1 条。
 */
const ANCHORS = Number(args.get('anchors') ?? 1);
/**
 * 有分数变化的座位怎么取：tail = 只取最后 K 个（责任最明确，但状态覆盖偏终局）；
 * even = 等距（覆盖与实战一致）。默认 even——迭代 1 复盘发现 tail 会让网络只学到终局局面。
 */
const TAIL = args.get('tail') === '1';
/** 路线化探索：每本场轮流指定一条主线，并在该本场给这条线的番种加权 */
const ROUTE_BALANCE = args.get('route-balance') === '1';
/**
 * 生成侧的主线表，和教程/等频采样的分类保持一致
 * （8 条主线；杠与偶然类不参与路线化探索）
 */
const ROUTE_KEYS: readonly (readonly string[])[] = [
  ['hunyise', 'qingyise', 'jiulian'],
  [
    'qinglong',
    'sanlianhuan',
    'sanbugao',
    'yise-santongshun',
    'silianhuan',
    'sibugao',
    'yise-sitongshun',
  ],
  ['sanse-tongshun', 'xiao-san-se-tongke', 'sanse-tongke'],
  [
    'hun-quan-dai-yaojiu',
    'chun-quan-dai-yaojiu',
    'hun-yaojiu',
    'qing-yaojiu',
    'shisansan',
  ],
  ['jusishu', 'jusanshu', 'juliangshu'],
  ['jingtong', 'liangbangao'],
  ['pengpenghe', 'qiduizi', 'sanlianke', 'silianke', 'ziyise'],
  [
    'queyimen',
    'juwushu',
    'yibangao',
    'ertongke',
    'menfengke',
    'sanyuanke',
    'xiao-sanyuan',
    'da-sanyuan',
    'xiao-san-feng-ke',
    'san-feng-ke',
    'xiao-sixi',
    'da-sixi',
  ],
];
/** 文件格式版本：2 = magic + 权重列 */
const FORMAT_VERSION = 2;
const FORMAT_MAGIC = 0x54513032; // "TQ02"
/**
 * 打牌决策记录「打完之后」的 13 张手牌（默认），而不是「打牌前」的 14 张。
 *
 * 实战里 `rankDiscards` 评估的是每个候选打完后的 13 张状态，看的是那时的
 * 向听 / 进张 / 潜力；以前的样本记的是 14 张（进张中位数能差 10 张以上），
 * 训练分布和实战分布完全错位。加 `--align=pre` 可以退回旧行为做对照。
 */
const ALIGN = args.get('align') ?? 'post';
/**
 * ε-探索：以这个概率改成随机打一张（DAgger 思路）。
 *
 * 纯贪心自对弈只会覆盖"当前策略会走的局面"，训练集里没有"如果我当时打别的"
 * 的反事实，价值网络就学不到纠正。加一点随机探索能让数据覆盖更多状态。
 * 用固定种子的 LCG，保证同样的 seed 生成同样的数据。
 */
const EPS = Number(args.get('eps') ?? 0);
/**
 * 分片：`--jobs=16` 时把 GAMES 均分给 16 个进程并行跑，各自写 `xxx.shard<i>.bin`，
 * 最后合并成一个文件。每片的 group id 加一个固定的高位偏移，合并后互不重叠，
 * 训练时按 group 切验证集仍然安全。
 */
const JOBS = Number(args.get('jobs') ?? 1);
const SHARD = args.get('shard');
/** 每片 group id 的偏移步长（单片最多 GAMES × 每局本场数，远小于这个数） */
const GROUP_STRIDE = 10_000_000;

function shardPath(index: number): string {
  const dot = OUT.lastIndexOf('.');
  if (dot < 0) return `${OUT}.shard${index}`;
  return `${OUT.slice(0, dot)}.shard${index}${OUT.slice(dot)}`;
}
// 探索用的 LCG 只需要一个 32 位种子；bigint 种子取低 32 位即可
const seedLow = typeof SEED === 'bigint' ? Number(SEED & 0xffffffffn) : SEED;
let exploreState = (seedLow ^ 0x9e3779b9) >>> 0;
function exploreRandom(): number {
  exploreState = (Math.imul(exploreState, 1664525) + 1013904223) >>> 0;
  return exploreState / 0x100000000;
}

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
  /** 这一步选了什么：0 = 打牌，其它 = 鸣牌/过等；打牌时记录牌种 */
  readonly discard: number;
}
const labelled: {
  features: Float32Array;
  target: number;
  group: number;
  discard: number;
  weight: number;
}[] = [];
const started = Date.now();
let groupCounter = 0;
/** 路线化探索用：每本场轮换一条主线 */
let routeIndex = 0;
/** 自对弈基准档（构建一次即可，别在决策循环里重复取） */
const baseProfile = profileOf(LEVEL);

/** 路线化探索：给指定主线的番种加权，逼 AI 真去造这条线 */
function routeProfile(routeIndex: number) {
  if (!ROUTE_BALANCE) return null;
  const base = profileOf(LEVEL);
  const keys = ROUTE_KEYS[routeIndex % ROUTE_KEYS.length];
  const bias: Record<string, number> = {};
  for (const key of keys) bias[key] = 1.8;
  return { ...base, yakuBias: bias, biasGate: undefined };
}

function playRound(
  state: GameState,
  pending: Pending[],
  roundProfile: ReturnType<typeof profileOf> | null,
): GameState {
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

    let action = decide(observation, {
      profile: roundProfile ?? baseProfile,
    });
    if (EPS > 0 && exploreRandom() < EPS) {
      const discards = legal.filter((item) => item.type === 'discard');
      if (discards.length > 0) {
        action = discards[Math.floor(exploreRandom() * discards.length)];
      }
    }

    if (ALIGN === 'post' && action.type === 'discard') {
      // 记「打完这张之后」的状态，和 rankDiscards 评估候选时看到的完全一致
      const after = observation.hand.slice();
      after[action.tile] -= 1;
      pending.push({
        seat: actor,
        discard: action.tile,
        features: encodeInput({
          concealed: after,
          melds,
          visible,
          seatWind: observation.seatWind,
          round: current.round,
          isDealer: current.dealer === actor,
          wallRemaining: wallRemaining(current),
          score: current.scores[actor],
          shanten: shantenOf(after, melds.length, cfg).value,
          ukeire: improvingTiles(after, melds, cfg, visible).count,
          potential: potentialScore(
            extractFeatures(after, melds, observation.seatWind),
          ),
        }),
      });
    } else {
      pending.push({
        seat: actor,
        discard: -1,
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
    }

    current = reduce(current, action);
  }
}

// 分片时只跑属于自己那一段；合并后的样本与单进程完全等价
const shardIndex = SHARD === undefined ? 0 : Number(SHARD.split('/')[0]);
const shardCount = SHARD === undefined ? 1 : Number(SHARD.split('/')[1]);
const perShard = Math.ceil(GAMES / shardCount);
const firstGame = shardIndex * perShard;
const lastGame = Math.min(GAMES, firstGame + perShard);
if (SHARD !== undefined) groupCounter = -shardIndex * GROUP_STRIDE * -1;

// ── 父进程：--jobs>1 时并发跑分片，全部结束后合并 ──
if (JOBS > 1 && SHARD === undefined) {
  const perShardGames = Math.ceil(GAMES / JOBS);
  const passthrough: string[] = [];
  for (const [key, value] of args) {
    if (['jobs', 'shard', 'games', 'seed', 'out'].includes(key)) continue;
    passthrough.push(`--${key}=${value}`);
  }
  console.log(
    `分片生成：${JOBS} 片 × ${perShardGames} 局（共 ${GAMES} 局）→ 合并到 ${OUT}`,
  );
  await runShards({
    script: fileURLToPath(import.meta.url),
    jobs: JOBS,
    argsFor: () => [
      ...passthrough,
      `--games=${GAMES}`,
      `--seed=${formatSeed(SEED)}`,
      `--out=${OUT}`,
    ],
    onTick: ({ finished, jobs, elapsed: seconds }) => {
      console.log(`  … 已完成 ${finished}/${jobs} 片（${seconds}s）`);
    },
  });
  mergeShards(JOBS, NN_FEATURE_DIM);
  process.exit(0);
}

for (let game = firstGame; game < lastGame; game += 1) {
  let state = createGame(cfg, offsetSeed(SEED, game));

  while (true) {
    const before = state.scores.slice();
    const pending: Pending[] = [];
    routeIndex += 1;
    const roundProfile = routeProfile(routeIndex);
    const over = playRound(state, pending, roundProfile);

    if (pending.length > 0) {
      const delta = over.scores.map((score, seat) => score - before[seat]);
      groupCounter += 1;

      // 该座位在这个决策之后还有几个自己的决策（0 = 最后一个决策）
      const distance = new Array<number>(pending.length).fill(0);
      const after = [0, 0, 0, 0];
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const seat = pending[index].seat;
        distance[index] = after[seat];
        after[seat] += 1;
      }

      // 选样本：stride = 整场等距；per-seat = 每家各取若干
      const keep: number[] = [];
      if (SAMPLE === 'per-seat') {
        const players = cfg.players;
        const perSeat = Math.max(1, Math.floor(PER_ROUND / players));
        for (let seat = 0; seat < players; seat += 1) {
          const own: number[] = [];
          for (let index = 0; index < pending.length; index += 1) {
            if (pending[index].seat === seat) own.push(index);
          }
          // 分数没变化的座位只留少量锚点，别用 0 标签淹没信号
          const quota = delta[seat] === 0 ? ANCHORS : perSeat;
          if (own.length <= quota) keep.push(...own);
          else if (delta[seat] === 0) {
            for (let index = 0; index < quota; index += 1) {
              keep.push(own[Math.floor((index * own.length) / quota)]);
            }
          } else if (TAIL) {
            // tail 模式：只取最后 K 个（责任最明确，但状态覆盖偏终局）
            const limit = Math.min(quota, HORIZON + 1);
            for (
              let index = own.length - limit;
              index < own.length;
              index += 1
            ) {
              keep.push(own[index]);
            }
          } else {
            // 默认：等距，保证训练分布和实战一致（tail 会丢掉中前盘状态）
            for (let index = 0; index < quota; index += 1) {
              keep.push(own[Math.floor((index * own.length) / quota)]);
            }
          }
        }
      } else if (pending.length <= PER_ROUND) {
        for (let index = 0; index < pending.length; index += 1)
          keep.push(index);
      } else {
        for (let index = 0; index < PER_ROUND; index += 1) {
          keep.push(Math.floor((index * pending.length) / PER_ROUND));
        }
      }

      for (const index of keep) {
        const entry = pending[index];
        const change = delta[entry.seat];
        // 标签保持「本场净得分」的原量纲（V 的尺度不变，不用重扫 pw）；
        // 离终局越远，责任越不确定 → 用权重 gamma^d 衰减，超过地平线直接丢弃。
        const label = change;
        const weight = change === 0 ? 1 : Math.pow(GAMMA, distance[index]);
        if (change !== 0 && distance[index] > HORIZON) continue;
        labelled.push({
          features: entry.features,
          target: label,
          group: groupCounter,
          discard: entry.discard,
          weight,
        });
      }
    }

    if (over.finished) break;
    state = reduce(over, { type: 'next-round' });
  }

  if ((game - firstGame + 1) % 50 === 0) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `  ${game + 1}/${GAMES} 局 · ${labelled.length} 样本 · ${elapsed}s`,
    );
  }
}

// v2 二进制：magic / count / dim / flags / groups / weights / body(dim+1)
const dim = NN_FEATURE_DIM;
const headerBytes = 16;
const buffer = new ArrayBuffer(
  headerBytes +
    labelled.length * 4 +
    labelled.length * 4 +
    labelled.length * (dim + 1) * 4,
);
const view = new DataView(buffer);
view.setUint32(0, FORMAT_MAGIC, true);
view.setUint32(4, labelled.length, true);
view.setUint32(8, dim, true);
view.setUint32(12, 1, true); // flags: bit0 = 带权重列
let offset = headerBytes;
for (const sample of labelled) {
  view.setUint32(offset, sample.group, true);
  offset += 4;
}
for (const sample of labelled) {
  view.setFloat32(offset, sample.weight, true);
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

const outPath = SHARD === undefined ? OUT : shardPath(shardIndex);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, new Uint8Array(buffer));

// 侧车：每条样本「选了什么动作」，给策略头（每个候选打牌一个价值）用。
// 1 字节/条：bit0..5 = 牌种（0..33），bit7 = 1 表示这一步是打牌。
const actionBytes = new Uint8Array(labelled.length);
for (let index = 0; index < labelled.length; index += 1) {
  const tile = labelled[index].discard;
  actionBytes[index] = tile >= 0 ? (1 << 7) | tile : 0;
}
writeFileSync(outPath.replace(/\.bin$/, '.act.bin'), actionBytes);

/** 把一个分片的 bin 读成 { groups: Uint32Array, body: Float32Array } */
function readShard(path: string): {
  count: number;
  dim: number;
  groups: Uint32Array;
  weights: Float32Array;
  body: Float32Array;
  actions: Uint8Array;
} {
  const raw = readFileSync(path);
  const magic = raw.readUInt32LE(0);
  const v2 = magic === FORMAT_MAGIC;
  const countOffset = v2 ? 4 : 0;
  const dimOffset = v2 ? 8 : 4;
  const count = raw.readUInt32LE(countOffset);
  const dim = raw.readUInt32LE(dimOffset);
  const groupsStart = v2 ? 16 : 8;
  const groups = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    groups[index] = raw.readUInt32LE(groupsStart + index * 4);
  }
  const weights = new Float32Array(count).fill(1);
  if (v2) {
    const weightsStart = groupsStart + count * 4;
    for (let index = 0; index < count; index += 1) {
      weights[index] = raw.readFloatLE(weightsStart + index * 4);
    }
  }
  const bodyStart = groupsStart + count * 4 + (v2 ? count * 4 : 0);
  const body = new Float32Array(count * (dim + 1));
  for (let index = 0; index < body.length; index += 1) {
    body[index] = raw.readFloatLE(bodyStart + index * 4);
  }
  const actPath = path.replace(/\.bin$/, '.act.bin');
  const actions = existsSync(actPath)
    ? new Uint8Array(readFileSync(actPath))
    : new Uint8Array(count);
  return { count, dim, groups, weights, body, actions };
}

/** 把 N 个分片按顺序拼成一个文件（group id 已经带过偏移，直接拼即可） */
function mergeShards(count: number, dim: number): void {
  const parts = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const part = readShard(shardPath(index));
    if (part.dim !== dim) {
      throw new Error(`分片 ${index} 的维度是 ${part.dim}，期望 ${dim}`);
    }
    parts.push(part);
    total += part.count;
  }

  const head = Buffer.alloc(16 + total * 4);
  head.writeUInt32LE(FORMAT_MAGIC, 0);
  head.writeUInt32LE(total, 4);
  head.writeUInt32LE(dim, 8);
  head.writeUInt32LE(1, 12); // flags: 带权重
  const weights = Buffer.alloc(total * 4);
  const body = Buffer.alloc(total * (dim + 1) * 4);
  const actions = Buffer.alloc(total);
  let groupOffset = 16;
  let weightOffset = 0;
  let bodyOffset = 0;
  let actionOffset = 0;
  for (const part of parts) {
    for (let index = 0; index < part.count; index += 1) {
      head.writeUInt32LE(part.groups[index], groupOffset);
      groupOffset += 4;
      weights.writeFloatLE(part.weights[index], weightOffset);
      weightOffset += 4;
    }
    Buffer.from(
      part.body.buffer,
      part.body.byteOffset,
      part.body.byteLength,
    ).copy(body, bodyOffset);
    bodyOffset += part.body.byteLength;
    actions.set(part.actions, actionOffset);
    actionOffset += part.actions.length;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.concat([head, weights, body]));
  writeFileSync(OUT.replace(/\.bin$/, '.act.bin'), actions);
  for (let index = 0; index < count; index += 1) {
    rmSync(shardPath(index), { force: true });
    rmSync(shardPath(index).replace(/\.bin$/, '.act.bin'), { force: true });
  }
  console.log(`\n合并 ${count} 个分片 → ${OUT}（${total} 样本）`);
}
if (SHARD !== undefined) {
  console.log(`分片 ${SHARD} 完成：${labelled.length} 样本 → ${outPath}`);
  process.exit(0);
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const mean =
  labelled.reduce((sum, item) => sum + item.target, 0) /
  Math.max(1, labelled.length);
const zeroShare =
  labelled.filter((item) => item.target === 0).length /
  Math.max(1, labelled.length);
console.log(
  `\n完成：${GAMES} 局 · ${labelled.length} 样本 · 标签均值 ${mean.toFixed(3)} ` +
    `· 零标签占比 ${(zeroShare * 100).toFixed(1)}% · 用时 ${elapsed}s`,
);
console.log(
  `格式 v${FORMAT_VERSION} · gamma=${GAMMA} · horizon=${HORIZON} · sample=${SAMPLE}` +
    ` · route-balance=${ROUTE_BALANCE ? 'on' : 'off'} · per-round=${PER_ROUND}`,
);
console.log(`输出：${OUT}`);
console.log(`动作侧车：${OUT.replace(/\.bin$/, '.act.bin')}`);
