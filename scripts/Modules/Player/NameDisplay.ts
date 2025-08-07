import { Player, system, world } from "@minecraft/server";
import PlayerSetting from "./PlayerSetting";

export class NameDisplay {
  private static instance: NameDisplay;
  private updateInterval: number = 20; // 更新间隔（ticks）

  private constructor() {
    this.init();
  }

  static getInstance(): NameDisplay {
    if (!NameDisplay.instance) {
      NameDisplay.instance = new NameDisplay();
    }
    return NameDisplay.instance;
  }

  private init(): void {
    // 定期更新所有玩家的名字显示
    system.runInterval(() => {
      this.updateAllPlayersNameDisplay();
    }, this.updateInterval);

    // 监听玩家加入事件
    world.afterEvents.playerSpawn.subscribe((event: any) => {
      this.updatePlayerNameDisplay(event.player);
    });
  }

  /**
   * 更新所有玩家的名字显示
   */
  private updateAllPlayersNameDisplay(): void {
    const players = world.getAllPlayers();
    players.forEach((player: Player) => {
      this.updatePlayerNameDisplay(player);
    });
  }

  /**
   * 更新单个玩家的名字显示
   */
  public updatePlayerNameDisplay(player: Player): void {
    try {
      const displayName = PlayerSetting.getPlayerDisplayName(player);
      player.nameTag = displayName;
    } catch (error) {
      // console.warn(`更新玩家 ${player.name} 的名字显示时发生错误:`, error);
    }
  }

  /**
   * 立即更新指定玩家的名字显示
   */
  public forceUpdatePlayerNameDisplay(player: Player): void {
    system.run(() => {
      this.updatePlayerNameDisplay(player);
    });
  }

  /**
   * 获取玩家的完整显示名称（用于聊天等场景）
   */
  public getPlayerFullDisplayName(player: Player): string {
    return PlayerSetting.getPlayerDisplayName(player);
  }

  /**
   * 重置玩家的名字显示为默认
   */
  public resetPlayerNameDisplay(player: Player): void {
    try {
      player.nameTag = player.name;
    } catch (error) {
      // console.warn(`重置玩家 ${player.name} 的名字显示时发生错误:`, error);
    }
  }

  /**
   * 设置更新间隔
   */
  public setUpdateInterval(ticks: number): void {
    this.updateInterval = Math.max(1, ticks);
  }
}

// 创建全局实例
const nameDisplay = NameDisplay.getInstance();
export default nameDisplay;
