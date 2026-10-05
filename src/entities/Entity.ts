import type { Vector2 } from '../geometry/Vector2';
import type { ActiveKnock } from '../mechanics/Knock';

/** Optional arena drawing style. Dimensions use world units. */
export type EntityStyle = (
  | { type: 'circle'; radius?: number }
  | { type: 'ring'; radius: number; thickness?: number }
  /** `radius` reaches the corners of a diamond or triangle and half the width of a square. */
  | { type: 'diamond' | 'square' | 'triangle'; radius?: number }
) & { /** Overrides the default marker color. */ color?: string };

/**
 * Optional image drawn for an entity, using a name from the shared graphics library.
 * The image is drawn upright at `facing` 180 (the boss facing straight down); with `rotate` it turns with the entity's facing.
 */
export interface EntityGraphic {
  /** Name of a graphic in `resources/graphics.json`. */
  image: string;
  /** Half the drawn size in world units. Defaults to the entity's indicator radius. */
  radius?: number;
  /** Turn the image as the entity's facing changes. Off keeps it in its base orientation. */
  rotate?: boolean;
  /** Draw the image instead of the `style` shape. Off draws it on top of the shape, e.g. inside a boss's ring. */
  replaceShape?: boolean;
}

/** Compass heading at which an entity graphic is drawn unrotated (facing straight down the screen). */
export const GRAPHIC_BASE_FACING = 180;

export interface Entity {
  id: string;
  name: string;
  position: Vector2;
  alive: boolean;
  style?: EntityStyle;
  /** Optional image in addition to, or in place of, `style`. */
  graphic?: EntityGraphic;
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

/** Default radius of an entity drawn without an explicit style radius. */
export const DEFAULT_ENTITY_RADIUS = 0.38;

/** Radius of an entity's drawn indicator in world units. */
export function entityRadius(entity: Entity): number {
  const style = entity.style;
  if (!style) return DEFAULT_ENTITY_RADIUS;
  return style.radius ?? DEFAULT_ENTITY_RADIUS;
}
