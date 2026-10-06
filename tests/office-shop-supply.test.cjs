const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(relativePath, globals) {
  const filename = path.join(__dirname, "..", relativePath);
  const source = fs.readFileSync(filename, "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, ...globals }, { filename });
  return module.exports;
}

function stack(amount = 1) {
  return {
    amount,
    maxAmount: 64,
    typeId: "minecraft:stone",
    clone() {
      return stack(this.amount);
    },
  };
}

function harness(metadata = {}) {
  const entry = {
    item: stack(),
    data: { category: "blocks", amount: 5, price: 2, createdAt: 1, ...metadata },
    itemDB: { data: { slot: 0 } },
  };
  let entries = [entry];
  let balance = 100;
  let stored;
  let failDelivery = false;
  const dialogs = [];
  const mutations = [];
  const forms = [];
  let response = { canceled: true };
  class Form {
    constructor() {
      this.fields = [];
      forms.push(this);
    }
    title() {
      return this;
    }
    textField(label, placeholder, options) {
      this.fields.push({ label, options });
      return this;
    }
    toggle(label, options) {
      this.fields.push({ label, options });
      return this;
    }
    show() {
      return Promise.resolve(response);
    }
  }
  const officeShop = {
    getCategoryItems: () => entries,
    updateItemMeta(_old, updates) {
      mutations.push("update");
      entry.data = { ...entry.data, ...updates };
    },
    deleteItem() {
      mutations.push("delete");
      entries = [];
    },
    addItemToCategory(options) {
      mutations.push(options);
    },
  };
  const container = {
    size: 1,
    getItem: () => stored,
    setItem(_slot, item) {
      stored = item;
    },
    addItem(item) {
      if (failDelivery) throw new Error("delivery failed");
      stored = stack((stored?.amount ?? 0) + item.amount);
    },
  };
  const player = { name: "buyer", getComponent: () => ({ container }) };
  const globals = {
    officeShop,
    economic: {
      hasEnoughGold: (_name, amount) => balance >= amount,
      removeGold(_name, amount) {
        balance -= amount;
        return true;
      },
      addGold(_name, amount) {
        balance += amount;
        return amount;
      },
    },
    ModalFormData: Form,
    ChestUIUtility: { getItemDisplayName: () => "Stone", hasAnyEnchantment: () => false },
    getItemDisplayName: () => "Stone",
    colorCodes: {},
    SystemLog: { error() {} },
    openDialogForm(_player, dialog) {
      dialogs.push(dialog);
    },
  };
  const { officeShopForm } = load("scripts/ui/forms/economic/office-shop-form.ts", globals);
  const { officeShopSettingForm } = load("scripts/ui/forms/system/office-shop-setting.ts", globals);
  return {
    entry,
    dialogs,
    mutations,
    forms,
    officeShopSettingForm,
    purchase(qty, item = entry) {
      officeShopForm.executePurchase(player, item, qty, "blocks", 1);
    },
    player,
    get balance() {
      return balance;
    },
    get delivered() {
      return stored?.amount ?? 0;
    },
    setResponse(values) {
      response = { canceled: false, formValues: values };
    },
    failDelivery() {
      failDelivery = true;
    },
  };
}

test("unlimited supply supports repeated purchases beyond the stored amount without depleting the listing", () => {
  const h = harness({ unlimitedSupply: true, amount: 1 });
  h.purchase(10);
  h.purchase(10);
  assert.equal(h.balance, 60);
  assert.equal(h.delivered, 20);
  assert.equal(h.entry.data.amount, 1);
  assert.deepEqual(h.mutations, []);
});

test("legacy finite listings decrement stock and are removed when sold out", () => {
  const h = harness();
  h.purchase(2);
  assert.equal(h.entry.data.amount, 3);
  h.purchase(3);
  assert.deepEqual(h.mutations, ["update", "delete"]);
  h.purchase(1);
  assert.equal(h.balance, 90);
  assert.equal(h.delivered, 5);
});

test("checkout checks current stock and mode even when a buyer has an old unlimited listing", () => {
  const h = harness({ unlimitedSupply: true });
  const oldEntry = { ...h.entry, data: { ...h.entry.data } };
  h.entry.data.unlimitedSupply = false;
  h.entry.data.amount = 2;
  h.purchase(3, oldEntry);
  assert.equal(h.balance, 100);
  assert.equal(h.delivered, 0);
  assert.match(h.dialogs[0].desc, /库存不足/);
});

test("failed unlimited delivery refunds payment and restores the inventory", () => {
  const h = harness({ unlimitedSupply: true });
  h.failDelivery();
  h.purchase(2);
  assert.equal(h.balance, 100);
  assert.equal(h.delivered, 0);
  assert.deepEqual(h.mutations, []);
});

test("invalid purchase quantities and unsafe totals do not debit the buyer", () => {
  for (const qty of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) {
    const h = harness({ unlimitedSupply: true });
    h.purchase(qty);
    assert.equal(h.balance, 100);
    assert.equal(h.delivered, 0);
  }
});

test("admin can create either supply mode and unlimited mode ignores the stock field", async () => {
  for (const unlimited of [true, false]) {
    const h = harness();
    h.setResponse([unlimited, unlimited ? "" : "25", "3"]);
    h.officeShopSettingForm.openItemAddDetailsForm(h.player, "blocks", stack(), 0);
    await Promise.resolve();
    assert.equal(h.mutations[0].unlimitedSupply, unlimited);
    assert.equal(h.mutations[0].amount, unlimited ? 1 : 25);
  }
});

test("admin can switch existing listings between finite and unlimited supply", async () => {
  const h = harness();
  h.setResponse([true, "ignored", "3"]);
  h.officeShopSettingForm.openEditItemForm(h.player, "blocks", h.entry);
  await Promise.resolve();
  assert.equal(h.entry.data.unlimitedSupply, true);
  assert.equal(h.entry.data.amount, 5);
  assert.equal(h.forms[0].fields[0].options.defaultValue, false);
  h.setResponse([false, "12", "4"]);
  h.officeShopSettingForm.openEditItemForm(h.player, "blocks", h.entry);
  await Promise.resolve();
  assert.equal(h.forms[1].fields[0].options.defaultValue, true);
  assert.equal(h.entry.data.unlimitedSupply, false);
  assert.equal(h.entry.data.amount, 12);
});

test("finite stock rejects fractions and malformed numeric input", async () => {
  for (const amount of ["", "0", "-1", "1.5", "12abc", "Infinity"]) {
    const h = harness();
    h.setResponse([false, amount, "3"]);
    h.officeShopSettingForm.openItemAddDetailsForm(h.player, "blocks", stack(), 0);
    await Promise.resolve();
    assert.deepEqual(h.mutations, []);
    assert.match(h.dialogs[0].desc, /正整数/);
  }
});
