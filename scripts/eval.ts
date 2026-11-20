// 自对弈评测：让两个 AI 档案轮流坐各个位子，统计和了率 / 放铳率 / 净得分 / 平均顺位。
//
// 【约定】A = 「迭代前」，B = 「迭代后」，打印的是 `B − A`：正值 = 迭代后更强。
//   参数用 `--before=` / `--after=`（`--anet=` / `--candnet=` 是旧别名，仅对调复核用）。
//   配对设计：同一副牌打两遍、交换座位，牌运被抵消；末尾打印配对 SE 与结论（|z|<2 判噪声）。
//   `--jobs=N` 分片并发；覆盖类参数（--pw/--uw/--df/--mp/--pol…）只作用于 B 侧。
//
// 用法：
//   node scripts/eval.ts --games=16 --seed=1 --preset=4p
//   node scripts/eval.ts --games=16 --lw=3        # 覆盖进阶档的前瞻权重
//   node scripts/eval.ts --games=16 --lw=0        # 对照实验：应当与普通完全一致
//   node scripts/eval.ts --games=300 --df=3000   # 覆盖进阶档的防守权重
import {
  createGame,
  startRound,
  legalActions,
  makeConfig,
  observe,
  reduce,
} from '../packages/core/src/index.ts';
import type { RuleConfig } from '../packages/core/src/index.ts';
import { AI_PROFILES, decide } from '../packages/core/src/ai/index.ts';
import { decodeWeights } from '../packages/core/src/ai/nn/model.ts';
import { decodePolicyWeights } from '../packages/core/src/ai/nn/policy.ts';
import { describeAb, summarizeAb } from '../packages/core/src/ai/eval-stats.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { runShards } from './parallel.ts';
import { formatSeed, offsetSeed, parseSeed } from './seed.ts';
import { resolve } from 'node:path';
import type { AiLevel, AiProfile } from '../packages/core/src/ai/index.ts';

interface Acc {
  seatRounds: number;
  wins: number;
  tsumo: number;
  ron: number;
  dealIn: number;
  dealInPoints: number;
  gain: number;
  placementSum: number;
  placementCount: number;
}

function emptyAcc(): Acc {
  return {
    seatRounds: 0,
    wins: 0,
    tsumo: 0,
    ron: 0,
    dealIn: 0,
    dealInPoints: 0,
    gain: 0,
    placementSum: 0,
    placementCount: 0,
  };
}

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const body = raw.replace(/^--/, '');
  const index = body.indexOf('=');
  if (index < 0) args.set(body, '1');
  else args.set(body.slice(0, index), body.slice(index + 1));
}

const GAMES = Number(args.get('games') ?? 24);
/** 复式模式：一组 = 两个本场（牌山四等分给座位，A/B 只换座位） */
const duplicate = args.get('duplicate') === '1';
const SEED = parseSeed(args.get('seed'));
const PRESET = args.get('preset') ?? '4p';
const LEVEL_A: AiLevel = 'advanced';
const LEVEL_B: AiLevel = 'advanced';

const CONFIGS: Record<string, RuleConfig> = {
  '4p': makeConfig({ rounds: 4 }),
  '3p': makeConfig({ players: 3, rounds: 3 }),
  '3p108': makeConfig({ players: 3, tileSet: 'sanma108', rounds: 3 }),
};

const baseCfg = CONFIGS[PRESET];
const cfg =
  baseCfg === undefined
    ? baseCfg
    : makeConfig({
        ...baseCfg,
        duplicateWalls: args.get('duplicate') === '1',
      });
if (cfg === undefined) {
  console.error(
    `未知 preset: ${PRESET}（可选 ${Object.keys(CONFIGS).join(' / ')}）`,
  );
  process.exit(1);
}

