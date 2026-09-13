import type { Encounter } from '../encounters/Encounter';
import { pointInCircle, pointInCone } from '../geometry/Collision';
import { MechanicExecutor } from '../mechanics/MechanicExecutor';
import { Scheduler } from './Scheduler';
import type { GameState } from './GameState';
import { Random } from './Random';
import { AreaResolver } from '../mechanics/AreaResolver';
import { RandomContext } from './RandomContext';
import { BotManager } from '../bots/BotManager';
import { MechanicalRoleEvaluator } from '../bots/MechanicalRoleEvaluator';
import { PositionEvaluator } from '../bots/PositionEvaluator';

export interface SimulationOptions { seed: number; controlledPlayerId?: string; }

export class Simulation {
  readonly state: GameState;
  private readonly scheduler = new Scheduler();
  private readonly random: Random;
  private readonly executor: MechanicExecutor;
  private readonly encounterDuration: number;
  private readonly areaResolver = new AreaResolver();
  private readonly botManager = new BotManager();
  private readonly areaGroups: NonNullable<Encounter['areaGroups']>;
  private readonly areaGroupParticipants = new Map<string, Set<string>>();
  private readonly areaGroupResolvedCount = new Map<string, number>();
  private readonly roleEvaluator: MechanicalRoleEvaluator;
  private positionEvaluator: PositionEvaluator;

  constructor(encounter: Encounter, options: SimulationOptions) {
    this.encounterDuration = encounter.duration;
    this.areaGroups = encounter.areaGroups ?? {};
    this.random = new Random(options.seed);
    const randomContext = new RandomContext(encounter.randomGroups, encounter.sequences, encounter.distributions, this.random);
    const players = structuredClone(encounter.players).map((player) => ({ ...player, maxHealth: player.maxHealth ?? player.health, controlled: player.id === options.controlledPlayerId, mechanicalRoles: player.mechanicalRoles ?? [] }));
    this.state = { time: 0, deltaTime: 0, currentMechanic: undefined, players, enemies: structuredClone(encounter.enemies), effects: [], worldGraphics: [], background: encounter.background, casts: [], running: false, completed: false, log: [] };
    this.roleEvaluator = new MechanicalRoleEvaluator(encounter.mechanicalRoles);
    this.positionEvaluator = new PositionEvaluator(encounter.positions, <T>(value: T) => randomContext.resolve(value));
    this.executor = new MechanicExecutor(this.state, this.random, encounter.statuses, encounter.casts, randomContext, encounter.areas, (group) => this.roleEvaluator.recalculate(this.state, group), (group) => this.positionEvaluator.recalculate(this.state, group));
    const eventTimes = new Map<string, number>();
    for (const event of encounter.events) {
      const executeAt = event.at ?? (event.after ? (eventTimes.get(event.after) ?? 0) + (event.delay ?? 0) : 0);
      eventTimes.set(event.id, executeAt);
      this.scheduler.schedule(event.id, executeAt, () => {
        const resolved = randomContext.resolve(event);
        if (resolved.type === 'recalculate_roles') this.roleEvaluator.recalculate(this.state, resolved.group);
        else if (resolved.type === 'recalculate_positions') this.positionEvaluator.recalculate(this.state, resolved.group);
        else this.executor.execute(resolved);
      });
    }
  }

  start(): void { this.state.running = true; }
  pause(): void { this.state.running = false; }

  tick(deltaMs: number): void {
    if (!this.state.running || this.state.completed) return;
    this.state.deltaTime = deltaMs;
    this.state.time += deltaMs;
    this.executor.expireStatuses();
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
            : (effect.side === 'north' ? player.position.y < effect.position.y : player.position.y >= effect.position.y);
        if (hit) inside.add(player.id);
      }
      effect.resolvedAt = this.state.time;
      for (const resolution of this.areaResolver.resolve(effect, this.state.players.filter((player) => inside.has(player.id)))) this.executor.executeEffect(resolution, inside);
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
    this.state.effects = this.state.effects.filter((effect) => effect.resolvedAt === undefined || this.state.time < effect.resolvedAt + effect.duration);
    this.state.worldGraphics = this.state.worldGraphics.filter((graphic) => this.state.time < graphic.createdAt + graphic.duration);
    this.botManager.update(this.state);
    if (this.state.time >= this.encounterDuration) { this.state.completed = true; this.state.running = false; }
  }
}