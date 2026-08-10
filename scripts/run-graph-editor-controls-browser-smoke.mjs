import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_GRAPH_EDITOR_SMOKE_PORT ?? 4217);
const debugPort = Number(process.env.PROCPLANTS_GRAPH_EDITOR_SMOKE_DEBUG_PORT ?? 9267);
const candidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(candidates.map(async (candidate) => { await access(candidate); return candidate; })).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for the graph editor browser smoke test");

const waitForOk = async (url, timeoutMs = 60_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch { /* preview is starting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};
const waitForJson = async (url, timeoutMs = 60_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch { /* browser is starting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-graph-editor-browser-"));
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
    `http://127.0.0.1:${appPort}/?p=understoryShrub&s=understoryShrub&seed=807026&d=0.02`,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((entry) => entry.type === "page" && entry.url.includes(String(appPort)));
  assert.ok(target?.webSocketDebuggerUrl);
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
    if (callback) { pending.delete(message.id); callback(message); }
  });
  const command = (method, params = {}) => new Promise((resolvePromise) => {
    const id = ++commandId;
    pending.set(id, resolvePromise);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Page.enable");
  await command("Runtime.enable");
  let stableDocuments = 0;
  for (let attempt = 0; attempt < 120 && stableDocuments < 3; attempt++) {
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

  const response = await command("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const waitFor = async (test, label) => {
          for (let index = 0; index < 600; index++) {
            const value = test();
            if (value) return value;
            await wait(100);
          }
          throw new Error('timed out waiting for ' + label);
        };
        await waitFor(() => document.querySelector('#inspectGraph') && !document.querySelector('#inspectGraph').disabled, 'graph button');
        const initialLazy = performance.getEntriesByType('resource').some((entry) => /procplant-graph-editor-ui-/.test(entry.name));
        document.querySelector('#inspectGraph').click();
        await waitFor(() => document.querySelector('.graph-subgraph-clipboard textarea'), 'graph editor');
        const rowFor = (stage) => [...document.querySelectorAll('.graph-node-list > li')]
          .find((entry) => entry.querySelector('.graph-node small')?.textContent?.startsWith(stage));
        const open = (stage) => {
          const row = rowFor(stage);
          if (!row.classList.contains('active')) row.querySelector('.graph-node').click();
          return row;
        };
        const initialHash = document.querySelector('#graphPreview').dataset.hash;
        let architecture = open('architecture');
        const architectureButton = architecture.querySelector('.graph-node');
        const controlsId = architectureButton.getAttribute('aria-controls');
        architecture.querySelector('[data-graph-action="copy-subgraph"]').click();
        const clipboardText = document.querySelector('.graph-subgraph-clipboard textarea').value;
        const clipboard = JSON.parse(clipboardText);
        const countInput = architecture.querySelector('input[aria-label$=" count"]');
        const copiedCount = Number(countInput.value);
        countInput.value = String(copiedCount + 1);
        countInput.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => document.querySelector('#graphPreview').dataset.hash !== initialHash, 'count edit');
        architecture = open('architecture');
        architecture.querySelector('[data-graph-action="paste-subgraph"]').click();
        await waitFor(() => document.querySelector('#graphPreview').dataset.hash === initialHash, 'subgraph paste restore');
        architecture = open('architecture');
        const restoredCount = Number(architecture.querySelector('input[aria-label$=" count"]').value);

        const beforeWrongStageHash = document.querySelector('#graphPreview').dataset.hash;
        const foliage = open('foliage');
        foliage.querySelector('[data-graph-action="paste-subgraph"]').click();
        const wrongStageStatus = document.querySelector('.graph-editor-status').textContent;
        const afterWrongStageHash = document.querySelector('#graphPreview').dataset.hash;

        const addButton = document.querySelector('.graph-editor-actions [data-graph-action="add-node"]');
        const beforeAddHash = document.querySelector('#graphPreview').dataset.hash;
        addButton?.click();
        await waitFor(() => document.querySelector('#graphPreview').dataset.hash !== beforeAddHash, 'node add');
        const reproductive = open('reproductive');
        const removeButton = reproductive.querySelector('[data-graph-action="remove-node"]');
        removeButton.click();
        await waitFor(() => document.querySelector('#graphPreview').dataset.hash === beforeAddHash, 'node remove restore');

        architecture = open('architecture');
        const spacing = architecture.querySelector('input[aria-label$="placement spacing"]');
        const originalSpacing = Number(spacing.value);
        spacing.value = String(originalSpacing + 0.01);
        spacing.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => !architecture.isConnected, 'placement edit rerender');
        const editedSpacing = Number(open('architecture').querySelector('input[aria-label$="placement spacing"]').value);
        const branching = open('branching');
        const maxDepth = branching.querySelector('.graph-scope-editor input[type="number"]');
        maxDepth.value = '2';
        maxDepth.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => !branching.isConnected, 'scope edit rerender');
        const editedMaxDepth = Number(open('branching').querySelector('.graph-scope-editor input[type="number"]').value);

        const originalCreateObjectUrl = URL.createObjectURL;
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        window.__graphExportBlob = null;
        URL.createObjectURL = (blob) => { window.__graphExportBlob = blob; return originalCreateObjectUrl(blob); };
        HTMLAnchorElement.prototype.click = function () { if (!this.download) return originalAnchorClick.call(this); };
        document.querySelector('#exportJson').click();
        await waitFor(() => window.__graphExportBlob, 'JSON export blob');
        const exported = JSON.parse(await window.__graphExportBlob.text());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;

        const beforeResetClipboard = document.querySelector('.graph-subgraph-clipboard');
        document.querySelector('.graph-editor-actions button').click();
        await waitFor(() => !beforeResetClipboard.isConnected, 'exact reset');
        const resetDisabled = document.querySelector('.graph-editor-actions button').disabled;
        const copyTargetHeight = Number.parseFloat(getComputedStyle(open('architecture').querySelector('[data-graph-action="copy-subgraph"]')).minHeight);
        return {
          initialLazy,
          clipboardContract: clipboard.contract,
          clipboardRootCount: clipboard.rootIds.length,
          clipboardStages: clipboard.nodes.map((node) => node.stage),
          copiedCount,
          restoredCount,
          wrongStageStatus,
          wrongStageUnchanged: beforeWrongStageHash === afterWrongStageHash,
          addRemoveRestored: document.querySelector('#graphPreview').dataset.hash === initialHash,
          editedSpacing,
          editedMaxDepth,
          exportedOverrides: exported.authoring.generatorOverrides,
          exportedArchitecture: exported.authoring.generatorGraph.nodes.find((node) => node.stage === 'architecture'),
          exportedBranching: exported.authoring.generatorGraph.nodes.find((node) => node.stage === 'branching'),
          exportedProductionPath: exported.authoring.productionDag?.path ?? null,
          resetDisabled,
          ariaExpanded: architectureButton.getAttribute('aria-expanded'),
          ariaControlsExists: Boolean(controlsId && document.getElementById(controlsId)),
          statusLive: document.querySelector('.graph-editor-status').getAttribute('aria-live'),
          clipboardLabelled: Boolean(document.querySelector('.graph-subgraph-clipboard label textarea')),
          copyTargetHeight,
        };
      })()
    `,
  });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  const result = response.result?.result?.value;
  assert.ok(result, JSON.stringify(response));
  assert.equal(result.initialLazy, false, "graph editor must remain lazy before opening");
  assert.equal(result.clipboardContract, "procplants.generator-subgraph");
  assert.equal(result.clipboardRootCount, 1);
  assert.deepEqual(result.clipboardStages, ["source", "architecture"]);
  assert.equal(result.restoredCount, result.copiedCount);
  assert.match(result.wrongStageStatus, /Cannot paste architecture controls onto foliage/);
  assert.equal(result.wrongStageUnchanged, true);
  assert.equal(result.addRemoveRestored, true);
  assert.ok(Math.abs(result.editedSpacing - 0.12) < 1e-12);
  assert.equal(result.editedMaxDepth, 2);
  assert.ok(result.exportedOverrides.some((operation) => operation.op === "set-placement"));
  assert.ok(Math.abs(result.exportedArchitecture.placement.spacing - 0.12) < 1e-12);
  assert.equal(result.exportedBranching.parentScope.maxDepth, 2);
  assert.ok(result.exportedProductionPath);
  assert.equal(result.resetDisabled, true);
  assert.equal(result.ariaExpanded, "true");
  assert.equal(result.ariaControlsExists, true);
  assert.equal(result.statusLive, "polite");
  assert.equal(result.clipboardLabelled, true);
  assert.ok(result.copyTargetHeight >= 24);
  console.log(JSON.stringify(result, null, 2));
  console.log("procplant graph editor browser copy/paste/add/remove/export smoke passed");
  socket.close();
} finally {
  const stop = async (handle) => {
    if (!handle || handle.exitCode !== null) return;
    const exited = new Promise((resolvePromise) => handle.once("exit", resolvePromise));
    handle.kill();
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
  };
  await stop(browser);
  await stop(preview);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
}