function tuned(level: AiLevel, isB: boolean): AiProfile {
  const base = AI_PROFILES[level];
  if (!isB) return base;
  const num = (key: string): number | undefined => {
    const raw = args.get(key);
    return raw === undefined ? undefined : Number(raw);
  };
  const pw = num('pw');
  const uw = num('uw');
  const sw = num('sw');
  const wp = num('wp');
  const lw = num('lw');
  const branch = num('branch');
  const noLook = args.get('nolook') === '1';
  const nnMode = args.get('nn');
  const nnb = num('nnb');
  const df = num('df');
  const mp = num('mp');
  const mm = num('mm');
  const nobias = args.get('nobias') === '1';
  /** 复现 2026-11-19 的"经典满偏好"（用于测总效果） */
  const CLASSIC_BIAS = {
    'sanse-tongshun': 1.65,
    qingyise: 1.25,
    hunyise: 1.2,
    qinglong: 1.6,
    sanlianhuan: 1.6,
    sanbugao: 1.4,
  } as const;
  const biasFull = args.get('biasfull') === '1';
  /** 番种偏好的整体缩放（1 = 原样，0.5 = 减半）；只作用于 B 侧 */
  const biasScale = num('bias') ?? 1;
  const nogate = args.get('nogate') === '1';
  const look = args.get('look') === '1';
  const dfh = num('dfh');
  const wpg = num('wpg');
  const ft = num('ft');

  return {
    ...base,
    weights: {
      shanten: sw ?? base.weights.shanten,
      ukeire: uw ?? base.weights.ukeire,
      potential: pw ?? base.weights.potential,
      winPath: wp ?? base.weights.winPath,
      nnBonus: nnb ?? base.weights.nnBonus,
      defense: df ?? base.weights.defense,
      defenseHistory: dfh ?? base.weights.defenseHistory,
      winPathFromNn: wpg ?? base.weights.winPathFromNn,
      foldTenpai: ft ?? base.weights.foldTenpai,
      meldPotential: mp ?? base.weights.meldPotential,
      meldMargin: mm ?? base.weights.meldMargin,
    },
    valueModel:
      nnMode === '2' ? 'heuristic+nn' : nnMode === '1' ? 'nn' : base.valueModel,
    lookahead: noLook ? 0 : look ? 1 : base.lookahead,
    lookaheadWeight: lw ?? base.lookaheadWeight,
    branch: branch ?? base.branch,
    yakuBias: nobias
      ? {}
      : biasFull
        ? CLASSIC_BIAS
        : biasScale === 1 || base.yakuBias === undefined
          ? base.yakuBias
          : Object.fromEntries(
              Object.entries(base.yakuBias).map(([key, value]) => [
                key,
                value * biasScale,
              ]),
            ),
    biasGate: nogate
      ? {
          requires: base.yakuBias === undefined ? 'qingyise' : 'qingyise',
          minProgress: 2,
          keys: [],
        }
      : biasFull
        ? {
            requires: 'qingyise',
            minProgress: 0.5,
            keys: ['qinglong', 'sanlianhuan', 'sanbugao'],
          }
        : base.biasGate,
  };
}

const profiles: AiProfile[] = [tuned(LEVEL_A, false), tuned(LEVEL_B, true)];

// 可选：给 B 侧换一个候选网络（A/B 实验）。路径是 weights.ts 同格式的文件。
// 可选：给 A 侧也换网络（两个强档直接对拼时用来做 A/B）
async function loadNets(spec: string | undefined) {
  if (spec === undefined) return undefined;
  const paths = spec
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const loaded = [];
  for (const path of paths) {
    const mod = await import(pathToFileURL(resolve(path)).href);
    loaded.push(
      decodeWeights(mod.NN_DIM0, mod.NN_DIM1, mod.NN_DIM2, mod.NN_WEIGHTS_B64),
    );
  }
  return loaded.length === 1 ? loaded[0] : loaded;
}

/** 权重文件路径 → 标签用的短名字 */
function netLabel(spec: string): string {
  return spec
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const base = item.replace(/\\/g, '/').split('/').pop() ?? item;
      return base.replace(/\.ts$/, '');
    })
    .join('+');
}

