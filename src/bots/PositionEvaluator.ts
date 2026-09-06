import type { GameState } from '../simulation/GameState';
import type { PositionRule, PositionTarget, EntityReference } from './PositionTarget';
import { findEntity } from '../mechanics/Selector';
import { MechanicalRoleEvaluator } from './MechanicalRoleEvaluator';

export interface PositionDefinition { rules: PositionRule[]; }

export class PositionEvaluator {
  private readonly definitions: Record<string, PositionDefinition>;
  private readonly conditionEvaluator: MechanicalRoleEvaluator;

  constructor(definitions: Record<string, PositionDefinition> = {}) {
    this.definitions = definitions;
    this.conditionEvaluator = new MechanicalRoleEvaluator();
  }

  recalculate(state: GameState): void {
    for (const player of state.players) {
      if (player.controlled) continue;
      const rule = Object.values(this.definitions).flatMap((definition) => definition.rules)
        .find((candidate) => this.conditionEvaluator.evaluate(candidate.when, player, state));
      player.desiredPosition = rule ? this.resolve(rule.target, state) : undefined;
    }
  }

  private resolve(target: PositionTarget, state: GameState): { x: number; y: number } | undefined {
    if (target.type === 'fixed') return { ...target.position };
    if (target.type === 'area') {
      const effect = state.effects.find((candidate) => candidate.resolvedAt === undefined && (!target.mechanic || candidate.mechanic === target.mechanic));
      return effect ? { x: effect.position.x + (target.offset?.x ?? 0), y: effect.position.y + (target.offset?.y ?? 0) } : undefined;
    }
    const entity = this.resolveReference(target.player, state);
    return entity ? { x: entity.position.x + (target.offset?.x ?? 0), y: entity.position.y + (target.offset?.y ?? 0) } : undefined;
  }

  private resolveReference(reference: EntityReference, state: GameState) {
    if (reference.type === 'id') return findEntity(state, reference.id);
    if (reference.type === 'gameplay_role') return state.players.find((player) => player.role === reference.role && player.alive);
    return state.players.find((player) => player.mechanicalRoles.includes(reference.role) && player.alive);
  }
}
