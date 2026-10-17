const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntime, createWorldState, ItemStack } = require("./helpers/item-database-runtime.cjs");

const DB = "officeShopItems";
const SHULKER_NBT = { contents: [{ typeId: "minecraft:diamond", amount: 64 }] };

function shulker() {
  return new ItemStack("minecraft:red_shulker_box", 1, SHULKER_NBT);
}

async function boot(state, options) {
  const runtime = createRuntime(state, options);
  const db = new runtime.ItemDatabase(DB);
  await runtime.advance(80);
  return { runtime, db };
}

function ownEntities(state) {
  return state.entities.filter((e) => e.props.get("paoDbName") === DB);
}

function legacyEntity(runtime, items) {
  return runtime.makeEntity({
    location: { x: 8, y: 0, z: 8 },
    nameTag: `DB_${DB}`,
    tags: [`pao_db_name:${DB}`, "pao_db_index:0", "spawntime:1"],
    props: { paoDbName: DB, paoDbIndex: 0 },
    items,
  });
}

test("items survive a full restart with their NBT and metadata", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(shulker(), { category: "blocks", price: 10, amount: 1, createdAt: 1 });
  await first.runtime.advance(5);

  const second = await boot(state);
  const items = [];
  second.db.forEach((entry) => items.push(entry));
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].item.nbt, SHULKER_NBT);
  assert.equal(items[0].data.price, 10);
});

test("entity items without an index are quarantined in place, never cleared or overwritten", async () => {
  const state = createWorldState();
  const runtime = createRuntime(state);
  legacyEntity(runtime, [shulker(), new ItemStack("minecraft:potion", 1, { potion: "strength" })]);

  const db = new runtime.ItemDatabase(DB);
  await runtime.advance(80);

  const [entity] = ownEntities(state);
  assert.deepEqual(entity.inventory.slots[0].nbt, SHULKER_NBT, "shulker contents must stay in the entity");
  assert.deepEqual(entity.inventory.slots[1].nbt, { potion: "strength" });
  assert.equal(db.length, 0, "quarantined items are hidden from the shop");

  db.add(new ItemStack("minecraft:stone", 8), { category: "blocks", price: 1, amount: 8, createdAt: 2 });
  assert.equal(entity.inventory.slots[2].typeId, "minecraft:stone");
  assert.deepEqual(entity.inventory.slots[0].nbt, SHULKER_NBT, "new items must not overwrite quarantined slots");
});

test("a corrupted index puts the database into protection mode without touching entity items", async () => {
  const state = createWorldState();
  state.dynamicProperties.set(`EntityDatabase_${DB}Index`, 1);
  state.dynamicProperties.set(`EntityDatabase_${DB}:0`, '{"slot_0":{"slot":0,"price":');
  const runtime = createRuntime(state);
  legacyEntity(runtime, [shulker()]);

  const db = new runtime.ItemDatabase(DB);
  await runtime.advance(80);

  const [entity] = ownEntities(state);
  assert.deepEqual(entity.inventory.slots[0].nbt, SHULKER_NBT);
  assert.throws(() => db.forEach(() => {}), /unhealthy/);
  assert.ok(runtime.logs.some(([level, text]) => level === "error" && text.includes("保护状态")));
});

test("missing storage entities are restored from the structure backup with full NBT", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(shulker(), { category: "blocks", price: 10, amount: 1, createdAt: 1 });
  await first.runtime.advance(120); // 等待结构备份防抖
  assert.ok([...state.structures.keys()].some((id) => id.startsWith("yuehua:item_db_")));

  // 模拟实体丢失（例如被其它插件清除）后重启
  state.entities.length = 0;
  const second = await boot(state);
  await second.runtime.advance(200);

  const items = [];
  second.db.forEach((entry) => items.push(entry));
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].item.nbt, SHULKER_NBT, "structure restore keeps data the JSON snapshot cannot hold");
});

