"""把候选权重文件装到线上位置，并做基本校验。

训练时通常先写到 `.data/` 里（评测确认后再上线）。这个脚本只负责搬运 + 校验：
目标文件必须是完整的 base64 权重文件，避免把空文件或半截文件装上线
（踩过这个坑：候选文件路径写错，`$null` 直接覆盖了线上权重）。

用法：
    python tools/torch/install_weights.py --from .data/model-eve3.ts
"""

import argparse
import os

TARGET = "packages/core/src/ai/nn/weights.ts"
# 23,809 个 float32 → base64 约 127KB
MIN_BYTES = 50_000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="source", required=True)
    ap.add_argument("--to", dest="target", default=TARGET)
    args = ap.parse_args()

    if not os.path.exists(args.source):
        raise SystemExit(f"✖ 找不到 {args.source}")

    text = open(args.source, encoding="utf-8").read()
    if len(text.encode("utf-8")) < MIN_BYTES:
        raise SystemExit(f"✖ {args.source} 只有 {len(text)} 字符，不像完整的权重文件")
    if "NN_WEIGHTS_B64" not in text or "NN_DIM0" not in text:
        raise SystemExit(f"✖ {args.source} 里没有 NN_WEIGHTS_B64 / NN_DIM0")

    os.makedirs(os.path.dirname(args.target), exist_ok=True)
    with open(args.target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)

    header = [line for line in text.splitlines() if line.startswith("//")][:2]
    print(f"已装载 {args.source} → {args.target}（{len(text) // 1024} KB）")
    for line in header:
        print(f"  {line}")


if __name__ == "__main__":
    main()
