"""Build CreeperMenu card artwork, JSON UI textures, and a desktop preview."""

from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).parent / "source" / "creeper-feature-atlas-cozy-imagegen.png"
LEFT_MOSAIC_SOURCE = Path(__file__).parent / "source" / "creeper-mosaic-left-323-imagegen.png"
RIGHT_MOSAIC_SOURCE = Path(__file__).parent / "source" / "creeper-mosaic-right-113-imagegen.png"
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
    "player": (174, 211, 219),
    "waypoint": (192, 218, 199),
    "land": (215, 228, 183),
    "economy": (241, 214, 166),
    "guild": (202, 201, 224),
    "floating_text": (184, 218, 211),
    "pvp": (232, 187, 179),
    "stats": (188, 207, 230),
    "quest": (240, 219, 173),
    "other": (216, 198, 223),
    "help": (194, 216, 232),
    "menu_item": (201, 219, 181),
    "server_settings": (207, 214, 213),
    "shop": (242, 210, 163),
    "player_market": (193, 218, 199),
    "transfer": (238, 216, 174),
}

ROOT_CARD_LABELS = {
    "player": "玩家操作",
    "waypoint": "坐标点",
    "land": "领地管理",
    "economy": "经济系统",
    "guild": "公会",
    "pvp": "PVP系统",
    "stats": "数据统计",
    "other": "其他功能",
    "quest": "任务系统",
    "menu_item": "菜单道具",
    "floating_text": "悬浮文字",
    "help": "帮助",
    "server_settings": "设置",
}

# Crop boxes follow the authored separators in the two fixed source atlases.
# Each scene is composed for the same aspect class used by the runtime mosaic.
SCENE_SPECS = {
    "player": ("left", (12, 13, 516, 380), (192, 128), "top_right"),
    "waypoint": ("left", (528, 13, 1010, 380), (192, 128), "top_right"),
    "land": ("left", (1023, 13, 1528, 380), (192, 128), "top_right"),
    "economy": ("left", (12, 392, 758, 695), (288, 128), "top_right"),
    "guild": ("left", (771, 392, 1528, 695), (288, 128), "top_right"),
    "pvp": ("left", (12, 707, 481, 1012), (192, 128), "top_right"),
    "stats": ("left", (494, 707, 988, 1012), (192, 128), "top_right"),
    "other": ("left", (1000, 707, 1528, 1012), (192, 128), "top_right"),
    "quest": ("right", (16, 16, 1008, 756), (256, 192), "bottom_left"),
    "menu_item": ("right", (16, 773, 1008, 1141), (288, 96), "right_middle"),
    "floating_text": ("right", (16, 1157, 320, 1520), (128, 128), "top_right"),
    "help": ("right", (336, 1157, 646, 1520), (128, 128), "top_right"),
    "server_settings": ("right", (662, 1157, 1008, 1520), (128, 128), "top_right"),
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


def extract_scene_cards() -> dict[str, Image.Image]:
    """Crop every root card from its final-ratio authored mosaic atlas."""
    atlases = {
        "left": Image.open(LEFT_MOSAIC_SOURCE).convert("RGB"),
        "right": Image.open(RIGHT_MOSAIC_SOURCE).convert("RGB"),
    }
    if atlases["left"].size != (1536, 1024):
        raise ValueError(f"Unexpected left mosaic size: {atlases['left'].size}")
    if atlases["right"].size != (1024, 1536):
        raise ValueError(f"Unexpected right mosaic size: {atlases['right'].size}")

    scenes: dict[str, Image.Image] = {}
    for name, (atlas_name, box, output_size, _label_anchor) in SCENE_SPECS.items():
        scenes[name] = atlases[atlas_name].crop(box).resize(output_size, Image.Resampling.NEAREST)
    return scenes


def save_nineslice(name: str, image: Image.Image, border: int) -> None:
    image.save(OUTPUT / f"{name}.png", optimize=True)
    (OUTPUT / f"{name}.json").write_text(
        f'{{\n  "base_size": [{image.width}, {image.height}],\n  "nineslice_size": {border}\n}}\n',
        encoding="utf-8",
    )


def make_panels() -> None:
    submenu = Image.new("RGBA", (32, 32))
    draw = ImageDraw.Draw(submenu)
    draw.rounded_rectangle(
        (0, 0, 31, 31),
        radius=7,
        fill=(244, 238, 224, 246),
        outline=(67, 58, 49, 255),
        width=2,
    )
    draw.arc((3, 3, 28, 28), 195, 342, fill=(255, 252, 241, 235), width=1)
    save_nineslice("submenu_panel", submenu, 8)

    close_frame = Image.new("RGBA", (16, 16))
    draw = ImageDraw.Draw(close_frame)
    draw.rounded_rectangle(
        (0, 0, 15, 15),
        radius=4,
        fill=(47, 42, 37, 125),
        outline=(255, 252, 240, 255),
        width=2,
    )
    save_nineslice("close_frame", close_frame, 4)

    icon_chip = Image.new("RGBA", (16, 16))
    draw = ImageDraw.Draw(icon_chip)
    draw.rounded_rectangle(
        (0, 0, 15, 15),
        radius=4,
        fill=(207, 220, 199, 250),
        outline=(86, 75, 62, 255),
        width=2,
    )
    draw.arc((2, 2, 13, 13), 195, 335, fill=(255, 252, 239, 255), width=1)
    save_nineslice("icon_chip", icon_chip, 4)

    line = Image.new("RGBA", (8, 1), (126, 113, 96, 120))
    line.save(OUTPUT / "line.png", optimize=True)


def make_card_background(name: str, base: tuple[int, int, int], state: str) -> Image.Image:
    if state == "hover":
        base = tuple(min(255, round(channel + (255 - channel) * 0.14)) for channel in base)
        border = (255, 249, 224, 255)
        accent = (255, 253, 240, 255)
    elif state == "pressed":
        base = tuple(round(channel * 0.88) for channel in base)
        border = (84, 73, 61, 255)
        accent = (225, 211, 184, 255)
    else:
        border = (72, 64, 55, 255)
        accent = (255, 249, 229, 230)
    image = Image.new("RGBA", (32, 32), (*base, 250))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 31, 31), outline=(48, 43, 38, 255), width=2)
    draw.rectangle((2, 2, 29, 29), outline=border, width=1)
    draw.line((6, 3, 25, 3), fill=accent, width=1)
    draw.line((3, 27, 28, 27), fill=(90, 76, 61, 70), width=1)
    draw.point((4, 4), fill=accent)
    draw.point((27, 27), fill=(105, 90, 72, 190))
    return image


