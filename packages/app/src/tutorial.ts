/**
 * 「铜雀」规则速览与完整番种表的数据。
 *
 * 每条番种都以 `规则文档.md` 为准，包含三部分：
 *   1. 名称 / 分值 / 类型
 *   2. 番种描述（规则原文的浓缩）
 *   3. 若干牌例，每个牌例带「引擎实算的计分细节」
 *
 * 牌例写法用天凤记号（`123m` = 一万二万三万、`1z` = 东、`5z` = 白），
 * 每个字符串是**一组牌**（面子 / 雀头），渲染时分组显示。
 *
 * `key` 与 `packages/core/src/yaku.ts` 的 YakuKey 一致；
 * `scoring` 由 `tutorial-scoring.ts` 调用引擎生成，单测会重算并逐字比对。
 */
import type { YakuKey } from '../../core/src/index.ts';

export type TutorialKind = '全体' | '组合' | '特殊' | '偶然';

export interface TutorialExample {
  /** 这副牌例的实算计分，例如「清一色 6 + 清龙 2 ＝ 8 分」 */
  readonly scoring: string;
  /** 牌例本体：每个元素是一组牌 */
  readonly groups: readonly string[];
}

export interface TutorialYaku {
  /** 与 yaku.ts 的 YakuKey 对应，用于覆盖性测试 */
  readonly key: YakuKey;
  readonly name: string;
  readonly points: number;
  readonly kind: TutorialKind;
  /** 番种描述 */
  readonly description: string;
  /** 至少一个牌例 */
  readonly examples: readonly TutorialExample[];
}

export interface TutorialSection {
  readonly title: string;
  readonly items: readonly TutorialYaku[];
}

export const RULE_INTRO: readonly {
  readonly title: string;
  readonly lines: readonly string[];
}[] = [
  {
    title: '牌张',
    lines: [
      '四人：标准 136 张（万 / 饼 / 索 各 1~9，东南西北中发白，每种 4 张）。',
      '三人：两种 108 张模式 —— 三人·无字去掉全部字牌，三人·有字去掉二至八万。',
      '四人固定可以吃牌；三人默认禁止吃牌，可在选项里开启。',
    ],
  },
  {
    title: '和牌条件',
    lines: [
      '基本型：4 副面子 + 1 对雀头；七对子 / 十三幺是特殊型。',
      '**2 番起和**：除「一杠」和所有 1 分偶然事件外，其余番种分数之和 ≥ 2 才能和牌。',
    ],
  },
  {
    title: '计分',
    lines: [
      '和牌得分 S：达成 ≥ 12 分的番种时取其中最大的一个；否则把所有番种累加，封顶 12。',
      '包含关系不计：若番种甲必然包含番种乙，则乙的分值不另计（例如三连刻不另计二连刻）。',
      '自摸：和牌者 +S，其他人不变。',
      '铳和：和牌者 +S，放铳者 −P，其中 P 取 A − 2, 0, 12 三者的中间值，A 是「含铳牌」的番种分值之和。',
    ],
  },
  {
    title: '番种类型',
    lines: [
      '全体：整副手牌参与。铳和时始终计入铳责。',
      '组合：部分面子 / 雀头参与。铳牌所在的那组是否属于该组合，决定它是否计入铳责。',
      '特殊：不属于四面子 + 雀头的特殊和牌型。',
      '偶然：杠上开花、抢杠、海底捞月、天地和等。',
    ],
  },
];

