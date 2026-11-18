import React from 'react';
import {
  KIND_COUNT,
  parseTiles,
  tileName,
  wallRemaining,
  windOf,
} from '../../core/src/index.ts';
import type { TileSetId } from '../../core/src/config.ts';
import { tileSrc } from './assets.ts';
import {
  countsForGate,
  RULE_INTRO,
  TUTORIAL_ITEMS,
  TUTORIAL_OVERVIEW,
  TUTORIAL_SECTIONS,
} from './tutorial.ts';
import { sidewaysIndex } from './meld.ts';
import { sortYakuByPoints, winTileIndex } from './hand.ts';
import { needsGlow, yakuColorOf } from './yaku-color.ts';
import { DURATIONS, durationOf, roundsOf } from './duration.ts';
import type { DurationId } from './duration.ts';
import type {
  Action,
  BestWinRecord,
  GameState,
  Meld,
  RoundRecord,
  RoundResult,
  RuleConfig,
  WinGroup,
} from '../../core/src/index.ts';

export const HUMAN = 0;

const WINDS = ['东', '南', '西', '北'];

/**
 * 固定称呼：按"离我的座次"取名，整局不变。
 * 风向每局会随庄家轮转而变，不适合当玩家名字。
 */
function playerName(seat: number, players: number): string {
  const offset = (seat - HUMAN + players) % players;
  if (offset === 0) return '我';
  if (offset === 1) return '下家';
  if (offset === 2) return players === 4 ? '对家' : '上家';
  return '上家';
}

/** 每个座位一个固定色号（CSS 里 .player-N 定义 --pc / --pc-dim / --pc-line） */
function playerClass(seat: number): string {
  return `player-${seat}`;
}

export interface ConfigPreset {
  readonly id: string;
  readonly label: string;
  readonly players: 3 | 4;
  readonly tileSet: TileSetId;
}

export const PRESETS: readonly ConfigPreset[] = [
  { id: '4p', label: '四人麻将', players: 4, tileSet: 'std136' },
  // 两种三人都用 108 张，差别在去掉哪一部分
  { id: '3p-noword', label: '三人·无字', players: 3, tileSet: 'sanma-noword' },
  { id: '3p-honor', label: '三人·有字', players: 3, tileSet: 'sanma108' },
];

/** 对局时长：圈数 × 人数 */
export { DURATIONS, durationOf, roundsOf };
export type { DurationId };

export function presetOf(cfg: RuleConfig): ConfigPreset {
  const found = PRESETS.find(
    (preset) =>
      preset.players === cfg.players && preset.tileSet === cfg.tileSet,
  );
  return found ?? PRESETS[0];
}

const CHI_SUITS = ['万', '饼', '索'];

/** 「吃 13饼」这种写法：两个点数 + 一个花色字 */
function chiText(tiles: readonly [number, number]): string {
  const suit = Math.floor(tiles[0] / 9);
  const ranks = [...tiles]
    .sort((a, b) => a - b)
    .map((tile) => (tile % 9) + 1)
    .join('');
  return `${ranks}${CHI_SUITS[suit] ?? '万'}`;
}

/** 按钮文本：和 / 吃 / 碰 / 杠 / 过；吃有多种方案时把方案写进去 */
function actionButtonLabel(action: Action, chiCount: number): string {
  switch (action.type) {
    case 'tsumo':
    case 'ron':
      return '和';
    case 'chi':
      return chiCount > 1 ? `吃 ${chiText(action.tiles)}` : '吃';
    case 'pon':
      return '碰';
    case 'kan':
    case 'ankan':
    case 'kakan':
      return '杠';
    case 'pass':
      return '过';
    default:
      return '';
  }
}

function resultTitle(kind: RoundResult['kind']): string {
  if (kind === 'tsumo') return '自摸';
  if (kind === 'ron') return '铳和';
  return '流局';
}

/** 按钮配色：和牌淡桔色 / 吃碰杠淡黄 / 过白色 */
function buttonClass(action: Action): string {
  if (action.type === 'tsumo' || action.type === 'ron') return 'btn-win';
  if (action.type === 'pass') return 'btn-pass';
  return 'btn-call';
}

/** 按钮顺序：和 → 吃 → 碰 → 杠 → 过 */
const ACTION_ORDER: Readonly<Record<Action['type'], number>> = {
  tsumo: 0,
  ron: 0,
  chi: 1,
  pon: 2,
  kan: 3,
  ankan: 3,
  kakan: 3,
  pass: 4,
  discard: 5,
  'next-round': 6,
};

interface TileProps {
  readonly kind: number;
  readonly small?: boolean;
  readonly large?: boolean;
  readonly highlight?: boolean;
  /** 刚摸到的那张：靠右单独隔开 */
  readonly drawn?: boolean;
  /** 牌河里最近打出的一张：高亮 */
  readonly last?: boolean;
  /** 摸切（刚摸到就打出）：加一层轻微阴影区分手切 */
  readonly tsumogiri?: boolean;
  /** 横置：副露里表示「从谁那里鸣的」 */
  readonly sideways?: boolean;
  readonly onClick?: () => void;
}