test("without any backup, snapshot restore is used and reported as lossy", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(shulker(), { category: "blocks", price: 10, amount: 1, createdAt: 1 });
  await first.runtime.advance(5);

  state.entities.length = 0;
  state.structures.clear();
  const second = await boot(state);
  await second.runtime.advance(200);

  const items = [];
  second.db.forEach((entry) => items.push(entry));
  assert.equal(items.length, 1);
  assert.equal(items[0].item.nbt, undefined);
  assert.ok(second.runtime.messages.some((m) => String(m).includes("潜影盒内容")));
});

test("each database stores its entities in its own block so backups never include another database", async () => {
  const state = createWorldState();
  const runtime = createRuntime(state);
  const shop = new runtime.ItemDatabase(DB);
  const market = new runtime.ItemDatabase("AuctionHouse2.0");
  await runtime.advance(80);
  shop.add(new ItemStack("minecraft:stone"), { createdAt: 1 });
  market.add(new ItemStack("minecraft:dirt"), { createdAt: 2 });
  await runtime.advance(120);

  assert.ok(state.structures.size >= 2, "both databases should have written a structure backup");
  for (const [, structure] of state.structures) {
    assert.ok(structure.entities.length > 0);
    const names = new Set(structure.entities.map((e) => e.props.paoDbName));
    assert.equal(names.size, 1);
  }
});

// ---- 审查回归用例（见 PR 讨论）----

function listItems(db) {
  const out = [];
  db.forEach((entry) => out.push(entry));
  return out;
}

test("a stale structure backup never pairs an old item with a newer slot record", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(new ItemStack("minecraft:diamond", 1), { category: "ores", price: 999, amount: 1, createdAt: 1 });
  await first.runtime.advance(120); // 备份包含钻石
  first.db.remove(listItems(first.db)[0].data);
  first.db.add(new ItemStack("minecraft:stone", 1), { category: "blocks", price: 1, amount: 1, createdAt: 2 });
  await first.runtime.advance(5); // 下一次备份尚未完成

  state.entities.length = 0;
  const second = await boot(state);
  await second.runtime.advance(200);

  const items = listItems(second.db);
  assert.equal(items.length, 1);
  assert.equal(items[0].item.typeId, "minecraft:stone");
  assert.equal(items[0].data.price, 1);
  const restoredDiamonds = ownEntities(state).flatMap((e) => e.inventory.slots).filter((s) => s?.typeId === "minecraft:diamond");
  assert.equal(restoredDiamonds.length, 0, "the sold diamond must not come back from the backup");
});

test("losing only some storage entities still restores them from the structure backup", async () => {
  const state = createWorldState();
  const first = await boot(state);
  for (let i = 0; i < 256; i++) first.db.add(new ItemStack("minecraft:stone"), { createdAt: i });
  first.db.add(shulker(), { createdAt: 999 });
  await first.runtime.advance(120);

  const lost = ownEntities(state).find((e) => e.props.get("paoDbIndex") === 1);
  state.entities.splice(state.entities.indexOf(lost), 1);
  const second = await boot(state);
  await second.runtime.advance(200);

  const box = listItems(second.db).find((e) => e.item.typeId.endsWith("shulker_box"));
  assert.deepEqual(box?.item.nbt, SHULKER_NBT);
  assert.equal(second.db.length, 257);
  assert.equal(ownEntities(state).length, 2, "placed copies of surviving entities must be removed");
});

test("if the index cannot be saved, removing an item fails instead of duplicating it", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 });
  const entry = listItems(first.db)[0];

  const original = first.runtime.world.setDynamicProperty;
  first.runtime.world.setDynamicProperty = (key, value) => {
    if (String(key).startsWith(`EntityDatabase_${DB}`)) throw new Error("injected save failure");
    return original(key, value);
  };
  assert.throws(() => entry.unStore(false));
  first.runtime.world.setDynamicProperty = original;

  assert.equal(listItems(first.db).length, 1, "the item stays in the shop when the removal could not be committed");
  const second = await boot(state);
  await second.runtime.advance(200);
  assert.equal(listItems(second.db).length, 1);
});

