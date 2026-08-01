import { Player, TextPrimitive, Vector3, world, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { generateId, isAdmin, SystemLog } from "../../../shared/utils/common";
import { formatDateTimeBeijing } from "../../../shared/utils/datetime-beijing";
import setting from "../../system/services/setting";
import economic from "../../economic/services/economic";

export interface IFloatingText {
  id: string;
  name: string;
  text: string;
  ownerName: string;
  location: Vector3;
  dimension: string;
  created: string;
  modified: string;
  scale: number;
  maximumRenderDistance: number;
  depthTest: boolean;
  backgroundAlpha: number;
}

export interface FloatingTextCreateInput {
  player: Player;
  name: string;
  text: string;
  scale?: number;
  maximumRenderDistance?: number;
  depthTest?: boolean;
  backgroundAlpha?: number;
}

export interface FloatingTextUpdateInput {
  player: Player;
  id: string;
  name?: string;
  text?: string;
  updateLocation?: boolean;
  scale?: number;
  maximumRenderDistance?: number;
  depthTest?: boolean;
  backgroundAlpha?: number;
}

const MAX_NAME_LENGTH = 24;
const MAX_TEXT_LENGTH = 240;
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;
const MIN_RENDER_DISTANCE = 8;
const MAX_RENDER_DISTANCE = 256;
const DEFAULT_SCALE = 1;
const DEFAULT_RENDER_DISTANCE = 64;
const DEFAULT_BACKGROUND_ALPHA = 0.35;

function nowText(): string {
  return formatDateTimeBeijing(Date.now());
}

function normalizeLocation(location: Vector3): Vector3 {
  return {
    x: Number(location.x.toFixed(2)),
    y: Number(location.y.toFixed(2)),
    z: Number(location.z.toFixed(2)),
  };
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

function sanitizeText(text: string): string {
  return text.replace(/\\n/g, "\n").trim().slice(0, MAX_TEXT_LENGTH);
}

class FloatingTextService {
  private db!: Database<IFloatingText>;
  private readonly rendered = new Map<string, TextPrimitive>();

  constructor() {
    system.run(() => {
      this.db = new Database<IFloatingText>("floating_text");
      this.renderAll();
    });
  }

  private getManager() {
    return world.primitiveShapesManager;
  }

  private ensureEnabled(player: Player): string | undefined {
    if (setting.getState("floatingText") !== true) {
      return isAdmin(player) ? "悬浮文字系统已关闭，请先在功能开关中开启。" : "服务器暂未开放悬浮文字功能。";
    }
    return undefined;
  }

  canUse(player: Player): boolean {
    if (setting.getState("floatingText") !== true) return false;
    return isAdmin(player) || setting.getState("floatingTextAllowMembers") === true;
  }

  getCreateCost(_player?: Player): number {
    if (setting.getState("economy") !== true) return 0;
    return parseNonNegativeInteger(setting.getState("floatingTextCreateCost"), 0);
  }

  getMaxPerPlayer(): number {
    return parseNonNegativeInteger(setting.getState("floatingTextMaxPerPlayer"), 3);
  }

  private canManage(player: Player, item: IFloatingText): boolean {
    return isAdmin(player) || item.ownerName === player.name;
  }

  private validateBasicInput(name: string, text: string): string | undefined {
    if (!name) return "名称不能为空";
    if (name.length > MAX_NAME_LENGTH) return `名称最多 ${MAX_NAME_LENGTH} 个字符`;
    if (!text) return "文本内容不能为空";
    if (text.length > MAX_TEXT_LENGTH) return `文本内容最多 ${MAX_TEXT_LENGTH} 个字符`;
    return undefined;
  }

  private render(item: IFloatingText): void {
    this.removeRendered(item.id);
    const dimension = world.getDimension(item.dimension);
    const shape = new TextPrimitive(item.location, item.text);
    shape.scale = item.scale;
    shape.maximumRenderDistance = item.maximumRenderDistance;
    shape.depthTest = item.depthTest;
    shape.backgroundColorOverride = { red: 0, green: 0, blue: 0, alpha: item.backgroundAlpha };
    shape.color = { red: 1, green: 1, blue: 1, alpha: 1 };
    shape.useRotation = false;
    this.getManager().addText(shape, dimension);
    this.rendered.set(item.id, shape);
  }

  private removeRendered(id: string): void {
    const shape = this.rendered.get(id);
    if (!shape) return;
    try {
      this.getManager().removeText(shape);
    } catch {
      try {
        shape.remove();
      } catch {
        // ignore stale primitive handles after reload.
      }
    }
    this.rendered.delete(id);
  }

  renderAll(): void {
    for (const id of this.rendered.keys()) {
      this.removeRendered(id);
    }
    if (setting.getState("floatingText") !== true) return;
    for (const item of this.db.values()) {
      try {
        this.render(item);
      } catch (error) {
        SystemLog.warn(`[FloatingText] 渲染悬浮文字失败: ${item.id} ${item.name}`);
        console.warn(error);
      }
    }
  }

  listAllForAdmin(): IFloatingText[] {
    return this.db.values().sort((a, b) => a.created.localeCompare(b.created));
  }

  listForPlayer(playerName: string): IFloatingText[] {
    return this.db
      .values()
      .filter((item) => item.ownerName === playerName)
      .sort((a, b) => a.created.localeCompare(b.created));
  }

  getById(id: string): IFloatingText | undefined {
    return this.db.get(id);
  }

  create(input: FloatingTextCreateInput): IFloatingText | string {
    const enabledError = this.ensureEnabled(input.player);
    if (enabledError) return enabledError;

    const admin = isAdmin(input.player);
    if (!admin && setting.getState("floatingTextAllowMembers") !== true) {
      return "服务器暂未对普通成员开放悬浮文字功能。";
    }

    const name = sanitizeName(input.name);
    const text = sanitizeText(input.text);
    const inputError = this.validateBasicInput(name, text);
    if (inputError) return inputError;

    if (!admin) {
      const max = this.getMaxPerPlayer();
      if (this.listForPlayer(input.player.name).length >= max) {
        return `您的悬浮文字数量已达到服务器设置上限(${max})`;
      }
    }

    const cost = this.getCreateCost(input.player);
    if (cost > 0 && !economic.removeGold(input.player.name, cost, "创建悬浮文字")) {
      return `金币不足，创建悬浮文字需要 ${cost} 金币`;
    }

    const id = generateId();
    const time = nowText();
    const item: IFloatingText = {
      id,
      name,
      text,
      ownerName: input.player.name,
      location: normalizeLocation({
        x: input.player.location.x,
        y: input.player.location.y + 1.8,
        z: input.player.location.z,
      }),
      dimension: input.player.dimension.id,
      created: time,
      modified: time,
      scale: clampNumber(input.scale, DEFAULT_SCALE, MIN_SCALE, MAX_SCALE),
      maximumRenderDistance: clampNumber(
        input.maximumRenderDistance,
        DEFAULT_RENDER_DISTANCE,
        MIN_RENDER_DISTANCE,
        MAX_RENDER_DISTANCE
      ),
      depthTest: input.depthTest ?? false,
      backgroundAlpha: clampNumber(input.backgroundAlpha, DEFAULT_BACKGROUND_ALPHA, 0, 1),
    };

    this.db.set(id, item);
    this.db.save();
    this.render(item);
    return item;
  }

  update(input: FloatingTextUpdateInput): IFloatingText | string {
    const enabledError = this.ensureEnabled(input.player);
    if (enabledError) return enabledError;

    const item = this.db.get(input.id);
    if (!item) return "悬浮文字不存在";
    if (!this.canManage(input.player, item)) return "您只能管理自己创建的悬浮文字";

    const nextName = input.name === undefined ? item.name : sanitizeName(input.name);
    const nextText = input.text === undefined ? item.text : sanitizeText(input.text);
    const inputError = this.validateBasicInput(nextName, nextText);
    if (inputError) return inputError;

    item.name = nextName;
    item.text = nextText;
    item.scale = clampNumber(input.scale, item.scale, MIN_SCALE, MAX_SCALE);
    item.maximumRenderDistance = clampNumber(
      input.maximumRenderDistance,
      item.maximumRenderDistance,
      MIN_RENDER_DISTANCE,
      MAX_RENDER_DISTANCE
    );
    item.depthTest = input.depthTest ?? item.depthTest;
    item.backgroundAlpha = clampNumber(input.backgroundAlpha, item.backgroundAlpha, 0, 1);
    if (input.updateLocation) {
      item.location = normalizeLocation({
        x: input.player.location.x,
        y: input.player.location.y + 1.8,
        z: input.player.location.z,
      });
      item.dimension = input.player.dimension.id;
    }
    item.modified = nowText();

    this.db.set(item.id, item);
    this.db.save();
    this.render(item);
    return item;
  }

  delete(player: Player, id: string): boolean | string {
    const enabledError = this.ensureEnabled(player);
    if (enabledError) return enabledError;

    const item = this.db.get(id);
    if (!item) return "悬浮文字不存在";
    if (!this.canManage(player, item)) return "您只能删除自己创建的悬浮文字";

    this.removeRendered(id);
    const deleted = this.db.delete(id);
    if (deleted) this.db.save();
    return deleted;
  }

  refreshFromSettings(): void {
    this.renderAll();
  }
}

export const floatingTextService = new FloatingTextService();
export default floatingTextService;
