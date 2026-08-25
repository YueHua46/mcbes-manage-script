export interface StringPropertyStore {
  get(key: string): string | undefined;
  set(key: string, value: string | undefined): void;
}

export interface QuestGenerationPointer {
  generation: number;
  chunkCount: number;
  checksum: string;
}

export interface QuestGenerationManifest {
  version: 1;
  current: QuestGenerationPointer;
  previous?: QuestGenerationPointer;
}

export type GenerationLoadResult<T> =
  | { status: "empty" }
  | { status: "ok"; value: T; generation: number }
  | { status: "recovered"; value: T; generation: number; failedGeneration: number }
  | { status: "corrupt"; error: string };

const DEFAULT_CHUNK_SIZE = 24_000;

export function checksumText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class GenerationStore<T> {
  constructor(
    private readonly properties: StringPropertyStore,
    private readonly prefix: string,
    private readonly chunkSize = DEFAULT_CHUNK_SIZE
  ) {
    if (!prefix.trim()) throw new Error("Generation store prefix must not be empty");
    if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("Generation store chunk size must be positive");
  }

  load(): GenerationLoadResult<T> {
    let manifest: QuestGenerationManifest | undefined;
    try {
      manifest = this.readManifest();
    } catch (error) {
      return { status: "corrupt", error: String(error) };
    }
    if (!manifest) return { status: "empty" };

    const current = this.readGeneration(manifest.current);
    if (current.ok) return { status: "ok", value: current.value, generation: manifest.current.generation };

    if (manifest.previous) {
      const previous = this.readGeneration(manifest.previous);
      if (previous.ok) {
        return {
          status: "recovered",
          value: previous.value,
          generation: manifest.previous.generation,
          failedGeneration: manifest.current.generation,
        };
      }
    }
    return { status: "corrupt", error: current.error };
  }

  save(value: T): QuestGenerationManifest {
    const existing = this.readManifest();
    const generation = (existing?.current.generation ?? 0) + 1;
    let stablePrevious: QuestGenerationPointer | undefined;
    if (existing) {
      if (this.readGeneration(existing.current).ok) stablePrevious = existing.current;
      else if (existing.previous && this.readGeneration(existing.previous).ok) stablePrevious = existing.previous;
      else throw new Error(`Cannot save ${this.prefix}: no valid generation remains`);
    }
    const serialized = JSON.stringify(value);
    const chunks = this.split(serialized);
    const pointer: QuestGenerationPointer = {
      generation,
      chunkCount: chunks.length,
      checksum: checksumText(serialized),
    };

    chunks.forEach((chunk, index) => this.properties.set(this.chunkKey(generation, index), chunk));
    const verified = this.readGeneration(pointer);
    if (!verified.ok) throw new Error(`Failed to verify quest generation ${generation}: ${verified.error}`);

    const manifest: QuestGenerationManifest = {
      version: 1,
      current: pointer,
      previous: stablePrevious,
    };
    this.properties.set(this.manifestKey(), JSON.stringify(manifest));

    for (const obsolete of [existing?.current, existing?.previous]) {
      if (obsolete && obsolete.generation !== stablePrevious?.generation) this.deleteGeneration(obsolete);
    }
    return manifest;
  }

  private split(serialized: string): string[] {
    if (serialized.length === 0) return [""];
    const chunks: string[] = [];
    for (let start = 0; start < serialized.length; start += this.chunkSize) {
      chunks.push(serialized.slice(start, start + this.chunkSize));
    }
    return chunks;
  }

  private readManifest(): QuestGenerationManifest | undefined {
    const raw = this.properties.get(this.manifestKey());
    if (raw === undefined) return undefined;
    const parsed = JSON.parse(raw) as Partial<QuestGenerationManifest>;
    if (parsed.version !== 1 || !parsed.current) throw new Error(`Invalid generation manifest for ${this.prefix}`);
    return parsed as QuestGenerationManifest;
  }

  private readGeneration(pointer: QuestGenerationPointer): { ok: true; value: T } | { ok: false; error: string } {
    let serialized = "";
    for (let index = 0; index < pointer.chunkCount; index++) {
      const chunk = this.properties.get(this.chunkKey(pointer.generation, index));
      if (chunk === undefined)
        return { ok: false, error: `Missing chunk ${index} in generation ${pointer.generation}` };
      serialized += chunk;
    }
    if (checksumText(serialized) !== pointer.checksum) {
      return { ok: false, error: `Checksum mismatch in generation ${pointer.generation}` };
    }
    try {
      return { ok: true, value: JSON.parse(serialized) as T };
    } catch (error) {
      return { ok: false, error: `Invalid JSON in generation ${pointer.generation}: ${String(error)}` };
    }
  }

  private deleteGeneration(pointer: QuestGenerationPointer): void {
    for (let index = 0; index < pointer.chunkCount; index++) {
      this.properties.set(this.chunkKey(pointer.generation, index), undefined);
    }
  }

  private manifestKey(): string {
    return `${this.prefix}:manifest`;
  }

  private chunkKey(generation: number, index: number): string {
    return `${this.prefix}:g${generation}:${index}`;
  }
}
