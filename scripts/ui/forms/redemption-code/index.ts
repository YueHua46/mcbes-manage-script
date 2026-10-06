import { Player } from "@minecraft/server";
import { CreeperActionFormData as ActionFormData } from "../../creeper-action-form";
import { CreeperMessageFormData as MessageFormData } from "../../creeper-message-form";
import { CreeperModalFormData as ModalFormData } from "../../creeper-modal-form";
import redemptionCodeService from "../../../features/economic/services/redemption-code";
import { formatDateTimeBeijing } from "../../../shared/utils/datetime-beijing";
import { color } from "../../../shared/utils/color";
import { isAdmin } from "../../../shared/utils/common";

const PAGE_SIZE = 10;

type ReturnForm = () => void;
type RedemptionCodeView = ReturnType<typeof redemptionCodeService.list>[number];
type RedemptionClaimView = RedemptionCodeView["claims"][string];
type RecoveryResolutionView = NonNullable<RedemptionCodeView["recoveryResolutions"]>[number];
type ClaimHistoryEntry =
  | { kind: "claim"; timestamp: number; claim: RedemptionClaimView }
  | { kind: "resolution"; timestamp: number; resolution: RecoveryResolutionView };

function openNotice(player: Player, title: string, body: string, onBack: ReturnForm): void {
  new ActionFormData()
    .title(title)
    .body(body)
    .button("返回", "textures/icons/back")
    .show(player)
    .then(onBack)
    .catch(() => onBack());
}

function openConfirm(
  player: Player,
  title: string,
  body: string,
  confirmText: string,
  onConfirm: ReturnForm,
  onCancel: ReturnForm
): void {
  new MessageFormData()
    .title(title)
    .body(body)
    .button1("取消")
    .button2(confirmText)
    .show(player)
    .then((response) => {
      if (!response.canceled && response.selection === 1) {
        onConfirm();
        return;
      }
      onCancel();
    })
    .catch(() => onCancel());
}

function requireAdmin(player: Player): boolean {
  if (isAdmin(player)) return true;
  player.sendMessage(color.red("只有管理员可以管理兑换码。"));
  return false;
}

function formatExpiry(expiresAt: number | null): string {
  return expiresAt === null ? "永久" : `${formatDateTimeBeijing(expiresAt)}（北京时间）`;
}

function getClaims(code: RedemptionCodeView): RedemptionClaimView[] {
  return Object.values(code.claims).sort((a, b) => b.preparedAt - a.preparedAt);
}

function getClaimHistory(code: RedemptionCodeView): ClaimHistoryEntry[] {
  const claims: ClaimHistoryEntry[] = getClaims(code).map((claim) => ({
    kind: "claim",
    timestamp: claim.preparedAt,
    claim,
  }));
  const resolutions: ClaimHistoryEntry[] = (code.recoveryResolutions ?? []).map((resolution) => ({
    kind: "resolution",
    timestamp: resolution.resolvedAt,
    resolution,
  }));
  return [...claims, ...resolutions].sort((a, b) => b.timestamp - a.timestamp);
}

function getReservedCount(code: RedemptionCodeView): number {
  return getClaims(code).filter((claim) => claim.status !== "granted").length;
}

function getGrantedCount(code: RedemptionCodeView): number {
  return getClaims(code).filter((claim) => claim.status === "granted").length;
}

function getRemainingUses(code: RedemptionCodeView): number | null {
  if (code.maxUses === null) return null;
  return Math.max(0, code.maxUses - getClaims(code).length);
}

function getCodeStateLabel(code: RedemptionCodeView): string {
  if (code.status === "archived") return "已归档";
  if (Date.now() >= (code.expiresAt ?? Number.POSITIVE_INFINITY)) return "已过期";
  if (getRemainingUses(code) === 0) return "已领完";
  return code.status === "active" ? "使用中" : "已停用";
}

function getCodeStateIcon(code: RedemptionCodeView): string {
  if (code.status === "archived") return "textures/icons/inventory_snapshot_archive";
  if (getCodeStateLabel(code) === "使用中") return "textures/icons/gift";
  if (getCodeStateLabel(code) === "已过期") return "textures/icons/clock";
  return "textures/icons/deny";
}

function getClaimStateLabel(status: RedemptionClaimView["status"]): string {
  switch (status) {
    case "granted":
      return "已到账";
    case "prepared":
      return "等待发放";
    case "recovery_required":
      return "需要人工核对";
  }
}

function getClaimStateIcon(status: RedemptionClaimView["status"]): string {
  if (status === "granted") return "textures/icons/accept";
  if (status === "recovery_required") return "textures/icons/deny";
  return "textures/icons/gift";
}

