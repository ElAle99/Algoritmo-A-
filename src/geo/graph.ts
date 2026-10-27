import { searchGraph, type Snapshot } from "../astar";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point as GeoPoint,
  Polygon,
} from "geojson";
export type Coordinate = [number, number];
export const BOUNDS = [18.669, -88.402, 18.685, -88.384] as const;
export type OSMElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  members?: { type: "node" | "way" | "relation"; ref: number; role: string }[];
};
export type OSMData = {
  elements: OSMElement[];
  osm3s?: { timestamp_osm_base?: string };
  remark?: string;
};
export type RoadNode = { id: string; coordinate: Coordinate; names: string[] };
export type RoadEdge = {
  id: string;
  physicalId: string;
  from: string;
  to: string;
  cost: number;
  coordinates: Coordinate[];
  name: string;
  wayId: number;
  tags?: Record<string, string>;
  directionKnown?: boolean;
  oneWay?: boolean;
};
export type RoadGraph = {
  nodes: Record<string, RoadNode>;
  edges: Record<string, RoadEdge>;
  outgoing: Record<string, string[]>;
  incoming: Record<string, string[]>;
};
export type Place = {
  id: string;
  name: string;
  category: string;
  coordinate: Coordinate;
  custom?: boolean;
  tags: Record<string, string>;
};
export type SelectedPoint = {
  name: string;
  nodeId: string;
  coordinate: Coordinate;
  requested: Coordinate;
  snapDistance: number;
};
const RAD = Math.PI / 180;
export function distance(a: Coordinate, b: Coordinate): number {
  const dLat = (b[1] - a[1]) * RAD,
    dLon = (b[0] - a[0]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return (
    6371008.8 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)))
  );
}
export const lineLength = (coordinates: Coordinate[]) =>
  coordinates
    .slice(1)
    .reduce((sum, p, i) => sum + distance(coordinates[i], p), 0);
