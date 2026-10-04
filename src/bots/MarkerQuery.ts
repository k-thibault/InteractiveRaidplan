import type { Vector2 } from '../geometry/Vector2';
import type { PositionTarget } from './PositionTarget';

/**
 * Picks an encounter marker from where things currently are, so positions are derived
 * from live crystal/marker geometry instead of precomputed per layout.
 *
 * Candidates are ranked by distance from `from` (nearest first), the `ranks` that
 * are wanted are kept, and one of them is chosen: the closest by default, or by distance
 * to a second point with `farthestFrom` / `nearestTo`.
 */
export interface MarkerQuery {
  /** Point the markers are ranked from. Omit inside a `shift` to rank from the point being shifted. */
  from?: PositionTarget;
  /** Only these marker ids are considered. */
  ids?: string[];
  /** Zero-based distance ranks to keep (0 is the closest marker). Defaults to `[0]`. */
  ranks?: number[];
  /** Of the kept markers, choose the one furthest from this point. */
  farthestFrom?: PositionTarget;
  /** Of the kept markers, choose the one closest to this point. */
  nearestTo?: PositionTarget;
}

export interface QueryableMarker { id: string; resolvedPosition: Vector2; }

const distance = (a: Vector2, b: Vector2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Picks a matching marker, preserving definition order for distance ties. */
export function pickMarker<T extends QueryableMarker>(
  markers: T[],
  from: Vector2,
  query: MarkerQuery,
  resolvePoint: (target: PositionTarget) => Vector2 | undefined,
): T | undefined {
  const pool = query.ids ? markers.filter((marker) => query.ids!.includes(marker.id)) : markers;
  const ranked = pool
    .map((marker, order) => ({ marker, order, away: distance(marker.resolvedPosition, from) }))
    .sort((a, b) => a.away - b.away || a.order - b.order)
    .map((entry) => entry.marker);
  const kept = (query.ranks ?? [0]).flatMap((rank) => ranked[rank] ? [ranked[rank]] : []);
  if (kept.length === 0) return undefined;
  const reference = query.farthestFrom ?? query.nearestTo;
  if (!reference) return kept[0];
  const point = resolvePoint(reference);
  if (!point) return undefined;
  const sign = query.farthestFrom ? -1 : 1;
  return [...kept].sort((a, b) => sign * (distance(a.resolvedPosition, point) - distance(b.resolvedPosition, point)))[0];
}
