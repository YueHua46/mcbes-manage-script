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
  assert.equal(insertedFactory.control_ids.custom_form, "custom_form_router@creeper_modal.custom_form_router");
  assert.equal(serverForm.custom_form.type, "panel");
  assert.equal(serverForm.custom_form_switch, undefined);
  assert.equal(serverForm["custom_form@server_form.custom_form_switch"], undefined);
  assert.equal(serverForm["main_screen_content/server_form_factory"], undefined);
  assert.ok(serverForm.long_form);
  assert.match(serverForm.long_form.bindings[1].source_property_name, /#title_text - '\/CMROOT '/);
  const nativeDialog = serverForm.long_form.controls[0]["long_form@common_dialogs.main_panel_no_buttons"];
  assert.match(
    nativeDialog.bindings[1].source_property_name,
    /#title_text[\s\S]*'\/CMROOT '[\s\S]*'\/CMFORM '[\s\S]*'\/CMMESSAGE '/
  );
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
  const messageRoute = ui.long_form_router.controls[2]["project_message_form@creeper_menu.form_type"];
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
  assert.deepEqual(messageRoute, {
    $min: "/CMMESSAGE ",
    $max: "/CMMESSAGE 􀐏",
    $content: "creeper_menu.message_form",
  });
  assert.deepEqual(ui["message_form@creeper_message.form"], {});
  assert.equal(new Set([rootRoute.$min, projectRoute.$min, messageRoute.$min]).size, 3);
  assert.equal(new Set([rootRoute.$max, projectRoute.$max, messageRoute.$max]).size, 3);
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
  assert.match(routing, /\/CMMESSAGE /);
});

