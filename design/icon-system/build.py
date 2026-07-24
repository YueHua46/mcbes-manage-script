"""Build native 32x32 CreeperMenu runtime icons from semantic atlases."""

from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).parent / "source"
OUTPUT = ROOT / "resource_packs/CreeperMenu/textures/icons"
CANVAS = 32
CONTENT = 28

ATLASES = {
    "atlas-actions.png": "accept add back deny edit2 leave leave_queue left_arrow right_arrow requeue settings gear info eyes wisdom terminal".split(),
    "atlas-social.png": "accessories amongus asker chat_bubble_white chatCooldown chatSpam dead discord dragon faces heart profile social spectator uye winner".split(),
    "atlas-world.png": "ada carneval carneval_unavailable checkpoint dunya durbun fast_travel fotograf home island marker_quest overworld region topraklar game_parkour_tag party_unavailable".split(),
    "atlas-economy.png": "catalogue clock coins gem gift rewards shop shop_bank trade trophy sandik quest_chest quest_daily_common quest_log star bina".split(),
    "atlas-gameplay.png": "8 copkutusu dinazor duyuru gadgets game_battle_box game_survival_games infinibag kilic mod_shield party_invites party_remove pickaxe saat sword zombi".split(),
    "atlas-main-menu.png": "menu_player menu_waypoint menu_land menu_economy menu_guild menu_floating_text menu_pvp menu_stats menu_quest menu_other menu_help menu_item menu_server_settings menu_shop menu_player_market menu_transfer".split(),
}

PALETTE = [
    (25, 22, 22), (40, 27, 18), (87, 50, 24), (151, 88, 36),
    (210, 145, 63), (139, 76, 42), (216, 144, 85), (244, 195, 140),
    (91, 98, 105), (174, 182, 184), (232, 236, 235), (250, 244, 220),
    (142, 36, 31), (225, 66, 43), (255, 123, 77), (42, 101, 45),
    (82, 166, 52), (154, 218, 74), (35, 80, 155), (61, 139, 222),
    (137, 199, 243), (176, 99, 16), (239, 177, 31), (255, 225, 97),
    (75, 34, 116), (137, 62, 190), (198, 109, 225), (17, 151, 158),
    (100, 211, 215),
]
PURPLE = set(PALETTE[24:27])


def key_color(pixel):
    r, g, b, _ = pixel
    return r >= 150 and b >= 150 and g <= 150 and r + b >= 400


def remove_matte(tile):
    image = tile.convert("RGBA")
    px, w, h = image.load(), image.width, image.height
    queue = deque([(x, y) for x in range(w) for y in (0, h - 1)])
    queue.extend((x, y) for y in range(h) for x in (0, w - 1))
    seen = set()
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not key_color(px[x, y]):
            continue
        seen.add((x, y))
        px[x, y] = (0, 0, 0, 0)
        queue.extend((nx, ny) for nx, ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)) if 0 <= nx < w and 0 <= ny < h)
    return image


def nearest_palette(rgb):
    r, g, b = rgb
    return min(PALETTE, key=lambda c: 2*(r-c[0])**2 + 3*(g-c[1])**2 + (b-c[2])**2)


def remove_crumbs(image):
    px, visited = image.load(), set()
    for sy in range(CANVAS):
        for sx in range(CANVAS):
            if (sx, sy) in visited or not px[sx, sy][3]:
                continue
            component, queue = [], deque([(sx, sy)])
            while queue:
                x, y = queue.popleft()
                if (x, y) in visited or not px[x, y][3]:
                    continue
                visited.add((x, y)); component.append((x, y))
                queue.extend((nx, ny) for nx in range(max(0,x-1),min(CANVAS,x+2)) for ny in range(max(0,y-1),min(CANVAS,y+2)))
            if len(component) <= 2:
                for x, y in component:
                    px[x, y] = (0, 0, 0, 0)


def icon_from(tile, name):
    subject = remove_matte(tile)
    subject = subject.crop(subject.getchannel("A").getbbox())
    scale = min(CONTENT / subject.width, CONTENT / subject.height)
    size = (max(1, round(subject.width*scale)), max(1, round(subject.height*scale)))
    subject = subject.resize(size, Image.Resampling.NEAREST)
    keep_purple = name in {"carneval", "carneval_unavailable"}
    output = Image.new("RGBA", size)
    colors = []
    for r, g, b, a in subject.get_flattened_data():
        color = nearest_palette((r, g, b))
        if color in PURPLE and not keep_purple:
            color = PALETTE[1]
        colors.append((*color, 255) if a else (0, 0, 0, 0))
    output.putdata(colors)
    canvas = Image.new("RGBA", (CANVAS, CANVAS))
    canvas.alpha_composite(output, ((CANVAS-size[0])//2, (CANVAS-size[1])//2))
    if not keep_purple:
        remove_crumbs(canvas)
    return canvas


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    count = 0
    for atlas_name, names in ATLASES.items():
        atlas = Image.open(SOURCE / atlas_name)
        grid = round(len(names) ** 0.5)
        if grid * grid != len(names):
            raise ValueError(f"{atlas_name} must contain a square number of icons")
        for i, name in enumerate(names):
            row, column = divmod(i, grid)
            box = tuple(round(v) for v in (column*atlas.width/grid, row*atlas.height/grid, (column+1)*atlas.width/grid, (row+1)*atlas.height/grid))
            icon_from(atlas.crop(box), name).save(OUTPUT / f"{name}.png", optimize=True)
            count += 1
    print(f"Built {count} icons at {CANVAS}x{CANVAS}")


if __name__ == "__main__":
    main()
