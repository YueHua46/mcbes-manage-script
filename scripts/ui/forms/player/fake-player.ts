import { Player, RawMessage, system, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import fakePlayerService, {
  FakePlayerBehavior,
  FakePlayerProgramStep,
  FakePlayerType,
  buildFakePlayerDeathReason,
  getFakePlayerType,
  IFakePlayer,
  isFakePlayer,
} from "../../../features/fake-player/services/fake-player";
import { FAKE_PLAYER_SKINS, getFakePlayerSkinName } from "../../../features/fake-player/services/fake-player-skins";
import { color } from "../../../shared/utils/color";
import { isAdmin } from "../../../shared/utils/common";
import { isSimulatedPlayerAvailable } from "../../../features/platform/sapi-capabilities";
import { openConfirmDialogForm, openDialogForm } from "../../../ui/components/dialog";
import { openFakePlayerInteractMenu } from "./fake-player-inventory";
import setting from "../../../features/system/services/setting";

function formatEconomyCost(cost: number): string {
  if (setting.getState("economy") !== true) return "免费（经济系统已关闭）";
  return cost > 0 ? `${cost} 金币` : "免费";
}

function formatLocation(item: IFakePlayer): string {
  return `${item.dimension.replace("minecraft:", "")} ${item.location.x}, ${item.location.y}, ${item.location.z}`;
}

function formatBehavior(item: IFakePlayer): string {
  const behavior = fakePlayerService.getBehavior(item);
  const movement = MOVEMENT_OPTIONS.find((option) => option.value === behavior.movement)?.label ?? behavior.movement;
  const action = ACTION_OPTIONS.find((option) => option.value === behavior.action)?.label ?? behavior.action;
  return `${movement} / ${action}`;
}

export function openFakePlayerMenu(player: Player, back: () => void): void {
  if (!fakePlayerService.canUse(player)) {
    openDialogForm(player, { title: "功能未开放", desc: "§c服务器暂未开放假人功能。" }, back);
    return;
  }

  const own = fakePlayerService.listForPlayer(player.name);
  const max = fakePlayerService.getMaxPerPlayer();
  const cost = fakePlayerService.getCreateCost();
  const simulatedPlayerAvailable = isSimulatedPlayerAvailable();

  const form = new ActionFormData();
  form.title("假人管理");
  form.body(
    [
      `§a我的假人: §e${own.length}/${isAdmin(player) ? "不限" : max}`,
      `§a创建费用: §e${formatEconomyCost(cost)}`,
      ...(simulatedPlayerAvailable
        ? [
            `§a新版假人复活费用: §e${formatEconomyCost(fakePlayerService.getReviveCost())}`,
            "§7创建时可选择兼容性更好的旧版实体，或可参与原版刷怪判定的新版模拟玩家。",
          ]
        : ["§7Realms 版仅支持旧版实体假人。"]),
    ].join("\n")
  );
  form.button("在当前位置创建假人", "textures/icons/add");
  form.button("我的假人列表", "textures/icons/spectator");
  if (isAdmin(player)) {
    form.button("全服假人管理", "textures/icons/mod_shield");
  }
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const admin = isAdmin(player);
    const backIndex = admin ? 3 : 2;
    switch (data.selection) {
      case 0:
        isSimulatedPlayerAvailable()
          ? openCreateFakePlayerForm(player, back)
          : openCreateFakePlayerDetailsForm(player, "entity", back);
        break;
      case 1:
        openFakePlayerListForm(player, false, back);
        break;
      case 2:
        admin ? openFakePlayerListForm(player, true, back) : back();
        break;
      case backIndex:
        back();
        break;
    }
  });
}

function openCreateFakePlayerForm(player: Player, back: () => void): void {
  if (!isSimulatedPlayerAvailable()) {
    openCreateFakePlayerDetailsForm(player, "entity", back);
    return;
  }

  const form = new ActionFormData();
  form.title("选择假人类型");
  form.body(
    [
      "§b旧版实体假人",
      "§7兼容性更好，可更换二次元皮肤；能够加载区块并维持红石、农作物运行，但不会参与玩家刷怪判定。",
      "",
      "§d新版模拟玩家",
      "§7能够加载区块并参与原版玩家刷怪判定；不支持二次元皮肤，部分模组可能将其误判为真实玩家，从而导致模组报错（具体会不会影响该模组核心功能则需自行测试）",
      "",
      "§e请选择更适合当前用途的版本。",
    ].join("\n")
  );
  form.button("旧版实体假人\n兼容性好 · 支持换肤", "textures/icons/profile");
  form.button("新版模拟玩家\n支持原版刷怪机制", "textures/icons/spectator");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      openFakePlayerMenu(player, back);
      return;
    }
    if (data.selection === 0) {
      openCreateFakePlayerDetailsForm(player, "entity", back);
    } else if (data.selection === 1) {
      openCreateFakePlayerDetailsForm(player, "simulated", back);
    } else {
      openFakePlayerMenu(player, back);
    }
  });
}

