const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const scriptsRoot = path.join(root, "scripts");
const iconRoot = path.join(root, "resource_packs", "CreeperMenu", "textures", "icons");

function walk(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target, extension);
    return entry.name.endsWith(extension) ? [target] : [];
  });
}

function readRgbaAlpha(file) {
  const png = fs.readFileSync(file);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const chunks = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }

  const packed = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (left, above, upperLeft) => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
  };

  for (let y = 0; y < height; y += 1) {
    const packedRow = y * (stride + 1);
    const filter = packed[packedRow];
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[packedRow + x + 1];
      const output = y * stride + x;
      const left = x >= 4 ? pixels[output - 4] : 0;
      const above = y > 0 ? pixels[output - stride] : 0;
      const upperLeft = x >= 4 && y > 0 ? pixels[output - stride - 4] : 0;
      const predictor = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filter];
      assert.notEqual(predictor, undefined, `unsupported PNG filter ${filter}`);
      pixels[output] = (raw + predictor) & 0xff;
    }
  }

  return { width, height, alpha: Array.from({ length: width * height }, (_, index) => pixels[index * 4 + 3]) };
}

function opaqueComponentSizes(file) {
  const { width, height, alpha } = readRgbaAlpha(file);
  const visited = new Set();
  const sizes = [];
  for (let start = 0; start < alpha.length; start += 1) {
    if (!alpha[start] || visited.has(start)) continue;
    let size = 0;
    const queue = [start];
    while (queue.length) {
      const current = queue.pop();
      if (visited.has(current) || !alpha[current]) continue;
      visited.add(current);
      size += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      for (let nextY = Math.max(0, y - 1); nextY <= Math.min(height - 1, y + 1); nextY += 1) {
        for (let nextX = Math.max(0, x - 1); nextX <= Math.min(width - 1, x + 1); nextX += 1) {
          const next = nextY * width + nextX;
          if (!visited.has(next) && alpha[next]) queue.push(next);
        }
      }
    }
    sizes.push(size);
  }
  return sizes;
}

function countOpaqueComponents(file) {
  return opaqueComponentSizes(file).length;
}

test("every referenced custom menu icon is a native 32x32 RGBA PNG", () => {
  const references = new Set();
  const pattern = /textures\/icons\/([A-Za-z0-9_]+)/g;

  for (const file of walk(scriptsRoot, ".ts")) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) references.add(match[1]);
  }

  assert.ok(references.size >= 80);
  for (const name of references) {
    const file = path.join(iconRoot, `${name}.png`);
    assert.ok(fs.existsSync(file), `missing icon: ${name}`);
    const png = fs.readFileSync(file);
    assert.equal(png.toString("ascii", 1, 4), "PNG", `${name} is not a PNG`);
    assert.equal(png.readUInt32BE(16), 32, `${name} width`);
    assert.equal(png.readUInt32BE(20), 32, `${name} height`);
    assert.equal(png[25], 6, `${name} must use RGBA color type`);
  }
});

test("main menu entries use dedicated function-semantic icons", () => {
  const source = fs.readFileSync(path.join(scriptsRoot, "ui", "forms", "server", "index.ts"), "utf8");
  const expected = {
    player: "menu_player",
    wayPoint: "menu_waypoint",
    land: "menu_land",
    economy: "menu_economy",
    guild: "menu_guild",
    floatingText: "menu_floating_text",
    pvp: "menu_pvp",
    stats: "menu_stats",
    quest: "menu_quest",
    other: "menu_other",
    help: "menu_help",
    sm: "menu_item",
    setting: "menu_server_settings",
  };

  for (const [id, icon] of Object.entries(expected)) {
    const entry = new RegExp(`id: ["']${id}["'][\\s\\S]{0,160}?icon: ["']textures/icons/${icon}["']`);
    assert.match(source, entry, `${id} must use ${icon}`);
  }
});

test("single-subject icon crops do not retain neighboring atlas fragments", () => {
  for (const name of ["faces", "heart", "suicide", "program_sneak"]) {
    const file = path.join(iconRoot, `${name}.png`);
    assert.equal(countOpaqueComponents(file), 1, `${name} contains disconnected atlas artwork`);
  }
});

