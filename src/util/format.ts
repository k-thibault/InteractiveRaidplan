export function formatStatusName(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function statusDisplayName(id: string, definitions: ReadonlyMap<string, { name?: string }>): string {
  return definitions.get(id)?.name ?? formatStatusName(id);
}

export function formatClock(ms: number): string {
  const minutes = String(Math.floor(ms / 60000)).padStart(2, '0');
  const seconds = (ms / 1000 % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
}