import { Player, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import setting from "../../../features/system/services/setting";
import behaviorLog, {
  BehaviorEventType,
  BehaviorLogEntry,
  behaviorEventDefinitions,
  formatBehaviorMessageBoxPage,
  formatBehaviorTimestamp,
  getBehaviorEventLabel,
} from "../../../features/behavior-log/services/behavior-log";
import { isAdmin } from "../../../shared/utils/common";
import { openDialogForm } from "../../components/dialog";
import { openItemWatchSubscribeForm } from "../item-watch";

const ALL_PLAYERS_VALUE = "__all_players__";
const ALL_TIME_VALUE = "all";
const PAGE_SIZE = 30;
const FORM_OPEN_MAX_ATTEMPTS = 8;
const FORM_OPEN_RETRY_TICKS = 2;
const FORM_NAVIGATION_DELAY_TICKS = 2;

const timeRangeOptions = [
  { label: "最近 1 小时", value: 0 },
  { label: "最近 6 小时", value: 1 },
  { label: "最近 24 小时", value: 2 },
  { label: "最近 3 天", value: 3 },
  { label: "最近 7 天", value: 4 },
  { label: "全部时间", value: 5 },
];

const groupLabels = {
  basic: "基础行为",
  combat: "战斗行为",
  dangerous: "高危行为",
  land: "领地行为",
  container: "容器行为",
  location: "坐标采样",
  item: "物品订阅",
} as const;

interface BehaviorLogFilterState {
  playerName?: string;
  timeRange: string;
  selectedTypes: BehaviorEventType[];
  keyword?: string;
  landOnly: boolean;
  dangerousOnly: boolean;
}

interface BehaviorLogQuerySession {
  filter: BehaviorLogFilterState;
  currentPage: number;
  total: number;
  totalPages: number;
  items: BehaviorLogEntry[];
  summaryText: string;
  pageText: string;
}

function getStartTimeFromRange(value: string): number | undefined {
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

function timeRangeLabel(value: string): string {
  switch (value) {
    case "1h":
      return "最近 1 小时";
    case "6h":
      return "最近 6 小时";
    case "24h":
      return "最近 24 小时";
    case "3d":
      return "最近 3 天";
    case "7d":
      return "最近 7 天";
    default:
      return "全部时间";
  }
}

function buildFilterDescription(
  playerName: string,
  timeRange: string,
  selectedTypes: BehaviorEventType[],
  keyword: string,
  landOnly: boolean,
  dangerousOnly: boolean
): string {
  const playerText = playerName === ALL_PLAYERS_VALUE ? "全部玩家" : playerName;
  const timeText = timeRangeLabel(timeRange);
  const eventText =
    selectedTypes.length > 0 ? selectedTypes.map((type) => getBehaviorEventLabel(type)).join("、") : "全部事件";
  const keywordText = keyword ? `，关键词：${keyword}` : "";
  const landText = landOnly ? "，仅领地相关" : "";
  const dangerousText = dangerousOnly ? "，仅危险行为" : "";
  return `筛选条件：${playerText} / ${timeText} / ${eventText}${keywordText}${landText}${dangerousText}`;
}

function runAfterDelay(nextAction: () => void): void {
  system.runTimeout(() => {
    nextAction();
  }, FORM_NAVIGATION_DELAY_TICKS);
}

type TraditionalFormData = ActionFormData | ModalFormData;

async function showForm(
  form: TraditionalFormData,
  player: Player,
  failMessage: string
): Promise<{ canceled: boolean; selection?: number; formValues?: (string | number | boolean)[] }> {
  for (let attempt = 0; attempt < FORM_OPEN_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await form.show(player);
      const canceled = response.canceled ?? !!response.cancelationReason;
      if (canceled && response.cancelationReason === "UserBusy" && attempt < FORM_OPEN_MAX_ATTEMPTS - 1) {
        await system.waitTicks(FORM_OPEN_RETRY_TICKS);
        continue;
      }
      if (canceled) {
        return { canceled: true };
      }
      const actionResponse = response as { selection?: number; formValues?: (string | number | boolean)[] };
      return {
        canceled: false,
        selection: actionResponse.selection,
        formValues: actionResponse.formValues,
      };
    } catch (error) {
      console.warn(failMessage, error);
      player.sendMessage("§c行为日志界面打开失败，请稍后再试。");
      return { canceled: true };
    }
  }
  player.sendMessage("§e请先关闭当前打开的界面后，再重新打开行为日志。");
  return { canceled: true };
}

export async function openBehaviorLogForm(player: Player): Promise<void> {
  if (!isAdmin(player)) {
    player.sendMessage("§c只有管理员可以查看行为日志。");
    return;
  }

  const stats = behaviorLog.getStats();
  const bodyLines = [
    "这里可以查看筛选日志，也可以管理哪些事件需要被监控。",
    "",
    `当前共 ${stats.totalCount}/${stats.maxEntries} 条日志，其中事件日志 ${stats.entryCount} 条，坐标日志 ${stats.locationCount} 条。`,
    "",
    `最近打开时间：${formatBehaviorTimestamp(Date.now())}`,
  ];
  const form = new ActionFormData()
    .title("行为日志管理")
    .body(bodyLines.join("\n"))
    .button("查看日志")
    .button("监控设置")
    .button(
      {
        text: "§w玩家获得物品监控\n§3自动记下当时背包里有什么",
      },
      "textures/blocks/chest_front"
    );

  const result = await showForm(form, player, "打开行为日志首页失败:");
  if (result.canceled) return;
  if (result.selection === 0) {
    runAfterDelay(() => void openBehaviorLogQueryForm(player));
    return;
  }
  if (result.selection === 1) {
    runAfterDelay(() => void openBehaviorLogSettingsForm(player));
    return;
  }
  if (result.selection === 2) {
    runAfterDelay(
      () =>
        void openItemWatchSubscribeForm(player, () => {
          runAfterDelay(() => void openBehaviorLogForm(player));
        })
    );
  }
}

function executeBehaviorLogQuery(filter: BehaviorLogFilterState, currentPage = 0): BehaviorLogQuerySession {
  const queryResult = behaviorLog.query({
    playerName: filter.playerName,
    eventTypes: filter.selectedTypes.length > 0 ? filter.selectedTypes : undefined,
    startTime: getStartTimeFromRange(filter.timeRange),
    keyword: filter.keyword,
    landOnly: filter.landOnly,
    dangerousOnly: filter.dangerousOnly,
    limit: PAGE_SIZE,
    offset: currentPage * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(queryResult.total / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages - 1);
  const finalResult =
    safePage === currentPage
      ? queryResult
      : behaviorLog.query({
          playerName: filter.playerName,
          eventTypes: filter.selectedTypes.length > 0 ? filter.selectedTypes : undefined,
          startTime: getStartTimeFromRange(filter.timeRange),
          keyword: filter.keyword,
          landOnly: filter.landOnly,
          dangerousOnly: filter.dangerousOnly,
          limit: PAGE_SIZE,
          offset: safePage * PAGE_SIZE,
        });

  return {
    filter,
    currentPage: safePage,
    total: finalResult.total,
    totalPages,
    items: finalResult.items,
    summaryText: buildFilterDescription(
      filter.playerName ?? ALL_PLAYERS_VALUE,
      filter.timeRange,
      filter.selectedTypes,
      filter.keyword ?? "",
      filter.landOnly,
      filter.dangerousOnly
    ),
    pageText: `第 ${safePage + 1} / ${totalPages} 页`,
  };
}

async function openBehaviorLogResultBox(player: Player, session: BehaviorLogQuerySession): Promise<void> {
  const body = formatBehaviorMessageBoxPage(
    session.summaryText,
    session.items,
    session.currentPage,
    session.totalPages,
    session.total
  );

  const isFirstPage = session.currentPage === 0;
  const isLastPage = session.currentPage >= session.totalPages - 1;

  const form = new ActionFormData().title("日志结果").body(body);

  if (isFirstPage) {
    form.button("返回筛选");
  } else {
    form.button("上一页");
  }
  if (!isLastPage) {
    form.button("下一页");
  } else {
    form.button("重新筛选");
  }

  const result = await showForm(form, player, "打开行为日志结果页失败:");
  if (result.canceled || typeof result.selection !== "number") {
    return;
  }

  const sel = result.selection;

  if (sel === 0) {
    if (isFirstPage) {
      runAfterDelay(() => void openBehaviorLogQueryForm(player));
    } else {
      runAfterDelay(() => {
        void openBehaviorLogResultBox(player, executeBehaviorLogQuery(session.filter, session.currentPage - 1));
      });
    }
    return;
  }

  if (sel === 1) {
    if (!isLastPage) {
      runAfterDelay(() => {
        void openBehaviorLogResultBox(player, executeBehaviorLogQuery(session.filter, session.currentPage + 1));
      });
    } else {
      runAfterDelay(() => void openBehaviorLogQueryForm(player));
    }
    return;
  }
}

async function openBehaviorLogQueryForm(player: Player): Promise<void> {
  const knownPlayers = behaviorLog.getKnownPlayers();
  const playerLabels = ["全部玩家", ...knownPlayers];
  const timeRangeLabels = timeRangeOptions.map((o) => o.label);

  const form = new ModalFormData()
    .title("行为日志查询")
    .label(
      "支持按玩家、时间、关键词、领地相关和危险行为进行筛选。提交后将通过单独页面展示结果。重新打开本表单即重置筛选。"
    )
    .dropdown("目标玩家（下拉选择）", playerLabels, { defaultValueIndex: 0 })
    .textField("玩家名（可选，直接输入）", "留空则使用上方选择", { defaultValue: "" })
    .dropdown("时间范围", timeRangeLabels, { defaultValueIndex: 2 })
    .textField("关键词（可选）", "可匹配聊天、对象类型、领地名或附加信息", { defaultValue: "" })
    .toggle("仅看领地相关", { defaultValue: false })
    .toggle("仅看高危行为", { defaultValue: false });

  for (const definition of behaviorEventDefinitions) {
    form.toggle(definition.label, { defaultValue: false });
  }

  form.submitButton("应用筛选");

  const result = await showForm(form, player, "打开行为日志查询页失败:");
  if (result.canceled) {
    runAfterDelay(() => void openBehaviorLogForm(player));
    return;
  }

  const formValues = result.formValues;
  const needLength = 6 + behaviorEventDefinitions.length;
  if (!formValues || formValues.length < needLength) {
    runAfterDelay(() => void openBehaviorLogForm(player));
    return;
  }

  // 若 .label() 占 formValues[0]，则实际为 [1]=玩家下拉 [2]=玩家名 [3]=时间下拉 [4]=关键词 [5][6]=toggle [7+]=事件
  // 通过类型判断：前四个应为 number, string, number, string（玩家索引、玩家名、时间索引、关键词）
  const a = formValues[0];
  const b = formValues[1];
  const c = formValues[2];
  const d = formValues[3];
  let playerIndex: number;
  let playerNameInput: string;
  let timeRangeIndex: number;
  let keyword: string;
  let landOnly: boolean;
  let dangerousOnly: boolean;
  let eventToggleStartIndex: number;

  if (typeof a === "number" && typeof b === "string" && typeof c === "number" && typeof d === "string") {
    playerIndex = a;
    playerNameInput = b.trim();
    timeRangeIndex = c;
    keyword = d.trim();
    landOnly = Boolean(formValues[4]);
    dangerousOnly = Boolean(formValues[5]);
    eventToggleStartIndex = 6;
  } else if (
    typeof b === "number" &&
    typeof c === "string" &&
    typeof d === "number" &&
    typeof formValues[4] === "string"
  ) {
    playerIndex = b;
    playerNameInput = c.trim();
    timeRangeIndex = d;
    keyword = String(formValues[4] ?? "").trim();
    landOnly = Boolean(formValues[5]);
    dangerousOnly = Boolean(formValues[6]);
    eventToggleStartIndex = 7;
  } else {
    runAfterDelay(() => void openBehaviorLogForm(player));
    return;
  }

  const playerName =
    playerNameInput || (playerIndex <= 0 ? ALL_PLAYERS_VALUE : (knownPlayers[playerIndex - 1] ?? ALL_PLAYERS_VALUE));
  const timeRange =
    timeRangeIndex === 0
      ? "1h"
      : timeRangeIndex === 1
        ? "6h"
        : timeRangeIndex === 2
          ? "24h"
          : timeRangeIndex === 3
            ? "3d"
            : timeRangeIndex === 4
              ? "7d"
              : ALL_TIME_VALUE;

  const selectedTypes: BehaviorEventType[] = [];
  for (let i = 0; i < behaviorEventDefinitions.length; i++) {
    if (formValues[eventToggleStartIndex + i]) {
      selectedTypes.push(behaviorEventDefinitions[i].type);
    }
  }

  const filterState: BehaviorLogFilterState = {
    playerName: playerName === ALL_PLAYERS_VALUE ? undefined : playerName,
    timeRange,
    selectedTypes,
    keyword: keyword || undefined,
    landOnly,
    dangerousOnly,
  };

  runAfterDelay(() => {
    void openBehaviorLogResultBox(player, executeBehaviorLogQuery(filterState, 0));
  });
}

async function openBehaviorLogSettingsForm(player: Player): Promise<void> {
  const enabled = setting.getState("behaviorLogEnabled" as never) as boolean;
  const maxEntries = String(setting.getState("behaviorLogMaxEntries" as never));
  const locationInterval = String(setting.getState("behaviorLogLocationIntervalSec" as never));

  const form = new ModalFormData()
    .title("行为日志监控设置")
    .label(
      "关闭某项后，该事件将不再写入日志。最大保留条数按全服总日志计算。达到上限时从最旧日志开始删除。提交即保存并返回首页。"
    )
    .toggle("启用行为日志系统", { defaultValue: enabled })
    .textField("行为日志最大保留条数", "全服总日志上限，例如 20000", { defaultValue: maxEntries })
    .textField("坐标采样间隔（秒）", "对所有在线玩家进行一次坐标记录的间隔", { defaultValue: locationInterval });

  for (const definition of behaviorEventDefinitions) {
    form.toggle(definition.label, {
      defaultValue: setting.getState(definition.settingKey as never) as boolean,
    });
  }

  form.submitButton("保存并返回");

  const result = await showForm(form, player, "打开行为日志设置页失败:");
  if (result.canceled) {
    runAfterDelay(() => void openBehaviorLogForm(player));
    return;
  }

  const formValues = result.formValues;
  // 表单顺序：.label() 可能占 formValues[0]（视 API 而定），然后 toggle、textField、textField、若干 toggle
  const minLength = 4 + behaviorEventDefinitions.length;
  if (!formValues || formValues.length < minLength) {
    runAfterDelay(() => void openBehaviorLogForm(player));
    return;
  }

  // 若 .label() 占一位：索引为 [1]=启用 toggle, [2]=最大条数, [3]=坐标间隔, [4+i]=事件 toggle
  // 若 .label() 不占位：索引为 [0]=启用, [1]=最大条数, [2]=坐标间隔, [3+i]=事件 toggle
  // 通过类型判断：前两位中一个是 boolean（启用），两个是 string（数字输入框）
  const a = formValues[0];
  const b = formValues[1];
  const c = formValues[2];
  const d = formValues[3];
  let enableToggle: boolean;
  let maxEntriesStr: string;
  let locationIntervalStr: string;
  let eventToggleStartIndex: number;

  if (typeof a === "boolean" && typeof b === "string" && typeof c === "string") {
    enableToggle = a;
    maxEntriesStr = b.trim() || maxEntries;
    locationIntervalStr = c.trim() || locationInterval;
    eventToggleStartIndex = 3;
  } else if (typeof b === "boolean" && typeof c === "string" && typeof d === "string") {
    enableToggle = b;
    maxEntriesStr = c.trim() || maxEntries;
    locationIntervalStr = d.trim() || locationInterval;
    eventToggleStartIndex = 4;
  } else {
    openDialogForm(player, { title: "保存失败", desc: "表单数据异常，请重试。" }, () => {
      void openBehaviorLogSettingsForm(player);
    });
    return;
  }

  const maxEntriesNum = Number(maxEntriesStr);
  const locationIntervalNum = Number(locationIntervalStr);

  if (!Number.isFinite(maxEntriesNum) || maxEntriesNum <= 0) {
    openDialogForm(player, { title: "保存失败", desc: "行为日志最大保留条数必须是大于 0 的数字。" }, () => {
      void openBehaviorLogSettingsForm(player);
    });
    return;
  }

  if (!Number.isFinite(locationIntervalNum) || locationIntervalNum <= 0) {
    openDialogForm(player, { title: "保存失败", desc: "坐标采样间隔必须是大于 0 的数字。" }, () => {
      void openBehaviorLogSettingsForm(player);
    });
    return;
  }

  setting.setState("behaviorLogEnabled" as never, enableToggle);
  setting.setState("behaviorLogMaxEntries" as never, String(Math.floor(maxEntriesNum)));
  setting.setState("behaviorLogLocationIntervalSec" as never, String(Math.floor(locationIntervalNum)));

  for (let i = 0; i < behaviorEventDefinitions.length; i++) {
    setting.setState(behaviorEventDefinitions[i].settingKey as never, Boolean(formValues[eventToggleStartIndex + i]));
  }

  runAfterDelay(() => void openBehaviorLogForm(player));
}
