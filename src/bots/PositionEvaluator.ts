import type { GameState } from '../simulation/GameState';
import type { PositionTarget, EntityReference } from './PositionTarget';
import { findEntity } from '../mechanics/Selector';
import { MechanicalRoleEvaluator, type ConditionExpression } from './MechanicalRoleEvaluator';
import { fromPolar } from '../geometry/Vector2';

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

  recalculate(state: GameState, group?: string): void {
    const rules = group
      ? (this.definitions[group] ?? [])
      : Object.values(this.definitions).flat();

    for (const player of state.players) {
      if (player.controlled) continue;
      const rule = rules.find((candidate) => this.conditionEvaluator.evaluate(candidate.when, player, state));
      player.desiredPosition = rule ? this.resolve(rule.target, state) : undefined;
    }
  }

  private resolve(target: PositionTarget, state: GameState): { x: number; y: number } | undefined {
    if (target.type === 'fixed') {
      const position = this.resolveValue(target.position);
      return typeof position === 'string' ? undefined : { ...position };
    }
    if (target.type === 'polar') {
      const angle = this.resolveValue(target.angle);
      const radius = this.resolveValue(target.radius);
      if (typeof angle !== 'number' || typeof radius !== 'number') return undefined;
      return fromPolar(angle, radius, target.origin);
    }
    if (target.type === 'area') {
      const effect = state.effects.find((candidate) =>
        candidate.resolvedAt === undefined &&
        (!target.mechanic || candidate.mechanic === target.mechanic) &&
        (!target.label || candidate.label === target.label));
      return effect ? {
        x: effect.position.x + (target.offset?.x ?? 0),
        y: effect.position.y + (target.offset?.y ?? 0)
      } : undefined;
    }

    const entity = this.resolveReference(target.player, state);
    return entity ? {
      x: entity.position.x + (target.offset?.x ?? 0),
      y: entity.position.y + (target.offset?.y ?? 0)
    } : undefined;
  }

  private resolveReference(reference: EntityReference, state: GameState) {
    if (reference.type === 'id') return findEntity(state, reference.id);
    if (reference.type === 'gameplay_role') return state.players.find((player) => player.role === reference.role && player.alive);
    return state.players.find((player) => player.mechanicalRoles.includes(reference.role) && player.alive);
  }
}
