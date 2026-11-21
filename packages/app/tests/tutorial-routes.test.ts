import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TUTORIAL_ITEMS,
  TUTORIAL_ROUTE_ADDONS,
  TUTORIAL_ROUTE_ALL_KEYS,
  TUTORIAL_ROUTE_CLASSIFICATION,
  TUTORIAL_ROUTE_EXCLUDED_KEYS,
  TUTORIAL_ROUTES,
  routeAllKeys,
} from '../src/tutorial.ts';

/**
 * 教程卡片只展示「代表番种」，展示清单是人工精选的，**不要自动补全**；
 * 补全后的完整归类放在 TUTORIAL_ROUTE_CLASSIFICATION 里，只服务等频采样。
 */
const DISPLAY_KEYS: Readonly<Record<string, readonly string[]>> = {
  A: ['hunyise', 'qingyise'],
  B: ['qinglong', 'sanlianhuan', 'sanbugao'],
  C: ['sanse-tongshun', 'xiao-san-se-tongke', 'sanse-tongke'],
  D: ['hun-quan-dai-yaojiu', 'chun-quan-dai-yaojiu'],
  E: ['jusishu', 'jusanshu'],
  F: ['jingtong'],
  G: ['pengpenghe', 'qiduizi'],
  H: ['queyimen', 'juwushu', 'yibangao', 'ertongke', 'menfengke', 'sanyuanke'],
};

describe('8 条主线', () => {
  it('正好 8 条，且按 A~H 排列', () => {
    assert.equal(TUTORIAL_ROUTES.length, 8);
    assert.deepEqual(
      TUTORIAL_ROUTES.map((route) => route.id),
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    );
  });

  it('展示用的番种清单保持人工精选（防止被自动补全覆盖）', () => {
    for (const route of TUTORIAL_ROUTES) {
      assert.deepEqual(
        route.items.map((item) => item.key),
        DISPLAY_KEYS[route.id],
        `${route.id} 的展示清单被改动了`,
      );
    }
  });

  it('完整归类 + 不归类清单覆盖全部 50 个番种，且互不重复', () => {
    const all = [...TUTORIAL_ROUTE_ALL_KEYS, ...TUTORIAL_ROUTE_EXCLUDED_KEYS];
    assert.equal(new Set(all).size, all.length, '有番种被归入了多次');
    assert.deepEqual(
      all.slice().sort(),
      TUTORIAL_ITEMS.map((item) => item.key).sort(),
      '没有覆盖全部番种',
    );
  });

  it('补充归类把稀有番种补到对应主线（但不进展示清单）', () => {
    // 两般高 → 对称类；十三幺 → 幺九类
    assert.ok(routeAllKeys('F').includes('liangbangao'), '两般高应归对称类');
    assert.ok(routeAllKeys('D').includes('shisansan'), '十三幺应归幺九类');
    assert.ok(
      !routeAllKeys('B').includes('liangbangao'),
      '一色组合里不应有两般高',
    );
    // 展示清单里没有这些稀有番种
    const displayed = TUTORIAL_ROUTES.flatMap((r) => r.items.map((i) => i.key));
    assert.ok(!displayed.includes('liangbangao'));
    assert.ok(!displayed.includes('shisansan'));
  });

  it('完整归类的每条主线都带标题且非空', () => {
    assert.equal(TUTORIAL_ROUTE_CLASSIFICATION.length, 8);
    for (const route of TUTORIAL_ROUTE_CLASSIFICATION) {
      assert.ok(route.title.length > 0);
      assert.ok(route.keys.length >= 1, `${route.id} 分类为空`);
    }
  });

  it('展示数据里的名称与分值跟番种表一致', () => {
    const byKey = new Map(TUTORIAL_ITEMS.map((item) => [item.key, item]));
    const all = [
      ...TUTORIAL_ROUTES.flatMap((route) => route.items),
      ...TUTORIAL_ROUTE_ADDONS,
    ];
    for (const item of all) {
      const source = byKey.get(item.key);
      assert.ok(source !== undefined, `${item.key} 不在番种表里`);
      assert.equal(item.name, source.name);
      assert.equal(item.points, source.points);
    }
  });

  it('「通用加成」只示意一杠与两杠', () => {
    assert.deepEqual(
      TUTORIAL_ROUTE_ADDONS.map((item) => item.key),
      ['yigang', 'lianggang'],
    );
  });

  it('不归类清单只包含杠与偶然类，且不出现在任何主线里', () => {
    const expected = [
      'yigang',
      'lianggang',
      'sangang',
      'sigang',
      'gangshang-kaihua',
      'qianggang',
      'miaoshou-huichun',
      'haidi-laoyue',
      'tianhe',
      'dihe',
    ];
    assert.deepEqual(
      TUTORIAL_ROUTE_EXCLUDED_KEYS.slice().sort(),
      expected.slice().sort(),
    );
    for (const key of TUTORIAL_ROUTE_EXCLUDED_KEYS) {
      assert.ok(
        !TUTORIAL_ROUTE_ALL_KEYS.includes(key),
        `${key} 不应出现在主线里`,
      );
    }
  });
});
