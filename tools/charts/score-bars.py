"""和牌得分分布：两张纯柱状图
  A) (分值, = 该分值的频率)
  B) (分值, ≤ 该分值的频率)  累计

用法：python .temp/draw-score-bars.py
输出：.data/得分分布-等于.png / 得分分布-小于等于.png
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
STATS = json.loads((ROOT / ".data" / "yaku-stats-last.json").read_text(encoding="utf-8"))

TIERS = [
    (1, "#7c9a86"),
    (2, "#5cb98a"),
    (4, "#a9cf5c"),
    (6, "#e6c34a"),
    (8, "#f0a24a"),
    (12, "#f2725f"),
    (16, "#e05ca8"),
    (24, "#c884ff"),
]

FONT_DIR = Path("C:/Windows/Fonts")


def font(size, bold=False, light=False):
    name = "msyhbd.ttc" if bold else ("msyhl.ttc" if light else "msyh.ttc")
    return ImageFont.truetype(str(FONT_DIR / name), size)


def hex_to_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def tier_color(score):
    color = TIERS[0][1]
    for points, value in TIERS:
        if points <= score:
            color = value
    return hex_to_rgb(color)


INK = (32, 36, 44)
MUTED = (122, 130, 142)
GRID = (236, 239, 244)
AXIS = (203, 209, 218)
BG = (255, 255, 255)

games = STATS["games"]
rounds = STATS["rounds"]
wins = STATS["wins"]
hist = {int(k): v for k, v in STATS["hist"].items()}
scores = sorted(hist)

cumulative = {}
running = 0
for score in scores:
    running += hist[score]
    cumulative[score] = running

W, H = 1560, 940
LEFT, RIGHT = 132, 1496
TOP, BOTTOM = 210, 760


def render(out_name, title, subtitle, value_of, y_max, tick_step, note, decimals=2):
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    draw.text((48, 30), title, font=font(36, bold=True), fill=INK)
    draw.text((50, 84), subtitle, font=font(18), fill=MUTED)

    def y_of(pct):
        return int(BOTTOM - (BOTTOM - TOP) * pct / y_max)

    # 网格与 y 轴刻度
    tick = 0
    while tick <= y_max + 1e-9:
        y = y_of(tick)
        draw.line([(LEFT, y), (RIGHT, y)], fill=GRID, width=1)
        draw.text((LEFT - 14, y), f"{tick:g}%", font=font(14), fill=MUTED, anchor="rm")
        tick += tick_step
    draw.line([(LEFT, BOTTOM), (RIGHT, BOTTOM)], fill=AXIS, width=2)
    draw.line([(LEFT, TOP), (LEFT, BOTTOM)], fill=AXIS, width=2)

    step = (RIGHT - LEFT) / len(scores)
    bar_w = step * 0.58

    for index, score in enumerate(scores):
        x = LEFT + step * (index + 0.5)
        value = value_of(score)
        top = min(y_of(value), BOTTOM - 3)
        draw.rounded_rectangle(
            [
                int(x - bar_w / 2),
                int(top),
                int(x + bar_w / 2),
                BOTTOM - 2,
            ],
            radius=5,
            fill=tier_color(score),
        )
        label = f"{value:.{decimals}f}%"
        draw.text((x, top - 10), label, font=font(15, bold=True), fill=INK, anchor="mb")
        draw.text((x, BOTTOM + 14), str(score), font=font(16), fill=INK, anchor="ma")
        draw.text(
            (x, BOTTOM + 40),
            f"{hist[score]:,}",
            font=font(12),
            fill=MUTED,
            anchor="ma",
        )

    draw.text(((LEFT + RIGHT) / 2, BOTTOM + 70), "和牌得分 S", font=font(16), fill=MUTED, anchor="ma")
    draw.text(
        (LEFT - 14, TOP - 28), "频率", font=font(14, bold=True), fill=MUTED, anchor="rm"
    )
    draw.text(
        (LEFT - 14, BOTTOM + 40), "手数", font=font(12), fill=MUTED, anchor="rm"
    )

    draw.text((48, H - 52), note, font=font(15), fill=MUTED)
    draw.text(
        (W - 48, H - 32),
        "铜雀 · 4 人麻将 · 40,000 局 / 160,000 本场",
        font=font(13),
        fill=(176, 182, 192),
        anchor="ra",
    )

    path = ROOT / ".data" / out_name
    img.save(path)
    print(f"saved {path.name} {W}x{H}")


render(
    "得分分布-等于.png",
    "铜雀 · 和牌得分分布（= 该分值）",
    f"和牌 {wins:,} 手 · 柱高 = 该分值占全部和牌的比例 · 横轴下排数字为手数",
    lambda score: hist[score] / wins * 100,
    y_max=40,
    tick_step=10,
    note="5 分档比 6 分档少：Σ=5 只能由 3+2、3+1+1、2+2+1 组合，而 Σ=6 有 6 分单番、3+3、3+2+1、2+2+2 多条路径",
)

render(
    "得分分布-小于等于.png",
    "铜雀 · 和牌得分分布（≤ 该分值，累计）",
    f"和牌 {wins:,} 手 · 柱高 = 得分不高于该分值的和牌占比",
    lambda score: cumulative[score] / wins * 100,
    y_max=100,
    tick_step=20,
      note=(
          f"≥12 分（界面发光档）只占 "
          f"{sum(hist[s] for s in hist if s >= 12) / wins * 100:.2f}%；"
          f"≤4 分已覆盖 {cumulative[4] / wins * 100:.2f}% 的和牌"
      ),
    decimals=1,
)
