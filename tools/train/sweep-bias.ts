/**
 * 番种偏好扫描。
 *
 * 同一批种子下对比不同 `yakuBias` 配置，看：
 *   - 三色 / 一色类番种的出现频率（相对所有和牌）
 *   - 平均打点、和牌率、流局率
 *   - 可选：与基线 AI 的同桌对抗（2v2），看偏科是否以牺牲得分为代价
 *
 * 用法：
 *   node tools/train/sweep-bias.ts --configs=.data/bias-configs.json --rounds=800
 *   node tools/train/sweep-bias.ts --configs=... --h2h --games=120
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  createGame,
  legalActions,
  makeConfig,
  observe,
  reduce,
} from '../../packages/core/src/index.ts';
import type { GameState, RoundRecord } from '../../packages/core/src/index.ts';
import { decide, profileOf } from '../../packages/core/src/ai/index.ts';
import type { AiProfile, YakuBias } from '../../packages/core/src/ai/index.ts';

function argOf(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const CONFIGS_PATH = argOf('configs', '.data/bias-configs.json');
const ROUNDS = Number(argOf('rounds', '800'));
const GAMES = Number(argOf('games', '120'));
const SEED0 = Number(argOf('seed', '5000'));
const H2H = flag('h2h');
const OUT = argOf('out', '.data/bias-sweep.json');

/** 关心的番种（key 与 rules 里的一致） */
const WATCHED = [
  'sanse-tongshun',
  'sanse-tongke',
  'qingyise',
  'hunyise',
  'qinglong',
  'sanlianhuan',
  'sanbugao',
  'yise-santongshun',
  'yibangao',
] as const;

interface Config {
  readonly label: string;
  readonly bias: YakuBias;
}

const configs: Config[] = JSON.parse(readFileSync(CONFIGS_PATH, 'utf8'));
const BASE = profileOf('advanced');

interface Metrics {
  rounds: number;
  wins: number;
  draws: number;
  gain: number;
  ron: number;
  tsumo: number;
  yaku: Map<string, number>;
  /** 每个被关注番种的打点总和 */
  yakuGain: Map<string, number>;
}

function emptyMetrics(): Metrics {
  return {
    rounds: 0,
    wins: 0,
    draws: 0,
    gain: 0,
    ron: 0,
    tsumo: 0,
    yaku: new Map(),
    yakuGain: new Map(),
  };
}

function harvest(metrics: Metrics, record: RoundRecord): void {
  metrics.rounds += 1;
  if (record.entries.length === 0) {
    metrics.draws += 1;
    return;
  }
  for (const entry of record.entries) {
    metrics.wins += 1;
    metrics.gain += entry.gain;
    if (record.kind === 'ron') metrics.ron += 1;
    else metrics.tsumo += 1;
    for (const hit of entry.yaku) {
      metrics.yaku.set(hit.name, (metrics.yaku.get(hit.name) ?? 0) + 1);
      metrics.yakuGain.set(
        hit.name,
        (metrics.yakuGain.get(hit.name) ?? 0) + entry.gain,
      );
    }
  }
}

/** 番种 key → 中文名，从 yakuProspects 的 key 反查（这里是固定表，避免额外依赖） */
const KEY_TO_NAME: Record<string, string> = {
  'sanse-tongshun': '三色同顺',
  'sanse-tongke': '三色同刻',
  qingyise: '清一色',
  hunyise: '混一色',
  qinglong: '清龙',
  sanlianhuan: '三连环',
  sanbugao: '三步高',
  'yise-santongshun': '一色三同顺',
  yibangao: '一般高',
};

function playSeries(
  profile: AiProfile,
  targetRounds: number,
  seedStart: number,
): Metrics {
  const metrics = emptyMetrics();
  const cfg = makeConfig({ rounds: 8 });
  let seed = seedStart;
  while (metrics.rounds < targetRounds) {
    let state: GameState = createGame(cfg, seed);
    seed += 1;
    let harvested = 0;
    for (let step = 0; step < 200_000; step += 1) {
      if (state.finished) break;
      if (state.phase === 'over') {
        for (let index = harvested; index < state.history.length; index += 1) {
          harvest(metrics, state.history[index]);
        }
        harvested = state.history.length;
        state = reduce(state, { type: 'next-round' });
        continue;
      }
      const actor = state.actor;
      if (actor === null) break;
      const legal = legalActions(state, actor);
      if (legal.length === 0) break;
      state = reduce(state, decide(observe(state, actor), { profile }));
    }
    for (let index = harvested; index < state.history.length; index += 1) {
      harvest(metrics, state.history[index]);
    }
  }
  return metrics;
}

