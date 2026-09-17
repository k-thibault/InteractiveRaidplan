import type { Vector2 } from '../geometry/Vector2';

/**
 * A single member captured into a runtime group. `position` is a snapshot
 * taken at the moment the group was built (by `select_group`,
 * `select_group_subset`, or `spawn_enemy`'s `addToGroup`) - it does not
 * track the entity afterward, so effects that read it later (e.g. spawning
 * an add at "where that soak landed") stay fixed even if the entity moves
 * or dies.
 */
export interface GroupEntry {
  id: string;
  position: Vector2;
}
