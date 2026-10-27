import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  regionalNetwork,
  regionalPlaces,
  PRESETS,
  presetPoint,
} from "../src/regional/network";
import {
  regionalTrace,
  finalSnapshot,
  routeMetrics,
  DEFAULT_OPTIONS,
  type Profile,
} from "../src/regional/routing";
import { osmIncidents } from "../src/regional/incidents";
import type { OSMData } from "../src/geo/graph";
const raw = await readFile("public/data/bacalar-regional-osm.json", "utf8"),
  data = JSON.parse(raw) as OSMData;
const provenance = JSON.parse(
  await readFile("public/data/regional-provenance.json", "utf8"),
);
const network = regionalNetwork(data),
  places = regionalPlaces(data),
  incidents = osmIncidents(network.graph, provenance.retrievedAt),
  origin = presetPoint(network, PRESETS[0]);
const validation: Record<string, unknown> = {};
for (const preset of PRESETS.slice(1)) {
  const point = presetPoint(network, preset);
  const profiles: Record<string, unknown> = {};
  for (const profile of ["shortest", "fastest", "risk"] as Profile[]) {
    const options = { ...DEFAULT_OPTIONS, profile, incidents };
    const out = finalSnapshot(
        regionalTrace(network, origin.nodeId, point.nodeId, options),
      ),
      back = finalSnapshot(
        regionalTrace(network, point.nodeId, origin.nodeId, options),
      );
    profiles[profile] = {
      outward: routeMetrics(network, out, options),
      return: routeMetrics(network, back, options),
      outwardStatus: out.status,
      returnStatus: back.status,
    };
  }
  validation[preset.id] = { point, profiles };
}
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceDate: provenance.retrievedAt,
  rawSha256: createHash("sha256").update(raw).digest("hex"),
  provenance,
  network,
  places,
  osmIncidents: incidents,
  presets: PRESETS,
  validation,
};
await writeFile(
  "public/data/bacalar-regional-graph.json",
  JSON.stringify(output),
);
await writeFile(
  "public/data/regional-validation.json",
  JSON.stringify(
    {
      sourceDate: output.sourceDate,
      generatedAt: output.generatedAt,
      rawSha256: output.rawSha256,
      bounds: network.bounds,
      stats: network.stats,
      incidents: incidents.length,
      validation,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      stats: network.stats,
      bounds: network.bounds,
      places: places.length,
      incidents: incidents.length,
      validation,
    },
    null,
    2,
  ),
);
