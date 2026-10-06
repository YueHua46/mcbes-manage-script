const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const forms = [];
class ActionFormData {
  constructor() {
    this.buttons = [];
    forms.push(this);
  }
  title() {
    return this;
  }
  button(label, texture) {
    this.buttons.push({ label, texture });
    return this;
  }
  show() {
    return Promise.resolve({ canceled: false, selection: 9 });
  }
}
function load(relative) {
  const built = esbuild.buildSync({
    entryPoints: [path.join(root, relative)],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["@minecraft/server", "@minecraft/server-ui"],
  });
  const module = { exports: {} };
  vm.runInNewContext(built.outputFiles[0].text, {
    module,
    exports: module.exports,
    require(name) {
      if (name === "@minecraft/server-ui") return { ActionFormData };
      if (name === "@minecraft/server")
        return {
          ItemEnchantableComponent: { componentId: "minecraft:enchantable" },
          ItemPotionComponent: { componentId: "minecraft:potion" },
        };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return module.exports;
}
const { ChestFormData, FurnaceFormData } = load("scripts/ui/components/chest-ui/chest-forms.ts");
const { vanillaItemIconPaths } = load("scripts/assets/vanilla-item-icon-paths.ts");
const { getChestItemTextureKey } = load("scripts/ui/components/chest-ui/item-chest-display.ts");

test("all 1604 vanilla items reach ActionForm as texture paths, never numeric strings", async () => {
  const entries = Object.entries(vanillaItemIconPaths);
  assert.equal(entries.length, 1604);
  for (let offset = 0; offset < entries.length; offset += 54) {
    const form = new ChestFormData(54);
    const batch = entries.slice(offset, offset + 54);
    batch.forEach(([id], slot) => form.button(slot, id, [], id, 1, 0, true));
    await form.show({});
    batch.forEach(([id, expected], slot) => {
      const actual = forms.at(-1).buttons[slot].texture;
      assert.match(actual, /^textures\//, id);
      if (id !== "minecraft:shield") assert.equal(actual, expected, id);
    });
  }
});

test("ItemStack, pattern and furnace preserve paths for stable and shifted items", async () => {
  for (const id of ["minecraft:stick", "minecraft:poplar_stairs", "minecraft:apple", "minecraft:red_shrub"]) {
    assert.match(
      getChestItemTextureKey({
        typeId: id,
        getComponent() {
          return undefined;
        },
      }),
      /^textures\//,
      id
    );
  }
  const chest = new ChestFormData(9);
  chest.pattern(["A"], { A: { itemName: "stairs", texture: "minecraft:poplar_stairs", enchanted: true } });
  await chest.show({});
  assert.match(forms.at(-1).buttons[0].texture, /^textures\//);
  const furnace = new FurnaceFormData();
  furnace.button(0, "stick", [], "minecraft:stick", 64, 25, true);
  await furnace.show({});
  assert.equal(forms.at(-1).buttons[0].texture, "textures/items/stick");
  assert.equal(forms.at(-1).buttons[0].label.rawtext[0].text, "stack#64dur#25§r");
});

test("appended inventory preserves visible icons, quantity and source slot", async () => {
  const item = {
    typeId: "minecraft:stick",
    amount: 64,
    localizationKey: "item.stick.name",
    getLore() {
      return [];
    },
    getComponent() {
      return undefined;
    },
  };
  const player = {
    getComponent() {
      return {
        container: {
          size: 2,
          getItem(i) {
            return i === 0 ? item : undefined;
          },
        },
      };
    },
  };
  const result = await new ChestFormData(9).show(player, { appendViewerInventory: true });
  assert.equal(forms.at(-1).buttons[9].texture, "textures/items/stick");
  assert.equal(forms.at(-1).buttons[9].label.rawtext[0].text, "stack#64dur#00§r");
  assert.equal(forms.at(-1).buttons[10].texture, undefined);
  assert.equal(result.inventorySlot, 0);
});
