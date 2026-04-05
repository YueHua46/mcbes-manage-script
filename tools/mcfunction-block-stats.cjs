/**
 * 离线统计 .mcfunction 中的 setblock：唯一 Java 方块 ID、带 Java [] 状态的比例等（用于归类：ID / 状态 / 缺省状态）。
 *
 * 用法:
 *   node tools/mcfunction-block-stats.cjs
 *   node tools/mcfunction-block-stats.cjs models/mcfunction/foo.mcfunction
 */
const fs = require("fs");
const path = require("path");
const { analyzeSetblockLine } = require("./java-to-bedrock-setblock.cjs");

const ROOT = path.join(__dirname, "..");
const DEFAULT_GLOB_DIR = path.join(ROOT, "models", "mcfunction");

function collectLines(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function statsForFile(filePath) {
  const lines = collectLines(filePath);
  /** @type {Map<string, number>} */
  const idCount = new Map();
  let setblock = 0;
  let withJavaStates = 0;
  let other = 0;
  for (const line of lines) {
    const a = analyzeSetblockLine(line);
    if (a.kind !== "setblock") {
      other++;
      continue;
    }
    setblock++;
    if (a.hasJavaStates) withJavaStates++;
    const id = a.javaBase.toLowerCase();
    idCount.set(id, (idCount.get(id) || 0) + 1);
  }
  const unique = [...idCount.entries()].sort((x, y) => y[1] - x[1]);
  return {
    file: path.relative(ROOT, filePath),
    totalLines: lines.length,
    setblockLines: setblock,
    nonSetblockLines: other,
    javaStateBracketLines: withJavaStates,
    uniqueJavaBaseIds: idCount.size,
    topIds: unique.slice(0, 40),
  };
}

function main() {
  const arg = process.argv[2];
  let files;
  if (arg) {
    const p = path.isAbsolute(arg) ? arg : path.join(ROOT, arg);
    if (!fs.existsSync(p)) {
      console.error(`[mcfunction-block-stats] 文件不存在: ${p}`);
      process.exit(1);
    }
    files = [p];
  } else if (fs.existsSync(DEFAULT_GLOB_DIR)) {
    files = fs
      .readdirSync(DEFAULT_GLOB_DIR)
      .filter((f) => f.toLowerCase().endsWith(".mcfunction"))
      .map((f) => path.join(DEFAULT_GLOB_DIR, f));
  } else {
    console.error(`[mcfunction-block-stats] 未指定文件且缺少目录: ${DEFAULT_GLOB_DIR}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("[mcfunction-block-stats] 未找到 .mcfunction");
    process.exit(1);
  }

  for (const f of files) {
    const s = statsForFile(f);
    console.log(JSON.stringify(s, null, 2));
  }
}

main();
