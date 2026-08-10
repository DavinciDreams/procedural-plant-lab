import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_DECAL_GLB_PORT ?? 4203);
const debugPort = Number(process.env.PROCPLANTS_DECAL_GLB_DEBUG_PORT ?? 9253);
const candidates = process.platform === "win32" ? [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(candidates.map(async (candidate) => { await access(candidate); return candidate; })).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for the placement decal GLB browser smoke test");

const waitFor = async (probe, label, timeoutMs = 60_000) => {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try { const value = await probe(); if (value) return value; } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${label}: ${String(lastError ?? "not ready")}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-decal-glb-browser-"));
const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});
let browser;
let socket;
try {
  const pageUrl = `http://127.0.0.1:${appPort}/scripts/procplant-placement-decal-glb-browser-smoke.html`;
  await waitFor(async () => (await fetch(pageUrl)).ok, "Vite decal GLB page");
  browser = spawn(chrome, [
    "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--no-first-run", "--disable-extensions", "--disable-background-networking",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, pageUrl,
  ], { stdio: "ignore", windowsHide: true });
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    if (!response.ok) return null;
    return (await response.json()).find((entry) => entry.type === "page" && entry.url.includes("procplant-placement-decal-glb-browser-smoke"));
  }, "Chrome decal GLB target");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
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
    if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? "runtime exception");
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
  });
  const command = (method, params = {}) => new Promise((resolveCommand) => {
    const id = ++commandId; pending.set(id, resolveCommand); socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Runtime.enable");
  const smoke = await waitFor(async () => {
    const response = await command("Runtime.evaluate", { expression: "window.__PROCPLANT_DECAL_GLB_BROWSER_SMOKE__ ?? null", returnByValue: true });
    return response.result?.result?.value ?? null;
  }, "placement decal GLB browser result");
  if (smoke.status !== "pass") throw new Error(smoke.error ?? "placement decal GLB browser smoke failed");
  assert.equal(smoke.draws, 1);
  assert.equal(smoke.vertices, 4);
  assert.equal(smoke.triangles, 2);
  assert.equal(smoke.loadedMaterial, "browser-decal-material");
  assert.equal(smoke.loadedTexture, true);
  assert.equal(smoke.loadedUvPairs, 4);
  assert.equal(smoke.loadedIndices, 6);
  assert.ok(smoke.changedPixels > 100);
  assert.equal(smoke.glError, 0);
  assert.match(smoke.gpu.version, /WebGL/);
  assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join("\n")}`);
  console.log(JSON.stringify(smoke));
} finally {
  socket?.close();
  const stop = async (handle) => {
    if (!handle || handle.exitCode !== null) return;
    const exited = new Promise((resolveExit) => handle.once("exit", resolveExit));
    handle.kill();
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
  };
  await stop(browser); await stop(vite);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
