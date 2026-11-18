import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createGame,
  legalActions,
  makeConfig,
  parseTiles,
  reduce,
} from '../../core/src/index.ts';
import {
  decodeState,
  encodeState,
  loadView,
  saveView,
} from '../src/storage.ts';

describe('存档序列化', () => {
  it('往返后手牌与关键字段一致', () => {
    const state = createGame(makeConfig({ rounds: 4 }), 7);
    const restored = decodeState(encodeState(state));
    assert.ok(restored !== null);
    assert.deepEqual(
      restored.hands.map((hand) => Array.from(hand)),
      state.hands.map((hand) => Array.from(hand)),
    );
    assert.equal(restored.phase, state.phase);
    assert.equal(restored.round, state.round);
    assert.equal(restored.dealer, state.dealer);
    assert.equal(restored.drawIndex, state.drawIndex);
    assert.equal(restored.liveEnd, state.liveEnd);
    assert.equal(restored.wall.length, state.wall.length);
    assert.deepEqual(restored.scores, state.scores);
  });

  it('还原出来的是可继续对局的状态（Uint8Array 真的还原了）', () => {
    let state = createGame(makeConfig({ rounds: 4 }), 11);
    state = reduce(state, { type: 'discard', tile: parseTiles('1m')[0] });

    const restored = decodeState(encodeState(state));
    assert.ok(restored !== null);
    const actor = restored.actor;
    assert.ok(actor !== null);
    assert.ok(restored.hands[actor] instanceof Uint8Array);

    const legal = legalActions(restored, actor);
    assert.ok(legal.length > 0);
    const next = reduce(restored, legal[0]);
    assert.notEqual(next, restored);
  });

  it('三麻也能往返', () => {
    const state = createGame(
      makeConfig({ players: 3, tileSet: 'sanma108', rounds: 3 }),
      5,
    );
    const restored = decodeState(encodeState(state));
    assert.ok(restored !== null);
    assert.equal(restored.cfg.players, 3);
    assert.equal(restored.hands.length, 3);
    assert.equal(restored.wall.length, 108);
  });

  it('坏数据一律返回 null', () => {
    assert.equal(decodeState('not json'), null);
    assert.equal(decodeState('{}'), null);
    assert.equal(decodeState('{"version":99,"state":{}}'), null);
    assert.equal(decodeState('{"version":1,"state":{}}'), null);
    assert.equal(
      decodeState('{"version":1,"state":{"cfg":{"players":5,"rounds":4}}}'),
      null,
      '人数非法应拒绝',
    );
    assert.equal(
      decodeState(
        '{"version":1,"state":{"cfg":{"players":4,"rounds":4},"hands":[]}}',
      ),
      null,
      '手牌数量不符应拒绝',
    );
  });
});

describe('界面停留位置', () => {
  /** 造一个最小的 localStorage 假实现 */
  function withStorage<T>(run: () => T): T {
    const store = new Map<string, string>();
    const fake = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    const previous = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    try {
      return run();
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = previous;
    }
  }

  it('默认停在和牌界面（finalShown 为 false）', () => {
    withStorage(() => {
      assert.equal(loadView().finalShown, false);
    });
  });

  it('翻到最终结算页后能读回来（关掉浏览器再打开还停在那）', () => {
    withStorage(() => {
      saveView({ finalShown: true });
      assert.equal(loadView().finalShown, true);
      saveView({ finalShown: false });
      assert.equal(loadView().finalShown, false);
    });
  });

  it('内容损坏时退回默认值，不抛异常', () => {
    withStorage(() => {
      localStorage.setItem('mahjong-playground/view/v1', '{');
      assert.equal(loadView().finalShown, false);
      localStorage.setItem('mahjong-playground/view/v1', '{"finalShown":1}');
      assert.equal(loadView().finalShown, false);
    });
  });
});
