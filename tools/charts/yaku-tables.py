"""番种表两张图：
  1) 按出现率降序
  2) 按分值升序
出现率用「绿=常见 → 橙 → 红 → 紫=稀有」的色阶；番种名用 UI 的分值色阶。

用法：python .temp/draw-yaku-tables.py
输出：.data/番种统计-按出现率.png / 番种统计-按分值.png
"""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# 当前规则的番种总数（2026-11-20 调整后为 50：删除二连刻）
RULE_YAKU_TOTAL = 50

ROOT = Path(__file__).resolve().parents[2]
STATS = json.loads((ROOT / ".data" / "yaku-stats-last.json").read_text(encoding="utf-8"))

TIERS = [
    (1, "#7c9a86", "灰绿"),
    (2, "#5cb98a", "绿"),
    (3, "#a9cf5c", "黄绿"),
    (6, "#e6c34a", "黄"),
    (8, "#f0a24a", "橙"),
    (12, "#f2725f", "桔红"),
    (16, "#e05ca8", "粉"),
    (24, "#c884ff", "紫"),
]

# 出现率色阶：绿 = 常见 → 橙 → 红 → 紫 = 稀有（t=1 最常见）
RATE_STOPS = [
    (0.00, "#7b2fbf"),  # 紫（最稀有）
    (0.18, "#b8336a"),
    (0.36, "#e2453a"),  # 红
    (0.56, "#f08c1a"),  # 橙
    (0.78, "#9ec93f"),  # 黄绿
    (1.00, "#1b7f3b"),  # 绿（最常见）
]

FONT_DIR = Path("C:/Windows/Fonts")


def font(size, bold=False, light=False):
    name = "msyhbd.ttc" if bold else ("msyhl.ttc" if light else "msyh.ttc")
    return ImageFont.truetype(str(FONT_DIR / name), size)


def hex_to_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def stop_color(stops, t):
    t = max(0.0, min(1.0, t))
    for index in range(len(stops) - 1):
        left = stops[index]
        right = stops[index + 1]
        if left[0] <= t <= right[0]:
            span = right[0] - left[0]
            local = 0.0 if span == 0 else (t - left[0]) / span
            return mix(hex_to_rgb(left[1]), hex_to_rgb(right[1]), local)
    return hex_to_rgb(stops[-1][1])


def tier_of(points):
    chosen = TIERS[0]
    for tier in TIERS:
        if tier[0] <= points:
            chosen = tier
    return chosen


INK = (32, 36, 44)
MUTED = (122, 130, 142)
LINE = (223, 227, 233)
BG = (255, 255, 255)

wins = STATS["wins"]
rounds = STATS["rounds"]
games = STATS["games"]

rows = []
for key, slot in STATS["yaku"].items():
    rows.append(
        {
            "name": slot["name"],
            "points": slot["points"],
            "count": slot["count"],
            "rate": slot["count"] / wins,
            "avg": slot["scoreSum"] / slot["count"],
        }
    )

log_min = math.log10(min(row["rate"] for row in rows))
log_max = math.log10(max(row["rate"] for row in rows))


def rate_color(rate):
    t = (math.log10(rate) - log_min) / (log_max - log_min) if log_max > log_min else 0.5
    return stop_color(RATE_STOPS, t)


def rate_text(rate):
    percent = rate * 100
    return f"{percent:.2f}%" if percent >= 0.01 else f"{percent:.3f}%"


