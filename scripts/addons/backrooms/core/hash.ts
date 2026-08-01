import { BackroomsSeed } from "./types";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function avalanche32(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function addCodeUnit(hash: number, codeUnit: number): number {
  let result = hash ^ (codeUnit & 0xff);
  result = Math.imul(result, FNV_PRIME);
  result ^= codeUnit >>> 8;
  return Math.imul(result, FNV_PRIME) >>> 0;
}

/** Stable across engines; deliberately hashes UTF-16 code units, not locale text. */
export function hashString32(value: string, initial = FNV_OFFSET): number {
  let hash = initial >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = addCodeUnit(hash, value.charCodeAt(index));
  }
  return avalanche32(hash ^ value.length);
}

function hashNumber32(value: number, initial: number): number {
  if (!Number.isFinite(value)) {
    return hashString32(String(value), initial);
  }
  // Coordinate and world seeds are integers. The string fallback preserves
  // fractional inputs without relying on typed-array endianness.
  if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
    return hashString32(value.toString(), initial);
  }
  const sign = value < 0 ? 1 : 0;
  const absolute = Math.abs(value);
  const low = absolute >>> 0;
  const high = Math.floor(absolute / 0x100000000) >>> 0;
  let hash = avalanche32(initial ^ low);
  hash = avalanche32(hash ^ high);
  return avalanche32(hash ^ sign);
}

export function hashParts32(...parts: readonly (BackroomsSeed | boolean)[]): number {
  let hash = FNV_OFFSET;
  for (const part of parts) {
    if (typeof part === "number") {
      hash = hashNumber32(part, hash ^ 0x4e554d42);
    } else if (typeof part === "boolean") {
      hash = avalanche32(hash ^ (part ? 0x54525545 : 0x46414c53));
    } else {
      hash = hashString32(part, hash ^ 0x53545247);
    }
    hash = avalanche32(hash ^ 0x9e3779b9);
  }
  return hash >>> 0;
}

export function deriveSeed32(
  worldSeed: BackroomsSeed,
  algorithmVersion: number,
  channel: string,
  rx: number,
  rz: number
): number {
  return hashParts32("backrooms", algorithmVersion, channel, worldSeed, rx, rz);
}

export function hashUint32Sequence(values: ArrayLike<number>, initial = FNV_OFFSET): number {
  let hash = initial >>> 0;
  for (let index = 0; index < values.length; index += 1) {
    hash = avalanche32(hash ^ (values[index] >>> 0) ^ Math.imul(index + 1, 0x9e3779b9));
  }
  return avalanche32(hash ^ values.length);
}

/** Small deterministic generator with an explicit 32-bit state. */
export class DeterministicRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  public next(): number {
    return this.nextUint32() / 0x100000000;
  }

  public chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Inclusive on both ends. */
  public integer(minimum: number, maximum: number): number {
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
      throw new RangeError(`Invalid integer range ${minimum}..${maximum}`);
    }
    const span = maximum - minimum + 1;
    return minimum + Math.floor(this.next() * span);
  }

  public pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new RangeError("Cannot pick from an empty collection");
    }
    return values[this.integer(0, values.length - 1)];
  }

  public shuffle<T>(values: T[]): void {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const other = this.integer(0, index);
      const temporary = values[index];
      values[index] = values[other];
      values[other] = temporary;
    }
  }
}
