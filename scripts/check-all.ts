// Runs every check script and reports one summary. `--quick` skips the slow ones (replay recording sweep, prodready batch).
// Run with: npm run check   (or npm run check:quick)
import { spawn } from 'node:child_process';

interface Check { file: string; slow?: boolean; }
const CHECKS: Check[] = [
  { file: 'check-geometry.ts' }, { file: 'check-core.ts' }, { file: 'check-simulation.ts' }, { file: 'tether-check.ts' }, { file: 'check-encounters.ts' },
  { file: 'check-replay-ids.ts' }, { file: 'check-history.ts' }, { file: 'check-viewer.ts' }, { file: 'check-foundation.ts' },
  { file: 'check-replay.ts', slow: true }, { file: 'check-prodready.ts', slow: true },
];

const quick = process.argv.includes('--quick');
const selected = CHECKS.filter((check) => !(quick && check.slow));

function run(file: string): Promise<{ code: number; seconds: number; output: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', `scripts/${file}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ code: code ?? 1, seconds: (Date.now() - started) / 1000, output }));
  });
}

// Scripts are independent, so run them side by side and print each one's output in a stable order.
const results = await Promise.all(selected.map(async (check) => ({ check, ...(await run(check.file)) })));
for (const { check, code, seconds, output } of results) {
  console.log(`${code === 0 ? 'ok  ' : 'FAIL'}  ${check.file} (${seconds.toFixed(1)}s)`);
  if (code !== 0) console.log(output.split('\n').filter((line) => !line.startsWith('PASS')).map((line) => `      ${line}`).join('\n'));
}
const failed = results.filter((result) => result.code !== 0);
console.log(failed.length === 0 ? `\nall ${results.length} checks passed${quick ? ' (quick: slow checks skipped)' : ''}` : `\n${failed.length} of ${results.length} checks failed: ${failed.map((result) => result.check.file).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
