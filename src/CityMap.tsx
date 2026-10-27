import { useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Bike,
  Home,
  Navigation,
  Pizza,
  Plus,
  Minus,
  Crosshair,
} from "lucide-react";
import { point, label, type City, type Snapshot } from "./algorithm";
const xy = (id: string) => {
  const p = point(id);
  return { x: 74 + p.x * 88, y: 70 + p.y * 78 };
};
const routePoints = (ids: string[]) =>
  ids
    .map((id) => {
      const p = xy(id);
      return `${p.x},${p.y}`;
    })
    .join(" ");
interface Props {
  city: City;
  state: Snapshot;
  editing: boolean;
  delivery: number;
  speed: number;
  showRoute: boolean;
  obstacle: (id: string) => void;
  onArrival: () => void;
}
export default function CityMap({
  city,
  state,
  editing,
  delivery,
  speed,
  showRoute,
  obstacle,
  onArrival,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const found = state.status === "found";
  const source = xy(delivery >= 0 && found ? state.path[delivery] : city.start);
  const next =
    found && delivery >= 0
      ? state.path[Math.min(delivery + 1, state.path.length - 1)]
      : city.start;
  const target = xy(next);
  const rider = target;
  const angle =
    delivery >= 0
      ? (Math.atan2(target.y - source.y, target.x - source.x) * 180) / Math.PI
      : 0;
  return (
    <div className="card map-card">
      <div className="map-top">
        <div>
          <span className="live-dot" />
          <strong>Distrito Primavera</strong>
          <small>Ciudad de simulación</small>
        </div>
        <span className="map-tag">
          {editing ? "EDICIÓN DE CALLES" : "VISTA EN VIVO"}
        </span>
      </div>
      <div
        className={`map-viewport ${editing ? "editing" : ""}`}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-node]")) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setPan({
              x: drag.current.px + (e.clientX - drag.current.x) / zoom,
              y: drag.current.py + (e.clientY - drag.current.y) / zoom,
            });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <svg
          viewBox="0 0 770 690"
          role="img"
          aria-label="Mapa interactivo de Distrito Primavera"
        >
          <defs>
            <pattern
              id="dots"
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r=".6" fill="#d5ddd9" />
            </pattern>
            <filter id="shadow">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity=".08" />
            </filter>
          </defs>
          <rect width="770" height="690" fill="#edf1ed" />
          <rect width="770" height="690" fill="url(#dots)" />
          <g
            transform={`translate(${385 + pan.x} ${345 + pan.y}) scale(${zoom}) translate(-385 -345)`}
          >
            {Array.from({ length: 7 }, (_, y) =>
              Array.from({ length: 7 }, (_, x) => {
                const park =
                  (x === 2 && y === 2) ||
                  (x === 5 && y === 5) ||
                  (x === 0 && y === 0);
                return (
                  <g key={`${x}-${y}`}>
                    <rect
                      x={86 + x * 88}
                      y={82 + y * 78}
                      width="64"
                      height="54"
                      rx="9"
                      fill={park ? "#cce3c9" : "#e0e5df"}
                    />
                    {park ? (
                      <>
                        {[0, 1, 2].map((i) => (
                          <g key={i}>
                            <circle
                              cx={100 + x * 88 + i * 16}
                              cy={98 + y * 78 + (i % 2) * 15}
                              r="8"
                              fill="#a4c99c"
                            />
                            <circle
                              cx={98 + x * 88 + i * 16}
                              cy={96 + y * 78 + (i % 2) * 15}
                              r="5"
                              fill="#b7d6ac"
                            />
                          </g>
                        ))}
                      </>
                    ) : (
                      <>
                        <rect
                          x={91 + x * 88}
                          y={87 + y * 78}
                          width={x % 2 ? 22 : 49}
                          height="21"
                          rx="3"
                          fill={["#d0d8d4", "#d9d6cd", "#d0d9de"][(x + y) % 3]}
                          stroke="#c7cfc9"
                          filter="url(#shadow)"
                        />
                        <rect
                          x={96 + x * 88}
                          y={114 + y * 78}
                          width="43"
                          height="15"
                          rx="3"
                          fill="#d4dcd6"
                        />
                      </>
                    )}
                  </g>
                );
              }),
            )}
            {Array.from({ length: 8 }, (_, i) => (
              <g key={i}>
                <path
                  d={`M 74 ${70 + i * 78} H 690 M ${74 + i * 88} 70 V 616`}
                  stroke="#dce2df"
                  strokeWidth="25"
                  strokeLinecap="round"
                />
                <path
                  d={`M 74 ${70 + i * 78} H 690 M ${74 + i * 88} 70 V 616`}
                  stroke="white"
                  strokeWidth="20"
                  strokeLinecap="round"
                />
                <path
                  d={`M 74 ${70 + i * 78} H 690 M ${74 + i * 88} 70 V 616`}
                  stroke="#e7ebe7"
                  strokeWidth="1"
                  strokeDasharray="5 7"
                />
              </g>
            ))}
            <g className="street-label">
              <text x="310" y="55">
                AVENIDA JACARANDA
              </text>
              <text x="270" y="551">
                AVENIDA DEL PARQUE
              </text>
              <text x="44" y="380" transform="rotate(-90 44 380)">
                CALLE OLIVO
              </text>
              <text x="724" y="420" transform="rotate(-90 724 420)">
                PASEO PRIMAVERA
              </text>
              <text x="256" y="278" className="park-label">
                Parque Central
              </text>
            </g>
            {state.current && (
              <g>
                {Object.values(state.records)
                  .filter((n) => n.parent)
                  .map((n) => (
                    <line
                      key={n.id}
                      x1={xy(n.parent!).x}
                      y1={xy(n.parent!).y}
                      x2={xy(n.id).x}
                      y2={xy(n.id).y}
                      stroke="#a9b9c9"
                      strokeWidth="3"
                      strokeDasharray="4 5"
                      opacity=".65"
                    />
                  ))}
              </g>
            )}
            {found && showRoute && (
              <motion.polyline
                key={city.seed + city.blocked.join("")}
                points={routePoints(state.path)}
                fill="none"
                stroke="#22a675"
                strokeWidth="7"
                strokeLinejoin="round"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.2 }}
              />
            )}
            {Array.from({ length: 64 }, (_, i) => {
              const id = `${i % 8},${Math.floor(i / 8)}`,
                p = xy(id),
                blocked = city.blocked.includes(id),
                isCurrent = state.current === id,
                open = state.open.some((n) => n.id === id),
                closed = state.closed.includes(id),
                neighbor = state.decisions.some((d) => d.id === id);
              return (
                <g
                  data-node
                  key={id}
                  role="button"
                  tabIndex={editing ? 0 : -1}
                  aria-label={`Nodo ${label(id)}${blocked ? ", bloqueado" : ""}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      obstacle(id);
                    }
                  }}
                  onClick={() => obstacle(id)}
                  className={editing ? "node-edit" : ""}
                >
                  <title>
                    {label(id)} · ({id})
                    {state.records[id]
                      ? ` · g=${state.records[id].g}, h=${state.records[id].h}, f=${state.records[id].f}`
                      : ""}
                  </title>
                  <circle cx={p.x} cy={p.y} r="15" fill="transparent" />
                  {neighbor && !blocked && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="13"
                      fill="none"
                      stroke="#85b0e6"
                      strokeDasharray="3 3"
                    />
                  )}
                  {blocked ? (
                    <g>
                      <rect
                        x={p.x - 10}
                        y={p.y - 8}
                        width="20"
                        height="16"
                        rx="5"
                        fill="#fff0ec"
                        stroke="#e78474"
                      />
                      <path
                        d={`M ${p.x - 5} ${p.y - 4} l 10 8 m -10 0 l 10 -8`}
                        stroke="#d86754"
                        strokeWidth="2"
                      />
                    </g>
                  ) : (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={isCurrent ? 8 : open || closed ? 6 : 3}
                      fill={
                        isCurrent
                          ? "#347bed"
                          : open
                            ? "#f2c65b"
                            : closed
                              ? "#a7b4c2"
                              : "#d6dfdc"
                      }
                      stroke="white"
                      strokeWidth="2"
                    />
                  )}
                </g>
              );
            })}
            <g
              transform={`translate(${xy(city.start).x} ${xy(city.start).y - 35})`}
            >
              <rect
                x="-28"
                y="-20"
                width="56"
                height="38"
                rx="11"
                fill="#fff"
                filter="url(#shadow)"
              />
              <Pizza x="-12" y="-15" size={24} color="#ed714b" />
              <text y="32" textAnchor="middle" className="poi-label">
                La Esquina
              </text>
            </g>
            <g
              transform={`translate(${xy(city.goal).x} ${xy(city.goal).y - 38})`}
            >
              <path d="M 0 30 L -9 14 H 9 Z" fill="#8d6bd1" />
              <rect
                x="-23"
                y="-26"
                width="46"
                height="42"
                rx="13"
                fill="#8d6bd1"
              />
              <Home x="-12" y="-17" size={24} color="white" />
              <text y="51" textAnchor="middle" className="poi-label">
                Casa de Sofía
              </text>
            </g>
            <motion.g
              onAnimationComplete={onArrival}
              animate={{ x: rider.x, y: rider.y }}
              transition={{
                duration: Math.max(0.1, speed / 1000),
                ease: "linear",
              }}
            >
              <circle r="18" fill="#fff" filter="url(#shadow)" />
              <circle r="14" fill="#273e43" />
              <g transform={`rotate(${angle})`}>
                <Bike x="-10" y="-10" size={20} color="white" />
              </g>
            </motion.g>
          </g>
        </svg>
        <div className="map-float">
          <span className="compass">
            N<Navigation size={17} />
          </span>
          <div>
            <button
              aria-label="Acercar mapa"
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
            >
              <Plus size={18} />
            </button>
            <button
              aria-label="Alejar mapa"
              onClick={() => setZoom((z) => Math.max(0.65, z - 0.2))}
            >
              <Minus size={18} />
            </button>
            <button
              aria-label="Centrar mapa"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              <Crosshair size={18} />
            </button>
          </div>
        </div>
        <div className="map-caption">
          <span>
            <i />
            {editing
              ? "Haz clic en una intersección para cerrar o abrir la calle"
              : "Arrastra para explorar · Usa + y − para acercar"}
          </span>
          <span>100 m ━━━</span>
        </div>
      </div>
      <div className="legend">
        {[
          ["#347bed", "Actual"],
          ["#f2c65b", "Abiertos"],
          ["#a7b4c2", "Evaluados"],
          ["#df7966", "Bloqueos"],
          ["#22a675", "Ruta óptima"],
          ["#8d6bd1", "Destino"],
        ].map(([color, name]) => (
          <span key={name}>
            <i style={{ background: color }} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
