/**
 * 行为日志管理：登记「玩家获得指定物品时要记录背包」的物品类型（写入行为日志供管理员查看）
 */

import { Player, RawMessage, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import {
  addSubscription,
  clearSubscriptions,
  formatItemWatchSubscriptionLabel,
  listSubscriptions,
  removeSubscription,
  SPAWN_EGG_GROUP_TOKEN,
} from "../../../features/item-watch/item-watch-subscription";
import { openConfirmDialogForm, openDialogForm } from "../../components/dialog";
import { color } from "../../../shared/utils/color";
import behaviorLog, {
  formatBehaviorTimestamp,
  parseItemWatchSnapshotId,
} from "../../../features/behavior-log/services/behavior-log";
import { resolveItemLocalizationKey } from "../../../features/behavior-log/services/item-watch-collect";
import itemWatchSnapshotStore from "../../../features/behavior-log/services/item-watch-snapshot-store";
import { openItemWatchSnapshotChestForm } from "../../../features/behavior-log/services/item-watch-snapshot-chest";

const SNAPSHOT_PAGE_SIZE = 20;
const FORM_OPEN_MAX_ATTEMPTS = 8;
const FORM_OPEN_RETRY_TICKS = 2;
const FORM_NAV_DELAY_TICKS = 2;

const snapshotTimeRangeOptions = [
  { label: "最近 1 小时", value: "1h" },
  { label: "最近 6 小时", value: "6h" },
  { label: "最近 24 小时", value: "24h" },
  { label: "最近 3 天", value: "3d" },
  { label: "最近 7 天", value: "7d" },
  { label: "全部时间", value: "all" },
];

function getSnapshotStartTime(value: string): number | undefined {
  const now = Date.now();
  switch (value) {
    case "1h":
      return now - 60 * 60 * 1000;
    case "6h":
      return now - 6 * 60 * 60 * 1000;
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "3d":
      return now - 3 * 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    default:
      return undefined;
  }
}

function shortTypeId(typeId: string): string {
  return typeId.replace(/^minecraft:/, "");
}

/** 背包存档列表行：有 localizationKey 时用 translate 显示客户端语言物品名 */
function snapshotArchiveRowLabel(
  playerName: string,
  shortTs: string,
  typeId: string | undefined,
  localizationKey: string | undefined
): RawMessage | string {
  if (localizationKey) {
    return {
      rawtext: [{ text: `§b${playerName}§r §8· §f` }, { translate: localizationKey }, { text: `\n§8${shortTs}` }],
    };
  }
  const itemShort = typeId ? shortTypeId(typeId) : "?";
  return `§b${playerName}§r §8· §f${itemShort}\n§8${shortTs}`;
}

async function showItemWatchForm(
  form: ActionFormData | ModalFormData,
  player: Player
): Promise<{ canceled: boolean; selection?: number; formValues?: (string | number | boolean)[] }> {
  for (let attempt = 0; attempt < FORM_OPEN_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await form.show(player);
      const canceled = response.canceled ?? !!response.cancelationReason;
      if (canceled && response.cancelationReason === "UserBusy" && attempt < FORM_OPEN_MAX_ATTEMPTS - 1) {
        await system.waitTicks(FORM_OPEN_RETRY_TICKS);
        continue;
      }
      if (canceled) return { canceled: true };
      const r = response as { selection?: number; formValues?: (string | number | boolean)[] };
      return { canceled: false, selection: r.selection, formValues: r.formValues };
    } catch {
      return { canceled: true };
    }
  }
  return { canceled: true };
}

function delayNav(fn: () => void): void {
  system.runTimeout(fn, FORM_NAV_DELAY_TICKS);
}

/** 用生活化语言说明「会发生什么」；登记列表仅管理员可改，对全服玩家生效 */
const BODY_HINT = [
  "§f登记后，任意玩家拿到对应物品时，服务器会自动存一份当时的背包快照。点「§b查看背包存档记录§f」可按玩家和时间筛选并进入箱子界面查看。",
  "",
  "§e全部生成蛋：§f点「§e登记全部生成蛋§f」或命令 §eadd spawn_egg_group§f，可一次添加监控任意 typeId 以 §7_spawn_egg§f 结尾的物品（既那些可能含开挂获得的生成蛋），只占登记列表 §71§f 条配额。",
  "",
  "§b怎么填「物品类型」？§f先在游戏里§e手拿§f那件物品，聊天输入 §e/yuehua:get_item_typeid§f 可复制编号；背包内全部编号用 §e/yuehua:get_item_typeid all§f。亦可用管理员命令 §e/yuehua:subscribe_item_hold§f 来管理登记列表。",
  "",
].join("\n");