function openCreateFakePlayerDetailsForm(player: Player, type: FakePlayerType, back: () => void): void {
  const isLegacy = type === "entity";
  const form = new ModalFormData();
  form.title(isLegacy ? "创建旧版实体假人" : "创建新版模拟玩家");
  form.textField("假人名称", "例如: 地狱树场加载点", {
    defaultValue: `${player.name}的假人`,
  });
  if (isLegacy) {
    form.dropdown(
      "二次元皮肤",
      FAKE_PLAYER_SKINS.map((skin) => skin.name),
      { defaultValueIndex: 0 }
    );
  }
  form.submitButton("确认创建");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      isSimulatedPlayerAvailable() ? openCreateFakePlayerForm(player, back) : openFakePlayerMenu(player, back);
      return;
    }

    const name = String(data.formValues?.[0] ?? "");
    const skinId = isLegacy ? (FAKE_PLAYER_SKINS[Number(data.formValues?.[1])]?.id ?? 0) : undefined;
    const result = fakePlayerService.create({ player, name, type, skinId });
    if (typeof result === "string") {
      openDialogForm(player, { title: "创建失败", desc: color.red(result) }, () =>
        openCreateFakePlayerDetailsForm(player, type, back)
      );
      return;
    }

    openDialogForm(
      player,
      {
        title: "创建成功",
        desc: [
          `§a已在当前位置创建假人 §e${result.name}§a。`,
          `§a类型: §e${getFakePlayerType(result) === "entity" ? "旧版实体假人" : "新版模拟玩家"}`,
          `§7${formatLocation(result)}`,
          "",
          "§e右键这个假人可以打开交互菜单。",
          ...(getFakePlayerType(result) === "simulated"
            ? [
                "§e默认只有创建者和管理员可以查看假人背包。",
                "§e创建者或管理员可以在交互菜单里添加其他可查看背包的玩家。",
              ]
            : ["§e可在假人详情中随时更换二次元皮肤。", "§7旧版实体假人不提供玩家背包。"]),
        ].join("\n"),
      },
      () => openFakePlayerMenu(player, back)
    );
  });
}

function openFakePlayerListForm(player: Player, adminView: boolean, back: () => void): void {
  const items = adminView ? fakePlayerService.listAllForAdmin() : fakePlayerService.listForPlayer(player.name);
  const form = new ActionFormData();
  form.title(adminView ? "全服假人管理" : "我的假人");

  if (items.length === 0) {
    form.body(adminView ? "§e当前全服没有假人。" : "§e你还没有创建任何假人。");
  } else {
    form.body(`§a共 ${items.length} 个假人`);
  }

  items.forEach((item) => {
    const typeLabel = getFakePlayerType(item) === "entity" ? "旧版" : "新版";
    const status = item.isDead ? "§c[已死亡]§r " : "";
    form.button(
      `${status}${item.name}\n[${typeLabel}] ${item.ownerName} · ${formatLocation(item)}`,
      item.isDead ? "textures/icons/dead" : "textures/icons/spectator"
    );
  });
  if (adminView && items.length > 0) {
    form.button("一键清除全部假人\n删除数据并踢出在线假人", "textures/icons/deny");
  }
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const clearAllIndex = adminView && items.length > 0 ? items.length : -1;
    const backIndex = clearAllIndex >= 0 ? items.length + 1 : items.length;

    if (data.selection === clearAllIndex) {
      openClearAllFakePlayersConfirmForm(player, back);
      return;
    }

    if (data.selection === backIndex) {
      openFakePlayerMenu(player, back);
      return;
    }
    if (typeof data.selection !== "number") return;
    const item = items[data.selection];
    if (!item) return;
    openFakePlayerDetailForm(player, item, adminView, back);
  });
}

function openClearAllFakePlayersConfirmForm(player: Player, back: () => void): void {
  if (!isAdmin(player)) {
    openDialogForm(player, { title: "无权操作", desc: color.red("只有管理员可以清除全服假人。") }, () =>
      openFakePlayerMenu(player, back)
    );
    return;
  }

  const count = fakePlayerService.listAllForAdmin().length;
  openConfirmDialogForm(
    player,
    "清除全部假人",
    [
      `§c确定删除全服 ${count} 个假人吗？`,
      "§c此操作会删除所有假人数据，并踢出/移除当前在线假人。",
      "§7假人背包会按现有移除逻辑先尝试持久化，但删除数据后不会再自动恢复。",
    ].join("\n"),
    () => {
      const result = fakePlayerService.deleteAll(player);
      openDialogForm(
        player,
        {
          title: typeof result === "string" ? "清除失败" : "清除完成",
          desc:
            typeof result === "string"
              ? color.red(result)
              : color.green(`已删除 ${result.deleted} 条假人数据，并踢出/移除 ${result.kicked} 个在线假人。`),
        },
        () => openFakePlayerMenu(player, back)
      );
    },
    () => openFakePlayerListForm(player, true, back),
    { dangerConfirm: true }
  );
}

