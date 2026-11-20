// 沙箱里跑不起 Vite（esbuild 与 Vite 的 Windows realpath 探测都要 spawn 子进程），
// 所以改用 SSR 把组件树渲染出来：验证 props、分支、牌面素材路径与三人模式。
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToString } = require('react-dom/server');

const {
  GameView,
  HistoryDialog,
  PRESETS,
  SettingsDialog,
  StartScreen,
  TutorialDialog,
} = await import('../.ssr/packages/app/src/GameView.js');
const { decodeState, encodeState } =
  await import('../.ssr/packages/app/src/storage.js');
const core = await import('../.ssr/packages/core/src/index.js');
const ai = await import('../.ssr/packages/core/src/ai/index.js');
const { YAKU } = await import('../.ssr/packages/core/src/yaku.js');
const { TUTORIAL_ITEMS } = await import('../.ssr/packages/app/src/tutorial.js');
const { LoadingScreen } =
  await import('../.ssr/packages/app/src/LoadingScreen.js');

const noop = () => {};
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
/** 去标签后的纯文本。有些文字跨了多个 <b>（比如 `+3 / -1`），只有拼起来才看得出格式。 */
const textOf = (html) => strip(html).replace(/<[^>]+>/g, '');

function render(state, legal, overrides = {}) {
  return renderToString(
    React.createElement(GameView, {
      state,
      legal,
      config: state.cfg,
      muted: true,
      canReplay: false,
      showFinal: false,
      onAction: noop,
      onRestart: noop,
      onPresetChange: noop,
      onOpenSettings: noop,
      onOpenHistory: noop,
      onToggleMute: noop,
      onOpenReplay: noop,
      onShowFinal: noop,
      ...overrides,
    }),
  );
}

function play(state, limit) {
  let steps = 0;
  let current = state;
  while (steps < limit && current.phase !== 'over') {
    const actor = current.actor;
    if (actor === null) break;
    const legal = core.legalActions(current, actor);
    if (legal.length === 0) break;
    current = core.reduce(current, ai.decide(core.observe(current, actor)));
    steps += 1;
  }
  return current;
}

// ---- 1. 四人开局（经典方桌布局） ----
const fourCfg = core.makeConfig({ rounds: 4 });
let state = core.createGame(fourCfg, 20260101);
const opening = strip(render(state, core.legalActions(state, 0)));
for (const expected of ['第 1 / 4 局', '剩余', '庄家', '四人麻将', '选项']) {
  assert.ok(opening.includes(expected), `开局画面缺少片段：${expected}`);
}
assert.ok(opening.includes('/tiles/Mahjong_'), '牌面应当用 SVG 素材');
for (const marker of [
  'seat-top',
  'seat-left',
  'seat-right',
  'seat-self',
  'arena',
  'slot-top',
  'slot-bottom',
  'slot-left',
  'slot-right',
  'hand-backs',
  'tile-back',
]) {
  assert.ok(opening.includes(marker), `方桌布局应包含 ${marker}`);
}
assert.equal(
  (opening.match(/river-slot/g) ?? []).length,
  4,
  '四家牌河都应在中央',
);

// 四家固定称呼 + 固定色号
for (const name of ['我', '下家', '对家', '上家']) {
  assert.ok(opening.includes(name), `应当出现固定称呼「${name}」`);
}
for (const cls of ['player-0', 'player-1', 'player-2', 'player-3']) {
  assert.ok(opening.includes(cls), `应当带上固定色号 ${cls}`);
}

// 中央名牌：名字与分数合成一个 tag，格式「名字：分数」
assert.ok(/对家：\d/.test(opening), '中央名牌应为「名字：分数」格式');
assert.ok(/我：\d/.test(opening), '自己的名牌也应在中央');

// ---- 2. 中局（覆盖牌河 / 副露 / 鸣牌按钮 / 动画类） ----
state = play(state, 26);
const mid = strip(render(state, core.legalActions(state, 0)));
assert.ok(
  state.discards.some((river) => river.length > 0),
  '中局应已有打出的牌',
);
assert.ok(mid.includes('tile-small'), '中局应渲染小牌');

