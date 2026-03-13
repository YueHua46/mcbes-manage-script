import { Player, system } from "@minecraft/server";
import { CustomForm, MessageBox, Observable } from "@minecraft/server-ui";
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
import {
  dduiGap,
  dduiLead,
  dduiSection,
  isMessageBoxTopButton,
} from "../../components";

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

async function showForm(form: any, player: Player, failMessage: string): Promise<boolean> {
  for (let attempt = 0; attempt < FORM_OPEN_MAX_ATTEMPTS; attempt++) {
    try {
      const shown = await form.show();
      if (shown !== false) {
        return true;
      }

      if (attempt < FORM_OPEN_MAX_ATTEMPTS - 1) {
        await system.waitTicks(FORM_OPEN_RETRY_TICKS);
        continue;
      }
    } catch (error) {
      console.warn(failMessage, error);
      player.sendMessage("§c行为日志界面打开失败，请稍后再试。");
      return false;
    }
  }

  player.sendMessage("§e请先关闭当前打开的界面后，再重新打开行为日志。");
  return false;
}

function navigateTo(currentForm: any, nextAction: () => void): void {
  currentForm.close();
  runAfterDelay(nextAction);
}

async function showMessageBox(box: any, player: Player, failMessage: string): Promise<any | null> {
  try {
    return await box.show();
  } catch (error) {
    console.warn(failMessage, error);
    player.sendMessage("§c行为日志界面打开失败，请稍后再试。");
    return null;
  }
}

export async function openBehaviorLogForm(player: Player): Promise<void> {
  if (!isAdmin(player)) {
    player.sendMessage("§c只有管理员可以查看行为日志。");
    return;
  }

  const stats = behaviorLog.getStats();
  const summary = Observable.create<string>(
    `当前共 ${stats.totalCount}/${stats.maxEntries} 条日志，其中事件日志 ${stats.entryCount} 条，坐标日志 ${stats.locationCount} 条。`
  );
  let dashboard: any;

  dashboard = CustomForm.create(player, "行为日志管理")
    .closeButton();

  dduiLead(dashboard, "这里可以查看筛选日志，也可以管理哪些事件需要被监控。");
  dashboard.label(summary);
  dduiSection(dashboard, "操作");
  dashboard.button("查看日志", () => {
    navigateTo(dashboard, () => {
      void openBehaviorLogQueryForm(player);
    });
  });
  dduiGap(dashboard);
  dashboard.button("监控设置", () => {
    navigateTo(dashboard, () => {
      void openBehaviorLogSettingsForm(player);
    });
  });
  dduiSection(dashboard, "状态");
  dashboard.label(`最近打开时间：${formatBehaviorTimestamp(Date.now())}`);

  await showForm(dashboard, player, "打开行为日志首页失败:");
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
  const button1Text = isFirstPage ? "返回筛选" : "上一页";
  const button2Text = isLastPage ? "重新筛选" : "下一页";

  const box = MessageBox.create(player, "日志结果")
    .body(body)
    .button1(button1Text)
    .button2(button2Text, session.pageText);

  const result = await showMessageBox(box, player, "打开行为日志结果页失败:");
  if (!result || typeof result.selection !== "number") {
    return;
  }

  if (isMessageBoxTopButton(result)) {
    if (isFirstPage) {
      runAfterDelay(() => {
        void openBehaviorLogQueryForm(player);
      });
      return;
    }

    runAfterDelay(() => {
      void openBehaviorLogResultBox(player, executeBehaviorLogQuery(session.filter, session.currentPage - 1));
    });
    return;
  }

  if (!isLastPage) {
    runAfterDelay(() => {
      void openBehaviorLogResultBox(player, executeBehaviorLogQuery(session.filter, session.currentPage + 1));
    });
    return;
  }

  runAfterDelay(() => {
    void openBehaviorLogQueryForm(player);
  });
}