function redemptionFailureTitle(reason: string): string {
  switch (reason) {
    case "economy_disabled":
      return "经济系统未开启";
    case "not_ready":
      return "兑换服务未就绪";
    case "not_found":
      return "兑换码不存在";
    case "already_claimed":
      return "兑换码已使用";
    case "expired":
      return "兑换码已过期";
    case "disabled":
      return "兑换码已停用";
    case "archived":
      return "兑换码已归档";
    case "exhausted":
      return "兑换码已领完";
    case "balance_limit_exceeded":
      return "余额将超过上限";
    case "recovery_required":
      return "兑换状态待核对";
    case "busy":
      return "兑换请求繁忙";
    case "conflict":
      return "兑换记录冲突";
    case "persistence_error":
    case "retryable_error":
      return "兑换暂未完成";
    default:
      return "兑换失败";
  }
}

/** 普通成员入口；关闭表单或完成兑换后返回“其他功能”。 */
export function openRedemptionCodeForm(player: Player, onBack: ReturnForm): void {
  if (!redemptionCodeService.isEconomyEnabled()) {
    openNotice(player, "兑换码不可用", color.yellow("经济系统当前未开启，暂时不能兑换金币。"), onBack);
    return;
  }
  if (!redemptionCodeService.isReady()) {
    openNotice(player, "兑换码不可用", color.yellow("兑换服务正在初始化，请稍后重试。"), onBack);
    return;
  }

  const form = new ModalFormData();
  form.title("兑换码");
  form.textField("兑换码", "请输入兑换码（区分大小写和空格）", { defaultValue: "" });
  form.submitButton("兑换");
  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) {
      onBack();
      return;
    }

    // 兑换码采用精确匹配，不能在 UI 层 trim 或改变大小写。
    const rawCode = String(response.formValues[0] ?? "");
    let result: ReturnType<typeof redemptionCodeService.redeem>;
    try {
      result = redemptionCodeService.redeem(player, rawCode);
    } catch (error) {
      openNotice(player, "兑换暂未完成", color.red(`兑换服务发生异常，请稍后重试。\n${String(error)}`), () =>
        openRedemptionCodeForm(player, onBack)
      );
      return;
    }

    if (!result.ok) {
      openNotice(player, redemptionFailureTitle(result.reason), color.red(result.message), () =>
        openRedemptionCodeForm(player, onBack)
      );
      return;
    }

    const pendingHint = result.persistencePending
      ? color.yellow("\n领取记录仍在完成持久化；系统会自动恢复，请勿重复操作。")
      : "";
    openNotice(
      player,
      "兑换成功",
      color.green(`已获得 ${result.gold} 金币，当前余额 ${result.balance} 金币。`) + pendingHint,
      onBack
    );
  });
}

/** 管理入口；由“经济系统管理”传入直接父菜单。 */
export function openRedemptionCodeManageForm(player: Player, onBack: ReturnForm): void {
  if (!requireAdmin(player)) return;
  if (!redemptionCodeService.isReady()) {
    openNotice(player, "兑换码管理", color.yellow("兑换码服务正在初始化，请稍后重试。"), onBack);
    return;
  }

  const form = new ActionFormData();
  form.title("兑换码管理");
  form.body("创建和管理金币兑换码。归档记录与领取历史会永久保留。");
  form.button("创建兑换码", "textures/icons/gift");
  form.button("兑换码列表", "textures/icons/rewards");
  form.button("已归档兑换码", "textures/icons/inventory_snapshot_archive");
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) {
      onBack();
      return;
    }
    switch (response.selection) {
      case 0:
        openCreateRedemptionCodeForm(player, () => openRedemptionCodeManageForm(player, onBack));
        break;
      case 1:
        openRedemptionCodeListForm(player, false, 1, () => openRedemptionCodeManageForm(player, onBack));
        break;
      case 2:
        openRedemptionCodeListForm(player, true, 1, () => openRedemptionCodeManageForm(player, onBack));
        break;
      default:
        onBack();
        break;
    }
  });
}

