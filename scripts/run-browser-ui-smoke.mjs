import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_SMOKE_PORT ?? 4177);
const debugPort = Number(process.env.PROCPLANTS_SMOKE_DEBUG_PORT ?? 9227);
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
if (!chrome) throw new Error("Chrome or Edge is required for the browser UI smoke test");

const waitForJson = async (url, timeoutMs = 20_000) => {
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

const waitForOk = async (url, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview process may not have bound its socket yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-browser-smoke-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitForOk(`http://127.0.0.1:${appPort}/`);
  browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${appPort}/`,
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
  // Chrome can publish the page target while its launch navigation is still
  // replacing the initial execution context. Require a few consecutive
  // complete-document probes before starting the long stateful evaluation so
  // a CDP attach race cannot be mistaken for an application failure.
  await command("Page.enable");
  await command("Runtime.enable");
  let stableDocuments = 0;
  for (let attempt = 0; attempt < 100 && stableDocuments < 3; attempt++) {
    const probe = await command("Runtime.evaluate", {
      expression: "({ ready: document.readyState, href: location.href })",
      returnByValue: true,
    });
    const value = probe.result?.result?.value;
    stableDocuments = !probe.error
      && value?.ready === "complete"
      && String(value?.href ?? "").includes(String(appPort))
      ? stableDocuments + 1
      : 0;
    if (stableDocuments < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  assert.equal(stableDocuments, 3, "browser document must stabilize before UI smoke evaluation");
  const expression = `
    (async () => {
      const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
      for (let i = 0; i < 100 && (!document.querySelector('#inspectGraph') || document.querySelector('#inspectGraph').disabled); i++) await wait(100);
      const initialLazyAuthoringResources = performance.getEntriesByType('resource')
        .map((entry) => entry.name.split('/').at(-1) ?? entry.name)
        .filter((name) => /procplant-(?:graph-editor-ui|lab-authoring-imports|three-geometry|three-material-adapter|rules|contour-editor-ui|crown-volume-tool)-/.test(name));
      document.querySelector('#inspectGraph').click();
      for (let i = 0; i < 100 && !document.querySelector('.graph-node-editor'); i++) await wait(100);
      const row = [...document.querySelectorAll('.graph-node-list > li')]
        .find((entry) => entry.querySelector('.graph-node small')?.textContent?.startsWith('architecture'));
      row.querySelector('.graph-node').click();
      const input = row.querySelector('.graph-node-editor input[type=number]');
      const before = Number(input.value);
      input.value = String(before + 1);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(1800);
      const current = [...document.querySelectorAll('.graph-node-list > li')]
        .find((entry) => entry.querySelector('.graph-node small')?.textContent?.startsWith('architecture'));
      current.querySelector('.graph-node').click();
      const waitForIdle = async () => {
        for (let i = 0; i < 120 && document.querySelector('#regenerate')?.disabled; i++) await wait(100);
        for (let i = 0; i < 120 && document.querySelector('#app')?.dataset.heroLodPending !== 'false'; i++) await wait(100);
        await wait(250);
      };
      const primary = document.querySelector('#primary');
      primary.value = 'phiFern';
      primary.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForIdle();
      for (let i = 0; i < 120 && document.querySelector('#app')?.dataset.heroLodPending !== 'false'; i++) await wait(100);
      for (let i = 0; i < 120 && !document.querySelector('#app')?.dataset.biomeVisibilityClusters; i++) await wait(100);
      const visibilityClusters = Number(document.querySelector('#app')?.dataset.biomeVisibilityClusters ?? 0);
      const visibilityCandidates = Number(document.querySelector('#app')?.dataset.biomeVisibilityCandidateInstances ?? 0);
      const visibilityPlacements = Number(document.querySelector('#app')?.dataset.biomeLodPlacements ?? 0);
      const visibilityFrustumRejected = Number(document.querySelector('#app')?.dataset.biomeVisibilityFrustumRejected ?? -1);
      primary.value = 'cloverGroundcover';
      primary.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForIdle();
      for (let i = 0; i < 120 && document.querySelector('#app')?.dataset.heroLodPending !== 'false'; i++) await wait(100);
      document.querySelector('#bakeMaterial').click();
      for (let i = 0; i < 120 && !document.querySelector('#app')?.dataset.materialBakeHash; i++) await wait(100);
      for (let i = 0; i < 240 && document.querySelector('#app')?.dataset.materialLivePbr !== 'true'; i++) await wait(100);
      await waitForIdle();
      const materialBakeHash = document.querySelector('#app')?.dataset.materialBakeHash ?? '';
      const materialBakeReady = document.querySelector('#app')?.dataset.materialBakeReady ?? null;
      const materialBakeImages = Number(document.querySelector('#app')?.dataset.materialBakeImages ?? 0);
      const materialLivePbr = document.querySelector('#app')?.dataset.materialLivePbr ?? null;
      const materialLiveAudit = document.querySelector('#app')?.dataset.materialLiveAudit ?? '';
      const materialLiveGroups = Number(document.querySelector('#app')?.dataset.materialLiveGroups ?? 0);
      const materialLiveTangents = document.querySelector('#app')?.dataset.materialLiveTangents ?? null;
      const materialLiveNormalMaps = Number(document.querySelector('#app')?.dataset.materialLiveNormalMaps ?? 0);
      const materialLiveTextureBytes = Number(document.querySelector('#app')?.dataset.materialLiveTextureBytes ?? 0);
      document.querySelector('#exportGlb').click();
      for (let i = 0; i < 240 && !document.querySelector('#app')?.dataset.lastGlbMaterialHash; i++) await wait(100);
      const lastGlbMaterialHash = document.querySelector('#app')?.dataset.lastGlbMaterialHash ?? '';
      const lastGlbMaterialAssignments = Number(document.querySelector('#app')?.dataset.lastGlbMaterialAssignments ?? 0);
      const lastGlbSurfaceGroups = Number(document.querySelector('#app')?.dataset.lastGlbSurfaceGroups ?? 0);
      primary.value = 'winterberryShrub';
      primary.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForIdle();
      const makeHeroGlb = () => {
        const textureCanvas = document.createElement('canvas');
        textureCanvas.width = textureCanvas.height = 2;
        const textureContext = textureCanvas.getContext('2d');
        textureContext.fillStyle = '#765432';
        textureContext.fillRect(0, 0, 2, 2);
        const encodedImage = type => Uint8Array.from(atob(textureCanvas.toDataURL(type).split(',')[1]), value => value.charCodeAt(0));
        const images = [encodedImage('image/png'), encodedImage('image/jpeg'), encodedImage('image/webp')];
        const imageOffsets = [];
        let binaryLength = 68;
        for (const image of images) {
          binaryLength = Math.ceil(binaryLength / 4) * 4;
          imageOffsets.push(binaryLength);
          binaryLength += image.length;
        }
        const binary = new Uint8Array(Math.ceil(binaryLength / 4) * 4);
        new Float32Array(binary.buffer, 0, 9).set([-0.5, 0, 0, 0.5, 0, 0, 0, 2, 0.2]);
        new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
        new Float32Array(binary.buffer, 44, 6).set([0, 0, 1, 0, 0.5, 1]);
        images.forEach((image, index) => binary.set(image, imageOffsets[index]));
        const json = {
          asset: { version: '2.0', generator: 'procplants browser smoke' },
          extensionsUsed: ['KHR_texture_transform', 'EXT_texture_webp'],
          scene: 0,
          scenes: [{ nodes: [0] }],
          nodes: [{ name: 'hero-trunk', mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0, mode: 4 }] }],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 2, 0.2] },
            { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
            { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
          ],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
            { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
            { buffer: 0, byteOffset: 44, byteLength: 24, target: 34962 },
            ...images.map((image, index) => ({ buffer: 0, byteOffset: imageOffsets[index], byteLength: image.length })),
          ],
          buffers: [{ byteLength: binary.length }],
          images: [
            { name: 'smoke-bark-color', bufferView: 3, mimeType: 'image/png' },
            { name: 'smoke-bark-normal', bufferView: 4, mimeType: 'image/jpeg' },
            { name: 'smoke-bark-emissive', bufferView: 5, mimeType: 'image/webp' },
          ],
          samplers: [{ magFilter: 9728, minFilter: 9985, wrapS: 33071, wrapT: 33648 }],
          textures: [
            { source: 0, sampler: 0 },
            { source: 1, sampler: 0 },
            { source: 0, sampler: 0, extensions: { EXT_texture_webp: { source: 2 } } },
          ],
          materials: [{
            name: 'smoke-source-bark',
            pbrMetallicRoughness: {
              baseColorFactor: [0.42, 0.31, 0.2, 1], metallicFactor: 0.05, roughnessFactor: 0.78,
              baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { offset: [0.1, 0.2], scale: [2, 3] } } },
            },
            normalTexture: { index: 1, scale: 0.65 },
            emissiveFactor: [0.02, 0.01, 0.005],
            emissiveTexture: { index: 2 },
          }],
        };
        const encoded = new TextEncoder().encode(JSON.stringify(json));
        const jsonLength = Math.ceil(encoded.length / 4) * 4;
        const output = new ArrayBuffer(12 + 8 + jsonLength + 8 + binary.length);
        const view = new DataView(output);
        view.setUint32(0, 0x46546c67, true);
        view.setUint32(4, 2, true);
        view.setUint32(8, output.byteLength, true);
        view.setUint32(12, jsonLength, true);
        view.setUint32(16, 0x4e4f534a, true);
        const jsonBytes = new Uint8Array(output, 20, jsonLength);
        jsonBytes.fill(0x20);
        jsonBytes.set(encoded);
        const binHeader = 20 + jsonLength;
        view.setUint32(binHeader, binary.length, true);
        view.setUint32(binHeader + 4, 0x004e4942, true);
        new Uint8Array(output, binHeader + 8).set(binary);
        return output;
      };
      const heroInput = document.querySelector('#heroGlbFile');
      const transfer = new DataTransfer();
      transfer.items.add(new File([makeHeroGlb()], 'smoke-hero.glb', { type: 'model/gltf-binary' }));
      heroInput.files = transfer.files;
      heroInput.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 120 && document.querySelector('#app')?.dataset.heroImportActive !== 'true'; i++) await wait(100);
      const heroImportActive = document.querySelector('#app')?.dataset.heroImportActive ?? null;
      const heroImportVertices = Number(document.querySelector('#app')?.dataset.heroImportVertices ?? 0);
      const heroImportAttachments = Number(document.querySelector('#app')?.dataset.heroImportAttachments ?? 0);
      const heroImportAttachmentHash = document.querySelector('#app')?.dataset.heroImportAttachmentHash ?? '';
      const heroImportAttachmentInstances = Number(document.querySelector('#app')?.dataset.heroImportAttachmentInstances ?? 0);
      const heroImportAttachmentDraws = Number(document.querySelector('#app')?.dataset.heroImportAttachmentDraws ?? 0);
      const heroImportAttachmentVertices = Number(document.querySelector('#app')?.dataset.heroImportAttachmentVertices ?? 0);
      const heroImportAttachmentTriangles = Number(document.querySelector('#app')?.dataset.heroImportAttachmentTriangles ?? 0);
      const heroImportBranchInstances = Number(document.querySelector('#app')?.dataset.heroImportBranchInstances ?? 0);
      const heroImportAccessoryInstances = Number(document.querySelector('#app')?.dataset.heroImportAccessoryInstances ?? 0);
      const heroImportSourceMaterial = document.querySelector('#app')?.dataset.heroImportSourceMaterial ?? null;
      const heroImportSourceMaterialTextures = Number(document.querySelector('#app')?.dataset.heroImportSourceMaterialTextures ?? 0);
      const heroImportSourceMaterialImages = Number(document.querySelector('#app')?.dataset.heroImportSourceMaterialImages ?? 0);
      const heroImportStatus = document.querySelector('#heroImportStatus')?.textContent ?? '';
      const heroImportHashBeforeEdit = document.querySelector('#app')?.dataset.heroImportHash ?? '';
      document.querySelector('#exportGlb').click();
      for (let i = 0; i < 240 && !/instanced branch/.test(document.querySelector('#saveStatus')?.textContent ?? ''); i++) await wait(100);
      const heroImportExportStatus = document.querySelector('#saveStatus')?.textContent ?? '';
      const heroImportExportBytes = Number(document.querySelector('#app')?.dataset.heroImportLastExportBytes ?? 0);
      const heroImportExportMaterials = Number(document.querySelector('#app')?.dataset.heroImportLastExportMaterials ?? 0);
      const heroImportExportTextures = Number(document.querySelector('#app')?.dataset.heroImportLastExportTextures ?? 0);
      const heroImportExportImages = Number(document.querySelector('#app')?.dataset.heroImportLastExportImages ?? 0);
      document.querySelector('#editHeroSpine').click();
      for (let i = 0; i < 120 && document.querySelector('#editHeroSpine')?.getAttribute('aria-pressed') !== 'true'; i++) await wait(100);
      const heroSpineEditing = document.querySelector('#editHeroSpine')?.getAttribute('aria-pressed') ?? null;
      const heroSpineAddEnabled = !document.querySelector('#addHeroSpinePoint')?.disabled;
      document.querySelector('#addHeroSpinePoint').click();
      for (let i = 0; i < 120 && document.querySelector('#app')?.dataset.heroImportHash === heroImportHashBeforeEdit; i++) await wait(100);
      const heroImportHashAfterEdit = document.querySelector('#app')?.dataset.heroImportHash ?? '';
      const heroSpineEditStatus = document.querySelector('#heroImportStatus')?.textContent ?? '';
      document.querySelector('#editHeroSpine').click();
      const heroSpineFinished = document.querySelector('#editHeroSpine')?.getAttribute('aria-pressed') ?? null;
      document.querySelector('#clearHeroGlb').click();
      const heroImportCleared = document.querySelector('#app')?.dataset.heroImportActive ?? null;
      primary.value = 'colonizedHazelShrub';
      primary.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForIdle();
      const crownTrianglesBefore = Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
      const tubeResolution = document.querySelector('#tubeResolution');
      tubeResolution.value = '0.6';
      tubeResolution.dispatchEvent(new Event('input', { bubbles: true }));
      await waitForIdle();
      const crownTrianglesAfter = Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
      document.querySelector('#crownVolumeMode').click();
      for (let i = 0; i < 100 && document.querySelector('#crownVolumeAdd').disabled; i++) await wait(100);
      document.querySelector('#crownVolumeAdd').click();
      await waitForIdle();
      for (let i = 0; i < 100 && document.querySelector('#app')?.dataset.crownFieldVolumeCount !== '2'; i++) await wait(100);
      for (let i = 0; i < 100 && document.querySelector('#crownLobeControls')?.hidden; i++) await wait(100);
      document.querySelector('#crownLobeWidth').value = '1.75';
      document.querySelector('#crownLobeHeight').value = '2.25';
      document.querySelector('#crownLobeDepth').value = '0.85';
      document.querySelector('#crownLobeRotation').value = '37';
      document.querySelector('#crownLobeWeight').value = '2.4';
      document.querySelector('#crownLobeWeight').dispatchEvent(new Event('change', { bubbles: true }));
      await waitForIdle();
      const crownTrianglesSculpted = Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
      const serializedAddedCrown = new URL(location.href).searchParams.get('cf');
      const addedCrownField = serializedAddedCrown ? JSON.parse(serializedAddedCrown) : null;
      const transformedLobe = addedCrownField?.volumes?.find((volume) => volume.id === 'volume-1') ?? null;
      const crownFieldDatasetVolumes = document.querySelector('#app')?.dataset.crownFieldVolumeCount ?? null;
      for (let i = 0; i < 100 && document.querySelector('#crownVolumeRemove').disabled; i++) await wait(100);
      document.querySelector('#crownVolumeRemove').click();
      await waitForIdle();
      for (let i = 0; i < 100 && document.querySelector('#app')?.dataset.crownFieldVolumeCount !== '1'; i++) await wait(100);
      const serializedCrown = new URL(location.href).searchParams.get('cf');
      const crownField = serializedCrown ? JSON.parse(serializedCrown) : null;
      const crownTrianglesAfterRemove = Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
      for (let i = 0; i < 100 && document.querySelector('#crownVolumeSubtract').disabled; i++) await wait(100);
      document.querySelector('#crownVolumeSubtract').click();
      await waitForIdle();
      for (let i = 0; i < 100 && document.querySelector('#app')?.dataset.crownFieldVolumeCount !== '2'; i++) await wait(100);
      const carvedTriangles = Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
      const serializedCarvedCrown = new URL(location.href).searchParams.get('cf');
      const carvedCrown = serializedCarvedCrown ? JSON.parse(serializedCarvedCrown) : null;
      const subtractiveLobe = carvedCrown?.volumes?.find((volume) => volume.operation === 'subtract') ?? null;
      for (let i = 0; i < 100 && document.querySelector('#crownVolumeRemove').disabled; i++) await wait(100);
      document.querySelector('#crownVolumeRemove').click();
      await waitForIdle();
      for (let i = 0; i < 100 && document.querySelector('#app')?.dataset.crownFieldVolumeCount !== '0'; i++) await wait(100);
      const crownTrianglesRestored = Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
      return {
        rows: document.querySelectorAll('.graph-node-list > li').length,
        before,
        after: Number(current.querySelector('.graph-node-editor input[type=number]').value),
        summary: document.querySelector('.graph-summary')?.textContent ?? '',
        hash: document.querySelector('#graphPreview')?.dataset.hash ?? '',
        triangles: document.querySelector('#triangles')?.textContent ?? '',
        editContourButton: Boolean(document.querySelector('#editCutoutContour')),
        heroImportButton: Boolean(document.querySelector('#importHeroGlb')),
        heroImportFile: document.querySelector('#heroGlbFile')?.accept ?? '',
        initialLazyAuthoringResources,
        macroRulesLoaded: document.querySelector('#app')?.dataset.macroRulesLoaded ?? null,
        visibilityClusters,
        visibilityCandidates,
        visibilityPlacements,
        visibilityFrustumRejected,
        materialBakeHash,
        materialBakeReady,
        materialBakeImages,
        materialLivePbr,
        materialLiveAudit,
        materialLiveGroups,
        materialLiveTangents,
        materialLiveNormalMaps,
        materialLiveTextureBytes,
        lastGlbMaterialHash,
        lastGlbMaterialAssignments,
        lastGlbSurfaceGroups,
        heroImportActive,
        heroImportVertices,
        heroImportAttachments,
        heroImportAttachmentHash,
        heroImportAttachmentInstances,
        heroImportAttachmentDraws,
        heroImportAttachmentVertices,
        heroImportAttachmentTriangles,
        heroImportBranchInstances,
        heroImportAccessoryInstances,
        heroImportSourceMaterial,
        heroImportSourceMaterialTextures,
        heroImportSourceMaterialImages,
        heroImportExportStatus,
        heroImportExportBytes,
        heroImportExportMaterials,
        heroImportExportTextures,
        heroImportExportImages,
        heroImportStatus,
        heroSpineEditing,
        heroSpineAddEnabled,
        heroImportHashBeforeEdit,
        heroImportHashAfterEdit,
        heroSpineEditStatus,
        heroSpineFinished,
        heroImportCleared,
        crownTrianglesBefore,
        crownTrianglesAfter,
        crownTrianglesSculpted,
        crownTrianglesRestored,
        crownUrlPersisted: new URL(location.href).searchParams.get('tr'),
        crownFieldContract: crownField?.contract ?? null,
        crownFieldVersion: crownField?.version ?? null,
        crownFieldVolumesAdded: addedCrownField?.volumes?.length ?? 0,
        crownLobeDimensions: transformedLobe?.dimensions ?? null,
        crownLobeRotation: transformedLobe?.rotation ?? null,
        crownLobeWeight: transformedLobe?.weight ?? null,
        crownFieldVolumesAfterRemove: crownField?.volumes?.length ?? 0,
        crownTrianglesAfterRemove,
        subtractiveLobeOperation: subtractiveLobe?.operation ?? null,
        carvedTriangles,
        crownFieldDatasetVolumes,
        crownFieldDatasetVolumesAfterRemove: document.querySelector('#app')?.dataset.crownFieldVolumeCount ?? null,
        crownFieldFinalUrl: new URL(location.href).searchParams.get('cf'),
        crownLobeControls: Boolean(document.querySelector('#crownLobeWidth') && document.querySelector('#crownLobeRotation')),
      };
    })()
  `;
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const result = response.result?.result?.value;
  if (!result?.rows) console.error(JSON.stringify(response));
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  if (!result) throw new Error(response.result?.exceptionDetails?.text ?? "browser evaluation failed");
  assert.equal(result.rows, 9);
  assert.equal(result.after, result.before + 1, "architecture count must survive regeneration through the graph adapter");
  assert.match(result.summary, /compiler controls applied/);
  assert.match(result.hash, /^[0-9a-f]{8}$/);
  assert.ok(Number(result.triangles.replaceAll(",", "")) > 0);
  assert.equal(result.editContourButton, true);
  assert.equal(result.heroImportButton, true);
  assert.match(result.heroImportFile, /\.glb/);
  assert.deepEqual(result.initialLazyAuthoringResources, [],
    "default startup must not fetch graph, material/import, macro, contour, or crown authoring chunks");
  assert.equal(result.macroRulesLoaded, null, "default startup must not load advanced macro rules");
  assert.ok(result.visibilityClusters > 0, "live Phi Fern placement LOD must build visibility clusters");
  assert.ok(result.visibilityPlacements > 0, "live Phi Fern placement LOD must expose placements");
  assert.ok(result.visibilityCandidates >= 0 && result.visibilityCandidates <= result.visibilityPlacements,
    "frustum candidate count must remain bounded by live placements");
  assert.ok(result.visibilityFrustumRejected >= 0 && result.visibilityFrustumRejected <= result.visibilityPlacements,
    "frustum rejection count must remain bounded by live placements");
  assert.match(result.materialBakeHash, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(result.materialBakeReady, "true");
  assert.equal(result.materialBakeImages, 6, "two PBR surfaces must bake base-color, ORM, and normal resources");
  assert.equal(result.materialLivePbr, "true", "baked bark/organ materials must be adopted by the live generated plant");
  assert.match(result.materialLiveAudit, /^fnv1a32:[0-9a-f]{8}$/);
  assert.ok(result.materialLiveGroups >= 2, "live mixed generated geometry must expose separate bark and organ draw groups");
  assert.equal(result.materialLiveTangents, "true", "live normal-mapped geometry must carry explicit tangents");
  assert.equal(result.materialLiveNormalMaps, 2, "both live bark and organ surfaces must bind normal maps");
  assert.equal(result.materialLiveTextureBytes, 6 * 256 * 256 * 4, "live texture ownership audit must be exact");
  assert.match(result.lastGlbMaterialHash, /^fnv1a32:[0-9a-f]{8}$/, "lab GLB export must embed the active baked material bundle");
  assert.ok(result.lastGlbSurfaceGroups > 0);
  assert.equal(result.lastGlbMaterialAssignments, result.lastGlbSurfaceGroups,
    "lab GLB export must assign every exported bark/organ range to an explicit baked slot");
  if (result.heroImportActive !== "true") console.error(`hero import diagnostic: ${JSON.stringify({ status: result.heroImportStatus, sourceMaterial: result.heroImportSourceMaterial })}`);
  if (!result.heroImportAttachmentHash) console.error(`hero attachment diagnostic: ${JSON.stringify({ status: result.heroImportStatus, active: result.heroImportActive, attachments: result.heroImportAttachments, exports: [result.heroImportExportMaterials, result.heroImportExportTextures, result.heroImportExportImages] })}`);
  assert.equal(result.heroImportActive, "true");
  assert.equal(result.heroImportVertices, 3);
  assert.ok(result.heroImportAttachments > 0, "hero import must emit procedural attachment anchors");
  assert.match(result.heroImportAttachmentHash, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(result.heroImportAttachmentInstances, result.heroImportBranchInstances + result.heroImportAccessoryInstances);
  assert.ok(result.heroImportBranchInstances > 0, "hero branch records must materialize as shared instances");
  assert.ok(result.heroImportAccessoryInstances > 0, "accessory-bearing hero genomes must materialize accessory instances");
  assert.equal(result.heroImportAttachmentDraws, 2, "winterberry hero branches and berries must use two shared prototype draws");
  assert.ok(result.heroImportAttachmentVertices > 0);
  assert.ok(result.heroImportAttachmentTriangles > 0);
  assert.equal(result.heroImportSourceMaterial, "true", "browser import must adopt the selected GLB source material");
  assert.equal(result.heroImportSourceMaterialTextures, 3, "PNG color, JPEG normal, and WebP emissive bindings must decode in-browser");
  assert.equal(result.heroImportSourceMaterialImages, 3);
  assert.ok(result.heroImportExportBytes > 0, "materialized imported hero content must survive real GLB export");
  assert.ok(result.heroImportExportMaterials >= 2, "real exported hero GLB must retain source bark plus organ materials");
  assert.ok(result.heroImportExportTextures >= 3, "real exported hero GLB must contain all adopted bark textures");
  assert.ok(result.heroImportExportImages >= 3, "real exported hero GLB must embed all adopted bark images");
  assert.match(result.heroImportExportStatus, /instanced branch, leaf, and accessory anchors/);
  assert.match(result.heroImportStatus, /smoke-source-bark source bark material with 3 texture bindings, UV0, wind, and collars applied/);
  assert.equal(result.heroSpineEditing, "true");
  assert.equal(result.heroSpineAddEnabled, true);
  assert.notEqual(result.heroImportHashAfterEdit, result.heroImportHashBeforeEdit, "manual spine edits must rebuild authored hero content");
  assert.match(result.heroSpineEditStatus, /manual 17-point spine applied/);
  assert.equal(result.heroSpineFinished, "false");
  assert.equal(result.heroImportCleared, null, "clearing the hero import must restore generated preview state");
  assert.ok(result.crownTrianglesAfter < result.crownTrianglesBefore, "lower swept-tube resolution must reduce live triangles");
  assert.equal(result.crownUrlPersisted, "0.60");
  assert.equal(result.crownFieldContract, "procplants.freeform-crown");
  assert.equal(result.crownFieldVersion, 1);
  assert.equal(result.crownFieldVolumesAdded, 2, "adding a viewport lobe must persist the base and sculpted volumes in the URL");
  assert.deepEqual(result.crownLobeDimensions, [1.75, 2.25, 0.85], "per-lobe resize controls must persist exact dimensions");
  assert.equal(result.crownLobeWeight, 2.4, "per-lobe density control must persist exact weight");
  assert.equal(result.crownLobeRotation?.length, 4, "per-lobe yaw control must persist a normalized quaternion");
  assert.ok(Math.abs(result.crownLobeRotation.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-10);
  assert.equal(result.crownFieldVolumesAfterRemove, 1, "removing the selected viewport lobe must update persisted crown state");
  assert.equal(result.subtractiveLobeOperation, "subtract", "cutout lobe control must persist subtraction semantics");
  assert.notEqual(result.carvedTriangles, result.crownTrianglesAfterRemove,
    "subtractive crown lobes must rebuild real branch geometry");
  assert.equal(result.crownFieldDatasetVolumes, "2");
  assert.equal(result.crownFieldDatasetVolumesAfterRemove, "0");
  assert.equal(result.crownFieldFinalUrl, null, "removing the final lobe must cleanly remove freeform URL state");
  assert.equal(result.crownLobeControls, true);
  assert.notEqual(result.crownTrianglesSculpted, result.crownTrianglesAfter,
    "the sculpted crown must rebuild real branch geometry rather than editor-only metadata");
  assert.equal(result.crownTrianglesRestored, result.crownTrianglesAfter,
    "removing the final control volume must restore exact legacy crown behavior");
  console.log(JSON.stringify(result));
  socket.close();
} finally {
  const stop = async (processHandle) => {
    if (!processHandle || processHandle.exitCode !== null) return;
    const exited = new Promise((resolvePromise) => processHandle.once("exit", resolvePromise));
    processHandle.kill();
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
  };
  await stop(browser);
  await stop(preview);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      break;
    } catch (error) {
      if (attempt === 9) console.warn(`browser profile cleanup deferred: ${String(error)}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
}