test("if the index cannot be saved, adding an item fails and leaves no copy in the entity", async () => {
  const state = createWorldState();
  const first = await boot(state);
  const original = first.runtime.world.setDynamicProperty;
  first.runtime.world.setDynamicProperty = (key, value) => {
    if (String(key).startsWith(`EntityDatabase_${DB}`)) throw new Error("injected save failure");
    return original(key, value);
  };
  assert.throws(() => first.db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 }));
  first.runtime.world.setDynamicProperty = original;

  assert.equal(first.db.length, 0);
  assert.equal(ownEntities(state)[0].inventory.slots.filter(Boolean).length, 0);
});

test("a corrupted new-format Meta enters protection mode instead of reading legacy data", async () => {
  const state = createWorldState();
  state.dynamicProperties.set(`EntityDatabase_${DB}Index`, 1);
  state.dynamicProperties.set(`EntityDatabase_${DB}:0`, "{}");
  const first = await boot(state);
  first.db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 });

  state.dynamicProperties.set(`EntityDatabase_${DB}Meta`, "{broken");
  const second = await boot(state);
  await second.runtime.advance(200);

  assert.throws(() => listItems(second.db), /unhealthy/);
  const slots = ownEntities(state).flatMap((e) => e.inventory.slots).filter(Boolean);
  assert.equal(slots.length, 1, "entity items are left untouched");
});

test("an item removed after the last backup is not resurrected, even as a hidden copy", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(shulker(), { createdAt: 1 });
  await first.runtime.advance(120);
  listItems(first.db)[0].unStore(false);
  await first.runtime.advance(5);

  state.entities.length = 0;
  const second = await boot(state);
  await second.runtime.advance(200);

  assert.equal(second.db.length, 0);
  const copies = ownEntities(state).flatMap((e) => e.inventory.slots).filter(Boolean);
  assert.equal(copies.length, 0);
});

test("a failed metadata edit keeps the previous values in memory and on disk", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(new ItemStack("minecraft:stone"), { price: 5, createdAt: 1 });
  const entry = listItems(first.db)[0];

  const original = first.runtime.world.setDynamicProperty;
  first.runtime.world.setDynamicProperty = (key, value) => {
    if (String(key).startsWith(`EntityDatabase_${DB}`)) throw new Error("injected save failure");
    return original(key, value);
  };
  assert.throws(() => first.db.edit(entry.data, { ...entry.data, price: 50 }));
  first.runtime.world.setDynamicProperty = original;

  assert.equal(listItems(first.db)[0].data.price, 5);
  const second = await boot(state);
  await second.runtime.advance(200);
  assert.equal(listItems(second.db)[0].data.price, 5);
});

// ---- v2 审查回归用例 ----

function failWrites(runtime, predicate) {
  const original = runtime.world.setDynamicProperty;
  runtime.world.setDynamicProperty = (key, value) => {
    if (predicate(String(key))) throw new Error(`injected write failure on ${key}`);
    return original(key, value);
  };
  return () => {
    runtime.world.setDynamicProperty = original;
  };
}

test("a failure after the Meta commit point is not reported as a rollback-able failure", async () => {
  const state = createWorldState();
  const runtime = createRuntime(state);
  const restore = failWrites(runtime, (key) => key === `EntityDatabase_${DB}Format`);
  const db = new runtime.ItemDatabase(DB);
  await runtime.advance(80);

  db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 }); // 必须视为成功
  restore();
  assert.equal(db.length, 1);
  assert.equal(ownEntities(state)[0].inventory.slots.filter(Boolean).length, 1);

  const second = await boot(state);
  await second.runtime.advance(200);
  assert.equal(listItems(second.db).length, 1);
  assert.equal(ownEntities(state).flatMap((e) => e.inventory.slots).filter(Boolean).length, 1);
});

