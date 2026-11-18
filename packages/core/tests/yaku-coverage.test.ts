import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  YAKU_TABLE,
  evaluateWin,
  makeConfig,
  parseHand,
  parseMeld,
  parseTiles,
} from '../src/index.ts';
import type { WinFlags, WinResult, YakuKey } from '../src/index.ts';

const cfg = makeConfig({ rounds: 4 });

interface CoverageCase {
  /** 期望命中的番种 */
  readonly key: YakuKey;
  readonly concealed: string;
  readonly winTile: string;
  readonly melds?: readonly string[];
  readonly seatWind?: number;
  readonly flags?: WinFlags;
  readonly why: string;
}

function run(c: CoverageCase): WinResult {
  return evaluateWin({
    concealed: parseHand(c.concealed),
    melds: (c.melds ?? []).map((text) => parseMeld(text)),
    cfg,
    winTile: parseTiles(c.winTile)[0],
    isTsumo: false,
    seatWind: c.seatWind ?? 0,
    flags: c.flags ?? {},
  });
}

function hitKeys(result: WinResult): YakuKey[] {
  assert.ok(result.best !== null);
  return result.best.hits.map((hit) => hit.key);
}

/**
 * 每个番种一条"必然命中"的构造用例。
 * 构造时特意避开会蕴含它的其它番种（否则会在 resolve 阶段被剔除）。
 */
