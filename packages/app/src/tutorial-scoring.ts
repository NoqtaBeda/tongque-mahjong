/**
 * 教程牌例的计分细节：交给引擎算，不手写。
 *
 * 单测会用这里的函数把每个牌例重算一遍，和 `tutorial.ts` 里存的文字比对，
 * 保证「教程上写的分数」和「引擎实际的分数」永远一致。
 */
import { evaluateWin, makeConfig, parseTiles } from '../../core/src/index.ts';
import type { Meld, WinFlags } from '../../core/src/index.ts';
import type { TutorialYaku } from './tutorial.ts';

const CFG = makeConfig({ rounds: 4 });

/** 偶然类番种需要额外的局面标志才能被引擎识别 */
const FLAGS: Readonly<Record<string, WinFlags>> = {
  'gangshang-kaihua': { rinshan: true },
  qianggang: { chankan: true },
  'miaoshou-huichun': { haitei: true },
  'haidi-laoyue': { houtei: true },
  tianhe: { tenhou: true },
  dihe: { chiihou: true },
};

/** 一组牌是不是杠（四张完全一样） */
export function isKanGroup(group: string): boolean {
  const tiles = parseTiles(group);
  return tiles.length === 4 && tiles.every((tile) => tile === tiles[0]);
}

/** 把教程里的一副牌例还原成引擎的输入（杠拆成副露） */
export function buildWinInput(item: TutorialYaku, groups: readonly string[]) {
  const concealed = new Uint8Array(34);
  const melds: Meld[] = [];
  for (const group of groups) {
    const tiles = parseTiles(group);
    if (isKanGroup(group)) {
      melds.push({
        kind: 'ankan',
        tiles: [tiles[0], tiles[0], tiles[0], tiles[0]],
      });
    } else {
      for (const tile of tiles) concealed[tile] += 1;
    }
  }
  // 和牌张取暗牌里的第一张（对番种判定没有影响，只影响「哪个面子是铳牌所在」）
  const winTile = concealed.findIndex((count) => count > 0);
  return {
    concealed,
    melds,
    cfg: CFG,
    winTile,
    isTsumo: true,
    seatWind: 0,
    flags: FLAGS[item.key],
  };
}

/** 把引擎结果写成教程里显示的那行文字 */
export function formatScoring(
  hits: readonly { name: string; points: number }[],
  score: number,
  rawSum: number,
): string {
  const detail = hits.map((hit) => `${hit.name} ${hit.points}`).join(' + ');
  if (detail.length === 0) return `无番种（0 分）`;
  // ≥12 的单番直接取最大；否则累加（可能被 12 分封顶）
  const best = Math.max(...hits.map((hit) => hit.points));
  const capped = best < 12 && rawSum > 12;
  const note = best >= 12 ? '（取最大单番）' : capped ? '（累加封顶）' : '';
  return `${detail} ＝ ${score} 分${note}`;
}

/** 计算一副牌例的计分细节；说不出和就返回 null */
export function scoringFor(
  item: TutorialYaku,
  groups: readonly string[],
): string | null {
  const result = evaluateWin(buildWinInput(item, groups));
  if (!result.isWin || !result.best) return null;
  return formatScoring(result.best.hits, result.best.score, result.best.rawSum);
}
