import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_CROWN_MASK_UI_PORT ?? 4191);
const debugPort = Number(process.env.PROCPLANTS_CROWN_MASK_UI_DEBUG_PORT ?? 9241);
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
if (!chrome) throw new Error("Chrome or Edge is required for the crown-mask UI browser smoke test");

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

const profile = await mkdtemp(join(tmpdir(), "procplants-crown-mask-ui-"));
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
        const waitFor = async (test, label, attempts = 180) => {
          for (let index = 0; index < attempts; index++) {
            const value = test();
            if (value) return value;
            await wait(100);
          }
          throw new Error('timed out waiting for ' + label);
        };
        await waitFor(() => document.querySelector('#primary') && !document.querySelector('#regenerate').disabled, 'lab controls');
        const app = document.querySelector('#app');
        const initialLazy = app.dataset.crownMaskFitUiLoaded === 'true' || performance.getEntriesByType('resource').some((entry) => /procplant-crown-mask-fit-ui-/.test(entry.name));
        const primary = document.querySelector('#primary');
        primary.value = 'colonizedHazelShrub';
        primary.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => !document.querySelector('#regenerate').disabled && app.dataset.heroLodPending === 'false', 'colonized plant');
        const baselineTriangles = Number(app.dataset.heroTemplateTriangles);
        const button = document.querySelector('#fitCrownMask');
        button.click();
        await waitFor(() => document.querySelector('#crownMaskFitEditor input[type=file]'), 'lazy mask UI');
        const openedTriangles = Number(app.dataset.heroTemplateTriangles);
        const canonicalUrlUnchanged = !new URL(location.href).searchParams.has('cf');
        document.querySelector('.crown-mask-fit-actions button:last-child').click();
        const closedWithoutApply = document.querySelector('#crownMaskFitEditor').hidden && button.getAttribute('aria-expanded') === 'false';

        button.click();
        const input = await waitFor(() => document.querySelector('#crownMaskFitEditor input[type=file]'), 'reopened mask UI');
        const source = document.createElement('canvas');
        source.width = source.height = 48;
        const sourceContext = source.getContext('2d');
        sourceContext.clearRect(0, 0, 48, 48);
        sourceContext.fillStyle = '#fff';
        sourceContext.beginPath();
        sourceContext.ellipse(24, 25, 15, 20, 0, 0, Math.PI * 2);
        sourceContext.fill();
        const blob = await new Promise((resolveBlob) => source.toBlob(resolveBlob, 'image/png'));
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'filled-crown.png', { type: 'image/png' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => document.querySelector('#crownMaskFitEditor').dataset.ready === 'true' && !document.querySelector('.crown-mask-fit-actions button:nth-child(2)').disabled, 'valid mask preview');
        const labels = [...document.querySelectorAll('.crown-mask-fit-grid label')];
        const bands = labels.find((label) => label.textContent.startsWith('Ellipsoid bands')).querySelector('input');
        bands.value = '6';
        bands.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.crown-mask-fit-actions button:first-child').click();
        await waitFor(() => document.querySelector('#crownMaskFitEditor').dataset.bandCount === '6', 'six-band preview');
        const previewStatus = document.querySelector('.crown-mask-fit-status').textContent;
        document.querySelector('.crown-mask-fit-actions button:nth-child(2)').click();
        await waitFor(() => app.dataset.crownMaskFitStatus === 'applied' && app.dataset.heroLodPending === 'false' && !document.querySelector('#regenerate').disabled, 'applied rebuilt crown', 300);

        const originalCreateObjectUrl = URL.createObjectURL;
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        window.__crownMaskExportBlob = null;
        URL.createObjectURL = (value) => { window.__crownMaskExportBlob = value; return originalCreateObjectUrl(value); };
        HTMLAnchorElement.prototype.click = function () { if (!this.download) return originalAnchorClick.call(this); };
        document.querySelector('#exportJson').click();
        await waitFor(() => window.__crownMaskExportBlob, 'JSON export');
        const exported = JSON.parse(await window.__crownMaskExportBlob.text());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;

        const result = {
          initialLazy,
          loadedAfterOpen: app.dataset.crownMaskFitUiLoaded,
          canonicalOpenUnchanged: baselineTriangles === openedTriangles && canonicalUrlUnchanged,
          closedWithoutApply,
          bandCount: Number(document.querySelector('#crownMaskFitEditor').dataset.bandCount),
          foregroundPixels: Number(document.querySelector('#crownMaskFitEditor').dataset.foregroundPixels),
          depthPolicy: document.querySelector('#crownMaskFitEditor').dataset.depthPolicy,
          urlHasCrown: new URL(location.href).searchParams.has('cf'),
          exportedVolumes: exported.authoring.freeformCrown.volumes.length,
          exportedContract: exported.authoring.freeformCrown.contract,
          previewStatus,
          ariaExpanded: button.getAttribute('aria-expanded'),
          ariaControlsExists: Boolean(document.getElementById(button.getAttribute('aria-controls'))),
          statusLive: document.querySelector('.crown-mask-fit-status').getAttribute('aria-live'),
          canvasRole: document.querySelector('.crown-mask-fit-editor canvas').getAttribute('role'),
          fileDescription: document.querySelector('.crown-mask-file input').getAttribute('aria-describedby'),
        };
        document.querySelector('.crown-mask-fit-actions button:last-child').click();
        result.closedAfterApply = document.querySelector('#crownMaskFitEditor').hidden && button.getAttribute('aria-expanded') === 'false';
        return result;
      })()
    `,
  });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
  const result = response.result?.result?.value;
  assert.equal(result.initialLazy, false, "crown-mask fitter must remain outside the initial static load");
  assert.equal(result.loadedAfterOpen, "true");
  assert.equal(result.canonicalOpenUnchanged, true, "opening the UI without applying must preserve canonical output and URL state");
  assert.equal(result.closedWithoutApply, true);
  assert.equal(result.bandCount, 6);
  assert.ok(result.foregroundPixels > 800);
  assert.equal(result.depthPolicy, "explicit-bounds-scaled-by-band-width");
  assert.equal(result.urlHasCrown, true);
  assert.equal(result.exportedVolumes, 6);
  assert.equal(result.exportedContract, "procplants.freeform-crown");
  assert.match(result.previewStatus, /bounded ellipsoids/);
  assert.equal(result.ariaExpanded, "true");
  assert.equal(result.ariaControlsExists, true);
  assert.equal(result.statusLive, "polite");
  assert.equal(result.canvasRole, "img");
  assert.equal(result.fileDescription, "crownMaskFitDescription");
  assert.equal(result.closedAfterApply, true);
  console.log(JSON.stringify(result, null, 2));
  console.log("procplant crown-mask lazy file/apply/URL/JSON browser smoke passed");
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
