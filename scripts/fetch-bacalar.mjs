// Manual, bounded extract refresh. Never called by app startup or the build.
import { writeFile, mkdir } from "node:fs/promises";
const bbox = [18.669, -88.402, 18.685, -88.384];
const endpoint = "https://overpass.private.coffee/api/interpreter";
const query = `[out:json][timeout:35];(way["highway"](${bbox.join(",")});nwr["amenity"](${bbox.join(",")});nwr["shop"](${bbox.join(",")});nwr["tourism"](${bbox.join(",")});nwr["leisure"="park"](${bbox.join(",")}););out body center;>;out skel qt;`;
const response = await fetch(endpoint, {
  method: "POST",
  body: new URLSearchParams({ data: query }),
  headers: {
    "User-Agent": "RutaPizza-University-Demo/2.0 (bounded educational extract)",
  },
  signal: AbortSignal.timeout(60000),
});
if (!response.ok)
  throw Error(`Overpass ${response.status}: ${await response.text()}`);
const data = await response.json();
if (!Array.isArray(data.elements) || data.remark)
  throw Error("Incomplete Overpass response");
await mkdir("public/data", { recursive: true });
await writeFile("public/data/bacalar-osm.json", JSON.stringify(data));
await writeFile(
  "public/data/provenance.json",
  JSON.stringify(
    {
      source: "OpenStreetMap contributors",
      license: "ODbL 1.0",
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      attribution: "https://www.openstreetmap.org/copyright",
      endpoint,
      retrievedAt: new Date().toISOString(),
      bbox,
      query,
      osmTimestamp: data.osm3s?.timestamp_osm_base,
    },
    null,
    2,
  ),
);
console.log(
  `${data.elements.length} elements downloaded; snapshot timestamp: ${data.osm3s?.timestamp_osm_base}`,
);
console.log(
  data.elements
    .filter((e) => (e.tags?.cuisine || "").includes("pizza"))
    .map((e) => ({
      id: e.id,
      name: e.tags.name,
      lat: e.lat ?? e.center?.lat,
      lon: e.lon ?? e.center?.lon,
    })),
);