def make_generic_button_background(state: str) -> Image.Image:
    if state == "hover":
        fill = (242, 232, 207, 252)
        border = (255, 251, 236, 255)
    elif state == "pressed":
        fill = (211, 202, 183, 252)
        border = (91, 78, 65, 255)
    else:
        fill = (235, 229, 214, 252)
        border = (91, 78, 65, 255)
    image = Image.new("RGBA", (24, 24))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 23, 23), radius=5, fill=fill, outline=border, width=2)
    draw.arc((2, 2, 21, 21), 195, 340, fill=(255, 252, 241, 255), width=1)
    draw.arc((2, 2, 21, 21), 15, 160, fill=(115, 97, 78, 90), width=1)
    return image


def make_scene_state(name: str, scene: Image.Image, state: str) -> Image.Image:
    image = scene.convert("RGBA")
    if state == "hover":
        image = ImageEnhance.Brightness(image).enhance(1.08)
        border = (255, 247, 218, 255)
        inner = (255, 255, 245, 230)
    elif state == "pressed":
        image = ImageEnhance.Brightness(image).enhance(0.84)
        border = (63, 54, 46, 255)
        inner = (181, 157, 125, 220)
    else:
        image = ImageEnhance.Brightness(image).enhance(0.96)
        border = (56, 49, 43, 255)
        inner = (235, 222, 194, 210)

    radius = max(7, min(image.size) // 14)
    rounded_mask = Image.new("L", image.size)
    ImageDraw.Draw(rounded_mask).rounded_rectangle(
        (0, 0, image.width - 1, image.height - 1), radius=radius, fill=255
    )
    image.putalpha(ImageChops.multiply(image.getchannel("A"), rounded_mask))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (1, 1, image.width - 2, image.height - 2),
        radius=radius,
        outline=border,
        width=4,
    )
    draw.rounded_rectangle(
        (4, 4, image.width - 5, image.height - 5),
        radius=max(3, radius - 4),
        outline=inner,
        width=1,
    )

    label = ROOT_CARD_LABELS[name]
    anchor = SCENE_SPECS[name][3]
    if anchor == "bottom_left":
        font_size = 27
    elif anchor == "right_middle":
        font_size = 23
    elif image.width <= 132:
        font_size = 16
    elif image.width >= 260:
        font_size = 21
    else:
        font_size = 18
    font = get_font(font_size)
    bounds = draw.textbbox((0, 0), label, font=font, stroke_width=2)
    text_width = bounds[2] - bounds[0]
    text_height = bounds[3] - bounds[1]
    pressed_offset = 1 if state == "pressed" else 0

    if anchor == "bottom_left":
        band_height = text_height + 18
        shade = Image.new("RGBA", image.size)
        ImageDraw.Draw(shade).rectangle(
            (4, image.height - band_height - 4, image.width - 5, image.height - 5),
            fill=(30, 26, 23, 158),
        )
        image = Image.alpha_composite(image, shade)
        draw = ImageDraw.Draw(image)
        position = (12 + pressed_offset, image.height - text_height - 13 + pressed_offset)
    elif anchor == "right_middle":
        position = (
            image.width - text_width - 14 + pressed_offset,
            (image.height - text_height) // 2 - 2 + pressed_offset,
        )
    else:
        position = (
            image.width - text_width - 10 + pressed_offset,
            8 + pressed_offset,
        )

    draw.text(
        position,
        label,
        font=font,
        fill=(255, 251, 239, 255),
        stroke_width=3 if image.width > 150 else 2,
        stroke_fill=(63, 53, 45, 255),
    )
    return image


