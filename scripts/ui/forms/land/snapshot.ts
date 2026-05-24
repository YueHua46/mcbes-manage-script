import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { ILand } from "../../../core/types";
import landSnapshotService, { LandSnapshotRecord } from "../../../features/land/services/land-snapshot";
import { color } from "../../../shared/utils/color";
import { formatDateTime } from "../../../shared/utils/format";
import { openConfirmDialogForm } from "../../components/dialog";

function openSnapshotDialog(
  player: Player,
  title: string,
  desc: string,
  onButton?: () => void
): void {
  const form = new ActionFormData();
  form.title(title);
  form.body(desc);
  form.button("§w返回", "textures/icons/back");
  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    onButton?.();
  });
}

function formatSnapshotLine(snapshot: LandSnapshotRecord): string {
  const size = snapshot.bounds.size;
  return [
    `${color.gray("创建：")}${color.yellow(formatDateTime(snapshot.createdAt))}`,
    `${color.gray("分片：")}${color.aqua(String(snapshot.chunkCount))}`,
    `${color.gray("尺寸：")}${color.white(`${size.x}x${size.y}x${size.z}`)}`,
    `${color.gray("实体：")}${snapshot.includeEntities ? color.green("包含") : color.gray("不包含")}`,
    `${color.gray("操作人：")}${color.white(snapshot.createdBy)}`,
  ].join("\n");
}

function openChunkLimitSettingsForm(player: Player, land: ILand, back: () => void): void {
  const current = landSnapshotService.getChunkLimit();
  const form = new ModalFormData();
  form.title("§w快照切块上限");
  form.label(
    [
      "结构快照会把大领地拆成多个结构分片逐个保存/恢复。",
      "上限越高，允许的领地越大，但保存和恢复时会产生更明显的卡顿。",
      "建议只在确实需要恢复大型领地时临时提高，并避免超过服务器承受范围。",
    ].join("\n")
  );
  form.textField("自动切块上限", "默认 10，建议 1～30", { defaultValue: String(current) });
  form.submitButton("保存");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      return;
    }
    const values = data.formValues ?? [];
    const raw = values.find((value): value is string => typeof value === "string") ?? "";
    const next = Math.floor(Number(raw));
    const result = landSnapshotService.setChunkLimit(next);
    if (typeof result === "string") {
      openSnapshotDialog(player, "设置失败", color.red(result), () =>
        openChunkLimitSettingsForm(player, land, back)
      );
      return;
    }
    openSnapshotDialog(
      player,
      "设置已更新",
      color.green(`自动切块上限已设置为 ${next}。\n`) +
        color.gray("如果设置过大，保存/恢复大型领地时可能出现明显卡顿。"),
      back
    );
  });
}

function openCreateSnapshotOptionsForm(player: Player, land: ILand, back: () => void): void {
  const form = new ModalFormData();
  form.title("§w保存领地快照");
  form.label(
    [
      `将为领地 ${land.name} 保存结构快照。`,
      "",
      landSnapshotService.describePlan(land),
      "",
      "默认只保存方块。包含实体时会保存画、展示框、生物、掉落物等非玩家实体；恢复时会先清理区域内非玩家实体再放回快照实体。",
    ].join("\n")
  );
  form.toggle("包含实体", {
    defaultValue: false,
    tooltip: "开启后恢复快照会重置区域内非玩家实体。大型领地实体较多时会增加保存/恢复开销。",
  });
  form.submitButton("继续");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const includeEntities = data.formValues?.find((value): value is boolean => typeof value === "boolean") ?? false;

    openConfirmDialogForm(
      player,
      "§w保存领地快照",
      [
        `将为领地 ${land.name} 保存结构快照。`,
        "",
        landSnapshotService.describePlan(land),
        "",
        includeEntities
          ? "§e本次会包含实体。恢复时将清理区域内非玩家实体，再放回快照实体。"
          : "§7本次只保存方块，不保存实体。",
        "",
        "保存过程中可能出现短暂卡顿，确定继续吗？",
      ].join("\n"),
      () => {
        const result = landSnapshotService.createSnapshot(player, land.name, { includeEntities });
        openSnapshotDialog(
          player,
          typeof result === "string" ? "保存未启动" : "保存已启动",
          typeof result === "string"
            ? color.red(result)
            : color.green("快照保存任务已加入队列，请留意聊天和操作栏提示。"),
          back
        );
      },
      () => openCreateSnapshotOptionsForm(player, land, back)
    );
  });
}

