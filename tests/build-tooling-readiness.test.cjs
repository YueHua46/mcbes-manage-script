const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("package exposes one-command quality checks", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.test, "node --test tests/*.test.cjs");
  assert.equal(pkg.scripts.typecheck, "tsc --noEmit");
  assert.equal(pkg.scripts.check, "npm run lint && npm run typecheck && npm test");
});

test("event source directory uses portable lowercase casing", () => {
  const scriptEntries = fs.readdirSync(path.join(root, "scripts"));
  assert.equal(scriptEntries.includes("events"), true);
  assert.equal(scriptEntries.includes("Events"), false);

  for (const obsolete of ["chatSend.ts", "index.ts", "playerJoinAndLeave.ts", "playerSpawn.ts", "useItemEvent.ts"]) {
    assert.equal(fs.existsSync(path.join(root, "scripts", "events", obsolete)), false, obsolete);
  }
});

test("lint and build configuration do not require a deployment path at module load", () => {
  const config = fs.readFileSync(path.join(root, "just.config.ts"), "utf8");
  assert.doesNotMatch(config, /^const bdsServerDeployPath\s*=\s*getOrThrowFromProcess/m);
  assert.match(
    config,
    /function setBdsServerDeployEnv\(\)[\s\S]*getOrThrowFromProcess\("BDS_SERVER_DEPLOY_PATH"\)/
  );
});

test("GitHub Actions pip cache tracks the repository development requirements file", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(
    workflow,
    /uses:\s*actions\/setup-python@v5[\s\S]*?cache:\s*pip[\s\S]*?cache-dependency-path:\s*requirements-dev\.txt/
  );
});
