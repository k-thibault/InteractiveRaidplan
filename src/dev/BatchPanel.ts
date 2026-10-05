import type { Encounter } from '../encounters/Encounter';
import { formatClock } from '../util/format';
import { deriveSeed, type BatchOptions, type RunOutcome } from './BatchRun';
import { summarize, type BatchReport, type Tally } from './BatchStats';
import type { WorkerRequest, WorkerResponse } from './batchWorker';

/** Seeds handed to a worker at a time; small enough that progress and cancelling stay responsive. */
const CHUNK_SIZE = 4;
/** Failing seeds listed as replay buttons. */
const SEED_BUTTON_LIMIT = 40;

export interface BatchPanelHooks {
  getEncounter(): Encounter | undefined;
  /** Opens the seed in the arena with all bots. */
  onReplay(seed: number): void;
}

export interface BatchPanel { open(): void; close(): void; }

const pct = (value: number) => `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function table(title: string, headers: string[], rows: string[][], note?: string): HTMLElement {
  const section = el('section', 'batch-section');
  section.append(el('h3', undefined, title));
  if (note) section.append(el('p', 'batch-note', note));
  const grid = el('table');
  const head = el('tr');
  headers.forEach((header) => head.append(el('th', undefined, header)));
  grid.append(head);
  for (const cells of rows) { const row = el('tr'); cells.forEach((cell) => row.append(el('td', undefined, cell))); grid.append(row); }
  section.append(grid);
  return section;
}

const tallyRows = (tallies: Tally[], limit = 12) => tallies.slice(0, limit).map((entry) => [entry.label, String(entry.count), pct(entry.share), seconds(entry.meanTime)]);

/** Dev-only dialog that simulates the open timeline across many seeds with all bots, spread over web workers. */
export function createBatchPanel(hooks: BatchPanelHooks): BatchPanel {
  const dialog = el('dialog', 'batch-dialog');
  const title = el('h2', undefined, 'Batch simulation');
  const form = el('div', 'batch-form');
  const runs = el('input'); runs.type = 'number'; runs.min = '1'; runs.max = '100000'; runs.value = '500';
  const firstSeed = el('input'); firstSeed.type = 'number'; firstSeed.value = '1';
  const runToEnd = el('input'); runToEnd.type = 'checkbox';
  const start = el('button', undefined, 'Run');
  const close = el('button', undefined, 'Close');
  const label = (text: string, input: HTMLElement) => { const wrapper = el('label'); wrapper.append(text, input); return wrapper; };
  form.append(label('Attempts', runs), label('Batch seed', firstSeed), label('Keep going after a death', runToEnd), start, close);
  const status = el('p', 'batch-status', 'All bots, no rendering. Attempts stop at the first death unless you keep going.');
  const progress = el('progress'); progress.hidden = true;
  const results = el('div', 'batch-results');
  dialog.append(title, form, status, progress, results);
  document.body.append(dialog);

  let workers: Worker[] = [];
  let running = false;

  const stop = () => { workers.forEach((worker) => worker.terminate()); workers = []; running = false; start.textContent = 'Run'; progress.hidden = true; };
  close.addEventListener('click', () => { stop(); dialog.close(); });
  dialog.addEventListener('close', stop);

  function render(report: BatchReport, options: BatchOptions, elapsedMs: number): void {
    results.replaceChildren();
    const summary = el('p', 'batch-summary');
    summary.append(
      el('strong', undefined, `${report.passed} / ${report.runs} cleared with everyone alive (${pct(report.runs ? report.passed / report.runs : 0)})`),
      document.createTextNode(` · ${report.failed} failed${report.errored ? ` · ${report.errored} errored` : ''} · ${(elapsedMs / 1000).toFixed(1)}s`),
    );
    results.append(summary);
    if (report.errors.length) results.append(el('p', 'batch-note', `Errors: ${report.errors.slice(0, 3).join(' | ')}`));
    if (report.failed === 0) return;
    const time = report.firstDeathTime!;
    results.append(table('First death', ['Mean', 'Median', 'Earliest', 'Latest'], [[formatClock(time.mean), formatClock(time.median), formatClock(time.min), formatClock(time.max)]],
      options.runToEnd ? `${report.meanDeathsPerFailure.toFixed(1)} deaths per failed attempt on average.` : 'Attempts stopped at the first death.'));
    const header = ['', 'First deaths', 'Of failures', 'Mean time'];
    results.append(
      table('By player', ['Player', ...header.slice(1)], tallyRows(report.byPlayer)),
      table('By mechanical role', ['Role', ...header.slice(1)], tallyRows(report.byRole), 'A player holding several roles counts toward each.'),
      table('By fatal source', ['Source', ...header.slice(1)], tallyRows(report.bySource)),
      table('By player and source', ['Death', ...header.slice(1)], tallyRows(report.bySourceAndPlayer)),
    );
    if (options.runToEnd) results.append(table('All deaths by source', ['Source', 'Deaths', 'Of deaths', 'Mean time'], tallyRows(report.allDeathsBySource)));
    for (const breakdown of report.rolls) {
      results.append(table(`Failure rate by ${breakdown.group}`, ['Rolled', 'Attempts', 'Failed', 'Rate'],
        breakdown.rows.map((row) => [row.value, String(row.runs), String(row.failures), pct(row.rate)])));
    }
    const seeds = el('section', 'batch-section');
    seeds.append(el('h3', undefined, 'Failed seeds'), el('p', 'batch-note', 'Click one to replay it in the arena with all bots.'));
    const list = el('div', 'batch-seeds');
    for (const seed of report.failedSeeds.slice(0, SEED_BUTTON_LIMIT)) {
      const button = el('button', undefined, String(seed));
      button.addEventListener('click', () => { dialog.close(); hooks.onReplay(seed); });
      list.append(button);
    }
    if (report.failedSeeds.length > SEED_BUTTON_LIMIT) list.append(el('span', 'batch-note', `+${report.failedSeeds.length - SEED_BUTTON_LIMIT} more`));
    const copy = el('button', undefined, 'Copy all seeds');
    copy.addEventListener('click', () => { void navigator.clipboard.writeText(report.failedSeeds.join(', ')); copy.textContent = 'Copied'; });
    seeds.append(list, copy);
    results.append(seeds);
  }

  function run(): void {
    const encounter = hooks.getEncounter();
    if (!encounter || running) return;
    const total = Math.max(1, Math.min(100000, Math.floor(Number(runs.value)) || 1));
    const base = Math.floor(Number(firstSeed.value)) || 0;
    const options: BatchOptions = { runToEnd: runToEnd.checked };
    const queue = Array.from({ length: total }, (_, index) => deriveSeed(base, index));
    const outcomes: RunOutcome[] = [];
    const startedAt = performance.now();
    running = true; start.textContent = 'Cancel'; progress.hidden = false; progress.max = total; progress.value = 0; results.replaceChildren();
    status.textContent = `${encounter.name}: 0 / ${total}`;
    const workerCount = Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 8, Math.ceil(total / CHUNK_SIZE)));
    const send = (worker: Worker, request: WorkerRequest) => worker.postMessage(request);
    workers = Array.from({ length: workerCount }, () => {
      const worker = new Worker(new URL('./batchWorker.ts', import.meta.url), { type: 'module' });
      send(worker, { type: 'init', encounter: structuredClone(encounter), options });
      const next = () => { const seeds = queue.splice(0, CHUNK_SIZE); if (seeds.length) send(worker, { type: 'run', seeds }); };
      worker.onmessage = (message: MessageEvent<WorkerResponse>) => {
        outcomes.push(...message.data.outcomes);
        progress.value = outcomes.length;
        status.textContent = `${encounter.name}: ${outcomes.length} / ${total} · ${outcomes.filter((outcome) => outcome.deaths.length > 0).length} failed so far`;
        if (outcomes.length >= total) {
          const report = summarize(outcomes);
          stop(); status.textContent = `${encounter.name}: finished ${total} attempts from batch seed ${base}. The same batch seed repeats the same attempts.`;
          render(report, options, performance.now() - startedAt);
        } else next();
      };
      worker.onerror = (event) => { stop(); status.textContent = `Worker failed: ${event.message}`; };
      next();
      return worker;
    });
  }

  start.addEventListener('click', () => {
    if (running) { stop(); status.textContent = 'Cancelled.'; return; }
    run();
  });

  return { open: () => { if (!dialog.open) dialog.showModal(); }, close: () => dialog.close() };
}