/** 2v2 同桌对抗：偶数座位用 profileA，奇数座位用 profileB */
function playHeadToHead(
  profileA: AiProfile,
  profileB: AiProfile,
  games: number,
  seedStart: number,
): { diff: number; games: number; winA: number; winB: number } {
  const cfg = makeConfig({ rounds: 8 });
  let diff = 0;
  let winA = 0;
  let winB = 0;
  for (let game = 0; game < games; game += 1) {
    let state: GameState = createGame(cfg, seedStart + game);
    for (let step = 0; step < 200_000; step += 1) {
      if (state.finished) break;
      if (state.phase === 'over') {
        state = reduce(state, { type: 'next-round' });
        continue;
      }
      const actor = state.actor;
      if (actor === null) break;
      const legal = legalActions(state, actor);
      if (legal.length === 0) break;
      const profile = actor % 2 === 0 ? profileA : profileB;
      state = reduce(state, decide(observe(state, actor), { profile }));
    }
    const a = state.scores[0] + state.scores[2];
    const b = state.scores[1] + state.scores[3];
    diff += a - b;
    if (a > b) winA += 1;
    else if (b > a) winB += 1;
  }
  return { diff: diff / Math.max(1, games), games, winA, winB };
}

function summarize(label: string, metrics: Metrics): Record<string, unknown> {
  const average = metrics.wins === 0 ? 0 : metrics.gain / metrics.wins;
  const watched: Record<
    string,
    { count: number; frequency: number; average: number }
  > = {};
  for (const key of WATCHED) {
    const name = KEY_TO_NAME[key];
    const count = metrics.yaku.get(name) ?? 0;
    watched[name] = {
      count,
      frequency: metrics.wins === 0 ? 0 : count / metrics.wins,
      average: count === 0 ? 0 : (metrics.yakuGain.get(name) ?? 0) / count,
    };
  }
  return {
    label,
    rounds: metrics.rounds,
    wins: metrics.wins,
    winRate: metrics.rounds === 0 ? 0 : metrics.wins / metrics.rounds,
    drawRate: metrics.rounds === 0 ? 0 : metrics.draws / metrics.rounds,
    average,
    tsumoShare: metrics.wins === 0 ? 0 : metrics.tsumo / metrics.wins,
    watched,
  };
}

function print(rows: Record<string, unknown>[]): void {
  console.log('');
  console.log(
    '配置            和牌率  流局率  平均打点  三色同顺  三色同刻  清一色  混一色  一色三同顺  一般高',
  );
  for (const row of rows) {
    const watched = row.watched as Record<string, { frequency: number }>;
    const pct = (name: string) =>
      `${(watched[name].frequency * 100).toFixed(2)}%`.padStart(8);
    console.log(
      `${(row.label as string).padEnd(14, ' ')} ` +
        `${((row.winRate as number) * 100).toFixed(1)}%`.padStart(7) +
        `${((row.drawRate as number) * 100).toFixed(1)}%`.padStart(8) +
        `${(row.average as number).toFixed(2)}`.padStart(10) +
        pct('三色同顺') +
        pct('清一色') +
        pct('清龙') +
        pct('三连环') +
        pct('三步高') +
        pct('一色三同顺') +
        pct('一般高'),
    );
  }
}

const rows: Record<string, unknown>[] = [];
for (const config of configs) {
  const profile: AiProfile = { ...BASE, yakuBias: config.bias };
  const metrics = playSeries(profile, ROUNDS, SEED0);
  const row = summarize(config.label, metrics);
  rows.push(row);
  console.log(
    `[${config.label}] ${metrics.rounds} 局完成 · 和牌 ${metrics.wins} · 平均打点 ${(row.average as number).toFixed(2)}`,
  );
}

print(rows);

let h2h: Record<string, unknown> | undefined;
if (H2H) {
  // 用第一个"非基线"配置和基线同桌对抗
  const candidate =
    configs.find((item) => Object.keys(item.bias).length > 0) ?? configs[0];
  const profileA: AiProfile = { ...BASE, yakuBias: candidate.bias };
  const result = playHeadToHead(profileA, BASE, GAMES, SEED0 + 90_000);
  console.log(
    `\n同桌对抗（${candidate.label} 坐 0/2 vs 基线坐 1/3，${result.games} 番）：` +
      `平均每场 ${result.diff >= 0 ? '+' : ''}${result.diff.toFixed(2)} 分 · 胜 ${result.winA} / 负 ${result.winB}`,
  );
  h2h = { label: candidate.label, ...result };
}

writeFileSync(
  OUT,
  JSON.stringify({ roundsWanted: ROUNDS, rows, h2h }, null, 2),
);
console.log(`\n已写入 ${OUT}`);
