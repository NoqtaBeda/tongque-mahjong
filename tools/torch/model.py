"""PyTorch 侧的公共部分：读数据、切分、模型、指标。

与 `packages/core/src/ai/nn/mlp.ts` 保持严格对应：
    120 -> 128 -> 64 -> 1，隐藏层 ReLU，输出层线性，MSE 回归。
"""

import struct

import numpy as np
import torch
from torch import nn

#: 与 tools/train/train.ts 一致：标签先除以 12 再回归
SCALE = 12.0


def load(path):
    """读 gen.ts 的二进制：uint32 count / uint32 dim / uint32 groups[count] / count×(dim+1) float32。"""
    raw = open(path, "rb").read()
    count, dim = struct.unpack_from("<II", raw, 0)
    groups = np.frombuffer(raw, dtype=np.uint32, count=count, offset=8).astype(np.int64)
    body = np.frombuffer(
        raw, dtype=np.float32, count=count * (dim + 1), offset=8 + count * 4
    ).reshape(count, dim + 1)
    features = body[:, :dim].copy()
    targets = (body[:, dim] / SCALE).copy()
    return features, targets, groups, dim


def load_many(paths):
    """把多个 .bin 拼起来（不同文件的 group 编号要错开）。"""
    features, targets, groups, dim = [], [], [], 0
    offset = 0
    for path in paths:
        f, t, g, d = load(path)
        if dim == 0:
            dim = d
        elif dim != d:
            raise ValueError(f"维度不一致：{path} 是 {d}，前面是 {dim}")
        features.append(f)
        targets.append(t)
        groups.append(g + offset)
        offset += int(g.max()) + 1
    return (
        np.concatenate(features),
        np.concatenate(targets),
        np.concatenate(groups),
        dim,
    )


def split_by_group(groups, valid_ratio=0.2, seed=7):
    """按本场分组切分：同一本场的样本高度相关，按行随机切分会让验证集泄漏。"""
    unique = np.unique(groups)
    rng = np.random.default_rng(seed)
    rng.shuffle(unique)
    cut = max(1, int(len(unique) * (1 - valid_ratio)))
    train_groups = set(unique[:cut].tolist())
    mask = np.array([g in train_groups for g in groups])
    return np.flatnonzero(mask), np.flatnonzero(~mask)


def split_by_group3(groups, valid_ratio=0.15, test_ratio=0.15, seed=7):
    """三分割：早停用验证集，最终指标看测试集。

    只有一个验证集时，早停选出的轮次本身就"看过"验证集，报告出来的相关系数是偏高的，
    不同配置之间也就没法公平比较。
    """
    unique = np.unique(groups)
    rng = np.random.default_rng(seed)
    rng.shuffle(unique)

    total = len(unique)
    valid_cut = max(1, int(total * valid_ratio))
    test_cut = max(1, int(total * test_ratio))
    valid_groups = set(unique[:valid_cut].tolist())
    test_groups = set(unique[valid_cut : valid_cut + test_cut].tolist())

    valid_mask = np.array([g in valid_groups for g in groups])
    test_mask = np.array([g in test_groups for g in groups])
    train_mask = ~valid_mask & ~test_mask
    return np.flatnonzero(train_mask), np.flatnonzero(valid_mask), np.flatnonzero(test_mask)


class Mlp(nn.Module):
    """120 -> h1 -> h2 -> 1，与 TS 侧的 `MlpWeights` 逐项对应。"""

    def __init__(self, dim, h1=128, h2=64):
        super().__init__()
        self.fc1 = nn.Linear(dim, h1)
        self.fc2 = nn.Linear(h1, h2)
        self.fc3 = nn.Linear(h2, 1)

    def forward(self, x):
        x = torch.relu(self.fc1(x))
        x = torch.relu(self.fc2(x))
        return self.fc3(x).squeeze(-1)


def correlation(pred, truth):
    pred = pred - pred.mean()
    truth = truth - truth.mean()
    denom = float(torch.linalg.vector_norm(pred) * torch.linalg.vector_norm(truth))
    return 0.0 if denom == 0 else float((pred * truth).sum() / denom)


def pick_device():
    return "cuda" if torch.cuda.is_available() else "cpu"
