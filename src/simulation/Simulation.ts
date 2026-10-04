import type { Encounter } from '../encounters/Encounter';
import { pointInCircle, pointInCone, pointInDonut } from '../geometry/Collision';
import { MechanicExecutor } from '../mechanics/MechanicExecutor';
import { Scheduler } from './Scheduler';
import type { GameState } from './GameState';
import { Random } from './Random';
import { AreaResolver } from '../mechanics/AreaResolver';
import { RandomContext } from './RandomContext';
import { BotManager, defaultBossFacing } from '../bots/BotManager';
import { FollowManager } from '../bots/FollowManager';
import { advanceKnocks } from '../mechanics/Knock';
import { MechanicalRoleEvaluator } from '../bots/MechanicalRoleEvaluator';
import type { RoleChange } from '../bots/MechanicalRoleEvaluator';
import { PositionEvaluator } from '../bots/PositionEvaluator';
import { FacingEvaluator } from '../bots/FacingEvaluator';
import type { StatusInstance } from '../entities/Status';
import { resolvePositionValue } from '../geometry/Vector2';
import { resolveArena } from '../geometry/Arena';
import { selectPlayers } from '../mechanics/Selector';

export interface SimulationOptions { seed: number; controlledPlayerId?: string; replayOutcomes?: Map<string, Record<string, unknown>>; debug?: boolean; }

export class Simulation {
  readonly state: GameState;
  private readonly scheduler = new Scheduler();
  private readonly random: Random;
  private readonly executor: MechanicExecutor;
  private readonly encounterDuration: number;
  private readonly areaResolver = new AreaResolver();
  private readonly botManager = new BotManager();
  private readonly followManager: FollowManager;
  private readonly areaGroups: NonNullable<Encounter['areaGroups']>;
  private readonly areaGroupParticipants = new Map<string, Set<string>>();
  private readonly areaGroupResolvedCount = new Map<string, number>();
  private readonly roleEvaluator: MechanicalRoleEvaluator;
  private positionEvaluator: PositionEvaluator;
  private readonly facingEvaluator: FacingEvaluator;
  private readonly debug: boolean;

  constructor(encounter: Encounter, options: SimulationOptions) {
    this.encounterDuration = encounter.duration;
    this.areaGroups = encounter.areaGroups ?? {};
    this.random = new Random(options.seed);
    this.debug = options.debug ?? false;
    this.followManager = new FollowManager(encounter.casts);
    const randomContext = new RandomContext(encounter.randomGroups, encounter.sequences, encounter.distributions, this.random);
    const statusControls = new Map(encounter.statuses.map((status) => [status.id, status.control]));
    const getControlState = (statuses: StatusInstance[]) => ({
      rooted: statuses.some((status) => statusControls.get(status.definitionId) === 'root'),
      stunned: statuses.some((status) => statusControls.get(status.definitionId) === 'stun')
    });
    const players = structuredClone(encounter.players).map((player) => ({ ...player, ...getControlState(player.statuses), maxHealth: player.maxHealth ?? player.health, controlled: player.id === options.controlledPlayerId, mechanicalRoles: player.mechanicalRoles ?? [] }));
    const enemies = structuredClone(encounter.enemies).map((enemy) => ({ ...enemy, ...getControlState(enemy.statuses) }));
    const markers = (encounter.markers ?? []).map((marker) => ({
      ...structuredClone(marker),
      resolvedPosition: resolvePositionValue(marker.position),
    }));
    this.state = { time: 0, arena: resolveArena(encounter.arena), deltaTime: 0, currentMechanic: undefined, players, enemies, effects: [], worldGraphics: [], background: encounter.background, casts: [], running: false, completed: false, log: [], groups: {}, markers };
    this.roleEvaluator = new MechanicalRoleEvaluator(encounter.mechanicalRoles, <T>(value: T) => randomContext.resolve(value));
    this.positionEvaluator = new PositionEvaluator(encounter.positions, <T>(value: T) => randomContext.resolve(value), encounter.markerQueries);
    this.facingEvaluator = new FacingEvaluator(encounter.facing, <T>(value: T) => randomContext.resolve(value), (target, state, self) => this.positionEvaluator.resolveTarget(target, state, self));
    const recalculateRoles = (group?: string) => this.logRoleChanges(this.roleEvaluator.recalculate(this.state, group));
    const recalculateFacing = (group?: string) => this.facingEvaluator.recalculate(this.state, group);
    this.executor = new MechanicExecutor(this.state, this.random, encounter.statuses, encounter.casts, randomContext, encounter.areas, recalculateRoles, (group, params) => this.positionEvaluator.recalculate(this.state, group, params), encounter.enemyTemplates, options.replayOutcomes, options.debug, recalculateFacing, encounter.batches);
    // Apply initial facing rules, then point unconfigured bots toward the boss.
    recalculateFacing();
    for (const player of this.state.players) {
      if (player.facing === undefined && !player.controlled && !player.facingRuleActive) player.facing = defaultBossFacing(this.state, player.position, player.focus);
    }
    const eventTimes = new Map<string, number>();
    for (const event of encounter.events) {
      const executeAt = event.at ?? (event.after ? (eventTimes.get(event.after) ?? 0) + (event.delay ?? 0) : 0);
      eventTimes.set(event.id, executeAt);
      this.scheduler.schedule(event.id, executeAt, () => {
        const resolved = randomContext.resolve(event);
        if (resolved.type === 'recalculate_roles') recalculateRoles(resolved.group);
        else if (resolved.type === 'recalculate_positions') this.positionEvaluator.recalculate(this.state, resolved.group, resolved.params);
        else if (resolved.type === 'recalculate_facing') recalculateFacing(resolved.group);
        else if (resolved.type === 'release_positions') this.positionEvaluator.release(selectPlayers(resolved.target, this.state, this.random));
        else this.executor.execute(resolved);
      });
    }
  }

