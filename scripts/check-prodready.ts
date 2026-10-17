// Every prodready encounter must clear a batch of all-bots attempts with no deaths and no simulation errors.
// Run with: npx tsx scripts/check-prodready.ts [attempts=500] [batchSeed=1] [encounterId...]
import { deriveSeed, runSeed } from '../src/dev/BatchRun';
import { summarize } from '../src/dev/BatchStats';
import type { RunOutcome } from '../src/dev/BatchRun';
import { loadEncounter, prodreadyEncounterIds } from './lib';

const [attemptsArg, batchSeedArg, ...only] = process.argv.slice(2);
const attempts = Number(attemptsArg ?? 500);
const batchSeed = Number(batchSeedArg ?? 1);
if (!Number.isInteger(attempts) || attempts < 1 || !Number.isInteger(batchSeed)) { console.error('usage: check-prodready.ts [attempts] [batchSeed] [encounterId...]'); process.exit(2); }

const ids = only.length ? only : prodreadyEncounterIds();
if (ids.length === 0) { console.error('no prodready encounters found in public/encounters/index.json'); process.exit(2); }

let failedEncounters = 0;
for (const id of ids) {
  const encounter = loadEncounter(id);
  const outcomes: RunOutcome[] = [];
  const started = Date.now();
  // Stop at the first death like the dev dialog does; the failing seeds are enough to replay.
  for (let index = 0; index < attempts; index += 1) outcomes.push(runSeed(encounter, deriveSeed(batchSeed, index), { runToEnd: false }));
  const report = summarize(outcomes);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const clean = report.failed === 0 && report.errored === 0 && report.passed === attempts;
  console.log(`${clean ? 'PASS' : 'FAIL'}  ${id}: ${report.passed}/${attempts} attempts cleared (batch seed ${batchSeed}, ${seconds}s)`);
  if (clean) continue;
  failedEncounters += 1;
  if (report.failed) {
    console.error(`  ${report.failed} failed; first failing seeds (replay them from the batch dialog): ${report.failedSeeds.slice(0, 10).join(', ')}`);
    for (const row of report.bySourceAndPlayer.slice(0, 5)) console.error(`  ${row.count}x ${row.label} (mean ${(row.meanTime / 1000).toFixed(1)}s)`);
  }
  if (report.errored) console.error(`  ${report.errored} errored: ${report.errors.join(' | ')}`);
}
console.log(failedEncounters === 0 ? `\nprodready check passed (${ids.join(', ')})` : `\n${failedEncounters} prodready encounter(s) did not pass`);
process.exit(failedEncounters === 0 ? 0 : 1);
