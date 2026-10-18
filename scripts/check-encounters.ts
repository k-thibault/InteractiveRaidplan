// Data integrity for every encounter in public/encounters: loader validation, dangling references and a smoke run.
// Run with: npx tsx scripts/check-encounters.ts
import { existsSync, readFileSync } from 'node:fs';
import { collectEntityGraphics, validateMarkerReferences, validateTethers } from '../src/encounters/EncounterLoader';
import { validateArenaDefinition } from '../src/geometry/Arena';
import { resolvePositionValue } from '../src/geometry/Vector2';
import { Simulation } from '../src/simulation/Simulation';
import { ENCOUNTER_IDS, TICK_MS, loadEncounter } from './lib';

let failures = 0;
function warn(message: string): void { console.warn(`WARN  ${message}`); }
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failures += 1; if (detail !== undefined) console.error(`      ${Array.isArray(detail) ? detail.slice(0, 8).join('\n      ') : String(detail)}`); }
}
const throwsMessage = (fn: () => void): string | undefined => { try { fn(); return undefined; } catch (error) { return error instanceof Error ? error.message : String(error); } };

const manifestUrl = new URL('../public/encounters/index.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as Array<{ id: string; name: string; file: string; prodready?: boolean }>;
const graphicsLibrary = JSON.parse(readFileSync(new URL('../public/resources/graphics.json', import.meta.url), 'utf8')) as Record<string, string>;

// Manifest
check('manifest ids are unique and URL-safe', new Set(manifest.map((entry) => entry.id)).size === manifest.length && manifest.every((entry) => /^[a-z0-9][a-z0-9-_]*$/i.test(entry.id)));
check('every manifest entry has a name and an existing file', manifest.every((entry) => entry.name && existsSync(new URL(entry.file, manifestUrl))), manifest.filter((entry) => !entry.name || !existsSync(new URL(entry.file, manifestUrl))).map((entry) => entry.id));
check('at least one encounter is prodready', manifest.some((entry) => entry.prodready === true));

type Json = Record<string, unknown>;
const literal = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('$');

/** Collects every string a key points at, wherever it sits in the encounter (events, casts, statuses, areas, batches, tethers). */
function collect(node: unknown, keys: string[], found: Array<{ key: string; value: string; path: string }> = [], path = '$'): typeof found {
  if (Array.isArray(node)) { node.forEach((child, index) => collect(child, keys, found, `${path}[${index}]`)); return found; }
  if (node === null || typeof node !== 'object') return found;
  for (const [key, child] of Object.entries(node as Json)) {
    if (keys.includes(key)) for (const value of Array.isArray(child) ? child : [child]) if (literal(value)) found.push({ key, value, path: `${path}.${key}` });
    collect(child, keys, found, `${path}.${key}`);
  }
  return found;
}

/** `enemy` names a template only on spawn_enemy; elsewhere (set_focus) it is an entity id. */
function spawnedTemplates(node: unknown, found: Array<{ value: string; path: string }> = [], path = '$'): typeof found {
  if (Array.isArray(node)) { node.forEach((child, index) => spawnedTemplates(child, found, `${path}[${index}]`)); return found; }
  if (node === null || typeof node !== 'object') return found;
  const record = node as Json;
  if (record.type === 'spawn_enemy' && literal(record.enemy)) found.push({ value: record.enemy, path: `${path}.enemy` });
  for (const [key, child] of Object.entries(record)) spawnedTemplates(child, found, `${path}.${key}`);
  return found;
}

for (const id of ENCOUNTER_IDS) {
  const encounter = loadEncounter(id); const e = encounter as unknown as Json;
  const problems = (label: string, list: string[]) => check(`${id}: ${label}`, list.length === 0, list);

  check(`${id}: arena, markers and tethers pass the loader's validation`, throwsMessage(() => {
    if (encounter.arena) validateArenaDefinition(encounter.arena);
    const markerIds = new Set<string>();
    for (const marker of encounter.markers ?? []) {
      if (!marker.id || markerIds.has(marker.id)) throw new Error(`marker id "${marker.id}" is empty or duplicated`);
      if (!!marker.character === !!marker.image) throw new Error(`marker "${marker.id}" needs exactly one of character or image`);
      const position = resolvePositionValue(marker.position);
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error(`marker "${marker.id}" has a non-finite position`);
      markerIds.add(marker.id);
    }
    validateMarkerReferences(encounter, markerIds);
    validateTethers(encounter);
  }) === undefined, throwsMessage(() => {
    const markerIds = new Set((encounter.markers ?? []).map((marker) => marker.id));
    validateMarkerReferences(encounter, markerIds); validateTethers(encounter);
  }));

  const graphicNames = new Set([...(encounter.resources?.graphics ?? []), ...(encounter.markers ?? []).flatMap((marker) => marker.image ? [marker.image] : []), ...collectEntityGraphics([encounter.players, encounter.enemies, encounter.enemyTemplates, encounter.events, encounter.casts])]);
  problems('every graphic exists in the shared library', [...graphicNames].filter((name) => !graphicsLibrary[name]).map((name) => `unknown graphic "${name}"`));
  problems('status icons exist in the shared library', (encounter.statuses ?? []).filter((status) => status.icon && !graphicsLibrary[status.icon] && !encounter.resources?.images?.[status.icon]).map((status) => `${status.id} icon "${status.icon}"`));

  const statusIds = new Set((encounter.statuses ?? []).map((status) => status.id));
  problems('status ids are unique', (encounter.statuses ?? []).map((status) => status.id).filter((statusId, index, all) => all.indexOf(statusId) !== index));
  problems('referenced statuses are defined', collect(e, ['status', 'statusChoices', 'failStatuses', 'statuses']).filter((ref) => !statusIds.has(ref.value)).map((ref) => `${ref.path} -> "${ref.value}"`));

  const castIds = new Set(Object.keys(encounter.casts ?? {}));
  problems('referenced casts are defined', collect(e, ['cast', 'castChoices']).filter((ref) => !castIds.has(ref.value)).map((ref) => `${ref.path} -> "${ref.value}"`));
  const areaIds = new Set(Object.keys(encounter.areas ?? {}));
  problems('referenced areas are defined', collect(e, ['area']).filter((ref) => !areaIds.has(ref.value)).map((ref) => `${ref.path} -> "${ref.value}"`));
  const templateIds = new Set(Object.keys(encounter.enemyTemplates ?? {}));
  problems('spawned enemy templates are defined', spawnedTemplates(e).filter((ref) => !templateIds.has(ref.value)).map((ref) => `${ref.path} -> "${ref.value}"`));
  const areaGroupIds = new Set(Object.keys(encounter.areaGroups ?? {}));
  problems('referenced area groups are defined', collect(e, ['areaGroup']).filter((ref) => !areaGroupIds.has(ref.value)).map((ref) => `${ref.path} -> "${ref.value}"`));
  const batchIds = new Set(Object.keys(encounter.batches ?? {}));
  problems('referenced batches are defined', collect(e, ['batch']).filter((ref) => !batchIds.has(ref.value)).map((ref) => `${ref.path} -> "${ref.value}"`));

  // Timeline
  const eventIds = encounter.events.map((event) => event.id);
  problems('event ids are present', eventIds.filter((eventId) => !eventId));
  // A repeated id is only harmful when an `after` points at it, since timing resolves to whichever event came last.
  const repeated = new Set(eventIds.filter((eventId, index) => eventIds.indexOf(eventId) !== index));
  problems('`after` never points at a repeated event id', encounter.events.filter((event) => event.after !== undefined && repeated.has(event.after)).map((event) => `${event.id} after "${event.after}"`));
  for (const eventId of repeated) warn(`${id}: event id "${eventId}" is used more than once`);
  problems('`after` points at an earlier event', encounter.events.filter((event, index) => event.after !== undefined && !eventIds.slice(0, index).includes(event.after)).map((event) => `${event.id} after "${event.after}"`));
  problems('every event has a time source and a sane delay', encounter.events.filter((event) => (event.at === undefined && event.after === undefined && (event.at ?? 0) !== 0) || (event.at !== undefined && !(event.at >= 0)) || (event.delay !== undefined && !(event.delay >= 0))).map((event) => event.id));
  const lastAt = Math.max(0, ...encounter.events.filter((event) => event.at !== undefined).map((event) => event.at!));
  check(`${id}: the duration covers the last timed event`, encounter.duration > 0 && encounter.duration >= lastAt, `duration ${encounter.duration} < last event at ${lastAt}`);

  // Entities
  const entityIds = [...encounter.players, ...encounter.enemies].map((entity) => entity.id);
  check(`${id}: player and enemy ids are unique`, new Set(entityIds).size === entityIds.length);
  check(`${id}: there are players and a boss to aim at`, encounter.players.length > 0 && encounter.enemies.length > 0);
  check(`${id}: every player has finite health and speed`, encounter.players.every((player) => Number.isFinite(player.health) && player.health > 0 && Number.isFinite(player.moveSpeed) && player.moveSpeed > 0));
}

// Smoke run: bots play every encounter through without throwing or producing garbage coordinates
for (const id of ENCOUNTER_IDS) {
  const encounter = loadEncounter(id); const problems: string[] = [];
  for (const seed of [11, 4242, 90210]) {
    try {
      const simulation = new Simulation(encounter, { seed, replayOutcomes: new Map() }); simulation.start();
      const maxTicks = Math.ceil(encounter.duration / TICK_MS) + 100;
      while (!simulation.state.completed && simulation.tickCount < maxTicks) {
        simulation.tick(TICK_MS);
        if (simulation.tickCount % 120 === 0) for (const entity of [...simulation.state.players, ...simulation.state.enemies]) if (!Number.isFinite(entity.position.x) || !Number.isFinite(entity.position.y)) problems.push(`seed ${seed}: ${entity.id} went non-finite at tick ${simulation.tickCount}`);
      }
      if (!simulation.state.completed) problems.push(`seed ${seed}: never completed`);
    } catch (error) { problems.push(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  check(`${id}: all-bots smoke runs complete without errors`, problems.length === 0, problems);
}

console.log(failures === 0 ? '\nencounter check passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
