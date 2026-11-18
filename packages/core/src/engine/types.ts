import type { Hand, Meld } from '../tiles.ts';
import type { RuleConfig } from '../config.ts';
import type { PatternResult } from '../evaluate.ts';

export type Seat = number;

export type Phase = 'discard' | 'claim' | 'over';

export type Action =
  /** 打出一张牌（discard 阶段） */
  | { readonly type: 'discard'; readonly tile: number }
  /** 自摸和了 */
  | { readonly type: 'tsumo' }
  /** 铳和 */
  | { readonly type: 'ron' }
  /** 放弃鸣牌 / 放弃和了 */
  | { readonly type: 'pass' }
  /** 吃：`tiles` 是手里拿出的两张 */
  | { readonly type: 'chi'; readonly tiles: readonly [number, number] }
  | { readonly type: 'pon' }
  /** 大明杠（claim 阶段） */
  | { readonly type: 'kan' }
  /** 暗杠（discard 阶段） */
  | { readonly type: 'ankan'; readonly tile: number }
  /** 加杠（discard 阶段） */
  | { readonly type: 'kakan'; readonly tile: number }
  /** 本局结束后进入下一局 */
  | { readonly type: 'next-round' };

export interface ClaimWindow {
  readonly tile: number;
  readonly from: Seat;
  /** 还没应答的座位，按距离打牌者的远近排列 */
  pending: Seat[];
  responses: (Action | null)[];
  /** 抢杠窗口：只允许 和 / 过 */
  readonly robKan: boolean;
}

export interface ScoringEntry {
  readonly seat: Seat;
  readonly result: PatternResult;
  /** 和牌张（自摸时就是摸到的那张） */
  readonly winTile: number;
  /** 和牌者得分 S */
  readonly gain: number;
  /** 该放铳者需要支付的 P（自摸时为 0） */
  readonly penalty: number;
  /** 手牌分组（副露 → 暗手面子 → 雀头），引擎算好，UI 直接读 */
  readonly groups: readonly WinGroup[];
}

export interface RoundResult {
  readonly kind: 'tsumo' | 'ron' | 'draw';
  readonly entries: readonly ScoringEntry[];
  readonly discarder: Seat | null;
}

/** 和牌型的一组：副露或暗手面子/雀头 */
export interface WinGroup {
  readonly tiles: readonly number[];
  /** true = 副露，false = 暗手面子或雀头 */
  readonly melded: boolean;
  /**
   * 这一组是雀头（七对子 / 十三幺里所有对子都算）。
   *
   * 展示和牌张时要靠它区分：铳牌既是面子的一部分又能读成雀头时（例如
   * `123 345 567 789 + 11` 的 1），和牌张应该标在面子里而不是雀头里。
   */
  readonly pair?: boolean;
}

/** 命中的一个番种，记录里只保留展示需要的字段 */
export interface YakuRecord {
  readonly name: string;
  readonly points: number;
  /** 是否计入关联铳责（决定标签是否高亮） */
  readonly liable: boolean;
}

/** 整场里分值最高的那次和牌，供终局页面回顾 */
export interface BestWinRecord {
  readonly seat: Seat;
  readonly round: number;
  readonly kind: 'tsumo' | 'ron';
  readonly gain: number;
  /** 蕴含剔除后的番数和 */
  readonly rawSum: number;
  readonly winTile: number;
  /** 和牌型拆解：副露 → 暗手面子 → 雀头 */
  readonly groups: readonly WinGroup[];
  readonly yaku: readonly YakuRecord[];
}

/** 对局记录里的一次和牌 */
export interface RoundEntryRecord {
  readonly seat: Seat;
  readonly gain: number;
  readonly winTile: number;
  /** 和牌型拆解：副露 → 暗手面子 → 雀头 */
  readonly groups: readonly WinGroup[];
  readonly yaku: readonly YakuRecord[];
  /** 这名和牌者对应的放铳失分（自摸为 0） */
  readonly penalty: number;
  readonly discarder: Seat | null;
}

/** 一局的记录：谁和了什么牌、得多少分、放铳者失多少分 */
export interface RoundRecord {
  readonly round: number;
  readonly kind: 'tsumo' | 'ron' | 'draw';
  readonly entries: readonly RoundEntryRecord[];
  /** 本局开始前四家的累计分，用于展示「X → Y」 */
  readonly scoresBefore: readonly number[];
  /** 本局结束后四家的累计分 */
  readonly scoresAfter: readonly number[];
}

export interface GameState {
  cfg: RuleConfig;
  /** 洗牌用的随机数状态，保证可复现 */
  rngState: number;
  round: number;
  dealer: Seat;
  phase: Phase;
  actor: Seat | null;

  hands: Hand[];
  melds: Meld[][];
  discards: number[][];
  /**
   * 牌河里每一张是不是「摸切」：true = 刚摸到就打了出去，false = 从手里打出的手切。
   *
   * 与 `discards` 一一对应、等长。被吃碰杠取走的牌会同时从两个数组里弹出。
   * 判定只看牌种：和刚摸到的那张同种就算摸切（手里是否另有一张同样的牌不影响）。
   */
  tsumogiri: boolean[][];
  scores: number[];

  /** 完整牌山（洗好的顺序） */
  wall: number[];
  /** 下一张正常摸牌的位置 */
  drawIndex: number;
  /** 活牌山的结尾（王牌从这里开始） */
  liveEnd: number;
  /** 王牌里下一个杠补牌的位置 */
  deadCursor: number;

  kanCounts: number[];
  /** 每家的摸牌次数，用于天和/地和判定 */
  drawCounts: number[];
  /** 本局已经发生的打牌次数 */
  turnIndex: number;

  lastDiscard: { tile: number; from: Seat } | null;
  claim: ClaimWindow | null;
  result: RoundResult | null;
  /** 整场分值最高的和牌，跨局保留 */
  bestWin: BestWinRecord | null;
  /** 已结束的每一局（含流局），跨局累积，供对局记录面板展示 */
  history: RoundRecord[];
  /** 刚摸到的牌（用于高亮与自摸判定） */
  drawnTile: number | null;
  /** 这张牌是否来自杠后补牌 */
  rinshan: boolean;
  /** 全部局数已打完 */
  finished: boolean;
}

export interface Observation {
  readonly cfg: RuleConfig;
  readonly round: number;
  readonly dealer: Seat;
  readonly seat: Seat;
  /** 门风：0=东 1=南 2=西 3=北 */
  readonly seatWind: number;
  readonly phase: Phase;
  readonly isActor: boolean;
  readonly hand: Hand;
  readonly melds: readonly (readonly Meld[])[];
  readonly discards: readonly (readonly number[])[];
  /** 与 discards 等长：true = 摸切 */
  readonly tsumogiri: readonly (readonly boolean[])[];
  readonly scores: readonly number[];
  readonly wallRemaining: number;
  readonly lastDiscard: { readonly tile: number; readonly from: Seat } | null;
  readonly claim: { readonly tile: number; readonly from: Seat } | null;
  readonly drawnTile: number | null;
  readonly legal: readonly Action[];
}
