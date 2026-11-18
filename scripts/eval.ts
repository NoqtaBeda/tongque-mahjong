// 自对弈评测：让两个 AI 档案轮流坐各个位子，统计和了率 / 放铳率 / 净得分 / 平均顺位。
//
// 用法：
//   node scripts/eval.ts --games=16 --seed=1 --preset=4p
//   node scripts/eval.ts --games=16 --lw=3        # 覆盖进阶档的前瞻权重
//   node scripts/eval.ts --games=16 --lw=0        # 对照实验：应当与普通完全一致
//   node scripts/eval.ts --games=300 --df=3000   # 覆盖进阶档的防守权重
import {
  createGame,
  legalActions,
  makeConfig,
  observe,
  reduce,
} from '../packages/core/src/index.ts';
import type { RuleConfig } from '../packages/core/src/index.ts';
import { AI_PROFILES, decide } from '../packages/core/src/ai/index.ts';
import { decodeWeights } from '../packages/core/src/ai/nn/model.ts';
import { pathToFileURL } from 'node:url';
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
const SEED = Number(args.get('seed') ?? 1);
const PRESET = args.get('preset') ?? '4p';
const LEVEL_A: AiLevel = 'advanced';
const LEVEL_B: AiLevel = 'advanced';

const CONFIGS: Record<string, RuleConfig> = {
  '4p': makeConfig({ rounds: 4 }),
  '3p': makeConfig({ players: 3, rounds: 3 }),
  '3p108': makeConfig({ players: 3, tileSet: 'sanma108', rounds: 3 }),
};

const cfg = CONFIGS[PRESET];
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
  const nogate = args.get('nogate') === '1';
  const look = args.get('look') === '1';
  const dfh = num('dfh');
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
      foldTenpai: ft ?? base.weights.foldTenpai,
      meldPotential: mp ?? base.weights.meldPotential,
      meldMargin: mm ?? base.weights.meldMargin,
    },
    valueModel:
      nnMode === '2' ? 'heuristic+nn' : nnMode === '1' ? 'nn' : base.valueModel,
    lookahead: noLook ? 0 : look ? 1 : base.lookahead,
    lookaheadWeight: lw ?? base.lookaheadWeight,
    branch: branch ?? base.branch,
    yakuBias: nobias ? {} : base.yakuBias,
    biasGate: nogate
      ? {
          requires: base.yakuBias === undefined ? 'qingyise' : 'qingyise',
          minProgress: 2,
          keys: [],
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

const ANET = args.get('anet');
const aNet = await loadNets(ANET);
if (aNet !== undefined) {
  profiles[0] = { ...profiles[0], nnWeights: aNet };
  console.log(`A 侧使用候选网络：${ANET}`);
}

const CANDNET = args.get('candnet');
if (CANDNET !== undefined) {
  const paths = CANDNET.split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const loaded = [];
  for (const path of paths) {
    const mod = await import(pathToFileURL(resolve(path)).href);
    loaded.push(
      decodeWeights(mod.NN_DIM0, mod.NN_DIM1, mod.NN_DIM2, mod.NN_WEIGHTS_B64),
    );
  }
  profiles[1] = {
    ...profiles[1],
    nnWeights: loaded.length === 1 ? loaded[0] : loaded,
  };
  console.log(`B 侧使用候选网络（${loaded.length} 个）：${CANDNET}`);
}
const accs: Acc[] = [emptyAcc(), emptyAcc()];
let draws = 0;

function playGame(gameIndex: number, seed: number): void {
  let state = createGame(cfg, seed);
  let guard = 0;

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

      if (state.finished) {
        const order = state.scores
          .map((score, seat) => ({ seat, score }))
          .sort((a, b) => b.score - a.score);
        order.forEach((entry, index) => {
          const acc = accs[(gameIndex + entry.seat) % 2];
          acc.placementSum += index + 1;
          acc.placementCount += 1;
        });
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

const started = Date.now();
// 配对设计：同一副牌打两遍、交换档案的座位分配。
// 这样牌运差异完全抵消，剩下的差值只来自两个档案的决策差异。
if (GAMES % 2 !== 0) {
  console.error('--games 必须是偶数：每副牌要打两遍（交换座位）');
  process.exit(1);
}
for (let pair = 0; pair < GAMES / 2; pair += 1) {
  const seed = SEED + pair;
  playGame(pair * 2, seed);
  playGame(pair * 2 + 1, seed);
}
const elapsed = Date.now() - started;

function pct(value: number, total: number): string {
  if (total === 0) return '—';
  return `${((value / total) * 100).toFixed(1)}%`;
}

function pad(text: string, width: number): string {
  return text.padEnd(width, ' ');
}

const totalRounds = GAMES * cfg.rounds;
console.log(
  `\n自对弈评测 · ${PRESET} · ${GAMES} 局 / ${totalRounds} 本场 · seed ${SEED} · 用时 ${(elapsed / 1000).toFixed(1)}s` +
    `\n普通档 vs 进阶档（每局换位，抵消座位优势）`,
);
console.log('-'.repeat(84));
console.log(
  pad('档案', 8) +
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
console.log('-'.repeat(84));

for (let index = 0; index < 2; index += 1) {
  const acc = accs[index];
  const profile = profiles[index];
  const net = acc.gain;
  const avgPlacement =
    acc.placementCount === 0 ? 0 : acc.placementSum / acc.placementCount;
  console.log(
    pad(profile.label, 8) +
      pad(String(acc.seatRounds), 8) +
      pad(String(acc.wins), 6) +
      pad(pct(acc.wins, acc.seatRounds), 8) +
      pad(String(acc.tsumo), 6) +
      pad(String(acc.ron), 6) +
      pad(String(acc.dealIn), 6) +
      pad(pct(acc.dealIn, acc.seatRounds), 8) +
      pad(net.toFixed(1), 9) +
      pad(avgPlacement.toFixed(2), 10),
  );
}

console.log('-'.repeat(84));
const diff = accs[0].gain - accs[1].gain;
console.log(
  `流局 ${draws} 本场（${pct(draws, totalRounds)}）` +
    `　净得分差（${profiles[0].label} − ${profiles[1].label}）：${diff.toFixed(1)}` +
    `　平均每局 ${(diff / GAMES).toFixed(2)}`,
);
