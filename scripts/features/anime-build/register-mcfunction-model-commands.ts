/**
 * models/mcfunction 下各 .mcfunction：先按世界 chunk 列分桶，再按 TickingAreaManager 容量切条带；
 * 每条条带 createTickingArea（await 至区块加载）后放置方块；优先用 setBlockType/setBlockPermutation。
 * 源行若为 Java 常用方块名（如 snow_block、waxed_copper_block），须映射到基岩注册 id，否则命令解析器会报「意外的 tileName」，
 * 且 setBlockType 也无法识别；釉陶等方块的 facing 状态在此转为基岩 facing_direction。
 */
import {
  system,
  world,
  CustomCommand,
  CommandPermissionLevel,
  CustomCommandOrigin,
  CustomCommandResult,
  CustomCommandStatus,
  CustomCommandRegistry,
  CustomCommandError,
  CustomCommandErrorReason,
  Dimension,
  Player,
  TickingAreaError,
  TickingAreaManager,
  CustomCommandParamType,
  CommandError,
  BlockPermutation,
} from "@minecraft/server";
import { color } from "../../shared/utils/color";
import {
  MCFUNCTION_MODEL_IDS,
  MCFUNCTION_MODELS,
  type McfunctionModelBundle,
  type McfunctionModelId,
} from "../../generated/mcfunction-models/registry";

function registerCommandIgnoreReloadLock(
  registry: CustomCommandRegistry,
  command: CustomCommand,
  handler: (origin: CustomCommandOrigin, ...args: unknown[]) => CustomCommandResult
): void {
  try {
    registry.registerCommand(command, handler as (o: CustomCommandOrigin) => CustomCommandResult);
  } catch (e) {
    if (e instanceof CustomCommandError && e.reason === CustomCommandErrorReason.RegistryReadOnly) {
      return;
    }
    throw e;
  }
}

const MCFUNCTION_COMMANDS_PER_TICK = 500;
const MCFUNCTION_BUCKET_YIELD_EVERY = 4000;
const MCFUNCTION_PROGRESS_EVERY_LINES = 20000;
/** 单次建造最多向玩家展示的关键错误条数（避免刷屏） */
const MCFUNCTION_RUN_FAILURE_LOG_MAX = 12;
/** 聊天里每条失败样例中命令预览的最大长度（完整命令见 console / 内容日志） */
const MCFUNCTION_RUN_FAILURE_CMD_MAX_LEN = 140;

/** 写入内容日志（创作者菜单 → 内容日志 / Content Log），便于整段复制 */
function logMcfunctionFailure(modelId: string, errLabel: string, errMsg: string, detail: string): void {
  console.warn(`[yuehua:mcfunction][${modelId}] 放置失败 (${errLabel}): ${errMsg}\n${detail}`);
}

const SETBLOCK_RELATIVE_THREE = /^setblock (~-?\d+) (~-?\d+) (~-?\d+) (.+)$/;

function parseTildeOffsetToken(token: string): number {
  const m = token.match(/^~(-?\d+)$/);
  if (!m) {
    throw new Error(`非法相对坐标分量: ${token}`);
  }
  return Number(m[1]);
}

function stripSetblockTailMode(tail: string): string {
  return tail.replace(/\s+(replace|destroy|keep)\s*$/i, "").trimEnd();
}

function ensureBlockTypeNamespace(typeId: string): string {
  return typeId.includes(":") ? typeId : `minecraft:${typeId}`;
}

/** 与 data/java-to-bedrock-setblock.json、@minecraft/vanilla-data 中基岩 id 对齐 */
const JAVA_TO_BEDROCK_BLOCK_ID: Record<string, string> = {
  "minecraft:snow_block": "minecraft:snow",
  "minecraft:waxed_copper_block": "minecraft:waxed_copper",
  "minecraft:light_gray_glazed_terracotta": "minecraft:silver_glazed_terracotta",
  "minecraft:red_nether_bricks": "minecraft:red_nether_brick",
  "minecraft:nether_quartz_ore": "minecraft:quartz_ore",
  "minecraft:rooted_dirt": "minecraft:dirt_with_roots",
  "minecraft:terracotta": "minecraft:hardened_clay",
  "minecraft:note_block": "minecraft:noteblock",
};

