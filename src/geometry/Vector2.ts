export interface Vector2 {
  x: number;
  y: number;
}

export function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function length(vector: Vector2): number {
  return Math.hypot(vector.x, vector.y);
}

export function normalize(vector: Vector2): Vector2 {
  const size = length(vector);
  return size === 0 ? { x: 0, y: 0 } : { x: vector.x / size, y: vector.y / size };
}

export function distance(a: Vector2, b: Vector2): number {
  return length(subtract(a, b));
}