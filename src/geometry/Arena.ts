import type { Vector2 } from './Vector2';

/** Legacy playable area (the whole 30x20 viewport minus a one-unit margin). */
export const DEFAULT_ARENA_HALF_WIDTH = 14;
export const DEFAULT_ARENA_HALF_HEIGHT = 9;

/** How far past a deadly border an entity may travel before the engine stops it (it is dead by then anyway). */
export const DEADLY_EDGE_OVERSHOOT = 1.5;
/** Distance bots keep from a deadly border when their destination would otherwise lie on or past it. */
export const BOT_DEADLY_EDGE_INSET = 0.3;
/** Float slack so standing exactly on the border is still inside. */
const EDGE_TOLERANCE = 1e-6;

export type ArenaShape = 'circle' | 'square' | 'rectangle';
/**
 * `wall`: the border only blocks movement (entities slide along it).
 * `deadly`: the border does not block; anything past it is killed.
 */
export type ArenaEdge = 'wall' | 'deadly';

/** Timeline-facing arena declaration. Lengths are world units; the arena is centred on the origin. */
export interface ArenaDefinition {
  shape: ArenaShape;
  /** `circle`: radius from the centre. */
  radius?: number;
  /** `square`: side length. */
  size?: number;
  /** `rectangle`: full width and height. */
  width?: number;
  height?: number;
  /** Defaults to `wall`. */
  edge?: ArenaEdge;
}

/** Resolved arena stored on `GameState`. */
export interface Arena {
  shape: ArenaShape;
  /** Circle radius; for boxes, the circumscribed radius. */
  radius: number;
  halfWidth: number;
  halfHeight: number;
  edge: ArenaEdge;
}

export function resolveArena(definition?: ArenaDefinition): Arena {
  const edge = definition?.edge ?? 'wall';
  if (!definition || (definition.shape === 'rectangle' && definition.width === undefined && definition.height === undefined)) {
    const halfWidth = DEFAULT_ARENA_HALF_WIDTH;
    const halfHeight = DEFAULT_ARENA_HALF_HEIGHT;
    return { shape: 'rectangle', radius: Math.hypot(halfWidth, halfHeight), halfWidth, halfHeight, edge };
  }
  if (definition.shape === 'circle') {
    const radius = definition.radius ?? 10;
    return { shape: 'circle', radius, halfWidth: radius, halfHeight: radius, edge };
  }
  const halfWidth = (definition.shape === 'square' ? (definition.size ?? 20) : (definition.width ?? 28)) / 2;
  const halfHeight = (definition.shape === 'square' ? (definition.size ?? 20) : (definition.height ?? 18)) / 2;
  return { shape: definition.shape, radius: Math.hypot(halfWidth, halfHeight), halfWidth, halfHeight, edge };
}

/** Throws a descriptive error for a nonsensical arena declaration. */
export function validateArenaDefinition(definition: ArenaDefinition): void {
  const positive = (value: number | undefined) => value === undefined || (Number.isFinite(value) && value > 0);
  if (!['circle', 'square', 'rectangle'].includes(definition.shape)) throw new Error(`Encounter arena shape must be circle, square or rectangle (got "${definition.shape}")`);
  if (definition.edge !== undefined && definition.edge !== 'wall' && definition.edge !== 'deadly') throw new Error(`Encounter arena edge must be wall or deadly (got "${definition.edge}")`);
  if (![definition.radius, definition.size, definition.width, definition.height].every(positive)) throw new Error('Encounter arena dimensions must be positive finite numbers');
  if (definition.shape === 'circle' && definition.radius === undefined) throw new Error('A circle arena needs a radius');
  if (definition.shape === 'square' && definition.size === undefined) throw new Error('A square arena needs a size (side length)');
}

/** Grows (positive) or shrinks (negative) the arena by `margin` world units. */
function resized(arena: Arena, margin: number): Arena {
  const halfWidth = Math.max(0, arena.halfWidth + margin);
  const halfHeight = Math.max(0, arena.halfHeight + margin);
  return { ...arena, halfWidth, halfHeight, radius: arena.shape === 'circle' ? halfWidth : Math.hypot(halfWidth, halfHeight) };
}

export function isInsideArena(arena: Arena, position: Vector2): boolean {
  if (arena.shape === 'circle') return Math.hypot(position.x, position.y) <= arena.radius + EDGE_TOLERANCE;
  return Math.abs(position.x) <= arena.halfWidth + EDGE_TOLERANCE && Math.abs(position.y) <= arena.halfHeight + EDGE_TOLERANCE;
}

/** Clamps a position in place to the arena shrunk by `inset`. */
export function clampToArena(position: Vector2, arena: Arena, inset = 0): void {
  const target = inset === 0 ? arena : resized(arena, -inset);
  if (target.shape === 'circle') {
    const distance = Math.hypot(position.x, position.y);
    if (distance > target.radius) {
      position.x = (position.x / distance) * target.radius;
      position.y = (position.y / distance) * target.radius;
    }
    return;
  }
  position.x = Math.max(-target.halfWidth, Math.min(target.halfWidth, position.x));
  position.y = Math.max(-target.halfHeight, Math.min(target.halfHeight, position.y));
}

/**
 * Applies the border's movement rule in place: a wall stops movement at the border, while a deadly
 * border lets entities cross it (and die) up to a small overshoot so they cannot wander off forever.
 */
export function constrainToArena(position: Vector2, arena: Arena): void {
  clampToArena(position, arena, arena.edge === 'deadly' ? -DEADLY_EDGE_OVERSHOOT : 0);
}

/** Distance from `origin` (inside the arena) along unit vector `direction` to the border. */
export function distanceToArenaEdge(arena: Arena, origin: Vector2, direction: Vector2): number {
  if (arena.shape === 'circle') {
    // Solve |origin + t*direction| = radius for the positive root.
    const b = origin.x * direction.x + origin.y * direction.y;
    const c = origin.x * origin.x + origin.y * origin.y - arena.radius * arena.radius;
    return -b + Math.sqrt(Math.max(0, b * b - c));
  }
  const limit = (half: number, start: number, step: number) => step === 0 ? Infinity : ((step > 0 ? half : -half) - start) / step;
  return Math.max(0, Math.min(limit(arena.halfWidth, origin.x, direction.x), limit(arena.halfHeight, origin.y, direction.y)));
}
