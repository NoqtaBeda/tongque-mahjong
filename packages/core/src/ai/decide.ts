import { KIND_COUNT, emptyHand, ponMeld } from '../tiles.ts';
import type { Hand, Meld } from '../tiles.ts';
import type { RuleConfig } from '../config.ts';
import { MIN_WIN_POINTS } from '../yaku.ts';
import type { Action, Observation } from '../engine/types.ts';
import { chooseDiscard } from './discard.ts';
import type { DiscardWeights } from './discard.ts';
import { AI_PROFILES } from './profile.ts';
import type { AiProfile } from './profile.ts';
import type { BiasGate, YakuBias } from './potential.ts';
import type { MlpWeights } from './nn/mlp.ts';
import { shantenOf } from './shanten.ts';
import { extractFeatures } from './features.ts';
import { potentialScore } from './potential.ts';
import { DEFAULT_WEIGHTS } from './discard.ts';

export interface DecideOptions {
  readonly weights?: DiscardWeights;
  readonly profile?: AiProfile;
  /** 覆盖 profile 里的番种偏好 */
  readonly yakuBias?: YakuBias;
  /** 覆盖 profile 里的条件偏好 */
  readonly biasGate?: BiasGate;
  /** 覆盖 profile 里的网络权重（A/B 实验用） */
  readonly nnWeights?: MlpWeights | readonly MlpWeights[];
}

/** 已知不在牌山里的牌：所有人的牌河 + 别家的副露（自己的手牌与副露由 `improvingTiles` 自己算）。 */
export function visibleTiles(obs: Observation): Hand {
  const visible = emptyHand();
  for (const river of obs.discards) {
    for (const tile of river) visible[tile] += 1;
  }
  for (let seat = 0; seat < obs.melds.length; seat += 1) {
    if (seat === obs.seat) continue;
    for (const meld of obs.melds[seat]) {
      for (const tile of meld.tiles) visible[tile] += 1;
    }
  }
  return visible;
}

/** 打掉一张后能达到的最好向听数。 */
function shantenAfterDiscard(
  hand: Hand,
  meldCount: number,
  cfg: RuleConfig,
): number {
  let best = shantenOf(hand, meldCount, cfg).value;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (hand[kind] === 0) continue;
    hand[kind] -= 1;
    const value = shantenOf(hand, meldCount, cfg).value;
    hand[kind] += 1;
    if (value < best) best = value;
  }
  return best;
}

function callShanten(
  obs: Observation,
  action: Action,
  cfg: RuleConfig,
): number | null {
  const hand = obs.hand.slice();
  const melds: Meld[] = obs.melds[obs.seat].slice();

  if (action.type === 'pon') {
    const tile = obs.claim?.tile;
    if (tile === undefined || hand[tile] < 2) return null;
    hand[tile] -= 2;
    melds.push(ponMeld(tile));
    return shantenAfterDiscard(hand, melds.length, cfg);
  }
  if (action.type === 'kan') {
    const tile = obs.claim?.tile;
    if (tile === undefined || hand[tile] < 3) return null;
    hand[tile] -= 3;
    melds.push({ kind: 'minkan', tiles: [tile, tile, tile, tile] });
    // 明杠后会补一张再打一张，10 张暗牌 + 1 副露已经是 13 张等价形
    return shantenOf(hand, melds.length, cfg).value;
  }
  if (action.type === 'chi') {
    const tile = obs.claim?.tile;
    if (tile === undefined) return null;
    const [a, b] = action.tiles;
    if (hand[a] === 0 || hand[b] === 0) return null;
    hand[a] -= 1;
    hand[b] -= 1;
    const tiles = [a, b, tile].sort((x, y) => x - y);
    melds.push({ kind: 'chi', tiles });
    return shantenAfterDiscard(hand, melds.length, cfg);
  }
  return null;
}

/**
 * 鸣牌判断。
 *
 * 原来只看"向听是否推进"，这不合理：这套规则要求**原始和 ≥ 2 才能和牌**，
 * 所以碰/吃之后这手牌还剩多少番种价值，比单纯的向听数字更重要
 * （碰了役牌刻、或者吃出一副三色，价值可能不降反升）。
 *
 * 现在用和打牌同一套价值函数来比"吃碰前 vs 吃碰后"：
 *   价值 = (8 − 向听) × shanten + 潜力 × meldPotential + 够不够起和分
 * 只有价值严格变大才鸣牌（`meldMargin` 控制门槛，避免为了小便宜拆掉门清）。
 */
function claimValue(
  hand: Hand,
  melds: readonly Meld[],
  seatWind: number,
  shanten: number,
  weights: DiscardWeights,
): number {
  // 注意 `shanten` 要由调用方给：
  //  - 不鸣牌时 = 13 张手牌的向听（`shantenOf`）
  //  - 鸣牌后   = 已经打掉一张的等价形向听（`callShanten` 的返回值）
  // 两边都是"决策点之后最接近和牌的向听数"，才可比。
  const potential = potentialScore(extractFeatures(hand, melds, seatWind));
  const meldWeight =
    weights.meldPotential ?? DEFAULT_WEIGHTS.meldPotential ?? 0;
  return (
    (8 - shanten) * weights.shanten +
    potential * meldWeight +
    (potential >= MIN_WIN_POINTS ? weights.winPath : 0)
  );
}

