import type { EntityReference } from './PositionTarget';

/** Facing targets use compass degrees, matching polar positions. */
export type FacingTarget =
  /** Faces the closest living player when resolved. */
  | { type: 'nearest_player' }
  /** A fixed compass heading with an optional degree offset. */
  | { type: 'absolute'; angle: number | string; offset?: number }
  /** Faces the direction from this entity towards another entity, plus an offset. */
  | { type: 'entity'; entity: EntityReference; offset?: number }
  /** Faces the direction from this entity towards a fixed point, plus an offset. */
  | { type: 'position'; position: { x: number; y: number } | string; offset?: number };
