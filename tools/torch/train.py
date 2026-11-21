"""PyTorch 版训练器：和 tools/train/train.ts 做同一件事，产物也是同一个 weights.ts。

用法：
    # 训练并直接覆盖线上权重
    python tools/torch/train.py --data=.data/chunk-50001.bin,.data/chunk-60001.bin
    # 只写到候选文件，先评测再决定是否上线
    python tools/torch/train.py --data=... --out=.data/cand-torch.ts

与 TS 版的差异：
- 早停按验证集相关系数挑最好的一轮（TS 版行为一致）
- 支持更大模型；GPU 下 36 万样本一轮约 2 秒
"""

import argparse
import os
import sys
import time

import numpy as np
import torch
from torch import nn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from export_weights import write_weights_ts  # noqa: E402
from model import Mlp, correlation, load_many, pick_device, split_by_group3  # noqa: E402

DEFAULT_OUT = "packages/core/src/ai/nn/weights.ts"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="逗号分隔的多个 .bin")
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--hidden1", type=int, default=128)
    ap.add_argument("--hidden2", type=int, default=64)
    ap.add_argument("--weight-decay", type=float, default=0.0)
    ap.add_argument("--valid-ratio", type=float, default=0.15)
    ap.add_argument("--test-ratio", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument(
        "--init",
        default="",
        help="从已有的 weights.ts 热启动（迁移学习）；留空则从零训练",
    )
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = pick_device()

    files = [path.strip() for path in args.data.split(",") if path.strip()]
    features, targets, groups, sample_weights, dim = load_many(files)
    train_idx, val_idx, test_idx = split_by_group3(
        groups, args.valid_ratio, args.test_ratio, args.seed
    )
    print(
        f"样本 {len(targets)} · 维度 {dim} · 训练 {len(train_idx)} / 验证 {len(val_idx)} / "
        f"测试 {len(test_idx)} · 标签均值 {targets.mean() * 12:.3f} 分 · 方差 {targets.var():.5f}"
    )
    print(f"设备 {device}" + (f" ({torch.cuda.get_device_name(0)})" if device == "cuda" else ""))

    x = torch.from_numpy(features).to(device)
    y = torch.from_numpy(targets).to(device)
    w = torch.from_numpy(sample_weights.astype(np.float32)).to(device)
    tr = torch.from_numpy(train_idx).to(device)
    va = torch.from_numpy(val_idx).to(device)
    te = torch.from_numpy(test_idx).to(device)

    model = Mlp(dim, args.hidden1, args.hidden2).to(device)
    if args.init:
        from export_weights import read_weights_ts

        loaded = read_weights_ts(args.init)
        got = (loaded["dim0"], loaded["dim1"], loaded["dim2"])
        want = (dim, args.hidden1, args.hidden2)
        if got != want:
            raise SystemExit(f"✖ 结构不符：{args.init} 是 {got}，当前配置是 {want}")
        model.load_state_dict(loaded["state"])
        print(f"已从 {args.init} 热启动")
    print(f"参数量 {sum(p.numel() for p in model.parameters())}")

    optimizer = torch.optim.Adam(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay
    )
    def weighted_mse(pred, target, weight):
        """加权 MSE：v2 数据的权重列（目前全为 1，留给后续按距离减权用）。"""
        return ((pred - target) ** 2 * weight).sum() / weight.sum()

    # 指标仍然用未加权 MSE，保证与 v1 数据的相关系数可比
    loss_fn = nn.MSELoss()

    best_r, best_epoch, best_state = -1.0, 0, None
    started = time.time()

    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = tr[torch.randperm(tr.numel(), device=device)]
        for start in range(0, perm.numel(), args.batch):
            idx = perm[start : start + args.batch]
            optimizer.zero_grad()
            loss = weighted_mse(model(x[idx]), y[idx], w[idx])
            loss.backward()
            optimizer.step()

        model.eval()
        with torch.no_grad():
            train_mse = float(loss_fn(model(x[tr]), y[tr]))
            val_pred = model(x[va])
            val_mse = float(loss_fn(val_pred, y[va]))
            val_r = correlation(val_pred, y[va])

        if val_r > best_r:
            best_r, best_epoch = val_r, epoch
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

        print(
            f"epoch {epoch:2d} · train mse {train_mse:.5f} · val mse {val_mse:.5f} · "
            f"val r {val_r:.3f} · {time.time() - started:.0f}s"
        )

    if best_state is not None:
        model.load_state_dict(best_state)

    model.eval()
    with torch.no_grad():
        final_pred = model(x[va])
        final_r = correlation(final_pred, y[va])
        final_mse = float(loss_fn(final_pred, y[va]))
        test_pred = model(x[te])
        test_r = correlation(test_pred, y[te])
        test_mse = float(loss_fn(test_pred, y[te]))

    print(
        f"\n验证集：mse {final_mse:.5f} · 相关系数 r={final_r:.3f}"
        f"（标签方差 {float(y.var()):.5f} · 取第 {best_epoch}/{args.epochs} 轮）"
    )
    # 测试集没参与早停，这个数才是能拿去跟别的配置比的
    print(f"测试集：mse {test_mse:.5f} · 相关系数 r={test_r:.3f}")

    note = (
        f"{len(targets)} 个样本训练（PyTorch）· 测试集相关系数 {test_r:.3f}"
        f" · {dim}→{args.hidden1}→{args.hidden2}→1"
    )
    # 导出文件用 base64 存 float32，加载器在 nn/model.ts，不再需要关心 import 路径
    write_weights_ts(model, args.out, note)
    print(f"权重已写入 {args.out}")
    print(f"总耗时 {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
