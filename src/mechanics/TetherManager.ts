import { entityRadius } from '../entities/Entity';
import type { Entity } from '../entities/Entity';
import { distance, toPolarAngle } from '../geometry/Vector2';
import type { Vector2 } from '../geometry/Vector2';
import type { GameState } from '../simulation/GameState';
import type { EffectDefinition } from './Effect';
import { findEntity } from './Selector';
import { isTetherBroken, projectOntoSegment } from './Tether';
import type { ActiveTether, TetherDefinition, TetherSpawnOptions } from './Tether';

/** What a tether hook's effects see: the tether's current target stands in for the cast target. */
export interface TetherHookContext {
  targetId: string;
  targetPosition: Vector2;
  tether: { sourceId: string; targetId: string };
}

/** Runs hook effects with the tether's source as the effect source and its name as the damage source. */
export type TetherHookRunner = (effects: EffectDefinition[], sourceId: string, sourceName: string, context: TetherHookContext) => void;
export type TetherLogger = (message: string, channel: 'player' | 'debug') => void;

/** Fields copied from a definition or spawn options onto a live tether. */
const DEFINITION_KEYS = ['name', 'style', 'lengthStages', 'passable', 'passTolerance', 'breakWhen', 'graceDuration', 'duration', 'onBreak', 'onExpire', 'onPass'] as const;

/** Filters for `remove`; every given filter must match. */
export interface TetherFilter {
  tag?: string;
  sourceId?: string;
  targetIds?: Set<string>;
}

/** Manages tether creation, passing, breaks, expiry, and tether-aimed casts. */
export class TetherManager {
  private readonly state: GameState;
  private readonly definitions: Record<string, TetherDefinition>;
  private readonly run: TetherHookRunner;
  private readonly log: TetherLogger;
  private counter = 0;

  constructor(state: GameState, definitions: Record<string, TetherDefinition> = {}, run: TetherHookRunner, log: TetherLogger) {
    this.state = state;
    this.definitions = definitions;
    this.run = run;
    this.log = log;
  }

  /** Whether the two entities already share a tether, in either direction. An entity pair can only ever have one. */
  isLinked(a: string, b: string): boolean {
    return this.state.tethers.some((tether) => (tether.sourceId === a && tether.targetId === b) || (tether.sourceId === b && tether.targetId === a));
  }

  /** Links the source to each eligible target; skips missing, dead, self, or already-linked targets. */
  spawn(options: TetherSpawnOptions, sourceId: string, targetIds: string[]): void {
    const named = options.tether === undefined ? undefined : this.definitions[options.tether];
    if (options.tether !== undefined && !named) return;
    const source = findEntity(this.state, sourceId);
    if (!source?.alive) return;
    const merged = this.merge(named, options);
    const tag = options.label ?? options.tether;
    for (const targetId of targetIds) {
      const target = findEntity(this.state, targetId);
      if (!target?.alive || target.id === source.id) continue;
      if (this.isLinked(source.id, target.id)) {
        this.log(`${source.name} is already tethered to ${target.name}.`, 'debug');
        continue;
      }
      const tether: ActiveTether = {
        id: `tether-${(this.counter += 1)}`,
        tag,
        name: merged.name ?? tag ?? 'Tether',
        sourceId: source.id,
        targetId: target.id,
        createdAt: this.state.time,
        baselineLength: distance(source.position, target.position),
        expiresAt: merged.duration === undefined ? undefined : this.state.time + merged.duration,
        style: merged.style,
        lengthStages: merged.lengthStages,
        passable: merged.passable ?? false,
        passTolerance: merged.passTolerance ?? 0,
        breakWhen: merged.breakWhen ?? [],
        graceDuration: merged.graceDuration ?? 0,
        onBreak: merged.onBreak,
        onExpire: merged.onExpire,
        onPass: merged.onPass,
      };
      this.state.tethers.push(tether);
      this.announce(target, `${source.name} tethered you.`, `${target.name} was tethered by ${source.name}.`);
    }
  }

  /** Ends matching tethers without running any hooks. */
  remove(filter: TetherFilter): void {
    this.state.tethers = this.state.tethers.filter((tether) => !(
      (filter.tag === undefined || tether.tag === filter.tag)
      && (filter.sourceId === undefined || tether.sourceId === filter.sourceId)
      && (filter.targetIds === undefined || filter.targetIds.has(tether.targetId))
    ));
  }

  /** Advances every tether one tick. Call after all movement for the tick is done. */
  update(): void {
    if (this.state.tethers.length === 0) return;
    this.dropOrphans();
    this.expire();
    this.passAlong();
    this.breakStrained();
    this.syncCasts();
  }

