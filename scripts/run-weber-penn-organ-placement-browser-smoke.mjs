import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_WEBER_PLACEMENT_PORT ?? 4204);
const debugPort = Number(process.env.PROCPLANTS_WEBER_PLACEMENT_DEBUG_PORT ?? 9254);
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
if (!chrome) throw new Error("Chrome or Edge is required for the Weber-Penn placement browser smoke test");

const waitFor = async (probe, label, timeoutMs = 30_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      // Browser/server startup is eventually consistent.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-weber-placement-browser-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${appPort}/`)).ok, "Vite preview");
  browser = spawn(chrome, [
    "--headless=new", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
    "--no-first-run", "--disable-extensions", "--disable-breakpad", "--disable-crash-reporter",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${appPort}/`,
  ], { stdio: "ignore", windowsHide: true });
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    if (!response.ok) return null;
    return (await response.json()).find((entry) => entry.type === "page" && entry.url.includes(String(appPort)));
  }, "browser target");
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
    if (stableDocuments < 3) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.equal(stableDocuments, 3, "browser document must stabilize before Weber placement evaluation");
  const response = await command("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const app = document.querySelector('#app');
        const idle = async () => {
          for (let index = 0; index < 240 && document.querySelector('#regenerate')?.disabled; index++) await wait(100);
          for (let index = 0; index < 240 && app?.dataset.heroLodPending !== 'false'; index++) await wait(100);
          await wait(300);
        };
        for (let index = 0; index < 240 && !document.querySelector('canvas'); index++) await wait(100);
        const primary = document.querySelector('#primary');
        const secondary = document.querySelector('#secondary');
        primary.value = 'oakCanopy';
        secondary.value = 'oakCanopy';
        primary.dispatchEvent(new Event('change', { bubbles: true }));
        secondary.dispatchEvent(new Event('change', { bubbles: true }));
        await idle();
        const mode = document.querySelector('#placementMode');
        mode.click();
        for (let index = 0; index < 240 && app.dataset.organPlacementToolReady !== 'true'; index++) await wait(100);
        const initialTriangles = Number(app.dataset.heroTemplateTriangles);
        const initialVertices = Number(app.dataset.heroTemplateVertices);
        const sourceSignature = app.dataset.heroPruneTargetSignature || app.dataset.weberPennOrganPlacementSignature || null;
        const disabledKinds = [...document.querySelectorAll('#placementKind option:disabled')].map((option) => option.value);
        const kind = document.querySelector('#placementKind');
        kind.value = 'fruit';
        kind.dispatchEvent(new Event('change', { bubbles: true }));
        const canvas = document.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        const candidates = [
          [0.58, 0.48], [0.62, 0.42], [0.55, 0.38], [0.66, 0.52],
          [0.44, 0.44], [0.38, 0.5], [0.52, 0.58], [0.7, 0.36],
        ];
        const fractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
        let placed = false;
        for (const [fx, fy] of candidates) {
          const clientX = rect.left + rect.width * fx;
          const clientY = rect.top + rect.height * fy;
          canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY }));
          canvas.dispatchEvent(new PointerEvent('click', { bubbles: true, button: 0, clientX, clientY }));
          for (let index = 0; index < 6 && Number(app.dataset.organPlacementCount ?? 0) < 1; index++) await wait(50);
          if (Number(app.dataset.organPlacementCount ?? 0) === 1) {
            placed = true;
            break;
          }
        }
        for (const fy of fractions) {
          if (placed) break;
          for (const fx of fractions) {
            const clientX = rect.left + rect.width * fx;
            const clientY = rect.top + rect.height * fy;
            canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY }));
            canvas.dispatchEvent(new PointerEvent('click', { bubbles: true, button: 0, clientX, clientY }));
            for (let index = 0; index < 3 && Number(app.dataset.organPlacementCount ?? 0) < 1; index++) await wait(50);
            if (Number(app.dataset.organPlacementCount ?? 0) === 1) {
              placed = true;
              break;
            }
          }
          if (placed) break;
        }
        for (let index = 0; index < 300 && (
          app.dataset.weberPennOrganPlacementStatus !== 'applied' ||
          Number(app.dataset.heroTemplateTriangles) === initialTriangles
        ); index++) await wait(100);
        await idle();
        const placedTriangles = Number(app.dataset.heroTemplateTriangles);
        const placedVertices = Number(app.dataset.heroTemplateVertices);
        const attachmentId = app.dataset.weberPennOrganPlacementAttachment ?? null;
        const ownerStemId = app.dataset.weberPennOrganPlacementOwner ?? null;
        const placementStatus = app.dataset.weberPennOrganPlacementStatus ?? null;
        const applied = Number(app.dataset.organPlacementApplied ?? -1);
        const unsupported = Number(app.dataset.organPlacementUnsupported ?? -1);
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const webglVersion = gl?.getParameter(gl.VERSION) ?? null;
        const webglError = gl?.getError() ?? null;

        document.querySelector('#inspectReadiness').click();
        for (let index = 0; index < 180 && Number(app.dataset.readinessTriangles ?? 0) !== placedTriangles; index++) await wait(100);
        const readinessTriangles = Number(app.dataset.readinessTriangles);
        const readinessVertices = Number(app.dataset.readinessVertices);

        let jsonBlob = null;
        let glbBlob = null;
        const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (blob) => {
          if (blob.type === 'application/json') jsonBlob = blob;
          if (blob.type === 'model/gltf-binary') glbBlob = blob;
          return originalCreateObjectUrl(blob);
        };
        HTMLAnchorElement.prototype.click = function () {};
        document.querySelector('#exportJson').click();
        for (let index = 0; index < 180 && !jsonBlob; index++) await wait(100);
        const exported = JSON.parse(await jsonBlob.text());
        document.querySelector('#exportGlb').click();
        for (let index = 0; index < 240 && !glbBlob; index++) await wait(100);
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
        const bytes = new Uint8Array(await glbBlob.arrayBuffer());
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const jsonLength = view.getUint32(12, true);
        const glbJson = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim());
        const metadata = glbJson.scenes?.[0]?.extras?.procplant?.metadata ?? {};

        document.querySelector('#undoPlacement').click();
        for (let index = 0; index < 300 && (
          Number(app.dataset.organPlacementCount ?? -1) !== 0 ||
          Number(app.dataset.heroTemplateTriangles) !== initialTriangles ||
          app.dataset.weberPennOrganPlacementStatus
        ); index++) await wait(100);
        await idle();
        return {
          placed,
          initialTriangles,
          initialVertices,
          placedTriangles,
          placedVertices,
          attachmentId,
          ownerStemId,
          placementStatus,
          applied,
          unsupported,
          disabledKinds,
          webglVersion,
          webglError,
          readinessTriangles,
          readinessVertices,
          exportedContract: exported.authoring.organPlacements?.contract,
          exportedKind: exported.authoring.organPlacements?.operations?.[0]?.kind,
          exportedAttachmentId: exported.authoring.organPlacements?.operations?.[0]?.attachmentId,
          glbContract: metadata.weberPennOrganPlacementContract,
          glbStatus: metadata.weberPennOrganPlacementStatus,
          glbSignature: metadata.weberPennOrganPlacementSignature,
          glbApplied: metadata.weberPennOrganPlacementApplied,
          glbTriangles: metadata.authoredTriangles,
          glbVertices: metadata.authoredVertices,
          resetCount: Number(app.dataset.organPlacementCount ?? -1),
          resetTriangles: Number(app.dataset.heroTemplateTriangles),
          resetVertices: Number(app.dataset.heroTemplateVertices),
          resetStatus: app.dataset.weberPennOrganPlacementStatus ?? null,
          sourceSignature,
          saveStatus: document.querySelector('#saveStatus')?.textContent ?? null,
        };
      })()
    `,
  });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  const result = response.result?.result?.value;
  if (!result) console.error(JSON.stringify(response));
  assert.ok(result);
  console.log(JSON.stringify(result));
  assert.equal(result.placed, true);
  assert.ok(result.placedTriangles > result.initialTriangles);
  assert.ok(result.placedVertices > result.initialVertices);
  assert.match(result.attachmentId, /^weber-penn:leaf-site:\d+$/);
  assert.match(result.ownerStemId, /^weber-penn:stem:\d+$/);
  assert.equal(result.placementStatus, "applied");
  assert.equal(result.applied, 1);
  assert.equal(result.unsupported, 0);
  assert.ok(result.disabledKinds.includes("branch") && result.disabledKinds.includes("decal"));
  assert.match(result.webglVersion, /^WebGL/);
  assert.equal(result.webglError, 0);
  assert.equal(result.readinessTriangles, result.placedTriangles);
  assert.equal(result.readinessVertices, result.placedVertices);
  assert.equal(result.exportedContract, "procplants.weber-penn-organ-placement-overrides");
  assert.equal(result.exportedKind, "fruit");
  assert.equal(result.exportedAttachmentId, result.attachmentId);
  assert.equal(result.glbContract, "procplants.weber-penn-organ-placement-overrides");
  assert.equal(result.glbStatus, "applied");
  assert.match(result.glbSignature, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(result.glbApplied, 1);
  assert.equal(result.glbTriangles, result.placedTriangles);
  assert.equal(result.glbVertices, result.placedVertices);
  assert.equal(result.resetCount, 0);
  assert.equal(result.resetTriangles, result.initialTriangles);
  assert.equal(result.resetVertices, result.initialVertices);
  assert.equal(result.resetStatus, null);
  socket.close();
} finally {
  if (browser && !browser.killed) browser.kill();
  if (!preview.killed) preview.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
