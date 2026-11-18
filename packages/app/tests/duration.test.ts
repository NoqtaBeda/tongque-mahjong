import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dealerSeatOf,
  makeConfig,
  seatWindOf,
  windRoundOf,
} from '../../core/src/index.ts';
import { DURATIONS, durationOf, lapsFor, roundsOf } from '../src/duration.ts';
import type { DurationId } from '../src/duration.ts';

const WINDS = ['东', '南', '西', '北'];
const DURATION_IDS: readonly DurationId[] = DURATIONS.map((item) => item.id);

describe('对局时长与风圈', () => {
  it('四人：东风 4 / 半庄 8 / 全庄 16 局', () => {
    assert.equal(roundsOf(4, 'tonpuu'), 4);
    assert.equal(roundsOf(4, 'hanchan'), 8);
    assert.equal(roundsOf(4, 'full'), 16);
  });

  it('三人：东风 3 / 半庄 6 / 全庄 9 局（全庄封顶 3 圈）', () => {
    assert.equal(roundsOf(3, 'tonpuu'), 3);
    assert.equal(roundsOf(3, 'hanchan'), 6);
    assert.equal(roundsOf(3, 'full'), 9, '三麻没有北场，全庄只能是东南西 3 圈');
    assert.equal(lapsFor(3, 'full'), 3);
    assert.equal(lapsFor(4, 'full'), 4);
  });

  it('三人的任何时长都不会出现北场，也没有人拿到北门风', () => {
    for (const duration of DURATION_IDS) {
      const rounds = roundsOf(3, duration);
      const cfg = makeConfig({ players: 3, tileSet: 'sanma108', rounds });
      for (let round = 0; round < rounds; round += 1) {
        assert.ok(
          windRoundOf(cfg, round) <= 2,
          `三人 ${duration} 的第 ${round + 1} 局出现了北场`,
        );
        for (let seat = 0; seat < 3; seat += 1) {
          const wind = seatWindOf(cfg, round, seat);
          assert.ok(
            wind <= 2,
            `三人 ${duration} 的第 ${round + 1} 局有座位拿到北门风`,
          );
          assert.equal(WINDS[wind] !== '北', true);
        }
        // 三家门风必须恰好是东南西各一次
        const winds = [0, 1, 2]
          .map((seat) => seatWindOf(cfg, round, seat))
          .sort();
        assert.deepEqual(winds, [0, 1, 2], '三家的门风应当是东南西各一');
      }
    }
  });

  it('四人的全庄包含北场（四圈）', () => {
    const cfg = makeConfig({ players: 4, rounds: roundsOf(4, 'full') });
    const fieldWinds = Array.from({ length: cfg.rounds }, (_, round) =>
      windRoundOf(cfg, round),
    );
    assert.equal(Math.max(...fieldWinds), 3, '四人全庄应当打到北场');
    assert.equal(
      fieldWinds.filter((wind) => wind === 3).length,
      4,
      '北场应当有 4 局',
    );
  });

  it('庄家按座位轮换，且庄家的门风等于场风', () => {
    const cfg = makeConfig({ players: 3, rounds: roundsOf(3, 'hanchan') });
    for (let round = 0; round < cfg.rounds; round += 1) {
      const dealer = dealerSeatOf(cfg, round);
      assert.equal(seatWindOf(cfg, round, dealer), windRoundOf(cfg, round));
    }
  });

  it('durationOf 能把配置反推回档位', () => {
    for (const players of [3, 4] as const) {
      for (const duration of DURATION_IDS) {
        const cfg = makeConfig({
          players,
          tileSet: 'std136',
          rounds: roundsOf(players, duration),
        });
        assert.equal(
          durationOf(cfg),
          duration,
          `${players} 人 ${duration} 反推失败`,
        );
      }
    }
  });
});
