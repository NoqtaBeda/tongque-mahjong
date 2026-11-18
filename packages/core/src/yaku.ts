export type YakuScope = 'whole' | 'combo' | 'special' | 'chance';

/**
 * 铳和时该番种如何计入关联铳责：
 * - always：整副手牌参与，始终计入
 * - by-meld：只有铳牌所在的面子/雀头参与时才计入
 * - never：自摸限定或规则上明确不计入
 */
export type LiabilityMode = 'always' | 'by-meld' | 'never';

interface YakuDefBase {
  readonly key: string;
  readonly name: string;
  readonly points: number;
  readonly scope: YakuScope;
  readonly liability: LiabilityMode;
  /** 是否带"数字"参数（二同刻 / 三色同刻 / 小三色同刻）。 */
  readonly hasParam: boolean;
  /** 是否可复计。 */
  readonly repeatable: boolean;
}

const RAW = [
  // 1 刻杠类
  {
    key: 'pengpenghe',
    name: '碰碰和',
    points: 2,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'yigang',
    name: '一杠',
    points: 1,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'lianggang',
    name: '两杠',
    points: 2,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'sangang',
    name: '三杠',
    points: 6,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'sigang',
    name: '四杠',
    points: 24,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  // 2 花色类
  {
    key: 'queyimen',
    name: '缺一门',
    points: 1,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'hunyise',
    name: '混一色',
    points: 2,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'qingyise',
    name: '清一色',
    points: 6,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'ziyise',
    name: '字一色',
    points: 16,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'jiulian',
    name: '九莲宝灯',
    points: 24,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  // 3 三色组合类
  {
    key: 'sanse-tongshun',
    name: '三色同顺',
    points: 2,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'ertongke',
    name: '二同刻',
    points: 1,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: true,
    repeatable: true,
  },
  {
    key: 'xiao-san-se-tongke',
    name: '小三色同刻',
    points: 2,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: true,
    repeatable: false,
  },
  {
    key: 'sanse-tongke',
    name: '三色同刻',
    points: 8,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: true,
    repeatable: false,
  },
  // 4 一色组合类
  {
    key: 'yibangao',
    name: '一般高',
    points: 1,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'qinglong',
    name: '清龙',
    points: 2,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'sanlianhuan',
    name: '三连环',
    points: 2,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'sanbugao',
    name: '三步高',
    points: 4,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'yise-santongshun',
    name: '一色三同顺',
    points: 8,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'silianhuan',
    name: '四连环',
    points: 8,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'sibugao',
    name: '四步高',
    points: 12,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'yise-sitongshun',
    name: '一色四同顺',
    points: 24,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'erlianke',
    name: '二连刻',
    points: 1,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: true,
  },
  {
    key: 'sanlianke',
    name: '三连刻',
    points: 6,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'silianke',
    name: '四连刻',
    points: 16,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  // 5 数字聚合类
  {
    key: 'juwushu',
    name: '聚五数',
    points: 1,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'jusishu',
    name: '聚四数',
    points: 2,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'jusanshu',
    name: '聚三数',
    points: 6,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'juliangshu',
    name: '聚两数',
    points: 24,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  // 6 对称类
  {
    key: 'liangbangao',
    name: '两般高',
    points: 6,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'jingtong',
    name: '镜同',
    points: 2,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  // 7 幺九类
  {
    key: 'hun-quan-dai-yaojiu',
    name: '混全带幺九',
    points: 2,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'chun-quan-dai-yaojiu',
    name: '纯全带幺九',
    points: 6,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'hun-yaojiu',
    name: '混幺九',
    points: 8,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'qing-yaojiu',
    name: '清幺九',
    points: 24,
    scope: 'whole',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  // 8 字牌类
  {
    key: 'menfengke',
    name: '门风刻',
    points: 1,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'xiao-san-feng-ke',
    name: '小三风刻',
    points: 2,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'san-feng-ke',
    name: '三风刻',
    points: 8,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'xiao-sixi',
    name: '小四喜',
    points: 16,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'da-sixi',
    name: '大四喜',
    points: 24,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'sanyuanke',
    name: '三元刻',
    points: 1,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: true,
  },
  {
    key: 'xiao-sanyuan',
    name: '小三元',
    points: 6,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'da-sanyuan',
    name: '大三元',
    points: 12,
    scope: 'combo',
    liability: 'by-meld',
    hasParam: false,
    repeatable: false,
  },
  // 9 特殊和牌型
  {
    key: 'qiduizi',
    name: '七对子',
    points: 2,
    scope: 'special',
    liability: 'never',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'shisansan',
    name: '十三幺',
    points: 13,
    scope: 'special',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  // 10 偶然事件
  {
    key: 'gangshang-kaihua',
    name: '杠上开花',
    points: 1,
    scope: 'chance',
    liability: 'never',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'qianggang',
    name: '抢杠',
    points: 1,
    scope: 'chance',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'miaoshou-huichun',
    name: '妙手回春',
    points: 1,
    scope: 'chance',
    liability: 'never',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'haidi-laoyue',
    name: '海底捞月',
    points: 1,
    scope: 'chance',
    liability: 'always',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'tianhe',
    name: '天和',
    points: 12,
    scope: 'chance',
    liability: 'never',
    hasParam: false,
    repeatable: false,
  },
  {
    key: 'dihe',
    name: '地和',
    points: 12,
    scope: 'chance',
    liability: 'never',
    hasParam: false,
    repeatable: false,
  },
] as const satisfies readonly YakuDefBase[];

export type YakuKey = (typeof RAW)[number]['key'];

export interface YakuDef extends YakuDefBase {
  readonly id: number;
  readonly key: YakuKey;
}

export const YAKU_TABLE: readonly YakuDef[] = RAW.map(
  (def, id) => ({ ...def, id }) as YakuDef,
);

export const YAKU: Readonly<Record<YakuKey, YakuDef>> = Object.freeze(
  Object.fromEntries(YAKU_TABLE.map((def) => [def.key, def])) as Record<
    YakuKey,
    YakuDef
  >,
);

/** 单番达到该分值即触发"取最大单番"的封顶规则。 */
export const SINGLE_YAKU_THRESHOLD = 12;
/** 和牌计分与放铳扣分的封顶值。 */
export const SCORE_CAP = 12;
/** 铳责的起扣门槛（即 2 番起和的那个 2）。 */
/** 和牌的最低分：不足这个分数既不能铳和、也不能自摸。 */
export const MIN_WIN_POINTS = 2;

export const LIABILITY_FLOOR = 2;
