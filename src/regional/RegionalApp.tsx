import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Bike,
  Check,
  ChevronLeft,
  ChevronRight,
  Construction,
  Download,
  Eye,
  Flag,
  Pizza,
  MapPin,
  Navigation,
  Pause,
  Play,
  Plus,
  Presentation,
  RotateCcw,
  Search,
  Settings2,
  ShieldQuestion,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { TracePlayer, type Snapshot } from "../astar";
import BacalarMap from "../geo/BacalarMap";
import {
  distance,
  interpolateRoute,
  routeFeature,
  type OSMData,
  type SelectedPoint,
  type Place,
  type Coordinate,
} from "../geo/graph";
import { useRoadDelivery } from "./useRoadDelivery";
import { readCustomPlaces, saveCustomPlaces, mergePlaces } from "../geo/places";
import {
  RoadIndex,
  presetPoint,
  stateNode,
  PRESETS,
  type RegionalNetwork,
} from "./network";
import {
  PROFILE_LABELS,
  edgeSeconds,
  routeMetrics,
  rerouteFromPosition,
  type Profile,
  type RouteOptions,
} from "./routing";
import {
  INCIDENT_KINDS,
  readIncidents,
  saveIncidents,
  incidentWeights,
  type Incident,
  type IncidentKind,
} from "./incidents";
import { useRegionalSearch } from "./useRegionalSearch";
import "../geo/bacalar.css";
import "./regional.css";
type Dataset = {
  schemaVersion: number;
  sourceDate: string;
  network: RegionalNetwork;
  places: Place[];
  osmIncidents: Incident[];
  rawSha256: string;
};
type Leg = NonNullable<ReturnType<typeof routeMetrics>> & {
  avoided: number;
  physicalIds: string[];
};
const m = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value.toFixed(1)} m`;
const time = (seconds: number) => `${(seconds / 60).toFixed(1)} min estimados`;
const nodeLabel = (id: string | null) =>
  id
    ? stateNode(id) === "vehicle-position"
      ? "Moto"
      : `N${stateNode(id).slice(-5)}`
    : "—";
const empty = (): Snapshot => ({
  current: null,
  open: [],
  closed: [],
  records: {},
  decisions: [],
  path: [],
  pathEdges: [],
  status: "ready",
  iteration: 0,
});
export default function RegionalApp() {
  const [loaded, setLoaded] = useState<{
      dataset: Dataset;
      data: OSMData;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      [
        "/data/bacalar-regional-graph.json",
        "/data/bacalar-regional-osm.json",
      ].map((url) =>
        fetch(url, { signal: controller.signal }).then((r) => {
          if (!r.ok) throw Error(`No se pudo leer ${url}`);
          return r.json();
        }),
      ),
    )
      .then(([dataset, data]) => {
        if (dataset.schemaVersion !== 1)
          throw Error("Versión de grafo no soportada");
        setLoaded({ dataset, data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, []);
  return loaded ? (
    <RegionalWorkspace {...loaded} />
  ) : (
    <div className="bacalar-loading">
      <Navigation size={30} />
      <h2>
        {error
          ? "No se pudo cargar la red regional"
          : "Abriendo la red vial ampliada…"}
      </h2>
      <p>
        {error ||
          "Grafo local versionado, sin descargar la red de OSM en cada inicio."}
      </p>
    </div>
  );
}
function RegionalWorkspace({
  dataset,
  data,
}: {
  dataset: Dataset;
  data: OSMData;
}) {
  const base = dataset.network;
  const [network, setNetwork] = useState(base),
    [origin, setOrigin] = useState(() => presetPoint(base, PRESETS[0])),
    [destination, setDestination] = useState(() =>
      presetPoint(base, PRESETS[1]),
    );
  const [pizza, setPizza] = useState(() => presetPoint(base, PRESETS[0]));
  const [client, setClient] = useState(() => presetPoint(base, PRESETS[1]));
  const [stage, setStage] = useState<
      "outbound" | "delivered" | "returning" | "returned"
    >("outbound"),
    [outbound, setOutbound] = useState<Leg | null>(null),
    [inbound, setInbound] = useState<Leg | null>(null);
  const [profile, setProfile] = useState<Profile>("shortest"),
    [riskFactor, setRiskFactor] = useState(1),
    [allowUnknown, setAllowUnknown] = useState(true),
    [includeUnverified, setIncludeUnverified] = useState(true);
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set()),
    [reports, setReports] = useState<Incident[]>(readIncidents),
    [initialIncoming, setInitialIncoming] = useState<string | undefined>();
  const incidents = useMemo(
    () => [
      ...dataset.osmIncidents,
      ...reports.filter((r) => r.datasetSha256 === dataset.rawSha256),
    ],
    [dataset.osmIncidents, reports],
  );
  const options = useMemo<RouteOptions>(
    () => ({
      profile,
      riskFactor,
      allowUnknown,
      includeUnverified,
      blocked: [...blocked],
      incidents,
      initialIncoming,
    }),
    [
      profile,
      riskFactor,
      allowUnknown,
      includeUnverified,
      blocked,
      incidents,
      initialIncoming,
    ],
  );
  const search = useRegionalSearch(
      network,
      origin.nodeId,
      destination.nodeId,
      options,
    ),
    player = useMemo(
      () => (search.events.length ? new TracePlayer(search.events) : null),
      [search.events],
    );
  const [cursor, setCursor] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(30),
    [explore, setExplore] = useState(true),
    [details, setDetails] = useState(false),
    [presentation, setPresentation] = useState(false),
    [tool, setTool] = useState("browse");
  const snapshot = useMemo(
    () =>
      player ? player.at(Math.min(cursor, search.events.length - 1)) : empty(),
    [player, cursor, search.events.length, origin.nodeId],
  );
  const state = search.busy ? empty() : snapshot;
  const route = useMemo(
    () => routeFeature(network.graph, state),
    [network, state],
  );
  const metrics = useMemo(
    () => routeMetrics(network, state, options),
    [network, state, options],
  );
  const timedSegments = useMemo(
    () =>
      state.status === "found"
        ? state.pathEdges.map((id) => ({
            distance: network.graph.edges[id].cost,
            seconds: edgeSeconds(network.graph.edges[id]),
          }))
        : [],
    [network, state],
  );
  const delivery = useRoadDelivery(timedSegments, speed),
    [carry, setCarry] = useState({
      distance: 0,
      seconds: 0,
      cost: 0,
      explored: 0,
      physicalIds: [] as string[],
    });
  const completed = useRef(false);
  const [hold, setHold] = useState<Coordinate | null>(null),
    [previous, setPrevious] = useState<Feature<LineString> | null>(null),
    [focus, setFocus] = useState<Coordinate | null>(null),
    [follow, setFollow] = useState(false),
    [sound, setSound] = useState(true);
  const audio = useRef<AudioContext | null>(null);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Place | null>(null),
    [custom, setCustom] = useState<Place[]>(readCustomPlaces),
    [customName, setCustomName] = useState(""),
    [customPoint, setCustomPoint] = useState<Coordinate | null>(null);
  const [incidentPoint, setIncidentPoint] = useState<{
      coordinate: Coordinate;
      physicalId: string;
    } | null>(null),
    [incidentKind, setIncidentKind] = useState<IncidentKind>("Bache pequeño"),
    [severity, setSeverity] = useState<1 | 2 | 3>(1),
    [incidentSource, setIncidentSource] = useState<"usuario" | "simulación">(
      "usuario",
    ),
    [confirmed, setConfirmed] = useState(false),
    [notes, setNotes] = useState(""),
    [street, setStreet] = useState<string | null>(null);
  const [tableSet, setTableSet] = useState<"open" | "closed">("open"),
    [tablePage, setTablePage] = useState(0);
  const index = useMemo(() => new RoadIndex(base.graph), [base]);
  const places = useMemo(
    () => mergePlaces(dataset.places, custom),
    [dataset.places, custom],
  );
  const found = state.status === "found",
    failed = state.status === "unreachable",
    locked =
      delivery.status === "moving" ||
      delivery.status === "paused" ||
      (carry.distance > 0 && (stage === "outbound" || stage === "returning"));
  const searchLocked =
    delivery.status === "moving" || delivery.status === "paused";
  const effectiveBlocked = useMemo(
    () =>
      new Set([
        ...blocked,
        ...incidentWeights(incidents, includeUnverified).closed,
      ]),
    [blocked, incidents, includeUnverified],
  );
  const incidentData = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: incidents.map((i) => ({
        type: "Feature",
        properties: {
          id: i.id,
          source: i.source,
          verification: i.verification,
        },
        geometry: { type: "Point", coordinates: i.coordinate },
      })),
    }),
    [incidents],
  );
  const rider = useMemo(() => {
    if (route && delivery.status !== "idle")
      return interpolateRoute(
        route.geometry.coordinates as Coordinate[],
        delivery.meters,
      );
    return {
      coordinate:
        stage === "delivered"
          ? destination.coordinate
          : stage === "returned"
            ? pizza.coordinate
            : (hold ?? origin.coordinate),
      bearing: 0,
    };
  }, [
    route,
    delivery.status,
    delivery.meters,
    stage,
    destination.coordinate,
    pizza.coordinate,
    hold,
    origin.coordinate,
  ]);
  useEffect(() => {
    setCursor(0);
    setPlaying(false);
  }, [search.events]);
  useEffect(() => {
    if (!playing || search.busy || !search.events.length) return;
    const timer = setTimeout(
      () => {
        setCursor((i) => {
          const next = Math.min(
            search.events.length - 1,
            i + Math.max(1, Math.floor(speed / 30)),
          );
          if (next === search.events.length - 1) setPlaying(false);
          return next;
        });
      },
      speed >= 30 ? 33 : 1000 / speed,
    );
    return () => clearTimeout(timer);
  }, [playing, search.busy, search.events, cursor, speed]);
  useEffect(() => {
    if (delivery.status !== "arrived" || !metrics || completed.current) return;
    completed.current = true;
    const excluded = new Set(effectiveBlocked),
      avoided = new Set(
        search.events.flatMap((e) =>
          e.decisions
            .filter(
              (d) =>
                d.kind === "blocked" &&
                d.edgeId &&
                excluded.has(network.graph.edges[d.edgeId]?.physicalId),
            )
            .map((d) => network.graph.edges[d.edgeId!].physicalId),
        ),
      ).size;
    const leg: Leg = {
      ...metrics,
      distance: carry.distance + metrics.distance,
      seconds: carry.seconds + metrics.seconds,
      cost: carry.cost + metrics.cost,
      explored: carry.explored + metrics.explored,
      avoided,
      physicalIds: [
        ...carry.physicalIds,
        ...state.pathEdges.map((id) => network.graph.edges[id].physicalId),
      ],
    };
    if (stage === "returning") {
      setInbound(leg);
      setStage("returned");
      toast.success("¡Regreso completado!");
    } else {
      setOutbound(leg);
      setStage("delivered");
      toast.success("¡Pizza entregada!");
    }
    if (sound && audio.current) {
      const ctx = audio.current;
      [523, 659, 784].forEach((hz, i) => {
        const o = ctx.createOscillator(),
          g = ctx.createGain(),
          t = ctx.currentTime + i * 0.12;
        o.frequency.value = hz;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        o.start(t);
        o.stop(t + 0.4);
      });
    }
  }, [delivery.status]);
  function unlock() {
    if (sound) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    }
  }
  function clearPlayback() {
    setPlaying(false);
    setCursor(0);
    delivery.reset();
    completed.current = false;
  }
  function newTrip(start = pizza, end = client) {
    clearPlayback();
    setNetwork(base);
    setInitialIncoming(undefined);
    setOrigin(start);
    setPizza(start);
    setDestination(end);
    setClient(end);
    setStage("outbound");
    setOutbound(null);
    setInbound(null);
    setHold(null);
    setCarry({
      distance: 0,
      seconds: 0,
      cost: 0,
      explored: 0,
      physicalIds: [],
    });
    setPrevious(route);
  }
  function selectPreset(id: string) {
    const p = PRESETS.find((p) => p.id === id)!;
    const target = presetPoint(base, p);
    newTrip(pizza, target);
    setFocus(target.coordinate);
    setSelected(null);
    setTool("browse");
    toast.info(p.note);
  }
  function selectPoint(
    coordinate: Coordinate,
    role: "origin" | "destination",
    name = "Punto elegido",
  ) {
    const near = index.nearestRoad(coordinate, 30);
    if (!near) {
      toast.error(
        "Elige una ubicación sobre una vía OSM (máximo 30 m). No se inventa un acceso a través de edificios o agua.",
      );
      return;
    }
    const road = near.edge,
      nodeId = near.along <= road.cost / 2 ? road.from : road.to,
      node = base.graph.nodes[nodeId];
    if (
      !(
        role === "origin"
          ? base.graph.outgoing[nodeId]
          : base.graph.incoming[nodeId]
      ).length
    ) {
      toast.error(
        "Ese extremo no admite el sentido solicitado. Selecciona otra intersección.",
      );
      return;
    }
    const point: SelectedPoint = {
      name,
      nodeId,
      coordinate: node.coordinate,
      requested: node.coordinate,
      snapDistance: distance(coordinate, node.coordinate),
    };
    if (role === "origin") newTrip(point, destination);
    else newTrip(pizza, point);
    setFocus(node.coordinate);
    setSelected(null);
    setTool("browse");
    toast.info(
      `Se usa el extremo vial conectado ${nodeLabel(nodeId)}. El desplazamiento desde el lugar a la calle no forma parte de la ruta.`,
    );
  }
  function rememberAndReplan() {
    if (
      !route ||
      !metrics ||
      !(delivery.status === "moving" || delivery.status === "paused")
    ) {
      setPrevious(route ?? previous);
      clearPlayback();
      return;
    }
    const location = rerouteFromPosition(
      network,
      state,
      delivery.meters,
      options,
    );
    let left = delivery.meters,
      seconds = 0,
      cost = 0;
    const traversed: string[] = [];
    for (const id of state.pathEdges) {
      const edge = network.graph.edges[id],
        amount = Math.min(left, edge.cost);
      if (amount <= 0) break;
      const fraction = amount / edge.cost;
      seconds += edgeSeconds(edge) * fraction;
      const penalty =
        incidentWeights(incidents, includeUnverified).penalties.get(
          edge.physicalId,
        ) ?? 0;
      cost +=
        (profile === "fastest"
          ? edgeSeconds(edge)
          : profile === "risk"
            ? edge.cost * (1 + riskFactor * penalty)
            : edge.cost) * fraction;
      traversed.push(edge.physicalId);
      left -= amount;
    }
    setCarry((c) => ({
      distance: c.distance + delivery.meters,
      seconds: c.seconds + seconds,
      cost: c.cost + cost,
      explored: c.explored + state.closed.length,
      physicalIds: [...c.physicalIds, ...traversed],
    }));
    setPrevious(route);
    setHold(location.coordinate);
    setOrigin({
      name: "Posición vial actual",
      nodeId: location.start,
      coordinate: location.coordinate,
      requested: location.coordinate,
      snapDistance: 0,
    });
    setNetwork(location.network);
    setInitialIncoming(location.initialIncoming);
    clearPlayback();
    toast.info(
      "Moto detenida en su posición vial. A* recalcula desde aquí. Revisa el resultado y ordena continuar.",
    );
  }
  function changeClosure(id: string) {
    rememberAndReplan();
    setBlocked((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function onMapPoint(p: Coordinate) {
    if (tool === "custom") {
      setCustomPoint(p);
      return;
    }
    if (tool === "incident") {
      const near = index.nearestRoad(p, 30);
      if (!near) {
        toast.error("Marca el reporte sobre un tramo vial.");
        return;
      }
      setIncidentPoint({
        coordinate: near.coordinate,
        physicalId: near.edge.physicalId,
      });
      return;
    }
    selectPoint(p, tool === "origin" ? "origin" : "destination");
  }
  function saveReport() {
    if (!incidentPoint) {
      toast.info("Selecciona un punto de la calle en el mapa.");
      return;
    }
    if (reports.length >= 1000) {
      toast.error("Límite de reportes locales alcanzado.");
      return;
    }
    const item: Incident = {
      datasetSha256: dataset.rawSha256,
      id: `report/${crypto.randomUUID()}`,
      coordinate: incidentPoint.coordinate,
      physicalId: incidentPoint.physicalId,
      kind: incidentKind,
      severity,
      date: new Date().toISOString(),
      source: incidentSource,
      verification:
        incidentSource === "simulación"
          ? "simulado"
          : confirmed
            ? "confirmado por usuario"
            : "sin verificar",
      notes: notes.trim().slice(0, 500),
    };
    const next = [...reports, item];
    try {
      saveIncidents(next);
    } catch {
      toast.error("El navegador no permitió guardar el reporte. No se añadió.");
      return;
    }
    rememberAndReplan();
    setReports(next);
    setIncidentPoint(null);
    setTool("browse");
    setNotes("");
    toast.success("Reporte local guardado. No se envió a OSM.");
  }
  function startReturn() {
    clearPlayback();
    setNetwork(base);
    setInitialIncoming(undefined);
    setPrevious(route);
    setOrigin(destination);
    setDestination(pizza);
    setHold(destination.coordinate);
    setCarry({
      distance: 0,
      seconds: 0,
      cost: 0,
      explored: 0,
      physicalIds: [],
    });
    setStage("returning");
    toast.info(
      "Se ejecuta un A* nuevo desde la entrega hasta la pizzería, con los sentidos y cierres actuales.",
    );
  }
  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es");
    return (
      q
        ? places.filter((p) =>
            `${p.name} ${p.category} ${p.tags["addr:street"] ?? ""}`
              .toLocaleLowerCase("es")
              .includes(q),
          )
        : places.filter((p) => p.category === "Pizzería")
    ).slice(0, 12);
  }, [places, query]);
  const current = state.current ? state.records[state.current] : null;
  const tableRecords = useMemo(
    () => [
      ...(current ? [current] : []),
      ...(tableSet === "open"
        ? state.open
        : state.closed.map((id) => state.records[id])
      ).filter((n) => n.id !== current?.id),
    ],
    [state, current, tableSet],
  );
  const page = Math.min(
    tablePage,
    Math.max(0, Math.ceil(tableRecords.length / 80) - 1),
  );
  const status =
    stage === "returned"
      ? "¡Regreso completado!"
      : stage === "delivered"
        ? "¡Pizza entregada!"
        : delivery.status === "moving"
          ? "Moto en recorrido"
          : delivery.status === "paused"
            ? "Recorrido pausado"
            : search.busy
              ? "Calculando en Web Worker…"
              : search.error
                ? "Error de cálculo"
                : failed
                  ? stage === "returning"
                    ? "No existe un regreso válido"
                    : "Destino inaccesible"
                  : found
                    ? "Ruta calculada con A*"
                    : playing
                      ? "Explorando alternativas"
                      : cursor
                        ? "Exploración en pausa"
                        : "Listo para explorar";
  const unit =
    profile === "fastest" ? "s" : profile === "risk" ? "m ponderados" : "m";
  const explain = failed
    ? "La lista abierta quedó vacía. No se inventa una ruta ni una maniobra desde la posición actual."
    : current
      ? `Elegido ${nodeLabel(current.id)} por menor f; desempate por h e identificador. El estado incluye la arista de llegada para respetar giros. ${state.decisions.filter((d) => d.kind === "blocked").length} alternativas restringidas o cerradas en este paso.`
      : "g acumula el costo del perfil. h es distancia geográfica directa, dividida por la máxima velocidad del grafo si se minimiza tiempo. Datos ausentes siguen sin verificar.";
  return (
    <div
      className={`bacalar-app regional-app ${presentation ? "presentation-mode" : ""}`}
    >
      <Toaster richColors position="top-center" />
      <div className="geo-header">
        <div className="geo-brand">
          <span>
            <PizzaIcon />
          </span>
          <div>
            RutaPizza <b>A*</b>
            <small>BACALAR · ENTREGA Y REGRESO</small>
          </div>
        </div>
        <span className="regional-coverage">
          {base.stats.nodes.toLocaleString()} nodos ·{" "}
          {base.stats.arcs.toLocaleString()} aristas dirigidas ·{" "}
          {base.stats.kilometers.toFixed(1)} km de vías OSM
        </span>
        <div className="geo-header-actions">
          <button
            aria-label="Sonido regional"
            onClick={() => setSound((v) => !v)}
          >
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button
            className="regional-present"
            onClick={() => setPresentation((v) => !v)}
          >
            <Presentation size={16} />
            {presentation ? "Salir de presentación" : "Presentación"}
          </button>
        </div>
      </div>
      <div className={`geo-workspace ${details ? "engine-open" : ""}`}>
        <BacalarMap
          graph={network.graph}
          data={data}
          snapshot={state}
          blocked={effectiveBlocked}
          route={route}
          previous={previous}
          places={places}
          origin={origin}
          destination={destination}
          explore={explore}
          tool={tool}
          onPoint={onMapPoint}
          onStreet={(id) =>
            tool === "inspect" ? setStreet(id) : changeClosure(id)
          }
          onPlace={setSelected}
          rider={rider}
          follow={follow && delivery.status === "moving"}
          focus={focus}
          coverageBounds={base.bounds}
          routeColor={
            stage === "returning" || stage === "returned"
              ? "#26996c"
              : "#2464e8"
          }
          incidents={incidentData}
          hideSnapConnectors
        />
        <div className="geo-top-tools">
          <button
            className={explore ? "active" : ""}
            onClick={() => setExplore((v) => !v)}
          >
            <Eye size={15} />
            Exploración A*
          </button>
          <button onClick={() => setDetails((v) => !v)}>
            <Settings2 size={15} />
            Motor A*
          </button>
          <button
            onClick={() => setTool(tool === "inspect" ? "browse" : "inspect")}
          >
            <ShieldQuestion size={15} />
            Datos de vía
          </button>
        </div>
        <aside className="geo-left">
          <section className="geo-panel geo-trip-panel">
            <div className="geo-section-label">
              <span>BACALAR · RED AMPLIADA</span>
              <span className="geo-live">IDA + REGRESO</span>
            </div>
            <h1>
              Más ciudad. <br />
              Más caminos<span>.</span>
            </h1>
            <p className="geo-intro">
              A* propio · Motocicleta · Datos OSM parciales.
              <br />
              Las vías sin información no se consideran verificadas.
            </p>
            <div className="regional-stage">
              {stage === "returning" || stage === "returned"
                ? "02 · Regreso a la pizzería"
                : "01 · Entrega al destino"}
            </div>
            <div className="geo-endpoints">
              {(
                [
                  [origin, "origin"],
                  [destination, "destination"],
                ] as const
              ).map(([p, role]) => (
                <button
                  className="geo-endpoint"
                  key={role}
                  disabled={locked}
                  onClick={() => setTool(tool === role ? "browse" : role)}
                >
                  <span className={`endpoint-pin ${role}`}>
                    {role === "origin" ? (
                      <Flag size={16} />
                    ) : (
                      <MapPin size={16} />
                    )}
                  </span>
                  <div>
                    <small>
                      {role === "origin" ? "Origen vial" : "Destino vial"}
                    </small>
                    <strong>{p.name}</strong>
                    <span>
                      {nodeLabel(p.nodeId)} · acceso final no recorrido
                    </span>
                  </div>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
            <label className="regional-field">
              DESTINOS PREESTABLECIDOS
              <select
                id="regional-preset"
                disabled={locked}
                defaultValue="upb"
                onChange={(e) => selectPreset(e.target.value)}
              >
                {PRESETS.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <details className="regional-access-note">
              <summary>Ubicación, fuente y acceso</summary>
              <p>
                {PRESETS.find(
                  (p) =>
                    p.roadNode ===
                    (stage === "returning" || stage === "returned"
                      ? client.nodeId
                      : destination.nodeId),
                )?.note ??
                  "Destino ajustado a la red. No se recorren accesos fuera de vías cartografiadas."}
              </p>
              <a
                href={
                  PRESETS.find(
                    (p) =>
                      p.roadNode ===
                      (stage === "returning" || stage === "returned"
                        ? client.nodeId
                        : destination.nodeId),
                  )?.sourceUrl ?? "https://www.openstreetmap.org/copyright"
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                Consultar fuente ↗
              </a>
            </details>
            <label className="regional-field">
              OBJETIVO DEL COSTO
              <select
                id="regional-profile"
                value={profile}
                disabled={locked}
                onChange={(e) => {
                  newTrip();
                  setProfile(e.target.value as Profile);
                }}
              >
                {Object.entries(PROFILE_LABELS).map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="regional-cost-note">
              {profile === "shortest"
                ? "Minimiza Σ distancia de tramos, en metros."
                : profile === "fastest"
                  ? "Minimiza Σ distancia / velocidad. Velocidades OSM o supuestos por clase de vía; no es tráfico real."
                  : "Minimiza Σ metros × (1 + factor × penalización conocida/reportada). No es una garantía de seguridad."}
            </p>
            {profile === "risk" && (
              <label className="regional-slider">
                Factor de penalización: {riskFactor}
                <input
                  type="range"
                  min="0"
                  max="5"
                  step=".25"
                  value={riskFactor}
                  disabled={locked}
                  onChange={(e) => setRiskFactor(Number(e.target.value))}
                />
              </label>
            )}
            <label className="regional-checkbox">
              <input
                type="checkbox"
                checked={allowUnknown}
                disabled={locked}
                onChange={(e) => {
                  newTrip();
                  setAllowUnknown(e.target.checked);
                }}
              />{" "}
              Permitir vías sin sentido/acceso verificado en OSM
            </label>
            <label className="regional-checkbox">
              <input
                type="checkbox"
                checked={includeUnverified}
                disabled={locked}
                onChange={(e) => {
                  newTrip();
                  setIncludeUnverified(e.target.checked);
                }}
              />{" "}
              Considerar reportes sin verificar y simulaciones
            </label>
            <div className="regional-metrics">
              <div>
                <small>Distancia vial</small>
                <strong>{metrics ? m(metrics.distance) : "—"}</strong>
              </div>
              <div>
                <small>Tiempo estimado</small>
                <strong>
                  {metrics ? `${(metrics.seconds / 60).toFixed(1)} min` : "—"}
                </strong>
              </div>
              <div>
                <small>Costo {unit}</small>
                <strong>{metrics ? metrics.cost.toFixed(1) : "—"}</strong>
              </div>
            </div>
            <div
              className={`geo-status ${failed ? "failed" : ""}`}
              data-stage={stage}
            >
              <i />
              {status}
            </div>
            {search.error && <p role="alert">{search.error}</p>}
            <div className="regional-buttons">
              <button
                className="geo-primary"
                disabled={search.busy || found || failed || searchLocked}
                onClick={() => {
                  unlock();
                  setPlaying((v) => !v);
                }}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}{" "}
                {playing ? "Pausar búsqueda" : "Explorar A*"}
              </button>
              <button
                disabled={search.busy || searchLocked}
                onClick={() => {
                  setPlaying(false);
                  setCursor(search.events.length - 1);
                }}
              >
                Ver resultado
              </button>
            </div>
            {found && stage !== "delivered" && stage !== "returned" && (
              <button
                className="geo-deliver"
                onClick={() => {
                  unlock();
                  completed.current = false;
                  setPlaying(false);
                  if (delivery.status === "moving") delivery.pause();
                  else if (delivery.status === "paused") delivery.resume();
                  else delivery.start();
                }}
              >
                <Bike size={17} />
                {delivery.status === "moving"
                  ? "Pausar recorrido"
                  : delivery.status === "paused"
                    ? "Reanudar recorrido"
                    : carry.distance > 0
                      ? "Continuar por la nueva ruta"
                      : stage === "returning"
                        ? "Iniciar regreso"
                        : "Iniciar entrega"}
              </button>
            )}
            {stage === "delivered" && (
              <button
                className="geo-deliver return-button"
                onClick={startReturn}
              >
                <RotateCcw size={16} />
                Regresar a la pizzería
              </button>
            )}
            {delivery.status !== "idle" && (
              <div className="geo-delivery-progress">
                <div>
                  <span>{m(carry.distance + delivery.meters)} recorridos</span>
                  <b>
                    {metrics?.distance
                      ? Math.round((delivery.meters / metrics.distance) * 100)
                      : 100}
                    %
                  </b>
                </div>
                <progress
                  max={metrics?.distance || 1}
                  value={delivery.meters}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={follow}
                    onChange={(e) => setFollow(e.target.checked)}
                  />
                  Seguir cámara
                </label>
              </div>
            )}
            {metrics && (
              <p className="regional-warning">
                <ShieldQuestion size={13} />
                {metrics.unknownDirection} tramos con sentido sin dato;{" "}
                {metrics.unknownAccess} con acceso sin dato.{" "}
                {metrics.estimatedSpeedEdges} velocidades estimadas. La ruta no
                certifica legalidad ni seguridad.
              </p>
            )}
            <div className="geo-edit-actions">
              <button
                onClick={() =>
                  setTool(tool === "closure" ? "browse" : "closure")
                }
                className={tool === "closure" ? "active" : ""}
              >
                <Construction size={15} />
                Cerrar / reabrir
              </button>
              <button
                aria-label="Limpiar cierres regionales"
                onClick={() => {
                  rememberAndReplan();
                  setBlocked(new Set());
                }}
              >
                <RotateCcw size={15} />
              </button>
            </div>
            <button
              className="regional-link"
              onClick={() => {
                if (route?.properties?.edgeIds?.length) {
                  changeClosure(
                    network.graph.edges[
                      state.pathEdges[Math.floor(state.pathEdges.length / 2)]
                    ].physicalId,
                  );
                } else
                  toast.info(
                    "Calcula primero una ruta para cerrar un tramo de demostración.",
                  );
              }}
            >
              Generar cierre de demostración
            </button>
            <button
              className="regional-link danger"
              onClick={() => {
                rememberAndReplan();
                setBlocked(
                  new Set(
                    network.graph.incoming[destination.nodeId].map(
                      (id) => network.graph.edges[id].physicalId,
                    ),
                  ),
                );
              }}
            >
              Escenario sin salida
            </button>
            <small className="geo-closure-count">
              {effectiveBlocked.size} cierres simulados/reportados · no son
              tráfico en vivo
            </small>
          </section>
          <section className="geo-panel geo-places-panel">
            <div className="geo-section-label">
              <span>NEGOCIOS Y LUGARES · {places.length}</span>
              <Search size={14} />
            </div>
            <label className="geo-search">
              <Search size={15} />
              <input
                aria-label="Buscar en Bacalar ampliado"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nombre de lugar o negocio"
              />
            </label>
            <div className="geo-results">
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelected(p);
                    setFocus(p.coordinate);
                  }}
                >
                  <MapPin size={14} />
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.category}
                      {p.custom ? " · personalizado" : ""}
                    </small>
                  </div>
                </button>
              ))}
            </div>
            <button
              className="geo-custom"
              disabled={locked}
              onClick={() => setTool(tool === "custom" ? "browse" : "custom")}
            >
              <Plus size={13} />
              Punto personalizado
            </button>
            {tool === "custom" && (
              <div className="geo-custom-form">
                <input
                  aria-label="Nombre personalizado regional"
                  placeholder="Nombre"
                  value={customName}
                  maxLength={80}
                  onChange={(e) => setCustomName(e.target.value)}
                />
                <p>
                  {customPoint
                    ? "Ubicación seleccionada"
                    : "Selecciona un punto del mapa."}
                </p>
                <button
                  onClick={() => {
                    if (!customPoint || !customName.trim()) return;
                    const p: Place = {
                      id: `custom/${crypto.randomUUID()}`,
                      name: customName.trim(),
                      category: "Punto personalizado",
                      coordinate: customPoint,
                      custom: true,
                      tags: {},
                    };
                    const next = [...custom, p];
                    saveCustomPlaces(next);
                    setCustom(next);
                    setSelected(p);
                    setTool("browse");
                    setCustomName("");
                  }}
                >
                  Guardar solo localmente
                </button>
              </div>
            )}
            <p className="geo-catalog-note">
              Catálogo parcial de la instantánea OSM. Para actualizar la red,
              usa la herramienta manual documentada.
            </p>
          </section>
          <section className="geo-panel geo-places-panel regional-incidents">
            <div className="geo-section-label">
              <span>CONDICIONES VIALES</span>
              <Construction size={14} />
            </div>
            <p>
              {dataset.osmIncidents.length} condiciones OSM, {reports.length}{" "}
              reportes locales. No se generan baches ficticios.
            </p>
            {reports.some((r) => r.datasetSha256 !== dataset.rawSha256) && (
              <p className="regional-warning">
                Hay reportes de otra versión o sin versión: se conservan, pero
                no alteran rutas hasta volver a registrarlos sobre esta red.
              </p>
            )}
            <button
              className="geo-deliver"
              onClick={() =>
                setTool(tool === "incident" ? "browse" : "incident")
              }
            >
              <Plus size={14} />
              Reportar incidencia
            </button>
            {tool === "incident" && (
              <div className="regional-report-form">
                <label>
                  Tipo
                  <select
                    value={incidentKind}
                    onChange={(e) =>
                      setIncidentKind(e.target.value as IncidentKind)
                    }
                  >
                    {INCIDENT_KINDS.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Severidad
                  <select
                    value={severity}
                    onChange={(e) =>
                      setSeverity(Number(e.target.value) as 1 | 2 | 3)
                    }
                  >
                    <option value="1">1 · baja</option>
                    <option value="2">2 · media</option>
                    <option value="3">3 · alta</option>
                  </select>
                </label>
                <label>
                  Fuente
                  <select
                    value={incidentSource}
                    onChange={(e) =>
                      setIncidentSource(
                        e.target.value as "usuario" | "simulación",
                      )
                    }
                  >
                    <option>usuario</option>
                    <option>simulación</option>
                  </select>
                </label>
                {incidentSource === "usuario" && (
                  <label className="regional-checkbox">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    Confirmado por mí, sin inspección oficial
                  </label>
                )}
                <textarea
                  placeholder="Observaciones (opcional)"
                  aria-label="Observaciones incidencia"
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <p>
                  {incidentPoint
                    ? `Punto: ${incidentPoint.coordinate.map((n) => n.toFixed(6)).join(", ")}`
                    : "Haz clic sobre una calle para ubicar el reporte."}
                </p>
                <button className="geo-primary" onClick={saveReport}>
                  Guardar reporte local
                </button>
              </div>
            )}
            <div className="regional-reports">
              {reports.map((i) => (
                <div key={i.id}>
                  <b>
                    {i.kind} · {i.severity}
                  </b>
                  <span>
                    {i.source} · {i.verification}
                  </span>
                  <small>
                    {new Date(i.date).toLocaleString("es-MX")}
                    <br />
                    {i.notes}
                  </small>
                  <button
                    aria-label={`Eliminar ${i.kind}`}
                    onClick={() => {
                      const next = reports.filter((r) => r.id !== i.id);
                      try {
                        saveIncidents(next);
                      } catch {
                        toast.error("No se pudo guardar el cambio.");
                        return;
                      }
                      rememberAndReplan();
                      setReports(next);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="regional-incident-legend">
              <span>● OSM: registrado, no inspeccionado</span>
              <span>● Naranja: usuario sin verificar</span>
              <span>● Borde verde: confirmado por usuario</span>
              <span>● Morado: simulación</span>
            </div>
          </section>
        </aside>
        {tool !== "browse" && (
          <div className="geo-tool-hint">
            <MapPin size={14} />
            {tool === "closure"
              ? "Selecciona un tramo para cerrar o reabrir. La moto se pausa si está en recorrido."
              : tool === "inspect"
                ? "Selecciona una vía para consultar sus datos OSM."
                : tool === "incident"
                  ? "Ubica la incidencia sobre una calle; no modifica OSM."
                  : `Selecciona ${tool === "origin" ? "el origen" : tool === "destination" ? "el destino" : "un punto"} sobre la red vial.`}
            <button
              aria-label="Cancelar herramienta regional"
              onClick={() => setTool("browse")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {selected && (
          <div className="geo-panel geo-place-card">
            <button
              className="geo-card-close"
              aria-label="Cerrar lugar regional"
              onClick={() => setSelected(null)}
            >
              <X size={16} />
            </button>
            <div className="geo-poi-category">
              {selected.category} · {selected.custom ? "simulación" : "OSM"}
            </div>
            <h2>{selected.name}</h2>
            <p>{selected.coordinate.map((c) => c.toFixed(6)).join(", ")}</p>
            <p>
              Elige un acceso sobre la calle si el local no tiene conexión
              vehicular cartografiada.
            </p>
            <div>
              <button
                disabled={locked}
                onClick={() =>
                  selectPoint(selected.coordinate, "origin", selected.name)
                }
              >
                Usar origen
              </button>
              <button
                disabled={locked}
                className="geo-primary"
                onClick={() =>
                  selectPoint(selected.coordinate, "destination", selected.name)
                }
              >
                Usar destino
              </button>
            </div>
            {selected.custom && (
              <button
                className="regional-link"
                onClick={() => {
                  const next = custom.filter((p) => p.id !== selected.id);
                  saveCustomPlaces(next);
                  setCustom(next);
                  setSelected(null);
                }}
              >
                Eliminar punto
              </button>
            )}
          </div>
        )}
        {street && (
          <div className="geo-panel geo-place-card regional-street">
            <button
              className="geo-card-close"
              onClick={() => setStreet(null)}
              aria-label="Cerrar datos de vía"
            >
              <X size={16} />
            </button>
            {(() => {
              const e = Object.values(base.graph.edges).find(
                (e) => e.physicalId === street,
              );
              if (!e) return null;
              return (
                <>
                  <h2>{e.name}</h2>
                  <p>
                    Sentido:{" "}
                    {e.directionKnown
                      ? e.oneWay
                        ? "único, registrado OSM"
                        : "bidireccional, registrado OSM"
                      : "sin dato, no verificado"}
                  </p>
                  <dl>
                    {[
                      "highway",
                      "oneway",
                      "access",
                      "vehicle",
                      "motor_vehicle",
                      "motorcycle",
                      "maxspeed",
                      "surface",
                      "smoothness",
                      "turn:lanes",
                    ].map((tag) => (
                      <div key={tag}>
                        <dt>{tag}</dt>
                        <dd>{e.tags?.[tag] ?? "sin dato"}</dd>
                      </div>
                    ))}
                  </dl>
                  <a
                    href={`https://www.openstreetmap.org/way/${e.wayId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ver fuente OSM ↗
                  </a>
                </>
              );
            })()}
          </div>
        )}
        {details && (
          <aside className="geo-panel geo-engine">
            <div className="geo-engine-title">
              <h2>
                <Zap size={15} />
                Motor A* · heap binario
              </h2>
              <button
                onClick={() => setDetails(false)}
                aria-label="Plegar motor regional"
              >
                <X size={16} />
              </button>
            </div>
            <div className="geo-node-current">
              <small>ESTADO SELECCIONADO</small>
              <strong>{nodeLabel(state.current)}</strong>
              <span>
                {state.current
                  ? network.graph.nodes[stateNode(state.current)]?.coordinate
                      .map((n) => n.toFixed(6))
                      .join(", ")
                  : "Inicio de búsqueda"}
              </span>
            </div>
            <div className="geo-cost-grid">
              {[
                ["g", current?.g],
                ["h", current?.h],
                ["f", current?.f],
              ].map(([label, n]) => (
                <div key={String(label)}>
                  <small>{label}(n)</small>
                  <strong>{typeof n === "number" ? n.toFixed(1) : "—"}</strong>
                  <span>{unit}</span>
                </div>
              ))}
            </div>
            <div className="geo-equation">
              {current
                ? `${current.g.toFixed(1)} + ${current.h.toFixed(1)} = ${current.f.toFixed(1)} ${unit}`
                : "f(n) = g(n) + h(n)"}
            </div>
            <dl>
              <div>
                <dt>Abiertos</dt>
                <dd>{state.open.length}</dd>
              </div>
              <div>
                <dt>Cerrados (estados de giro)</dt>
                <dd>{state.closed.length}</dd>
              </div>
              <div>
                <dt>Iteración</dt>
                <dd>{state.iteration}</dd>
              </div>
              <div>
                <dt>Worker</dt>
                <dd>{search.milliseconds.toFixed(0)} ms</dd>
              </div>
            </dl>
            <p className="geo-decision-explanation">{explain}</p>
            <div className="regional-table-controls">
              <select
                aria-label="Lista de estados A*"
                value={tableSet}
                onChange={(e) => {
                  setTableSet(e.target.value as "open" | "closed");
                  setTablePage(0);
                }}
              >
                <option value="open">Lista abierta</option>
                <option value="closed">Lista cerrada</option>
              </select>
              <button
                aria-label="Página anterior de estados"
                disabled={page === 0}
                onClick={() => setTablePage(page - 1)}
              >
                <ChevronLeft size={13} />
              </button>
              <span>
                {page + 1}/{Math.max(1, Math.ceil(tableRecords.length / 80))}
              </span>
              <button
                aria-label="Página siguiente de estados"
                disabled={(page + 1) * 80 >= tableRecords.length}
                onClick={() => setTablePage(page + 1)}
              >
                <ChevronRight size={13} />
              </button>
            </div>
            <div className="geo-node-table">
              <table>
                <thead>
                  <tr>
                    <th>Nodo</th>
                    <th>g</th>
                    <th>h</th>
                    <th>f</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRecords.slice(page * 80, page * 80 + 80).map((n) => (
                    <tr key={n.id}>
                      <td title={n.id}>{nodeLabel(n.id)}</td>
                      <td>{n.g.toFixed(1)}</td>
                      <td>{n.h.toFixed(1)}</td>
                      <td>{n.f.toFixed(1)}</td>
                      <td>
                        {n.id === state.current
                          ? "Actual"
                          : tableSet === "open"
                            ? "Abierto"
                            : "Cerrado"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="geo-method-note">
              80 filas por página. Ambas listas se conservan completas; los
              nodos del mapa usan capas GeoJSON.
            </p>
            <h3>Alternativas de este paso</h3>
            <div className="geo-alternatives">
              {state.decisions.map((d) => (
                <div
                  key={`${d.edgeId}-${d.id}`}
                  className={d.kind === "blocked" ? "blocked" : ""}
                >
                  <ChevronRight size={12} />
                  <p>
                    <b>
                      {network.graph.edges[d.edgeId!]?.name ?? nodeLabel(d.id)}
                    </b>
                    {d.message}
                  </p>
                </div>
              ))}
            </div>
            {found && (
              <details className="geo-path-nodes">
                <summary>Secuencia y exportación GeoJSON</summary>
                <p>{state.path.map(nodeLabel).join(" → ")}</p>
                <button
                  onClick={() => {
                    if (!route) return;
                    const blob = URL.createObjectURL(
                      new Blob([JSON.stringify(route)], {
                        type: "application/geo+json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = blob;
                    a.download = `bacalar-${stage}-${profile}.geojson`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(blob), 1000);
                  }}
                >
                  <Download size={13} />
                  Exportar ruta propia
                </button>
              </details>
            )}
            <details className="regional-data-details">
              <summary>Datos y límites medidos</summary>
              <p>
                Instantánea{" "}
                {new Date(dataset.sourceDate).toLocaleDateString("es-MX")}.
                Extensión: {base.bounds.join(", ")}.{" "}
                {base.stats.unknownDirection} tramos físicos sin sentido
                registrado y {base.stats.unknownAccess} sin acceso registrado.{" "}
                {base.stats.turns} restricciones de giro compatibles en este
                extracto; {base.stats.unsupportedTurns} no interpretadas.{" "}
                {base.stats.conditionalWaysExcluded} vías excluidas por política
                conservadora.
              </p>
              {base.limitations.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </details>
          </aside>
        )}
        <div className="geo-bottom">
          <div className="geo-education">
            <div>
              <Zap size={14} />
              <strong>
                {presentation ? "f(n) = g(n) + h(n)" : "¿Cómo piensa A*?"}
              </strong>
              <span>Paso {state.iteration}</span>
            </div>
            <p>
              {presentation && current
                ? `${nodeLabel(current.id)}: ${current.g.toFixed(1)} + ${current.h.toFixed(1)} = ${current.f.toFixed(1)} ${unit}`
                : explain}
            </p>
          </div>
          <div className="geo-playback">
            <button
              aria-label="Paso anterior regional"
              disabled={search.busy || cursor === 0 || searchLocked}
              onClick={() => {
                setPlaying(false);
                setCursor((i) => Math.max(0, i - 1));
              }}
            >
              <ChevronLeft size={19} />
            </button>
            <button
              className="geo-play-button"
              aria-label={
                playing
                  ? "Pausar búsqueda regional"
                  : "Reproducir búsqueda regional"
              }
              disabled={search.busy || found || failed || searchLocked}
              onClick={() => setPlaying((v) => !v)}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              aria-label="Siguiente paso regional"
              disabled={search.busy || found || failed || searchLocked}
              onClick={() => {
                setPlaying(false);
                setCursor((i) => Math.min(search.events.length - 1, i + 1));
              }}
            >
              <ChevronRight size={19} />
            </button>
            <button
              aria-label="Reiniciar viaje regional"
              onClick={() => newTrip()}
            >
              <RotateCcw size={16} />
            </button>
            <div className="geo-playback-speed">
              <label htmlFor="regional-speed">
                Velocidad simulada <b>{speed}×</b>
              </label>
              <input
                id="regional-speed"
                type="range"
                min="1"
                max="120"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              />
            </div>
            <span className="geo-iteration">
              {state.iteration} / {Math.max(0, search.events.length - 1)}
            </span>
          </div>
          <div className="geo-legend">
            <span>● Azul: ida</span>
            <span>● Verde: regreso</span>
            <span>● Amarillo: abiertos</span>
            <span>● Rojo: cierres</span>
            <span>› Sentido OSM</span>
          </div>
        </div>
        {(outbound || inbound) && (
          <motion.div
            className="geo-panel regional-summary"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="geo-section-label">
              <span>
                {inbound ? "¡REGRESO COMPLETADO!" : "¡PIZZA ENTREGADA!"}
              </span>
              <Check size={16} />
            </div>
            <div className="regional-summary-cols">
              <div>
                <small>Ida</small>
                <strong>{outbound ? m(outbound.distance) : "—"}</strong>
                <span>{outbound ? time(outbound.seconds) : ""}</span>
              </div>
              <div>
                <small>Regreso</small>
                <strong>{inbound ? m(inbound.distance) : "Pendiente"}</strong>
                <span>
                  {inbound ? time(inbound.seconds) : "Se calcula con A* nuevo"}
                </span>
              </div>
              <div>
                <small>Total</small>
                <strong>
                  {m((outbound?.distance ?? 0) + (inbound?.distance ?? 0))}
                </strong>
                <span>
                  {(outbound?.explored ?? 0) + (inbound?.explored ?? 0)} estados
                  explorados
                </span>
              </div>
            </div>
            <p>
              {(outbound?.avoided ?? 0) + (inbound?.avoided ?? 0)} cierres
              encontrados y evitados por las búsquedas.
              {outbound && inbound
                ? ` Diferencia de distancia: ${m(Math.abs(outbound.distance - inbound.distance))}; ${new Set([...outbound.physicalIds, ...inbound.physicalIds].filter((id) => !outbound.physicalIds.includes(id) || !inbound.physicalIds.includes(id))).size} tramos físicos no compartidos.`
                : ""}
            </p>
          </motion.div>
        )}
      </div>
      <div className="geo-footnote">
        <span>
          Red OSM local versionada · datos parciales · sentidos y accesos
          desconocidos señalados
        </span>
        <span>
          Fondo remoto requiere internet. UPB: vía de servicio OSM; Cenote Azul:
          Boulevard Costera, sin entrar por escaleras.
        </span>
      </div>
    </div>
  );
}
function PizzaIcon() {
  return <Pizza size={23} />;
}
