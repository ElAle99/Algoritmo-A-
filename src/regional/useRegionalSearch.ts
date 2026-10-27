import { useEffect, useMemo, useState } from "react";
import type { SearchEvent } from "../astar";
import type { RegionalNetwork } from "./network";
import type { RouteOptions } from "./routing";
export function useRegionalSearch(
  network: RegionalNetwork,
  start: string,
  goal: string,
  options: RouteOptions,
) {
  const token = useMemo(() => ({}), [network, start, goal, options]);
  const [result, setResult] = useState<{
    token: object;
    events: SearchEvent[];
    milliseconds: number;
    error?: string;
  } | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL("./search.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) =>
      setResult({
        token,
        events: event.data.events ?? [],
        milliseconds: event.data.milliseconds ?? 0,
        error: event.data.error,
      });
    worker.onerror = () =>
      setResult({
        token,
        events: [],
        milliseconds: 0,
        error: "No se pudo ejecutar el worker local de búsqueda.",
      });
    worker.postMessage({ id: 1, network, start, goal, options });
    return () => worker.terminate();
  }, [token, network, start, goal, options]);
  return result?.token === token
    ? { ...result, busy: false }
    : { events: [], milliseconds: 0, error: undefined, busy: true };
}
