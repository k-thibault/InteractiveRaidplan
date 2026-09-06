import type { Player } from '../entities/Player';
import type { GameState } from '../simulation/GameState';

export type Condition =
  | { type: 'has_status'; status: string }
  | { type: 'not_has_status'; status: string }
  | { type: 'gameplay_role'; role: Player['role'] }
  | { type: 'mechanical_role'; role: string }
  | { type: 'mechanic'; mechanic: string }
  | { type: 'active_cast'; cast: string; source?: string }
  | { type: 'active_area'; mechanic?: string; element?: string }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] }
  | { type: 'player_condition'; player: PlayerReference; condition: Condition };

export type PlayerReference =
  | { type: 'self' }
  | { type: 'mechanical_role'; role: string }
  | { type: 'gameplay_role'; role: Player['role'] }
  | { type: 'id'; id: string };

export interface MechanicalRoleRule { when: Condition; }
export interface MechanicalRoleDefinition { rules: MechanicalRoleRule[]; }

export class MechanicalRoleEvaluator {
  private readonly definitions: Record<string, MechanicalRoleDefinition>;

  constructor(definitions: Record<string, MechanicalRoleDefinition> = {}) { this.definitions = definitions; }

  recalculate(state: GameState): void {
    const assignments = new Map<string, string[]>();
    for (const player of state.players) {
      const roles = Object.entries(this.definitions)
        .filter(([, definition]) => definition.rules.some((rule) => this.matches(rule.when, player, state)))
        .map(([role]) => role);
      assignments.set(player.id, roles);
    }
    for (const player of state.players) player.mechanicalRoles = assignments.get(player.id) ?? [];
  }

  evaluate(condition: Condition, player: Player, state: GameState): boolean { return this.matches(condition, player, state); }

  private matches(condition: Condition, player: Player, state: GameState): boolean {
    switch (condition.type) {
      case 'has_status': return player.statuses.some((status) => status.definitionId === condition.status);
      case 'not_has_status': return !player.statuses.some((status) => status.definitionId === condition.status);
      case 'gameplay_role': return player.role === condition.role;
      case 'mechanical_role': return player.mechanicalRoles.includes(condition.role);
      case 'mechanic': return state.currentMechanic === condition.mechanic;
      case 'active_cast': return state.casts.some((cast) => cast.definitionId === condition.cast && (!condition.source || cast.sourceId === condition.source));
      case 'active_area': return state.effects.some((effect) =>
        effect.resolvedAt === undefined &&
        (condition.mechanic === undefined || effect.mechanic === condition.mechanic) &&
        (condition.element === undefined || effect.element === condition.element));
      case 'and': return condition.conditions.every((child) => this.matches(child, player, state));
      case 'or': return condition.conditions.some((child) => this.matches(child, player, state));
      case 'player_condition': return state.players.some((candidate) => this.matchesReference(candidate, condition.player) && this.matches(condition.condition, candidate, state));
    }
  }

  private matchesReference(player: Player, reference: PlayerReference): boolean {
    if (reference.type === 'self') return true;
    if (reference.type === 'id') return player.id === reference.id;
    if (reference.type === 'gameplay_role') return player.role === reference.role;
    return player.mechanicalRoles.includes(reference.role);
  }
}
