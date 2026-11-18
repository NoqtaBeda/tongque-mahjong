/**
 * 让「进阶」AI 自己打一段时间，统计和牌的打点与番种分布。
 *
 * 用法：
 *   node scripts/yaku-stats.ts --minutes=25 [--seed=0] [--out=.data/yaku-stats.json]
 *
 * 统计口径：
 *   - 平均打点 = 所有和牌的和牌分（entry.gain）之和 / 和牌次数
 *   - 番种出现频率 = 含该番种的和牌次数 / 和牌次数
 *   - 番种平均打点 = 含该番种的和牌的打点之和 / 含该番种的次数
 *   - 流局不计入「和牌次数」，但计入局数
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  createGame,
  legalActions,
  makeConfig,
  observe,
  reduce,
} from '../packages/core/src/index.ts';
import type { GameState, RoundRecord } from '../packages/core/src/index.ts';
import { decide, profileOf } from '../packages/core/src/ai/index.ts';

function argOf(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const MINUTES = Number(argOf('minutes', '25'));
const SEED0 = Number(argOf('seed', '0'));
const OUT = argOf('out', '.data/yaku-stats.json');
const ADVANCED = profileOf('advanced');

interface Tally {
  count: number;
  gain: number;
}

const tally = new Map<string, Tally>();
const scores: number[] = [];
let rounds = 0;
let draws = 0;
let tsumoWins = 0;
let ronWins = 0;
let totalGain = 0;
let wins = 0;
/** 每次和牌命中的番种个数，用来观察"番种是不是总扎堆" */
let yakuPerWin = 0;

function harvest(record: RoundRecord): void {
  rounds += 1;
  if (record.entries.length === 0) {
    draws += 1;
    return;
  }
  for (const entry of record.entries) {
    wins += 1;
    totalGain += entry.gain;
    scores.push(entry.gain);
    yakuPerWin += entry.yaku.length;
    if (record.kind === 'tsumo') tsumoWins += 1;
    else ronWins += 1;

    // 同一手牌里同名的番种只记一次（理论上不会重复，防一下）
    const seen = new Set<string>();
    for (const hit of entry.yaku) {
      if (seen.has(hit.name)) continue;
      seen.add(hit.name);
      const slot = tally.get(hit.name) ?? { count: 0, gain: 0 };
      slot.count += 1;
      slot.gain += entry.gain;
      tally.set(hit.name, slot);
    }
  }
}

const started = Date.now();
const deadline = started + MINUTES * 60_000;

let seed = SEED0;
let lastReport = started;

function playOne(): boolean {
  if (Date.now() > deadline) return false;
  const cfg = makeConfig({ rounds: 8 });
  let state: GameState = createGame(cfg, seed);
  seed += 1;
  let harvested = 0;

  for (let step = 0; step < 200_000; step += 1) {
    if (Date.now() > deadline) break;
    if (state.finished) break;
    if (state.phase === 'over') {
      for (let index = harvested; index < state.history.length; index += 1) {
        harvest(state.history[index]);
      }
      harvested = state.history.length;
      state = reduce(state, { type: 'next-round' });
      continue;
    }
    const actor = state.actor;
    if (actor === null) break;
    const legal = legalActions(state, actor);
    if (legal.length === 0) break;
    state = reduce(state, decide(observe(state, actor), { profile: ADVANCED }));
  }

  for (let index = harvested; index < state.history.length; index += 1) {
    harvest(state.history[index]);
  }
  return true;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[at];
}

function report(final: boolean): void {
  const sorted = [...scores].sort((a, b) => a - b);
  const average = wins === 0 ? 0 : totalGain / wins;
  const rows = [...tally]
    .map(([name, slot]) => ({
      name,
      count: slot.count,
      frequency: wins === 0 ? 0 : slot.count / wins,
      average: slot.count === 0 ? 0 : slot.gain / slot.count,
    }))
    .sort((a, b) => b.count - a.count || b.average - a.average);

  const elapsed = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(
    `[${elapsed} 分] 局 ${rounds} · 和牌 ${wins}（自摸 ${tsumoWins} / 铳和 ${ronWins}）` +
      ` · 流局 ${draws} · 平均打点 ${average.toFixed(2)} · 番种 ${tally.size} 种`,
  );
  if (final) {
    console.log('');
    console.log('=== 打点分布 ===');
    console.log(
      `  平均 ${average.toFixed(3)} · 中位 ${percentile(sorted, 0.5)} · ` +
        `最小 ${sorted[0] ?? 0} · 最大 ${sorted[sorted.length - 1] ?? 0}`,
    );
    console.log(
      `  平均每手番种数 ${(yakuPerWin / Math.max(1, wins)).toFixed(2)}`,
    );
    console.log('');
    console.log('=== 番种（按出现次数排序） ===');
    console.log('  名称            次数    频率     平均打点');
    for (const row of rows) {
      console.log(
        `  ${row.name.padEnd(14, '　')} ${String(row.count).padStart(6)} ` +
          `${(row.frequency * 100).toFixed(2).padStart(7)}% ${row.average.toFixed(2).padStart(8)}`,
      );
    }
    console.log('');
    console.log(
      `  和牌率 ${((wins / Math.max(1, rounds)) * 100).toFixed(1)}% · ` +
        `流局率 ${((draws / Math.max(1, rounds)) * 100).toFixed(1)}%`,
    );

    mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')) || '.', { recursive: true });
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          minutes: MINUTES,
          rounds,
          wins,
          tsumoWins,
          ronWins,
          draws,
          average,
          median: percentile(sorted, 0.5),
          min: sorted[0] ?? 0,
          max: sorted[sorted.length - 1] ?? 0,
          yakuPerWin: yakuPerWin / Math.max(1, wins),
          rows,
        },
        null,
        2,
      ),
    );
    console.log(`\n已写入 ${OUT}`);
  }
}

console.log(
  `进阶 AI 自对弈统计：跑 ${MINUTES} 分钟，从 seed ${SEED0} 开始（每局 8 小局）`,
);

while (playOne()) {
  if (Date.now() - lastReport > 60_000) {
    lastReport = Date.now();
    report(false);
  }
}

report(true);
