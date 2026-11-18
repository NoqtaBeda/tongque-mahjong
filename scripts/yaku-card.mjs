// 把 yaku-stats.json 转成 schemaJson 卡片（图表 + 表格）
import { readFileSync, writeFileSync } from 'node:fs';

const stats = JSON.parse(readFileSync('.data/yaku-stats.json', 'utf8'));
const rows = stats.rows;

const top = (list, key, count) =>
  [...list].sort((a, b) => b[key] - a[key]).slice(0, count);
const freqTop = top(rows, 'count', 15);
const valueTop = top(rows, 'average', 12);

const barOptions = (list, key, axisName, scale = 1) => ({
  theme: 'hdesign-light',
  padding: [20, 40, 30, 90],
  legend: { show: false },
  direction: 'horizontal',
  data: list.map((row) => ({
    番种: row.name,
    数值: Number((row[key] * scale).toFixed(2)),
  })),
  xAxis: { data: '番种' },
  yAxis: { name: axisName },
});

const kpi = [
  ['平均打点', stats.average.toFixed(2)],
  ['中位打点', String(stats.median)],
  ['最高打点', String(stats.max)],
  ['手均番种', stats.yakuPerWin.toFixed(2)],
  ['和牌率', `${((stats.wins / stats.rounds) * 100).toFixed(1)}%`],
  ['流局率', `${((stats.draws / stats.rounds) * 100).toFixed(1)}%`],
];

const card = (children) => ({ componentName: 'TinyCard', children });

const schema = {
  componentName: 'Page',
  state: {},
  methods: {},
  children: [
    card([
      { componentName: 'h3', children: '进阶 AI 自对弈 · 番种统计' },
      {
        componentName: 'Text',
        props: {
          text: `${stats.rounds} 小局 · ${stats.wins} 手和牌（自摸 ${stats.tsumoWins} / 铳和 ${stats.ronWins}）· 流局 ${stats.draws} · 进阶档 AI 四家自对弈 23 分钟`,
          style: 'display:block;font-size:13px;margin-bottom:14px;',
        },
      },
      {
        componentName: 'div',
        props: { style: 'display:flex;flex-wrap:wrap;gap:10px;' },
        children: kpi.map(([label, value]) => ({
          componentName: 'div',
          props: {
            style:
              'min-width:104px;padding:10px 14px;border:1px solid #2f4a3a;border-radius:10px;',
          },
          children: [
            {
              componentName: 'Text',
              props: {
                text: label,
                style: 'display:block;font-size:12px;margin-bottom:4px;',
              },
            },
            {
              componentName: 'Text',
              props: {
                text: value,
                style: 'display:block;font-size:22px;font-weight:700;',
              },
            },
          ],
        })),
      },
    ]),
    card([
      {
        componentName: 'Text',
        props: {
          text: '出现频率 Top 15（%）',
          style: 'display:block;font-weight:700;margin-bottom:8px;',
        },
      },
      {
        componentName: 'TinyHuichartsBar',
        props: {
          options: barOptions(freqTop, 'frequency', '出现频率(%)', 100),
        },
      },
    ]),
    card([
      {
        componentName: 'Text',
        props: {
          text: '频率 × 平均打点（点越大样本越多）',
          style: 'display:block;font-weight:700;margin-bottom:8px;',
        },
      },
      {
        componentName: 'TinyHuichartsScatter',
        props: {
          options: {
            theme: 'hdesign-light',
            padding: [30, 40, 40, 50],
            legend: { show: false },
            bubbleSize: [8, 40],
            xAxisType: 'value',
            data: {
              番种: rows.map((row) => [
                Number((row.frequency * 100).toFixed(2)),
                Number(row.average.toFixed(2)),
                row.count,
              ]),
            },
          },
        },
      },
    ]),
    card([
      {
        componentName: 'Text',
        props: {
          text: '高价值番种 · 平均打点 Top 12',
          style: 'display:block;font-weight:700;margin-bottom:8px;',
        },
      },
      {
        componentName: 'TinyHuichartsBar',
        props: { options: barOptions(valueTop, 'average', '平均打点') },
      },
      {
        componentName: 'Text',
        props: {
          text: '注意：低频番种样本很少（聚两数 1 次、字一色 2 次、四步高 7 次），这几个的打点参考价值有限。',
          style: 'display:block;font-size:12px;margin-top:8px;',
        },
      },
    ]),
  ],
};

const text = JSON.stringify(schema);
writeFileSync('.data/yaku-card.json', text);
console.log(`生成 ${text.length} 字符，写入 .data/yaku-card.json`);
