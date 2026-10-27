import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
export async function checkRegional({ send, evaluate, click, waitFor, delay }) {
  await waitFor(`!!document.querySelector('.mode-bar')`);
  await click("Modo Bacalar Real");
  await waitFor(`!!document.querySelector('.regional-app')`);
  const map = `document.querySelector('.bacalar-canvas').routeMap`,
    aria = (label) =>
      evaluate(
        `document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`,
      );
  await waitFor(`!!${map}?.getSource('streets')`);
  await click("Usar fondo local");
  await waitFor(`!!${map}.getSource('route')`);
  await waitFor(
    `!document.querySelector('.regional-buttons button:last-child').disabled`,
  );
  await click("Motor A*");
  await aria("Siguiente paso regional");
  await waitFor(
    `document.querySelector('.geo-education>div>span').textContent==='Paso 1'`,
  );
  const first = await evaluate(
    `document.querySelector('.geo-engine').textContent`,
  );
  await aria("Siguiente paso regional");
  await aria("Paso anterior regional");
  await delay(100);
  assert.equal(
    await evaluate(`document.querySelector('.geo-engine').textContent`),
    first,
  );
  await evaluate(
    `(()=>{const i=document.querySelector('#regional-speed');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'120');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click("Ver resultado");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Ruta calculada con A*'`,
  );
  await waitFor(
    `${map}.queryRenderedFeatures({layers:['route-line']}).length>0`,
  );
  const raw = JSON.parse(
      await readFile("public/data/bacalar-regional-osm.json", "utf8"),
    ),
    nodes = new Map(
      raw.elements
        .filter((e) => e.type === "node")
        .map((n) => [n.id, [n.lon, n.lat]]),
    ),
    ways = new Map(
      raw.elements.filter((e) => e.type === "way").map((w) => [w.id, w]),
    );
  const rendered = () =>
    evaluate(
      `(async()=>{return (await ${map}.getSource('route').getData()).features[0];})()`,
    );
  const checkGeometry = (route) => {
    const expected = route.properties.edgeIds.flatMap((id, i) => {
      const [, w, a, b, direction] = id.match(/^w(\d+):(\d+)-(\d+):([fr])$/);
      let points = ways
        .get(Number(w))
        .nodes.slice(Number(a), Number(b) + 1)
        .map((id) => nodes.get(id));
      if (direction === "r") points.reverse();
      return i ? points.slice(1) : points;
    });
    assert.deepEqual(route.geometry.coordinates, expected);
  };
  const out = await rendered();
  checkGeometry(out);
  assert.ok(out.properties.cost > 4100 && out.properties.cost < 4250);
  await evaluate(
    `(()=>{const s=document.querySelector('[aria-label="Lista de estados A*"]');s.value='closed';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitFor(
    `document.querySelector('.geo-node-table').textContent.includes('Cerrado')`,
  );
  await aria("Página siguiente de estados");
  assert.ok(
    (
      await evaluate(
        `document.querySelector('.regional-table-controls>span').textContent`,
      )
    ).startsWith("2/"),
  );
  await evaluate(
    `(()=>{const s=document.querySelector('[aria-label="Lista de estados A*"]');s.value='open';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await click("Iniciar entrega");
  await delay(200);
  await click("Pausar recorrido");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Recorrido pausado'`,
  );
  const frozen = await evaluate(
    `document.querySelector('.geo-delivery-progress>div').textContent`,
  );
  await delay(200);
  assert.equal(
    await evaluate(
      `document.querySelector('.geo-delivery-progress>div').textContent`,
    ),
    frozen,
  );
  await click("Reanudar recorrido");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='¡Pizza entregada!'`,
  );
  await click("Regresar a la pizzería");
  await waitFor(
    `!document.querySelector('.regional-buttons button:last-child').disabled`,
  );
  await click("Ver resultado");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Ruta calculada con A*'`,
  );
  const back = await rendered();
  checkGeometry(back);
  assert.notDeepEqual(
    back.properties.nodeIds,
    [...out.properties.nodeIds].reverse(),
  );
  assert.equal(
    await evaluate(`${map}.getPaintProperty('route-line','line-color')`),
    "#26996c",
  );
  await click("Iniciar regreso");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='¡Regreso completado!'`,
  );
  assert.ok(
    (
      await evaluate(`document.querySelector('.regional-summary').textContent`)
    ).includes("8.10 km"),
  );
  await evaluate(
    `(()=>{const s=document.querySelector('#regional-preset');s.value='cenote';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitFor(
    `!document.querySelector('.regional-buttons button:last-child').disabled`,
  );
  await click("Ver resultado");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Ruta calculada con A*'`,
  );
  const cenote = await rendered();
  checkGeometry(cenote);
  assert.ok(cenote.properties.cost > 4200 && cenote.properties.cost < 4400);
  await click("Iniciar entrega");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='¡Pizza entregada!'`,
  );
  await click("Regresar a la pizzería");
  await waitFor(
    `!document.querySelector('.regional-buttons button:last-child').disabled`,
  );
  await click("Ver resultado");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Ruta calculada con A*'`,
  );
  checkGeometry(await rendered());
  await click("Iniciar regreso");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='¡Regreso completado!'`,
  );
  // New trip, report an explicitly simulated pothole and verify persistence and cost profile.
  await evaluate(
    `(()=>{const s=document.querySelector('#regional-preset');s.value='upb';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitFor(
    `!document.querySelector('.regional-buttons button:last-child').disabled`,
  );
  await click("Ver resultado");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Ruta calculada con A*'`,
  );
  const current = await rendered();
  await click("Reportar incidencia");
  const reportPoint = current.geometry.coordinates[2];
  await evaluate(
    `void ${map}.fire('click',{point:${map}.project(${JSON.stringify(reportPoint)}),lngLat:${map}.unproject(${map}.project(${JSON.stringify(reportPoint)})),originalEvent:{target:${map}.getCanvas()}})`,
  );
  await click("Guardar reporte local");
  await waitFor(
    `document.querySelectorAll('.regional-reports>div').length===1`,
  );
  assert.equal(
    await evaluate(
      `JSON.parse(localStorage.getItem('rutapizza-incidents-v1')).items.length`,
    ),
    1,
  );
  await evaluate(
    `(()=>{const s=document.querySelector('#regional-profile');s.value='risk';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitFor(
    `!document.querySelector('.regional-buttons button:last-child').disabled`,
  );
  await click("Ver resultado");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Ruta calculada con A*'`,
  );
  // Close a future segment during motion. Compare the exact displayed marker position before and after recalculation.
  await click("Iniciar entrega");
  await delay(150);
  const old = await rendered();
  const target =
    old.geometry.coordinates[Math.floor(old.geometry.coordinates.length * 0.8)];
  await click("Cerrar / reabrir");
  const position = await evaluate(
    `(()=>{const r=document.querySelector('.geo-rider').getBoundingClientRect();${map}.fire('click',{point:${map}.project(${JSON.stringify(target)}),lngLat:${map}.unproject(${map}.project(${JSON.stringify(target)})),originalEvent:{target:${map}.getCanvas()}});return {x:r.left,y:r.top};})()`,
  );
  await waitFor(
    `document.querySelector('.geo-endpoint:first-child strong').textContent==='Posición vial actual'`,
  );
  await waitFor(
    `!document.querySelector('.regional-buttons button:last-child').disabled`,
  );
  const after = await evaluate(
    `(()=>{const r=document.querySelector('.geo-rider').getBoundingClientRect();return {x:r.left,y:r.top};})()`,
  );
  assert.ok(
    Math.hypot(after.x - position.x, after.y - position.y) < 0.1,
    "La moto no debe saltar al recalcular",
  );
  await click("Ver resultado");
  await waitFor(
    `['Ruta calculada con A*','Destino inaccesible'].includes(document.querySelector('.geo-status').textContent)`,
  );
  assert.ok(
    await evaluate(
      `(async()=>{return (await ${map}.getSource('previous').getData()).features.length>0;})()`,
    ),
  );
  await click("Presentación");
  await waitFor(
    `document.querySelector('.regional-app').classList.contains('presentation-mode')`,
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.mode-bar')).display`,
    ),
    "none",
  );
  await click("Salir de presentación");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(400);
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=390`));
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(
    join(tmpdir(), "rutapizza-regional-mobile.png"),
    Buffer.from(shot.data, "base64"),
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(300);
  const desktop = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(
    join(tmpdir(), "rutapizza-regional-desktop.png"),
    Buffer.from(desktop.data, "base64"),
  );
  console.log(
    "Regional browser passed: worker + heap, exact OSM geometry, UPB and Cenote round trips independently, green return, incident persistence, risk profile, mid-route closure without teleport, presentation and responsive layout.",
  );
}
