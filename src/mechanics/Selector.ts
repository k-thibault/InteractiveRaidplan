import { distance } from '../geometry/Vector2';
import type { Entity } from '../entities/Entity';
import type { Player, PlayerRole } from '../entities/Player';
import type { Random } from '../simulation/Random';
import type { GameState } from '../simulation/GameState';

export type PlayerSelector =
  | { type: 'all' }
  | { type: 'role'; role: PlayerRole }
  | { type: 'role_any'; roles: PlayerRole[] }
  | { type: 'random'; count: number; role?: PlayerRole; roles?: PlayerRole[] }
  | { type: 'nearest'; source: string }
  | { type: 'with_status'; status: string }
  | { type: 'without_status'; status: string }
  | { type: 'mechanical_role'; role: string }
  | { type: 'and'; selectors: PlayerSelector[] }
  | { type: 'or'; selectors: PlayerSelector[] };

export function findEntity(state: GameState, id: string): Entity | undefined {
  return [...state.players, ...state.enemies].find((entity) => entity.id === id);
}

export function selectPlayers(selector: PlayerSelector, state: GameState, random: Random): Player[] {
  let players = state.players.filter((player) => player.alive);
  if (selector.type === 'all') return players;
  if (selector.type === 'role') return players.filter((player) => player.role === selector.role);
  if (selector.type === 'role_any') return players.filter((player) => selector.roles.includes(player.role));
  if (selector.type === 'with_status') return players.filter((player) => player.statuses.some((status) => status.definitionId === selector.status));
  if (selector.type === 'without_status') return players.filter((player) => !player.statuses.some((status) => status.definitionId === selector.status));
  if (selector.type === 'mechanical_role') return players.filter((player) => player.mechanicalRoles.includes(selector.role));
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
    return random.shuffle(players).slice(0, selector.count);
  }
  const source = findEntity(state, selector.source);
  return source ? players.sort((a, b) => distance(a.position, source.position) - distance(b.position, source.position)).slice(0, 1) : [];
}