function formatListLines(player: Player): string {
  const list = listSubscriptions(player);
  return list.length > 0
    ? list.map((id) => `§b· §f${formatItemWatchSubscriptionLabel(id)}`).join("\n")
    : "§3（还没登记任何物品类型）";
}

function openAddSubscribeModal(player: Player, onDone: () => void): void {
  const form = new ModalFormData();
  form.title("§w新增一种物品监控");
  form.textField(
    "物品类型编号（与游戏内完全一致，一般是 minecraft:xxx；也可填 spawn_egg_group 监控全部 …_spawn_egg）",
    "手持物品后用 /yuehua:get_item_typeid 复制"
  );
  form.submitButton("新增");
  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason || !data.formValues?.length) {
      onDone();
      return;
    }
    const typeId = String(data.formValues[0] ?? "").trim();
    if (!typeId) {
      openDialogForm(player, { title: "提示", desc: color.red("请先填上要监控的物品类型编号。") }, onDone);
      return;
    }
    const r = addSubscription(player, typeId);
    openDialogForm(
      player,
      { title: r.ok ? "已登记" : "未登记", desc: r.ok ? color.green(r.message) : color.red(r.message) },
      onDone
    );
  });
}

function openRemoveSubscribeMenu(player: Player, onDone: () => void): void {
  const list = listSubscriptions(player);
  if (list.length === 0) {
    openDialogForm(player, { title: "提示", desc: color.yellow("当前列表是空的，没有可取消的。") }, onDone);
    return;
  }

  const form = new ActionFormData();
  form.title("§w取消对已登记物品的监控");
  form.body(`${BODY_HINT}\n§f点一下某项，就不再监控这种物品：\n${formatListLines(player)}`);

  for (const id of list) {
    form.button(`§c不再监控 §f${formatItemWatchSubscriptionLabel(id)}`, "textures/icons/requeue");
  }
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason || typeof data.selection !== "number") {
      onDone();
      return;
    }
    if (data.selection === list.length) {
      onDone();
      return;
    }
    const id = list[data.selection];
    const r = removeSubscription(player, id);
    openDialogForm(
      player,
      { title: r.ok ? "已取消" : "失败", desc: r.ok ? color.green(r.message) : color.red(r.message) },
      () => openRemoveSubscribeMenu(player, onDone)
    );
  });
}

function registerSpawnEggGroupWatch(player: Player, onDone: () => void): void {
  const r = addSubscription(player, SPAWN_EGG_GROUP_TOKEN);
  openDialogForm(
    player,
    { title: r.ok ? "已登记" : "未登记", desc: r.ok ? color.green(r.message) : color.red(r.message) },
    onDone
  );
}

function openClearConfirm(player: Player, onDone: () => void): void {
  const list = listSubscriptions(player);
  if (list.length === 0) {
    openDialogForm(player, { title: "提示", desc: color.yellow("列表本来就是空的。") }, onDone);
    return;
  }

  openConfirmDialogForm(
    player,
    "§c清空整张登记列表？",
    color.yellow(
      `会去掉全部 ${list.length} 种物品的监控登记，以后拿到它们不会再自动记背包。§f（不会删掉已经发生过的行为日志。）`
    ),
    () => {
      clearSubscriptions(player);
      openDialogForm(player, { title: "完成", desc: color.green("已清空登记列表。") }, onDone);
    },
    onDone,
    { dangerConfirm: true }
  );
}

interface SnapshotFilter {
  playerName: string | undefined;
  timeRange: string;
  keyword: string | undefined;
}

