/** Manual only: download once (or use --input), validate, then rebuild the published local graph. */
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  regionalNetwork,
  presetPoint,
  PRESETS,
  REGIONAL_BOUNDS,
} from "../src/regional/network";
import type { OSMData } from "../src/geo/graph";
const at = process.argv.indexOf("--input"),
  input = at >= 0 ? process.argv[at + 1] : undefined,
  endpoint = "https://overpass.private.coffee/api/interpreter";
const query = `[out:json][timeout:40];way[highway](${REGIONAL_BOUNDS.join(",")})->.roads;rel(bw.roads)[type=restriction]->.turns;(nwr[amenity](${REGIONAL_BOUNDS.join(",")});nwr[shop](${REGIONAL_BOUNDS.join(",")});nwr[tourism](${REGIONAL_BOUNDS.join(",")});nwr[leisure=park](${REGIONAL_BOUNDS.join(",")});)->.places;(.roads;.turns;.places;);out body center;>;out skel qt;`;
let text: string;
if (input) text = await readFile(input, "utf8");
else {
  const r = await fetch(endpoint, {
    method: "POST",
    body: new URLSearchParams({ data: query }),
    headers: {
      "User-Agent": "RutaPizza-University/3.0 (manual bounded regional update)",
    },
    signal: AbortSignal.timeout(55000),
  });
  if (!r.ok)
    throw Error(`Overpass ${r.status}; se conserva la versión anterior`);
  text = await r.text();
}
const data = JSON.parse(text) as OSMData;
if (
  data.remark ||
  !Array.isArray(data.elements) ||
  data.elements.length > 100000
)
  throw Error("Respuesta parcial o fuera del límite: no se publica");
const network = regionalNetwork(data);
for (const p of PRESETS) presetPoint(network, p);
await writeFile("public/data/bacalar-regional-osm.json", text);
await writeFile(
  "public/data/regional-provenance.json",
  JSON.stringify(
    {
      source: "OpenStreetMap contributors",
      license: "ODbL 1.0",
      endpoint: input ? "Extracto local importado manualmente" : endpoint,
      input: input ?? null,
      query: input ? null : query,
      bbox: REGIONAL_BOUNDS,
      retrievedAt: new Date().toISOString(),
      osmTimestamp: data.osm3s?.timestamp_osm_base,
    },
    null,
    2,
  ),
);
await new Promise<void>((resolve, reject) => {
  const processBuild = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/build-regional.ts"],
    { stdio: "inherit", windowsHide: true },
  );
  processBuild.on("error", reject);
  processBuild.on("exit", (code) =>
    code === 0 ? resolve() : reject(Error(`Generación finalizó con ${code}`)),
  );
});
console.log(
  "Grafo actualizado. Reinicia la aplicación y ejecuta las pruebas antes de exponer.",
);