async function openBehaviorLogQueryForm(player: Player): Promise<void> {
  const knownPlayers = behaviorLog.getKnownPlayers();
  const playerItems = [
    { label: "全部玩家", value: 0 },
    ...knownPlayers.map((name, index) => ({
      label: name,
      value: index + 1,
    })),
  ];

  const playerValue = Observable.create<number>(0, { clientWritable: true });
  const playerNameValue = Observable.create<string>("", { clientWritable: true });
  const timeRangeValue = Observable.create<number>(2, { clientWritable: true });
  const keywordValue = Observable.create<string>("", { clientWritable: true });
  const landOnlyValue = Observable.create<boolean>(false, { clientWritable: true });
  const dangerousOnlyValue = Observable.create<boolean>(false, { clientWritable: true });
  const selectedCountValue = Observable.create<string>("当前未限定事件类型，将显示全部事件。");

  const eventToggles = behaviorEventDefinitions.reduce(
    (map, definition) => {
      map[definition.type] = Observable.create<boolean>(false, { clientWritable: true });
      return map;
    },
    {} as Record<BehaviorEventType, any>
  );

  const updateSelectedCount = () => {
    const selectedCount = behaviorEventDefinitions.filter((definition) => eventToggles[definition.type].getData()).length;
    selectedCountValue.setData(
      selectedCount > 0
        ? `已限定 ${selectedCount} 个事件类型。`
        : "当前未限定事件类型，将显示全部事件。"
    );
  };

  behaviorEventDefinitions.forEach((definition) => {
    eventToggles[definition.type].subscribe(() => updateSelectedCount());
  });

  let form: any;

  const getSelectedPlayerName = (): string => {
    const name = playerNameValue.getData().trim();
    if (name) return name;

    const selectedIndex = playerValue.getData();
    if (selectedIndex <= 0) return ALL_PLAYERS_VALUE;
    return knownPlayers[selectedIndex - 1] ?? ALL_PLAYERS_VALUE;
  };

  const getSelectedTimeRange = (): string => {
    switch (timeRangeValue.getData()) {
      case 0:
        return "1h";
      case 1:
        return "6h";
      case 2:
        return "24h";
      case 3:
        return "3d";
      case 4:
        return "7d";
      default:
        return ALL_TIME_VALUE;
    }
  };

  const getSelectedEventTypes = (): BehaviorEventType[] => {
    return behaviorEventDefinitions
      .filter((definition) => eventToggles[definition.type].getData())
      .map((definition) => definition.type);
  };

  const resetFilters = () => {
    playerValue.setData(0);
    playerNameValue.setData("");
    timeRangeValue.setData(2);
    keywordValue.setData("");
    landOnlyValue.setData(false);
    dangerousOnlyValue.setData(false);
    behaviorEventDefinitions.forEach((definition) => {
      eventToggles[definition.type].setData(false);
    });
    updateSelectedCount();
  };

  form = CustomForm.create(player, "行为日志查询")
    .closeButton();

  dduiLead(form, "支持按玩家、时间、关键词、领地相关和危险行为进行筛选。");
  dduiSection(form, "筛选条件");
  form.dropdown("目标玩家（下拉选择）", playerValue, playerItems, {
    description: "从已有日志记录的玩家中快速选择，或选「全部玩家」。",
  });
  dduiGap(form);
  form.textField("玩家名（可选，直接输入）", playerNameValue, {
    description: "留空则使用上方选择；输入玩家名时优先按输入筛选，支持任意玩家（含离线）。",
  });
  dduiGap(form);
  form.dropdown("时间范围", timeRangeValue, timeRangeOptions, {
    description: "默认展示最近 24 小时。",
  });
  dduiGap(form);
  form.textField("关键词（可选）", keywordValue, {
    description: "可匹配聊天、对象类型、领地名或附加信息。",
  });
  dduiGap(form);
  form.toggle("仅看领地相关", landOnlyValue);
  dduiGap(form);
  form.toggle("仅看高危行为", dangerousOnlyValue);
  dduiGap(form);
  form.label(selectedCountValue);
  dduiSection(form, "事件类型筛选");
  form.label("不勾选表示全部事件。");
  dduiGap(form);

  let lastGroup = "";
  for (const definition of behaviorEventDefinitions) {
    if (definition.group !== lastGroup) {
      lastGroup = definition.group;
      dduiSection(form, groupLabels[definition.group]);
    }
    form.toggle(definition.label, eventToggles[definition.type]);
    dduiGap(form);
  }

  dduiSection(form, "操作");
  form.button("应用筛选", () => {
    const filterState: BehaviorLogFilterState = {
      playerName: getSelectedPlayerName() === ALL_PLAYERS_VALUE ? undefined : getSelectedPlayerName(),
      timeRange: getSelectedTimeRange(),
      selectedTypes: getSelectedEventTypes(),
      keyword: keywordValue.getData().trim() || undefined,
      landOnly: landOnlyValue.getData(),
      dangerousOnly: dangerousOnlyValue.getData(),
    };
    navigateTo(form, () => {
      void openBehaviorLogResultBox(player, executeBehaviorLogQuery(filterState, 0));
    });
  });
  dduiGap(form);
  form.button("重置筛选", () => {
    resetFilters();
  });
  dduiGap(form);
  form.button("返回首页", () => {
    navigateTo(form, () => {
      void openBehaviorLogForm(player);
    });
  });
  dduiSection(form, "说明");
  form.label("点击“应用筛选”后，将通过 MessageBox 单独展示当前筛选结果，并直接显示每条日志的完整关键信息。");
  dduiGap(form);
  form.label(`当前时间：${formatBehaviorTimestamp(Date.now())}`);

  updateSelectedCount();
  await showForm(form, player, "打开行为日志查询页失败:");
}