// A = 迭代前，B = 迭代后。`--anet` / `--candnet` 是旧别名。
const BEFORE = args.get('before') ?? args.get('anet');
const AFTER = args.get('after') ?? args.get('candnet');
if (args.get('anet') !== undefined && args.get('before') === undefined) {
  console.log('提示：--anet 是 --before 的旧别名（A = 迭代前）');
}
// 只给 --before 时 B 就是线上权重（= 迭代后），这是"拿线上权重当基准"的正常用法
if (BEFORE !== undefined && AFTER === undefined) {
  console.log(
    'B 侧未指定权重，按线上权重（迭代后）计。对调复核才需要 --after。',
  );
}

const aNet = await loadNets(BEFORE);
profiles[0] =
  aNet === undefined
    ? { ...profiles[0], label: 'A:线上权重' }
    : { ...profiles[0], label: `A:${netLabel(BEFORE ?? '')}`, nnWeights: aNet };
if (aNet !== undefined) console.log(`A 侧（迭代前）网络：${BEFORE}`);

/** 策略头（P0）：从导出的 .ts 里读 POLICY_WEIGHTS 并解码 */
async function loadPolicy(spec: string | undefined) {
  if (spec === undefined) return undefined;
  const mod = await import(pathToFileURL(resolve(spec)).href);
  if (mod.POLICY_WEIGHTS === undefined) {
    throw new Error(`${spec} 里没有导出 POLICY_WEIGHTS`);
  }
  return decodePolicyWeights(mod.POLICY_WEIGHTS);
}

const POLICY = await loadPolicy(args.get('pol'));
const POLICY_WEIGHT =
  args.get('polw') === undefined ? 1 : Number(args.get('polw'));
if (POLICY !== undefined) {
  profiles[1] = {
    ...profiles[1],
    weights: { ...profiles[1].weights, policyWeight: POLICY_WEIGHT },
    policyWeights: POLICY,
  };
  console.log(`B 侧启用策略头：${args.get('pol')}（权重 ${POLICY_WEIGHT}）`);
}

const bNet = await loadNets(AFTER);
profiles[1] =
  bNet === undefined
    ? { ...profiles[1], label: 'B:线上权重' }
    : { ...profiles[1], label: `B:${netLabel(AFTER ?? '')}`, nnWeights: bNet };
if (bNet !== undefined) console.log(`B 侧（迭代后）网络：${AFTER}`);
const accs: Acc[] = [emptyAcc(), emptyAcc()];
let draws = 0;
/** 每局的 `B 净得分 − A 净得分`（正值=迭代后更强），配对 SE 从这里算 */
const gameDiffs: number[] = [];

function playGame(gameIndex: number, seed: number | bigint | string): void {
  // 复式模式：一次只打一个本场（牌山按座位固定）；普通模式打完整一局
  let state = duplicate
    ? startRound(cfg, new Array<number>(cfg.players).fill(0), 0, seed)
    : createGame(cfg, seed);
  let guard = 0;
  // 本局开始前两边的累计净得分，结束时相减就是这一局各自的收益
  const gainBefore = [accs[0].gain, accs[1].gain];

  while (true) {
    guard += 1;
    if (guard > 20000) throw new Error('对局没有收敛');

    if (state.phase === 'over') {
      for (let seat = 0; seat < cfg.players; seat += 1) {
        accs[(gameIndex + seat) % 2].seatRounds += 1;
      }

      const result = state.result;
      if (result !== null) {
        if (result.kind === 'draw') draws += 1;
        for (const entry of result.entries) {
          const acc = accs[(gameIndex + entry.seat) % 2];
          acc.wins += 1;
          acc.gain += entry.gain;
          if (result.kind === 'tsumo') acc.tsumo += 1;
          else acc.ron += 1;
        }
        if (result.kind === 'ron' && result.discarder !== null) {
          const acc = accs[(gameIndex + result.discarder) % 2];
          const paid = result.entries.reduce(
            (sum, entry) => sum + entry.penalty,
            0,
          );
          acc.dealIn += 1;
          acc.dealInPoints += paid;
          acc.gain -= paid;
        }
      }

      // 复式下一场就是一个本场，打完即一组的一半
      if (duplicate || state.finished) {
        // 约定：B − A，正值代表迭代后更强
        gameDiffs.push(
          accs[1].gain - gainBefore[1] - (accs[0].gain - gainBefore[0]),
        );
        if (!duplicate) {
          const order = state.scores
            .map((score, seat) => ({ seat, score }))
            .sort((a, b) => b.score - a.score);
          order.forEach((entry, index) => {
            const acc = accs[(gameIndex + entry.seat) % 2];
            acc.placementSum += index + 1;
            acc.placementCount += 1;
          });
        }
        return;
      }
      state = reduce(state, { type: 'next-round' });
      continue;
    }

    const actor = state.actor;
    if (actor === null) throw new Error('未结束却没有行动者');
    const legal = legalActions(state, actor);
    if (legal.length === 0) throw new Error('行动者没有合法动作');
    const action = decide(observe(state, actor), {
      profile: profiles[(gameIndex + actor) % 2],
    });
    state = reduce(state, action);
  }
}