function mapJavaBlockTypeToBedrock(javaNamespacedId: string): string {
  return JAVA_TO_BEDROCK_BLOCK_ID[javaNamespacedId] ?? javaNamespacedId;
}

/** 基岩釉陶等：Java facing → facing_direction（0 Down … 2 North … 5 East） */
const CARDINAL_TO_FACING_DIRECTION: Record<string, number> = {
  north: 2,
  south: 3,
  west: 4,
  east: 5,
};

function adaptGlazedTerracottaStatesForBedrock(
  bedrockTypeId: string,
  states: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const id = bedrockTypeId.toLowerCase();
  if (!/_glazed_terracotta$/i.test(id)) {
    return { ...states };
  }
  if (!Object.prototype.hasOwnProperty.call(states, "facing")) {
    return { ...states };
  }
  const raw = states.facing;
  const key = typeof raw === "string" ? raw.toLowerCase() : "";
  const fd = CARDINAL_TO_FACING_DIRECTION[key];
  if (fd === undefined) {
    return { ...states };
  }
  const next = { ...states };
  delete next.facing;
  next.facing_direction = fd;
  return next;
}

function extractSetblockOldBlockMode(tail: string): string {
  const m = tail.match(/\s+(replace|destroy|keep)\s*$/i);
  return m ? m[1].toLowerCase() : "replace";
}

/** 与构建期 formatBedrockStates 一致，供 runCommand 回退 */
function formatBedrockStatesBracket(states: Record<string, string | number | boolean>): string {
  const keys = Object.keys(states);
  if (keys.length === 0) {
    return "";
  }
  const parts: string[] = [];
  for (const k of keys.sort()) {
    const v = states[k];
    const bk = `"${String(k).replace(/"/g, '\\"')}"`;
    if (typeof v === "boolean") {
      parts.push(`${bk}=${v}`);
    } else if (typeof v === "number") {
      parts.push(`${bk}=${v}`);
    } else {
      parts.push(`${bk}="${String(v).replace(/"/g, '\\"')}"`);
    }
  }
  return ` [${parts.join(",")}]`;
}

function bedrockTileNameForCommand(bedrockTypeId: string): string {
  return bedrockTypeId.startsWith("minecraft:") ? bedrockTypeId.slice("minecraft:".length) : bedrockTypeId;
}

interface ParsedRelSetblock {
  ax: number;
  ay: number;
  az: number;
  /** 源行中的 Java/通用名（补 blockIds 时用此键） */
  javaTypeId: string;
  bedrockTypeId: string;
  states: Record<string, string | number | boolean>;
  mode: string;
}

function parseRelSetblockLine(line: string, ox: number, oy: number, oz: number): ParsedRelSetblock | null {
  const m = line.match(SETBLOCK_RELATIVE_THREE);
  if (!m) {
    return null;
  }
  const tail = m[4];
  const tailNoMode = stripSetblockTailMode(tail);
  const { typeId: rawType, statesBracket } = splitEmbeddedTypeAndStates(tailNoMode);
  const javaId = ensureBlockTypeNamespace(rawType);
  const bedrockTypeId = mapJavaBlockTypeToBedrock(javaId);
  let states: Record<string, string | number | boolean> =
    statesBracket && statesBracket !== "[]" ? bracketStatesToRecord(statesBracket) : {};
  states = adaptGlazedTerracottaStatesForBedrock(bedrockTypeId, states);
  return {
    ax: ox + parseTildeOffsetToken(m[1]),
    ay: oy + parseTildeOffsetToken(m[2]),
    az: oz + parseTildeOffsetToken(m[3]),
    javaTypeId: javaId,
    bedrockTypeId,
    states,
    mode: extractSetblockOldBlockMode(tail),
  };
}

function bedrockAbsoluteSetblockCommand(p: ParsedRelSetblock): string {
  const tile = bedrockTileNameForCommand(p.bedrockTypeId);
  const bracket = formatBedrockStatesBracket(p.states);
  return `setblock ${p.ax} ${p.ay} ${p.az} ${tile}${bracket} ${p.mode}`;
}

