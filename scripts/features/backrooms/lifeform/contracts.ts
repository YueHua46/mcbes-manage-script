export type EncounterPhase =
  | "dormant"
  | "lure"
  | "stalk"
  | "inspect"
  | "roar"
  | "chase"
  | "search"
  | "retreat";

export interface EncounterState {
  readonly ownerId: string;
  readonly manifestationSlot: number;
  readonly createdTick: number;
  readonly phase: EncounterPhase;
  readonly phaseStartedTick: number;
  readonly chaseStartedTick: number;
  readonly staggerUntilTick: number;
  readonly nextStaggerTick: number;
}

export type EncounterAction =
  | { type: "tick"; tick: number }
  | { type: "lure-complete"; tick: number }
  | { type: "mutual-sight"; tick: number }
  | { type: "phase-timeout"; tick: number }
  | { type: "sight-lost"; tick: number }
  | { type: "target-seen"; tick: number }
  | { type: "owner-unavailable"; tick: number }
  | { type: "chase-expired"; tick: number }
  | { type: "search-expired"; tick: number }
  | { type: "damage"; amount: number; tick: number };

export function createEncounterState(
  ownerId: string,
  manifestationSlot: number,
  createdTick: number,
): EncounterState {
  return {
    ownerId,
    manifestationSlot,
    createdTick,
    phase: "dormant",
    phaseStartedTick: createdTick,
    chaseStartedTick: 0,
    staggerUntilTick: 0,
    nextStaggerTick: 0,
  };
}

function enterPhase(state: EncounterState, phase: EncounterPhase, tick: number): EncounterState {
  return {
    ...state,
    phase,
    phaseStartedTick: tick,
    chaseStartedTick: phase === "chase" && state.chaseStartedTick === 0
      ? tick
      : state.chaseStartedTick,
  };
}

export function reduceEncounterState(state: EncounterState, action: EncounterAction): EncounterState {
  if (action.type === "damage") {
    if (action.amount < 6 || action.tick < state.nextStaggerTick) return state;
    return {
      ...state,
      staggerUntilTick: action.tick + 11,
      nextStaggerTick: action.tick + 60,
    };
  }
  if (action.type === "owner-unavailable" || action.type === "chase-expired") {
    return enterPhase(state, "retreat", action.tick);
  }
  if (action.type === "tick" && state.phase === "dormant" && action.tick > state.createdTick) {
    return enterPhase(state, "lure", action.tick);
  }
  if (action.type === "lure-complete" && state.phase === "lure") {
    return enterPhase(state, "stalk", action.tick);
  }
  if (action.type === "mutual-sight" && (state.phase === "lure" || state.phase === "stalk")) {
    return enterPhase(state, "inspect", action.tick);
  }
  if (action.type === "phase-timeout" && state.phase === "inspect") {
    return enterPhase(state, "roar", action.tick);
  }
  if (action.type === "phase-timeout" && state.phase === "roar") {
    return enterPhase(state, "chase", action.tick);
  }
  if (action.type === "sight-lost" && state.phase === "chase") {
    return enterPhase(state, "search", action.tick);
  }
  if (action.type === "target-seen" && state.phase === "search") {
    return enterPhase(state, "chase", action.tick);
  }
  if (action.type === "search-expired" && state.phase === "search") {
    return enterPhase(state, "retreat", action.tick);
  }
  return state;
}

export interface HorizontalPoint {
  x: number;
  z: number;
}

export interface SpawnRegionSnapshot {
  region: { rx: number; rz: number };
  size: number;
  loaded: boolean;
  blackout?: boolean;
  getCell(x: number, z: number): number | undefined;
}

export interface SpawnSiteContext {
  player: HorizontalPoint & { y: number };
  forward: HorizontalPoint;
  manifestationSpawn: HorizontalPoint & { y: number };
  otherPlayers: ReadonlyArray<HorizontalPoint & { y: number }>;
  regions: readonly SpawnRegionSnapshot[];
  seed: number | string;
  isLoaded(location: { x: number; y: number; z: number }): boolean;
  hasClearance(location: { x: number; y: number; z: number }): boolean;
  isVoid(location: { x: number; y: number; z: number }): boolean;
}

export interface SpawnCandidate {
  key: string;
  location: { x: number; y: number; z: number };
  euclideanDistance: number;
  pathDistance: number;
  lineOfSight: false;
  score: number;
}

