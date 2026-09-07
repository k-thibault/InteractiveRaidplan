import type { Vector2 } from '../geometry/Vector2';

/**
 * Where a world graphic is positioned. `entity` anchors track a living
 * entity's position every frame (so a graphic "on its target" follows the
 * target as it moves); `position` anchors are fixed in space.
 */
export type GraphicAnchor =
  | { type: 'position'; position: Vector2 }
  | { type: 'entity'; entity: string };

/**
 * A resource-backed graphic rendered in the arena for a limited time. This
 * is distinct from area telegraphs (which drive damage resolution) and the
 * cast bar (which is UI chrome) - a world graphic is purely visual, used for
 * things like a status glow on its target or a ground marker that signals an
 * upcoming mechanic.
 */
export interface WorldGraphicInstance {
  id: string;
  image: string;
  anchor: GraphicAnchor;
  radius: number;
  createdAt: number;
  duration: number;
}
