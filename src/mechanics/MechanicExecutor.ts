import type { GameState } from '../simulation/GameState';
import type { Random } from '../simulation/Random';
import { findEntity, selectPlayers } from './Selector';
import type { EncounterEvent, SpawnAreaEvent, ShowGraphicEvent } from './Event';
import type { AreaEffect, EffectDefinition, DamageDefinition, SpawnAreaEffect } from './Effect';
import { DamageResolver } from './DamageResolver';
import type { StatusDefinition } from '../entities/Status';
import type { RandomContext } from '../simulation/RandomContext';
import type { ApplyStatusAssignment, DistributeStatusesEffect } from './Effect';
import type { GraphicAnchor } from './Graphic';
import { formatStatusName } from '../util/format';
import type { CastDefinition } from './Cast';

export class MechanicExecutor {
  private readonly state: GameState;
  private readonly random: Random;
  private readonly damageResolver: DamageResolver;
  private readonly randomContext: RandomContext;
  private readonly statusDefinitions: Map<string, StatusDefinition>;
  private readonly castDefinitions: Record<string, CastDefinition>;
  private readonly recalculateRoles: (group?: string) => void;
  private readonly recalculatePositions: (group?: string) => void;

  constructor(
    state: GameState,
    random: Random,
    statuses: StatusDefinition[],
    casts: Record<string, CastDefinition> = {},
    randomContext: RandomContext,
    recalculateRoles: (group?: string) => void = () => undefined,
    recalculatePositions: (group?: string) => void = () => undefined
  ) {
    this.state = state;
    this.random = random;
    this.damageResolver = new DamageResolver(statuses);
    this.randomContext = randomContext;
    this.statusDefinitions = new Map(statuses.map((status) => [status.id, status]));
    this.castDefinitions = casts;
    this.recalculateRoles = recalculateRoles;
    this.recalculatePositions = recalculatePositions;
  }

  execute(event: EncounterEvent): void {
    if (event.type === 'set_mechanic') this.state.currentMechanic = event.mechanic;
    else if (event.type === 'apply_status') for (const player of selectPlayers(event.target, this.state, this.random)) this.applyStatus(player, event.status, event.duration);
    else if (event.type === 'damage') this.applyDamage(selectPlayers(event.target, this.state, this.random), event.damage);
    else if (event.type === 'heal') this.healPlayers(selectPlayers(event.target, this.state, this.random), event.amount, event.full);
    else if (event.type === 'start_cast') this.startCast(event.cast, event.source, event.mechanic);
    else if (event.type === 'remove_status') for (const player of selectPlayers(event.target, this.state, this.random)) this.removeStatus(player, event.status);
    else if (event.type === 'spawn_area') this.spawnArea(this.randomContext.resolve(event));
    else if (event.type === 'set_background') this.state.background = event.image;
    else if (event.type === 'show_graphic') this.showGraphicEvent(event);
  }

  update(): void {
    for (const cast of [...this.state.casts]) {
      if (cast.completesAt > this.state.time) continue;
      const definition = this.castDefinitions[cast.definitionId];
      this.state.casts = this.state.casts.filter((active) => active.id !== cast.id);
      if (!definition) continue;
      for (const rawEffect of definition.effects) this.executeEffect(this.randomContext.resolve(rawEffect), new Set(), cast.sourceId, definition.name);
    }
  }

  expireStatuses(): void {
    for (const player of this.state.players) {
      for (const status of [...player.statuses]) {
        if (status.expiresAt !== undefined && status.expiresAt <= this.state.time) this.removeStatus(player, status.definitionId);
      }
    }
  }

  private spawnArea(event: SpawnAreaEvent | SpawnAreaEffect): void {
    const source = event.position ?? findEntity(this.state, event.source ?? '')?.position;
    if (!source) return;
    const base = {
      id: `effect-${this.state.effects.length + 1}`,
      position: { ...source }, rotation: 0, createdAt: this.state.time,
      telegraphDuration: event.telegraphDuration, duration: event.duration,
      radius: event.radius, element: event.element, mechanic: event.mechanic, resolution: event.resolution,
      telegraphColor: event.telegraphColor, executionColor: event.executionColor
    };
    if (event.direction === 'back') base.rotation = Math.PI;
    const effect: AreaEffect = event.shape === 'cone'
      ? { ...base, shape: 'cone', angle: event.angle ?? 60 }
      : event.shape === 'half_room'
        ? { ...base, shape: 'half_room', side: event.side ?? 'north' }
        : { ...base, shape: 'circle' };
    this.state.effects.push(effect);
  }

  private showGraphicEvent(event: ShowGraphicEvent): void {
    const anchor: GraphicAnchor = event.position ? { type: 'position', position: event.position } : { type: 'entity', entity: event.source ?? 'boss' };
    this.spawnGraphic(event.image, anchor, event.radius, event.duration);
  }

  private spawnGraphic(image: string, anchor: GraphicAnchor, radius = 1.5, duration: number): void {
    this.state.worldGraphics.push({ id: `graphic-${this.state.worldGraphics.length + 1}-${this.state.time}`, image, anchor, radius, createdAt: this.state.time, duration });
  }

  private startCast(castId: string, sourceId: string, mechanic?: string): void {
    const definition = this.castDefinitions[castId];
    if (!definition || this.state.casts.some((cast) => cast.sourceId === sourceId && cast.definitionId === castId)) return;
    if (mechanic) this.state.currentMechanic = mechanic;
    this.state.casts.push({ id: `cast-${this.state.casts.length + 1}`, definitionId: castId, sourceId, startedAt: this.state.time, completesAt: this.state.time + definition.castTime });
  }

