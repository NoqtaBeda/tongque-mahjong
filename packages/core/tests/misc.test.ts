import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeKinds,
  evaluateWin,
  makeConfig,
  parseHand,
  parseTiles,
  seatWindOf,
  tileCode,
  tileName,
  windCount,
} from '../src/index.ts';
import type { RuleConfig, WinFlags } from '../src/index.ts';

const cfg = makeConfig({ rounds: 4 });

function run(
  concealed: string,
  winTile: string,
  options: { seatWind?: number; flags?: WinFlags; cfg?: RuleConfig } = {},
) {
  return evaluateWin({
    concealed: parseHand(concealed),
    melds: [],
    cfg: options.cfg ?? cfg,
    winTile: parseTiles(winTile)[0],
    isTsumo: true,
    seatWind: options.seatWind ?? 0,
    flags: options.flags ?? {},
  });
}

describe('九莲宝灯', () => {
  it('九面听牌成立并取 24 分', () => {
    const r = run('111m 234m 55m 678m 999m', '5m');
    assert.equal(r.isWin, true);
    assert.ok(r.best !== null);
    assert.deepEqual(
      r.best.hits.map((hit) => hit.key),
      ['jiulian'],
      '清一色被九莲蕴含',
    );
    assert.equal(r.best.score, 24);
    assert.equal(r.best.penalty, 12, '铳责被 12 封顶');
  });

  it('清一色但形制不符时不成立', () => {
    const r = run('123m 234m 345m 456m 77m', '7m');
    assert.ok(r.best !== null);
    assert.ok(!r.best.hits.some((hit) => hit.key === 'jiulian'));
    assert.ok(
      r.best.hits.some((hit) => hit.key === 'sibugao'),
      '四步高仍然成立',
    );
  });
});

describe('门风刻', () => {
  const hand = '111z 222m 333m 444m 55m';

  it('门风与刻子一致时成立', () => {
    const r = run(hand, '5m', { seatWind: 0 });
    assert.ok(r.best !== null);
    assert.ok(r.best.hits.some((hit) => hit.key === 'menfengke'));
  });

  it('门风不一致时不成立', () => {
    const r = run(hand, '5m', { seatWind: 1 });
    assert.ok(r.best !== null);
    assert.ok(!r.best.hits.some((hit) => hit.key === 'menfengke'));
  });
});

describe('偶然事件', () => {
  it('天和叠加到得分但不影响铳责', () => {
    const r = run('111m 222m 333m 444m 55m', '5m', { flags: { tenhou: true } });
    assert.ok(r.best !== null);
    assert.ok(r.best.hits.some((hit) => hit.key === 'tianhe'));
    assert.equal(r.best.score, 16, '四连刻16 取最大单番，天和12 不改变结果');
  });

  it('杠上开花仅 1 分，且不满足 2 番起和', () => {
    const r = run('123m 456m 789p 234s 55z', '5z', {
      flags: { rinshan: true },
    });
    assert.ok(r.best !== null);
    const keys = r.best.hits.map((hit) => hit.key);
    assert.ok(keys.includes('gangshang-kaihua'));
    assert.equal(r.ronAllowed, false, '1 分偶然事件被排除在起和之和外');
  });
});

describe('记号约定（天凤 / MPSZ）', () => {
  it('1z-7z 的编号与代码一一对应', () => {
    const pairs: ReadonlyArray<readonly [string, number]> = [
      ['1z', 27],
      ['2z', 28],
      ['3z', 29],
      ['4z', 30],
      ['5z', 31],
      ['6z', 32],
      ['7z', 33],
    ];
    for (const [code, kind] of pairs) {
      assert.equal(parseTiles(code)[0], kind, `${code} 应解析为 ${kind}`);
      assert.equal(tileCode(kind), code, `${kind} 的代码应为 ${code}`);
    }
  });

  it('三元牌顺序是 白 → 發 → 中（不是中发白）', () => {
    assert.equal(tileName(31), '白');
    assert.equal(tileName(32), '发');
    assert.equal(tileName(33), '中');
  });

  it('风牌是 东南西北', () => {
    assert.deepEqual([27, 28, 29, 30].map(tileName), ['东', '南', '西', '北']);
  });

  it('数牌的代码与中文名', () => {
    assert.equal(tileCode(0), '1m');
    assert.equal(tileCode(17), '9p');
    assert.equal(tileCode(26), '9s');
    assert.equal(tileName(0), '一万');
    assert.equal(tileName(13), '五饼');
    assert.equal(tileName(25), '八索');
  });

  it('34 个牌种都能往返', () => {
    for (let kind = 0; kind < 34; kind += 1) {
      const code = tileCode(kind);
      assert.equal(parseTiles(code)[0], kind, `${code} 往返失败`);
      assert.ok(tileName(kind).length > 0);
    }
  });
});

describe('规则配置', () => {
  it('108 张模式禁用二至八万', () => {
    const sanma = makeConfig({ players: 3, tileSet: 'sanma108', rounds: 3 });
    const active = activeKinds(sanma);
    // 万 1 与 万 9 保留，万 2~8 禁用
    assert.equal(active[0], 1);
    assert.equal(active[8], 1);
    for (let kind = 1; kind <= 7; kind += 1)
      assert.equal(active[kind], 0, `kind ${kind} 应禁用`);
    assert.equal(active[9], 1, '饼子不受影响');
  });

  it('局数必须是人数整数倍', () => {
    assert.throws(() => makeConfig({ players: 3, rounds: 4 }));
    assert.equal(windCount(makeConfig({ players: 3, rounds: 9 })), 3);
    assert.equal(windCount(makeConfig({ players: 4, rounds: 16 })), 4);
  });

  it('轮庄：局 n 的庄家为 n mod 人数，门风随庄位轮转', () => {
    const four = makeConfig({ players: 4, rounds: 4 });
    assert.equal(seatWindOf(four, 0, 0), 0, '东1局 东家');
    assert.equal(seatWindOf(four, 0, 1), 1);
    assert.equal(seatWindOf(four, 1, 1), 0, '东2局 南家坐庄');
    assert.equal(seatWindOf(four, 4, 0), 1, '南1局 东家转为南');

    const three = makeConfig({ players: 3, rounds: 3 });
    assert.equal(seatWindOf(three, 0, 0), 0);
    assert.equal(seatWindOf(three, 0, 2), 2, '三麻门风只有东南西');
  });
});
