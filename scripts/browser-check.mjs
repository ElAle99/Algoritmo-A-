// Optional browser integration check. Requires a running Vite server and local Chrome.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import assert from "node:assert/strict";
const profile = await mkdtemp(join(tmpdir(), "rutapizza-browser-"));
const chrome = spawn(
  process.env.CHROME_PATH ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    ...(process.argv.includes("--bacalar") ||
    process.argv.includes("--online") ||
    process.argv.includes("--regional")
      ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
      : []),
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=9223",
    `--user-data-dir=${profile}`,
  ],
  { windowsHide: true, stdio: "ignore" },
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let socket;
try {
  let targets;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await fetch("http://127.0.0.1:9223/json").then((r) => r.json());
      if (targets.length) break;
    } catch {}
    await delay(250);
  }
  assert.ok(targets?.length, "Chrome did not start");
  socket = new WebSocket(
    targets.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((r, j) => {
    socket.onopen = r;
    socket.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const item = pending.get(message.id);
      if (item) {
        pending.delete(message.id);
        message.error
          ? item.reject(message.error)
          : item.resolve(message.result);
      }
    }
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    )
      errors.push(JSON.stringify(message.params.args));
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, { resolve, reject });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const click = (text) =>
    evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click()`,
    );
  const waitFor = async (expression) => {
    for (let i = 0; i < 600; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw Error(
      `Timeout: ${expression}; body=${await evaluate("document.body.innerText")}; errors=${JSON.stringify(errors)}`,
    );
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  console.log(
    "Navigation",
    await send("Page.navigate", {
      url: process.env.TEST_URL || "http://127.0.0.1:5173",
    }),
  );
  if (process.argv.includes("--regional")) {
    const { checkRegional } = await import("./check-regional.mjs");
    await checkRegional({ send, evaluate, click, waitFor, delay });
  } else if (process.argv.includes("--online")) {
    const { checkOnline } = await import("./check-online.mjs");
    await checkOnline({ send, evaluate, click, waitFor, delay });
  } else if (process.argv.includes("--bacalar")) {
    const { checkBacalar } = await import("./check-bacalar.mjs");
    await checkBacalar({ send, evaluate, click, waitFor, delay });
  } else {
    await waitFor(`!!document.querySelector('.current-node')`);
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-node]').length`),
      64,
    );
    await click("Siguiente paso");
    await waitFor(
      `document.querySelector('.current-node strong').textContent==='G1'`,
    );
    const snapshot = await evaluate(
      `document.querySelector('.engine').textContent`,
    );
    await click("Siguiente paso");
    await evaluate(`document.querySelector('[title="Paso anterior"]').click()`);
    await delay(150);
    assert.equal(
      await evaluate(`document.querySelector('.engine').textContent`),
      snapshot,
      "Previous step must restore all displayed algorithm values",
    );
    await evaluate(
      `document.querySelector('[title="Reiniciar simulación"]').click()`,
    );
    await click("Agregar obstáculos");
    await waitFor(
      `document.querySelector('.map-tag').textContent==='EDICIÓN DE CALLES'`,
    );
    await evaluate(
      `document.querySelector('[aria-label="Nodo B2"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
    );
    await waitFor(
      `!!document.querySelector('[aria-label="Nodo B2, bloqueado"]')`,
    );
    await click("Terminar edición");
    await evaluate(
      `(()=>{const input=document.querySelector('#speed');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1300');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await click("Iniciar búsqueda");
    await waitFor(
      `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Iniciar entrega')`,
    );
    await click("Iniciar entrega");
    await waitFor(
      `document.querySelector('.search-status h3').textContent==='Entrega completada'`,
    );
    assert.ok(
      (
        await evaluate(`document.querySelector('.route-summary').textContent`)
      ).includes("12 / 12"),
    );
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    await writeFile(
      join(tmpdir(), "rutapizza-desktop.png"),
      Buffer.from(shot.data, "base64"),
    );
    await click("Probar destino inaccesible");
    await click("Iniciar búsqueda");
    await waitFor(
      `document.querySelector('.search-status h3').textContent==='Destino inalcanzable'`,
    );
    assert.equal(
      await evaluate(
        `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Iniciar entrega')`,
      ),
      false,
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(300);
    assert.ok(
      await evaluate(`document.documentElement.scrollWidth<=390`),
      "Mobile page must not overflow horizontally",
    );
    const mobile = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    await writeFile(
      join(tmpdir(), "rutapizza-mobile.png"),
      Buffer.from(mobile.data, "base64"),
    );
    assert.deepEqual(errors, [], "Browser console errors");
    console.log(
      "Browser checks passed: 64 nodes, step restoration, obstacle editing, optimal delivery, unreachable destination, mobile layout, no console errors.",
    );
    console.log(
      `Screenshots: ${join(tmpdir(), "rutapizza-desktop.png")} and ${join(tmpdir(), "rutapizza-mobile.png")}`,
    );
  }
  assert.deepEqual(errors, [], "Browser console errors");
} finally {
  socket?.close();
  chrome.kill();
  await delay(500);
  if (
    dirname(resolve(profile)) === resolve(tmpdir()) &&
    basename(profile).startsWith("rutapizza-browser-")
  ) {
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}
