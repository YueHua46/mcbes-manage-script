const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const MAX_BYTES = 32767;

function createWorld({ failOnWrite } = {}) {
  const store = new Map();
  let writes = 0;
  return {
    store,
    world: {
      getDynamicProperty: (key) => store.get(key),
      setDynamicProperty: (key, value) => {
        if (value === undefined) {
          store.delete(key);
          return;
        }
        if (typeof value === "string" && Buffer.byteLength(value, "utf8") > MAX_BYTES) {
          throw new Error(`ArgumentOutOfBoundsError: dynamic property value out of bounds (${key})`);
        }
        writes++;
        if (failOnWrite && failOnWrite(key, writes)) {
          throw new Error(`injected write failure on ${key}`);
        }
        store.set(key, value);
      },
    },
  };
}

function loadDatabase(world) {
  const filename = path.join(__dirname, "..", "scripts", "shared", "database", "database.ts");
  const source = fs.readFileSync(filename, "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const quietConsole = { log() {}, warn() {}, error() {} };
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      world,
      system: {},
      taskScheduler: { register() {} },
      console: quietConsole,
      JSON,
      Date,
      Math,
      Number,
      Object,
    },
    { filename }
  );
  return module.exports;
}

function cjkEntry(i) {
  return {
    slot: i,
    itemSnapshot: {
      typeId: "minecraft:diamond_sword",
      amount: 1,
      nameTag: `§l§d传说之剑·第${i}号`,
      lore: [
        "§6这是一件来自远古遗迹的传说级装备，蕴含着强大的力量",
        "§7右键释放技能：烈焰风暴，对周围敌人造成大量伤害",
        "§b服务器限定商品 · 不可交易 · 绑定后永久有效",
      ],
    },
    category: "武器装备",
    price: 1000 + i,
  };
}

test("splitByUtf8Bytes keeps chunks under the byte limit and never splits surrogate pairs", () => {
  const { world } = createWorld();
  const { splitByUtf8Bytes, utf8ByteLength } = loadDatabase(world);
  const value = "a中😀".repeat(5000);
  const chunks = splitByUtf8Bytes(value, 1000);

  assert.equal(chunks.join(""), value);
  for (const chunk of chunks) {
    assert.ok(utf8ByteLength(chunk) <= 1000);
    assert.equal(utf8ByteLength(chunk), Buffer.byteLength(chunk, "utf8"));
    const first = chunk.charCodeAt(0);
    assert.ok(!(first >= 0xdc00 && first <= 0xdfff), "chunk must not start with a low surrogate");
  }
});

test("CJK-heavy databases save and reload intact (bytes, not characters, are the limit)", () => {
  const env = createWorld();
  const { Database } = loadDatabase(env.world);
  const db = new Database("shop");
  for (let i = 0; i < 300; i++) db.set(`slot_${i}`, cjkEntry(i));

  const json = JSON.stringify(db.getAll());
  assert.ok(Buffer.byteLength(json, "utf8") > json.length * 1.3, "fixture should be CJK heavy");
  db.save(true);

  Database.databases.length = 0;
  const reloaded = new Database("shop");
  assert.equal(reloaded.loadState, "ok");
  assert.equal(reloaded.keys().length, 300);
  assert.deepEqual(reloaded.get("slot_299"), cjkEntry(299));
});

test("a failed save never corrupts the previously committed data", () => {
  let failing = false;
  const env = createWorld({ failOnWrite: (key) => failing && /@\d+:2$/.test(key) });
  const { Database } = loadDatabase(env.world);

  const db = new Database("shop");
  for (let i = 0; i < 50; i++) db.set(`slot_${i}`, cjkEntry(i));
  db.save(true);

  for (let i = 50; i < 400; i++) db.set(`slot_${i}`, cjkEntry(i));
  failing = true;
  assert.throws(() => db.save(true));
  failing = false;

  Database.databases.length = 0;
  const reloaded = new Database("shop");
  assert.equal(reloaded.loadState, "ok");
  assert.equal(reloaded.keys().length, 50);
});