function parsePositiveInteger(value: unknown): number | undefined {
  const text = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function openCreateRedemptionCodeForm(player: Player, onBack: ReturnForm): void {
  if (!requireAdmin(player)) return;
  const form = new ModalFormData();
  form.title("创建兑换码");
  form.textField("自定义兑换码", "留空则自动生成 CM-XXXX-XXXX-XXXX", { defaultValue: "" });
  form.textField("奖励金币", "正整数", { defaultValue: "100" });
  form.toggle("限制全服兑换次数", { defaultValue: true });
  form.textField("全服最多兑换次数", "开启限制时填写正整数", { defaultValue: "1" });
  form.toggle("设置过期时间", { defaultValue: false });
  form.textField("有效小时数", "开启过期时填写正整数", { defaultValue: "24" });
  form.submitButton("创建");
  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) {
      onBack();
      return;
    }
    if (!requireAdmin(player)) return;

    const customCode = String(response.formValues[0] ?? "");
    const gold = parsePositiveInteger(response.formValues[1]);
    const limited = response.formValues[2] === true;
    const maxUses = limited ? parsePositiveInteger(response.formValues[3]) : null;
    const expiring = response.formValues[4] === true;
    const expiresInHours = expiring ? parsePositiveInteger(response.formValues[5]) : null;

    if (gold === undefined) {
      openNotice(player, "创建失败", color.red("奖励金币必须是正整数。"), () =>
        openCreateRedemptionCodeForm(player, onBack)
      );
      return;
    }
    if (limited && maxUses === undefined) {
      openNotice(player, "创建失败", color.red("限量兑换次数必须是正整数。"), () =>
        openCreateRedemptionCodeForm(player, onBack)
      );
      return;
    }
    if (expiring && expiresInHours === undefined) {
      openNotice(player, "创建失败", color.red("有效小时数必须是正整数。"), () =>
        openCreateRedemptionCodeForm(player, onBack)
      );
      return;
    }

    const result = redemptionCodeService.create(player, {
      // 只有真正的空字符串表示自动生成；空格也是兑换码原文，由服务进行合法性校验。
      code: customCode === "" ? undefined : customCode,
      gold,
      maxUses: maxUses ?? null,
      expiresInHours: expiresInHours ?? null,
    });
    if (!result.ok) {
      openNotice(player, "创建失败", color.red(result.message), () => openCreateRedemptionCodeForm(player, onBack));
      return;
    }

    if (result.generated) {
      player.sendMessage("自动生成的兑换码（下一行可复制）：");
      player.sendMessage(result.code.code);
    }
    openNotice(
      player,
      "创建成功",
      `${color.green(result.message)}\n\n兑换码：${result.code.code}\n奖励：${result.code.gold} 金币\n总次数：${
        result.code.maxUses === null ? "无限" : result.code.maxUses
      }\n有效期：${formatExpiry(result.code.expiresAt)}`,
      onBack
    );
  });
}

function openRedemptionCodeListForm(player: Player, archived: boolean, page: number, onBack: ReturnForm): void {
  if (!requireAdmin(player)) return;
  const codes = redemptionCodeService.list({ archived });
  const totalPages = Math.max(1, Math.ceil(codes.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageCodes = codes.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const form = new ActionFormData();
  const actions: ReturnForm[] = [];
  form.title(archived ? "已归档兑换码" : "兑换码列表");
  form.body(`第 ${safePage} / ${totalPages} 页 · 共 ${codes.length} 个${archived ? "归档" : "未归档"}兑换码`);

  pageCodes.forEach((code) => {
    form.button(
      `${code.code}\n${code.gold} 金币 · ${getCodeStateLabel(code)} · ${
        code.maxUses === null ? "无限量" : `剩余 ${getRemainingUses(code)}/${code.maxUses}`
      }`,
      getCodeStateIcon(code)
    );
    actions.push(() =>
      openRedemptionCodeDetailForm(player, code.id, () =>
        openRedemptionCodeListForm(player, archived, safePage, onBack)
      )
    );
  });

  if (safePage > 1) {
    form.button("上一页", "textures/icons/left_arrow");
    actions.push(() => openRedemptionCodeListForm(player, archived, safePage - 1, onBack));
  }
  if (safePage < totalPages) {
    form.button("下一页", "textures/icons/right_arrow");
    actions.push(() => openRedemptionCodeListForm(player, archived, safePage + 1, onBack));
  }
  form.button("返回", "textures/icons/back");
  actions.push(onBack);

  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) {
      onBack();
      return;
    }
    actions[response.selection]?.();
  });
}

function formatCodeDetail(code: RedemptionCodeView): string {
  const granted = getGrantedCount(code);
  const reserved = getReservedCount(code);
  const remaining = getRemainingUses(code);
  return [
    `兑换码：${code.code}`,
    `奖励金币：${code.gold}`,
    `当前状态：${getCodeStateLabel(code)}`,
    `有效期：${formatExpiry(code.expiresAt)}`,
    `兑换总次数：${code.maxUses === null ? "无限" : code.maxUses}`,
    `已到账：${granted}`,
    `占位/待恢复：${reserved}`,
    `剩余次数：${remaining === null ? "无限" : remaining}`,
    `创建者：${code.createdByName}（${code.createdById}）`,
    `创建时间：${formatDateTimeBeijing(code.createdAt)}（北京时间）`,
  ].join("\n");
}

