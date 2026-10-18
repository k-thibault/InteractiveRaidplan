import type { Vector2 } from './Vector2';

/**
 * The controlled player's position and facing live on a fixed grid so that a recording stores them losslessly:
 * live play and replay both see exactly the same numbers. Positions are whole multiples of `1 / POSITION_UNITS_PER_WORLD_UNIT`
 * world units; facings are whole multiples of `1 / FACING_UNITS_PER_DEGREE` degrees.
 *
 * Conversions go through integers (`to*Units` / `from*Units`) and always divide, so the same integer yields bit-identical floats everywhere.
 */
export const POSITION_UNITS_PER_WORLD_UNIT = 10_000;
export const FACING_UNITS_PER_DEGREE = 100;

/** `+ 0` turns a negative zero into a positive one: `Math.round(-0.3)` is -0, which would hash differently from the 0 a replay places. */
export function toPositionUnits(value: number): number { return Math.round(value * POSITION_UNITS_PER_WORLD_UNIT) + 0; }
export function fromPositionUnits(units: number): number { return units / POSITION_UNITS_PER_WORLD_UNIT + 0; }

/** Compass degrees in [0, 360) as whole facing units. */
export function toFacingUnits(degrees: number): number {
  const units = Math.round((((degrees % 360) + 360) % 360) * FACING_UNITS_PER_DEGREE) + 0;
  return units === 360 * FACING_UNITS_PER_DEGREE ? 0 : units;
}
export function fromFacingUnits(units: number): number { return units / FACING_UNITS_PER_DEGREE + 0; }

/** Snaps a position to the grid in place. */
export function quantizePosition(position: Vector2): void {
  position.x = fromPositionUnits(toPositionUnits(position.x));
  position.y = fromPositionUnits(toPositionUnits(position.y));
}

/** Snaps a heading to the grid, normalised to [0, 360). */
export function quantizeFacing(degrees: number): number { return fromFacingUnits(toFacingUnits(degrees)); }
