import { KIND_COUNT } from './tiles.ts';

export type PlayerCount = 3 | 4;
export type TileSetId = 'std136' | 'sanma108' | 'sanma-noword';

export interface RuleConfig {
  readonly players: PlayerCount;
  /**
   * 牌张构成：
   *   - std136：标准 136 张；
   *   - sanma108：三人·有字 —— 去掉二至八万，保留字牌；
   *   - sanma-noword：三人·无字 —— 去掉全部字牌，万饼索 1~9 全留。
   * 后两者都是 108 张，只是组成不同。
   */
  readonly tileSet: TileSetId;
  readonly allowChi: boolean;
  /** 牌山末尾保留 14 张王牌，仅用于杠后补牌。 */
  readonly keepDeadWall: boolean;
  /**
   * 复式（duplicate）模式：牌山四等分，每人只从自己的那段摸牌，
   * 杠后补牌从自己那段尾部取；任一玩家需要摸/补而无牌即流局。
   * 仅用于 A/B 测试的配对对局，不支持三人麻将。
   */
  readonly duplicateWalls: boolean;
  readonly allowSevenPairs: boolean;
  /** 七对子是否允许重复对子（龙七对）。 */
  readonly sevenPairsQuadAsTwoPairs: boolean;
  readonly allowThirteenOrphans: boolean;
  /** 总局数；必须为玩家人数的整数倍（每风圈每人一局坐庄）。 */
  readonly rounds: number;
}

const BASE_CONFIG: RuleConfig = {
  players: 4,
  tileSet: 'std136',
  allowChi: true,
  keepDeadWall: true,
  duplicateWalls: false,
  allowSevenPairs: true,
  sevenPairsQuadAsTwoPairs: false,
  allowThirteenOrphans: true,
  rounds: 4,
};

export function makeConfig(overrides: Partial<RuleConfig> = {}): RuleConfig {
  const merged: RuleConfig = { ...BASE_CONFIG, ...overrides };
  if (!Number.isInteger(merged.rounds) || merged.rounds <= 0) {
    throw new Error(`rounds must be a positive integer, got ${merged.rounds}`);
  }
  if (merged.duplicateWalls && merged.players !== 4) {
    throw new Error(`复式牌山只支持四人麻将，收到 players=${merged.players}`);
  }
  if (merged.rounds % merged.players !== 0) {
    throw new Error(
      `rounds (${merged.rounds}) must be a multiple of players (${merged.players})`,
    );
  }
  // 复式把 136 张全部分给四家，不能再留 14 张王牌
  return merged.duplicateWalls ? { ...merged, keepDeadWall: false } : merged;
}
/** 风数 = 局数 / 人数（东风 1、半庄 2、三风 3、全庄 4）。 */
export function windCount(cfg: RuleConfig): number {
  return cfg.rounds / cfg.players;
}

/**
 * 该配置下实际参与洗牌的牌种。
 * 108 张模式只去掉万子的 2~8（牌种 1..7），其余牌种编号不变，
 * 因此顺子/刻子枚举可以由张数自然短路，无需特判。
 */
export function activeKinds(cfg: RuleConfig): Uint8Array {
  const active = new Uint8Array(KIND_COUNT).fill(1);
  if (cfg.tileSet === 'sanma108') {
    // 三人·有字：去掉万子 2~8
    for (let kind = 1; kind <= 7; kind += 1) active[kind] = 0;
  } else if (cfg.tileSet === 'sanma-noword') {
    // 三人·无字：去掉全部字牌
    for (let kind = 27; kind < KIND_COUNT; kind += 1) active[kind] = 0;
  }
  return active;
}

/** 第 round 局（0 起）的庄家座次与风圈。 */
export function dealerSeatOf(cfg: RuleConfig, round: number): number {
  return round % cfg.players;
}

export function windRoundOf(cfg: RuleConfig, round: number): number {
  return Math.floor(round / cfg.players);
}

/** 第 round 局某座位的门风：0=东 1=南 2=西 3=北。 */
export function seatWindOf(
  cfg: RuleConfig,
  round: number,
  seat: number,
): number {
  const dealer = dealerSeatOf(cfg, round);
  const wind = windRoundOf(cfg, round);
  return (((seat - dealer + wind) % cfg.players) + cfg.players) % cfg.players;
}
