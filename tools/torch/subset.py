"""按 group 取子集，生成 bagging 用的数据（v2 格式）。

用法：
    python tools/torch/subset.py --source a.bin --out b.bin --keep 4 --offset 0
    # 保留 (group + offset) % 5 != 4 的样本 → 约 80%
"""

import argparse
import struct

import numpy as np


def load_v2(path):
    raw = open(path, "rb").read()
    magic = struct.unpack_from("<I", raw, 0)[0]
    assert magic == 0x54513032, f"{path} 不是 v2"
    count, dim, flags = struct.unpack_from("<III", raw, 4)
    groups = np.frombuffer(raw, dtype="<u4", count=count, offset=16).astype(np.int64)
    weights_start = 16 + count * 4
    if flags & 1:
        weights = np.frombuffer(raw, dtype="<f4", count=count, offset=weights_start)
        body_start = weights_start + count * 4
    else:
        weights = np.ones(count, dtype=np.float32)
        body_start = weights_start
    body = np.frombuffer(
        raw, dtype="<f4", count=count * (dim + 1), offset=body_start
    ).reshape(count, dim + 1)
    return groups, weights, body, dim


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mod", type=int, default=5, help="按 group %% mod 划分")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--drop", type=int, default=4, help="丢掉 (group+offset)%%mod==drop 的部分")
    parser.add_argument("--chunk", type=int, default=200000)
    args = parser.parse_args()

    groups, weights, body, dim = load_v2(args.source)
    keep = ((groups + args.offset) % args.mod) != args.drop
    count = int(keep.sum())
    print(f"保留 {count:,} / {groups.size:,} 行（{count / groups.size * 100:.1f}%）")

    header = struct.pack("<IIII", 0x54513032, count, dim, 1)
    with open(args.out, "wb") as handle:
        handle.write(header)
        handle.write(groups[keep].astype("<u4").tobytes())
        handle.write(weights[keep].astype("<f4").tobytes())
        kept = body[keep]
        for start in range(0, count, args.chunk):
            stop = min(count, start + args.chunk)
            handle.write(kept[start:stop].astype("<f4").tobytes())
    print(f"已写出 {args.out}")


if __name__ == "__main__":
    main()
