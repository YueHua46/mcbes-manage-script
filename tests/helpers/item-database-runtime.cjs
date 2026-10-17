/**
 * 一个足够贴近 SAPI 行为的 ItemDatabase 运行时：
 * - 实体背包 getItem 返回副本，setItem 保存副本（与真实 Container 一致）
 * - ItemStack 的 `nbt` 字段代表 JSON 快照无法读取的数据（例如潜影盒内容），
 *   只有 clone / 实体容器 / 结构能保留它
 * - 结构管理器按方块捕获/放置实体（含完整 nbt）
 * - system.run / runTimeout / runInterval 由 advance() 手动推进
 *
 * 每次 createRuntime() 都重新加载模块，可用同一份 state 模拟“重启服务器”。
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..", "..");

function transpile(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
  return {
    filename,
    code: ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
  };
}

function runModule(relativePath, globals) {
  const { filename, code } = transpile(relativePath);
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, ...globals }, { filename });
  return module.exports;
}

class ItemStack {
  constructor(typeId, amount = 1, nbt) {
    this.typeId = typeId;
    this.amount = amount;
    this.maxAmount = 64;
    this.nameTag = undefined;
    this.lockMode = "none";
    this.keepOnDeath = false;
    this.nbt = nbt === undefined ? undefined : JSON.parse(JSON.stringify(nbt));
  }
  clone() {
    const copy = new ItemStack(this.typeId, this.amount, this.nbt);
    copy.nameTag = this.nameTag;
    return copy;
  }
  getComponent() {
    return undefined;
  }
  getLore() {
    return [];
  }
  getCanDestroy() {
    return [];
  }
  getCanPlaceOn() {
    return [];
  }
  getDynamicPropertyIds() {
    return [];
  }
}

function componentClass(id) {
  return class {
    static componentId = id;
  };
}

class LocationInUnloadedChunkError extends Error {}

/** 世界状态：可跨“重启”复用 */
function createWorldState() {
  return {
    dynamicProperties: new Map(),
    entities: [],
    structures: new Map(),
    nextEntityId: 1,
  };
}

function createInventory(items = []) {
  const slots = new Array(256).fill(undefined);
  items.forEach((item, index) => {
    if (item) slots[index] = item.clone();
  });
  return {
    size: 256,
    slots,
    getItem(index) {
      return slots[index]?.clone();
    },
    setItem(index, item) {
      slots[index] = item ? item.clone() : undefined;
    },
    get emptySlotsCount() {
      return slots.filter((slot) => !slot).length;
    },
  };
}

function makeEntity(state, runtime, { typeId = "pao:new_database", location, nameTag = "", tags = [], props = {}, items = [] }) {
  const entity = {
    id: String(state.nextEntityId++),
    typeId,
    nameTag,
    location: { ...location },
    isValid: true,
    tags: new Set(tags),
    props: new Map(Object.entries(props)),
    inventory: createInventory(items),
    getComponent(name) {
      return name === "inventory" || name === "minecraft:inventory" ? { container: this.inventory } : undefined;
    },
    getTags() {
      return [...this.tags];
    },
    addTag(tag) {
      this.tags.add(tag);
      return true;
    },
    removeTag(tag) {
      return this.tags.delete(tag);
    },
    getDynamicProperty(key) {
      return this.props.get(key);
    },
    setDynamicProperty(key, value) {
      if (value === undefined) this.props.delete(key);
      else this.props.set(key, value);
    },
    teleport(target) {
      this.location = { x: target.x, y: target.y, z: target.z };
    },
    remove() {
      // 事件总是发给当前活动的运行时（模拟重启后只有新实例在监听）
      (state.activeRuntime ?? runtime)?.emitEntityRemove(this);
      this.isValid = false;
      const index = state.entities.indexOf(this);
      if (index >= 0) state.entities.splice(index, 1);
    },
  };
  state.entities.push(entity);
  return entity;
}

function insideBlock(location, block) {
  return (
    Math.floor(location.x) === block.x && Math.floor(location.y) === block.y && Math.floor(location.z) === block.z
  );
}

