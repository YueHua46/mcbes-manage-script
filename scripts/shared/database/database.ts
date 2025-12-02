/**
 * 数据库管理类
 * 用于持久化存储数据到世界动态属性
 */

import { world, system } from "@minecraft/server";

export class Database<V = any> {
  static readonly databases = new Array<Database<any>>();
  private cache = Database.getAll(this.name, this.defaultValue);

  public constructor(
    readonly name: string,
    private readonly defaultValue: string = "{}"
  ) {
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
    return delete this.cache[property];
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
    this.save();
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
   */
  public save(): void {
    const stringified = JSON.stringify(this.cache);
    const maxChunkSize = 30000; // 最大字符串长度
    const index = Math.ceil(stringified.length / maxChunkSize);
    
    world.setDynamicProperty(`${this.name}Index`, index);
    for (let i = 0; i < index; i++) {
      const chunk = stringified.slice(i * maxChunkSize, (i + 1) * maxChunkSize);
      world.setDynamicProperty(`${this.name}:${i}`, chunk);
    }
  }

  protected static save() {
    this.databases.forEach((database) => {
      database.save();
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
      for (let i = 0; i < index; i++) {
        const value = world.getDynamicProperty(`${name}:${i}`) as string;
        if (value) {
          stringified += value;
        }
      }
    }
    
    if (!stringified) return {};
    return JSON.parse(stringified);
  }
}

// 每秒自动保存所有数据库
system.runInterval(() => {
  //@ts-ignore
  Database.save();
}, 20);


