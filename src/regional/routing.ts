import {
  iterateSearch,
  TracePlayer,
  type SearchEvent,
  type Snapshot,
  type SearchProblem,
} from "../astar";
import {
  distance,
  lineLength,
  routeFeature,
  type Coordinate,
  type RoadEdge,
} from "../geo/graph";
import {
  stateNode,
  turnAllowed,
  accessValue,
  type RegionalNetwork,
} from "./network";
import { incidentWeights, type Incident } from "./incidents";
export type Profile = "shortest" | "fastest" | "risk";
export type RouteOptions = {
  profile: Profile;
  blocked: string[];
  incidents: Incident[];
  riskFactor: number;
  includeUnverified: boolean;
  allowUnknown: boolean;
  initialIncoming?: string;
};
export const DEFAULT_OPTIONS: RouteOptions = {
  profile: "shortest",
  blocked: [],
  incidents: [],
  riskFactor: 1,
  includeUnverified: true,
  allowUnknown: true,
};
export const PROFILE_LABELS: Record<Profile, string> = {
  shortest: "Más corta · metros",
  fastest: "Más rápida estimada · segundos",
  risk: "Menor riesgo conocido · metros ponderados",
};
const estimates: Record<string, number> = {
  motorway: 90,
  trunk: 70,
  primary: 50,
  secondary: 40,
  tertiary: 35,
  residential: 25,
  unclassified: 25,
  service: 15,
  living_street: 10,
  track: 10,
  road: 20,
};
export function edgeSpeed(edge: RoadEdge) {
  const direction = edge.id.endsWith(":r") ? "backward" : "forward";
  const tag = edge.tags?.[`maxspeed:${direction}`] ?? edge.tags?.maxspeed;
  const match = tag?.trim().match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kph)?$/i);
  if (match && Number(match[1]) > 0)
    return {
      kph:
        Number(match[1]) * (match[2]?.toLowerCase() === "mph" ? 1.609344 : 1),
      estimated: false,
    };
  return {
    kph: estimates[edge.tags?.highway ?? "road"] ?? 20,
    estimated: true,
  };
}
export const edgeSeconds = (e: RoadEdge) => e.cost / (edgeSpeed(e).kph / 3.6);
export function destinationAccess(
  network: RegionalNetwork,
  start: string,
  goal: string,
) {
  const allowed = new Set<string>(),
    queue = [start, goal].filter((node) =>
      [...network.graph.outgoing[node], ...network.graph.incoming[node]].every(
        (id) =>
          ["destination", "customers"].includes(
            accessValue(network.graph.edges[id]) ?? "",
          ),
      ),
    ),
    seen = new Set<string>();
  while (queue.length) {
    const node = queue.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const id of [
      ...network.graph.outgoing[node],
      ...network.graph.incoming[node],
    ]) {
      const e = network.graph.edges[id];
      if (!["destination", "customers"].includes(accessValue(e) ?? ""))
        continue;
      allowed.add(e.physicalId);
      queue.push(e.from, e.to);
    }
  }
  return allowed;
}
/** Edge-context states are necessary: an intersection alone cannot encode turn restrictions. */
export function regionalProblem(
  network: RegionalNetwork,
  start: string,
  goal: string,
  options: RouteOptions,
): SearchProblem {
  const graph = network.graph;
  if (!graph.nodes[start] || !graph.nodes[goal])
    throw Error("Extremo fuera de la red vial");
  if (!Number.isFinite(options.riskFactor) || options.riskFactor < 0)
    throw Error("La penalización debe ser finita y no negativa");
  const weights = incidentWeights(options.incidents, options.includeUnverified),
    blocked = new Set([...options.blocked, ...weights.closed]),
    access = destinationAccess(network, start, goal);
  const maximumSpeed = Math.max(
    1,
    ...Object.values(graph.edges).map((e) => edgeSpeed(e).kph / 3.6),
  );
  return {
    start: `${start}@${options.initialIncoming ?? ""}`,
    goal,
    isGoal: (id) => stateNode(id) === goal,
    heuristic: (id) => {
      const h = distance(
        graph.nodes[stateNode(id)].coordinate,
        graph.nodes[goal].coordinate,
      );
      return options.profile === "fastest" ? h / maximumSpeed : h;
    },
    neighbors: (id) => {
      const node = stateNode(id),
        incomingId = id.slice(id.indexOf("@") + 1),
        incoming = graph.edges[incomingId];
      return graph.outgoing[node].map((edgeId) => {
        const e = graph.edges[edgeId],
          accessTag = accessValue(e);
        const isBlocked =
          blocked.has(e.physicalId) ||
          !turnAllowed(network, incoming, e) ||
          (!options.allowUnknown &&
            (!e.directionKnown || accessTag === undefined)) ||
          (["destination", "customers"].includes(accessTag ?? "") &&
            !access.has(e.physicalId));
        const cost =
          options.profile === "fastest"
            ? edgeSeconds(e)
            : options.profile === "risk"
              ? e.cost *
                (1 +
                  options.riskFactor *
                    (weights.penalties.get(e.physicalId) ?? 0))
              : e.cost;
        return {
          id: `${e.to}@${e.id}`,
          edgeId: e.id,
          cost,
          blocked: isBlocked,
        };
      });
    },
  };
}
export function regionalTrace(
  network: RegionalNetwork,
  start: string,
  goal: string,
  options: RouteOptions,
) {
  return [...iterateSearch(regionalProblem(network, start, goal, options))];
}
export function finalSnapshot(events: SearchEvent[]) {
  return new TracePlayer(events).at(events.length - 1);
}
export function routeMetrics(
  network: RegionalNetwork,
  state: Snapshot,
  options: RouteOptions,
) {
  if (state.status !== "found") return null;
  const edges = state.pathEdges.map((id) => network.graph.edges[id]);
  return {
    distance: edges.reduce((s, e) => s + e.cost, 0),
    seconds: edges.reduce((s, e) => s + edgeSeconds(e), 0),
    cost: state.records[state.path.at(-1)!].g,
    estimatedSpeedEdges: edges.filter((e) => edgeSpeed(e).estimated).length,
    unknownDirection: edges.filter((e) => !e.directionKnown).length,
    unknownAccess: edges.filter((e) => accessValue(e) === undefined).length,
    explored: state.closed.length,
    profile: options.profile,
    edgeIds: state.pathEdges,
  };
}
/** Stops at an exact point on the current directed edge; no teleport to an intersection. */
export function rerouteFromPosition(
  network: RegionalNetwork,
  state: Snapshot,
  traveled: number,
  options: RouteOptions,
) {
  const graph = network.graph,
    route = routeFeature(graph, state);
  if (!route) throw Error("No hay un recorrido activo");
  let remaining = Math.max(0, traveled),
    edge = graph.edges[state.pathEdges[0]],
    prefix = 0,
    passedIncoming = options.initialIncoming;
  for (const id of state.pathEdges) {
    const candidate = graph.edges[id];
    edge = candidate;
    if (remaining <= candidate.cost) break;
    remaining -= candidate.cost;
    prefix += candidate.cost;
    passedIncoming = candidate.id;
  }
  if (!edge) {
    const id = stateNode(state.path.at(-1)!);
    return {
      network,
      start: id,
      coordinate: graph.nodes[id].coordinate,
      traveled: 0,
      initialIncoming: undefined,
    };
  }
  if (remaining <= 1e-6)
    return {
      network,
      start: edge.from,
      coordinate: graph.nodes[edge.from].coordinate,
      traveled: prefix,
      initialIncoming: passedIncoming,
    };
  let left = remaining,
    index = 1;
  const coordinates = edge.coordinates;
  for (; index < coordinates.length; index++) {
    const length = distance(coordinates[index - 1], coordinates[index]);
    if (left <= length) break;
    left -= length;
  }
  index = Math.min(index, coordinates.length - 1);
  const a = coordinates[index - 1],
    b = coordinates[index],
    length = distance(a, b),
    t = length ? Math.min(1, left / length) : 0,
    coordinate: Coordinate = [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ];
  if (remaining >= edge.cost - 1e-6)
    return {
      network,
      start: edge.to,
      coordinate: graph.nodes[edge.to].coordinate,
      traveled: prefix + edge.cost,
      initialIncoming: edge.id,
    };
  const start = "vehicle-position",
    id = `position:${edge.id}`,
    part = [coordinate, ...coordinates.slice(index)];
  const residual: RoadEdge = {
    ...edge,
    id,
    from: start,
    cost: lineLength(part),
    coordinates: part,
  };
  const next: RegionalNetwork = {
    ...network,
    graph: {
      ...graph,
      nodes: {
        ...graph.nodes,
        [start]: { id: start, coordinate, names: ["Posición vial actual"] },
      },
      edges: { ...graph.edges, [id]: residual },
      outgoing: { ...graph.outgoing, [start]: [id] },
      incoming: { ...graph.incoming, [start]: [] },
    },
  };
  // A closure of the occupied segment deliberately leaves no legal continuation in this model.
  // We do not invent a U-turn or a connection across the sidewalk.
  void options;
  return {
    network: next,
    start,
    coordinate,
    traveled: prefix + remaining,
    initialIncoming: undefined,
  };
}
