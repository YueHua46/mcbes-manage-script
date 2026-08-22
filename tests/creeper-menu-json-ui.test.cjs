const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("main menu routes only its marked ActionForm into the custom JSON UI", () => {
  const constants = read("scripts", "core", "constants.ts");
  const serverForm = read("resource_packs", "CreeperMenu", "ui", "server_form.json");

  assert.match(constants, /MENU_TITLE: "\/CMROOT 苦力怕菜单"/);
  assert.match(serverForm, /"long_form": "@server_form\.long_form_switch"/);
  assert.match(serverForm, /#title_text = '\/CMROOT 苦力怕菜单'/);
  assert.match(serverForm, /not \(#title_text = '\/CMROOT 苦力怕菜单'\)/);
  assert.equal((serverForm.match(/"visible": false/g) ?? []).length, 5);
  assert.match(serverForm, /generic_long_form@creeper_menu\.generic_long_form/);
  assert.match(serverForm, /custom_form@creeper_menu\.generic_custom_form/);
  assert.match(serverForm, /special_inventory_form@server_form\.long_form/);
});

test("non-inventory subforms use themed action and modal layouts", () => {
  const ui = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");

  assert.match(ui, /"generic_long_form"/);
  assert.match(ui, /"control_name": "creeper_menu\.generic_dynamic_button"/);
  assert.match(ui, /"generic_custom_form"/);
  assert.match(ui, /"form@server_form\.custom_form_panel"/);
  assert.doesNotMatch(
    ui.match(/"generic_screen_background"[\s\S]*?"generic_header"/)[0],
    /"brand"/
  );
  assert.match(ui, /"generic_dynamic_button@common\.button": \{[\s\S]*?"visible": false/);
  assert.match(ui, /"source_property_name": "\(not \(#text = ''\)\)"/);
});

test("mosaic binds all thirteen fixed form collection indices exactly once", () => {
  const ui = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");
  const indices = [...ui.matchAll(/"\$cm_index": (\d+)/g)].map((match) => Number(match[1]));

  assert.deepEqual(indices.sort((a, b) => a - b), Array.from({ length: 13 }, (_, index) => index));
  assert.match(ui, /"binding_collection_name": "form_buttons"/);
  assert.match(ui, /"source_property_name": "\(not \(#text = ''\)\)"/);
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
