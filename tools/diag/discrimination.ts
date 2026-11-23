// 诊断：价值网络到底在学"这一打的好坏"，还是在学"局面结局"？
//
// 指标：
//   1. 同一局面下不同候选打牌的 V 离散度（判别力，越大越好）
//   2. 屏蔽局面特征（76..83）后 V 的变化（局面依赖度，越小越好）
//   3. 标签的组内方差 vs 组间方差——决定 r 的天花板来自哪里
import {
  createGame,
  legalActions,
  makeConfig,
  observe,
  reduce,
  wallRemaining,
} from '../../packages/core/src/index.ts';
import {
  decide,
  extractFeatures,
  improvingTiles,
  potentialScore,
  profileOf,
  shantenOf,
  visibleTiles,
} from '../../packages/core/src/ai/index.ts';
import { encodeInput } from '../../packages/core/src/ai/nn/features.ts';
import { readFileSync } from 'node:fs';
import { predict } from '../../packages/core/src/ai/nn/mlp.ts';
import {
  decodeWeights,
  NN_WEIGHTS,
} from '../../packages/core/src/ai/nn/model.ts';
import type { MlpWeights } from '../../packages/core/src/ai/nn/mlp.ts';

/** 从导出的 .ts 文件里取出 base64 并解码（用于对比不同模型） */
function loadModel(path: string): MlpWeights {
  const text = readFileSync(path, 'utf8');
  const dims = [0, 1, 2].map((index) => {
    const match = new RegExp(`NN_DIM${index}\\s*=\\s*(\\d+)`).exec(text);
    return match === null ? 0 : Number(match[1]);
  });
  const literal = /NN_WEIGHTS_B64\s*=\s*([\s\S]*?);/.exec(text);
  const b64 = (literal === null ? '' : literal[1]).replace(
    /[^A-Za-z0-9+/=]/g,
    '',
  );
  return decodeWeights(dims[0], dims[1], dims[2], b64);
}

const MODEL = process.argv[3];
const NET = MODEL === undefined ? NN_WEIGHTS : loadModel(MODEL);

const cfg = makeConfig({ rounds: 4 });
const profile = profileOf('advanced');
/** 局面级特征的下标（在 120 维里） */
const POSITION_DIMS = [76, 77, 78, 79, 80, 81, 82, 83];

function valueOf(
  input: Parameters<typeof encodeInput>[0],
  mask: boolean,
): number {
  const features = encodeInput(input);
  if (mask) for (const dim of POSITION_DIMS) features[dim] = 0;
  return predict(NET, features) * 12;
}

const GAMES = Number(process.argv[2] ?? 400);
const spreads: number[] = [];
const positionDeltas: number[] = [];
const maskedSpreads: number[] = [];
/** 每个决策点里，V 最高与最低候选的差——这是决策真正依赖的量 */
const ranges: number[] = [];

for (let game = 0; game < GAMES; game += 1) {
  let state = createGame(cfg, 1000 + game);
  let guard = 0;
  while (state.phase !== 'over' && guard < 20000) {
    guard += 1;
    const actor = state.actor;
    if (actor === null) break;
    const legal = legalActions(state, actor);
    if (legal.length === 0) break;
    const observation = observe(state, actor);
    const melds = state.melds[actor];
    const visible = visibleTiles(observation);
    const discards = legal.filter((item) => item.type === 'discard');
    if (discards.length >= 3) {
      const values: number[] = [];
      const maskedValues: number[] = [];
      for (const action of discards) {
        const tile = (action as { readonly tile: number }).tile;
        const after = observation.hand.slice();
        after[tile] -= 1;
        const input = {
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
        };
        const value = valueOf(input, false);
        values.push(value);
        maskedValues.push(valueOf(input, true));
        positionDeltas.push(Math.abs(value - valueOf(input, true)));
      }
      const mean = values.reduce((a, c) => a + c, 0) / values.length;
      const spread = Math.sqrt(
        values.reduce((a, c) => a + (c - mean) ** 2, 0) / values.length,
      );
      spreads.push(spread);
      ranges.push(Math.max(...values) - Math.min(...values));
      const maskedMean =
        maskedValues.reduce((a, c) => a + c, 0) / maskedValues.length;
      maskedSpreads.push(
        Math.sqrt(
          maskedValues.reduce((a, c) => a + (c - maskedMean) ** 2, 0) /
            maskedValues.length,
        ),
      );
    }
    state = reduce(state, decide(observe(state, actor), { profile }));
  }
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, c) => a + c, 0) / values.length;

console.log(
  `  模型 ${MODEL ?? '线上权重'} · 决策点 ${spreads.length} 个（${GAMES} 局）`,
);
console.log(
  `  候选间 V 离散度: 均值 ${mean(spreads).toFixed(3)} 分 · 极差均值 ${mean(ranges).toFixed(3)} 分`,
);
console.log(
  `  屏蔽局面维度后离散度: ${mean(maskedSpreads).toFixed(3)} 分（变化 ${(
    (mean(maskedSpreads) / Math.max(1e-9, mean(spreads)) - 1) *
    100
  ).toFixed(1)}%）`,
);
console.log(
  `  屏蔽局面维度造成的单点 V 变化: |ΔV| 均值 ${mean(positionDeltas).toFixed(3)} 分`,
);
const ratio = mean(positionDeltas) / Math.max(1e-9, mean(ranges));
console.log(
  `  局面依赖度 / 判别力 = ${ratio.toFixed(2)}（>1 说明局面影响比"选哪张"还大）`,
);
