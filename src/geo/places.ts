import { BOUNDS, extractPlaces, type Place, type OSMData } from "./graph";
const CACHE_KEY = "rutapizza-bacalar-pois-v1";
const TTL = 24 * 60 * 60 * 1000;
const COOLDOWN = 60 * 1000;
let pending: Promise<Place[]> | null = null;
let lastAttempt = 0;
export function cachedPlaces(): Place[] {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (
      cached &&
      Date.now() - cached.time < TTL &&
      Array.isArray(cached.elements)
    ) {
      return extractPlaces({ elements: cached.elements });
    }
  } catch {
    /* Storage can be disabled. */
  }
  return [];
}
/** One user-triggered bounded query, 24-hour cache, 60-second failure cooldown. */
export function refreshPlaces(): Promise<Place[]> {
  if (pending) return pending;
  const cached = cachedPlaces();
  if (cached.length) return Promise.resolve(cached);
  if (Date.now() - lastAttempt < COOLDOWN)
    return Promise.reject(
      Error("Espera un minuto antes de volver a consultar Overpass."),
    );
  lastAttempt = Date.now();
  pending = (async () => {
    const query = `[out:json][timeout:20];(nwr[amenity](${BOUNDS.join(",")});nwr[shop](${BOUNDS.join(",")});nwr[tourism](${BOUNDS.join(",")});nwr[leisure=park](${BOUNDS.join(",")}););out center tags;`;
    const response = await fetch(
      "https://overpass.private.coffee/api/interpreter",
      {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!response.ok)
      throw Error(
        `Overpass no disponible (${response.status}). Se conserva el catálogo local.`,
      );
    const data: OSMData = await response.json();
    if (
      !Array.isArray(data.elements) ||
      data.remark ||
      data.elements.length > 5000
    )
      throw Error(
        "Respuesta incompleta o fuera del límite. Se conserva el catálogo local.",
      );
    const places = extractPlaces(data);
    if (!places.length)
      throw Error("Sin resultados nuevos. Se conserva el catálogo local.");
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ time: Date.now(), elements: data.elements }),
      );
    } catch {
      /* The loaded results still work in memory. */
    }
    return places;
  })();
  pending
    .finally(() => {
      pending = null;
    })
    .catch(() => {});
  return pending;
}
export function mergePlaces(...lists: Place[][]): Place[] {
  return [...new Map(lists.flat().map((p) => [p.id, p])).values()].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
}
export function readCustomPlaces(): Place[] {
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem("rutapizza-custom-pois") ?? "[]",
    );
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (p): p is Place =>
          !!p &&
          typeof p.id === "string" &&
          typeof p.name === "string" &&
          p.name.length <= 80 &&
          p.custom === true &&
          Array.isArray(p.coordinate) &&
          p.coordinate.length === 2 &&
          p.coordinate.every(
            (n: unknown) => typeof n === "number" && Number.isFinite(n),
          ),
      )
      .map((p) => ({ ...p, tags: {}, category: "Punto personalizado" }));
  } catch {
    return [];
  }
}
export function saveCustomPlaces(places: Place[]) {
  try {
    localStorage.setItem("rutapizza-custom-pois", JSON.stringify(places));
  } catch {
    /* Not fatal in private mode. */
  }
}
