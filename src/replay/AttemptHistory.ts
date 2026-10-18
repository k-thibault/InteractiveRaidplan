import type { PlayerDriver } from '../simulation/PlayerDriver';
import type { Simulation } from '../simulation/Simulation';
import type { Replay } from './format';
import { ReplayRecorder } from './ReplayRecorder';
import type { RecorderMeta } from './ReplayRecorder';

/** Records attempts and keeps the most recent finished attempt available. */
export class AttemptHistory {
  private recorder: ReplayRecorder | undefined;
  private simulation: Simulation | undefined;
  private last: Replay | undefined;
  private readonly onClose: ((replay: Replay) => void) | undefined;

  /** Called when an attempt ends. */
  constructor(onClose?: (replay: Replay) => void) { this.onClose = onClose; }

  /** True from `begin` until the attempt completes or is abandoned. */
  get recording(): boolean { return this.recorder !== undefined; }

  /** Most recent ended attempt, unless a new one has started ticking. */
  get available(): Replay | undefined {
    if (this.recorder && (this.simulation?.tickCount ?? 0) > 0) return undefined;
    return this.last;
  }

  /** Start recording before the simulation's first tick. */
  begin(simulation: Simulation, driver: PlayerDriver | undefined, meta: RecorderMeta): void {
    if (this.recorder) this.abandon();
    this.simulation = simulation;
    this.recorder = new ReplayRecorder(meta);
    this.recorder.attach(simulation, driver);
  }

  /** Close the recording when the attempt completes. */
  settle(): void {
    if (this.recorder && this.simulation?.state.completed) this.close();
  }

  /** End the attempt, keeping it if at least one tick ran. */
  abandon(): void {
    if (!this.recorder) return;
    if ((this.simulation?.tickCount ?? 0) > 0) this.close();
    else { this.recorder = undefined; this.simulation = undefined; }
  }

  private close(): void {
    this.last = this.recorder!.finish();
    this.onClose?.(this.last);
    this.recorder = undefined; this.simulation = undefined;
  }
}
