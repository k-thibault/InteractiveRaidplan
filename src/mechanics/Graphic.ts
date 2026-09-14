import type { Vector2 } from '../geometry/Vector2';

/** A world graphic can follow a live entity or stay fixed to a position. */
export type GraphicAnchor =
  | { type: 'position'; position: Vector2 }
  | { type: 'entity'; entity: string };

/** Visual-only graphic instance rendered in the arena for a limited time. */
export interface WorldGraphicInstance {
  id: string;
  image: string;
  anchor: GraphicAnchor;
  radius: number;
  createdAt: number;
  duration: number;
}
