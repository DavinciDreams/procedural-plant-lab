import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_GUIDED_VINE_DAG_SMOKE_PORT ?? 4200);
const debugPort = Number(process.env.PROCPLANTS_GUIDED_VINE_DAG_SMOKE_DEBUG_PORT ?? 9250);
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
if (!chrome) throw new Error("Chrome or Edge is required for the guided-vine DAG browser smoke test");

const waitForJson = async (url, timeoutMs = 60_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // The preview/debug socket may not be bound yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const waitForOk = async (url, timeoutMs = 60_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview socket may not be bound yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-guided-vine-dag-browser-"));
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
    `http://127.0.0.1:${appPort}/?p=floweringWallCreeper&s=floweringWallCreeper&h=0&seed=807026&d=0.15`,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((entry) => entry.type === "page" && entry.url.includes(String(appPort)));
  assert.ok(target?.webSocketDebuggerUrl, "headless guided-vine page target must be available");
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
  let ready = false;
  for (let attempt = 0; attempt < 180 && !ready; attempt++) {
    const probe = await command("Runtime.evaluate", {
      expression: "document.readyState === 'complete' && document.querySelector('#app')?.dataset.productionDagPath === 'legacy-canonical'",
      returnByValue: true,
    });
    ready = probe.result?.result?.value === true;
    if (!ready) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  assert.equal(ready, true, "fresh guided-vine page must reach its canonical production path");

  const evaluated = await command("Runtime.evaluate", {
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const app = document.querySelector('#app');
        const waitForIdle = async () => {
          for (let i = 0; i < 180 && document.querySelector('#regenerate')?.disabled; i++) await wait(100);
          await wait(350);
        };
        await waitForIdle();
        let previewError = null;
        window.addEventListener('unhandledrejection', (event) => {
          previewError = String(event.reason?.stack ?? event.reason);
        }, { once: true });
        document.querySelector('#inspectGraph').click();
        for (let i = 0; i < 180 && !document.querySelector('.graph-node-list > li'); i++) await wait(100);
        const rows = [...document.querySelectorAll('.graph-node-list > li')];
        const rowFor = (stage) => rows.find((entry) => entry.querySelector('.graph-node small')?.textContent?.startsWith(stage));
        const foliage = rowFor('foliage');
        const branching = rowFor('branching');
        if (!foliage || !branching) return {
          error: 'guided-vine graph editor did not render canonical stage rows',
          rowCount: rows.length,
          previewText: document.querySelector('#graphPreview')?.textContent,
          editorLoaded: app.dataset.graphEditorLoaded,
          inspectText: document.querySelector('#inspectGraph')?.textContent,
          previewError,
        };
        const branchingEnabled = branching.querySelector('input[type="checkbox"]')?.checked ?? null;
        const seedLabel = [...foliage.querySelectorAll('label')].find((label) => label.textContent.includes('stage seed'));
        const seedInput = seedLabel.querySelector('input');
        seedInput.value = '4321';
        seedInput.dispatchEvent(new Event('change', { bubbles: true }));
        for (let i = 0; i < 180 && app.dataset.productionDagPath !== 'typed-artifacts'; i++) await wait(100);
        await waitForIdle();
        const typedHash = app.dataset.productionDagHash;
        const typedArtifacts = Number(app.dataset.productionDagArtifacts);

        let exportedBlob = null;
        const originalCreateObjectUrl = URL.createObjectURL;
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (blob) => { exportedBlob = blob; return 'blob:guided-vine-dag-smoke'; };
        HTMLAnchorElement.prototype.click = () => {};
        document.querySelector('#exportJson').click();
        for (let i = 0; i < 180 && !exportedBlob; i++) await wait(100);
        const exported = JSON.parse(await exportedBlob.text());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;

        document.querySelector('.graph-editor-actions button').click();
        for (let i = 0; i < 180 && app.dataset.productionDagPath !== 'legacy-canonical'; i++) await wait(100);
        await waitForIdle();
        const source = exported.authoring.generatorGraph.nodes.find((node) => node.stage === 'source');
        const branchRecord = exported.authoring.productionDag.records.find((record) => record.stage === 'branching');
        const foliageRecord = exported.authoring.productionDag.records.find((record) => record.stage === 'foliage');
        return {
          typedHash,
          typedPath: exported.authoring.productionDag.path,
          resetPath: app.dataset.productionDagPath,
          backend: source.parameters.backend,
          branchingEnabled,
          branchStatus: branchRecord.status,
          foliageSeed: foliageRecord.seed,
          artifacts: typedArtifacts,
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(evaluated.result?.exceptionDetails, undefined, evaluated.result?.exceptionDetails?.text);
  const result = evaluated.result?.result?.value;
  if (result?.error) console.error(JSON.stringify(result));
  assert.equal(result.typedPath, "typed-artifacts");
  assert.equal(result.resetPath, "legacy-canonical");
  assert.equal(result.backend, "guided-vine");
  assert.equal(result.branchingEnabled, false);
  assert.equal(result.branchStatus, "disabled");
  assert.equal(result.foliageSeed, 4321);
  assert.equal(result.artifacts, 8);
  assert.match(result.typedHash, /^[0-9a-f]{8}$/);
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
