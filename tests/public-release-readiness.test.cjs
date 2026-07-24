const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function listFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativeEntry = path.join(relativeDirectory, entry.name);
      return entry.isDirectory() ? listFiles(relativeEntry) : [relativeEntry];
    })
    .sort();
}

function directoryDigest(relativeDirectory) {
  const hash = crypto.createHash("sha256");
  const files = listFiles(relativeDirectory);
  for (const relativeFile of files) {
    hash.update(relativeFile.slice(relativeDirectory.length).split(path.sep).join("/"));
    hash.update(fs.readFileSync(path.join(root, relativeFile)));
  }
  return { count: files.length, sha256: hash.digest("hex") };
}

function fileDigest(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

test("repository uses a consistent noncommercial source-available license", () => {
  const license = read("LICENSE");
  const readme = read("README.md");

  assert.match(license, /PolyForm Noncommercial License 1\.0\.0/);
  assert.match(license, /https:\/\/polyformproject\.org\/licenses\/noncommercial\/1\.0\.0/);
  assert.doesNotMatch(readme, /\bMIT\b/i);
  assert.match(readme, /PolyForm Noncommercial License 1\.0\.0/);
  assert.match(readme, /非官方.*Minecraft|NOT AN OFFICIAL MINECRAFT/i);
});

test("public development environment and repository hygiene are documented", () => {
  const envExample = read(".env.example");
  const gitignore = read(".gitignore");

  assert.match(envExample, /^PROJECT_NAME=/m);
  assert.match(envExample, /^BDS_SERVER_DEPLOY_PATH=/m);
  assert.match(gitignore, /^\.vs\/?$/m);
  assert.match(gitignore, /^error\.log$/m);
  assert.match(gitignore, /^\.superpowers\/?$/m);
  assert.match(gitignore, /^\.DS_Store$/m);
});

test("approved DOVA encodes, audio records, and anime character resources stay byte-for-byte unchanged", () => {
  const dovaDigests = {
    "welcome.ogg": "17e848c6ede3cf39bb9c3ad9827cfbbdae6da5a81ccb9f8da799446800d8618a",
    "1.ogg": "cf501edaed8466cdf56ee55327936100c939e413ec72a9fdb154fc9744df3df9",
    "2.ogg": "afad750c80de227c1f5d840ae8b415870accb66abee183934b6ffd4fa45f997b",
    "3.ogg": "f2f1475bf983113f0454d0abf6522e47fa98fb29b6cb5bf0d975f68172fde6bb",
    "4.ogg": "1a87243145f193c40d48e9015234a1e7d71c2610b09b9f2b704cd5af62685077",
    "5.ogg": "812c1bd892036db04954718a8101f97c4ea53c9a56e033fd549e75dc8b4c6b5e",
    "6.ogg": "a4a913ac0c94a5ada9dd5bd6db063bdf5eb4f722f303aa4e55b7b3cf6638434d",
    "7.ogg": "d06f52f0fa02214f332fef5853c3e0a7398c477efdd8e0f99a7802fc54851001",
    "8.ogg": "00054087f7f52477b78837093266667ae14aa395d325977ddcddb0e9e063c115",
    "9.ogg": "a40e91fa54f6816650ea71b1613d6044dfca517bb375f5911ae495d6998ed0c1",
    "ATTRIBUTION.txt": "49b8780f08b17d033168a30223fd273489ca3308efdd53791fc7d7cdf4112b7f",
  };
  for (const [name, sha256] of Object.entries(dovaDigests)) {
    assert.equal(fileDigest(`resource_packs/CreeperMenu/sounds/${name}`), sha256, name);
  }
  assert.deepEqual(directoryDigest("backups/welcome-sounds-20260719"), {
    count: 12,
    sha256: "27fac6c30c6ba0a2dfc5f624c7496a4a213d2e5bef3c6f25f8908f4265c825be",
  });
  assert.deepEqual(directoryDigest("design/welcome-characters"), {
    count: 56,
    sha256: "e9e312bc388bb0bc76162fe46cb8da500294464d3e82c18b57b91322f0e37f58",
  });
  assert.deepEqual(directoryDigest("resource_packs/CreeperMenu/textures/entity"), {
    count: 16,
    sha256: "3a71af2141c1da002fbe977df4e84f0957385d76d7d47c03fdc257d6d5e30038",
  });
  assert.equal(
    fileDigest("resource_packs/CreeperMenu/font/glyph_E8.png"),
    "077b882f447bfb6f33819ff5a7526640be2988d398b7c7bf016dbe79dc8dfef4"
  );
});

test("README exposes the release essentials", () => {
  const readme = read("README.md");
  for (const required of [
    "docs/images/creeper-menu-banner.png",
    "普通兼容版",
    "Realms 兼容版",
    "BDS 增强版",
    "npm run build:realms",
    "npm run mcaddon:realms",
    "@minecraft/server-gametest",
    "安装",
    "npm run check",
    "第三方",
  ]) {
    assert.match(readme, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("README documents the automatic three-variant release workflow", () => {
  const readme = read("README.md");
  for (const required of [
    "CreeperMenu-v3.2.13-MCBE-1.26.3x-普通兼容版.mcaddon",
    "CreeperMenu-v3.2.13-MCBE-1.26.3x-Realms兼容版.mcaddon",
    "CreeperMenu-v3.2.13-MCBE-1.26.3x-BDS增强版.mcaddon",
    "npm run release:sync -- 3.2.14",
    "git tag v3.2.14",
    "git push origin v3.2.14",
    "1.26.30",
    "1.26.3x",
    "Backrooms",
    "独立版本",
  ]) {
    assert.match(readme, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