function openFakePlayerDetailForm(player: Player, item: IFakePlayer, adminView: boolean, back: () => void): void {
  const form = new ActionFormData();
  form.title(`${item.name}`);
  const simulated = getFakePlayerType(item) === "simulated";
  const dead = simulated && item.isDead === true;
  const detailLines = [
    `§a拥有者: §e${item.ownerName}`,
    `§a类型: §e${simulated ? "新版模拟玩家" : "旧版实体假人"}`,
    ...(simulated ? [`§a状态: ${dead ? "§c已死亡" : "§a存活（生存模式）"}`] : []),
    ...(simulated && !dead ? [`§a当前行为: §e${formatBehavior(item)}`] : []),
    ...(getFakePlayerType(item) === "entity" ? [`§a皮肤: §e${getFakePlayerSkinName(item.skinId)}`] : []),
    `§a位置: §e${formatLocation(item)}`,
    `§a创建时间: §e${item.created}`,
  ];
  const detailBody: RawMessage | string = dead
    ? {
        rawtext: [
          { text: `${detailLines.slice(0, 3).join("\n")}\n§c死亡原因: §f` },
          buildFakePlayerDeathReason(item),
          {
            text: `\n§c死亡时间: §f${item.diedAt ?? "未知"}\n§e复活费用: ${formatEconomyCost(fakePlayerService.getReviveCost())}\n${detailLines.slice(3).join("\n")}`,
          },
        ],
      }
    : detailLines.join("\n");
  form.body(detailBody);

  const actions: Array<() => void> = [];
  const addAction = (label: string, icon: string, action: () => void) => {
    form.button(label, icon);
    actions.push(action);
  };

  if (simulated && !dead) {
    addAction("背包与权限", "textures/icons/quest_chest", () => openFakePlayerInteractMenu(player, item.id));
    addAction("行为控制", "textures/icons/settings", () => openFakePlayerBehaviorForm(player, item, adminView, back));
  } else if (!simulated) {
    addAction("更换二次元皮肤", "textures/icons/edit2", () =>
      openLegacyFakePlayerSkinForm(player, item, adminView, back)
    );
  }

  if (dead) {
    addAction(`复活假人\n${formatEconomyCost(fakePlayerService.getReviveCost())}`, "textures/icons/heart", () => {
      const cost = fakePlayerService.getReviveCost();
      const costDescription = cost > 0 ? `将从你的钱包扣除 §6${cost} §7金币。` : "本次复活免费，不会扣除金币。";
      const confirmBody: RawMessage = {
        rawtext: [
          { text: `§e确定复活假人 §b${item.name}§e 吗？\n§7${costDescription}\n§7死亡原因：` },
          buildFakePlayerDeathReason(item),
        ],
      };
      openConfirmDialogForm(
        player,
        "复活假人",
        confirmBody,
        () => {
          const result = fakePlayerService.revive(player, item.id);
          openDialogForm(
            player,
            {
              title: typeof result === "string" ? "复活失败" : "复活成功",
              desc:
                typeof result === "string"
                  ? color.red(result)
                  : color.green(cost > 0 ? `假人已复活，并扣除 ${cost} 金币。` : "假人已免费复活。"),
            },
            () => openFakePlayerListForm(player, adminView, back)
          );
        },
        () => openFakePlayerDetailForm(player, item, adminView, back)
      );
    });
  }

  addAction("移动到我的当前位置", "textures/icons/fast_travel", () => {
    const result = fakePlayerService.moveToOperator(player, item.id);
    openDialogForm(
      player,
      {
        title: typeof result === "string" ? "移动结果" : "移动成功",
        desc:
          typeof result === "string"
            ? color.yellow(result)
            : color.green(dead ? "假人的复活位置已移动到你的当前位置。" : "假人已移动到你的当前位置。"),
      },
      () => openFakePlayerListForm(player, adminView, back)
    );
  });

  if (!dead) {
    addAction("重新生成", "textures/icons/requeue", () => {
      const result = fakePlayerService.refresh(item.id);
      openDialogForm(
        player,
        {
          title: typeof result === "string" ? "重新生成失败" : "重新生成成功",
          desc: typeof result === "string" ? color.red(result) : color.green("假人已重新生成。"),
        },
        () => openFakePlayerListForm(player, adminView, back)
      );
    });
  }

  addAction("删除假人", "textures/icons/deny", () => {
    openConfirmDialogForm(
      player,
      "删除假人",
      `§c确定删除假人 §e${item.name}§c 吗？\n§7创建费用不会退回。`,
      () => {
        const result = fakePlayerService.delete(player, item.id);
        openDialogForm(
          player,
          {
            title: result === true ? "删除成功" : "删除失败",
            desc: result === true ? color.green("假人已删除。") : color.red(String(result)),
          },
          () => openFakePlayerListForm(player, adminView, back)
        );
      },
      () => openFakePlayerDetailForm(player, item, adminView, back),
      { dangerConfirm: true }
    );
  });
  addAction("返回", "textures/icons/back", () => openFakePlayerListForm(player, adminView, back));

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (typeof data.selection === "number") actions[data.selection]?.();
  });
}

const MOVEMENT_OPTIONS: Array<{ value: FakePlayerBehavior["movement"]; label: string }> = [
  { value: "idle", label: "原地不动" },
  { value: "station", label: "固定在设置的位置和朝向" },
];

