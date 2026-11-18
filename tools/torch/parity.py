"""PyTorch → TypeScript 数值一致性校验（Python 侧）。

做两件事：
1. 造一个固定种子的模型，把权重写入真实的 weights.ts
   （临时文件 `.data/parity-weights.ts`，base64 的 float32 字节流），走完整的导出代码路径；
2. 用同一批权重算出一组输入的前向结果，写进 `.data/parity-vectors.json`，
   交给 `scripts/nn-parity.mjs` 在 Node 侧用 TS 的 `predict()` 比对。

用法：python tools/torch/parity.py
"""

import json
import os
import sys

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from export_weights import write_weights_ts  # noqa: E402
from model import Mlp  # noqa: E402

DIM0, DIM1, DIM2 = 120, 128, 64
CASE_COUNT = 64
# 校验用的权重写在 .data 里，不污染源码目录；从这里回到 mlp.ts 的相对路径是 ../packages/...
WEIGHTS_TS = ".data/parity-weights.ts"
MLP_IMPORT = "../packages/core/src/ai/nn/mlp.ts"
VECTORS_JSON = ".data/parity-vectors.json"


def make_inputs(generator):
    """一半均匀分布、一半稀疏 one-hot：真实特征是"少数非零 + 大量 0"的形状。"""
    cases = []
    for index in range(CASE_COUNT):
        if index % 2 == 0:
            vector = torch.rand(DIM0, generator=generator)
        else:
            vector = torch.zeros(DIM0)
            picks = torch.randint(0, DIM0, (6,), generator=generator)
            values = torch.rand(6, generator=generator).round(decimals=2)
            vector[picks] = values
        cases.append(vector)
    return torch.stack(cases)


def main():
    torch.manual_seed(20260101)
    model = Mlp(DIM0, DIM1, DIM2).eval()

    note = "数值一致性校验用的随机权重，不是训练产物"
    os.makedirs(".data", exist_ok=True)
    write_weights_ts(model, WEIGHTS_TS, note)

    inputs = make_inputs(torch.Generator().manual_seed(7))
    with torch.no_grad():
        outputs = model(inputs)

    payload = {
        "weights": WEIGHTS_TS,
        "cases": [
            {
                "input": [round(float(v), 6) for v in inputs[i].tolist()],
                "expected": float(outputs[i]),
            }
            for i in range(CASE_COUNT)
        ],
    }
    os.makedirs(".data", exist_ok=True)
    with open(VECTORS_JSON, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle)

    print(f"已写出 {WEIGHTS_TS} 与 {VECTORS_JSON}")
    print(f"用例 {CASE_COUNT} 个 · 前向输出范围 {outputs.min():.4f} ~ {outputs.max():.4f}")
    print(f"参数量 {sum(p.numel() for p in model.parameters())}")


if __name__ == "__main__":
    main()