test("project ActionForms use the themed route while unrelated and REPL forms stay native", () => {
  const serverFormText = read("resource_packs", "CreeperMenu", "ui", "server_form.json");
  const serverForm = JSON.parse(serverFormText);
  const ui = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");
  const wrapper = read("scripts", "ui", "creeper-action-form.ts");
  const nativeCustom = serverForm.custom_form.controls[0]["native_custom_form@server_form.native_custom_form"];
  const multilineCustom = serverForm.custom_form.controls[1]["custom_multiline_form@server_form.custom_multiline_form"];

  assert.match(serverFormText, /"custom_form": "custom_form_router@creeper_modal\.custom_form_router"/);
  assert.equal(serverForm.custom_form.bindings[0].binding_name, "#title_text");
  assert.equal(serverForm.custom_form.bindings[0].binding_type, "global");
  assert.equal(
    serverForm["native_custom_form@common_dialogs.main_panel_no_buttons"].$child_control,
    "server_form.custom_form_panel"
  );
  assert.match(serverFormText, /#title_text - '\/CMROOT ' - '\/CMFORM ' - '\/CMMESSAGE '/);
  assert.equal(nativeCustom.visible, false);
  assert.equal(multilineCustom.visible, false);
  assert.equal(nativeCustom.bindings[0].binding_name, "#title_text");
  assert.equal(nativeCustom.bindings[0].binding_type, "global");
  assert.equal(multilineCustom.bindings[0].binding_name, "#title_text");
  assert.equal(multilineCustom.bindings[0].binding_type, "global");
  assert.equal(
    nativeCustom.bindings[1].source_property_name,
    "((#title_text - '/CMMODAL ' - 'JavaScript REPL') = #title_text)"
  );
  assert.equal(multilineCustom.bindings[1].source_property_name, "(#title_text = 'JavaScript REPL')");
  assert.doesNotMatch(JSON.stringify(serverForm.custom_form), /creeper_modal\.form|project_custom/);
  assert.doesNotMatch(JSON.stringify(serverForm.custom_form), /\$flag_form_title/);
  assert.match(ui, /"project_action_form@creeper_menu\.form_type"/);
  assert.match(ui, /"\$min": "\/CMFORM "/);
  assert.match(ui, /"generic_long_form"/);
  assert.match(ui, /"button": "creeper_menu\.generic_dynamic_button"/);
  assert.match(wrapper, /CREEPER_ACTION_FORM_PREFIX = "\/CMFORM "/);
  assert.match(wrapper, /new MinecraftActionFormData\(\)/);
});

test("project MessageForms use a dedicated two-button themed route", () => {
  const serverForm = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "server_form.json"));
  const menu = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const message = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_message.json"));
  const definitions = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "_ui_defs.json"));
  const wrapper = read("scripts", "ui", "creeper-message-form.ts");
  const route = menu.long_form_router.controls[2]["project_message_form@creeper_menu.form_type"];
  const nativeDialog = serverForm.long_form.controls[0]["long_form@common_dialogs.main_panel_no_buttons"];
  const titleBindings = message.header.controls[0].title.bindings;
  const footerControls = message.footer.controls;
  const button = message["message_button@common.button"];

  assert.ok(definitions.ui_defs.includes("ui/creeper_message.json"));
  assert.ok(
    definitions.ui_defs.indexOf("ui/creeper_message.json") < definitions.ui_defs.indexOf("ui/creeper_menu.json"),
    "creeper_message must be registered before creeper_menu inherits its controls"
  );
  assert.ok(fs.existsSync(path.join(root, "design", "menu-ui", "message-preview.png")));
  assert.deepEqual(route, {
    $min: "/CMMESSAGE ",
    $max: "/CMMESSAGE 􀐏",
    $content: "creeper_menu.message_form",
  });
  assert.deepEqual(menu["message_form@creeper_message.form"], {});
  assert.match(nativeDialog.bindings[1].source_property_name, /'\/CMMESSAGE '/);
  assert.equal(titleBindings[0].binding_name, "#title_text");
  assert.equal(titleBindings[0].source_control_name, undefined);
  assert.equal(titleBindings[1].source_property_name, "(#title_text - '/CMMESSAGE ')");
  assert.equal(message.body_content.controls[0].body.text, "#form_text");
  assert.equal(message.body_content.controls[0].body.bindings[0].binding_name, "#form_text");
  assert.deepEqual(message.form.controls[0].dialog.controls[1].body_frame.size, ["100% - 14px", "100% - 94px"]);
  assert.equal(footerControls[0]["button_one@creeper_message.message_button"].$cm_index, 0);
  assert.deepEqual(footerControls[0]["button_one@creeper_message.message_button"].size, ["50% - 3px", 28]);
  assert.equal(footerControls[2]["button_two@creeper_message.message_button"].$cm_index, 1);
  assert.deepEqual(footerControls[2]["button_two@creeper_message.message_button"].size, ["50% - 3px", 28]);
  assert.deepEqual(message.footer.size, ["100% - 14px", 33]);
  assert.equal(button.$pressed_button_name, "button.form_button_click");
  assert.equal(button.bindings[0].binding_type, "collection_details");
  assert.equal(button.bindings[0].binding_collection_name, "form_buttons");
  const messageButtonLabel = message.button_state.controls[0].label;
  assert.deepEqual(messageButtonLabel.offset, [0, 0]);
  assert.deepEqual(messageButtonLabel.size, ["100% - 12px", "default"]);
  assert.deepEqual(messageButtonLabel.max_size, ["100% - 12px", 10]);
  assert.match(wrapper, /CREEPER_MESSAGE_FORM_PREFIX = "\/CMMESSAGE "/);
  assert.match(wrapper, /ActionFormData as MinecraftActionFormData/);
  assert.doesNotMatch(wrapper, /MessageFormData as MinecraftMessageFormData/);
  assert.match(wrapper, /new MinecraftActionFormData\(\)/);
  assert.match(wrapper, /\.body\(applyCreeperTextPalette\(this\.bodyText\)\)/);
  assert.match(wrapper, /\.button\(applyCreeperTextPalette\(this\.buttonOneText\)\)/);
  assert.match(wrapper, /\.button\(applyCreeperTextPalette\(this\.buttonTwoText\)\)/);
  assert.match(wrapper, /return form\.show\(player\)/);
});

