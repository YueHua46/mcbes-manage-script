/**
 * PVP管理员配置UI
 */

import { Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { isAdmin } from "../../../shared/utils/common";
import pvpManager from "../../../features/pvp/services/pvp-manager";
import { color } from "../../../shared/utils/color";

/**
 * 打开PVP管理表单（管理员）
 */
export function openPvpManagementForm(player: Player): void {
  if (!isAdmin(player)) {
    player.sendMessage(color.red("只有管理员可以访问PVP管理！"));
    return;
  }

  const config = pvpManager.getConfig();
  const storedMode = pvpManager.getStoredMode();
  const moduleEnabled = pvpManager.isModuleEnabled();
  const modeOptions = [
    "原版模式：按世界/存档原版的玩家互相伤害设置决定",
    "插件模式：按插件规则控制，支持个人开关、统计、夺金",
    "强制模式：大乱斗，全员强制开启PVP（包括管理员）",
    "禁止模式：强制禁止玩家互相伤害",
  ];
  const modeValues = ["vanilla", "plugin", "forced", "off"] as const;
  const currentModeIndex = modeValues.indexOf(storedMode);

  const form = new ModalFormData();
  form.title("§wPVP管理");

  const moduleHint = moduleEnabled
    ? "功能开关：§a已开启"
    : "功能开关：§c已关闭§f（对外暂按原版处理，以下模式保存后会在重新开启功能开关时生效）";
  form.dropdown(
    `PVP模式\n${moduleHint}\n已保存模式：${pvpManager.getModeDisplay(storedMode)}\n对外生效：${pvpManager.getModeDisplay(config.mode)}\n${pvpManager.getModeDescription(storedMode)}`,
    modeOptions,
    { defaultValueIndex: currentModeIndex === -1 ? 2 : currentModeIndex }
  );
  form.slider("夺取金额", 0, 1000, { valueStep: 10, defaultValue: config.seizeAmount });
  form.slider("最低金币保护", 0, 500, { valueStep: 10, defaultValue: config.minGoldProtection });
  form.slider("切换冷却时间(秒)", 0, 120, { valueStep: 5, defaultValue: config.toggleCooldown });
  form.slider("战斗标签时间(秒)", 5, 60, { valueStep: 5, defaultValue: config.combatTagDuration });
  form.toggle("强制模式：无视领地保护（默认关闭，仅大乱斗生效）", {
    defaultValue: config.forcedIgnoreLandProtection,
  });

  form.show(player).then((response) => {
    if (response.canceled) return;

    const [modeIndex, seizeAmount, minProtection, cooldown, combatTag, forcedIgnoreLandProtection] =
      response.formValues as [number, number, number, number, number, boolean];
    const mode = modeValues[modeIndex] ?? "off";

    // 更新配置
    pvpManager.updateConfig({
      mode,
      seizeAmount,
      minGoldProtection: minProtection,
      toggleCooldown: cooldown,
      combatTagDuration: combatTag,
      forcedIgnoreLandProtection,
    });

    player.sendMessage(color.green("PVP配置已更新！"));
    player.sendMessage(color.yellow(`当前模式：${pvpManager.getModeDisplay(mode)}`));
    player.sendMessage(color.gray(pvpManager.getModeDescription(mode)));
    player.sendMessage(color.yellow(`夺取金额：${seizeAmount}`));
    player.sendMessage(color.yellow(`最低金币保护：${minProtection}`));
    player.sendMessage(color.yellow(`切换冷却时间：${cooldown}秒`));
    player.sendMessage(color.yellow(`战斗标签时间：${combatTag}秒`));
    player.sendMessage(color.yellow(`强制模式无视领地保护：${forcedIgnoreLandProtection ? "开启" : "关闭"}`));
  });
}
