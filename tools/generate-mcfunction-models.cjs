/**
 * 扫描 models/mcfunction/*.mcfunction，为每个文件生成分片 JSON + index.js/index.d.ts，
 * 并生成 registry.ts（模型 id = 文件名去掉 .mcfunction，仅允许 [a-zA-Z0-9_-]+）。
 *
 * 用法: node tools/generate-mcfunction-models.cjs
 */
const fs = require("fs");
const path = require("path");
const {
  loadConfig,
  transpileSetblockLine,
  parseRelComponentOffset,
} = require("./java-to-bedrock-setblock.cjs");

const ROOT = path.join(__dirname, "..");
const INPUT_DIR = path.join(ROOT, "models", "mcfunction");
const OUT_ROOT = path.join(ROOT, "scripts", "generated", "mcfunction-models");
const LINES_PER_PART = 3500;
/** 转写后三轴均为「~」与数字连写（~-58 ~53 ~-1）；见 java-to-bedrock-setblock */
const SETBLOCK_REL = /^setblock (~-?\d+) (~-?\d+) (~-?\d+)/;
const ID_RE = /^[a-zA-Z0-9_-]+$/;

function assertValidId(id, sourcePath) {
  if (!ID_RE.test(id)) {
    console.error(
      `[generate-mcfunction-models] 非法模型 id「${id}」（仅允许字母数字、下划线、连字符）: ${sourcePath}`
    );
    process.exit(1);
  }
}

