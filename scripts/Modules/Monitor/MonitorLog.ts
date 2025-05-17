import { Player, system, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Database } from "../Database";
import { openServerMenuForm } from "../Forms/Forms";
import { openDialogForm } from "../Forms/Dialog";
import { color } from "../../utils/color";

// 定义监控事件类型
export interface MonitorEvents {
  tntIgnite: boolean; // 监控TNT点燃
  flintAndSteelUse: boolean; // 监控打火石点燃
  lavaUse: boolean; // 监控使用岩浆桶
  attackNeutralMobs: boolean; // 监控领地内攻击部分中立生物
  openChest: boolean; // 监控开箱子
  summonWither: boolean; // 监控召唤凋零（只监控凋零召唤出的一瞬间内100格的玩家）
  armorStandInteract: boolean; // 监控与盔甲架的交互（偷盔甲架装备）
  placeSoulSand: boolean; // 监控放置灵魂沙
}

// 定义监控服务端配置
export interface ServerConfig {
  ip: string;
  port: number;
}

// 监控日志管理类
class MonitorLog {
  private db!: Database<boolean | MonitorEvents | ServerConfig>;

  constructor() {
    system.run(() => {
      this.db = new Database<boolean | MonitorEvents | ServerConfig>("monitor_log");
      this.init();
    });
  }

  // 初始化默认设置
  private init() {
    if (!this.db.has("enabled")) {
      this.db.set("enabled", false);
    }

    if (!this.db.has("events")) {
      this.db.set("events", {
        tntIgnite: true,
        flintAndSteelUse: true,
        lavaUse: true,
        placeSoulSand: true,
        attackNeutralMobs: true,
        openChest: true,
        summonWither: true,
        armorStandInteract: true,
      });
    }

    // 服务端配置
    if (!this.db.has("server_config")) {
      this.db.set("server_config", {
        ip: "127.0.0.1",
        port: 3000,
      });
    }
  }

  // 获取监控功能开关状态
  public isEnabled(): boolean {
    return this.db.get("enabled") as boolean;
  }

  // 设置监控功能开关状态
  public setEnabled(enabled: boolean): void {
    this.db.set("enabled", enabled);
  }

  // 获取所有监控事件设置
  public getEvents(): MonitorEvents {
    return this.db.get("events") as MonitorEvents;
  }

  // 更新监控事件设置
  public updateEvents(events: Partial<MonitorEvents>): void {
    const currentEvents = this.getEvents();
    this.db.set("events", { ...currentEvents, ...events });
  }

  // 打开监控日志主菜单
  public openMonitorLogMenu(player: Player): void {
    const form = new ActionFormData();
    form.title("§w监控日志功能");
    form.button("§w监控事件管理", "textures/ui/settings_glyph_color");
    form.button("§w监控服务端配置", "textures/ui/settings_glyph_color");
    form.button("§w监控功能开关", "textures/ui/toggle_on");
    form.button("§w返回", "textures/icons/back");

    form.show(player).then((response) => {
      if (response.canceled) return;

      switch (response.selection) {
        case 0:
          this.openMonitorEventsForm(player);
          break;
        case 1:
          this.openMonitorServerConfigForm(player);
          break;
        case 2:
          this.openMonitorToggleForm(player);
          break;
        case 3:
          openServerMenuForm(player);
          break;
      }
    });
  }

  // 打开监控事件管理表单
  private openMonitorEventsForm(player: Player): void {
    const events = this.getEvents();
    const form = new ModalFormData();

    form.title("§w监控事件管理");
    form.toggle("§w监控TNT点燃", {
      defaultValue: events.tntIgnite,
    });
    form.toggle("§w监控打火石点燃", {
      defaultValue: events.flintAndSteelUse,
    });
    form.toggle("§w监控使用岩浆桶", {
      defaultValue: events.lavaUse,
    });
    form.toggle("§w监控领地内攻击部分中立生物（包括村民、狼、猫等。。。）", {
      defaultValue: events.attackNeutralMobs,
    });
    form.toggle("§w监控开箱子", {
      defaultValue: events.openChest,
    });
    form.toggle("§w监控召唤凋零", {
      defaultValue: events.summonWither,
    });
    form.toggle("§w监控与盔甲架的交互（偷盔甲架装备）", {
      defaultValue: events.armorStandInteract,
    });
    form.submitButton("§w确认");

    form.show(player).then((response) => {
      if (response.canceled) {
        return;
      }

      const { formValues } = response;
      if (formValues) {
        this.updateEvents({
          tntIgnite: formValues[0] as boolean,
          flintAndSteelUse: formValues[1] as boolean,
          lavaUse: formValues[2] as boolean,
          attackNeutralMobs: formValues[3] as boolean,
          openChest: formValues[4] as boolean,
          summonWither: formValues[5] as boolean,
          armorStandInteract: formValues[6] as boolean,
        });

        openDialogForm(
          player,
          {
            title: "设置成功",
            desc: color.green("监控事件设置已更新！"),
          },
          () => this.openMonitorLogMenu(player)
        );
      }
    });
  }

  // 打开监控功能开关表单
  private openMonitorToggleForm(player: Player): void {
    const enabled = this.isEnabled();
    const form = new ModalFormData();

    form.title("§w监控功能开关");
    form.toggle("§w监控功能开关", {
      defaultValue: enabled,
    });
    form.submitButton("§w确认");

    form.show(player).then((response) => {
      if (response.canceled) {
        return;
      }

      const { formValues } = response;
      if (formValues) {
        this.setEnabled(formValues[0] as boolean);

        openDialogForm(
          player,
          {
            title: "设置成功",
            desc: color.green(`监控功能已${formValues[0] ? "开启" : "关闭"}！`),
          },
          () => this.openMonitorLogMenu(player)
        );
      }
    });
  }

  // 打开监控服务端配置表单
  private openMonitorServerConfigForm(player: Player): void {
    const form = new ModalFormData();
    form.title("§w监控服务端配置");
    form.textField("§w服务端IP（默认为 127.0.0.1 本地）", "请输入监控服务端IP", {
      defaultValue: (this.db.get("server_config") as ServerConfig).ip as string,
    });
    form.textField("§w服务端端口（默认为 3000，必须改为你VPS服务端给你提供的可用端口）", "请输入监控服务端端口", {
      defaultValue: (this.db.get("server_config") as ServerConfig).port.toString(),
    });
    form.submitButton("§w确认");

    form.show(player).then((response) => {
      if (response.canceled) {
        return;
      }
      const { formValues } = response;
      if (formValues) {
        this.db.set("server_config", {
          ip: formValues[0] as string,
          port: parseInt(formValues[1] as string),
        });

        openDialogForm(player, {
          title: "设置成功",
          desc: color.green("监控服务端配置已更新！"),
        });
      } else {
        openDialogForm(player, {
          title: "设置失败",
          desc: color.red("监控服务端配置更新失败！表单配置错误"),
        });
      }
    });
  }
}

export default new MonitorLog();
