import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
/** Real browser integration: compare the actual MapLibre source with exported A* GeoJSON. */
export async function checkBacalar({ send, evaluate, click, waitFor, delay }) {
  await waitFor(`!!document.querySelector('.mode-bar')`);
  await click("Modo Bacalar Real");
  await waitFor(`!!document.querySelector('#coverage-mode')`);
  await evaluate(
    `(()=>{const s=document.querySelector('#coverage-mode');s.value='central';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitFor(`!!document.querySelector('.geo-trip-panel')`);
  await waitFor(
    `document.querySelector('.bacalar-canvas').routeMap?.getSource('streets')!==undefined`,
  );
  await click("Usar fondo local");
  await waitFor(
    `document.querySelector('.geo-base-controls').textContent.includes('Fondo local')`,
  );
  const map = `document.querySelector('.bacalar-canvas').routeMap`;
  await waitFor(`!!${map}.getSource('nodes')`);
  await waitFor(
    `${map}.isSourceLoaded('streets') && ${map}.querySourceFeatures('streets').length>0`,
  );
  assert.ok(await evaluate(`${map}.getCanvas().width>0`));
  await click("Motor A*");
  const clickAria = (label) =>
    evaluate(
      `document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`,
    );
  await clickAria("Siguiente paso Bacalar");
  await waitFor(
    `document.querySelector('.geo-education>div>span').textContent==='Paso 1'`,
  );
  const first = await evaluate(
    `document.querySelector('.geo-engine').textContent`,
  );
  await clickAria("Siguiente paso Bacalar");
  await clickAria("Paso anterior Bacalar");
  await delay(100);
  assert.equal(
    await evaluate(`document.querySelector('.geo-engine').textContent`),
    first,
  );
  const nodes = await evaluate(
    `(async()=>{const s=await ${map}.getSource('nodes').getData();return s.features.filter(f=>f.properties.status==='current').map(f=>f.id);})()`,
  );
  assert.equal(
    nodes.length,
    1,
    "Current node layer must track the restored snapshot",
  );
  await click("Mostrar exploración A*");
  assert.equal(
    await evaluate(`${map}.getLayoutProperty('node-points','visibility')`),
    "none",
  );
  await click("Mostrar exploración A*");
  await evaluate(
    `(()=>{const input=document.querySelector('#geo-speed');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'12');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await click("Reproducir búsqueda");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Ruta óptima encontrada'`,
  );
  await waitFor(
    `${map}.queryRenderedFeatures({layers:['route-line']}).length>0`,
  );
  const route = await evaluate(
    `(async()=>{return (await ${map}.getSource('route').getData()).features[0];})()`,
  );
  assert.ok(route.properties.edgeIds.length > 1);
  assert.equal(
    route.properties.nodeIds.length,
    route.properties.edgeIds.length + 1,
  );
  assert.ok(route.properties.cost > 1000 && route.properties.cost < 1100);
  // Independently verify all route coordinates against the downloaded OSM way node sequences.
  const raw = JSON.parse(
    await readFile("public/data/bacalar-osm.json", "utf8"),
  );
  const rawNodes = new Map(
    raw.elements
      .filter((e) => e.type === "node")
      .map((n) => [n.id, [n.lon, n.lat]]),
  );
  const rawWays = new Map(
    raw.elements.filter((e) => e.type === "way").map((w) => [w.id, w]),
  );
  const expected = route.properties.edgeIds.flatMap((id, index) => {
    const [, wayId, a, b, direction] = id.match(/^w(\d+):(\d+)-(\d+):([fr])$/);
    let coords = rawWays
      .get(Number(wayId))
      .nodes.slice(Number(a), Number(b) + 1)
      .map((id) => rawNodes.get(id));
    if (direction === "r") coords.reverse();
    return index ? coords.slice(1) : coords;
  });
  assert.deepEqual(
    route.geometry.coordinates,
    expected,
    "The rendered route must be exactly the OSM geometry of A* edges",
  );
  await click("Iniciar entrega");
  await evaluate(
    `document.querySelector('.geo-delivery-progress input').click()`,
  );
  await delay(500);
  await click("Pausar entrega");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Entrega en pausa'`,
  );
  const paused = await evaluate(
    `document.querySelector('.geo-delivery-progress>div').textContent`,
  );
  await delay(350);
  assert.equal(
    await evaluate(
      `document.querySelector('.geo-delivery-progress>div').textContent`,
    ),
    paused,
  );
  await click("Reanudar entrega");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='¡Pizza entregada!'`,
  );
  assert.ok(
    (
      await evaluate(
        `document.querySelector('.geo-delivery-progress').textContent`,
      )
    ).includes("100%"),
  );
  await delay(400);
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(
    join(tmpdir(), "rutapizza-bacalar-desktop.png"),
    Buffer.from(shot.data, "base64"),
  );
  // Click a street via MapLibre's hit detection, then verify both source and history reset.
  await click("Cerrar / reabrir calle");
  const testPoint = await evaluate(
    `(()=>{const p=${map}.project(${JSON.stringify(route.geometry.coordinates[Math.floor(route.geometry.coordinates.length / 2)])});return {x:p.x,y:p.y};})()`,
  );
  await evaluate(
    `void ${map}.fire('click',{point:new (${map}.project([0,0]).constructor)(${testPoint.x},${testPoint.y}),lngLat:${map}.unproject([${testPoint.x},${testPoint.y}]),originalEvent:{target:${map}.getCanvas()}})`,
  );
  await waitFor(
    `document.querySelector('.geo-closure-count').textContent.startsWith('1 ')`,
  );
  await click("Terminar cierres");
  await clickAria("Limpiar cierres");
  await evaluate(
    `(()=>{const select=document.querySelector('#geo-scenario');select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await click("Calcular ruta con A*");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Ruta óptima encontrada'`,
  );
  const detour = await evaluate(
    `(async()=>{const s=await ${map}.getSource('route').getData();const streets=await ${map}.getSource('streets').getData();return {route:s.features[0],blocked:streets.features.filter(f=>f.properties.blocked).map(f=>f.properties.id),previous:(await ${map}.getSource('previous').getData()).features.length};})()`,
  );
  assert.equal(detour.previous, 1);
  assert.ok(
    detour.route.properties.edgeIds.every(
      (id) => !detour.blocked.includes(id.slice(0, -2)),
    ),
  );
  assert.ok(detour.route.properties.cost >= route.properties.cost);
  // Browser offline: the local graph and GeoJSON layers must still calculate the inaccessible scenario.
  await send("Network.enable");
  await send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await click("Actualizar comercios con Overpass");
  await waitFor(
    `document.querySelector('.geo-places-status').textContent.includes('catálogo local conservado')`,
  );
  await evaluate(
    `(()=>{const select=document.querySelector('#geo-scenario');select.value='3';select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await click("Calcular ruta con A*");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Destino inaccesible'`,
  );
  assert.equal(
    await evaluate(
      `(async()=>{return (await ${map}.getSource('route').getData()).features.length})()`,
    ),
    0,
  );
  assert.equal(
    await evaluate(`!!document.querySelector('.geo-deliver')`),
    false,
  );
  await send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await evaluate(
    `(()=>{const i=document.querySelector('[aria-label="Buscar negocios, calles y lugares"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Don Mostado');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await waitFor(`document.querySelectorAll('.geo-results>button').length===1`);
  await click("Don Mostado Pizza");
  await waitFor(`!!document.querySelector('.geo-place-card')`);
  assert.ok(
    (
      await evaluate(`document.querySelector('.geo-place-card').textContent`)
    ).includes("PIZZERÍA"),
  );
  await clickAria("Cerrar lugar");
  await click("Agregar punto personalizado");
  await evaluate(
    `(()=>{const i=document.querySelector('[aria-label="Nombre del punto personalizado"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Punto de exposición');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await evaluate(
    `void ${map}.fire('click',{point:${map}.project([-88.3923678,18.6758227]),lngLat:${map}.unproject(${map}.project([-88.3923678,18.6758227])),originalEvent:{target:${map}.getCanvas()}})`,
  );
  await click("Guardar solo en la simulación");
  await waitFor(
    `document.querySelector('.geo-place-card h2')?.textContent==='Punto de exposición'`,
  );
  assert.equal(
    await evaluate(
      `JSON.parse(localStorage.getItem('rutapizza-custom-pois')).length`,
    ),
    1,
  );
  await click("Ir aquí");
  await waitFor(
    `document.querySelector('.geo-endpoint:last-child strong').textContent==='Punto de exposición'`,
  );
  await evaluate(
    `(()=>{const i=document.querySelector('[aria-label="Buscar negocios, calles y lugares"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Punto de exposición');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click("Punto de exposición");
  await waitFor(`!!document.querySelector('.geo-delete-custom')`);
  await click("Eliminar punto personalizado");
  assert.equal(
    await evaluate(
      `JSON.parse(localStorage.getItem('rutapizza-custom-pois')).length`,
    ),
    0,
  );
  await click("Modo Simulación");
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-node]').length`),
    64,
  );
  await click("Modo Bacalar Real");
  await waitFor(`!!document.querySelector('#coverage-mode')`);
  await evaluate(
    `(()=>{const s=document.querySelector('#coverage-mode');s.value='central';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitFor(`!!document.querySelector('.geo-trip-panel')`);
  await waitFor(
    `!!document.querySelector('.bacalar-canvas').routeMap?.getSource('route')`,
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(350);
  assert.ok(
    await evaluate(`document.documentElement.scrollWidth<=390`),
    "Mobile layout overflows",
  );
  const mobile = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(
    join(tmpdir(), "rutapizza-bacalar-mobile.png"),
    Buffer.from(mobile.data, "base64"),
  );
  console.log(
    "Bacalar browser passed: MapLibre/WebGL, snapshots/layers, route exactly matches raw OSM A* edge geometry, paused/resumed delivery, real street click, detour comparison, offline unreachable, POI search, mode switch and 390px viewport.",
  );
  console.log(
    `Route: ${route.properties.cost.toFixed(3)} m, ${route.properties.edgeIds.length} edges. Screenshots in ${tmpdir()}`,
  );
}
