"""生成 PWA 图标：python scripts/make-icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PUBLIC = Path(__file__).resolve().parent.parent / "public"
BG = (25, 137, 250)
FG = (255, 255, 255)


def find_font(size: int):
    for name in ("msyhbd.ttc", "msyh.ttc", "simhei.ttf", "PingFang.ttc", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make(size: int, filename: str, radius_ratio: float = 0.0) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=BG)
    font = find_font(int(size * 0.5))
    text = "账"
    box = draw.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), text, font=font, fill=FG)
    img.save(PUBLIC / filename)


if __name__ == "__main__":
    PUBLIC.mkdir(exist_ok=True)
    # iOS 会自己加圆角，apple-touch-icon 用直角
    make(180, "apple-touch-icon.png")
    make(192, "pwa-192.png")
    make(512, "pwa-512.png")
    print("icons written to", PUBLIC)