function openRedemptionCodeDetailForm(player: Player, codeId: string, onBack: ReturnForm): void {
  if (!requireAdmin(player)) return;
  const code = redemptionCodeService.getById(codeId);
  if (!code) {
    openNotice(player, "兑换码不存在", color.yellow("该兑换码已不存在，请刷新列表。"), onBack);
    return;
  }

  const form = new ActionFormData();
  const actions: ReturnForm[] = [];
  const reopen = () => openRedemptionCodeDetailForm(player, codeId, onBack);
  form.title("兑换码详情");
  form.body(formatCodeDetail(code));
  form.button("领取记录", "textures/icons/rewards");
  actions.push(() => openClaimHistoryForm(player, codeId, 1, reopen));

  if (code.status !== "archived") {
    if (code.status === "active") {
      form.button("停用兑换码", "textures/icons/deny");
      actions.push(() => openSetEnabledConfirm(player, code, false, reopen));
    } else if (Date.now() < (code.expiresAt ?? Number.POSITIVE_INFINITY) && getRemainingUses(code) !== 0) {
      form.button("恢复使用", "textures/icons/accept");
      actions.push(() => openSetEnabledConfirm(player, code, true, reopen));
    }
    form.button("永久归档", "textures/icons/inventory_snapshot_archive");
    actions.push(() => openArchiveConfirm(player, code, onBack));
  }

  form.button("返回", "textures/icons/back");
  actions.push(onBack);
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) {
      onBack();
      return;
    }
    actions[response.selection]?.();
  });
}

function openSetEnabledConfirm(player: Player, code: RedemptionCodeView, enabled: boolean, onBack: ReturnForm): void {
  openConfirm(
    player,
    enabled ? "恢复兑换码" : "停用兑换码",
    enabled
      ? `确认恢复兑换码「${code.code}」吗？恢复后，符合次数和有效期条件的玩家可继续兑换。`
      : `确认停用兑换码「${code.code}」吗？已占位的领取仍可继续完成。`,
    enabled ? "确认恢复" : "确认停用",
    () => {
      if (!requireAdmin(player)) return;
      const result = redemptionCodeService.setEnabled(player, code.id, enabled);
      openNotice(
        player,
        result.ok ? "操作成功" : "操作失败",
        result.ok ? color.green(result.message) : color.red(result.message),
        onBack
      );
    },
    onBack
  );
}

function openArchiveConfirm(player: Player, code: RedemptionCodeView, onBack: ReturnForm): void {
  openConfirm(
    player,
    "永久归档兑换码",
    `确认归档「${code.code}」吗？\n\n归档后不能恢复或再次使用；代码本身和全部领取历史会永久保留，且该代码不能重新创建。`,
    "确认归档",
    () => {
      if (!requireAdmin(player)) return;
      const result = redemptionCodeService.archive(player, code.id);
      openNotice(
        player,
        result.ok ? "归档成功" : "归档失败",
        result.ok ? color.green(result.message) : color.red(result.message),
        onBack
      );
    },
    () => openRedemptionCodeDetailForm(player, code.id, onBack)
  );
}

