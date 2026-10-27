import {
  buildGraph,
  distance,
  extractPlaces,
  type Coordinate,
  type OSMData,
  type RoadEdge,
  type RoadGraph,
  type SelectedPoint,
  type Place,
} from "../geo/graph";
export const REGIONAL_BOUNDS = [18.63, -88.44, 18.725, -88.365] as const;
export type TurnRule = {
  id: number;
  fromWay: number;
  toWay: number;
  viaNode: string;
  kind: string;
};
export type RegionalNetwork = {
  graph: RoadGraph;
  turns: TurnRule[];
  limitations: string[];
  bounds: number[];
  stats: {
    nodes: number;
    arcs: number;
    segments: number;
    kilometers: number;
    unknownDirection: number;
    unknownAccess: number;
    conditionalWaysExcluded: number;
    turns: number;
    unsupportedTurns: number;
  };
};
export const stateNode = (id: string) => id.split("@")[0];
export const accessValue = (e: RoadEdge) =>
  e.tags?.motorcycle ??
  e.tags?.motor_vehicle ??
  e.tags?.vehicle ??
  e.tags?.access;
export function regionalNetwork(data: OSMData): RegionalNetwork {
  const excluded = new Set(
    data.elements
      .filter(
        (e) =>
          e.type === "way" &&
          e.tags?.highway &&
          (["agricultural", "forestry", "use_sidepath", "dismount"].includes(
            e.tags.motorcycle ??
              e.tags.motor_vehicle ??
              e.tags.vehicle ??
              e.tags.access ??
              "",
          ) ||
            Object.keys(e.tags).some((k) => k.endsWith(":conditional")) ||
            e.tags.smoothness === "impassable" ||
            !!(
              (e.tags["oneway:motorcycle"] ?? e.tags.oneway) &&
              !["yes", "no", "1", "0", "true", "false", "-1"].includes(
                e.tags["oneway:motorcycle"] ?? e.tags.oneway,
              )
            )),
      )
      .map((e) => e.id),
  );
  const graph = buildGraph(
    {
      ...data,
      elements: data.elements.filter(
        (e) => e.type !== "way" || !excluded.has(e.id),
      ),
    },
    {
      bounds: REGIONAL_BOUNDS,
      regional: true,
      anchors: [
        8204984607,
        7262028817,
        3744961664,
        3744961933,
        3744961830,
        9336022209,
        ...data.elements
          .filter((e) => e.type === "relation")
          .flatMap((e) =>
            (e.members ?? [])
              .filter((m) => m.role === "via" && m.type === "node")
              .map((m) => m.ref),
          ),
      ],
    },
  );
  const turns: TurnRule[] = [],
    limitations: string[] = [];
  let unsupportedTurns = 0;
  for (const r of data.elements) {
    if (r.type !== "relation" || r.tags?.type !== "restriction") continue;
    if (
      (r.tags.except ?? "")
        .split(";")
        .some((s) =>
          ["motorcycle", "motor_vehicle", "vehicle"].includes(s.trim()),
        )
    )
      continue;
    const kind =
      r.tags["restriction:motorcycle"] ??
      r.tags["restriction:motor_vehicle"] ??
      r.tags.restriction;
    const from = r.members?.filter(
        (m) => m.role === "from" && m.type === "way",
      ),
      to = r.members?.filter((m) => m.role === "to" && m.type === "way"),
      via = r.members?.filter((m) => m.role === "via");
    if (
      !kind ||
      (!kind.startsWith("no_") && !kind.startsWith("only_")) ||
      from?.length !== 1 ||
      to?.length !== 1 ||
      via?.length !== 1 ||
      via[0].type !== "node" ||
      Object.keys(r.tags).some((k) => k.endsWith(":conditional"))
    ) {
      unsupportedTurns++;
      limitations.push(
        `Restricción OSM ${r.id}: estructura o condición no soportada; se excluyen las vías from afectadas.`,
      );
      for (const m of from ?? [])
        for (const e of Object.values(graph.edges))
          if (e.wayId === m.ref) {
            delete graph.edges[e.id];
            graph.outgoing[e.from] = graph.outgoing[e.from].filter(
              (id) => id !== e.id,
            );
            graph.incoming[e.to] = graph.incoming[e.to].filter(
              (id) => id !== e.id,
            );
          }
      continue;
    }
    turns.push({
      id: r.id,
      fromWay: from[0].ref,
      toWay: to[0].ref,
      viaNode: String(via[0].ref),
      kind,
    });
  }
  const physical = [
    ...new Map(
      Object.values(graph.edges).map((e) => [e.physicalId, e]),
    ).values(),
  ];
  const coords = Object.values(graph.nodes).map((n) => n.coordinate);
  const bounds = coords.length
    ? [
        Math.min(...coords.map((p) => p[1])),
        Math.min(...coords.map((p) => p[0])),
        Math.max(...coords.map((p) => p[1])),
        Math.max(...coords.map((p) => p[0])),
      ]
    : [...REGIONAL_BOUNDS];
  limitations.push(
    "La ausencia de oneway o access no verifica sentido, legalidad ni seguridad.",
    "turn:lanes describe carriles; se conserva y se muestra, no se convierte por sí solo en una prohibición de giro.",
    "Las condiciones de horario no se evalúan: las vías condicionales se excluyen de forma conservadora.",
  );
  return {
    graph,
    turns,
    limitations,
    bounds,
    stats: {
      nodes: coords.length,
      arcs: Object.keys(graph.edges).length,
      segments: physical.length,
      kilometers: physical.reduce((s, e) => s + e.cost, 0) / 1000,
      unknownDirection: physical.filter((e) => !e.directionKnown).length,
      unknownAccess: physical.filter((e) => accessValue(e) === undefined)
        .length,
      conditionalWaysExcluded: excluded.size,
      turns: turns.length,
      unsupportedTurns,
    },
  };
}
export function turnAllowed(
  network: RegionalNetwork,
  incoming: RoadEdge | undefined,
  outgoing: RoadEdge,
) {
  if (!incoming) return true;
  const rules = network.turns.filter(
    (r) => r.fromWay === incoming.wayId && r.viaNode === incoming.to,
  );
  const matches = (r: TurnRule) => {
    if (r.kind.endsWith("u_turn"))
      return outgoing.wayId === r.toWay && outgoing.to === incoming.from;
    if (r.kind.endsWith("straight_on") && r.fromWay === r.toWay)
      return outgoing.wayId === r.toWay && outgoing.to !== incoming.from;
    return outgoing.wayId === r.toWay;
  };
  const only = rules.filter((r) => r.kind.startsWith("only_"));
  return (
    (!only.length || only.some(matches)) &&
    rules.filter((r) => r.kind.startsWith("no_")).every((r) => !matches(r))
  );
}
export type Preset = {
  id: string;
  name: string;
  osmRef: string;
  coordinate: Coordinate;
  roadNode: string;
  note: string;
  sourceUrl: string;
};
export const PRESETS: Preset[] = [
  {
    id: "pizza",
    name: "Don Mostado Pizza",
    osmRef: "node/4348648594",
    coordinate: [-88.3923678, 18.6758227],
    roadNode: "3744961664",
    note: "Ruta hasta la intersección vial OSM cercana; últimos metros al local no modelados.",
    sourceUrl: "https://www.openstreetmap.org/node/4348648594",
  },
  {
    id: "upb",
    name: "Universidad Politécnica de Bacalar (UPB)",
    osmRef: "way/790801027",
    coordinate: [-88.4004077, 18.701881257142862],
    roadNode: "8204984607",
    note: "Terminal de la vía de servicio OSM 882282674 dentro del polígono universitario. Acceso actual no verificado. Dirección oficial: Av. 39, entre 56 y 46-A; el registro OSM conserva una dirección antigua 50–54 y un error en el nombre.",
    sourceUrl: "https://www.upb.edu.mx/",
  },
  {
    id: "cenote",
    name: "Cenote Azul",
    osmRef: "node/2580447954",
    coordinate: [-88.4129825, 18.6470061],
    roadNode: "7262028817",
    note: "Llegada al Boulevard Costera, junto a la conexión OSM de escaleras 778109571. No se entra en motocicleta al agua ni se recorren las escaleras; acceso final al recinto no verificado.",
    sourceUrl: "https://www.openstreetmap.org/node/2580447954",
  },
  {
    id: "centro",
    name: "Centro de Bacalar · Parque Principal",
    osmRef: "way/370821514",
    coordinate: [-88.3896907888889, 18.676981977777775],
    roadNode: "9336022209",
    note: "Elige el acceso exterior cartografiado del parque; no se inventa una calle dentro del parque.",
    sourceUrl: "https://www.openstreetmap.org/way/370821514",
  },
];
export function presetPoint(
  network: RegionalNetwork,
  preset: Preset,
): SelectedPoint {
  const node = network.graph.nodes[preset.roadNode];
  if (!node || !network.graph.incoming[node.id]?.length)
    throw Error(`No hay acceso vial cartografiado para ${preset.name}`);
  return {
    name: preset.name,
    nodeId: node.id,
    coordinate: node.coordinate,
    requested: node.coordinate,
    snapDistance: distance(node.coordinate, preset.coordinate),
  };
}
/** An indexed search, not a full scan on every map click. Cells are about 210 m. */
export class RoadIndex {
  private nodes = new Map<string, string[]>();
  private segments = new Map<string, string[]>();
  private cell = 0.002;
  constructor(private graph: RoadGraph) {
    for (const n of Object.values(graph.nodes)) {
      const key = this.key(n.coordinate);
      this.nodes.set(key, [...(this.nodes.get(key) ?? []), n.id]);
    }
    const seen = new Set<string>();
    for (const e of Object.values(graph.edges)) {
      if (seen.has(e.physicalId)) continue;
      seen.add(e.physicalId);
      for (let i = 1; i < e.coordinates.length; i++) {
        const a = e.coordinates[i - 1],
          b = e.coordinates[i];
        for (
          let x = Math.floor(Math.min(a[0], b[0]) / this.cell);
          x <= Math.floor(Math.max(a[0], b[0]) / this.cell);
          x++
        )
          for (
            let y = Math.floor(Math.min(a[1], b[1]) / this.cell);
            y <= Math.floor(Math.max(a[1], b[1]) / this.cell);
            y++
          ) {
            const key = `${x},${y}`,
              ids = this.segments.get(key) ?? [];
            if (!ids.includes(e.id)) ids.push(e.id);
            this.segments.set(key, ids);
          }
      }
    }
  }
  private key(p: Coordinate) {
    return `${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)}`;
  }
  private cells(p: Coordinate, meters: number) {
    const r = meters / 100000,
      result: string[] = [];
    for (
      let x = Math.floor((p[0] - r) / this.cell);
      x <= Math.floor((p[0] + r) / this.cell);
      x++
    )
      for (
        let y = Math.floor((p[1] - r) / this.cell);
        y <= Math.floor((p[1] + r) / this.cell);
        y++
      )
        result.push(`${x},${y}`);
    return result;
  }
  nearestNode(p: Coordinate, role: "origin" | "destination", max = 250) {
    let id: string | null = null,
      best = max;
    for (const key of this.cells(p, max))
      for (const candidate of this.nodes.get(key) ?? []) {
        if (
          !(
            role === "origin"
              ? this.graph.outgoing[candidate]
              : this.graph.incoming[candidate]
          ).length
        )
          continue;
        const d = distance(p, this.graph.nodes[candidate].coordinate);
        if (d < best) {
          best = d;
          id = candidate;
        }
      }
    return id ? { id, distance: best } : null;
  }
  nearestRoad(p: Coordinate, max = 30) {
    let best: {
      edge: RoadEdge;
      coordinate: Coordinate;
      distance: number;
      along: number;
    } | null = null;
    const ids = new Set(
      this.cells(p, max).flatMap((k) => this.segments.get(k) ?? []),
    );
    for (const id of ids) {
      const e = this.graph.edges[id];
      let along = 0;
      for (let i = 1; i < e.coordinates.length; i++) {
        const a = e.coordinates[i - 1],
          b = e.coordinates[i],
          scale = Math.cos((p[1] * Math.PI) / 180),
          dx = (b[0] - a[0]) * scale,
          dy = b[1] - a[1],
          t = Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a[0]) * scale * dx + (p[1] - a[1]) * dy) /
                (dx * dx + dy * dy || 1),
            ),
          ),
          coordinate: Coordinate = [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
          ],
          d = distance(p, coordinate);
        if (d <= max && (!best || d < best.distance))
          best = {
            edge: e,
            coordinate,
            distance: d,
            along: along + distance(a, coordinate),
          };
        along += distance(a, b);
      }
    }
    return best;
  }
}
export function regionalPlaces(data: OSMData): Place[] {
  return extractPlaces(data, REGIONAL_BOUNDS).map((p) => ({
    ...p,
    category: p.tags.amenity === "university" ? "Universidad" : p.category,
  }));
}
