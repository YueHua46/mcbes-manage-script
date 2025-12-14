/**
 * 数据库管理类
 * 用于持久化存储数据到世界动态属性
 */

import { world, system } from "@minecraft/server";

export class Database<V = any> {
  static readonly databases = new Array<Database<any>>();
  private cache!: Record<string, V>;
  private isDirty = false; // 标记数据库是否被修改

  public constructor(
    readonly name: string,
    private readonly defaultValue: string = "{}"
  ) {
    this.cache = Database.getAll(this.name, this.defaultValue);
    Database.databases.push(this);
  }

  /**
   * 设置键值
   * @remarks 不会立即保存，调用 .save() 或等待1分钟自动保存
   * @param property 键名
   * @param value 值
   */
  public set(property: string, value: V): void {
    this.cache[property] = value;
    this.isDirty = true; // 标记为已修改
  }

  /**
   * 获取键值
   * @param property 键名
   * @returns 该键对应的值（如果不存在则返回 undefined）
   */
  public get(property: string): V {
    return this.cache[property];
  }

  /**
   * 测试数据库是否包含某个键
   * @param property 键名
   * @returns 数据库是否包含该键
   */
  public has(property: string): boolean {
    return property in this.cache;
  }

  /**
   * 从数据库删除键
   * @remarks 不会立即保存，调用 .save() 或等待1分钟自动保存
   * @param property 要删除的键名
   * @returns 数据库是否原本包含该键
   */
  public delete(property: string): boolean {
    const result = delete this.cache[property];
    if (result) {
      this.isDirty = true; // 标记为已修改
    }
    return result;
  }

  /**
   * 获取数据库中所有键的数组
   * @returns 所有键的数组
   */
  public keys(): string[] {
    return Object.keys(this.cache);
  }

  /**
   * 获取数据库中所有值的数组
   * @returns 所有值的数组
   */
  public values(): V[] {
    return Object.values(this.cache);
  }

  /**
   * 清空数据库中的所有值
   * @remarks 立即保存
   */
  public clear() {
    this.cache = {};
    this.isDirty = true;
    this.save(true); // 强制保存
  }

  /**
   * 获取包含所有键值对的对象
   * @remarks 所有更改都会保存
   * @returns 包含所有键值对的对象
   */
  public getAll(): Record<string, V> {
    return (this.cache ??= Database.getAll(this.name, this.defaultValue));
  }