function openClaimHistoryForm(player: Player, codeId: string, page: number, onBack: ReturnForm): void {
  if (!requireAdmin(player)) return;
  const code = redemptionCodeService.getById(codeId);
  if (!code) {
    openNotice(player, "领取记录", color.yellow("兑换码已不存在，请刷新列表。"), onBack);
    return;
  }
  const claims = getClaims(code);
  const history = getClaimHistory(code);
  const resolutionCount = code.recoveryResolutions?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageEntries = history.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const form = new ActionFormData();
  const actions: ReturnForm[] = [];
  form.title("领取记录");
  form.body(
    `兑换码：${code.code}\n第 ${safePage} / ${totalPages} 页 · ${claims.length} 条领取 · ${resolutionCount} 条人工处理审计`
  );

  pageEntries.forEach((entry) => {
    if (entry.kind === "claim") {
      const claim = entry.claim;
      form.button(
        `${claim.playerName}\n${getClaimStateLabel(claim.status)} · ${formatDateTimeBeijing(claim.updatedAt)}`,
        getClaimStateIcon(claim.status)
      );
      actions.push(() =>
        openClaimDetailForm(player, codeId, claim.playerIdentityId, () =>
          openClaimHistoryForm(player, codeId, safePage, onBack)
        )
      );
      return;
    }

    const resolution = entry.resolution;
    const actionLabel = resolution.action === "mark_granted" ? "标记已到账" : "撤销占位";
    form.button(
      `${resolution.playerName}\n人工处理：${actionLabel} · ${formatDateTimeBeijing(resolution.resolvedAt)}`,
      resolution.action === "mark_granted" ? "textures/icons/accept" : "textures/icons/deny"
    );
    actions.push(() =>
      openNotice(
        player,
        "人工处理审计",
        `玩家：${resolution.playerName}\n身份 ID：${resolution.playerIdentityId}\n处理结果：${actionLabel}\n管理员：${
          resolution.resolvedByName
        }（${resolution.resolvedById}）\n处理时间：${formatDateTimeBeijing(resolution.resolvedAt)}（北京时间）\n\n${color.gray(
          "该操作只处理领取状态或占位，没有直接修改玩家金币。"
        )}`,
        () => openClaimHistoryForm(player, codeId, safePage, onBack)
      )
    );
  });
  if (safePage > 1) {
    form.button("上一页", "textures/icons/left_arrow");
    actions.push(() => openClaimHistoryForm(player, codeId, safePage - 1, onBack));
  }
  if (safePage < totalPages) {
    form.button("下一页", "textures/icons/right_arrow");
    actions.push(() => openClaimHistoryForm(player, codeId, safePage + 1, onBack));
  }
  form.button("返回", "textures/icons/back");
  actions.push(onBack);
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) {
      onBack();
      return;
    }
    actions[response.selection]?.();
  });
}

function formatClaimDetail(claim: RedemptionClaimView): string {
  return [
    `玩家：${claim.playerName}`,
    `身份 ID：${claim.playerIdentityId}`,
    `状态：${getClaimStateLabel(claim.status)}`,
    `占位时间：${formatDateTimeBeijing(claim.preparedAt)}（北京时间）`,
    `最后更新：${formatDateTimeBeijing(claim.updatedAt)}（北京时间）`,
    claim.grantedAt ? `到账时间：${formatDateTimeBeijing(claim.grantedAt)}（北京时间）` : "",
    claim.recoveryReason ? `异常原因：${claim.recoveryReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function openClaimDetailForm(player: Player, codeId: string, playerIdentityId: string, onBack: ReturnForm): void {
  if (!requireAdmin(player)) return;
  const code = redemptionCodeService.getById(codeId);
  const claim = code?.claims[playerIdentityId];
  if (!code || !claim) {
    openNotice(player, "领取记录", color.yellow("该领取记录已不存在，请刷新列表。"), onBack);
    return;
  }

  const form = new ActionFormData();
  const actions: ReturnForm[] = [];
  form.title("领取记录详情");
  form.body(formatClaimDetail(claim));
  if (claim.status === "recovery_required") {
    form.button("标记已到账", "textures/icons/accept");
    actions.push(() => openResolveRecoveryConfirm(player, code, claim, "mark_granted", onBack));
    form.button("撤销占位", "textures/icons/deny");
    actions.push(() => openResolveRecoveryConfirm(player, code, claim, "release", onBack));
  }
  form.button("返回", "textures/icons/back");
  actions.push(onBack);
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) {
      onBack();
      return;
    }
    actions[response.selection]?.();
  });
}

function openResolveRecoveryConfirm(
  player: Player,
  code: RedemptionCodeView,
  claim: RedemptionClaimView,
  action: "mark_granted" | "release",
  onBack: ReturnForm
): void {
  const markGranted = action === "mark_granted";
  openConfirm(
    player,
    markGranted ? "标记领取已到账" : "撤销领取占位",
    `${markGranted ? "确认将该异常领取标记为已到账" : "确认撤销该异常领取占用的名额"}吗？\n\n玩家：${
      claim.playerName
    }\n兑换码：${code.code}\n奖励：${code.gold} 金币\n\n${color.red(
      "此操作不会修改玩家金币。请先通过“玩家金币管理”核对并纠正余额。"
    )}`,
    markGranted ? "确认已到账" : "确认撤销",
    () => {
      if (!requireAdmin(player)) return;
      const result = redemptionCodeService.resolveRecovery(player, code.id, claim.playerIdentityId, action);
      openNotice(
        player,
        result.ok ? "处理成功" : "处理失败",
        result.ok ? color.green(result.message) : color.red(result.message),
        onBack
      );
    },
    () => openClaimDetailForm(player, code.id, claim.playerIdentityId, onBack)
  );
}
