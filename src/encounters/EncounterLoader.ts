import type { Encounter } from './Encounter';

interface GraphicLibrary {
  [name: string]: string;
}

/**
 * Loads an encounter and resolves the named graphics it uses from the shared
 * graphic library. Encounter JSON never needs to contain SVG/data URLs.
 */
export async function loadEncounter(url: string): Promise<Encounter> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load encounter: ${response.status}`);

  const encounter = await response.json() as Encounter;
  const graphics = encounter.resources?.graphics ?? [];
  if (graphics.length === 0) return encounter;

  const libraryUrl = new URL('../resources/graphics.json', new URL(url, window.location.origin));
  const libraryResponse = await fetch(libraryUrl);
  if (!libraryResponse.ok) throw new Error(`Unable to load graphic library: ${libraryResponse.status}`);

  const library = await libraryResponse.json() as GraphicLibrary;
  const images: Record<string, string> = {};
  for (const name of graphics) {
    const image = library[name];
    if (!image) throw new Error(`Encounter references unknown graphic "${name}"`);
    images[name] = image;
  }

  encounter.resources = { ...encounter.resources, images };
  return encounter;
}
