import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeAb, summarizeAb } from '../src/ai/eval-stats.ts';

// 约定：差值是 B − A，正值 = B（迭代后）更强
describe('A/B 汇总（B − A，正值 = 迭代后更强）', () => {
  it('全是 0 时判为噪声，不会因为 0/0 抛错', () => {
    const result = summarizeAb([0, 0, 0, 0]);
    assert.equal(result.perGame, 0);
    assert.equal(result.se, 0);
    assert.equal(result.z, 0);
    assert.equal(result.verdict, 'noise');
  });

  it('偶数局才能配对，奇数局直接报错', () => {
    assert.throws(() => summarizeAb([1, 2, 3]), /偶数局/);
  });

  it('局数、对数、均值都对得上', () => {
    const result = summarizeAb([1, 1, 3, 3]);
    assert.equal(result.games, 4);
    assert.equal(result.pairs, 2);
    assert.equal(result.perGame, 2);
  });

  it('B 稳定更强 → 正均值、z 为正、判 b', () => {
    const result = summarizeAb([3, 3, 3, 3, 3, 3, 3, 3]);
    assert.ok(result.perGame > 0);
    assert.equal(result.verdict, 'b');
    assert.match(describeAb(result), /B（迭代后）更强/);
  });

  it('A 稳定更强 → 负均值、判 a', () => {
    const result = summarizeAb([-3, -3, -3, -3, -3, -3, -3, -3]);
    assert.equal(result.verdict, 'a');
    assert.match(describeAb(result), /A（迭代前）更强/);
  });

  it('配对能抵掉牌运：同对里符号相反时，均值仍体现真实差异', () => {
    // 每对：一局 +10（B 运气好）、一局 -4（A 运气好），配对后总差 +6，均值 +3
    const result = summarizeAb([10, -4, 10, -4]);
    assert.equal(result.perGame, 3);
    assert.equal(result.se, 0);
    assert.equal(result.verdict, 'b');
  });

  it('均值远小于 SE 时判噪声（今天 2400 局那种情况）', () => {
    // 50 对：每对合计在 +21 / −19 之间跳（对间标准差约 20），
    // 每局均值只有 +0.5，但配对 SE 有 1.4 —— "看起来有差别、其实是噪声"
    const diffs: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      diffs.push(index % 2 === 0 ? 21 : -19, 0);
    }
    const result = summarizeAb(diffs);
    assert.ok(Math.abs(result.perGame - 0.5) < 1e-9);
    assert.ok(result.se > 1);
    assert.equal(result.verdict, 'noise');
    assert.match(describeAb(result), /噪声内/);
  });

  it('置信区间以均值为中心、半宽约为 1.96×SE', () => {
    const result = summarizeAb([2, 4, 1, 3]);
    const halfWidth = (result.high - result.low) / 2;
    assert.ok(Math.abs(halfWidth - 1.96 * result.se) < 1e-9);
    assert.ok(Math.abs((result.low + result.high) / 2 - result.perGame) < 1e-9);
  });
});
