export type Point = { x: number; y: number };
export type City = {
  size: number;
  start: string;
  goal: string;
  blocked: string[];
  seed: number;
};
export { compare, reconstruct } from "./astar";
export type { RecordNode, Decision, Snapshot } from "./astar";
import { searchGraph, type RecordNode, type Snapshot } from "./astar";
export const key = (x: number, y: number) => `${x},${y}`;
export const point = (id: string): Point => {
  const [x, y] = id.split(",").map(Number);
  return { x, y };
};
export const label = (id: string) => {
  const { x, y } = point(id);
  return `${String.fromCharCode(65 + y)}${x + 1}`;
};
export const manhattan = (a: string, b: string) => {
  const p = point(a),
    q = point(b);
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
};
export const neighbors = (id: string, size: number) => {
  const { x, y } = point(id);
  return [
    [x + 1, y],
    [x, y + 1],
    [x - 1, y],
    [x, y - 1],
  ]
    .filter(([a, b]) => a >= 0 && b >= 0 && a < size && b < size)
    .map(([a, b]) => key(a, b));
};
/** Relaxation is independent so better-cost updates can be verified directly. */
export function relax(
  records: Record<string, RecordNode>,
  id: string,
  parent: string,
  goal: string,
): boolean {
  const g = records[parent].g + 1;
  if (records[id] && records[id].g <= g) return false;
  const h = manhattan(id, goal);
  records[id] = { id, g, h, f: g + h, parent };
  return true;
}
export function search(city: City): Snapshot[] {
  return searchGraph({
    start: city.start,
    goal: city.goal,
    heuristic: (id) => manhattan(id, city.goal),
    neighbors: (id) =>
      neighbors(id, city.size).map((next) => ({
        id: next,
        cost: 1,
        blocked: city.blocked.includes(next),
      })),
  });
}
export function generateCity(scenario = 1, seed = 42): City {
  const size = 8,
    start = key(0, 6),
    goal = key(7, 1);
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // Reserve an explicit corridor for the two reachable scenarios.
  const safe = new Set<string>();
  for (let x = 0; x < size; x++) safe.add(key(x, 6));
  for (let y = 1; y <= 6; y++) safe.add(key(7, y));
  const blocked: string[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const id = key(x, y);
      if (
        id !== start &&
        id !== goal &&
        !safe.has(id) &&
        random() < (scenario === 1 ? 0.12 : 0.29)
      )
        blocked.push(id);
    }
  if (scenario === 3)
    for (const id of neighbors(goal, size))
      if (!blocked.includes(id)) blocked.push(id);
  return { size, start, goal, blocked, seed };
}
export const moveCursor = (index: number, delta: number, length: number) =>
  Math.max(0, Math.min(length - 1, index + delta));