const POSITIVE: readonly CoverageCase[] = [
  // ── 1 刻杠类 ──
  {
    key: 'pengpenghe',
    concealed: '111m 222m 333p 444s 55z',
    winTile: '5z',
    why: '四副刻子 + 字牌雀头',
  },
  {
    key: 'yigang',
    concealed: '222m 333m 456m 77m',
    winTile: '7m',
    melds: ['1111m'],
    why: '一副明杠',
  },
  {
    key: 'lianggang',
    concealed: '345m 678m 99m',
    winTile: '9m',
    melds: ['1111m', '2222m'],
    why: '恰好两副杠',
  },
  {
    key: 'sangang',
    concealed: '456m 77m',
    winTile: '7m',
    melds: ['1111m', '2222m', '3333m'],
    why: '恰好三副杠',
  },
  {
    key: 'sigang',
    concealed: '55m',
    winTile: '5m',
    melds: ['1111m', '2222m', '3333m', '4444m'],
    why: '恰好四副杠',
  },
  // ── 2 花色类 ──
  {
    key: 'queyimen',
    concealed: '123m 456m 789m 123p 55p',
    winTile: '5p',
    why: '两种数字花色且不含字牌',
  },
  {
    key: 'hunyise',
    concealed: '123m 456m 789m 111z 55z',
    winTile: '5z',
    why: '一种数字花色 + 字牌',
  },
  {
    key: 'qingyise',
    concealed: '123m 456m 789m 234m 55m',
    winTile: '5m',
    why: '仅一种数字花色且无字牌',
  },
  {
    key: 'ziyise',
    concealed: '111z 222z 333z 444z 55z',
    winTile: '5z',
    why: '全部字牌',
  },
  {
    key: 'jiulian',
    concealed: '111m 234m 55m 678m 999m',
    winTile: '5m',
    why: '1112345678999 + 5m 的九面听',
  },
  // ── 3 三色组合类 ──
  {
    key: 'sanse-tongshun',
    concealed: '123m 123p 123s 456m 77m',
    winTile: '7m',
    why: '三色同数字的顺子',
  },
  {
    key: 'ertongke',
    concealed: '111m 111p 234s 567s 99m',
    winTile: '9m',
    why: '两副同数字刻子（避开三色同刻所需的三花色）',
  },
  {
    key: 'xiao-san-se-tongke',
    concealed: '111m 111p 11s 888p 888s',
    winTile: '8s',
    why: '两刻同数字 + 第三花色同数字雀头',
  },
  {
    key: 'sanse-tongke',
    concealed: '111m 111p 111s 234m 55m',
    winTile: '5m',
    why: '三花色同数字刻子',
  },
  // ── 4 一色组合类 ──
  {
    key: 'yibangao',
    concealed: '123m 123m 456p 789s 55z',
    winTile: '5z',
    why: '两个完全相同的顺子',
  },
  {
    key: 'qinglong',
    concealed: '123m 456m 789m 234p 55p',
    winTile: '5p',
    why: '同花色 123 / 456 / 789',
  },
  {
    key: 'sanlianhuan',
    concealed: '123m 345m 567m 234p 55p',
    winTile: '5p',
    why: '同花色 Δ=2 的三个顺子',
  },
  {
    key: 'sanbugao',
    concealed: '123m 234m 345m 678p 55p',
    winTile: '5p',
    why: '同花色 Δ=1 的三个顺子（第 4 副避开 456）',
  },
  {
    key: 'yise-santongshun',
    concealed: '123m 123m 123m 456p 55p',
    winTile: '5p',
    why: '三个完全相同的顺子',
  },
  {
    key: 'silianhuan',
    concealed: '123m 345m 567m 789m 55p',
    winTile: '5p',
    why: '同花色 Δ=2 的四个顺子',
  },
  {
    key: 'sibugao',
    concealed: '123m 234m 345m 456m 77m',
    winTile: '7m',
    why: '同花色 Δ=1 的四个顺子',
  },
  {
    key: 'yise-sitongshun',
    concealed: '123m 123m 123m 123m 55p',
    winTile: '5p',
    why: '四个完全相同的顺子',
  },
  {
    key: 'erlianke',
    concealed: '111m 222m 456p 789s 55z',
    winTile: '5z',
    why: '同花色连号的两个刻子',
  },
  {
    key: 'sanlianke',
    concealed: '444m 555m 666m 444p 55z',
    winTile: '5z',
    why:
      '同花色连号的三个刻子。刻意避开 1~3 / 7~9：那类连刻总能改拆成 123×3（一色三同顺 8 分），' +
      '再叠加混全带幺九反而更高，三连刻会被更高分的分解盖掉',
  },
  {
    key: 'silianke',
    concealed: '111m 222m 333m 444m 55m',
    winTile: '5m',
    why: '同花色连号的四个刻子',
  },
  // ── 5 数字聚合类 ──
  {
    key: 'juwushu',
    concealed: '123m 234m 345m 123s 55s',
    winTile: '5s',
    why: '数字跨度 4',
  },
  {
    key: 'jusishu',
    concealed: '123m 234m 123p 234p 11s',
    winTile: '1s',
    why: '数字跨度 3',
  },
  {
    key: 'jusanshu',
    concealed: '123m 123p 123s 123m 11m',
    winTile: '1m',
    why: '数字跨度 2',
  },
  {
    key: 'juliangshu',
    concealed: '111m 222m 111p 222p 11s',
    winTile: '1s',
    why: '数字跨度 1',
  },
  // ── 6 对称类 ──
  {
    key: 'liangbangao',
    concealed: '123m 123m 456p 456p 77s',
    winTile: '7s',
    why: '两组不相同的一般高',
  },
  {
    key: 'jingtong',
    concealed: '123s 555s 123p 555p 44p',
    winTile: '4p',
    why: '两花色镜像的两副面子',
  },
  // ── 7 幺九类 ──
  {
    key: 'hun-quan-dai-yaojiu',
    concealed: '123m 789p 111s 111z 99p',
    winTile: '9p',
    why: '每个面子和雀头都含幺九，且含字牌',
  },
  {
    key: 'chun-quan-dai-yaojiu',
    concealed: '123m 789m 111p 999p 99s',
    winTile: '9s',
    why: '每个面子和雀头都含幺九数牌，且不含字牌',
  },
  {
    key: 'hun-yaojiu',
    concealed: '111m 999m 111p 111z 55z',
    winTile: '5z',
    why: '仅幺九刻子与对子，含字牌',
  },
  {
    key: 'qing-yaojiu',
    concealed: '111m 999m 111p 999p 11s',
    winTile: '1s',
    why: '仅幺九数牌刻子与对子',
  },
  // ── 8 字牌类 ──
  {
    key: 'menfengke',
    concealed: '111z 222m 333m 444m 55m',
    winTile: '5m',
    seatWind: 0,
    why: '门风为东且持有东刻子',
  },
  {
    key: 'xiao-san-feng-ke',
    concealed: '111z 222z 456m 789p 33z',
    winTile: '3z',
    why: '两组风刻 + 第三种风雀头',
  },
  {
    key: 'san-feng-ke',
    concealed: '111z 222z 333z 456m 55m',
    winTile: '5m',
    why: '三组风刻（雀头非风牌，避免小四喜）',
  },
  {
    key: 'xiao-sixi',
    concealed: '111z 222z 333z 456m 44z',
    winTile: '4z',
    why: '三组风刻 + 第四种风雀头',
  },
  {
    key: 'da-sixi',
    concealed: '111z 222z 333z 444z 55m',
    winTile: '5m',
    why: '四组风刻',
  },
  {
    key: 'sanyuanke',
    concealed: '555z 123m 456m 789p 11s',
    winTile: '1s',
    why: '单组三元刻（避开小三元所需的两组）',
  },
  {
    key: 'xiao-sanyuan',
    concealed: '555z 666z 456m 789p 77z',
    winTile: '7z',
    why: '两组三元刻 + 第三种三元雀头',
  },
  {
    key: 'da-sanyuan',
    concealed: '555z 666z 777z 456m 55m',
    winTile: '5m',
    why: '三组三元刻',
  },
  // ── 9 特殊和牌型 ──
  {
    key: 'qiduizi',
    concealed: '11s 22s 44s 55s 77s 88s 99s',
    winTile: '9s',
    why: '七对子（该手牌不存在四面子分解）',
  },
  {
    key: 'shisansan',
    concealed: '11m 9m 1p 9p 1s 9s 1234567z',
    winTile: '1m',
    why: '十三种幺九各一张 + 其中一种成对',
  },
  // ── 10 偶然事件 ──
  {
    key: 'gangshang-kaihua',
    concealed: '123m 456m 789m 123p 55s',
    winTile: '5s',
    flags: { rinshan: true },
    why: '杠后补牌自摸',
  },
  {
    key: 'qianggang',
    concealed: '123m 456m 789m 123p 55s',
    winTile: '1p',
    flags: { chankan: true },
    why: '抢他人补杠的牌',
  },
  {
    key: 'miaoshou-huichun',
    concealed: '123m 456m 789m 123p 55s',
    winTile: '5s',
    flags: { haitei: true },
    why: '牌山摸尽时自摸',
  },
  {
    key: 'haidi-laoyue',
    concealed: '123m 456m 789m 123p 55s',
    winTile: '1p',
    flags: { houtei: true },
    why: '最后一张放铳被和',
  },
  {
    key: 'tianhe',
    concealed: '123m 456m 789m 123p 55s',
    winTile: '5s',
    flags: { tenhou: true },
    why: '庄家起手即和',
  },
  {
    key: 'dihe',
    concealed: '123m 456m 789m 123p 55s',
    winTile: '5s',
    flags: { chiihou: true },
    why: '闲家第一次摸牌即自摸',
  },
];

