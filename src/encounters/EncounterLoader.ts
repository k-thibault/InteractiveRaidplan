import type { Encounter } from './Encounter';
import { resolvePositionValue } from '../geometry/Vector2';
import { isValidDirectionClamp } from '../geometry/DirectionClamp';
import { validateArenaDefinition } from '../geometry/Arena';

export interface EncounterManifestEntry {
  /** Stable URL-safe identifier, also used by the `?encounter=` parameter. */
  id: string;
  name: string;
  file: string;
  /** Include this encounter in the production timeline list. */
  prodready?: boolean;
}

interface GraphicLibrary { [name: string]: string; }

export async function loadEncounterManifest(
  url = `${import.meta.env.BASE_URL}encounters/index.json`,
): Promise<EncounterManifestEntry[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load encounter list: ${response.status}`);
  const entries = await response.json() as EncounterManifestEntry[];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(entry.id)) throw new Error(`Encounter manifest id "${entry.id}" must be URL-safe (letters, digits, - and _)`);
    if (ids.has(entry.id)) throw new Error(`Encounter manifest contains duplicate id "${entry.id}"`);
    ids.add(entry.id);
  }
  return entries.map((entry) => ({
    ...entry,
    file: new URL(entry.file, response.url).href,
  }));
}

function resolveResourceUrl(value: string, baseUrl: string): string {
  if (/^(?:data|blob|https?):/i.test(value)) return value;
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(value.replace(/^\/+/, ''), value.startsWith('/') ? base : baseUrl).href;
}

/** A value that is written out literally rather than being filled in from a random group at runtime. */
const isLiteral = (value: unknown): value is string => typeof value === 'string' && !value.includes('$');

/** Checks every marker id, marker-query name and query rank written into positions, facing rules and markerQueries. */
export function validateMarkerReferences(encounter: Encounter, markerIds: Set<string>): void {
  const queries = encounter.markerQueries ?? {};
  const visit = (node: unknown, where: string): void => {
    if (Array.isArray(node)) { node.forEach((child) => visit(child, where)); return; }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.type === 'marker') {
      if (isLiteral(record.marker) && !markerIds.has(record.marker)) throw new Error(`${where} references unknown marker "${record.marker}"`);
      if (typeof record.query === 'string' && !queries[record.query]) throw new Error(`${where} references unknown marker query "${record.query}"`);
      if (record.marker === undefined && record.query === undefined) throw new Error(`${where} has a marker target with neither "marker" nor "query"`);
    }
    if (record.clamp !== undefined && !(typeof record.clamp === 'string' && !isLiteral(record.clamp)) && !isValidDirectionClamp(record.clamp)) throw new Error(`${where} has an invalid direction clamp ${JSON.stringify(record.clamp)}`);
    if (Array.isArray(record.ids)) for (const id of record.ids) if (isLiteral(id) && !markerIds.has(id)) throw new Error(`${where} references unknown marker "${id}"`);
    if (Array.isArray(record.ranks) && !record.ranks.every((rank) => Number.isInteger(rank) && rank >= 0)) throw new Error(`${where} has marker query ranks that are not non-negative integers`);
    for (const child of Object.values(record)) visit(child, where);
  };
  visit(encounter.positions, 'Encounter positions');
  visit(encounter.facing, 'Encounter facing');
  visit(encounter.markerQueries, 'Encounter markerQueries');
}

/** Loads an encounter and resolves any shared resource-backed graphics. */
export async function loadEncounter(url: string): Promise<Encounter> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load encounter: ${response.status}`);

  const encounter = await response.json() as Encounter;
  if (encounter.arena) validateArenaDefinition(encounter.arena);
  const markerIds = new Set<string>();
  for (const marker of encounter.markers ?? []) {
    if (!marker.id) throw new Error('Encounter marker ids must be non-empty');
    if (markerIds.has(marker.id)) throw new Error(`Encounter contains duplicate marker id "${marker.id}"`);
    if (!marker.character && !marker.image) throw new Error(`Encounter marker "${marker.id}" must define either character or image`);
    if (marker.character && marker.image) throw new Error(`Encounter marker "${marker.id}" cannot define both character and image`);
    const position = resolvePositionValue(marker.position);
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error(`Encounter marker "${marker.id}" must have a finite position`);
    if (marker.border && (!Number.isFinite(marker.border.radius) || marker.border.radius <= 0)) {
      throw new Error(`Encounter marker "${marker.id}" border radius must be a positive finite number`);
    }
    markerIds.add(marker.id);
  }
  validateMarkerReferences(encounter, markerIds);
  const graphics = [...new Set([
    ...(encounter.resources?.graphics ?? []),
    ...(encounter.markers?.flatMap((marker) => marker.image ? [marker.image] : []) ?? []),
  ])];
  if (graphics.length === 0) return encounter;

  const libraryUrl = new URL('resources/graphics.json', new URL(import.meta.env.BASE_URL, window.location.origin));
  const libraryResponse = await fetch(libraryUrl);
  if (!libraryResponse.ok) throw new Error(`Unable to load graphic library: ${libraryResponse.status}`);

  const library = await libraryResponse.json() as GraphicLibrary;
  const images: Record<string, string> = {};
  for (const name of graphics) {
    const image = library[name];
    if (!image) throw new Error(`Encounter references unknown graphic "${name}"`);
    images[name] = resolveResourceUrl(image, libraryResponse.url);
  }

  encounter.resources = { ...encounter.resources, images };
  return encounter;
}