test("root, action, message, and native long-form title routes are mutually exclusive", () => {
  const serverForm = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "server_form.json"));
  const menu = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const nativeDialog = serverForm.long_form.controls[0]["long_form@common_dialogs.main_panel_no_buttons"];
  const nativeVisibility = nativeDialog.bindings[1].source_property_name;
  const routes = menu.long_form_router.controls.map((control) => Object.values(control)[0]);
  const isRange = (title, route) => title === route.$min || (title > route.$min && title < route.$max);
  const isNative = (title) =>
    !title.includes("§c§h§e§s§t") &&
    !title.includes("§f§u§r§n§a§c§e") &&
    !title.includes("/CMROOT ") &&
    !title.includes("/CMFORM ") &&
    !title.includes("/CMMESSAGE ");

  assert.equal(
    nativeVisibility,
    "((#title_text - '§c§h§e§s§t' - '§f§u§r§n§a§c§e' - '/CMROOT ' - '/CMFORM ' - '/CMMESSAGE ') = #title_text)"
  );
  for (const title of [
    "/CMROOT 苦力怕菜单",
    "/CMFORM 公会菜单",
    "/CMMESSAGE 公开信息",
    "/CMMESSAGE ",
    "普通原版 MessageForm",
    "",
  ]) {
    const matches = routes.filter((route) => isRange(title, route)).length + Number(isNative(title));
    assert.equal(matches, 1, `expected exactly one long-form route for ${JSON.stringify(title)}`);
  }
});

