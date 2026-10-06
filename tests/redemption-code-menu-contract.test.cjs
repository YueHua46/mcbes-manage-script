const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const files = {
  redemptionUi: ["scripts", "ui", "forms", "redemption-code", "index.ts"],
  otherUi: ["scripts", "ui", "forms", "other", "index.ts"],
  systemUi: ["scripts", "ui", "forms", "system", "index.ts"],
  service: ["scripts", "features", "economic", "services", "redemption-code.ts"],
  serverMenu: ["scripts", "ui", "forms", "server", "index.ts"],
  bootstrap: ["scripts", "bootstrap.ts"],
  economicModelsIndex: ["scripts", "features", "economic", "models", "index.ts"],
  economicServicesIndex: ["scripts", "features", "economic", "services", "index.ts"],
  formsIndex: ["scripts", "ui", "forms", "index.ts"],
  database: ["scripts", "shared", "database", "database.ts"],
};

function parse(parts) {
  const source = read(...parts);
  return {
    source,
    sourceFile: ts.createSourceFile(parts.join("/"), source, ts.ScriptTarget.Latest, true),
  };
}

function findNode(parts, description, predicate) {
  const parsed = parse(parts);
  let match;
  const visit = (node) => {
    if (!match && predicate(node)) match = node;
    if (!match) ts.forEachChild(node, visit);
  };
  visit(parsed.sourceFile);
  assert.ok(match, `missing ${description} in ${parts.join("/")}`);
  return { ...parsed, node: match };
}

