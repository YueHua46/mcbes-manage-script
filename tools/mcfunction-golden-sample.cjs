/**
 * 从 .mcfunction 随机抽样若干行，输出转写后的 setblock，便于在游戏内手工 /execute 试跑（golden 抽检）。
 *
 * 用法:
 *   node tools/mcfunction-golden-sample.cjs models/mcfunction/foo.mcfunction
 *   node tools/mcfunction-golden-sample.cjs models/mcfunction/foo.mcfunction 20
 *
 * 环境变量 MCFUNCTION_GOLDEN_SEED=123 可固定随机种子（便于复现）。
 */
const fs = require("fs");
const path = require("path");
const { loadConfig, transpileSetblockLine } = require("./java-to-bedrock-setblock.cjs");

const ROOT = path.join(__dirname, "..");

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function collectSetblockLines(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  return lines.filter((l) => /^setblock ~\s*-?\d+ ~\s*-?\d+ ~\s*-?\d+ /i.test(l));
}

function sample(arr, n, rng) {
  if (n >= arr.length) return [...arr];
  const idx = new Set();
  while (idx.size < n) {
    idx.add(Math.floor(rng() * arr.length));
  }
  return [...idx].sort((a, b) => a - b).map((i) => arr[i]);
}

function main() {
  const fileArg = process.argv[2];
  const nArg = parseInt(process.argv[3] || "12", 10);
  if (!fileArg) {
    console.error("用法: node tools/mcfunction-golden-sample.cjs <path/to.mcfunction> [条数]");
    process.exit(1);
  }
  const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(ROOT, fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    process.exit(1);
  }

  const seed = Number(process.env.MCFUNCTION_GOLDEN_SEED) || Date.now() % 2147483647;
  const rng = mulberry32(seed);
  const setblocks = collectSetblockLines(filePath);
  if (setblocks.length === 0) {
    console.error("未找到 setblock 行");
    process.exit(1);
  }

  const cfg = loadConfig(ROOT);
  const picked = sample(setblocks, Math.min(nArg, 200), rng);
  console.log(`# seed=${seed} file=${path.relative(ROOT, filePath)} picked=${picked.length}/${setblocks.length}`);
  for (const line of picked) {
    try {
      console.log(transpileSetblockLine(line, cfg));
    } catch (e) {
      console.log(`# ERROR ${e instanceof Error ? e.message : e} <- ${line.slice(0, 100)}`);
    }
  }
}

main();
