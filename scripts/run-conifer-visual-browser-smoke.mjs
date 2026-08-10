import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_CONIFER_VISUAL_PORT ?? 4203);
const debugPort = Number(process.env.PROCPLANTS_CONIFER_VISUAL_DEBUG_PORT ?? 9253);
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
if (!chrome) throw new Error("Chrome or Edge is required for the conifer visual browser smoke test");

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
      if ((await fetch(url)).ok) return;
    } catch {
      // Preview may not have bound its socket yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-conifer-visual-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitForOk(`http://127.0.0.1:${appPort}/`);
  browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--disable-crashpad", "--no-first-run", "--disable-extensions",
    "--window-size=1280,900", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${appPort}/?p=blueSpruce&s=cloverGroundcover&seed=612072&d=0`,
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
  await command("Page.addScriptToEvaluateOnNewDocument", {
    source: "Object.defineProperty(performance, 'now', { configurable: true, value: () => 1000 });",
  });
  await command("Page.reload");
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
  assert.equal(stableDocuments, 3, "browser document must stabilize before visual capture");
  const evaluated = await command("Runtime.evaluate", {
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const app = document.querySelector('#app');
        let primary = null;
        for (let i = 0; i < 180; i++) {
          primary = document.querySelector('#primary');
          if (primary && !primary.disabled) break;
          await wait(100);
        }
        if (!primary) throw new Error('primary preset selector did not load');
        const waitForIdle = async () => {
          for (let i = 0; i < 180 && document.querySelector('#regenerate')?.disabled; i++) await wait(100);
          for (let i = 0; i < 180 && app?.dataset.heroLodPending !== 'false'; i++) await wait(100);
          await wait(500);
        };
        const capture = async () => {
          await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
          const canvas = document.querySelector('canvas');
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let hash = 0x811c9dc5;
          let sum = 0;
          let sumSquares = 0;
          let opaque = 0;
          let foliagePixels = 0;
          const bins = new Set();
          for (let offset = 0; offset < pixels.length; offset += 4) {
            const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2], a = pixels[offset + 3];
            hash ^= r; hash = Math.imul(hash, 0x01000193);
            hash ^= g; hash = Math.imul(hash, 0x01000193);
            hash ^= b; hash = Math.imul(hash, 0x01000193);
            hash ^= a; hash = Math.imul(hash, 0x01000193);
            const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
            sum += luminance; sumSquares += luminance * luminance;
            if (a > 0) opaque++;
            if (g > r * 1.035 && g > b * 1.035 && g - Math.min(r, b) > 8) foliagePixels++;
            bins.add((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4));
          }
          const count = pixels.length / 4;
          const mean = sum / count;
          return {
            hash: (hash >>> 0).toString(16).padStart(8, '0'),
            width: canvas.width,
            height: canvas.height,
            opaque,
            foliagePixels,
            colorBins: bins.size,
            luminanceVariance: sumSquares / count - mean * mean,
            webglError: gl.getError(),
          };
        };
        const ids = ['blueSpruce', 'alpineFir', 'redwoodSpire', 'tundraSmallPine', 'shorePineCones'];
        const results = [];
        for (const id of ids) {
          primary.value = id;
          primary.dispatchEvent(new Event('change', { bubbles: true }));
          await waitForIdle();
          const first = await capture();
          const second = await capture();
          results.push({
            id,
            first,
            second,
            triangles: Number(document.querySelector('#triangles').textContent.replaceAll(',', '')),
            draws: Number(app?.dataset.previewDraws ?? '0'),
            heroTriangles: Number(app?.dataset.heroTemplateTriangles ?? '0'),
          });
        }
        return results;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(evaluated.result?.exceptionDetails, undefined, evaluated.result?.exceptionDetails?.text);
  const results = evaluated.result?.result?.value;
  assert.equal(results.length, 5);
  for (const result of results) {
    assert.equal(result.first.hash, result.second.hash, `${result.id} fixed-camera WebGL pixels must be stable`);
    assert.ok(result.first.opaque > 0, `${result.id} must render pixels`);
    assert.ok(result.first.foliagePixels > 0, `${result.id} must retain visible green foliage coverage`);
    assert.ok(result.first.colorBins >= 24, `${result.id} must retain a nontrivial shaded silhouette`);
    assert.ok(result.first.luminanceVariance > 40, `${result.id} must retain visual contrast`);
    assert.equal(result.first.webglError, 0, `${result.id} must render without a WebGL error`);
    assert.ok(result.triangles > 0, `${result.id} must render authored geometry`);
    assert.ok(result.draws > 0, `${result.id} must report real scene draws`);
    assert.ok(result.heroTriangles > 0, `${result.id} must report hero LOD geometry`);
  }
  assert.equal(new Set(results.map((result) => result.first.hash)).size, results.length,
    "each audited conifer must retain a distinct fixed-camera silhouette");
  console.log(JSON.stringify(results, null, 2));
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