for (const entry of ["clear", "hardReset"]) {
  test(`a failed ${entry}() leaves the index intact for later saves`, async () => {
    const state = createWorldState();
    const first = await boot(state);
    first.db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 });

    const restore = failWrites(first.runtime, (key) => key.startsWith(`EntityDatabase_${DB}`));
    if (entry === "clear") {
      assert.throws(() => first.db.clear());
    } else {
      await assert.rejects(first.db.hardReset());
    }
    restore();

    assert.equal(listItems(first.db).length, 1);
    // 任何后续保存都会写出整份缓存：不能把清空后的缓存带出去
    first.db.add(new ItemStack("minecraft:stone", 1), { createdAt: 2 });

    const second = await boot(state);
    await second.runtime.advance(200);
    assert.equal(listItems(second.db).length, 2);
  });
}

// ---- v3 审查回归用例 ----

test("an item already handed out is never re-registered by the entity rescue path", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 });
  const [entity] = ownEntities(state);
  const originalSetItem = entity.inventory.setItem;
  entity.inventory.setItem = (index, item) => {
    if (!item) throw new Error("injected clear failure");
    return originalSetItem(index, item);
  };

  const handedOut = listItems(first.db)[0].unStore(false);
  assert.equal(handedOut.typeId, "minecraft:diamond");
  assert.equal(first.db.length, 0);

  entity.remove(); // 有玩家在线时被意外移除 → 走抢救
  await first.runtime.advance(120);
  assert.equal(first.db.length, 0, "rescue must not resurrect the handed-out item");
  const copies = ownEntities(state).flatMap((e) => e.inventory.slots).filter(Boolean);
  assert.equal(copies.length, 0);
});

test("a failed post-delete cleanup is retried and never comes back after restart", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 });
  const [entity] = ownEntities(state);
  const originalSetItem = entity.inventory.setItem;
  let failClear = true;
  entity.inventory.setItem = (index, item) => {
    if (!item && failClear) throw new Error("injected clear failure");
    return originalSetItem(index, item);
  };

  listItems(first.db)[0].unStore(false);
  failClear = false;
  await first.runtime.advance(150);
  assert.equal(entity.inventory.slots.filter(Boolean).length, 0, "stale copy is cleared on retry");

  const second = await boot(state);
  await second.runtime.advance(200);
  assert.equal(second.db.length, 0);
  assert.equal(ownEntities(state).flatMap((e) => e.inventory.slots).filter(Boolean).length, 0);
});

for (const entry of ["clear", "hardReset"]) {
  test(`${entry}() finishes cleanly after its commit even if removing an entity fails`, async () => {
    const state = createWorldState();
    const first = await boot(state);
    first.db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 });
    for (const entity of ownEntities(state)) {
      entity.remove = () => {
        throw new Error("injected remove failure");
      };
    }

    if (entry === "clear") {
      first.db.clear();
      await first.runtime.advance(5);
    } else {
      const done = first.db.hardReset();
      await first.runtime.advance(80); // hardReset 内部需要等待若干 tick
      await done;
    }

    assert.equal(listItems(first.db).length, 0, "old items are no longer visible after a committed clear");
    first.db.add(new ItemStack("minecraft:stone", 1), { createdAt: 2 });

    const second = await boot(state);
    await second.runtime.advance(200);
    const items = listItems(second.db);
    assert.deepEqual(
      items.map((e) => e.item.typeId),
      ["minecraft:stone"]
    );
  });
}

// ---- 重构后的不变式（全量审查清单）----

