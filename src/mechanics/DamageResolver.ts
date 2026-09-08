import type { Player } from '../entities/Player';
import type { StatusDefinition } from '../entities/Status';
import type { DamageDefinition } from './Effect';

export interface DamageResult { amount: number; fatal: boolean; killed: boolean; }

export class DamageResolver {
  private readonly definitions: Map<string, StatusDefinition>;

  constructor(statuses: StatusDefinition[]) { this.definitions = new Map(statuses.map((status) => [status.id, status])); }

  resolve(target: Player, damage: DamageDefinition): DamageResult {
    let amount = damage.amount;
    let fatal = damage.fatal ?? false;
    for (const instance of target.statuses) {
      const definition = this.definitions.get(instance.definitionId);
      for (const modifier of definition?.damageTaken ?? []) {
        if (modifier.damageType !== undefined && modifier.damageType !== damage.type) continue;
        if (modifier.multiplier !== undefined) amount *= modifier.multiplier;
        if (modifier.fatal) fatal = true;
      }
    }
    const killed = fatal || amount >= target.health;
    if (fatal) {
     target.health = 0;
    } else {
     target.health = Math.max(0, target.health - amount);
    }
    if (killed) target.alive = false;
    return { amount, fatal, killed };
  }
}