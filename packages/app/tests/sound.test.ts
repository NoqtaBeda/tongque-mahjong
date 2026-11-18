import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGame, makeConfig } from '../../core/src/index.ts';
import type { GameState } from '../../core/src/index.ts';
import { soundCue } from '../src/sound.ts';

const cfg = makeConfig({ rounds: 4 });
const base = createGame(cfg, 1);

/** 造一个状态：只覆盖需要变化的字段，其余沿用开局状态。 */
function variant(patch: Partial<GameState>): GameState {
  return { ...base, ...patch };
}

describe('音效推断', () => {
  it('全员 pass 掉鸣牌窗口时一声都不出', () => {
    const inClaim = variant({ phase: 'claim', drawIndex: 10 });
    // 窗口关闭 → 下家摸牌，没有任何人鸣牌
    const afterPass = variant({ phase: 'discard', drawIndex: 11 });
    assert.equal(
      soundCue(inClaim, afterPass),
      null,
      'pass 既不该响鸣牌音，也不该响摸牌音',
    );
  });

  it('有人碰/吃/杠时播放鸣牌音', () => {
    const inClaim = variant({ phase: 'claim', drawIndex: 10 });
    const afterCall = variant({
      phase: 'discard',
      drawIndex: 10,
      melds: [[], [{ kind: 'pon', tiles: [0, 0, 0] }], [], []],
    });
    assert.equal(soundCue(inClaim, afterCall), 'call');
  });

  it('大明杠既要补摸也会加副露，算鸣牌', () => {
    const inClaim = variant({ phase: 'claim', drawIndex: 10 });
    const afterKan = variant({
      phase: 'discard',
      drawIndex: 11,
      melds: [[], [{ kind: 'minkan', tiles: [0, 0, 0, 0] }], [], []],
    });
    assert.equal(soundCue(inClaim, afterKan), 'call', '副露增加时判定为鸣牌');
  });

  it('打牌播放出牌音', () => {
    const before = variant({ phase: 'discard', turnIndex: 3 });
    const after = variant({ phase: 'discard', turnIndex: 4 });
    assert.equal(soundCue(before, after), 'discard');
  });

  it('和牌 / 流局分别播放对应音效', () => {
    const playing = variant({ phase: 'discard' });
    const win = variant({
      phase: 'over',
      result: { kind: 'ron', entries: [], discarder: 1 },
    });
    const draw = variant({
      phase: 'over',
      result: { kind: 'draw', entries: [], discarder: null },
    });
    assert.equal(soundCue(playing, win), 'win');
    assert.equal(soundCue(playing, draw), 'drain');
  });

  it('摸牌不出声', () => {
    const before = variant({ phase: 'discard', drawIndex: 20 });
    const after = variant({ phase: 'discard', drawIndex: 21 });
    assert.equal(soundCue(before, after), null);
  });
});
