const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const requiredFiles = [
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/pr-title.yml",
];

test("all contribution governance files exist", () => {
  for (const file of requiredFiles) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} is missing`);
  }
});

test("issue routing keeps support out of the issue tracker", () => {
  const config = read(".github/ISSUE_TEMPLATE/config.yml");
  assert.match(config, /blank_issues_enabled:\s*false/);
  assert.match(config, /\/discussions/);
  assert.match(config, /\/security\/advisories\/new/);
});

test("issue forms declare triage labels and project-specific environments", () => {
  const bug = read(".github/ISSUE_TEMPLATE/bug_report.yml");
  const feature = read(".github/ISSUE_TEMPLATE/feature_request.yml");
  assert.match(bug, /labels:\s*\["bug", "needs-triage"\]/);
  assert.match(feature, /labels:\s*\["enhancement", "needs-triage"\]/);
  for (const value of ["Realms", "BDS", "Backrooms"]) {
    assert.match(bug, new RegExp(value));
    assert.match(feature, new RegExp(value));
  }
});

test("pull requests document checks and use semantic title validation", () => {
  const template = read(".github/PULL_REQUEST_TEMPLATE.md");
  const workflow = read(".github/workflows/pr-title.yml");
  for (const value of ["npm run check", "Realms", "BDS", "Closes #"]) {
    assert.match(
      template,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(workflow, /amannn\/action-semantic-pull-request@v6/);
  assert.match(workflow, /pull-requests:\s*read/);
  for (const type of [
    "feat",
    "fix",
    "docs",
    "refactor",
    "test",
    "build",
    "ci",
    "chore",
    "perf",
    "style",
    "revert",
  ]) {
    assert.match(workflow, new RegExp(`\\n\\s+${type}\\s*(?:\\n|$)`));
  }
});

test("entry-point documents expose contribution, support, and security routes", () => {
  const readme = read("README.md");
  const contributing = read("CONTRIBUTING.md");
  for (const value of ["CONTRIBUTING.md", "/discussions", "SECURITY.md"]) {
    assert.match(
      readme,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(contributing, /贡献流程/);
  assert.match(contributing, /Contribution workflow/i);
});
