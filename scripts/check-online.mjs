import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
/** Optional network-dependent provider smoke test. No tile prefetch or bulk download. */
export async function checkOnline({ send, evaluate, click, waitFor, delay }) {
  await waitFor(`!!document.querySelector('.mode-bar')`);
  await click("Modo Bacalar Real");
  await waitFor(`!!document.querySelector('#coverage-mode')`);
  await evaluate(
    `(()=>{const s=document.querySelector('#coverage-mode');s.value='central';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitFor(`!!document.querySelector('.geo-trip-panel')`);
  const map = `document.querySelector('.bacalar-canvas').routeMap`;
  await waitFor(
    `!!${map}?.getSource('openmaptiles') && ${map}.querySourceFeatures('openmaptiles',{sourceLayer:'water'}).length>0`,
  );
  await waitFor(`${map}.queryRenderedFeatures({layers:['water']}).length>0`);
  assert.equal(
    await evaluate(`${map}.getPaintProperty('water','fill-color')`),
    "#a9ddd9",
  );
  await evaluate(
    `(()=>{const i=document.querySelector('#geo-speed');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'12');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click("Calcular ruta con A*");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='Ruta óptima encontrada'`,
  );
  await waitFor(
    `${map}.queryRenderedFeatures({layers:['route-line']}).length>0`,
  );
  await click("Iniciar entrega");
  await waitFor(
    `document.querySelector('.geo-status').textContent==='¡Pizza entregada!'`,
  );
  assert.ok(await evaluate(`!!document.querySelector('.geo-rider-direction')`));
  await delay(400);
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(
    join(tmpdir(), "rutapizza-bacalar-online.png"),
    Buffer.from(shot.data, "base64"),
  );
  console.log(
    "Online provider passed: OpenFreeMap vector tiles rendered, actual lagoon water layer in turquoise, own A* route rendered and delivery completed.",
  );
}
