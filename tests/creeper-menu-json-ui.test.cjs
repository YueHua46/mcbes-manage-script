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
  const factoryModification = serverForm.main_screen_content.modifications[0];
  const insertedFactory = factoryModification.value[0].server_form_factory;

  assert.match(constants, /MENU_TITLE: "\/CMROOT 苦力怕菜单"/);
  assert.equal(factoryModification.operation, "insert_front");
  assert.equal(insertedFactory.type, "factory");
  assert.equal(insertedFactory.control_ids.long_form, "long_form_router@creeper_menu.long_form_router");
  assert.equal(insertedFactory.control_ids.custom_form, "@common.empty_panel");
  assert.deepEqual(serverForm["custom_form@server_form.custom_form_switch"], {});
  assert.equal(serverForm["main_screen_content/server_form_factory"], undefined);
  assert.ok(serverForm.long_form);
  assert.match(serverForm.long_form.bindings[1].source_property_name, /#title_text - '\/CMROOT '/);
  const nativeDialog = serverForm.long_form.controls[0]["long_form@common_dialogs.main_panel_no_buttons"];
  assert.match(nativeDialog.bindings[1].source_property_name, /#title_text[\s\S]*'\/CMROOT '[\s\S]*'\/CMFORM '/);
  assert.doesNotMatch(serverFormText, /inside_header_panel|creeper_menu_native_visible/);
  assert.doesNotMatch(serverFormText, /\$longform_size|\$customform_size/);
  assert.equal(ui.form_type.visible, false);
  assert.equal(ui.native_route, undefined);
  assert.equal(ui.form_type.bindings[0].binding_name, "#title_text");
  assert.equal(ui.form_type.bindings[0].source_control_name, undefined);
  assert.match(
    ui.form_type.bindings[1].source_property_name,
    /#title_text = \$min[\s\S]*#title_text > \$min[\s\S]*#title_text < \$max/
  );
  assert.equal(ui.form_type.bindings[2].target_property_name, "#title");
  const rootRoute = ui.long_form_router.controls[0]["main_menu@creeper_menu.form_type"];
  const projectRoute = ui.long_form_router.controls[1]["project_action_form@creeper_menu.form_type"];
  assert.deepEqual(rootRoute, {
    $min: "/CMROOT ",
    $max: "/CMROOT 􀐏",
    $content: "creeper_menu.root",
  });
  assert.deepEqual(projectRoute, {
    $min: "/CMFORM ",
    $max: "/CMFORM 􀐏",
    $content: "creeper_menu.generic_long_form",
  });
  assert.notEqual(rootRoute.$min, projectRoute.$min);
  assert.notEqual(rootRoute.$max, projectRoute.$max);
  assert.doesNotMatch(JSON.stringify(ui.form_type), /source_control_name/);
  assert.doesNotMatch(JSON.stringify(ui), /root_route|project_action_route/);
  assert.doesNotMatch(serverFormText, /long_form_switch|generic_long_form|special_inventory_form/);
  assert.equal(
    ui.root.controls.some((control) => control.screen_dim || control.ambient_background),
    false
  );
  assert.equal(
    ui.generic_long_form.controls.some((control) => control.screen_dim || control.ambient_background),
    false
  );
});

