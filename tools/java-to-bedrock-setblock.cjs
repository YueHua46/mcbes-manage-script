/**
 * 将 Java 版习惯的 setblock 行转为基岩版可解析的语法（tileName + 基岩 blockStates 括号规则）。
 * 由 tools/generate-mcfunction-models.cjs 在嵌入数据前调用。
 *
 * 失败分类（排障）：
 * - ID 不匹配：需在 data/java-to-bedrock-setblock.json 的 blockIds 补映射
 * - Java [] 状态：由本工具转为 ["k"=v,"k"="s"]；键名可用 globalStateKeyMap（如 axis→pillar_axis）
 * - 必选状态缺失：在 defaultStates 里按方块补默认状态（如釉陶 facing）
 * - 相对坐标：基岩版要求「~」与偏移数字连写（~-17、~53、~0），不要在中间插空格。
 *
 * 用法调试：node tools/java-to-bedrock-setblock.cjs --line "setblock ~0 ~0 ~0 minecraft:oak_log[axis=x]"
 */
const fs = require("fs");
const path = require("path");

/** 输入允许 ~-17 或已手写的 ~ -17（\s*） */
const SETBLOCK_PREFIX = /^setblock (~)\s*(-?\d+) (~)\s*(-?\d+) (~)\s*(-?\d+) /i;
const OLD_BLOCK_MODE = /\s+(destroy|keep|replace)\s*$/i;

/** @returns {Record<string, unknown>} */
function loadConfig(projectRoot) {
  const configPath = path.join(projectRoot, "data", "java-to-bedrock-setblock.json");
  const base = {
    options: {
      appendReplace: true,
      stripMinecraftPrefix: true,
      strictPalette: false,
    },
    blockIds: {},
    defaultStates: {},
    globalStateKeyMap: {},
    axisRemapBlockIdPatterns: [],
    allowedBlockIds: null,
  };
  if (!fs.existsSync(configPath)) {
    return base;
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const { options: _o, ...rest } = raw;
  return {
    ...base,
    ...rest,
    options: { ...base.options, ...(raw.options || {}) },
  };
}

/**
 * @param {string} spec 坐标后的整段（已去掉 destroy/keep/replace）
 */
function splitJavaBlockSpec(spec) {
  const s = spec.trim();
  const idx = s.indexOf("[");
  if (idx === -1) {
    return { baseId: s, javaStateStr: null };
  }
  let depth = 0;
  let j = idx;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`Unbalanced [] in block spec: ${s.slice(0, 100)}`);
  }
  const baseId = s.slice(0, idx).trim();
  const javaStateStr = s.slice(idx + 1, j - 1);
  const tail = s.slice(j).trim();
  if (tail.length > 0) {
    throw new Error(`Unexpected trailing after block states: ${tail.slice(0, 80)}`);
  }
  return { baseId, javaStateStr };
}

