import {
  snapPoint,
  searchRoads,
  distance,
  type RoadGraph,
  type Place,
  type SelectedPoint,
} from "./graph";
export function demoEndpoints(
  graph: RoadGraph,
  places: Place[],
): { origin: SelectedPoint; destination: SelectedPoint } {
  const origins = [
    ...places.filter((p) => p.name === "Don Mostado Pizza"),
    ...places.filter((p) => p.category === "Pizzería"),
  ];
  const destinations = [
    ...places.filter((p) => p.name === "Vico's"),
    ...places.filter(
      (p) => p.category === "Escuela" || p.category === "Parque",
    ),
  ];
  for (const start of origins) {
    const origin = snapPoint(graph, start.coordinate, "origin");
    if (!origin) continue;
    for (const goal of destinations) {
      const destination = snapPoint(graph, goal.coordinate, "destination");
      if (
        !destination ||
        distance(origin.coordinate, destination.coordinate) < 250
      )
        continue;
      if (
        searchRoads(graph, origin.nodeId, destination.nodeId).at(-1)!.status ===
        "found"
      )
        return {
          origin: { ...origin, name: start.name },
          destination: { ...destination, name: goal.name },
        };
    }
  }
  throw Error(
    "El extracto no contiene los extremos conectados de la demostración.",
  );
}