  private merge(named: TetherDefinition | undefined, options: TetherSpawnOptions): TetherDefinition {
    const merged: Record<string, unknown> = {};
    for (const key of DEFINITION_KEYS) {
      const value = options[key] !== undefined ? options[key] : named?.[key];
      if (value !== undefined) merged[key] = structuredClone(value);
    }
    return merged as TetherDefinition;
  }

  private detach(tether: ActiveTether): void {
    this.state.tethers = this.state.tethers.filter((candidate) => candidate !== tether);
  }

  private isLive(tether: ActiveTether): boolean {
    return this.state.tethers.includes(tether);
  }

  private context(tether: ActiveTether, target: Entity): TetherHookContext {
    return { targetId: target.id, targetPosition: { ...target.position }, tether: { sourceId: tether.sourceId, targetId: target.id } };
  }

  /** Players see messages about their own tethers; messages about bots only show in debug logs. */
  private announce(entity: Entity, playerMessage: string, botMessage: string): void {
    if ('controlled' in entity && entity.controlled) this.log(playerMessage, 'player');
    else if (botMessage) this.log(botMessage, 'debug');
  }

  /** A tether whose source or target is gone or dead just ends. No hook runs. */
  private dropOrphans(): void {
    this.state.tethers = this.state.tethers.filter((tether) => findEntity(this.state, tether.sourceId)?.alive && findEntity(this.state, tether.targetId)?.alive);
  }

  private expire(): void {
    for (const tether of [...this.state.tethers]) {
      if (tether.expiresAt === undefined || tether.expiresAt > this.state.time) continue;
      this.detach(tether);
      const target = findEntity(this.state, tether.targetId);
      if (target && tether.onExpire) this.run(tether.onExpire, tether.sourceId, tether.name, this.context(tether, target));
    }
  }

  /**
  * Passes to the closest eligible player on the line. Already-linked players are skipped;
  * oldest tethers run first so chained passes are deterministic.
   */
  private passAlong(): void {
    for (const tether of [...this.state.tethers]) {
      if (!tether.passable || !this.isLive(tether)) continue;
      const source = findEntity(this.state, tether.sourceId);
      const holder = findEntity(this.state, tether.targetId);
      if (!source || !holder) continue;
      const taker = this.state.players
        .filter((player) => player.alive && player.id !== source.id && player.id !== holder.id && !this.isLinked(source.id, player.id))
        .flatMap((player) => {
          const where = projectOntoSegment(player.position, source.position, holder.position);
          const onLine = where && where.along > 0 && where.along < 1 && where.offset <= entityRadius(player) + tether.passTolerance;
          return onLine ? [{ player, along: where.along }] : [];
        })
        .sort((a, b) => a.along - b.along)[0]?.player;
      if (!taker) continue;
      tether.targetId = taker.id;
      tether.baselineLength = distance(source.position, taker.position);
      this.announce(holder, `${source.name}'s tether was taken by ${taker.name}.`, `${taker.name} took ${holder.name}'s tether from ${source.name}.`);
      this.announce(taker, `You took ${holder.name}'s tether from ${source.name}.`, '');
      if (tether.onPass) this.run(tether.onPass, tether.sourceId, tether.name, this.context(tether, taker));
    }
  }

  private breakStrained(): void {
    for (const tether of [...this.state.tethers]) {
      if (!this.isLive(tether) || tether.breakWhen.length === 0) continue;
      if (this.state.time < tether.createdAt + tether.graceDuration) continue;
      const source = findEntity(this.state, tether.sourceId);
      const target = findEntity(this.state, tether.targetId);
      if (!source || !target) continue;
      if (!isTetherBroken(tether, distance(source.position, target.position))) continue;
      // Gone before its hook runs, so the hook can put a fresh tether on the same pair.
      this.detach(tether);
      this.announce(target, `Your tether to ${source.name} broke.`, `${target.name}'s tether to ${source.name} broke.`);
      if (tether.onBreak) this.run(tether.onBreak, tether.sourceId, tether.name, this.context(tether, target));
    }
  }

  /** Casts aimed with a `tether` facing follow the tether's current target, so a pass redirects them. */
  private syncCasts(): void {
    for (const cast of this.state.casts) {
      if (cast.tetherId === undefined) continue;
      const tether = this.state.tethers.find((candidate) => candidate.id === cast.tetherId);
      if (!tether) continue;
      const caster = findEntity(this.state, cast.sourceId);
      const target = findEntity(this.state, tether.targetId);
      if (!caster || !target) continue;
      cast.targetId = target.id;
      cast.targetPosition = { ...target.position };
      cast.direction = Math.atan2(target.position.y - caster.position.y, target.position.x - caster.position.x);
      caster.facing = toPolarAngle(target.position, caster.position);
    }
  }
}