const ACTION_OPTIONS: Array<{ value: FakePlayerBehavior["action"]; label: string }> = [
  { value: "none", label: "不执行操作" },
  { value: "interact", label: "频繁交互（右键）" },
  { value: "attack", label: "频繁攻击（左键）" },
  { value: "use_slot", label: "频繁使用手持物品" },
  { value: "hold_slot", label: "持续使用手持物品" },
  { value: "hold_break", label: "持续挖掘假人所看方块" },
];

function openFakePlayerControlHub(player: Player, item: IFakePlayer, adminView: boolean, back: () => void): void {
  void (async () => {
    const ui = (await import("@minecraft/server-ui")) as Record<string, any>;
    const CustomForm = ui.CustomForm;
    if (!CustomForm) {
      openFakePlayerBehaviorForm(player, item, adminView, back);
      return;
    }
    const form =
      typeof CustomForm.create === "function"
        ? CustomForm.create(player, `行为控制 · ${item.name}`)
        : new CustomForm(player, `行为控制 · ${item.name}`);
    const closeThen = (callback: () => void) => {
      try {
        form.close();
      } catch {
        /* 已关闭 */
      }
      system.runTimeout(callback, 4);
    };
    const program = fakePlayerService.getProgram(item);
    form.label(`动作脚本: ${program.steps.length} 步 / ${program.enabled ? "运行中" : "已停止"}`);
    form.button("动作序列编排", () => closeThen(() => openFakePlayerProgramEditor(player, item, adminView, back)));
    form.button("快捷行为控制", () => closeThen(() => openFakePlayerBehaviorForm(player, item, adminView, back)));
    form.button("返回", () => closeThen(() => openFakePlayerDetailForm(player, item, adminView, back)));
    await form.show();
  })();
}

const PROGRAM_STEP_OPTIONS: Array<{ type: FakePlayerProgramStep["type"]; label: string }> = [
  { type: "wait", label: "等待" },
  { type: "teleport", label: "瞬移到坐标" },
  { type: "move_to", label: "寻路到坐标" },
  { type: "move_relative", label: "相对方向移动" },
  { type: "move_stop", label: "停止移动" },
  { type: "follow", label: "跟随玩家" },
  { type: "look_at", label: "看向坐标" },
  { type: "select_slot", label: "切换手持快捷栏" },
  { type: "use_start", label: "开始使用手持物品" },
  { type: "use_stop", label: "停止使用物品" },
  { type: "attack", label: "攻击一次" },
  { type: "interact", label: "视线交互一次" },
  { type: "interact_block", label: "交互指定方块" },
  { type: "use_on_block", label: "对方块使用物品" },
  { type: "break_start", label: "开始挖掘方块" },
  { type: "break_stop", label: "停止挖掘" },
  { type: "jump", label: "跳跃" },
  { type: "sneak_start", label: "开始蹲下" },
  { type: "sneak_stop", label: "停止蹲下" },
];

function formatProgramStep(step: FakePlayerProgramStep, index: number): string {
  const name = PROGRAM_STEP_OPTIONS.find((option) => option.type === step.type)?.label ?? step.type;
  if (step.type === "wait") return `${index + 1}. ${name} ${(step.ticks / 20).toFixed(2)} 秒`;
  if ("location" in step) return `${index + 1}. ${name} (${step.location.x}, ${step.location.y}, ${step.location.z})`;
  if (step.type === "select_slot" || step.type === "use_start") return `${index + 1}. ${name} ${step.slot + 1}`;
  return `${index + 1}. ${name}`;
}

function openFakePlayerProgramEditor(player: Player, item: IFakePlayer, adminView: boolean, back: () => void): void {
  void (async () => {
    const ui = (await import("@minecraft/server-ui")) as Record<string, any>;
    const { CustomForm, ObservableBoolean } = ui;
    if (!CustomForm || !ObservableBoolean) return;
    const program = fakePlayerService.getProgram(fakePlayerService.getById(item.id) ?? item);
    const loop = new ObservableBoolean(program.loop, { clientWritable: true });
    const form =
      typeof CustomForm.create === "function"
        ? CustomForm.create(player, `动作序列 · ${item.name}`)
        : new CustomForm(player, `动作序列 · ${item.name}`);
    const reopen = () => system.runTimeout(() => openFakePlayerProgramEditor(player, item, adminView, back), 4);
    const close = () => {
      try {
        form.close();
      } catch {
        /* 已关闭 */
      }
    };
    form.toggle("循环执行", loop);
    if (program.steps.length === 0) form.label("尚未添加动作。动作会严格按照列表顺序执行。");
    program.steps.forEach((step, index) => {
      form.label(formatProgramStep(step, index));
      if (index > 0)
        form.button(`上移第 ${index + 1} 步`, () => {
          [program.steps[index - 1], program.steps[index]] = [program.steps[index], program.steps[index - 1]];
          close();
          fakePlayerService.setProgram(player, item.id, { ...program, loop: loop.getData(), enabled: false });
          reopen();
        });
      if (index < program.steps.length - 1)
        form.button(`下移第 ${index + 1} 步`, () => {
          [program.steps[index], program.steps[index + 1]] = [program.steps[index + 1], program.steps[index]];
          close();
          fakePlayerService.setProgram(player, item.id, { ...program, loop: loop.getData(), enabled: false });
          reopen();
        });
      form.button(`删除第 ${index + 1} 步`, () => {
        program.steps.splice(index, 1);
        close();
        fakePlayerService.setProgram(player, item.id, { ...program, loop: loop.getData(), enabled: false });
        reopen();
      });
    });
    form.divider();
    form.button("添加动作", () => {
      close();
      system.runTimeout(() => openAddProgramStepForm(player, item, program, loop.getData(), adminView, back), 4);
    });
    form.button(program.enabled ? "停止脚本" : "从头运行", () => {
      const result = fakePlayerService.setProgram(player, item.id, {
        ...program,
        loop: loop.getData(),
        enabled: !program.enabled,
      });
      player.sendMessage(
        typeof result === "string"
          ? color.red(result)
          : color.green(program.enabled ? "脚本已停止。" : "脚本已从头开始运行。")
      );
      close();
      reopen();
    });
    form.button("返回", () => {
      close();
      system.runTimeout(() => openFakePlayerControlHub(player, item, adminView, back), 4);
    });
    await form.show();
  })();
}