// ---- 3. 终局结算面板（要有和牌者，才能验手牌 / 番种 / 分数） ----
// 一个种子的整场可能全是流局，所以多试几个种子
function findWinState(cfg, seed) {
  for (let offset = 0; offset < 24; offset += 1) {
    let current = core.createGame(cfg, seed + offset);
    for (let step = 0; step < 4000; step += 1) {
      if (current.phase === 'over') {
        if (current.result !== null && current.result.kind !== 'draw')
          return current;
        if (current.finished) break;
        current = core.reduce(current, { type: 'next-round' });
        continue;
      }
      const actor = current.actor;
      if (actor === null) break;
      const legal = core.legalActions(current, actor);
      if (legal.length === 0) break;
      current = core.reduce(current, ai.decide(core.observe(current, actor)));
    }
  }
  return null;
}

const winState = findWinState(fourCfg, 20260101);
assert.ok(winState !== null, '应当能找到一局有人和牌的局面');
assert.equal(winState.phase, 'over');

const finished = strip(
  render(winState, core.legalActions(winState, 0), { canReplay: true }),
);
assert.ok(finished.includes('回放本局'), '结算面板应有回放入口');
assert.ok(
  finished.includes('下一局') || finished.includes('再来一局'),
  '结算面板应有推进按钮',
);

// 结算面板要展示：谁和牌、手牌、番种、总分
assert.ok(finished.includes('result-panel'), '应当渲染结算面板');
assert.ok(finished.includes('番种'), '结算面板应列出番种');
assert.ok(finished.includes('合计'), '结算面板应给出合计与得分');