async function openSnapshotResultPage(
  player: Player,
  filter: SnapshotFilter,
  currentPage: number,
  onBack: () => void
): Promise<void> {
  const queryResult = behaviorLog.query({
    playerName: filter.playerName,
    eventTypes: ["itemWatchSnapshot"],
    startTime: getSnapshotStartTime(filter.timeRange),
    keyword: filter.keyword,
    limit: SNAPSHOT_PAGE_SIZE,
    offset: currentPage * SNAPSHOT_PAGE_SIZE,
  });

  const total = queryResult.total;
  const totalPages = Math.max(1, Math.ceil(total / SNAPSHOT_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages - 1);

  const finalItems =
    safePage === currentPage
      ? queryResult.items
      : behaviorLog.query({
          playerName: filter.playerName,
          eventTypes: ["itemWatchSnapshot"],
          startTime: getSnapshotStartTime(filter.timeRange),
          keyword: filter.keyword,
          limit: SNAPSHOT_PAGE_SIZE,
          offset: safePage * SNAPSHOT_PAGE_SIZE,
        }).items;

  const isFirstPage = safePage === 0;
  const isLastPage = safePage >= totalPages - 1;

  const playerDesc = filter.playerName ?? "全部玩家";
  const timeDesc = snapshotTimeRangeOptions.find((o) => o.value === filter.timeRange)?.label ?? "全部时间";
  const keywordDesc = filter.keyword ? ` · 关键词：${filter.keyword}` : "";
  const bodyLines = [
    `${color.yellow(playerDesc)} ${color.darkGray("·")} ${color.white(timeDesc)}${keywordDesc}`,
    `${color.darkGray(`第 ${safePage + 1} / ${totalPages} 页 · 共 ${total} 条存档`)}`,
    "",
    total === 0
      ? color.gray("当前筛选条件下没有背包存档记录。")
      : color.gray("点击下方某条记录，以箱子界面查看当时的背包。"),
  ].join("\n");

  const form = new ActionFormData().title("§w背包存档记录").body(bodyLines);

  for (const entry of finalItems) {
    const shortTs = formatBehaviorTimestamp(entry.t).slice(5);
    const sid = parseItemWatchSnapshotId(entry.m);
    const snap = sid ? itemWatchSnapshotStore.get(sid) : undefined;
    const locKey = resolveItemLocalizationKey(entry.v ?? "", snap?.acquiredLocalizationKey);
    form.button(snapshotArchiveRowLabel(entry.p, shortTs, entry.v, locKey), "textures/icons/quest_chest");
  }

  // 导航按钮不传 iconPath：客户端会把路径当按钮下方辅助小字，浅灰在白色底上几乎看不清
  if (!isFirstPage) {
    form.button("§0§l« §r§w上一页");
  }
  if (!isLastPage) {
    form.button("§w下一页 §0§l»");
  }
  form.button("§w重新筛选");
  form.button("§w返回");

  const navOffset = finalItems.length;
  let prevBtn = -1;
  let nextBtn = -1;
  let reFilterBtn: number;
  let backBtn: number;

  if (!isFirstPage && !isLastPage) {
    prevBtn = navOffset;
    nextBtn = navOffset + 1;
    reFilterBtn = navOffset + 2;
    backBtn = navOffset + 3;
  } else if (!isFirstPage) {
    prevBtn = navOffset;
    reFilterBtn = navOffset + 1;
    backBtn = navOffset + 2;
  } else if (!isLastPage) {
    nextBtn = navOffset;
    reFilterBtn = navOffset + 1;
    backBtn = navOffset + 2;
  } else {
    reFilterBtn = navOffset;
    backBtn = navOffset + 1;
  }

  const result = await showItemWatchForm(form, player);
  if (result.canceled || typeof result.selection !== "number") {
    onBack();
    return;
  }

  const sel = result.selection;

  if (sel === backBtn) {
    onBack();
    return;
  }
  if (sel === reFilterBtn) {
    delayNav(() => void openSnapshotFilterForm(player, onBack));
    return;
  }
  if (sel === prevBtn) {
    delayNav(() => void openSnapshotResultPage(player, filter, safePage - 1, onBack));
    return;
  }
  if (sel === nextBtn) {
    delayNav(() => void openSnapshotResultPage(player, filter, safePage + 1, onBack));
    return;
  }

  const entry = finalItems[sel];
  if (!entry) {
    delayNav(() => void openSnapshotResultPage(player, filter, safePage, onBack));
    return;
  }

  const sid = parseItemWatchSnapshotId(entry.m);
  if (!sid) {
    player.sendMessage("§c该条记录的存档编号缺失，可能已过期。");
    delayNav(() => void openSnapshotResultPage(player, filter, safePage, onBack));
    return;
  }

  const payload = itemWatchSnapshotStore.get(sid);
  if (!payload) {
    player.sendMessage("§c这条背包存档已过期或被系统清理。");
    delayNav(() => void openSnapshotResultPage(player, filter, safePage, onBack));
    return;
  }

  void openItemWatchSnapshotChestForm(player, payload, () => {
    delayNav(() => void openSnapshotResultPage(player, filter, safePage, onBack));
  });
}

async function openSnapshotFilterForm(player: Player, onBack: () => void): Promise<void> {
  const knownPlayers = behaviorLog.getKnownPlayers();
  const playerLabels = ["全部玩家", ...knownPlayers];
  const timeLabels = snapshotTimeRangeOptions.map((o) => o.label);

  const form = new ModalFormData()
    .title("§w背包存档筛选")
    .label("选择筛选条件后点击确认，以列表方式浏览背包存档记录；点击某条记录可打开箱子界面查看当时背包。")
    .dropdown("目标玩家", playerLabels, { defaultValueIndex: 0 })
    .textField("玩家名（可选，直接输入覆盖上方选择）", "留空则使用上方选择", { defaultValue: "" })
    .dropdown("时间范围", timeLabels, { defaultValueIndex: 2 })
    .textField("物品关键词（可选）", "如 tnt、diamond，留空查全部", { defaultValue: "" });
  form.submitButton("查看存档");

  const result = await showItemWatchForm(form, player);
  if (result.canceled) {
    onBack();
    return;
  }

  const fv = result.formValues;
  if (!fv || fv.length < 4) {
    onBack();
    return;
  }

  // API 有时把 .label() 作为 fv[0]，通过类型判断区分两种偏移
  let playerIndex: number;
  let playerNameInput: string;
  let timeRangeIndex: number;
  let keyword: string;

  const a = fv[0],
    b = fv[1],
    c = fv[2],
    d = fv[3];
  if (typeof a === "number" && typeof b === "string" && typeof c === "number" && typeof d === "string") {
    playerIndex = a;
    playerNameInput = b.trim();
    timeRangeIndex = c;
    keyword = d.trim();
  } else if (typeof b === "number" && typeof c === "string" && typeof d === "number" && typeof fv[4] === "string") {
    playerIndex = b;
    playerNameInput = c.trim();
    timeRangeIndex = d;
    keyword = String(fv[4] ?? "").trim();
  } else {
    onBack();
    return;
  }

  const playerName = playerNameInput || (playerIndex <= 0 ? undefined : (knownPlayers[playerIndex - 1] ?? undefined));
  const timeRange = snapshotTimeRangeOptions[timeRangeIndex]?.value ?? "all";

  const filter: SnapshotFilter = {
    playerName: playerName || undefined,
    timeRange,
    keyword: keyword || undefined,
  };

  delayNav(() => void openSnapshotResultPage(player, filter, 0, onBack));
}

/** 行为日志管理 → 玩家获得物品监控 */
export function openItemWatchSubscribeForm(player: Player, onBack: () => void): void {
  const reopenMain = () => openItemWatchSubscribeForm(player, onBack);

  const form = new ActionFormData();
  form.title("§w玩家获得物品监控\n§3自动记下当时背包里有什么");
  form.body(`${BODY_HINT}\n§f§l当前已登记的物品类型：§r\n${formatListLines(player)}`);

  form.button("§w新增一种物品监控", "textures/icons/add");
  form.button("§w取消对某一种物品的监控", "textures/icons/requeue");
  form.button("§3清空全部物品监控", "textures/icons/deny");
  form.button("§e登记全部生成蛋\n§8任意 …_spawn_egg 的物品", "textures/items/spawn_egg");
  form.button("§b查看背包存档记录", "textures/icons/quest_chest");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason || typeof data.selection !== "number") {
      onBack();
      return;
    }
    switch (data.selection) {
      case 0:
        openAddSubscribeModal(player, reopenMain);
        break;
      case 1:
        openRemoveSubscribeMenu(player, reopenMain);
        break;
      case 2:
        openClearConfirm(player, reopenMain);
        break;
      case 3:
        registerSpawnEggGroupWatch(player, reopenMain);
        break;
      case 4:
        void openSnapshotFilterForm(player, reopenMain);
        break;
      case 5:
        onBack();
        break;
      default:
        onBack();
    }
  });
}
