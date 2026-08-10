import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const debugPort = Number(process.env.PROCPLANTS_WEBGPU_DEBUG_PORT ?? 9231);
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
if (!chrome) throw new Error("Chrome or Edge is required for the WebGPU visibility smoke test");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/") {
      response.writeHead(200, { "content-type": contentTypes.get(".html") });
      response.end('<!doctype html><title>procplants WebGPU smoke</title><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>');
      return;
    }
    const path = resolve(root, `.${decodeURIComponent(pathname)}`);
    const relativePath = relative(root, path);
    const allowedThree = relativePath.replaceAll("\\", "/") === "node_modules/three/build/three.module.js";
    if (relativePath.startsWith("..") || (relativePath.split(/[\\/]/)[0] !== "dist-lib" && !allowedThree)) {
      response.writeHead(404).end();
      return;
    }
    const data = await readFile(path);
    response.writeHead(200, { "content-type": contentTypes.get(extname(path)) ?? "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
const port = address.port;
const profile = await mkdtemp(join(tmpdir(), "procplants-webgpu-smoke-"));
let browser;

const waitForJson = async (url, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome may still be opening its debugging socket.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

try {
  browser = spawn(chrome, [
    "--headless=new",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,UseSkiaRenderer",
    "--use-angle=vulkan",
    "--no-first-run",
    "--disable-extensions",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `http://127.0.0.1:${port}/`,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((entry) => entry.type === "page" && entry.url.includes(String(port)));
  assert.ok(target?.webSocketDebuggerUrl, "headless browser page target must be available");
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
  await command("Runtime.enable");
  const expression = `
    (async () => {
      if (!navigator.gpu) return { available: false, reason: 'navigator.gpu unavailable' };
      const adapter = await navigator.gpu.requestAdapter() ?? await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
      if (!adapter) return { available: false, reason: 'requestAdapter returned null' };
      const device = await adapter.requestDevice();
      const core = await import('/dist-lib/core.js');
      const webgpu = await import('/dist-lib/webgpu.js');
      const centers = new Float32Array([0, 0, 0, 5, 0, 0, 20, 0, 0]);
      const clusters = core.buildProcPlantVisibilityClusters(
        { centers, radii: new Float32Array([0.1, 0.1, 0.1]) },
        { cellSize: 4, maxInstancesPerCluster: 2 },
      );
      const lodDistances = [0, 3, 8];
      const draws = [
        { indexCount: 120, firstIndex: 0, baseVertex: 0 },
        { indexCount: 48, firstIndex: 120, baseVertex: 4 },
        { indexCount: 12, firstIndex: 168, baseVertex: -2 },
      ];
      const view = core.createProcPlantVisibilityView([
        1, 0, 0, 10, -1, 0, 0, 10,
        0, 1, 0, 10, 0, -1, 0, 10,
        0, 0, 1, 10, 0, 0, -1, 10,
      ], [0, 0, 0], 12);
      const plan = webgpu.createProcPlantWebGpuVisibilityPlan(clusters, lodDistances, draws, { limits: device.limits });
      const reference = webgpu.referenceProcPlantWebGpuVisibility(clusters, lodDistances, draws, view);
      const runtime = await webgpu.createProcPlantWebGpuVisibilityRuntime(device, plan, { label: 'browser smoke' });
      runtime.dispatch(view);
      const readback = await runtime.readback();
      const comparison = webgpu.compareProcPlantWebGpuVisibilityReadback(readback, reference);
      const diagnostics = runtime.diagnostics;
      const adapterInfo = adapter.info ? {
        vendor: adapter.info.vendor ?? '',
        architecture: adapter.info.architecture ?? '',
        device: adapter.info.device ?? '',
        description: adapter.info.description ?? '',
      } : null;
      runtime.dispose();
      const disposedState = runtime.diagnostics.state;
      if (typeof device.destroy === 'function') device.destroy();
      return { available: true, comparison, diagnostics, disposedState, adapterInfo };
    })()
  `;
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
  }
  const result = response.result?.result?.value;
  assert.ok(result);
  if (result.available) {
    assert.deepEqual(result.comparison, { matches: true, mismatchCount: 0 });
    assert.equal(result.diagnostics.dispatchCount, 1);
    assert.equal(result.diagnostics.readbackCount, 1);
    assert.equal(result.disposedState, "disposed");
    console.log(JSON.stringify({ message: "procplant live WebGPU visibility smoke passed", ...result }));
  } else {
    console.log(JSON.stringify({ message: "procplant live WebGPU visibility smoke skipped", ...result }));
  }
  socket.close();
} finally {
  if (browser && browser.exitCode === null) {
    const exited = new Promise((resolveExit) => browser.once("exit", resolveExit));
    browser.kill();
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
  }
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
