// 脚本共用的种子解析：允许 32 位数字，也允许超过 2^53 的 128 位十进制种子。
//
// 为什么需要：引擎的种子类型是 `number | bigint | string | RngState`，
// 但命令行的 `--seed` 是字符串。数字种子只有 32 位（保持老数据可复现），
// 想要更大的空间就传一个长数字，这里会解析成 bigint。

export type Seed = number | bigint;

/** 解析 `--seed=`：安全整数按 number，超长纯数字按 bigint，其它报错 */
export function parseSeed(raw: string | undefined, fallback: number = 1): Seed {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  if (/^-?\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (Number.isSafeInteger(asNumber)) return asNumber;
    // 超过 2^53：用 BigInt 保住全部位数
    return BigInt(trimmed);
  }
  throw new Error(
    `--seed 必须是整数（收到“${raw}”）。想要更大空间就传更长的十进制数，例如 202611200030123456789012345`,
  );
}

/** 在种子上加偏移（bigint 与 number 不能直接相加） */
export function offsetSeed(seed: Seed, offset: number): Seed {
  return typeof seed === 'bigint' ? seed + BigInt(offset) : seed + offset;
}

/** 打印用：bigint 会带 n，这里统一成十进制字符串 */
export function formatSeed(seed: Seed): string {
  return typeof seed === 'bigint' ? seed.toString() : String(seed);
}