test("legacy Index/chunk format is read and migrated on the next save", () => {
  const env = createWorld();
  const legacy = JSON.stringify({ a: 1, b: "旧数据" });
  env.store.set("legacyIndex", 2);
  env.store.set("legacy:0", legacy.slice(0, 5));
  env.store.set("legacy:1", legacy.slice(5));

  const { Database } = loadDatabase(env.world);
  const db = new Database("legacy");
  assert.equal(db.loadState, "ok");
  assert.equal(db.get("b"), "旧数据");

  db.set("c", 3);
  db.save();
  assert.ok(typeof env.store.get("legacyMeta") === "string");

  Database.databases.length = 0;
  const reloaded = new Database("legacy");
  assert.deepEqual(reloaded.getAll(), { a: 1, b: "旧数据", c: 3 });
});

test("corrupted data is backed up and reported without overwriting the stored chunks", () => {
  const env = createWorld();
  env.store.set("brokenIndex", 1);
  env.store.set("broken:0", '{"slot_0":{"slot":0,"price":');

  const { Database } = loadDatabase(env.world);
  const db = new Database("broken");
  assert.equal(db.loadState, "reset");
  assert.deepEqual(db.getAll(), {});
  assert.equal(env.store.get("broken:0"), '{"slot_0":{"slot":0,"price":');
  assert.ok([...env.store.keys()].some((key) => key.startsWith("broken:corruptBackup:")));
});

test("an invalid Meta is treated as corruption, not as an un-migrated legacy database", () => {
  const env = createWorld();
  env.store.set("shopIndex", 1);
  env.store.set("shop:0", JSON.stringify({ old: true }));
  const { Database } = loadDatabase(env.world);
  const db = new Database("shop");
  db.set("new", true);
  db.save();

  env.store.set("shopMeta", "{broken");
  Database.databases.length = 0;
  const reloaded = new Database("shop");
  assert.equal(reloaded.loadState, "reset");
  assert.equal(reloaded.get("old"), undefined);
});

test("a missing Meta after migration is treated as corruption", () => {
  const env = createWorld();
  env.store.set("shopIndex", 1);
  env.store.set("shop:0", JSON.stringify({ old: true }));
  const { Database } = loadDatabase(env.world);
  const db = new Database("shop");
  db.set("new", true);
  db.save();

  env.store.delete("shopMeta");
  Database.databases.length = 0;
  const reloaded = new Database("shop");
  assert.equal(reloaded.loadState, "reset");
  assert.equal(reloaded.get("old"), undefined);
});

test("save() reports success once Meta is committed, even if later bookkeeping fails", () => {
  const env = createWorld({ failOnWrite: (key) => key === "shopFormat" });
  const { Database } = loadDatabase(env.world);
  const db = new Database("shop");
  db.set("a", 1);
  db.save();

  Database.databases.length = 0;
  assert.equal(new Database("shop").get("a"), 1);
});

test("a failed clear() restores the previous cache and dirty state", () => {
  let failing = false;
  const env = createWorld({ failOnWrite: () => failing });
  const { Database } = loadDatabase(env.world);
  const db = new Database("shop");
  db.set("a", 1);
  db.save();

  failing = true;
  assert.throws(() => db.clear());
  failing = false;
  assert.equal(db.get("a"), 1);

  db.set("b", 2);
  db.save();
  Database.databases.length = 0;
  assert.deepEqual(new Database("shop").getAll(), { a: 1, b: 2 });
});

test("repaired data is not written back automatically", () => {
  const env = createWorld();
  const broken = '{"transactions":[{"a":1},{"b":2},{"c"';
  env.store.set("logIndex", 1);
  env.store.set("log:0", broken);
  const { Database } = loadDatabase(env.world);
  const db = new Database("log");
  assert.equal(db.loadState, "repaired");
  Database.saveNextDirty();
  assert.equal(env.store.get("log:0"), broken);
  assert.equal(env.store.has("logMeta"), false);
});
