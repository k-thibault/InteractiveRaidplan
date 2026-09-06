import type { Encounter } from './Encounter';

export async function loadEncounter(url: string): Promise<Encounter> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load encounter: ${response.status}`);
  return response.json() as Promise<Encounter>;
}