/**
 * Cooldown maps keyed by player/location only need entries younger than their cooldown.
 * Once a map grows past `threshold`, drop every entry older than `maxAge` so long-running
 * servers do not keep one entry per player, item or block ever seen.
 */
export function pruneExpiredEntries(entries: Map<string, number>, now: number, maxAge: number, threshold = 1024): void {
  if (entries.size <= threshold) return;
  for (const [key, stamp] of entries) {
    if (now - stamp >= maxAge) entries.delete(key);
  }
}