def save_full_texture(name: str, image: Image.Image) -> None:
    image.save(OUTPUT / f"{name}.png", optimize=True)
    # Full-scene artwork must scale as one image. A stale nineslice descriptor
    # would split the illustration into corners and a stretched center.
    (OUTPUT / f"{name}.json").unlink(missing_ok=True)


def make_runtime_textures(scenes: dict[str, Image.Image]) -> None:
    background = Image.open(BRAND_BACKGROUND).convert("RGB")
    side = min(background.size)
    left = (background.width - side) // 2
    top = (background.height - side) // 2
    background.crop((left, top, left + side, top + side)).resize(
        (512, 512), Image.Resampling.LANCZOS
    ).save(OUTPUT / "background.png", optimize=True)
    make_panels()
    for card, scene in scenes.items():
        for state in ("default", "hover", "pressed"):
            save_full_texture(
                f"cards/{card}_{state}",
                make_scene_state(card, scene, state),
            )
    for card in ("shop", "player_market", "transfer"):
        for state in ("default", "hover", "pressed"):
            save_nineslice(
                f"cards/{card}_{state}",
                make_card_background(card, CARD_COLORS[card], state),
                8,
            )
    for state in ("default", "hover", "pressed"):
        save_nineslice(
            f"cards/generic_{state}",
            make_generic_button_background(state),
            6,
        )


def get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/msyhbd.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_card(canvas: Image.Image, scenes: dict[str, Image.Image], name: str, rect: tuple[int, int, int, int]) -> None:
    x, y, width, height = rect
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x + 4, y + 5, x + width + 4, y + height + 5), radius=11, fill=(26, 24, 22, 145))
    scene = scenes[name].resize((width, height), Image.Resampling.LANCZOS)
    canvas.alpha_composite(make_scene_state(name, scene, "default"), (x, y))


