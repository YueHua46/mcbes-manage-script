export interface QuestMovementLocation {
  x: number;
  y: number;
  z: number;
}

export interface QuestGlideDistanceSample {
  gliding: boolean;
  dimensionId?: string;
  location?: QuestMovementLocation;
}

/** Half-second samples above this distance are treated as teleports or invalid discontinuities. */
export const QUEST_MAX_GLIDE_SEGMENT_DISTANCE = 64;

export function resolveQuestGlideDistance(
  previous: QuestGlideDistanceSample | undefined,
  current: QuestGlideDistanceSample,
  maxSegmentDistance = QUEST_MAX_GLIDE_SEGMENT_DISTANCE
): number {
  if (!previous?.gliding || !current.gliding) return 0;
  if (!previous.dimensionId || previous.dimensionId !== current.dimensionId) return 0;
  if (!previous.location || !current.location) return 0;
  if (!Number.isFinite(maxSegmentDistance) || maxSegmentDistance <= 0) return 0;

  const dx = current.location.x - previous.location.x;
  const dy = current.location.y - previous.location.y;
  const dz = current.location.z - previous.location.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(distance) || distance <= 0 || distance > maxSegmentDistance) return 0;
  return distance;
}
