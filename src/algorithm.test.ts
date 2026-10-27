import { describe, it, expect } from "vitest";
import {
  search,
  generateCity,
  manhattan,
  neighbors,
  relax,
  reconstruct,
  moveCursor,
  type City,
} from "./algorithm";
const base: City = { size: 4, start: "0,0", goal: "3,3", blocked: [], seed: 1 };
function bfs(city: City) {
  const queue: [string, number][] = [[city.start, 0]],
    seen = new Set([city.start]);
  while (queue.length) {
    const [id, cost] = queue.shift()!;
    if (id === city.goal) return cost;
    for (const n of neighbors(id, city.size))
      if (!seen.has(n) && !city.blocked.includes(n)) {
        seen.add(n);
        queue.push([n, cost + 1]);
      }
  }
  return -1;
}
describe("A* real y reproducible", () => {
  it("encuentra la ruta más corta con Manhattan correcto", () => {
    const final = search(base).at(-1)!;
    expect(final.status).toBe("found");
    expect(final.path.length - 1).toBe(6);
    expect(manhattan(base.start, base.goal)).toBe(6);
    for (const n of Object.values(final.records)) {
      expect(n.f).toBe(n.g + n.h);
      expect(n.h).toBe(manhattan(n.id, base.goal));
    }
  });
  it("evita obstáculos y encuentra alternativas con desvío", () => {
    const city = {
      ...base,
      start: "0,1",
      goal: "3,1",
      blocked: ["1,1", "1,0"],
    };
    const result = search(city).at(-1)!;
    expect(result.path.length - 1).toBe(5);
    expect(result.path.every((n) => !city.blocked.includes(n))).toBe(true);
    expect(
      search(city).some((s) => s.decisions.some((d) => d.kind === "blocked")),
    ).toBe(true);
  });
  it("detecta destino inaccesible y vacía la lista abierta", () => {
    const final = search({ ...base, blocked: ["2,3", "3,2"] }).at(-1)!;
    expect(final.status).toBe("unreachable");
    expect(final.open).toEqual([]);
    expect(final.path).toEqual([]);
  });
  it("resuelve inicio igual a destino con costo cero", () => {
    const final = search({ ...base, goal: base.start }).at(-1)!;
    expect(final.path).toEqual([base.start]);
    expect(final.records[base.start].g).toBe(0);
  });
  it("actualiza mejores costos y el padre; rechaza costos peores", () => {
    const records = {
      "0,0": { id: "0,0", g: 0, h: 2, f: 2, parent: null },
      "1,0": { id: "1,0", g: 9, h: 1, f: 10, parent: "0,1" },
    };
    expect(relax(records, "1,0", "0,0", "2,0")).toBe(true);
    expect(records["1,0"]).toEqual({
      id: "1,0",
      g: 1,
      h: 1,
      f: 2,
      parent: "0,0",
    });
    expect(relax(records, "1,0", "0,0", "2,0")).toBe(false);
    expect(reconstruct(records, "1,0")).toEqual(["0,0", "1,0"]);
  });
  it("reconstruye padres contiguos y sin ciclos", () => {
    const s = search(generateCity(2, 73)).at(-1)!;
    expect(s.path[0]).toBe("0,6");
    expect(s.path.at(-1)).toBe("7,1");
    s.path.slice(1).forEach((id, i) => {
      expect(manhattan(id, s.path[i])).toBe(1);
      expect(s.records[id].parent).toBe(s.path[i]);
    });
  });
  it("genera escenarios garantizados y repetibles en 100 semillas", () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const scenario of [1, 2, 3]) {
        const city = generateCity(scenario, seed);
        expect(generateCity(scenario, seed)).toEqual(city);
        const s = search(city).at(-1)!;
        expect(s.status).toBe(scenario === 3 ? "unreachable" : "found");
        expect(s.path.length ? s.path.length - 1 : -1).toBe(bfs(city));
        expect(city.blocked).not.toContain(city.start);
        expect(city.blocked).not.toContain(city.goal);
      }
    }
  });
  it("conserva instantáneas al avanzar y retroceder", () => {
    const history = search(base);
    const saved = structuredClone(history[1]);
    let cursor = moveCursor(0, 1, history.length);
    cursor = moveCursor(cursor, 1, history.length);
    cursor = moveCursor(cursor, -1, history.length);
    expect(history[cursor]).toEqual(saved);
    expect(history[0].closed).toEqual([]);
    expect(history[1].closed).toHaveLength(1);
    expect(moveCursor(0, -1, history.length)).toBe(0);
    expect(moveCursor(history.length - 1, 1, history.length)).toBe(
      history.length - 1,
    );
  });
  it("aplica el mismo desempate en cada ejecución", () =>
    expect(search(base)).toEqual(search(base)));
});
