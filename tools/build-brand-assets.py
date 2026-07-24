#!/usr/bin/env python3
"""Build Creeper Menu brand images without modifying the in-game menu item."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = ROOT / "design/brand/source/background-imagegen.png"
MENU_ITEM = ROOT / "resource_packs/CreeperMenu/textures/items/sm.png"
BEHAVIOR_ICON = ROOT / "behavior_packs/CreeperMenu/pack_icon.png"
RESOURCE_ICON = ROOT / "resource_packs/CreeperMenu/pack_icon.png"
BANNER = ROOT / "docs/images/creeper-menu-banner.png"

LIME = "#8BC84A"
LIME_BRIGHT = "#A8ED5C"
DARK = "#0B1711"
DEEP_GREEN = "#10241A"
MUTED = "#59705E"
WHITE = "#F3F8EF"
TEXT_MUTED = "#B8C7B9"


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize and center-crop an image to cover a target rectangle."""
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def dark_background(size: tuple[int, int]) -> Image.Image:
    source = Image.open(BACKGROUND).convert("RGB")
    background = cover(source, size)
    background = ImageEnhance.Color(background).enhance(0.72)
    background = ImageEnhance.Brightness(background).enhance(0.42)
    tint = Image.new("RGBA", size, (*ImageColor_getrgb(DEEP_GREEN), 92))
    return Image.alpha_composite(background.convert("RGBA"), tint)


def ImageColor_getrgb(value: str) -> tuple[int, int, int]:
    return tuple(int(value[index : index + 2], 16) for index in (1, 3, 5))


def draw_corner_marks(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    *,
    length: int,
    width: int,
) -> None:
    left, top, right, bottom = box
    color = MUTED
    draw.line((left, top + length, left, top, left + length, top), fill=color, width=width)
    draw.line(
        (right - length, bottom, right, bottom, right, bottom - length),
        fill=color,
        width=width,
    )


def menu_item_scaled(pixel_size: int) -> Image.Image:
    item = Image.open(MENU_ITEM).convert("RGBA")
    if item.size != (16, 16):
        raise ValueError(f"Expected the menu item to remain 16×16, got {item.size}")
    return item.resize((pixel_size, pixel_size), Image.Resampling.NEAREST)


def draw_emblem(canvas: Image.Image, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    width = right - left
    draw = ImageDraw.Draw(canvas)

    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.rectangle(box, outline=(*ImageColor_getrgb(LIME_BRIGHT), 155), width=max(4, width // 52))
    glow = glow.filter(ImageFilter.GaussianBlur(max(8, width // 18)))
    canvas.alpha_composite(glow)

    outer_width = max(4, width // 52)
    inner_width = max(3, width // 82)
    draw.rectangle(box, fill=DARK, outline=LIME, width=outer_width)

    inset = width // 15
    inner_box = (left + inset, top + inset, right - inset, bottom - inset)
    draw.rectangle(inner_box, outline="#365C31", width=inner_width)

    corner_inset = width // 9
    corner_box = (
        left + corner_inset,
        top + corner_inset,
        right - corner_inset,
        bottom - corner_inset,
    )
    draw_corner_marks(
        draw,
        corner_box,
        length=width // 9,
        width=max(3, width // 58),
    )

    item_size = (width // 16) * 8
    item = menu_item_scaled(item_size)
    item_left = left + (width - item_size) // 2
    item_top = top + (width - item_size) // 2
    canvas.alpha_composite(item, (item_left, item_top))


def find_font(preferred_size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("/System/Library/Fonts/STHeiti Medium.ttc"),
        Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    if not bold:
        candidates[0], candidates[1] = candidates[1], candidates[0]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), preferred_size)
    raise FileNotFoundError("Install a CJK font such as Noto Sans CJK to rebuild the banner.")


def build_pack_icon() -> Image.Image:
    icon = dark_background((256, 256))
    draw_emblem(icon, (25, 25, 231, 231))
    return icon.convert("RGB")


def build_banner() -> Image.Image:
    banner = dark_background((1600, 640))
    draw = ImageDraw.Draw(banner)
    draw.rectangle((22, 22, 1578, 618), outline="#4F7D39", width=3)

    draw_emblem(banner, (96, 96, 544, 544))

    eyebrow_font = find_font(32, bold=True)
    title_font = find_font(92, bold=True)
    subtitle_font = find_font(34)
    draw.text((650, 118), "C R E E P E R   M E N U", font=eyebrow_font, fill=LIME_BRIGHT)
    draw.text((646, 178), "苦力怕菜单", font=title_font, fill=WHITE)
    draw.rectangle((650, 315, 858, 324), fill=LIME_BRIGHT)
    draw.text((650, 370), "Minecraft 基岩版服务器菜单附加包", font=subtitle_font, fill=TEXT_MUTED)
    draw.text((650, 430), "把常用服务器功能集中在一个菜单道具里", font=subtitle_font, fill=TEXT_MUTED)
    return banner.convert("RGB")


def main() -> None:
    for path in (BEHAVIOR_ICON, RESOURCE_ICON, BANNER):
        path.parent.mkdir(parents=True, exist_ok=True)

    icon = build_pack_icon()
    icon.save(BEHAVIOR_ICON, "PNG", optimize=True)
    icon.save(RESOURCE_ICON, "PNG", optimize=True)
    build_banner().save(BANNER, "PNG", optimize=True)

    print(f"Wrote {BEHAVIOR_ICON.relative_to(ROOT)}")
    print(f"Wrote {RESOURCE_ICON.relative_to(ROOT)}")
    print(f"Wrote {BANNER.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
