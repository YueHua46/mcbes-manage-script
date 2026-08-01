const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("all CreeperMenu variants share one bootstrap implementation", () => {
  const bootstrap = read("scripts/bootstrap.ts");

  assert.match(bootstrap, /export function bootstrap/);
  assert.match(bootstrap, /eventRegistry\.initializeAll\(\)/);
  assert.match(bootstrap, /scheduleItemIconKeyCacheWarmup\(\)/);

  for (const variant of ["standard", "realms", "bds"]) {
    const entry = read(`scripts/main.${variant}.ts`);
    assert.match(entry, /import \{ bootstrap \} from "\.\/bootstrap"/);
    assert.match(entry, new RegExp(`bootstrap\\(startupVariants\\.${variant}\\)`));
    assert.doesNotMatch(entry, /function initializeApp/);
    assert.doesNotMatch(entry, /eventRegistry\.initializeAll/);
    assert.doesNotMatch(entry, /features\/one-click/);
  }
});

test("startup differences live in typed variant configuration", () => {
  const variants = read("scripts/startup-variants.ts");

  assert.match(variants, /export interface StartupVariant/);
  assert.match(variants, /standard:/);
  assert.match(variants, /realms:/);
  assert.match(variants, /bds:/);
  assert.match(variants, /Realms 兼容版（仅旧版实体假人）/);
  assert.match(variants, /BDS 增强版（仅 BDS 服务器）/);
});