function Tile({
  kind,
  small = false,
  large = false,
  highlight = false,
  drawn = false,
  last = false,
  tsumogiri = false,
  sideways = false,
  onClick,
}: TileProps) {
  const classes = ['tile'];
  if (small) classes.push('tile-small');
  if (large) classes.push('tile-large');
  if (highlight) classes.push('tile-highlight');
  if (drawn) classes.push('tile-drawn');
  if (last) classes.push('tile-last');
  if (tsumogiri) classes.push('tile-tsumogiri');
  if (sideways) classes.push('tile-sideways');
  if (onClick) classes.push('tile-clickable');

  return (
    <div className={classes.join(' ')} onClick={onClick} title={tileName(kind)}>
      <img src={tileSrc(kind)} alt={tileName(kind)} draggable={false} />
    </div>
  );
}

/** 牌背：天凤里对手的手牌是可见张数的牌背。背面没有方向性，所以不旋转也正确。 */
function TileBack() {
  return <div className="tile tile-back" aria-hidden="true" />;
}

/**
 * 副露。上家/下家的副露按我的视角转 90°，外面套一个"宽高互换"的占位盒，
 * 把旋转后的元素绝对定位居中——CSS 旋转不改变布局尺寸，必须由外层盒把位置占掉。
 */

function MeldView({
  meld,
  seat,
  players,
  rotated,
}: {
  readonly meld: Meld;
  readonly seat: number;
  readonly players: number;
  readonly rotated: boolean;
}) {
  const sideways = sidewaysIndex(meld, seat, players);
  // 横置牌横着占 1.3326 张牌的宽度，外层旋转占位盒要按「总跨度」算高度
  const span = meld.tiles.length + (sideways >= 0 ? 0.3326 : 0);

  // 暗杠也把 4 张全部亮出（只是不横置），便于观察牌型
  const tiles = meld.tiles.map((tile, index) => (
    <Tile
      key={`${meld.kind}-${index}`}
      kind={tile}
      small
      sideways={index === sideways}
    />
  ));

  if (!rotated) return <div className="meld">{tiles}</div>;

  return (
    <div className="meld-rot" style={{ '--n': span } as React.CSSProperties}>
      <div className="meld meld-inner">{tiles}</div>
    </div>
  );
}

function handTiles(state: GameState, seat: number): number[] {
  const tiles: number[] = [];
  const counts = state.hands[seat];
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    for (let copy = 0; copy < counts[kind]; copy += 1) tiles.push(kind);
  }
  return tiles;
}

function handCount(state: GameState, seat: number): number {
  const counts = state.hands[seat];
  let total = 0;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) total += counts[kind];
  return total;
}

/**
 * 和牌者亮出来的手牌：摘掉和牌张，返回暗牌。
 * 只有自摸时那张牌才在手里；荣和时手里本来就是 13 张、和牌张来自别人，
 * 这时候如果也去删一张，会把手里同种牌误删掉（少一张牌的 bug）。
 */
function revealedHand(
  state: GameState,
  seat: number,
  winTile: number,
  isTsumo: boolean,
): number[] {
  const tiles = handTiles(state, seat);
  if (isTsumo) {
    const at = tiles.lastIndexOf(winTile);
    if (at >= 0) tiles.splice(at, 1);
  }
  return tiles;
}

/** 分数/失分配色：正绿、-1~-3 淡黄、≤-4 亮红、0 白 */
function deltaClass(value: number): string {
  if (value > 0) return 'delta-gain';
  if (value < 0)
    return Math.abs(value) >= 4 ? 'delta-loss-big' : 'delta-loss-small';
  return 'delta-flat';
}
/** 失分配色：与分数变化共用一套（0 白、1~3 淡黄、≥4 亮红） */
function penaltyClass(value: number): string {
  return deltaClass(-Math.max(0, value));
}

/** 牌山剩余量的警示等级：>32 绿 / 16~32 淡黄 / 8~15 桔 / <8 红 */
function wallLevel(remaining: number): string {
  if (remaining > 32) return 'wall-high';
  if (remaining >= 16) return 'wall-mid';
  if (remaining >= 8) return 'wall-low';
  return 'wall-danger';
}
/** 终局顺位：同分并列（1, 1, 3 …） */
function standingsOf(
  scores: readonly number[],
): { seat: number; score: number; rank: number }[] {
  const order = scores
    .map((score, seat) => ({ seat, score }))
    .sort((a, b) => b.score - a.score);

  let rank = 0;
  let previous: number | null = null;
  return order.map((row, index) => {
    if (previous === null || row.score !== previous) {
      rank = index + 1;
      previous = row.score;
    }
    return { seat: row.seat, score: row.score, rank };
  });
}