// 整副和牌必须完整显示成 14 张（副露 + 面子 + 雀头），少一张就是 bug
const handStart = finished.indexOf('class="result-hand"');
const handEnd = finished.indexOf('class="result-line"', handStart);
assert.ok(handStart >= 0 && handEnd > handStart, '结算面板应有手牌行');
const resultTiles = (
  finished.slice(handStart, handEnd).match(/<div class="tile/g) ?? []
).length;
assert.equal(
  resultTiles,
  14,
  `结算面板的手牌应有 14 张，实际 ${resultTiles} 张`,
);

const firstEntry = winState.result.entries[0];
const firstYaku = firstEntry.result.hits[0];
assert.ok(firstYaku !== undefined, '和牌者至少有一个番种');
assert.ok(
  finished.includes(firstYaku.name),
  `结算面板应显示番种「${firstYaku.name}」`,
);
assert.ok(finished.includes(String(firstEntry.gain)), '结算面板应显示得分');

// 和牌者的手牌必须在座位面板上翻明（14 张 = 13 暗牌 + 和牌张）
assert.ok(finished.includes('hand-revealed'), '和牌者的手牌应当亮出来');
const winnerSeat = firstEntry.seat;
const winnerIsTop = winnerSeat !== 0;
void winnerIsTop;
assert.ok(
  (finished.match(/hand-revealed/g) ?? []).length >= 1,
  '至少有一家亮牌',
);

// 亮牌的数据前提：暗牌张数 = 13 − 3×副露数（自摸再加摸到的 1 张）
for (const entry of winState.result.entries) {
  const melds = winState.melds[entry.seat].length;
  const total = winState.hands[entry.seat].reduce((sum, n) => sum + n, 0);
  const expected = 13 - 3 * melds + (winState.result.kind === 'tsumo' ? 1 : 0);
  assert.equal(
    total,
    expected,
    `副露 ${melds} 组时和牌者暗牌应有 ${expected} 张`,
  );
}

// ---- 4. 三人 + 108 张（没有对家，所以不该出现 seat-top） ----
const threeCfg = core.makeConfig({
  players: 3,
  tileSet: 'sanma108',
  rounds: 3,
});
const three = core.createGame(threeCfg, 271);
const threeHtml = strip(render(three, core.legalActions(three, 0)));
assert.ok(threeHtml.includes('seat-left'), '三麻应有上家');
assert.ok(threeHtml.includes('seat-right'), '三麻应有下家');
assert.ok(!threeHtml.includes('seat-top'), '三麻没有对家');
assert.ok(!threeHtml.includes('slot-top'), '三麻没有对家的牌河');
assert.equal(
  (threeHtml.match(/river-slot/g) ?? []).length,
  3,
  '三麻只有三条牌河',
);
assert.ok(threeHtml.includes('board-three'), '三麻应使用对侧布局');
assert.ok(threeHtml.includes('三人·有字'), '顶栏应显示当前对局模式');
assert.ok(
  threeHtml.includes('下家') && threeHtml.includes('上家'),
  '三麻应有上下家',
);
assert.ok(!threeHtml.includes('对家'), '三麻没有对家');

// ---- 5. 牌面路径符合天凤记号 ----
const honorsHand = core.parseHand('1234567z');
for (const [kind, code] of [
  [27, '1z'],
  [31, '5z'],
  [32, '6z'],
  [33, '7z'],
]) {
  assert.ok(honorsHand[kind] > 0, `测试手牌应包含 ${code}`);
  assert.equal(core.tileCode(kind), code);
}
assert.equal(core.tileName(31), '白');
assert.equal(core.tileName(33), '中');

// ---- 5.5 副露的座位朝向 ----
// 对家的副露要整组转 180°（和 .slot-top .river 一致），否则「横置牌表示从谁鸣的」在对家身上是镜像反的
const meldState = findFinished(fourCfg, 777, (state) =>
  state.melds.some((group) => group.length > 0),
);
assert.ok(meldState !== null, '应当能找到一盘有副露的完整对局');
const meldHtml = strip(render(meldState, []));
assert.ok(meldHtml.includes('melds-flip'), '对家的副露容器应当带 melds-flip');
assert.equal(
  (meldHtml.match(/melds-side/g) ?? []).length,
  2,
  '上家 / 下家的副露应当是 melds-side（左右各一）',
);
// ---- 6. 鸣牌按钮：位置在牌河区内、配色按动作分类 ----
function findMyClaim(cfg, seed) {
  let current = core.createGame(cfg, seed);
  for (let step = 0; step < 6000; step += 1) {
    if (current.finished) return null;
    if (current.phase === 'over') {
      current = core.reduce(current, { type: 'next-round' });
      continue;
    }
    const actor = current.actor;
    if (actor === null) return null;
    const legal = core.legalActions(current, actor);
    if (actor === 0 && legal.some((action) => action.type !== 'discard'))
      return current;
    current = core.reduce(current, ai.decide(core.observe(current, actor)));
  }
  return null;
}

let claimState = null;
for (let offset = 0; offset < 24 && claimState === null; offset += 1) {
  claimState = findMyClaim(fourCfg, 4242 + offset);
}
assert.ok(claimState !== null, '应当能找到一个轮到我鸣牌的局面');
const claimLegal = core.legalActions(claimState, 0);
const claimHtml = strip(render(claimState, claimLegal));

const arenaAt = claimHtml.indexOf('class="arena"');
const actionsAt = claimHtml.indexOf('class="actions"');
const selfAt = claimHtml.indexOf('seat-self');
assert.ok(arenaAt >= 0 && actionsAt > arenaAt, '鸣牌按钮应当渲染在牌河区内部');
assert.ok(selfAt > actionsAt, '鸣牌按钮应在牌河区之后、自家区域之前');

for (const action of claimLegal) {
  if (action.type === 'discard') continue;
  const expected =
    action.type === 'tsumo' || action.type === 'ron'
      ? 'btn-win'
      : action.type === 'pass'
        ? 'btn-pass'
        : 'btn-call';
  assert.ok(
    claimHtml.includes(expected),
    `${action.type} 按钮应带 ${expected} 配色类`,
  );
}

// 鸣牌按钮统一为单字：和 / 吃 / 碰 / 杠 / 过
const callLabels = [
  ...claimHtml.matchAll(/class="btn-(?:win|call|pass)"[^>]*>([^<]*)</g),
].map((match) => match[1]);
assert.ok(callLabels.length > 0, '鸣牌时应当有按钮');
// 单字，或多方案时的「吃 13饼」写法
const CALL_LABEL = /^(和|吃|碰|杠|过|吃 \d{2}[万饼索])$/;
for (const label of callLabels) {
  assert.ok(CALL_LABEL.test(label), `鸣牌按钮文字不符合约定：「${label}」`);
}

// 按钮顺序必须是 和 → 吃 → 碰 → 杠 → 过
const order = ['btn-win', 'btn-call', 'btn-pass']
  .map((cls) => claimHtml.indexOf(cls))
  .filter((index) => index >= 0);
for (let index = 1; index < order.length; index += 1) {
  assert.ok(order[index - 1] < order[index], '按钮顺序应为 和 → 吃碰杠 → 过');
}
const passText = claimHtml.indexOf('>过<');
const ponText = claimHtml.indexOf('>碰<');
if (passText >= 0 && ponText >= 0) {
  assert.ok(ponText < passText, '碰应当排在过之前');
}

// 鸣牌窗口里必须高亮"最近一张舍牌"，否则玩家不知道该鸣哪家的哪张牌
assert.equal(
  (claimHtml.match(/tile-last/g) ?? []).length,
  1,
  '鸣牌时应高亮最近一张舍牌',
);

// ---- 7. 摸到的牌排在最后、最近舍牌高亮 ----
function findMyDraw(cfg, seed) {
  let current = core.createGame(cfg, seed);
  for (let step = 0; step < 6000; step += 1) {
    const thrown = current.discards.reduce(
      (sum, river) => sum + river.length,
      0,
    );
    if (
      current.phase === 'discard' &&
      current.actor === 0 &&
      current.drawnTile !== null &&
      thrown >= 8
    ) {
      return current;
    }
    if (current.phase === 'over') {
      if (current.finished) return null;
      current = core.reduce(current, { type: 'next-round' });
      continue;
    }
    const actor = current.actor;
    if (actor === null) return null;
    const legal = core.legalActions(current, actor);
    if (legal.length === 0) return null;
    current = core.reduce(current, ai.decide(core.observe(current, actor)));
  }
  return null;
}

const drawState = findMyDraw(fourCfg, 20260101);
assert.ok(drawState !== null, '应当能找到一个轮到我摸牌的局面');
const drawHtml = strip(render(drawState, core.legalActions(drawState, 0)));

assert.equal(
  (drawHtml.match(/tile-drawn/g) ?? []).length,
  1,
  '摸到的牌应当只有一个',
);
const lastTileAt = drawHtml.lastIndexOf('class="tile ');
assert.ok(
  drawHtml.slice(lastTileAt, lastTileAt + 80).includes('tile-drawn'),
  '摸到的牌应当排在整张桌子的最后一个牌位置（手牌最右）',
);

assert.equal(
  (drawHtml.match(/tile-last/g) ?? []).length,
  1,
  '轮到我打牌时也应当高亮上一家刚打出的那张牌',
);

// 带关联铳责的番种要单独标色（只标实际触发铳责的那些）
function liabilityHits(entry) {
  const slot = entry.result.liabilitySlot;
  if (entry.result.liability <= 0) return 0;
  return entry.result.hits.filter(
    (hit) =>
      hit.liability === 'always' ||
      (hit.liability === 'by-meld' && (hit.meldMask & slot) !== 0),
  ).length;
}

function findLiabilityWin(cfg, baseSeed, maxSeeds) {
  for (let offset = 0; offset < maxSeeds; offset += 1) {
    const found = findWinState(cfg, baseSeed + offset);
    if (found === null) continue;
    // 这一节要验「放铳者 tag」和「+x / −y」，所以必须挑铳和
    if (found.result.kind !== 'ron') continue;
    let count = 0;
    for (const entry of found.result.entries) count += liabilityHits(entry);
    if (count > 0) return { state: found, count };
  }
  return null;
}

const liabilityWin = findLiabilityWin(fourCfg, 20260101, 60);
if (liabilityWin !== null) {
  const liabilityHtml = strip(
    render(liabilityWin.state, core.legalActions(liabilityWin.state, 0), {
      canReplay: true,
    }),
  );
  assert.equal(
    (liabilityHtml.match(/class="liability-dot"/g) ?? []).length,
    liabilityWin.count,
    '带关联铳责的番种应当正好标出这么多',
  );
  assert.ok(
    liabilityHtml.includes('·放铳'),
    '结算面板应把放铳者标成「XX·放铳」',
  );
  assert.ok(
    /\+-?\d+ \/ /.test(textOf(liabilityHtml)),
    '铳和应显示「+x / −y」（斜杠两边留空）',
  );
}

// ---- 7.4 开始界面 ----
const startHtml = strip(
  renderToString(
    React.createElement(StartScreen, { onStart: noop, onTutorial: noop }),
  ),
);
assert.ok(startHtml.includes('铜雀'), '开始界面应有标题「铜雀」');
assert.ok(startHtml.includes('简洁明快的竞技'), '开始界面应有副标题');
assert.ok(
  startHtml.includes('开始') && startHtml.includes('教程'),
  '开始界面应有开始 / 教程两个按钮',
);
assert.equal(
  (startHtml.match(/class="start-btn/g) ?? []).length,
  2,
  '开始界面应当正好两个按钮',
);
// ---- 7.5 教程对话框：规则速览 + 完整番种表 ----
const tutorialHtml = strip(
  renderToString(React.createElement(TutorialDialog, { onClose: noop })),
);
assert.ok(tutorialHtml.includes('铜雀'), '教程标题应当带上规则名「铜雀」');
const tutorialBlocks = (tutorialHtml.match(/class="tut-yaku"/g) ?? []).length;
assert.equal(
  tutorialBlocks,
  50,
  `番种表应当有 50 条，实际 ${tutorialBlocks} 条`,
);
for (const name of Object.values(YAKU).map((yaku) => yaku.name)) {
  assert.ok(tutorialHtml.includes(name), `番种表缺少「${name}」`);
}
// 「不计入 2 番起和」这种限制要高亮出来，数量要和文案里出现该说法的条目数一致
const highlightCount = (tutorialHtml.match(/class="tut-hl"/g) ?? []).length;
const expectHighlights = TUTORIAL_ITEMS.filter((item) =>
  /不计入\s*2\s*番起和/.test(item.description),
).length;
assert.ok(highlightCount >= 1, '「不计入 2 番起和」应当被高亮');
assert.equal(
  highlightCount,
  expectHighlights,
  `高亮数量应等于描述里写了该限制的条目数（${expectHighlights}）`,
);
// 描述里的 \n 要渲染成换行（镜同就靠它把 A1/A2 那半句另起一行）
const expectedBreaks = TUTORIAL_ITEMS.filter((item) =>
  item.description.includes('\n'),
).length;
const renderedBreaks = (tutorialHtml.match(/<br\/?>/g) ?? []).length;
assert.equal(
  renderedBreaks,
  expectedBreaks,
  `描述里的 \\n 应当渲染成换行（期望 ${expectedBreaks} 个，实际 ${renderedBreaks} 个）`,
);
// 番种表前面要有一张按分值从小到大的一览
assert.ok(tutorialHtml.includes('class="tut-overview"'), '教程应有番种一览表');
assert.equal(
  (tutorialHtml.match(/class="tut-overview-points"/g) ?? []).length,
  9,
  '一览表应当有 9 个分值行（1 分拆成「不能起和」「能起和」两行）',
);
// 1 分档里「不能起和」那一行要带 info 图标（且只带一个）
assert.equal(
  (tutorialHtml.match(/class="tut-overview-info"/g) ?? []).length,
  1,
  '「不能起和」的行应当恰好有一个 info 图标',
);
const overviewTags = [
  ...tutorialHtml.matchAll(/class="tut-tag[^"]*"[^>]*>([^<]*)</g),
].map((m) => m[1]);
assert.equal(
  overviewTags.length,
  50,
  `一览表应当有 50 个 tag，实际 ${overviewTags.length} 个`,
);
for (const name of Object.values(YAKU).map((yaku) => yaku.name)) {
  assert.ok(overviewTags.includes(name), `一览表缺少「${name}」`);
}
// 每条的结构必须是：名称行 → 描述 → 「牌例：计分」→ 牌面
const entries = tutorialHtml.split('class="tut-yaku"').slice(1);
for (const entry of entries) {
  const name = /class="tut-name">([^<]*)/.exec(entry)?.[1] ?? '?';
  const body = entry.slice(0, entry.indexOf('class="tut-yaku"'));
  const desc = /class="tut-desc">([\s\S]*?)<\/p>/.exec(body);
  assert.ok(
    desc !== null && desc[1].replace(/<[^>]+>/g, '').trim().length >= 6,
    `「${name}」缺少描述`,
  );
  const label = /class="tut-example-label">([\s\S]*?)<\/p>/.exec(body);
  assert.ok(label !== null, `「${name}」缺少「牌例：」标签`);
  assert.ok(
    label[1].replace(/<[^>]+>/g, '').includes('分'),
    `「${name}」的牌例标签应当带上计分细节`,
  );
  assert.ok((body.match(/<img/g) ?? []).length >= 1, `「${name}」没有牌面`);
}

// ---- 8. 选项对话框 ----
function renderSettings(overrides) {
  return strip(
    renderToString(
      React.createElement(SettingsDialog, {
        preset: PRESETS[0],
        keepDeadWall: false,
        duration: 'hanchan',
        chi: false,
        dirty: false,
        confirming: false,
        onChangePreset: noop,
        onChangeDeadWall: noop,
        onChangeDuration: noop,
        onChangeChi: noop,
        onApply: noop,
        onCancel: noop,
        onConfirm: noop,
        onDismissConfirm: noop,
        ...overrides,
      }),
    ),
  );
}

const settingsHtml = renderSettings();
for (const expected of [
  '选项',
  '对局模式',
  '四人麻将',
  '三人·无字',
  '三人·有字',
  '对局时长',
  '东风战',
  '半庄战',
  '全庄战',
  '使用王牌',
  '不使用',
  '允许吃牌',
  '禁止',
  '应用',
  '关闭',
]) {
  assert.ok(settingsHtml.includes(expected), `选项对话框应包含「${expected}」`);
}
assert.ok(/seg-btn on">半庄战/.test(settingsHtml), '默认对局时长应为半庄战');

// 对局模式排在选项第一行
const firstLabel = /settings-label">([^<]*)/.exec(settingsHtml);
assert.ok(
  firstLabel !== null && firstLabel[1] === '对局模式',
  '对局模式应排在选项第一行',
);

// 四人麻将：吃牌强制允许且不可选（不再显示提示文案）
assert.ok(!settingsHtml.includes('此项不可更改'), '不应该再有吃牌提示文案');
assert.ok(
  /seg-btn on" disabled=""/.test(settingsHtml),
  '四人麻将的「允许」应选中且禁用',
);
// 三麻：吃牌可选，默认禁止
const threeSettings = renderSettings({ preset: PRESETS[1] });
assert.ok(threeSettings.includes('三人·无字'), '设置里应能选三人·无字');
assert.ok(/seg-btn on">禁止/.test(threeSettings), '三麻默认禁止吃牌');
// 三个角标：对局模式 + 对局时长 + 使用王牌
assert.equal(
  (settingsHtml.match(/class="info-badge"/g) ?? []).length,
  3,
  '应当有三个说明角标（对局模式、对局时长、使用王牌）',
);
const tips = [
  ...settingsHtml.matchAll(/<span class="info-tip">([\s\S]*?)<\/span>/g),
].map((m) => m[1]);
assert.equal(tips.length, 3, '每个角标都要有气泡内容');
// 模式说明覆盖三种玩法
assert.ok(
  tips.some((tip) => tip.includes('三人·无字') && tip.includes('三人·有字')),
  '对局模式角标应说明三种模式',
);
// 时长说明要写清三人全庄 9 局
assert.ok(
  tips.some((tip) => tip.includes('9 局') && tip.includes('16 局')),
  '对局时长角标应说明两边的全庄局数',
);
// 王牌说明还在
assert.ok(
  tips.some((tip) => tip.includes('王牌')),
  '应有王牌说明角标',
);
// 文案里的 \n 要渲染成换行（模式、时长两个气泡都是多行的）
assert.ok(
  tips.filter((tip) => tip.includes('<br/>')).length >= 2,
  '模式 / 时长的气泡应当是多行显示的',
);
assert.ok(
  !settingsHtml.includes('settings-note'),
  '原来那段提示文字应当已删除',
);
assert.ok(
  !settingsHtml.includes('王牌指牌山末尾保留'),
  '提示正文不应再渲染在面板里',
);
assert.ok(settingsHtml.includes('disabled'), '没有改动时「应用」应当禁用');
assert.ok(
  !settingsHtml.includes('确定应用'),
  '未进入二次确认时不应出现确认按钮',
);

const confirmHtmlSettings = renderSettings({ dirty: true, confirming: true });
assert.ok(
  confirmHtmlSettings.includes('应用更改并重置当前对局？'),
  '有改动时应二次确认是否重置',
);
assert.ok(confirmHtmlSettings.includes('确定应用'), '二次确认应有确定按钮');

// ---- 9. 终局顺位 ----
function findFinished(cfg, seed, accept = () => true) {
  for (let offset = 0; offset < 80; offset += 1) {
    let current = core.createGame(cfg, seed + offset);
    for (let step = 0; step < 12000; step += 1) {
      if (current.finished) {
        if (accept(current)) return current;
        break;
      }
      if (current.phase === 'over') {
        current = core.reduce(current, { type: 'next-round' });
        continue;
      }
      const actor = current.actor;
      if (actor === null) break;
      const legal = core.legalActions(current, actor);
      if (legal.length === 0) break;
      current = core.reduce(current, ai.decide(core.observe(current, actor)));
    }
  }
  return null;
}

const finishedGame = findFinished(fourCfg, 20260101, (state) =>
  state.history.some((record) => record.entries.length > 0),
);
assert.ok(finishedGame !== null, '应当能打完一整局');

// 第一页：还是单局结算，不能直接跳到终局面板
const lastRoundHtml = strip(render(finishedGame, [], { canReplay: true }));
assert.ok(
  !lastRoundHtml.includes('终局'),
  '最后一局先显示单局结算，不直接跳终局',
);
assert.ok(!lastRoundHtml.includes('最终顺位'), '单局结算页不应混入顺位表');
assert.ok(lastRoundHtml.includes('最终结算'), '单局结算页应有「最终结算」按钮');
if (finishedGame.result.entries.length > 0) {
  assert.ok(
    (lastRoundHtml.match(/class="result-entry"/g) ?? []).length >= 1,
    '最后一局的和牌详情应当渲染出来',
  );
} else {
  assert.ok(lastRoundHtml.includes('无人和牌'), '最后一局流局时应写明');
}

// 第二页：点「最终结算」之后才是顺位面板
const finalHtml = strip(render(finishedGame, [], { showFinal: true }));
assert.ok(finalHtml.includes('终局'), '翻页后应显示终局面板');
assert.ok(finalHtml.includes('最终顺位'), '终局页面应显示顺位');
assert.equal(
  (finalHtml.match(/class="standings-row/g) ?? []).length,
  4,
  '四人局应列出 4 名玩家',
);
assert.ok(finalHtml.includes('再来一局'), '终局页面应有再来一局');
assert.ok(!finalHtml.includes('最终结算'), '终局页面不应再有「最终结算」按钮');

const bestWin = finishedGame.bestWin;
if (bestWin !== null) {
  assert.ok(finalHtml.includes('本局大牌'), '终局页面应回顾整场最高的一手');
}

const ranks = [...finalHtml.matchAll(/standings-rank">(\d+) 位</g)].map((m) =>
  Number(m[1]),
);
assert.equal(ranks.length, 4, '应有 4 个顺位数字');
assert.equal(ranks[0], 1, '第一名顺位应为 1');
for (let index = 1; index < ranks.length; index += 1) {
  assert.ok(ranks[index] >= ranks[index - 1], '顺位应当随分数递减而不递增');
}

// ---- 10. 对局记录 ----
assert.ok(Array.isArray(finishedGame.history), '打完一整场应当有对局记录');
assert.equal(
  finishedGame.history.length,
  finishedGame.cfg.rounds,
  '每个本场都要留下一条记录（含流局）',
);

const historyHtml = strip(
  renderToString(
    React.createElement(HistoryDialog, {
      history: finishedGame.history,
      players: 4,
      onClose: noop,
    }),
  ),
);
assert.ok(historyHtml.includes('对局记录'), '记录面板应有标题');
for (const expected of ['第 1 局', '第 2 局']) {
  assert.ok(historyHtml.includes(expected), `记录面板应列出「${expected}」`);
}

const wonRecords = finishedGame.history.filter(
  (record) => record.entries.length > 0,
);
assert.ok(
  wonRecords.length > 0,
  '这批种子应当至少有一局和牌，才能验证记录内容',
);
for (const record of wonRecords) {
  const entry = record.entries[0];
  const labels = ['我', '下家', '对家', '上家'];
  assert.ok(
    labels.some((label) => historyHtml.includes(label)),
    '记录面板应出现玩家名',
  );
  assert.ok(entry.yaku.length > 0, '和牌记录里应当带上番种');
  assert.ok(
    historyHtml.includes(entry.yaku[0].name),
    `记录面板应显示番种「${entry.yaku[0].name}」`,
  );
}
if (wonRecords.some((record) => record.kind === 'ron')) {
  assert.ok(
    historyHtml.includes('·放铳'),
    '铳和记录里应把放铳者标成「XX·放铳」',
  );
  assert.ok(
    /\+-?\d+ \/ /.test(textOf(historyHtml)),
    '铳和记录应显示「+x / −y」',
  );
  assert.ok(
    historyHtml.indexOf('·放铳') > historyHtml.indexOf('result-hand'),
    '记录里的 tag 行应当排在和牌手牌下方',
  );
}
if (finishedGame.history.some((record) => record.kind === 'draw')) {
  assert.ok(historyHtml.includes('流局'), '流局的记录应当标出「流局」');
}

// 累计分：每局四家都要有「X → Y」，并按增减上色
assert.ok(historyHtml.includes('→'), '记录面板应展示累计分变化');
assert.equal(
  (historyHtml.match(/class="score-chip /g) ?? []).length,
  finishedGame.history.length * 4,
  '每局应有 4 个玩家的分数变化',
);
assert.ok(historyHtml.includes('delta-gain'), '得分的那一格应标绿');
const lossCells = finishedGame.history.some((record) =>
  record.scoresAfter.some(
    (value, seat) => value < (record.scoresBefore[seat] ?? 0),
  ),
);
if (lossCells) {
  assert.ok(
    historyHtml.includes('delta-loss-small') ||
      historyHtml.includes('delta-loss-big'),
    '失分的那一格应标淡黄或亮红',
  );
}

// ---- 12. 牌山剩余量的分档配色 ----
// drawIndex 往前推，让 wallRemaining 落在每一档的边界上
const wallCases = [
  [41, 'wall-high'],
  [32, 'wall-mid'],
  [16, 'wall-mid'],
  [15, 'wall-low'],
  [8, 'wall-low'],
  [7, 'wall-danger'],
  [1, 'wall-danger'],
];
for (const [remaining, expected] of wallCases) {
  const probe = { ...state, drawIndex: state.liveEnd - remaining };
  const probeHtml = strip(render(probe, []));
  assert.ok(
    probeHtml.includes(`class="center-wall ${expected}"`),
    `剩余 ${remaining} 张应当用 ${expected} 配色`,
  );
}
// ---- 11. 关上浏览器再打开，仍停在和牌结算 / 最终结算界面 ----
// 走一遍真实的存档往返：重开页面时 App 就是拿 decodeState 的结果渲染的
const restored = decodeState(encodeState(finishedGame));
assert.ok(restored !== null, '终局存档应当能还原');
const restoredHtml = strip(
  render(restored, core.legalActions(restored, 0), { canReplay: true }),
);
assert.ok(
  restoredHtml.includes('result-panel'),
  '还原存档后应当仍停在和牌结算面板',
);
if (finishedGame.result.kind === 'draw') {
  assert.ok(
    restoredHtml.includes('流局'),
    '最后一句是流局时，还原后标题应当仍是流局',
  );
} else {
  assert.ok(
    restoredHtml.includes('·自摸') || restoredHtml.includes('·铳和'),
    '还原后仍应显示和牌者',
  );
}
const restoredFinal = strip(
  render(restored, [], { canReplay: true, showFinal: true }),
);
assert.ok(
  restoredFinal.includes('终局'),
  '翻到最终结算页时，还原后也要还在那一页',
);

console.log(
  `SSR OK：开局 ${opening.length} 字，中局 ${mid.length} 字，结算 ${finished.length} 字，` +
    `三麻 ${threeHtml.length} 字，鸣牌 ${claimHtml.length} 字，摸牌 ${drawHtml.length} 字，` +
    `记录 ${historyHtml.length} 字`,
);

// ---------------------------------------------------------------- 加载界面
const loadingHtml = renderToString(
  React.createElement(LoadingScreen, {
    progress: { loaded: 12, total: 34, failed: [] },
  }),
);
assert.ok(
  loadingHtml.includes('loading-screen'),
  '加载界面应有 .loading-screen',
);
assert.ok(
  loadingHtml.includes('正在加载牌面素材'),
  '加载界面应提示正在加载素材',
);
assert.ok(
  loadingHtml.includes('aria-valuenow="35"'),
  `进度条应按 12/34 显示 35%，实际：${loadingHtml.slice(0, 200)}`,
);
assert.ok(
  textOf(loadingHtml).replace(/\s+/g, ' ').includes('12 / 34'),
  `加载界面应显示已加载数量，实际：${textOf(loadingHtml)}`,
);
console.log('SSR OK：加载界面渲染正常（进度 12/34 → 35%）');