async function openBehaviorLogSettingsForm(player: Player): Promise<void> {
  const enabledValue = Observable.create<boolean>(setting.getState("behaviorLogEnabled" as never) as boolean, {
    clientWritable: true,
  });
  const maxEntriesValue = Observable.create<string>(String(setting.getState("behaviorLogMaxEntries" as never)), {
    clientWritable: true,
  });
  const locationIntervalValue = Observable.create<string>(
    String(setting.getState("behaviorLogLocationIntervalSec" as never)),
    {
      clientWritable: true,
    }
  );
  const statusValue = Observable.create<string>("修改后点击“保存设置”生效。");

  const toggleValues = behaviorEventDefinitions.reduce(
    (map, definition) => {
      map[definition.type] = Observable.create<boolean>(setting.getState(definition.settingKey as never) as boolean, {
        clientWritable: true,
      });
      return map;
    },
    {} as Record<BehaviorEventType, any>
  );

  const applySettings = (): boolean => {
    const maxEntries = Number(maxEntriesValue.getData().trim());
    const locationInterval = Number(locationIntervalValue.getData().trim());

    if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
      statusValue.setData("行为日志最大保留条数必须是大于 0 的数字。");
      return false;
    }

    if (!Number.isFinite(locationInterval) || locationInterval <= 0) {
      statusValue.setData("坐标采样间隔必须是大于 0 的数字。");
      return false;
    }

    setting.setState("behaviorLogEnabled" as never, enabledValue.getData());
    setting.setState("behaviorLogMaxEntries" as never, String(Math.floor(maxEntries)));
    setting.setState("behaviorLogLocationIntervalSec" as never, String(Math.floor(locationInterval)));

    for (const definition of behaviorEventDefinitions) {
      setting.setState(definition.settingKey as never, toggleValues[definition.type].getData());
    }

    statusValue.setData(`已保存：${formatBehaviorTimestamp(Date.now())}`);
    return true;
  };

  let form: any;
  form = CustomForm.create(player, "行为日志监控设置")
    .closeButton();

  dduiLead(
    form,
    "关闭某项后，该事件将不再写入日志。最大保留条数按全服总日志计算，包含所有玩家、所有事件类型和坐标记录。当达到最大上限时，会从最旧的日志开始删除，以免超过限制。"
  );
  dduiSection(form, "基础设置");
  form.toggle("启用行为日志系统", enabledValue);
  dduiGap(form);
  form.textField("行为日志最大保留条数", maxEntriesValue, {
    description:
      "这是全服总日志上限。例如填 20000，表示所有玩家的聊天、领地行为、危险行为、坐标记录等合计最多保留最近 20000 条。当达到最大上限时，会从最旧的日志开始删除，以免超过限制。",
  });
  dduiGap(form);
  form.textField("坐标采样间隔（秒）", locationIntervalValue, {
    description: "这是对所有在线玩家进行一次坐标记录的时间间隔。比如填 60，表示每 60 秒给所有在线玩家各记录一条坐标日志。",
  });
  dduiGap(form);

  let lastGroup = "";
  for (const definition of behaviorEventDefinitions) {
    if (definition.group !== lastGroup) {
      lastGroup = definition.group;
      dduiSection(form, groupLabels[definition.group]);
    }
    form.toggle(definition.label, toggleValues[definition.type]);
    dduiGap(form);
  }

  dduiSection(form, "状态");
  form.label(statusValue);
  dduiSection(form, "操作");
  form.button("保存设置", () => {
    applySettings();
  });
  dduiGap(form);
  form.button("保存并返回", () => {
    if (!applySettings()) return;
    navigateTo(form, () => {
      void openBehaviorLogForm(player);
    });
  });
  dduiGap(form);
  form.button("返回首页", () => {
    navigateTo(form, () => {
      void openBehaviorLogForm(player);
    });
  });

  await showForm(form, player, "打开行为日志设置页失败:");
}