  /**
   * 立即保存数据库
   * @param force 强制保存，即使数据库未被修改
   */
  public save(force: boolean = false): void {
    // 如果数据库未被修改且不是强制保存，则跳过
    if (!force && !this.isDirty) {
      return;
    }

    const stringified = JSON.stringify(this.cache);
    const MAX_PROPERTY_SIZE = 32767; // Minecraft 动态属性的实际最大长度

    // 尝试使用不同的分块大小，从大到小，直到成功
    const chunkSizeOptions = [
      Math.floor(MAX_PROPERTY_SIZE * 0.95), // 31128 - 95% 安全边距
      Math.floor(MAX_PROPERTY_SIZE * 0.9), // 29490 - 90% 安全边距
      Math.floor(MAX_PROPERTY_SIZE * 0.85), // 27851 - 85% 安全边距
      Math.floor(MAX_PROPERTY_SIZE * 0.8), // 26213 - 80% 安全边距
      Math.floor(MAX_PROPERTY_SIZE * 0.75), // 24575 - 75% 安全边距
    ];

    for (const maxChunkSize of chunkSizeOptions) {
      try {
        // 如果数据长度超过单个块的限制，必须分块
        const index = Math.ceil(stringified.length / maxChunkSize);

        // 第一步：预先验证所有块的大小，确保都能保存（不实际保存）
        const chunks: string[] = [];
        let allChunksValid = true;

        for (let i = 0; i < index; i++) {
          const start = i * maxChunkSize;
          const end = Math.min((i + 1) * maxChunkSize, stringified.length);
          const chunk = stringified.slice(start, end);

          // 验证块长度不超过限制
          if (chunk.length > MAX_PROPERTY_SIZE) {
            allChunksValid = false;
            if (maxChunkSize === chunkSizeOptions[chunkSizeOptions.length - 1]) {
              // 如果已经是最小的分块大小，抛出错误
              throw new Error(
                `数据库 "${this.name}" 的第 ${i} 个数据块长度 (${chunk.length}) 超过限制 (${MAX_PROPERTY_SIZE})，即使使用最小分块大小 (${maxChunkSize}) 也无法保存`
              );
            }
            break; // 尝试下一个更小的分块大小
          }

          chunks.push(chunk);
        }

        // 如果所有块都有效，才进行实际保存
        if (allChunksValid && chunks.length === index) {
          // 第二步：保存所有块（原子性操作）
          // 先保存所有数据块，最后才更新 Index，确保数据完整性
          for (let i = 0; i < chunks.length; i++) {
            try {
              world.setDynamicProperty(`${this.name}:${i}`, chunks[i]);
            } catch (error: any) {
              // 如果保存时出错（可能是块太大），清理已保存的块并尝试下一个更小的分块大小
              if (error?.message?.includes("String length") || error?.message?.includes("out of bounds")) {
                // 清理已保存的块（可选，因为下次会用新的 Index）
                // 注意：这里不清理也可以，因为 Index 还没更新，读取时不会读到不完整的数据
                if (maxChunkSize === chunkSizeOptions[chunkSizeOptions.length - 1]) {
                  throw error;
                }
                allChunksValid = false;
                break;
              }
              throw error;
            }
          }

          // 第三步：只有在所有块都成功保存后，才更新 Index（原子性操作）
          if (allChunksValid) {
            world.setDynamicProperty(`${this.name}Index`, index);

            // 如果使用了更小的分块大小，记录警告
            if (maxChunkSize < chunkSizeOptions[0]) {
              console.warn(
                `[Database] 数据库 "${this.name}" 数据量较大，已自动使用更小的分块大小 ${maxChunkSize} 以确保安全保存`
              );
            }

            // 保存成功后，清除修改标记
            this.isDirty = false;
            return; // 保存成功，退出
          }
        }

        // 如果当前分块大小不合适，继续尝试下一个更小的分块大小
        if (!allChunksValid && maxChunkSize !== chunkSizeOptions[chunkSizeOptions.length - 1]) {
          continue;
        }
      } catch (error: any) {
        // 如果是最小的分块大小仍然失败，抛出错误
        if (maxChunkSize === chunkSizeOptions[chunkSizeOptions.length - 1]) {
          console.error(`[Database] 保存数据库 "${this.name}" 时发生错误:`, error);
          throw error;
        }
        // 否则继续尝试下一个更小的分块大小
        continue;
      }
    }
  }

  protected static save() {
    // 只保存被修改的数据库，提高效率
    this.databases.forEach((database) => {
      try {
        database.save(); // 默认只保存被修改的数据库
      } catch (error) {
        // 如果某个数据库保存失败，记录错误但继续保存其他数据库
        console.error(`[Database] 自动保存数据库 "${database.name}" 失败:`, error);
      }
    });
  }

