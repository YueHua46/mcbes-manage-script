"""Build CreeperMenu card artwork, JSON UI textures, and a desktop preview."""

from collections import deque
from pathlib import Path
from time import sleep

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).parent / "source" / "creeper-feature-atlas-cozy-imagegen.png"
LEFT_MOSAIC_SOURCE = Path(__file__).parent / "source" / "creeper-mosaic-left-323-imagegen.png"
RIGHT_MOSAIC_SOURCE = Path(__file__).parent / "source" / "creeper-mosaic-right-113-imagegen.png"
SUBMENU_CORE_SOURCE = Path(__file__).parent / "source" / "creeper-submenu-icons-core-imagegen.png"
SUBMENU_ADMIN_SOURCE = Path(__file__).parent / "source" / "creeper-submenu-icons-admin-imagegen.png"
ACTION_ICON_SOURCE = Path(__file__).parent / "source" / "creeper-action-icons-imagegen.png"
BRAND_BACKGROUND = ROOT / "design" / "brand" / "source" / "background-imagegen.png"
OUTPUT = ROOT / "resource_packs" / "CreeperMenu" / "textures" / "ui" / "creeper_menu"
CARD_OUTPUT = OUTPUT / "cards"
ICON_OUTPUT = ROOT / "resource_packs" / "CreeperMenu" / "textures" / "icons"
PREVIEW = Path(__file__).parent / "preview.png"
SUBMENU_PREVIEW = Path(__file__).parent / "submenu-preview.png"
MODAL_PREVIEW = Path(__file__).parent / "modal-preview.png"
MESSAGE_PREVIEW = Path(__file__).parent / "message-preview.png"

CARD_NAMES = (
    "player waypoint land economy guild floating_text pvp stats "
    "quest other help menu_item server_settings shop player_market transfer"
).split()

SUBMENU_ICON_ATLASES = {
    SUBMENU_CORE_SOURCE: (
        "waypoint_add_private waypoint_add_public fake_player_manage fake_player_list "
        "simulated_player fake_player_admin guild_directory guild_mine "
        "suicide death_return death_ranking custom_dimensions "
        "land_flight land_teleport_settings guild_waypoint tpa_settings"
    ).split(),
    SUBMENU_ADMIN_SOURCE: (
        "blacklist_list anti_dupe_whitelist author_list guild_applications "
        "guild_invite guild_leader_transfer land_public_access land_members "
        "player_inventory_admin marketplace_browse server_live_dashboard join_popup_announcement "
        "status_bar_settings floating_text_admin inventory_snapshot_archive waypoint_admin_all"
    ).split(),
}
SUBMENU_SINGLE_COMPONENT_ICONS = {"suicide"}

ACTION_ICON_NAMES = (
    "filter_search filter_refresh program_path_target program_move_relative "
    "program_stop program_follow program_look_target program_hotbar "
    "program_use_item program_interact program_interact_block program_jump "
    "program_sneak name_color whitelist_remove shulker_take shulker_copy"
).split()
ACTION_SINGLE_COMPONENT_ICONS = {"program_sneak"}

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