function openAddProgramStepForm(
  player: Player,
  item: IFakePlayer,
  program: ReturnType<typeof fakePlayerService.getProgram>,
  loop: boolean,
  adminView: boolean,
  back: () => void
): void {
  const form = new ActionFormData().title("添加原子动作");
  PROGRAM_STEP_OPTIONS.forEach((option) => form.button(option.label));
  form.button("返回");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined || response.selection >= PROGRAM_STEP_OPTIONS.length) {
      openFakePlayerProgramEditor(player, item, adminView, back);
      return;
    }
    openProgramStepConfig(player, item, program, loop, PROGRAM_STEP_OPTIONS[response.selection].type, adminView, back);
  });
}

function openProgramStepConfig(
  player: Player,
  item: IFakePlayer,
  program: ReturnType<typeof fakePlayerService.getProgram>,
  loop: boolean,
  type: FakePlayerProgramStep["type"],
  adminView: boolean,
  back: () => void
): void {
  const noParam = ["move_stop", "use_stop", "attack", "interact", "break_stop", "jump", "sneak_start", "sneak_stop"];
  if (noParam.includes(type)) {
    appendProgramStep(player, item, program, loop, { type } as FakePlayerProgramStep, adminView, back);
    return;
  }
  const form = new ModalFormData().title(PROGRAM_STEP_OPTIONS.find((option) => option.type === type)?.label ?? type);
  const viewedBlock = player.getBlockFromViewDirection({ maxDistance: 16 })?.block;
  const location = viewedBlock?.location ?? player.location;
  const players = world
    .getAllPlayers()
    .filter((target) => !isFakePlayer(target))
    .map((target) => target.name);
  if (type === "wait") form.textField("等待秒数", "例如 1.5", { defaultValue: "1" });
  if (["teleport", "move_to", "look_at", "interact_block", "use_on_block", "break_start"].includes(type)) {
    form.textField("X", "坐标", { defaultValue: String(location.x) });
    form.textField("Y", "坐标", { defaultValue: String(location.y) });
    form.textField("Z", "坐标", { defaultValue: String(location.z) });
  }
  if (type === "move_to") form.slider("速度", 0.1, 1, { defaultValue: 1, valueStep: 0.1 });
  if (type === "move_relative") {
    form.slider("左右（负数向左）", -1, 1, { defaultValue: 0, valueStep: 0.1 });
    form.slider("前后（负数向后）", -1, 1, { defaultValue: 1, valueStep: 0.1 });
    form.slider("速度", 0.1, 1, { defaultValue: 1, valueStep: 0.1 });
  }
  if (type === "follow") {
    form.dropdown("在线真实玩家", players.length ? players : ["当前无在线玩家"]);
    form.slider("速度", 0.1, 1, { defaultValue: 1, valueStep: 0.1 });
  }
  if (["select_slot", "use_start", "use_on_block"].includes(type)) {
    form.slider("快捷栏槽位", 1, 9, { defaultValue: 1, valueStep: 1 });
  }
  form.submitButton("添加到序列");
  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) {
      openFakePlayerProgramEditor(player, item, adminView, back);
      return;
    }
    const values = response.formValues;
    let step: FakePlayerProgramStep | undefined;
    if (type === "wait") step = { type, ticks: Math.max(1, Math.round(Number(values[0]) * 20)) };
    else if (type === "move_relative")
      step = { type, leftRight: Number(values[0]), forward: Number(values[1]), speed: Number(values[2]) };
    else if (type === "follow") {
      if (!players.length) {
        player.sendMessage(color.red("当前没有可跟随的真实玩家。"));
        return;
      }
      step = { type, playerName: players[Number(values[0])], speed: Number(values[1]) };
    } else if (type === "select_slot" || type === "use_start") step = { type, slot: Math.round(Number(values[0])) - 1 };
    else {
      const target = { x: Number(values[0]), y: Number(values[1]), z: Number(values[2]) };
      if (![target.x, target.y, target.z].every(Number.isFinite)) {
        player.sendMessage(color.red("坐标必须是有效数字。"));
        return;
      }
      if (type === "teleport") step = { type, location: target, dimension: player.dimension.id };
      else if (type === "move_to") step = { type, location: target, speed: Number(values[3]) };
      else if (type === "look_at" || type === "interact_block" || type === "break_start")
        step = { type, location: target };
      else if (type === "use_on_block") step = { type, location: target, slot: Math.round(Number(values[3])) - 1 };
    }
    if (step) appendProgramStep(player, item, program, loop, step, adminView, back);
  });
}

