const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("release version is injected into runtime code by the build", () => {
  const release = JSON.parse(read("release.config.json"));
  const buildConfig = read("just.config.ts");
  const globals = read("scripts/global.d.ts");
  const metadata = read("scripts/build-metadata.ts");
  const bootstrap = read("scripts/bootstrap.ts");
  const runtimeConfig = read("scripts/core/config.ts");

  assert.match(buildConfig, /__APP_VERSION__:\s*JSON\.stringify\(releaseConfig\.version\)/);
  assert.match(
    buildConfig,
    /__MINECRAFT_VERSION_FAMILY__:\s*JSON\.stringify\(minecraftFamily\(releaseConfig\.minecraftVersion\)\)/
  );
  assert.match(globals, /declare const __APP_VERSION__:\s*string/);
  assert.match(globals, /declare const __MINECRAFT_VERSION_FAMILY__:\s*string/);
  assert.match(metadata, /APP_VERSION\s*=\s*__APP_VERSION__/);
  assert.match(metadata, /MINECRAFT_VERSION_FAMILY\s*=\s*__MINECRAFT_VERSION_FAMILY__/);
  assert.match(bootstrap, /APP_VERSION/);
  assert.match(bootstrap, /适配游戏版本：MCBE \$\{MINECRAFT_VERSION_FAMILY\} 及以上/);
  assert.match(runtimeConfig, /version:\s*APP_VERSION/);
  assert.doesNotMatch(bootstrap, new RegExp(`v${release.version.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(runtimeConfig, new RegExp(release.version.replaceAll(".", "\\.")));
});
