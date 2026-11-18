/**
 * 对局时长：圈数 × 人数。
 *
 * 四人按 东风 1 / 半庄 2 / 全庄 4 圈；
 * **三人没有北场**，风圈只剩东南西三种，所以全庄最多 3 圈（9 局）。
 */
import type { RuleConfig } from '../../core/src/index.ts';

export type DurationId = 'tonpuu' | 'hanchan' | 'full';

export const DURATIONS: ReadonlyArray<{
  readonly id: DurationId;
  readonly label: string;
  readonly laps: number;
}> = [
  { id: 'tonpuu', label: '东风战', laps: 1 },
  { id: 'hanchan', label: '半庄战', laps: 2 },
  { id: 'full', label: '全庄战', laps: 4 },
];

export function lapsOf(duration: DurationId): number {
  return DURATIONS.find((item) => item.id === duration)?.laps ?? 2;
}

/** 实际圈数：三人封顶 3 圈（东南西），四人可以到 4 圈（东南西北）。 */
export function lapsFor(players: number, duration: DurationId): number {
  return Math.min(lapsOf(duration), players);
}

/** 总局数 = 人数 × 实际圈数。 */
export function roundsOf(players: number, duration: DurationId): number {
  return players * lapsFor(players, duration);
}

/** 从配置反推时长档位（三人 3 圈、四人 4 圈都算全庄）。 */
export function durationOf(cfg: RuleConfig): DurationId {
  const laps = cfg.rounds / cfg.players;
  if (laps <= 1) return 'tonpuu';
  if (laps === 2) return 'hanchan';
  return 'full';
}
