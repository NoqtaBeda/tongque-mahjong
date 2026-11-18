import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createGame,
  legalActions,
  makeConfig,
  observe,
  reduce,
} from '../src/index.ts';
import type { Action, GameState, RuleConfig } from '../src/index.ts';
import { decide } from '../src/ai/index.ts';

interface RunSummary {
  readonly state: GameState;
  readonly steps: number;
  readonly rounds: number;
  readonly tsumo: number;
  readonly ron: number;
  readonly draws: number;
}

function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'discard' && b.type === 'discard') return a.tile === b.tile;
  if (a.type === 'ankan' && b.type === 'ankan') return a.tile === b.tile;
  if (a.type === 'kakan' && b.type === 'kakan') return a.tile === b.tile;
  if (a.type === 'chi' && b.type === 'chi') {
    return a.tiles[0] === b.tiles[0] && a.tiles[1] === b.tiles[1];
  }
  return true;
}

function autoPlay(cfg: RuleConfig, seed: number): RunSummary {
  let state = createGame(cfg, seed);
  let steps = 0;
  let rounds = 0;
  let tsumo = 0;
  let ron = 0;
  let draws = 0;

  while (true) {
    steps += 1;
    assert.ok(steps < 20000, `seed ${seed}: 步数失控`);

    if (state.phase === 'over') {
      assert.ok(state.result !== null, '结束态必须有结算');
      rounds += 1;
      if (state.result.kind === 'tsumo') tsumo += 1;
      else if (state.result.kind === 'ron') ron += 1;
      else draws += 1;

      for (const entry of state.result.entries) {
        assert.ok(entry.gain >= 0);
        assert.ok(entry.penalty >= 0);
        assert.ok(entry.penalty <= entry.gain, '放铳者支付不应超过和牌者所得');
      }

      if (state.finished) break;
      state = reduce(state, { type: 'next-round' });
      assert.equal(state.phase, 'discard');
      continue;
    }

    const actor = state.actor;
    assert.ok(actor !== null, '未结束时必须有行动者');
    const legal = legalActions(state, actor);
    assert.ok(legal.length > 0, '行动者必须有合法动作');

    const observation = observe(state, actor);
    const action = decide(observation);
    assert.ok(
      legal.some((candidate) => sameAction(candidate, action)),
      `AI 返回了非法动作 ${JSON.stringify(action)}（合法：${legal.map((a) => a.type).join(',')}）`,
    );

    const before = state;
    const kansBefore = before.kanCounts.reduce((a, b) => a + b, 0);
    state = reduce(state, action);
    const kansAfter = state.kanCounts.reduce((a, b) => a + b, 0);
    const progressed =
      state.phase !== before.phase ||
      state.actor !== before.actor ||
      state.turnIndex !== before.turnIndex ||
      state.drawIndex !== before.drawIndex ||
      state.liveEnd !== before.liveEnd ||
      kansAfter !== kansBefore ||
      state.drawnTile !== before.drawnTile;
    assert.ok(progressed, `seed ${seed}: 动作 ${action.type} 没有推进状态`);
  }

  return { state, steps, rounds, tsumo, ron, draws };
}

describe('全自动对局', () => {
  it('四麻：能完整打到终局', () => {
    const cfg = makeConfig({ rounds: 4 });
    const summary = autoPlay(cfg, 2024);
    assert.equal(summary.rounds, 4);
    assert.equal(summary.state.scores.length, 4);
    assert.ok(summary.steps > 20);
  });

  it('四麻：多局种都能收敛', () => {
    const cfg = makeConfig({ rounds: 8 });
    const summary = autoPlay(cfg, 77);
    assert.equal(summary.rounds, 8);
    assert.equal(summary.state.finished, true);
  });

  it('三麻：能完整打到终局', () => {
    const cfg = makeConfig({ players: 3, rounds: 3 });
    const summary = autoPlay(cfg, 314);
    assert.equal(summary.rounds, 3);
    assert.equal(summary.state.scores.length, 3);
  });

  it('三麻 108 张：能完整打到终局', () => {
    const cfg = makeConfig({ players: 3, tileSet: 'sanma108', rounds: 3 });
    const summary = autoPlay(cfg, 271);
    assert.equal(summary.rounds, 3);
  });

  it('多个 seed 下至少出现一次和牌', () => {
    const cfg = makeConfig({ rounds: 4 });
    let wins = 0;
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const summary = autoPlay(cfg, seed);
      wins += summary.tsumo + summary.ron;
    }
    assert.ok(wins > 0, '六局牌里应当至少出现一次和牌');
  });

  it('同一 seed 的对局完全可复现', () => {
    const cfg = makeConfig({ rounds: 4 });
    const first = autoPlay(cfg, 99);
    const second = autoPlay(cfg, 99);
    assert.deepEqual(first.state.scores, second.state.scores);
    assert.equal(first.steps, second.steps);
    assert.equal(first.tsumo, second.tsumo);
    assert.equal(first.ron, second.ron);
  });

  it('七对子被关闭也能正常终局', () => {
    const cfg = makeConfig({
      rounds: 4,
      allowSevenPairs: false,
      allowThirteenOrphans: false,
    });
    const summary = autoPlay(cfg, 606);
    assert.equal(summary.rounds, 4);
  });
});
