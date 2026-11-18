import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGame, legalActions, makeConfig, reduce } from '../src/index.ts';

const cfg = makeConfig({ rounds: 4 });

describe('牌河的摸切标记', () => {
  it('摸切与手切被区分记录，且与牌河等长', () => {
    let state = createGame(cfg, 20260101);
    // 找两步：先让当前玩家摸牌后打牌（摸切），再找另一次从手里出牌
    for (let step = 0; step < 400; step += 1) {
      if (state.phase === 'over') {
        state = reduce(state, { type: 'next-round' });
        continue;
      }
      const actor = state.actor;
      if (actor === null) break;
      const legal = legalActions(state, actor);
      if (legal.length === 0) break;

      if (state.phase === 'discard' && state.drawnTile !== null) {
        const drawn = state.drawnTile;
        const before = state.discards[actor].length;
        // 打刚摸到的那张 → 摸切
        const next = reduce(state, { type: 'discard', tile: drawn });
        assert.equal(next.discards[actor].length, before + 1);
        assert.equal(
          next.tsumogiri[actor].length,
          next.discards[actor].length,
          '两个数组必须等长',
        );
        assert.equal(
          next.tsumogiri[actor][before],
          true,
          '打刚摸到的牌应当记为摸切',
        );
        state = next;
        break;
      }
      state = reduce(state, legal[0]);
    }
  });

  it('从手里打出的牌记为手切', () => {
    let state = createGame(cfg, 20260101);
    for (let step = 0; step < 400; step += 1) {
      if (state.phase === 'over') {
        state = reduce(state, { type: 'next-round' });
        continue;
      }
      const actor = state.actor;
      if (actor === null) break;
      const legal = legalActions(state, actor);
      if (legal.length === 0) break;

      if (state.phase === 'discard') {
        const drawn = state.drawnTile;
        // 找一张不是刚摸到的牌
        const other = legal
          .filter((action) => action.type === 'discard')
          .map((action) => (action.type === 'discard' ? action.tile : -1))
          .find((tile) => tile >= 0 && tile !== drawn);
        if (other !== undefined) {
          const before = state.discards[actor].length;
          const next = reduce(state, { type: 'discard', tile: other });
          assert.equal(
            next.tsumogiri[actor][before],
            false,
            '打别的牌应当记为手切',
          );
          return;
        }
      }
      state = reduce(state, legal[0]);
    }
  });

  it('被鸣走的牌会同时从牌河与摸切标记里移除', () => {
    // 直接构造：让 1 号位碰走 0 号位刚打出的牌
    const state = createGame(cfg, 7);
    state.discards[0].push(5);
    state.tsumogiri[0].push(true);
    state.lastDiscard = { tile: 5, from: 0 };
    state.claim = {
      tile: 5,
      from: 0,
      pending: [1],
      responses: [null, null, null, null],
      robKan: false,
    };
    state.phase = 'claim';
    state.actor = 1;
    state.hands[1][5] = 2;
    state.hands[0][5] = 1;

    const next = reduce(state, { type: 'pon' });
    assert.equal(next.discards[0].length, 0, '被碰走的牌应当从牌河消失');
    assert.equal(next.tsumogiri[0].length, 0, '摸切标记也要同步移除');
  });
});