interface NegativeCase {
  readonly key: YakuKey;
  readonly concealed: string;
  readonly winTile: string;
  readonly melds?: readonly string[];
  readonly seatWind?: number;
  readonly why: string;
}

/** 反向用例：手牌合法和牌，但该番种**不应**出现。 */
const NEGATIVE: readonly NegativeCase[] = [
  {
    key: 'queyimen',
    concealed: '123m 456m 789m 111z 55z',
    winTile: '5z',
    why: '含字牌，缺一门要求不含字牌',
  },
  {
    key: 'hunyise',
    concealed: '123m 456m 789m 234m 55m',
    winTile: '5m',
    why: '没有字牌，应为清一色而非混一色',
  },
  {
    key: 'yibangao',
    concealed: '123m 123p 456s 789s 55z',
    winTile: '5z',
    why: '顺子数字相同但跨花色，不构成一般高',
  },
  {
    key: 'jiulian',
    concealed: '123m 234m 345m 456m 77m',
    winTile: '7m',
    why: '是清一色，但 13 张形制不是 1112345678999',
  },
  {
    key: 'ertongke',
    concealed: '111m 222p 345s 678s 55z',
    winTile: '5z',
    why: '两副刻子数字不同',
  },
  {
    key: 'xiao-san-se-tongke',
    concealed: '111m 111p 22s 345s 678s',
    winTile: '2s',
    why: '有同数字的两副刻子，但雀头数字不同（"雀头与刻子同花色"其实不可能：会超过 4 张）',
  },
  {
    key: 'da-sixi',
    concealed: '111z 222z 333z 456m 44z',
    winTile: '4z',
    why: '只有三组风刻，应为小四喜',
  },
  {
    key: 'da-sanyuan',
    concealed: '555z 666z 456m 789p 77z',
    winTile: '7z',
    why: '只有两组三元刻，应为小三元',
  },
  {
    key: 'juwushu',
    concealed: '123m 456m 789m 123p 55p',
    winTile: '5p',
    why: '数字跨度 9，不是聚五数',
  },
  {
    key: 'menfengke',
    concealed: '111z 222m 333m 444m 55m',
    winTile: '5m',
    seatWind: 1,
    why: '门风为南，持有的是东刻子',
  },
];

