const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const questIconManifest = JSON.parse(read("design", "menu-ui", "quest-icon-manifest.json"));

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
    const distances = [Math.abs(estimate - left), Math.abs(estimate - above), Math.abs(estimate - upperLeft)];
    return distances[0] <= distances[1] && distances[0] <= distances[2]
      ? left
      : distances[1] <= distances[2]
        ? above
        : upperLeft;
  };
  for (let y = 0; y < height; y += 1) {
    const packedRow = y * (stride + 1);
    const filter = packed[packedRow];
    for (let x = 0; x < stride; x += 1) {
      const output = y * stride + x;
      const left = x >= 4 ? pixels[output - 4] : 0;
      const above = y > 0 ? pixels[output - stride] : 0;
      const upperLeft = x >= 4 && y > 0 ? pixels[output - stride - 4] : 0;
      const predictors = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)];
      assert.notEqual(predictors[filter], undefined, `unsupported PNG filter ${filter}`);
      pixels[output] = (packed[packedRow + x + 1] + predictors[filter]) & 0xff;
    }
  }
  return {
    width,
    height,
    alpha: Array.from({ length: width * height }, (_, index) => pixels[index * 4 + 3]),
  };
}

function questMarker(index) {
  const digits = "0123456789abcdef";
  return `§r§${digits[Math.floor(index / 16)]}§${digits[index % 16]}§r`;
}

test("quest rarity themes drive mutually exclusive HUD markers and hide the native actionbar", () => {
  const hud = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "hud_screen.json"));
  const source = JSON.stringify(hud);
  for (const rarity of ["COMMON", "RARE", "EPIC", "LEGENDARY"]) {
    const marker = `[CMQUEST_${rarity}]`;
    assert.match(source, new RegExp(marker.replace(/[\[\]]/g, "\\$&")));
    assert.match(hud.hud_actionbar_text.visible, new RegExp(marker.replace(/[\[\]]/g, "\\$&")));
  }
  assert.equal(hud.cm_quest_toast.type, "image");
  assert.equal(hud.cm_quest_toast.texture, "textures/ui/creeper_menu/submenu_panel");
  assert.deepEqual(hud.cm_quest_toast.controls[3].quest_text.color, [0.2, 0.18, 0.16]);
  assert.equal(hud.cm_quest_toast.controls[3].quest_text.shadow, false);
  assert.equal(hud["cm_quest_toast_epic@hud.cm_quest_toast"].$cm_quest_show_corner_gems, true);
  assert.equal(hud["cm_quest_toast_legendary@hud.cm_quest_toast"].$cm_quest_show_double_line, true);
  assert.deepEqual(
    [
      hud.cm_quest_toast.$cm_quest_rarity_label,
      hud["cm_quest_toast_rare@hud.cm_quest_toast"].$cm_quest_rarity_label,
      hud["cm_quest_toast_epic@hud.cm_quest_toast"].$cm_quest_rarity_label,
      hud["cm_quest_toast_legendary@hud.cm_quest_toast"].$cm_quest_rarity_label,
    ],
    ["普通委托", "稀有委托", "史诗委托", "传说委托"]
  );
  assert.equal(hud.cm_quest_toast.anchor_from, "top_right");
  assert.equal(hud.cm_quest_toast.anchor_to, "top_right");
  assert.ok(hud.cm_quest_toast.size[0] <= 210, "toast must stay compact in the right HUD column");
  assert.ok(hud.cm_quest_toast.offset[0] >= -10, "toast must hug the right safe edge");
  assert.ok(hud.cm_quest_toast.offset[1] <= 12, "toast must stay in the top-right corner");
});

