import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_CROWN_VOXEL_MASK_UI_PORT ?? 4194);
const debugPort = Number(process.env.PROCPLANTS_CROWN_VOXEL_MASK_UI_DEBUG_PORT ?? 9244);
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
if (!chrome) throw new Error("Chrome or Edge is required for the crown voxel-mask UI browser smoke test");

const waitFor = async (url, json = false, timeoutMs = 20_000) => {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return json ? response.json() : undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError ?? "not ready")}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-crown-voxel-mask-ui-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitFor(`http://127.0.0.1:${appPort}/`);
  browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${appPort}/`,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitFor(`http://127.0.0.1:${debugPort}/json`, true);
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
  let stable = 0;
  for (let attempt = 0; attempt < 120 && stable < 3; attempt++) {
    const probe = await command("Runtime.evaluate", {
      expression: "({ ready: document.readyState, app: Boolean(document.querySelector('#app')) })",
      returnByValue: true,
    });
    const value = probe.result?.result?.value;
    stable = value?.ready === "complete" && value?.app ? stable + 1 : 0;
    if (stable < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  assert.equal(stable, 3, "browser document must stabilize");

  const response = await command("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const waitFor = async (test, label, attempts = 300) => {
          for (let index = 0; index < attempts; index++) {
            const value = test();
            if (value) return value;
            await wait(100);
          }
          throw new Error('timed out waiting for ' + label);
        };
        const fileFor = (bytes, name = 'crown.voxmask') => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], name, { type: 'application/octet-stream' }));
          return transfer.files;
        };
        await waitFor(() => document.querySelector('#primary') && !document.querySelector('#regenerate').disabled, 'lab controls');
        const app = document.querySelector('#app');
        const initialLazy = app.dataset.crownVoxelMaskFitUiLoaded === 'true'
          || performance.getEntriesByType('resource').some((entry) => /procplant-crown-voxel-mask-fit-ui-/.test(entry.name));
        const primary = document.querySelector('#primary');
        primary.value = 'colonizedHazelShrub';
        primary.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => !document.querySelector('#regenerate').disabled && app.dataset.heroLodPending === 'false', 'colonized plant');
        const baselineTriangles = Number(app.dataset.heroTemplateTriangles);
        const button = document.querySelector('#fitCrownVoxelMask');
        const baselineUrl = location.href;
        button.click();
        await waitFor(() => document.querySelector('#crownVoxelMaskFitEditor input[type=file]'), 'lazy voxel-mask UI');
        const openedTriangles = Number(app.dataset.heroTemplateTriangles);
        const canonicalOpenUnchanged = baselineTriangles === openedTriangles && baselineUrl === location.href;
        document.querySelector('.crown-voxel-mask-fit-actions button:last-child').click();
        const closedWithoutApply = document.querySelector('#crownVoxelMaskFitEditor').hidden && button.getAttribute('aria-expanded') === 'false';

        button.click();
        const input = await waitFor(() => document.querySelector('#crownVoxelMaskFitEditor input[type=file]'), 'reopened voxel-mask UI');
        const width = 16, height = 24, depth = 16;
        const bytes = new Uint8Array(width * height * depth);
        for (let y = 2; y < height - 2; y++) {
          for (let z = 0; z < depth; z++) {
            for (let x = 0; x < width; x++) {
              const nx = (x + 0.5 - width / 2) / (width * 0.37);
              const ny = (y + 0.5 - height / 2) / (height * 0.43);
              const nz = (z + 0.5 - depth / 2) / (depth * 0.37);
              if (nx * nx + ny * ny + nz * nz <= 1) bytes[x + width * (z + depth * y)] = 255;
            }
          }
        }
        input.files = fileFor(bytes);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => document.querySelector('#crownVoxelMaskFitEditor').dataset.ready === 'true', 'valid voxel fit');
        const labels = [...document.querySelectorAll('.crown-voxel-mask-fit-grid label')];
        const centerX = labels.find((label) => label.textContent.startsWith('Center X')).querySelector('input');
        const voxelX = labels.find((label) => label.textContent.startsWith('Voxel size X')).querySelector('input');
        const bands = labels.find((label) => label.textContent.startsWith('Vertical fit bands')).querySelector('input');
        centerX.value = '1.25';
        centerX.dispatchEvent(new Event('input', { bubbles: true }));
        voxelX.value = '0.15';
        voxelX.dispatchEvent(new Event('input', { bubbles: true }));
        bands.value = '6';
        bands.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.crown-voxel-mask-fit-actions button:first-child').click();
        await waitFor(() => document.querySelector('#crownVoxelMaskFitEditor').dataset.lobeCount === '6', 'six-band voxel preview');
        document.querySelector('[data-view=front]').click();
        document.querySelector('[data-view=side]').click();
        document.querySelector('[data-view=top]').click();
        document.querySelector('[data-view=reset]').click();
        const editor = document.querySelector('#crownVoxelMaskFitEditor');
        const previewStatus = document.querySelector('.crown-voxel-mask-fit-status').textContent;
        const auditText = document.querySelector('.crown-voxel-mask-audit').textContent;
        const validMetrics = {
          sourceBytes: Number(editor.dataset.sourceBytes),
          fitHash: editor.dataset.fitHash,
          foregroundVoxels: Number(editor.dataset.foregroundVoxels),
          previewPoints: Number(editor.dataset.previewPoints),
          ordering: editor.dataset.ordering,
          workUnits: Number(editor.dataset.workUnits),
        };
        const canvas = document.querySelector('.crown-voxel-mask-viewport canvas');
        const webgl = Boolean(canvas.getContext('webgl2'));
        canvas.focus();
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        document.querySelector('.crown-voxel-mask-fit-actions button:nth-child(2)').click();
        await waitFor(() => app.dataset.crownVoxelMaskFitStatus === 'applied' && app.dataset.heroLodPending === 'false' && !document.querySelector('#regenerate').disabled, 'applied voxel crown');

        const urlCrown = JSON.parse(new URL(location.href).searchParams.get('cf'));
        const originalCreateObjectUrl = URL.createObjectURL;
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        window.__crownVoxelMaskExportBlob = null;
        URL.createObjectURL = (value) => { window.__crownVoxelMaskExportBlob = value; return originalCreateObjectUrl(value); };
        HTMLAnchorElement.prototype.click = function () { if (!this.download) return originalAnchorClick.call(this); };
        document.querySelector('#exportJson').click();
        await waitFor(() => window.__crownVoxelMaskExportBlob, 'JSON export');
        const exported = JSON.parse(await window.__crownVoxelMaskExportBlob.text());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
        const exportedCrown = exported.authoring.freeformCrown;
        const exactPersistence = JSON.stringify(exportedCrown) === JSON.stringify(urlCrown);
        const appliedUrl = location.href;

        const disconnected = new Uint8Array(width * height * depth);
        disconnected[1 + width * (1 + depth * 1)] = 255;
        disconnected[(width - 2) + width * ((depth - 2) + depth * (height - 2))] = 255;
        input.files = fileFor(disconnected, 'disconnected.bin');
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => /disconnected/.test(document.querySelector('.crown-voxel-mask-fit-status').textContent), 'fail-closed disconnected audit');
        const failClosed = document.querySelector('.crown-voxel-mask-fit-actions button:nth-child(2)').disabled
          && editor.dataset.ready === 'false'
          && location.href === appliedUrl;

        const result = {
          initialLazy,
          loadedAfterOpen: app.dataset.crownVoxelMaskFitUiLoaded,
          canonicalOpenUnchanged,
          closedWithoutApply,
          sourceBytes: validMetrics.sourceBytes,
          lobeCount: 6,
          fitHash: validMetrics.fitHash,
          foregroundVoxels: validMetrics.foregroundVoxels,
          previewPoints: validMetrics.previewPoints,
          ordering: validMetrics.ordering,
          workUnits: validMetrics.workUnits,
          orderingBeforeFailure: auditText.includes('x-fastest'),
          auditHasWork: auditText.includes('4,000,000'),
          previewStatus,
          webgl,
          urlVolumes: urlCrown.volumes.length,
          urlCenterX: urlCrown.volumes[0].center[0],
          exportedVolumes: exportedCrown.volumes.length,
          exportedContract: exportedCrown.contract,
          exactPersistence,
          sourceNotEmbedded: !Object.hasOwn(exported.authoring, 'crownVoxelMask'),
          failClosed,
          ariaExpanded: button.getAttribute('aria-expanded'),
          ariaControlsExists: Boolean(document.getElementById(button.getAttribute('aria-controls'))),
          statusLive: document.querySelector('.crown-voxel-mask-fit-status').getAttribute('aria-live'),
          canvasRole: canvas.getAttribute('role'),
          canvasFocusable: canvas.tabIndex,
          canvasKeyshortcuts: canvas.getAttribute('aria-keyshortcuts'),
          fileDescription: input.getAttribute('aria-describedby'),
          viewButtonCount: document.querySelectorAll('.crown-voxel-mask-view-actions button').length,
        };
        document.querySelector('.crown-voxel-mask-fit-actions button:last-child').click();
        result.closedAfterApply = document.querySelector('#crownVoxelMaskFitEditor').hidden && button.getAttribute('aria-expanded') === 'false';
        return result;
      })()
    `,
  });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
  const result = response.result?.result?.value;
  assert.equal(result.initialLazy, false, "voxel-mask viewport must remain outside the initial static load");
  assert.equal(result.loadedAfterOpen, "true");
  assert.equal(result.canonicalOpenUnchanged, true, "opening without applying must preserve canonical output and URL state");
  assert.equal(result.closedWithoutApply, true);
  assert.equal(result.sourceBytes, 6_144);
  assert.equal(result.foregroundVoxels, 1_536);
  assert.equal(result.previewPoints, 1_536);
  assert.equal(result.ordering, "x-fastest-then-z-then-y");
  assert.ok(result.fitHash?.length === 8);
  assert.ok(result.workUnits > result.foregroundVoxels);
  assert.equal(result.orderingBeforeFailure, true);
  assert.equal(result.auditHasWork, true);
  assert.match(result.previewStatus, /bounded ellipsoid lobes/);
  assert.equal(result.webgl, true, "real browser viewport must acquire WebGL2");
  assert.equal(result.urlVolumes, 6);
  assert.equal(result.exportedVolumes, 6);
  assert.equal(result.exportedContract, "procplants.freeform-crown");
  assert.equal(result.exactPersistence, true, "URL and exported JSON must contain the exact same derived crown");
  assert.equal(result.sourceNotEmbedded, true, "raw source occupancy must not be added to JSON authoring state");
  assert.equal(result.failClosed, true, "invalid disconnected input must not remain applicable or alter saved state");
  assert.equal(result.ariaExpanded, "true");
  assert.equal(result.ariaControlsExists, true);
  assert.equal(result.statusLive, "polite");
  assert.equal(result.canvasRole, "img");
  assert.equal(result.canvasFocusable, 0);
  assert.match(result.canvasKeyshortcuts, /ArrowLeft/);
  assert.equal(result.fileDescription, "crownVoxelMaskFitDescription");
  assert.equal(result.viewButtonCount, 4);
  assert.equal(result.closedAfterApply, true);
  console.log(JSON.stringify(result, null, 2));
  console.log("procplant crown voxel-mask lazy viewport/apply/URL/JSON/fail-closed browser smoke passed");
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
