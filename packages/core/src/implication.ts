import { YAKU_TABLE } from './yaku.ts';
import type { YakuKey } from './yaku.ts';

/**
 * `always`   —— 达成 A 必然达成 B，与参数无关
 * `same-param` —— 仅在参数（数字）相同时成立，例如三色同刻(1) ⇒ 二同刻(1)
 */
export type ImplicationMode = 'always' | 'same-param';

interface Edge {
  readonly from: YakuKey;
  readonly to: YakuKey;
  readonly mode: ImplicationMode;
}

/**
 * 规则文档里的"不另计 X"。前 21 条是文档显式声明；
 * 其余是由"若达成 A 必然达成 B 则 B 不另计"通则推出、文档未逐条写明的部分
 * （其 A 均为 ≥14 分，数值上已经饱和，仅为结算展示一致而保留）。
 */
const EDGES: readonly Edge[] = [
  // —— 文档显式 ——
  { from: 'jiulian', to: 'qingyise', mode: 'always' },
  { from: 'sanse-tongke', to: 'ertongke', mode: 'same-param' },
  { from: 'xiao-san-se-tongke', to: 'ertongke', mode: 'same-param' },
  { from: 'yise-santongshun', to: 'yibangao', mode: 'always' },
  { from: 'silianhuan', to: 'sanlianhuan', mode: 'always' },
  { from: 'sibugao', to: 'sanbugao', mode: 'always' },
  { from: 'yise-sitongshun', to: 'yise-santongshun', mode: 'always' },
  { from: 'sanlianke', to: 'erlianke', mode: 'always' },
  { from: 'silianke', to: 'erlianke', mode: 'always' },
  { from: 'silianke', to: 'sanlianke', mode: 'always' },
  { from: 'liangbangao', to: 'yibangao', mode: 'always' },
  { from: 'hun-yaojiu', to: 'hun-quan-dai-yaojiu', mode: 'always' },
  { from: 'hun-yaojiu', to: 'pengpenghe', mode: 'always' },
  { from: 'hun-yaojiu', to: 'qiduizi', mode: 'always' },
  { from: 'qing-yaojiu', to: 'chun-quan-dai-yaojiu', mode: 'always' },
  { from: 'qing-yaojiu', to: 'pengpenghe', mode: 'always' },
  { from: 'qing-yaojiu', to: 'qiduizi', mode: 'always' },
  { from: 'xiao-sixi', to: 'san-feng-ke', mode: 'always' },
  { from: 'da-sixi', to: 'san-feng-ke', mode: 'always' },
  { from: 'xiao-sanyuan', to: 'sanyuanke', mode: 'always' },
  { from: 'da-sanyuan', to: 'sanyuanke', mode: 'always' },
  // 案例 3 明确："被四连刻蕴含的碰碰和也不再计入"
  { from: 'silianke', to: 'pengpenghe', mode: 'always' },
  // —— 通则推出（A 均 ≥14 分，不影响数值） ——
  { from: 'ziyise', to: 'pengpenghe', mode: 'always' },
  { from: 'ziyise', to: 'hun-yaojiu', mode: 'always' },
  { from: 'ziyise', to: 'hun-quan-dai-yaojiu', mode: 'always' },
  { from: 'sigang', to: 'pengpenghe', mode: 'always' },
  { from: 'yise-sitongshun', to: 'yibangao', mode: 'always' },
  { from: 'xiao-sixi', to: 'xiao-san-feng-ke', mode: 'always' },
  { from: 'da-sixi', to: 'menfengke', mode: 'always' },
  { from: 'da-sixi', to: 'pengpenghe', mode: 'always' },
];

export const EXPLICIT_IMPLICATION_COUNT = 22;

/** 传递闭包：`REACHES[a].get(c)` 表示 a ⇒ c；多跳路径若含 same-param 边，整条链都要求参数相等。 */
export const REACHES: ReadonlyMap<
  YakuKey,
  ReadonlyMap<YakuKey, ImplicationMode>
> = buildReach();

function buildReach(): Map<YakuKey, Map<YakuKey, ImplicationMode>> {
  const keys = YAKU_TABLE.map((def) => def.key);
  const reach = new Map<YakuKey, Map<YakuKey, ImplicationMode>>();
  for (const key of keys) reach.set(key, new Map());

  for (const edge of EDGES) {
    reach.get(edge.from)?.set(edge.to, edge.mode);
  }

  // 边数很少，用反复松弛即可；含环也不会发散，因为只记录"更强"的模式。
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of keys) {
      const fromA = reach.get(a);
      if (fromA === undefined) continue;
      for (const [b, first] of [...fromA]) {
        const fromB = reach.get(b);
        if (fromB === undefined) continue;
        for (const [c, second] of [...fromB]) {
          if (c === a) continue;
          const combined: ImplicationMode =
            first === 'always' && second === 'always' ? 'always' : 'same-param';
          const current = fromA.get(c);
          if (
            current === undefined ||
            (current === 'same-param' && combined === 'always')
          ) {
            fromA.set(c, combined);
            changed = true;
          }
        }
      }
    }
  }

  return reach;
}

/** A 的达成是否蕴含 B 的达成（用于剔除被蕴含的番种）。 */
export function implies(
  from: { readonly key: YakuKey; readonly param?: number },
  to: { readonly key: YakuKey; readonly param?: number },
): boolean {
  const mode = REACHES.get(from.key)?.get(to.key);
  if (mode === undefined) return false;
  if (mode === 'always') return true;
  return from.param !== undefined && from.param === to.param;
}