export const TUTORIAL_SECTIONS: readonly TutorialSection[] = [
  {
    title: '刻杠类',
    items: [
      {
        key: 'pengpenghe',
        name: '碰碰和',
        points: 2,
        kind: '组合',
        description: '手牌中包含 4 副刻子。',
        examples: [
          {
            scoring: '碰碰和 2 + 三元刻 1 ＝ 3 分',
            groups: ['111m', '222p', '333s', '555z', '99m'],
          },
        ],
      },
      {
        key: 'yigang',
        name: '一杠',
        points: 1,
        kind: '组合',
        description: '手牌中包含恰好 1 个杠。不计入 2 番起和。',
        examples: [
          {
            scoring: '混一色 2 + 一杠 1 ＝ 3 分',
            groups: ['1111m', '234m', '567m', '789m', '11z'],
          },
        ],
      },
      {
        key: 'lianggang',
        name: '两杠',
        points: 2,
        kind: '组合',
        description: '手牌中包含恰好 2 个杠。',
        examples: [
          {
            scoring: '两杠 2 ＝ 2 分',
            groups: ['1111m', '2222p', '345s', '678s', '99s'],
          },
        ],
      },
      {
        key: 'sangang',
        name: '三杠',
        points: 6,
        kind: '组合',
        description: '手牌中包含恰好 3 个杠。',
        examples: [
          {
            scoring: '三杠 6 ＝ 6 分',
            groups: ['1111m', '2222p', '3333s', '456s', '99m'],
          },
        ],
      },
      {
        key: 'sigang',
        name: '四杠',
        points: 24,
        kind: '组合',
        description: '手牌中包含恰好 4 个杠。',
        examples: [
          {
            scoring: '四杠 24 ＝ 24 分（取最大单番）',
            groups: ['1111m', '2222p', '3333s', '6666s', '99m'],
          },
        ],
      },
    ],
  },
  {
    title: '花色类',
    items: [
      {
        key: 'queyimen',
        name: '缺一门',
        points: 1,
        kind: '全体',
        description: '手牌中有且仅有两种数字花色，不含字牌。',
        examples: [
          {
            scoring: '缺一门 1 + 清龙 2 ＝ 3 分',
            groups: ['123m', '456m', '789m', '123p', '99p'],
          },
        ],
      },
      {
        key: 'hunyise',
        name: '混一色',
        points: 2,
        kind: '全体',
        description: '手牌中有且仅有一种数字花色和字牌。',
        examples: [
          {
            scoring: '混一色 2 + 清龙 2 ＝ 4 分',
            groups: ['123m', '456m', '789m', '111m', '22z'],
          },
        ],
      },
      {
        key: 'qingyise',
        name: '清一色',
        points: 6,
        kind: '全体',
        description: '手牌中仅有一种数字花色的牌。',
        examples: [
          {
            scoring: '清一色 6 + 清龙 2 ＝ 8 分',
            groups: ['123m', '456m', '789m', '234m', '55m'],
          },
        ],
      },
      {
        key: 'ziyise',
        name: '字一色',
        points: 16,
        kind: '全体',
        description: '手牌中仅有字牌。',
        examples: [
          {
            scoring: '字一色 16 + 大四喜 24 ＝ 24 分（取最大单番）',
            groups: ['111z', '222z', '333z', '444z', '55z'],
          },
        ],
      },
      {
        key: 'jiulian',
        name: '九莲宝灯',
        points: 24,
        kind: '全体',
        description:
          '和牌时手牌为 1112345678999 的清一色、门清九面听牌型。不另计清一色。',
        examples: [
          {
            scoring: '九莲宝灯 24 + 清龙 2 ＝ 24 分（取最大单番）',
            groups: ['11123456789991m'],
          },
        ],
      },
    ],
  },
  {
    title: '三色组合类',
    items: [
      {
        key: 'sanse-tongshun',
        name: '三色同顺',
        points: 2,
        kind: '组合',
        description: '手牌中有三个数字相等、花色各异的顺子。',
        examples: [
          {
            scoring: '三色同顺 2 ＝ 2 分',
            groups: ['123m', '123p', '123s', '456m', '99m'],
          },
        ],
      },
      {
        key: 'ertongke',
        name: '二同刻',
        points: 1,
        kind: '组合',
        description: '手牌中有两个数字相等的刻子。可复计。',
        examples: [
          {
            scoring: '碰碰和 2 + 二同刻 1 + 二同刻 1 + 二连刻 1 ＝ 5 分',
            groups: ['111m', '111p', '222p', '222s', '44z'],
          },
        ],
      },
      {
        key: 'xiao-san-se-tongke',
        name: '小三色同刻',
        points: 2,
        kind: '组合',
        description:
          '手牌中有两个数字相等的刻子，且雀头为数字相等的第三种花色。\n其中包含的二同刻不另计。',
        examples: [
          {
            scoring: '碰碰和 2 + 二同刻 1 + 小三色同刻 2 ＝ 5 分',
            groups: ['111m', '111p', '11s', '888p', '888s'],
          },
        ],
      },
      {
        key: 'sanse-tongke',
        name: '三色同刻',
        points: 8,
        kind: '组合',
        description: '手牌中有三个数字相等的刻子。不另计二同刻。',
        examples: [
          {
            scoring: '三色同刻 8 ＝ 8 分',
            groups: ['111m', '111p', '111s', '456m', '99m'],
          },
        ],
      },
    ],
  },
  {
    title: '一色组合类',
    items: [
      {
        key: 'yibangao',
        name: '一般高',
        points: 1,
        kind: '组合',
        description: '手牌中有完全相同的两个顺子。',
        examples: [
          {
            scoring: '缺一门 1 + 一般高 1 ＝ 2 分',
            groups: ['123m', '123m', '456p', '789p', '99p'],
          },
        ],
      },
      {
        key: 'qinglong',
        name: '清龙',
        points: 2,
        kind: '组合',
        description: '手牌中有同花色的 123、456、789 顺子各一个。',
        examples: [
          {
            scoring: '缺一门 1 + 清龙 2 ＝ 3 分',
            groups: ['123m', '456m', '789m', '234p', '55p'],
          },
        ],
      },
      {
        key: 'sanlianhuan',
        name: '三连环',
        points: 2,
        kind: '组合',
        description: '手牌中有同花色、起点相差 2 的三个顺子。',
        examples: [
          {
            scoring: '缺一门 1 + 三连环 2 ＝ 3 分',
            groups: ['123m', '345m', '567m', '234p', '55p'],
          },
        ],
      },
      {
        key: 'sanbugao',
        name: '三步高',
        points: 4,
        kind: '组合',
        description: '手牌中有同花色、起点相差 1 的三个顺子。',
        examples: [
          {
            scoring: '清一色 6 + 三连环 2 + 三步高 4 ＝ 12 分',
            groups: ['123m', '234m', '345m', '567m', '99m'],
          },
        ],
      },
      {
        key: 'yise-santongshun',
        name: '一色三同顺',
        points: 8,
        kind: '组合',
        description: '手牌中有完全相同的三个顺子。不另计一般高。',
        examples: [
          {
            scoring: '缺一门 1 + 一色三同顺 8 ＝ 9 分',
            groups: ['123m', '123m', '123m', '456p', '99p'],
          },
        ],
      },
      {
        key: 'silianhuan',
        name: '四连环',
        points: 8,
        kind: '组合',
        description: '手牌中有同花色、起点相差 2 的四个顺子。不另计三连环。',
        examples: [
          {
            scoring: '清一色 6 + 四连环 8 ＝ 12 分（累加封顶）',
            groups: ['123m', '345m', '567m', '789m', '55m'],
          },
        ],
      },
      {
        key: 'sibugao',
        name: '四步高',
        points: 12,
        kind: '组合',
        description: '手牌中有同花色、起点相差 1 的四个顺子。不另计三步高。',
        examples: [
          {
            scoring: '清一色 6 + 四步高 12 ＝ 12 分（取最大单番）',
            groups: ['123m', '234m', '345m', '456m', '99m'],
          },
        ],
      },
      {
        key: 'yise-sitongshun',
        name: '一色四同顺',
        points: 24,
        kind: '组合',
        description: '手牌中有完全相同的四个顺子。不另计一色三同顺。',
        examples: [
          {
            scoring:
              '清一色 6 + 一色四同顺 24 + 纯全带幺九 6 ＝ 24 分（取最大单番）',
            groups: ['123m', '123m', '123m', '123m', '99m'],
          },
        ],
      },
      {
        key: 'erlianke',
        name: '二连刻',
        points: 1,
        kind: '组合',
        description: '手牌中有同花色、数字递增 1 的两个刻子。可复计。',
        examples: [
          {
            scoring: '碰碰和 2 + 二连刻 1 + 二连刻 1 ＝ 4 分',
            groups: ['111m', '222m', '333s', '444s', '55z'],
          },
        ],
      },
      {
        key: 'sanlianke',
        name: '三连刻',
        points: 6,
        kind: '组合',
        description: '手牌中有同花色、数字递增 1 的三个刻子。不另计二连刻。',
        examples: [
          {
            scoring: '缺一门 1 + 一色三同顺 8 ＝ 9 分',
            groups: ['111m', '222m', '333m', '567p', '99p'],
          },
        ],
      },
      {
        key: 'silianke',
        name: '四连刻',
        points: 16,
        kind: '组合',
        description:
          '手牌中有同花色、数字递增 1 的四个刻子。不另计碰碰和、二连刻、三连刻。',
        examples: [
          {
            scoring: '清一色 6 + 四连刻 16 ＝ 16 分（取最大单番）',
            groups: ['111m', '222m', '333m', '444m', '99m'],
          },
        ],
      },
    ],
  },
  {
    title: '数字聚合类',
    items: [
      {
        key: 'juwushu',
        name: '聚五数',
        points: 1,
        kind: '全体',
        description: '手牌中只有数牌，且最大值 − 最小值 = 4。',
        examples: [
          {
            scoring: '缺一门 1 + 聚五数 1 + 三步高 4 ＝ 6 分',
            groups: ['123m', '234m', '345m', '123p', '55p'],
          },
        ],
      },
      {
        key: 'jusishu',
        name: '聚四数',
        points: 2,
        kind: '全体',
        description: '手牌中只有数牌，且最大值 − 最小值 = 3。',
        examples: [
          {
            scoring: '聚四数 2 ＝ 2 分',
            groups: ['234m', '345p', '234s', '345m', '55m'],
          },
        ],
      },
      {
        key: 'jusanshu',
        name: '聚三数',
        points: 6,
        kind: '全体',
        description: '手牌中只有数牌，且最大值 − 最小值 = 2。',
        examples: [
          {
            scoring: '聚三数 6 + 三色同顺 2 + 一般高 1 ＝ 9 分',
            groups: ['345m', '345p', '345s', '345m', '55m'],
          },
        ],
      },
      {
        key: 'juliangshu',
        name: '聚两数',
        points: 24,
        kind: '全体',
        description: '手牌中只有数牌，且最大值 − 最小值 = 1。',
        examples: [
          {
            scoring:
              '聚两数 24 + 碰碰和 2 + 二同刻 1 + 小三色同刻 2 + 二连刻 1 ＝ 24 分（取最大单番）',
            groups: ['444m', '555p', '444s', '555m', '44p'],
          },
        ],
      },
    ],
  },
  {
    title: '对称类',
    items: [
      {
        key: 'liangbangao',
        name: '两般高',
        points: 6,
        kind: '组合',
        description: '手牌包含两组不相同的「一般高」。不另计一般高。',
        examples: [
          {
            scoring: '两般高 6 ＝ 6 分',
            groups: ['123m', '123m', '456p', '456p', '99s'],
          },
        ],
      },
      {
        key: 'jingtong',
        name: '镜同',
        points: 2,
        kind: '组合',
        description:
          '四副面子（A1、A2、B1、B2）只含恰好两种花色的数字牌，\n其中 A1/A2、B1/B2 分别同花色、A1/B1、A2/B2 分别数字相同。',
        examples: [
          {
            scoring: '二同刻 1 + 镜同 2 ＝ 3 分',
            groups: ['123s', '555s', '123p', '555p', '44z'],
          },
        ],
      },
    ],
  },
  {
    title: '幺九类',
    items: [
      {
        key: 'hun-quan-dai-yaojiu',
        name: '混全带幺九',
        points: 2,
        kind: '全体',
        description:
          '所有面子和雀头都包含幺九牌（数字 1、数字 9、字牌），且包含字牌。',
        examples: [
          {
            scoring: '混全带幺九 2 ＝ 2 分',
            groups: ['123m', '789m', '111p', '999s', '11z'],
          },
        ],
      },
      {
        key: 'chun-quan-dai-yaojiu',
        name: '纯全带幺九',
        points: 6,
        kind: '全体',
        description:
          '所有面子和雀头都包含幺九数牌（数字 1、数字 9），其中不含字牌。',
        examples: [
          {
            scoring: '纯全带幺九 6 ＝ 6 分',
            groups: ['123m', '789m', '111p', '999s', '11m'],
          },
        ],
      },
      {
        key: 'hun-yaojiu',
        name: '混幺九',
        points: 8,
        kind: '全体',
        description:
          '手牌中仅有幺九牌（数字 1、数字 9、字牌）的刻子和对子，且包含字牌。\n不另计混全带幺九、碰碰和、七对子。',
        examples: [
          {
            scoring: '二同刻 1 + 混幺九 8 ＝ 9 分',
            groups: ['111m', '999p', '222z', '999s', '11z'],
          },
        ],
      },
      {
        key: 'qing-yaojiu',
        name: '清幺九',
        points: 24,
        kind: '全体',
        description:
          '手牌中仅有幺九数牌（数字 1、数字 9）的刻子和对子，其中不含字牌。\n不另计纯全带幺九、碰碰和。',
        examples: [
          {
            scoring:
              '二同刻 1 + 小三色同刻 2 + 镜同 2 + 清幺九 24 ＝ 24 分（取最大单番）',
            groups: ['111m', '999m', '111p', '999p', '11s'],
          },
        ],
      },
    ],
  },
  {
    title: '字牌类',
    items: [
      {
        key: 'menfengke',
        name: '门风刻',
        points: 1,
        kind: '组合',
        description: '与玩家门风相对应的刻子（示例按东家，门风 = 东）。',
        examples: [
          {
            scoring: '混一色 2 + 门风刻 1 ＝ 3 分',
            groups: ['111z', '234m', '567m', '789m', '99m'],
          },
        ],
      },
      {
        key: 'xiao-san-feng-ke',
        name: '小三风刻',
        points: 2,
        kind: '组合',
        description: '手牌包含两组风牌刻子，雀头为另一种风牌。',
        examples: [
          {
            scoring: '混一色 2 + 门风刻 1 + 小三风刻 2 ＝ 5 分',
            groups: ['111z', '222z', '33z', '456m', '789m'],
          },
        ],
      },
      {
        key: 'san-feng-ke',
        name: '三风刻',
        points: 8,
        kind: '组合',
        description: '手牌包含三组风牌刻子。',
        examples: [
          {
            scoring: '混一色 2 + 门风刻 1 + 三风刻 8 ＝ 11 分',
            groups: ['111z', '222z', '333z', '456m', '99m'],
          },
        ],
      },
      {
        key: 'xiao-sixi',
        name: '小四喜',
        points: 16,
        kind: '组合',
        description: '三组风牌刻子 + 第四种风牌雀头。不另计三风刻。',
        examples: [
          {
            scoring: '混一色 2 + 门风刻 1 + 小四喜 16 ＝ 16 分（取最大单番）',
            groups: ['111z', '222z', '333z', '44z', '567m'],
          },
        ],
      },
      {
        key: 'da-sixi',
        name: '大四喜',
        points: 24,
        kind: '组合',
        description: '四组风牌刻子。不另计碰碰和、三风刻。',
        examples: [
          {
            scoring: '混一色 2 + 大四喜 24 ＝ 24 分（取最大单番）',
            groups: ['111z', '222z', '333z', '444z', '55m'],
          },
        ],
      },
      {
        key: 'sanyuanke',
        name: '三元刻',
        points: 1,
        kind: '组合',
        description: '中、发或白的刻子。可复计。',
        examples: [
          {
            scoring: '混一色 2 + 三元刻 1 ＝ 3 分',
            groups: ['555z', '234m', '567m', '789m', '99m'],
          },
        ],
      },
      {
        key: 'xiao-sanyuan',
        name: '小三元',
        points: 6,
        kind: '组合',
        description: '两组三元刻 + 第三种三元牌雀头。不另计三元刻。',
        examples: [
          {
            scoring: '混一色 2 + 小三元 6 ＝ 8 分',
            groups: ['555z', '666z', '77z', '234m', '567m'],
          },
        ],
      },
      {
        key: 'da-sanyuan',
        name: '大三元',
        points: 12,
        kind: '组合',
        description: '三组三元刻。不另计三元刻。',
        examples: [
          {
            scoring: '混一色 2 + 大三元 12 ＝ 12 分（取最大单番）',
            groups: ['555z', '666z', '777z', '234m', '99m'],
          },
        ],
      },
    ],
  },
  {
    title: '特殊和牌型',
    items: [
      {
        key: 'qiduizi',
        name: '七对子',
        points: 2,
        kind: '特殊',
        description: '手牌包含 7 组对子。不计入铳责。',
        examples: [
          {
            scoring: '七对子 2 ＝ 2 分',
            groups: ['11m', '33m', '55m', '77m', '99p', '11s', '33s'],
          },
        ],
      },
      {
        key: 'shisansan',
        name: '十三幺',
        points: 13,
        kind: '特殊',
        description: '十三种幺九牌各一张，其中一种成对。计入铳责。',
        examples: [
          {
            scoring: '十三幺 13 ＝ 13 分（取最大单番）',
            groups: ['19m19p19s1z2z3z4z5z6z7z', '1m'],
          },
        ],
      },
    ],
  },
  {
    title: '偶然事件',
    items: [
      {
        key: 'gangshang-kaihua',
        name: '杠上开花',
        points: 1,
        kind: '偶然',
        description: '使用开杠后从岭上补的那张牌自摸和牌。不计入 2 番起和。',
        examples: [
          {
            scoring: '混一色 2 + 一杠 1 + 杠上开花 1 ＝ 4 分',
            groups: ['1111m', '234m', '567m', '789m', '11z'],
          },
        ],
      },
      {
        key: 'qianggang',
        name: '抢杠',
        points: 1,
        kind: '偶然',
        description: '使用他人补杠的那张牌铳和。计入铳责。不计入 2 番起和。',
        examples: [
          {
            scoring: '缺一门 1 + 一色三同顺 8 + 抢杠 1 ＝ 10 分',
            groups: ['111m', '222m', '333m', '567p', '99p'],
          },
        ],
      },
      {
        key: 'miaoshou-huichun',
        name: '妙手回春',
        points: 1,
        kind: '偶然',
        description: '牌山剩余 0 张（不含王牌）时自摸。不计入 2 番起和。',
        examples: [
          {
            scoring: '缺一门 1 + 清龙 2 + 妙手回春 1 ＝ 4 分',
            groups: ['123m', '456m', '789m', '234p', '55p'],
          },
        ],
      },
      {
        key: 'haidi-laoyue',
        name: '海底捞月',
        points: 1,
        kind: '偶然',
        description:
          '牌山剩余 0 张（不含王牌）时铳和。计入铳责。不计入 2 番起和。',
        examples: [
          {
            scoring: '缺一门 1 + 清龙 2 + 海底捞月 1 ＝ 4 分',
            groups: ['123m', '456m', '789m', '234p', '55p'],
          },
        ],
      },
      {
        key: 'tianhe',
        name: '天和',
        points: 12,
        kind: '偶然',
        description: '庄家起手 14 张牌即和牌。',
        examples: [
          {
            scoring: '缺一门 1 + 清龙 2 + 天和 12 ＝ 12 分（取最大单番）',
            groups: ['123m', '456m', '789m', '234p', '55p'],
          },
        ],
      },
      {
        key: 'dihe',
        name: '地和',
        points: 12,
        kind: '偶然',
        description: '闲家第一次摸牌即自摸和牌。',
        examples: [
          {
            scoring: '地和 12 ＝ 12 分（取最大单番）',
            groups: ['123m', '456m', '789p', '456s', '55s'],
          },
        ],
      },
    ],
  },
];
/** 所有番种条目（用于覆盖性检查） */
export const TUTORIAL_ITEMS: readonly TutorialYaku[] =
  TUTORIAL_SECTIONS.flatMap((section) => section.items);

