import type { GameState } from '../simulation/GameState';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import { clampToArena, distanceToArenaEdge } from '../geometry/Arena';
import type { AreaEffect } from '../mechanics/Effect';
import type { PositionTarget } from './PositionTarget';
import { resolveEntityReference } from '../mechanics/Selector';
import { MechanicalRoleEvaluator, type ConditionExpression } from './MechanicalRoleEvaluator';
import { fromPolar, toPolarAngle, circularMeanAngle, normalize, subtract } from '../geometry/Vector2';
import type { Vector2 } from '../geometry/Vector2';
import { signedAngleDelta } from '../geometry/Facing';
import { pickMarker } from './MarkerQuery';
import type { MarkerQuery } from './MarkerQuery';
import { clampDirection, type DirectionClamp } from '../geometry/DirectionClamp';

/** Distance in world units under which a follower counts as standing on its drag goal. */
const DRAG_ARRIVED = 0.05;

export interface PositionRule {
  when?: ConditionExpression;
  target: PositionTarget;
  /** Re-resolve the target every tick instead of once, for targets that depend on moving entities. */
  live?: boolean;
  clamp?: DirectionClamp;
}
/** Position rules are grouped and only the requested group is evaluated. */
export type PositionDefinition = PositionRule[];
export type PositionDefinitions = Record<string, PositionDefinition>;

export class PositionEvaluator {
  private readonly definitions: PositionDefinitions;
  private readonly conditionEvaluator: MechanicalRoleEvaluator;
  private readonly resolveValue: <T>(value: T) => T;
  /** The `live` rule each player currently follows. */
  private readonly liveRules = new Map<string, { target: PositionTarget; params?: Record<string, number> }>();

  private readonly markerQueries: Record<string, MarkerQuery>;

  constructor(definitions: PositionDefinitions = {}, resolveValue: <T>(value: T) => T = (value) => value, markerQueries: Record<string, MarkerQuery> = {}) {
    this.definitions = definitions;
    this.markerQueries = markerQueries;
    this.conditionEvaluator = new MechanicalRoleEvaluator({}, resolveValue);
    this.resolveValue = resolveValue;
  }

  recalculate(state: GameState, group?: string, params?: Record<string, number>): void {
    const rules = group
      ? (this.definitions[group] ?? [])
      : Object.values(this.definitions).flat();

    for (const player of state.players) {
      if (player.controlled) continue;
      const rule = rules.find((candidate) => candidate.when === undefined || this.conditionEvaluator.evaluate(candidate.when, player, state));
      player.desiredPosition = rule ? this.resolve(rule.target, state, params, player) : undefined;
      player.movementClamp = rule?.clamp === undefined ? undefined : this.resolveValue(rule.clamp);
      if (rule?.live) this.liveRules.set(player.id, { target: rule.target, params });
      else this.liveRules.delete(player.id);
    }
  }

  /** Drops the position rule of these players, leaving them with no destination. */
  release(players: Player[]): void {
    for (const player of players) {
      player.desiredPosition = undefined;
      player.movementClamp = undefined;
      this.liveRules.delete(player.id);
    }
  }

  /** Refreshes the destinations of players following a `live` rule. */
  update(state: GameState): void {
    for (const player of state.players) {
      const live = this.liveRules.get(player.id);
      if (!live || player.controlled || !player.alive) continue;
      player.desiredPosition = this.resolve(live.target, state, live.params, player) ?? player.desiredPosition;
    }
  }

  /** Resolves any position target to a point right now. `self` is the player it is resolved for, if any. */
  resolveTarget(target: PositionTarget, state: GameState, self?: Player): Vector2 | undefined {
    return this.resolve(target, state, undefined, self);
  }