test("generated action icons keep a transparent safety edge", () => {
  const names = [
    "filter_search",
    "filter_refresh",
    "program_path_target",
    "program_move_relative",
    "program_stop",
    "program_follow",
    "program_look_target",
    "program_hotbar",
    "program_use_item",
    "program_interact",
    "program_interact_block",
    "program_jump",
    "program_sneak",
    "name_color",
    "whitelist_remove",
    "shulker_take",
    "shulker_copy",
  ];

  for (const name of names) {
    const file = path.join(iconRoot, `${name}.png`);
    const { width, height, alpha } = readRgbaAlpha(file);
    assert.equal(width, 32, `${name} width`);
    assert.equal(height, 32, `${name} height`);
    for (let position = 0; position < 32; position += 1) {
      assert.equal(alpha[position], 0, `${name} top edge`);
      assert.equal(alpha[31 * width + position], 0, `${name} bottom edge`);
      assert.equal(alpha[position * width], 0, `${name} left edge`);
      assert.equal(alpha[position * width + 31], 0, `${name} right edge`);
    }
  }

  const build = fs.readFileSync(path.join(root, "design", "menu-ui", "build.py"), "utf8");
  assert.match(build, /def extract_action_icons\(\)/);
  assert.match(build, /extract_submenu_icons\(\)[\s\S]{0,80}extract_action_icons\(\)/);
});

test("ambiguous submenu actions use distinct semantic icon artwork", () => {
  const generatedIcons = [
    "waypoint_add_private",
    "waypoint_add_public",
    "fake_player_manage",
    "fake_player_list",
    "simulated_player",
    "fake_player_admin",
    "guild_directory",
    "guild_mine",
    "suicide",
    "death_return",
    "death_ranking",
    "custom_dimensions",
    "land_flight",
    "land_teleport_settings",
    "guild_waypoint",
    "tpa_settings",
    "blacklist_list",
    "anti_dupe_whitelist",
    "author_list",
    "guild_applications",
    "guild_invite",
    "guild_leader_transfer",
    "land_public_access",
    "land_members",
    "player_inventory_admin",
    "marketplace_browse",
    "server_live_dashboard",
    "join_popup_announcement",
    "status_bar_settings",
    "floating_text_admin",
    "inventory_snapshot_archive",
    "waypoint_admin_all",
    "filter_search",
    "filter_refresh",
    "program_path_target",
    "program_move_relative",
    "program_stop",
    "program_follow",
    "program_look_target",
    "program_hotbar",
    "program_use_item",
    "program_interact",
    "program_interact_block",
    "program_jump",
    "program_sneak",
    "name_color",
    "whitelist_remove",
    "shulker_take",
    "shulker_copy",
  ];
  const hashes = generatedIcons.map((name) => {
    const file = path.join(iconRoot, `${name}.png`);
    assert.ok(fs.existsSync(file), `missing generated semantic icon: ${name}`);
    return require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  });
  assert.equal(new Set(hashes).size, generatedIcons.length, "semantic icons must not be duplicate artwork");

  const contracts = [
    ["ui/forms/waypoint/index.ts", "添加当前私人坐标点", "waypoint_add_private"],
    ["ui/forms/waypoint/index.ts", "添加当前公共坐标点", "waypoint_add_public"],
    ["ui/forms/player/index.ts", "假人管理", "fake_player_manage"],
    ["ui/forms/player/fake-player.ts", "我的假人列表", "fake_player_list"],
    ["ui/forms/player/fake-player.ts", "全服假人管理", "fake_player_admin"],
    ["ui/forms/guild/index.ts", "公会列表", "guild_directory"],
    ["ui/forms/guild/index.ts", "我的公会", "guild_mine"],
    ["ui/forms/other/index.ts", "自杀", "suicide"],
    ["ui/forms/other/index.ts", "回到上次死亡地点", "death_return"],
    ["ui/forms/stats/index.ts", "死亡次数排行榜", "death_ranking"],
    ["ui/forms/system/index.ts", "自定义维度管理", "custom_dimensions"],
    ["ui/forms/system/index.ts", "领地飞行设置", "land_flight"],
    ["ui/forms/system/index.ts", "领地传送设置", "land_teleport_settings"],
    ["ui/forms/system/index.ts", "公会坐标（管理员）", "guild_waypoint"],
    ["ui/forms/behavior-log/index.ts", "打开完整筛选", "filter_search"],
    ["ui/forms/item-watch/index.ts", "重新筛选", "filter_refresh"],
    ["ui/forms/player/fake-player.ts", "寻路到坐标", "program_path_target"],
    ["ui/forms/player/fake-player.ts", "切换手持快捷栏", "program_hotbar"],
    ["ui/forms/player/index.ts", "form.button(name", "name_color"],
    ["ui/forms/system/anti-dupe-settings.ts", "form.button(`${n}`", "whitelist_remove"],
    ["ui/forms/system/player-inventory-admin.ts", "取走潜影盒", "shulker_take"],
    ["ui/forms/system/player-inventory-admin.ts", "复制一份潜影盒", "shulker_copy"],
  ];
  for (const [relativeFile, label, icon] of contracts) {
    const source = fs.readFileSync(path.join(scriptsRoot, ...relativeFile.split("/")), "utf8");
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`${escapedLabel}[\\s\\S]{0,180}?textures/icons/${icon}`));
  }
});
