import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import raw from "../../public/data/bacalar-regional-osm.json";
import {
  regionalNetwork,
  PRESETS,
  presetPoint,
  turnAllowed,
  RoadIndex,
  stateNode,
} from "./network";
import {
  regionalTrace,
  finalSnapshot,
  regionalProblem,
  routeMetrics,
  rerouteFromPosition,
  DEFAULT_OPTIONS,
  edgeSpeed,
  edgeSeconds,
  type Profile,
} from "./routing";
import {
  osmIncidents,
  incidentWeights,
  readIncidents,
  saveIncidents,
  type Incident,
} from "./incidents";
import {
  distance,
  lineLength,
  routeFeature,
  type OSMData,
  type OSMElement,
} from "../geo/graph";
import { MinHeap } from "../heap";
import { iterateSearch, TracePlayer } from "../astar";
import { distanceAtTime } from "./useRoadDelivery";
const data = raw as unknown as OSMData,
  network = regionalNetwork(data),
  origin = presetPoint(network, PRESETS[0]),
  osm = osmIncidents(network.graph, "2026-10-27T00:00:00Z");
function independentDijkstra(problem: ReturnType<typeof regionalProblem>) {
  const costs = new Map([[problem.start, 0]]),
    pending = new Set([problem.start]),
    visited = new Set<string>();
  while (pending.size) {
    let current = "",
      minimum = Infinity;
    for (const id of pending) {
      const cost = costs.get(id)!;
      if (cost < minimum) {
        minimum = cost;
        current = id;
      }
    }
    pending.delete(current);
    if (problem.isGoal?.(current)) return minimum;
    visited.add(current);
    for (const e of problem.neighbors(current)) {
      if (e.blocked || visited.has(e.id)) continue;
      const value = minimum + e.cost;
      if (value < (costs.get(e.id) ?? Infinity)) {
        costs.set(e.id, value);
        pending.add(e.id);
      }
    }
  }
  return Infinity;
}
const n = (id: number, lon: number, lat: number): OSMElement => ({
  type: "node",
  id,
  lon,
  lat,
});
const w = (
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
    n(1, -88.397, 18.677),
    n(2, -88.396, 18.677),
    n(3, -88.395, 18.677),
    n(4, -88.396, 18.678),
    n(5, -88.395, 18.678),
    w(10, [1, 2], { oneway: "yes", maxspeed: "10" }),
    w(11, [2, 3], { oneway: "yes", maxspeed: "10" }),
    w(12, [1, 4, 5, 3], { maxspeed: "90" }),
    w(13, [4, 2], { maxspeed: "20" }),
  ],
};
function report(physicalId: string): Incident {
  return {
    id: "test/user",
    coordinate: [-88.396, 18.677],
    physicalId,
    kind: "Bache grande",
    severity: 3,
    date: "2026-10-27T00:00:00Z",
    source: "usuario",
    verification: "sin verificar",
    notes: "Reporte de prueba, no dato real",
  };
}
describe("Ampliación regional sin inventar conectividad", () => {
  it("un cierre antes de moverse permite recalcular desde el nodo real sin inventar un callejón", () => {
    const net = regionalNetwork(fixture),
      state = finalSnapshot(regionalTrace(net, "1", "3", DEFAULT_OPTIONS)),
      first = net.graph.edges[state.pathEdges[0]],
      options = { ...DEFAULT_OPTIONS, blocked: [first.physicalId] },
      located = rerouteFromPosition(net, state, 0, options);
    expect(located.start).toBe("1");
    expect(located.coordinate).toEqual(net.graph.nodes["1"].coordinate);
    expect(
      finalSnapshot(regionalTrace(located.network, located.start, "3", options))
        .status,
    ).toBe("found");
  });
  it("la animación respeta la velocidad estimada de cada tramo y no una velocidad plana", () => {
    const edges = [
      { distance: 100, seconds: 10 },
      { distance: 100, seconds: 50 },
    ];
    expect(distanceAtTime(edges, 5)).toBe(50);
    expect(distanceAtTime(edges, 20)).toBe(120);
    expect(distanceAtTime(edges, 100)).toBe(200);
    expect(distanceAtTime(edges, -1)).toBe(0);
  });
  it("excluye sentidos reversibles no evaluados, superficies impasables y barreras bloqueadas", () => {
    for (const tags of [
      { oneway: "reversible" },
      { smoothness: "impassable" },
    ] as Record<string, string>[]) {
      const net = regionalNetwork({
        elements: [
          ...fixture.elements.filter((e) => e.type === "node"),
          w(50, [1, 2, 3], tags),
        ],
      });
      expect(Object.keys(net.graph.edges)).toHaveLength(0);
    }
    const net = regionalNetwork({
      elements: [
        n(1, -88.397, 18.677),
        { ...n(2, -88.396, 18.677), tags: { barrier: "gate", locked: "yes" } },
        n(3, -88.395, 18.677),
        w(50, [1, 2, 3]),
      ],
    });
    expect(Object.keys(net.graph.edges)).toHaveLength(0);
  });
  it("access=destination no se usa como atajo, pero admite llegar a su interior", () => {
    const elements = fixture.elements
      .filter((e) => e.type === "node")
      .concat(
        n(6, -88.3948, 18.677),
        w(10, [1, 2], { access: "destination" }),
        w(11, [2, 3], { access: "destination" }),
        w(12, [1, 4, 5, 3]),
        w(14, [2, 6], { access: "destination" }),
      );
    const net = regionalNetwork({ elements });
    const transit = finalSnapshot(
      regionalTrace(net, "1", "3", DEFAULT_OPTIONS),
    );
    expect(
      transit.pathEdges.every((id) => net.graph.edges[id].wayId === 12),
    ).toBe(true);
    const arrival = finalSnapshot(
      regionalTrace(net, "1", "6", DEFAULT_OPTIONS),
    );
    expect(arrival.status).toBe("found");
    expect(
      arrival.pathEdges.some((id) => net.graph.edges[id].wayId === 14),
    ).toBe(true);
  });
  it("agrupa varias restricciones only como alternativas permitidas y mantiene prohibiciones", () => {
    const rel = (id: number, to: number): OSMElement => ({
      type: "relation",
      id,
      tags: { type: "restriction", restriction: "only_straight_on" },
      members: [
        { type: "way", ref: 10, role: "from" },
        { type: "node", ref: 2, role: "via" },
        { type: "way", ref: to, role: "to" },
      ],
    });
    const net = regionalNetwork({
      ...fixture,
      elements: [...fixture.elements, rel(91, 11), rel(92, 13)],
    });
    const from = Object.values(net.graph.edges).find((e) => e.wayId === 10)!;
    for (const wayId of [11, 13])
      expect(
        turnAllowed(
          net,
          from,
          Object.values(net.graph.edges).find(
            (e) => e.wayId === wayId && e.from === "2",
          )!,
        ),
      ).toBe(true);
  });
  it("mide cobertura, incluye destinos y excede el recorte central", () => {
    expect(network.stats.nodes).toBeGreaterThan(800);
    expect(network.stats.arcs).toBeGreaterThan(2000);
    expect(network.bounds[0]).toBeLessThan(18.647);
    expect(network.bounds[2]).toBeGreaterThan(18.702);
    expect(network.stats.kilometers).toBeGreaterThan(150);
    expect(network.stats.unknownAccess).toBeGreaterThan(0);
    expect(network.stats.turns).toBe(0);
    for (const preset of PRESETS)
      expect(presetPoint(network, preset)).toBeTruthy();
  });
  it("los accesos de UPB y Cenote son nodos de vías OSM reales, no segmentos añadidos", () => {
    for (const preset of PRESETS.slice(1, 3)) {
      const selected = presetPoint(network, preset);
      const original = data.elements.find(
        (e) => e.type === "node" && String(e.id) === selected.nodeId,
      )!;
      expect(selected.coordinate).toEqual([original.lon, original.lat]);
      expect(
        data.elements.some(
          (e) =>
            e.type === "way" &&
            e.tags?.highway &&
            e.nodes?.includes(original.id),
        ),
      ).toBe(true);
    }
    expect(network.graph.nodes["8204984607"].coordinate).toEqual([
      -88.4003654, 18.7017204,
    ]);
  });
  for (const preset of PRESETS.slice(1, 3))
    for (const profile of ["shortest", "fastest", "risk"] as Profile[])
      it(`${preset.id}: ida y regreso independientes y óptimos (${profile})`, () => {
        const target = presetPoint(network, preset),
          options = { ...DEFAULT_OPTIONS, profile, incidents: osm };
        const outbound = finalSnapshot(
            regionalTrace(network, origin.nodeId, target.nodeId, options),
          ),
          back = finalSnapshot(
            regionalTrace(network, target.nodeId, origin.nodeId, options),
          );
        for (const [start, goal, state] of [
          [origin.nodeId, target.nodeId, outbound],
          [target.nodeId, origin.nodeId, back],
        ] as const) {
          expect(state.status).toBe("found");
          expect(state.records[state.path.at(-1)!].g).toBeCloseTo(
            independentDijkstra(regionalProblem(network, start, goal, options)),
            6,
          );
          expect(
            routeFeature(network.graph, state)!.geometry.coordinates[0],
          ).toEqual(network.graph.nodes[start].coordinate);
          expect(
            routeFeature(network.graph, state)!.geometry.coordinates.at(-1),
          ).toEqual(network.graph.nodes[goal].coordinate);
          const info = routeMetrics(network, state, options)!;
          expect(info.distance).toBeCloseTo(
            lineLength(
              routeFeature(network.graph, state)!.geometry.coordinates as [
                number,
                number,
              ][],
            ),
            6,
          );
        }
        expect(back.path.map(stateNode)).not.toEqual(
          [...outbound.path.map(stateNode)].reverse(),
        );
      });
  it("un solo sentido impide el sentido inverso; oneway=no mantiene ambas aristas", () => {
    const net = regionalNetwork(fixture);
    const a = Object.values(net.graph.edges).find((e) => e.wayId === 10)!;
    expect(
      Object.values(net.graph.edges).filter((e) => e.wayId === 10),
    ).toHaveLength(1);
    expect(a.from).toBe("1");
    expect(a.to).toBe("2");
    expect(
      finalSnapshot(regionalTrace(net, "2", "1", DEFAULT_OPTIONS)).pathEdges,
    ).not.toContain(a.id);
    const bidirectional = regionalNetwork({
      ...fixture,
      elements: fixture.elements.map((e) =>
        e.type === "way" && e.id === 10
          ? { ...e, tags: { ...e.tags, oneway: "no" } }
          : e,
      ),
    });
    expect(
      Object.values(bidirectional.graph.edges).filter((e) => e.wayId === 10),
    ).toHaveLength(2);
  });
  it("respeta precedencia de acceso, prohibiciones direccionales y condiciones no evaluadas", () => {
    for (const tags of [
      { access: "no" },
      { motor_vehicle: "no" },
      { motorcycle: "private" },
      { "access:conditional": "no @ (Mo-Fr 08:00-18:00)" },
    ] as Record<string, string>[]) {
      const net = regionalNetwork({
        elements: [
          ...fixture.elements.filter((e) => e.type === "node"),
          w(50, [1, 2, 3], tags),
        ],
      });
      expect(Object.keys(net.graph.edges)).toHaveLength(0);
    }
    const explicit = regionalNetwork({
      elements: [
        ...fixture.elements.filter((e) => e.type === "node"),
        w(50, [1, 2, 3], {
          access: "no",
          motorcycle: "yes",
          "motorcycle:backward": "no",
        }),
      ],
    });
    expect(
      Object.values(explicit.graph.edges).every((e) => e.id.endsWith(":f")),
    ).toBe(true);
  });
  it("las restricciones via nodo requieren recordar la arista de llegada", () => {
    const relation: OSMElement = {
      type: "relation",
      id: 100,
      tags: { type: "restriction", restriction: "no_straight_on" },
      members: [
        { type: "way", ref: 10, role: "from" },
        { type: "node", ref: 2, role: "via" },
        { type: "way", ref: 11, role: "to" },
      ],
    };
    const net = regionalNetwork({
      ...fixture,
      elements: [...fixture.elements, relation],
    });
    const state = finalSnapshot(regionalTrace(net, "1", "3", DEFAULT_OPTIONS));
    const from = Object.values(net.graph.edges).find((e) => e.wayId === 10)!,
      to = Object.values(net.graph.edges).find((e) => e.wayId === 11)!;
    expect(turnAllowed(net, from, to)).toBe(false);
    expect(state.pathEdges).not.toEqual([from.id, to.id]);
    expect(state.status).toBe("found");
    expect(state.path.every((id) => id.includes("@"))).toBe(true);
  });
  it("respeta only_ y except=motorcycle; no convierte turn:lanes en una prohibición global", () => {
    const rel: OSMElement = {
      type: "relation",
      id: 100,
      tags: { type: "restriction", restriction: "only_straight_on" },
      members: [
        { type: "way", ref: 10, role: "from" },
        { type: "node", ref: 2, role: "via" },
        { type: "way", ref: 11, role: "to" },
      ],
    };
    const net = regionalNetwork({
      ...fixture,
      elements: [...fixture.elements, rel],
    });
    const from = Object.values(net.graph.edges).find((e) => e.wayId === 10)!,
      to = Object.values(net.graph.edges).find(
        (e) => e.wayId === 13 && e.from === "2",
      )!;
    expect(turnAllowed(net, from, to)).toBe(false);
    expect(
      regionalNetwork({
        ...fixture,
        elements: [
          ...fixture.elements,
          { ...rel, tags: { ...rel.tags, except: "motorcycle" } },
        ],
      }).turns,
    ).toHaveLength(0);
  });
  it("restricciones via-way no interpretadas se identifican y excluyen conservadoramente", () => {
    const net = regionalNetwork({
      ...fixture,
      elements: [
        ...fixture.elements,
        {
          type: "relation",
          id: 999,
          tags: { type: "restriction", restriction: "no_left_turn" },
          members: [
            { type: "way", ref: 10, role: "from" },
            { type: "way", ref: 13, role: "via" },
            { type: "way", ref: 11, role: "to" },
          ],
        },
      ],
    });
    expect(net.stats.unsupportedTurns).toBe(1);
    expect(Object.values(net.graph.edges).some((e) => e.wayId === 10)).toBe(
      false,
    );
  });
  it("los perfiles minimizan magnitudes distintas con costos no negativos", () => {
    const net = regionalNetwork(fixture),
      short = finalSnapshot(regionalTrace(net, "1", "3", DEFAULT_OPTIONS)),
      fast = finalSnapshot(
        regionalTrace(net, "1", "3", {
          ...DEFAULT_OPTIONS,
          profile: "fastest",
        }),
      );
    expect(short.pathEdges).not.toEqual(fast.pathEdges);
    expect(routeMetrics(net, short, DEFAULT_OPTIONS)!.distance).toBeLessThan(
      routeMetrics(net, fast, DEFAULT_OPTIONS)!.distance,
    );
    for (const e of Object.values(net.graph.edges))
      expect(edgeSeconds(e)).toBeGreaterThan(0);
  });
  it("maxspeed con mph se convierte; valores desconocidos son estimaciones explícitas", () => {
    const e = Object.values(network.graph.edges)[0];
    expect(edgeSpeed({ ...e, tags: { maxspeed: "30 mph" } })).toEqual({
      kph: 48.28032,
      estimated: false,
    });
    expect(
      edgeSpeed({ ...e, tags: { highway: "service", maxspeed: "signals" } }),
    ).toEqual({ kph: 15, estimated: true });
  });
  it("baches reportados penalizan riesgo, no inventan baches OSM ni cambian distancia", () => {
    const net = regionalNetwork(fixture),
      normal = finalSnapshot(regionalTrace(net, "1", "3", DEFAULT_OPTIONS)),
      edge = net.graph.edges[normal.pathEdges[0]],
      incident = report(edge.physicalId),
      risk = finalSnapshot(
        regionalTrace(net, "1", "3", {
          ...DEFAULT_OPTIONS,
          profile: "risk",
          incidents: [incident],
        }),
      );
    expect(risk.pathEdges).not.toEqual(normal.pathEdges);
    expect(
      finalSnapshot(
        regionalTrace(net, "1", "3", {
          ...DEFAULT_OPTIONS,
          incidents: [incident],
        }),
      ).pathEdges,
    ).toEqual(normal.pathEdges);
    expect(
      osm.every((i) => i.kind !== "Bache pequeño" && i.kind !== "Bache grande"),
    ).toBe(true);
    expect(incidentWeights([incident]).penalties.get(edge.physicalId)).toBe(6);
  });
  it("cierres y reportes de calle cerrada excluyen físicamente sus dos direcciones", () => {
    const net = regionalNetwork(fixture),
      state = finalSnapshot(regionalTrace(net, "1", "3", DEFAULT_OPTIONS)),
      closed = net.graph.edges[state.pathEdges[0]].physicalId;
    const options = { ...DEFAULT_OPTIONS, blocked: [closed] };
    expect(
      finalSnapshot(regionalTrace(net, "1", "3", options)).pathEdges.every(
        (id) => net.graph.edges[id].physicalId !== closed,
      ),
    ).toBe(true);
    const incident = { ...report(closed), kind: "Calle cerrada" as const };
    expect(incidentWeights([incident]).closed.has(closed)).toBe(true);
  });
  it("heurísticas de los tres perfiles son consistentes sobre cada transición dirigida", () => {
    for (const profile of ["shortest", "fastest", "risk"] as Profile[]) {
      const problem = regionalProblem(
        network,
        origin.nodeId,
        PRESETS[1].roadNode,
        { ...DEFAULT_OPTIONS, profile, incidents: osm },
      );
      for (const edge of Object.values(network.graph.edges)) {
        const id = `${edge.to}@${edge.id}`;
        for (const arc of problem.neighbors(id))
          if (!arc.blocked)
            expect(problem.heuristic(id)).toBeLessThanOrEqual(
              arc.cost + problem.heuristic(arc.id) + 1e-6,
            );
      }
    }
  });
  it("recalcula desde la posición exacta sobre el tramo y conserva sus sentidos", () => {
    const options = { ...DEFAULT_OPTIONS },
      state = finalSnapshot(
        regionalTrace(network, origin.nodeId, PRESETS[1].roadNode, options),
      ),
      first = network.graph.edges[state.pathEdges[0]],
      traveled = first.cost * 0.4,
      located = rerouteFromPosition(network, state, traveled, options);
    const snapshot = finalSnapshot(
      regionalTrace(located.network, located.start, PRESETS[1].roadNode, {
        ...options,
        initialIncoming: located.initialIncoming,
      }),
    );
    expect(snapshot.status).toBe("found");
    const line = routeFeature(located.network.graph, snapshot)!.geometry
      .coordinates;
    expect(line[0]).toEqual(located.coordinate);
    expect(distance(origin.coordinate, located.coordinate)).toBeGreaterThan(0);
    expect(located.network.graph.outgoing[located.start]).toHaveLength(1);
    expect(
      located.network.graph.edges[
        located.network.graph.outgoing[located.start][0]
      ].to,
    ).toBe(first.to);
  });
  it("si se cierra el tramo ocupado no inventa un giro ni teletransporta a la moto", () => {
    const state = finalSnapshot(
        regionalTrace(
          network,
          origin.nodeId,
          PRESETS[1].roadNode,
          DEFAULT_OPTIONS,
        ),
      ),
      edge = network.graph.edges[state.pathEdges[0]],
      options = { ...DEFAULT_OPTIONS, blocked: [edge.physicalId] },
      located = rerouteFromPosition(network, state, edge.cost / 2, options),
      next = finalSnapshot(
        regionalTrace(
          located.network,
          located.start,
          PRESETS[1].roadNode,
          options,
        ),
      );
    expect(next.status).toBe("unreachable");
    expect(routeFeature(located.network.graph, next)).toBeNull();
  });
  it("el índice espacial encuentra vías y rechaza ajustes a través de la laguna", () => {
    const index = new RoadIndex(network.graph),
      near = index.nearestRoad(origin.coordinate)!;
    expect(near.distance).toBeLessThan(1);
    expect(index.nearestRoad([-88.375, 18.675], 30)).toBeNull();
    expect(index.nearestNode(origin.coordinate, "origin")?.id).toBe(
      origin.nodeId,
    );
  });
  it("sin datos verificados suficientes informa una búsqueda sin ruta, no legalidad inventada", () => {
    const result = finalSnapshot(
      regionalTrace(network, origin.nodeId, PRESETS[1].roadNode, {
        ...DEFAULT_OPTIONS,
        allowUnknown: false,
      }),
    );
    expect(result.status).toBe("unreachable");
    expect(result.open).toEqual([]);
  });
  it("heap y traza compacta admiten miles de estados con retroceso correcto", () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    [8, 3, 1, 7, 1, 9].forEach((n) => heap.push(n));
    expect(Array.from({ length: 6 }, () => heap.pop())).toEqual([
      1, 1, 3, 7, 8, 9,
    ]);
    const count = 8000,
      events = [
        ...iterateSearch({
          start: "0",
          goal: String(count),
          heuristic: (id) => count - Number(id),
          neighbors: (id) =>
            Number(id) < count ? [{ id: String(Number(id) + 1), cost: 1 }] : [],
        }),
      ];
    expect(events).toHaveLength(count + 2);
    expect(events.reduce((n, e) => n + e.updates.length, 0)).toBe(count + 1);
    const player = new TracePlayer(events);
    expect(player.at(events.length - 1).records[String(count)].g).toBe(count);
    const prior = player.at(20);
    player.at(100);
    expect(player.at(20)).toEqual(prior);
  });
});
describe("Persistencia de incidencias locales", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("conserva ubicación, severidad, fuente, fecha, verificación y notas", () => {
    const item = report("segment");
    saveIncidents([item]);
    expect(readIncidents()).toEqual([item]);
  });
  it("tolera datos corruptos sin inventar reportes", () => {
    localStorage.setItem("rutapizza-incidents-v1", "broken");
    expect(readIncidents()).toEqual([]);
  });
});
