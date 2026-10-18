import type { Player } from '../entities/Player';
import { toFacingUnits, toPositionUnits } from '../geometry/Quantize';
import type { PlayerDriver } from '../simulation/PlayerDriver';
import type { Simulation } from '../simulation/Simulation';
import { hashState } from './hash';
import { CHECKPOINT_INTERVAL_TICKS, REPLAY_FORMAT_VERSION, SIM_VERSION } from './format';
import type { RunFlags } from '../streak/StreakTypes';
import type { Replay } from './format';

export interface RecorderMeta {
  encounterId: string;
  encounterHash: number;
  seed: number;
  /** The live outcomes map as it stands at run start; copied here because the run mutates it. */
  outcomes: Map<string, Record<string, unknown>>;
  tickMs: number;
  /** Read when the recording is finished, since options can only lose streak eligibility during a run. */
  runFlags?: () => RunFlags;
  /** Called when game logic reads the controlled player's facing while no facing rule is active (a timeline authoring gap). */
  warn?: (message: string) => void;
}

/** Records the controlled player's simulation inputs and state checkpoints. */
export class ReplayRecorder {
  private readonly meta: RecorderMeta;
  private readonly outcomes: Replay['header']['outcomes'];
  private simulation: Simulation | undefined;
  private player: Player | undefined;
  private startUnits = { x: 0, y: 0 };
  private lastX = 0;
  private lastY = 0;
  private lastTickPosition = 0;
  private lastTickFacing = 0;
  private lastFacingValue = 0;
  /** What the driver step of the current tick produced, awaiting the end-of-tick decision about facing. */
  private pending: { tick: number; units: number; ruleAtStart: boolean; read: boolean } | undefined;
  private readonly position: number[] = [];
  private readonly facing: number[] = [];
  private readonly checkpoints: number[] = [];

  constructor(meta: RecorderMeta) {
    this.meta = meta;
    this.outcomes = [...meta.outcomes].map(([key, value]) => [key, structuredClone(value)]);
  }

  /** Attach the recorder before the simulation's first tick. */
  attach(simulation: Simulation, driver: PlayerDriver | undefined): void {
    this.simulation = simulation;
    this.player = simulation.state.players.find((candidate) => candidate.controlled);
    simulation.setDriver(driver || this.player ? this.wrap(driver) : undefined);
    simulation.onTickEnd = (tickCount) => this.endTick(tickCount);
    if (this.player) {
      simulation.state.onFacingRead = (player) => {
        if (this.pending) this.pending.read = true;
        if (!player.facingRuleActive) this.meta.warn?.(`Facing of ${player.name} was read at ${simulation.state.time.toFixed(0)} ms while no facing rule was active. Add a facing rule to the timeline so this stays correct in replays.`);
      };
    }
  }

  private wrap(inner: PlayerDriver | undefined): PlayerDriver {
    return {
      idle: (deltaSeconds) => inner?.idle?.(deltaSeconds),
      step: (tick, deltaSeconds) => {
        const player = this.player;
        if (player && tick === 0) { this.startUnits = { x: toPositionUnits(player.position.x), y: toPositionUnits(player.position.y) }; this.lastX = this.startUnits.x; this.lastY = this.startUnits.y; }
        inner?.step(tick, deltaSeconds);
        if (!player) return;
        const x = toPositionUnits(player.position.x); const y = toPositionUnits(player.position.y);
        if (x !== this.lastX || y !== this.lastY) {
          this.position.push(tick - this.lastTickPosition, x - this.lastX, y - this.lastY);
          this.lastTickPosition = tick; this.lastX = x; this.lastY = y;
        }
        this.pending = { tick, units: player.facing === undefined ? 0 : toFacingUnits(player.facing), ruleAtStart: player.facingRuleActive === true, read: false };
      },
    };
  }

  /**
   * Facing is recorded for a tick when a facing rule is active at its start or end, or when game logic read it during the tick.
   * The first two cover rule windows; the last is the safety net. Leaving a tracked span writes the "not tracked" marker.
   */
  private endTick(tickCount: number): void {
    const simulation = this.simulation!;
    const pending = this.pending; this.pending = undefined;
    if (pending && this.player) {
      const tracked = pending.ruleAtStart || pending.read || this.player.facingRuleActive === true;
      const value = tracked ? pending.units + 1 : 0;
      if (value !== this.lastFacingValue) {
        this.facing.push(pending.tick - this.lastTickFacing, value);
        this.lastTickFacing = pending.tick; this.lastFacingValue = value;
      }
    }
    if (tickCount % CHECKPOINT_INTERVAL_TICKS === 0) this.checkpoints.push(hashState(simulation.state));
  }

  /** Finishes the recording at the current tick. Safe to call mid-run (an abandoned attempt) or after completion. */
  finish(): Replay {
    const simulation = this.simulation;
    if (!simulation) throw new Error('ReplayRecorder.finish() called before attach()');
    const { state } = simulation;
    return {
      header: {
        formatVersion: REPLAY_FORMAT_VERSION,
        simVersion: SIM_VERSION,
        encounterId: this.meta.encounterId,
        encounterHash: this.meta.encounterHash,
        seed: this.meta.seed,
        outcomes: this.outcomes,
        controlledPlayerId: this.player?.id,
        controlledPlayerName: this.player?.name,
        ...(this.player && this.meta.runFlags ? { runFlags: this.meta.runFlags() } : {}),
        tickMs: this.meta.tickMs,
        endTick: simulation.tickCount,
        result: { completed: state.completed && !state.failed, failed: state.failed, deaths: state.deaths.map((death) => ({ time: death.time, playerId: death.playerId, source: death.source })) },
        rolls: { ...simulation.rolledChoices, ...state.rolls },
        startUnits: this.startUnits,
      },
      position: this.position.slice(),
      facing: this.facing.slice(),
      checkpoints: this.checkpoints.slice(),
      endHash: hashState(state),
    };
  }
}
