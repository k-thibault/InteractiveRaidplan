import type { GameState } from '../simulation/GameState';
import type { Random } from '../simulation/Random';
import { findEntity, selectPlayers } from './Selector';
import type { EncounterEvent, SpawnAreaEvent, ShowGraphicEvent, SpawnEnemyEvent, SelectGroupEvent, SelectGroupSubsetEvent, ForEachGroupEvent } from './Event';
import type { AreaEffect, EffectDefinition, DamageDefinition, SpawnAreaEffect, AreaDefinition, SpawnEnemyEffect } from './Effect';
import { DamageResolver } from './DamageResolver';
import type { StatusDefinition } from '../entities/Status';
import type { Enemy, EnemyTemplate } from '../entities/Enemy';
import type { RandomContext } from '../simulation/RandomContext';
import type { ApplyStatusAssignment, DistributeStatusesEffect } from './Effect';
import type { GraphicAnchor } from './Graphic';
import { formatStatusName } from '../util/format';
import type { CastDefinition, CastFacing } from './Cast';
import { resolvePositionValue, isTowardsPosition } from '../geometry/Vector2';
import type { PositionValue, Vector2 } from '../geometry/Vector2';

/** Carries the cast's locked target/direction into nested effects. */
interface CastContext { direction?: number; targetId?: string; }

export class MechanicExecutor {
  private readonly state: GameState;
  private readonly random: Random;
  private readonly damageResolver: DamageResolver;
  private readonly randomContext: RandomContext;
  private readonly statusDefinitions: Map<string, StatusDefinition>;
  private readonly castDefinitions: Record<string, CastDefinition>;
  private readonly areaDefinitions: Record<string, AreaDefinition>;
  private readonly enemyTemplates: Record<string, EnemyTemplate>;
  private readonly recalculateRoles: (group?: string) => void;
  private readonly recalculatePositions: (group?: string, params?: Record<string, number>) => void;
  private readonly pendingEffects: { executeAt: number; effects: EffectDefinition[]; inside: Set<string>; sourceId: string; sourceName?: string; cast?: CastContext }[] = [];
  /** Stores the outcomes of replayable rolls, keyed by `replayId`. */
  private readonly replayOutcomes: Map<string, Record<string, unknown>>;

  constructor(
    state: GameState,
    random: Random,
    statuses: StatusDefinition[],
    casts: Record<string, CastDefinition> = {},
    randomContext: RandomContext,
    areas: Record<string, AreaDefinition> = {},
    recalculateRoles: (group?: string) => void = () => undefined,
    recalculatePositions: (group?: string, params?: Record<string, number>) => void = () => undefined,
    enemyTemplates: Record<string, EnemyTemplate> = {},
    replayOutcomes: Map<string, Record<string, unknown>> = new Map()
  ) {
    this.state = state;
    this.random = random;
    this.damageResolver = new DamageResolver(statuses);
    this.randomContext = randomContext;
    this.statusDefinitions = new Map(statuses.map((status) => [status.id, status]));
    this.castDefinitions = casts;
    this.areaDefinitions = areas;
    this.enemyTemplates = enemyTemplates;
    this.recalculateRoles = recalculateRoles;
    this.recalculatePositions = recalculatePositions;
    this.replayOutcomes = replayOutcomes;
  }

  /** Reads a single recorded replay value for this `replayId`. */
  private getReplay<T>(replayId: string | undefined, key: string): T | undefined {
    return replayId ? (this.replayOutcomes.get(replayId)?.[key] as T | undefined) : undefined;
  }

  /** Records a replayed value under this `replayId`. */
  private setReplay(replayId: string | undefined, key: string, value: unknown): void {
    if (!replayId) return;
    this.replayOutcomes.set(replayId, { ...this.replayOutcomes.get(replayId), [key]: value });
  }

