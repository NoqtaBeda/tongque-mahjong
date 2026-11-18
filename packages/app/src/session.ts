/**
 * 对局会话：当前状态 + 本局起点 + 本局收到的动作。
 *
 * 单独放在 `.ts` 里是为了能直接跑单测——Node 的类型剥离不支持 `.tsx`，
 * 而"刷新后该不该接着上一局"这种判断正是最需要测试的地方。
 */
import { createGame, reduce } from '../../core/src/index.ts';
import type { Action, GameState, RuleConfig } from '../../core/src/index.ts';

export interface Session {
  readonly state: GameState;
  /** 本局开始时的状态，回放用 */
  readonly roundStart: GameState;
  /** 本局自 roundStart 起收到的动作 */
  readonly log: readonly Action[];
}

export function newSession(cfg: RuleConfig, seed: number): Session {
  const state = createGame(cfg, seed);
  return { state, roundStart: state, log: [] };
}

export function step(session: Session, action: Action): Session {
  const state = reduce(session.state, action);
  if (action.type === 'next-round') {
    // 换局了，本局起点与动作记录都重来
    return { state, roundStart: state, log: [] };
  }
  return {
    state,
    roundStart: session.roundStart,
    log: [...session.log, action],
  };
}

/**
 * 页面加载时该用哪份状态。
 *
 * 只要有存档就接着用——**包括 `phase === 'over'` 的结算态**。结算界面本来就由
 * 状态推导出来，还原后自然停在那一页；如果这里把"已结束"的存档丢掉，
 * 在结算界面刷新一下，整局就会从头开始。
 */
export function resumeSession(
  saved: GameState | null,
  fresh: () => Session,
): Session {
  if (saved !== null) return { state: saved, roundStart: saved, log: [] };
  return fresh();
}
