import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodeToKTX2 } from "ktx2-encoder";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_KTX2_SMOKE_PORT ?? 4197);
const debugPort = Number(process.env.PROCPLANTS_KTX2_SMOKE_DEBUG_PORT ?? 9247);
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
if (!chrome) throw new Error("Chrome or Edge is required for the hero KTX2 browser smoke test");

const rgba = new Uint8Array(8 * 8 * 4);
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  const offset = (y * 8 + x) * 4;
  const red = (x + y) % 2 === 0;
  rgba[offset] = red ? 240 : 25;
  rgba[offset + 1] = red ? 35 : 220;
  rgba[offset + 2] = 20;
  rgba[offset + 3] = 255;
}
const ktx2 = await encodeToKTX2(rgba, {
  imageDecoder: async (data) => ({ data: data.slice(), width: 8, height: 8 }),
  isKTX2File: true,
  isUASTC: true,
  generateMipmap: true,
  isPerceptual: true,
  isSetKTX2SRGBTransferFunc: true,
  isNormalMap: false,
  needSupercompression: false,
  enableRDO: false,
  uastcLDRQualityLevel: 1,
  outputBufferSize: 65_536,
  enableDebug: false,
});

const makeHeroGlb = () => {
  const imageOffset = 68;
  const binary = new Uint8Array(Math.ceil((imageOffset + ktx2.byteLength) / 4) * 4);
  new Float32Array(binary.buffer, 0, 9).set([-0.8, 0, 0, 0.8, 0, 0, 0, 2.8, 0.2]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
  new Float32Array(binary.buffer, 44, 6).set([0, 0, 1, 0, 0.5, 1]);
  binary.set(ktx2, imageOffset);
  const json = {
    asset: { version: "2.0", generator: "procplants KTX2 browser smoke" },
    extensionsUsed: ["KHR_texture_basisu", "KHR_texture_transform"],
    extensionsRequired: ["KHR_texture_basisu"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "ktx2-hero-trunk", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.8, 0, 0], max: [0.8, 2.8, 0.2] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
      { buffer: 0, byteOffset: 44, byteLength: 24, target: 34962 },
      { buffer: 0, byteOffset: imageOffset, byteLength: ktx2.byteLength },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    images: [{ name: "smoke-ktx2-bark", bufferView: 3, mimeType: "image/ktx2" }],
    samplers: [{ magFilter: 9728, minFilter: 9985, wrapS: 33071, wrapT: 33648 }],
    textures: [{ sampler: 0, extensions: { KHR_texture_basisu: { source: 0 } } }],
    materials: [{
      name: "smoke-ktx2-source-bark",
      pbrMetallicRoughness: {
        baseColorFactor: [0.8, 0.7, 0.6, 1],
        metallicFactor: 0.05,
        roughnessFactor: 0.73,
        baseColorTexture: {
          index: 0,
          extensions: { KHR_texture_transform: { offset: [0.125, 0.25], rotation: 0.2, scale: [2, 3] } },
        },
      },
      doubleSided: true,
    }],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.byteLength / 4) * 4;
  const output = new ArrayBuffer(12 + 8 + jsonLength + 8 + binary.byteLength);
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
  view.setUint32(binHeader, binary.byteLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  new Uint8Array(output, binHeader + 8).set(binary);
  return new Uint8Array(output);
};
const heroGlbBase64 = Buffer.from(makeHeroGlb()).toString("base64");

const waitForOk = async (url, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch { /* preview is still binding */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};
const waitForJson = async (url, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch { /* browser is still binding */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-hero-ktx2-smoke-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitForOk(`http://127.0.0.1:${appPort}/`);
  browser = spawn(chrome, [
    "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--disable-crashpad", "--no-first-run", "--disable-extensions",
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
    if (callback) { pending.delete(message.id); callback(message); }
  });
  const command = (method, params = {}) => new Promise((resolvePromise) => {
    const id = ++commandId;
    pending.set(id, resolvePromise);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Runtime.enable");
  const expression = `
    (async () => {
      const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
      for (let i = 0; i < 240 && (!document.querySelector('#heroGlbFile') || document.querySelector('#importHeroGlb')?.disabled); i++) await wait(100);
      const before = performance.getEntriesByType('resource').map((entry) => entry.name);
      const bytes = Uint8Array.from(atob(${JSON.stringify(heroGlbBase64)}), (value) => value.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'smoke-ktx2-hero.glb', { type: 'model/gltf-binary' }));
      const input = document.querySelector('#heroGlbFile');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 300 && document.querySelector('#app')?.dataset.heroImportSourceMaterialKtx2Uploads !== '1'; i++) await wait(100);
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      const after = performance.getEntriesByType('resource').map((entry) => entry.name);
      const canvas = document.querySelector('#viewport canvas, canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      return {
        active: document.querySelector('#app')?.dataset.heroImportActive ?? null,
        decoded: Number(document.querySelector('#app')?.dataset.heroImportSourceMaterialKtx2Images ?? 0),
        decoder: document.querySelector('#app')?.dataset.heroImportSourceMaterialKtx2Decoder ?? '',
        uploads: Number(document.querySelector('#app')?.dataset.heroImportSourceMaterialKtx2Uploads ?? 0),
        status: document.querySelector('#heroImportStatus')?.textContent ?? '',
        glError: gl?.getError() ?? -1,
        initialKtxResources: before.filter((url) => /KTX2Loader|basis_transcoder/.test(url)).length,
        loadedKtxResources: after.filter((url) => /KTX2Loader|basis_transcoder/.test(url)).map((url) => url.split('/').at(-1)),
      };
    })()
  `;
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  const result = response.result?.result?.value;
  assert.equal(result.active, "true", `KTX2 hero import failed: ${result.status}`);
  assert.equal(result.decoded, 1);
  assert.equal(result.decoder, "three-ktx2-loader+basis");
  assert.equal(result.uploads, 1, "decoded KTX2 texture must be uploaded by the live preview renderer");
  assert.equal(result.glError, 0, "live KTX2 preview render must not produce a WebGL error");
  assert.equal(result.initialKtxResources, 0, "KTX2 decoder/transcoder must remain outside startup resources");
  assert.ok(result.loadedKtxResources.some((name) => name.startsWith("KTX2Loader-")));
  assert.ok(result.loadedKtxResources.some((name) => name.startsWith("basis_transcoder-") && name.endsWith(".js")));
  assert.ok(result.loadedKtxResources.some((name) => name.startsWith("basis_transcoder-") && name.endsWith(".wasm")));
  assert.match(result.status, /smoke-ktx2-source-bark source bark material with 1 texture binding/);
  console.log(JSON.stringify({ ktx2Bytes: ktx2.byteLength, ...result }, null, 2));
  console.log("ok 1 - real browser KTX2 decode, renderer upload, and WebGL preview are lazy and error-free");
  console.log("1..1");
  socket.close();
} finally {
  const stop = async (processHandle) => {
    if (!processHandle || processHandle.exitCode !== null) return;
    processHandle.kill();
    await Promise.race([
      new Promise((resolvePromise) => processHandle.once("exit", resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
    ]);
  };
  await stop(browser);
  await stop(preview);
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