  protected static getAll(name: string, defaultValue: string): Record<string, any> {
    let stringified = "";
    const index = world.getDynamicProperty(`${name}Index`) as number;

    if (!index) {
      world.setDynamicProperty(`${name}Index`, 1);
      world.setDynamicProperty(`${name}:0`, defaultValue);
      stringified = defaultValue;
    } else {
      const missingChunks: number[] = [];
      for (let i = 0; i < index; i++) {
        const value = world.getDynamicProperty(`${name}:${i}`) as string;
        if (value) {
          stringified += value;
        } else {
          missingChunks.push(i);
        }
      }

      // 如果有缺失的块，记录警告
      if (missingChunks.length > 0) {
        console.warn(
          `[Database] 数据库 "${name}" 缺少 ${missingChunks.length} 个数据块: [${missingChunks.join(", ")}]`
        );
      }
    }

    if (!stringified) return {};

    try {
      return JSON.parse(stringified);
    } catch (error) {
      // 如果 JSON 解析失败，说明数据可能损坏或不完整
      console.error(`[Database] 无法解析数据库 "${name}" 的数据:`, error);
      console.error(`[Database] 数据长度: ${stringified.length}, 期望块数: ${index || 1}`);
      console.error(`[Database] 损坏的数据预览: ${stringified.substring(0, 500)}...`);
      console.error(`[Database] 数据末尾预览: ...${stringified.substring(Math.max(0, stringified.length - 200))}`);

      // 尝试修复不完整的 JSON（特别是数组数据）
      const repaired = this.tryRepairJson(stringified);
      if (repaired !== null) {
        console.warn(`[Database] 成功修复数据库 "${name}" 的部分数据，已保留有效内容`);
        // 保存修复后的数据（使用动态修复机制）
        const repairedString = JSON.stringify(repaired);
        const MAX_PROPERTY_SIZE = 32767;
        const chunkSizeOptions = [
          Math.floor(MAX_PROPERTY_SIZE * 0.95), // 31128
          Math.floor(MAX_PROPERTY_SIZE * 0.9), // 29490
          Math.floor(MAX_PROPERTY_SIZE * 0.85), // 27851
          Math.floor(MAX_PROPERTY_SIZE * 0.8), // 26213
          Math.floor(MAX_PROPERTY_SIZE * 0.75), // 24575
        ];

        for (const maxChunkSize of chunkSizeOptions) {
          try {
            const newIndex = Math.ceil(repairedString.length / maxChunkSize);

            // 第一步：预先验证所有块的大小
            const chunks: string[] = [];
            let allChunksValid = true;

            for (let i = 0; i < newIndex; i++) {
              const start = i * maxChunkSize;
              const end = Math.min((i + 1) * maxChunkSize, repairedString.length);
              const chunk = repairedString.slice(start, end);

              if (chunk.length > MAX_PROPERTY_SIZE) {
                allChunksValid = false;
                if (maxChunkSize === chunkSizeOptions[chunkSizeOptions.length - 1]) {
                  throw new Error(
                    `数据库 "${name}" 修复后的第 ${i} 个数据块长度 (${chunk.length}) 超过限制 (${MAX_PROPERTY_SIZE})`
                  );
                }
                break;
              }

              chunks.push(chunk);
            }

            // 第二步：如果所有块都有效，才进行实际保存
            if (allChunksValid && chunks.length === newIndex) {
              // 先保存所有数据块
              for (let i = 0; i < chunks.length; i++) {
                try {
                  world.setDynamicProperty(`${name}:${i}`, chunks[i]);
                } catch (error: any) {
                  if (error?.message?.includes("String length") || error?.message?.includes("out of bounds")) {
                    if (maxChunkSize === chunkSizeOptions[chunkSizeOptions.length - 1]) {
                      throw error;
                    }
                    allChunksValid = false;
                    break;
                  }
                  throw error;
                }
              }

              // 第三步：只有在所有块都成功保存后，才更新 Index
              if (allChunksValid) {
                world.setDynamicProperty(`${name}Index`, newIndex);

                if (maxChunkSize < chunkSizeOptions[0]) {
                  console.warn(
                    `[Database] 数据库 "${name}" 修复后数据量较大，已自动使用更小的分块大小 ${maxChunkSize} 以确保安全保存`
                  );
                }
                break; // 保存成功，退出循环
              }
            }

            // 如果当前分块大小不合适，继续尝试下一个更小的分块大小
            if (!allChunksValid && maxChunkSize !== chunkSizeOptions[chunkSizeOptions.length - 1]) {
              continue;
            }
          } catch (error: any) {
            if (maxChunkSize === chunkSizeOptions[chunkSizeOptions.length - 1]) {
              throw error;
            }
            continue; // 尝试下一个更小的分块大小
          }
        }
        return repaired;
      }

      // 如果无法修复，尝试使用默认值
      try {
        const defaultData = JSON.parse(defaultValue);
        console.warn(`[Database] 数据库 "${name}" 数据已损坏，使用默认值重新初始化`);
        // 清空损坏的数据并重新初始化
        world.setDynamicProperty(`${name}Index`, 1);
        world.setDynamicProperty(`${name}:0`, defaultValue);
        return defaultData;
      } catch {
        // 如果默认值也无效，返回空对象
        console.warn(`[Database] 数据库 "${name}" 默认值无效，使用空对象`);
        world.setDynamicProperty(`${name}Index`, 1);
        world.setDynamicProperty(`${name}:0`, "{}");
        return {};
      }
    }
  }

