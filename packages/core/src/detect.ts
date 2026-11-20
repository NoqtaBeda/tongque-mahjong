import {
  KIND_COUNT,
  handTotal,
  isKanMeld,
  isNumberKind,
  isTripletMeld,
  isYaochuuKind,
  kindRank,
  kindSuit,
  meldRank,
} from './tiles.ts';
import type { Hand, Meld } from './tiles.ts';
import type { RuleConfig } from './config.ts';
import { YAKU } from './yaku.ts';
import type { LiabilityMode, YakuKey, YakuScope } from './yaku.ts';
import type { HandPattern } from './decompose.ts';

/** bit0..3 = 4 副面子，bit4 = 雀头 */
export const PAIR_BIT = 1 << 4;
export const ALL_MASK = 0b11111;

export interface WinFlags {
  /** 杠上开花 */
  rinshan?: boolean;
  /** 抢杠 */
  chankan?: boolean;
  /** 妙手回春（摸最后一张自摸） */
  haitei?: boolean;
  /** 海底捞月（最后一张放铳） */
  houtei?: boolean;
  tenhou?: boolean;
  chiihou?: boolean;
}

export interface DetectCtx {
  readonly cfg: RuleConfig;
  /** 全部牌：暗牌 + 副露 + 杠的第 4 张 */
  readonly hand: Hand;
  readonly concealed: Hand;
  readonly melds: readonly Meld[];
  readonly seatWind: number;
  readonly winTile: number;
  readonly isTsumo: boolean;
  /** 门前清：没有吃/碰/明杠/加杠（暗杠不破门清） */
  readonly isConcealed: boolean;
  readonly flags: WinFlags;
}

export interface YakuHit {
  readonly id: number;
  readonly key: YakuKey;
  readonly name: string;
  readonly points: number;
  readonly scope: YakuScope;
  readonly liability: LiabilityMode;
  readonly meldMask: number;
  readonly param?: number;
}

export function bit(index: number): number {
  return 1 << index;
}

export function bitsOf(indices: readonly number[]): number {
  let mask = 0;
  for (const index of indices) mask |= 1 << index;
  return mask;
}

export function makeHit(
  key: YakuKey,
  meldMask: number,
  param?: number,
): YakuHit {
  const def = YAKU[key];
  const base = {
    id: def.id,
    key,
    name: def.name,
    points: def.points,
    scope: def.scope,
    liability: def.liability,
    meldMask,
  };
  return param === undefined ? base : { ...base, param };
}

export function detectAll(pattern: HandPattern, ctx: DetectCtx): YakuHit[] {
  const hits: YakuHit[] = [];
  detectColour(ctx, hits);
  detectAggregate(ctx, hits);

  if (pattern.type === 'standard') detectStandard(pattern, ctx, hits);
  else if (pattern.type === 'sevenPairs') detectSevenPairs(ctx, hits);
  else detectThirteenOrphans(hits);

  detectChance(ctx, hits);
  return hits;
}

// ---------------------------------------------------------------- 花色 / 聚合

function detectColour(ctx: DetectCtx, hits: YakuHit[]): void {
  const suits = new Set<number>();
  let hasHonor = false;
  let hasNumber = false;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (ctx.hand[kind] === 0) continue;
    if (kind >= 27) hasHonor = true;
    else {
      hasNumber = true;
      suits.add(Math.floor(kind / 9));
    }
  }

  if (!hasNumber) {
    hits.push(makeHit('ziyise', ALL_MASK));
    return;
  }
  if (!hasHonor && suits.size === 2) hits.push(makeHit('queyimen', ALL_MASK));
  if (hasHonor && suits.size === 1) hits.push(makeHit('hunyise', ALL_MASK));
  if (!hasHonor && suits.size === 1) hits.push(makeHit('qingyise', ALL_MASK));
}

const JU_BY_SPAN: Readonly<Record<number, YakuKey>> = {
  1: 'juliangshu',
  2: 'jusanshu',
  3: 'jusishu',
  4: 'juwushu',
};

