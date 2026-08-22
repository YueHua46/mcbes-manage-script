const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

function walkTypeScript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkTypeScript(fullPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

test("main menu routes only its marked ActionForm into the custom JSON UI", () => {
  const constants = read("scripts", "core", "constants.ts");
  const serverFormText = read("resource_packs", "CreeperMenu", "ui", "server_form.json");
  const serverForm = JSON.parse(serverFormText);
  const ui = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const insertedFactory = serverForm.main_screen_content.modifications[0].value[0].creeper_menu_factory;

  assert.match(constants, /MENU_TITLE: "\/CMROOT 苦力怕菜单"/);
  assert.equal(insertedFactory.type, "panel");
  assert.equal(insertedFactory.factory.name, "server_form_factory");
  assert.equal(
    insertedFactory.factory.control_ids.long_form,
    "@creeper_menu.long_form_replacement"
  );
  assert.match(
    serverForm.long_form.bindings[1].source_property_name,
    /#title_text - '\/CMROOT '/
  );
  assert.doesNotMatch(serverFormText, /inside_header_panel|creeper_menu_native_visible/);
  assert.doesNotMatch(serverFormText, /\$longform_size|\$customform_size/);
  assert.equal(ui.root_route.visible, false);
  assert.equal(ui.project_action_route.visible, false);
  assert.equal(ui.root_route.bindings[0].source_control_name, "long_form_replacement");
  assert.match(ui.root_route.bindings[0].source_property_name, /#title_text - '\/CMROOT '/);
  assert.match(ui.project_action_route.bindings[0].source_property_name, /#title_text - '\/CMFORM '/);
  assert.doesNotMatch(serverFormText + JSON.stringify(ui), /\$content|\$title_marker/);
  assert.doesNotMatch(serverFormText, /long_form_switch|generic_long_form|special_inventory_form/);
});

test("project ActionForms use the themed route while unrelated and REPL forms stay native", () => {
  const serverForm = read("resource_packs", "CreeperMenu", "ui", "server_form.json");
  const ui = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");
  const wrapper = read("scripts", "ui", "creeper-action-form.ts");

  assert.match(serverForm, /"custom_form": "@server_form\.custom_form_switch"/);
  assert.match(serverForm, /"custom_form@server_form\.custom_form"/);
  assert.match(serverForm, /"custom_multiline_form@server_form\.custom_multiline_form"/);
  assert.match(serverForm, /#title_text - '\/CMROOT ' - '\/CMFORM '/);
  assert.match(ui, /"project_action_route"/);
  assert.match(ui, /"generic_long_form"/);
  assert.match(ui, /"control_name": "creeper_menu\.generic_dynamic_button"/);
  assert.match(wrapper, /CREEPER_ACTION_FORM_PREFIX = "\/CMFORM "/);
  assert.match(wrapper, /new MinecraftActionFormData\(\)/);
});

test("all project ActionForms except root and inventory forms use the routed wrapper", () => {
  const allowedNativeFiles = new Set([
    path.join(root, "scripts", "shared", "hooks", "use-form.ts"),
    path.join(root, "scripts", "ui", "creeper-action-form.ts"),
    path.join(root, "scripts", "ui", "components", "chest-ui", "chest-forms.ts"),
    path.join(root, "scripts", "ui", "forms", "server", "index.ts"),
  ]);
  const directImport = /import \{[^\r\n]*ActionFormData[^\r\n]*\} from "@minecraft\/server-ui";/;
  const offenders = walkTypeScript(path.join(root, "scripts"))
    .filter((filename) => !allowedNativeFiles.has(filename))
    .filter((filename) => directImport.test(fs.readFileSync(filename, "utf8")));

  assert.deepEqual(offenders, []);
});

test("atlas extraction removes enclosed chroma key and assigns whole connected artwork", () => {
  const builder = read("design", "menu-ui", "build.py");

  assert.match(builder, /def is_strong_key/);
  assert.match(builder, /def connected_components/);
  assert.match(builder, /components_by_cell/);
  assert.match(builder, /center_x = sum/);
  assert.doesNotMatch(builder, /atlas\.crop\(box\)/);
});

test("mosaic binds all thirteen fixed form collection indices exactly once", () => {
  const ui = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");
  const indices = [...ui.matchAll(/"\$cm_index": (\d+)/g)].map((match) => Number(match[1]));

  assert.deepEqual(indices.sort((a, b) => a - b), Array.from({ length: 13 }, (_, index) => index));
  assert.match(ui, /"binding_collection_name": "form_buttons"/);
  assert.match(ui, /"source_property_name": "\(not \(#text = ''\)\)"/);
  assert.match(ui, /"quick_row": \{[\s\S]*?"collection_name": "form_buttons"/);
});

test("custom menu is registered and every card has generated runtime artwork", () => {
  const definitions = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "_ui_defs.json"));
  const textureRoot = path.join(
    root,
    "resource_packs",
    "CreeperMenu",
    "textures",
    "ui",
    "creeper_menu",
    "cards"
  );
  const names = [
    "player",
    "waypoint",
    "land",
    "economy",
    "guild",
    "floating_text",
    "pvp",
    "stats",
    "quest",
    "other",
    "help",
    "menu_item",
    "server_settings",
  ];

  assert.ok(definitions.ui_defs.includes("ui/creeper_menu.json"));
  for (const name of names) {
    assert.ok(fs.existsSync(path.join(textureRoot, `${name}.png`)), `${name} artwork`);
    for (const state of ["default", "hover", "pressed"]) {
      assert.ok(fs.existsSync(path.join(textureRoot, `${name}_${state}.png`)), `${name} ${state}`);
      assert.ok(fs.existsSync(path.join(textureRoot, `${name}_${state}.json`)), `${name} ${state} metadata`);
    }
  }
});

test("server menu preserves fixed button slots and guards unavailable selections", () => {
  const source = read("scripts", "ui", "forms", "server", "index.ts");

  assert.match(source, /menuItems\.forEach/);
  assert.match(source, /form\.button\(available \? item\.text : "", available \? item\.icon : ""\)/);
  assert.match(source, /const selectedItem = menuItems\[data\.selection\]/);
  assert.match(source, /selectedItem\.alwaysVisible \|\| setting\.getState/);
});
