import { MinHeap } from "./heap";
/** Shared A*: no UI, map provider or routing-service dependency. */
export type RecordNode = {
  id: string;
  g: number;
  h: number;
  f: number;
  parent: string | null;
  via?: string;
};
export type Decision = {
  id: string;
  edgeId?: string;
  kind: "blocked" | "closed" | "improved" | "discovered" | "unchanged";
  message: string;
};
export type Snapshot = {
  current: string | null;
  open: RecordNode[];
  closed: string[];
  records: Record<string, RecordNode>;
  decisions: Decision[];
  path: string[];
  pathEdges: string[];
  status: "ready" | "searching" | "found" | "unreachable";
  iteration: number;
};
export type SearchArc = {
  id: string;
  cost: number;
  edgeId?: string;
  blocked?: boolean;
};
export type SearchProblem = {
  start: string;
  goal: string;
  heuristic: (id: string) => number;
  neighbors: (id: string) => SearchArc[];
  isGoal?: (id: string) => boolean;
};
export const compare = (a: RecordNode, b: RecordNode) =>
  a.f - b.f || a.h - b.h || a.id.localeCompare(b.id);
export function reconstruct(
  records: Record<string, RecordNode>,
  id: string,
): string[] {
  const path: string[] = [],
    seen = new Set<string>();
  let next: string | null = id;
  while (next !== null) {
    if (seen.has(next) || !records[next])
      throw Error("Cadena de padres inválida");
    seen.add(next);
    path.unshift(next);
    next = records[next].parent;
  }
  return path;
}

export type SearchEvent = {
  current: string | null;
  updates: RecordNode[];
  decisions: Decision[];
  status: Snapshot["status"];
  iteration: number;
  path: string[];
  pathEdges: string[];
};
/** The generator is the single expansion engine used by SVG, legacy and regional routing. */
export function* iterateSearch(problem: SearchProblem): Generator<SearchEvent> {
  const { start, goal, heuristic, neighbors } = problem;
  const h = heuristic(start);
  const records: Record<string, RecordNode> = {
    [start]: { id: start, g: 0, h, f: h, parent: null },
  };
  const open = new Set([start]),
    closed = new Set<string>(),
    heap = new MinHeap<RecordNode>(compare);
  heap.push(records[start]);
  let iteration = 0;
  yield {
    current: null,
    updates: [records[start]],
    decisions: [],
    status: "ready",
    iteration: 0,
    path: [],
    pathEdges: [],
  };
  while (heap.size) {
    const selected = heap.pop()!;
    if (!open.has(selected.id) || records[selected.id] !== selected) continue;
    const current = selected.id;
    open.delete(current);
    closed.add(current);
    iteration++;
    if (problem.isGoal ? problem.isGoal(current) : current === goal) {
      const path = reconstruct(records, current);
      yield {
        current,
        updates: [],
        decisions: [],
        status: "found",
        iteration,
        path,
        pathEdges: path
          .slice(1)
          .map((id) => records[id].via)
          .filter((id): id is string => !!id),
      };
      return;
    }
    const decisions: Decision[] = [],
      updates: RecordNode[] = [];
    for (const arc of neighbors(current)) {
      const { id, edgeId } = arc;
      if (arc.blocked) {
        decisions.push({
          id,
          edgeId,
          kind: "blocked",
          message:
            "Calle cerrada o movimiento restringido: alternativa descartada",
        });
        continue;
      }
      if (!Number.isFinite(arc.cost) || arc.cost < 0)
        throw Error("A* requiere costos finitos y no negativos");
      if (closed.has(id)) {
        decisions.push({
          id,
          edgeId,
          kind: "closed",
          message: "Nodo ya evaluado: no mejora el costo",
        });
        continue;
      }
      const g = selected.g + arc.cost,
        known = !!records[id],
        improved = !known || g < records[id].g;
      if (improved) {
        const h = heuristic(id);
        records[id] = {
          id,
          g,
          h,
          f: g + h,
          parent: current,
          ...(edgeId ? { via: edgeId } : {}),
        };
        updates.push(records[id]);
        open.add(id);
        heap.push(records[id]);
      }
      decisions.push({
        id,
        edgeId,
        kind: improved ? (known ? "improved" : "discovered") : "unchanged",
        message: improved
          ? known
            ? "Se encontr? un camino de menor costo"
            : "Alternativa disponible: se agrega a la lista abierta"
          : "El camino conocido tiene un costo igual o menor",
      });
    }
    yield {
      current,
      updates,
      decisions,
      status: open.size ? "searching" : "unreachable",
      iteration,
      path: [],
      pathEdges: [],
    };
  }
}
/** Compact O(expansions + relaxations) history; snapshots are materialized only on demand. */
export class TracePlayer {
  private index = -1;
  private records: Record<string, RecordNode> = {};
  private open = new Set<string>();
  private closed = new Set<string>();
  constructor(public events: SearchEvent[]) {}
  at(index: number): Snapshot {
    index = Math.max(0, Math.min(index, this.events.length - 1));
    if (index < this.index) {
      this.index = -1;
      this.records = {};
      this.open.clear();
      this.closed.clear();
    }
    while (this.index < index) {
      const event = this.events[++this.index];
      for (const record of event.updates) {
        this.records[record.id] = record;
        this.open.add(record.id);
      }
      if (event.current) {
        this.open.delete(event.current);
        this.closed.add(event.current);
      }
    }
    const e = this.events[index];
    return {
      current: e.current,
      status: e.status,
      iteration: e.iteration,
      decisions: e.decisions,
      path: e.path,
      pathEdges: e.pathEdges,
      records: { ...this.records },
      open: [...this.open].map((id) => this.records[id]).sort(compare),
      closed: [...this.closed],
    };
  }
}
export function searchGraph(problem: SearchProblem): Snapshot[] {
  const events = [...iterateSearch(problem)],
    player = new TracePlayer(events);
  return events.map((_, i) => player.at(i));
}
