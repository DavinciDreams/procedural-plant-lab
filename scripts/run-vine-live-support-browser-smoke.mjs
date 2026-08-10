import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_VINE_LIVE_PORT ?? 4297);
const debugPort = Number(process.env.PROCPLANTS_VINE_LIVE_DEBUG_PORT ?? 9347);
const candidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(candidates.map(async (candidate) => { await access(candidate); return candidate; })).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for the live vine support browser smoke");

const waitFor = async (probe, timeoutMs = 60_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const value = await probe(); if (value) return value; } catch { /* asynchronous sockets */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("timed out waiting for the live vine support browser smoke");
};

const profile = await mkdtemp(join(tmpdir(), "procplants-vine-live-browser-"));
const preview = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--host", "127.0.0.1", "--port", String(appPort)], {
  cwd: root, stdio: "ignore", windowsHide: true,
});
let browser;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${appPort}/`)).ok);
  browser = spawn(chrome, [
    "--headless=new", "--disable-crashpad", "--no-first-run", "--disable-extensions",
    "--use-angle=swiftshader", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
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
    if (callback) { pending.delete(message.id); callback(message); }
  });
  const command = (method, params = {}) => new Promise((resolveCommand) => {
    const commandId = ++id;
    pending.set(commandId, resolveCommand);
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });
  await command("Runtime.enable");
  await waitFor(async () => {
    const probe = await command("Runtime.evaluate", {
      expression: "Boolean(document.querySelector('canvas') && document.readyState === 'complete' && !document.querySelector('#regenerate')?.disabled && !document.querySelector('#vineGuideMode')?.disabled)",
      returnByValue: true,
    });
    return probe.result?.result?.value === true;
  });
  const evaluated = await command("Runtime.evaluate", {
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const idle = async () => { for (let i = 0; i < 300 && document.querySelector('#regenerate')?.disabled; i++) await wait(50); await wait(250); };
        const exportJson = async () => {
          let blob = null;
          const oldUrl = URL.createObjectURL;
          const oldClick = HTMLAnchorElement.prototype.click;
          URL.createObjectURL = (value) => { blob = value; return 'blob:live-vine'; };
          HTMLAnchorElement.prototype.click = () => {};
          document.querySelector('#exportJson').click();
          for (let i = 0; i < 160 && !blob; i++) await wait(50);
          URL.createObjectURL = oldUrl;
          HTMLAnchorElement.prototype.click = oldClick;
          return JSON.parse(await blob.text());
        };
        const app = document.querySelector('#app');
        const beforeResources = performance.getEntriesByType('resource').map((entry) => entry.name);
        const canvas = document.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        const clickCanvas = (x, y) => canvas.dispatchEvent(new MouseEvent('click', {
          bubbles: true, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y,
        }));
        document.querySelector('#vineGuideMode').click();
        for (let i = 0; i < 160 && app.dataset.vineGuideAuthoringLoaded !== 'true'; i++) await wait(50);
        clickCanvas(0.43, 0.62);
        await wait(100);
        clickCanvas(0.57, 0.38);
        await idle();
        const source = await exportJson();
        for (let i = 0; i < 160 && document.querySelector('#attachVineLiveSupport')?.disabled; i++) await wait(50);
        document.querySelector('#attachVineLiveSupport').click();
        for (let i = 0; i < 160 && app.dataset.vineLiveSupportStatus !== 'attached'; i++) await wait(50);
        const attached = await exportJson();
        const afterAttachResources = performance.getEntriesByType('resource').map((entry) => entry.name);
        document.querySelector('#deformVineLiveSupport').click();
        await idle();
        const moved = await exportJson();
        document.querySelector('#resetVineLiveSupport').click();
        await idle();
        const reset = await exportJson();
        return {
          backend: app.dataset.vineLiveSupportBackend,
          moduleLoaded: app.dataset.vineLiveSupportLoaded,
          statusAfterMove: moved.authoring.vineLiveSupport ? 'rebuilt' : app.dataset.vineLiveSupportStatus,
          transformedPoints: Number(app.dataset.vineLiveSupportTransformedPoints || moved.authoring.vineLiveSupport?.bindings?.length || 0),
          sourcePoints: source.authoring.vineGuide.points.map((point) => point.position),
          attachedPoints: attached.authoring.vineGuide.points.map((point) => point.position),
          movedPoints: moved.authoring.vineGuide.points.map((point) => point.position),
          resetPoints: reset.authoring.vineGuide.points.map((point) => point.position),
          attachment: attached.authoring.vineLiveSupport,
          movedAttachment: moved.authoring.vineLiveSupport,
          resetAttachment: reset.authoring.vineLiveSupport,
          lazyBefore: beforeResources.some((url) => url.includes('procplant-vine-live-support')),
          lazyAfter: afterAttachResources.some((url) => url.includes('procplant-vine-live-support')),
          disposed: app.dataset.vineLiveSupportDisposed,
          bindingsAfterReset: Number(app.dataset.vineLiveSupportBindings),
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(evaluated.result?.exceptionDetails, undefined, evaluated.result?.exceptionDetails?.text);
  const result = evaluated.result?.result?.value;
  assert.ok(result.backend === "webgl1" || result.backend === "webgl2", JSON.stringify(result));
  assert.equal(result.moduleLoaded, "true");
  assert.equal(result.lazyBefore, false);
  assert.equal(result.lazyAfter, true);
  assert.deepEqual(result.attachedPoints, result.sourcePoints, "attaching must not mutate the source V1 guide");
  assert.notDeepEqual(result.movedPoints, result.sourcePoints, "transform rebuild must move materialized guide points");
  assert.deepEqual(result.resetPoints, result.sourcePoints, "reset must restore the exact source V1 guide");
  assert.equal(result.attachment.contract, "procplants.vine-live-support");
  assert.equal(result.attachment.version, 1);
  assert.equal(result.attachment.bindings.length, 2);
  assert.equal(result.movedAttachment.bindings.length, 2);
  const serialized = JSON.stringify(result.attachment);
  assert.equal(serialized.includes("matrixWorld"), false);
  assert.equal(serialized.includes('"geometry"'), false);
  assert.equal(serialized.includes('"vertices"'), false);
  assert.equal(result.resetAttachment, null);
  assert.equal(result.disposed, "true");
  assert.equal(result.bindingsAfterReset, 0);
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