def extract_submenu_icons() -> None:
    """Split the two authored 4x4 atlases into native 32x32 RGBA icons."""
    ICON_OUTPUT.mkdir(parents=True, exist_ok=True)
    for source, names in SUBMENU_ICON_ATLASES.items():
        atlas = remove_edge_key(Image.open(source).convert("RGBA"))
        for index, name in enumerate(names):
            row, column = divmod(index, 4)
            left = round(column * atlas.width / 4)
            top = round(row * atlas.height / 4)
            right = round((column + 1) * atlas.width / 4)
            bottom = round((row + 1) * atlas.height / 4)
            subject = atlas.crop((left, top, right, bottom))
            mask = Image.new("L", subject.size)
            mask_pixels = mask.load()
            components = [component for component in connected_components(subject) if len(component) >= 32]
            if name in SUBMENU_SINGLE_COMPONENT_ICONS and components:
                components = [max(components, key=len)]
            for component in components:
                for x, y in component:
                    mask_pixels[x, y] = 255
            subject.putalpha(mask)
            bounds = subject.getchannel("A").getbbox()
            if bounds is None:
                raise ValueError(f"No submenu icon artwork found for {name}")
            subject = subject.crop(bounds)
            scale = min(29 / subject.width, 29 / subject.height)
            size = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
            subject = subject.resize(size, Image.Resampling.NEAREST)
            canvas = Image.new("RGBA", (32, 32))
            canvas.alpha_composite(subject, ((32 - size[0]) // 2, (32 - size[1]) // 2))
            canvas.save(ICON_OUTPUT / f"{name}.png", optimize=True)


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
        fill=(236, 231, 219, 252),
        outline=(105, 93, 78, 255),
        width=1,
    )
    save_nineslice("submenu_panel", submenu, 8)

    for state, fill, border in (
        ("default", (72, 68, 63, 245), (242, 237, 224, 255)),
        ("hover", (101, 89, 72, 250), (255, 248, 226, 255)),
        ("pressed", (57, 52, 47, 250), (213, 203, 184, 255)),
    ):
        close = Image.new("RGBA", (24, 24))
        close_draw = ImageDraw.Draw(close)
        close_draw.rounded_rectangle((1, 1, 22, 22), radius=5, fill=fill, outline=border, width=1)
        close_draw.line((8, 8, 15, 15), fill=(239, 235, 226, 255), width=2)
        close_draw.line((15, 8, 8, 15), fill=(239, 235, 226, 255), width=2)
        save_full_texture(f"close_{state}", close)
    (OUTPUT / "close_frame.png").unlink(missing_ok=True)
    (OUTPUT / "close_frame.json").unlink(missing_ok=True)

    icon_chip = Image.new("RGBA", (16, 16))
    draw = ImageDraw.Draw(icon_chip)
    draw.rounded_rectangle(
        (0, 0, 15, 15),
        radius=5,
        fill=(210, 219, 204, 248),
        outline=(151, 141, 119, 235),
        width=1,
    )
    save_nineslice("icon_chip", icon_chip, 4)

    line = Image.new("RGBA", (8, 1), (126, 113, 96, 120))
    line.save(OUTPUT / "line.png", optimize=True)

    field_states = {
        "default": ((244, 240, 230, 255), (154, 140, 118, 245)),
        "hover": ((250, 246, 235, 255), (176, 150, 111, 255)),
        "pressed": ((224, 218, 204, 255), (132, 117, 97, 255)),
    }
    for state, (fill, border) in field_states.items():
        field = Image.new("RGBA", (24, 24))
        field_draw = ImageDraw.Draw(field)
        field_draw.rounded_rectangle((0, 0, 23, 23), radius=6, fill=fill, outline=border, width=1)
        save_nineslice(f"modal_field_{state}", field, 6)

    dropdown_panel = Image.new("RGBA", (24, 24))
    dropdown_draw = ImageDraw.Draw(dropdown_panel)
    dropdown_draw.rounded_rectangle(
        (0, 0, 23, 23), radius=5, fill=(238, 233, 221, 255), outline=(132, 117, 97, 255), width=1
    )
    save_nineslice("modal_dropdown_panel", dropdown_panel, 6)

    for selected in (False, True):
        for hovered in (False, True):
            name = "modal_toggle_on" if selected else "modal_toggle_off"
            if hovered:
                name += "_hover"
            toggle = Image.new("RGBA", (30, 16))
            toggle_draw = ImageDraw.Draw(toggle)
            fill = (164, 190, 161, 255) if selected else (201, 196, 184, 255)
            border = (112, 126, 99, 255) if selected else (139, 127, 110, 255)
            if hovered:
                fill = tuple(min(255, channel + 14) for channel in fill[:3]) + (255,)
                border = (163, 132, 91, 255)
            toggle_draw.rounded_rectangle((0, 0, 29, 15), radius=7, fill=fill, outline=border, width=1)
            knob_x = 21 if selected else 8
            toggle_draw.ellipse(
                (knob_x - 5, 3, knob_x + 5, 13),
                fill=(247, 242, 230, 255),
                outline=(102, 91, 76, 255),
                width=1,
            )
            save_full_texture(name, toggle)

    for name, fill, border in (
        ("modal_slider_track", (207, 201, 187, 255), (139, 127, 110, 255)),
        ("modal_slider_track_hover", (219, 211, 194, 255), (163, 132, 91, 255)),
        ("modal_slider_progress", (171, 194, 165, 255), (111, 127, 99, 255)),
        ("modal_slider_progress_hover", (188, 207, 180, 255), (143, 117, 82, 255)),
    ):
        track = Image.new("RGBA", (24, 8))
        track_draw = ImageDraw.Draw(track)
        track_draw.rounded_rectangle((0, 0, 23, 7), radius=3, fill=fill, outline=border, width=1)
        save_nineslice(name, track, 3)

    for state, fill, border in (
        ("", (238, 233, 220, 255), (116, 104, 88, 255)),
        ("_hover", (249, 243, 227, 255), (168, 135, 91, 255)),
        ("_pressed", (208, 202, 190, 255), (111, 98, 81, 255)),
    ):
        thumb = Image.new("RGBA", (12, 18))
        thumb_draw = ImageDraw.Draw(thumb)
        thumb_draw.rounded_rectangle((0, 0, 11, 17), radius=5, fill=fill, outline=border, width=1)
        thumb_draw.line((4, 5, 4, 12), fill=(151, 139, 119, 210), width=1)
        thumb_draw.line((7, 5, 7, 12), fill=(151, 139, 119, 210), width=1)
        save_full_texture(f"modal_slider_thumb{state}", thumb)

    step_colors = {
        "modal_slider_step": (139, 127, 110, 210),
        "modal_slider_step_hover": (163, 132, 91, 235),
        "modal_slider_step_progress": (101, 126, 96, 230),
        "modal_slider_step_progress_hover": (126, 151, 119, 255),
    }
    for name, color in step_colors.items():
        Image.new("RGBA", (2, 6), color).save(OUTPUT / f"{name}.png", optimize=True)

    for selected in (False, True):
        for hovered in (False, True):
            name = "modal_radio_on" if selected else "modal_radio_off"
            if hovered:
                name += "_hover"
            radio = Image.new("RGBA", (12, 12))
            radio_draw = ImageDraw.Draw(radio)
            border = (164, 132, 91, 255) if hovered else (128, 116, 99, 255)
            radio_draw.ellipse((0, 0, 11, 11), fill=(244, 240, 230, 255), outline=border, width=1)
            if selected:
                radio_draw.ellipse((3, 3, 8, 8), fill=(126, 153, 119, 255))
            save_full_texture(name, radio)

    info = Image.new("RGBA", (7, 11))
    info_draw = ImageDraw.Draw(info)
    info_draw.ellipse((0, 2, 6, 8), fill=(205, 216, 199, 255), outline=(112, 101, 85, 255), width=1)
    info_draw.point((3, 4), fill=(73, 65, 56, 255))
    info_draw.line((3, 6, 3, 7), fill=(73, 65, 56, 255), width=1)
    save_full_texture("modal_info", info)


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
        fill = (242, 236, 222, 252)
        border = (176, 150, 111, 255)
    elif state == "pressed":
        fill = (211, 205, 193, 252)
        border = (132, 117, 97, 255)
    else:
        fill = (230, 226, 216, 252)
        border = (154, 140, 118, 235)
    image = Image.new("RGBA", (24, 24))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 23, 23), radius=6, fill=fill, outline=border, width=1)
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

    # The authored textures use different aspect ratios. A fixed source-space
    # radius keeps their perceived runtime corner radius aligned after each is
    # scaled into the common mosaic columns.
    radius = 8
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
    target = OUTPUT / f"{name}.png"
    for attempt in range(5):
        try:
            image.save(target, optimize=True)
            break
        except OSError:
            if attempt == 4:
                raise
            sleep(0.05 * (attempt + 1))
    # Full-scene artwork must scale as one image. A stale nineslice descriptor
    # would split the illustration into corners and a stretched center.
    (OUTPUT / f"{name}.json").unlink(missing_ok=True)


