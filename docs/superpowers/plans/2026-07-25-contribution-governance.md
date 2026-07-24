# Contribution Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bilingual, low-friction contribution workflow with structured Issues, a PR template, semantic PR-title validation, project policies, and matching GitHub repository settings.

**Architecture:** Repository files define the contributor-facing workflow and testable policy contracts. A small Node built-in test protects required templates, links, labels, and PR-title configuration; GitHub Actions runs the existing project checks plus a separate least-privilege PR-title workflow. GitHub repository settings provide Discussions, private vulnerability reports, labels, squash-only merges, and branch protection that cannot be fully represented in files.

**Tech Stack:** Markdown, GitHub Issue Forms YAML, GitHub Actions YAML, Node.js built-in test runner, GitHub repository settings.

## Global Constraints

- All contributor-facing templates are concise Chinese/English bilingual documents.
- Only PR titles are validated; individual commits are not validated.
- PR titles use `<type>(<optional-scope>): <subject>`.
- Allowed types are `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `style`, and `revert`.
- Scope is optional and unrestricted.
- `main` uses squash merge, with the PR title as the squash commit title.
- Questions and setup support go to Discussions; Issues track reproducible bugs and actionable features.
- Do not add release automation, Stale Bot, per-commit validation, mandatory scopes, or complex automatic labeling.
- Preserve all pre-existing user changes and do not commit generated output, `.env`, server configuration, credentials, or player data.

---

### Task 1: Add Governance Contract Tests

**Files:**
- Create: `tests/contribution-governance.test.cjs`

**Interfaces:**
- Consumes: repository files at fixed paths and Node.js built-ins `node:fs`, `node:path`, and `node:test`.
- Produces: test failures when a required contribution file, bilingual marker, label, Discussions link, security link, or PR-title action setting is missing.

- [ ] **Step 1: Write the failing contract tests**

Create `tests/contribution-governance.test.cjs` with tests that:

```js
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
    assert.match(template, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
  for (const value of [
    "CONTRIBUTING.md",
    "/discussions",
    "SECURITY.md",
  ]) {
    assert.match(readme, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(contributing, /贡献流程/);
  assert.match(contributing, /Contribution workflow/i);
});
```

- [ ] **Step 2: Run the test and verify the missing files fail**

Run:

```bash
node --test tests/contribution-governance.test.cjs
```

Expected: FAIL because `CONTRIBUTING.md` and the `.github` governance files do not exist.

- [ ] **Step 3: Commit the red test**

```bash
git add tests/contribution-governance.test.cjs
git commit -m "test: 定义贡献治理文件契约"
```

---

### Task 2: Add Contributor and Project Policy Documents

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `SECURITY.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing development commands from `README.md` and `package.json`, PolyForm Noncommercial terms from `LICENSE`, attribution rules from `THIRD_PARTY_NOTICES.md`.
- Produces: stable contributor, conduct, support, licensing, and private-security entry points referenced by templates and tests.

- [ ] **Step 1: Write `CONTRIBUTING.md`**

Use matching Chinese and English sections with these exact operational rules:

```text
Issue: reproducible bugs and agreed actionable features.
Discussions: installation, configuration, usage questions, and early ideas.
Security: private vulnerability report only; never a public Issue.

Setup:
npm ci
python3 -m pip install -r requirements-dev.txt
cp .env.example .env

Required checks:
npm run check
npm run build:standard
npm run build:realms
npm run verify:realms-build
npm run build:bds-admin
npm run build:backrooms

PR title:
<type>(<optional-scope>): <subject>
feat, fix, docs, refactor, test, build, ci, chore, perf, style, revert

Merge behavior:
Contributors may keep work-in-progress commits; maintainers squash the PR.
```

Also state that the repository is source-available under PolyForm Noncommercial rather than OSI open source, third-party assets retain their own terms, and contributors must not add unauthorized assets, secrets, server addresses, player data, generated output, or `.env`.

- [ ] **Step 2: Write `CODE_OF_CONDUCT.md`**

Adopt Contributor Covenant 2.1, retain its attribution and CC BY 4.0 notice, and add a bilingual project preface stating:

```text
中文：本项目致力于提供无骚扰的协作环境。请使用 GitHub 对相关内容或用户的举报功能报告行为事件，不要在公开 Issue 中披露敏感细节。
English: This project is committed to a harassment-free collaboration environment. Report conduct incidents through GitHub's reporting tools for the relevant content or account; do not disclose sensitive details in a public issue.
```

- [ ] **Step 3: Write `SECURITY.md`**

Use bilingual sections that state:

```text
Supported version: the latest release and current main branch.
Private report URL:
https://github.com/YueHua46/mcbes-manage-script/security/advisories/new
Never disclose credentials, real server addresses, player data, or exploit details in a public Issue.
Include affected version/commit, environment, build variant, impact, reproduction, and any proposed mitigation.
Maintainers acknowledge reports when available; no fixed response SLA is promised.
```

- [ ] **Step 4: Update README contribution entry points**

Replace the current short `## 贡献` body with concise links to:

```markdown
- [贡献指南](CONTRIBUTING.md)
- [GitHub Discussions](https://github.com/YueHua46/mcbes-manage-script/discussions)
- [安全政策](SECURITY.md)
```

Retain the existing `npm run ...` verification command block and surrounding license content.

- [ ] **Step 5: Run document contract tests**

Run:

```bash
node --test tests/contribution-governance.test.cjs
```

Expected: governance file existence tests progress; failures remain only for Issue/PR/workflow files created in later tasks.

- [ ] **Step 6: Commit project policies**

```bash
git add README.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md
git commit -m "docs: 添加双语贡献与项目政策"
```

---

### Task 3: Add Structured Issue and Pull Request Templates

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

**Interfaces:**
- Consumes: links and commands documented by Task 2.
- Produces: GitHub-native forms with stable label names `bug`, `enhancement`, and `needs-triage`, plus a PR checklist used by contributors and maintainers.

- [ ] **Step 1: Add the bilingual Bug Report form**

Configure:

```yaml
name: "错误报告 / Bug report"
description: "报告可复现的问题 / Report a reproducible problem"
title: "[Bug]: "
labels: ["bug", "needs-triage"]
body:
  - markdown welcome and support-routing text
  - required duplicate-search and latest-version checkboxes
  - required project version or commit input
  - required Minecraft version input
  - required deployment dropdown: Local world, Realms, BDS, BDS enhanced
  - required build dropdown: Standard, Realms, BDS enhanced, Backrooms
  - required problem, reproduction, expected, and actual textareas
  - optional logs, screenshots/video, and additional-context textareas
```

All visible prompts and validation messages must be Chinese/English bilingual.

- [ ] **Step 2: Add the bilingual Feature Request form**

Configure:

```yaml
name: "功能建议 / Feature request"
description: "建议可执行的改进 / Suggest an actionable improvement"
title: "[Feature]: "
labels: ["enhancement", "needs-triage"]
body:
  - markdown welcome and Discussions-routing text
  - required duplicate-search checkbox
  - required problem/use-case textarea
  - required proposed-solution textarea
  - optional alternatives textarea
  - required affected-area dropdown: Creeper Menu, Standard, Realms, BDS enhanced, Backrooms, Build/tooling, Documentation
  - required compatibility-impact textarea
  - optional implementation-willingness dropdown
  - optional additional-context textarea
```

- [ ] **Step 3: Add Issue routing configuration**

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: "使用问题与交流 / Questions & Support"
    url: "https://github.com/YueHua46/mcbes-manage-script/discussions"
    about: "安装、配置和使用问题请前往 Discussions / Use Discussions for setup, configuration, and support"
  - name: "安全漏洞 / Security vulnerability"
    url: "https://github.com/YueHua46/mcbes-manage-script/security/advisories/new"
    about: "请私密报告安全问题 / Report security issues privately"
```

- [ ] **Step 4: Add the bilingual PR template**

Include:

```text
Summary / 变更摘要
Related issue / 关联 Issue: Closes #
Change type / 变更类型
Affected variants: Standard, Realms, BDS enhanced, Backrooms
Validation checkboxes:
  npm run check
  npm run build:standard
  npm run build:realms
  npm run verify:realms-build
  npm run build:bds-admin
  npm run build:backrooms
Manual in-game test result or explicit "not tested"
Screenshots for UI/resource changes
Breaking change, migration, and compatibility notes
Contributor confirmation for secrets, server addresses, player data, generated files, and third-party redistribution rights
PR title examples and a note that maintainers squash merge
```

- [ ] **Step 5: Format and test templates**

Run:

```bash
npx prettier --check ".github/**/*.{yml,md}"
node --test tests/contribution-governance.test.cjs
```

Expected: Prettier reports all matched files formatted; governance tests fail only because `pr-title.yml` is not yet present.

- [ ] **Step 6: Commit templates**

```bash
git add .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs: 添加 Issue 与 PR 模板"
```

---

### Task 4: Add Semantic PR-Title Validation

**Files:**
- Create: `.github/workflows/pr-title.yml`
- Modify: `tests/contribution-governance.test.cjs`

**Interfaces:**
- Consumes: GitHub `pull_request_target` metadata and repository `GITHUB_TOKEN`.
- Produces: required check `PR Title / Validate title`; exports parsed type, optional scope, and subject only inside the workflow.

- [ ] **Step 1: Add the title-validation workflow**

Create:

```yaml
name: PR Title

on:
  pull_request_target:
    types: [opened, reopened, edited, synchronize]

permissions:
  pull-requests: read

jobs:
  validate:
    name: Validate title
    runs-on: ubuntu-latest
    steps:
      - name: Validate semantic pull request title
        uses: amannn/action-semantic-pull-request@v6
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          types: |
            feat
            fix
            docs
            refactor
            test
            build
            ci
            chore
            perf
            style
            revert
          requireScope: false
          subjectPattern: ^(?!.*[。.]\s*$).+$
          subjectPatternError: '标题描述不能以句号结尾 / The PR title subject must not end with a period: "{subject}"'
```

Do not check out or execute fork code in this privileged metadata-only workflow.

- [ ] **Step 2: Correct the contract test to parse the newline type list**

Ensure the type assertion uses:

```js
assert.match(workflow, new RegExp(`\\n\\s+${type}\\s*(?:\\n|$)`));
```

- [ ] **Step 3: Format and run all repository checks**

Run:

```bash
npx prettier --check ".github/**/*.{yml,md}" CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md README.md
npm run check
```

Expected: formatting check exits 0; ESLint, Prettier, TypeScript, and all Node tests exit 0.

- [ ] **Step 4: Build every supported variant**

Run:

```bash
npm run build:standard
npm run build:realms
npm run verify:realms-build
npm run build:bds-admin
npm run build:backrooms
```

Expected: all commands exit 0 and Realms verification reports no unsupported GameTest references.

- [ ] **Step 5: Commit validation workflow**

```bash
git add .github/workflows/pr-title.yml tests/contribution-governance.test.cjs
git commit -m "ci: 校验 Pull Request 标题"
```

---

### Task 5: Configure and Verify the GitHub Repository

**Files:**
- No repository file changes.

**Interfaces:**
- Consumes: authenticated GitHub browser session for `YueHua46/mcbes-manage-script`.
- Produces: enabled Discussions and private vulnerability reporting, squash-only merge settings, `bug`, `enhancement`, and `needs-triage` labels, and `main` protection requiring `CI / verify` and `PR Title / Validate title`.

- [ ] **Step 1: Push the implementation branch**

```bash
git push -u origin codex/contribution-governance
```

Expected: remote branch is created and tracks `origin/codex/contribution-governance`.

- [ ] **Step 2: Create or verify labels**

In repository Issues settings, ensure:

```text
bug            #d73a4a  Something isn't working
enhancement    #a2eeef  New feature or request
needs-triage   #fbca04  Needs maintainer review
```

- [ ] **Step 3: Enable community and security features**

In repository settings:

```text
Features > Discussions: enabled
Security > Private vulnerability reporting: enabled
```

Ensure Discussions contains `Q&A`, `Ideas`, and `Show and tell` categories.

- [ ] **Step 4: Configure merge behavior**

In pull request merge settings:

```text
Allow merge commits: disabled
Allow squash merging: enabled
Default commit message: Pull request title
Allow rebase merging: disabled
```

- [ ] **Step 5: Configure `main` rules**

Create a branch ruleset targeting `main`:

```text
Prevent deletion: enabled
Block force pushes: enabled
Require a pull request before merging: enabled
Required approvals: 0
Require status checks:
  CI / verify
  PR Title / Validate title
```

If GitHub does not allow selecting a new check until it has run once, merge or run the workflow first, then add `PR Title / Validate title`; report this exact remaining manual dependency rather than substituting another check.

- [ ] **Step 6: Verify remote and local outcomes**

Verify in GitHub UI:

```text
Issue creation shows Bug and Feature forms, with support and security links.
Pull request creation shows the bilingual checklist.
Discussions is visible.
Security policy and private report button are visible.
Only Squash and merge is offered.
main rules show the intended protection.
```

Verify locally:

```bash
git status --short
git log --oneline --decorate -6
git diff main...HEAD --check
git diff --stat main...HEAD
git ls-remote --heads origin codex/contribution-governance
```

Expected: clean status; only intended governance files differ from `main`; remote branch exists.
