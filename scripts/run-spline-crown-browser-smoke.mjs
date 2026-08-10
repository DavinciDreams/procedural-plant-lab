import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_SPLINE_CROWN_SMOKE_PORT ?? 4197);
const debugPort = Number(process.env.PROCPLANTS_SPLINE_CROWN_SMOKE_DEBUG_PORT ?? 9247);
const chromeCandidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(chromeCandidates.map(async (candidate) => {
  await access(candidate);
  return candidate;
})).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for the spline crown browser smoke test");

const waitForJson = async (url, timeoutMs = 60_000) => {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError ?? "not ready")}`);
};

const waitForOk = async (url, timeoutMs = 60_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview may not have bound its socket yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-spline-crown-browser-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitForOk(`http://127.0.0.1:${appPort}/`);
  browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--disable-crashpad", "--no-first-run", "--disable-extensions",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${appPort}/?p=colonizedHazelShrub&s=phiFern&seed=807026&d=0.15`,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((entry) => entry.type === "page" && entry.url.includes(String(appPort)));
  assert.ok(target?.webSocketDebuggerUrl, "headless browser page target must be available");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
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
  const command = (method, params = {}) => new Promise((resolvePromise) => {
    const id = ++commandId;
    pending.set(id, resolvePromise);
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
    stableDocuments = !probe.error && value?.ready === "complete" && String(value?.href ?? "").includes(String(appPort))
      ? stableDocuments + 1
      : 0;
    if (stableDocuments < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  assert.equal(stableDocuments, 3);
  const evaluated = await command("Runtime.evaluate", {
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const app = document.querySelector('#app');
        const triangles = () => Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
        const waitForIdle = async () => {
          for (let i = 0; i < 180 && document.querySelector('#regenerate')?.disabled; i++) await wait(100);
          for (let i = 0; i < 180 && app?.dataset.heroLodPending !== 'false'; i++) await wait(100);
          await wait(300);
        };
        for (let i = 0; i < 180 && app?.dataset.crownSplineAvailable !== 'true'; i++) await wait(100);
        await waitForIdle();
        const beforeTriangles = triangles();

        document.querySelector('#crownSplineAdd').click();
        for (let i = 0; i < 180 && app.dataset.crownSplineCount !== '1'; i++) await wait(100);
        await waitForIdle();
        const splineId = app.dataset.crownSplineSelected;
        const initialPointId = app.dataset.crownSplinePointSelected;

        document.querySelector('#crownSplinePointAdd').click();
        for (let i = 0; i < 180 && app.dataset.crownSplinePointCount !== '4'; i++) await wait(100);
        await waitForIdle();
        const addedPointId = app.dataset.crownSplinePointSelected;

        const xInput = document.querySelector('#crownSplinePointX');
        xInput.value = String(Number(xInput.value) + 0.75);
        xInput.dispatchEvent(new Event('change', { bubbles: true }));
        await waitForIdle();
        const radiusInput = document.querySelector('#crownSplinePointRadius');
        radiusInput.value = '0.42';
        radiusInput.dispatchEvent(new Event('change', { bubbles: true }));
        await waitForIdle();
        const authoredTriangles = triangles();
        const parsed = JSON.parse(new URL(location.href).searchParams.get('cf'));

        document.querySelector('#crownVolumeMode').click();
        for (let i = 0; i < 180 && app.dataset.crownVolumeActive !== 'true'; i++) await wait(100);
        const splineVisualCount = Number(app.dataset.crownSplineVisualCount);

        let exportedBlob = null;
        const originalCreateObjectUrl = URL.createObjectURL;
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (blob) => { exportedBlob = blob; return 'blob:spline-crown-smoke'; };
        HTMLAnchorElement.prototype.click = () => {};
        document.querySelector('#exportJson').click();
        for (let i = 0; i < 180 && !exportedBlob; i++) await wait(100);
        const exported = JSON.parse(await exportedBlob.text());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;

        document.querySelector('#crownVolumeMode').click();
        document.querySelector('#crownSplinePointRemove').click();
        await waitForIdle();
        document.querySelector('#crownSplineRemove').click();
        await waitForIdle();
        return {
          available: app.dataset.crownSplineAvailable,
          splineId,
          initialPointId,
          addedPointId,
          selectedSpline: app.dataset.crownSplineSelected ?? null,
          contract: parsed.contract,
          version: parsed.version,
          pointIds: parsed.splines[0]?.points.map((point) => point.id),
          movedPoint: parsed.splines[0]?.points.at(-1),
          splineVisualCount,
          beforeTriangles,
          authoredTriangles,
          resetTriangles: triangles(),
          exportStateVersion: exported.state.crownField?.version,
          exportGenomeVersion: exported.genome.spaceColonization?.freeform?.version,
          exportAuthoringVersion: exported.authoring.freeformCrown?.version,
          resetUrlValue: new URL(location.href).searchParams.get('cf'),
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(evaluated.exceptionDetails, undefined, evaluated.exceptionDetails?.text);
  const result = evaluated.result?.result?.value;
  assert.equal(result.available, "true");
  assert.equal(result.splineId, "spline-1");
  assert.equal(result.initialPointId, "spline-1-point-1");
  assert.equal(result.addedPointId, "spline-1-point-4");
  assert.equal(result.contract, "procplants.freeform-crown");
  assert.equal(result.version, 2);
  assert.deepEqual(result.pointIds, ["spline-1-point-1", "spline-1-point-2", "spline-1-point-3", "spline-1-point-4"]);
  assert.equal(result.movedPoint.id, result.addedPointId);
  assert.equal(result.movedPoint.radius, 0.42);
  assert.ok(result.splineVisualCount >= 5, "one curve and four point visuals must be materialized");
  assert.equal(result.exportStateVersion, 2);
  assert.equal(result.exportGenomeVersion, 2);
  assert.equal(result.exportAuthoringVersion, 2);
  assert.equal(result.resetTriangles, result.beforeTriangles, "removing the last spline must restore exact legacy triangles");
  assert.equal(result.resetUrlValue, null);
  console.log(JSON.stringify(result));
  socket.close();
} finally {
  const stop = async (processHandle) => {
    if (!processHandle || processHandle.exitCode !== null) return;
    const exited = new Promise((resolvePromise) => processHandle.once("exit", resolvePromise));
    processHandle.kill();
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  };
  await stop(browser);
  await stop(preview);
  await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 }).catch(() => {});
}