  private logRoleChanges(changes: RoleChange[]): void {
    if (!this.debug) return;
    for (const { playerId, added, removed } of changes) {
      const name = this.state.players.find((player) => player.id === playerId)?.name ?? playerId;
      if (added.length) this.state.log.push({ id: `log-${this.state.log.length + 1}`, time: this.state.time, message: `${name} gained role(s): ${added.join(', ')}.`, channel: 'debug' });
      if (removed.length) this.state.log.push({ id: `log-${this.state.log.length + 1}`, time: this.state.time, message: `${name} lost role(s): ${removed.join(', ')}.`, channel: 'debug' });
    }
  }

  start(): void { this.state.running = true; }
  pause(): void { this.state.running = false; }

  tick(deltaMs: number): void {
    if (!this.state.running || this.state.completed) return;
    this.state.deltaTime = deltaMs;
    this.state.time += deltaMs;
    this.executor.expireStatuses();
    this.executor.expireEnemies();
    this.executor.update();
    for (const effect of this.state.effects) {
      const resolves = this.state.time >= effect.createdAt + effect.telegraphDuration;
      if (!resolves || this.state.time > effect.createdAt + effect.telegraphDuration + effect.duration) continue;
      if (effect.resolvedAt !== undefined) continue;
      const inside = new Set<string>();
      for (const player of this.state.players) {
        if (!player.alive) continue;
        if (effect.excludeSource && player.id === effect.sourceId) continue;
        const hit = effect.shape === 'circle'
          ? pointInCircle(player.position, effect.position, effect.radius)
          : effect.shape === 'cone'
            ? pointInCone(player.position, effect.position, effect.rotation, effect.radius, effect.angle)
            : effect.shape === 'donut'
              ? pointInDonut(player.position, effect.position, effect.innerRadius, effect.radius)
              : (effect.side === 'north' ? player.position.y < effect.position.y : player.position.y >= effect.position.y);
        if (hit) inside.add(player.id);
      }
      effect.resolvedAt = this.state.time;
      for (const resolution of this.areaResolver.resolve(effect, this.state.players.filter((player) => inside.has(player.id)))) this.executor.executeEffect(resolution, inside, undefined, undefined, { area: { position: effect.position, sourceId: effect.sourceId } });
      if (effect.areaGroup) {
        const group = this.areaGroups[effect.areaGroup];
        if (group) {
          const participants = this.areaGroupParticipants.get(effect.areaGroup) ?? new Set<string>();
          for (const playerId of inside) participants.add(playerId);
          this.areaGroupParticipants.set(effect.areaGroup, participants);
          const resolvedCount = (this.areaGroupResolvedCount.get(effect.areaGroup) ?? 0) + 1;
          this.areaGroupResolvedCount.set(effect.areaGroup, resolvedCount);
          if (resolvedCount >= group.count) {
            for (const groupedEffect of group.effects) this.executor.executeEffect(groupedEffect, participants);
            this.areaGroupParticipants.delete(effect.areaGroup);
            this.areaGroupResolvedCount.delete(effect.areaGroup);
          }
        }
      }
    }
    this.scheduler.update(this.state.time);
    if (this.state.shotcall?.expiresAt !== undefined && this.state.shotcall.expiresAt <= this.state.time) this.state.shotcall = undefined;
    this.state.effects = this.state.effects.filter((effect) => effect.resolvedAt === undefined || this.state.time < effect.resolvedAt + effect.duration);
    this.state.worldGraphics = this.state.worldGraphics.filter((graphic) => this.state.time < graphic.createdAt + graphic.duration);
    advanceKnocks(this.state, this.state.deltaTime);
    this.positionEvaluator.update(this.state);
    this.botManager.update(this.state);
    this.followManager.update(this.state);
    this.executor.resolveArenaEdge();
    if (this.state.time >= this.encounterDuration) { this.state.completed = true; this.state.running = false; }
  }
}