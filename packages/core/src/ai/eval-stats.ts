/**
 * A/B 评测的统计汇总。
 *
 * 约定（2026-11-19 用户定稿）：**A = 迭代前，B = 迭代后**，
 * 差值一律按 **`B − A`** 打印 —— **正值 = 迭代后更强**（符合"改进了多少"的习惯认知）。
 *
 * `scripts/eval.ts` 是配对设计：同一副牌打两遍、交换 A/B 的座位，每一"对"覆盖全部座位，
 * 牌运差异被抵消。因此 SE 按"对"来算（配对 SE），比把 2N 局当独立样本算出来的小约 25%
 * （实测 SE ≈ 8.0/√N：2400 局 0.16、9000 局 0.08、40000 局 0.04）。
 */
export interface AbSummary {
  /** 总对局数（偶数，等于对数的两倍） */
  readonly games: number;
  /** 配对数 = games / 2 */
  readonly pairs: number;
  /** 每局平均差值（B − A），正值代表 B（迭代后）更强 */
  readonly perGame: number;
  /** perGame 的标准误（配对口径） */
  readonly se: number;
  /** 95% 置信区间下界 */
  readonly low: number;
  /** 95% 置信区间上界 */
  readonly high: number;
  /** perGame / se，衡量"离 0 有几个标准误" */
  readonly z: number;
  /** 结论：a = A 更强，b = B 更强，noise = 差异在噪声内 */
  readonly verdict: 'a' | 'b' | 'noise';
}

/** 样本标准差（分母 n-1） */
function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let sum = 0;
  for (const value of values) sum += (value - mean) * (value - mean);
  return Math.sqrt(sum / (values.length - 1));
}

/**
 * 把"每一局的差值"汇总成均值 / 标准误 / 结论。
 *
 * `gameDiffs[i]` 是第 i 局的 `B 净得分 − A 净得分`。相邻两局共用同一副牌
 * （交换过座位），所以按对合并后再算 SE。
 */
export function summarizeAb(gameDiffs: readonly number[]): AbSummary {
  if (gameDiffs.length % 2 !== 0) {
    throw new Error(
      `配对评测需要偶数局，收到 ${gameDiffs.length} 局（每副牌要打两遍）`,
    );
  }
  const games = gameDiffs.length;
  const pairs = games / 2;
  const total = gameDiffs.reduce((sum, value) => sum + value, 0);
  const perGame = games === 0 ? 0 : total / games;

  // 每对的合计差值；配对 SE = SD(对) / (2 × √对数)，单位仍是"每局"
  const pairTotals: number[] = [];
  for (let index = 0; index < games; index += 2) {
    pairTotals.push(gameDiffs[index] + gameDiffs[index + 1]);
  }
  const se = pairs < 2 ? 0 : stdDev(pairTotals) / (2 * Math.sqrt(pairs));

  // 配对后方差为 0（每对差值完全一致）时，只要均值非 0 就是确定性的差异
  const z =
    se === 0
      ? perGame === 0
        ? 0
        : perGame > 0
          ? Infinity
          : -Infinity
      : perGame / se;
  const verdict: AbSummary['verdict'] =
    perGame === 0 || Math.abs(z) < 2 ? 'noise' : perGame > 0 ? 'b' : 'a';

  return {
    games,
    pairs,
    perGame,
    se,
    low: perGame - 1.96 * se,
    high: perGame + 1.96 * se,
    z,
    verdict,
  };
}

/**
 * 人类可读的一句话结论，例如：
 * `B（迭代后）更强 0.26 分/局（z = 2.9，95% CI [0.08, 0.44]）`
 */
export function describeAb(summary: AbSummary, unit = '局'): string {
  const ci = `95% CI [${summary.low.toFixed(2)}, ${summary.high.toFixed(2)}]`;
  const head = `${summary.perGame >= 0 ? '+' : ''}${summary.perGame.toFixed(2)} 分/${unit}`;
  const zText = Number.isFinite(summary.z)
    ? summary.z.toFixed(1)
    : summary.z > 0
      ? '∞'
      : '-∞';
  const tail = `z = ${zText}，${ci}`;
  if (summary.verdict === 'noise') {
    return `差异在噪声内：${head}（${tail}，|z| < 2，不能认定变强或变弱）`;
  }
  const side = summary.verdict === 'b' ? 'B（迭代后）' : 'A（迭代前）';
  const magnitude = Math.abs(summary.perGame).toFixed(2);
  return `${side}更强 ${magnitude} 分/${unit}（${head}，${tail}）`;
}
