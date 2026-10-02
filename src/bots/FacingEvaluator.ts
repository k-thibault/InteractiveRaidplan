import type { GameState } from '../simulation/GameState';
import type { Entity } from '../entities/Entity';
import type { FacingTarget } from './FacingTarget';
import type { EntityReference } from './PositionTarget';
import { findEntity } from '../mechanics/Selector';
import { toPolarAngle } from '../geometry/Vector2';

/** Facing conditions use state shared by players and enemies. */
export type FacingCondition =
  | { type: 'has_status'; status: string }
  | { type: 'not_has_status'; status: string }
  | { type: 'mechanic'; mechanic: string }
  | { type: 'active_cast'; cast: string; source?: string }
  | { type: 'active_area'; mechanic?: string; element?: string }
  | { type: 'entity_id'; id: string }
  | { type: 'and'; conditions: FacingConditionExpression[] }
  | { type: 'or'; conditions: FacingConditionExpression[] }
  | { type: 'not'; condition: FacingConditionExpression };

export type FacingConditionExpression = FacingCondition | FacingConditionExpression[];
export interface FacingRule { when?: FacingConditionExpression; target: FacingTarget; }
/** Facing rules are grouped and only the requested group is evaluated. */
export type FacingDefinition = FacingRule[];
export type FacingDefinitions = Record<string, FacingDefinition>;

export class FacingEvaluator {
  private readonly definitions: FacingDefinitions;
  private readonly resolveValue: <T>(value: T) => T;

  constructor(definitions: FacingDefinitions = {}, resolveValue: <T>(value: T) => T = (value) => value) {
    this.definitions = definitions;
    this.resolveValue = resolveValue;
  }

  /** Applies matching facing rules to players and enemies. */
  recalculate(state: GameState, group?: string, params?: Record<string, number>): void {
    void params; // Reserved for API parity with position recalculation.
    const rules = group ? (this.definitions[group] ?? []) : Object.values(this.definitions).flat();
    for (const entity of [...state.players, ...state.enemies] as Entity[]) {
      const rule = rules.find((candidate) => candidate.when === undefined || this.matches(candidate.when, entity, state));
      if (rule) {
        const angle = this.resolve(rule.target, state, entity);
        entity.facingRuleActive = angle !== undefined;
        if (angle !== undefined) entity.facing = angle;
      } else {
        entity.facingRuleActive = false;
      }
    }
  }

  /** Resolves a facing target, relative to `self`, to a compass-degree heading. */
  resolve(target: FacingTarget, state: GameState, self: Entity): number | undefined {
    if (target.type === 'absolute') {
      const angle = this.resolveValue(target.angle);
      const resolved = typeof angle === 'number' ? angle : Number(angle);
      return Number.isFinite(resolved) ? resolved : undefined;
    }
    if (target.type === 'position') {
      const position = this.resolveValue(target.position);
      if (typeof position === 'string') return undefined;
      return toPolarAngle(position, self.position) + (target.offset ?? 0);
    }
    const entity = this.resolveReference(target.entity, state);
    return entity ? toPolarAngle(entity.position, self.position) + (target.offset ?? 0) : undefined;
  }

  private resolveReference(reference: EntityReference, state: GameState) {
    if (reference.type === 'id') return findEntity(state, reference.id);
    if (reference.type === 'gameplay_role') return state.players.find((player) => player.role === reference.role && player.alive);
    return state.players.find((player) => player.mechanicalRoles.includes(reference.role) && player.alive);
  }

  private matches(condition: FacingConditionExpression, entity: Entity, state: GameState): boolean {
    if (Array.isArray(condition)) return condition.every((child) => this.matches(child, entity, state));
    const statuses = 'statuses' in entity ? (entity as { statuses: { definitionId: string }[] }).statuses : [];

    switch (condition.type) {
      case 'has_status': return statuses.some((status) => status.definitionId === condition.status);
      case 'not_has_status': return !statuses.some((status) => status.definitionId === condition.status);
      case 'mechanic': return state.currentMechanic === condition.mechanic;
      case 'entity_id': return entity.id === condition.id;
      case 'active_cast': return state.casts.some((cast) => cast.definitionId === condition.cast && (!condition.source || cast.sourceId === condition.source));
      case 'active_area': return state.effects.some((effect) =>
        effect.resolvedAt === undefined &&
        (condition.mechanic === undefined || effect.mechanic === condition.mechanic) &&
        (condition.element === undefined || effect.element === condition.element));
      case 'and': return condition.conditions.every((child) => this.matches(child, entity, state));
      case 'or': return condition.conditions.some((child) => this.matches(child, entity, state));
      case 'not': return !this.matches(condition.condition, entity, state);
    }
  }
}