function decideClaim(
  obs: Observation,
  legal: readonly Action[],
  weights: DiscardWeights = DEFAULT_WEIGHTS,
): Action {
  const pass: Action = { type: 'pass' };
  const meldCount = obs.melds[obs.seat].length;
  const hand = obs.hand.slice();
  const before = shantenOf(hand, meldCount, obs.cfg).value;
  const margin = weights.meldMargin ?? 0;

  let bestAction: Action | null = null;
  let bestValue =
    claimValue(hand, obs.melds[obs.seat], obs.seatWind, before, weights) +
    margin;

  for (const action of legal) {
    if (action.type === 'pass' || action.type === 'ron') continue;
    const after = callShanten(obs, action, obs.cfg);
    if (after === null) continue;

    const nextHand = hand.slice();
    const nextMelds: Meld[] = obs.melds[obs.seat].slice();
    if (action.type === 'pon') {
      const tile = obs.claim?.tile;
      if (tile === undefined) continue;
      nextHand[tile] -= 2;
      nextMelds.push(ponMeld(tile));
    } else if (action.type === 'kan') {
      const tile = obs.claim?.tile;
      if (tile === undefined) continue;
      nextHand[tile] -= 3;
      nextMelds.push({ kind: 'minkan', tiles: [tile, tile, tile, tile] });
    } else if (action.type === 'chi') {
      const tile = obs.claim?.tile;
      if (tile === undefined) continue;
      const [a, b] = action.tiles;
      nextHand[a] -= 1;
      nextHand[b] -= 1;
      nextMelds.push({
        kind: 'chi',
        tiles: [a, b, tile].sort((x, y) => x - y),
      });
    } else {
      continue;
    }

    // 杠要补一张再打，向听按"少一张"算，`callShanten` 已经处理过
    const value = claimValue(nextHand, nextMelds, obs.seatWind, after, weights);
    if (value > bestValue) {
      bestValue = value;
      bestAction = action;
    }
  }

  // 兜底：如果权重里没开 meldPotential（普通档），退回原来的"向听推进"判断
  if (bestAction === null && (weights.meldPotential ?? 0) === 0) {
    let bestShanten = before;
    for (const action of legal) {
      if (action.type === 'pass' || action.type === 'ron') continue;
      const after = callShanten(obs, action, obs.cfg);
      if (after === null) continue;
      const isKan = action.type === 'kan';
      const better = isKan ? after <= bestShanten : after < bestShanten;
      if (better) {
        bestShanten = after;
        bestAction = action;
      }
    }
  }

  return bestAction ?? pass;
}

function decideSelfKan(
  obs: Observation,
  legal: readonly Action[],
): Action | null {
  const meldCount = obs.melds[obs.seat].length;
  const current = shantenAfterDiscard(obs.hand.slice(), meldCount, obs.cfg);

  for (const action of legal) {
    if (action.type !== 'ankan' && action.type !== 'kakan') continue;
    const tile = action.tile;
    const hand = obs.hand.slice();
    const melds: Meld[] = obs.melds[obs.seat].slice();
    if (action.type === 'ankan') {
      if (hand[tile] !== 4) continue;
      hand[tile] = 0;
      melds.push({ kind: 'ankan', tiles: [tile, tile, tile, tile] });
    } else {
      const index = melds.findIndex(
        (meld) => meld.kind === 'pon' && meld.tiles[0] === tile,
      );
      if (index < 0 || hand[tile] === 0) continue;
      hand[tile] -= 1;
      melds[index] = { kind: 'kakan', tiles: [tile, tile, tile, tile] };
    }
    // 杠后补一张再打一张，10/11 张暗牌 + 副露已经是打牌后的等价形
    const after = shantenOf(hand, melds.length, obs.cfg).value;
    if (after <= current) return action;
  }
  return null;
}

function decideDiscard(
  obs: Observation,
  legal: readonly Action[],
  options: DecideOptions,
  profile: AiProfile,
): Action {
  const kan = decideSelfKan(obs, legal);
  if (kan !== null) return kan;

  const weights = options.weights ?? profile.weights;
  const tile = chooseDiscard(obs.hand, obs.melds[obs.seat], obs.cfg, {
    visible: visibleTiles(obs),
    seatWind: obs.seatWind,
    weights,
    lookahead: profile.lookahead,
    lookaheadWeight: profile.lookaheadWeight,
    branch: profile.branch,
    valueModel: profile.valueModel,
    yakuBias: options.yakuBias ?? profile.yakuBias,
    biasGate: options.biasGate ?? profile.biasGate,
    nnWeights: options.nnWeights ?? profile.nnWeights,
    defense:
      profile.weights.defense === undefined || profile.weights.defense === 0
        ? undefined
        : obs,
    nnContext: {
      round: obs.round,
      isDealer: obs.dealer === obs.seat,
      wallRemaining: obs.wallRemaining,
      score: obs.scores[obs.seat],
    },
  });

  if (tile === null) {
    const fallback = legal.find((action) => action.type === 'discard');
    return fallback ?? { type: 'pass' };
  }
  return { type: 'discard', tile };
}

/**
 * L0 决策：能与则和 → 值得的鸣牌 → 打牌。
 *
 * 规则上自摸与铳和对和牌者收益相同，所以"见逃"永远不是最优，见到和了就必和。
 */
export function decide(obs: Observation, options: DecideOptions = {}): Action {
  const legal = obs.legal;
  if (legal.length === 0) return { type: 'pass' };

  for (const action of legal) {
    if (action.type === 'tsumo' || action.type === 'ron') return action;
  }
  if (obs.phase === 'claim') {
    return decideClaim(
      obs,
      legal,
      options.weights ??
        options.profile?.weights ??
        AI_PROFILES.advanced.weights,
    );
  }
  if (obs.phase === 'over') {
    return legal[0];
  }
  return decideDiscard(
    obs,
    legal,
    options,
    options.profile ?? AI_PROFILES.advanced,
  );
}
