export const KIND_COUNT = 34;

const SUIT_M = 0;
const SUIT_P = 1;
const SUIT_S = 2;
const SUIT_Z = 3;

/**
 * 牌种编号（0..33），与天凤 / MPSZ 记号一一对应：
 * - 0-8   = `1m`-`9m`（万）
 * - 9-17  = `1p`-`9p`（饼）
 * - 18-26 = `1s`-`9s`（索）
 * - 27-30 = `1z`-`4z`（东南西北）
 * - 31-33 = `5z`-`7z`（白、發、中）
 *
 * 注意三元牌的顺序是「白 → 發 → 中」，不是中文习惯的「中发白」。
 */
export function kindSuit(kind: number): number {
  return kind < 27 ? Math.floor(kind / 9) : SUIT_Z;
}

export function kindRank(kind: number): number {
  return kind < 27 ? (kind % 9) + 1 : kind - 26;
}

export function isNumberKind(kind: number): boolean {
  return kind < 27;
}

export function isHonorKind(kind: number): boolean {
  return kind >= 27;
}

export function isTerminalKind(kind: number): boolean {
  if (kind >= 27) return false;
  const rank = (kind % 9) + 1;
  return rank === 1 || rank === 9;
}

/** 幺九牌 = 数字 1、数字 9、字牌 */
export function isYaochuuKind(kind: number): boolean {
  return kind >= 27 || isTerminalKind(kind);
}

export const WIND_KINDS: readonly number[] = [27, 28, 29, 30];
export const DRAGON_KINDS: readonly number[] = [31, 32, 33];

export type Hand = Uint8Array;

export function emptyHand(): Hand {
  return new Uint8Array(KIND_COUNT);
}

export function handTotal(hand: Hand): number {
  let total = 0;
  for (let kind = 0; kind < KIND_COUNT; kind += 1) total += hand[kind];
  return total;
}

const SUIT_BY_LETTER: Readonly<Record<string, number>> = {
  m: SUIT_M,
  p: SUIT_P,
  s: SUIT_S,
  z: SUIT_Z,
};

const TILE_SUIT_LETTERS = ['m', 'p', 's', 'z'] as const;

function kindOf(suit: number, rank: number): number {
  if (suit === SUIT_Z) {
    if (rank < 1 || rank > 7) throw new Error(`bad honor rank: ${rank}`);
    return 26 + rank;
  }
  if (rank < 1 || rank > 9) throw new Error(`bad rank: ${rank}`);
  return suit * 9 + (rank - 1);
}

/** 解析 `111m 222m 11z` 这类记法，返回带重复的牌种序列。 */
export function parseTiles(text: string): number[] {
  const out: number[] = [];
  let digits: number[] = [];
  for (const ch of text) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    if (ch >= '0' && ch <= '9') {
      digits.push(ch.charCodeAt(0) - 48);
      continue;
    }
    const suit = SUIT_BY_LETTER[ch.toLowerCase()];
    if (suit === undefined)
      throw new Error(`unexpected tile letter "${ch}" in "${text}"`);
    if (digits.length === 0)
      throw new Error(`dangling suit letter "${ch}" in "${text}"`);
    for (const digit of digits) out.push(kindOf(suit, digit));
    digits = [];
  }
  if (digits.length > 0) throw new Error(`tiles without a suit in "${text}"`);
  return out;
}

export function parseHand(text: string): Hand {
  const hand = emptyHand();
  for (const kind of parseTiles(text)) {
    hand[kind] += 1;
    if (hand[kind] > 4)
      throw new Error(`more than 4 copies of kind ${kind} in "${text}"`);
  }
  return hand;
}

/** 牌种 → 天凤 / MPSZ 记号的代码，例如 `1m`、`7z`。 */
export function tileCode(kind: number): string {
  const suit = kind < 27 ? TILE_SUIT_LETTERS[Math.floor(kind / 9)] : 'z';
  return `${kindRank(kind)}${suit}`;
}

const NUMERAL_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_NAMES = ['万', '饼', '索'];

/** 字牌的中文名，顺序与 `1z`-`7z` 一致：东南西北 + 白發中。 */
export const HONOR_NAMES = ['东', '南', '西', '北', '白', '发', '中'] as const;

/** 牌种的中文名，用于 `title` / `alt`。 */
export function tileName(kind: number): string {
  if (kind >= 27) return HONOR_NAMES[kind - 27];
  return `${NUMERAL_NAMES[kindRank(kind) - 1]}${SUIT_NAMES[Math.floor(kind / 9)]}`;
}

export function formatHand(hand: Hand): string {
  const parts: string[] = [];
  for (let suit = 0; suit < 4; suit += 1) {
    const from = suit === 3 ? 27 : suit * 9;
    const to = suit === 3 ? 34 : from + 9;
    let digits = '';
    for (let kind = from; kind < to; kind += 1) {
      digits += String(kindRank(kind)).repeat(hand[kind]);
    }
    if (digits.length > 0) parts.push(digits + TILE_SUIT_LETTERS[suit]);
  }
  return parts.join(' ');
}

export type MeldKind = 'chi' | 'pon' | 'minkan' | 'ankan' | 'kakan';

export interface Meld {
  readonly kind: MeldKind;
  readonly tiles: readonly number[];
  /**
   * 被鸣牌的那一家的座位号。只有吃 / 碰 / 大明杠 / 加杠有；
   * 暗杠和「AI 内部模拟用的临时副露」没有。
   *
   * 日麻副露的横置牌位置专门用来表示「从谁那里鸣的」：
   * 上家 → 左端、对家 → 中间、下家 → 右端（大明杠同理，只是牌多一张）。
   */
  readonly from?: number;
  /** 被鸣的那张牌的牌种（吃用来定位横置牌；碰杠三/四张同种，靠位置表达来源） */
  readonly called?: number;
}

export function chiMeld(start: number): Meld {
  return { kind: 'chi', tiles: [start, start + 1, start + 2] };
}

export function ponMeld(tile: number): Meld {
  return { kind: 'pon', tiles: [tile, tile, tile] };
}

export function isKanMeld(meld: Meld): boolean {
  return meld.tiles.length === 4;
}

export function isTripletMeld(meld: Meld): boolean {
  return meld.kind !== 'chi';
}

export function meldSuit(meld: Meld): number {
  return kindSuit(meld.tiles[0]);
}

export function meldRank(meld: Meld): number {
  return kindRank(meld.tiles[0]);
}

function inferMeldKind(tiles: readonly number[]): MeldKind {
  if (tiles.length === 4) return 'minkan';
  if (tiles.length !== 3)
    throw new Error(`a meld needs 3 or 4 tiles, got ${tiles.length}`);
  const [a, b, c] = tiles;
  return a === b && b === c ? 'pon' : 'chi';
}

export function parseMeld(text: string, kind?: MeldKind): Meld {
  const tiles = parseTiles(text).sort((a, b) => a - b);
  return { kind: kind ?? inferMeldKind(tiles), tiles };
}
