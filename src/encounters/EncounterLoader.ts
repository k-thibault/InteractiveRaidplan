import type { Encounter } from './Encounter';

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
  const graphics = encounter.resources?.graphics ?? [];
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
