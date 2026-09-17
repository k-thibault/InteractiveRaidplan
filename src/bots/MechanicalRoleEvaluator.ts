import type { Player } from '../entities/Player';
import type { GameState } from '../simulation/GameState';

export type Condition =
  | { type: 'has_status'; status: string }
  | { type: 'not_has_status'; status: string }
  | { type: 'gameplay_role'; role: Player['role'] }
  | { type: 'damage_position'; position: NonNullable<Player['damagePosition']> }
  | { type: 'team'; team: NonNullable<Player['team']> }
  | { type: 'mechanical_role'; role: string }
  | { type: 'mechanic'; mechanic: string }
  | { type: 'active_cast'; cast: string; source?: string }
  | { type: 'active_area'; mechanic?: string; element?: string }
  | { type: 'and'; conditions: ConditionExpression[] }
  | { type: 'or'; conditions: ConditionExpression[] }
  | { type: 'not'; condition: ConditionExpression }
  | { type: 'player_condition'; player: PlayerReference; condition: ConditionExpression }
  | { type: 'flex_conflict_loser'; pairRole: string; statuses: string[] };

export type ConditionExpression = Condition | ConditionExpression[];
export interface RoleChange { playerId: string; added: string[]; removed: string[]; }

export type MechanicalRoleGroup = Record<string, ConditionExpression>;
export type MechanicalRoleDefinitions = Record<string, MechanicalRoleGroup>;

export type PlayerReference =
  | { type: 'self' }
  | { type: 'mechanical_role'; role: string }
  | { type: 'gameplay_role'; role: Player['role'] }
  | { type: 'id'; id: string }
  | { type: 'team_partner' };

export class MechanicalRoleEvaluator {
  private readonly definitions: MechanicalRoleDefinitions;

  constructor(definitions: MechanicalRoleDefinitions = {}) { this.definitions = definitions; }

  recalculate(state: GameState, group?: string): RoleChange[] {
    const definition = group ? this.definitions[group] : undefined;
    const groups = definition ? [definition] : Object.values(this.definitions);
    const roleKeys = new Set(groups.flatMap((current) => Object.keys(current)));
    const assignments = new Map<string, string[]>();

    for (const player of state.players) {
      const roles = groups
        .flatMap((current) => Object.entries(current))
        .filter(([, condition]) => this.matches(condition, player, state))
        .map(([role]) => role);
      assignments.set(player.id, roles);
    }
    const changes: RoleChange[] = [];
    for (const player of state.players) {
      const kept = player.mechanicalRoles.filter((role) => !roleKeys.has(role));
      const next = [...kept, ...(assignments.get(player.id) ?? [])];
      const added = next.filter((role) => !player.mechanicalRoles.includes(role));
      const removed = player.mechanicalRoles.filter((role) => !next.includes(role));
      if (added.length || removed.length) changes.push({ playerId: player.id, added, removed });
      player.mechanicalRoles = next;
    }
    return changes;
  }

  evaluate(condition: ConditionExpression, player: Player, state: GameState): boolean {
    return this.matches(condition, player, state);
  }

  private matches(condition: ConditionExpression, player: Player, state: GameState): boolean {
    if (Array.isArray(condition)) return condition.every((child) => this.matches(child, player, state));

    switch (condition.type) {
      case 'has_status': return player.statuses.some((status) => status.definitionId === condition.status);
      case 'not_has_status': return !player.statuses.some((status) => status.definitionId === condition.status);
      case 'gameplay_role': return player.role === condition.role;
      case 'damage_position': return player.damagePosition === condition.position;
      case 'team': return player.team === condition.team;
      case 'mechanical_role': return player.mechanicalRoles.includes(condition.role);
      case 'mechanic': return state.currentMechanic === condition.mechanic;
      case 'active_cast': return state.casts.some((cast) => cast.definitionId === condition.cast && (!condition.source || cast.sourceId === condition.source));
      case 'active_area': return state.effects.some((effect) =>
        effect.resolvedAt === undefined &&
        (condition.mechanic === undefined || effect.mechanic === condition.mechanic) &&
        (condition.element === undefined || effect.element === condition.element));
      case 'and': return condition.conditions.every((child) => this.matches(child, player, state));
      case 'or': return condition.conditions.some((child) => this.matches(child, player, state));
      case 'not': return !this.matches(condition.condition, player, state);
      case 'player_condition':
        return state.players.some((candidate) =>
          this.matchesReference(candidate, condition.player, player) &&
          this.matches(condition.condition, candidate, state));
      case 'flex_conflict_loser': {
        const requiredRoles = Array.isArray(condition.pairRole) ? condition.pairRole : [condition.pairRole];
        if (!requiredRoles.every((role) => player.mechanicalRoles.includes(role))) return false;
        const partner = state.players.find((candidate) =>
          candidate.id !== player.id &&
          requiredRoles.every((role) => candidate.mechanicalRoles.includes(role)));
        if (!partner) return false;
        const sharedStatus = condition.statuses.some((statusId) =>
          player.statuses.some((status) => status.definitionId === statusId) &&
          partner.statuses.some((status) => status.definitionId === statusId));
        return sharedStatus && (player.flexPriority ?? 0) < (partner.flexPriority ?? 0);
      }
    }
  }

  private matchesReference(player: Player, reference: PlayerReference, owner?: Player): boolean {
    if (reference.type === 'self') return owner ? player.id === owner.id : true;
    if (reference.type === 'id') return player.id === reference.id;
    if (reference.type === 'gameplay_role') return player.role === reference.role;
    if (reference.type === 'team_partner') return !!owner?.team && player.team === owner.team && player.id !== owner.id;
    return player.mechanicalRoles.includes(reference.role);
  }
}