export function inside(p: Coordinate) {
  return (
    p[1] >= BOUNDS[0] &&
    p[0] >= BOUNDS[1] &&
    p[1] <= BOUNDS[2] &&
    p[0] <= BOUNDS[3]
  );
}
const supported = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
]);
function access(tags: Record<string, string>) {
  const value =
    tags.motorcycle ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access;
  return !["no", "private"].includes(value ?? "");
}
/** Connect only shared OSM node IDs. A geometric crossing alone is not a junction. */
export function buildGraph(
  data: OSMData,
  options?: {
    bounds?: readonly number[];
    anchors?: number[];
    regional?: boolean;
  },
): RoadGraph {
  const bounds = options?.bounds ?? BOUNDS;
  const raw = new Map<number, OSMElement>();
  for (const element of data.elements)
    if (element.type === "node") {
      const previous = raw.get(element.id);
      raw.set(element.id, {
        ...previous,
        ...element,
        tags: { ...previous?.tags, ...element.tags },
      });
    }
  const valid = (id: number) => {
    const n = raw.get(id);
    return (
      !!n &&
      n.lon !== undefined &&
      n.lat !== undefined &&
      n.lat >= bounds[0] &&
      n.lon >= bounds[1] &&
      n.lat <= bounds[2] &&
      n.lon <= bounds[3] &&
      access(n.tags ?? {}) &&
      !(
        options?.regional &&
        (n.tags?.locked === "yes" ||
          Object.keys(n.tags ?? {}).some((k) => k.endsWith(":conditional")))
      ) &&
      (!(
        n.tags?.barrier &&
        ["bollard", "block", "cycle_barrier"].includes(n.tags.barrier)
      ) ||
        n.tags.motorcycle === "yes")
    );
  };
  const runs: { way: OSMElement; ids: number[]; offset: number }[] = [];
  for (const way of data.elements) {
    if (
      way.type !== "way" ||
      !way.nodes ||
      !way.tags ||
      !(
        supported.has(way.tags.highway) ||
        (options?.regional && way.tags.highway === "track")
      ) ||
      !access(way.tags) ||
      (options?.regional &&
        Object.keys(way.tags).some((k) => k.endsWith(":conditional"))) ||
      way.tags.area === "yes"
    )
      continue;
    let ids: number[] = [],
      offset = 0;
    way.nodes.forEach((id, index) => {
      if (valid(id)) {
        if (!ids.length) offset = index;
        ids.push(id);
      } else {
        if (ids.length > 1) runs.push({ way, ids, offset });
        ids = [];
      }
    });
    if (ids.length > 1) runs.push({ way, ids, offset });
  }
  const uses = new Map<number, number>();
  for (const id of options?.anchors ?? []) uses.set(id, 2);
  for (const run of runs)
    for (const id of run.ids) uses.set(id, (uses.get(id) ?? 0) + 1);
  const graph: RoadGraph = { nodes: {}, edges: {}, outgoing: {}, incoming: {} };
  function node(id: number, name: string) {
    const key = String(id),
      rawNode = raw.get(id)!;
    if (!graph.nodes[key]) {
      graph.nodes[key] = {
        id: key,
        coordinate: [rawNode.lon!, rawNode.lat!],
        names: [],
      };
      graph.outgoing[key] = [];
      graph.incoming[key] = [];
    }
    if (!graph.nodes[key].names.includes(name))
      graph.nodes[key].names.push(name);
    return key;
  }
  for (const { way, ids, offset } of runs) {
    let begin = 0;
    for (let i = 1; i < ids.length; i++) {
      if (
        i !== ids.length - 1 &&
        (uses.get(ids[i]) ?? 0) < 2 &&
        !(ids[0] === ids.at(-1) && i === Math.floor(ids.length / 2))
      )
        continue;
      const name = way.tags?.name ?? "Calle sin nombre OSM",
        from = node(ids[begin], name),
        to = node(ids[i], name);
      const coordinates = ids
        .slice(begin, i + 1)
        .map((id) => [raw.get(id)!.lon!, raw.get(id)!.lat!] as Coordinate);
      const cost = lineLength(coordinates),
        physicalId = `w${way.id}:${offset + begin}-${offset + i}`;
      const oneway = way.tags?.["oneway:motorcycle"] ?? way.tags?.oneway;
      const forwardOnly =
        ["yes", "1", "true"].includes(oneway ?? "") ||
        (!oneway &&
          (way.tags?.junction === "roundabout" ||
            way.tags?.highway === "motorway"));
      function edge(reverse: boolean) {
        const id = `${physicalId}:${reverse ? "r" : "f"}`;
        const edge: RoadEdge = {
          id,
          physicalId,
          from: reverse ? to : from,
          to: reverse ? from : to,
          cost,
          coordinates: reverse ? [...coordinates].reverse() : coordinates,
          name,
          wayId: way.id,
          ...(options?.regional
            ? {
                tags: way.tags,
                directionKnown:
                  !!oneway ||
                  way.tags?.junction === "roundabout" ||
                  way.tags?.highway === "motorway",
                oneWay: oneway === "-1" || forwardOnly,
              }
            : {}),
        };
        if (options?.regional) {
          const direction = reverse ? "backward" : "forward";
          const value =
            way.tags?.[`motorcycle:${direction}`] ??
            way.tags?.[`motor_vehicle:${direction}`] ??
            way.tags?.[`vehicle:${direction}`] ??
            way.tags?.[`access:${direction}`];
          if (
            value &&
            ["no", "private", "agricultural", "forestry"].includes(value)
          )
            return;
        }
        graph.edges[id] = edge;
        graph.outgoing[edge.from].push(id);
        graph.incoming[edge.to].push(id);
      }
      if (cost > 0 && from !== to) {
        if (oneway !== "-1") edge(false);
        if (!forwardOnly) edge(true);
      }
      begin = i;
    }
  }
  for (const id of Object.keys(graph.nodes)) {
    if (!graph.outgoing[id].length && !graph.incoming[id].length) {
      delete graph.nodes[id];
      delete graph.outgoing[id];
      delete graph.incoming[id];
    } else {
      graph.outgoing[id].sort();
      graph.incoming[id].sort();
    }
  }
  return graph;
}
export function searchRoads(
  graph: RoadGraph,
  start: string,
  goal: string,
  blocked: ReadonlySet<string> = new Set(),
): Snapshot[] {
  if (!graph.nodes[start] || !graph.nodes[goal])
    throw Error("Selecciona dos nodos válidos");
  return searchGraph({
    start,
    goal,
    heuristic: (id) =>
      distance(graph.nodes[id].coordinate, graph.nodes[goal].coordinate),
    neighbors: (id) =>
      graph.outgoing[id].map((edgeId) => {
        const e = graph.edges[edgeId];
        return {
          id: e.to,
          cost: e.cost,
          edgeId,
          blocked: blocked.has(e.physicalId),
        };
      }),
  });
}
export function snapPoint(
  graph: RoadGraph,
  requested: Coordinate,
  role: "origin" | "destination" = "destination",
  maxDistance = 200,
): SelectedPoint | null {
  let best: RoadNode | undefined,
    meters = Infinity;
  for (const node of Object.values(graph.nodes)) {
    if (
      !(role === "origin" ? graph.outgoing[node.id] : graph.incoming[node.id])
        .length
    )
      continue;
    const d = distance(requested, node.coordinate);
    if (d < meters || (d === meters && node.id < (best?.id ?? ""))) {
      best = node;
      meters = d;
    }
  }
  return best && meters <= maxDistance
    ? {
        name: best.names[0],
        nodeId: best.id,
        coordinate: best.coordinate,
        requested,
        snapDistance: meters,
      }
    : null;
}
export function routeFeature(
  graph: RoadGraph,
  state: Snapshot,
): Feature<LineString> | null {
  if (state.status !== "found") return null;
  const coordinates: Coordinate[] = [];
  state.pathEdges.forEach((id, i) => {
    const edge = graph.edges[id];
    if (
      !edge ||
      edge.from !== state.path[i].split("@")[0] ||
      edge.to !== state.path[i + 1].split("@")[0]
    )
      throw Error("La geometría no corresponde al camino A*");
    coordinates.push(...(i ? edge.coordinates.slice(1) : edge.coordinates));
  });
  if (!coordinates.length) {
    const p = graph.nodes[state.path[0].split("@")[0]].coordinate;
    coordinates.push(p, p);
  }
  return {
    type: "Feature",
    properties: {
      nodeIds: state.path.map((id) => id.split("@")[0]),
      stateIds: state.path,
      edgeIds: state.pathEdges,
      cost: state.records[state.path.at(-1)!].g,
    },
    geometry: { type: "LineString", coordinates },
  };
}
export function roadsGeoJSON(
  graph: RoadGraph,
  blocked: ReadonlySet<string> = new Set(),
): FeatureCollection<LineString> {
  const seen = new Set<string>();
  return {
    type: "FeatureCollection",
    features: Object.values(graph.edges)
      .filter((e) => {
        if (seen.has(e.physicalId)) return false;
        seen.add(e.physicalId);
        return true;
      })
      .map((e) => ({
        type: "Feature",
        id: e.physicalId,
        properties: {
          id: e.physicalId,
          name: e.name,
          blocked: blocked.has(e.physicalId),
          oneWay: e.oneWay ?? false,
          directionKnown: e.directionKnown ?? true,
        },
        geometry: { type: "LineString", coordinates: e.coordinates },
      })),
  };
}
export function explorationGeoJSON(
  graph: RoadGraph,
  state: Snapshot,
): FeatureCollection<GeoPoint> {
  const closed = new Set(state.closed.map((id) => id.split("@")[0])),
    open = new Set(state.open.map((n) => n.id.split("@")[0]));
  return {
    type: "FeatureCollection",
    features: Object.values(graph.nodes).map((n) => ({
      type: "Feature",
      id: n.id,
      properties: {
        id: n.id,
        status:
          n.id === state.current?.split("@")[0]
            ? "current"
            : open.has(n.id)
              ? "open"
              : closed.has(n.id)
                ? "closed"
                : "idle",
      },
      geometry: { type: "Point", coordinates: n.coordinate },
    })),
  };
}
export function examinedGeoJSON(
  graph: RoadGraph,
  state: Snapshot,
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: state.decisions
      .filter((d) => d.edgeId)
      .map((d) => ({
        type: "Feature",
        properties: { kind: d.kind },
        geometry: {
          type: "LineString",
          coordinates: graph.edges[d.edgeId!].coordinates,
        },
      })),
  };
}
export function extractPlaces(
  data: OSMData,
  bounds: readonly number[] = BOUNDS,
): Place[] {
  const places = new Map<string, Place>();
  const nodes = new Map(
    data.elements.filter((e) => e.type === "node").map((e) => [e.id, e]),
  );
  for (const e of data.elements) {
    const tags = e.tags ?? {};
    const points = (e.nodes ?? [])
      .map((id) => nodes.get(id))
      .filter(
        (n): n is OSMElement => n?.lon !== undefined && n.lat !== undefined,
      );
    const lon =
        e.lon ??
        e.center?.lon ??
        (points.length
          ? points.reduce((s, n) => s + n.lon!, 0) / points.length
          : undefined),
      lat =
        e.lat ??
        e.center?.lat ??
        (points.length
          ? points.reduce((s, n) => s + n.lat!, 0) / points.length
          : undefined);
    if (
      lon === undefined ||
      lat === undefined ||
      !(
        lat >= bounds[0] &&
        lon >= bounds[1] &&
        lat <= bounds[2] &&
        lon <= bounds[3]
      ) ||
      !(tags.amenity || tags.shop || tags.tourism || tags.leisure === "park")
    )
      continue;
    const category = (tags.cuisine ?? "").split(/[;,\s_]+/).includes("pizza")
      ? "Pizzería"
      : ({
          restaurant: "Restaurante",
          cafe: "Cafetería",
          pharmacy: "Farmacia",
          school: "Escuela",
          supermarket: "Supermercado",
          hotel: "Hotel",
          hostel: "Hostal",
          park: "Parque",
        }[tags.amenity ?? tags.shop ?? tags.tourism ?? tags.leisure] ??
        (tags.shop
          ? "Tienda"
          : tags.tourism
            ? "Alojamiento"
            : "Lugar de interés"));
    const id = `${e.type}/${e.id}`;
    places.set(id, {
      id,
      name: tags.name ?? `${category} sin nombre OSM`,
      category,
      coordinate: [lon, lat],
      tags,
    });
  }
  return [...places.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function contextGeoJSON(data: OSMData): FeatureCollection<Polygon> {
  const nodes = new Map(
    data.elements.filter((e) => e.type === "node").map((e) => [e.id, e]),
  );
  return {
    type: "FeatureCollection",
    features: data.elements
      .filter(
        (e) =>
          e.type === "way" &&
          e.nodes &&
          e.nodes[0] === e.nodes.at(-1) &&
          (e.tags?.building || e.tags?.leisure === "park"),
      )
      .flatMap((e) => {
        const coords = e
          .nodes!.map((id) => nodes.get(id))
          .filter(
            (n): n is OSMElement => n?.lon !== undefined && n.lat !== undefined,
          )
          .map((n) => [n.lon!, n.lat!] as Coordinate);
        return coords.length === e.nodes!.length && coords.length >= 4
          ? [
              {
                type: "Feature" as const,
                properties: {
                  kind: e.tags?.leisure === "park" ? "park" : "building",
                },
                geometry: { type: "Polygon" as const, coordinates: [coords] },
              },
            ]
          : [];
      }),
  };
}
export function interpolateRoute(
  coordinates: Coordinate[],
  meters: number,
): { coordinate: Coordinate; bearing: number } {
  let left = Math.max(0, meters);
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1],
      b = coordinates[i],
      length = distance(a, b);
    if (left <= length || i === coordinates.length - 1) {
      const t = length ? Math.min(1, left / length) : 0;
      const lat1 = a[1] * RAD,
        lat2 = b[1] * RAD,
        dLon = (b[0] - a[0]) * RAD;
      const bearing =
        Math.atan2(
          Math.sin(dLon) * Math.cos(lat2),
          Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
        ) / RAD;
      return {
        coordinate: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        bearing,
      };
    }
    left -= length;
  }
  return { coordinate: coordinates[0], bearing: 0 };
}
/** Scenarios reuse a fixed route; close a physical segment in both directions. */
export function demoClosures(
  graph: RoadGraph,
  start: string,
  goal: string,
  scenario: number,
): Set<string> {
  if (scenario === 3)
    return new Set(
      graph.incoming[goal].map((id) => graph.edges[id].physicalId),
    );
  if (scenario !== 2) return new Set();
  const normal = searchRoads(graph, start, goal).at(-1)!;
  for (const id of normal.pathEdges
    .slice(1)
    .concat(normal.pathEdges.slice(0, 1))) {
    const blocked = new Set([graph.edges[id].physicalId]);
    if (searchRoads(graph, start, goal, blocked).at(-1)!.status === "found")
      return blocked;
  }
  return new Set();
}
