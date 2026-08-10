import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_WEBER_TRIM_PORT ?? 4191);
const debugPort = Number(process.env.PROCPLANTS_WEBER_TRIM_DEBUG_PORT ?? 9241);
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
if (!chrome) throw new Error("Chrome or Edge is required for the Weber-Penn trim browser smoke test");

const waitForOk = async (url, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Preview may not have bound yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const waitForJson = async (url, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser debug endpoint may not have bound yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-weber-trim-browser-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitForOk(`http://127.0.0.1:${appPort}/`);
  browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--disable-breakpad", "--disable-crash-reporter",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${appPort}/`,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((entry) => entry.type === "page" && entry.url.includes(String(appPort)));
  assert.ok(target?.webSocketDebuggerUrl);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
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
    stableDocuments = !probe.error && value?.ready === "complete" && String(value?.href ?? "").includes(String(appPort))
      ? stableDocuments + 1
      : 0;
    if (stableDocuments < 3) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.equal(stableDocuments, 3);
  const response = await command("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const idle = async () => {
          for (let i = 0; i < 180 && document.querySelector('#regenerate')?.disabled; i++) await wait(100);
          await wait(250);
        };
        for (let i = 0; i < 180 && (!document.querySelector('#primary') || document.querySelector('#regenerate')?.disabled); i++) await wait(100);
        const primary = document.querySelector('#primary');
        primary.value = 'oakCanopy';
        primary.dispatchEvent(new Event('change', { bubbles: true }));
        await idle();
        const app = document.querySelector('#app');
        document.querySelector('#pruneMode').click();
        for (let i = 0; i < 180 && app.dataset.heroPruneBackend !== 'weber-penn'; i++) await wait(100);
        const initialTriangles = Number(app.dataset.heroTemplateTriangles);
        const initialVertices = Number(app.dataset.heroTemplateVertices);
        const sourceSignature = app.dataset.heroPruneTargetSignature;
        const canvas = document.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        const strokeRows = [0.3, 0.38, 0.46, 0.54, 0.62];
        let selected = '';
        for (const ry of strokeRows) {
          const pointerId = 41;
          canvas.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, button: 0, buttons: 1, pointerId,
            clientX: rect.left + rect.width * 0.28,
            clientY: rect.top + rect.height * ry,
          }));
          for (let step = 1; step <= 12; step++) {
            canvas.dispatchEvent(new PointerEvent('pointermove', {
              bubbles: true, button: 0, buttons: 1, pointerId,
              clientX: rect.left + rect.width * (0.28 + step * 0.036),
              clientY: rect.top + rect.height * ry,
            }));
          }
          canvas.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true, button: 0, buttons: 0, pointerId,
            clientX: rect.left + rect.width * 0.72,
            clientY: rect.top + rect.height * ry,
          }));
          await wait(75);
          selected = app.dataset.heroPruneSelectedIds ?? '';
          if (selected && !selected.split(',').includes('weber-penn:stem:0') && !document.querySelector('#pruneSelected').disabled) break;
        }
        const candidates = [
          [0.58, 0.48], [0.62, 0.42], [0.55, 0.38], [0.66, 0.52],
          [0.44, 0.44], [0.38, 0.5], [0.52, 0.58], [0.7, 0.36],
        ];
        for (const [rx, ry] of candidates) {
          if (selected && !selected.split(',').includes('weber-penn:stem:0') && !document.querySelector('#pruneSelected').disabled) break;
          canvas.dispatchEvent(new PointerEvent('click', {
            bubbles: true,
            button: 0,
            clientX: rect.left + rect.width * rx,
            clientY: rect.top + rect.height * ry,
          }));
          await wait(50);
          selected = app.dataset.heroPruneSelectedIds ?? '';
          if (selected && !selected.split(',').includes('weber-penn:stem:0') && !document.querySelector('#pruneSelected').disabled) break;
        }
        if (!selected || selected.split(',').includes('weber-penn:stem:0')) throw new Error('could not select a non-root stable Weber-Penn stem through the live picker');
        document.querySelector('#pruneSelected').click();
        await idle();
        for (let i = 0; i < 180 && app.dataset.weberPennTrimStatus !== 'applied'; i++) await wait(100);
        const trimmedTriangles = Number(app.dataset.heroTemplateTriangles);
        const trimmedVertices = Number(app.dataset.heroTemplateVertices);
        const nativeBefore = Number(app.dataset.weberPennTrimBeforeTriangles);
        const nativeAfter = Number(app.dataset.weberPennTrimAfterTriangles);
        const removedStems = Number(app.dataset.weberPennTrimRemovedStems);
        const removedLeaves = Number(app.dataset.weberPennTrimRemovedLeaves);
        document.querySelector('#inspectReadiness').click();
        for (let i = 0; i < 180 && !app.dataset.readinessTriangles; i++) await wait(100);
        const readinessTriangles = Number(app.dataset.readinessTriangles);
        const readinessVertices = Number(app.dataset.readinessVertices);

        let exportedBlob = null;
        const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (blob) => {
          if (blob.type === 'model/gltf-binary') exportedBlob = blob;
          return originalCreateObjectUrl(blob);
        };
        HTMLAnchorElement.prototype.click = function () {};
        document.querySelector('#exportGlb').click();
        for (let i = 0; i < 180 && !exportedBlob; i++) await wait(100);
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
        const bytes = new Uint8Array(await exportedBlob.arrayBuffer());
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const jsonLength = view.getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim());
        const metadata = json.scenes?.[0]?.extras?.procplant?.metadata ?? {};

        document.querySelector('#resetPrune').click();
        await idle();
        const resetTriangles = Number(app.dataset.heroTemplateTriangles);
        const resetVertices = Number(app.dataset.heroTemplateVertices);
        return {
          initialTriangles,
          initialVertices,
          sourceSignature,
          selected,
          trimmedTriangles,
          trimmedVertices,
          nativeBefore,
          nativeAfter,
          removedStems,
          removedLeaves,
          readinessTriangles,
          readinessVertices,
          exportTrimStatus: metadata.weberPennTrimStatus,
          exportSourceSignature: metadata.weberPennTrimSourceSignature,
          exportResultSignature: metadata.weberPennTrimResultSignature,
          exportRemovedStems: metadata.weberPennTrimRemovedStems,
          exportRemovedLeaves: metadata.weberPennTrimRemovedLeaves,
          exportAuthoredTriangles: metadata.authoredTriangles,
          exportAuthoredVertices: metadata.authoredVertices,
          resetTriangles,
          resetVertices,
          resetStatus: app.dataset.weberPennTrimStatus ?? null,
        };
      })()
    `,
  });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  const result = response.result?.result?.value;
  if (!result) console.error(JSON.stringify(response));
  assert.ok(result);
  console.log(JSON.stringify(result));
  assert.match(result.sourceSignature, /^fnv1a32:[0-9a-f]{8}$/);
  assert.match(result.selected, /^weber-penn:stem:\d+(?:,weber-penn:stem:\d+)*$/);
  assert.ok(result.trimmedTriangles < result.initialTriangles, "live trim must remove preview/export triangles");
  assert.ok(result.trimmedVertices < result.initialVertices, "live trim must remove owned vertex ranges");
  assert.ok(result.nativeAfter < result.nativeBefore);
  assert.ok(result.removedStems > 0);
  assert.ok(result.removedLeaves > 0);
  assert.equal(result.readinessTriangles, result.trimmedTriangles, "readiness must inspect the exact authored hero template");
  assert.equal(result.readinessVertices, result.trimmedVertices);
  assert.equal(result.exportTrimStatus, "applied");
  assert.equal(result.exportSourceSignature, result.sourceSignature);
  assert.match(result.exportResultSignature, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(result.exportRemovedStems, result.removedStems);
  assert.equal(result.exportRemovedLeaves, result.removedLeaves);
  assert.equal(result.exportAuthoredTriangles, result.trimmedTriangles);
  assert.equal(result.exportAuthoredVertices, result.trimmedVertices);
  assert.equal(result.resetTriangles, result.initialTriangles, "Reset Trim must restore exact generated triangle count");
  assert.equal(result.resetVertices, result.initialVertices, "Reset Trim must restore exact generated vertex count");
  assert.equal(result.resetStatus, null);
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
      if (attempt === 9) console.warn(`browser profile cleanup deferred: ${String(error)}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
}
