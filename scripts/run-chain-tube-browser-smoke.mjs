import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_CHAIN_TUBE_SMOKE_PORT ?? 4189);
const debugPort = Number(process.env.PROCPLANTS_CHAIN_TUBE_SMOKE_DEBUG_PORT ?? 9239);
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
if (!chrome) throw new Error("Chrome or Edge is required for the chain tube browser smoke test");

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

const profile = await mkdtemp(join(tmpdir(), "procplants-chain-tube-browser-"));
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
        const waitForIdle = async () => {
          for (let i = 0; i < 180 && document.querySelector('#regenerate')?.disabled; i++) await wait(100);
          for (let i = 0; i < 180 && app?.dataset.heroLodPending !== 'false'; i++) await wait(100);
          await wait(300);
        };
        for (let i = 0; i < 180 && app?.dataset.chainTubeAvailable !== 'true'; i++) await wait(100);
        await waitForIdle();
        const select = document.querySelector('#chainTubeSelect');
        const options = [...select.options];
        const longest = options.sort((a, b) => Number(/(\\d+) nodes/.exec(b.textContent)?.[1] ?? 0) - Number(/(\\d+) nodes/.exec(a.textContent)?.[1] ?? 0))[0];
        select.value = longest.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const selectedChain = select.value;
        const beforeTriangles = Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
        document.querySelector('#chainTubeRadius').value = '1.6';
        document.querySelector('#chainTubeTaper').value = '0.4';
        document.querySelector('#chainTubeResolution').value = '3';
        document.querySelector('#chainTubeResolution').dispatchEvent(new Event('change', { bubbles: true }));
        await waitForIdle();
        const afterTriangles = Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
        const serialized = new URL(location.href).searchParams.get('ct');
        const parsed = JSON.parse(serialized);

        let exportedBlob = null;
        const originalCreateObjectUrl = URL.createObjectURL;
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (blob) => { exportedBlob = blob; return 'blob:chain-tube-smoke'; };
        HTMLAnchorElement.prototype.click = () => {};
        document.querySelector('#exportJson').click();
        for (let i = 0; i < 180 && !exportedBlob; i++) await wait(100);
        const exported = JSON.parse(await exportedBlob.text());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;

        document.querySelector('#chainTubeReset').click();
        await waitForIdle();
        const resetTriangles = Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
        return {
          available: app.dataset.chainTubeAvailable,
          chainCount: Number(app.dataset.chainTubeCount),
          signature: app.dataset.chainTubeGraphSignature,
          selectedChain,
          selectedDataset: app.dataset.chainTubeSelected,
          overrideCount: Number(parsed.overrides.length),
          contract: parsed.contract,
          radiusScale: parsed.overrides[0]?.radiusScale,
          taperScale: parsed.overrides[0]?.taperScale,
          radialSegments: parsed.overrides[0]?.radialSegments,
          beforeTriangles,
          afterTriangles,
          resetTriangles,
          exportStateContract: exported.state.chainTubeOverrides?.contract,
          exportGenomeContract: exported.genome.spaceColonization?.chainTubeOverrides?.contract,
          resetUrlValue: new URL(location.href).searchParams.get('ct'),
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(evaluated.exceptionDetails, undefined, evaluated.exceptionDetails?.text);
  const result = evaluated.result?.result?.value;
  assert.equal(result.available, "true");
  assert.ok(result.chainCount > 8);
  assert.match(result.signature, /^fnv1a64:[0-9a-f]{16}$/);
  assert.equal(result.selectedDataset, result.selectedChain);
  assert.equal(result.overrideCount, 1);
  assert.equal(result.contract, "procplants.chain-tube-overrides");
  assert.equal(result.radiusScale, 1.6);
  assert.equal(result.taperScale, 0.4);
  assert.equal(result.radialSegments, 3);
  console.log(JSON.stringify(result));
  assert.ok(result.afterTriangles < result.beforeTriangles, "selected-chain resolution must reduce live preview triangles");
  assert.equal(result.exportStateContract, result.contract);
  assert.equal(result.exportGenomeContract, result.contract);
  assert.equal(result.resetTriangles, result.beforeTriangles, "reset must restore the exact live triangle count");
  assert.equal(result.resetUrlValue, null);
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