test("project ModalForms use one complete themed custom-form route", () => {
  const serverForm = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "server_form.json"));
  const modal = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_modal.json"));
  const definitions = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "_ui_defs.json"));
  const wrapper = read("scripts", "ui", "creeper-modal-form.ts");
  const insertedFactory = serverForm.main_screen_content.modifications[0].value[0].server_form_factory;
  const routeVisibility = modal.form_type.bindings[1].source_property_name;
  const projectRoute = modal.custom_form_router.controls[0]["project_custom_form@creeper_modal.form_type"];
  const titleBindings = modal.header.controls[0].title.bindings;
  const factoryIds = modal.generated_contents.factory.control_ids;

  assert.ok(definitions.ui_defs.includes("ui/creeper_modal.json"));
  assert.equal(insertedFactory.control_ids.custom_form, "custom_form_router@creeper_modal.custom_form_router");
  assert.deepEqual(projectRoute, {
    $min: "/CMMODAL ",
    $max: "/CMMODAL 􀐏",
    $content: "creeper_modal.form",
  });
  assert.equal(modal.form_type.visible, false);
  assert.equal(modal.form_type.bindings[0].binding_name, "#title_text");
  assert.equal(modal.form_type.bindings[0].source_control_name, undefined);
  assert.equal(modal.form.visible, undefined);
  assert.equal(modal.form.bindings, undefined);
  assert.equal(routeVisibility, "(#title_text = $min) or (#title_text > $min and #title_text < $max)");
  assert.equal(titleBindings[0].binding_name, "#title_text");
  assert.equal(titleBindings[0].source_control_name, undefined);
  assert.equal(titleBindings[1].source_property_name, "(#title_text - '/CMMODAL ')");
  assert.deepEqual(factoryIds, {
    label: "@creeper_modal.custom_label",
    header: "@creeper_modal.custom_header",
    divider: "@creeper_modal.custom_divider",
    toggle: "@creeper_modal.custom_toggle",
    slider: "@creeper_modal.custom_slider",
    step_slider: "@creeper_modal.custom_step_slider",
    dropdown: "@creeper_modal.custom_dropdown",
    input: "@creeper_modal.custom_input",
  });
  assert.equal(modal["submit_button@common.button"].$pressed_button_name, "button.submit_custom_form");
  assert.equal(modal["custom_toggle@settings_common.option_toggle"].$control_name, "creeper_modal.toggle_control");
  assert.equal(modal["custom_slider@settings_common.option_slider"].$control_name, "creeper_modal.slider_control");
  assert.equal(modal["custom_input@settings_common.option_text_edit"].$control_name, "creeper_modal.input_control");
  assert.match(JSON.stringify(modal.custom_dropdown), /creeper_modal\.dropdown_control/);
  assert.deepEqual(modal.dropdown_control.size, ["100%", 25]);
  assert.equal(modal.dropdown_toggle_content.type, "panel");
  assert.equal(modal.dropdown_toggle_content.anchor_from, "center");
  assert.equal(modal.dropdown_toggle_content.anchor_to, "center");
  const dropdownToggleLabel = modal.dropdown_toggle_content.controls[0].label;
  const dropdownToggleChevron = modal.dropdown_toggle_content.controls[1].chevron;
  assert.equal(dropdownToggleLabel.anchor_from, "left_middle");
  assert.equal(dropdownToggleLabel.anchor_to, "left_middle");
  assert.deepEqual(dropdownToggleLabel.offset, [2, -1]);
  assert.equal(dropdownToggleChevron.anchor_from, "right_middle");
  assert.equal(dropdownToggleChevron.anchor_to, "right_middle");
  assert.equal(
    modal.custom_dropdown.controls[0]["dropdown@settings_common.option_dropdown"].$dropdown_scroll_content_size[1],
    "200%"
  );
  assert.equal(
    modal["custom_dropdown_content@settings_common.option_radio_dropdown_group"].$radio_factory.control_name,
    "creeper_modal.custom_dropdown_radio"
  );
  assert.equal(
    modal["custom_dropdown_content@settings_common.option_radio_dropdown_group"].$radio_collection_name,
    "custom_dropdown"
  );
  assert.equal(
    modal["custom_dropdown_content@settings_common.option_radio_dropdown_group"].$radio_bindings[0]
      .binding_collection_name,
    "custom_form"
  );
  const dropdownRadio = modal["custom_dropdown_radio@settings_common.radio_with_label"];
  assert.equal(dropdownRadio.$radio_label_text, "#custom_radio_text");
  assert.equal(dropdownRadio.$radio_label_bindings[0].binding_collection_name, "custom_dropdown");
  assert.equal(dropdownRadio.$radio_label_bindings[1].binding_type, "collection_details");
  assert.equal(modal.radio_visuals.type, "panel");
  assert.deepEqual(modal.radio_visuals.size, ["100%", 17]);
  const radioImage = modal.radio_visuals.controls[1].radio_image;
  const radioLabel = modal.radio_visuals.controls[2].radio_label;
  assert.equal(radioImage.anchor_from, "left_middle");
  assert.equal(radioLabel.text, "$radio_label_text");
  assert.equal(radioLabel.bindings, "$radio_label_bindings");
  assert.equal(modal.radio_state, undefined);
  for (const state of [
    "radio_off@creeper_modal.radio_visuals",
    "radio_on@creeper_modal.radio_visuals",
    "radio_off_hover@creeper_modal.radio_visuals",
    "radio_on_hover@creeper_modal.radio_visuals",
    "radio_off_locked@creeper_modal.radio_visuals",
    "radio_on_locked@creeper_modal.radio_visuals",
  ]) {
    assert.ok(modal[state], state);
  }
  const submitButton = modal["submit_button@common.button"];
  const submitLabel = modal.submit_state.controls[0]["label@common_buttons.new_ui_binding_button_label"];
  assert.deepEqual(submitButton.size, ["100%", 26]);
  assert.equal(submitButton.enabled, true);
  assert.equal(submitLabel.$button_text, "#submit_text");
  assert.equal(submitLabel.$button_text_binding_type, "global");
  assert.equal(submitLabel.$button_binding_condition, "once");
  assert.deepEqual(modal.submit_state.$button_offset, [0, -1]);
  assert.equal(submitLabel.$new_ui_label_offset, undefined);
  const lockedSubmitState = submitButton.controls[3]["locked@creeper_modal.submit_state"];
  assert.deepEqual(lockedSubmitState.$cm_submit_color, [0.3, 0.27, 0.23]);
  assert.equal(lockedSubmitState.alpha, undefined);
  assert.match(wrapper, /CREEPER_MODAL_FORM_PREFIX = "\/CMMODAL "/);
  assert.match(wrapper, /new MinecraftModalFormData\(\)\.title/);
  assert.match(wrapper, /this\.form\.label\(applyCreeperTextPalette\(text\)\)/);
  assert.match(wrapper, /this\.form\.header\(applyCreeperTextPalette\(text\)\)/);
  assert.match(
    wrapper,
    /this\.form\.dropdown\(applyCreeperTextPalette\(label\), applyCreeperTextPalette\(items\), dropdownOptions\)/
  );
  assert.match(
    wrapper,
    /this\.form\.slider\(applyCreeperTextPalette\(label\), minimumValue, maximumValue, sliderOptions\)/
  );
  assert.match(
    wrapper,
    /this\.form\.textField\(applyCreeperTextPalette\(label\), applyCreeperTextPalette\(placeholderText\), textFieldOptions\)/
  );
  assert.match(wrapper, /this\.form\.toggle\(applyCreeperTextPalette\(label\), toggleOptions\)/);
  assert.match(wrapper, /this\.form\.submitButton\(applyCreeperTextPalette\(submitButtonText\)\)/);
  assert.match(wrapper, /return this\.form\.show\(player\)/);
});