function detectAggregate(ctx: DetectCtx, hits: YakuHit[]): void {
  let min = Number.POSITIVE_INFINITY;
  let max = -1;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (ctx.hand[kind] === 0) continue;
    if (kind >= 27) return; // 含字牌则不是"只有数牌"
    const rank = (kind % 9) + 1;
    if (rank < min) min = rank;
    if (rank > max) max = rank;
  }
  if (max < 0) return;
  const key = JU_BY_SPAN[max - min];
  if (key !== undefined) hits.push(makeHit(key, ALL_MASK));
}

// ---------------------------------------------------------------- 标准型

function detectStandard(
  pattern: HandPattern,
  ctx: DetectCtx,
  hits: YakuHit[],
): void {
  const sets = pattern.sets;
  const pair = pattern.pair;
  if (pair === null || sets.length !== 4) return;
  const pairKind = pair[0];

  const tripletIdx: number[] = [];
  const kanIdx: number[] = [];
  const chiByStart = new Map<number, number[]>();
  const tripletByKind = new Map<number, number[]>();

  for (let index = 0; index < sets.length; index += 1) {
    const meld = sets[index];
    if (isTripletMeld(meld)) {
      tripletIdx.push(index);
      push(tripletByKind, meld.tiles[0], index);
      if (isKanMeld(meld)) kanIdx.push(index);
    } else {
      push(chiByStart, meld.tiles[0], index);
    }
  }

  // 刻杠类
  if (tripletIdx.length === 4) hits.push(makeHit('pengpenghe', 0b1111));
  if (kanIdx.length === 1) hits.push(makeHit('yigang', bitsOf(kanIdx)));
  else if (kanIdx.length === 2) hits.push(makeHit('lianggang', bitsOf(kanIdx)));
  else if (kanIdx.length === 3) hits.push(makeHit('sangang', bitsOf(kanIdx)));
  else if (kanIdx.length === 4) hits.push(makeHit('sigang', bitsOf(kanIdx)));

  // 九莲宝灯：门清、14 张、形制固定
  if (
    ctx.isConcealed &&
    handTotal(ctx.concealed) === 14 &&
    isNineGates(ctx.concealed)
  ) {
    hits.push(makeHit('jiulian', ALL_MASK));
  }

  detectThreeColour(chiByStart, tripletByKind, pairKind, hits);
  detectSameSuitRuns(chiByStart, hits);
  detectSameSuitTriplets(tripletByKind, hits);
  detectMirror(sets, hits);
  detectTerminalSets(sets, pairKind, ctx, hits);
  detectHonourSets(sets, tripletIdx, pairKind, ctx, hits);
}

