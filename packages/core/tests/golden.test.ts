import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateWin,
  makeConfig,
  parseHand,
  parseMeld,
  parseTiles,
} from '../src/index.ts';
import type { Meld, RuleConfig, WinFlags, WinResult } from '../src/index.ts';

const baseConfig = makeConfig({ rounds: 4 });

interface CaseOptions {
  readonly melds?: readonly Meld[];
  readonly winTile: string;
  readonly isTsumo?: boolean;
  readonly seatWind?: number;
  readonly flags?: WinFlags;
  readonly cfg?: RuleConfig;
}

function evaluate(
  concealed: string,
  options: CaseOptions,
): WinResult & { best: NonNullable<WinResult['best']> } {
  const result = evaluateWin({
    concealed: parseHand(concealed),
    melds: options.melds ?? [],
    cfg: options.cfg ?? baseConfig,
    winTile: parseTiles(options.winTile)[0],
    isTsumo: options.isTsumo ?? false,
    seatWind: options.seatWind ?? 0,
    flags: options.flags ?? {},
  });
  assert.ok(result.isWin, `hand should win: ${concealed}`);
  assert.ok(result.best !== null);
  return { ...result, best: result.best };
}

function hitKeys(result: WinResult): string[] {
  assert.ok(result.best !== null);
  return result.best.hits.map((hit) => hit.key).sort();
}

describe('规则文档案例', () => {
  it('案例 1：雀头放铳不计碰碰和', () => {
    const r = evaluate('111m 222m 333m 555m 11z', { winTile: '1z' });
    assert.equal(r.best.score, 10, '混一色2 + 碰碰和2 + 三连刻6');
    assert.equal(r.best.liability, 2, '只有混一色参与铳责');
    assert.equal(r.best.penalty, 0);
  });

  it('案例 2：一杠计入得分但不计入铳责', () => {
    const r = evaluate('222m 234m 345m 55m', {
      melds: [parseMeld('1111m', 'minkan')],
      winTile: '5m',
    });
    assert.equal(r.best.score, 9, '清一色6 + 二连刻1 + 聚五数1 + 一杠1');
    assert.equal(r.best.liability, 7);
    assert.equal(r.best.penalty, 5);
  });

  it('案例 3：≥12 分单番取最大，全体番种仍计入铳责', () => {
    const r = evaluate('111m 222m 333m 444m 55m', { winTile: '5m' });
    assert.equal(r.best.score, 16, '四连刻 16 取最大单番');
    assert.equal(r.best.liability, 7, '清一色6 + 聚五数1');
    assert.equal(r.best.penalty, 5);
    assert.ok(!hitKeys(r).includes('pengpenghe'), '碰碰和被四连刻蕴含');
  });

  it('案例 4：铳牌落在刻子上，铳责被 12 封顶', () => {
    const r = evaluate('111m 222m 333m 444m 55m', { winTile: '4m' });
    assert.equal(r.best.score, 16);
    assert.equal(r.best.liability, 23, '四连刻16 + 清一色6 + 聚五数1');
    assert.equal(r.best.penalty, 12);
  });
});

describe('番种表内的用例', () => {
  it('二同刻可复计，并与碰碰和、二连刻叠加', () => {
    // 注意：111p 与 222p 是同花色的连号刻子，二连刻也成立，因此总分是 5 而不是 4。
    const r = evaluate('111m 111p 222p 222s 44z', { winTile: '4z' });
    assert.equal(r.best.score, 5, '碰碰和2 + 二同刻1 + 二同刻1 + 二连刻1');
    assert.deepEqual(hitKeys(r), [
      'erlianke',
      'ertongke',
      'ertongke',
      'pengpenghe',
    ]);
  });

  it('小三色同刻蕴含同数字的二同刻', () => {
    const r = evaluate('111m 111p 11s 888p 888s', { winTile: '8s' });
    assert.equal(r.best.score, 5, '碰碰和2 + 小三色同刻2 + 二同刻(8)1');
    const keys = hitKeys(r);
    assert.ok(keys.includes('xiao-san-se-tongke'));
    assert.equal(
      keys.filter((key) => key === 'ertongke').length,
      1,
      '只保留数字 8 的二同刻',
    );
  });

  it('三步高与三连环可叠加，且正好撞上 12 分封顶', () => {
    const r = evaluate('123m 234m 345m 567m 99m', { winTile: '9m' });
    assert.equal(r.best.score, 12, '清一色6 + 三步高4 + 三连环2');
    assert.equal(r.best.rawSum, 12);
  });

  it('缺一门要求不含字牌', () => {
    const r = evaluate('111m 222m 333s 444s 55z', { winTile: '5z' });
    assert.equal(
      r.best.score,
      4,
      '碰碰和2 + 二连刻1 + 二连刻1（缺一门不成立）',
    );
    assert.ok(!hitKeys(r).includes('queyimen'));
  });

  it('镜同：雀头为字牌时不成立缺一门', () => {
    const r = evaluate('123s 555s 123p 555p 44z', { winTile: '4z' });
    assert.equal(r.best.score, 3, '镜同2 + 二同刻1');
    assert.ok(!hitKeys(r).includes('queyimen'));
    assert.ok(!hitKeys(r).includes('juwushu'), '含字牌不成聚数');
  });

  it('镜同：雀头为数牌时缺一门与聚五数同时成立', () => {
    const r = evaluate('123s 555s 123p 555p 44p', { winTile: '4p' });
    assert.equal(r.best.score, 5, '镜同2 + 二同刻1 + 聚五数1 + 缺一门1');
  });
});

describe('特殊和牌型', () => {
  it('七对子不计入关联铳责', () => {
    // 文档原例 `11s22s33s44s55s66s77s` 还能拆成 123123456456+77（两般高6 + 清一色6 = 12），
    // 按"计分最高优先"会取 12 分。这里换一手没有更高分解的七对子。
    const r = evaluate('11s 22s 44s 55s 77s 88s 99s', { winTile: '9s' });
    assert.equal(r.best.score, 8, '清一色6 + 七对子2');
    assert.equal(r.best.liability, 6, '七对子不计铳责');
    assert.equal(r.best.penalty, 4);
  });

  it('七对子手牌若存在更高分解，按最高分结算', () => {
    // 234 234 567 567 + 11 这条分解让铳牌 7s 落在顺子里，铳责同样被拉满：
    // S = 清一色6 + 两般高6 = 12，S_A = 12，P = 10。
    const r = evaluate('11s 22s 33s 44s 55s 66s 77s', { winTile: '7s' });
    assert.equal(r.best.score, 12, '清一色6 + 两般高6');
    assert.equal(r.best.liability, 12);
    assert.equal(r.best.penalty, 10);
  });

  it('十三幺计入关联铳责', () => {
    const r = evaluate('11m 9m 1p 9p 1s 9s 1234567z', { winTile: '1m' });
    assert.equal(r.best.score, 13);
    assert.equal(r.best.liability, 13);
    assert.equal(r.best.penalty, 11);
  });
});
