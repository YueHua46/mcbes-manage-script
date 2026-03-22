/**
 * 玩家全服红包 UI
 */

import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { openDialogForm } from "../../components/dialog";
import redPacketService, {
  buildShareAmounts,
  getRedPacketExpiryMs,
  MAX_SHARE_COUNT,
  type RedPacketListItem,
} from "../../../features/economic/services/red-packet";
import economic from "../../../features/economic/services/economic";
import { colorCodes } from "../../../shared/utils/color";
import { formatDateTimeBeijing } from "../../../shared/utils/datetime-beijing";
import type { RedPacketMode } from "../../../features/economic/models/red-packet.model";

/** 红包子菜单（发红包 / 待领） */
export function openRedPacketMenu(player: Player): void {
  const { openEconomyMenuForm } = require("./index") as typeof import("./index");
  const pending = redPacketService.countPendingFor(player.name);
  let body =
    `${colorCodes.green}在此发送全服红包，或领取他人发放的红包。\n` +
    `${colorCodes.gray}在有效期内，谁先领谁得（每人每包限领一份）。\n`;
  if (pending > 0) {
    body += `\n${colorCodes.red}§l※ 你有 ${pending} 个红包待领取！`;
  }

  const form = new ActionFormData()
    .title("§w红包")
    .body(body)
    .button("§w发红包", "textures/icons/gift")
    .button("§w待领红包", "textures/icons/shop_bank")
    .button("§w领取详细", "textures/icons/quest_daily_common")
    .button("§w返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    switch (res.selection) {
      case 0:
        openSendRedPacketMenu(player);
        break;
      case 1:
        openClaimRedPacketMenu(player);
        break;
      case 2:
        openRedPacketDetailListMenu(player);
        break;
      default:
        openEconomyMenuForm(player);
        break;
    }
  });
}

/** 从红包菜单进入：先发模式选择，再进对应表单 */
export function openSendRedPacketMenu(player: Player): void {
  const expireHours = Math.round(getRedPacketExpiryMs() / (60 * 60 * 1000));
  const form = new ActionFormData()
    .title("§w发红包 · 选择模式")
    .body(
      `${colorCodes.green}请先选择一种发送方式，下一步会显示该方式的说明与输入项。\n\n` +
        `${colorCodes.yellow}① 每人每份固定金额\n` +
        `${colorCodes.gray}   每份金币相同；总扣款 = 份数 × 每份金额。\n\n` +
        `${colorCodes.yellow}② 固定份数 · 总金额随机分摊（拼手气）\n` +
        `${colorCodes.gray}   填写一笔总金币和份数；系统拆成多份，每份金额随机，先到先得。\n\n` +
        `${colorCodes.gray}有效期约 ${colorCodes.yellow}${expireHours} ${colorCodes.gray}小时 · 钱包 ${colorCodes.gold}${economic.getWallet(player.name).gold} ${colorCodes.gray}金币`
    )
    .button("§w① 每人每份固定金额", "textures/icons/coins")
    .button("§w② 拼手气（总金随机分份）", "textures/icons/gift")
    .button("§w返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    if (res.selection === 0) {
      showSendRedPacketModal(player, "per_head");
    } else if (res.selection === 1) {
      showSendRedPacketModal(player, "total");
    } else {
      openRedPacketMenu(player);
    }
  });
}

