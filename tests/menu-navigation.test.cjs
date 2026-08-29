const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function walkTypeScript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkTypeScript(fullPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

test("submenu cards use the field-guide rhythm with a visible three-pixel gap", () => {
  const ui = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const item = ui.generic_dynamic_button;
  const button = ui["generic_button@common.button"];

  assert.deepEqual(item.size, ["100%", 39]);
  assert.deepEqual(button.size, ["100%", 36]);
  assert.equal(item.size[1] - button.size[1], 3);
  assert.equal(item.bindings[0].binding_collection_name, "form_buttons");
  const label = ui.generic_button_state.controls.find((control) => control.label).label;
  assert.deepEqual(label.size, ["100% - 64px", "default"]);
  assert.deepEqual(label.max_size, ["100% - 64px", 30]);
  assert.deepEqual(label.offset, [44, -1]);
  assert.deepEqual(button.controls[1]["hover@creeper_menu.generic_button_state"].$cm_state_offset, [0, 1]);
  assert.deepEqual(button.controls[2]["pressed@creeper_menu.generic_button_state"].$cm_state_offset, [0, 2]);
  assert.doesNotMatch(JSON.stringify(item), /common_buttons\.light_text_button/);
});

test("submenu header uses a branded field-guide title hierarchy", () => {
  const ui = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const title = ui.generic_header.controls.find((control) => control.title).title;
  const subtitle = ui.generic_header.controls.find((control) => control.subtitle).subtitle;
  const emblem = ui.generic_header.controls.find((control) => control.emblem).emblem;
  const dialog = ui.generic_long_form.controls[0].dialog;
  const contentFrame = dialog.controls.find((control) => control.content_frame).content_frame;
  const scroll = contentFrame.controls[0]["scroll@common.scrolling_panel"];

  assert.deepEqual(ui.generic_header.size, ["100% - 16px", 56]);
  assert.equal(ui.generic_header.size[0], contentFrame.size[0]);
  assert.deepEqual(title.offset, [50, -4]);
  assert.deepEqual(subtitle.offset, [51, 7]);
  assert.equal(subtitle.text, "冒险手册 · 选择行动");
  assert.equal(emblem.texture, "textures/ui/creeper_menu/submenu_emblem");
  assert.deepEqual(emblem.offset, [5, -2]);
  assert.equal(ui.generic_header.texture, "textures/ui/creeper_menu/header_band");
  assert.deepEqual(scroll.$scroll_size, [2, "100%"]);
  assert.deepEqual(scroll.size, ["100%", "100% - 10px"]);
  assert.deepEqual(scroll.$scrolling_pane_size, ["100%", "100%"]);
  assert.deepEqual(scroll.$scroll_bar_right_padding_size, [0, 0]);
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

test("project menu business buttons never omit their icon", () => {
  const allowedImplicitNavigation = /^(上一页|下一页|返回|关闭)/;
  const offenders = [];

  for (const filename of walkTypeScript(path.join(root, "scripts", "ui", "forms"))) {
    const source = fs.readFileSync(filename, "utf8");
    const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "button" &&
        node.arguments.length < 2
      ) {
        const firstArgument = node.arguments[0];
        const label = firstArgument && ts.isStringLiteralLike(firstArgument) ? firstArgument.text : undefined;
        if (!label || !allowedImplicitNavigation.test(label)) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          offenders.push(`${path.relative(root, filename)}:${position.line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  assert.deepEqual(offenders, []);
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

  const behaviorLog = read("scripts", "ui", "forms", "behavior-log", "index.ts");
  const behaviorRoot = section(behaviorLog, "export async function openBehaviorLogForm", "function executeBehaviorLogQuery");
  assert.match(behaviorRoot, /button\("返回", "textures\/icons\/back"\)/);
  assert.match(behaviorRoot, /result\.selection === 4/);
  assert.match(behaviorRoot, /openSystemSettingForm\(player\)/);
});