function functionText(parts, name) {
  const { sourceFile, node } = findNode(
    parts,
    `function ${name}`,
    (candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name
  );
  return node.getText(sourceFile);
}

function methodText(parts, name) {
  const { sourceFile, node } = findNode(
    parts,
    `method ${name}`,
    (candidate) => ts.isMethodDeclaration(candidate) && candidate.name?.getText() === name
  );
  return node.getText(sourceFile);
}

function assertGuardBefore(source, guard, call, description) {
  const callIndex = source.indexOf(call);
  assert.notEqual(callIndex, -1, `missing ${description}`);
  assert.ok(source.lastIndexOf(guard, callIndex) >= 0, `${description} must be guarded before it runs`);
}

test("member redemption is exposed only under Other Features while economy is enabled", () => {
  const { sourceFile, node: rootFunction } = findNode(
    files.otherUi,
    "function openBaseFunctionForm",
    (candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === "openBaseFunctionForm"
  );
  let economyGuard;
  const visit = (candidate) => {
    if (
      !economyGuard &&
      ts.isIfStatement(candidate) &&
      candidate.expression.getText(sourceFile).replace(/\s/g, "") === 'setting.getState("economy")===true'
    ) {
      economyGuard = candidate;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(rootFunction);

  assert.ok(economyGuard, "the Other Features redemption entry needs an explicit economy === true guard");
  const guardedEntry = economyGuard.thenStatement.getText(sourceFile);
  const otherRoot = rootFunction.getText(sourceFile);
  assert.match(guardedEntry, /text:\s*"兑换码"/);
  assert.match(guardedEntry, /icon:\s*"textures\/icons\/gift"/);
  assert.match(guardedEntry, /openRedemptionCodeForm\(player,\s*\(\) => openBaseFunctionForm\(player\)\)/);
  assert.equal((otherRoot.match(/text:\s*"兑换码"/g) ?? []).length, 1);

  const memberForm = functionText(files.redemptionUi, "openRedemptionCodeForm");
  assert.ok(
    memberForm.indexOf("redemptionCodeService.isEconomyEnabled()") < memberForm.indexOf("new ModalFormData()"),
    "the member form must recheck economy state before showing its input"
  );
});

test("redemption input is passed through exactly and all project form routes use Creeper wrappers", () => {
  const redemptionUi = read(...files.redemptionUi);
  const memberForm = functionText(files.redemptionUi, "openRedemptionCodeForm");

  assert.match(redemptionUi, /CreeperActionFormData as ActionFormData/);
  assert.match(redemptionUi, /CreeperModalFormData as ModalFormData/);
  assert.match(redemptionUi, /CreeperMessageFormData as MessageFormData/);
  assert.doesNotMatch(redemptionUi, /from "@minecraft\/server-ui"/);
  assert.match(functionText(files.redemptionUi, "openNotice"), /new ActionFormData\(\)/);
  assert.match(functionText(files.redemptionUi, "openConfirm"), /new MessageFormData\(\)/);
  assert.match(memberForm, /new ModalFormData\(\)/);

  assert.match(memberForm, /const rawCode = String\(response\.formValues\[0\] \?\? ""\)/);
  assert.match(memberForm, /redemptionCodeService\.redeem\(player, rawCode\)/);
  assert.doesNotMatch(memberForm, /(?:rawCode|formValues\[0\])[\s\S]{0,60}\.(?:trim|toLowerCase)\(\)/);
});

test("administration lives under Economy Management and mutations have UI and service admin guards", () => {
  const economyMenu = functionText(files.systemUi, "openEconomyManageForm");
  const manageMenu = functionText(files.redemptionUi, "openRedemptionCodeManageForm");

  assertGuardBefore(economyMenu, "if (!isAdmin(player))", "new ActionFormData()", "Economy Management entry");
  assert.match(economyMenu, /form\.button\("兑换码管理", "textures\/icons\/gift"\)/);
  assert.doesNotMatch(economyMenu, /getState\("economy"\)|isEconomyEnabled/);
  assert.match(
    economyMenu,
    /case 5:[\s\S]*openRedemptionCodeManageForm\(player,\s*\(\) => openEconomyManageForm\(player\)\)/
  );
  assertGuardBefore(manageMenu, "if (!requireAdmin(player)) return;", "new ActionFormData()", "redemption manager");

  for (const [functionName, serviceCall] of [
    ["openCreateRedemptionCodeForm", "redemptionCodeService.create"],
    ["openSetEnabledConfirm", "redemptionCodeService.setEnabled"],
    ["openArchiveConfirm", "redemptionCodeService.archive"],
    ["openResolveRecoveryConfirm", "redemptionCodeService.resolveRecovery"],
  ]) {
    assertGuardBefore(
      functionText(files.redemptionUi, functionName),
      "if (!requireAdmin(player)) return;",
      serviceCall,
      `${functionName} UI mutation`
    );
  }

  for (const methodName of ["create", "setEnabled", "archive", "resolveRecovery"]) {
    const method = methodText(files.service, methodName);
    assert.match(
      method,
      /\{\s*if \(!isAdmin\(admin\)\) return adminFailure\("forbidden"/,
      `${methodName} service mutation must reject non-admin callers before doing work`
    );
  }
});

test("redemption business actions have icons and cancellations return to their direct parent", () => {
  const { sourceFile } = parse(files.redemptionUi);
  const missingIcons = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "button" &&
      node.arguments.length < 2
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      missingIcons.push(position.line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.deepEqual(missingIcons, []);

  const manageMenu = functionText(files.redemptionUi, "openRedemptionCodeManageForm");
  const detail = functionText(files.redemptionUi, "openRedemptionCodeDetailForm");
  const claimDetail = functionText(files.redemptionUi, "openClaimDetailForm");
  assert.match(manageMenu, /button\("创建兑换码", "textures\/icons\/gift"\)/);
  assert.match(manageMenu, /button\("兑换码列表", "textures\/icons\/rewards"\)/);
  assert.match(detail, /button\("领取记录", "textures\/icons\/rewards"\)/);
  assert.match(detail, /button\("停用兑换码", "textures\/icons\/deny"\)/);
  assert.match(claimDetail, /button\("标记已到账", "textures\/icons\/accept"\)/);
  assert.match(claimDetail, /button\("撤销占位", "textures\/icons\/deny"\)/);

  const claimHistoryBuilder = functionText(files.redemptionUi, "getClaimHistory");
  const claimHistoryForm = functionText(files.redemptionUi, "openClaimHistoryForm");
  assert.match(claimHistoryBuilder, /code\.recoveryResolutions \?\? \[\]/);
  assert.match(claimHistoryForm, /人工处理：\$\{actionLabel\}/);
  assert.match(claimHistoryForm, /"人工处理审计"/);

  const notice = functionText(files.redemptionUi, "openNotice");
  const confirm = functionText(files.redemptionUi, "openConfirm");
  assert.match(notice, /button\("返回", "textures\/icons\/back"\)/);
  assert.match(notice, /\.then\(onBack\)/);
  assert.match(notice, /\.catch\(\(\) => onBack\(\)\)/);
  assert.match(confirm, /onCancel\(\)/);
  assert.match(confirm, /\.catch\(\(\) => onCancel\(\)\)/);

  for (const functionName of [
    "openRedemptionCodeForm",
    "openRedemptionCodeManageForm",
    "openCreateRedemptionCodeForm",
    "openRedemptionCodeListForm",
    "openRedemptionCodeDetailForm",
    "openClaimHistoryForm",
    "openClaimDetailForm",
  ]) {
    assert.match(
      functionText(files.redemptionUi, functionName),
      /if \(response\.canceled[^)]*\) \{\s*onBack\(\);\s*return;/,
      `${functionName} must return to its caller when canceled`
    );
  }

  for (const functionName of [
    "openRedemptionCodeListForm",
    "openRedemptionCodeDetailForm",
    "openClaimHistoryForm",
    "openClaimDetailForm",
  ]) {
    const form = functionText(files.redemptionUi, functionName);
    assert.match(form, /form\.button\("返回", "textures\/icons\/back"\)/);
    assert.match(form, /actions\.push\(onBack\)/);
  }

  assert.match(
    functionText(files.redemptionUi, "openArchiveConfirm"),
    /\(\) => openRedemptionCodeDetailForm\(player, code\.id, onBack\)/
  );
  assert.match(
    functionText(files.redemptionUi, "openResolveRecoveryConfirm"),
    /\(\) => openClaimDetailForm\(player, code\.id, claim\.playerIdentityId, onBack\)/
  );
});

test("redemption adds no root card or JSON UI route", () => {
  const { sourceFile, node: menuItems } = findNode(
    files.serverMenu,
    "menuItems declaration",
    (candidate) => ts.isVariableDeclaration(candidate) && candidate.name.getText() === "menuItems"
  );
  assert.ok(ts.isArrayLiteralExpression(menuItems.initializer));
  const rootIds = menuItems.initializer.elements.map((element) => {
    assert.ok(ts.isObjectLiteralExpression(element));
    const id = element.properties.find(
      (property) => ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === "id"
    );
    assert.ok(id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer));
    return id.initializer.text;
  });
  assert.deepEqual(rootIds, [
    "player",
    "wayPoint",
    "land",
    "economy",
    "guild",
    "floatingText",
    "pvp",
    "stats",
    "quest",
    "other",
    "help",
    "sm",
    "setting",
  ]);

  const serverForm = JSON.parse(read("resource_packs", "CreeperMenu", "ui", "server_form.json"));
  const menuUiSource = read("resource_packs", "CreeperMenu", "ui", "creeper_menu.json");
  const menuUi = JSON.parse(menuUiSource);
  const factory = serverForm.main_screen_content.modifications[0].value[0].server_form_factory;
  assert.equal(factory.type, "factory");
  assert.deepEqual(factory.control_ids, {
    long_form: "long_form_router@creeper_menu.long_form_router",
    custom_form: "custom_form_router@creeper_modal.custom_form_router",
  });
  const routePrefixes = menuUi.long_form_router.controls.map((control) => Object.values(control)[0].$min);
  assert.deepEqual(routePrefixes, ["/CMROOT ", "/CMFORM ", "/CMMESSAGE "]);
  const indices = [...menuUiSource.matchAll(/"\$cm_index": (\d+)/g)].map((match) => Number(match[1]));
  assert.deepEqual(
    indices.sort((left, right) => left - right),
    Array.from({ length: 13 }, (_, index) => index)
  );
});

test("redemption service is loaded at startup, exported, and registered for persistence recovery", () => {
  assert.match(read(...files.bootstrap), /import "\.\/features\/economic\/services\/redemption-code";/);
  assert.match(read(...files.economicModelsIndex), /export \* from "\.\/redemption-code\.model";/);
  assert.match(
    read(...files.economicServicesIndex),
    /export \{ default as redemptionCodeService \} from "\.\/redemption-code";/
  );
  assert.match(read(...files.formsIndex), /export \* from "\.\/redemption-code";/);

  const service = read(...files.service);
  assert.match(service, /new Database<IRedemptionCode>\(REDEMPTION_CODE_DATABASE\)/);
  assert.match(service, /id: "economy\.redemptionCodeRecovery"/);
  assert.match(service, /intervalTicks: RECOVERY_INTERVAL_TICKS/);
  assert.match(read(...files.database), /Database\.databases\.push\(this\)/);
});