function appendProgramStep(
  player: Player,
  item: IFakePlayer,
  program: ReturnType<typeof fakePlayerService.getProgram>,
  loop: boolean,
  step: FakePlayerProgramStep,
  adminView: boolean,
  back: () => void
): void {
  const result = fakePlayerService.setProgram(player, item.id, {
    enabled: false,
    loop,
    steps: [...program.steps, step],
  });
  if (typeof result === "string") player.sendMessage(color.red(result));
  openFakePlayerProgramEditor(player, item, adminView, back);
}

function openFakePlayerBehaviorForm(player: Player, item: IFakePlayer, adminView: boolean, back: () => void): void {
  void openFakePlayerBehaviorDdui(player, item, adminView, back);
}

async function openFakePlayerBehaviorDdui(
  player: Player,
  item: IFakePlayer,
  adminView: boolean,
  back: () => void
): Promise<void> {
  const ui = (await import("@minecraft/server-ui")) as Record<string, any>;
  const { CustomForm, ObservableBoolean, ObservableNumber, ObservableString } = ui;
  if (!CustomForm || !ObservableBoolean || !ObservableNumber || !ObservableString) {
    openFakePlayerBehaviorFallbackForm(player, item, adminView, back);
    return;
  }

  const writable = { clientWritable: true };
  const current = fakePlayerService.getBehavior(item);
  const onlinePlayers = world.getAllPlayers().filter((target) => !isFakePlayer(target));
  const targetNames = onlinePlayers.map((target) => target.name);
  const selectedTarget = Math.max(0, targetNames.indexOf(current.targetPlayer ?? player.name));
  const movement = new ObservableNumber(
    Math.max(
      0,
      MOVEMENT_OPTIONS.findIndex((option) => option.value === current.movement)
    ),
    writable
  );
  const target = new ObservableNumber(selectedTarget, writable);
  const speed = new ObservableNumber(current.speed, writable);
  const action = new ObservableNumber(
    Math.max(
      0,
      ACTION_OPTIONS.findIndex((option) => option.value === current.action)
    ),
    writable
  );
  const interval = new ObservableString(String(current.intervalTicks / 20), writable);
  const slot = new ObservableNumber(current.hotbarSlot, writable);
  const sneaking = new ObservableBoolean(current.sneaking, writable);
  const station = current.stationLocation ?? player.location;
  const fallbackLook = player.getViewDirection();
  const lookAt = current.lookAtLocation ?? {
    x: player.location.x + fallbackLook.x * 5,
    y: player.location.y + 1.62 + fallbackLook.y * 5,
    z: player.location.z + fallbackLook.z * 5,
  };
  const stationX = new ObservableString(String(station.x), writable);
  const stationY = new ObservableString(String(station.y), writable);
  const stationZ = new ObservableString(String(station.z), writable);
  const lookX = new ObservableString(String(lookAt.x), writable);
  const lookY = new ObservableString(String(lookAt.y), writable);
  const lookZ = new ObservableString(String(lookAt.z), writable);
  const followVisible = new ObservableBoolean(current.movement === "follow");
  const stationVisible = new ObservableBoolean(current.movement === "station");
  const targetVisible = new ObservableBoolean(current.movement === "station");
  const speedVisible = new ObservableBoolean(!["idle", "station"].includes(current.movement));
  const intervalVisible = new ObservableBoolean(!["none", "hold_slot", "hold_break"].includes(current.action));
  const form =
    typeof CustomForm.create === "function"
      ? CustomForm.create(player, `行为控制 · ${item.name}`)
      : new CustomForm(player, `行为控制 · ${item.name}`);
  const updateTargetVisibility = () => {
    const movementMode = MOVEMENT_OPTIONS[movement.getData()]?.value ?? "idle";
    targetVisible.setData(movementMode === "station");
  };
  const closeAndReturn = () => {
    try {
      form.close();
    } catch {
      // 表单可能已经关闭。
    }
    system.runTimeout(
      () => openFakePlayerDetailForm(player, fakePlayerService.getById(item.id) ?? item, adminView, back),
      4
    );
  };

  movement.subscribe((index: number) => {
    const mode = MOVEMENT_OPTIONS[index]?.value ?? "idle";
    followVisible.setData(mode === "follow");
    stationVisible.setData(mode === "station");
    speedVisible.setData(!["idle", "station"].includes(mode));
    updateTargetVisibility();
  });
  action.subscribe((index: number) => {
    const mode = ACTION_OPTIONS[index]?.value ?? "none";
    intervalVisible.setData(!["none", "hold_slot", "hold_break"].includes(mode));
    updateTargetVisibility();
  });

  form.dropdown(
    "移动方式",
    movement,
    MOVEMENT_OPTIONS.map((option, index) => ({ label: option.label, value: index }))
  );
  if (targetNames.length > 0) {
    form.dropdown(
      "跟随玩家",
      target,
      targetNames.map((name, index) => ({ label: name, value: index })),
      { visible: followVisible }
    );
  } else {
    form.label("当前没有可跟随的在线真实玩家。", { visible: followVisible });
  }
  form.button(
    "读取我当前站位与视线目标",
    () => {
      const block = player.getBlockFromViewDirection({ maxDistance: 16 })?.block;
      const direction = player.getViewDirection();
      const targetLocation = block?.location ?? {
        x: player.location.x + direction.x * 5,
        y: player.location.y + 1.62 + direction.y * 5,
        z: player.location.z + direction.z * 5,
      };
      stationX.setData(player.location.x.toFixed(3));
      stationY.setData(player.location.y.toFixed(3));
      stationZ.setData(player.location.z.toFixed(3));
      lookX.setData(String(targetLocation.x));
      lookY.setData(String(targetLocation.y));
      lookZ.setData(String(targetLocation.z));
      player.sendMessage(color.green(block ? "已读取站位和所看方块。" : "视线内没有方块，已记录前方 5 格目标点。"));
    },
    { visible: targetVisible }
  );
  form.textField("锁定位置 X", stationX, { visible: stationVisible });
  form.textField("锁定位置 Y", stationY, { visible: stationVisible });
  form.textField("锁定位置 Z", stationZ, { visible: stationVisible });
  form.textField("目标 X", lookX, { visible: targetVisible });
  form.textField("目标 Y", lookY, { visible: targetVisible });
  form.textField("目标 Z", lookZ, { visible: targetVisible });
  form.slider("移动速度", speed, 0.1, 1, { step: 0.1, visible: speedVisible });
  form.divider();
  form.dropdown(
    "周期动作",
    action,
    ACTION_OPTIONS.map((option, index) => ({ label: option.label, value: index }))
  );
  form.textField("动作间隔（秒）", interval, {
    description: "请输入 0.05 到 3600，例如 0.5",
    visible: intervalVisible,
  });
  form.dropdown(
    "假人手持位置",
    slot,
    Array.from({ length: 9 }, (_, index) => ({ label: `第 ${index + 1} 个快捷槽`, value: index })),
    { description: "选择假人当前手持哪个快捷槽中的物品" }
  );
  form.toggle("保持蹲下", sneaking, { description: "开启后，假人会持续保持潜行姿势" });
  form.divider();
  form.button("保存并立即执行", () => {
    const movementValue = MOVEMENT_OPTIONS[movement.getData()]?.value ?? "idle";
    if (movementValue === "follow" && targetNames.length === 0) {
      player.sendMessage(color.red("当前没有可跟随的在线真实玩家。"));
      return;
    }
    const stationLocation = {
      x: Number(stationX.getData()),
      y: Number(stationY.getData()),
      z: Number(stationZ.getData()),
    };
    const lookAtLocation = { x: Number(lookX.getData()), y: Number(lookY.getData()), z: Number(lookZ.getData()) };
    const actionValue = ACTION_OPTIONS[action.getData()]?.value ?? "none";
    const intervalSeconds = Number(interval.getData());
    if (
      !["none", "hold_slot", "hold_break"].includes(actionValue) &&
      (!Number.isFinite(intervalSeconds) || intervalSeconds < 0.05 || intervalSeconds > 3600)
    ) {
      player.sendMessage(color.red("动作间隔必须是 0.05 到 3600 之间的秒数。"));
      return;
    }
    if (
      movementValue === "station" &&
      (![
        stationLocation.x,
        stationLocation.y,
        stationLocation.z,
        lookAtLocation.x,
        lookAtLocation.y,
        lookAtLocation.z,
      ].every(Number.isFinite) ||
        player.dimension.id !== item.dimension)
    ) {
      player.sendMessage(color.red("锁定位置必须是有效坐标，并且你需要与假人在同一维度录入。"));
      return;
    }
    const result = fakePlayerService.setBehavior(player, item.id, {
      movement: movementValue,
      targetPlayer: movementValue === "follow" ? targetNames[target.getData()] : undefined,
      speed: speed.getData(),
      action: actionValue,
      intervalTicks: Math.max(1, Math.round(intervalSeconds * 20)),
      hotbarSlot: Math.max(0, Math.min(8, Math.round(slot.getData()))),
      sneaking: sneaking.getData(),
      stationLocation: movementValue === "station" ? stationLocation : current.stationLocation,
      stationDimension: movementValue === "station" ? player.dimension.id : current.stationDimension,
      lookAtLocation: movementValue === "station" ? lookAtLocation : current.lookAtLocation,
    });
    if (typeof result === "string") {
      player.sendMessage(color.red(result));
      return;
    }
    player.sendMessage(color.green("假人行为已保存并开始执行。"));
    closeAndReturn();
  });
  form.button("停止全部行为", () => {
    const result = fakePlayerService.stopBehavior(player, item.id);
    player.sendMessage(typeof result === "string" ? color.red(result) : color.green("已停止假人的全部行为。"));
    if (typeof result !== "string") closeAndReturn();
  });
  form.button("返回", closeAndReturn);

  try {
    await form.show();
  } catch {
    openFakePlayerBehaviorFallbackForm(player, item, adminView, back);
  }
}

