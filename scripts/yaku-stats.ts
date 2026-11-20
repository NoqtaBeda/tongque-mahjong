// 番种统计：跑 N 局自对弈，统计每个番种的出现次数 / 出现率 / 平均打点，以及和牌得分分布。
//
// 用法：
//   node scripts/yaku-stats.ts --games=4000
//   node scripts/yaku-stats.ts --games=40000 --jobs=16      # 分片并行
//   node scripts/yaku-stats.ts --games=4000 --result=.data/yaku.json --shard=0/16
//
// 分片模式下只写结果 JSON，不打印；父进程负责合并与呈现。
import {
  createGame,
  legalActions,
  makeConfig,
  observe,
  reduce,
} from '../packages/core/src/index.ts';
import type { GameState, RuleConfig } from '../packages/core/src/index.ts';
import { AI_PROFILES, decide } from '../packages/core/src/ai/index.ts';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { runShards } from './parallel.ts';
import { formatSeed, offsetSeed, parseSeed } from './seed.ts';

/** 单个番种的累计量 */
interface YakuAgg {
  name: string;
  /** 番种自身分值（可能随牌型变化，例如一杠是 1、三杠是 2） */
  points: number;
  /** 出现了几次（按"和牌"计：一手牌里该番种只记一次） */
  count: number;
  /** 该番种出现时，整手牌的得分之和（用来算平均打点） */
  scoreSum: number;
}

interface ShardResult {
  games: number;
  rounds: number;
  wins: number;
  tsumo: number;
  ron: number;
  draws: number;
  scoreSum: number;
  /** 得分直方图：key 是分数，value 是和牌数 */
  hist: Record<number, number>;
  /** key → 累计 */
  yaku: Record<string, YakuAgg>;
}

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const body = raw.replace(/^--/, '');
  const index = body.indexOf('=');
  if (index < 0) args.set(body, '1');
  else args.set(body.slice(0, index), body.slice(index + 1));
}

const GAMES = Number(args.get('games') ?? 4000);
const SEED = parseSeed(args.get('seed'));

if (!Number.isInteger(GAMES) || GAMES <= 0) {
  console.error(`--games 必须是正整数（收到“${args.get('games')}”）`);
  process.exit(1);
}
const JOBS = Number(args.get('jobs') ?? 1);
const SHARD = args.get('shard');
const RESULT = args.get('result');
const PRESET = args.get('preset') ?? '4p';

const CONFIGS: Record<string, RuleConfig> = {
  '4p': makeConfig({ rounds: 4 }),
  '3p': makeConfig({ players: 3, rounds: 3 }),
};
const cfg = CONFIGS[PRESET];
if (cfg === undefined) {
  console.error(`未知 preset: ${PRESET}`);
  process.exit(1);
}

const profile = AI_PROFILES.advanced;

function emptyResult(): ShardResult {
  return {
    games: 0,
    rounds: 0,
    wins: 0,
    tsumo: 0,
    ron: 0,
    draws: 0,
    scoreSum: 0,
    hist: {},
    yaku: {},
  };
}

const acc = emptyResult();

function recordRound(state: GameState): void {
  acc.rounds += 1;
  const result = state.result;
  if (result === null) return;
  if (result.kind === 'draw') {
    acc.draws += 1;
    return;
  }
  for (const entry of result.entries) {
    acc.wins += 1;
    if (result.kind === 'tsumo') acc.tsumo += 1;
    else acc.ron += 1;
    const score = entry.result.score;
    acc.scoreSum += score;
    acc.hist[score] = (acc.hist[score] ?? 0) + 1;
    for (const hit of entry.result.hits) {
      const slot = acc.yaku[hit.key] ?? {
        name: hit.name,
        points: hit.points,
        count: 0,
        scoreSum: 0,
      };
      slot.count += 1;
      slot.scoreSum += score;
      // 同名番种的分值可能因牌型不同而变，取出现过的最大值方便展示
      if (hit.points > slot.points) slot.points = hit.points;
      acc.yaku[hit.key] = slot;
    }
  }
}

function playGame(seed: number | bigint | string): void {
  let state = createGame(cfg, seed);
  let guard = 0;
  while (true) {
    guard += 1;
    if (guard > 20000) throw new Error('对局没有收敛');
    if (state.phase === 'over') {
      recordRound(state);
      if (state.finished) return;
      state = reduce(state, { type: 'next-round' });
      continue;
    }
    const actor = state.actor;
    if (actor === null) throw new Error('未结束却没有行动者');
    const legal = legalActions(state, actor);
    if (legal.length === 0) throw new Error('行动者没有合法动作');
    state = reduce(state, decide(observe(state, actor), { profile }));
  }
}

// ── 分片 ──
if (SHARD !== undefined) {
  const [index, count] = SHARD.split('/').map(Number);
  const perShard = Math.ceil(GAMES / count);
  const first = index * perShard;
  const last = Math.min(GAMES, first + perShard);
  for (let game = first; game < last; game += 1) {
    playGame(offsetSeed(SEED, game));
    acc.games += 1;
  }
  if (RESULT === undefined) throw new Error('分片模式需要 --result=<文件>');
  writeFileSync(RESULT, JSON.stringify(acc), 'utf8');
  process.exit(0);
}