  execute(event: EncounterEvent): void {
    if (event.type === 'set_mechanic') this.state.currentMechanic = event.mechanic;
    else if (event.type === 'apply_status') for (const player of selectPlayers(event.target, this.state, this.random)) this.applyStatus(player, event.status, event.duration, event.stacks ?? 1);
    else if (event.type === 'distribute_statuses') this.distributeStatuses(event, selectPlayers(event.target, this.state, this.random), event.replayId);
    else if (event.type === 'damage') this.applyDamage(selectPlayers(event.target, this.state, this.random), event.damage);
    else if (event.type === 'heal') this.healPlayers(selectPlayers(event.target, this.state, this.random), event.amount, event.full);
    else if (event.type === 'start_cast') {
      const cast = this.resolveCastChoice(event.cast, event.castChoices);
      // When the cast was rolled from `castChoices` and no `mechanic` was given, default the mechanic flag to
      // whichever cast got picked, so `{"type":"mechanic"}` position/role rules can react to the outcome.
      this.startCast(cast, event.source, event.mechanic ?? (event.castChoices ? cast : undefined), event.facing, event.replayId);
    }
    else if (event.type === 'remove_status') for (const player of selectPlayers(event.target, this.state, this.random)) this.removeStatus(player, event.status, event.stacks ?? 1);
    else if (event.type === 'spawn_area') this.spawnArea(this.randomContext.resolve(event));
    else if (event.type === 'set_background') this.state.background = event.image;
    else if (event.type === 'show_graphic') this.showGraphicEvent(event);
    else if (event.type === 'select_group') this.selectGroup(this.randomContext.resolve(event));
    else if (event.type === 'select_group_subset') this.selectGroupSubset(event);
    else if (event.type === 'for_each_group') this.forEachGroup(this.randomContext.resolve(event), new Set(), 'boss', undefined, undefined);
    else if (event.type === 'spawn_enemy') this.spawnEnemy(this.randomContext.resolve(event));
    else if (event.type === 'remove_enemy') this.removeEnemy(event.id);
  }

  update(): void {
    for (const cast of [...this.state.casts]) {
      if (cast.completesAt > this.state.time) continue;
      const definition = this.castDefinitions[cast.definitionId];
      this.state.casts = this.state.casts.filter((active) => active.id !== cast.id);
      if (!definition) continue;
      const context: CastContext = { direction: cast.direction, targetId: cast.targetId };
      for (const rawEffect of definition.effects) this.executeEffect(this.randomContext.resolve(rawEffect), new Set(), cast.sourceId, definition.name, context);
    }
    for (const pending of [...this.pendingEffects]) {
      if (pending.executeAt > this.state.time) continue;
      this.pendingEffects.splice(this.pendingEffects.indexOf(pending), 1);
      for (const rawEffect of pending.effects) this.executeEffect(this.randomContext.resolve(rawEffect), pending.inside, pending.sourceId, pending.sourceName, pending.cast);
    }
  }

  expireStatuses(): void {
    for (const player of this.state.players) {
      for (const status of [...player.statuses]) {
        if (status.expiresAt !== undefined && status.expiresAt <= this.state.time) this.removeStatus(player, status.definitionId);
      }
    }
  }

  /** Removes expired temporary enemies and cancels their casts. */
  expireEnemies(): void {
    const expired = this.state.enemies.filter((enemy) => enemy.expiresAt !== undefined && enemy.expiresAt <= this.state.time);
    if (expired.length === 0) return;
    const expiredIds = new Set(expired.map((enemy) => enemy.id));
    this.state.enemies = this.state.enemies.filter((enemy) => !expiredIds.has(enemy.id));
    this.state.casts = this.state.casts.filter((cast) => !expiredIds.has(cast.sourceId));
  }

  /** Resolves positions, including live `towards` targets. */
  private resolvePosition(value: PositionValue): Vector2 | undefined {
    if (!isTowardsPosition(value)) return resolvePositionValue(value);
    const from = this.resolvePosition(value.from);
    const target = findEntity(this.state, value.target);
    if (!from || !target) return from;
    const gap = Math.hypot(target.position.x - from.x, target.position.y - from.y);
    const distance = Math.min(Number(value.distance), gap);
    if (gap === 0) return { ...from };
    const t = distance / gap;
    return { x: from.x + (target.position.x - from.x) * t, y: from.y + (target.position.y - from.y) * t };
  }

