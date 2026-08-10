import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_FORCE_EDITOR_SMOKE_PORT ?? 4227);
const debugPort = Number(process.env.PROCPLANTS_FORCE_EDITOR_SMOKE_DEBUG_PORT ?? 9277);
const candidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(candidates.map(async (candidate) => { await access(candidate); return candidate; })).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for the spatial force editor browser smoke test");

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

const profile = await mkdtemp(join(tmpdir(), "procplants-force-editor-browser-"));
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
    `http://127.0.0.1:${appPort}/?p=understoryShrub&s=understoryShrub&seed=807026&d=0.15`,
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
        await waitFor(() => document.querySelector('#editSpatialForces') && !document.querySelector('#editSpatialForces').disabled, 'force editor button');
        const initialLazy = performance.getEntriesByType('resource').some((entry) => /procplant-spatial-force-editor-ui-/.test(entry.name));
        const button = document.querySelector('#editSpatialForces');
        button.click();
        await waitFor(() => document.querySelector('.spatial-force-actions'), 'force editor');
        const controlsId = button.getAttribute('aria-controls');
        document.querySelector('.spatial-force-actions button').click();
        await waitFor(() => document.querySelector('#app').dataset.spatialForceStatus === 'applied', 'real force application');
        await waitFor(() => document.querySelector('#spatialForceEditor').dataset.fieldCount === '1', 'field rerender');
        const firstSignature = document.querySelector('#app').dataset.spatialForceSignature;
        const affectedNodes = Number(document.querySelector('#app').dataset.spatialForceAffectedNodes);
        const visualCount = Number(document.querySelector('#app').dataset.spatialForceVisuals);
        const strength = document.querySelector('input[aria-label="field-01 strength"]');
        const labelledStrength = strength.closest('label') !== null;
        strength.value = '0.4';
        strength.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => document.querySelector('#app').dataset.spatialForceSignature !== firstSignature, 'field edit regeneration');
        await waitFor(() => document.querySelector('#spatialForceEditor').dataset.fieldCount === '1', 'edited field rerender');
        const editedSignature = document.querySelector('#app').dataset.spatialForceSignature;
        document.querySelector('.spatial-force-actions button:nth-of-type(2)').click();
        await waitFor(() => document.querySelector('input[aria-label="field-01 strength"]')?.value === '0.2', 'undo field value');
        await waitFor(() => document.querySelector('#app').dataset.spatialForceSignature === firstSignature, 'undo geometry');
        const undoRestored = document.querySelector('input[aria-label="field-01 strength"]').value;
        const restoredStrength = document.querySelector('input[aria-label="field-01 strength"]');
        restoredStrength.value = '0.4';
        restoredStrength.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => document.querySelector('#app').dataset.spatialForceSignature === editedSignature, 'redo edit after undo');
        await waitFor(() => document.querySelector('#spatialForceEditor').dataset.fieldCount === '1', 'redo rerender');
        document.querySelector('.spatial-force-actions button').click();
        await waitFor(() => document.querySelector('#spatialForceEditor').dataset.fieldCount === '2', 'second field');
        const secondId = document.querySelector('.spatial-force-list li:nth-child(2)').dataset.fieldId;
        document.querySelector('.spatial-force-list li:nth-child(2) button[aria-label$="earlier"]').click();
        await waitFor(() => document.querySelector('.spatial-force-list li:first-child')?.dataset.fieldId === secondId, 'authored reorder');

        const originalCreateObjectUrl = URL.createObjectURL;
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        window.__forceExportBlob = null;
        URL.createObjectURL = (blob) => { window.__forceExportBlob = blob; return originalCreateObjectUrl(blob); };
        HTMLAnchorElement.prototype.click = function () { if (!this.download) return originalAnchorClick.call(this); };
        document.querySelector('#exportJson').click();
        await waitFor(() => window.__forceExportBlob, 'JSON export');
        const exported = JSON.parse(await window.__forceExportBlob.text());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
        const urlState = JSON.parse(new URL(location.href).searchParams.get('ff'));

        const primary = document.querySelector('#primary');
        primary.value = 'blueSpruce';
        primary.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => document.querySelector('#app').dataset.spatialForceStatus === 'unsupported-backend', 'unsupported backend diagnostic');
        await waitFor(() => document.querySelector('#spatialForceEditor').dataset.supported === 'false', 'unsupported editor context');
        const unsupportedDiagnostic = document.querySelector('.spatial-force-diagnostics').textContent;
        const unsupportedStillRendered = Number(document.querySelector('#app').dataset.heroTemplateVertices) > 0;
        const fieldsPreserved = document.querySelector('#spatialForceEditor').dataset.fieldCount;

        document.querySelector('.spatial-force-actions button:nth-of-type(3)').click();
        await waitFor(() => document.querySelector('#app').dataset.spatialForceStatus === 'canonical', 'exact reset');
        await waitFor(() => document.querySelector('#spatialForceEditor').dataset.fieldCount === '0', 'reset editor');
        return {
          initialLazy,
          affectedNodes,
          visualCount,
          signatureChanged: firstSignature !== editedSignature,
          undoRestored,
          authoredOrder: exported.authoring.spatialForces.state.fields.map((field) => field.id),
          exportedStatus: exported.authoring.spatialForces.status,
          exportedAuditAffected: exported.authoring.spatialForces.audit.affectedNodes,
          urlOrder: urlState.fields.map((field) => field.id),
          unsupportedDiagnostic,
          unsupportedStillRendered,
          fieldsPreserved,
          resetUrlRemoved: !new URL(location.href).searchParams.has('ff'),
          resetCanonical: document.querySelector('#app').dataset.spatialForceStatus,
          ariaExpanded: button.getAttribute('aria-expanded'),
          ariaControlsExists: Boolean(controlsId && document.getElementById(controlsId)),
          statusLive: document.querySelector('.spatial-force-status').getAttribute('aria-live'),
          labelledStrength,
          removedControls: !document.querySelector('input[aria-label="field-01 strength"]'),
          minButtonHeight: Number.parseFloat(getComputedStyle(document.querySelector('.spatial-force-actions button')).minHeight),
        };
      })()
    `,
  });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
  const result = response.result?.result?.value;
  assert.ok(result, JSON.stringify(response));
  assert.equal(result.initialLazy, false, "force editor must remain outside initial static loading");
  assert.ok(result.affectedNodes > 0, "field edit must deform generated graph nodes");
  assert.equal(result.visualCount, 1);
  assert.equal(result.signatureChanged, true);
  assert.equal(result.undoRestored, "0.2");
  assert.deepEqual(result.authoredOrder, ["field-02", "field-01"]);
  assert.deepEqual(result.urlOrder, result.authoredOrder);
  assert.equal(result.exportedStatus, "applied");
  assert.ok(result.exportedAuditAffected > 0);
  assert.match(result.unsupportedDiagnostic, /Not applied: Weber-Penn geometry/);
  assert.equal(result.unsupportedStillRendered, true, "unsupported fields must preserve canonical rendered geometry");
  assert.equal(result.fieldsPreserved, "2");
  assert.equal(result.resetUrlRemoved, true);
  assert.equal(result.resetCanonical, "canonical");
  assert.equal(result.ariaExpanded, "true");
  assert.equal(result.ariaControlsExists, true);
  assert.equal(result.statusLive, "polite");
  assert.equal(result.labelledStrength, true);
  assert.equal(result.removedControls, true, "removed/reset controls must no longer remain in the DOM");
  assert.ok(result.minButtonHeight >= 24);
  console.log(JSON.stringify(result, null, 2));
  console.log("procplant spatial force editor browser edit/export/unsupported/reset smoke passed");
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
