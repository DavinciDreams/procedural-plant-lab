import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_VINE_GUIDE_SMOKE_PORT ?? 4289);
const debugPort = Number(process.env.PROCPLANTS_VINE_GUIDE_SMOKE_DEBUG_PORT ?? 9339);
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
if (!chrome) throw new Error("Chrome or Edge is required for the vine guide browser smoke test");

const waitFor = async (probe, timeoutMs = 60_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      // Preview and debugging sockets bind asynchronously.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("timed out waiting for the vine guide browser smoke");
};

const profile = await mkdtemp(join(tmpdir(), "procplants-vine-guide-browser-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${appPort}/`)).ok);
  browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--disable-crashpad", "--no-first-run", "--disable-extensions",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${appPort}/?p=floweringWallCreeper&s=floweringWallCreeper&h=0&seed=807026&d=0.15`,
  ], { stdio: "ignore", windowsHide: true });
  const target = await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return targets.find((entry) => entry.type === "page" && entry.url.includes(String(appPort)));
  });
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  let id = 0;
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
    const commandId = ++id;
    pending.set(commandId, resolveCommand);
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });
  await command("Page.enable");
  await command("Runtime.enable");
  await waitFor(async () => {
    const result = await command("Runtime.evaluate", {
      expression: "Boolean(document.querySelector('canvas') && document.querySelector('#regenerate') && document.querySelector('#vineGuideMode') && document.readyState === 'complete' && !document.querySelector('#regenerate').disabled && !document.querySelector('#vineGuideMode').disabled)",
      returnByValue: true,
    });
    return result.result?.result?.value === true;
  });
  const resultMessage = await command("Runtime.evaluate", {
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const waitForIdle = async () => {
          for (let i = 0; i < 240 && document.querySelector('#regenerate')?.disabled; i++) await wait(100);
          await wait(250);
        };
        const app = document.querySelector('#app');
        const canvas = document.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        document.querySelector('#vineGuideMode').click();
        for (let i = 0; i < 120 && app.dataset.vineGuideAuthoringLoaded !== 'true'; i++) await wait(50);
        const click = (x, y) => canvas.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          clientX: rect.left + rect.width * x,
          clientY: rect.top + rect.height * y,
        }));
        click(0.43, 0.62);
        await wait(100);
        const draftStatus = app.dataset.vineGuideStatus;
        const draftPoints = Number(app.dataset.vineGuidePointCount);
        click(0.57, 0.38);
        await waitForIdle();

        let exportedBlob = null;
        const originalCreateObjectUrl = URL.createObjectURL;
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (blob) => { exportedBlob = blob; return 'blob:vine-guide-smoke'; };
        HTMLAnchorElement.prototype.click = () => {};
        document.querySelector('#exportJson').click();
        for (let i = 0; i < 120 && !exportedBlob; i++) await wait(50);
        const exported = JSON.parse(await exportedBlob.text());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
        const authoredStatus = app.dataset.vineGuideStatus;
        const authoredPoints = Number(app.dataset.vineGuidePointCount);
        const projection = app.dataset.vineGuideProjection;
        const collision = app.dataset.vineGuideCollision;
        const packagePoints = exported.authoring.vineGuide.points;
        const exportedGuide = exported.genome.vine.guide;
        const persistedUrl = location.href;
        const persisted = JSON.parse(new URL(location.href).searchParams.get('vg'));

        document.querySelector('#resetVineGuide').click();
        await waitForIdle();
        document.querySelector('#vineGuideSupportMode').click();
        for (let i = 0; i < 120 && app.dataset.vineSurfaceAuthoringLoaded !== 'true'; i++) await wait(50);
        click(0.43, 0.74);
        await wait(100);
        click(0.57, 0.70);
        await waitForIdle();
        let supportBlob = null;
        URL.createObjectURL = (blob) => { supportBlob = blob; return 'blob:vine-support-smoke'; };
        HTMLAnchorElement.prototype.click = () => {};
        document.querySelector('#exportJson').click();
        for (let i = 0; i < 120 && !supportBlob; i++) await wait(50);
        const supportExport = JSON.parse(await supportBlob.text());
        let supportGlb = null;
        URL.createObjectURL = (blob) => { supportGlb = blob; return 'blob:vine-support-glb-smoke'; };
        document.querySelector('#exportGlb').click();
        for (let i = 0; i < 240 && !supportGlb; i++) await wait(50);
        const supportGlbBytes = new Uint8Array(await supportGlb.arrayBuffer());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
        const supportProof = {
          status: app.dataset.vineGuideStatus,
          points: Number(app.dataset.vineGuidePointCount),
          projection: app.dataset.vineGuideProjection,
          collision: app.dataset.vineGuideCollision,
          supportId: app.dataset.vineGuideSupportId,
          clearance: Number(app.dataset.vineGuideSupportClearance),
          verifiedClearance: Number(app.dataset.vineGuideVerifiedClearance),
          y: supportExport.authoring.vineGuide.points.map((point) => point.position[1]),
          exactGuide: JSON.stringify(supportExport.authoring.vineGuide.points.map((point) => point.position)) === JSON.stringify(supportExport.genome.vine.guide),
          serializedHasLiveBinding: JSON.stringify(supportExport.authoring.vineGuide).includes('lab-static-ground'),
          glbBytes: supportGlbBytes.byteLength,
          glbMagic: String.fromCharCode(...supportGlbBytes.slice(0, 4)),
        };
        document.querySelector('#resetVineGuide').click();
        await waitForIdle();
        return {
          draftStatus,
          draftPoints,
          authoredStatus,
          authoredPoints,
          projection,
          collision,
          stableIds: packagePoints.map((point) => point.id),
          exactGuide: JSON.stringify(packagePoints.map((point) => point.position)) === JSON.stringify(exportedGuide),
          persistedExact: JSON.stringify(persisted) === JSON.stringify(exported.authoring.vineGuide),
          resetStatus: app.dataset.vineGuideStatus,
          resetPoints: Number(app.dataset.vineGuidePointCount),
          resetPersisted: new URL(location.href).searchParams.has('vg'),
          persistedUrl,
          supportProof,
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(resultMessage.result?.exceptionDetails, undefined, resultMessage.result?.exceptionDetails?.text);
  const result = resultMessage.result?.result?.value;
  assert.equal(result.draftStatus, "draft");
  assert.equal(result.draftPoints, 1);
  assert.equal(result.authoredStatus, "applied");
  assert.equal(result.authoredPoints, 2);
  assert.equal(result.projection, "camera-facing-plane");
  assert.equal(result.collision, "static-none");
  assert.deepEqual(result.stableIds, ["vine-guide-point:0000", "vine-guide-point:0001"]);
  assert.equal(result.exactGuide, true);
  assert.equal(result.persistedExact, true);
  assert.equal(result.resetStatus, "canonical");
  assert.equal(result.resetPoints, 0);
  assert.equal(result.resetPersisted, false);
  assert.equal(result.supportProof.status, "applied");
  assert.equal(result.supportProof.points, 2);
  assert.equal(result.supportProof.projection, "static-mesh-surface");
  assert.equal(result.supportProof.collision, "static-clearance-verified");
  assert.equal(result.supportProof.supportId, "lab-static-ground");
  assert.equal(result.supportProof.clearance, 0.02);
  assert.ok(result.supportProof.verifiedClearance >= -1e-8);
  assert.ok(result.supportProof.y.every(Number.isFinite));
  assert.ok(Math.max(...result.supportProof.y) - Math.min(...result.supportProof.y) < 1e-5,
    `both snapped points must share the static ground offset: ${JSON.stringify(result.supportProof)}`);
  assert.equal(result.supportProof.exactGuide, true);
  assert.equal(result.supportProof.serializedHasLiveBinding, false);
  assert.ok(result.supportProof.glbBytes > 1_000);
  assert.equal(result.supportProof.glbMagic, "glTF");
  await command("Page.navigate", { url: result.persistedUrl });
  const restored = await waitFor(async () => {
    const probe = await command("Runtime.evaluate", {
      expression: `({
        ready: document.readyState === 'complete' && document.querySelector('#app')?.dataset.vineGuideRestored === 'true' && !document.querySelector('#regenerate')?.disabled,
        status: document.querySelector('#app')?.dataset.vineGuideStatus,
        points: Number(document.querySelector('#app')?.dataset.vineGuidePointCount),
        targetMatched: document.querySelector('#app')?.dataset.vineGuideTargetMatched,
      })`,
      returnByValue: true,
    });
    const value = probe.result?.result?.value;
    return value?.ready ? value : null;
  });
  assert.equal(restored.status, "applied");
  assert.equal(restored.points, 2);
  assert.equal(restored.targetMatched, "true");
  delete result.persistedUrl;
  result.reloadRestored = true;
  console.log(JSON.stringify(result));
  socket.close();
} finally {
  const stop = async (handle) => {
    if (!handle || handle.exitCode !== null) return;
    const exited = new Promise((resolveExit) => handle.once("exit", resolveExit));
    handle.kill();
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
  };
  await stop(browser);
  await stop(preview);
  await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 }).catch(() => {});
}
