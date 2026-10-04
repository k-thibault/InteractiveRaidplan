import type { GameState } from '../simulation/GameState';
import type { LogEntry } from '../simulation/Log';
import type { Random } from '../simulation/Random';
import { findEntity, selectPlayers } from './Selector';
import type { EncounterEvent, SpawnAreaEvent, ShowGraphicEvent, SpawnEnemyEvent, SelectGroupEvent, SelectGroupSubsetEvent, ForEachGroupEvent } from './Event';
import type { AreaEffect, EffectDefinition, EffectTarget, DamageDefinition, SpawnAreaEffect, AreaDefinition, SpawnEnemyEffect, BatchDefinition } from './Effect';
import { DamageResolver } from './DamageResolver';
import type { StatusDefinition } from '../entities/Status';
import type { Enemy, EnemyTemplate } from '../entities/Enemy';
import type { RandomContext } from '../simulation/RandomContext';
import type { ApplyStatusAssignment, DistributeStatusesEffect } from './Effect';
import type { GraphicAnchor } from './Graphic';
import { statusDisplayName } from '../util/format';
import type { CastDefinition, CastFacing } from './Cast';
import { resolvePositionValue, isTowardsPosition, fromPolar, normalize, subtract, toPolarAngle } from '../geometry/Vector2';
import type { PositionValue, Vector2 } from '../geometry/Vector2';
import { DEFAULT_FACING } from '../geometry/Facing';
import { DEFAULT_KNOCK_DURATION, facingKnockScale } from './Knock';
import type { KnockDirection, KnockParams } from './Knock';
import type { FollowSettings } from '../bots/FollowManager';
import type { Player } from '../entities/Player';
import { isInsideArena } from '../geometry/Arena';

/** Grace period in ms for batches that don't set `window`. */
const DEFAULT_BATCH_WINDOW = 500;

