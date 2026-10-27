import { lazy, Suspense, useState } from "react";
import { Globe2, Grid2X2, Pizza } from "lucide-react";
import App from "./App";
const BacalarApp = lazy(() => import("./regional/Gateway"));
export default function ModeApp() {
  const [mode, setMode] = useState<"simulation" | "bacalar">(() =>
    location.hash === "#bacalar" ? "bacalar" : "simulation",
  );
  return (
    <>
      <div className="mode-bar">
        <span>
          <Pizza size={15} /> RutaPizza A* <b>Bacalar Smart Delivery</b>
        </span>
        <div role="group" aria-label="Modalidad de mapa">
          <button
            aria-pressed={mode === "simulation"}
            onClick={() => {
              setMode("simulation");
              history.replaceState(null, "", location.pathname);
            }}
          >
            <Grid2X2 size={14} /> Modo Simulación
          </button>
          <button
            aria-pressed={mode === "bacalar"}
            onClick={() => {
              setMode("bacalar");
              history.replaceState(null, "", "#bacalar");
            }}
          >
            <Globe2 size={14} /> Modo Bacalar Real
          </button>
        </div>
        <small>UNA CIUDAD · DOS FORMAS DE EXPLORAR</small>
      </div>
      <div hidden={mode !== "simulation"}>
        <App />
      </div>
      {mode === "bacalar" && (
        <Suspense
          fallback={
            <div className="bacalar-loading">Cargando cartografía…</div>
          }
        >
          <BacalarApp />
        </Suspense>
      )}
    </>
  );
}
