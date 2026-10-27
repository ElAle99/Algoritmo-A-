import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Bike,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  MapPin,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  Volume2,
  VolumeX,
  X,
  Zap,
  Pizza,
  Construction,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import CityMap from "./CityMap";
import {
  generateCity,
  label,
  manhattan,
  moveCursor,
  search,
  type City,
} from "./algorithm";
export default function App() {
  const [city, setCity] = useState<City>(() => generateCity());
  const [scenario, setScenario] = useState(1);
  const [seed, setSeed] = useState("42");
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(550);
  const [editing, setEditing] = useState(false);
  const [showRoute, setShowRoute] = useState(true);
  const [delivery, setDelivery] = useState(-1);
  const [arrived, setArrived] = useState(false);
  const [sound, setSound] = useState(true);
  const audio = useRef<AudioContext | null>(null);
  const history = useMemo(() => search(city), [city]);
  const state = history[cursor];
  const current = state.current ? state.records[state.current] : null;
  const found = state.status === "found";
  const completed = found && arrived;
  const delivering = delivery >= 0 && !completed;
  function reset() {
    setCursor(0);
    setPlaying(false);
    setDelivery(-1);
    setArrived(false);
  }
  function load(next: number, newSeed = Number(seed) || 0) {
    setScenario(next);
    setCity(generateCity(next, newSeed));
    reset();
  }
  function newCity() {
    const nextSeed = Math.floor(Math.random() * 1000000);
    setSeed(String(nextSeed));
    load(scenario, nextSeed);
    toast.info(`Nueva ciudad · semilla ${nextSeed}`);
  }
  function step(delta: number) {
    setPlaying(false);
    setDelivery(-1);
    setArrived(false);
    setCursor((i) => moveCursor(i, delta, history.length));
  }
  function enableAudio() {
    if (sound) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    }
  }
  function chime() {
    if (!sound || !audio.current) return;
    const ctx = audio.current;
    [523.25, 659.25, 783.99].forEach((frequency, i) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = frequency;
      const t = ctx.currentTime + i * 0.13;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t);
      o.stop(t + 0.5);
    });
  }
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (cursor < history.length - 1) setCursor(cursor + 1);
      else setPlaying(false);
    }, speed);
    return () => clearTimeout(t);
  }, [playing, cursor, history.length, speed]);
  // Advance only after the previous street animation ends, so turns never cut corners.
  function arrivedAtNode() {
    if (!found || delivery < 0 || completed) return;
    if (delivery >= state.path.length - 2) {
      setDelivery(state.path.length - 1);
      setArrived(true);
    } else setDelivery((i) => i + 1);
  }
  useEffect(() => {
    if (completed) {
      chime();
      toast.success(
        "¡Pizza entregada! El camino más corto, una pizza caliente.",
      );
    }
  }, [completed]);
  function obstacle(id: string) {
    if (!editing) return;
    if (id === city.start || id === city.goal) {
      toast.info("El origen y el destino deben permanecer disponibles");
      return;
    }
    setCity((c) => ({
      ...c,
      blocked: c.blocked.includes(id)
        ? c.blocked.filter((n) => n !== id)
        : [...c.blocked, id],
    }));
    reset();
  }
  const status = completed
    ? "Entrega completada"
    : found
      ? "Ruta óptima encontrada"
      : state.status === "unreachable"
        ? "Destino inalcanzable"
        : playing
          ? "Explorando la ciudad"
          : cursor
            ? "Búsqueda en pausa"
            : "Todo listo para salir";
  return (
    <>
      <Toaster richColors position="top-center" />
      <header>
        <a className="brand" href="#">
          <span className="brand-icon">
            <Pizza size={25} />
          </span>
          <span>
            RutaPizza <b>A*</b>
            <small>SIMULADOR INTELIGENTE DE RUTAS</small>
          </span>
        </a>
        <nav>
          <span className="nav-active">Simulador</span>
          <a href="#education">Cómo funciona A*</a>
        </nav>
        <div className="header-end">
          <span className="local">
            <i /> Sistema local
          </span>
          <button
            className="icon"
            aria-label={sound ? "Desactivar sonido" : "Activar sonido"}
            onClick={() => {
              setSound(!sound);
              if (!sound) {
                audio.current ??= new AudioContext();
                void audio.current.resume();
              }
            }}
          >
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        </div>
      </header>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ALGORITMOS QUE ENCUENTRAN EL CAMINO</div>
          <h1>
            Una buena ruta. Una pizza a tiempo<span>.</span>
          </h1>
          <p>Explora la ciudad y descubre cómo A* toma cada decisión.</p>
        </div>
        <span className="project-badge">
          <Zap size={15} /> Laboratorio interactivo <b>01</b>
        </span>
      </div>
      <main>
        <aside className="left">
          <section className="card dispatch">
            <div className="section-heading">
              <h2>Tu próxima entrega</h2>
              <span className="pill">EN VIVO</span>
            </div>
            <div className="courier">
              <div className="avatar">
                <Bike size={29} />
                <i />
              </div>
              <div>
                <strong>Alex, tu repartidor</strong>
                <small>Una ciudad. El mejor camino.</small>
              </div>
            </div>
            <div className="stops">
              <div>
                <span className="stop-dot orange" />
                <div>
                  <small>PUNTO DE PARTIDA</small>
                  <strong>Pizzería La Esquina</strong>
                  <span>Av. del Parque · Nodo {label(city.start)}</span>
                </div>
              </div>
              <div>
                <span className="stop-dot purple" />
                <div>
                  <small>DESTINO</small>
                  <strong>Casa de Sofía</strong>
                  <span>Calle Jacaranda · Nodo {label(city.goal)}</span>
                </div>
              </div>
            </div>
            <div className="trip-stats">
              <div>
                <strong>
                  {found ? state.path.length - 1 : "—"} <small>calles</small>
                </strong>
                <span>Distancia óptima</span>
              </div>
              <div>
                <strong>
                  {manhattan(city.start, city.goal)} <small>mov.</small>
                </strong>
                <span>Estimación inicial</span>
              </div>
            </div>
          </section>
          <section className="card controls">
            <div className="section-heading">
              <h2>Centro de control</h2>
              <span className="tiny-label">A*</span>
            </div>
            <label className="field-label" htmlFor="scenario">
              ESCENARIO DE LA CIUDAD
            </label>
            <select
              id="scenario"
              value={scenario}
              onChange={(e) => load(Number(e.target.value))}
            >
              <option value={1}>01 · Entrega sencilla</option>
              <option value={2}>02 · Tráfico y calles cerradas</option>
              <option value={3}>03 · Ciudad bloqueada</option>
            </select>
            <div className="seed-row">
              <label>
                Semilla
                <input
                  aria-label="Semilla"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  type="number"
                />
              </label>
              <button className="secondary" onClick={() => load(scenario)}>
                <Shuffle size={15} /> Generar
              </button>
            </div>
            <button
              className="primary"
              disabled={playing || found || state.status === "unreachable"}
              onClick={() => {
                enableAudio();
                setPlaying(true);
                if (cursor === 0) setCursor(1);
              }}
            >
              <Play size={17} fill="currentColor" />
              {cursor ? "Reproducir automáticamente" : "Iniciar búsqueda"}
              <ArrowRight size={17} />
            </button>
            <div className="step-controls">
              <button
                title="Paso anterior"
                disabled={!cursor}
                onClick={() => step(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                disabled={found || state.status === "unreachable"}
                onClick={() => (playing ? setPlaying(false) : step(1))}
              >
                {playing ? <Pause size={16} /> : <ChevronRight size={16} />}{" "}
                {playing ? "Pausar" : "Siguiente paso"}
              </button>
              <button title="Reiniciar simulación" onClick={reset}>
                <RotateCcw size={16} />
              </button>
            </div>
            <div className="speed">
              <label htmlFor="speed">Velocidad de búsqueda</label>
              <span>{(1000 / speed).toFixed(1)}×</span>
              <input
                id="speed"
                type="range"
                min="120"
                max="1300"
                value={1420 - speed}
                onChange={(e) => setSpeed(1420 - Number(e.target.value))}
              />
              <small>Paso a paso</small>
              <small>Más rápido</small>
            </div>
            <div className="divider" />
            <button
              className={`wide secondary ${editing ? "selected" : ""}`}
              onClick={() => {
                setEditing(!editing);
                setPlaying(false);
              }}
            >
              <Construction size={16} />
              {editing ? "Terminar edición" : "Agregar obstáculos"}
              <span>{editing ? "✓" : "+"}</span>
            </button>
            <button className="text-button" onClick={newCity}>
              <Shuffle size={13} /> Generar nueva ciudad
            </button>
            <button
              className="text-button"
              onClick={() => {
                setCity((c) => ({ ...c, blocked: [] }));
                reset();
              }}
            >
              Limpiar obstáculos
            </button>
            <button className="text-button danger" onClick={() => load(3)}>
              Probar destino inaccesible
            </button>
          </section>
          <div className="offline">
            <span>
              <Check size={14} />
            </span>
            <p>
              100% local, 100% explicable
              <small>Sin APIs. Solo algoritmos y pizza.</small>
            </p>
          </div>
        </aside>
        <section className="center">
          <CityMap
            city={city}
            state={state}
            editing={editing}
            delivery={delivery}
            speed={speed}
            showRoute={showRoute}
            obstacle={obstacle}
            onArrival={arrivedAtNode}
          />
          <section
            className={`card search-status ${state.status === "unreachable" ? "error" : completed ? "success" : ""}`}
          >
            <span className="status-icon">
              {completed ? (
                <Check />
              ) : state.status === "unreachable" ? (
                <X />
              ) : found ? (
                <MapPin />
              ) : (
                <Navigation />
              )}
            </span>
            <div>
              <h3>{status}</h3>
              <p>
                {completed
                  ? `${state.path.length - 1} movimientos · ${state.closed.length} nodos explorados`
                  : found
                    ? "La búsqueda terminó. Ahora comienza el recorrido del repartidor."
                    : state.status === "unreachable"
                      ? "La lista abierta quedó vacía. No existe un camino hasta la casa."
                      : "El repartidor espera mientras A* evalúa las mejores alternativas."}
              </p>
            </div>
            {found && (
              <button
                className="primary"
                disabled={delivering || completed}
                onClick={() => {
                  enableAudio();
                  setDelivery(0);
                  setArrived(false);
                }}
              >
                <Bike size={17} />
                {completed
                  ? "¡Pizza entregada!"
                  : delivering
                    ? "En camino…"
                    : "Iniciar entrega"}
              </button>
            )}
          </section>
          {found && (
            <section className="card route-summary">
              <div className="section-heading">
                <h2>
                  {completed ? "¡Pizza entregada!" : "Recorrido calculado"}
                </h2>
                <label>
                  <input
                    type="checkbox"
                    checked={showRoute}
                    onChange={(e) => setShowRoute(e.target.checked)}
                  />{" "}
                  Mostrar ruta óptima
                </label>
              </div>
              <div className="progress">
                <div
                  style={{
                    width: `${(Math.max(0, delivery) / (state.path.length - 1)) * 100}%`,
                  }}
                />
              </div>
              <p>
                Posición:{" "}
                {label(delivery >= 0 ? state.path[delivery] : city.start)} ·
                Costo acumulado: {Math.max(0, delivery)} /{" "}
                {state.path.length - 1}
              </p>
              <div className="path-sequence">
                {state.path.map((id, i) => (
                  <span key={id}>
                    {i > 0 && " → "}
                    {label(id)}
                  </span>
                ))}
              </div>
            </section>
          )}
          <section className="education card" id="education">
            <div className="education-icon">
              <CircleHelp size={22} />
            </div>
            <div>
              <div className="eyebrow">APRENDE MIENTRAS EXPLORAS</div>
              <h2>¿Cómo piensa el algoritmo A*?</h2>
              <p>
                {found
                  ? "El algoritmo encontró la ruta de menor costo. Siguiendo los padres reconstruye el camino; solo entonces se mueve el repartidor."
                  : state.status === "unreachable"
                    ? "Se exploraron todas las alternativas disponibles. Sin nodos pendientes, A* confirma que el destino es inaccesible."
                    : cursor
                      ? "El algoritmo analiza las calles vecinas y combina el costo recorrido con la distancia Manhattan. Siempre elige el menor f; en empates prefiere menor h y luego el identificador."
                      : "A* busca el camino más corto combinando lo que ya recorrió con una estimación de lo que falta. Inicia la búsqueda para ver sus decisiones."}
              </p>
              <span className="education-note">
                Explorar nodos no significa mover al repartidor.
              </span>
            </div>
          </section>
        </section>
        <aside className="right">
          <section className="card engine">
            <div className="section-heading">
              <h2>
                <span className="engine-icon">
                  <Zap size={17} />
                </span>
                Motor de búsqueda A*
              </h2>
              <span className="tiny-label">LIVE</span>
            </div>
            <div className="engine-status">
              <i className={playing ? "active" : ""} />
              {status}
            </div>
            <div className="current-node">
              <span>NODO ACTUAL</span>
              <strong>{state.current ? label(state.current) : "—"}</strong>
              <small>
                {state.current
                  ? `Coordenadas (${state.current})`
                  : "Esperando la primera iteración"}
              </small>
            </div>
            <div className="costs">
              <div>
                <span>g(n)</span>
                <strong>{current?.g ?? "—"}</strong>
                <small>Recorrido</small>
              </div>
              <b>+</b>
              <div>
                <span>h(n)</span>
                <strong>{current?.h ?? "—"}</strong>
                <small>Estimado</small>
              </div>
              <b>=</b>
              <div className="total">
                <span>f(n)</span>
                <strong>{current?.f ?? "—"}</strong>
                <small>Costo total</small>
              </div>
            </div>
            <div className="formula">
              {current
                ? `f(${label(current.id)}) = ${current.g} + ${current.h} = ${current.f}`
                : "f(n) = g(n) + h(n)"}
            </div>
            <dl className="metrics">
              <div>
                <dt>Nodos explorados</dt>
                <dd>{state.closed.length}</dd>
              </div>
              <div>
                <dt>Nodos pendientes</dt>
                <dd>{state.open.length}</dd>
              </div>
              <div>
                <dt>Iteración actual</dt>
                <dd>{state.iteration.toString().padStart(2, "0")}</dd>
              </div>
              <div>
                <dt>Mejor costo estimado</dt>
                <dd>{found ? current?.g : (state.open[0]?.f ?? "—")}</dd>
              </div>
            </dl>
            <div className="choice">
              <Zap size={16} />
              <p>
                {current
                  ? `${label(current.id)} fue seleccionado por su menor f (${current.f}); los empates se resuelven con h e identificador.`
                  : "El nodo con menor f(n) será el próximo en explorarse."}
              </p>
            </div>
            <div className="table-heading">
              <h3>Registro de nodos</h3>
              <span>{Object.keys(state.records).length} nodos</span>
            </div>
            <div className="table-scroll">
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
                          : a.f - b.f || a.h - b.h || a.id.localeCompare(b.id),
                    )
                    .map((n) => (
                      <tr
                        className={n.id === state.current ? "current-row" : ""}
                        key={n.id}
                      >
                        <td>{label(n.id)}</td>
                        <td>{n.g}</td>
                        <td>{n.h}</td>
                        <td>
                          <b>{n.f}</b>
                        </td>
                        <td>
                          <span
                            className={`table-state ${n.id === state.current ? "blue" : state.closed.includes(n.id) ? "gray" : "yellow"}`}
                          >
                            {n.id === state.current
                              ? "Actual"
                              : state.closed.includes(n.id)
                                ? "Evaluado"
                                : "Abierto"}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="table-foot">
              Costos reales · Cada calle vale 1 movimiento
            </p>
          </section>
          <section className="card decisions">
            <div className="section-heading">
              <h2>Decisiones del algoritmo</h2>
              <span className="tiny-label">{state.decisions.length}</span>
            </div>
            {state.decisions.length ? (
              state.decisions.map((d) => (
                <motion.div
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={`${cursor}-${d.id}`}
                  className={`decision ${d.kind}`}
                >
                  <span>
                    {d.kind === "blocked" ? (
                      <X size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>
                  <p>
                    <b>{label(d.id)}</b> · {d.message}
                  </p>
                </motion.div>
              ))
            ) : (
              <p className="muted">
                {found
                  ? "Exploración completada: ruta óptima encontrada."
                  : "Las decisiones de cada iteración aparecerán aquí."}
              </p>
            )}
            {state.decisions.some((d) => d.kind === "blocked") && (
              <p className="decision-note">
                Buscando otra ruta disponible. A* cambia de nodo; el repartidor
                permanece en la pizzería.
              </p>
            )}
          </section>
        </aside>
      </main>
      <footer>
        <span>
          <Pizza size={15} /> Hecho para aprender, diseñado para explorar.
        </span>
        <span>A* · Distancia Manhattan · Costo uniforme</span>
      </footer>
    </>
  );
}