describe('番种覆盖：正向构造', () => {
  for (const testCase of POSITIVE) {
    it(`${testCase.key} —— ${testCase.why}`, () => {
      const result = run(testCase);
      // 这里只验"能不能拆成和牌型 + 命中哪个番种"，不验是否够起和分：
      // 1 分番种的手牌本身合法，只是按规则不能真的和。
      assert.ok(
        result.best !== null,
        `手牌应能拆成和牌型：${testCase.concealed}`,
      );
      const keys = hitKeys(result);
      assert.ok(
        keys.includes(testCase.key),
        `期望命中 ${testCase.key}，实际命中：${[...keys].sort().join(', ')}`,
      );
    });
  }

  it('51 个番种全部有正向用例', () => {
    const covered = new Set(POSITIVE.map((testCase) => testCase.key));
    const missing = YAKU_TABLE.map((def) => def.key).filter(
      (key) => !covered.has(key),
    );
    assert.deepEqual(
      [...missing],
      [],
      `以下番种缺少正向用例：${missing.join(', ')}`,
    );
    assert.equal(YAKU_TABLE.length, 51, '番种表应有 51 条');
  });

  it('正向用例的 key 没有重复定义以外的冗余', () => {
    const unique = new Set(POSITIVE.map((testCase) => testCase.key));
    assert.equal(unique.size, YAKU_TABLE.length);
  });
});

describe('番种覆盖：反向用例', () => {
  for (const testCase of NEGATIVE) {
    it(`不应命中 ${testCase.key} —— ${testCase.why}`, () => {
      const result = run(testCase as CoverageCase);
      assert.ok(
        result.best !== null,
        `手牌本身应能拆成和牌型：${testCase.concealed}`,
      );
      const keys = hitKeys(result);
      assert.ok(
        !keys.includes(testCase.key),
        `不应命中 ${testCase.key}，实际命中：${[...keys].sort().join(', ')}`,
      );
    });
  }
});
