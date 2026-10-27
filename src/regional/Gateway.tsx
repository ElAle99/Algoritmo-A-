import { lazy, Suspense, useState } from "react";
const RegionalApp = lazy(() => import("./RegionalApp"));
const CentralApp = lazy(() => import("../geo/BacalarApp"));
export default function Gateway() {
  const [scope, setScope] = useState("regional");
  return (
    <>
      <div className="regional-scope">
        <label htmlFor="coverage-mode">Red de cálculo</label>
        <select
          id="coverage-mode"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="regional">Bacalar ampliado · UPB + Cenote Azul</option>
          <option value="central">Centro · demostración anterior</option>
        </select>
        <span>
          El simulador SVG y el escenario central permanecen disponibles.
        </span>
      </div>
      <Suspense
        fallback={<div className="bacalar-loading">Cargando modalidad…</div>}
      >
        {scope === "regional" ? <RegionalApp /> : <CentralApp />}
      </Suspense>
    </>
  );
}
