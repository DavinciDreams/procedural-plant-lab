import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_LOD5_WEBGL_PORT ?? 4197);
const debugPort = Number(process.env.PROCPLANTS_LOD5_WEBGL_DEBUG_PORT ?? 9247);
assert.ok(Number.isInteger(appPort) && appPort > 1024 && appPort < 65536);
assert.ok(Number.isInteger(debugPort) && debugPort > 1024 && debugPort < 65536 && debugPort !== appPort);
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
if (!chrome) throw new Error("Chrome or Edge is required for the five-tier LOD WebGL smoke test");

const waitFor = async (probe, label, timeoutMs = 60_000) => {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${label}: ${String(lastError ?? "not ready")}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-lod5-webgl-"));
const vite = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "--host", "127.0.0.1", "--port", String(appPort), "--strictPort",
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
let socket;
try {
  const pageUrl = `http://127.0.0.1:${appPort}/scripts/procplant-five-tier-lod-browser-smoke.html`;
  await waitFor(async () => (await fetch(pageUrl)).ok, "Vite five-tier LOD page");
  browser = spawn(chrome, [
    "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--no-first-run", "--disable-extensions", "--disable-background-networking",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, pageUrl,
  ], { stdio: "ignore", windowsHide: true });
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    if (!response.ok) return null;
    const entries = await response.json();
    return entries.find((entry) => entry.type === "page" && entry.url.includes("procplant-five-tier-lod-browser-smoke"));
  }, "Chrome five-tier LOD page target");
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
  const smoke = await waitFor(async () => {
    const response = await command("Runtime.evaluate", {
      expression: "window.__PROCPLANT_LOD5_BROWSER_SMOKE__ ?? null",
      returnByValue: true,
    });
    return response.result?.result?.value ?? null;
  }, "five-tier LOD WebGL result");
  if (smoke.status !== "pass") throw new Error(smoke.error ?? "five-tier LOD WebGL smoke failed");
  assert.match(smoke.gpu.version, /WebGL/);
  assert.ok(smoke.changedPixels > 500);
  assert.equal(smoke.drawCalls, 2);
  assert.equal(smoke.atlas.coverage, "hemisphere");
  assert.match(smoke.asset.cacheKey, /^procplants-lod5-atlas-v1-[0-9a-f]{8}$/);
  assert.match(smoke.asset.contentHash, /^fnv1a32-[0-9a-f]{8}$/);
  assert.equal(smoke.asset.captureApi, "three-webgl-render-target-readback");
  assert.equal(smoke.asset.packageCacheKey, smoke.asset.cacheKey);
  assert.ok(smoke.asset.documentBytes > smoke.atlas.width * smoke.atlas.height * 4);
  assert.equal(smoke.selectedLevel, 4);
  assert.equal(smoke.export.loadedMeshes, 5);
  assert.equal(smoke.export.defaultSceneMeshes, 1);
  assert.deepEqual(smoke.lods.map((lod) => lod.triangles), [352, 264, 4, 4, 2]);
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
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      break;
    } catch (error) {
      if (attempt === 9) console.warn(`WebGL browser profile cleanup deferred: ${String(error)}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
}
