const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "behavior_packs/CreeperMenu/manifest.json");
const bundlePath = path.join(root, "dist/scripts/main.js");

if (!fs.existsSync(manifestPath) || !fs.existsSync(bundlePath)) {
  throw new Error("找不到 Realms 构建产物，请先运行 npm run build:realms");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const bundle = fs.readFileSync(bundlePath, "utf8");
const modules = (manifest.dependencies ?? []).map((dependency) => dependency.module_name).filter(Boolean);

for (const unsupported of [
  "@minecraft/server-gametest",
  "@minecraft/server-admin",
  "@minecraft/server-net",
  "@minecraft/debug-utilities",
]) {
  if (modules.includes(unsupported)) {
    throw new Error(`Realms manifest 包含不支持模块: ${unsupported}`);
  }
}

if (bundle.includes("@minecraft/server-gametest")) {
  throw new Error("Realms JavaScript 仍引用 @minecraft/server-gametest");
}

console.log("Realms 构建验证通过：manifest 不声明受限模块，脚本不含 GameTest。");
