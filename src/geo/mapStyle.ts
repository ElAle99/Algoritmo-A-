import type { StyleSpecification } from "maplibre-gl";
export const localStyle = (): StyleSpecification => ({
  version: 8,
  name: "RutaPizza · Red vial local OSM",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#edf1ef" },
    },
  ],
});
/** Retain provider sources/attributions; customize only presentation. */
export function navigationStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    name: "RutaPizza · Bacalar",
    layers: style.layers.map((layer) => {
      const id = layer.id.toLowerCase();
      if (layer.type === "background")
        return {
          ...layer,
          paint: { ...layer.paint, "background-color": "#f1f3f1" },
        };
      if (layer.type === "fill" && id.includes("water"))
        return { ...layer, paint: { ...layer.paint, "fill-color": "#a9ddd9" } };
      if (
        layer.type === "fill" &&
        (id.includes("park") || id.includes("landcover"))
      )
        return {
          ...layer,
          paint: {
            ...layer.paint,
            "fill-color": "#d9e8d3",
            "fill-opacity": 0.65,
          },
        };
      if (layer.type === "fill" && id.includes("building"))
        return {
          ...layer,
          paint: {
            ...layer.paint,
            "fill-color": "#dce1dc",
            "fill-outline-color": "#d1d8d2",
          },
        };
      if (
        layer.type === "line" &&
        (id.includes("road") || id.includes("highway")) &&
        !id.includes("rail")
      )
        return {
          ...layer,
          paint: {
            ...layer.paint,
            "line-color": id.includes("casing") ? "#d9dfdb" : "#ffffff",
          },
        };
      if (layer.type === "symbol" && id.includes("poi"))
        return { ...layer, layout: { ...layer.layout, visibility: "none" } };
      if (
        layer.type === "symbol" &&
        (id.includes("road") || id.includes("place"))
      )
        return {
          ...layer,
          paint: {
            ...layer.paint,
            "text-color": "#6c7e79",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        };
      return layer;
    }),
  };
}
