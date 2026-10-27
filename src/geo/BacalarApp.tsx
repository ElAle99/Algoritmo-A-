import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bike,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Construction,
  Download,
  Eye,
  EyeOff,
  Flag,
  LocateFixed,
  MapPin,
  Navigation,
  PanelRightClose,
  Pause,
  Pizza,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import type { Feature, LineString } from "geojson";
import BacalarMap from "./BacalarMap";
import {
  buildGraph,
  extractPlaces,
  searchRoads,
  snapPoint,
  routeFeature,
  interpolateRoute,
  demoClosures,
  type Coordinate,
  type OSMData,
  type Place,
  type RoadGraph,
  type SelectedPoint,
} from "./graph";
import { demoEndpoints } from "./demo";
import {
  cachedPlaces,
  mergePlaces,
  readCustomPlaces,
  refreshPlaces,
  saveCustomPlaces,
} from "./places";
import { useDelivery } from "./useDelivery";
import { moveCursor } from "../algorithm";
import "./bacalar.css";
type Loaded = {
  data: OSMData;
  graph: RoadGraph;
  places: Place[];
  origin: SelectedPoint;
  destination: SelectedPoint;
};
export default function BacalarApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/bacalar-osm.json", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error("No se pudo cargar el extracto local");
        return response.json() as Promise<OSMData>;
      })
      .then((data) => {
        const graph = buildGraph(data),
          places = extractPlaces(data),
          points = demoEndpoints(graph, places);
        setLoaded({ data, graph, places, ...points });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, []);
  if (!loaded)
    return (
      <div className="bacalar-loading">
        <Navigation size={30} />
        <h2>
          {error
            ? "No se pudo abrir Bacalar"
            : "Preparando las calles de Bacalar…"}
        </h2>
        <p>
          {error ||
            "Leyendo el extracto local de OpenStreetMap y construyendo el grafo vial."}
        </p>
        {error && <button onClick={() => location.reload()}>Reintentar</button>}
      </div>
    );
  return <BacalarWorkspace loaded={loaded} />;
}
const meters = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(2)} km` : `${n.toFixed(0)} m`;
const nodeName = (id: string | null) => (id ? `N${id.slice(-5)}` : "—");
function BacalarWorkspace({ loaded }: { loaded: Loaded }) {
  const { graph, data } = loaded;
  const [origin, setOrigin] = useState(loaded.origin),
    [destination, setDestination] = useState(loaded.destination);
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set()),
    [cursor, setCursor] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(4);
  const [explore, setExplore] = useState(true),
    [details, setDetails] = useState(false),
    [tool, setTool] = useState("browse"),
    [follow, setFollow] = useState(false);
  const [previous, setPrevious] = useState<Feature<LineString> | null>(null),
    [compare, setCompare] = useState(true),
    [focus, setFocus] = useState<Coordinate | null>(null);
  const [custom, setCustom] = useState<Place[]>(readCustomPlaces),
    [remotePlaces, setRemotePlaces] = useState<Place[]>(cachedPlaces),
    [refreshing, setRefreshing] = useState(false),
    [placesStatus, setPlacesStatus] = useState("Catálogo del extracto local");
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Place | null>(null),
    [customName, setCustomName] = useState(""),
    [customPoint, setCustomPoint] = useState<Coordinate | null>(null),
    [sound, setSound] = useState(true);
  const audio = useRef<AudioContext | null>(null);
  const history = useMemo(
    () => searchRoads(graph, origin.nodeId, destination.nodeId, blocked),
    [graph, origin.nodeId, destination.nodeId, blocked],
  );
  const state = history[Math.min(cursor, history.length - 1)];
  const route = useMemo(() => routeFeature(graph, state), [graph, state]);
  const total = route ? Number(route.properties?.cost) : 0;
  const delivery = useDelivery(total, speed);
  const places = useMemo(
    () => mergePlaces(loaded.places, remotePlaces, custom),
    [loaded.places, remotePlaces, custom],
  );
  const current = state.current ? state.records[state.current] : null;
  const found = state.status === "found",
    failed = state.status === "unreachable";
  const rider = useMemo(
    () =>
      route && delivery.status !== "idle"
        ? interpolateRoute(
            route.geometry.coordinates as Coordinate[],
            delivery.meters,
          )
        : { coordinate: origin.coordinate, bearing: 0 },
    [route, delivery.meters, delivery.status, origin.coordinate],
  );
  const searchResults = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("es");
    if (!text)
      return places.filter((p) => p.category === "Pizzería").slice(0, 7);
    const matches = places.filter((p) =>
      `${p.name} ${p.category} ${p.tags["addr:street"] ?? ""}`
        .toLocaleLowerCase("es")
        .includes(text),
    );
    const streets = new Map<string, Place>();
    for (const node of Object.values(graph.nodes))
      for (const name of node.names)
        if (name.toLocaleLowerCase("es").includes(text) && !streets.has(name))
          streets.set(name, {
            id: `street/${name}`,
            name,
            category: "Calle",
            coordinate: node.coordinate,
            tags: {},
          });
    return [...matches, ...streets.values()].slice(0, 15);
  }, [places, graph, query]);
  useEffect(() => {
    if (!playing) return;
    if (cursor >= history.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setCursor((i) => i + 1), 1000 / speed);
    return () => clearTimeout(timer);
  }, [playing, cursor, history.length, speed]);
  useEffect(() => {
    if (delivery.status !== "arrived") return;
    toast.success("¡Pizza entregada! Recorrido A* completado.");
    if (sound && audio.current) {
      const ctx = audio.current;
      [523, 659, 784].forEach((frequency, i) => {
        const oscillator = ctx.createOscillator(),
          gain = ctx.createGain(),
          time = ctx.currentTime + i * 0.14;
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.1, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);
        oscillator.start(time);
        oscillator.stop(time + 0.5);
      });
    }
  }, [delivery.status]);
  function unlockAudio() {
    if (sound) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    }
  }
  function reset(remember = false) {
    if (remember && route) setPrevious(route);
    setCursor(0);
    setPlaying(false);
    delivery.reset();
  }
  function step(delta: number) {
    setPlaying(false);
    delivery.reset();
    setCursor((i) => moveCursor(i, delta, history.length));
  }
  function choosePoint(
    coordinate: Coordinate,
    role: "origin" | "destination",
    name = "Punto elegido",
  ) {
    const snapped = snapPoint(graph, coordinate, role);
    if (!snapped) {
      toast.error("Selecciona un punto a menos de 200 m de la red vial local.");
      return;
    }
    reset(true);
    const point = { ...snapped, name };
    if (role === "origin") setOrigin(point);
    else setDestination(point);
    setTool("browse");
    setSelected(null);
    toast.info(
      `Punto ajustado ${meters(snapped.snapDistance)} a una intersección transitable.`,
    );
  }
  function closeStreet(id: string) {
    if (!Object.values(graph.edges).some((e) => e.physicalId === id)) return;
    reset(true);
    const next = new Set(blocked);
    if (next.has(id)) {
      next.delete(id);
      toast.info("Calle reabierta");
    } else {
      next.add(id);
      toast.info(
        "Cierre simulado aplicado. Calcula una nueva ruta para comparar.",
      );
    }
    setBlocked(next);
  }
  function scenario(number: number) {
    const points = demoEndpoints(graph, loaded.places),
      closures = demoClosures(
        graph,
        points.origin.nodeId,
        points.destination.nodeId,
        number,
      );
    reset();
    setOrigin(points.origin);
    setDestination(points.destination);
    setBlocked(closures);
    setTool("browse");
    setSelected(null);
    setFocus(points.origin.coordinate);
    setPrevious(
      number === 2
        ? routeFeature(
            graph,
            searchRoads(
              graph,
              points.origin.nodeId,
              points.destination.nodeId,
            ).at(-1)!,
          )
        : null,
    );
    toast.info(
      number === 3
        ? "Se cerraron todos los accesos al destino."
        : number === 2
          ? "Una calle de la ruta normal está cerrada. Existe una alternativa."
          : "Demostración normal restaurada.",
    );
  }
  function addCustom() {
    if (!customPoint || !customName.trim()) {
      toast.info("Escribe un nombre y selecciona un punto en el mapa.");
      return;
    }
    if (custom.length >= 100) {
      toast.error(
        "Límite de 100 puntos personalizados. Elimina uno para continuar.",
      );
      return;
    }
    const place: Place = {
      id: `custom/${Date.now()}`,
      name: customName.trim().slice(0, 80),
      category: "Punto personalizado",
      coordinate: customPoint,
      custom: true,
      tags: {},
    };
    const next = [...custom, place];
    setCustom(next);
    saveCustomPlaces(next);
    setCustomName("");
    setCustomPoint(null);
    setTool("browse");
    setSelected(place);
    toast.success("Punto guardado solo en este navegador.");
  }
  async function updatePlaces() {
    setRefreshing(true);
    try {
      setRemotePlaces(await refreshPlaces());
      setPlacesStatus("Overpass · consulta acotada / caché de 24 h");
      toast.success(
        "Catálogo actualizado; el grafo de demostración se conserva.",
      );
    } catch (e) {
      setPlacesStatus("Overpass no disponible · catálogo local conservado");
      toast.error(
        e instanceof Error
          ? e.message
          : "No se pudo actualizar. Se conserva el catálogo local.",
      );
    } finally {
      setRefreshing(false);
    }
  }
  const status =
    delivery.status === "arrived"
      ? "¡Pizza entregada!"
      : delivery.status === "moving"
        ? "Entrega en camino"
        : delivery.status === "paused"
          ? "Entrega en pausa"
          : found
            ? "Ruta óptima encontrada"
            : failed
              ? "Destino inaccesible"
              : playing
                ? "Explorando la red vial"
                : cursor
                  ? "Búsqueda en pausa"
                  : "Listos para explorar";
  const explanation = failed
    ? "La lista abierta quedó vacía. No existe un camino en esta red con los cierres actuales."
    : found
      ? "A* reconstruyó los padres y las aristas exactas de la ruta. El repartidor puede iniciar la entrega."
      : current
        ? `Se seleccionó ${nodeName(current.id)} por su menor f (${meters(current.f)}); en empates, menor h e identificador. Se analizan ${state.decisions.length} conexiones salientes.`
        : "A* combina los metros recorridos con la distancia geográfica en línea recta. El repartidor espera mientras se calcula la ruta.";
  return (
    <div className="bacalar-app">
      <Toaster richColors position="top-center" />
      <div className="geo-header">
        <div className="geo-brand">
          <span>
            <Pizza size={23} />
          </span>
          <div>
            RutaPizza <b>A*</b>
            <small>BACALAR SMART DELIVERY</small>
          </div>
        </div>
        <div className="geo-city-heading">
          <i />
          <span>
            Bacalar, Quintana Roo
            <small>Calles reales. Decisiones explicables.</small>
          </span>
        </div>
        <div className="geo-header-actions">
          <span className="geo-data-badge">
            <ShieldCheck size={14} /> Red OSM local
          </span>
          <button
            aria-label={
              sound ? "Silenciar entrega" : "Activar sonido de entrega"
            }
            onClick={() => {
              setSound((v) => !v);
              if (!sound) {
                audio.current ??= new AudioContext();
                void audio.current.resume();
              }
            }}
          >
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
        </div>
      </div>
      <div className={`geo-workspace ${details ? "engine-open" : ""}`}>
        <BacalarMap
          graph={graph}
          data={data}
          snapshot={state}
          blocked={blocked}
          route={route}
          previous={compare ? previous : null}
          places={places}
          origin={origin}
          destination={destination}
          explore={explore}
          tool={tool}
          onPoint={(p) =>
            tool === "custom"
              ? setCustomPoint(p)
              : choosePoint(p, tool === "origin" ? "origin" : "destination")
          }
          onStreet={closeStreet}
          onPlace={setSelected}
          rider={rider}
          follow={follow && delivery.status === "moving"}
          focus={focus}
        />
        <div className="geo-top-tools">
          <button
            className={explore ? "active" : ""}
            onClick={() => setExplore((v) => !v)}
          >
            {explore ? <Eye size={15} /> : <EyeOff size={15} />} Mostrar
            exploración A*
          </button>
          <button
            className={details ? "active" : ""}
            onClick={() => setDetails((v) => !v)}
          >
            <SlidersHorizontal size={15} /> Motor A* <ChevronDown size={13} />
          </button>
        </div>
        <aside className="geo-left">
          <div className="geo-trip-panel geo-panel">
            <div className="geo-section-label">
              <span>TU ENTREGA, MEJOR CONECTADA</span>
              <span className="geo-live">BACALAR</span>
            </div>
            <h1>
              El mejor camino <br />
              empieza aquí<span>.</span>
            </h1>
            <p className="geo-intro">
              Una pizza. Las calles de Bacalar. <br />
              Un algoritmo que explica cada decisión.
            </p>
            <div className="geo-endpoints">
              {(
                [
                  [origin, "origin", "Origen · pizzería"],
                  [destination, "destination", "Destino · cliente"],
                ] as const
              ).map(([p, role, title]) => (
                <button
                  key={role}
                  className={`geo-endpoint ${tool === role ? "chosen" : ""}`}
                  onClick={() => {
                    setTool(tool === role ? "browse" : role);
                    setPlaying(false);
                  }}
                >
                  <span className={`endpoint-pin ${role}`}>
                    {role === "origin" ? (
                      <Pizza size={16} />
                    ) : (
                      <MapPin size={16} />
                    )}
                  </span>
                  <div>
                    <small>{title}</small>
                    <strong>{p.name}</strong>
                    <span>
                      {p.snapDistance > 2
                        ? `Ajustado ${meters(p.snapDistance)} a la calle`
                        : "Sobre la red vial"}{" "}
                      · {nodeName(p.nodeId)}
                    </span>
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            <div className="geo-trip-metrics">
              <div>
                <small>DISTANCIA A*</small>
                <strong>{found ? meters(total) : "—"}</strong>
              </div>
              <div>
                <small>COSTO DE RUTA</small>
                <strong>{found ? `${total.toFixed(1)} m` : "—"}</strong>
              </div>
            </div>
            <div
              className={`geo-status ${failed ? "failed" : delivery.status === "arrived" ? "arrived" : ""}`}
            >
              <i />
              {status}
            </div>
            <button
              className="geo-primary"
              disabled={
                playing || found || failed || delivery.status === "moving"
              }
              onClick={() => {
                unlockAudio();
                setPlaying(true);
              }}
            >
              <Navigation size={17} />
              {cursor ? "Reproducir búsqueda" : "Calcular ruta con A*"}
              <ChevronRight size={16} />
            </button>
            {found && (
              <button
                className="geo-deliver"
                disabled={delivery.status === "arrived"}
                onClick={() => {
                  unlockAudio();
                  setPlaying(false);
                  delivery.status === "moving"
                    ? delivery.pause()
                    : delivery.status === "paused"
                      ? delivery.resume()
                      : delivery.start();
                }}
              >
                {delivery.status === "moving" ? (
                  <Pause size={17} />
                ) : delivery.status === "arrived" ? (
                  <Check size={17} />
                ) : (
                  <Bike size={17} />
                )}{" "}
                {delivery.status === "moving"
                  ? "Pausar entrega"
                  : delivery.status === "paused"
                    ? "Reanudar entrega"
                    : delivery.status === "arrived"
                      ? "¡Pizza entregada!"
                      : "Iniciar entrega"}
              </button>
            )}
            {delivery.status !== "idle" && (
              <div className="geo-delivery-progress">
                <div>
                  <span>{meters(delivery.meters)} recorridos</span>
                  <b>
                    {total ? Math.round((delivery.meters / total) * 100) : 100}%
                  </b>
                </div>
                <progress max={total || 1} value={delivery.meters} />
                <label>
                  <input
                    type="checkbox"
                    checked={follow}
                    onChange={(e) => setFollow(e.target.checked)}
                  />{" "}
                  Seguir al repartidor
                </label>
                {delivery.status === "arrived" && (
                  <motion.div
                    className="geo-success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                  >
                    <Check size={18} />
                    <span>
                      Entrega completada
                      <strong>
                        {meters(total)} · {state.pathEdges.length} tramos ·{" "}
                        {state.closed.length} nodos evaluados
                      </strong>
                    </span>
                  </motion.div>
                )}
              </div>
            )}
            <div className="geo-scenario">
              <label htmlFor="geo-scenario">DEMOSTRACIONES LOCALES</label>
              <select
                id="geo-scenario"
                defaultValue="1"
                onChange={(e) => scenario(Number(e.target.value))}
              >
                <option value="1">01 · Entrega normal en Bacalar</option>
                <option value="2">02 · Calle cerrada y alternativa</option>
                <option value="3">03 · Destino inaccesible</option>
              </select>
            </div>
            <div className="geo-edit-actions">
              <button
                className={tool === "closure" ? "active" : ""}
                onClick={() => {
                  setTool(tool === "closure" ? "browse" : "closure");
                  setPlaying(false);
                }}
              >
                <Construction size={15} />{" "}
                {tool === "closure"
                  ? "Terminar cierres"
                  : "Cerrar / reabrir calle"}
              </button>
              <button
                title="Limpiar cierres"
                aria-label="Limpiar cierres"
                disabled={!blocked.size}
                onClick={() => {
                  reset(true);
                  setBlocked(new Set());
                }}
              >
                <RotateCcw size={15} />
              </button>
            </div>
            <div className="geo-closure-count">
              {blocked.size} cierres simulados · no son datos de tráfico real
            </div>
            {previous && (
              <label className="geo-compare">
                <input
                  type="checkbox"
                  checked={compare}
                  onChange={(e) => setCompare(e.target.checked)}
                />{" "}
                Comparar ruta anterior (
                {meters(Number(previous.properties?.cost))})
              </label>
            )}
          </div>
          <div className="geo-places-panel geo-panel">
            <div className="geo-section-label">
              <span>DESCUBRE BACALAR</span>
              <MapPin size={13} />
            </div>
            <label className="geo-search">
              <Search size={16} />
              <input
                aria-label="Buscar negocios, calles y lugares"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Negocios, calles y lugares…"
              />
              {query && (
                <button
                  aria-label="Limpiar búsqueda"
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              )}
            </label>
            <div className="geo-results">
              {searchResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelected(p);
                    setFocus(p.coordinate);
                  }}
                >
                  <span
                    className={p.category === "Pizzería" ? "pizza" : "place"}
                  >
                    {p.category === "Pizzería" ? (
                      <Pizza size={14} />
                    ) : (
                      <MapPin size={14} />
                    )}
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.category}
                      {p.custom ? " · solo simulación" : ""}
                    </small>
                  </div>
                  <ChevronRight size={13} />
                </button>
              ))}
              {!searchResults.length && (
                <p>No hay coincidencias en el catálogo local de esta zona.</p>
              )}
            </div>
            <div className="geo-catalog-note">
              {places.length} lugares disponibles · listado parcial de OSM
            </div>
            <button
              className="geo-refresh"
              disabled={refreshing}
              onClick={updatePlaces}
            >
              <Download size={13} />
              {refreshing
                ? "Consultando Overpass…"
                : "Actualizar comercios con Overpass"}
            </button>
            <small className="geo-places-status">{placesStatus}</small>
            <button
              className="geo-custom"
              onClick={() => {
                setTool(tool === "custom" ? "browse" : "custom");
                setCustomPoint(null);
              }}
            >
              <Plus size={13} /> Agregar punto personalizado
            </button>
            {tool === "custom" && (
              <div className="geo-custom-form">
                <input
                  maxLength={80}
                  aria-label="Nombre del punto personalizado"
                  placeholder="Nombre del punto"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
                <p>
                  {customPoint
                    ? `Punto: ${customPoint[1].toFixed(5)}, ${customPoint[0].toFixed(5)}`
                    : "Haz clic en el mapa para ubicarlo."}
                </p>
                <button onClick={addCustom}>
                  Guardar solo en la simulación
                </button>
              </div>
            )}
          </div>
        </aside>
        {tool !== "browse" && (
          <div className="geo-tool-hint">
            <LocateFixed size={15} />
            {tool === "closure"
              ? "Haz clic en un tramo para cerrar o reabrir ambos sentidos."
              : tool === "custom"
                ? "Selecciona la ubicación del punto personalizado."
                : `Haz clic en el mapa para ubicar el ${tool === "origin" ? "origen" : "destino"}.`}
            <button
              aria-label="Cancelar herramienta"
              onClick={() => setTool("browse")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <AnimatePresence>
          {selected && (
            <motion.div
              className="geo-place-card geo-panel"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <button
                className="geo-card-close"
                aria-label="Cerrar lugar"
                onClick={() => setSelected(null)}
              >
                <X size={16} />
              </button>
              <div className="geo-poi-category">
                {selected.custom
                  ? "SOLO EN TU SIMULACIÓN"
                  : selected.category.toUpperCase()}
              </div>
              <h2>{selected.name}</h2>
              <p>
                {selected.coordinate[1].toFixed(6)},{" "}
                {selected.coordinate[0].toFixed(6)}
              </p>
              {selected.tags["addr:street"] && (
                <p>
                  {selected.tags["addr:street"]}{" "}
                  {selected.tags["addr:housenumber"]}
                </p>
              )}
              <div>
                <button
                  onClick={() =>
                    choosePoint(selected.coordinate, "origin", selected.name)
                  }
                >
                  <Flag size={14} /> Usar de origen
                </button>
                <button
                  className="geo-primary"
                  onClick={() =>
                    choosePoint(
                      selected.coordinate,
                      "destination",
                      selected.name,
                    )
                  }
                >
                  <MapPin size={14} /> Ir aquí
                </button>
              </div>
              {selected.custom ? (
                <button
                  className="geo-delete-custom"
                  onClick={() => {
                    const next = custom.filter((p) => p.id !== selected.id);
                    setCustom(next);
                    saveCustomPlaces(next);
                    setSelected(null);
                  }}
                >
                  Eliminar punto personalizado
                </button>
              ) : (
                !selected.id.startsWith("street/") && (
                  <a
                    href={`https://www.openstreetmap.org/${selected.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Consultar registro en OpenStreetMap ↗
                  </a>
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {details && (
            <motion.aside
              className="geo-engine geo-panel"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 30, opacity: 0 }}
            >
              <div className="geo-engine-title">
                <h2>
                  <Zap size={16} /> Motor de búsqueda A*
                </h2>
                <button
                  aria-label="Plegar motor A*"
                  onClick={() => setDetails(false)}
                >
                  <PanelRightClose size={17} />
                </button>
              </div>
              <div className="geo-node-current">
                <small>NODO ACTUAL</small>
                <strong>{nodeName(state.current)}</strong>
                <span>
                  {state.current
                    ? graph.nodes[state.current].coordinate
                        .map((c) => c.toFixed(6))
                        .join(", ")
                    : "Selecciona un paso para comenzar"}
                </span>
              </div>
              <div className="geo-cost-grid">
                {[
                  ["g(n)", current?.g],
                  ["h(n)", current?.h],
                  ["f(n)", current?.f],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <small>{label}</small>
                    <strong>
                      {typeof value === "number" ? value.toFixed(1) : "—"}
                    </strong>
                    <span>metros</span>
                  </div>
                ))}
              </div>
              <div className="geo-equation">
                {current
                  ? `${current.g.toFixed(1)} + ${current.h.toFixed(1)} = ${current.f.toFixed(1)} m`
                  : "f(n) = g(n) + h(n)"}
              </div>
              <dl>
                <div>
                  <dt>Lista abierta</dt>
                  <dd>{state.open.length}</dd>
                </div>
                <div>
                  <dt>Lista cerrada</dt>
                  <dd>{state.closed.length}</dd>
                </div>
                <div>
                  <dt>Iteración</dt>
                  <dd>{state.iteration}</dd>
                </div>
                <div>
                  <dt>Grafo local</dt>
                  <dd>{Object.keys(graph.nodes).length} nodos</dd>
                </div>
              </dl>
              <p className="geo-decision-explanation">{explanation}</p>
              <h3>Registro de costos</h3>
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
                    {Object.values(state.records)
                      .sort((a, b) =>
                        a.id === state.current
                          ? -1
                          : b.id === state.current
                            ? 1
                            : a.f - b.f || a.h - b.h,
                      )
                      .map((n) => (
                        <tr
                          key={n.id}
                          className={n.id === state.current ? "selected" : ""}
                        >
                          <td title={n.id}>{nodeName(n.id)}</td>
                          <td>{n.g.toFixed(0)}</td>
                          <td>{n.h.toFixed(0)}</td>
                          <td>{n.f.toFixed(0)}</td>
                          <td>
                            {n.id === state.current
                              ? "Actual"
                              : state.closed.includes(n.id)
                                ? "Cerrado"
                                : "Abierto"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <h3>Conexiones de esta iteración</h3>
              <div className="geo-alternatives">
                {state.decisions.map((d, i) => (
                  <div
                    key={`${d.edgeId}-${i}`}
                    className={d.kind === "blocked" ? "blocked" : ""}
                  >
                    {d.kind === "blocked" ? (
                      <X size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                    <p>
                      <b>{graph.edges[d.edgeId!]?.name ?? nodeName(d.id)}</b>
                      {d.message}
                    </p>
                  </div>
                ))}
                {!state.decisions.length && (
                  <p>
                    {found
                      ? "Exploración completada: ruta óptima encontrada."
                      : "Las decisiones aparecerán después de cada expansión."}
                  </p>
                )}
              </div>
              {found && (
                <details className="geo-path-nodes">
                  <summary>Secuencia exacta de la ruta</summary>
                  <p>{state.path.map(nodeName).join(" → ")}</p>
                  <button
                    onClick={() => {
                      if (!route) return;
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(route, null, 2)], {
                          type: "application/geo+json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "rutapizza-bacalar-astar.geojson";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    <Download size={13} /> Exportar ruta A* GeoJSON
                  </button>
                </details>
              )}
              <span className="geo-method-note">
                Haversine · metros · A* propio
                <br />
                Sin Google Directions ni motor externo
              </span>
            </motion.aside>
          )}
        </AnimatePresence>
        <div className="geo-bottom">
          <div className="geo-education">
            <div>
              <Zap size={15} />
              <strong>¿Cómo piensa A*?</strong>
              <span>Paso {state.iteration}</span>
            </div>
            <p>{explanation}</p>
          </div>
          <div className="geo-playback">
            <button
              aria-label="Paso anterior Bacalar"
              disabled={!cursor}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="geo-play-button"
              disabled={found || failed}
              onClick={() => {
                unlockAudio();
                setPlaying((v) => !v);
              }}
              aria-label={
                playing
                  ? "Pausar búsqueda Bacalar"
                  : "Reproducir búsqueda Bacalar"
              }
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              aria-label="Siguiente paso Bacalar"
              disabled={found || failed}
              onClick={() => step(1)}
            >
              <ChevronRight size={20} />
            </button>
            <span className="geo-play-separator" />
            <button
              aria-label="Reiniciar búsqueda Bacalar"
              onClick={() => reset()}
            >
              <RotateCcw size={17} />
            </button>
            <div className="geo-playback-speed">
              <label htmlFor="geo-speed">
                Velocidad <b>{speed}×</b>
              </label>
              <input
                id="geo-speed"
                type="range"
                min="1"
                max="12"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              />
            </div>
            <span className="geo-iteration">
              <b>{state.iteration.toString().padStart(2, "0")}</b> /{" "}
              {history.length - 1} pasos
            </span>
          </div>
          {explore && (
            <div className="geo-legend">
              {[
                ["#2978f2", "Actual"],
                ["#efbd4f", "Pendientes"],
                ["#9aa9b6", "Visitados"],
                ["#e76562", "Cierres"],
                ["#2464e8", "Ruta A*"],
                ["#879aab", "Anterior"],
              ].map(([color, label]) => (
                <span key={label}>
                  <i style={{ background: color }} />
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="geo-footnote">
        <span>
          <ShieldCheck size={12} /> Datos locales para exposición · cierres
          simulados · zona acotada
        </span>
        <span>
          El fondo remoto requiere conexión. La red vial y A* funcionan con el
          extracto local.
        </span>
      </div>
    </div>
  );
}
