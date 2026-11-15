import type { Player } from '../entities/Player';
import type { StatusDefinition, StatusInstance } from '../entities/Status';
import type { DamageDefinition } from './Effect';

export interface DamageResult {
  /** Health actually lost, except that an unprevented hit reports its full amount. */
  amount: number; fatal: boolean; killed: boolean;
  /** Set when an immunity status changed the outcome. */
  prevented?: 'invulnerable' | 'undying';
  /** Immunity statuses that used their last charge and should now fade. */
  spent: string[];
}

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
    const lethal = fatal || amount >= target.health;
    const shield = damage.bypassImmunity ? undefined : this.findImmunity(target);
    const spent: string[] = [];
    if (shield?.mode === 'invulnerable') {
      if (lethal) this.spendCharge(shield.instance, spent);
      return { amount: 0, fatal: false, killed: false, prevented: 'invulnerable', spent };
    }
    if (shield && lethal) {
      amount = target.health - 1;
      target.health = 1;
      this.spendCharge(shield.instance, spent);
      return { amount, fatal: false, killed: false, prevented: 'undying', spent };
    }
    if (fatal) {
      target.health = 0;
    } else {
      target.health = Math.max(0, target.health - amount);
    }
    if (lethal) target.alive = false;
    return { amount, fatal, killed: lethal, spent };
  }

  /** Invulnerability wins over undying; otherwise the earliest applied status counts. */
  private findImmunity(target: Player): { instance: StatusInstance; mode: 'invulnerable' | 'undying' } | undefined {
    let undying: { instance: StatusInstance; mode: 'undying' } | undefined;
    for (const instance of target.statuses) {
      const mode = this.definitions.get(instance.definitionId)?.damageImmunity?.mode;
      if (mode === 'invulnerable') return { instance, mode };
      if (mode === 'undying') undying ??= { instance, mode };
    }
    return undying;
  }

  private spendCharge(instance: StatusInstance, spent: string[]): void {
    const charges = instance.charges ?? this.definitions.get(instance.definitionId)?.damageImmunity?.charges;
    if (charges === undefined) return;
    instance.charges = charges - 1;
    if (instance.charges <= 0) spent.push(instance.definitionId);
  }
}
