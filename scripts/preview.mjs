// 把 SSR 渲染的结果 + 样式表写成一个可以直接双击打开的静态页，
// 这样不需要起 Vite 也能检查方桌布局（素材路径改成了相对路径）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToString } = require('react-dom/server');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const appDir = join(root, 'packages', 'app');

const {
  GameView,
  HistoryDialog,
  PRESETS,
  SettingsDialog,
  StartScreen,
  TutorialDialog,
} = await import('../.ssr/packages/app/src/GameView.js');
const core = await import('../.ssr/packages/core/src/index.js');
const ai = await import('../.ssr/packages/core/src/ai/index.js');

const noop = () => {};

function render(state, legal = [], showFinal = false) {
  return renderToString(
    React.createElement(GameView, {
      state,
      legal,
      config: state.cfg,
      muted: true,
      canReplay: true,
      showFinal,
      onAction: noop,
      onRestart: noop,
      onPresetChange: noop,
      onOpenSettings: noop,
      onToggleMute: noop,
      onOpenReplay: noop,
      onShowFinal: noop,
    }),
  );
}

/** 找一个轮到我摸牌打牌的局面，用来展示"摸到的牌靠右" */
function playUntilMyTurn(cfg, seed, minRound = 0) {
  let current = core.createGame(cfg, seed);
  for (let step = 0; step < 6000; step += 1) {
    const thrown = current.discards.reduce(
      (sum, river) => sum + river.length,
      0,
    );
    if (
      current.round >= minRound &&
      current.phase === 'discard' &&
      current.actor === 0 &&
      current.drawnTile !== null &&
      thrown >= 10
    ) {
      return current;
    }
    if (current.phase === 'over') {
      if (current.finished) return current;
      current = core.reduce(current, { type: 'next-round' });
      continue;
    }
    const actor = current.actor;
    if (actor === null) break;
    const legal = core.legalActions(current, actor);
    if (legal.length === 0) break;
    current = core.reduce(current, ai.decide(core.observe(current, actor)));
  }
  return current;
}

