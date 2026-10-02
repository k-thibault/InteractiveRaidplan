import type { EntityReference } from './PositionTarget';

/** Facing targets use compass degrees, matching polar positions. */
export type FacingTarget =
  /** A fixed heading, independent of where the entity is standing. */
  | { type: 'absolute'; angle: number | string }
  /** Faces the direction from this entity towards another entity, plus an offset. */
  | { type: 'entity'; entity: EntityReference; offset?: number }
  /** Faces the direction from this entity towards a fixed point, plus an offset. */
  | { type: 'position'; position: { x: number; y: number } | string; offset?: number };