function showSendRedPacketModal(player: Player, mode: RedPacketMode): void {
  const form = new ModalFormData();
  if (mode === "per_head") {
    form.title("§w发红包 · 每人每份固定金额\n" + `§7每份金额相同；总扣款=份数×每份。§8不指定领取人，先到先得`);
    form.textField(`${colorCodes.yellow}红包份数`, `1～${MAX_SHARE_COUNT}，即发几个可领名额`, {
      defaultValue: "1",
    });
    form.textField(`${colorCodes.yellow}每份金币（正整数）`, "每份金额相同", { defaultValue: "100" });
    form.textField(`${colorCodes.gray}祝福语（可选）`, "恭喜发财", { defaultValue: "" });
  } else {
    form.title("§w发红包 · 拼手气（总金随机分份）\n" + `§7填写总金币与份数；随机拆份。§8不指定领取人，先到先得`);
    form.textField(`${colorCodes.yellow}红包份数`, `1～${MAX_SHARE_COUNT}，拆成几份随机金额`, {
      defaultValue: "1",
    });
    form.textField(`${colorCodes.yellow}总金币（正整数）`, "整包总金额，将随机拆到各份", { defaultValue: "100" });
    form.textField(`${colorCodes.gray}祝福语（可选）`, "恭喜发财", { defaultValue: "" });
  }
  form.submitButton("下一步");

  form.show(player).then((res) => {
    if (res.canceled || !res.formValues) {
      openSendRedPacketMenu(player);
      return;
    }

    const fv = res.formValues as (string | number | boolean | undefined)[];
    const headStr = String(fv[0] ?? "").trim();
    const amountStr = String(fv[1] ?? "").trim();
    const msgRaw = String(fv[2] ?? "");
    const headCount = Math.floor(Number(headStr));
    if (!Number.isFinite(headCount) || headCount < 1) {
      openDialogForm(player, { title: "红包份数无效", desc: `${colorCodes.red}请输入有效的正整数红包份数` }, () =>
        showSendRedPacketModal(player, mode)
      );
      return;
    }

    const amount = Math.floor(Number(amountStr));
    if (!Number.isFinite(amount) || amount < 1) {
      openDialogForm(player, { title: "金额无效", desc: `${colorCodes.red}请输入有效的正整数` }, () =>
        showSendRedPacketModal(player, mode)
      );
      return;
    }

    const built = buildShareAmounts(mode, amount, headCount);
    if (!built.ok) {
      openDialogForm(player, { title: "无法发放", desc: `${colorCodes.red}${built.error}` }, () =>
        showSendRedPacketModal(player, mode)
      );
      return;
    }

    const totalDeducted = built.totalDeducted;
    const nNow = built.shares.length;

    let preview: string;
    if (mode === "total") {
      const T = totalDeducted;
      const n = nNow;
      const rangeLine =
        T === n
          ? `${colorCodes.gray}共 ${n} 份 · 每份均为 ${colorCodes.gold}1 ${colorCodes.gray}（总额等于份数时无法拆出不同金额）`
          : `${colorCodes.gray}共 ${n} 份`;
      preview = `${colorCodes.green}将扣除 ${colorCodes.gold}${totalDeducted} ${colorCodes.green}金币\n` + rangeLine;
    } else {
      preview =
        `${colorCodes.green}每份 ${colorCodes.gold}${amount} ${colorCodes.green}金币\n` +
        `${colorCodes.gray}共 ${nNow} 份 · 合计扣除 ${colorCodes.gold}${totalDeducted}`;
    }

    const wallet = economic.getWallet(player.name);
    if (wallet.gold < totalDeducted) {
      openDialogForm(
        player,
        {
          title: "余额不足",
          desc: `${colorCodes.red}需要 ${colorCodes.gold}${totalDeducted} ${colorCodes.red}金币，当前 ${colorCodes.gold}${wallet.gold}`,
        },
        () => showSendRedPacketModal(player, mode)
      );
      return;
    }

    const msg = String(msgRaw ?? "").trim();
    const modeHint =
      mode === "per_head"
        ? `${colorCodes.gray}模式：§f每人每份固定金额`
        : `${colorCodes.gray}模式：§f拼手气（总金随机分份）`;
    const confirmBody = `${modeHint}\n\n${preview}\n\n${colorCodes.gray}确认后扣款并全服广播。\n${colorCodes.darkGray}不预分配领取人；有效期内谁先领谁得。`;

    const confirm = new ActionFormData()
      .title("§w确认发红包")
      .body(confirmBody)
      .button("§w确认发送", "textures/icons/accept")
      .button("§w返回修改", "textures/icons/deny");

    confirm.show(player).then((cres) => {
      if (cres.canceled || cres.selection === undefined) {
        showSendRedPacketModal(player, mode);
        return;
      }
      if (cres.selection !== 0) {
        showSendRedPacketModal(player, mode);
        return;
      }

      const err = redPacketService.createPacket(player, {
        mode,
        headCount,
        amount,
        message: msg,
      });
      if (err) {
        openDialogForm(player, { title: "发送失败", desc: `${colorCodes.red}${err}` }, () =>
          openSendRedPacketMenu(player)
        );
        return;
      }
      openDialogForm(
        player,
        {
          title: "§a发送成功",
          desc: `${colorCodes.green}红包已发出！\n${colorCodes.gray}任意玩家可在 ${colorCodes.yellow}经济系统 → 红包 → 待领红包 ${colorCodes.gray}抢领（先到先得，每人每包限领一份）。`,
        },
        () => openRedPacketMenu(player)
      );
    });
  });
}

