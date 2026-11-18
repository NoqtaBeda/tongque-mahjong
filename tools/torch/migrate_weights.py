"""一次性迁移：把旧格式（数字数组）的 weights.ts 转成新格式（base64）。

旧文件里是 `Float32Array.from([...])`，新文件只存一个 base64 字符串。
解析旧文件、按同样顺序重排成 float32 小端字节流即可。
"""

import base64
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "torch"))

from export_weights import HEADER  # noqa: E402

SOURCE = ".data/model-eve3.ts"
TARGET = "packages/core/src/ai/nn/weights.ts"


def parse_array(text, name):
    match = re.search(name + r"\s*:\s*Float32Array\.from\(\[([^\]]*)\]\)", text)
    if match is None:
        raise SystemExit(f"✖ 找不到 {name}")
    return np.array([float(v) for v in match.group(1).split(",")], dtype="<f4")


def main():
    text = open(SOURCE, encoding="utf-8").read()
    dim0 = int(re.search(r"NN_DIM0\s*=\s*(\d+)", text).group(1))
    dim1 = int(re.search(r"NN_DIM1\s*=\s*(\d+)", text).group(1))
    dim2 = int(re.search(r"NN_DIM2\s*=\s*(\d+)", text).group(1))

    parts = [parse_array(text, name) for name in ("w1", "b1", "w2", "b2", "w3", "b3")]
    blob = b"".join(part.tobytes() for part in parts)
    note = f"{dim0}→{dim1}→{dim2}→1 · base64 格式（由旧数组格式迁移）"

    output = HEADER.format(
        note=note,
        dim0=dim0,
        dim1=dim1,
        dim2=dim2,
        b64=base64.b64encode(blob).decode("ascii"),
    )
    with open(TARGET, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(output)

    print(f"{SOURCE} → {TARGET}")
    print(f"维度 {dim0}→{dim1}→{dim2}→1 · 浮点 {len(blob) // 4} 个 · {len(output) // 1024} KB")


if __name__ == "__main__":
    main()