  executeEffect(effect: EffectDefinition, inside: Set<string>, sourceId = 'boss', sourceName?: string): void {
    const resolvedEffect = this.randomContext.resolve(effect);
    if (resolvedEffect.type === 'assign_distribution') {
      const participants = this.state.players.filter((player) => player.alive && inside.has(player.id));
      const values = this.randomContext.rollDistribution(resolvedEffect.distribution);
      participants.forEach((player, index) => this.applyAssignment(player, this.randomContext.resolveAssigned(resolvedEffect.effect, values[index])));
      return;
    }
    if (resolvedEffect.type === 'distribute_statuses') {
      this.distributeStatuses(resolvedEffect);
      return;
    }
    if (resolvedEffect.type === 'start_cast') { this.startCast(resolvedEffect.cast, resolvedEffect.source ?? sourceId, resolvedEffect.mechanic); return; }
    if (resolvedEffect.type === 'set_mechanic') { this.state.currentMechanic = resolvedEffect.mechanic; return; }
    if (resolvedEffect.type === 'recalculate_roles') { this.recalculateRoles(resolvedEffect.group); return; }
    if (resolvedEffect.type === 'recalculate_positions') { this.recalculatePositions(resolvedEffect.group); return; }
    if (resolvedEffect.type === 'spawn_area') { this.spawnArea({ ...resolvedEffect, source: resolvedEffect.source ?? sourceId }); return; }
    if (resolvedEffect.type === 'remove_status') { for (const player of selectPlayers(resolvedEffect.target, this.state, this.random)) this.removeStatus(player, resolvedEffect.status); return; }
    if (resolvedEffect.type === 'show_graphic') { this.spawnGraphic(resolvedEffect.image, resolvedEffect.anchor ?? { type: 'entity', entity: sourceId }, resolvedEffect.radius, resolvedEffect.duration); return; }
    const targets = typeof resolvedEffect.target === 'string'
      ? (resolvedEffect.target === 'all'
        ? this.state.players.filter((player) => player.alive)
        : this.state.players.filter((player) => player.alive && (resolvedEffect.target === 'inside' ? inside.has(player.id) : !inside.has(player.id))))
      : selectPlayers(resolvedEffect.target, this.state, this.random);
    if (resolvedEffect.type === 'damage') this.applyDamage(targets, resolvedEffect.damage, sourceName);
    else if (resolvedEffect.type === 'heal') this.healPlayers(targets, resolvedEffect.amount, resolvedEffect.full);
    else for (const player of targets) this.applyStatus(player, resolvedEffect.status, resolvedEffect.duration);
  }

  private healPlayers(players: typeof this.state.players, amount?: number, full?: boolean): void {
    for (const player of players) {
      if (!player.alive) continue;
      const max = player.maxHealth ?? player.health;
      player.health = full === false ? Math.min(max, player.health + (amount ?? 0)) : max;
    }
  }

  private applyDamage(players: typeof this.state.players, damage: DamageDefinition, sourceName?: string): void {
    for (const player of players) {
      const result = this.damageResolver.resolve(player, damage);
      if (player.controlled) {
        if (result.fatal) this.logEvent(`You took fatal ${damage.type} damage${sourceName ? ` from ${sourceName}` : ''}.`);
        else this.logEvent(`${sourceName ? `You were hit by ${sourceName} for` : 'You were hit for'} ${Math.round(result.amount)} ${damage.type} damage.`);
      }
    }
  }

  private distributeStatuses(effect: DistributeStatusesEffect): void {
    const players = this.random.shuffle(selectPlayers(effect.target, this.state, this.random));
    const statuses = this.random.shuffle(effect.statuses.map((status) => this.randomContext.resolve(status)));

    for (let index = 0; index < Math.min(players.length, statuses.length); index += 1) {
      this.applyStatus(players[index], statuses[index], effect.duration);
    }
  }

  private applyAssignment(player: typeof this.state.players[number], effect: ApplyStatusAssignment): void {
    if (effect.type === 'apply_status' && effect.status) this.applyStatus(player, effect.status, effect.duration);
  }

  private applyStatus(player: typeof this.state.players[number], statusId: string, duration: number | undefined): void {
    player.statuses.push({ definitionId: statusId, appliedAt: this.state.time, expiresAt: duration === undefined ? undefined : this.state.time + duration, stacks: 1 });
    if (player.controlled) this.logEvent(`You were affected by ${formatStatusName(statusId)}.`);
    const definition = this.statusDefinitions.get(statusId);
    for (const effect of definition?.onApply ?? []) this.executeEffect(effect, new Set(), player.id);
  }

  private removeStatus(player: typeof this.state.players[number], statusId: string): void {
    const index = player.statuses.findIndex((status) => status.definitionId === statusId);
    if (index === -1) return;
    player.statuses.splice(index, 1);
    const definition = this.statusDefinitions.get(statusId);
    for (const effect of definition?.onRemove ?? []) this.executeEffect(effect, new Set(), player.id);
    if (player.controlled) this.logEvent(`Your ${formatStatusName(statusId)} status ended.`);
  }

  private logEvent(message: string): void { this.state.log.push({ id: `log-${this.state.log.length + 1}`, time: this.state.time, message }); }
}