// ---------------------------------------------------------------------------
// 运行 + 汇总
// ---------------------------------------------------------------------------

if (GAMES % 2 !== 0) {
  console.error('--games 必须是偶数：每副牌要打两遍（交换座位）');
  process.exit(1);
}
const PAIRS = GAMES / 2;

function pct(value: number, total: number): string {
  if (total === 0) return '—';
  return `${((value / total) * 100).toFixed(1)}%`;
}

function pad(text: string, width: number): string {
  return text.padEnd(width, ' ');
}

/** 配对设计：同一副牌打两遍、交换座位，牌运差异被抵消 */
function runAllGames(): number {
  const started = Date.now();
  for (let pair = 0; pair < PAIRS; pair += 1) {
    const seed = offsetSeed(SEED, pair);
    playGame(pair * 2, seed);
    playGame(pair * 2 + 1, seed);
  }
  return Date.now() - started;
}

interface ShardResult {
  readonly accs: Acc[];
  readonly draws: number;
  readonly gameDiffs: number[];
}

function mergeShard(result: ShardResult): void {
  for (let index = 0; index < 2; index += 1) {
    const target = accs[index];
    const source = result.accs[index];
    target.seatRounds += source.seatRounds;
    target.wins += source.wins;
    target.tsumo += source.tsumo;
    target.ron += source.ron;
    target.dealIn += source.dealIn;
    target.dealInPoints += source.dealInPoints;
    target.gain += source.gain;
    target.placementSum += source.placementSum;
    target.placementCount += source.placementCount;
  }
  draws += result.draws;
  // 每个分片的 gameDiffs 长度都是偶数（成对），按片顺序拼接后配对关系不被打乱
  gameDiffs.push(...result.gameDiffs);
}