function redPacketStatusLine(it: RedPacketListItem): string {
  if (it.finished) return "已领完";
  if (it.expired) return "已过期";
  return "进行中";
}

function formatClaimAt(ts: number): string {
  const s = formatDateTimeBeijing(ts);
  return s.length > 11 ? s.slice(5) : s;
}

/** 红包领取明细：列表 → 单包分页 */
export function openRedPacketDetailListMenu(player: Player): void {
  const list = redPacketService.listRedPacketsForDetail(40);
  if (list.length === 0) {
    openDialogForm(
      player,
      { title: "§w领取详细", desc: `${colorCodes.gray}暂无红包记录` },
      () => openRedPacketMenu(player)
    );
    return;
  }

  let body =
    `${colorCodes.green}以下为最近红包（按发放时间倒序）。\n` +
    `${colorCodes.gray}点选一条可查看每人领取金额；未当时在线也可回看。\n`;
  const form = new ActionFormData().title("§w红包 · 领取详细").body(body);
  list.forEach((it) => {
    const tag = redPacketStatusLine(it);
    const modeShort = it.mode === "total" ? "拼手气" : "固定";
    const statusColor = it.finished ? "§6" : it.expired ? "§c" : "§a";
    form.button(
      `§e§l${it.senderName}§r §3· §6${it.claimedCount}/${it.shareCount}份 §b${modeShort} ${statusColor}${tag}`,
      "textures/icons/gift"
    );
  });
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    if (res.selection === list.length) {
      openRedPacketMenu(player);
      return;
    }
    const sel = list[res.selection];
    if (!sel) {
      openRedPacketMenu(player);
      return;
    }
    openRedPacketDetailPage(player, sel.id, 0);
  });
}

const CLAIM_DETAIL_PAGE_SIZE = 10;

