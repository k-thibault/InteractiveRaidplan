import type { Encounter } from '../encounters/Encounter';
import type { Simulation } from '../simulation/Simulation';
import type { Replay } from './format';
import { createReplaySession, finalOutcomes } from './playback';
import type { ReplaySession } from './playback';
import type { ReplayDriver } from './ReplayDriver';

/** Advances replay playback and supports restart and seeking. */
export class ReplayViewer {
  readonly replay: Replay;
  /** Reasons the replay may not match the original (changed encounter or simulation version), shown before playing. */
  readonly warnings: string[];
  playing = true;
  private readonly encounter: Encounter;
  private session: ReplaySession;
  private accumulator = 0;
  private reachedEnd = false;
  private seekTarget: number | undefined;
  private firstDivergence: number | undefined;
  private generation = 0;

  constructor(encounter: Encounter, replay: Replay, warnings: string[] = []) {
    this.encounter = encounter; this.replay = replay; this.warnings = warnings;
    this.session = createReplaySession(encounter, replay);
  }

  get simulation(): Simulation { return this.session.simulation; }
  /** Undefined for all-bots replays; `facingTracked` tells the renderer when to hide the arrow. */
  get driver(): ReplayDriver | undefined { return this.session.driver; }
  get tick(): number { return this.session.simulation.tickCount; }
  get endTick(): number { return this.replay.header.endTick; }
  get finished(): boolean { return this.reachedEnd; }
  /** Simulated time of the first checkpoint that did not match, in ms, once playback has passed it. */
  get divergedAtMs(): number | undefined {
    const tick = this.firstDivergence ?? this.session.divergedAtTick;
    return tick === undefined ? undefined : tick * this.replay.header.tickMs;
  }
  /** True while a seek is still catching up; normal playback is suspended until it lands. */
  get seeking(): boolean { return this.seekTarget !== undefined; }
  /** Increases whenever restart or rewind replaces the simulation. */
  get epoch(): number { return this.generation; }

  /** The random outcomes of the whole recorded attempt, for retrying the same RNG. Reuses the live session if it already reached the end. */
  retryOutcomes(): Map<string, Record<string, unknown>> {
    if (this.reachedEnd) return new Map([...this.session.outcomes].map(([key, value]) => [key, structuredClone(value)]));
    return finalOutcomes(this.encounter, this.replay);
  }

  /** Back to the beginning, playing. */
  restart(): void {
    this.seekTarget = undefined;
    this.rebuild();
    this.playing = true;
  }

  /** Seek to a recorded tick, rebuilding the simulation for backward seeks. */
  seekTo(tick: number): void {
    this.seekTarget = Math.max(0, Math.min(this.endTick, Math.round(tick)));
    if (this.seekTarget < this.endTick) this.reachedEnd = false;
  }

  /**
   * Advance by `elapsedMs` of real time at `speed`, or, while seeking, spend about `sliceMs` catching up instead.
   * Does nothing while paused and not seeking, or when finished. `now` is injectable for tests.
   */
  update(elapsedMs: number, speed: number, sliceMs = 8, now: () => number = () => performance.now()): void {
    if (this.seekTarget !== undefined) { this.catchUp(this.seekTarget, sliceMs, now); return; }
    if (!this.playing || this.reachedEnd) return;
    const tickMs = this.replay.header.tickMs;
    this.accumulator += elapsedMs * speed;
    while (this.accumulator >= tickMs) {
      if (!this.session.advance()) { this.reachedEnd = true; this.accumulator = 0; return; }
      this.accumulator -= tickMs;
    }
    this.noteDivergence();
  }

  private catchUp(target: number, sliceMs: number, now: () => number): void {
    if (target < this.session.simulation.tickCount) this.rebuild();
    const deadline = now() + sliceMs;
    let advanced = true;
    while (this.session.simulation.tickCount < target && (advanced = this.session.advance())) {
      if (now() >= deadline) break;
    }
    this.noteDivergence();
    if (this.session.simulation.tickCount >= target || !advanced) {
      this.seekTarget = undefined; this.accumulator = 0;
      if (this.session.simulation.tickCount >= this.endTick || this.session.simulation.state.completed) this.reachedEnd = true;
    }
  }

  private rebuild(): void {
    this.session = createReplaySession(this.encounter, this.replay);
    this.accumulator = 0; this.reachedEnd = false; this.generation += 1;
  }

  /** A divergence stays reported after rewinding past it. */
  private noteDivergence(): void {
    const tick = this.session.divergedAtTick;
    if (tick !== undefined && (this.firstDivergence === undefined || tick < this.firstDivergence)) this.firstDivergence = tick;
  }
}