test("all 158 preset quests have unique transparent 32px HUD artwork and fixed markers", () => {
  const theme = read("scripts", "features", "quest", "notifications", "quest-experience-theme.ts");
  const generatedMap = read("scripts", "features", "quest", "notifications", "generated-quest-icon-map.ts");
  const hudSource = read("resource_packs", "CreeperMenu", "ui", "hud_screen.json");
  const hud = JSON.parse(hudSource);
  const badgeChip = hud.cm_quest_toast.controls.find((control) => control.badge_chip).badge_chip;
  const hashes = new Set();
  const markers = new Set();
  assert.equal(questIconManifest.icons.length, 158);
  assert.match(theme, /GENERATED_PRESET_QUEST_ICONS/);
  for (const entry of questIconManifest.icons) {
    const marker = questMarker(entry.markerIndex);
    const relative = path.join(
      "resource_packs",
      "CreeperMenu",
      "textures",
      "ui",
      "creeper_menu",
      "quest_icons",
      `${entry.slug}.png`
    );
    const absolute = path.join(root, relative);
    const bytes = fs.readFileSync(absolute);
    const { width, height, alpha } = readRgbaAlpha(absolute);
    assert.equal(width, 32, `${entry.slug} width`);
    assert.equal(height, 32, `${entry.slug} height`);
    assert.equal(bytes[25], 6, `${entry.slug} must use RGBA`);
    assert.ok(alpha.some(Boolean), `${entry.slug} artwork must not be empty`);
    for (let position = 0; position < 32; position += 1) {
      for (const edge of [0, 1]) {
        assert.equal(alpha[edge * width + position], 0, `${entry.slug} top edge`);
        assert.equal(alpha[(31 - edge) * width + position], 0, `${entry.slug} bottom edge`);
        assert.equal(alpha[position * width + edge], 0, `${entry.slug} left edge`);
        assert.equal(alpha[position * width + 31 - edge], 0, `${entry.slug} right edge`);
      }
    }
    hashes.add(crypto.createHash("sha256").update(bytes).digest("hex"));
    markers.add(marker);
    assert.match(generatedMap, new RegExp(entry.questId.replaceAll(".", "\\.")));
    assert.match(generatedMap, new RegExp(`quest_icons/${entry.slug}`));
    assert.match(generatedMap, new RegExp(marker));
    assert.match(hudSource, new RegExp(`quest_icons/${entry.slug}`));

    const icon = badgeChip.controls.find((control) => control[entry.slug])?.[entry.slug];
    assert.ok(icon, `${entry.slug} HUD control`);
    assert.equal(icon.anchor_from, "center", `${entry.slug} horizontal/vertical origin`);
    assert.equal(icon.anchor_to, "center", `${entry.slug} horizontal/vertical destination`);
    assert.deepEqual(icon.offset, [0, 2], `${entry.slug} optical vertical centering`);
    assert.match(icon.visible, new RegExp(marker));
    assert.match(badgeChip.controls[0].badge_icon.visible, new RegExp(marker));
  }
  assert.equal(hashes.size, 158, "every preset quest needs distinct artwork");
  assert.equal(markers.size, 158, "every preset quest needs a distinct marker");
});

test("every quest rarity and feedback kind has an original registered OGG cue", () => {
  const definitions = JSON.parse(
    read("resource_packs", "CreeperMenu", "sounds", "sound_definitions.json")
  ).sound_definitions;
  for (const rarity of ["common", "rare", "epic", "legendary"]) {
    for (const kind of ["accept", "progress", "complete", "claim"]) {
      const soundId = `creeper.quest.${rarity}.${kind}`;
      const sound = definitions[soundId];
      assert.ok(sound, soundId);
      const file = path.join(root, "resource_packs", "CreeperMenu", `${sound.sounds[0].name}.ogg`);
      assert.equal(fs.existsSync(file), true, file);
      assert.equal(fs.readFileSync(file).subarray(0, 4).toString("ascii"), "OggS");
    }
  }
  assert.match(read("resource_packs", "CreeperMenu", "sounds", "QUEST_ATTRIBUTION.txt"), /确定性合成/);
  assert.match(read("tools", "generate_quest_sounds.py"), /uses no sampled or third-party audio/);
});

