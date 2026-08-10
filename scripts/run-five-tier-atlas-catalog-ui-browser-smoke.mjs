import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_LOD5_CATALOG_UI_WEBGL_PORT ?? 4199);
const debugPort = Number(process.env.PROCPLANTS_LOD5_CATALOG_UI_WEBGL_DEBUG_PORT ?? 9249);
assert.ok(Number.isInteger(appPort) && appPort > 1024 && appPort < 65536);
assert.ok(Number.isInteger(debugPort) && debugPort > 1024 && debugPort < 65536 && debugPort !== appPort);
const chromeCandidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(chromeCandidates.map(async (candidate) => { await access(candidate); return candidate; })).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for the durable five-tier atlas catalog UI smoke test");

const waitFor = async (probe, label, timeoutMs = 120_000) => {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try { const value = await probe(); if (value) return value; } catch (error) { lastError = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${label}: ${String(lastError ?? "not ready")}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-lod5-catalog-ui-webgl-"));
const vite = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "--host", "127.0.0.1", "--port", String(appPort), "--strictPort",
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
let socket;
try {
  const pageUrl = `http://127.0.0.1:${appPort}/scripts/procplant-five-tier-atlas-catalog-ui-browser-smoke.html`;
  await waitFor(async () => (await fetch(pageUrl)).ok, "Vite durable catalog UI page");
  browser = spawn(chrome, [
    "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--no-first-run", "--disable-extensions", "--disable-background-networking",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, pageUrl,
  ], { stdio: "ignore", windowsHide: true });
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    if (!response.ok) return null;
    const entries = await response.json();
    return entries.find((entry) => entry.type === "page" && entry.url.includes("procplant-five-tier-atlas-catalog-ui-browser-smoke"));
  }, "Chrome durable catalog UI target");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let commandId = 0;
  const pending = new Map();
  const consoleErrors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      consoleErrors.push(message.params.args?.map((argument) => argument.description ?? argument.value).join(" ") ?? "console error");
    }
    if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "runtime exception");
    }
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
  });
  const command = (method, params = {}) => new Promise((resolvePromise) => {
    const id = ++commandId;
    pending.set(id, resolvePromise);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Page.enable");
  await command("Runtime.enable");
  const smoke = await waitFor(async () => {
    const response = await command("Runtime.evaluate", {
      expression: "window.__PROCPLANT_LOD5_CATALOG_UI_BROWSER_SMOKE__ ?? null",
      returnByValue: true,
    });
    return response.result?.result?.value ?? null;
  }, "durable catalog UI result");
  if (smoke.status !== "pass") throw new Error(smoke.error ?? JSON.stringify(smoke));
  assert.equal(smoke.lazy.contextsBeforeRun, 0);
  assert.ok(smoke.lazy.contextsAfterFirst > 0);
  assert.equal(smoke.lazy.contextsAfterReload, smoke.lazy.contextsBeforeReload);
  assert.equal(smoke.first.captured, 2);
  assert.equal(smoke.reload.cacheHits, 2);
  assert.equal(smoke.stale.staleInvalidated, 1);
  assert.equal(smoke.stale.captured, 1);
  assert.equal(smoke.cancelled.adopted, 0);
  assert.equal(smoke.cache.evictionStats.evictions, 1);
  assert.equal(smoke.cache.corruptionCode, "corrupt");
  assert.equal(smoke.cache.sizeLimitCode, "limit");
  assert.equal(smoke.cache.quotaCode, "quota");
  assert.equal(smoke.cache.adapterQuotaCode, "quota");
  assert.equal(smoke.export.length, 2);
  assert.ok(smoke.export.every((entry) => entry.meshes === 5 && entry.defaultSceneMeshes === 1 && entry.bytes > 0));
  assert.deepEqual(smoke.resources.staleMemory, { geometries: 0, textures: 0 });
  assert.equal(smoke.resources.firstAfterDispose.contextLost, true);
  await command("Page.navigate", { url: `http://127.0.0.1:${appPort}/` });
  const labBeforeOpen = await waitFor(async () => {
    const response = await command("Runtime.evaluate", {
      expression: `(() => {
        const app = document.querySelector('#app');
        const button = document.querySelector('#openLod5Catalog');
        const host = document.querySelector('#lod5CatalogHost');
        return app && button && host ? { loaded: app.dataset.lod5CatalogLoaded ?? null, hidden: host.hidden } : null;
      })()`,
      returnByValue: true,
    });
    return response.result?.result?.value ?? null;
  }, "standalone lab catalog trigger");
  assert.deepEqual(labBeforeOpen, { loaded: null, hidden: true }, "catalog UI must stay unloaded at lab startup");
  await command("Runtime.evaluate", { expression: "document.querySelector('#openLod5Catalog').click()" });
  const labAfterOpen = await waitFor(async () => {
    const response = await command("Runtime.evaluate", {
      expression: `(() => {
        const app = document.querySelector('#app');
        const host = document.querySelector('#lod5CatalogHost');
        const status = host?.querySelector('[data-status]');
        return app?.dataset.lod5CatalogLoaded === 'true' && host && !host.hidden && status
          ? { loaded: true, status: status.textContent } : null;
      })()`,
      returnByValue: true,
    });
    return response.result?.result?.value ?? null;
  }, "lazy standalone lab catalog panel");
  assert.equal(labAfterOpen.loaded, true);
  assert.match(labAfterOpen.status, /No renderer or cache transaction has started/);
  await command("Runtime.evaluate", { expression: "document.querySelector('#openLod5Catalog').click()" });
  assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join("\n")}`);
  console.log(JSON.stringify(smoke));
} finally {
  socket?.close();
  const stop = async (processHandle) => {
    if (!processHandle || processHandle.exitCode !== null) return;
    const exited = new Promise((resolvePromise) => processHandle.once("exit", resolvePromise));
    processHandle.kill();
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
  };
  await stop(browser);
  await stop(vite);
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); break; }
    catch (error) {
      if (attempt === 9) console.warn(`WebGL browser profile cleanup deferred: ${String(error)}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
}