  private spawnArea(event: SpawnAreaEvent | SpawnAreaEffect, cast?: CastContext): void {
    const definition = event.area ? this.areaDefinitions[event.area] : undefined;
    if (event.area && !definition) return;
    const resolved = { ...(definition ?? {}), ...event };
    if (!resolved.shape || resolved.radius === undefined || resolved.telegraphDuration === undefined || resolved.duration === undefined || !resolved.resolution) return;
    // `$castTarget` resolves to the triggering cast's live target. 
    const anchorId = resolved.source === '$castTarget' ? cast?.targetId : resolved.source;
    const source = (resolved.position ? this.resolvePosition(resolved.position) : undefined) ?? findEntity(this.state, anchorId ?? '')?.position;
    if (!source) return;
    const base = {
      id: `effect-${this.state.effects.length + 1}`,
      position: { ...source }, rotation: 0, createdAt: this.state.time,
      telegraphDuration: resolved.telegraphDuration, duration: resolved.duration,
      radius: resolved.radius, element: resolved.element, mechanic: resolved.mechanic, resolution: resolved.resolution,
      telegraphColor: resolved.telegraphColor, executionColor: resolved.executionColor, label: resolved.label,
      tags: resolved.tags, sourceId: anchorId, excludeSource: resolved.excludeSource, telegraphStyle: resolved.telegraphStyle,
      areaGroup: resolved.areaGroup
    };
    if (resolved.direction === 'back') base.rotation = Math.PI;
    if (resolved.direction === 'nearest_player' || resolved.direction === 'random_player') {
      const sourceEntity = findEntity(this.state, resolved.source ?? '');
      if (sourceEntity) {
        const replayId = resolved.replayableDirection ? resolved.replayId : undefined;
        // Reuse a recorded pick only while it still exists. 
        const recordedId = this.getReplay<string>(replayId, 'target');
        const recordedTarget = recordedId ? findEntity(this.state, recordedId) : undefined;
        const target = recordedTarget?.alive
          ? recordedTarget
          : (resolved.direction === 'nearest_player'
            ? this.state.players
              .filter((player) => player.alive && player.id !== sourceEntity.id)
              .sort((a, b) => Math.hypot(a.position.x - sourceEntity.position.x, a.position.y - sourceEntity.position.y) - Math.hypot(b.position.x - sourceEntity.position.x, b.position.y - sourceEntity.position.y))[0]
            : selectPlayers({ type: 'random', count: 1 }, this.state, this.random)[0]);
        if (target) {
          base.rotation = Math.atan2(target.position.y - sourceEntity.position.y, target.position.x - sourceEntity.position.x);
          this.setReplay(replayId, 'target', target.id);
        }
      }
    }
    // Keep the original cast direction when requested. 
    if (resolved.direction === 'cast_direction' && cast?.direction !== undefined) base.rotation = cast.direction;
    // Re-derive from the locked target's current position when requested. 
    if (resolved.direction === 'cast_target' && cast?.targetId !== undefined) {
      const sourceEntity = findEntity(this.state, resolved.source ?? '');
      const target = findEntity(this.state, cast.targetId);
      if (sourceEntity && target) base.rotation = Math.atan2(target.position.y - sourceEntity.position.y, target.position.x - sourceEntity.position.x);
    }
    if (resolved.rotationOffset) base.rotation += (resolved.rotationOffset * Math.PI) / 180;
    const effect: AreaEffect = resolved.shape === 'cone'
      ? { ...base, shape: 'cone', angle: resolved.angle ?? 60 }
      : resolved.shape === 'half_room'
        ? { ...base, shape: 'half_room', side: resolved.side ?? 'north' }
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

  private resolveCastChoice(cast: string | undefined, castChoices: string[] | undefined): string {
    if (cast) return cast;
    if (!castChoices || castChoices.length === 0) throw new Error('start_cast requires either "cast" or "castChoices"');
    return castChoices[this.random.integer(0, castChoices.length - 1)];
  }

  private startCast(castId: string, sourceId: string, mechanic?: string, facing?: CastFacing, replayId?: string): void {
    const definition = this.castDefinitions[castId];
    if (!definition || this.state.casts.some((cast) => cast.sourceId === sourceId && cast.definitionId === castId)) return;
    if (mechanic) this.state.currentMechanic = mechanic;
    // Instance facing overrides the default cast definition. 
    const effectiveFacing = facing ?? definition.facing;
    // Lock the target/direction once when the cast begins. 
    const resolved = effectiveFacing ? this.resolveFacing(effectiveFacing, sourceId, effectiveFacing.replayable ? replayId : undefined) : undefined;
    this.state.casts.push({ id: `cast-${this.state.casts.length + 1}`, definitionId: castId, sourceId, startedAt: this.state.time, completesAt: this.state.time + definition.castTime, targetId: resolved?.targetId, direction: resolved?.direction });
  }

  private resolveFacing(facing: CastFacing, sourceId: string, replayId?: string): { targetId: string; direction: number } | undefined {
    const source = findEntity(this.state, sourceId);
    if (!source) return undefined;
    // Reuse a recorded target only while it still exists. 
    const recordedId = this.getReplay<string>(replayId, 'target');
    const recordedTarget = recordedId ? findEntity(this.state, recordedId) : undefined;
    const target = recordedTarget?.alive
      ? recordedTarget
      : (facing.type === 'entity'
        ? findEntity(this.state, facing.id)
        : (facing.type === 'random_player'
          ? selectPlayers({ type: 'random', count: 1 }, this.state, this.random)
          : selectPlayers({ type: 'nearest', source: sourceId, count: 1 }, this.state, this.random))[0]);
    if (!target) return undefined;
    this.setReplay(replayId, 'target', target.id);
    return { targetId: target.id, direction: Math.atan2(target.position.y - source.position.y, target.position.x - source.position.x) };
  }

  private selectGroup(event: SelectGroupEvent | { name: string; selector: SelectGroupEvent['selector']; replayId?: string }): void {
    // Reuse a recorded group only if everyone is still alive. 
    const recorded = this.getReplay<string[]>(event.replayId, 'members');
    const recordedPlayers = recorded?.map((id) => this.state.players.find((player) => player.id === id));
    const selected = recordedPlayers?.every((player): player is typeof this.state.players[number] => !!player?.alive)
      ? recordedPlayers
      : selectPlayers(event.selector, this.state, this.random);
    this.state.groups[event.name] = selected.map((player) => ({ id: player.id, position: { ...player.position } }));
    this.setReplay(event.replayId, 'members', selected.map((player) => player.id));
  }

  private selectGroupSubset(event: SelectGroupSubsetEvent | { from: string; name: string; count: number; replayId?: string }): void {
    const source = this.state.groups[event.from] ?? [];
    const sourceIds = new Set(source.map((entry) => entry.id));
    const recorded = this.getReplay<string[]>(event.replayId, 'members');
    const recordedValid = recorded && recorded.length === event.count && recorded.every((id) => sourceIds.has(id));
    const selected = recordedValid ? recorded!.map((id) => source.find((entry) => entry.id === id)!) : this.random.shuffle(source).slice(0, event.count);
    this.state.groups[event.name] = selected;
    this.setReplay(event.replayId, 'members', selected.map((entry) => entry.id));
  }

  private forEachGroup(event: ForEachGroupEvent | { group: string; effects: EffectDefinition[] }, inside: Set<string>, sourceId: string, sourceName?: string, cast?: CastContext): void {
    const members = this.state.groups[event.group] ?? [];
    for (const member of members) {
      // Snapshot position is fixed; livePosition reads the current position. 
      const live = findEntity(this.state, member.id)?.position;
      const augmentedMember = { id: member.id, position: member.position, livePosition: live ? { ...live } : member.position };
      for (const rawEffect of event.effects) {
        this.executeEffect(this.randomContext.resolveAssigned(rawEffect, augmentedMember, 'groupMember'), inside, sourceId, sourceName, cast);
      }
    }
  }

  private spawnEnemy(event: SpawnEnemyEvent | SpawnEnemyEffect): void {
    const template = event.enemy ? this.enemyTemplates[event.enemy] : undefined;
    if (event.enemy && !template) return;
    const resolved = { ...(template ?? {}), ...event };
    const position = this.resolvePosition(resolved.position);
    if (!position) return;
    const id = `enemy-${this.state.enemies.length + 1}-${this.state.time}`;
    const enemy: Enemy = {
      id, type: 'enemy', name: resolved.name ?? 'Enemy', position: { ...position }, alive: true,
      style: resolved.style, statuses: [],
      expiresAt: resolved.expiresAfter !== undefined ? this.state.time + resolved.expiresAfter : undefined
    };
    this.state.enemies.push(enemy);
    if (resolved.addToGroup) {
      const group = this.state.groups[resolved.addToGroup] ?? [];
      this.state.groups[resolved.addToGroup] = [...group, { id, position: { ...position } }];
    }
  }

  private removeEnemy(id: string): void {
    this.state.enemies = this.state.enemies.filter((enemy) => enemy.id !== id);
    this.state.casts = this.state.casts.filter((cast) => cast.sourceId !== id);
  }

  executeEffect(effect: EffectDefinition, inside: Set<string>, sourceId = 'boss', sourceName?: string, cast?: CastContext): void {
    if (effect.type === 'delayed_effects') {
      // Resolve nested references when the delayed batch runs.
      const delay = this.randomContext.resolve(effect.delay);
      this.pendingEffects.push({ executeAt: this.state.time + delay, effects: effect.effects, inside, sourceId, sourceName, cast });
      return;
    }
    const resolvedEffect = this.randomContext.resolve(effect);
    if (resolvedEffect.type === 'assign_distribution') {
      const participants = this.state.players.filter((player) => player.alive && inside.has(player.id));
      const participantIds = new Set(participants.map((player) => player.id));
      const recorded = this.getReplay<{ playerId: string; value: unknown }[]>(resolvedEffect.replayId, 'pairs');
      const recordedValid = recorded && recorded.length === participants.length && recorded.every((pair) => participantIds.has(pair.playerId));
      if (recordedValid) {
        for (const pair of recorded!) this.applyAssignment(participants.find((player) => player.id === pair.playerId)!, this.randomContext.resolveAssigned(resolvedEffect.effect, pair.value));
      } else {
        const values = this.randomContext.rollDistribution(resolvedEffect.distribution);
        participants.forEach((player, index) => this.applyAssignment(player, this.randomContext.resolveAssigned(resolvedEffect.effect, values[index])));
        this.setReplay(resolvedEffect.replayId, 'pairs', participants.map((player, index) => ({ playerId: player.id, value: values[index] })));
      }
      return;
    }
    if (resolvedEffect.type === 'distribute_statuses') {
      const players = typeof resolvedEffect.target === 'string'
        ? this.state.players.filter((player) => player.alive && (
          resolvedEffect.target === 'all' ||
          (resolvedEffect.target === 'inside' ? inside.has(player.id) : !inside.has(player.id))))
        : selectPlayers(resolvedEffect.target, this.state, this.random);
      this.distributeStatuses(resolvedEffect, players, resolvedEffect.replayId);
      return;
    }
    if (resolvedEffect.type === 'start_cast') {
      const cast = this.resolveCastChoice(resolvedEffect.cast, resolvedEffect.castChoices);
      const mechanic = resolvedEffect.mechanic ?? (resolvedEffect.castChoices ? cast : undefined);
      this.startCast(cast, resolvedEffect.source ?? sourceId, mechanic, resolvedEffect.facing, resolvedEffect.replayId);
      return;
    }
    if (resolvedEffect.type === 'set_mechanic') { this.state.currentMechanic = resolvedEffect.mechanic; return; }
    if (resolvedEffect.type === 'recalculate_roles') { this.recalculateRoles(resolvedEffect.group); return; }
    if (resolvedEffect.type === 'recalculate_positions') { this.recalculatePositions(resolvedEffect.group, resolvedEffect.params); return; }
    if (resolvedEffect.type === 'spawn_area') { this.spawnArea({ ...resolvedEffect, source: resolvedEffect.source ?? sourceId }, cast); return; }
    if (resolvedEffect.type === 'select_group') { this.selectGroup(resolvedEffect); return; }
    if (resolvedEffect.type === 'select_group_subset') { this.selectGroupSubset(resolvedEffect); return; }
    if (resolvedEffect.type === 'for_each_group') { this.forEachGroup(resolvedEffect, inside, sourceId, sourceName, cast); return; }
    if (resolvedEffect.type === 'spawn_enemy') { this.spawnEnemy(resolvedEffect); return; }
    if (resolvedEffect.type === 'remove_enemy') { this.removeEnemy(resolvedEffect.id); return; }
    if (resolvedEffect.type === 'remove_status') {
      const targets = typeof resolvedEffect.target === 'string'
        ? this.state.players.filter((player) => player.alive && (resolvedEffect.target === 'all' || (resolvedEffect.target === 'inside' ? inside.has(player.id) : !inside.has(player.id))))
        : selectPlayers(resolvedEffect.target, this.state, this.random);
      for (const player of targets) this.removeStatus(player, resolvedEffect.status, resolvedEffect.stacks ?? 1);
      return;
    }
    if (resolvedEffect.type === 'show_graphic') { this.spawnGraphic(resolvedEffect.image, resolvedEffect.anchor ?? { type: 'entity', entity: sourceId }, resolvedEffect.radius, resolvedEffect.duration); return; }
    const targets = typeof resolvedEffect.target === 'string'
      ? (resolvedEffect.target === 'all'
        ? this.state.players.filter((player) => player.alive)
        : this.state.players.filter((player) => player.alive && (resolvedEffect.target === 'inside' ? inside.has(player.id) : !inside.has(player.id))))
      : selectPlayers(resolvedEffect.target, this.state, this.random);
    if (resolvedEffect.type === 'damage') this.applyDamage(targets, resolvedEffect.damage, sourceName);
    else if (resolvedEffect.type === 'heal') this.healPlayers(targets, resolvedEffect.amount, resolvedEffect.full);
    else for (const player of targets) this.applyStatus(player, resolvedEffect.status, resolvedEffect.duration, resolvedEffect.stacks ?? 1);
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

  private distributeStatuses(effect: DistributeStatusesEffect, selectedPlayers: typeof this.state.players, replayId?: string): void {
    const selectedIds = new Set(selectedPlayers.map((player) => player.id));
    const recorded = this.getReplay<{ playerId: string; status: string }[]>(replayId, 'pairs');
    const recordedValid = recorded && recorded.every((pair) => selectedIds.has(pair.playerId));
    if (recordedValid) {
      for (const pair of recorded!) this.applyStatus(selectedPlayers.find((player) => player.id === pair.playerId)!, pair.status, effect.duration);
      return;
    }
    const players = this.random.shuffle(selectedPlayers);
    const statuses = this.random.shuffle(effect.statuses.map((status) => this.randomContext.resolve(status)));
    const pairs: { playerId: string; status: string }[] = [];
    for (let index = 0; index < Math.min(players.length, statuses.length); index += 1) {
      this.applyStatus(players[index], statuses[index], effect.duration);
      pairs.push({ playerId: players[index].id, status: statuses[index] });
    }
    this.setReplay(replayId, 'pairs', pairs);
  }

  private applyAssignment(player: typeof this.state.players[number], effect: ApplyStatusAssignment): void {
    if (effect.type === 'apply_status' && effect.status) this.applyStatus(player, effect.status, effect.duration);
  }

  private applyStatus(player: typeof this.state.players[number], statusId: string, duration: number | undefined, stacks = 1): void {
    const definition = this.statusDefinitions.get(statusId);
    const existing = player.statuses.find((status) => status.definitionId === statusId);
    const newExpiresAt = duration === undefined ? undefined : this.state.time + duration;
    if (existing) {
      if (definition?.maxStacks) existing.stacks = Math.min(definition.maxStacks, existing.stacks + stacks);
      // Permanent effects last longer than timed ones. 
      const isLonger = newExpiresAt === undefined ? existing.expiresAt !== undefined : existing.expiresAt !== undefined && newExpiresAt > existing.expiresAt;
      if (isLonger) existing.expiresAt = newExpiresAt;
      return;
    }
    player.statuses.push({ definitionId: statusId, appliedAt: this.state.time, expiresAt: newExpiresAt, stacks });
    if (player.controlled && !definition?.hidden) this.logEvent(`You were affected by ${formatStatusName(statusId)}.`);
    for (const effect of definition?.onApply ?? []) this.executeEffect(effect, new Set(), player.id);
  }

  private removeStatus(player: typeof this.state.players[number], statusId: string, stacks = 1): void {
    const index = player.statuses.findIndex((status) => status.definitionId === statusId);
    if (index === -1) return;
    const definition = this.statusDefinitions.get(statusId);
    const instance = player.statuses[index];
    if (definition?.maxStacks && instance.stacks > stacks) {
      instance.stacks -= stacks;
      return;
    }
    player.statuses.splice(index, 1);
    for (const effect of definition?.onRemove ?? []) this.executeEffect(effect, new Set(), player.id);
    if (player.controlled && !definition?.hidden) this.logEvent(`Your ${formatStatusName(statusId)} status ended.`);
  }

  private logEvent(message: string): void { this.state.log.push({ id: `log-${this.state.log.length + 1}`, time: this.state.time, message }); }
}