def make_preview(cards: dict[str, Image.Image], scenes: dict[str, Image.Image]) -> None:
    background = Image.open(BRAND_BACKGROUND).convert("RGBA").resize((1600, 900), Image.Resampling.LANCZOS)
    background = ImageEnhance.Brightness(background).enhance(0.9)
    overlay = Image.new("RGBA", background.size, (44, 39, 35, 30))
    canvas = Image.alpha_composite(background, overlay)
    draw = ImageDraw.Draw(canvas)
    draw.text((62, 36), "主菜单", font=get_font(42), fill=(255, 255, 255), stroke_width=2, stroke_fill=(56, 49, 43))
    draw.rounded_rectangle((1512, 34, 1558, 80), radius=8, fill=(47, 42, 37, 105), outline=(255, 252, 240), width=3)
    draw.text((1523, 34), "×", font=get_font(35), fill=(255, 255, 255))

    x0, y0, gap = 62, 112, 8
    left_width, right_x, right_width = 970, 1040, 498
    row_h = 242
    small_width = (left_width - gap * 2) // 3
    wide_width = (left_width - gap) // 2
    draw_card(canvas, scenes, "player", (x0, y0, small_width, row_h))
    draw_card(canvas, scenes, "waypoint", (x0 + small_width + gap, y0, small_width, row_h))
    draw_card(canvas, scenes, "land", (x0 + (small_width + gap) * 2, y0, left_width - (small_width + gap) * 2, row_h))
    draw_card(canvas, scenes, "economy", (x0, y0 + row_h + gap, wide_width, row_h))
    draw_card(canvas, scenes, "guild", (x0 + wide_width + gap, y0 + row_h + gap, left_width - wide_width - gap, row_h))
    draw_card(canvas, scenes, "pvp", (x0, y0 + (row_h + gap) * 2, small_width, row_h))
    draw_card(canvas, scenes, "stats", (x0 + small_width + gap, y0 + (row_h + gap) * 2, small_width, row_h))
    draw_card(canvas, scenes, "other", (x0 + (small_width + gap) * 2, y0 + (row_h + gap) * 2, left_width - (small_width + gap) * 2, row_h))

    quest_h, banner_h = 384, 170
    quick_h = row_h * 3 + gap * 2 - quest_h - banner_h - gap * 2
    draw_card(canvas, scenes, "quest", (right_x, y0, right_width, quest_h))
    draw_card(canvas, scenes, "menu_item", (right_x, y0 + quest_h + gap, right_width, banner_h))
    quick_y = y0 + quest_h + gap + banner_h + gap
    quick_width = (right_width - gap * 2) // 3
    draw_card(canvas, scenes, "floating_text", (right_x, quick_y, quick_width, quick_h))
    draw_card(canvas, scenes, "help", (right_x + quick_width + gap, quick_y, quick_width, quick_h))
    draw_card(canvas, scenes, "server_settings", (right_x + (quick_width + gap) * 2, quick_y, right_width - (quick_width + gap) * 2, quick_h))
    canvas.convert("RGB").save(PREVIEW, quality=95)


def make_submenu_preview(cards: dict[str, Image.Image]) -> None:
    background = Image.open(BRAND_BACKGROUND).convert("RGBA").resize((1600, 900), Image.Resampling.LANCZOS)
    background = ImageEnhance.Brightness(background).enhance(0.88)
    canvas = Image.alpha_composite(background, Image.new("RGBA", background.size, (56, 48, 41, 36)))
    draw = ImageDraw.Draw(canvas)
    dialog = (390, 100, 1210, 800)
    draw.rounded_rectangle((397, 107, 1217, 807), radius=18, fill=(31, 28, 25, 125))
    draw.rounded_rectangle(dialog, radius=18, fill=(244, 238, 224, 250), outline=(67, 58, 49), width=3)
    draw.line((411, 106, 1189, 106), fill=(255, 252, 241), width=2)
    draw.text((425, 124), "经济系统", font=get_font(35), fill=(63, 56, 49))
    draw.text((427, 167), "选择一项继续", font=get_font(17), fill=(129, 113, 94))
    draw.rounded_rectangle((1148, 122, 1186, 160), radius=7, fill=(47, 42, 37, 105), outline=(255, 252, 240), width=2)
    draw.text((1157, 119), "×", font=get_font(30), fill=(255, 255, 255))

    rows = [
        ("shop", "官方商店", "购买服务器商品与限时物资"),
        ("player_market", "玩家交易市场", "浏览和管理玩家挂单"),
        ("transfer", "金币转账", "向在线玩家安全转账"),
        ("economy", "红包", "发送或领取服务器红包"),
        ("other", "出售背包物品", "按服务器回收价快速出售"),
    ]
    y = 212
    for name, title, description in rows:
        draw.rounded_rectangle((422, y, 1178, y + 92), radius=13, fill=(235, 229, 214, 252), outline=(91, 78, 65), width=2)
        draw.line((436, y + 4, 1164, y + 4), fill=(255, 252, 241), width=2)
        draw.rounded_rectangle((437, y + 12, 505, y + 80), radius=10, fill=(207, 220, 199), outline=(86, 75, 62), width=2)
        art = cards[name].resize((60, 60), Image.Resampling.NEAREST)
        canvas.alpha_composite(art, (441, y + 16))
        draw.text((528, y + 29), title, font=get_font(25), fill=(63, 56, 49))
        draw.text((1138, y + 24), "›", font=get_font(34), fill=(105, 91, 75))
        y += 105
    canvas.convert("RGB").save(SUBMENU_PREVIEW, quality=95)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    CARD_OUTPUT.mkdir(parents=True, exist_ok=True)
    cards = extract_cards()
    scenes = extract_scene_cards()
    make_runtime_textures(scenes)
    make_preview(cards, scenes)
    make_submenu_preview(cards)
    print(f"Built {len(cards)} card illustrations and previews in {PREVIEW.parent}")


if __name__ == "__main__":
    main()
