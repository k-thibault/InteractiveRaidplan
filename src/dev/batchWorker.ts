import type { Encounter } from '../encounters/Encounter';
import { runSeed, type BatchOptions, type RunOutcome } from './BatchRun';

export type WorkerRequest =
  | { type: 'init'; encounter: Encounter; options: BatchOptions }
  | { type: 'run'; seeds: number[] };
export type WorkerResponse = { type: 'results'; outcomes: RunOutcome[] };

let encounter: Encounter | undefined;
let options: BatchOptions = { runToEnd: false };

self.onmessage = (message: MessageEvent<WorkerRequest>) => {
  const request = message.data;
  if (request.type === 'init') { encounter = request.encounter; options = request.options; return; }
  if (!encounter) return;
  const outcomes = request.seeds.map((seed) => runSeed(encounter!, seed, options));
  (self as unknown as { postMessage(response: WorkerResponse): void }).postMessage({ type: 'results', outcomes });
};