  /** `origin` is the point a marker query ranks from when it names no `from`; `shift` supplies its own start point. */
  private resolve(target: PositionTarget, state: GameState, params?: Record<string, number>, player?: Player, origin?: Vector2): { x: number; y: number } | undefined {
    if (target.type === 'marker') {
      const marker = this.findMarker(target, state, params, player, origin);
      if (!marker) return undefined;
      return {
        x: marker.resolvedPosition.x + (target.offset?.x ?? 0),
        y: marker.resolvedPosition.y + (target.offset?.y ?? 0),
      };
    }
    if (target.type === 'fixed') {
      const position = this.resolveValue(this.substituteParams(target.position, params));
      return typeof position === 'string' ? undefined : { x: position.x, y: position.y };
    }
    if (target.type === 'polar') {
      let angle: number | string | undefined;
      if (target.angleFrom) {
        const entity = resolveEntityReference(this.resolveValue(target.angleFrom), state);
        if (!entity) return undefined;
        angle = toPolarAngle(entity.position, target.origin ?? { x: 0, y: 0 });
      } else if (target.angle !== undefined) {
        angle = this.resolveValue(this.substituteParams(target.angle, params));
      }
      const radius = this.resolveValue(this.substituteParams(target.radius, params));
      if (typeof angle !== 'number' || typeof radius !== 'number') return undefined;
      if (target.angleTowards) {
        const other = resolveEntityReference(this.resolveValue(target.angleTowards.entity), state);
        const by = this.resolveValue(this.substituteParams(target.angleTowards.by, params));
        if (!other || typeof by !== 'number') return undefined;
        // Turn the shorter way round toward the other entity's bearing; a negative `by` turns away from it.
        const turn = signedAngleDelta(angle, toPolarAngle(other.position, target.origin ?? { x: 0, y: 0 }));
        angle += Math.sign(turn) * by;
      }
      return fromPolar(angle + (target.angleOffset ?? 0), radius, target.origin);
    }
    if (target.type === 'drag') {
      const follower = resolveEntityReference(this.resolveValue(target.entity), state);
      const goal = this.resolve(target.to, state, params, player);
      const gap = target.distance ?? (follower as Partial<Enemy> | undefined)?.follow?.distance;
      if (!follower || !goal || gap === undefined) return undefined;
      // Off the goal the heading comes from the follower; on it, the follower keeps the heading it arrived with.
      let dx = goal.x - follower.position.x;
      let dy = goal.y - follower.position.y;
      if (Math.hypot(dx, dy) < DRAG_ARRIVED && player) {
        dx = player.position.x - follower.position.x;
        dy = player.position.y - follower.position.y;
      }
      const length = Math.hypot(dx, dy);
      // With no heading at all, stand north of the goal.
      const unit = length > 0 ? { x: dx / length, y: dy / length } : { x: 0, y: -1 };
      const spot = { x: goal.x + unit.x * gap, y: goal.y + unit.y * gap };
      clampToArena(spot, state.arena);
      return spot;
    }
    if (target.type === 'edge') {
      let angle: number | string | undefined;
      if (target.angleTo) {
        const point = this.resolve(target.angleTo, state, params, player, target.origin);
        if (!point) return undefined;
        angle = toPolarAngle(point, target.origin ?? { x: 0, y: 0 });
      } else if (target.angleFrom) {
        const entity = resolveEntityReference(this.resolveValue(target.angleFrom), state);
        if (!entity) return undefined;
        angle = toPolarAngle(entity.position, target.origin ?? { x: 0, y: 0 });
      } else if (target.angle !== undefined) {
        angle = this.resolveValue(this.substituteParams(target.angle, params));
      }
      const inset = this.resolveValue(this.substituteParams(target.inset ?? 0, params));
      const edgeOffset = Number(this.resolveValue(this.substituteParams(target.angleOffset ?? 0, params)));
      if (typeof angle !== 'number' || typeof inset !== 'number' || !Number.isFinite(edgeOffset)) return undefined;
      angle += edgeOffset;
      const origin = target.origin ?? { x: 0, y: 0 };
      const heading = fromPolar(angle, 1);
      const unit = { x: heading.x, y: heading.y };
      const reach = Math.max(0, distanceToArenaEdge(state.arena, origin, unit) - inset);
      return { x: origin.x + unit.x * reach, y: origin.y + unit.y * reach };
    }
    if (target.type === 'between') {
      const from = resolveEntityReference(this.resolveValue(target.a), state);
      const to = resolveEntityReference(this.resolveValue(target.b), state);
      if (!from || !to) return undefined;
      const t = target.t ?? 0.5;
      return { x: from.position.x + (to.position.x - from.position.x) * t, y: from.position.y + (to.position.y - from.position.y) * t };
    }
    if (target.type === 'shift') {
      const anchor = target.toward ?? target.awayFrom;
      const from = this.resolve(target.from, state, params, player, origin);
      const other = anchor ? this.resolve(anchor, state, params, player, from) : undefined;
      const distance = this.resolveValue(this.substituteParams(target.distance, params));
      if (!from || !other || typeof distance !== 'number') return undefined;
      let heading = normalize(subtract(other, from));
      // Snap the shift heading so grouped players preserve spacing.
      if (target.clamp !== undefined) heading = clampDirection(heading, this.resolveValue(target.clamp));
      // Turn the heading clockwise (compass degrees) around `from`.
      const turn = Number(this.resolveValue(this.substituteParams(target.angleOffset ?? 0, params)));
      if (turn !== 0 && Number.isFinite(turn)) heading = fromPolar(toPolarAngle(heading, { x: 0, y: 0 }) + turn, 1);
      const signed = target.toward ? distance : -distance;
      return { x: from.x + heading.x * signed, y: from.y + heading.y * signed };
    }
    if (target.type === 'area') return this.resolveArea(target, state);

    const entity = resolveEntityReference(this.resolveValue(target.player), state);
    return entity ? {
      x: entity.position.x + (target.offset?.x ?? 0),
      y: entity.position.y + (target.offset?.y ?? 0)
    } : undefined;
  }

