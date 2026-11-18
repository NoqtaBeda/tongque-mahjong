"""PyTorch 训练管线的冒烟测试：读真实数据、跑几轮、报告验证集相关系数。

和 tools/torch/train.py 用的是同一套 `model.py`，只是参数更保守、更适合"能不能跑通"这个目的。

用法：
    python tools/torch/smoke.py [--data=.data/chunk-50001.bin] [--epochs=20] [--repeat=60]
"""

import argparse
import os
import sys
import time

import numpy as np
import torch
from torch import nn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from model import Mlp, correlation, load_many, pick_device, split_by_group  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=".data/chunk-50001.bin")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--hidden1", type=int, default=128)
    ap.add_argument("--hidden2", type=int, default=64)
    # 小数据可以平铺放大，用来估算真实规模下的吞吐（指标无意义）
    ap.add_argument("--repeat", type=int, default=1)
    args = ap.parse_args()

    torch.manual_seed(7)
    device = pick_device()

    files = [path.strip() for path in args.data.split(",") if path.strip()]
    features, targets, groups, dim = load_many(files)
    if args.repeat > 1:
        features = np.tile(features, (args.repeat, 1))
        targets = np.tile(targets, args.repeat)
        groups = np.concatenate(
            [groups + index * (groups.max() + 1) for index in range(args.repeat)]
        )

    train_idx, val_idx = split_by_group(groups)
    print(
        f"样本 {len(targets)} · 维度 {dim} · 训练 {len(train_idx)} / 验证 {len(val_idx)} · "
        f"标签均值 {targets.mean() * 12:.3f} 分 · 方差 {targets.var():.5f}"
    )
    print(f"设备 {device}" + (f" ({torch.cuda.get_device_name(0)})" if device == "cuda" else ""))

    x = torch.from_numpy(features).to(device)
    y = torch.from_numpy(targets).to(device)
    tr = torch.from_numpy(train_idx).to(device)
    va = torch.from_numpy(val_idx).to(device)

    model = Mlp(dim, args.hidden1, args.hidden2).to(device)
    print(f"参数量 {sum(p.numel() for p in model.parameters())}")

    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    loss_fn = nn.MSELoss()

    best_r, best_epoch, best_state = -1.0, 0, None
    started = time.time()

    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = tr[torch.randperm(tr.numel(), device=device)]
        for start in range(0, perm.numel(), args.batch):
            idx = perm[start : start + args.batch]
            optimizer.zero_grad()
            loss = loss_fn(model(x[idx]), y[idx])
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
            f"val r {val_r:.3f} · {time.time() - started:.1f}s"
        )

    if best_state is not None:
        model.load_state_dict(best_state)

    model.eval()
    with torch.no_grad():
        final_pred = model(x[va])
        final_r = correlation(final_pred, y[va])
        final_mse = float(loss_fn(final_pred, y[va]))

    elapsed = time.time() - started
    print(
        f"\n验证集：mse {final_mse:.5f} · 相关系数 r={final_r:.3f} "
        f"（标签方差 {float(y.var()):.5f} · 取第 {best_epoch}/{args.epochs} 轮）"
    )
    print(
        f"总耗时 {elapsed:.1f}s · 每轮 {elapsed / args.epochs:.2f}s · "
        f"{len(train_idx) / (elapsed / args.epochs):.0f} 样本/秒"
    )


if __name__ == "__main__":
    main()