/**
 * 是否计入「2 番起和」的门槛。
 *
 * 与 `packages/core/src/evaluate.ts` 的 `meetsWinThreshold` 保持一致：
 * 「一杠」和所有 1 分偶然事件不计，其余都算。
 */
export function countsForGate(item: TutorialYaku): boolean {
  if (item.key === 'yigang') return false;
  if (item.kind === '偶然' && item.points === 1) return false;
  return true;
}
export interface TutorialOverviewRow {
  readonly points: number;
  readonly items: readonly TutorialYaku[];
}

/**
 * 番种一览：按分值从小到大把所有番种排一遍，放在教程开头当索引。
 * 直接从 `TUTORIAL_ITEMS` 汇总，改番种表时它会自动跟着变。
 */
export const TUTORIAL_OVERVIEW: readonly TutorialOverviewRow[] = (() => {
  const byPoints = new Map<number, TutorialYaku[]>();
  for (const item of TUTORIAL_ITEMS) {
    const items = byPoints.get(item.points);
    if (items === undefined) byPoints.set(item.points, [item]);
    else items.push(item);
  }
  return [...byPoints.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([points, items]) => ({
      points,
      // 同一档内把「不计入 2 番起和」的排到最后
      items: [...items].sort(
        (a, b) => Number(!countsForGate(a)) - Number(!countsForGate(b)),
      ),
    }));
})();