function openRedPacketDetailPage(player: Player, packetId: string, page: number): void {
  const res = redPacketService.getRedPacketClaimDetail(packetId);
  if (!res.ok) {
    openDialogForm(player, { title: "§w提示", desc: `${colorCodes.red}${res.error}` }, () => openRedPacketDetailListMenu(player));
    return;
  }

  const { item, claims, remainingCount } = res.data;
  const modeLabel = item.mode === "total" ? "拼手气（随机拆份）" : "每人每份固定";
  let statusText: string;
  if (item.finished) statusText = `${colorCodes.yellow}已领完`;
  else if (item.expired) statusText = `${colorCodes.red}已过期`;
  else statusText = `${colorCodes.green}进行中`;

  let body =
    `${colorCodes.white}发包: ${colorCodes.yellow}${item.senderName}\n` +
    `${colorCodes.gray}模式: ${modeLabel}\n` +
    `${colorCodes.gray}总额: ${colorCodes.gold}${item.totalDeducted} ${colorCodes.gray}金币 · 共 ${colorCodes.white}${item.shareCount} ${colorCodes.gray}份\n` +
    `${colorCodes.gray}状态: ${statusText} · 截止 ${formatDateTimeBeijing(item.expiresAt)}\n`;
  if (item.message) {
    body += `${colorCodes.lightPurple}寄语: ${item.message}\n`;
  }
  body += `\n${colorCodes.green}—— 领取记录 ——\n`;

  if (claims.length === 0) {
    body += `${colorCodes.gray}尚无人领取。\n`;
  }

  const maxPage = Math.max(0, Math.ceil(claims.length / CLAIM_DETAIL_PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(0, page), maxPage);
  const start = safePage * CLAIM_DETAIL_PAGE_SIZE;
  const slice = claims.slice(start, start + CLAIM_DETAIL_PAGE_SIZE);

  slice.forEach((c, i) => {
    const idx = start + i + 1;
    const timePart = c.at !== undefined ? ` ${colorCodes.darkGray}${formatClaimAt(c.at)}` : "";
    body += `${colorCodes.yellow}${idx}. ${colorCodes.aqua}${c.playerName} ${colorCodes.gray}+ ${colorCodes.gold}${c.amount} ${colorCodes.gray}金${timePart}\n`;
  });

  if (remainingCount > 0) {
    body += `\n${colorCodes.gray}剩余 ${colorCodes.white}${remainingCount} ${colorCodes.gray}份未领（未领完前不显示每份金额）`;
  }

  const form = new ActionFormData().title("§w领取明细").body(body);
  if (safePage < maxPage) {
    form.button("§w下一页", "textures/icons/right_arrow");
  }
  if (safePage > 0) {
    form.button("§w上一页", "textures/icons/left_arrow");
  }
  form.button("§w返回列表", "textures/icons/back");

  form.show(player).then((r) => {
    if (r.canceled || r.selection === undefined) return;
    let idx = 0;
    if (safePage < maxPage) {
      if (r.selection === idx) {
        openRedPacketDetailPage(player, packetId, safePage + 1);
        return;
      }
      idx++;
    }
    if (safePage > 0) {
      if (r.selection === idx) {
        openRedPacketDetailPage(player, packetId, safePage - 1);
        return;
      }
      idx++;
    }
    openRedPacketDetailListMenu(player);
  });
}

/** 待领红包列表 */
export function openClaimRedPacketMenu(player: Player): void {
  const pending = redPacketService.getPendingPacketsFor(player.name);
  if (pending.length === 0) {
    const emptyForm = new ActionFormData()
      .title("§w待领红包")
      .body(`${colorCodes.gray}当前没有可领取的红包。`)
      .button("§w返回", "textures/icons/back");
    emptyForm.show(player).then(() => openRedPacketMenu(player));
    return;
  }

  let bodyText = `${colorCodes.green}以下为可抢领的红包（即将截止的在前，先到先得）：\n`;
  pending.forEach((p, i) => {
    const t = formatDateTimeBeijing(p.expiresAt);
    const isLucky = p.mode === "total";
    bodyText += `\n${colorCodes.yellow}${i + 1}. ${colorCodes.white}${p.senderName}`;
    if (isLucky) {
      bodyText += ` ${colorCodes.gray}· ${colorCodes.gold}拼手气 ${colorCodes.gray}（领取前不显示金额）`;
    } else {
      bodyText += ` ${colorCodes.gray}· ${colorCodes.gold}${p.amount} ${colorCodes.gray}金币/份`;
    }
    bodyText += `\n   ${colorCodes.darkGray}截止 ${t}`;
    if (p.message) {
      bodyText += `\n   ${colorCodes.lightPurple}「${p.message}」`;
    }
  });

  const listForm = new ActionFormData().title("§w待领红包").body(bodyText);
  pending.forEach((p) => {
    const isLucky = p.mode === "total";
    const btnLabel = isLucky
      ? `§e§l${p.senderName}§r §b拼手气`
      : `§e§l${p.senderName}§r §6§l${p.amount}§r §6金/份`;
    listForm.button(btnLabel, "textures/icons/gift");
  });
  listForm.button("§w返回", "textures/icons/back");

  listForm.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    if (res.selection === pending.length) {
      openRedPacketMenu(player);
      return;
    }
    const sel = pending[res.selection];
    if (!sel) {
      openRedPacketMenu(player);
      return;
    }
    const err = redPacketService.claim(player, sel.id);
    openDialogForm(
      player,
      {
        title: err ? "领取失败" : "领取成功",
        desc: err
          ? `${colorCodes.red}${err}`
          : `${colorCodes.green}已获得 ${colorCodes.gold}${sel.amount} ${colorCodes.green}金币`,
      },
      () => openClaimRedPacketMenu(player)
    );
  });
}

export function getPendingRedPacketHint(player: Player): string {
  const n = redPacketService.countPendingFor(player.name);
  if (n < 1) return "";
  return `\n${colorCodes.red}§l※ 你有 ${n} 个红包待领！${colorCodes.green} → 点「红包」`;
}