function mergeShard(part: ShardResult): void {
  acc.games += part.games;
  acc.rounds += part.rounds;
  acc.wins += part.wins;
  acc.tsumo += part.tsumo;
  acc.ron += part.ron;
  acc.draws += part.draws;
  acc.scoreSum += part.scoreSum;
  for (const [score, count] of Object.entries(part.hist)) {
    const key = Number(score);
    acc.hist[key] = (acc.hist[key] ?? 0) + count;
  }
  for (const [key, slot] of Object.entries(part.yaku)) {
    const target = acc.yaku[key] ?? { ...slot, count: 0, scoreSum: 0 };
    target.count += slot.count;
    target.scoreSum += slot.scoreSum;
    if (slot.points > target.points) target.points = slot.points;
    acc.yaku[key] = target;
  }
}

const started = Date.now();
if (JOBS > 1) {
  if (GAMES % JOBS !== 0) {
    console.error(`--jobs=${JOBS} 无法均分 ${GAMES} 局`);
    process.exit(1);
  }
  const stamp = `${process.pid}-${Date.now()}`;
  const resultFile = (index: number): string =>
    `.data/yaku-shard-${stamp}-${index}.json`;

  const passthrough: string[] = [];
  for (const [key, value] of args) {
    if (['jobs', 'shard', 'result', 'games', 'seed'].includes(key)) continue;
    passthrough.push(`--${key}=${value}`);
  }

  console.log(`番种统计：${JOBS} 片 × ${GAMES / JOBS} 局（共 ${GAMES} 局）`);
  await runShards({
    script: fileURLToPath(import.meta.url),
    jobs: JOBS,
    // 注意：这里传"总局数"和"基础种子"，由分片自己按 --shard=i/n 切出自己那一段。
    // 早先这里传的是"每片局数"，分片又除了一次分片数，导致每片只跑了 1/16 的量。
    argsFor: (index) => [
      ...passthrough,
      `--games=${GAMES}`,
      `--seed=${formatSeed(SEED)}`,
      `--result=${resultFile(index)}`,
    ],
    onTick: ({ finished, jobs, elapsed }) => {
      console.log(`  … 已完成 ${finished}/${jobs} 片（${elapsed}s）`);
    },
  });
  for (let index = 0; index < JOBS; index += 1) {
    const path = resultFile(index);
    mergeShard(JSON.parse(readFileSync(path, 'utf8')) as ShardResult);
    rmSync(path, { force: true });
  }
} else {
  for (let game = 0; game < GAMES; game += 1) {
    playGame(offsetSeed(SEED, game));
    acc.games += 1;
  }
}
const elapsed = ((Date.now() - started) / 1000).toFixed(0);

// ── 呈现 ──
const pct = (value: number, total: number): string =>
  total === 0 ? '—' : `${((value / total) * 100).toFixed(2)}%`;
const pad = (text: string, width: number): string => text.padEnd(width, ' ');

console.log(
  `\n番种统计 · ${PRESET} · ${acc.games} 局 / ${acc.rounds} 本场 · seed ${formatSeed(SEED)}` +
    `${JOBS > 1 ? ` · ${JOBS} 片并行` : ''} · 用时 ${elapsed}s`,
);
console.log(
  `和牌 ${acc.wins} 手（自摸 ${acc.tsumo} / 铳和 ${acc.ron}）· 流局 ${acc.draws} 本场` +
    ` · 和牌率 ${pct(acc.wins, acc.rounds)} · 平均打点 ${(acc.scoreSum / Math.max(1, acc.wins)).toFixed(2)}`,
);

console.log('\n【一】番种统计（按分值、次数排序）');
console.log('-'.repeat(74));
console.log(
  pad('番种', 16) +
    pad('分值', 6) +
    pad('次数', 8) +
    pad('出现率', 10) +
    pad('平均打点', 10),
);
console.log('-'.repeat(74));
const rows = Object.entries(acc.yaku)
  .map(([key, slot]) => ({ key, ...slot }))
  .sort((a, b) => b.points - a.points || b.count - a.count);
for (const row of rows) {
  console.log(
    pad(row.name, 16) +
      pad(String(row.points), 6) +
      pad(String(row.count), 8) +
      pad(pct(row.count, acc.wins), 10) +
      pad((row.scoreSum / row.count).toFixed(2), 10),
  );
}
console.log('-'.repeat(74));
console.log(`共 ${rows.length} 种番种出现过`);

console.log('\n【二】和牌得分分布');
console.log('-'.repeat(52));
console.log(
  pad('得分', 8) + pad('和牌数', 10) + pad('占比', 10) + pad('≥该分', 10),
);
console.log('-'.repeat(52));
const scores = Object.keys(acc.hist)
  .map(Number)
  .sort((a, b) => a - b);
let cumulative = 0;
const cumulativeByScore: Record<number, number> = {};
for (const score of [...scores].sort((a, b) => b - a)) {
  cumulative += acc.hist[score];
  cumulativeByScore[score] = cumulative;
}
for (const score of scores) {
  console.log(
    pad(String(score), 8) +
      pad(String(acc.hist[score]), 10) +
      pad(pct(acc.hist[score], acc.wins), 10) +
      pad(String(cumulativeByScore[score]), 10),
  );
}
console.log('-'.repeat(52));

writeFileSync(
  '.data/yaku-stats-last.json',
  JSON.stringify(
    { ...acc, elapsed: Number(elapsed), jobs: JOBS, preset: PRESET },
    null,
    2,
  ),
  'utf8',
);
console.log('\n结果已写入 .data/yaku-stats-last.json');