test("protection mode: the unload path never writes the index", async () => {
  const state = createWorldState();
  state.dynamicProperties.set(`EntityDatabase_${DB}Index`, 1);
  state.dynamicProperties.set(`EntityDatabase_${DB}:0`, '{"slot_0":{"slot":0,"price":');
  const runtime = createRuntime(state);
  legacyEntity(runtime, [shulker()]);
  const db = new runtime.ItemDatabase(DB);
  await runtime.advance(80);
  const before = JSON.stringify([...state.dynamicProperties.entries()].filter(([k]) => k.startsWith("EntityDatabase_")));

  const realPlayers = runtime.world.getAllPlayers();
  realPlayers.length = 0; // 所有玩家离线
  ownEntities(state)[0].remove(); // 随区块卸载
  await runtime.advance(10);

  const after = JSON.stringify([...state.dynamicProperties.entries()].filter(([k]) => k.startsWith("EntityDatabase_")));
  assert.equal(after, before);
  assert.match(db.getStatus().protection ?? "", /损坏/);
});

test("protection mode: a rescue puts items back physically but keeps protection and the index untouched", async () => {
  const state = createWorldState();
  state.dynamicProperties.set(`EntityDatabase_${DB}Index`, 1);
  state.dynamicProperties.set(`EntityDatabase_${DB}:0`, '{"slot_0":{"slot":0,"price":');
  const runtime = createRuntime(state);
  legacyEntity(runtime, [shulker()]);
  const db = new runtime.ItemDatabase(DB);
  await runtime.advance(80);

  ownEntities(state)[0].remove(); // 有人在线时被意外移除
  await runtime.advance(80);

  assert.match(db.getStatus().protection ?? "", /损坏/);
  const slots = ownEntities(state).flatMap((e) => e.inventory.slots).filter(Boolean);
  assert.equal(slots.length, 1);
  assert.deepEqual(slots[0].nbt, SHULKER_NBT);
  assert.equal(state.dynamicProperties.has(`EntityDatabase_${DB}Meta`), false, "index was not rewritten");
});

test("a rescue while initialisation is still running only restores items physically", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(shulker(), { createdAt: 1 });

  const runtime = createRuntime(state);
  const db = new runtime.ItemDatabase(DB);
  await runtime.advance(20); // 初始化正在等待存储区加载，即将查找实体
  ownEntities(state)[0].remove();
  await runtime.advance(250);

  const items = listItems(db);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].item.nbt, SHULKER_NBT);
  const indices = ownEntities(state).map((e) => e.props.get("paoDbIndex"));
  assert.equal(new Set(indices).size, indices.length, "init and rescue must not both create entity 0");
});

test("if rolling back an add fails, the leftover copy is never reused or shown", async () => {
  const state = createWorldState();
  const first = await boot(state);
  const [entity] = ownEntities(state);
  const originalSetItem = entity.inventory.setItem;
  let failClear = true;
  entity.inventory.setItem = (index, item) => {
    if (!item && failClear) throw new Error("injected rollback failure");
    return originalSetItem(index, item);
  };
  const restore = failWrites(first.runtime, (key) => key.startsWith(`EntityDatabase_${DB}`));
  assert.throws(() => first.db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 }));
  restore();

  assert.equal(first.db.length, 0);
  first.db.add(new ItemStack("minecraft:stone", 1), { createdAt: 2 });
  assert.equal(entity.inventory.slots[0].typeId, "minecraft:diamond", "the leftover slot is not overwritten");
  assert.equal(entity.inventory.slots[1].typeId, "minecraft:stone");

  failClear = false;
  await first.runtime.advance(60);
  assert.equal(entity.inventory.slots[0], undefined, "the leftover copy is cleaned up on retry");
  assert.deepEqual(listItems(first.db).map((e) => e.item.typeId), ["minecraft:stone"]);
});

test("a trailing empty entity is only dropped after it was actually removed", async () => {
  const state = createWorldState();
  const first = await boot(state);
  for (let i = 0; i < 257; i++) first.db.add(new ItemStack("minecraft:stone"), { createdAt: i });
  const second = ownEntities(state).find((e) => e.props.get("paoDbIndex") === 1);
  second.remove = () => {
    throw new Error("injected remove failure");
  };
  first.db.remove(listItems(first.db).find((e) => e.data.createdAt === 256).data);
  first.db.add(new ItemStack("minecraft:dirt"), { createdAt: 999 });

  const indices = ownEntities(state).map((e) => e.props.get("paoDbIndex"));
  assert.equal(new Set(indices).size, indices.length, "no two storage entities may share an index");
});