/** @param {string | null} javaStateStr */
function parseJavaStates(javaStateStr) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!javaStateStr || !javaStateStr.trim()) return out;
  for (const part of javaStateStr.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    let k = part.slice(0, eq).trim();
    let v = part.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

/** @param {string} blockId */
function shouldRemapAxis(blockId, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const id = blockId.toLowerCase();
  return patterns.some((p) => {
    try {
      return new RegExp(p, "i").test(id);
    } catch {
      return false;
    }
  });
}

/** @param {Record<string, string>} states */
function remapStateKeys(states, globalMap, blockId, axisPatterns) {
  /** @type {Record<string, string>} */
  const next = {};
  for (const [k, v] of Object.entries(states)) {
    let nk = globalMap[k] || k;
    if (k === "axis" && shouldRemapAxis(blockId, axisPatterns)) {
      nk = "pillar_axis";
    }
    next[nk] = v;
  }
  return next;
}

/** 釉陶：Java facing → 基岩 facing_direction（Down=0 Up=1 North=2 South=3 West=4 East=5） */
const CARDINAL_TO_FACING_DIRECTION = {
  north: "2",
  south: "3",
  west: "4",
  east: "5",
};

/**
 * @param {Record<string, string>} states
 * @param {string} mappedBlockIdNorm 已做 blockIds 映射后的 id（如 minecraft:silver_glazed_terracotta）
 */
function adaptGlazedTerracottaStates(states, mappedBlockIdNorm) {
  const id = String(mappedBlockIdNorm || "").toLowerCase();
  if (!/_glazed_terracotta$/i.test(id)) {
    return states;
  }
  if (!Object.prototype.hasOwnProperty.call(states, "facing")) {
    return states;
  }
  const v = String(states.facing || "").toLowerCase();
  const fd = CARDINAL_TO_FACING_DIRECTION[v];
  if (fd == null) {
    return states;
  }
  const next = { ...states };
  delete next.facing;
  next.facing_direction = fd;
  return next;
}

/** @param {Record<string, string>} statesObj */
function formatBedrockStates(statesObj) {
  const keys = Object.keys(statesObj);
  if (keys.length === 0) return "";
  const parts = [];
  for (const k of keys.sort()) {
    const v = statesObj[k];
    const bk = `"${String(k).replace(/"/g, '\\"')}"`;
    const vs = String(v);
    if (vs === "true" || vs === "false") {
      parts.push(`${bk}=${vs}`);
    } else if (/^-?\d+$/.test(vs)) {
      parts.push(`${bk}=${vs}`);
    } else {
      parts.push(`${bk}="${vs.replace(/"/g, '\\"')}"`);
    }
  }
  return ` [${parts.join(",")}]`;
}

function normalizeBlockId(id) {
  const t = id.trim();
  if (!t.includes(":")) return `minecraft:${t}`;
  return t;
}

function stripNamespace(id, strip) {
  if (!strip) return id;
  if (id.startsWith("minecraft:")) return id.slice("minecraft:".length);
  return id;
}

function resolveMappedId(normalizedJavaId, blockIds) {
  const lower = normalizedJavaId.toLowerCase();
  for (const [k, v] of Object.entries(blockIds)) {
    if (String(k).toLowerCase() === lower) return String(v);
  }
  return normalizedJavaId;
}

function lookupDefaultStates(cfg, javaIdNorm, bedrockIdNorm) {
  const d = cfg.defaultStates || {};
  const j = d[javaIdNorm] || d[javaIdNorm.toLowerCase()];
  const b = d[bedrockIdNorm] || d[bedrockIdNorm.toLowerCase()];
  return { ...(j || {}), ...(b || {}) };
}

/**
 * 基岩 setblock：每轴为「~」与数字无空格连写，轴与轴之间一个空格。
 * @param {string} tilde
 * @param {string} numStr 捕获的 -?\\d+
 */
function formatBedrockRelComponent(tilde, numStr) {
  return `${tilde}${numStr}`;
}

/**
 * 解析单轴相对坐标串（转写后的片段），用于生成器统计 dx/dy/dz。
 * @param {string} component 如 "~-58"、"~53"
 */
function parseRelComponentOffset(component) {
  const x = component.trim().match(/^~(-?\d+)$/);
  if (!x) {
    throw new Error(`无法解析相对坐标分量: ${component}`);
  }
  return Number(x[1]);
}

/**
 * @param {string} line
 * @param {ReturnType<loadConfig>} cfg
 * @param {{ paletteViolations?: string[] }} [ctx]
 */
function transpileSetblockLine(line, cfg, ctx) {
  const m = line.match(SETBLOCK_PREFIX);
  if (!m) {
    throw new Error(`非 setblock 或坐标格式不受支持: ${line.slice(0, 100)}`);
  }
  const rest = line.slice(m[0].length);
  let mode = null;
  let spec = rest;
  const mm = rest.match(OLD_BLOCK_MODE);
  if (mm) {
    mode = mm[1].toLowerCase();
    spec = rest.slice(0, rest.length - mm[0].length).trimEnd();
  }
  const { baseId: rawBase, javaStateStr } = splitJavaBlockSpec(spec);
  const javaNorm = normalizeBlockId(rawBase);
  const mappedId = resolveMappedId(javaNorm, cfg.blockIds || {});
  const javaStates = parseJavaStates(javaStateStr);
  const defaults = lookupDefaultStates(cfg, javaNorm, mappedId);
  /** @type {Record<string, string>} */
  let merged = { ...defaults, ...javaStates };
  merged = remapStateKeys(merged, cfg.globalStateKeyMap || {}, mappedId, cfg.axisRemapBlockIdPatterns || []);
  merged = adaptGlazedTerracottaStates(merged, mappedId);
  const opt = cfg.options || {};
  const tileOut = stripNamespace(mappedId, opt.stripMinecraftPrefix !== false);
  const bedrockStates = formatBedrockStates(merged);
  let suffix = "";
  if (mode) {
    suffix = ` ${mode}`;
  } else if (opt.appendReplace !== false) {
    suffix = ` replace`;
  }

  const xPart = formatBedrockRelComponent(m[1], m[2]);
  const yPart = formatBedrockRelComponent(m[3], m[4]);
  const zPart = formatBedrockRelComponent(m[5], m[6]);
  const out = `setblock ${xPart} ${yPart} ${zPart} ${tileOut}${bedrockStates}${suffix}`;

  const allowed = cfg.allowedBlockIds;
  if (Array.isArray(allowed) && allowed.length > 0) {
    const canon = normalizeBlockId(tileOut.includes(":") ? tileOut : `minecraft:${tileOut}`).toLowerCase();
    const ok = allowed.some((a) => String(a).toLowerCase() === canon || String(a).toLowerCase() === tileOut.toLowerCase());
    if (!ok) {
      const msg = `方块不在允许调色板中: ${tileOut}（来自 ${javaNorm}）`;
      if (opt.strictPalette || process.env.MCFUNCTION_STRICT_PALETTE === "1") {
        throw new Error(msg);
      }
      if (ctx && Array.isArray(ctx.paletteViolations)) {
        ctx.paletteViolations.push(msg);
      }
    }
  }

  return out;
}

/**
 * @param {string} line
 * @returns {{ kind: 'setblock', hasJavaStates: boolean, javaBase: string } | { kind: 'other' }}
 */
function analyzeSetblockLine(line) {
  const m = line.match(SETBLOCK_PREFIX);
  if (!m) return { kind: "other" };
  let rest = line.slice(m[0].length);
  const mm = rest.match(OLD_BLOCK_MODE);
  if (mm) {
    rest = rest.slice(0, rest.length - mm[0].length).trimEnd();
  }
  try {
    const { baseId, javaStateStr } = splitJavaBlockSpec(rest);
    return {
      kind: "setblock",
      hasJavaStates: Boolean(javaStateStr && javaStateStr.trim()),
      javaBase: normalizeBlockId(baseId),
    };
  } catch {
    return { kind: "other" };
  }
}

function mainCli() {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--line");
  if (idx === -1 || !argv[idx + 1]) {
    console.log("用法: node tools/java-to-bedrock-setblock.cjs --line \"setblock ...\"");
    process.exit(1);
  }
  const projectRoot = path.join(__dirname, "..");
  const cfg = loadConfig(projectRoot);
  const out = transpileSetblockLine(argv[idx + 1], cfg);
  console.log(out);
}

if (require.main === module) {
  mainCli();
}

module.exports = {
  loadConfig,
  transpileSetblockLine,
  analyzeSetblockLine,
  SETBLOCK_PREFIX,
  parseRelComponentOffset,
};