  /** Finds the marker a `marker` target names, either by id or by running its query against the live markers. */
  private findMarker(target: Extract<PositionTarget, { type: 'marker' }>, state: GameState, params?: Record<string, number>, player?: Player, origin?: Vector2): GameState['markers'][number] | undefined {
    if (target.marker !== undefined) {
      const markerId = this.resolveValue(target.marker);
      return state.markers.find((candidate) => candidate.id === markerId);
    }
    const named = typeof target.query === 'string' ? this.markerQueries[target.query] : target.query;
    if (!named) return undefined;
    const query = this.resolveValue(named);
    const from = query.from ? this.resolve(query.from, state, params, player, origin) : origin;
    if (!from) return undefined;
    return pickMarker(state.markers, from, query, (point) => this.resolve(point, state, params, player, origin));
  }

  private substituteParams<T>(value: T, params?: Record<string, number>): T {
    if (typeof value !== 'string' || !params) return value;
    let result = value as string;
    for (const [key, paramValue] of Object.entries(params)) result = result.replaceAll(`$${key}`, String(paramValue));
    return result as T;
  }

  private resolveArea(target: Extract<PositionTarget, { type: 'area' }>, state: GameState): { x: number; y: number } | undefined {
    const matches = state.effects.filter((candidate) =>
      candidate.resolvedAt === undefined &&
      (!target.mechanic || candidate.mechanic === target.mechanic) &&
      (!target.label || candidate.label === target.label) &&
      (!target.tag || candidate.tags?.includes(target.tag)));
    if (matches.length === 0) return undefined;
    const selected: AreaEffect[] = target.aggregate === 'average' ? matches : matches.slice(0, 1);

    if (target.polar) {
      const origin = target.polar.origin ?? { x: 0, y: 0 };
      const angle = circularMeanAngle(selected.map((effect) => toPolarAngle(effect.position, origin)));
      const radius = this.resolveValue(target.polar.radius);
      if (typeof radius !== 'number') return undefined;
      return fromPolar(angle + (target.polar.angleOffset ?? 0), radius, origin);
    }

    const x = selected.reduce((sum, effect) => sum + effect.position.x, 0) / selected.length;
    const y = selected.reduce((sum, effect) => sum + effect.position.y, 0) / selected.length;
    return { x: x + (target.offset?.x ?? 0), y: y + (target.offset?.y ?? 0) };
  }
}
