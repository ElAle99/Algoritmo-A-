import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  Map as GLMap,
  StyleSpecification,
} from "maplibre-gl";
import type { FeatureCollection, Feature, LineString } from "geojson";
import { Crosshair, Layers, WifiOff } from "lucide-react";
import type { Snapshot } from "../astar";
import {
  contextGeoJSON,
  roadsGeoJSON,
  explorationGeoJSON,
  examinedGeoJSON,
  type Coordinate,
  type RoadGraph,
  type OSMData,
  type Place,
  type SelectedPoint,
} from "./graph";
import { localStyle, navigationStyle } from "./mapStyle";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);
maplibregl.setWorkerCount(2);
type Props = {
  graph: RoadGraph;
  data: OSMData;
  snapshot: Snapshot;
  blocked: Set<string>;
  route: Feature<LineString> | null;
  previous: Feature<LineString> | null;
  places: Place[];
  origin: SelectedPoint;
  destination: SelectedPoint;
  explore: boolean;
  tool: string;
  onPoint: (p: Coordinate) => void;
  onStreet: (id: string) => void;
  onPlace: (p: Place) => void;
  rider: { coordinate: Coordinate; bearing: number };
  follow: boolean;
  focus: Coordinate | null;
  onReady?: (map: GLMap) => void;
  coverageBounds?: readonly number[];
  routeColor?: string;
  incidents?: FeatureCollection;
  hideSnapConnectors?: boolean;
};
const collection = (features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});
const attribution =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a>';
export default function BacalarMap(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    mapRef = useRef<GLMap | null>(null),
    riderRef = useRef<maplibregl.Marker | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false),
    [remote, setRemote] = useState(true),
    [baseStatus, setBaseStatus] = useState("Cargando fondo vectorial…"),
    [fatal, setFatal] = useState("");
  const [styleVersion, setStyleVersion] = useState(0);
  const activeBase = useRef(false),
    baseError = useRef(false),
    bearing = useRef(0);
  const roads = useMemo(
    () => roadsGeoJSON(props.graph, props.blocked),
    [props.graph, props.blocked],
  );
  const context = useMemo(() => contextGeoJSON(props.data), [props.data]);
  const sourceData = useRef(new Map<string, FeatureCollection>());
  const nodesData = useMemo(
    () => explorationGeoJSON(props.graph, props.snapshot),
    [props.graph, props.snapshot],
  );
  const examinedData = useMemo(
    () => examinedGeoJSON(props.graph, props.snapshot),
    [props.graph, props.snapshot],
  );
  const routeData = useMemo(
    () => collection(props.route ? [props.route] : []),
    [props.route],
  );
  const previousData = useMemo(
    () => collection(props.previous ? [props.previous] : []),
    [props.previous],
  );
  const poiData = useMemo(
    () =>
      collection(
        props.places.map((p) => ({
          type: "Feature",
          properties: { id: p.id, name: p.name, category: p.category },
          geometry: { type: "Point", coordinates: p.coordinate },
        })),
      ),
    [props.places],
  );
  const pinData = useMemo(
    () =>
      collection(
        [props.origin, props.destination].map((p, i) => ({
          type: "Feature",
          properties: { role: i ? "destination" : "origin", name: p.name },
          geometry: { type: "Point", coordinates: p.coordinate },
        })),
      ),
    [props.origin, props.destination],
  );
  const snapData = useMemo(
    () =>
      collection(
        [props.origin, props.destination]
          .filter((p) => !props.hideSnapConnectors && p.snapDistance > 2)
          .map((p) => ({
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [p.requested, p.coordinate],
            },
          })),
      ),
    [props.origin, props.destination, props.hideSnapConnectors],
  );
  useEffect(() => {
    if (!container.current) return;
    let map: GLMap;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: localStyle(),
        center: [-88.3928, 18.6778],
        zoom: props.coverageBounds ? 13.4 : 15.1,
        minZoom: props.coverageBounds ? 11 : 13,
        maxZoom: 19,
        maxBounds: props.coverageBounds
          ? [
              [
                props.coverageBounds[1] - 0.004,
                props.coverageBounds[0] - 0.004,
              ],
              [
                props.coverageBounds[3] + 0.004,
                props.coverageBounds[2] + 0.004,
              ],
            ]
          : [
              [-88.411, 18.66],
              [-88.375, 18.694],
            ],
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
      });
    } catch {
      setFatal(
        "WebGL no está disponible. El cálculo A* sigue activo; puedes usar el modo Simulación.",
      );
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: attribution,
      }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: "metric" }),
      "bottom-left",
    );
    map.on("style.load", () => {
      sourceData.current.clear();
      setReady(true);
      setStyleVersion((v) => v + 1);
    });
    map.on("error", () => {
      if (activeBase.current) {
        baseError.current = true;
        setBaseStatus(
          "Fondo remoto no disponible o incompleto · red local activa",
        );
      }
    });
    map.on("idle", () => {
      if (activeBase.current && !baseError.current && map.areTilesLoaded())
        setBaseStatus("OpenFreeMap · fondo vectorial en línea");
    });
    map.on("click", (event) => {
      const p = latest.current;
      const layers = ["poi-points", "street-hit"].filter((id) =>
        map.getLayer(id),
      );
      const hits = layers.length
        ? map.queryRenderedFeatures(event.point, { layers })
        : [];
      if (p.tool === "closure") {
        const hit = hits.find((f) => f.layer.id === "street-hit");
        if (hit?.properties?.id) p.onStreet(String(hit.properties.id));
        return;
      }
      if (p.tool === "inspect") {
        const hit = hits.find((f) => f.layer.id === "street-hit");
        if (hit?.properties?.id) p.onStreet(String(hit.properties.id));
        return;
      }
      if (
        p.tool === "origin" ||
        p.tool === "destination" ||
        p.tool === "custom" ||
        p.tool === "incident"
      ) {
        p.onPoint([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
      const poi = hits.find((f) => f.layer.id === "poi-points");
      if (poi) {
        const place = p.places.find((place) => place.id === poi.properties?.id);
        if (place) p.onPlace(place);
      }
    });
    const riderEl = document.createElement("div");
    riderEl.className = "geo-rider";
    riderEl.setAttribute("aria-label", "Motocicleta del repartidor");
    riderEl.innerHTML =
      '<div class="geo-rider-direction"><div class="rider-arrow">▲</div><svg viewBox="0 0 32 32" width="25" height="25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="24" r="5"/><circle cx="25" cy="24" r="5"/><path d="M7 24l7-12 5 12H7l7-8h8l3 8M19 8h4l3 9M9 12h7M12 8l2 4"/><rect x="3" y="8" width="7" height="7" rx="1"/></svg></div>';
    riderRef.current = new maplibregl.Marker({
      element: riderEl,
      rotationAlignment: "map",
    })
      .setLngLat(latest.current.rider.coordinate)
      .addTo(map);
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    props.onReady?.(map);
    if (props.coverageBounds) {
      const b = props.coverageBounds;
      map.fitBounds(
        [
          [b[1], b[0]],
          [b[3], b[2]],
        ],
        {
          padding:
            container.current.clientWidth < 760
              ? 40
              : { left: 335, right: 70, top: 70, bottom: 150 },
          duration: 0,
        },
      );
    }
    // Expose rendered data for the integration check, without duplicating routing logic.
    Object.assign(container.current, { routeMap: map });
    return () => {
      resize.disconnect();
      riderRef.current?.remove();
      riderRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const controller = new AbortController();
    let active = true;
    if (!remote) {
      activeBase.current = false;
      setReady(false);
      map.setStyle(localStyle());
      setBaseStatus("Fondo local · calles y edificios del extracto OSM");
      return;
    }
    setBaseStatus("Cargando fondo vectorial…");
    const timer = setTimeout(() => controller.abort(), 12000);
    fetch("https://tiles.openfreemap.org/styles/positron", {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error(String(r.status));
        return r.json() as Promise<StyleSpecification>;
      })
      .then((style) => {
        if (!active) return;
        activeBase.current = true;
        baseError.current = false;
        setReady(false);
        map.setStyle(navigationStyle(style));
        setBaseStatus("OpenFreeMap · cargando teselas vectoriales…");
      })
      .catch(() => {
        if (active) {
          activeBase.current = false;
          setBaseStatus("Sin conexión al proveedor · red local OSM activa");
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [remote]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const layers = () => {
      map.addSource("context", { type: "geojson", data: context, attribution });
      map.addLayer({
        id: "local-context",
        type: "fill",
        source: "context",
        paint: {
          "fill-color": [
            "match",
            ["get", "kind"],
            "park",
            "#d4e6cc",
            "#dce3de",
          ],
          "fill-opacity": 0.6,
        },
      });
      map.addSource("streets", { type: "geojson", data: roads, attribution });
      if (props.coverageBounds) {
        const b = props.coverageBounds,
          ring = [
            [b[1], b[0]],
            [b[3], b[0]],
            [b[3], b[2]],
            [b[1], b[2]],
            [b[1], b[0]],
          ];
        map.addSource("coverage", {
          type: "geojson",
          data: collection([
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: ring },
            },
          ]),
        });
        map.addLayer({
          id: "coverage-boundary",
          type: "line",
          source: "coverage",
          paint: {
            "line-color": "#8ca58a",
            "line-width": 2,
            "line-dasharray": [4, 4],
          },
        });
      }
      map.addLayer({
        id: "street-casing",
        type: "line",
        source: "streets",
        paint: { "line-color": "#cfd9d3", "line-width": 9 },
      });
      map.addLayer({
        id: "street-lines",
        type: "line",
        source: "streets",
        paint: { "line-color": "#fff", "line-width": 6 },
      });
      map.addLayer({
        id: "street-hit",
        type: "line",
        source: "streets",
        paint: { "line-color": "#ffffff", "line-opacity": 0, "line-width": 20 },
      });
      map.addLayer({
        id: "oneway-arrows",
        type: "symbol",
        source: "streets",
        filter: ["==", ["get", "oneWay"], true],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 160,
          "text-field": "›",
          "text-font": [map.getStyle().glyphs ? "Noto Sans Regular" : "Arial"],
          "text-size": 22,
          "text-keep-upright": false,
        },
        paint: {
          "text-color": "#82958b",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
      });
      if (props.coverageBounds)
        map.addLayer({
          id: "unknown-directions",
          type: "line",
          source: "streets",
          filter: ["==", ["get", "directionKnown"], false],
          paint: {
            "line-color": "#bdc7c0",
            "line-width": 1.5,
            "line-dasharray": [2, 3],
            "line-opacity": 0.5,
          },
        });
      for (const id of ["examined", "previous", "route", "snaps"])
        map.addSource(id, { type: "geojson", data: collection([]) });
      map.addLayer({
        id: "previous-line",
        type: "line",
        source: "previous",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#879aab",
          "line-width": 5,
          "line-dasharray": [2, 2],
          "line-opacity": 0.65,
        },
      });
      map.addLayer({
        id: "examined-lines",
        type: "line",
        source: "examined",
        paint: {
          "line-color": [
            "match",
            ["get", "kind"],
            "blocked",
            "#e46561",
            "#77a6ec",
          ],
          "line-width": 5,
          "line-opacity": 0.7,
        },
      });
      map.addLayer({
        id: "route-halo",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 10 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2464e8", "line-width": 6 },
      });
      map.addLayer({
        id: "closures",
        type: "line",
        source: "streets",
        filter: ["==", ["get", "blocked"], true],
        layout: { "line-cap": "round" },
        paint: {
          "line-color": "#e76562",
          "line-width": 7,
          "line-dasharray": [1, 1],
        },
      });
      map.addLayer({
        id: "snap-lines",
        type: "line",
        source: "snaps",
        paint: {
          "line-color": "#8a70bf",
          "line-width": 2,
          "line-dasharray": [2, 2],
        },
      });
      if (!map.getStyle().glyphs)
        map.addLayer({
          id: "local-street-names",
          type: "symbol",
          source: "streets",
          filter: ["!=", ["get", "name"], "Calle sin nombre OSM"],
          layout: {
            "symbol-placement": "line",
            "text-field": ["get", "name"],
            "text-font": ["Arial"],
            "text-size": 10,
            "symbol-spacing": 220,
            "text-max-angle": 35,
          },
          paint: {
            "text-color": "#788c81",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        });
      map.addSource("nodes", { type: "geojson", data: collection([]) });
      map.addLayer({
        id: "node-points",
        type: "circle",
        source: "nodes",
        paint: {
          "circle-radius": [
            "match",
            ["get", "status"],
            "current",
            7,
            "idle",
            2.5,
            4,
          ],
          "circle-color": [
            "match",
            ["get", "status"],
            "current",
            "#2978f2",
            "open",
            "#efbd4f",
            "closed",
            "#9aa9b6",
            "#bfd0c6",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });
      map.addSource("pois", { type: "geojson", data: collection([]) });
      map.addLayer({
        id: "poi-points",
        type: "circle",
        source: "pois",
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "category"], "Pizzería"],
            5,
            3.5,
          ],
          "circle-color": [
            "case",
            ["==", ["get", "category"], "Pizzería"],
            "#e5825c",
            "#6d9995",
          ],
          "circle-opacity": 0.85,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
      map.addSource("pins", { type: "geojson", data: collection([]) });
      map.addSource("incidents", { type: "geojson", data: collection([]) });
      map.addLayer({
        id: "incident-points",
        type: "circle",
        source: "incidents",
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "match",
            ["get", "source"],
            "simulación",
            "#b785cc",
            "OSM",
            "#f3d2a1",
            "#e48a4b",
          ],
          "circle-stroke-color": [
            "match",
            ["get", "verification"],
            "confirmado por usuario",
            "#28805c",
            "#ffffff",
          ],
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "selected-pins",
        type: "circle",
        source: "pins",
        paint: {
          "circle-radius": 9,
          "circle-color": [
            "match",
            ["get", "role"],
            "origin",
            "#243f3d",
            "#8a68cf",
          ],
          "circle-stroke-width": 3,
          "circle-stroke-color": "#fff",
        },
      });
    };
    if (!map.getSource("streets")) layers();
    const set = (id: string, data: FeatureCollection) => {
      if (sourceData.current.get(id) === data) return;
      sourceData.current.set(id, data);
      (map.getSource(id) as GeoJSONSource).setData(data);
    };
    set("streets", roads);
    set("context", context);
    // Re-send only changed sources; static streets and POIs stay in the worker cache.
    set("nodes", nodesData);
    set("examined", examinedData);
    set("route", routeData);
    set("previous", previousData);
    set("pois", poiData);
    set("pins", pinData);
    set("snaps", snapData);
    if (props.incidents) set("incidents", props.incidents);
    map.setPaintProperty(
      "route-line",
      "line-color",
      props.routeColor ?? "#2464e8",
    );
    map.setLayoutProperty(
      "node-points",
      "visibility",
      props.explore ? "visible" : "none",
    );
    map.setLayoutProperty(
      "examined-lines",
      "visibility",
      props.explore ? "visible" : "none",
    );
  }, [
    ready,
    styleVersion,
    roads,
    context,
    nodesData,
    examinedData,
    routeData,
    previousData,
    poiData,
    pinData,
    snapData,
    props.explore,
    props.incidents,
    props.routeColor,
  ]);
  useEffect(() => {
    bearing.current +=
      ((((props.rider.bearing - bearing.current + 540) % 360) + 360) % 360) -
      180;
    // Never tween position across corners: each sample lies on the actual polyline.
    // Smooth only the heading, independently from MapLibre's projected position.
    riderRef.current?.setLngLat(props.rider.coordinate);
    const direction = riderRef.current
      ?.getElement()
      .querySelector<HTMLElement>(".geo-rider-direction");
    if (direction) direction.style.transform = `rotate(${bearing.current}deg)`;
    if (props.follow && ready) {
      const mobile = (container.current?.clientWidth ?? 1000) < 760;
      mapRef.current?.easeTo({
        center: props.rider.coordinate,
        duration: 180,
        padding: mobile
          ? { left: 30, right: 30, top: 70, bottom: 70 }
          : { left: 330, right: 70, top: 70, bottom: 130 },
      });
    }
  }, [
    props.rider.coordinate[0],
    props.rider.coordinate[1],
    props.rider.bearing,
    props.follow,
    ready,
  ]);
  useEffect(() => {
    if (props.focus)
      mapRef.current?.easeTo({ center: props.focus, zoom: 16, duration: 650 });
  }, [props.focus]);
  return (
    <>
      <div
        className="bacalar-canvas"
        ref={container}
        data-ready={ready}
        aria-label="Mapa geográfico de Bacalar"
      />
      {fatal && (
        <div className="geo-map-error">
          <WifiOff />
          {fatal}
        </div>
      )}
      <div className="geo-base-controls">
        <span className={baseStatus.includes("línea") ? "online" : ""}>
          <i />
          {baseStatus}
        </span>
        <button onClick={() => setRemote((v) => !v)}>
          <Layers size={14} />
          {remote ? "Usar fondo local" : "Usar fondo en línea"}
        </button>
        <button
          aria-label="Centrar Bacalar"
          onClick={() => {
            if (props.coverageBounds) {
              const b = props.coverageBounds;
              mapRef.current?.fitBounds(
                [
                  [b[1], b[0]],
                  [b[3], b[2]],
                ],
                { padding: 40, bearing: 0, pitch: 0 },
              );
              return;
            }
            mapRef.current?.easeTo({
              center: [-88.3928, 18.6778],
              zoom: 15.1,
              bearing: 0,
              pitch: 0,
            });
          }}
        >
          <Crosshair size={16} />
        </button>
      </div>
    </>
  );
}
