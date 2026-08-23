const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("submenu cards stay compact with a visible three-pixel gap", () => {
  const ui = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const item = ui.generic_dynamic_button;
  const button = ui["generic_button@common.button"];

  assert.deepEqual(item.size, ["100%", 36]);
  assert.deepEqual(button.size, ["100%", 33]);
  assert.equal(item.size[1] - button.size[1], 3);
  assert.equal(item.bindings[0].binding_collection_name, "form_buttons");
  assert.deepEqual(button.controls[1]["hover@creeper_menu.generic_button_state"].$cm_state_offset, [0, 1]);
  assert.deepEqual(button.controls[2]["pressed@creeper_menu.generic_button_state"].$cm_state_offset, [0, 2]);
  assert.doesNotMatch(JSON.stringify(item), /common_buttons\.light_text_button/);
});

test("submenu header uses one vertically centered title without a duplicate subtitle", () => {
  const ui = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const title = ui.generic_header.controls[0].title;

  assert.deepEqual(title.offset, [0, 0]);
  assert.equal(ui.generic_header.controls.some((control) => "subtitle" in control), false);
});

test("project ActionForms supply icons for implicit navigation buttons", () => {
  const wrapper = read("scripts", "ui", "creeper-action-form.ts");

  assert.match(wrapper, /function resolveImplicitNavigationIcon/);
  assert.match(wrapper, /startsWith\("上一页"\)[\s\S]*textures\/icons\/left_arrow/);
  assert.match(wrapper, /startsWith\("下一页"\)[\s\S]*textures\/icons\/right_arrow/);
  assert.match(wrapper, /startsWith\("返回"\)[\s\S]*startsWith\("关闭"\)[\s\S]*textures\/icons\/back/);
  assert.match(wrapper, /iconPath: iconPath \?\? resolveImplicitNavigationIcon\(text\)/);
  assert.match(read("scripts", "ui", "components", "dialog.ts"), /button\("返回", "textures\/icons\/back"\)/);
});

test("root and nested menus return to their immediate parent", () => {
  const server = read("scripts", "ui", "forms", "server", "index.ts");
  const guildEntry = section(server, 'id: "guild"', 'id: "floatingText"');
  assert.match(guildEntry, /void openGuildMenuForm\(player\)/);
  assert.doesNotMatch(guildEntry, /await openGuildMenuForm/);

  const other = read("scripts", "ui", "forms", "other", "index.ts");
  const author = section(other, "function openAuthorListForm", "export function openBaseFunctionForm");
  const otherRoot = section(other, "export function openBaseFunctionForm", "export const openLeaveMessageForms");
  const messageBoard = section(other, "export const openLeaveMessageForms", "export const openLeaveMessageListForm");
  assert.match(author, /openBaseFunctionForm\(player\)/);
  assert.doesNotMatch(author, /openServerMenuForm\(player\)/);
  assert.match(otherRoot, /openServerMenuForm\(player\)/);
  assert.match(messageBoard, /openBaseFunctionForm\(player\)/);
  assert.doesNotMatch(messageBoard, /openServerMenuForm\(player\)/);

  const player = read("scripts", "ui", "forms", "player", "index.ts");
  const chat = section(player, "export function openChatForm", "export function openDeleteChatBlackListForm");
  assert.match(chat, /openPlayerActionForm\(player\)/);
  assert.doesNotMatch(chat, /openServerMenuForm\(player\)/);
});