function createRuntime(state = createWorldState(), { players = 1 } = {}) {
  let tick = 0;
  let nextRunId = 1;
  const tasks = new Map();
  const logs = [];
  const messages = [];
  const listeners = { entityRemove: [], playerLeave: [], playerSpawn: [] };

  const runtime = {
    emitEntityRemove(entity) {
      for (const listener of listeners.entityRemove) listener({ removedEntity: entity });
    },
  };
  state.activeRuntime = runtime;

  const system = {
    run(fn) {
      return system.runTimeout(fn, 1);
    },
    runTimeout(fn, delay = 1) {
      const id = nextRunId++;
      tasks.set(id, { at: tick + Math.max(1, delay), fn });
      return id;
    },
    runInterval(fn, interval = 1) {
      const id = nextRunId++;
      const step = Math.max(1, interval);
      tasks.set(id, { at: tick + step, fn, interval: step });
      return id;
    },
    clearRun(id) {
      tasks.delete(id);
    },
  };

  const playerList = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Player${i}` }));

  const dimension = {
    runCommand() {
      return { successCount: 1 };
    },
    getEntities(options = {}) {
      return state.entities.filter((entity) => !options.type || entity.typeId === options.type);
    },
    spawnEntity(typeId, location) {
      return makeEntity(state, runtime, { typeId, location });
    },
  };

  const structureManager = {
    get(id) {
      return state.structures.has(id) ? { id } : undefined;
    },
    delete(id) {
      return state.structures.delete(typeof id === "string" ? id : id.id);
    },
    createFromWorld(id, _dimension, from, _to, options = {}) {
      if (state.structures.has(id)) throw new Error(`structure ${id} already exists`);
      const captured = options.includeEntities
        ? state.entities
            .filter((entity) => insideBlock(entity.location, from))
            .map((entity) => ({
              typeId: entity.typeId,
              nameTag: entity.nameTag,
              offset: {
                x: entity.location.x - from.x,
                y: entity.location.y - from.y,
                z: entity.location.z - from.z,
              },
              tags: [...entity.tags],
              props: Object.fromEntries(entity.props),
              items: entity.inventory.slots.map((item) => item?.clone()),
            }))
        : [];
      state.structures.set(id, { entities: captured });
      return { id };
    },
    place(id, _dimension, location, options = {}) {
      const structure = state.structures.get(typeof id === "string" ? id : id.id);
      if (!structure) throw new Error(`missing structure ${id}`);
      if (!options.includeEntities) return;
      for (const saved of structure.entities) {
        makeEntity(state, runtime, {
          typeId: saved.typeId,
          nameTag: saved.nameTag,
          location: {
            x: location.x + saved.offset.x,
            y: location.y + saved.offset.y,
            z: location.z + saved.offset.z,
          },
          tags: saved.tags,
          props: saved.props,
          items: saved.items,
        });
      }
    },
  };

  const world = {
    getAllPlayers: () => playerList,
    getDimension: () => dimension,
    getDynamicProperty: (key) => state.dynamicProperties.get(key),
    setDynamicProperty: (key, value) => {
      if (value === undefined) {
        state.dynamicProperties.delete(key);
        return;
      }
      if (typeof value === "string" && Buffer.byteLength(value, "utf8") > 32767) {
        throw new Error(`ArgumentOutOfBoundsError: ${key}`);
      }
      state.dynamicProperties.set(key, value);
    },
    structureManager,
    beforeEvents: {
      entityRemove: { subscribe: (fn) => listeners.entityRemove.push(fn) },
      playerLeave: { subscribe: (fn) => listeners.playerLeave.push(fn) },
    },
    afterEvents: {
      playerSpawn: { subscribe: (fn) => listeners.playerSpawn.push(fn) },
    },
  };

  const quietConsole = { log() {}, info() {}, warn() {}, error() {} };
  const SystemLog = {
    info: (...args) => logs.push(["info", args.join(" ")]),
    warn: (...args) => logs.push(["warn", args.join(" ")]),
    error: (...args) => logs.push(["error", args.join(" ")]),
  };

  const sapi = {
    world,
    system,
    ItemStack,
    LocationInUnloadedChunkError,
    StructureSaveMode: { World: "World", Memory: "Memory" },
    EnchantmentTypes: { get: () => undefined },
    ItemBookComponent: componentClass("minecraft:book"),
    ItemDurabilityComponent: componentClass("minecraft:durability"),
    ItemDyeableComponent: componentClass("minecraft:dyeable"),
    ItemEnchantableComponent: componentClass("minecraft:enchantable"),
    ItemInventoryComponent: componentClass("minecraft:inventory"),
    console: quietConsole,
  };

  const { Database } = runModule("scripts/shared/database/database.ts", {
    ...sapi,
    taskScheduler: { register() {} },
  });
  const persist = runModule("scripts/shared/utils/item-stack-persist.ts", sapi);
  const reconcile = runModule("scripts/features/economic/services/item-database-reconcile.ts", {});
  const itemDatabaseModule = runModule("scripts/features/economic/services/item-database.ts", {
    ...sapi,
    ...persist,
    ...reconcile,
    Database,
    SystemLog,
    isAdmin: () => true,
    getOnlineRealPlayers: () => playerList.map((p) => ({ ...p, sendMessage: (m) => messages.push(m) })),
    getOnlineRealPlayerCount: () => playerList.length,
    isScriptFakePlayerEntity: () => false,
    Date,
    Math,
    JSON,
    Number,
    Object,
    Promise,
  });

  async function advance(ticks = 1) {
    for (let i = 0; i < ticks; i++) {
      tick++;
      const due = [...tasks.entries()].filter(([, task]) => task.at <= tick).sort((a, b) => a[0] - b[0]);
      for (const [id, task] of due) {
        if (!tasks.has(id)) continue;
        if (task.interval) task.at = tick + task.interval;
        else tasks.delete(id);
        task.fn();
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return {
    state,
    world,
    dimension,
    logs,
    messages,
    advance,
    ItemDatabase: itemDatabaseModule.default,
    getItemDatabases: itemDatabaseModule.getItemDatabases,
    Database,
    persist,
    makeEntity: (options) => makeEntity(state, runtime, options),
    emitPlayerLeave: (player) => listeners.playerLeave.forEach((fn) => fn({ player })),
  };
}

module.exports = { createRuntime, createWorldState, ItemStack };