function push(map: Map<number, number[]>, key: number, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function isNineGates(concealed: Hand): boolean {
  const base = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  for (let suit = 0; suit < 3; suit += 1) {
    let extra = 0;
    let total = 0;
    let ok = true;
    for (let offset = 0; offset < 9; offset += 1) {
      const count = concealed[suit * 9 + offset];
      if (count < base[offset]) {
        ok = false;
        break;
      }
      extra += count - base[offset];
      total += count;
    }
    if (!ok) continue;
    let foreign = 0;
    for (let kind = 0; kind < KIND_COUNT; kind += 1) {
      if (Math.floor(kind / 9) !== suit) foreign += concealed[kind];
    }
    if (foreign === 0 && total === 14 && extra === 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------- 三色组合类

function detectThreeColour(
  chiByStart: ReadonlyMap<number, number[]>,
  tripletByKind: ReadonlyMap<number, number[]>,
  pairKind: number,
  hits: YakuHit[],
): void {
  // 三色同顺
  for (let offset = 0; offset < 7; offset += 1) {
    const picked = pickStarts(chiByStart, [offset, 9 + offset, 18 + offset]);
    if (picked !== null) hits.push(makeHit('sanse-tongshun', bitsOf(picked)));
  }

  // 二同刻（可复计，按数字）
  for (let rank = 1; rank <= 9; rank += 1) {
    const indices = pickAllTriplets(tripletByKind, rank);
    if (indices.length >= 2)
      hits.push(makeHit('ertongke', bitsOf(indices), rank));
  }

  // 小三色同刻：两刻同数字，雀头为同数字的第三种花色
  if (isNumberKind(pairKind)) {
    const rank = kindRank(pairKind);
    const pairSuit = kindSuit(pairKind);
    const bySuit = new Map<number, number>();
    for (let suit = 0; suit < 3; suit += 1) {
      if (suit === pairSuit) continue;
      const found = tripletByKind.get(suit * 9 + (rank - 1));
      if (found !== undefined && found.length > 0) bySuit.set(suit, found[0]);
    }
    if (bySuit.size >= 2) {
      const picked = [...bySuit.values()].slice(0, 2);
      hits.push(makeHit('xiao-san-se-tongke', bitsOf(picked) | PAIR_BIT, rank));
    }
  }

  // 三色同刻
  for (let rank = 1; rank <= 9; rank += 1) {
    const bySuit: number[] = [];
    for (let suit = 0; suit < 3; suit += 1) {
      const found = tripletByKind.get(suit * 9 + (rank - 1));
      if (found !== undefined && found.length > 0) bySuit.push(found[0]);
    }
    if (bySuit.length === 3)
      hits.push(makeHit('sanse-tongke', bitsOf(bySuit), rank));
  }
}

function pickStarts(
  map: ReadonlyMap<number, number[]>,
  starts: readonly number[],
): number[] | null {
  const picked: number[] = [];
  for (const start of starts) {
    const found = map.get(start);
    if (found === undefined || found.length === 0) return null;
    picked.push(found[0]);
  }
  return picked;
}

function pickAllTriplets(
  map: ReadonlyMap<number, number[]>,
  rank: number,
): number[] {
  const out: number[] = [];
  for (let suit = 0; suit < 3; suit += 1) {
    const found = map.get(suit * 9 + (rank - 1));
    if (found !== undefined) out.push(...found);
  }
  return out;
}

// ---------------------------------------------------------------- 一色组合类

function detectSameSuitRuns(
  chiByStart: ReadonlyMap<number, number[]>,
  hits: YakuHit[],
): void {
  const groups: number[][] = [];
  for (const indices of chiByStart.values()) {
    if (indices.length >= 2) groups.push(indices);
  }

  for (const indices of groups) {
    hits.push(makeHit('yibangao', bit(indices[0]) | bit(indices[1])));
    if (indices.length >= 3) {
      hits.push(
        makeHit(
          'yise-santongshun',
          bit(indices[0]) | bit(indices[1]) | bit(indices[2]),
        ),
      );
    }
    if (indices.length >= 4) {
      hits.push(makeHit('yise-sitongshun', bitsOf(indices.slice(0, 4))));
    }
  }

  if (groups.length >= 2) {
    const [first, second] = groups;
    hits.push(
      makeHit(
        'liangbangao',
        bit(first[0]) | bit(first[1]) | bit(second[0]) | bit(second[1]),
      ),
    );
  }

  for (let suit = 0; suit < 3; suit += 1) {
    const base = suit * 9;

    const dragon = pickStarts(chiByStart, [base, base + 3, base + 6]);
    if (dragon !== null) hits.push(makeHit('qinglong', bitsOf(dragon)));

    // 三连环：Δ = 2
    for (let from = 0; from <= 2; from += 1) {
      const picked = pickStarts(chiByStart, [
        base + from,
        base + from + 2,
        base + from + 4,
      ]);
      if (picked !== null) hits.push(makeHit('sanlianhuan', bitsOf(picked)));
    }

    // 三步高：Δ = 1
    for (let from = 0; from <= 4; from += 1) {
      const picked = pickStarts(chiByStart, [
        base + from,
        base + from + 1,
        base + from + 2,
      ]);
      if (picked !== null) hits.push(makeHit('sanbugao', bitsOf(picked)));
    }

    // 四连环：Δ = 2，唯一形态 1/3/5/7
    const fourStep = pickStarts(chiByStart, [
      base,
      base + 2,
      base + 4,
      base + 6,
    ]);
    if (fourStep !== null) hits.push(makeHit('silianhuan', bitsOf(fourStep)));

    // 四步高：Δ = 1
    for (let from = 0; from <= 3; from += 1) {
      const picked = pickStarts(chiByStart, [
        base + from,
        base + from + 1,
        base + from + 2,
        base + from + 3,
      ]);
      if (picked !== null) hits.push(makeHit('sibugao', bitsOf(picked)));
    }
  }
}

function detectSameSuitTriplets(
  tripletByKind: ReadonlyMap<number, number[]>,
  hits: YakuHit[],
): void {
  for (let suit = 0; suit < 3; suit += 1) {
    const base = suit * 9;

    for (let from = 0; from <= 6; from += 1) {
      const picked = pickStarts(tripletByKind, [
        base + from,
        base + from + 1,
        base + from + 2,
      ]);
      if (picked !== null) hits.push(makeHit('sanlianke', bitsOf(picked)));
    }
    for (let from = 0; from <= 5; from += 1) {
      const picked = pickStarts(tripletByKind, [
        base + from,
        base + from + 1,
        base + from + 2,
        base + from + 3,
      ]);
      if (picked !== null) hits.push(makeHit('silianke', bitsOf(picked)));
    }
  }
}

// ---------------------------------------------------------------- 对称类

function detectMirror(sets: readonly Meld[], hits: YakuHit[]): void {
  for (const meld of sets) {
    if (!isNumberKind(meld.tiles[0])) return;
  }

  const order = [0, 1, 2, 3];
  for (const [a1, a2, b1, b2] of permutations4(order)) {
    const setA1 = sets[a1];
    const setA2 = sets[a2];
    const setB1 = sets[b1];
    const setB2 = sets[b2];
    if (kindSuit(setA1.tiles[0]) !== kindSuit(setA2.tiles[0])) continue;
    if (kindSuit(setB1.tiles[0]) !== kindSuit(setB2.tiles[0])) continue;
    if (kindSuit(setA1.tiles[0]) === kindSuit(setB1.tiles[0])) continue;
    if (!sameShape(setA1, setB1)) continue;
    if (!sameShape(setA2, setB2)) continue;
    hits.push(makeHit('jingtong', bit(a1) | bit(a2) | bit(b1) | bit(b2)));
    return;
  }
}

function sameShape(left: Meld, right: Meld): boolean {
  if (isTripletMeld(left) !== isTripletMeld(right)) return false;
  return meldRank(left) === meldRank(right);
}

function* permutations4(
  items: readonly number[],
): Generator<readonly [number, number, number, number]> {
  for (const a of items) {
    for (const b of items) {
      if (b === a) continue;
      for (const c of items) {
        if (c === a || c === b) continue;
        for (const d of items) {
          if (d === a || d === b || d === c) continue;
          yield [a, b, c, d];
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 幺九 / 字牌

function detectTerminalSets(
  sets: readonly Meld[],
  pairKind: number,
  ctx: DetectCtx,
  hits: YakuHit[],
): void {
  const hasHonor = handHasHonor(ctx.hand);
  const setsCoverTerminal = sets.every((meld) =>
    meld.kind === 'chi'
      ? meldRank(meld) === 1 || meldRank(meld) === 7
      : isYaochuuKind(meld.tiles[0]),
  );
  const pairIsTerminal = isYaochuuKind(pairKind);

  if (setsCoverTerminal && pairIsTerminal) {
    if (hasHonor) hits.push(makeHit('hun-quan-dai-yaojiu', ALL_MASK));
    else hits.push(makeHit('chun-quan-dai-yaojiu', ALL_MASK));
  }

  const allTriplets = sets.every((meld) => isTripletMeld(meld));
  const allSetsTerminal = sets.every((meld) => isYaochuuKind(meld.tiles[0]));
  if (allTriplets && allSetsTerminal && pairIsTerminal) {
    if (hasHonor) hits.push(makeHit('hun-yaojiu', ALL_MASK));
    else hits.push(makeHit('qing-yaojiu', ALL_MASK));
  }
}

function detectHonourSets(
  sets: readonly Meld[],
  tripletIdx: readonly number[],
  pairKind: number,
  ctx: DetectCtx,
  hits: YakuHit[],
): void {
  const windTriplets = tripletIdx.filter((index) =>
    isWindKind(sets[index].tiles[0]),
  );
  const dragonTriplets = tripletIdx.filter((index) =>
    isDragonKind(sets[index].tiles[0]),
  );

  // 门风刻
  if (ctx.seatWind >= 0 && ctx.seatWind <= 3) {
    const wanted = 27 + ctx.seatWind;
    for (const index of tripletIdx) {
      if (sets[index].tiles[0] === wanted)
        hits.push(makeHit('menfengke', bit(index)));
    }
  }

  const pairIsWind = isWindKind(pairKind);
  const pairIsDragon = isDragonKind(pairKind);

  if (
    windTriplets.length >= 2 &&
    pairIsWind &&
    !includesKind(sets, windTriplets, pairKind)
  ) {
    hits.push(
      makeHit(
        'xiao-san-feng-ke',
        bit(windTriplets[0]) | bit(windTriplets[1]) | PAIR_BIT,
      ),
    );
  }
  if (windTriplets.length >= 3) {
    hits.push(makeHit('san-feng-ke', bitsOf(windTriplets.slice(0, 3))));
  }
  if (
    windTriplets.length === 3 &&
    pairIsWind &&
    !includesKind(sets, windTriplets, pairKind)
  ) {
    hits.push(makeHit('xiao-sixi', bitsOf(windTriplets) | PAIR_BIT));
  }
  if (windTriplets.length === 4) hits.push(makeHit('da-sixi', 0b1111));

  for (const index of dragonTriplets)
    hits.push(makeHit('sanyuanke', bit(index)));
  if (
    dragonTriplets.length === 2 &&
    pairIsDragon &&
    !includesKind(sets, dragonTriplets, pairKind)
  ) {
    hits.push(makeHit('xiao-sanyuan', bitsOf(dragonTriplets) | PAIR_BIT));
  }
  if (dragonTriplets.length === 3)
    hits.push(makeHit('da-sanyuan', bitsOf(dragonTriplets)));
}

function includesKind(
  sets: readonly Meld[],
  indices: readonly number[],
  kind: number,
): boolean {
  return indices.some((index) => sets[index].tiles[0] === kind);
}

function isWindKind(kind: number): boolean {
  return kind >= 27 && kind <= 30;
}

function isDragonKind(kind: number): boolean {
  return kind >= 31 && kind <= 33;
}

function handHasHonor(hand: Hand): boolean {
  for (let kind = 27; kind < KIND_COUNT; kind += 1) {
    if (hand[kind] > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------- 特殊和牌型

function detectSevenPairs(ctx: DetectCtx, hits: YakuHit[]): void {
  hits.push(makeHit('qiduizi', ALL_MASK));

  // 七对子型没有面子，但"全体"类番种仍可成立；混幺九/清幺九 在这里单独判定。
  let allTerminal = true;
  let hasHonor = false;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (ctx.hand[kind] === 0) continue;
    if (!isYaochuuKind(kind)) allTerminal = false;
    if (kind >= 27) hasHonor = true;
  }
  if (allTerminal) {
    if (hasHonor) hits.push(makeHit('hun-yaojiu', ALL_MASK));
    else hits.push(makeHit('qing-yaojiu', ALL_MASK));
  }
}

function detectThirteenOrphans(hits: YakuHit[]): void {
  hits.push(makeHit('shisansan', ALL_MASK));
}

// ---------------------------------------------------------------- 偶然事件

function detectChance(ctx: DetectCtx, hits: YakuHit[]): void {
  const flags = ctx.flags;
  if (flags.rinshan === true) hits.push(makeHit('gangshang-kaihua', ALL_MASK));
  if (flags.chankan === true) hits.push(makeHit('qianggang', ALL_MASK));
  if (flags.haitei === true) hits.push(makeHit('miaoshou-huichun', ALL_MASK));
  if (flags.houtei === true) hits.push(makeHit('haidi-laoyue', ALL_MASK));
  if (flags.tenhou === true) hits.push(makeHit('tianhe', ALL_MASK));
  if (flags.chiihou === true) hits.push(makeHit('dihe', ALL_MASK));
}
