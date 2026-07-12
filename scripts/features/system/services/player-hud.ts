import { system } from "@minecraft/server";
import { economic } from "../../economic";
import { getOnlineRealPlayers } from "../../../shared/utils/online-players";
import { getTPS } from "../../../shared/utils/tps";
import { glyphMap } from "../../../assets/glyph-map";

const HUD_MARKER = "[CMHUD]";
const HUD_REFRESH_TICKS = 40;

function formatGold(value: number): string {
  const amount = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 10_000) return `${(amount / 1_000).toFixed(1)}K`;
  return String(amount);
}

function getTpsColor(tps: number): string {
  if (tps >= 18) return "§a";
  if (tps >= 15) return "§e";
  return "§c";
}

system.runInterval(() => {
  const players = getOnlineRealPlayers();
  if (players.length === 0) return;
  const tps = Math.max(0, Math.min(20, getTPS()));
  const tpsText = tps.toFixed(1);

  for (const player of players) {
    try {
      const gold = economic.getWallet(player.name).gold;
      player.onScreenDisplay.setActionBar(
        `${HUD_MARKER}§r${glyphMap.coins} §7金币 §6${formatGold(gold)}` +
          `   §8•   §r${glyphMap.clock} §7TPS ${getTpsColor(tps)}${tpsText}` +
          `   §8•   §r${glyphMap.friends} §7在线 §a${players.length}`
      );
    } catch (error) {
      console.warn(`[PlayerHud] 刷新 ${player.name} 的 HUD 失败: ${(error as Error).message}`);
    }
  }
}, HUD_REFRESH_TICKS);
