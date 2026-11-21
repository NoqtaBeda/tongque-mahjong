import { KIND_COUNT, isRng } from '../../core/src/index.ts';
import type { GameState } from '../../core/src/index.ts';

const STORAGE_KEY = 'mahjong-playground/save/v2';
// 版本号 +1 会让旧存档失效（每次大改界面都靠它清进度）
const VERSION = 2;

interface Envelope {
  readonly version: number;
  readonly state: unknown;
}

/** `GameState` 里的 `hands` 是 `Uint8Array`，JSON 存不了，单独转成普通数组。 */
export function encodeState(state: GameState): string {
  const payload = {
    ...state,
    hands: state.hands.map((hand) => Array.from(hand)),
  };
  const envelope: Envelope = { version: VERSION, state: payload };
  return JSON.stringify(envelope);
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

/** 解析失败、版本不符、字段缺失时一律返回 null，交给调用方开新局。 */
export function decodeState(raw: string): GameState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const envelope = parsed as Envelope;
  if (envelope.version !== VERSION) return null;
  if (typeof envelope.state !== 'object' || envelope.state === null)
    return null;

  const candidate = envelope.state as Record<string, unknown>;

  const cfg = candidate.cfg as Record<string, unknown> | undefined;
  if (cfg === undefined) return null;
  const players = cfg.players;
  if (players !== 3 && players !== 4) return null;
  if (typeof cfg.rounds !== 'number') return null;

  const hands = candidate.hands;
  if (!Array.isArray(hands) || hands.length !== players) return null;
  if (!hands.every(isNumberArray)) return null;
  if (!hands.every((hand) => hand.length === KIND_COUNT)) return null;

  const rebuilt: Uint8Array[] = hands.map((hand) => {
    const typed = new Uint8Array(KIND_COUNT);
    for (let index = 0; index < KIND_COUNT; index += 1)
      typed[index] = hand[index];
    return typed;
  });

  const state = { ...candidate, hands: rebuilt } as unknown as GameState;
  if (!Array.isArray(state.discards) || state.discards.length !== players)
    return null;
  if (!Array.isArray(state.scores) || state.scores.length !== players)
    return null;
  if (typeof state.phase !== 'string') return null;
  // 只接受当前格式：缺字段的存档一律丢弃（存档写坏了就开新局，不做就地修补）
  if (!Array.isArray(state.history)) return null;
  if (!Array.isArray(state.tsumogiri)) return null;
  if (!isRng(state.rng)) return null;

  return state;
}

export function saveState(state: GameState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, encodeState(state));
  } catch {
    // 隐私模式或配额已满：存档失败不该影响对局
  }
}

export function loadState(): GameState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return decodeState(raw);
  } catch {
    return null;
  }
}

export function clearState(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上
  }
}

// ---------------------------------------------------------------- 界面停留位置

const VIEW_KEY = 'mahjong-playground/view/v2';

/**
 * 界面上"翻到了哪一页"这类状态。
 *
 * 对局本身已经在存档里，但「终局」页是点过按钮才切换的——不记下来的话，
 * 和牌/最终结算界面开着时关掉浏览器，下次打开就退回最后一局的开局画面了。
 */
interface ViewState {
  /** 是否已经翻到最终结算页（打完所有局之后） */
  readonly finalShown: boolean;
}

export function saveView(view: ViewState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // 存档失败不该影响对局
  }
}

export function loadView(): ViewState {
  if (typeof localStorage === 'undefined') return { finalShown: false };
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw === null) return { finalShown: false };
    const parsed = JSON.parse(raw) as Partial<ViewState> | null;
    return { finalShown: parsed?.finalShown === true };
  } catch {
    return { finalShown: false };
  }
}
