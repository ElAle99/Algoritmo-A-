import { describe, it, expect } from "vitest";
import raw from "../../public/data/bacalar-osm.json";
import {
  buildGraph,
  distance,
  lineLength,
  searchRoads,
  routeFeature,
  snapPoint,
  roadsGeoJSON,
  explorationGeoJSON,
  examinedGeoJSON,
  extractPlaces,
  interpolateRoute,
  demoClosures,
  type OSMData,
  type OSMElement,
  type RoadGraph,
  type Coordinate,
} from "./graph";
import { demoEndpoints } from "./demo";
import { moveCursor } from "../algorithm";
import { searchGraph } from "../astar";
const data = raw as unknown as OSMData,
  graph = buildGraph(data),
  places = extractPlaces(data),
  demo = demoEndpoints(graph, places);
const final = searchRoads(
  graph,
  demo.origin.nodeId,
  demo.destination.nodeId,
).at(-1)!;
function dijkstra(
  graph: RoadGraph,
  start: string,
  blocked: Set<string> = new Set(),
  reverse = false,
) {
  const costs: Record<string, number> = { [start]: 0 },
    queue = new Set([start]);
  while (queue.size) {
    const id = [...queue].sort(
      (a, b) => costs[a] - costs[b] || a.localeCompare(b),
    )[0];
    queue.delete(id);
    for (const edgeId of (reverse ? graph.incoming : graph.outgoing)[id]) {
      const e = graph.edges[edgeId];
      if (blocked.has(e.physicalId)) continue;
      const next = reverse ? e.from : e.to,
        value = costs[id] + e.cost;
      if (costs[next] === undefined || value < costs[next]) {
        costs[next] = value;
        queue.add(next);
      }
    }
  }
  return costs;
}
const node = (id: number, lon: number, lat: number): OSMElement => ({
  type: "node",
  id,
  lon,
  lat,
});
const way = (
  id: number,
  nodes: number[],
  tags: Record<string, string> = {},
): OSMElement => ({
  type: "way",
  id,
  nodes,
  tags: { highway: "residential", ...tags },
});
const fixture: OSMData = {
  elements: [
    node(1, -88.395, 18.675),
    node(2, -88.394, 18.675),
    node(3, -88.393, 18.675),
    node(4, -88.394, 18.674),
    node(5, -88.394, 18.676),
    way(10, [1, 2, 3], { name: "Calle A" }),
    way(11, [4, 2, 5], { name: "Calle B" }),
  ],
};
describe("Red vial geográfica de Bacalar", () => {
  it("calcula distancias geográficas en metros, simétricas y estables", () => {
    expect(distance([0, 0], [0, 1])).toBeCloseTo(111195.0802, 2);
    expect(distance([-88.39, 18.67], [-88.39, 18.67])).toBe(0);
    expect(distance([1, 2], [3, 4])).toBeCloseTo(distance([3, 4], [1, 2]), 8);
    expect(distance([0, 0], [180, 0])).toBeCloseTo(Math.PI * 6371008.8, 3);
  });
  it("conecta intersecciones por el nodo OSM compartido", () => {
    const g = buildGraph(fixture);
    expect(g.outgoing["2"]).toHaveLength(4);
    expect(searchRoads(g, "1", "5").at(-1)!.path).toEqual(["1", "2", "5"]);
  });
  it("no une cruces geométricos sin un identificador compartido", () => {
    const g = buildGraph({
      ...fixture,
      elements: [
        ...fixture.elements.filter((e) => e.type === "node"),
        way(10, [1, 3]),
        way(11, [4, 5]),
      ],
    });
    expect(searchRoads(g, "1", "5").at(-1)!.status).toBe("unreachable");
  });
  it("conserva curvaturas internas al comprimir nodos de grado dos", () => {
    const g = buildGraph({
      elements: fixture.elements
        .filter((e) => e.type === "node")
        .concat(way(10, [1, 4, 3])),
    });
    expect(g.nodes["4"]).toBeUndefined();
    expect(Object.values(g.edges)[0].coordinates).toHaveLength(3);
    expect(Object.values(g.edges)[0].cost).toBeCloseTo(
      lineLength([
        [-88.395, 18.675],
        [-88.394, 18.674],
        [-88.393, 18.675],
      ]),
      6,
    );
  });
  it("respeta oneway yes, -1 y rotondas; excluye vías privadas y peatonales", () => {
    for (const [tags, from, to] of [
      [{ oneway: "yes" }, "1", "3"],
      [{ oneway: "-1" }, "3", "1"],
      [{ junction: "roundabout" }, "1", "3"],
    ] as const) {
      const g = buildGraph({
        elements: fixture.elements
          .filter((e) => e.type === "node")
          .concat(way(10, [1, 2, 3], tags)),
      });
      expect(searchRoads(g, from, to).at(-1)!.status).toBe("found");
      expect(searchRoads(g, to, from).at(-1)!.status).toBe("unreachable");
    }
    for (const tags of [
      { access: "private" },
      { highway: "footway" },
      { motor_vehicle: "no" },
    ] as Record<string, string>[])
      expect(
        Object.keys(
          buildGraph({
            elements: fixture.elements
              .filter((e) => e.type === "node")
              .concat(way(10, [1, 2, 3], tags)),
          }).edges,
        ),
      ).toHaveLength(0);
  });
  it("usa el costo de toda la geometría, no la distancia entre extremos", () => {
    for (const e of Object.values(graph.edges)) {
      expect(e.cost).toBeCloseTo(lineLength(e.coordinates), 7);
      expect(e.cost + 1e-6).toBeGreaterThanOrEqual(
        distance(graph.nodes[e.from].coordinate, graph.nodes[e.to].coordinate),
      );
    }
  });
  it("tiene heurística admisible y consistente para todo el grafo local", () => {
    const costs = dijkstra(graph, demo.destination.nodeId, new Set(), true),
      goal = demo.destination.coordinate;
    for (const n of Object.values(graph.nodes)) {
      if (costs[n.id] !== undefined)
        expect(distance(n.coordinate, goal)).toBeLessThanOrEqual(
          costs[n.id] + 1e-6,
        );
    }
    for (const e of Object.values(graph.edges))
      expect(
        distance(graph.nodes[e.from].coordinate, goal),
      ).toBeLessThanOrEqual(
        e.cost + distance(graph.nodes[e.to].coordinate, goal) + 1e-6,
      );
  });
  it("A* propio coincide con Dijkstra en rutas del extracto auténtico", () => {
    const costs = dijkstra(graph, demo.origin.nodeId);
    const ids = Object.keys(graph.nodes)
      .sort()
      .filter((_, i) => i % 23 === 0)
      .concat(demo.destination.nodeId);
    for (const goal of ids) {
      const s = searchRoads(graph, demo.origin.nodeId, goal).at(-1)!;
      if (costs[goal] === undefined) expect(s.status).toBe("unreachable");
      else {
        expect(s.status).toBe("found");
        expect(s.records[goal].g).toBeCloseTo(costs[goal], 6);
      }
    }
  });
  it("reconstruye GeoJSON exactamente desde las aristas elegidas por A*", () => {
    const feature = routeFeature(graph, final)!;
    const expected = final.pathEdges.flatMap((id, i) =>
      i ? graph.edges[id].coordinates.slice(1) : graph.edges[id].coordinates,
    );
    expect(feature.geometry.coordinates).toEqual(expected);
    expect(feature.properties?.nodeIds).toEqual(final.path);
    expect(feature.properties?.edgeIds).toEqual(final.pathEdges);
    expect(lineLength(expected)).toBeCloseTo(
      final.records[demo.destination.nodeId].g,
      6,
    );
    expect(
      final.pathEdges.reduce((sum, id) => sum + graph.edges[id].cost, 0),
    ).toBeCloseTo(Number(feature.properties?.cost), 6);
  });
  it("rechaza una geometría que no corresponde al camino calculado", () => {
    const invalid = structuredClone(final);
    invalid.pathEdges[0] = Object.keys(graph.edges).find(
      (id) => graph.edges[id].from !== invalid.path[0],
    )!;
    expect(() => routeFeature(graph, invalid)).toThrow(
      "La geometría no corresponde",
    );
  });
  it("cierra un tramo en ambos sentidos y encuentra una alternativa", () => {
    const closed = demoClosures(
      graph,
      demo.origin.nodeId,
      demo.destination.nodeId,
      2,
    );
    expect(closed.size).toBe(1);
    const result = searchRoads(
      graph,
      demo.origin.nodeId,
      demo.destination.nodeId,
      closed,
    ).at(-1)!;
    expect(result.status).toBe("found");
    expect(
      result.pathEdges.every((id) => !closed.has(graph.edges[id].physicalId)),
    ).toBe(true);
    expect(result.records[demo.destination.nodeId].g).toBeCloseTo(
      dijkstra(graph, demo.origin.nodeId, closed)[demo.destination.nodeId],
      6,
    );
    expect(
      roadsGeoJSON(graph, closed).features.filter((f) => f.properties?.blocked),
    ).toHaveLength(1);
  });
  it("genera tres demostraciones deterministas, incluida una sin salida", () => {
    for (const scenario of [1, 2, 3]) {
      const blocked = demoClosures(
        graph,
        demo.origin.nodeId,
        demo.destination.nodeId,
        scenario,
      );
      expect(
        demoClosures(
          graph,
          demo.origin.nodeId,
          demo.destination.nodeId,
          scenario,
        ),
      ).toEqual(blocked);
      const result = searchRoads(
        graph,
        demo.origin.nodeId,
        demo.destination.nodeId,
        blocked,
      ).at(-1)!;
      expect(result.status).toBe(scenario === 3 ? "unreachable" : "found");
      if (scenario === 3) {
        expect(result.open).toEqual([]);
        expect(routeFeature(graph, result)).toBeNull();
      }
    }
  });
  it("asocia puntos a nodos transitables, informa el ajuste y rechaza puntos lejanos", () => {
    const snap = snapPoint(graph, [-88.3923678, 18.6758227], "origin")!;
    expect(graph.outgoing[snap.nodeId].length).toBeGreaterThan(0);
    expect(snap.snapDistance).toBeCloseTo(
      distance(snap.coordinate, snap.requested),
      6,
    );
    expect(snapPoint(graph, [-99, 20])).toBeNull();
  });
  it("mantiene las capas sincronizadas con la instantánea al avanzar y retroceder", () => {
    const history = searchRoads(
      graph,
      demo.origin.nodeId,
      demo.destination.nodeId,
    );
    const first = structuredClone(history[1]);
    let cursor = moveCursor(0, 1, history.length);
    cursor = moveCursor(cursor, 1, history.length);
    cursor = moveCursor(cursor, -1, history.length);
    expect(history[cursor]).toEqual(first);
    const points = explorationGeoJSON(graph, history[cursor]);
    expect(
      points.features.find((f) => f.properties?.status === "current")?.id,
    ).toBe(history[cursor].current);
    expect(
      points.features.filter((f) => f.properties?.status === "open"),
    ).toHaveLength(history[cursor].open.length);
    const examined = examinedGeoJSON(graph, history[cursor]);
    expect(examined.features.map((f) => f.geometry.coordinates)).toEqual(
      history[cursor].decisions.map((d) => graph.edges[d.edgeId!].coordinates),
    );
  });
  it("anima puntos únicamente sobre los segmentos exactos de la ruta", () => {
    const line = routeFeature(graph, final)!.geometry
        .coordinates as Coordinate[],
      cost = lineLength(line);
    expect(interpolateRoute(line, 0).coordinate).toEqual(line[0]);
    expect(interpolateRoute(line, cost + 1).coordinate).toEqual(line.at(-1));
    for (let m = 0; m < cost; m += 13) {
      const p = interpolateRoute(line, m).coordinate;
      expect(
        line
          .slice(1)
          .some(
            (b, i) =>
              Math.abs(
                distance(line[i], p) + distance(p, b) - distance(line[i], b),
              ) < 0.01,
          ),
      ).toBe(true);
    }
  });
  it("conserva nombres OSM sin inventar comercios ni marcar todos como pizzería", () => {
    expect(places.find((p) => p.name === "Don Mostado Pizza")?.category).toBe(
      "Pizzería",
    );
    expect(
      places.find((p) => p.name === "Parque Principal de Bacalar")?.category,
    ).toBe("Parque");
    expect(
      places.every((p) =>
        data.elements.some((e) => `${e.type}/${e.id}` === p.id),
      ),
    ).toBe(true);
  });
  it("el núcleo compartido mejora costos ponderados y registra la decisión", () => {
    const arcs: Record<string, { id: string; cost: number; edgeId: string }[]> =
      {
        a: [
          { id: "b", cost: 10, edgeId: "ab" },
          { id: "c", cost: 1, edgeId: "ac" },
        ],
        c: [{ id: "b", cost: 1, edgeId: "cb" }],
        b: [{ id: "d", cost: 1, edgeId: "bd" }],
        d: [],
      };
    const h = searchGraph({
      start: "a",
      goal: "d",
      heuristic: () => 0,
      neighbors: (id) => arcs[id],
    });
    expect(h.at(-1)!.path).toEqual(["a", "c", "b", "d"]);
    expect(h.at(-1)!.pathEdges).toEqual(["ac", "cb", "bd"]);
    expect(h.at(-1)!.records.d.g).toBe(3);
    expect(h.some((s) => s.decisions.some((d) => d.kind === "improved"))).toBe(
      true,
    );
  });
  it("resuelve origen igual a destino sin aristas ni entrega ficticia", () => {
    const s = searchRoads(graph, demo.origin.nodeId, demo.origin.nodeId).at(
      -1,
    )!;
    expect(s.pathEdges).toEqual([]);
    expect(s.records[demo.origin.nodeId].g).toBe(0);
    expect(
      lineLength(routeFeature(graph, s)!.geometry.coordinates as Coordinate[]),
    ).toBe(0);
  });
  it("registra un resumen reproducible de la demostración real", () => {
    console.info(
      "Bacalar OSM:",
      JSON.stringify({
        nodes: Object.keys(graph.nodes).length,
        arcs: Object.keys(graph.edges).length,
        physicalRoads: roadsGeoJSON(graph).features.length,
        places: places.length,
        origin: demo.origin,
        destination: demo.destination,
        routeMeters: final.records[demo.destination.nodeId].g,
        edges: final.pathEdges.length,
        iterations: final.iteration,
      }),
    );
    expect(final.status).toBe("found");
  });
});