function processOneFile(mcfunctionPath, modelId, bedrockCfg) {
  const raw = fs.readFileSync(mcfunctionPath, "utf8");
  let lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) {
    console.error(`[generate-mcfunction-models] 文件无有效命令行: ${mcfunctionPath}`);
    process.exit(1);
  }

  const paletteCtx = { paletteViolations: [] };
  lines = lines.map((line, idx) => {
    try {
      return transpileSetblockLine(line, bedrockCfg, paletteCtx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[generate-mcfunction-models] Java→Bedrock 转写失败 「${modelId}」第 ${idx + 1} 行: ${msg}\n  ${line.slice(0, 160)}`
      );
      process.exit(1);
    }
  });

  if (paletteCtx.paletteViolations.length > 0) {
    const uniq = [...new Set(paletteCtx.paletteViolations)];
    console.warn(
      `[generate-mcfunction-models] 「${modelId}」调色板非严格警告 ${uniq.length} 类（options.strictPalette 或 MCFUNCTION_STRICT_PALETTE=1 可改为失败）:`
    );
    uniq.slice(0, 15).forEach((t) => console.warn(`  - ${t}`));
    if (uniq.length > 15) console.warn(`  … 另 ${uniq.length - 15} 类`);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const allCoords = [];

  for (const line of lines) {
    const m = line.match(SETBLOCK_REL);
    if (!m) {
      console.error(`[generate-mcfunction-models] 无法解析坐标: ${line.slice(0, 80)}`);
      process.exit(1);
    }
    const dx = parseRelComponentOffset(m[1]);
    const dy = parseRelComponentOffset(m[2]);
    const dz = parseRelComponentOffset(m[3]);
    allCoords.push([dx, dz]);
    minX = Math.min(minX, dx);
    maxX = Math.max(maxX, dx);
    minY = Math.min(minY, dy);
    maxY = Math.max(maxY, dy);
    minZ = Math.min(minZ, dz);
    maxZ = Math.max(maxZ, dz);
  }

  const modelDir = path.join(OUT_ROOT, modelId);
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  for (const f of fs.readdirSync(modelDir)) {
    if (
      /^part_\d{3}\.json$/u.test(f) ||
      /^part_\d{3}\.coords\.json$/u.test(f) ||
      f === "index.js" ||
      f === "index.d.ts"
    ) {
      fs.unlinkSync(path.join(modelDir, f));
    }
  }

  const parts = [];
  const coordParts = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PART) {
    parts.push(lines.slice(i, i + LINES_PER_PART));
    coordParts.push(allCoords.slice(i, i + LINES_PER_PART));
  }

  const importLines = [];
  const coordImportLines = [];
  const idents = [];
  const coordIdents = [];
  for (let p = 0; p < parts.length; p++) {
    const suffix = String(p).padStart(3, "0");
    const fname = `part_${suffix}.json`;
    const cname = `part_${suffix}.coords.json`;
    const ident = `part_${suffix}`;
    const cident = `coords_${suffix}`;
    fs.writeFileSync(path.join(modelDir, fname), JSON.stringify(parts[p]), "utf8");
    fs.writeFileSync(path.join(modelDir, cname), JSON.stringify(coordParts[p]), "utf8");
    importLines.push(`import ${ident} from "./${fname}";`);
    coordImportLines.push(`import ${cident} from "./${cname}";`);
    idents.push(ident);
    coordIdents.push(cident);
  }

  const boundsObj = { minX, minY, minZ, maxX, maxY, maxZ };
  const boundsJson = JSON.stringify(boundsObj);

  const indexJs = `/* eslint-disable */
/** AUTO-GENERATED — 勿手改。由 tools/generate-mcfunction-models.cjs（含 Java→Bedrock setblock 转写）根据 models/mcfunction/${modelId}.mcfunction 生成。 */
${importLines.join("\n")}
${coordImportLines.join("\n")}

export const LINE_PARTS = [${idents.join(", ")}];
export const COORD_PARTS = [${coordIdents.join(", ")}];
export const REL_BOUNDS = ${boundsJson};
export const TOTAL_LINES = ${lines.length};
`;

  const indexDts = `/** AUTO-GENERATED — 勿手改 */
export interface RelBounds {
    readonly minX: number;
    readonly minY: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly maxZ: number;
}
export declare const LINE_PARTS: readonly (readonly string[])[];
export declare const COORD_PARTS: readonly (readonly [number, number][])[];
export declare const REL_BOUNDS: RelBounds;
export declare const TOTAL_LINES: number;
`;

  fs.writeFileSync(path.join(modelDir, "index.js"), indexJs, "utf8");
  fs.writeFileSync(path.join(modelDir, "index.d.ts"), indexDts, "utf8");

  console.log(
    `[generate-mcfunction-models] 「${modelId}」${lines.length} 条命令 → ${parts.length} 个分片；REL_BOUNDS ${boundsJson}`
  );

  return { modelId, lineCount: lines.length, partCount: parts.length };
}

function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`[generate-mcfunction-models] 缺少目录: ${INPUT_DIR}`);
    process.exit(1);
  }

  const entries = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".mcfunction"))
    .map((f) => ({
      full: path.join(INPUT_DIR, f),
      id: path.basename(f, path.extname(f)),
    }));

  if (entries.length === 0) {
    console.error(`[generate-mcfunction-models] 未找到任何 .mcfunction: ${INPUT_DIR}`);
    process.exit(1);
  }

  const seen = new Set();
  for (const e of entries) {
    assertValidId(e.id, e.full);
    const low = e.id.toLowerCase();
    if (seen.has(low)) {
      console.error(`[generate-mcfunction-models] 模型 id 冲突（大小写不敏感）: ${e.id}`);
      process.exit(1);
    }
    seen.add(low);
  }

  if (!fs.existsSync(OUT_ROOT)) {
    fs.mkdirSync(OUT_ROOT, { recursive: true });
  }

  /** 移除曾生成但已无源文件的模型目录 */
  const validIds = new Set(entries.map((e) => e.id));
  for (const name of fs.readdirSync(OUT_ROOT)) {
    const sub = path.join(OUT_ROOT, name);
    if (!fs.statSync(sub).isDirectory()) continue;
    if (!validIds.has(name) && name !== "README.md") {
      fs.rmSync(sub, { recursive: true, force: true });
      console.log(`[generate-mcfunction-models] 已删除过期的生成目录: ${name}`);
    }
  }

  const bedrockCfg = loadConfig(ROOT);
  const results = [];
  for (const e of entries.sort((a, b) => a.id.localeCompare(b.id))) {
    results.push(processOneFile(e.full, e.id, bedrockCfg));
  }

  const importLines = results.map((r) => `import * as ${safeJsIdent(r.modelId)} from "./${r.modelId}/index.js";`);
  const safeIdent = (id) => safeJsIdent(id);
  const registryLines = results.map(
    (r) => `  "${r.modelId}": bundle(${safeIdent(r.modelId)}),`
  );

  const registryTs = `/** AUTO-GENERATED — 勿手改。由 tools/generate-mcfunction-models.cjs（含 Java→Bedrock setblock）生成。 */
${importLines.join("\n")}

function bundle(m: {
  LINE_PARTS: readonly (readonly string[])[];
  COORD_PARTS: readonly (readonly [number, number][])[];
  REL_BOUNDS: McfunctionModelBundle["REL_BOUNDS"];
  TOTAL_LINES: number;
}): McfunctionModelBundle {
  return {
    LINE_PARTS: m.LINE_PARTS,
    COORD_PARTS: m.COORD_PARTS,
    REL_BOUNDS: m.REL_BOUNDS,
    TOTAL_LINES: m.TOTAL_LINES,
  };
}

export interface McfunctionModelBundle {
  readonly LINE_PARTS: readonly (readonly string[])[];
  readonly COORD_PARTS: readonly (readonly [number, number][])[];
  readonly REL_BOUNDS: {
    readonly minX: number;
    readonly minY: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly maxZ: number;
  };
  readonly TOTAL_LINES: number;
}

export const MCFUNCTION_MODEL_IDS = [${results.map((r) => `"${r.modelId}"`).join(", ")}] as const;

export type McfunctionModelId = (typeof MCFUNCTION_MODEL_IDS)[number];

export const MCFUNCTION_MODELS: { readonly [K in McfunctionModelId]: McfunctionModelBundle } = {
${registryLines.join("\n")}
};
`;

  fs.writeFileSync(path.join(OUT_ROOT, "registry.ts"), registryTs, "utf8");

  console.log(
    `[generate-mcfunction-models] 完成：${results.length} 个模型 → ${path.relative(ROOT, OUT_ROOT)}`
  );
}

/** 将 modelId 转为合法 JS 标识符（用于 import * as） */
function safeJsIdent(modelId) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(modelId)) return modelId;
  return `_${modelId.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

main();
