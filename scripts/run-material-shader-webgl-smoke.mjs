import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_MATERIAL_SHADER_WEBGL_PORT ?? 4195);
const debugPort = Number(process.env.PROCPLANTS_MATERIAL_SHADER_WEBGL_DEBUG_PORT ?? 9245);
const candidates = process.platform === "win32" ? [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(candidates.map(async (candidate) => { await access(candidate); return candidate; })).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for the material shader WebGL smoke test");
const waitFor = async (probe, label, timeout = 60_000) => {
  const started = Date.now(); let lastError;
  while (Date.now() - started < timeout) {
    try { const value = await probe(); if (value) return value; } catch (error) { lastError = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${label}: ${String(lastError ?? "not ready")}`);
};
const profile = await mkdtemp(join(tmpdir(), "procplants-material-shader-webgl-"));
const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"], { cwd: root, stdio: "ignore", windowsHide: true });
let browser; let socket;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${appPort}/scripts/procplant-material-shader-webgl-smoke.html`)).ok, "Vite shader page");
  browser = spawn(chrome, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-first-run", "--disable-extensions", "--disable-background-networking", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${appPort}/scripts/procplant-material-shader-webgl-smoke.html`], { stdio: "ignore", windowsHide: true });
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`); if (!response.ok) return null;
    return (await response.json()).find((entry) => entry.type === "page" && entry.url.includes("material-shader-webgl-smoke"));
  }, "Chrome shader page target");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => { socket.addEventListener("open", resolvePromise, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0; const pending = new Map(); const errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") errors.push(message.params.args?.map((arg) => arg.description ?? arg.value).join(" ") ?? "console error");
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text);
    const resolvePromise = pending.get(message.id); if (resolvePromise) { pending.delete(message.id); resolvePromise(message); }
  });
  const command = (method, params = {}) => new Promise((resolvePromise) => { const commandId = ++id; pending.set(commandId, resolvePromise); socket.send(JSON.stringify({ id: commandId, method, params })); });
  await command("Runtime.enable");
  const result = await waitFor(async () => {
    const response = await command("Runtime.evaluate", { expression: "window.__PROCPLANT_MATERIAL_SHADER_WEBGL_SMOKE__ ?? null", returnByValue: true });
    return response.result?.result?.value ?? null;
  }, "material shader WebGL result");
  if (result.status !== "pass") throw new Error(result.error ?? "material shader WebGL smoke failed");
  assert.match(result.renderer, /WebGL/);
  assert.match(result.planHash, /^fnv1a32:[0-9a-f]{8}$/);
  assert.match(result.cacheKey, /procplant-wind-v1.*procplant-material-shader-v1/);
  assert.ok(result.changed.shader >= 500 && result.changed.shadow >= 50 && result.changed.wind >= 50);
  assert.equal(new Set(Object.values(result.hashes)).size, 4);
  assert.deepEqual(errors, [], `browser console errors: ${errors.join("\n")}`);
  console.log(JSON.stringify(result));
} finally {
  socket?.close();
  for (const processHandle of [browser, vite]) if (processHandle && processHandle.exitCode === null) processHandle.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
