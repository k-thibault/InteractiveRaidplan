import { Simulation } from '../src/simulation/Simulation';
import { ENCOUNTER_IDS, TICK_MS, loadEncounter } from './lib';

let failures = 0;
function check(name: string, passed: boolean): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`);
  if (!passed) failures += 1;
}

interface Finding { path: string; draw: string; }
function audit(encounter: unknown): { missing: Finding[]; ids: string[] } {
  const missing: Finding[] = [];
  const ids: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
    if (typeof value !== 'object' || value === null) return;
    const item = value as Record<string, any>;
    const type = item.type as string | undefined;
    if (typeof item.replayId === 'string') ids.push(item.replayId);
    const requireId = (draw: string) => { if (typeof item.replayId !== 'string') missing.push({ path, draw }); };
    if (['distribute_statuses', 'assign_distribution', 'select_group_subset'].includes(type ?? '')) requireId(type!);
    if (type === 'select_group' && item.selector?.type === 'random') requireId('random select_group');
    if (type === 'start_cast' && item.castChoices?.length > 1) requireId('castChoices');
    if (type === 'start_cast' && (item.facing?.type === 'random_player' || item.facing?.fallback === 'random_player')) {
      requireId('random cast facing');
      if (!item.facing.replayable) missing.push({ path, draw: 'facing.replayable' });
    }
    if (type === 'apply_status' && (item.target?.type === 'random' || Array.isArray(item.statusChoices))) requireId('random apply_status');
    if (type === 'spawn_area' && item.direction === 'random_player' && item.replayableDirection) requireId('random area direction');
    Object.entries(item).forEach(([key, child]) => visit(child, `${path}.${key}`));
  };
  visit(encounter, '$');
  return { missing, ids };
}

for (const encounterId of ENCOUNTER_IDS) {
  const { missing, ids } = audit(loadEncounter(encounterId));
  check(`${encounterId}: pinnable random draws have replay ids`, missing.length === 0);
  check(`${encounterId}: replay ids are unique`, new Set(ids).size === ids.length);
  if (missing.length) console.error(missing.slice(0, 5));
}

const encounter = structuredClone(loadEncounter('example'));
encounter.duration = 13000;
encounter.casts['replay-id-check'] = {
  id: 'replay-id-check', name: 'Replay ID check', castTime: 100, visible: true,
  effects: [{ type: 'apply_status', replayId: 'effect-status', target: { type: 'random', count: 2 }, statusChoices: ['fire-vulnerability', 'frost-vulnerability', 'magic-vulnerability'], duration: 20000 }],
} as never;
encounter.events = [
  { id: 'random-status', at: 1000, type: 'apply_status', target: { type: 'random', count: 2 }, status: 'physical-vulnerability', duration: 20000, replayId: 'random-status' },
  { id: 'distribution', at: 2000, type: 'distribute_statuses', target: { type: 'all' }, statuses: ['fire-vulnerability', 'frost-vulnerability', 'magic-vulnerability', 'damage-down'], duration: 20000, replayId: 'distribution' },
  { id: 'group', at: 3000, type: 'select_group', name: 'random-group', selector: { type: 'random', count: 3 }, replayId: 'random-group' },
  { id: 'subset', at: 3100, type: 'select_group_subset', from: 'random-group', name: 'random-subset', count: 1, replayId: 'random-subset' },
  { id: 'status-choice-cast', at: 4000, type: 'start_cast', source: 'boss', cast: 'replay-id-check' },
  ...[1, 2, 3].map((index) => ({
    id: `cast-${index}`,
    at: 8000 + index * 1000,
    type: 'start_cast' as const,
    source: 'boss',
    castChoices: ['flamestrike', 'froststrike', 'volatile-explosion'],
    replayId: 'repeat-cast',
  })),
] as never;

function run(seed: number, outcomes: Map<string, Record<string, unknown>>): string {
  const simulation = new Simulation(encounter, { seed, replayOutcomes: outcomes });
  simulation.start();
  while (!simulation.state.completed) simulation.tick(TICK_MS);
  const { state } = simulation;
  return JSON.stringify({
    players: state.players.map((player) => [player.id, player.alive, player.statuses.map((status) => status.definitionId).sort()]),
    groups: Object.entries(state.groups).map(([name, members]) => [name, members.map((member) => member.id)]).sort(),
    rolls: state.rolls,
  });
}

const recorded = new Map<string, Record<string, unknown>>();
const expected = run(1, recorded);
check('each supported draw stores an outcome', ['random-status#0', 'distribution#0', 'random-group#0', 'random-subset#0', 'effect-status#0'].every((key) => recorded.has(key)));
check('repeated draws have independent replay records', ['repeat-cast#0', 'repeat-cast#1', 'repeat-cast#2'].every((key) => typeof recorded.get(key)?.cast === 'string'));
check('recorded draws reproduce with another seed', run(2, new Map([...recorded].map(([key, value]) => [key, structuredClone(value)]))) === expected);

if (failures > 0) process.exit(1);
console.log('replay id check passed');