/** 按面子分组渲染整副和牌，并高亮和牌张 */
function GroupedHand({
  groups,
  winTile,
}: {
  readonly groups: readonly WinGroup[];
  readonly winTile: number;
}) {
  const winAt = winTileIndex(groups, winTile);

  let cursor = 0;
  return (
    <div className="result-hand">
      {groups.map((group, groupIndex) => {
        const start = cursor;
        cursor += group.tiles.length;
        return (
          <div
            className={`result-group${group.melded ? ' melded' : ''}`}
            key={`g-${groupIndex}`}
          >
            {group.tiles.map((kind, tileIndex) => (
              <Tile
                key={`t-${start + tileIndex}`}
                kind={kind}
                {...(start + tileIndex === winAt ? { highlight: true } : {})}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

type Side = 'top' | 'left' | 'right' | 'bottom';

/** 庄 / 行动中：挂在玩家名牌的外侧，尺寸约名牌的 2/3 */
function MarksOf({
  seat,
  state,
}: {
  readonly seat: number;
  readonly state: GameState;
}) {
  const dealer = state.dealer === seat;
  const acting = state.actor === seat && state.phase !== 'over';
  if (!dealer && !acting) return null;

  return (
    <span className="ci-marks">
      {dealer && <em className="mark-dealer">庄</em>}
      {acting && <em className="mark-active">行动中</em>}
    </span>
  );
}

/** 牌河：`wrap-reverse` 让第一行贴着玩家，上面再叠下一行；整块按座位旋转。 */
function River({
  tiles,
  tsumogiri,
  side,
  last,
}: {
  readonly tiles: readonly number[];
  /** 与 tiles 等长：true = 摸切 */
  readonly tsumogiri: readonly boolean[];
  readonly side: Side;
  readonly last: number | null;
}) {
  return (
    <div className={`river-slot slot-${side}`}>
      <div className="river">
        {tiles.map((kind, index) => (
          <Tile
            key={`${side}-${index}`}
            kind={kind}
            last={last !== null && index === tiles.length - 1 && kind === last}
            tsumogiri={tsumogiri[index] === true}
          />
        ))}
      </div>
    </div>
  );
}

interface SeatPanelProps {
  readonly state: GameState;
  readonly seat: number;
  readonly side: Exclude<Side, 'bottom'>;
  /** 和牌后亮出该家的手牌 */
  readonly revealed: {
    readonly tiles: readonly number[];
    readonly winTile: number;
  } | null;
}

function SeatPanel({ state, seat, side, revealed }: SeatPanelProps) {
  const rotated = side === 'left' || side === 'right';
  const backs = handCount(state, seat);
  const backsClass = `hand-backs hand-backs-${side}`;

  return (
    <div className={`seat seat-${side}`} data-seat={seat}>
      {/*
        对家的副露整组转 180°：他们的左端在屏幕上就是右端。
        牌河对家也是 rotate(180deg) 的，两边必须一致，否则「横置牌表示从谁鸣的」
        这个信息在对家身上就是镜像反的。
      */}
      <div
        className={`melds melds-opp ${rotated ? 'melds-side' : ''} ${
          side === 'top' ? 'melds-flip' : ''
        }`}
      >
        {state.melds[seat].map((meld, index) => (
          <MeldView
            key={`m-${seat}-${index}`}
            meld={meld}
            seat={seat}
            players={state.cfg.players}
            rotated={rotated}
          />
        ))}
      </div>

      {revealed !== null ? (
        <div className={`${backsClass} hand-revealed`}>
          {revealed.tiles.map((kind, index) =>
            rotated ? (
              <div className="tile-rot-box" key={`rv-${seat}-${index}`}>
                <Tile kind={kind} small />
              </div>
            ) : (
              <Tile key={`rv-${seat}-${index}`} kind={kind} small />
            ),
          )}
          {rotated ? (
            <div className="tile-rot-box">
              <Tile kind={revealed.winTile} small highlight />
            </div>
          ) : (
            <Tile kind={revealed.winTile} small highlight />
          )}
        </div>
      ) : (
        <div className={backsClass}>
          {Array.from({ length: backs }, (_, index) => (
            <TileBack key={`b-${seat}-${index}`} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface SettingsDialogProps {
  readonly preset: ConfigPreset;
  readonly keepDeadWall: boolean;
  readonly duration: DurationId;
  /** 三人麻将是否允许吃牌；四人麻将恒为 true，不可选 */
  readonly chi: boolean;
  readonly dirty: boolean;
  readonly confirming: boolean;
  readonly onChangePreset: (preset: ConfigPreset) => void;
  readonly onChangeDeadWall: (value: boolean) => void;
  readonly onChangeDuration: (duration: DurationId) => void;
  readonly onChangeChi: (value: boolean) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onDismissConfirm: () => void;
}

/**
 * 和牌行首：`和牌者·自摸/铳和`，铳和时再跟一个 `← 放铳者·放铳`（淡色 tag），
 * 右侧是 `+和牌分`，铳和时补上 `/ 放铳失分`。
 */
function ResultHead({
  seat,
  kind,
  gain,
  penalty,
  discarder,
  players,
}: {
  readonly seat: number;
  readonly kind: RoundResult['kind'];
  readonly gain: number;
  readonly penalty: number;
  readonly discarder: number | null;
  readonly players: number;
}) {
  return (
    <div className="result-head">
      <span className={`result-seat ${playerClass(seat)}`}>
        {playerName(seat, players)}·{kind === 'tsumo' ? '自摸' : '铳和'}
      </span>

      {discarder !== null && (
        <>
          <span className="result-arrow">←</span>
          <span className={`result-discarder ${playerClass(discarder)}`}>
            {playerName(discarder, players)}·放铳
          </span>
        </>
      )}

      <span className="result-gain">
        <b className="delta-gain">+{gain}</b>
        {discarder !== null && (
          <b className={penaltyClass(penalty)}>
            {' '}
            / {penalty > 0 ? `−${penalty}` : '0'}
          </b>
        )}
      </span>
    </div>
  );
}

/** 四家分数：`玩家 A → B`，B 按增减上色。结算面板和对局记录共用。 */
function ScoreChanges({
  before,
  after,
  players,
}: {
  readonly before: readonly number[];
  readonly after: readonly number[];
  readonly players: number;
}) {
  return (
    <div className="score-changes">
      {after.map((value, seat) => {
        const from = before[seat] ?? 0;
        return (
          <span
            className={`score-chip ${playerClass(seat)}`}
            key={`score-${seat}`}
          >
            <span className="score-name">{playerName(seat, players)}</span>
            <b className="delta-flat">{from}</b>
            <span className="score-arrow">→</span>
            <b className={deltaClass(value - from)}>{value}</b>
          </span>
        );
      })}
    </div>
  );
}

/** 对局记录：每局谁和了什么牌、得多少分、放铳者失多少分。 */
export function HistoryDialog({
  history,
  players,
  onClose,
}: {
  readonly history: readonly RoundRecord[];
  readonly players: number;
  readonly onClose: () => void;
}) {
  return (
    <div className="overlay">
      <div className="panel history-panel">
        <h2>对局记录</h2>

        {history.length === 0 ? (
          <p className="history-empty">还没有打完的局。</p>
        ) : (
          <div className="history-list">
            {history.map((record) => (
              <div className="history-block" key={`round-${record.round}`}>
                <div className="history-head">
                  <span className="history-round">
                    第 {record.round + 1} 局
                  </span>
                  {record.entries.length === 0 && (
                    <span className="history-draw">流局</span>
                  )}
                </div>

                <ScoreChanges
                  before={record.scoresBefore}
                  after={record.scoresAfter}
                  players={players}
                />

                {record.entries.map((entry) => (
                  <div
                    className="history-entry"
                    key={`entry-${record.round}-${entry.seat}`}
                  >
                    <GroupedHand
                      groups={entry.groups}
                      winTile={entry.winTile}
                    />

                    <ResultHead
                      seat={entry.seat}
                      kind={record.kind}
                      gain={entry.gain}
                      penalty={entry.penalty}
                      discarder={entry.discarder}
                      players={players}
                    />

                    <div className="history-line">
                      <div className="result-yaku">
                        {sortYakuByPoints(entry.yaku).map((hit, index) => (
                          <span
                            className={`yaku-chip${needsGlow(hit.points) ? ' yaku-chip-glow' : ''}`}
                            key={`y-${record.round}-${entry.seat}-${index}`}
                            style={
                              {
                                '--yaku': yakuColorOf(hit.points),
                              } as React.CSSProperties
                            }
                          >
                            {hit.liable && (
                              <span
                                className="liability-dot"
                                aria-label="关联铳责"
                              />
                            )}
                            {hit.name}
                            <b>{hit.points}</b>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="panel-actions">
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/** 把 `**xx**` 渲染成加粗，其余原样输出。教程正文里只有这一种标记。 */
/** 开始界面：标题 + 副标题 + 开始 / 教程。 */
export function StartScreen({
  onStart,
  onTutorial,
}: {
  readonly onStart: () => void;
  readonly onTutorial: () => void;
}) {
  return (
    <div className="start-screen">
      <div className="start-inner">
        <h1 className="start-title">铜雀</h1>
        <p className="start-subtitle">简洁明快的竞技 &amp; 娱乐麻将</p>
        <div className="start-actions">
          <button type="button" className="start-btn primary" onClick={onStart}>
            开始
          </button>
          <button type="button" className="start-btn" onClick={onTutorial}>
            教程
          </button>
        </div>
      </div>
    </div>
  );
}
/** 选项说明角标：悬停用 data-tip 出解释，圈里一个 i 由 SVG 画 */
function InfoBadge({ tip }: { readonly tip: string }) {
  return (
    <span className="info-badge">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="6.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <circle cx="8" cy="5" r="0.95" fill="currentColor" />
        <rect
          x="7.25"
          y="6.9"
          width="1.5"
          height="5"
          rx="0.75"
          fill="currentColor"
        />
      </svg>
      {/* 气泡用真实 DOM 渲染而不是 CSS attr()：attr() 取到的文本无法换行 */}
      <span className="info-tip">{renderText(tip)}</span>
    </span>
  );
}
/** 「不计入 2 番起和」这类关键限制，渲染时自动加粗，不用在文案里加标记 */
const HIGHLIGHT_PATTERN = /(不计入\s*2\s*番起和)/;

/**
 * 把 `**xx**` 渲染成加粗，并把「不计入 2 番起和」高亮。
 *
 * 匹配靠正则，这样正文保持纯文本：
 * 改了措辞只要还写着「不计入 2 番起和」就会自动生效。
 */
function withEmphasis(text: string): React.ReactNode {
  const segments = text.split(HIGHLIGHT_PATTERN);
  return segments.map((segment, segmentIndex) => {
    if (segmentIndex % 2 === 1) {
      return (
        <span className="tut-hl" key={`hl-${segmentIndex}`}>
          {segment}
        </span>
      );
    }
    return segment
      .split('**')
      .map((part, index) =>
        index % 2 === 1 ? (
          <b key={`em-${segmentIndex}-${index}`}>{part}</b>
        ) : (
          <React.Fragment key={`tx-${segmentIndex}-${index}`}>
            {part}
          </React.Fragment>
        ),
      );
  });
}

/** 正文渲染：`\n` 换行、`**xx**` 加粗、关键限制高亮 */
function renderText(text: string): React.ReactNode {
  return text.split('\n').map((line, index) => (
    <React.Fragment key={`ln-${index}`}>
      {index > 0 && <br />}
      {withEmphasis(line)}
    </React.Fragment>
  ));
}

/** 一组牌例：每种牌一张小牌，组与组之间留空 */
function ExampleTiles({
  groups,
  seed,
}: {
  readonly groups: readonly string[];
  readonly seed: string;
}) {
  return (
    <div className="tut-example">
      {groups.map((group, groupIndex) => (
        <span className="tut-group" key={`${seed}-g${groupIndex}`}>
          {parseTiles(group).map((tile, tileIndex) => (
            <Tile
              key={`${seed}-g${groupIndex}-t${tileIndex}`}
              kind={tile}
              small
            />
          ))}
        </span>
      ))}
    </div>
  );
}

/** 教程对话框：「铜雀」规则速览 + 完整番种表（每种都带牌例）。 */
export function TutorialDialog({ onClose }: { readonly onClose: () => void }) {
  return (
    <div className="overlay">
      <div className="panel tutorial-panel">
        <h2>铜雀 · 规则与番种</h2>

        <div className="tutorial-scroll">
          {RULE_INTRO.map((block) => (
            <section className="tutorial-block" key={block.title}>
              <h3>{block.title}</h3>
              <ul className="tutorial-list">
                {block.lines.map((line) => (
                  <li key={line}>{withEmphasis(line)}</li>
                ))}
              </ul>
            </section>
          ))}

          <h3 className="tutorial-table-title">
            完整番种表 · 共 {TUTORIAL_ITEMS.length} 种
          </h3>

          {/* 开头先给一张按分值从小到大排的一览表，当索引用 */}
          <table className="tut-overview">
            <tbody>
              {TUTORIAL_OVERVIEW.map((row) => (
                <tr key={`overview-${row.points}`}>
                  <td
                    className="tut-overview-points"
                    style={
                      {
                        '--yaku': yakuColorOf(row.points),
                      } as React.CSSProperties
                    }
                  >
                    {row.points}
                  </td>
                  <td className="tut-overview-names">
                    {row.items.map((item) => (
                      <span
                        className={`tut-tag${countsForGate(item) ? '' : ' tut-tag-muted'}${
                          needsGlow(item.points) ? ' tut-tag-glow' : ''
                        }`}
                        key={`overview-${item.key}`}
                        title={
                          countsForGate(item) ? undefined : '不计入 2 番起和'
                        }
                        style={
                          {
                            '--yaku': yakuColorOf(item.points),
                          } as React.CSSProperties
                        }
                      >
                        {item.name}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {TUTORIAL_SECTIONS.map((section) => (
            <section className="tutorial-block" key={section.title}>
              <h4>{section.title}</h4>
              {section.items.map((item) => (
                <div className="tut-yaku" key={item.key}>
                  <div className="tut-yaku-head">
                    <span className="tut-name">{item.name}</span>
                    <span
                      className="tut-points"
                      style={
                        {
                          '--yaku': yakuColorOf(item.points),
                        } as React.CSSProperties
                      }
                    >
                      {item.points} 分
                    </span>
                    <span className={`tut-kind tut-kind-${item.kind}`}>
                      {item.kind}
                    </span>
                  </div>
                  <p className="tut-desc">{renderText(item.description)}</p>
                  {item.examples.map((example, index) => (
                    <div
                      className="tut-example-block"
                      key={`${item.key}-ex${index}`}
                    >
                      <p className="tut-example-label">
                        牌例{item.examples.length > 1 ? ` ${index + 1}` : ''}：
                        {example.scoring}
                      </p>
                      <ExampleTiles
                        groups={example.groups}
                        seed={`${item.key}-${index}`}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="panel-actions">
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/** 选项对话框：纯展示，草稿值和"是否在二次确认"都由外部持有。 */
export function SettingsDialog({
  preset,
  keepDeadWall,
  duration,
  chi,
  dirty,
  confirming,
  onChangePreset,
  onChangeDeadWall,
  onChangeDuration,
  onChangeChi,
  onApply,
  onCancel,
  onConfirm,
  onDismissConfirm,
}: SettingsDialogProps) {
  // 四人麻将强制吃牌：按钮置灰并恒亮「允许」，不让玩家选
  const chiForced = preset.players === 4;
  const chiActive = chiForced ? true : chi;

  return (
    <div className="overlay">
      <div className="panel settings-panel">
        <h2>选项</h2>

        <div className="settings-row">
          <span className="settings-label">
            对局模式
            <InfoBadge
              tip={
                '四人麻将：136 张，可以吃牌。\n三人·无字：108 张，去掉全部字牌。\n三人·有字：108 张，去掉二至八万。'
              }
            />
          </span>
          <div className="seg">
            {PRESETS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`seg-btn${preset.id === item.id ? ' on' : ''}`}
                onClick={() => onChangePreset(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">
            对局时长
            <InfoBadge
              tip={
                '东风战：1 圈 —— 三人 3 局，四人 4 局。\n半庄战：2 圈 —— 三人 6 局，四人 8 局。\n全庄战：四人 4 圈共 16 局；三人 3 圈共 9 局。'
              }
            />
          </span>
          <div className="seg">
            {DURATIONS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`seg-btn${duration === item.id ? ' on' : ''}`}
                onClick={() => onChangeDuration(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">
            使用王牌
            {/*
              角标：悬停解释王牌的来历与作用。
              内容放在 data-tip 里，纯 CSS 出提示，不需要额外的浮层组件。
            */}
            <InfoBadge tip="“王牌”指牌山末尾保留的，不用于摸牌，仅用于杠后补牌的 14 张。" />
          </span>
          <div className="seg">
            {[false, true].map((item) => (
              <button
                type="button"
                key={String(item)}
                className={`seg-btn${keepDeadWall === item ? ' on' : ''}`}
                onClick={() => onChangeDeadWall(item)}
              >
                {item ? '使用' : '不使用'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">允许吃牌</span>
          <div className="seg">
            {[false, true].map((item) => (
              <button
                type="button"
                key={String(item)}
                className={`seg-btn${chiActive === item ? ' on' : ''}`}
                disabled={chiForced}
                onClick={() => onChangeChi(item)}
              >
                {item ? '允许' : '禁止'}
              </button>
            ))}
          </div>
        </div>

        {confirming ? (
          <>
            <p className="settings-warn">应用更改并重置当前对局？</p>
            <div className="panel-actions">
              <button
                type="button"
                className="ghost"
                onClick={onDismissConfirm}
              >
                取消
              </button>
              <button type="button" onClick={onConfirm}>
                确定应用
              </button>
            </div>
          </>
        ) : (
          <div className="panel-actions">
            <button type="button" className="ghost" onClick={onCancel}>
              关闭
            </button>
            <button type="button" onClick={onApply} disabled={!dirty}>
              应用
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 终局回顾：整场分值最高的那一手 */
function BestWinView({
  record,
  players,
}: {
  readonly record: BestWinRecord;
  readonly players: number;
}) {
  return (
    <div className="result-entry">
      <div className="result-head">
        <span className={`result-seat ${playerClass(record.seat)}`}>
          {playerName(record.seat, players)}
        </span>
        <span className="result-tag">
          第 {record.round + 1} 局 · {record.kind === 'tsumo' ? '自摸' : '铳和'}
        </span>
        <span className="result-gain">+{record.gain}</span>
      </div>

      <GroupedHand groups={record.groups} winTile={record.winTile} />

      <div className="result-line">
        <span className="result-label">番种</span>
        <div className="result-yaku">
          {sortYakuByPoints(record.yaku).map((hit, index) => (
            <span
              className={`yaku-chip${needsGlow(hit.points) ? ' yaku-chip-glow' : ''}`}
              key={`by-${index}`}
              style={
                { '--yaku': yakuColorOf(hit.points) } as React.CSSProperties
              }
            >
              {hit.liable && (
                <span className="liability-dot" aria-label="关联铳责" />
              )}
              {hit.name}
              <b>{hit.points}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="result-total">
        <span>
          合计 <b>{record.rawSum}</b> 番 → 和牌分 <b>{record.gain}</b>
        </span>
      </div>
    </div>
  );
}

export interface GameViewProps {
  readonly state: GameState;
  readonly legal: readonly Action[];
  readonly config: RuleConfig;
  readonly muted: boolean;
  readonly canReplay: boolean;
  readonly readOnly?: boolean;
  /** 全部局数打完后是否已经翻到「最终结算」那一页 */
  readonly showFinal?: boolean;
  readonly onShowFinal: () => void;
  readonly onAction: (action: Action) => void;
  readonly onRestart: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenTutorial: () => void;
  readonly onOpenHistory: () => void;
  readonly onToggleMute: () => void;
  readonly onOpenReplay: () => void;
}

/** 纯展示组件：不含状态机与副作用，方便单独渲染与测试。 */
export function GameView({
  state,
  legal,
  config,
  muted,
  canReplay,
  readOnly = false,
  showFinal = false,
  onAction,
  onRestart,
  onOpenSettings,
  onOpenTutorial,
  onOpenHistory,
  onToggleMute,
  onOpenReplay,
  onShowFinal,
}: GameViewProps) {
  const players = config.players;
  const sorted = handTiles(state, HUMAN);
  const canDiscard =
    !readOnly && state.phase === 'discard' && state.actor === HUMAN;

  // 摸到的那张从手牌里摘出来，永远排在最右边并隔开；打掉之后手牌自动恢复排序。
  // 只在"轮到我打牌"时成立——鸣牌窗口里手牌是 13 张，没有摸牌。
  const drawn =
    state.phase === 'discard' &&
    state.actor === HUMAN &&
    state.drawnTile !== null
      ? state.drawnTile
      : null;
  let rest = sorted;
  if (drawn !== null) {
    const at = sorted.lastIndexOf(drawn);
    if (at >= 0) rest = [...sorted.slice(0, at), ...sorted.slice(at + 1)];
  }

  const buttonActions = readOnly
    ? []
    : legal
        .filter((action) => action.type !== 'discard')
        .sort((a, b) => ACTION_ORDER[a.type] - ACTION_ORDER[b.type]);
  const chiCount = buttonActions.filter(
    (action) => action.type === 'chi',
  ).length;

  // 逆时针：自己在下、下家在右、对家在上、上家在左；三麻没有对家
  const rightSeat = (HUMAN + 1) % players;
  const topSeat = players === 4 ? (HUMAN + 2) % players : null;
  const leftSeat =
    players === 4 ? (HUMAN + 3) % players : (HUMAN + 2) % players;

  // 玩法提示就不写了（电子麻将的交互是常识）；只保留"当前是回放"这一个状态提示
  const hint = readOnly ? '回放中…' : '';

  const preset = presetOf(config);
  const roundLabel = `${WINDS[windOf(state, state.dealer)]}${(state.round % players) + 1}局`;

  // 最近一张舍牌：引擎只在鸣牌窗口里保留 lastDiscard，平时要靠"上一家牌河的末尾"推出来，
  // 这样任何时刻都能看到刚打出的那张牌。
  const lastDiscard = state.lastDiscard;
  const recentFrom =
    lastDiscard !== null
      ? lastDiscard.from
      : state.actor !== null
        ? (state.actor - 1 + players) % players
        : null;
  const lastOf = (seat: number): number | null => {
    if (seat !== recentFrom) return null;
    const river = state.discards[seat];
    return river.length > 0 ? river[river.length - 1] : null;
  };

  // 和牌后：把和牌者的手牌亮出来（座位面板 + 结算面板都要用）
  // 终局分两页：先看本局结算，点「最终结算」再翻到顺位页
  const finalView = state.phase === 'over' && state.finished && showFinal;
  const result = state.phase === 'over' ? state.result : null;
  // 本局的记录（含结算前后的累计分），用于底部「A → B」的分数变化
  const lastRecord =
    state.history.length > 0 ? state.history[state.history.length - 1] : null;
  const currentRecord =
    lastRecord !== null && lastRecord.round === state.round ? lastRecord : null;
  const winnerInfo = new Map<number, { tiles: number[]; winTile: number }>();
  if (result !== null) {
    for (const entry of result.entries) {
      winnerInfo.set(entry.seat, {
        tiles: revealedHand(
          state,
          entry.seat,
          entry.winTile,
          result.kind === 'tsumo',
        ),
        winTile: entry.winTile,
      });
    }
  }

  // 四家名牌：玩家名 + 分数，挂在中央框外侧
  const scoreOf = (seat: number) => (
    <>
      <span
        className={`ci-chip ${playerClass(seat)}`}
        title={`${playerName(seat, players)}（${WINDS[windOf(state, seat)]}家）`}
      >
        {playerName(seat, players)}：{state.scores[seat]}
      </span>
      <MarksOf seat={seat} state={state} />
    </>
  );

  /** 门风大字（半透明），四边各一个 */
  const windMark = (seat: number | null) =>
    seat === null ? null : (
      <span className="ci-wind-char">{WINDS[windOf(state, seat)]}</span>
    );

  return (
    <div className="app">
      <header className="topbar">
        <span className="round">
          第 {state.round + 1} / {config.rounds} 局
        </span>
        <span className="muted">庄家 {WINDS[windOf(state, state.dealer)]}</span>
        <span className="spacer" />
        <span className="preset-label">{preset.label}</span>

        <button
          type="button"
          className="ghost"
          onClick={onOpenHistory}
          title="对局记录"
        >
          记录
        </button>
        <button
          type="button"
          className="ghost"
          onClick={onOpenTutorial}
          title="规则与番种"
        >
          教程
        </button>
        <button
          type="button"
          className="ghost"
          onClick={onOpenSettings}
          title="选项"
        >
          ⚙
        </button>
        <button
          type="button"
          className="ghost"
          onClick={onToggleMute}
          title="音效开关"
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={onRestart}
          disabled={readOnly}
        >
          重开
        </button>
      </header>

      <div className="table-wrap">
        <div className={`board${players === 4 ? '' : ' board-three'}`}>
          {topSeat !== null && (
            <SeatPanel
              state={state}
              seat={topSeat}
              side="top"
              revealed={winnerInfo.get(topSeat) ?? null}
            />
          )}
          <SeatPanel
            state={state}
            seat={leftSeat}
            side="left"
            revealed={winnerInfo.get(leftSeat) ?? null}
          />
          <SeatPanel
            state={state}
            seat={rightSeat}
            side="right"
            revealed={winnerInfo.get(rightSeat) ?? null}
          />

          <div className="arena">
            {topSeat !== null && (
              <River
                tiles={state.discards[topSeat]}
                tsumogiri={state.tsumogiri[topSeat]}
                side="top"
                last={lastOf(topSeat)}
              />
            )}
            <River
              tiles={state.discards[leftSeat]}
              tsumogiri={state.tsumogiri[leftSeat]}
              side="left"
              last={lastOf(leftSeat)}
            />
            <River
              tiles={state.discards[rightSeat]}
              tsumogiri={state.tsumogiri[rightSeat]}
              side="right"
              last={lastOf(rightSeat)}
            />
            <River
              tiles={state.discards[HUMAN]}
              tsumogiri={state.tsumogiri[HUMAN]}
              side="bottom"
              last={lastOf(HUMAN)}
            />

            <div className="arena-info">
              {topSeat !== null ? (
                <span className="ci-slot ci-top">{scoreOf(topSeat)}</span>
              ) : null}
              <span className="ci-slot ci-left">{scoreOf(leftSeat)}</span>
              <span className="ci-slot ci-right">{scoreOf(rightSeat)}</span>
              <span className="ci-slot ci-bottom">{scoreOf(HUMAN)}</span>

              <div className="ci-frame">
                <span className="ci-wind ci-wtop">{windMark(topSeat)}</span>
                <span className="ci-wind ci-wleft">{windMark(leftSeat)}</span>
                <div className="ci-center">
                  <span className="center-round">{roundLabel}</span>
                  <span
                    className={`center-wall ${wallLevel(wallRemaining(state))}`}
                  >
                    剩余 {wallRemaining(state)}
                  </span>
                </div>
                <span className="ci-wind ci-wright">{windMark(rightSeat)}</span>
                <span className="ci-wind ci-wbot">{windMark(HUMAN)}</span>
              </div>
            </div>

            <div className="actions">
              {buttonActions.map((action, index) => (
                <button
                  type="button"
                  className={buttonClass(action)}
                  key={`a-${index}`}
                  onClick={() => onAction(action)}
                >
                  {actionButtonLabel(action, chiCount)}
                </button>
              ))}
            </div>
          </div>

          <div className="seat seat-self" data-seat={HUMAN}>
            <div className="seat-head">
              {buttonActions.length === 0 && hint !== '' && (
                <span className="hint">{hint}</span>
              )}
            </div>

            <div className="self-row">
              <div className="melds">
                {state.melds[HUMAN].map((meld, index) => (
                  <MeldView
                    key={`hm-${index}`}
                    meld={meld}
                    seat={HUMAN}
                    players={players}
                    rotated={false}
                  />
                ))}
              </div>

              <div className="hand">
                {rest.map((kind, index) => (
                  <Tile
                    key={`h-${index}`}
                    kind={kind}
                    {...(canDiscard
                      ? {
                          onClick: () =>
                            onAction({ type: 'discard', tile: kind }),
                        }
                      : {})}
                  />
                ))}
                {drawn !== null && (
                  <Tile
                    key="drawn"
                    kind={drawn}
                    drawn
                    highlight
                    {...(canDiscard
                      ? {
                          onClick: () =>
                            onAction({ type: 'discard', tile: drawn }),
                        }
                      : {})}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {result !== null && (
        <div className="overlay">
          <div className="panel result-panel">
            <h2>{finalView ? '终局' : resultTitle(result.kind)}</h2>

            {finalView && (
              <>
                <div className="standings-title">最终顺位</div>
                <div className="standings">
                  {standingsOf(state.scores).map((row) => (
                    <div
                      className={`standings-row ${playerClass(row.seat)}`}
                      key={`st-${row.seat}`}
                    >
                      <span className="standings-rank">{row.rank} 位</span>
                      <span className="standings-name">
                        {playerName(row.seat, players)}
                      </span>
                      <span className="standings-score">{row.score}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!finalView && (
              <>
                {result.entries.length === 0 && <p>无人和牌，本局记 0 分。</p>}

                {result.entries.map((entry) => {
                  return (
                    <div className="result-entry" key={`entry-${entry.seat}`}>
                      <ResultHead
                        seat={entry.seat}
                        kind={result.kind}
                        gain={entry.gain}
                        penalty={entry.penalty}
                        discarder={result.discarder}
                        players={players}
                      />
                      <GroupedHand
                        groups={entry.groups}
                        winTile={entry.winTile}
                      />

                      <div className="result-line">
                        <span className="result-label">番种</span>
                        <div className="result-yaku">
                          {sortYakuByPoints(entry.result.hits).map((hit) => {
                            // 只有"实际吃到铳责"的番种才标色：always，或 by-meld 且落点对得上
                            const slot = entry.result.liabilitySlot;
                            const liable =
                              entry.result.liability > 0 &&
                              (hit.liability === 'always' ||
                                (hit.liability === 'by-meld' &&
                                  (hit.meldMask & slot) !== 0));
                            return (
                              <span
                                className={`yaku-chip${needsGlow(hit.points) ? ' yaku-chip-glow' : ''}`}
                                key={`y-${entry.seat}-${hit.id}`}
                                style={
                                  {
                                    '--yaku': yakuColorOf(hit.points),
                                  } as React.CSSProperties
                                }
                                title={
                                  liable
                                    ? `关联铳责 +${hit.points}（S_A 合计 ${entry.result.liability}）`
                                    : undefined
                                }
                              >
                                {liable && (
                                  <span
                                    className="liability-dot"
                                    aria-label="关联铳责"
                                  />
                                )}
                                {hit.name}
                                <b>{hit.points}</b>
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      <div className="result-total">
                        <span>
                          合计 <b>{entry.result.rawSum}</b> 番 → 和牌分{' '}
                          <b>{entry.gain}</b>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {finalView && state.bestWin !== null && (
              <>
                <div className="standings-title">本局大牌</div>
                <BestWinView record={state.bestWin} players={players} />
              </>
            )}

            <div className="result-scores">
              <ScoreChanges
                before={currentRecord?.scoresBefore ?? state.scores}
                after={currentRecord?.scoresAfter ?? state.scores}
                players={players}
              />
            </div>

            <div className="panel-actions">
              {canReplay && (
                <button type="button" className="ghost" onClick={onOpenReplay}>
                  回放本局
                </button>
              )}
              {finalView ? (
                <button type="button" onClick={onRestart}>
                  再来一局
                </button>
              ) : state.finished ? (
                <button type="button" onClick={onShowFinal}>
                  最终结算
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onAction({ type: 'next-round' })}
                >
                  下一局
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
