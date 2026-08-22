const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("main menu routes only its marked ActionForm into the custom JSON UI", () => {
  const constants = read("scripts", "core", "constants.ts");
  const serverFormText = read("resource_packs", "CreeperMenu", "ui", "server_form.json");
  const serverForm = JSON.parse(serverFormText);
  const ui = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const insertedFactory = serverForm.main_screen_content.modifications[0].value[0].creeper_menu_factory;

  assert.match(constants, /MENU_TITLE: "\/CMROOT 苦力怕菜单"/);
  assert.equal(insertedFactory.type, "factory");
  assert.equal(
    insertedFactory.control_ids.long_form,
    "long_form_replacement@creeper_menu.long_form_replacement"
  );
  assert.equal(serverForm.long_form.bindings[0].source_control_name, "inside_header_panel");
  assert.match(
    serverForm.long_form_panel.modifications[0].value[0].source_property_name,
    /#title_text < '\/CMROOT '/
  );
  assert.equal(ui.form_type.visible, false);
  assert.match(ui.form_type.bindings[1].source_property_name, /#title_text > \$min/);
  assert.doesNotMatch(serverFormText, /long_form_switch|generic_long_form|special_inventory_form/);
});

test("unmarked subforms keep the project's stable native and REPL routes", () => {
  const serverForm = read("resource_packs", "CreeperMenu", "ui", "server_form.json");
  const ui = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");

  assert.match(serverForm, /"custom_form": "@server_form\.custom_form_switch"/);
  assert.match(serverForm, /"custom_form@server_form\.custom_form"/);
  assert.match(serverForm, /"custom_multiline_form@server_form\.custom_multiline_form"/);
  assert.doesNotMatch(ui, /generic_(?:long|custom)_form|generic_screen_background/);
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
