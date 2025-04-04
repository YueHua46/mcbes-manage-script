import { world, system } from "@minecraft/server";

export class Database<V = any> {
  static readonly databases = new Array<Database<any>>();
  private cache = Database.getAll(this.name, this.defaultValue);

  public constructor(readonly name: string, private readonly defaultValue: string = "{}") {
    // 判断是否已经存在，如果存在则引用已有的动态属性数据
    Database.databases.push(this);
  }

  /**
   * Set a value from a key
   * @remarks Doesn't save instantly, call .save() or wait 1 minute to save automatically
   * @param {string} property Key to set
   * @param {V} value The value
   */
  public set(property: string, value: V): void {
    this.cache[property] = value;
  }

  /**
   * Get a value from a key
   * @param {string} property Key to get
   * @returns {V} The value that was set for the key (or undefined)
   */
  public get(property: string): V {
    return this.cache[property];
  }

  /**
   * Test for whether or not the database has the key
   * @param {string} property Key to test for
   * @returns {boolean} Whether or not the database has the key
   */
  public has(property: string): boolean {
    return property in this.cache;
  }

  /**
   * Delete a key from the database
   * @remarks Doesn't save instantly, call .save() or wait 1 minute to save automatically
   * @param {string} property Key to delete from the database
   * @returns {boolean} Whether the database had the key to begin with
   */
  public delete(property: string): boolean {
    return delete this.cache[property];
  }

  /**
   * Get an array of all keys in the database
   * @returns {string[]} An array of all keys in the database
   */
  public keys(): string[] {
    return Object.keys(this.cache);
  }

  /**
   * Get an array of all values in the database
   * @returns {V[]} An array of all values in the database
   */
  public values(): V[] {
    return Object.values(this.cache);
  }

  /**
   * Clears all values in the database
   * @remarks Saves instantly
   */
  public clear() {
    this.cache = {};
    this.save();
  }

  /**
   * Get an object with all keys and values
   * @remarks All changes will save
   * @returns {Record<string, V>} An object of all keys and values
   */
  public getAll(): Record<string, V> {
    return (this.cache ??= Database.getAll(this.name, this.defaultValue));
  }

  /**
   * Save the database instantly
   */
  public save(): void {
    const stringified = JSON.stringify(this.cache);
    const maxChunkSize = 30000; // 最大字符串长度
    const index = Math.ceil(stringified.length / maxChunkSize);
    // console.log('this.cache', JSON.stringify(this.cache))
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

system.runInterval(() => {
  //@ts-ignore
  Database.save();
}, 20);
