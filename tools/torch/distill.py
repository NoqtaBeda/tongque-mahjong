"""把 N 个同构价值网络的预测均值蒸馏成一个训练集。

用法：
    python tools/torch/distill.py --source .data/v2-iter6-40k.bin \
        --models a.ts,b.ts,c.ts --out .data/distill.bin

思路：集成只有在推理时平均才有效，而推理时跑 N 个网络太慢。
把集成在大量状态上的输出当成新标签，训练一个单网络去拟合，得到"蒸馏版集成"。
"""

import argparse
import base64
import re
import struct

import numpy as np

from model import SCALE


def read_ts(path):
    text = open(path, encoding="utf-8").read()
    dims = [int(re.search(rf"NN_DIM{i}\s*=\s*(\d+)", text).group(1)) for i in range(3)]
    literal = re.search(r"NN_WEIGHTS_B64\s*=\s*([\s\S]*?);", text)
    b64 = re.sub(r"[^A-Za-z0-9+/=]", "", literal.group(1))
    buf = np.frombuffer(base64.b64decode(b64), dtype="<f4")
    d0, d1, d2 = dims
    sizes = (d0 * d1, d1, d1 * d2, d2, d2, 1)
    return buf, (d0, d1, d2, *sizes)


def predict(buf, shape, x):
    d0, d1, d2, w1, b1, w2, b2, w3, b3 = shape
    x = x[:, :d0]
    offset = 0
    W1 = buf[offset : offset + w1].reshape(d1, d0)
    offset += w1
    B1 = buf[offset : offset + b1]
    offset += b1
    W2 = buf[offset : offset + w2].reshape(d2, d1)
    offset += w2
    B2 = buf[offset : offset + b2]
    offset += b2
    W3 = buf[offset : offset + w3].reshape(1, d2)
    offset += w3
    B3 = buf[offset : offset + b3]
    h1 = np.maximum(x @ W1.T + B1, 0)
    h2 = np.maximum(h1 @ W2.T + B2, 0)
    return (h2 @ W3.T + B3).ravel()


def load_v2(path):
    raw = open(path, "rb").read()
    magic = struct.unpack_from("<I", raw, 0)[0]
    assert magic == 0x54513032, f"{path} 不是 v2 格式"
    count, dim, flags = struct.unpack_from("<III", raw, 4)
    groups_start = 16
    groups = np.frombuffer(raw, dtype="<u4", count=count, offset=groups_start)
    weights_start = groups_start + count * 4
    if flags & 1:
        weights = np.frombuffer(raw, dtype="<f4", count=count, offset=weights_start)
        body_start = weights_start + count * 4
    else:
        weights = np.ones(count, dtype=np.float32)
        body_start = weights_start
    body = np.frombuffer(
        raw, dtype="<f4", count=count * (dim + 1), offset=body_start
    ).reshape(count, dim + 1)
    return body[:, :dim].copy(), body[:, dim].copy(), groups, weights, dim


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="提供特征的 v2 文件")
    parser.add_argument("--models", required=True, help="逗号分隔的权重 .ts")
    parser.add_argument("--out", required=True)
    parser.add_argument("--chunk", type=int, default=200000)
    args = parser.parse_args()

    sources = [item.strip() for item in args.source.split(",") if item.strip()]
    features_parts, group_parts, weight_parts, dim = [], [], [], 0
    group_offset = 0
    for path in sources:
        f, _, g, w, d = load_v2(path)
        if dim == 0:
            dim = d
        elif dim != d:
            raise SystemExit(f"✖ {path} 维度 {d} 与前面的 {dim} 不符")
        features_parts.append(f)
        group_parts.append(g + group_offset)
        weight_parts.append(w)
        group_offset += int(g.max()) + 1 if g.size else 0
        print(f"  读入 {path}：{f.shape[0]:,} 行")
    features = np.concatenate(features_parts)
    groups = np.concatenate(group_parts).astype(np.uint32)
    weights = np.concatenate(weight_parts).astype(np.float32)
    paths = [item.strip() for item in args.models.split(",") if item.strip()]
    nets = [read_ts(path) for path in paths]
    print(f"特征 {features.shape} · 模型 {len(nets)} 个")

    total = np.zeros(features.shape[0], dtype=np.float64)
    for index, (buf, shape) in enumerate(nets):
        if shape[0] != dim:
            raise SystemExit(f"✖ {paths[index]} 维度 {shape[0]} 与数据 {dim} 不符")
        total += predict(buf, shape, features)
        print(f"  已融合 {index + 1}/{len(nets)}")
    # 文件里的标签是「分」，而网络输出是「分 / SCALE」，写回时必须乘回去
    targets = ((total / len(nets)) * SCALE).astype(np.float32)
    print(
        f"蒸馏标签：均值 {targets.mean():.3f} 分 · 标准差 {targets.std():.3f} 分"
    )

    count = features.shape[0]
    header = struct.pack("<IIII", 0x54513032, count, dim, 1)
    with open(args.out, "wb") as handle:
        handle.write(header)
        handle.write(groups.astype("<u4").tobytes())
        handle.write(weights.astype("<f4").tobytes())
        for start in range(0, count, args.chunk):
            stop = min(count, start + args.chunk)
            block = np.concatenate(
                [features[start:stop], targets[start:stop, None]], axis=1
            )
            handle.write(block.astype("<f4").tobytes())
    print(f"已写出 {args.out}（{count} 行）")


if __name__ == "__main__":
    main()
