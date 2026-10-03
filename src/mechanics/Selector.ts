import { distance } from '../geometry/Vector2';
import { isFacingTowards, isFacingAway, DEFAULT_FACING } from '../geometry/Facing';
import type { Entity } from '../entities/Entity';
import type { Player, PlayerRole } from '../entities/Player';
import type { Random } from '../simulation/Random';
import type { GameState } from '../simulation/GameState';
import type { EntityReference } from '../bots/PositionTarget';

/** An entity id, or a fixed world point, to test facing against. */
export type FacingSource = string | { x: number; y: number };

export type PlayerSelector =
  | { type: 'all' }
  | { type: 'role'; role: PlayerRole }
  | { type: 'role_any'; roles: PlayerRole[] }
  /** `from` restricts the pool before picking, e.g. to exclude players who already have a status. */
  | { type: 'random'; count: number; role?: PlayerRole; roles?: PlayerRole[]; from?: PlayerSelector }
  /** The closest alive players to `source`, nearest first. `role`/`roles` filter before ranking. */
  | { type: 'nearest'; source: string; count?: number; role?: PlayerRole; roles?: PlayerRole[] }
  | { type: 'with_status'; status: string }
  | { type: 'without_status'; status: string }
  | { type: 'mechanical_role'; role: string }
  /** Players captured into a named runtime group. */
  | { type: 'from_group'; group: string }
  /** Players facing towards or away from a source within the given tolerance. */
  | { type: 'facing'; source: FacingSource; mode: 'towards' | 'away'; tolerance?: number }
  | { type: 'and'; selectors: PlayerSelector[] }
  | { type: 'or'; selectors: PlayerSelector[] };

export function findEntity(state: GameState, id: string): Entity | undefined {
  return [...state.players, ...state.enemies].find((entity) => entity.id === id);
}

/** Role references match the first living player; id references match any entity. */
export function resolveEntityReference(reference: EntityReference, state: GameState): Entity | undefined {
  if (reference.type === 'id') return findEntity(state, reference.id);
  if (reference.type === 'gameplay_role') return state.players.find((player) => player.role === reference.role && player.alive);
  return state.players.find((player) => player.mechanicalRoles.includes(reference.role) && player.alive);
}

export function selectPlayers(selector: PlayerSelector, state: GameState, random: Random): Player[] {
  let players = state.players.filter((player) => player.alive);
  if (selector.type === 'all') return players;
  if (selector.type === 'role') return players.filter((player) => player.role === selector.role);
  if (selector.type === 'role_any') return players.filter((player) => selector.roles.includes(player.role));
  if (selector.type === 'with_status') return players.filter((player) => player.statuses.some((status) => status.definitionId === selector.status));
  if (selector.type === 'without_status') return players.filter((player) => !player.statuses.some((status) => status.definitionId === selector.status));
  if (selector.type === 'mechanical_role') return players.filter((player) => player.mechanicalRoles.includes(selector.role));
  if (selector.type === 'from_group') {
    const ids = new Set((state.groups?.[selector.group] ?? []).map((entry) => entry.id));
    return players.filter((player) => ids.has(player.id));
  }
  if (selector.type === 'facing') {
    const point = typeof selector.source === 'string' ? findEntity(state, selector.source)?.position : selector.source;
    if (!point) return [];
    const test = selector.mode === 'towards' ? isFacingTowards : isFacingAway;
    return players.filter((player) => test(player.position, player.facing ?? DEFAULT_FACING, point, selector.tolerance));
  }
  if (selector.type === 'and') {
    return players.filter((player) => selector.selectors.every((child) => selectPlayers(child, state, random).some((candidate) => candidate.id === player.id)));
  }
  if (selector.type === 'or') {
    const ids = new Set(selector.selectors.flatMap((child) => selectPlayers(child, state, random).map((candidate) => candidate.id)));
    return players.filter((player) => ids.has(player.id));
  }
  if (selector.type === 'random') {
    if (selector.role) players = players.filter((player) => player.role === selector.role);
    if (selector.roles) players = players.filter((player) => selector.roles!.includes(player.role));
    if (selector.from) {
      const pool = new Set(selectPlayers(selector.from, state, random).map((player) => player.id));
      players = players.filter((player) => pool.has(player.id));
    }
    return random.shuffle(players).slice(0, selector.count);
  }
  if (selector.role) players = players.filter((player) => player.role === selector.role);
  if (selector.roles) players = players.filter((player) => selector.roles!.includes(player.role));
  const source = findEntity(state, selector.source);
  return source ? players.sort((a, b) => distance(a.position, source.position) - distance(b.position, source.position)).slice(0, selector.count ?? 1) : [];
}
