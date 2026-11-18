/**
 * 副露的摆放规则。
 *
 * 依据日麻通行规范（日本麻雀連盟 / M.League / 天鳳）：
 *   - **吃**：鸣来的牌横置在**左端** —— 表示「从上家鸣的」
 *   - **碰 / 大明杠 / 加杠**：横置位置表示**从谁那里鸣的**
 *       - 上家（前一家）→ 左端，第 1 张
 *       - 对家（对门）  → 中间，第 2 张
 *       - 下家（后一家）→ 右端，第 3 张（大明杠 4 张时也是第 3 张）
 *   - **暗杠**：不横置（本项目里 4 张全部亮出，方便观察牌型）
 *
 * 单独放在 `.ts` 里是为了能直接跑单测（Node 的类型剥离不支持 `.tsx`）。
 */
import type { Meld } from '../../core/src/index.ts';

/**
 * 横置牌在这组副露里的下标；返回 `-1` 表示没有横置牌。
 *
 * @param seat 这组副露属于哪一家（0..players-1）
 * @param players 3 或 4
 */
export function sidewaysIndex(
  meld: Meld,
  seat: number,
  players: number,
): number {
  if (meld.kind === 'chi') return 0;
  if (meld.kind === 'ankan' || meld.from === undefined) return -1;
  const offset = (meld.from - seat + players) % players;
  if (offset === 1) return 2; // 下家
  if (offset === players - 1) return 0; // 上家
  return 1; // 对家（三麻里不会走到这里）
}