test("an initialisation failure is reported through protection mode", async () => {
  const state = createWorldState();
  const runtime = createRuntime(state);
  runtime.dimension.spawnEntity = () => {
    throw new Error("injected spawn failure");
  };
  const db = new runtime.ItemDatabase(DB);
  await runtime.advance(80);

  assert.match(db.getStatus().protection ?? "", /初始化失败/);
  assert.throws(() => db.forEach(() => {}), /初始化失败/);
});

test("stored items are isolated from the caller's objects", async () => {
  const state = createWorldState();
  const first = await boot(state);
  const original = new ItemStack("minecraft:diamond", 3);
  first.db.add(original, { createdAt: 1 });
  original.amount = 64;
  listItems(first.db)[0].item.amount = 32;
  assert.equal(listItems(first.db)[0].item.amount, 3);
});

test("operations on outdated data are rejected instead of applied to a changed item", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(new ItemStack("minecraft:stone"), { price: 5, createdAt: 1 });
  const stale = listItems(first.db)[0].data;
  first.db.edit(stale, { price: 6 });
  assert.throws(() => first.db.edit(stale, { price: 7 }), /Item not found/);
  assert.throws(() => first.db.remove(stale), /Item not found/);
  assert.equal(listItems(first.db)[0].data.price, 6);
});

test("edit() never rewrites the stored item even if an item copy is passed back", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(shulker(), { price: 5, createdAt: 1 });
  const entry = listItems(first.db)[0];
  const rev = entry.data.rev;
  first.db.edit(entry.data, { ...entry.data, item: new ItemStack("minecraft:dirt"), price: 9 });
  const after = listItems(first.db)[0];
  assert.equal(after.item.typeId, "minecraft:red_shulker_box");
  assert.equal(after.data.rev, rev, "metadata edits do not count as content changes");
});

test("unStore hands out the real entity item and refuses when it no longer matches", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(shulker(), { createdAt: 1 });
  first.db.add(new ItemStack("minecraft:stone"), { createdAt: 2 });
  const [box, stone] = listItems(first.db);
  assert.deepEqual(box.unStore(true).nbt, SHULKER_NBT);

  ownEntities(state)[0].inventory.slots[1] = new ItemStack("minecraft:dirt");
  assert.throws(() => stone.unStore(false), /不符/);
  assert.equal(first.db.length, 2, "nothing was removed");
});

test("removeMany deletes everything in a single commit", async () => {
  const state = createWorldState();
  const first = await boot(state);
  for (let i = 0; i < 5; i++) first.db.add(new ItemStack("minecraft:stone"), { category: "c", createdAt: i });
  let saves = 0;
  const original = first.runtime.world.setDynamicProperty;
  first.runtime.world.setDynamicProperty = (key, value) => {
    if (key === `EntityDatabase_${DB}Meta`) saves++;
    return original(key, value);
  };
  assert.equal(first.db.removeMany(listItems(first.db).map((e) => e.data)), 5);
  first.runtime.world.setDynamicProperty = original;
  assert.equal(saves, 1);
  assert.equal(first.db.length, 0);
});

