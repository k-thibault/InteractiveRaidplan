import type { Vector2 } from '../geometry/Vector2';

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
}