function openSnapshotDetailForm(player: Player, land: ILand, snapshot: LandSnapshotRecord, back: () => void): void {
  const form = new ActionFormData();
  form.title("§w领地快照详情");
  form.body(
    [
      `${color.gold("领地：")}${color.yellow(snapshot.landName)}`,
      `${color.gold("快照：")}${color.white(snapshot.id)}`,
      "",
      formatSnapshotLine(snapshot),
      "",
      color.red("恢复会覆盖该领地对应区域内的方块，请确认没有玩家正在施工。"),
    ].join("\n")
  );
  form.button("§w恢复此快照", "textures/icons/requeue");
  form.button("§c删除此快照", "textures/icons/deny");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      return;
    }
    if (data.selection === 0) {
      openConfirmDialogForm(
        player,
        "§w恢复领地快照",
        [
          `将把领地 ${snapshot.landName} 恢复到 ${formatDateTime(snapshot.createdAt)} 的快照。`,
          "",
          snapshot.includeEntities
            ? "§e该快照包含实体。恢复时会清理区域内非玩家实体，再放回快照实体。"
            : "§7该快照不包含实体，只恢复方块。",
          "",
          "§c这会覆盖对应区域内的方块，确定继续吗？",
        ].join("\n"),
        () => {
          const result = landSnapshotService.restoreSnapshot(player, snapshot.id);
          openSnapshotDialog(
            player,
            typeof result === "string" ? "恢复未启动" : "恢复已启动",
            typeof result === "string"
              ? color.red(result)
              : color.green("快照恢复任务已加入队列，请留意聊天和操作栏提示。"),
            back
          );
        },
        () => openSnapshotDetailForm(player, land, snapshot, back),
        { dangerConfirm: true }
      );
      return;
    }
    if (data.selection === 1) {
      openConfirmDialogForm(
        player,
        "§w删除领地快照",
        `将删除该快照和它保存的 ${snapshot.chunkCount} 个结构分片。\n\n删除后不可恢复，确定继续吗？`,
        () => {
          const result = landSnapshotService.deleteSnapshot(snapshot.id);
          openSnapshotDialog(
            player,
            typeof result === "string" ? "删除失败" : "已删除",
            typeof result === "string" ? color.red(result) : color.green("快照已删除。"),
            back
          );
        },
        () => openSnapshotDetailForm(player, land, snapshot, back),
        { dangerConfirm: true }
      );
      return;
    }
    back();
  });
}

export function openLandSnapshotForm(player: Player, land: ILand, back: () => void): void {
  const snapshots = landSnapshotService.listByLand(land.name);
  const form = new ActionFormData();
  form.title("§w领地快照");
  form.body(
    [
      `${color.gold("领地：")}${color.yellow(land.name)}`,
      "",
      landSnapshotService.describePlan(land),
      "",
      color.gray("保存快照时可选择是否包含实体。保存和恢复会按分片逐 tick 执行。"),
    ].join("\n")
  );

  form.button("§w保存当前快照", "textures/icons/fotograf");
  for (const snapshot of snapshots.slice(0, 12)) {
    form.button(
      `§w${formatDateTime(snapshot.createdAt)}\n§8${snapshot.chunkCount} 分片 · ${snapshot.createdBy}`,
      "textures/icons/region"
    );
  }
  form.button("§w切块上限设置", "textures/icons/settings");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      return;
    }
    const selection = data.selection;
    if (selection === undefined || selection === null) return;

    if (selection === 0) {
      openCreateSnapshotOptionsForm(player, land, () => openLandSnapshotForm(player, land, back));
      return;
    }

    const snapshotIndex = selection - 1;
    if (snapshotIndex >= 0 && snapshotIndex < Math.min(snapshots.length, 12)) {
      openSnapshotDetailForm(player, land, snapshots[snapshotIndex], () => openLandSnapshotForm(player, land, back));
      return;
    }

    const limitButtonIndex = Math.min(snapshots.length, 12) + 1;
    if (selection === limitButtonIndex) {
      openChunkLimitSettingsForm(player, land, () => openLandSnapshotForm(player, land, back));
      return;
    }

    back();
  });
}