def save_preview(image: Image.Image, target: Path) -> None:
    """Atomically refresh previews even while another process is reading them."""
    temporary = target.with_name(f".{target.stem}.tmp{target.suffix}")
    for attempt in range(5):
        try:
            image.convert("RGB").save(temporary, quality=95)
            temporary.replace(target)
            return
        except OSError:
            temporary.unlink(missing_ok=True)
            if attempt == 4:
                raise
            sleep(0.05 * (attempt + 1))


def extract_action_icons() -> None:
    """Extract a 4x5 high-resolution atlas without ever crossing cell bounds."""
    ICON_OUTPUT.mkdir(parents=True, exist_ok=True)
    atlas = Image.open(ACTION_ICON_SOURCE).convert("RGBA")
    columns, rows = 4, 5
    for index, name in enumerate(ACTION_ICON_NAMES):
        row, column = divmod(index, columns)
        left = round(column * atlas.width / columns)
        top = round(row * atlas.height / rows)
        right = round((column + 1) * atlas.width / columns)
        bottom = round((row + 1) * atlas.height / rows)
        cell = atlas.crop((left, top, right, bottom))
        if name in ACTION_SINGLE_COMPONENT_ICONS:
            components = connected_components(cell)
            if not components:
                raise ValueError(f"No connected action icon artwork found for {name}")
            mask = Image.new("L", cell.size)
            mask_pixels = mask.load()
            for x, y in max(components, key=len):
                mask_pixels[x, y] = 255
            cell.putalpha(mask)
        bounds = cell.getchannel("A").getbbox()
        if bounds is None:
            raise ValueError(f"No action icon artwork found for {name}")
        subject = cell.crop(bounds)
        scale = min(29 / subject.width, 29 / subject.height)
        size = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
        subject = subject.resize(size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (32, 32))
        canvas.alpha_composite(subject, ((32 - size[0]) // 2, (32 - size[1]) // 2))
        canvas.save(ICON_OUTPUT / f"{name}.png", optimize=True)




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
    close = Image.open(OUTPUT / "close_default.png").resize((46, 46), Image.Resampling.NEAREST)
    canvas.alpha_composite(close, (1512, 34))

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
    save_preview(canvas, PREVIEW)


def make_submenu_preview(cards: dict[str, Image.Image]) -> None:
    background = Image.open(BRAND_BACKGROUND).convert("RGBA").resize((1600, 900), Image.Resampling.LANCZOS)
    background = ImageEnhance.Brightness(background).enhance(0.88)
    canvas = Image.alpha_composite(background, Image.new("RGBA", background.size, (56, 48, 41, 36)))
    draw = ImageDraw.Draw(canvas)
    dialog = (420, 120, 1180, 760)
    draw.rounded_rectangle((426, 126, 1186, 766), radius=18, fill=(31, 28, 25, 105))
    draw.rounded_rectangle(dialog, radius=18, fill=(236, 231, 219, 252), outline=(105, 93, 78), width=2)
    draw.text((454, 144), "经济系统", font=get_font(35), fill=(51, 46, 41))
    draw.text((456, 187), "选择一项继续", font=get_font(17), fill=(112, 99, 84))
    close = Image.open(OUTPUT / "close_default.png").resize((38, 38), Image.Resampling.NEAREST)
    canvas.alpha_composite(close, (1118, 142))
    draw.text((456, 216), "请选择你要进行的操作。", font=get_font(16), fill=(69, 62, 55))
    draw.text((456, 239), "当前余额：0 金币", font=get_font(16), fill=(69, 62, 55))

    rows = [
        ("shop", "官方商店", "购买服务器商品与限时物资"),
        ("player_market", "玩家交易市场", "浏览和管理玩家挂单"),
        ("transfer", "金币转账", "向在线玩家安全转账"),
        ("economy", "红包", "发送或领取服务器红包"),
        ("other", "出售背包物品", "按服务器回收价快速出售"),
    ]
    y = 270
    for name, title, description in rows:
        draw.rounded_rectangle((450, y, 1150, y + 76), radius=12, fill=(226, 222, 211, 252), outline=(112, 99, 83), width=1)
        draw.rounded_rectangle((463, y + 8, 523, y + 68), radius=9, fill=(205, 216, 199), outline=(112, 101, 85), width=1)
        art = cards[name].resize((56, 56), Image.Resampling.NEAREST)
        canvas.alpha_composite(art, (465, y + 10))
        draw.text((544, y + 21), title, font=get_font(24), fill=(51, 46, 41))
        draw.text((1110, y + 16), "›", font=get_font(32), fill=(105, 91, 75))
        y += 86
    save_preview(canvas, SUBMENU_PREVIEW)


def make_modal_preview() -> None:
    background = Image.open(BRAND_BACKGROUND).convert("RGBA").resize((1600, 900), Image.Resampling.LANCZOS)
    background = ImageEnhance.Brightness(background).enhance(0.82)
    canvas = Image.alpha_composite(background, Image.new("RGBA", background.size, (54, 47, 40, 45)))
    draw = ImageDraw.Draw(canvas)
    dialog = (440, 120, 1160, 780)
    draw.rounded_rectangle((447, 127, 1167, 787), radius=18, fill=(31, 28, 25, 105))
    draw.rounded_rectangle(dialog, radius=18, fill=(236, 231, 219, 252), outline=(105, 93, 78), width=2)
    draw.text((472, 145), "玩家传送", font=get_font(34), fill=(51, 46, 41))
    close = Image.open(OUTPUT / "close_default.png").resize((38, 38), Image.Resampling.NEAREST)
    canvas.alpha_composite(close, (1094, 142))

    rows = (("选择玩家", "YingLin3467"), ("选择传送方式", "传送到玩家"))
    y = 225
    for label, value in rows:
        draw.text((474, y), label, font=get_font(20), fill=(69, 61, 54))
        draw.rounded_rectangle(
            (472, y + 35, 1128, y + 103),
            radius=12,
            fill=(244, 240, 230, 255),
            outline=(154, 140, 118, 245),
            width=2,
        )
        draw.text((500, y + 53), value, font=get_font(24), fill=(62, 55, 48))
        draw.polygon(((1083, y + 62), (1101, y + 62), (1092, y + 72)), fill=(101, 89, 74))
        y += 145

    draw.rounded_rectangle(
        (472, 535, 1128, 605),
        radius=12,
        fill=(230, 226, 216, 252),
        outline=(154, 140, 118, 235),
        width=2,
    )
    confirm = "确认"
    confirm_box = draw.textbbox((0, 0), confirm, font=get_font(25))
    confirm_width = confirm_box[2] - confirm_box[0]
    draw.text((800 - confirm_width // 2, 553), confirm, font=get_font(25), fill=(56, 50, 44))
    save_preview(canvas, MODAL_PREVIEW)


def make_message_preview() -> None:
    background = Image.open(BRAND_BACKGROUND).convert("RGBA").resize((1600, 900), Image.Resampling.LANCZOS)
    background = ImageEnhance.Brightness(background).enhance(0.82)
    canvas = Image.alpha_composite(background, Image.new("RGBA", background.size, (54, 47, 40, 45)))
    draw = ImageDraw.Draw(canvas)
    dialog = (430, 135, 1170, 765)
    draw.rounded_rectangle((437, 142, 1177, 772), radius=18, fill=(31, 28, 25, 105))
    draw.rounded_rectangle(dialog, radius=18, fill=(236, 231, 219, 252), outline=(105, 93, 78), width=2)
    draw.text((462, 158), "公开信息", font=get_font(34), fill=(51, 46, 41))
    close = Image.open(OUTPUT / "close_default.png").resize((38, 38), Image.Resampling.NEAREST)
    canvas.alpha_composite(close, (1104, 155))

    body = (462, 215, 1138, 650)
    draw.rounded_rectangle(body, radius=12, fill=(244, 240, 230, 255), outline=(154, 140, 118, 245), width=2)
    lines = (
        "会长：YingLin3467",
        "副会长：（无）",
        "创建时间：2026-08-23 17:52:08",
        "成员数：1",
        "",
        "成员",
        "YingLin3467",
        "",
        "公告",
        "欢迎来到我们的公会。",
    )
    y = 244
    for line in lines:
        draw.text((490, y), line, font=get_font(22), fill=(64, 56, 49))
        y += 34
    draw.rounded_rectangle((1119, 239, 1126, 626), radius=3, fill=(209, 202, 188, 220))
    draw.rounded_rectangle((1119, 239, 1126, 385), radius=3, fill=(132, 119, 101, 245))

    buttons = ((462, 671, 794, 724, "刷新"), (806, 671, 1138, 724, "返回"))
    for left, top, right, bottom, label in buttons:
        draw.rounded_rectangle(
            (left, top, right, bottom),
            radius=11,
            fill=(230, 226, 216, 252),
            outline=(154, 140, 118, 235),
            width=2,
        )
        text_box = draw.textbbox((0, 0), label, font=get_font(23))
        text_width = text_box[2] - text_box[0]
        draw.text(((left + right - text_width) // 2, top + 13), label, font=get_font(23), fill=(56, 50, 44))
    save_preview(canvas, MESSAGE_PREVIEW)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    CARD_OUTPUT.mkdir(parents=True, exist_ok=True)
    extract_submenu_icons()
    extract_action_icons()
    cards = extract_cards()
    scenes = extract_scene_cards()
    make_runtime_textures(scenes)
    make_preview(cards, scenes)
    make_submenu_preview(cards)
    make_modal_preview()
    make_message_preview()
    print(f"Built {len(cards)} card illustrations and previews in {PREVIEW.parent}")


if __name__ == "__main__":
    main()