test("audit records are capped", async () => {
  const state = createWorldState();
  const audits = {};
  for (let i = 0; i < 150; i++) audits[`audit_discarded_0_${i}`] = { slot: 0, detectedAt: i };
  state.dynamicProperties.set(`EntityDatabase_${DB}Index`, 1);
  state.dynamicProperties.set(`EntityDatabase_${DB}:0`, JSON.stringify(audits));
  const first = await boot(state);
  first.db.add(new ItemStack("minecraft:stone"), { createdAt: 1 });

  const second = await boot(state);
  second.db.add(new ItemStack("minecraft:dirt"), { createdAt: 2 });
  const second2 = await boot(state);
  assert.ok(second2.db.length >= 0);
  const raw = [...state.dynamicProperties.entries()]
    .filter(([k]) => k.startsWith(`EntityDatabase_${DB}@`))
    .map(([, v]) => v);
  const cache = JSON.parse(raw.join(""));
  assert.ok(Object.keys(cache).filter((k) => k.startsWith("audit_")).length <= 100);
});

test("admin maintenance: rebuild from entities exits protection; quarantined items can be taken or discarded", async () => {
  const state = createWorldState();
  state.dynamicProperties.set(`EntityDatabase_${DB}Index`, 1);
  state.dynamicProperties.set(`EntityDatabase_${DB}:0`, '{"slot_0":{"slot":0,"price":');
  const runtime = createRuntime(state);
  legacyEntity(runtime, [shulker(), new ItemStack("minecraft:dirt", 4)]);
  const db = new runtime.ItemDatabase(DB);
  await runtime.advance(80);
  assert.ok(db.getStatus().protection);

  const result = db.rebuildIndexFromEntities();
  assert.equal(result.items, 0);
  assert.equal(result.quarantined, 2);
  assert.equal(db.getStatus().protection, undefined);
  const quarantined = db.listQuarantined();
  assert.equal(quarantined.length, 2);

  const target = {
    size: 4,
    slots: new Array(4).fill(undefined),
    getItem(i) {
      return this.slots[i];
    },
    setItem(i, item) {
      this.slots[i] = item;
    },
    addItem(item) {
      const i = this.slots.findIndex((s) => !s);
      if (i < 0) return item;
      this.slots[i] = item;
      return undefined;
    },
  };
  const box = quarantined.find((q) => q.typeId.endsWith("shulker_box"));
  db.takeQuarantined(box.id, target);
  assert.deepEqual(target.slots[0].nbt, SHULKER_NBT);
  db.discardQuarantined(quarantined.find((q) => q.typeId === "minecraft:dirt").id);
  assert.equal(db.listQuarantined().length, 0);
  assert.equal(ownEntities(state).flatMap((e) => e.inventory.slots).filter(Boolean).length, 0);

  const second = await boot(state);
  await second.runtime.advance(100);
  assert.equal(second.db.getStatus().protection, undefined);
  assert.equal(second.db.listQuarantined().length, 0);
});

// ---- v4 审查回归用例 ----

test("rebuilding the index keeps stale copies cleanup-only (never takeable)", async () => {
  const state = createWorldState();
  const first = await boot(state);
  first.db.add(new ItemStack("minecraft:diamond", 1), { createdAt: 1 });
  const [entity] = ownEntities(state);
  const originalSetItem = entity.inventory.setItem;
  let failClear = true;
  entity.inventory.setItem = (index, item) => {
    if (!item && failClear) throw new Error("injected clear failure");
    return originalSetItem(index, item);
  };
  listItems(first.db)[0].unStore(false); // 已交付，实体中留下残留副本
  assert.equal(first.db.getStatus().staleCopies, 1);

  // 进入保护状态后由管理员重建
  entity.isValid = false;
  assert.throws(() => first.db.forEach(() => {}));
  entity.isValid = true;
  first.db.rebuildIndexFromEntities();

  assert.equal(first.db.listQuarantined().length, 0, "the handed-out diamond must not become takeable");
  assert.equal(first.db.getStatus().staleCopies, 1);

  failClear = false;
  await first.runtime.advance(60);
  assert.equal(entity.inventory.slots[0], undefined, "the stale copy is still cleaned up");

  const second = await boot(state);
  await second.runtime.advance(100);
  assert.equal(second.db.listQuarantined().length, 0);
  assert.equal(second.db.length, 0);
});
