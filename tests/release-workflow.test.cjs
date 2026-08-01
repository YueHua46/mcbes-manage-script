const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const workflow = fs
  .readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")
  .replace(/\r\n?/g, "\n");

test("CI builds three downloadable variants for pushes and pull requests", () => {
  assert.match(workflow, /^on:\n(?:[\s\S]*?)  push:/m);
  assert.match(workflow, /^  pull_request:/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(workflow, /release_tag:/);
  assert.match(workflow, /variant:\s*standard/);
  assert.match(workflow, /variant:\s*realms/);
  assert.match(workflow, /variant:\s*bds/);
  assert.match(workflow, /npm run "\$\{\{ matrix\.script \}\}"/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /retention-days:\s*14/);
});

test("only the final gated release job receives write permission", () => {
  assert.match(workflow, /^permissions:\n  contents: read/m);
  assert.doesNotMatch(
    workflow.match(/^permissions:[\s\S]*?(?=^jobs:)/m)?.[0] || "",
    /contents:\s*write/
  );

  const releaseJob = workflow.match(/^  release:\n[\s\S]*$/m)?.[0];
  assert.ok(releaseJob, "release job must exist");
  assert.match(releaseJob, /needs:\s*\[verify, package\]/);
  assert.match(releaseJob, /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(releaseJob, /github\.event_name == 'workflow_dispatch'/);
  assert.match(releaseJob, /permissions:\n      contents: write/);
  assert.match(releaseJob, /actions\/download-artifact@v4/);
  assert.match(releaseJob, /gh release create/);
  assert.match(releaseJob, /gh release upload/);
  assert.match(releaseJob, /--verify-tag/);
  assert.match(releaseJob, /--clobber/);
});

test("manual releases must check out and validate an existing tag", () => {
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && inputs\.release_tag \|\| github\.ref/
  );
  assert.match(workflow, /git show-ref --verify/);
  assert.match(workflow, /npm run release:check -- --tag/);
  assert.match(workflow, /node tools\/release-metadata\.cjs verify-release-files/);
});
