import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTiles, YAKU } from '../../core/src/index.ts';
import {
  countsForGate,
  TUTORIAL_ITEMS,
  TUTORIAL_OVERVIEW,
  TUTORIAL_SECTIONS,
} from '../src/tutorial.ts';
import { scoringFor } from '../src/tutorial-scoring.ts';

describe('教程的番种表', () => {
  it('覆盖引擎里的每一个番种', () => {
    const engineKeys = Object.keys(YAKU) as string[];
    const tutorialKeys = new Set<string>(
      TUTORIAL_ITEMS.map((item) => item.key),
    );
    const missing = engineKeys.filter((key) => !tutorialKeys.has(key));
    assert.deepEqual(missing, [], `教程缺少这些番种: ${missing.join(', ')}`);
  });

  it('没有引擎里不存在的番种（拼写错误会在这里暴露）', () => {
    const engineKeys = new Set<string>(Object.keys(YAKU));
    const unknown = TUTORIAL_ITEMS.map((item) => item.key as string).filter(
      (key) => !engineKeys.has(key),
    );
    assert.deepEqual(
      unknown,
      [],
      `教程里有引擎不认识的番种: ${unknown.join(', ')}`,
    );
  });

  it('名称与分值跟引擎一致', () => {
    for (const item of TUTORIAL_ITEMS) {
      const yaku = YAKU[item.key];
      assert.equal(item.name, yaku.name, `${item.key} 名称不一致`);
      assert.equal(item.points, yaku.points, `${item.key} 分值不一致`);
    }
  });

  it('每个番种都有描述', () => {
    for (const item of TUTORIAL_ITEMS) {
      assert.ok(
        typeof item.description === 'string' &&
          item.description.trim().length >= 6,
        `${item.name} 缺少番种描述`,
      );
    }
  });

  it('每个番种至少有一个牌例，牌例能解析且每种牌不超过 4 张', () => {
    for (const item of TUTORIAL_ITEMS) {
      assert.ok(item.examples.length > 0, `${item.name} 必须有牌例`);
      for (const example of item.examples) {
        const tiles = example.groups.flatMap((group) => parseTiles(group));
        assert.ok(tiles.length > 0, `${item.name} 的牌例解析为空`);
        for (const tile of tiles) {
          assert.ok(
            Number.isInteger(tile) && tile >= 0 && tile < 34,
            `${item.name} 出现非法牌 ${tile}`,
          );
        }
        const counts = new Array(34).fill(0);
        for (const tile of tiles) counts[tile] += 1;
        assert.ok(
          counts.every((count) => count <= 4),
          `${item.name} 的牌例里某种牌超过 4 张`,
        );
        assert.ok(
          tiles.length >= 14 && tiles.length <= 18,
          `${item.name} 的牌例张数异常: ${tiles.length}`,
        );
      }
    }
  });

  it('牌例的计分细节与引擎实算完全一致', () => {
    for (const item of TUTORIAL_ITEMS) {
      for (const example of item.examples) {
        const actual = scoringFor(item, example.groups);
        assert.ok(actual !== null, `${item.name} 的牌例在引擎里不成和`);
        assert.equal(
          actual,
          example.scoring,
          `${item.name} 的计分细节与引擎不一致`,
        );
      }
    }
  });

  it('分类标题齐全', () => {
    const titles = TUTORIAL_SECTIONS.map((section) => section.title);
    assert.deepEqual(titles, [
      '刻杠类',
      '花色类',
      '三色组合类',
      '一色组合类',
      '数字聚合类',
      '对称类',
      '幺九类',
      '字牌类',
      '特殊和牌型',
      '偶然事件',
    ]);
  });

  it('一览表按分值从小到大，且与番种表完全对得上', () => {
    const points = TUTORIAL_OVERVIEW.map((row) => row.points);
    const sorted = [...points].sort((a, b) => a - b);
    assert.deepEqual(points, sorted, '一览表必须按分值升序');

    const counted = TUTORIAL_OVERVIEW.reduce(
      (sum, row) => sum + row.items.length,
      0,
    );
    assert.equal(counted, TUTORIAL_ITEMS.length, '一览表应当列全所有番种');

    // 每一行的名称集合必须等于番种表里该分值的所有番种
    for (const row of TUTORIAL_OVERVIEW) {
      const expected = TUTORIAL_ITEMS.filter(
        (item) => item.points === row.points,
      )
        .map((item) => item.name)
        .sort();
      assert.deepEqual(
        row.items.map((item) => item.name).sort(),
        expected,
        `${row.points} 分这一行对不上`,
      );
    }
  });

  it('不计入 2 番起和的正好是「一杠 + 4 个 1 分偶然」', () => {
    const excluded = TUTORIAL_ITEMS.filter((item) => !countsForGate(item));
    assert.deepEqual(
      excluded.map((item) => item.name).sort(),
      ['一杠', '妙手回春', '抢杠', '杠上开花', '海底捞月'].sort(),
    );
    // 这些条目也正是描述里写了「不计入 2 番起和」的那些
    for (const item of excluded) {
      assert.ok(
        item.description.includes('不计入 2 番起和'),
        `${item.name} 的描述应当写明不计入起和`,
      );
    }
    // 其余番种都计入
    assert.equal(
      TUTORIAL_ITEMS.filter((item) => countsForGate(item)).length,
      46,
    );
  });

  it('同一档里「不计入起和」的排在最后', () => {
    for (const row of TUTORIAL_OVERVIEW) {
      const flags = row.items.map((item) => countsForGate(item));
      const firstExcluded = flags.indexOf(false);
      if (firstExcluded === -1) continue;
      assert.equal(
        flags.slice(firstExcluded).every((counts) => !counts),
        true,
        `${row.points} 分这一档里，不计入起和的番种没有全部排在最后`,
      );
    }
  });

  it('同一番种只出现一次', () => {
    const keys = TUTORIAL_ITEMS.map((item) => item.key);
    assert.equal(new Set(keys).size, keys.length, '有番种重复列出了');
  });
});