function openFakePlayerBehaviorFallbackForm(
  player: Player,
  item: IFakePlayer,
  adminView: boolean,
  back: () => void
): void {
  const current = fakePlayerService.getBehavior(item);
  const form = new ModalFormData();
  form.title(`行为控制 · ${item.name}`);
  form.dropdown(
    "移动方式",
    MOVEMENT_OPTIONS.map((option) => option.label),
    {
      defaultValueIndex: Math.max(
        0,
        MOVEMENT_OPTIONS.findIndex((option) => option.value === current.movement)
      ),
    }
  );
  form.textField("跟随的玩家名（仅跟随模式使用）", "必须是当前在线的真实玩家", {
    defaultValue: current.targetPlayer ?? player.name,
  });
  form.slider("移动速度", 0.1, 1, { defaultValue: current.speed, valueStep: 0.1 });
  form.dropdown(
    "周期动作",
    ACTION_OPTIONS.map((option) => option.label),
    {
      defaultValueIndex: Math.max(
        0,
        ACTION_OPTIONS.findIndex((option) => option.value === current.action)
      ),
    }
  );
  form.textField("动作间隔（秒）", "例如 1.5", {
    defaultValue: String(current.intervalTicks / 20),
  });
  form.slider("快捷栏槽位", 1, 9, { defaultValue: current.hotbarSlot + 1, valueStep: 1 });
  form.toggle("保持蹲下", { defaultValue: current.sneaking });
  form.toggle("停止全部行为", { defaultValue: false });
  form.submitButton("保存并立即执行");
  form.show(player).then((data) => {
    if (data.canceled || !data.formValues) {
      openFakePlayerDetailForm(player, item, adminView, back);
      return;
    }

    const stopAll = Boolean(data.formValues[7]);
    const intervalSeconds = Number(data.formValues[4]);
    if (!stopAll && (!Number.isFinite(intervalSeconds) || intervalSeconds < 0.05 || intervalSeconds > 3600)) {
      openDialogForm(player, { title: "保存失败", desc: color.red("动作间隔必须在 0.05 到 3600 秒之间。") }, () =>
        openFakePlayerBehaviorForm(player, item, adminView, back)
      );
      return;
    }

    const result = stopAll
      ? fakePlayerService.stopBehavior(player, item.id)
      : fakePlayerService.setBehavior(player, item.id, {
          movement: MOVEMENT_OPTIONS[Number(data.formValues[0])]?.value ?? "idle",
          targetPlayer: String(data.formValues[1] ?? "").trim(),
          speed: Number(data.formValues[2]),
          action: ACTION_OPTIONS[Number(data.formValues[3])]?.value ?? "none",
          intervalTicks: Math.max(1, Math.round(intervalSeconds * 20)),
          hotbarSlot: Math.round(Number(data.formValues[5])) - 1,
          sneaking: Boolean(data.formValues[6]),
        });
    openDialogForm(
      player,
      {
        title: typeof result === "string" ? "保存失败" : "行为已生效",
        desc:
          typeof result === "string"
            ? color.red(result)
            : color.green(stopAll ? "已停止移动、交互、挖掘和物品使用。" : "行为配置已保存并开始执行。"),
      },
      () => openFakePlayerDetailForm(player, fakePlayerService.getById(item.id) ?? item, adminView, back)
    );
  });
}

function openLegacyFakePlayerSkinForm(player: Player, item: IFakePlayer, adminView: boolean, back: () => void): void {
  const form = new ModalFormData();
  form.title(`更换皮肤 · ${item.name}`);
  form.dropdown(
    "二次元皮肤",
    FAKE_PLAYER_SKINS.map((skin) => skin.name),
    {
      defaultValueIndex: Math.max(
        0,
        FAKE_PLAYER_SKINS.findIndex((skin) => skin.id === item.skinId)
      ),
    }
  );
  form.submitButton("应用皮肤");
  form.show(player).then((data) => {
    if (data.canceled || !data.formValues) {
      openFakePlayerDetailForm(player, item, adminView, back);
      return;
    }
    const skin = FAKE_PLAYER_SKINS[Number(data.formValues[0])] ?? FAKE_PLAYER_SKINS[0];
    const result = fakePlayerService.setLegacySkin(player, item.id, skin.id);
    openDialogForm(
      player,
      {
        title: typeof result === "string" ? "更换失败" : "更换成功",
        desc: typeof result === "string" ? color.red(result) : color.green(`皮肤已更换为 ${skin.name}。`),
      },
      () => openFakePlayerListForm(player, adminView, back)
    );
  });
}
