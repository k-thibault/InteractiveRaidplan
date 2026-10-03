import type { Encounter } from './Encounter';
import { resolvePositionValue } from '../geometry/Vector2';

export interface EncounterManifestEntry {
  id: string;
  name: string;
  file: string;
}

interface GraphicLibrary { [name: string]: string; }

export async function loadEncounterManifest(
  url = `${import.meta.env.BASE_URL}encounters/index.json`,
): Promise<EncounterManifestEntry[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load encounter list: ${response.status}`);
  const entries = await response.json() as EncounterManifestEntry[];
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

/** Loads an encounter and resolves any shared resource-backed graphics. */
export async function loadEncounter(url: string): Promise<Encounter> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load encounter: ${response.status}`);

  const encounter = await response.json() as Encounter;
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
