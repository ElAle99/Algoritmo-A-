import { type Coordinate, type RoadGraph } from "../geo/graph";
export type IncidentKind =
  | "Bache pequeño"
  | "Bache grande"
  | "Bache sin tamaño OSM"
  | "Pavimento deteriorado"
  | "Calle sin pavimentar"
  | "Obra vial"
  | "Calle cerrada"
  | "Zona de riesgo reportada";
export const INCIDENT_KINDS: IncidentKind[] = [
  "Bache pequeño",
  "Bache grande",
  "Pavimento deteriorado",
  "Calle sin pavimentar",
  "Obra vial",
  "Calle cerrada",
  "Zona de riesgo reportada",
];
export type Incident = {
  datasetSha256?: string;
  id: string;
  coordinate: Coordinate;
  physicalId: string;
  kind: IncidentKind;
  severity: 1 | 2 | 3;
  date: string;
  source: "OSM" | "usuario" | "simulación";
  verification:
    | "registro OSM no inspeccionado"
    | "sin verificar"
    | "confirmado por usuario"
    | "simulado";
  notes: string;
};
const KEY = "rutapizza-incidents-v1";
export function saveIncidents(items: Incident[]) {
  localStorage.setItem(KEY, JSON.stringify({ version: 1, items }));
}
export function readIncidents(): Incident[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (data?.version !== 1 || !Array.isArray(data.items)) return [];
    return data.items
      .filter(
        (i: Incident) =>
          i &&
          typeof i.id === "string" &&
          typeof i.physicalId === "string" &&
          ["usuario", "simulación"].includes(i.source) &&
          ["sin verificar", "confirmado por usuario", "simulado"].includes(
            i.verification,
          ) &&
          Array.isArray(i.coordinate) &&
          i.coordinate.length === 2 &&
          i.coordinate.every(Number.isFinite) &&
          [1, 2, 3].includes(i.severity) &&
          INCIDENT_KINDS.includes(i.kind) &&
          typeof i.notes === "string" &&
          typeof i.date === "string",
      )
      .slice(0, 1000);
  } catch {
    return [];
  }
}
export function osmIncidents(graph: RoadGraph, date: string): Incident[] {
  const seen = new Set<string>(),
    result: Incident[] = [];
  for (const e of Object.values(graph.edges)) {
    if (seen.has(e.physicalId)) continue;
    seen.add(e.physicalId);
    let kind: IncidentKind | undefined;
    if (e.tags?.hazard === "pothole" || e.tags?.hazard === "potholes")
      kind = "Bache sin tamaño OSM";
    else if (
      ["bad", "very_bad", "horrible", "very_horrible", "impassable"].includes(
        e.tags?.smoothness ?? "",
      )
    )
      kind = "Pavimento deteriorado";
    else if (
      [
        "unpaved",
        "gravel",
        "dirt",
        "ground",
        "sand",
        "mud",
        "earth",
        "compacted",
        "fine_gravel",
      ].includes(e.tags?.surface ?? "")
    )
      kind = "Calle sin pavimentar";
    if (kind)
      result.push({
        id: `osm/${e.physicalId}`,
        physicalId: e.physicalId,
        kind,
        coordinate: e.coordinates[Math.floor(e.coordinates.length / 2)],
        severity: 1,
        date,
        source: "OSM",
        verification: "registro OSM no inspeccionado",
        notes: `surface=${e.tags?.surface ?? "sin dato"}; smoothness=${e.tags?.smoothness ?? "sin dato"}; hazard=${e.tags?.hazard ?? "sin dato"}. Fecha de extracción, no de inspección. No se deducen baches por superficie.`,
      });
  }
  return result;
}
export function incidentWeights(items: Incident[], includeUnverified = true) {
  const penalties = new Map<string, number>(),
    closed = new Set<string>();
  for (const i of items) {
    if (
      !includeUnverified &&
      (i.verification === "sin verificar" || i.verification === "simulado")
    )
      continue;
    if (i.kind === "Calle cerrada") {
      closed.add(i.physicalId);
      continue;
    }
    const weight =
      (
        {
          "Bache pequeño": 0.5,
          "Bache grande": 2,
          "Bache sin tamaño OSM": 1,
          "Pavimento deteriorado": 1,
          "Calle sin pavimentar": 0.5,
          "Obra vial": 2,
          "Zona de riesgo reportada": 3,
        } as Record<string, number>
      )[i.kind] ?? 0;
    penalties.set(
      i.physicalId,
      (penalties.get(i.physicalId) ?? 0) + weight * i.severity,
    );
  }
  return { penalties, closed };
}
