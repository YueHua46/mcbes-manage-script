"""Build CreeperMenu card artwork, JSON UI textures, and a desktop preview."""

from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).parent / "source" / "creeper-feature-atlas-imagegen.png"
BRAND_BACKGROUND = ROOT / "design" / "brand" / "source" / "background-imagegen.png"
OUTPUT = ROOT / "resource_packs" / "CreeperMenu" / "textures" / "ui" / "creeper_menu"
CARD_OUTPUT = OUTPUT / "cards"
PREVIEW = Path(__file__).parent / "preview.png"
SUBMENU_PREVIEW = Path(__file__).parent / "submenu-preview.png"

CARD_NAMES = (
    "player waypoint land economy guild floating_text pvp stats "
    "quest other help menu_item server_settings shop player_market transfer"
).split()

CARD_COLORS = {
    "player": (42, 98, 88),
    "waypoint": (36, 86, 122),
    "land": (50, 105, 52),
    "economy": (121, 78, 26),
    "guild": (51, 67, 104),
    "floating_text": (30, 104, 108),
    "pvp": (116, 48, 41),
    "stats": (45, 83, 117),
    "quest": (97, 83, 38),
    "other": (76, 58, 102),
    "help": (40, 85, 125),
    "menu_item": (42, 112, 48),
    "server_settings": (57, 68, 72),
    "shop": (106, 71, 28),
    "player_market": (54, 87, 63),
    "transfer": (103, 76, 26),
}


