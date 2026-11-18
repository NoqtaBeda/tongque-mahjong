/**
 * 放铳风险评估。
 *
 * 本规则集**没有振听**（`packages/core/src/engine` 里没有任何 furiten 逻辑），
 * 所以日麻里"现物绝对安全 / 筋"这类确定性推理在这里全部失效 —— 自己打过的牌
 * 别人照样能铳和。只能按概率估：
 *
 *   P(某家铳和这张) ∝ 该家的威胁度 × 这张牌的"被需要程度" × 剩余张数占比
 *
 * 三个因子：
 *  1. 威胁度：副露越多越像已经听牌；牌河越长越接近听牌
 *  2. 被需要程度：中张（3~7）能被更多顺子用上，端牌和字牌次之
 *  3. 剩余张数：可见的越多，剩下能铳的那张越少
 */
import { KIND_COUNT } from '../tiles.ts';
import type { Hand, Meld } from '../tiles.ts';
import type { Observation } from '../engine/types.ts';

/** 汇总所有可见的牌：四家牌河 + 所有副露（含自己打出的）。 */
export function seenTiles(
  discards: readonly (readonly number[])[],
  melds: readonly (readonly Meld[])[],
): Hand {
  const seen: Hand = new Uint8Array(KIND_COUNT);
  for (const river of discards) {
    for (const tile of river) seen[tile] += 1;
  }
  for (const group of melds) {
    for (const meld of group) {
      for (const tile of meld.tiles) seen[tile] += 1;
    }
  }
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (seen[kind] > 4) seen[kind] = 4;
  }
  return seen;
}

/**
 * 对手威胁度（0..1）。
 *
 * 只用手能看到的公开信息：
 *  - 副露数：每副 +0.22（两副露基本就是听牌形）
 *  - 牌河长度：越接近尾声越可能已经听牌
 *  - 立直之类本规则没有，所以不建模
 */
export function threatOf(obs: Observation, seat: number): number {
  const melds = obs.melds[seat].length;
  const discards = obs.discards[seat].length;
  const raw = 0.12 + melds * 0.22 + Math.min(1, discards / 14) * 0.3;
  return raw > 1 ? 1 : raw;
}

/**
 * 单张牌的"被需要程度"基准（1.0 是中性）。
 *
 * 中张（3~7）能被三种顺子用上，最容易放铳；端牌次之；
 * 字牌只有成对/刻的用途，相对安全一些。
 */
function needBase(tile: number): number {
  if (tile >= 27) return 0.85; // 字牌
  const rank = tile % 9; // 0..8 对应 1..9
  if (rank === 0 || rank === 8) return 0.8; // 1 / 9
  if (rank === 1 || rank === 7) return 0.95; // 2 / 8
  return 1.15; // 3~7
}

/**
 * 概率标定系数。
 *
 * 未标定时，三家用"威胁度 × 被需要度 × 剩余占比"算出的单张铳和概率高达 60%，
 * 而实测放铳率只有 11.5%（见 `scripts/eval.ts`）。所以整体乘 0.2，
 * 让"随便打一张的期望失分"落在 0.5 分上下（≈ 11.5% × 平均 4 分）。
 */
const RISK = 0.2;

/**
 * 打掉这张牌的期望失分（单位：分）。
 *
 * 量纲与"期望得分"一致，所以可以直接和网络输出（× 潜力权重）放在一起比较。
 */
export function expectedLoss(
  obs: Observation,
  tile: number,
  seen: Hand,
  averagePenalty: number,
): number {
  const remaining = Math.max(0, 4 - seen[tile]);
  if (remaining === 0) return 0;
  const share = remaining / 4;
  let risk = 0;
  for (let seat = 0; seat < obs.cfg.players; seat += 1) {
    if (seat === obs.seat) continue;
    risk += threatOf(obs, seat);
  }
  return risk * needBase(tile) * share * averagePenalty * RISK;
}

/**
 * 牌河历史修正：对手自己打过的牌，被他铳和的概率更低。
 *
 * 本规则没有振听，所以"打过就一定安全"不成立；但统计上他手里已经不需要这类牌的概率更大，
 * 每打过一次就降权一档。`strength` 是降权力度（0 表示不考虑历史）。
 */
function historyFactor(
  obs: Observation,
  tile: number,
  strength: number,
): number {
  if (strength <= 0) return 1;
  let discards = 0;
  for (let seat = 0; seat < obs.cfg.players; seat += 1) {
    if (seat === obs.seat) continue;
    for (const item of obs.discards[seat]) if (item === tile) discards += 1;
  }
  const factor = 1 - strength * Math.min(2, discards);
  return factor < 0.35 ? 0.35 : factor;
}

/** 给每张牌算一个期望失分，供打牌时按需查表。 */
export function dangerTable(
  obs: Observation,
  averagePenalty = 4,
  historyStrength = 0,
): Float64Array {
  const seen = seenTiles(obs.discards, obs.melds);
  const table = new Float64Array(KIND_COUNT);
  for (let tile = 0; tile < KIND_COUNT; tile += 1) {
    table[tile] =
      expectedLoss(obs, tile, seen, averagePenalty) *
      historyFactor(obs, tile, historyStrength);
  }
  return table;
}
