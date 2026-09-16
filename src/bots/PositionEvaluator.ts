import type { GameState } from '../simulation/GameState';
import type { AreaEffect } from '../mechanics/Effect';
import type { PositionTarget, EntityReference } from './PositionTarget';
import { findEntity } from '../mechanics/Selector';
import { MechanicalRoleEvaluator, type ConditionExpression } from './MechanicalRoleEvaluator';
import { fromPolar, toPolarAngle, circularMeanAngle } from '../geometry/Vector2';

export interface PositionRule { when: ConditionExpression; target: PositionTarget; }
/** Position rules are grouped and only the requested group is evaluated. */
export type PositionDefinition = PositionRule[];
export type PositionDefinitions = Record<string, PositionDefinition>;

export class PositionEvaluator {
  private readonly definitions: PositionDefinitions;
  private readonly conditionEvaluator: MechanicalRoleEvaluator;
  private readonly resolveValue: <T>(value: T) => T;

  constructor(definitions: PositionDefinitions = {}, resolveValue: <T>(value: T) => T = (value) => value) {
    this.definitions = definitions;
    this.conditionEvaluator = new MechanicalRoleEvaluator();
    this.resolveValue = resolveValue;
  }

  recalculate(state: GameState, group?: string, params?: Record<string, number>): void {
    const rules = group
      ? (this.definitions[group] ?? [])
      : Object.values(this.definitions).flat();

    for (const player of state.players) {
      if (player.controlled) continue;
      const rule = rules.find((candidate) => this.conditionEvaluator.evaluate(candidate.when, player, state));
      player.desiredPosition = rule ? this.resolve(rule.target, state, params) : undefined;
    }
  }

  private resolve(target: PositionTarget, state: GameState, params?: Record<string, number>): { x: number; y: number } | undefined {
    if (target.type === 'fixed') {
      const position = this.resolveValue(this.substituteParams(target.position, params));
      return typeof position === 'string' ? undefined : { x: position.x, y: position.y };
    }
    if (target.type === 'polar') {
      const angle = this.resolveValue(this.substituteParams(target.angle, params));
      const radius = this.resolveValue(this.substituteParams(target.radius, params));
      if (typeof angle !== 'number' || typeof radius !== 'number') return undefined;
      return fromPolar(angle + (target.angleOffset ?? 0), radius, target.origin);
    }
    if (target.type === 'area') return this.resolveArea(target, state);

    const entity = this.resolveReference(target.player, state);
    return entity ? {
      x: entity.position.x + (target.offset?.x ?? 0),
      y: entity.position.y + (target.offset?.y ?? 0)
    } : undefined;
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

  private resolveReference(reference: EntityReference, state: GameState) {
    if (reference.type === 'id') return findEntity(state, reference.id);
    if (reference.type === 'gameplay_role') return state.players.find((player) => player.role === reference.role && player.alive);
    return state.players.find((player) => player.mechanicalRoles.includes(reference.role) && player.alive);
  }
}
