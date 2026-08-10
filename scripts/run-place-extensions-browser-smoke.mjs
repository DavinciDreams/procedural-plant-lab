import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_PLACE_PORT ?? 4198);
const debugPort = Number(process.env.PROCPLANTS_PLACE_DEBUG_PORT ?? 9248);
const candidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(candidates.map(async (candidate) => {
  await access(candidate);
  return candidate;
})).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for the place-parts browser smoke test");

const waitFor = async (probe, label, timeoutMs = 30_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      // The server or browser may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-place-browser-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${appPort}/`)).ok, "Vite preview");
  browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--disable-breakpad", "--disable-crash-reporter",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${appPort}/`,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    if (!response.ok) return null;
    return (await response.json()).find((entry) => entry.type === "page" && entry.url.includes(String(appPort)));
  }, "browser target");
  assert.ok(targets.webSocketDebuggerUrl);
  const socket = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      callback(message);
    }
  });
  const command = (method, params = {}) => new Promise((resolveCommand) => {
    const id = ++commandId;
    pending.set(id, resolveCommand);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Page.enable");
  await command("Runtime.enable");
  let stableDocuments = 0;
  for (let attempt = 0; attempt < 100 && stableDocuments < 3; attempt++) {
    const probe = await command("Runtime.evaluate", {
      expression: "({ ready: document.readyState, href: location.href })",
      returnByValue: true,
    });
    const value = probe.result?.result?.value;
    stableDocuments = !probe.error
      && value?.ready === "complete"
      && String(value?.href ?? "").includes(String(appPort))
      ? stableDocuments + 1
      : 0;
    if (stableDocuments < 3) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.equal(stableDocuments, 3, "browser document must stabilize before placement evaluation");
  const expression = `
    (async () => {
      const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
      const app = document.querySelector('#app');
      const idle = async () => {
        for (let i = 0; i < 180 && document.querySelector('#regenerate')?.disabled; i++) await wait(100);
        for (let i = 0; i < 180 && app?.dataset.heroLodPending !== 'false'; i++) await wait(100);
        await wait(250);
      };
      for (let i = 0; i < 180 && !document.querySelector('canvas'); i++) await wait(100);
      const canvas = document.querySelector('canvas');
      const primary = document.querySelector('#primary');
      const secondary = document.querySelector('#secondary');
      primary.value = 'understoryShrub';
      secondary.value = 'understoryShrub';
      primary.dispatchEvent(new Event('change', { bubbles: true }));
      secondary.dispatchEvent(new Event('change', { bubbles: true }));
      await idle();
      for (let i = 0; i < 120 && app?.dataset.organPlacementAvailable !== 'true'; i++) await wait(100);
      const initialResources = performance.getEntriesByType('resource').map((entry) => entry.name);
      const options = [...document.querySelectorAll('#placementKind option')].map((option) => option.value);
      const button = document.querySelector('#placementMode');
      const select = document.querySelector('#placementKind');
      const undo = document.querySelector('#undoPlacement');
      const baselineTriangles = Number(app.dataset.heroTemplateTriangles);
      button.click();
      for (let i = 0; i < 120 && app.dataset.organPlacementActive !== 'true'; i++) await wait(100);

      const clickUntilCount = async (expected) => {
        for (let i = 0; i < 120 && app.dataset.organPlacementToolReady !== 'true'; i++) await wait(100);
        const rect = canvas.getBoundingClientRect();
        const fractions = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8];
        for (const fy of fractions) {
          for (const fx of fractions) {
            const clientX = rect.left + rect.width * fx;
            const clientY = rect.top + rect.height * fy;
            canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));
            canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
            for (let i = 0; i < 4 && Number(app.dataset.organPlacementCount ?? 0) < expected; i++) await wait(100);
            if (Number(app.dataset.organPlacementCount ?? 0) >= expected) {
              await idle();
              return true;
            }
          }
        }
        return false;
      };

      select.value = 'coniferSpray';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const clusterPlaced = await clickUntilCount(1);
      const clusterTriangles = Number(app.dataset.heroTemplateTriangles);
      select.value = 'branch';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const branchPlaced = await clickUntilCount(2);
      const branchTriangles = Number(app.dataset.heroTemplateTriangles);
      const applied = Number(app.dataset.organPlacementApplied ?? 0);
      const unsupported = Number(app.dataset.organPlacementUnsupported ?? -1);

      let exportedBlob;
      const originalCreateObjectUrl = URL.createObjectURL;
      const originalAnchorClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = (blob) => { exportedBlob = blob; return originalCreateObjectUrl(blob); };
      HTMLAnchorElement.prototype.click = function () {};
      document.querySelector('#exportJson').click();
      for (let i = 0; i < 120 && !exportedBlob; i++) await wait(100);
      URL.createObjectURL = originalCreateObjectUrl;
      HTMLAnchorElement.prototype.click = originalAnchorClick;
      const exported = JSON.parse(await exportedBlob.text());
      const exportedPlacements = exported.authoring.organPlacements;

      undo.click();
      await idle();
      const afterBranchUndo = Number(app.dataset.heroTemplateTriangles);
      undo.click();
      await idle();
      const resetTriangles = Number(app.dataset.heroTemplateTriangles);
      return {
        options,
        label: select.getAttribute('aria-label'),
        buttonText: button.textContent,
        initialLazy: initialResources.some((url) => url.includes('procplant-organ-placement-overrides')),
        loadedLazy: performance.getEntriesByType('resource').some((entry) => entry.name.includes('procplant-organ-placement-overrides')),
        clusterPlaced,
        branchPlaced,
        baselineTriangles,
        clusterTriangles,
        branchTriangles,
        afterBranchUndo,
        resetTriangles,
        applied,
        unsupported,
        exportedVersion: exportedPlacements?.version,
        exportedKinds: exportedPlacements?.operations?.map((operation) => operation.kind),
        status: document.querySelector('#saveStatus')?.textContent ?? null,
        finalCount: Number(app.dataset.organPlacementCount ?? -1),
      };
    })()
  `;
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (!response.result?.result?.value) console.error(JSON.stringify(response));
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
  }
  const result = response.result?.result?.value;
  assert.ok(result);
  console.log(JSON.stringify(result));
  assert.deepEqual(result.options, ["leaf", "flower", "fruit", "berry", "cone", "thorn", "aerialRoot", "coniferSpray", "fernFrond", "palmFrond", "mossTuft", "branch"]);
  assert.equal(result.label, "Plant part type");
  assert.equal(result.initialLazy, false);
  assert.equal(result.loadedLazy, true);
  assert.equal(result.clusterPlaced, true);
  assert.equal(result.branchPlaced, true);
  assert.ok(result.clusterTriangles > result.baselineTriangles);
  assert.ok(result.branchTriangles > result.clusterTriangles);
  assert.equal(result.applied, 2);
  assert.equal(result.unsupported, 0);
  assert.equal(result.exportedVersion, 2);
  assert.deepEqual(result.exportedKinds, ["coniferSpray", "branch"]);
  assert.equal(result.afterBranchUndo, result.clusterTriangles);
  assert.equal(result.resetTriangles, result.baselineTriangles);
  assert.equal(result.finalCount, 0);
  socket.close();
} finally {
  const stop = async (handle) => {
    if (!handle || handle.exitCode !== null) return;
    const exited = new Promise((resolveExit) => handle.once("exit", resolveExit));
    handle.kill();
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
  };
  await stop(browser);
  await stop(preview);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      break;
    } catch (error) {
      if (attempt === 9) console.warn(`place browser profile cleanup deferred: ${String(error)}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
}
