import type { Vector2 } from '../geometry/Vector2';
import type { ActiveKnock } from '../mechanics/Knock';

/** Optional arena drawing style. Dimensions use world units. */
export type EntityStyle =
  | { type: 'circle'; radius?: number }
  | { type: 'ring'; radius: number; thickness?: number };

export interface Entity {
  id: string;
  name: string;
  position: Vector2;
  alive: boolean;
  style?: EntityStyle;
  /** Compass heading in degrees; defaults to north when unset. */
  facing?: number;
  /** Whether a facing rule currently controls this entity. */
  facingRuleActive?: boolean;
  /** Set from active statuses. Blocks regular movement. */
  rooted?: boolean;
  /** Set from active statuses. Blocks regular movement and facing changes. */
  stunned?: boolean;
  /** Forced movement in progress. Blocks regular movement. */
  knock?: ActiveKnock;
}