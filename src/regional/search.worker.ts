/// <reference lib="webworker" />
import { regionalTrace, type RouteOptions } from "./routing";
import type { RegionalNetwork } from "./network";
type Request = {
  id: number;
  network: RegionalNetwork;
  start: string;
  goal: string;
  options: RouteOptions;
};
self.onmessage = (event: MessageEvent<Request>) => {
  const { id, network, start, goal, options } = event.data;
  try {
    const time = performance.now();
    const events = regionalTrace(network, start, goal, options);
    self.postMessage({ id, events, milliseconds: performance.now() - time });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