def is_key(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, _ = pixel
    # The generated atlas uses a magenta key with a slight gradient. Include
    # dark antialiased key pixels as long as red and blue remain balanced and
    # clearly dominate green. Flood filling from the atlas edge keeps genuine
    # purple artwork (which is enclosed by its black outline) intact.
    return min(r, b) - g >= 18 and abs(r - b) <= 96 and r + b >= 36


def is_strong_key(pixel: tuple[int, int, int, int]) -> bool:
    """Match unmistakable key color, including holes enclosed by artwork."""
    r, g, b, _ = pixel
    return min(r, b) - g >= 140 and abs(r - b) <= 64 and r + b >= 300


def remove_edge_key(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    queue = deque((x, y) for x in range(width) for y in (0, height - 1))
    queue.extend((x, y) for y in range(height) for x in (0, width - 1))
    seen: set[tuple[int, int]] = set()
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not is_key(pixels[x, y]):
            continue
        seen.add((x, y))
        pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in (
            (x - 1, y - 1),
            (x, y - 1),
            (x + 1, y - 1),
            (x - 1, y),
            (x + 1, y),
            (x - 1, y + 1),
            (x, y + 1),
            (x + 1, y + 1),
        ):
            if 0 <= nx < width and 0 <= ny < height:
                queue.append((nx, ny))
    for y in range(height):
        for x in range(width):
            if is_strong_key(pixels[x, y]):
                pixels[x, y] = (0, 0, 0, 0)
    return image


def connected_components(image: Image.Image) -> list[list[tuple[int, int]]]:
    """Return 8-connected opaque components from a keyed RGBA atlas."""
    width, height = image.size
    alpha = image.getchannel("A")
    visited = bytearray(width * height)
    components: list[list[tuple[int, int]]] = []
    for y in range(height):
        for x in range(width):
            offset = y * width + x
            if visited[offset] or alpha.getpixel((x, y)) == 0:
                continue
            visited[offset] = 1
            queue = deque([(x, y)])
            component: list[tuple[int, int]] = []
            while queue:
                px, py = queue.popleft()
                component.append((px, py))
                for nx, ny in (
                    (px - 1, py - 1),
                    (px, py - 1),
                    (px + 1, py - 1),
                    (px - 1, py),
                    (px + 1, py),
                    (px - 1, py + 1),
                    (px, py + 1),
                    (px + 1, py + 1),
                ):
                    if not (0 <= nx < width and 0 <= ny < height):
                        continue
                    neighbor = ny * width + nx
                    if visited[neighbor] or alpha.getpixel((nx, ny)) == 0:
                        continue
                    visited[neighbor] = 1
                    queue.append((nx, ny))
            if len(component) >= 8:
                components.append(component)
    return components


def extract_cards() -> dict[str, Image.Image]:
    atlas = remove_edge_key(Image.open(SOURCE).convert("RGBA"))
    components_by_cell: list[list[list[tuple[int, int]]]] = [[] for _ in CARD_NAMES]
    for component in connected_components(atlas):
        center_x = sum(point[0] for point in component) / len(component)
        center_y = sum(point[1] for point in component) / len(component)
        column = min(3, int(center_x * 4 / atlas.width))
        row = min(3, int(center_y * 4 / atlas.height))
        components_by_cell[row * 4 + column].append(component)

    cards: dict[str, Image.Image] = {}
    for index, name in enumerate(CARD_NAMES):
        components = components_by_cell[index]
        if not components:
            raise ValueError(f"No connected artwork found for {name}")
        left = min(x for component in components for x, _ in component)
        top = min(y for component in components for _, y in component)
        right = max(x for component in components for x, _ in component) + 1
        bottom = max(y for component in components for _, y in component) + 1
        mask = Image.new("L", atlas.size)
        mask_pixels = mask.load()
        for component in components:
            for x, y in component:
                mask_pixels[x, y] = 255
        subject = Image.new("RGBA", (right - left, bottom - top))
        crop = atlas.crop((left, top, right, bottom))
        subject.paste(crop, (0, 0), mask.crop((left, top, right, bottom)))
        bounds = subject.getchannel("A").getbbox()
        if bounds is None:
            raise ValueError(f"No artwork found for {name}")
        subject = subject.crop(bounds)
        scale = min(88 / subject.width, 82 / subject.height)
        size = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
        subject = subject.resize(size, Image.Resampling.NEAREST)
        canvas = Image.new("RGBA", (96, 96))
        canvas.alpha_composite(subject, ((96 - size[0]) // 2, (88 - size[1]) // 2 + 2))
        canvas.save(CARD_OUTPUT / f"{name}.png", optimize=True)
        cards[name] = canvas
    return cards


def save_nineslice(name: str, image: Image.Image, border: int) -> None:
    image.save(OUTPUT / f"{name}.png", optimize=True)
    (OUTPUT / f"{name}.json").write_text(
        f'{{\n  "base_size": [{image.width}, {image.height}],\n  "nineslice_size": {border}\n}}\n',
        encoding="utf-8",
    )


def make_panel() -> None:
    panel = Image.new("RGBA", (32, 32), (4, 16, 11, 248))
    draw = ImageDraw.Draw(panel)
    draw.rectangle((0, 0, 31, 31), outline=(8, 28, 18, 255), width=2)
    draw.rectangle((2, 2, 29, 29), outline=(57, 111, 43, 255), width=1)
    draw.line((7, 3, 25, 3), fill=(137, 222, 67, 230), width=1)
    draw.line((3, 7, 3, 24), fill=(47, 91, 37, 255), width=1)
    save_nineslice("panel", panel, 8)


def make_card_background(name: str, base: tuple[int, int, int], state: str) -> Image.Image:
    if state == "hover":
        base = tuple(min(255, round(channel * 1.22)) for channel in base)
        border = (151, 232, 76, 255)
        accent = (200, 255, 111, 255)
    elif state == "pressed":
        base = tuple(round(channel * 0.7) for channel in base)
        border = (61, 116, 46, 255)
        accent = (105, 174, 62, 255)
    else:
        border = (31, 66, 39, 255)
        accent = (91, 158, 58, 255)
    image = Image.new("RGBA", (32, 32), (*base, 248))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 31, 31), outline=(8, 18, 13, 255), width=2)
    draw.rectangle((2, 2, 29, 29), outline=border, width=1)
    draw.line((6, 3, 25, 3), fill=accent, width=1)
    draw.rectangle((3, 24, 28, 28), fill=(4, 12, 8, 92))
    draw.point((4, 4), fill=accent)
    draw.point((27, 27), fill=(13, 39, 22, 255))
    return image


def make_runtime_textures() -> None:
    background = Image.open(BRAND_BACKGROUND).convert("RGB")
    side = min(background.size)
    left = (background.width - side) // 2
    top = (background.height - side) // 2
    background.crop((left, top, left + side, top + side)).resize(
        (512, 512), Image.Resampling.LANCZOS
    ).save(OUTPUT / "background.png", optimize=True)
    make_panel()
    for card, base in CARD_COLORS.items():
        for state in ("default", "hover", "pressed"):
            save_nineslice(
                f"cards/{card}_{state}",
                make_card_background(card, base, state),
                8,
            )


def get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_card(
    canvas: Image.Image,
    cards: dict[str, Image.Image],
    name: str,
    label: str,
    rect: tuple[int, int, int, int],
) -> None:
    x, y, width, height = rect
    base = CARD_COLORS[name]
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x, y, x + width, y + height), radius=4, fill=(*base, 244), outline=(15, 30, 20), width=4)
    draw.line((x + 8, y + 5, x + width - 8, y + 5), fill=(137, 222, 67), width=2)
    art = cards[name]
    art_size = min(height - 18, width // 2 + 18, 96)
    art = art.resize((art_size, art_size), Image.Resampling.NEAREST)
    canvas.alpha_composite(art, (x + 7, y + (height - art_size) // 2 - 3))
    font = get_font(max(18, min(30, height // 5)))
    label_box = draw.textbbox((0, 0), label, font=font)
    text_width = label_box[2] - label_box[0]
    text_x = max(x + width - text_width - 12, x + art_size - 4)
    draw.text((text_x + 2, y + height - font.size - 8 + 2), label, font=font, fill=(0, 0, 0, 180))
    draw.text((text_x, y + height - font.size - 8), label, font=font, fill=(236, 247, 232))


def make_preview(cards: dict[str, Image.Image]) -> None:
    background = Image.open(BRAND_BACKGROUND).convert("RGBA").resize((1600, 900), Image.Resampling.LANCZOS)
    background = ImageEnhance.Brightness(background).enhance(0.58)
    overlay = Image.new("RGBA", background.size, (0, 8, 5, 90))
    canvas = Image.alpha_composite(background, overlay)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((48, 48, 1552, 852), radius=10, fill=(3, 16, 10, 230), outline=(88, 167, 53), width=3)
    icon = cards["menu_item"].resize((82, 82), Image.Resampling.NEAREST)
    canvas.alpha_composite(icon, (72, 55))
    draw.text((165, 68), "苦力怕菜单", font=get_font(42), fill=(189, 255, 91))
    draw.text((168, 116), "CREEPER MENU · SERVER HUB", font=get_font(18), fill=(108, 150, 116))

    x0, y0, gap = 70, 165, 12
    left_width, right_x, right_width = 1010, 1092, 438
    row_h = 210
    draw_card(canvas, cards, "player", "玩家操作", (x0, y0, 326, row_h))
    draw_card(canvas, cards, "waypoint", "坐标点", (x0 + 338, y0, 326, row_h))
    draw_card(canvas, cards, "land", "领地管理", (x0 + 676, y0, 334, row_h))
    draw_card(canvas, cards, "economy", "经济系统", (x0, y0 + 222, 396, row_h))
    draw_card(canvas, cards, "guild", "公会", (x0 + 408, y0 + 222, 294, row_h))
    draw_card(canvas, cards, "pvp", "PVP", (x0 + 714, y0 + 222, 296, row_h))
    draw_card(canvas, cards, "quest", "任务系统", (x0, y0 + 444, 414, row_h))
    draw_card(canvas, cards, "stats", "数据统计", (x0 + 426, y0 + 444, 252, row_h))
    draw_card(canvas, cards, "other", "其他功能", (x0 + 690, y0 + 444, 320, row_h))
    draw_card(canvas, cards, "menu_item", "菜单道具", (right_x, y0, right_width, 294))
    draw_card(canvas, cards, "floating_text", "悬浮文字", (right_x, y0 + 306, 258, 164))
    draw_card(canvas, cards, "help", "帮助", (right_x + 270, y0 + 306, 168, 164))
    draw_card(canvas, cards, "server_settings", "服务器设置", (right_x, y0 + 482, right_width, 172))
    canvas.convert("RGB").save(PREVIEW, quality=95)


def make_submenu_preview(cards: dict[str, Image.Image]) -> None:
    background = Image.open(BRAND_BACKGROUND).convert("RGBA").resize((1600, 900), Image.Resampling.LANCZOS)
    background = ImageEnhance.Brightness(background).enhance(0.5)
    canvas = Image.alpha_composite(background, Image.new("RGBA", background.size, (0, 8, 5, 110)))
    draw = ImageDraw.Draw(canvas)
    dialog = (270, 70, 1330, 830)
    draw.rounded_rectangle(dialog, radius=10, fill=(3, 16, 10, 238), outline=(88, 167, 53), width=3)
    icon = cards["economy"].resize((72, 72), Image.Resampling.NEAREST)
    canvas.alpha_composite(icon, (298, 82))
    draw.text((382, 91), "经济系统", font=get_font(38), fill=(189, 255, 91))
    draw.text((384, 137), "选择你要使用的经济功能", font=get_font(18), fill=(132, 164, 139))

    rows = [
        ("shop", "官方商店", "购买服务器商品与限时物资"),
        ("player_market", "玩家交易市场", "浏览和管理玩家挂单"),
        ("transfer", "金币转账", "向在线玩家安全转账"),
        ("economy", "红包", "发送或领取服务器红包"),
        ("other", "出售背包物品", "按服务器回收价快速出售"),
    ]
    y = 190
    for name, title, description in rows:
        base = CARD_COLORS[name]
        draw.rounded_rectangle((300, y, 1300, y + 104), radius=5, fill=(*base, 242), outline=(41, 92, 48), width=3)
        draw.line((310, y + 5, 1290, y + 5), fill=(137, 222, 67), width=2)
        art = cards[name].resize((88, 88), Image.Resampling.NEAREST)
        canvas.alpha_composite(art, (312, y + 7))
        draw.text((418, y + 19), title, font=get_font(28), fill=(236, 247, 232))
        draw.text((420, y + 61), description, font=get_font(17), fill=(178, 204, 184))
        draw.text((1252, y + 36), "›", font=get_font(32), fill=(189, 255, 91))
        y += 116
    canvas.convert("RGB").save(SUBMENU_PREVIEW, quality=95)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    CARD_OUTPUT.mkdir(parents=True, exist_ok=True)
    cards = extract_cards()
    make_runtime_textures()
    make_preview(cards)
    make_submenu_preview(cards)
    print(f"Built {len(cards)} card illustrations and previews in {PREVIEW.parent}")


if __name__ == "__main__":
    main()