/** 找一个有人和牌的局面，用来展示结算面板 */
function findWinState(cfg, seed) {
  let current = core.createGame(cfg, seed);
  for (let step = 0; step < 4000; step += 1) {
    if (current.phase === 'over') {
      if (current.result !== null && current.result.kind !== 'draw')
        return current;
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

/** 找有多种吃牌方案的局面，用来看「吃 13饼」这种按钮文本 */
function findMultiChi(cfg, seed) {
  let current = core.createGame(cfg, seed);
  for (let step = 0; step < 8000; step += 1) {
    if (current.phase === 'over') {
      if (current.finished) return null;
      current = core.reduce(current, { type: 'next-round' });
      continue;
    }
    const actor = current.actor;
    if (actor === null) return null;
    const legal = core.legalActions(current, actor);
    if (legal.length === 0) return null;
    if (
      actor === 0 &&
      legal.filter((action) => action.type === 'chi').length >= 2
    ) {
      return current;
    }
    current = core.reduce(current, ai.decide(core.observe(current, actor)));
  }
  return null;
}

/** 找我已鸣过 2 组以上、且轮到我打牌的局面，用来看自家副露的排版 */
function findMyMelds(cfg, seed) {
  let current = core.createGame(cfg, seed);
  for (let step = 0; step < 8000; step += 1) {
    if (
      current.phase === 'discard' &&
      current.actor === 0 &&
      current.drawnTile !== null &&
      current.melds[0].length >= 2
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

/**
 * 打完整局，用来出终局 / 最后一局 / 对局记录三个快照。
 * 按"演示价值"排序挑局面：最好同时满足
 *   ① 某一局是铳和（这样累计分才会出现失分的那一格）
 *   ② 最后一局有和牌且它就是整场最高（「最后一局」和「本局大牌」各显示一次）
 */
function findFinished(cfg, seed) {
  let best = null;
  let bestScore = -1;

  for (let offset = 0; offset < 60; offset += 1) {
    let current = core.createGame(cfg, seed + offset);
    for (let step = 0; step < 12000; step += 1) {
      if (current.finished) {
        const lastWin =
          current.result.kind !== 'draw' && current.result.entries.length > 0;
        const duplicated =
          lastWin &&
          current.bestWin !== null &&
          current.bestWin.round === current.round;
        // 要有真实失分（铳和但放铳失分为 0 的情况不算）
        const hasLoss = current.history.some((record) =>
          record.scoresAfter.some(
            (value, seat) => value < (record.scoresBefore[seat] ?? 0),
          ),
        );
        const score = (hasLoss ? 2 : 0) + (duplicated ? 1 : 0);
        if (score > bestScore) {
          best = current;
          bestScore = score;
        }
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
    if (bestScore === 3) break;
  }
  return best;
}

/** 找一个轮到我鸣牌的局面，用来展示按钮配色 */
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

const css = readFileSync(join(appDir, 'src', 'styles.css'), 'utf8');

function page(title, html) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
${css}
.snapshot-title { max-width: 1120px; margin: 18px auto 0; padding: 0 16px; font-size: 13px; color: #8aa596; }
</style>
</head>
<body>
<div class="snapshot-title">静态快照 · ${title}（素材走后端相对路径，直接双击打开即可）</div>
${html}
</body>
</html>
`;
}

const fourCfg = core.makeConfig({ rounds: 4 });
const myTurn = playUntilMyTurn(fourCfg, 20260101);
const midStates =
  myTurn.phase === 'discard'
    ? myTurn
    : play(core.createGame(fourCfg, 20260101), 26);
const threeCfg = core.makeConfig({
  players: 3,
  tileSet: 'sanma108',
  rounds: 3,
});
const threeStates = play(core.createGame(threeCfg, 271), 20);

// 快照放在 preview/ 子目录里，素材要向上找一层
const rewrite = (html) =>
  html.replaceAll('src="/tiles/', 'src="../public/tiles/');

mkdirSync(join(appDir, 'preview'), { recursive: true });
writeFileSync(
  join(appDir, 'preview', 'yonma.html'),
  page(
    '四人东风战 · 轮到我打牌',
    rewrite(render(midStates, core.legalActions(midStates, 0))),
  ),
);
writeFileSync(
  join(appDir, 'preview', 'sanma.html'),
  page('三人·有字 · 中局', rewrite(render(threeStates))),
);

const claimState = findMyClaim(fourCfg, 4242);
if (claimState !== null) {
  writeFileSync(
    join(appDir, 'preview', 'claim.html'),
    page(
      '轮到鸣牌 · 按钮配色',
      rewrite(render(claimState, core.legalActions(claimState, 0))),
    ),
  );
}

const winState = findWinState(fourCfg, 20260101);
if (winState !== null) {
  writeFileSync(
    join(appDir, 'preview', 'result.html'),
    page('和牌结算', rewrite(render(winState, core.legalActions(winState, 0)))),
  );
}

// 找一局"既有吃铳责的番种、又有不吃的"和牌，方便对比两种标签底色；
// 优先挑放铳失分 > 0 的，好顺带验证失分配色
let mixedWin = null;
let mixedFallback = null;
let largestPenalty = null;
let largestValue = 0;
for (let offset = 0; offset < 240; offset += 1) {
  const state = findWinState(fourCfg, 20260101 + offset);
  if (state === null) continue;
  const entry = state.result.entries[0];

  if (entry.penalty > largestValue) {
    largestValue = entry.penalty;
    largestPenalty = state;
  }

  const slot = entry.result.liabilitySlot;
  const liable = entry.result.hits.filter(
    (hit) =>
      entry.result.liability > 0 &&
      (hit.liability === 'always' ||
        (hit.liability === 'by-meld' && (hit.meldMask & slot) !== 0)),
  ).length;
  const plain = entry.result.hits.length - liable;
  if (liable === 0 || plain === 0) continue;
  if (entry.penalty > 0) {
    mixedWin = state;
    break;
  }
  if (mixedFallback === null) mixedFallback = state;
}

const liabilityState = mixedWin ?? mixedFallback;
if (liabilityState !== null) {
  writeFileSync(
    join(appDir, 'preview', 'liability.html'),
    page(
      '关联铳责番种',
      rewrite(render(liabilityState, core.legalActions(liabilityState, 0))),
    ),
  );
}

// 失分 > 0 的局面，用来看数字的配色分档
if (largestPenalty !== null && largestValue > 0) {
  writeFileSync(
    join(appDir, 'preview', 'penalty.html'),
    page(
      '放铳失分',
      rewrite(render(largestPenalty, core.legalActions(largestPenalty, 0))),
    ),
  );
}

writeFileSync(
  join(appDir, 'preview', 'start.html'),
  page(
    '开始界面',
    renderToString(
      React.createElement(StartScreen, {
        onStart: () => {},
        onTutorial: () => {},
      }),
    ),
  ),
);

writeFileSync(
  join(appDir, 'preview', 'tutorial.html'),
  page(
    '教程 · 规则与番种',
    rewrite(
      renderToString(
        React.createElement(TutorialDialog, { onClose: () => {} }),
      ),
    ),
  ),
);

writeFileSync(
  join(appDir, 'preview', 'settings.html'),
  page(
    '选项对话框',
    rewrite(
      renderToString(
        React.createElement(SettingsDialog, {
          preset: PRESETS[0],
          chi: false,
          keepDeadWall: false,
          duration: 'hanchan',
          dirty: false,
          confirming: false,
          onChangePreset: noop,
          onChangeChi: noop,
          onChangeDeadWall: noop,
          onChangeDuration: noop,
          onApply: noop,
          onCancel: noop,
          onConfirm: noop,
          onDismissConfirm: noop,
        }),
      ),
    ),
  ),
);

// 第 2 局开始庄家轮到下家，用来看侧家名牌上的"庄"是否跟着竖排
const rotatedState = playUntilMyTurn(fourCfg, 20260101, 1);
if (rotatedState.round >= 1) {
  writeFileSync(
    join(appDir, 'preview', 'rotation.html'),
    page(
      '侧家为庄 · 名牌旋转',
      rewrite(render(rotatedState, core.legalActions(rotatedState, 0))),
    ),
  );
}

const multiChi = findMultiChi(fourCfg, 20260101);
if (multiChi !== null) {
  writeFileSync(
    join(appDir, 'preview', 'chi.html'),
    page(
      '多种吃牌方案',
      rewrite(render(multiChi, core.legalActions(multiChi, 0))),
    ),
  );
}

const finishedState = findFinished(fourCfg, 20260101);
if (finishedState !== null) {
  // 第一页：最后一局的单局结算（按钮是「最终结算」）
  writeFileSync(
    join(appDir, 'preview', 'last-round.html'),
    page('最后一局结算', rewrite(render(finishedState, [], false))),
  );
  // 第二页：翻过去之后的终局顺位
  writeFileSync(
    join(appDir, 'preview', 'final.html'),
    page('终局顺位', rewrite(render(finishedState, [], true))),
  );
  // 对局记录面板
  writeFileSync(
    join(appDir, 'preview', 'history.html'),
    page(
      '对局记录',
      rewrite(
        renderToString(
          React.createElement(HistoryDialog, {
            history: finishedState.history,
            players: 4,
            onClose: noop,
          }),
        ),
      ),
    ),
  );
}

const meldState = findMyMelds(fourCfg, 20260101);
if (meldState !== null) {
  writeFileSync(
    join(appDir, 'preview', 'meld.html'),
    page(
      '自家两组副露',
      rewrite(render(meldState, core.legalActions(meldState, 0))),
    ),
  );
}

console.log(
  '已生成：packages/app/preview/ 下的 yonma / sanma / claim / chi / meld / result / liability / penalty / settings / rotation / last-round / final / history',
);