test("ModalForm project, native, and REPL title routes are mutually exclusive", () => {
  const serverForm = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "server_form.json"));
  const modal = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_modal.json"));
  const nativeCustom = serverForm.custom_form.controls[0]["native_custom_form@server_form.native_custom_form"];
  const replCustom = serverForm.custom_form.controls[1]["custom_multiline_form@server_form.custom_multiline_form"];
  const nativeVisibility = nativeCustom.bindings[1].source_property_name;
  const projectVisibility = modal.form_type.bindings[1].source_property_name;
  const min = "/CMMODAL ";
  const max = "/CMMODAL 􀐏";
  const repl = "JavaScript REPL";
  const isProject = (title) => title === min || (title > min && title < max);
  const isNative = (title) => !title.includes(min) && !title.includes(repl);
  const isRepl = (title) => title === repl;

  assert.equal(projectVisibility, "(#title_text = $min) or (#title_text > $min and #title_text < $max)");
  assert.equal(nativeVisibility, "((#title_text - '/CMMODAL ' - 'JavaScript REPL') = #title_text)");
  assert.equal(replCustom.bindings[1].source_property_name, "(#title_text = 'JavaScript REPL')");
  assert.equal(nativeCustom.bindings[0].binding_type, "global");
  assert.equal(replCustom.bindings[0].binding_type, "global");

  for (const title of ["/CMMODAL 玩家传送", min, `${min}A`, "普通 ModalForm", "", repl]) {
    assert.equal(
      Number(isProject(title)) + Number(isNative(title)) + Number(isRepl(title)),
      1,
      `expected exactly one custom-form route for ${JSON.stringify(title)}`
    );
  }
});

test("all project ModalForms use the routed wrapper", () => {
  const wrapperFile = path.join(root, "scripts", "ui", "creeper-modal-form.ts");
  const directImport = /import \{[^\r\n]*ModalFormData[^\r\n]*\} from "@minecraft\/server-ui";/;
  const offenders = walkTypeScript(path.join(root, "scripts"))
    .filter((filename) => filename !== wrapperFile)
    .filter((filename) => directImport.test(fs.readFileSync(filename, "utf8")));
  const wrapperImports = walkTypeScript(path.join(root, "scripts"))
    .filter((filename) => filename !== wrapperFile)
    .map((filename) => fs.readFileSync(filename, "utf8"))
    .filter((source) => /CreeperModalFormData as ModalFormData/.test(source));

  assert.deepEqual(offenders, []);
  assert.ok(wrapperImports.length >= 27);
});

test("all project MessageForms use the routed wrapper", () => {
  const allowedNativeFiles = new Set([
    path.join(root, "scripts", "shared", "hooks", "use-form.ts"),
    path.join(root, "scripts", "ui", "creeper-message-form.ts"),
  ]);
  const directImport = /import \{[^\r\n]*MessageFormData[^\r\n]*\} from "@minecraft\/server-ui";/;
  const offenders = walkTypeScript(path.join(root, "scripts"))
    .filter((filename) => !allowedNativeFiles.has(filename))
    .filter((filename) => directImport.test(fs.readFileSync(filename, "utf8")));
  const wrapperImports = walkTypeScript(path.join(root, "scripts"))
    .filter((filename) => filename !== path.join(root, "scripts", "ui", "creeper-message-form.ts"))
    .map((filename) => fs.readFileSync(filename, "utf8"))
    .filter((source) => /CreeperMessageFormData as MessageFormData/.test(source));

  assert.deepEqual(offenders, []);
  assert.ok(wrapperImports.length >= 2);
});

