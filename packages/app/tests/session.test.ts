import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createGame,
  legalActions,
  makeConfig,
  observe,
  reduce,
} from '../../core/src/index.ts';
import type { GameState } from '../../core/src/index.ts';
import { decide } from '../../core/src/ai/index.ts';
import { newSession, resumeSession, step } from '../src/session.ts';

const cfg = makeConfig({ rounds: 4 });

/** 推进一手；碰上一局结束就翻到下一局，直到满足 `stop` */
function playUntil(
  seed: number,
  stop: (state: GameState) => boolean,
): GameState {
  let state = createGame(cfg, seed);
  for (let count = 0; count < 40000; count += 1) {
    if (stop(state)) return state;
    if (state.phase === 'over') {
      state = reduce(state, { type: 'next-round' });
      continue;
    }
    const actor = state.actor;
    if (actor === null) break;
    const legal = legalActions(state, actor);
    if (legal.length === 0) break;
    state = reduce(state, decide(observe(state, actor)));
  }
  throw new Error('没有走到目标状态');
}

const playToOver = (seed: number) =>
  playUntil(seed, (state) => state.phase === 'over');
const playToFinished = (seed: number) =>
  playUntil(seed, (state) => state.finished);

describe('刷新后接续对局', () => {
  it('结算态的存档必须接着用，不能重开一局', () => {
    const over = playToOver(20260101);
    assert.equal(over.phase, 'over');

    let spawned = false;
    const session = resumeSession(over, () => {
      spawned = true;
      return newSession(cfg, 1);
    });

    assert.equal(spawned, false, '不该开到新局');
    assert.equal(session.state.phase, 'over', '还原出来应当仍是结算态');
    assert.deepEqual(
      session.state.scores,
      over.scores,
      '分数要和刷新前一致，不能归零',
    );
    assert.equal(
      session.state.history.length,
      over.history.length,
      '对局记录也要还在',
    );
    assert.equal(session.roundStart, over, '回放起点就用这个状态');
    assert.deepEqual(session.log, []);
  });

  it('打完全部的终局存档同样要接上', () => {
    const over = playToFinished(20260102);
    assert.equal(over.finished, true, '四局打完就该是终局');

    const session = resumeSession(over, () => {
      throw new Error('不该走到这里');
    });
    assert.equal(session.state.finished, true);
    assert.equal(session.state.history.length, over.cfg.rounds);
  });

  it('没有存档才开新局', () => {
    const session = resumeSession(null, () => newSession(cfg, 7));
    assert.notEqual(session.state.phase, 'over');
    assert.equal(session.state.round, 0);
    assert.deepEqual(session.log, []);
  });

  it('step 累积动作，换局时清空', () => {
    const session = newSession(cfg, 3);
    const actor = session.state.actor;
    assert.notEqual(actor, null);
    const legal = legalActions(session.state, actor!);

    const next = step(session, legal[0]);
    assert.equal(next.log.length, 1);
    assert.equal(next.roundStart, session.roundStart, '同一局里回放起点不变');

    const over = playToOver(20260103);
    const rolled = step(
      { state: over, roundStart: over, log: [] },
      { type: 'next-round' },
    );
    assert.deepEqual(rolled.log, [], '换局后动作记录清空');
  });
});