test("AI and maintainer documentation preserves the mutually exclusive routing contract", () => {
  const agents = read("AGENTS.md");
  const routing = read("design", "menu-ui", "JSON_UI_ROUTING.md");

  assert.match(agents, /按标题命名空间路由的互斥表单渲染/);
  assert.match(agents, /不得通过 `source_control_name`/);
  assert.match(routing, /"type": "factory"/);
  assert.match(routing, /#title_text = \$min/);
  assert.match(routing, /#title_text > \$min and #title_text < \$max/);
  assert.match(routing, /同一个表单 factory 内的多个自定义分支同时可见/);
  assert.match(routing, /\/CMROOT /);
  assert.match(routing, /\/CMFORM /);
});

test("project ActionForms use the themed route while unrelated and REPL forms stay native", () => {
  const serverFormText = read("resource_packs", "CreeperMenu", "ui", "server_form.json");
  const serverForm = JSON.parse(serverFormText);
  const ui = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");
  const wrapper = read("scripts", "ui", "creeper-action-form.ts");
  const nativeCustom = serverForm.custom_form_switch.controls[0]["native_custom_form@server_form.native_custom_form"];
  const multilineCustom =
    serverForm.custom_form_switch.controls[1]["custom_multiline_form@server_form.custom_multiline_form"];

  assert.match(serverFormText, /"custom_form": "@common\.empty_panel"/);
  assert.deepEqual(serverForm["custom_form@server_form.custom_form_switch"], {});
  assert.equal(
    serverForm["native_custom_form@common_dialogs.main_panel_no_buttons"].$child_control,
    "server_form.custom_form_panel"
  );
  assert.match(serverFormText, /#title_text - '\/CMROOT ' - '\/CMFORM '/);
  assert.equal(nativeCustom.visible, false);
  assert.equal(multilineCustom.visible, false);
  assert.equal(nativeCustom.bindings[0].binding_name, "#title_text");
  assert.equal(nativeCustom.bindings[0].binding_type, undefined);
  assert.equal(multilineCustom.bindings[0].binding_name, "#title_text");
  assert.equal(multilineCustom.bindings[0].binding_type, undefined);
  assert.equal(nativeCustom.bindings[1].source_property_name, "(not (#title_text = 'JavaScript REPL'))");
  assert.equal(multilineCustom.bindings[1].source_property_name, "(#title_text = 'JavaScript REPL')");
  assert.doesNotMatch(JSON.stringify(serverForm.custom_form_switch), /\$flag_form_title/);
  assert.match(ui, /"project_action_form@creeper_menu\.form_type"/);
  assert.match(ui, /"\$min": "\/CMFORM "/);
  assert.match(ui, /"generic_long_form"/);
  assert.match(ui, /"button": "creeper_menu\.generic_dynamic_button"/);
  assert.match(wrapper, /CREEPER_ACTION_FORM_PREFIX = "\/CMFORM "/);
  assert.match(wrapper, /new MinecraftActionFormData\(\)/);
});

test("generic forms render their title and keep dynamic button states isolated", () => {
  const ui = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const title = ui.generic_header.controls.find((control) => control.title).title;
  const buttons = ui.generic_long_form_content.controls[0].buttons;
  const button = ui.generic_dynamic_button;
  const nativeButton = button.controls[0]["button@common_buttons.light_text_button"];

  assert.equal(title.text, "#form_text");
  assert.equal(title.bindings[0].binding_name, "#form_text");
  assert.equal(buttons.factory.control_ids.button, "creeper_menu.generic_dynamic_button");
  assert.equal(buttons.bindings[0].binding_name, "#form_button_contents");
  assert.notEqual(buttons.bindings[0].binding_name, "#form_button_length");

  assert.equal(button.visible, false);
  assert.match(button.bindings.at(-1).source_property_name, /not \(#text = ''\)/);
  assert.equal(button.bindings.at(-1).target_property_name, "#visible");
  assert.equal(nativeButton.$button_text_binding_type, "collection");
  assert.equal(nativeButton.$button_text_grid_collection_name, "form_buttons");
  assert.deepEqual(nativeButton.$default_text_color, [0.25, 0.22, 0.19]);
  assert.deepEqual(nativeButton.$hover_text_color, [0.18, 0.16, 0.14]);
  assert.deepEqual(nativeButton.$pressed_text_color, [0.34, 0.29, 0.24]);
  assert.equal(nativeButton.bindings.length, 1);
  assert.equal(nativeButton.bindings[0].binding_type, "collection_details");
  assert.equal(ui.generic_button_default_state, undefined);
  assert.equal(ui.generic_button_hover_state, undefined);
  assert.equal(ui.generic_button_pressed_state, undefined);
});

test("project ActionForm wrapper sends visible titles through form text and bodies through labels", () => {
  const wrapper = read("scripts", "ui", "creeper-action-form.ts");

  assert.match(wrapper, /\.title\(routedTitle\(this\.titleText\)\)\.body\(this\.titleText\)/);
  assert.match(wrapper, /if \(this\.bodyText !== undefined\) form\.label\(this\.bodyText\)/);
  assert.doesNotMatch(wrapper, /private readonly form = new MinecraftActionFormData/);
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
  assert.match(builder, /def extract_scene_cards/);
  assert.match(builder, /def save_full_texture/);
  assert.match(builder, /SCENE_SPECS/);
  assert.doesNotMatch(builder, /atlas\.crop\(box\)/);
});

test("mosaic binds all thirteen fixed form collection indices exactly once", () => {
  const ui = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");
  const indices = [...ui.matchAll(/"\$cm_index": (\d+)/g)].map((match) => Number(match[1]));

  assert.deepEqual(
    indices.sort((a, b) => a - b),
    Array.from({ length: 13 }, (_, index) => index)
  );
  assert.match(ui, /"binding_collection_name": "form_buttons"/);
  assert.match(ui, /"source_property_name": "\(not \(#text = ''\)\)"/);
  assert.match(ui, /"quick_row": \{[\s\S]*?"collection_name": "form_buttons"/);
});

test("custom menu is registered and every card has generated runtime artwork", () => {
  const definitions = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "_ui_defs.json"));
  const ui = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const builder = read("design", "menu-ui", "build.py");
  const uiTextureRoot = path.join(root, "resource_packs", "CreeperMenu", "textures", "ui", "creeper_menu");
  const textureRoot = path.join(uiTextureRoot, "cards");
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
  assert.equal(ui.root.controls[0].dialog.type, "panel");
  assert.equal(ui.root.controls[0].dialog.texture, undefined);
  assert.equal(ui.generic_long_form.controls[0].dialog.texture, "textures/ui/creeper_menu/submenu_panel");
  assert.equal(ui.card_state.controls.length, 0);
  assert.match(builder, /creeper-feature-atlas-cozy-imagegen\.png/);
  assert.match(builder, /creeper-mosaic-left-323-imagegen\.png/);
  assert.match(builder, /creeper-mosaic-right-113-imagegen\.png/);
  for (const texture of [
    "submenu_panel.png",
    "submenu_panel.json",
    "close_frame.png",
    "close_frame.json",
    "icon_chip.png",
    "icon_chip.json",
    "line.png",
  ]) {
    assert.ok(fs.existsSync(path.join(uiTextureRoot, texture)), texture);
  }
  for (const state of ["default", "hover", "pressed"]) {
    assert.ok(fs.existsSync(path.join(textureRoot, `generic_${state}.png`)), `generic ${state}`);
    assert.ok(fs.existsSync(path.join(textureRoot, `generic_${state}.json`)), `generic ${state} metadata`);
  }
  assert.equal(fs.existsSync(path.join(root, "resource_packs", "CreeperMenu", "ui", "server_form_dark.json")), false);
  for (const name of names) {
    assert.ok(fs.existsSync(path.join(textureRoot, `${name}.png`)), `${name} artwork`);
    for (const state of ["default", "hover", "pressed"]) {
      assert.ok(fs.existsSync(path.join(textureRoot, `${name}_${state}.png`)), `${name} ${state}`);
      assert.equal(
        fs.existsSync(path.join(textureRoot, `${name}_${state}.json`)),
        false,
        `${name} ${state} must remain a full image instead of a nineslice`
      );
    }
  }
});

test("server menu preserves fixed button slots and guards unavailable selections", () => {
  const source = read("scripts", "ui", "forms", "server", "index.ts");

  assert.match(source, /const activeServerMenuPlayers = new Set<string>\(\)/);
  assert.match(source, /activeServerMenuPlayers\.has\(player\.id\)/);
  assert.match(source, /activeServerMenuPlayers\.add\(player\.id\)/);
  assert.match(source, /finally \{[\s\S]*activeServerMenuPlayers\.delete\(player\.id\)/);
  assert.match(source, /menuItems\.forEach/);
  assert.match(source, /form\.button\(available \? item\.text : "", available \? item\.icon : ""\)/);
  assert.match(source, /const selectedItem = menuItems\[data\.selection\]/);
  assert.match(source, /selectedItem\.alwaysVisible \|\| setting\.getState/);
});