/** 从 tail 解析：方块 id + 基岩方括号状态（若有） */
function splitEmbeddedTypeAndStates(tailWithoutMode: string): { typeId: string; statesBracket: string | null } {
  const s = tailWithoutMode.trim();
  const i = s.indexOf("[");
  if (i === -1) {
    const id = s.split(/\s+/)[0] ?? "";
    return { typeId: id, statesBracket: null };
  }
  const typeId = s.slice(0, i).trim();
  let depth = 0;
  let j = i;
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
    throw new Error(`setblock 方括号不配平: ${s.slice(0, 80)}`);
  }
  const bracket = s.slice(i, j);
  const rest = s.slice(j).trim();
  if (rest.length > 0) {
    throw new Error(`setblock 尾部多余: ${rest}`);
  }
  return { typeId, statesBracket: bracket };
}

/** 命令串里 ["k"=v,"k"="s"] → resolve 用对象 */
function bracketStatesToRecord(bracket: string): Record<string, string | number | boolean> {
  const inner = bracket.slice(1, -1).trim();
  const out: Record<string, string | number | boolean> = {};
  if (!inner) return out;
  for (const part of inner.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    let val = part.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      out[key] = val.slice(1, -1);
    } else if (val === "true" || val === "false") {
      out[key] = val === "true";
    } else if (/^-?\d+$/.test(val)) {
      out[key] = Number(val);
    } else {
      out[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

/**
 * 用方块 API 放置（主路径）；失败再以 **基岩 id + 基岩状态** 绝对坐标 setblock 回退。
 */
function placeMcfunctionSetblockLine(dim: Dimension, line: string, ox: number, oy: number, oz: number): void {
  const parsed = parseRelSetblockLine(line, ox, oy, oz);
  if (!parsed) {
    dim.runCommand(`execute positioned ${ox} ${oy} ${oz} run ${line}`);
    return;
  }
  const loc = { x: parsed.ax, y: parsed.ay, z: parsed.az };
  const runFallbackCommand = (): void => {
    dim.runCommand(bedrockAbsoluteSetblockCommand(parsed));
  };

  try {
    if (Object.keys(parsed.states).length > 0) {
      try {
        dim.setBlockPermutation(
          loc,
          BlockPermutation.resolve(parsed.bedrockTypeId as any, parsed.states as any)
        );
      } catch {
        dim.setBlockType(loc, parsed.bedrockTypeId);
      }
    } else {
      dim.setBlockType(loc, parsed.bedrockTypeId);
    }
  } catch {
    runFallbackCommand();
  }
}

interface WcBand {
  minWcX: number;
  maxWcX: number;
  z0: number;
  z1: number;
}

interface McfunctionSession {
  cancelRequested: boolean;
  reporter: Player;
  runId: number;
  modelId: McfunctionModelId;
  /** 剩余可向玩家展示的放置失败样例条数 */
  runCommandFailureLogBudget: number;
  /**
   * setblock 命令解析阶段报「意外的 tileName」类错误时，记录源 javaTypeId（Set 自动去重），
   * 建造结束后打 console 便于补 data/java-to-bedrock-setblock.json。
   */
  setblockParseFailureJavaTypeIds: Set<string>;
}

/** 是否像 tileName 不被命令解析器接受的报错（中文客户端多为弯引号 “”，不能用只匹配 ASCII 引号的正则） */
function isSetblockTileNotAcceptedByCommandError(e: unknown): boolean {
  if (!(e instanceof CommandError)) {
    return false;
  }
  const msg = e.message;
  if (/意外的/.test(msg)) {
    return true;
  }
  if (/parsing command params/i.test(msg) && /unexpected/i.test(msg)) {
    return true;
  }
  return false;
}

let mcfunctionSession: McfunctionSession | undefined;

function floorBlockCoord(n: number): number {
  return Math.floor(n);
}

function waitTicks(count: number): Promise<void> {
  return new Promise((resolve) => {
    system.runTimeout(() => resolve(), count);
  });
}

function isMcfunctionModelId(id: string): id is McfunctionModelId {
  return (MCFUNCTION_MODEL_IDS as readonly string[]).includes(id);
}

function tickingAreaSlug(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9_]/g, "_");
}

function computeBands(
  mgr: TickingAreaManager,
  dim: Dimension,
  ox: number,
  oy: number,
  oz: number,
  rel: McfunctionModelBundle["REL_BOUNDS"]
): WcBand[] {
  const minWcX = Math.floor((ox + rel.minX) / 16);
  const maxWcX = Math.floor((ox + rel.maxX) / 16);
  const minWcZ = Math.floor((oz + rel.minZ) / 16);
  const maxWcZ = Math.floor((oz + rel.maxZ) / 16);
  const bands: WcBand[] = [];

  function hasCap(xa: number, xb: number, zStart: number, zEnd: number): boolean {
    const from = { x: xa * 16, y: oy + rel.minY, z: zStart * 16 };
    const to = { x: xb * 16 + 15, y: oy + rel.maxY, z: zEnd * 16 + 15 };
    return mgr.hasCapacity({ dimension: dim, from, to });
  }

  function decomposeX(xa: number, xb: number): void {
    let zz = minWcZ;
    while (zz <= maxWcZ) {
      let zEnd = maxWcZ;
      while (zEnd >= zz && !hasCap(xa, xb, zz, zEnd)) {
        zEnd--;
      }
      if (zEnd < zz) {
        if (xa >= xb) {
          throw new Error("单层 chunk 列仍超出常加载 chunk 配额，请提高配额或缩小模型");
        }
        const mid = Math.floor((xa + xb) / 2);
        decomposeX(xa, mid);
        decomposeX(mid + 1, xb);
        return;
      }
      bands.push({ minWcX: xa, maxWcX: xb, z0: zz, z1: zEnd });
      zz = zEnd + 1;
    }
  }

  decomposeX(minWcX, maxWcX);
  return bands;
}

function collectLinesForBand(bucket: Map<string, string[]>, band: WcBand): string[] {
  const out: string[] = [];
  for (let wz = band.z0; wz <= band.z1; wz++) {
    for (let wx = band.minWcX; wx <= band.maxWcX; wx++) {
      const chunkLines = bucket.get(`${wx},${wz}`);
      if (chunkLines) {
        out.push(...chunkLines);
      }
    }
  }
  return out;
}

async function buildBucket(
  ox: number,
  oz: number,
  session: McfunctionSession,
  data: McfunctionModelBundle
): Promise<Map<string, string[]>> {
  const bucket = new Map<string, string[]>();
  let done = 0;
  let lastBroadcast = 0;
  const parts = data.LINE_PARTS;
  const coordParts = data.COORD_PARTS;
  const totalLines = data.TOTAL_LINES;
  const tag = session.modelId;

  for (let pi = 0; pi < parts.length; pi++) {
    const lines = parts[pi];
    const cds = coordParts[pi];
    for (let i = 0; i < lines.length; i++) {
      if (session.cancelRequested) {
        return bucket;
      }
      const pair = cds[i];
      const dx = pair[0];
      const dz = pair[1];
      const wcX = Math.floor((ox + dx) / 16);
      const wcZ = Math.floor((oz + dz) / 16);
      const key = `${wcX},${wcZ}`;
      let arr = bucket.get(key);
      if (!arr) {
        arr = [];
        bucket.set(key, arr);
      }
      arr.push(lines[i]);
      done++;
      if (done - lastBroadcast >= MCFUNCTION_PROGRESS_EVERY_LINES) {
        lastBroadcast = done;
        session.reporter.sendMessage(
          color.gray(`[${tag}] 分桶 ${done} / ${totalLines}（约 ${((100 * done) / totalLines).toFixed(1)}%）`)
        );
      }
      if (done % MCFUNCTION_BUCKET_YIELD_EVERY === 0) {
        await waitTicks(1);
      }
    }
  }
  return bucket;
}

async function runCommandBatch(
  dim: Dimension,
  ox: number,
  oy: number,
  oz: number,
  lines: readonly string[],
  session: McfunctionSession,
  progressLabel: string
): Promise<number> {
  let failed = 0;
  let inBatch = 0;
  let done = 0;
  let lastBroadcast = 0;
  for (const line of lines) {
    if (session.cancelRequested) {
      break;
    }
    const parsedLine = parseRelSetblockLine(line, ox, oy, oz);
    const fullCmd = parsedLine ? bedrockAbsoluteSetblockCommand(parsedLine) : `execute positioned ${ox} ${oy} ${oz} run ${line}`;
    try {
      placeMcfunctionSetblockLine(dim, line, ox, oy, oz);
    } catch (e) {
      failed++;
      if (parsedLine && isSetblockTileNotAcceptedByCommandError(e)) {
        session.setblockParseFailureJavaTypeIds.add(parsedLine.javaTypeId);
      }
      if (session.runCommandFailureLogBudget > 0) {
        session.runCommandFailureLogBudget--;
        const cmdShown =
          fullCmd.length > MCFUNCTION_RUN_FAILURE_CMD_MAX_LEN
            ? `${fullCmd.slice(0, MCFUNCTION_RUN_FAILURE_CMD_MAX_LEN)}…`
            : fullCmd;
        const errLabel = e instanceof CommandError ? "CommandError" : e instanceof Error ? e.name : "unknown";
        const errMsg = e instanceof Error ? e.message : String(e);
        logMcfunctionFailure(
          session.modelId,
          errLabel,
          errMsg,
          `fullCommand: ${fullCmd}`
        );
        session.reporter.sendMessage(
          color.red(`[${session.modelId}] 放置失败 (${errLabel}): ${errMsg} | ${cmdShown}`)
        );
      }
    }
    done++;
    inBatch++;
    if (done - lastBroadcast >= MCFUNCTION_PROGRESS_EVERY_LINES) {
      lastBroadcast = done;
      session.reporter.sendMessage(color.gray(`${progressLabel} ${done} / ${lines.length}`));
    }
    if (inBatch >= MCFUNCTION_COMMANDS_PER_TICK) {
      inBatch = 0;
      await waitTicks(1);
    }
  }
  return failed;
}

async function runMcfunctionBuild(
  dim: Dimension,
  ox: number,
  oy: number,
  oz: number,
  session: McfunctionSession,
  data: McfunctionModelBundle
): Promise<void> {
  const mgr = world.tickingAreaManager;
  const rel = data.REL_BOUNDS;
  const totalLines = data.TOTAL_LINES;
  const modelId = session.modelId;
  const slug = tickingAreaSlug(modelId);
  let totalFailed = 0;

  try {
    world.sendMessage(
      color.aqua(
        `[${modelId}] 分桶中… 本包常加载 chunk 上限 ${mgr.maxChunkCount}，当前已由脚本占 ${mgr.chunkCount}；` +
          `每 tick 最多 ${MCFUNCTION_COMMANDS_PER_TICK} 条命令。`
      )
    );
    const bucket = await buildBucket(ox, oz, session, data);
    if (session.cancelRequested) {
      world.sendMessage(color.yellow(`[${modelId}] 已在分桶阶段取消（已处理 ${bucket.size} 个 chunk 列）。`));
      return;
    }

    let bands: WcBand[];
    try {
      bands = computeBands(mgr, dim, ox, oy, oz, rel);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      world.sendMessage(color.red(`[${modelId}] 划分常加载条带失败：${msg}`));
      return;
    }

    world.sendMessage(
      color.aqua(`[${modelId}] 分桶完成，${bucket.size} 个 chunk 列；${bands.length} 个条带，开始放置。`)
    );

    for (let bi = 0; bi < bands.length; bi++) {
      if (session.cancelRequested) {
        break;
      }
      const band = bands[bi];
      const from = {
        x: band.minWcX * 16,
        y: oy + rel.minY,
        z: band.z0 * 16,
      };
      const to = {
        x: band.maxWcX * 16 + 15,
        y: oy + rel.maxY,
        z: band.z1 * 16 + 15,
      };
      const id = `yuehua_mcfn_${slug}_${session.runId}_${bi}`;
      try {
        await mgr.createTickingArea(id, { dimension: dim, from, to });
      } catch (e) {
        if (e instanceof TickingAreaError) {
          world.sendMessage(color.red(`[${modelId}] createTickingArea 失败：${e.reason}`));
        } else {
          world.sendMessage(color.red(`[${modelId}] createTickingArea 失败：${String(e)}`));
        }
        break;
      }
      try {
        const bandLines = collectLinesForBand(bucket, band);
        const failHere = await runCommandBatch(
          dim,
          ox,
          oy,
          oz,
          bandLines,
          session,
          `[${modelId}] 条带 ${bi + 1}/${bands.length}`
        );
        totalFailed += failHere;
      } finally {
        try {
          mgr.removeTickingArea(id);
        } catch {
          /* unknown id */
        }
      }
    }
  } finally {
    mcfunctionSession = undefined;
    if (session.cancelRequested) {
      world.sendMessage(color.yellow(`[${modelId}] 已取消；放置失败累计 ${totalFailed} 条。`));
      if (totalFailed > 0) {
        console.warn(
          `[yuehua:mcfunction][${modelId}] 建造已取消；放置失败累计 ${totalFailed} 条（源 ${totalLines} 行）。详情见上文的 console.warn / 游戏内「内容日志」。`
        );
      }
    } else {
      const tail =
        totalFailed > MCFUNCTION_RUN_FAILURE_LOG_MAX
          ? `；上方至多展示 ${MCFUNCTION_RUN_FAILURE_LOG_MAX} 条失败示例`
          : "";
      world.sendMessage(
        color.green(`[${modelId}] 已结束；放置失败 ${totalFailed} 条（源 ${totalLines} 行）${tail}。`)
      );
      if (totalFailed > 0) {
        console.warn(
          `[yuehua:mcfunction][${modelId}] 建造已结束；放置失败 ${totalFailed} 条（源 ${totalLines} 行）。完整失败命令与报错见本窗口 console.warn（游戏内：设置 → 创作者 → 内容日志，便于复制）。`
        );
      }
    }
    const badTiles = [...session.setblockParseFailureJavaTypeIds].sort();
    if (badTiles.length > 0) {
      console.warn(
        `[yuehua:mcfunction][${modelId}] 本次建造「setblock 解析不认识的 tile」去重后的源 typeId（维护：补 JAVA_TO_BEDROCK_BLOCK_ID / data/java-to-bedrock-setblock.json）：\n` +
          badTiles.join("\n")
      );
    }
  }
}

function handleAbortTickingAreas(): void {
  try {
    world.tickingAreaManager.removeAllTickingAreas();
  } catch {
    /* */
  }
}

function startBuild(player: Player, modelId: McfunctionModelId): CustomCommandResult {
  if (mcfunctionSession !== undefined) {
    player.sendMessage(
      color.yellow(
        `[mcfunction] 已有任务在运行（${mcfunctionSession.modelId}），请先 /yuehua:mcfunction_cancel 或等待完成。`
      )
    );
    return { status: CustomCommandStatus.Failure };
  }

  const data = MCFUNCTION_MODELS[modelId];
  const dim = player.dimension;
  const ox = floorBlockCoord(player.location.x);
  const oy = floorBlockCoord(player.location.y);
  const oz = floorBlockCoord(player.location.z);

  const session: McfunctionSession = {
    cancelRequested: false,
    reporter: player,
    runId: Date.now(),
    modelId,
    runCommandFailureLogBudget: MCFUNCTION_RUN_FAILURE_LOG_MAX,
    setblockParseFailureJavaTypeIds: new Set(),
  };
  mcfunctionSession = session;

  system.run(() => {
    void runMcfunctionBuild(dim, ox, oy, oz, session, data).catch((e) => {
      mcfunctionSession = undefined;
      world.sendMessage(color.red(`[${modelId}] 异常中断：${e instanceof Error ? e.message : String(e)}`));
    });
  });

  return { status: CustomCommandStatus.Success };
}

function handleMcfunctionBuildCommand(origin: CustomCommandOrigin, ...args: unknown[]): CustomCommandResult {
  const player = origin.sourceEntity;
  if (!player || player.typeId !== "minecraft:player") {
    return { status: CustomCommandStatus.Failure };
  }
  const p = player as Player;

  const rawArg = args[0];
  const modelIdArg = typeof rawArg === "string" ? rawArg : undefined;
  const trimmed = modelIdArg?.trim();
  if (!trimmed) {
    p.sendMessage(
      color.yellow(
        `用法: /yuehua:mcfunction_build <模型id>（与 models/mcfunction 下文件名一致，不含 .mcfunction）。` +
          ` 查看列表: /yuehua:mcfunction_list`
      )
    );
    return { status: CustomCommandStatus.Failure };
  }

  if (!isMcfunctionModelId(trimmed)) {
    p.sendMessage(
      color.red(
        `未知模型 id「${trimmed}」。可用: ${MCFUNCTION_MODEL_IDS.join(", ")}`
      )
    );
    return { status: CustomCommandStatus.Failure };
  }

  return startBuild(p, trimmed);
}

function handleMcfunctionListCommand(origin: CustomCommandOrigin, ..._args: unknown[]): CustomCommandResult {
  const player = origin.sourceEntity;
  if (!player || player.typeId !== "minecraft:player") {
    return { status: CustomCommandStatus.Failure };
  }
  const p = player as Player;
  p.sendMessage(color.green(`已编译的 mcfunction 模型（models/mcfunction）：${MCFUNCTION_MODEL_IDS.join(", ")}`));
  return { status: CustomCommandStatus.Success };
}

function handleMcfunctionCancelCommand(origin: CustomCommandOrigin, ..._args: unknown[]): CustomCommandResult {
  const player = origin.sourceEntity;
  if (!player || player.typeId !== "minecraft:player") {
    return { status: CustomCommandStatus.Failure };
  }
  const p = player as Player;

  if (mcfunctionSession === undefined) {
    p.sendMessage(color.yellow("[mcfunction] 当前没有进行中的任务。"));
    return { status: CustomCommandStatus.Success };
  }

  mcfunctionSession.cancelRequested = true;
  handleAbortTickingAreas();
  world.sendMessage(color.yellow("[mcfunction] 已请求取消；条带常加载区已尝试移除。"));
  return { status: CustomCommandStatus.Success };
}

/** 兼容旧档：固定建造 anime_1 */
function handleLegacyAnime1BuildCommand(origin: CustomCommandOrigin, ..._args: unknown[]): CustomCommandResult {
  const player = origin.sourceEntity;
  if (!player || player.typeId !== "minecraft:player") {
    return { status: CustomCommandStatus.Failure };
  }
  const p = player as Player;
  if (!isMcfunctionModelId("anime_1")) {
    p.sendMessage(color.red("[anime1] 当前构建未包含 anime_1 模型，请向 models/mcfunction 放入 anime_1.mcfunction 后重新构建。"));
    return { status: CustomCommandStatus.Failure };
  }
  return startBuild(p, "anime_1");
}

export function registerMcfunctionModelCommands(registry: CustomCommandRegistry): void {
  const listCmd: CustomCommand = {
    name: "yuehua:mcfunction_list",
    description: "列出已由构建嵌入的 mcfunction 模型 id（与 models/mcfunction 下文件名一致）",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registerCommandIgnoreReloadLock(registry, listCmd, handleMcfunctionListCommand);

  const buildCmd: CustomCommand = {
    name: "yuehua:mcfunction_build",
    description:
      "以当前玩家脚下方块为原点，按模型 id 分片执行 setblock（models/mcfunction/<id>.mcfunction，仅管理员）",
    permissionLevel: CommandPermissionLevel.Admin,
    optionalParameters: [{ type: CustomCommandParamType.String, name: "模型id(同文件名，不含.mcfunction)" }],
  };
  registerCommandIgnoreReloadLock(registry, buildCmd, handleMcfunctionBuildCommand);

  const cancelCmd: CustomCommand = {
    name: "yuehua:mcfunction_cancel",
    description: "取消进行中的 mcfunction 建造并移除本脚本常加载区（仅管理员）",
    permissionLevel: CommandPermissionLevel.Admin,
  };
  registerCommandIgnoreReloadLock(registry, cancelCmd, handleMcfunctionCancelCommand);

  const legacyBuild: CustomCommand = {
    name: "yuehua:anime1_build",
    description:
      "（兼容）等同 /yuehua:mcfunction_build anime_1：以当前脚下方块为原点建造 anime_1（仅管理员）",
    permissionLevel: CommandPermissionLevel.Admin,
  };
  registerCommandIgnoreReloadLock(registry, legacyBuild, handleLegacyAnime1BuildCommand);

  const legacyCancel: CustomCommand = {
    name: "yuehua:anime1_cancel",
    description: "（兼容）等同 /yuehua:mcfunction_cancel",
    permissionLevel: CommandPermissionLevel.Admin,
  };
  registerCommandIgnoreReloadLock(registry, legacyCancel, handleMcfunctionCancelCommand);
}
