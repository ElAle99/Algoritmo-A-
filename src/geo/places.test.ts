import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const element = {
  type: "node",
  id: 123,
  lon: -88.392,
  lat: 18.676,
  tags: { amenity: "restaurant", name: "Dato de prueba", cuisine: "pizza" },
};
describe("Overpass acotado y caché", () => {
  beforeEach(() => {
    vi.resetModules();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("agrupa peticiones simultáneas y reutiliza los resultados sin otra consulta", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ elements: [element] }),
      });
    vi.stubGlobal("fetch", fetch);
    const { refreshPlaces } = await import("./places");
    const first = refreshPlaces(),
      second = refreshPlaces();
    expect(first).toBe(second);
    expect((await first)[0].name).toBe("Dato de prueba");
    await refreshPlaces();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = fetch.mock.calls[0][1].body.toString();
    expect(decodeURIComponent(body)).toContain("18.669,-88.402,18.685,-88.384");
  });
  it("no reintenta automáticamente fallos de red y aplica un enfriamiento", async () => {
    const fetch = vi.fn().mockRejectedValue(Error("Offline"));
    vi.stubGlobal("fetch", fetch);
    const { refreshPlaces } = await import("./places");
    await expect(refreshPlaces()).rejects.toThrow("Offline");
    await expect(refreshPlaces()).rejects.toThrow("Espera un minuto");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rechaza resultados parciales y no los guarda", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ elements: [element], remark: "Timeout" }),
        }),
    );
    const { refreshPlaces, cachedPlaces } = await import("./places");
    await expect(refreshPlaces()).rejects.toThrow("Respuesta incompleta");
    expect(cachedPlaces()).toEqual([]);
  });
  it("tolera almacenamiento bloqueado y conserva puntos personalizados válidos", async () => {
    const { saveCustomPlaces, readCustomPlaces } = await import("./places");
    saveCustomPlaces([
      {
        id: "custom/1",
        name: "Mi punto",
        coordinate: [-88.39, 18.67],
        category: "Punto personalizado",
        custom: true,
        tags: {},
      },
    ]);
    expect(readCustomPlaces()).toHaveLength(1);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("Unavailable");
      },
      setItem: () => {
        throw Error("Unavailable");
      },
    });
    expect(() => saveCustomPlaces([])).not.toThrow();
    expect(readCustomPlaces()).toEqual([]);
  });
});
