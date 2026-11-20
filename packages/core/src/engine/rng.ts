/**
 * 对局随机源。
 *
 * - 生成器：**xoshiro128\*\***（Blackman & Vigna），128 位状态（4 个 uint32），
 *   只用 32 位整数运算与 `Math.imul`，不依赖 BigInt。
 * - 输出：每次一步返回一个 32 位字，转成 `[0,1)` 浮点；`floor(value * n)` 的
 *   选择偏差 ≤ 1/2³²，对 136 张牌的 Fisher–Yates 完全可忽略。
 * - 种子：32 位 number、64 位 bigint、字符串（FNV-1a → 128 位）、
 *   或直接给 4 个 uint32（系统熵源结果）。
 *
 * **「真随机」体现在种子，不体现在洗牌**：洗牌必须确定性，否则存档无法复现。
 */
export type RngState = readonly [number, number, number, number];

const TWO_POW_32 = 4294967296;
const MASK_32 = 0xffffffffn;

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** splitmix32：短种子的扩散器，把 32 位种子铺成 128 位状态 */
function splitmix32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z ^= z >>> 16;
    z = Math.imul(z, 0x21f0aaad);
    z ^= z >>> 15;
    z = Math.imul(z, 0x735a2d97);
    z ^= z >>> 15;
    return z >>> 0;
  };
}

/** xoshiro 的状态不能全 0 */
function ensureNonZero(rng: RngState): RngState {
  if ((rng[0] | rng[1] | rng[2] | rng[3]) !== 0) return rng;
  return [0x9e3779b9, 0x243f6a88, 0xb7e15162, 1];
}

function fromNumber(seed: number): RngState {
  const mix = splitmix32(seed | 0);
  return ensureNonZero([mix(), mix(), mix(), mix()]);
}

function fromBigInt(seed: bigint): RngState {
  const mix = splitmix32(Number(seed & MASK_32) ^ Number(seed >> 32n));
  const lanes: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const chunk = Number((seed >> BigInt(32 * index)) & MASK_32);
    lanes.push((chunk ^ mix()) >>> 0);
  }
  return ensureNonZero([lanes[0], lanes[1], lanes[2], lanes[3]]);
}

function fromString(seed: string): RngState {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const limit = 0xffffffffffffffffn;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= BigInt(seed.charCodeAt(index));
    hash = (hash * prime) & limit;
  }
  return fromBigInt(hash);
}

/** 任意种子 → 128 位状态 */
export function toRng(seed: number | bigint | string | RngState): RngState {
  if (isRng(seed)) return ensureNonZero(seed);
  if (typeof seed === 'number') return fromNumber(seed);
  if (typeof seed === 'bigint') return fromBigInt(seed);
  return fromString(seed);
}

/** 走一步：返回新状态与 [0,1) 的浮点 */
export function nextRng(rng: RngState): { rng: RngState; value: number } {
  const s0 = rng[0];
  const s1 = rng[1];
  const s2 = rng[2];
  const s3 = rng[3];

  // 输出：rotl(s1 * 5, 7) * 9 的低 32 位
  const result = (rotl(Math.imul(s1, 5), 7) * 9) >>> 0;
  const t = (s1 << 9) >>> 0;

  const n2 = (s2 ^ s0) >>> 0;
  const n3 = (s3 ^ s1) >>> 0;
  const n1 = (s1 ^ n2) >>> 0;
  const n0 = (s0 ^ n3) >>> 0;

  return {
    rng: [n0, n1, (n2 ^ t) >>> 0, rotl(n3, 11)],
    value: result / TWO_POW_32,
  };
}

/**
 * 系统熵源的 128 位种子（"真随机"）。
 *
 * 浏览器与 Node 19+ 都有 `crypto.getRandomValues`；缺失时退化为时间 + `Math.random`，
 * 并明确不再是密码学随机。
 */
export function randomRng(): RngState {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.getRandomValues !== undefined) {
    const buffer = new Uint32Array(4);
    webCrypto.getRandomValues(buffer);
    return ensureNonZero([buffer[0], buffer[1], buffer[2], buffer[3]]);
  }
  const mix = splitmix32(
    (Date.now() ^ Math.floor(Math.random() * TWO_POW_32)) | 0,
  );
  return ensureNonZero([mix(), mix(), mix(), mix()]);
}

/** 校验一个值是否可作为随机状态（存档迁移用） */
export function isRng(value: unknown): value is RngState {
  if (!Array.isArray(value) || value.length !== 4) return false;
  return value.every(
    (item) => Number.isInteger(item) && item >= 0 && item < TWO_POW_32,
  );
}

/** 状态是否来自系统熵源无从判断，但可以用来展示（调试用） */
export function describeRng(rng: RngState): string {
  return rng.map((word) => word.toString(16).padStart(8, '0')).join('-');
}

// ---------------------------------------------------------------- BigInt 变体
//
// 同一个 xoshiro128** 算法，状态仍是 4 个 uint32（存档格式不变），
// 只把循环内的算术换成 BigInt 64/128 位运算，用于对比性能。

const MASK32 = 0xffffffffn;

function rotlBig(value: bigint, shift: bigint): bigint {
  return ((value << shift) | (value >> (32n - shift))) & MASK32;
}

/** BigInt 版的一步：语义与 `nextRngNumber` 完全一致 */
export function nextRngBigInt(rng: RngState): {
  rng: RngState;
  value: number;
} {
  const s0 = BigInt(rng[0]);
  const s1 = BigInt(rng[1]);
  const s2 = BigInt(rng[2]);
  const s3 = BigInt(rng[3]);

  const result = (rotlBig((s1 * 5n) & MASK32, 7n) * 9n) & MASK32;
  const t = (s1 << 9n) & MASK32;

  const n2 = s2 ^ s0;
  const n3 = s3 ^ s1;
  const n1 = s1 ^ n2;
  const n0 = s0 ^ n3;

  return {
    rng: [Number(n0), Number(n1), Number(n2 ^ t), Number(rotlBig(n3, 11n))],
    value: Number(result) / TWO_POW_32,
  };
}

export type RngMode = 'number' | 'bigint';

/**
 * 当前使用的算术实现。
 *
 * 默认走 32 位整数版；设 `TONGQUE_RNG_MODE=bigint` 可切到 BigInt 版做对比。
 * 浏览器里没有 `process`，环境变量读取会被跳过。
 */
export const RNG_MODE: RngMode = (() => {
  const env =
    typeof process === 'undefined'
      ? undefined
      : (process.env as Record<string, string | undefined>);
  return env?.TONGQUE_RNG_MODE === 'bigint' ? 'bigint' : 'number';
})();

/** 按当前模式走一步 */
export function drawRng(rng: RngState): { rng: RngState; value: number } {
  return RNG_MODE === 'bigint' ? nextRngBigInt(rng) : nextRng(rng);
}