def render(sorted_rows, title, subtitle, split_at, out_name):
    W, H = 1640, 1128
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    draw.text((44, 28), title, font=font(38, bold=True), fill=INK)
    draw.text((46, 82), subtitle, font=font(18), fill=MUTED)

    left_x = 44
    col_w = 660
    row_h = 32
    top_y = 172

    for column in range(2):
        if column == 0:
            chunk = sorted_rows[:split_at]
        else:
            chunk = sorted_rows[split_at:]
        x0 = left_x + column * col_w

        lanes = {"points": 250, "count": 366, "rate": 502, "avg": 616}
        headers = [
            ("番种", 34, "lm"),
            ("分值", lanes["points"], "rm"),
            ("次数", lanes["count"], "rm"),
            ("出现率", lanes["rate"], "rm"),
            ("均打点", lanes["avg"], "rm"),
        ]
        for label, offset, anchor in headers:
            draw.text(
                (x0 + offset, top_y - 26), label, font=font(17, bold=True), fill=INK, anchor=anchor
            )
        draw.line([(x0, top_y - 4), (x0 + col_w - 34, top_y - 4)], fill=LINE, width=2)

        previous_points = None
        for index, row in enumerate(chunk):
            y = top_y + index * row_h
            # 分值变化处画一条分隔线（按分值排序时能看出分档）
            if previous_points is not None and row["points"] != previous_points:
                draw.line(
                    [(x0, y - 3), (x0 + col_w - 34, y - 3)], fill=(233, 236, 242), width=1
                )
            previous_points = row["points"]

            if index % 2 == 1:
                draw.rectangle(
                    [x0 - 6, y - 2, x0 + col_w - 34, y + row_h - 6], fill=(249, 250, 252)
                )
            tier = tier_of(row["points"])
            draw.rounded_rectangle(
                [x0 + 2, y + 7, x0 + 18, y + 23], radius=4, fill=hex_to_rgb(tier[1])
            )
            draw.text((x0 + 28, y + 4), row["name"], font=font(17), fill=hex_to_rgb(tier[1]))
            draw.text(
                (x0 + lanes["points"], y + 4),
                str(row["points"]),
                font=font(16),
                fill=MUTED,
                anchor="ra",
            )
            draw.text(
                (x0 + lanes["count"], y + 4),
                f"{row['count']:,}",
                font=font(16),
                fill=MUTED,
                anchor="ra",
            )
            draw.text(
                (x0 + lanes["rate"], y + 4),
                rate_text(row["rate"]),
                font=font(16, bold=True),
                fill=rate_color(row["rate"]),
                anchor="ra",
            )
            draw.text(
                (x0 + lanes["avg"], y + 4),
                f"{row['avg']:.2f}",
                font=font(16),
                fill=MUTED,
                anchor="ra",
            )

    draw.line(
        [(left_x + col_w - 30, top_y - 26), (left_x + col_w - 30, top_y + split_at * row_h)],
        fill=(238, 241, 246),
        width=2,
    )

    # ── 图例 ──
    legend_y = H - 118
    draw.text((44, legend_y - 30), "色阶说明", font=font(16, bold=True), fill=INK)
    x = 44
    for points_value, color, label in TIERS:
        draw.rounded_rectangle(
            [x, legend_y - 6, x + 18, legend_y + 12], radius=4, fill=hex_to_rgb(color)
        )
        draw.text((x + 24, legend_y - 6), f"{label}·{points_value}", font=font(14), fill=MUTED)
        x += 104
    draw.text((x + 10, legend_y - 6), "← 番种名与左侧小方块 = 分值色阶", font=font(14), fill=MUTED)

    # 出现率渐变条（稀有 → 常见）
    draw.text((44, legend_y + 30), "出现率", font=font(15, bold=True), fill=INK)
    grad_x = 118
    grad_w = 320
    for step in range(grad_w):
        t = 1 - step / grad_w  # 左=稀有 右=常见
        color = stop_color(RATE_STOPS, t)
        draw.line([(grad_x + step, legend_y + 30), (grad_x + step, legend_y + 52)], fill=color)
    draw.text((grad_x - 6, legend_y + 58), "稀有", font=font(13), fill=MUTED, anchor="ma")
    draw.text((grad_x + grad_w + 6, legend_y + 58), "常见", font=font(13), fill=MUTED, anchor="ma")
    draw.text(
        (grad_x + grad_w + 40, legend_y + 28),
        f"按对数映射 {rate_text(min(r['rate'] for r in rows))} – "
        f"{rate_text(max(r['rate'] for r in rows))}",
        font=font(14),
        fill=MUTED,
    )

    draw.text(
        (W - 44, H - 26),
        f"铜雀 · 4 人麻将 · {games:,} 局 / {rounds:,} 本场 · 和牌 {wins:,} 手",
        font=font(13),
        fill=(176, 182, 192),
        anchor="ra",
    )

    path = ROOT / ".data" / out_name
    img.save(path)
    print(f"saved {path.name} {W}x{H}")


by_rate = sorted(rows, key=lambda row: -row["rate"])
by_points = sorted(rows, key=lambda row: (row["points"], -row["rate"]))

render(
    by_rate,
    "铜雀 · 番种出现率（按出现率降序）",
    f"{games:,} 局 / {rounds:,} 本场 · 和牌 {wins:,} 手 · 平均打点 {STATS['scoreSum'] / wins:.2f}"
    " · 出现率 = 该番种出现的和牌手数 / 和牌总手数",
    split_at=25,
    out_name="番种统计-按出现率.png",
)

render(
    by_points,
    "铜雀 · 番种一览（按分值升序）",
    f"同一分值内按出现率降序 · 共 {len(by_points)} 种出现过（当前规则共 {RULE_YAKU_TOTAL} 种）"
    " · 出现率 = 该番种出现的和牌手数 / 和牌总手数",
    split_at=24,
    out_name="番种统计-按分值.png",
)