function printReport(elapsedMs: number, shards: number): void {
  const totalRounds = duplicate ? GAMES : GAMES * cfg.rounds;
  const shardNote = shards > 1 ? ` · ${shards} 片并行` : '';
  console.log(
    `\n自对弈评测 · ${PRESET}${duplicate ? '（复式）' : ''} · ${GAMES} 场 / ${totalRounds} 本场` +
      ` · ${PAIRS} ${duplicate ? '组' : '对'} · seed ${formatSeed(SEED)}${shardNote}` +
      ` · 用时 ${(elapsedMs / 1000).toFixed(1)}s`,
  );
  console.log('-'.repeat(105));
  console.log(
    pad('档案', 26) +
      pad('座位局', 8) +
      pad('和了', 6) +
      pad('和了率', 8) +
      pad('自摸', 6) +
      pad('铳和', 6) +
      pad('放铳', 6) +
      pad('放铳率', 8) +
      pad('净得分', 9) +
      pad('平均顺位', 10),
  );
  console.log('-'.repeat(105));

  for (let index = 0; index < 2; index += 1) {
    const acc = accs[index];
    const avgPlacement =
      acc.placementCount === 0 ? 0 : acc.placementSum / acc.placementCount;
    console.log(
      pad(profiles[index].label.slice(0, 25), 26) +
        pad(String(acc.seatRounds), 8) +
        pad(String(acc.wins), 6) +
        pad(pct(acc.wins, acc.seatRounds), 8) +
        pad(String(acc.tsumo), 6) +
        pad(String(acc.ron), 6) +
        pad(String(acc.dealIn), 6) +
        pad(pct(acc.dealIn, acc.seatRounds), 8) +
        pad(acc.gain.toFixed(1), 9) +
        pad(avgPlacement.toFixed(2), 10),
    );
  }

  console.log('-'.repeat(105));
  const summary = summarizeAb(gameDiffs);
  console.log(
    `流局 ${draws} 本场（${pct(draws, totalRounds)}）` +
      `　${GAMES} 局 / ${summary.pairs} 对（配对设计：同副牌打两遍、交换座位）`,
  );
  console.log(`A = 迭代前：${profiles[0].label}（${BEFORE ?? '线上权重'}）`);
  console.log(`B = 迭代后：${profiles[1].label}（${AFTER ?? '线上权重'}）`);
  console.log(
    `净得分差 B − A：${summary.perGame >= 0 ? '+' : ''}${summary.perGame.toFixed(2)} 分/局` +
      `　正数 = B（迭代后）更强`,
  );
  console.log(`结论：${describeAb(summary, duplicate ? '组' : '局')}`);
}

const JOBS = Number(args.get('jobs') ?? 1);
const SHARD = args.get('shard');
const RESULT = args.get('result');

// 分片模式：跑完写结果文件就退出，不打印（父进程负责汇总）
if (SHARD !== undefined) {
  if (RESULT === undefined) throw new Error('分片模式需要 --result=<文件>');
  runAllGames();
  const payload: ShardResult = { accs, draws, gameDiffs };
  writeFileSync(RESULT, JSON.stringify(payload), 'utf8');
  process.exit(0);
}

if (!Number.isInteger(JOBS) || JOBS < 1) {
  console.error(`--jobs 必须是正整数，收到 ${JOBS}`);
  process.exit(1);
}

if (JOBS > 1) {
  if (PAIRS % JOBS !== 0) {
    console.error(
      `--jobs=${JOBS} 无法均分 ${PAIRS} 对（每片必须是整数对）；` +
        `请换成能整除 ${PAIRS} 的 jobs`,
    );
    process.exit(1);
  }
  const pairsPerShard = PAIRS / JOBS;
  const stamp = `${process.pid}-${Date.now()}`;
  const resultFile = (index: number): string =>
    `.data/eval-shard-${stamp}-${index}.json`;

  // 父进程参数原样下发，只替换 games / seed / result
  const passthrough: string[] = [];
  for (const [key, value] of args) {
    if (['jobs', 'shard', 'result', 'games', 'seed'].includes(key)) continue;
    passthrough.push(`--${key}=${value}`);
  }

  console.log(
    `分片评测：${JOBS} 片 × ${pairsPerShard * 2} 局（共 ${GAMES} 局 / ${PAIRS} 对）`,
  );
  const { elapsed } = await runShards({
    script: fileURLToPath(import.meta.url),
    jobs: JOBS,
    argsFor: (index) => [
      ...passthrough,
      `--games=${pairsPerShard * 2}`,
      `--seed=${formatSeed(offsetSeed(SEED, index * pairsPerShard))}`,
      `--result=${resultFile(index)}`,
    ],
    onTick: ({ finished, jobs, elapsed: seconds }) => {
      console.log(`  … 已完成 ${finished}/${jobs} 片（${seconds}s）`);
    },
  });

  for (let index = 0; index < JOBS; index += 1) {
    const path = resultFile(index);
    mergeShard(JSON.parse(readFileSync(path, 'utf8')) as ShardResult);
    rmSync(path, { force: true });
  }
  printReport(elapsed * 1000, JOBS);
} else {
  printReport(runAllGames(), 1);
}