test("generic forms render their title and keep dynamic button states isolated", () => {
  const ui = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json"));
  const title = ui.generic_header.controls.find((control) => control.title).title;
  const buttons = ui.generic_long_form_content.controls[0].buttons;
  const button = ui.generic_dynamic_button;
  const customButton = button.controls[0]["button@creeper_menu.generic_button"];
  const buttonTemplate = ui["generic_button@common.button"];
  const buttonState = ui.generic_button_state;
  const iconChip = buttonState.controls[1].icon_chip;
  const behaviorLogForm = read("scripts", "ui", "forms", "behavior-log", "index.ts");

  assert.equal(title.text, "#form_text");
  assert.equal(title.bindings[0].binding_name, "#form_text");
  assert.equal(buttons.factory.control_ids.button, "creeper_menu.generic_dynamic_button");
  assert.equal(buttons.bindings[0].binding_name, "#form_button_contents");
  assert.notEqual(buttons.bindings[0].binding_name, "#form_button_length");

  assert.equal(button.visible, false);
  assert.match(button.bindings.at(-1).source_property_name, /not \(#text = ''\)/);
  assert.equal(button.bindings.at(-1).target_property_name, "#visible");
  assert.deepEqual(customButton, {});
  assert.equal(buttonTemplate.$pressed_button_name, "button.form_button_click");
  assert.equal(buttonTemplate.bindings[0].binding_type, "collection_details");
  assert.equal(buttonState.type, "image");
  assert.equal(buttonState.keep_ratio, false);
  assert.equal(buttonState.controls[0].label.bindings[0].binding_collection_name, "form_buttons");
  assert.equal(iconChip.bindings[0].binding_name, "#form_button_texture");
  assert.equal(iconChip.bindings[0].binding_name_override, undefined);
  assert.match(
    iconChip.bindings[1].source_property_name,
    /not \(\(#form_button_texture = ''\) or \(#form_button_texture = 'loading'\)\)/
  );
  assert.equal(iconChip.texture, "textures/ui/creeper_menu/icon_chip");
  assert.match(behaviorLogForm, /\.button\("查看日志", "textures\/icons\/eyes"\)/);
  assert.match(behaviorLogForm, /\.button\("监控设置", "textures\/icons\/settings"\)/);
  assert.match(behaviorLogForm, /\.button\("重新筛选", "textures\/icons\/filter_refresh"\)/);
  assert.match(behaviorLogForm, /\.button\("返回", "textures\/icons\/back"\)/);
  assert.match(behaviorLogForm, /result\.selection === 4/);
  assert.match(behaviorLogForm, /openSystemSettingForm\(player\)/);
  assert.doesNotMatch(JSON.stringify(button), /common_buttons\.light_text_button/);
});

test("project ActionForm wrapper sends visible titles through form text and bodies through labels", () => {
  const wrapper = read("scripts", "ui", "creeper-action-form.ts");

  assert.match(wrapper, /const visibleTitle = neutralizeCreeperTitle\(this\.titleText\)/);
  assert.match(wrapper, /\.title\(routedTitle\(visibleTitle\)\)\.body\(visibleTitle\)/);
  assert.match(wrapper, /form\.label\(applyCreeperTextPalette\(this\.bodyText\)\)/);
  assert.match(wrapper, /form\.button\(applyCreeperTextPalette\(element\.text\), element\.iconPath\)/);
  assert.match(wrapper, /form\.header\(applyCreeperTextPalette\(element\.text\)\)/);
  assert.match(wrapper, /form\.label\(applyCreeperTextPalette\(element\.text\)\)/);
  assert.doesNotMatch(wrapper, /private readonly form = new MinecraftActionFormData/);
});

test("all themed forms share a readable multi-color paper palette", () => {
  const palette = read("scripts", "ui", "creeper-text-palette.ts");
  const action = read("scripts", "ui", "creeper-action-form.ts");
  const message = read("scripts", "ui", "creeper-message-form.ts");
  const modal = read("scripts", "ui", "creeper-modal-form.ts");

  for (const [source, themed] of Object.entries({
    7: "8",
    9: "t",
    a: "2",
    b: "t",
    c: "m",
    d: "5",
    e: "n",
    f: "j",
  })) {
    assert.match(palette, new RegExp(`(?:"${source}"|${source}): "${themed}"`));
  }
  assert.match(palette, /MINECRAFT_FORMATTING_CODE = \/§\[0-9a-u\]\/gi/);
  assert.match(palette, /text\.replace\(MINECRAFT_COLOR_CODE/);
  assert.match(action, /from "\.\/creeper-text-palette"/);
  assert.match(message, /from "\.\/creeper-text-palette"/);
  assert.match(modal, /from "\.\/creeper-text-palette"/);

  // Form option objects can contain persisted user input. They must never be rewritten.
  assert.doesNotMatch(modal, /applyCreeperTextPalette\((?:dropdown|slider|textField|toggle)Options\)/);
});

test("all project ActionForms except root and inventory forms use the routed wrapper", () => {
  const allowedNativeFiles = new Set([
    path.join(root, "scripts", "shared", "hooks", "use-form.ts"),
    path.join(root, "scripts", "ui", "creeper-action-form.ts"),
    path.join(root, "scripts", "ui", "creeper-message-form.ts"),
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
  const source = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");
  const ui = JSON.parse(source);
  const indices = [...source.matchAll(/"\$cm_index": (\d+)/g)].map((match) => Number(match[1]));

  assert.deepEqual(
    indices.sort((a, b) => a - b),
    Array.from({ length: 13 }, (_, index) => index)
  );
  assert.match(source, /"binding_collection_name": "form_buttons"/);
  assert.match(source, /"source_property_name": "\(not \(#text = ''\)\)"/);
  assert.match(source, /"quick_row": \{[\s\S]*?"collection_name": "form_buttons"/);

  assert.deepEqual(ui.row_one.controls.at(-1)["land@creeper_menu.card_land"].size, ["33.34% - 2px", "100%"]);
  assert.deepEqual(ui.row_three.controls.at(-1)["other@creeper_menu.card_other"].size, ["33.34% - 2px", "100%"]);
  const quickControls = ui.right_mosaic.controls.at(-1).quick_row.controls;
  assert.deepEqual(quickControls.at(-1)["server_settings@creeper_menu.card_server_settings"].size, [
    "33.34% - 2px",
    "100%",
  ]);
  const card = ui["card@common.button"];
  assert.deepEqual(card.controls[0]["default@creeper_menu.card_state"].$cm_state_offset, [0, 0]);
  assert.deepEqual(card.controls[1]["hover@creeper_menu.card_state"].$cm_state_offset, [0, 1]);
  assert.deepEqual(card.controls[2]["pressed@creeper_menu.card_state"].$cm_state_offset, [0, 2]);
  assert.equal(ui.card_state.offset, "$cm_state_offset");
  assert.equal(ui.card_state.keep_ratio, false);
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
  assert.equal(ui.close_state.keep_ratio, false);
  assert.equal(ui["close_button@common.button"].$pressed_button_name, "button.menu_exit");
  assert.doesNotMatch(JSON.stringify(ui.header), /common\.close_button|close_frame/);
  assert.doesNotMatch(JSON.stringify(ui.generic_header), /common\.close_button|close_frame/);
  assert.match(builder, /creeper-feature-atlas-cozy-imagegen\.png/);
  assert.match(builder, /creeper-mosaic-left-323-imagegen\.png/);
  assert.match(builder, /creeper-mosaic-right-113-imagegen\.png/);
  for (const texture of [
    "submenu_panel.png",
    "submenu_panel.json",
    "close_default.png",
    "close_hover.png",
    "close_pressed.png",
    "icon_chip.png",
    "icon_chip.json",
    "line.png",
    "modal_field_default.png",
    "modal_field_default.json",
    "modal_dropdown_panel.png",
    "modal_dropdown_panel.json",
    "modal_toggle_off.png",
    "modal_toggle_on.png",
    "modal_slider_track.png",
    "modal_slider_progress.png",
    "modal_slider_thumb.png",
    "modal_radio_off.png",
    "modal_radio_on.png",
    "modal_info.png",
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