test("quest feedback differentiates rarity, plays sounds, and broadcasts persisted completions", () => {
  const theme = read("scripts", "features", "quest", "notifications", "quest-experience-theme.ts");
  const notification = read("scripts", "features", "quest", "notifications", "quest-notification-service.ts");
  for (const rarity of ["common", "rare", "epic", "legendary"]) {
    assert.match(theme, new RegExp(`${rarity}: \\{`));
  }
  for (const color of ["§2", "§3", "§5", "§6"]) {
    assert.match(theme, new RegExp(color));
  }
  assert.match(notification, /§0\$\{title\}/);
  assert.match(notification, /getQuestIconMarker\(change\.quest\.id\)/);
  assert.match(notification, /player\.playSound\(getQuestFeedbackSound/);
  assert.match(notification, /world\.sendMessage/);
  assert.match(notification, /completedNotified/);
  assert.match(notification, /change\.quest\.completionMessage/);
  assert.match(notification, /sanitizeQuestDisplayText\(change\.quest\.completionMessage/);
  assert.match(notification, /QUEST_REWARD_LOCATION_HINT = "奖励已解锁 · 可到任务「冒险日志」领取"/);
  assert.match(notification, /QUEST_COMPLETION_MESSAGE_MAX_LENGTH = 40/);
  assert.match(notification, /PROGRESS_SOUND_COOLDOWN_MS/);
  assert.match(notification, /QUEST_TOAST_EXTENSION_TICKS = 60/);
  for (const baseTicks of [36, 48, 54, 58, 70]) {
    assert.match(notification, new RegExp(`= ${baseTicks} \\+ QUEST_TOAST_EXTENSION_TICKS`));
  }
  assert.match(notification, /QUEST_AUTO_ACCEPT_FOLLOW_UP_DELAY_TICKS = QUEST_COMPLETION_TOAST_TTL_TICKS \+ 10/);
  assert.match(notification, /replaceKey: `quest\.\$\{kind\}:\$\{questId \?\? title\}`/);
  assert.match(notification, /onDisplay: \(\) => this\.playSound/);
});

test("first preset slice uses playful Chinese titles instead of functional placeholders", () => {
  const preset = read("scripts", "features", "quest", "presets", "core", "first-slice.ts");
  for (const title of [
    "要致富，先撸树",
    "四格小桌，手搓万物",
    "木镐：你的班就上到这儿",
    "这颗蓝的，含金量很高",
    "主世界待腻了",
    "你火气很大啊",
  ]) {
    assert.match(preset, new RegExp(title));
  }
});

test("player quest details use explicit objectives, compact rewards, and supported progress glyphs", () => {
  const form = read("scripts", "ui", "forms", "quest-system", "index.ts");
  assert.match(form, /goal\.displayText/);
  assert.match(form, /金币 \+\$\{amount\}/);
  assert.match(form, /经验 \+\$\{amount\}/);
  assert.match(form, /任务说明/);
  assert.match(form, /目标进度/);
  assert.doesNotMatch(form, /[■□]/);
  assert.match(form, /待领取奖励 \(\$\{summary\.claimable\}\)\\n点这里把辛苦费收好/);
  assert.match(form, /openQuestClaimableListForm/);
  assert.match(form, /const actions: Array<\(\) => void> = \[\]/);
  assert.match(form, /actions\[response\.selection\]\?\.\(\)/);
});

test("quest administration uses the routed project forms without DDUI", () => {
  const form = read("scripts", "ui", "forms", "quest-system", "index.ts");
  const definitions = read("scripts", "features", "quest", "services", "quest-definition.ts");
  const playerService = read("scripts", "features", "quest", "services", "quest-player.ts");
  const rewardHandlers = read("scripts", "features", "quest", "rewards", "runtime-reward-handlers.ts");
  assert.match(form, /CreeperActionFormData as ActionFormData/);
  assert.match(form, /CreeperModalFormData as ModalFormData/);
  assert.match(form, /CreeperMessageFormData as MessageFormData/);
  assert.match(form, /\.title\("任务编辑器"\)/);
  assert.match(form, /\.title\("任务基础信息"\)/);
  assert.match(form, /\.title\(persisted \? "删除任务" : "放弃草稿"\)/);
  assert.match(form, /\.textField\("完成提示语"/);
  assert.match(form, /addableQuestRewardSchemas = questRewardSchemas\.filter/);
  assert.match(form, /schema\.key !== "send_message"/);
  assert.match(form, /预设任务管理/);
  assert.match(form, /overrideChapterEnabled/);
  assert.match(form, /overrideQuestEnabled/);
  assert.match(form, /overrideQuestRewards/);
  assert.match(form, /quest_preset_pack_states|saveServerState/);
  assert.match(playerService, /getJournalQuests\(player: Player\)/);
  assert.match(playerService, /instance\.completionSnapshot\.rewards\.map/);
  assert.match(playerService, /claimable: journalQuests\.filter/);
  assert.match(definitions, /key: "send_message"/);
  assert.match(rewardHandlers, /action: "send_message"/);
  assert.doesNotMatch(form, /\bCustomForm\b|\bObservable(?:Boolean|Number|String)\b|QuestDdui|QuestDDUI/);
});