  /**
   * 尝试修复损坏的 JSON 数据
   * @param corruptedJson 损坏的 JSON 字符串
   * @returns 修复后的对象，如果无法修复则返回 null
   */
  private static tryRepairJson(corruptedJson: string): Record<string, any> | null {
    try {
      // 尝试找到最后一个完整的 JSON 对象
      // 对于数组数据，尝试找到最后一个完整的数组项

      // 如果数据以 {"transactions":[... 开头，尝试修复数组
      if (corruptedJson.includes('"transactions"') && corruptedJson.includes("[")) {
        const transactionsStart = corruptedJson.indexOf('"transactions":[');
        if (transactionsStart !== -1) {
          const arrayStart = corruptedJson.indexOf("[", transactionsStart) + 1;
          let braceCount = 0;
          let bracketCount = 1; // 已经找到了开头的 [
          let lastValidIndex = arrayStart;
          let inString = false;
          let escapeNext = false;

          // 从数组开始位置查找最后一个完整的对象
          for (let i = arrayStart; i < corruptedJson.length; i++) {
            const char = corruptedJson[i];

            // 处理字符串内的字符
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            if (char === "\\") {
              escapeNext = true;
              continue;
            }
            if (char === '"') {
              inString = !inString;
              continue;
            }
            if (inString) continue;

            // 处理 JSON 结构
            if (char === "{") {
              braceCount++;
            } else if (char === "}") {
              braceCount--;
              if (braceCount === 0 && bracketCount === 1) {
                // 找到了一个完整的对象
                lastValidIndex = i + 1;
              }
            } else if (char === "[") {
              bracketCount++;
            } else if (char === "]") {
              bracketCount--;
              if (bracketCount === 0) {
                // 数组结束，但可能不完整
                break;
              }
            }
          }

          // 尝试构建完整的 JSON
          if (lastValidIndex > arrayStart) {
            const validPart = corruptedJson.substring(0, lastValidIndex);
            // 移除末尾可能的逗号
            const cleanedPart = validPart.replace(/,\s*$/, "");
            const repairedJson = cleanedPart + "]}";

            try {
              const parsed = JSON.parse(repairedJson);
              // 确保返回的数据结构正确
              if (parsed && typeof parsed === "object" && "transactions" in parsed) {
                return parsed;
              }
            } catch {
              // 修复失败，继续尝试其他方法
            }
          }
        }
      }

      // 通用修复：尝试找到最后一个完整的对象
      let lastBrace = -1;
      let braceCount = 0;
      for (let i = 0; i < corruptedJson.length; i++) {
        if (corruptedJson[i] === "{") {
          braceCount++;
        } else if (corruptedJson[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            lastBrace = i;
          }
        }
      }

      if (lastBrace > 0) {
        const repairedJson = corruptedJson.substring(0, lastBrace + 1);
        try {
          return JSON.parse(repairedJson);
        } catch {
          // 修复失败
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}

// 每秒自动保存所有数据库
system.runInterval(() => {
  //@ts-ignore
  Database.save();
}, 20);