/** Carries the cast's locked target/direction into nested effects. */
interface EffectContext {
  direction?: number;
  targetId?: string;
  /** Set while an area's resolution effects run: its center and the entity it is anchored to. */
  area?: { position: Vector2; sourceId?: string };
}

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
  private readonly recalculateFacing: (group?: string) => void;
  private readonly batchDefinitions: Record<string, BatchDefinition>;
  /** Batches whose window is open, keyed by name. */
  private readonly openBatches = new Map<string, { count: number; closesAt: number }>();
  private readonly pendingEffects: { executeAt: number; effects: EffectDefinition[]; inside: Set<string>; sourceId: string; sourceName?: string; cast?: EffectContext }[] = [];
  /** Stores the outcomes of replayable rolls, keyed by `replayId`. */
  private readonly replayOutcomes: Map<string, Record<string, unknown>>;
  private readonly debug: boolean;

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
    replayOutcomes: Map<string, Record<string, unknown>> = new Map(),
    debug = false,
    recalculateFacing: (group?: string) => void = () => undefined,
    batches: Record<string, BatchDefinition> = {}
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
    this.recalculateFacing = recalculateFacing;
    this.batchDefinitions = batches;
    this.replayOutcomes = replayOutcomes;
    this.debug = debug;
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
    if (event.type === 'set_shotcall') this.setShotcall(event.text, event.duration);
    else if (event.type === 'clear_shotcall') this.state.shotcall = undefined;
    else if (event.type === 'set_mechanic') this.state.currentMechanic = event.mechanic;
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
    else if (event.type === 'recalculate_facing') this.recalculateFacing(event.group);
    else if (event.type === 'set_focus') this.setFocus(selectPlayers(event.target, this.state, this.random), event.enemy, event.follow);
    else if (event.type === 'knock') this.applyKnock(selectPlayers(event.target, this.state, this.random), event, event.source ?? 'boss');
    else if (event.type === 'start_follow') this.startFollow(event.source ?? 'boss', event);
    else if (event.type === 'stop_follow') this.stopFollow(event.source ?? 'boss');
  }

  private setShotcall(text: string, duration?: number): void {
    this.state.shotcall = { text, createdAt: this.state.time, expiresAt: duration === undefined ? undefined : this.state.time + Math.max(0, duration) };
  }

  update(): void {
    for (const cast of [...this.state.casts]) {
      if (cast.completesAt > this.state.time) continue;
      const definition = this.castDefinitions[cast.definitionId];
      this.state.casts = this.state.casts.filter((active) => active.id !== cast.id);
      if (!definition) continue;
      const source = findEntity(this.state, cast.sourceId);
      const hasFacingCast = this.state.casts.some((active) => active.sourceId === cast.sourceId && (active.targetId !== undefined || active.direction !== undefined));
      if (source && !hasFacingCast) source.facingRuleActive = false;
      const context: EffectContext = { direction: cast.direction, targetId: cast.targetId };
      for (const rawEffect of definition.effects) this.executeEffect(this.randomContext.resolve(rawEffect), new Set(), cast.sourceId, definition.name, context);
    }
    for (const pending of [...this.pendingEffects]) {
      if (pending.executeAt > this.state.time) continue;
      this.pendingEffects.splice(this.pendingEffects.indexOf(pending), 1);
      for (const rawEffect of pending.effects) this.executeEffect(this.randomContext.resolve(rawEffect), pending.inside, pending.sourceId, pending.sourceName, pending.cast);
    }
    for (const [name, batch] of [...this.openBatches]) {
      if (batch.closesAt > this.state.time) continue;
      this.openBatches.delete(name);
      for (const rawEffect of this.batchDefinitions[name]?.effects ?? []) this.executeEffect(this.randomContext.resolveAssigned(rawEffect, batch.count, 'batchCount'), new Set());
    }
  }

  private addToBatch(name: string): void {
    const definition = this.batchDefinitions[name];
    if (!definition) return;
    const open = this.openBatches.get(name);
    if (open) open.count += 1;
    else this.openBatches.set(name, { count: 1, closesAt: this.state.time + (definition.window ?? DEFAULT_BATCH_WINDOW) });
  }

  expireStatuses(): void {
    for (const player of this.state.players) {
      for (const status of [...player.statuses]) {
        if (status.expiresAt !== undefined && status.expiresAt <= this.state.time) this.removeStatus(player, status.definitionId, status.stacks, 'expired');
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
    this.pruneGroups(expiredIds);
  }

  private pruneGroups(ids: Set<string>): void {
    for (const name of Object.keys(this.state.groups)) {
      const members = this.state.groups[name];
      if (members.some((entry) => ids.has(entry.id))) {
        this.state.groups[name] = members.filter((entry) => !ids.has(entry.id));
      }
    }
  }

  /** Kills every living player standing past a deadly arena border. A `wall` border never kills. */
  resolveArenaEdge(): void {
    const arena = this.state.arena;
    if (arena.edge !== 'deadly') return;
    const outside = new Set(this.state.players.filter((player) => player.alive && !isInsideArena(arena, player.position)).map((player) => player.id));
    if (outside.size === 0) return;
    this.executeEffect({ type: 'damage', target: 'inside', damage: { amount: 0, type: 'physical', fatal: true } }, outside, 'boss', 'the arena edge');
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

  private spawnArea(event: SpawnAreaEvent | SpawnAreaEffect, cast?: EffectContext): void {
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
    if (resolved.direction === 'facing') {
      const sourceEntity = findEntity(this.state, resolved.source ?? '');
      if (sourceEntity?.facing !== undefined) base.rotation = (sourceEntity.facing * Math.PI) / 180 - Math.PI / 2;
    }
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
        : resolved.shape === 'donut'
          ? { ...base, shape: 'donut', innerRadius: resolved.innerRadius ?? 0 }
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
    if (!definition || !findEntity(this.state, sourceId)) return;
    if (this.state.casts.some((cast) => cast.sourceId === sourceId && cast.definitionId === castId)) return;
    if (mechanic) this.state.currentMechanic = mechanic;
    // Instance facing overrides the default cast definition. 
    const effectiveFacing = facing ?? definition.facing;
    // Lock the target/direction once when the cast begins. 
    const resolved = effectiveFacing ? this.resolveFacing(effectiveFacing, sourceId, effectiveFacing.replayable ? replayId : undefined) : undefined;
    const source = findEntity(this.state, sourceId);
    const target = resolved ? findEntity(this.state, resolved.targetId) : undefined;
    if (source && target) {
      source.facing = toPolarAngle(target.position, source.position);
      source.facingRuleActive = true;
    }
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

  private forEachGroup(event: ForEachGroupEvent | { group: string; effects: EffectDefinition[] }, inside: Set<string>, sourceId: string, sourceName?: string, cast?: EffectContext): void {
    const members = this.state.groups[event.group] ?? [];
    for (const member of members) {
      // Snapshot position is fixed; livePosition reads the current position. 
      const live = findEntity(this.state, member.id)?.position;
      if (!live) continue; // stale member (its entity expired/was removed since it was added to the group)
      const augmentedMember = { id: member.id, position: member.position, livePosition: { ...live } };
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
    const id = resolved.enemyId ?? `enemy-${this.state.enemies.length + 1}-${this.state.time}`;
    const enemy: Enemy = {
      id, type: 'enemy', name: resolved.name ?? 'Enemy', position: { ...position }, alive: true,
      style: resolved.style, statuses: [],
      expiresAt: resolved.expiresAfter !== undefined ? this.state.time + resolved.expiresAfter : undefined
    };
    const nearestPlayer = this.state.players
      .filter((player) => player.alive)
      .sort((a, b) => Math.hypot(a.position.x - position.x, a.position.y - position.y) - Math.hypot(b.position.x - position.x, b.position.y - position.y))[0];
    if (nearestPlayer) enemy.facing = toPolarAngle(nearestPlayer.position, position);
    this.state.enemies.push(enemy);
    if (resolved.addToGroup) {
      const group = this.state.groups[resolved.addToGroup] ?? [];
      this.state.groups[resolved.addToGroup] = [...group, { id, position: { ...position } }];
    }
  }

  private removeEnemy(id: string): void {
    this.state.enemies = this.state.enemies.filter((enemy) => enemy.id !== id);
    this.state.casts = this.state.casts.filter((cast) => cast.sourceId !== id);
    this.pruneGroups(new Set([id]));
  }

  executeEffect(effect: EffectDefinition, inside: Set<string>, sourceId = 'boss', sourceName?: string, cast?: EffectContext): void {
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
      this.distributeStatuses(resolvedEffect, this.effectTargets(resolvedEffect.target, inside, sourceId, cast), resolvedEffect.replayId);
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
    if (resolvedEffect.type === 'recalculate_facing') { this.recalculateFacing(resolvedEffect.group); return; }
    if (resolvedEffect.type === 'set_focus') { this.setFocus(this.effectTargets(resolvedEffect.target, inside, sourceId, cast), resolvedEffect.enemy, resolvedEffect.follow); return; }
    if (resolvedEffect.type === 'spawn_area') { this.spawnArea({ ...resolvedEffect, source: resolvedEffect.source ?? sourceId }, cast); return; }
    if (resolvedEffect.type === 'select_group') { this.selectGroup(resolvedEffect); return; }
    if (resolvedEffect.type === 'select_group_subset') { this.selectGroupSubset(resolvedEffect); return; }
    if (resolvedEffect.type === 'for_each_group') { this.forEachGroup(resolvedEffect, inside, sourceId, sourceName, cast); return; }
    if (resolvedEffect.type === 'spawn_enemy') { this.spawnEnemy(resolvedEffect); return; }
    if (resolvedEffect.type === 'remove_enemy') { this.removeEnemy(resolvedEffect.id); return; }
    if (resolvedEffect.type === 'start_follow') { this.startFollow(resolvedEffect.source ?? sourceId, resolvedEffect); return; }
    if (resolvedEffect.type === 'stop_follow') { this.stopFollow(resolvedEffect.source ?? sourceId); return; }
    if (resolvedEffect.type === 'add_to_batch') { this.addToBatch(resolvedEffect.batch); return; }
    if (resolvedEffect.type === 'remove_status') {
      for (const player of this.effectTargets(resolvedEffect.target, inside, sourceId, cast)) this.removeStatus(player, resolvedEffect.status, resolvedEffect.stacks ?? 1);
      return;
    }
    if (resolvedEffect.type === 'show_graphic') { this.spawnGraphic(resolvedEffect.image, resolvedEffect.anchor ?? { type: 'entity', entity: sourceId }, resolvedEffect.radius, resolvedEffect.duration); return; }
    const targets = this.effectTargets(resolvedEffect.target, inside, sourceId, cast);
    if (resolvedEffect.type === 'damage') this.applyDamage(targets, resolvedEffect.damage, sourceName);
    else if (resolvedEffect.type === 'heal') this.healPlayers(targets, resolvedEffect.amount, resolvedEffect.full);
    else if (resolvedEffect.type === 'knock') this.applyKnock(targets, resolvedEffect, sourceId, cast);
    else {
      for (const player of targets) {
        const status = resolvedEffect.status ?? this.pickStatus(resolvedEffect.statusChoices);
        if (status) this.applyStatus(player, status, resolvedEffect.duration, resolvedEffect.stacks ?? 1);
      }
    }
  }

  private effectTargets(target: EffectTarget, inside: Set<string>, sourceId: string, context?: EffectContext): Player[] {
    if (typeof target !== 'string') return selectPlayers(target, this.state, this.random);
    return this.state.players.filter((player) => {
      if (!player.alive) return false;
      if (target === 'all') return true;
      if (target === 'source') return player.id === sourceId;
      if (target === 'inside_others') return inside.has(player.id) && player.id !== context?.area?.sourceId;
      return target === 'inside' ? inside.has(player.id) : !inside.has(player.id);
    });
  }

  /** Starts a knock on each living player, replacing any knock already in progress. */
  private applyKnock(players: Player[], knock: KnockParams, sourceId: string, context?: EffectContext): void {
    const duration = knock.duration ?? DEFAULT_KNOCK_DURATION;
    if (!(duration > 0)) return;
    for (const player of players) {
      if (!player.alive) continue;
      const direction = this.knockHeading(player, knock.direction, sourceId, context);
      if (!direction) continue;
      let distance = knock.distance;
      for (const modifier of knock.facingModifiers ?? []) {
        if (!player.statuses.some((status) => status.definitionId === modifier.status)) continue;
        const scale = facingKnockScale(player.facing ?? DEFAULT_FACING, direction, modifier);
        if (scale === undefined) continue;
        distance *= scale;
        if (modifier.consume) this.removeStatus(player, modifier.status);
      }
      player.knock = { direction, speed: distance / (duration / 1000), remaining: duration };
    }
  }

  /** Unit vector for the knock, or undefined when its origin can't be resolved. */
  private knockHeading(player: Player, direction: KnockDirection, sourceId: string, context?: EffectContext): Vector2 | undefined {
    if (direction.type === 'linear') {
      const angle = Number(direction.angle);
      return Number.isFinite(angle) ? fromPolar(angle, 1) : undefined;
    }
    const origin = typeof direction.from === 'string'
      ? findEntity(this.state, direction.from)?.position
      : direction.from ? this.resolvePosition(direction.from) : (context?.area?.position ?? findEntity(this.state, sourceId)?.position);
    if (!origin) return undefined;
    const away = normalize(subtract(player.position, origin));
    // Standing exactly on the origin has no away direction, so fall back to north.
    return away.x === 0 && away.y === 0 ? fromPolar(DEFAULT_FACING, 1) : away;
  }

  private setFocus(players: Player[], enemy?: string, follow?: boolean): void {
    for (const player of players) {
      if (enemy !== undefined) player.focus = enemy;
      if (follow !== undefined) player.followFocus = follow;
    }
  }

  private startFollow(enemyId: string, settings: FollowSettings): void {
    const enemy = this.state.enemies.find((candidate) => candidate.id === enemyId);
    if (enemy) enemy.follow = { target: settings.target, distance: settings.distance, moveSpeed: settings.moveSpeed };
  }

  private stopFollow(enemyId: string): void {
    const enemy = this.state.enemies.find((candidate) => candidate.id === enemyId);
    if (enemy) enemy.follow = undefined;
  }

  private pickStatus(choices: string[] | undefined): string | undefined {
    return choices && choices.length > 0 ? choices[this.random.integer(0, choices.length - 1)] : undefined;
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
      const wasAlive = player.alive;
      const result = this.damageResolver.resolve(player, damage);
      if (result.killed && wasAlive) this.removeStatusesOnDeath(player);
      if (player.controlled) {
        if (result.fatal) this.logEvent(`You took fatal ${damage.type} damage${sourceName ? ` from ${sourceName}` : ''}.`);
        else this.logEvent(`${sourceName ? `You were hit by ${sourceName} for` : 'You were hit for'} ${Math.round(result.amount)} ${damage.type} damage.`);
      } else if (this.debug) {
        if (result.fatal) this.logEvent(`${player.name} took fatal ${damage.type} damage${sourceName ? ` from ${sourceName}` : ''}.`, 'debug');
        else this.logEvent(`${player.name} ${sourceName ? `was hit by ${sourceName} for` : 'was hit for'} ${Math.round(result.amount)} ${damage.type} damage.`, 'debug');
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
    this.refreshControl(player);
    if (player.controlled && !definition?.hidden) this.logEvent(`You were affected by ${statusDisplayName(statusId, this.statusDefinitions)}.`);
    else if (this.debug) this.logEvent(`${player.name} gained ${statusDisplayName(statusId, this.statusDefinitions)}${definition?.hidden ? ' (hidden)' : ''}.`, 'debug');
    for (const effect of definition?.onApply ?? []) this.executeEffect(effect, new Set(), player.id);
  }

  private removeStatusesOnDeath(player: typeof this.state.players[number]): void {
    for (const status of [...player.statuses]) {
      const definition = this.statusDefinitions.get(status.definitionId);
      if (definition?.keepOnDeath) continue;
      const trigger = definition?.deathRemovalTrigger ?? 'none';
      this.removeStatus(player, status.definitionId, status.stacks, 'death', trigger);
    }
  }

  private removeStatus(
    player: typeof this.state.players[number],
    statusId: string,
    stacks = 1,
    reason: 'expired' | 'removed' | 'death' = 'removed',
    deathTrigger?: 'none' | 'remove' | 'early_remove' | 'expire'
  ): void {
    const index = player.statuses.findIndex((status) => status.definitionId === statusId);
    if (index === -1) return;
    const definition = this.statusDefinitions.get(statusId);
    const instance = player.statuses[index];
    if (definition?.maxStacks && instance.stacks > stacks) {
      instance.stacks -= stacks;
      return;
    }
    player.statuses.splice(index, 1);
    this.refreshControl(player);
    if (reason === 'death') {
      const effects = deathTrigger === 'remove'
        ? definition?.onRemove
        : deathTrigger === 'early_remove'
          ? definition?.onEarlyRemove
          : deathTrigger === 'expire'
            ? definition?.onExpire
            : [];
      const holder = deathTrigger === 'remove' && definition?.reassignIfDead
        ? selectPlayers({ type: 'random', count: 1 }, this.state, this.random)[0] ?? player
        : player;
      for (const effect of effects ?? []) this.executeEffect(effect, new Set(), holder.id);
    } else {
      const reasonEffects = reason === 'expired' ? definition?.onExpire : definition?.onEarlyRemove;
      for (const effect of reasonEffects ?? []) this.executeEffect(effect, new Set(), player.id);
      const holder = player.alive || !definition?.reassignIfDead ? player : (selectPlayers({ type: 'random', count: 1 }, this.state, this.random)[0] ?? player);
      for (const effect of definition?.onRemove ?? []) this.executeEffect(effect, new Set(), holder.id);
    }
    if (player.controlled && !definition?.hidden) this.logEvent(`Your ${statusDisplayName(statusId, this.statusDefinitions)} status ended.`);
    else if (this.debug) this.logEvent(`${player.name}'s ${statusDisplayName(statusId, this.statusDefinitions)}${definition?.hidden ? ' (hidden)' : ''} status ended.`, 'debug');
  }

  /** Recomputes root/stun from the statuses currently on the player. */
  private refreshControl(player: Player): void {
    const controls = player.statuses.map((status) => this.statusDefinitions.get(status.definitionId)?.control);
    player.rooted = controls.includes('root');
    player.stunned = controls.includes('stun');
  }

  private logEvent(message: string, channel: LogEntry['channel'] = 'player'): void {
    this.state.log.push({ id: `log-${this.state.log.length + 1}`, time: this.state.time, message, channel });
  }
}
