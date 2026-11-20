export {
  KIND_COUNT,
  DRAGON_KINDS,
  HONOR_NAMES,
  WIND_KINDS,
  chiMeld,
  emptyHand,
  formatHand,
  handTotal,
  isHonorKind,
  isKanMeld,
  isNumberKind,
  isTerminalKind,
  isTripletMeld,
  isYaochuuKind,
  kindRank,
  kindSuit,
  meldRank,
  meldSuit,
  parseHand,
  parseMeld,
  parseTiles,
  ponMeld,
  tileCode,
  tileName,
} from './tiles.ts';
export type { Hand, Meld, MeldKind } from './tiles.ts';

export {
  activeKinds,
  dealerSeatOf,
  makeConfig,
  seatWindOf,
  windCount,
  windRoundOf,
} from './config.ts';
export type { PlayerCount, RuleConfig, TileSetId } from './config.ts';

export { decompose, isSevenPairs, isThirteenOrphans } from './decompose.ts';
export type { HandPattern, PatternType } from './decompose.ts';

export {
  YAKU,
  YAKU_TABLE,
  LIABILITY_FLOOR,
  MIN_WIN_POINTS,
  SCORE_CAP,
  SINGLE_YAKU_THRESHOLD,
} from './yaku.ts';
export type { LiabilityMode, YakuDef, YakuKey, YakuScope } from './yaku.ts';

export { EXPLICIT_IMPLICATION_COUNT, REACHES, implies } from './implication.ts';
export type { ImplicationMode } from './implication.ts';

export { ALL_MASK, PAIR_BIT, bitsOf, detectAll, makeHit } from './detect.ts';
export type { DetectCtx, WinFlags, YakuHit } from './detect.ts';

export {
  computeScore,
  dropImplied,
  evaluateWin,
  liabilityFor,
  meetsWinThreshold,
  mergeHands,
  penaltyOf,
  winSlots,
} from './evaluate.ts';
export type { PatternResult, WinInput, WinResult } from './evaluate.ts';

export {
  RNG_MODE,
  describeRng,
  drawRng,
  handGroups,
  createGame,
  isRng,
  legalActions,
  nextRng,
  nextRngBigInt,
  observe,
  randomRng,
  reduce,
  startRound,
  toRng,
  wallRemaining,
  windOf,
} from './engine/index.ts';
export type {
  Action,
  BestWinRecord,
  ClaimWindow,
  GameState,
  Observation,
  Phase,
  RoundEntryRecord,
  RoundRecord,
  RngState,
  RoundResult,
  ScoringEntry,
  Seat,
  WinGroup,
  YakuRecord,
} from './engine/index.ts';
