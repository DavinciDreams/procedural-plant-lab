import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const appPort = Number(process.env.PROCPLANTS_IMPORTED_DECAL_PORT ?? 4211);
const debugPort = Number(process.env.PROCPLANTS_IMPORTED_DECAL_DEBUG_PORT ?? 9261);
const candidates = process.platform === "win32" ? [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(candidates.map(async (candidate) => { await access(candidate); return candidate; })).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for imported-hero decal browser proof");

const pad4 = (value) => (value + 3) & ~3;
const bytesOf = (kind, values) => { const array = new kind(values); return new Uint8Array(array.buffer); };
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };
const u32 = (value) => bytesOf(Uint32Array, [value]);
const crc32 = (bytes) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => { const name = new TextEncoder().encode(type); return concat(u32be(data.length), name, data, u32be(crc32(concat(name, data)))); };
const u32be = (value) => Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
const png = concat(Uint8Array.of(137,80,78,71,13,10,26,10), pngChunk("IHDR", concat(u32be(2), u32be(2), Uint8Array.of(8,6,0,0,0))), pngChunk("IDAT", new Uint8Array(deflateSync(Uint8Array.of(0,255,80,30,255,40,220,80,255,0,30,100,255,255,240,210,40,255)))), pngChunk("IEND", new Uint8Array()));
const positions = bytesOf(Float32Array, [-0.7, 0, 0, 0.7, 0, 0, 0, 3, 0]);
const normals = bytesOf(Float32Array, [0, 0, 1, 0, 0, 1, 0, 0, 1]);
const uv = bytesOf(Uint16Array, [0, 0, 65535, 0, 32768, 65535]);
const indices = bytesOf(Uint16Array, [0, 1, 2]);
const parts = [positions, normals, uv, indices, png];
const offsets = []; let binaryLength = 0;
for (const part of parts) { binaryLength = pad4(binaryLength); offsets.push(binaryLength); binaryLength += part.length; }
const binary = new Uint8Array(binaryLength); parts.forEach((part, index) => binary.set(part, offsets[index]));
const json = {
  asset: { version: "2.0", generator: "Procplants imported decal browser fixture" }, scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ name: "Static hero trunk", mesh: 0 }], buffers: [{ byteLength: binary.length }],
  bufferViews: parts.map((part, index) => ({ buffer: 0, byteOffset: offsets[index], byteLength: part.length })),
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }, { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: 2, componentType: 5123, normalized: true, count: 3, type: "VEC2" }, { bufferView: 3, componentType: 5123, count: 3, type: "SCALAR" },
  ],
  images: [{ bufferView: 4, mimeType: "image/png" }], textures: [{ source: 0 }],
  materials: [{ name: "Bark", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, roughnessFactor: 0.9 } }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
};
const jsonSource = new TextEncoder().encode(JSON.stringify(json)); const jsonBytes = new Uint8Array(pad4(jsonSource.length)); jsonBytes.fill(32); jsonBytes.set(jsonSource);
const binBytes = new Uint8Array(pad4(binary.length)); binBytes.set(binary);
const glb = concat(u32(0x46546c67), u32(2), u32(12 + 8 + jsonBytes.length + 8 + binBytes.length), u32(jsonBytes.length), u32(0x4e4f534a), jsonBytes, u32(binBytes.length), u32(0x004e4942), binBytes);

const temp = await mkdtemp(join(tmpdir(), "procplants-imported-decal-browser-"));
const profile = join(temp, "profile"); const downloads = join(temp, "downloads");
const heroPath = join(temp, "static-hero.glb"); const decalPath = join(temp, "decal.png");
await writeFile(heroPath, glb); await writeFile(decalPath, png);
const waitFor = async (probe, label, timeout = 60_000) => { const start = Date.now(); let last; while (Date.now() - start < timeout) { try { const value = await probe(); if (value) return value; } catch (error) { last = error; } await new Promise((resolveWait) => setTimeout(resolveWait, 100)); } throw new Error(`timed out waiting for ${label}: ${String(last ?? "not ready")}`); };
const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"], { cwd: root, stdio: "ignore", windowsHide: true });
let browser; let socket;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${appPort}/`)).ok, "Vite app");
  browser = spawn(chrome, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-first-run", "--disable-extensions", "--disable-background-networking", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${appPort}/`], { stdio: "ignore", windowsHide: true });
  const target = await waitFor(async () => { const response = await fetch(`http://127.0.0.1:${debugPort}/json`); return response.ok ? (await response.json()).find((entry) => entry.type === "page" && entry.url.includes(String(appPort))) : null; }, "Chrome target");
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0; const pending = new Map(); const errors = [];
  socket.addEventListener("message", (event) => { const message = JSON.parse(String(event.data)); if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails?.exception?.description ?? "runtime exception"); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); callback(message); } });
  const command = (method, params = {}) => new Promise((resolveCommand) => { const commandId = ++id; pending.set(commandId, resolveCommand); socket.send(JSON.stringify({ id: commandId, method, params })); });
  const evaluate = async (expression) => { const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (response.error) throw new Error(JSON.stringify(response.error)); if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result?.result?.value; };
  await command("Runtime.enable"); await command("DOM.enable"); await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  await waitFor(() => evaluate("document.readyState === 'complete' && !!document.querySelector('#regenerate') && !document.querySelector('#regenerate').disabled && !!document.querySelector('#heroGlbFile')"), "lab ready");
  const setFile = async (selector, path) => { const document = await command("DOM.getDocument", { depth: -1 }); const node = await command("DOM.querySelector", { nodeId: document.result.root.nodeId, selector }); await command("DOM.setFileInputFiles", { nodeId: node.result.nodeId, files: [path] }); };
  await setFile("#heroGlbFile", heroPath);
  await waitFor(() => evaluate("!!document.querySelector('#heroImportStatus')?.textContent && !document.querySelector('#heroImportStatus').textContent.startsWith('Importing')"), "hero import result");
  const heroState = await evaluate("({ active:document.querySelector('#app')?.dataset.heroImportActive, target:document.querySelector('#app')?.dataset.heroImportDecalTarget, status:document.querySelector('#heroImportStatus')?.textContent })");
  assert.deepEqual(heroState, { active: "true", target: "static", status: heroState.status }, heroState.status);
  await setFile("#placementDecalFile", decalPath);
  await waitFor(() => evaluate("document.querySelector('#app')?.dataset.placementDecalBindingReady === 'true'"), "image binding");
  await waitFor(() => evaluate("!!document.querySelector('#placementMode') && !document.querySelector('#placementMode').disabled && !document.querySelector('#regenerate').disabled"), "placement controls idle");
  await evaluate("document.querySelector('#placementMode').click()");
  await waitFor(() => evaluate("document.querySelector('#app')?.dataset.organPlacementActive === 'true'"), "imported decal placement mode");
  const placed = await evaluate(`(async () => { const wait = (ms) => new Promise(r => setTimeout(r, ms)); const canvas = document.querySelector('canvas'); const app = document.querySelector('#app'); const rect = canvas.getBoundingClientRect(); for (let yi=1; yi<20; yi++) for (let xi=1; xi<20; xi++) { canvas.dispatchEvent(new MouseEvent('click', { bubbles:true, clientX:rect.left+rect.width*xi/20, clientY:rect.top+rect.height*yi/20 })); await wait(20); if (app.dataset.heroImportDecalStatus === 'ready') return { count:Number(app.dataset.organPlacementCount), draws:Number(app.dataset.heroImportDecalDraws), triangles:Number(app.dataset.heroImportDecalTriangles), gpu:{ version:canvas.getContext('webgl2')?.getParameter(canvas.getContext('webgl2').VERSION) ?? canvas.getContext('webgl')?.getParameter(canvas.getContext('webgl').VERSION), error:canvas.getContext('webgl2')?.getError() ?? canvas.getContext('webgl')?.getError() } }; } return { failed:true, dataset:{...app.dataset}, status:document.querySelector('#saveStatus')?.textContent }; })()`);
  assert.equal(placed.failed, undefined, JSON.stringify(placed)); assert.equal(placed.count, 1); assert.equal(placed.draws, 1); assert.equal(placed.triangles, 2); assert.match(placed.gpu.version, /WebGL/); assert.equal(placed.gpu.error, 0);
  await evaluate("document.querySelector('#exportGlb').click()");
  const exportedPath = await waitFor(async () => (await readdir(downloads)).find((name) => name.endsWith(".glb") && !name.endsWith(".crdownload"))?.replace(/^/, `${downloads}\\`), "GLB download");
  const exported = await readFile(exportedPath); const view = new DataView(exported.buffer, exported.byteOffset, exported.byteLength); const jsonLength = view.getUint32(12, true); const exportedJson = JSON.parse(new TextDecoder().decode(exported.subarray(20, 20 + jsonLength)).trim());
  assert.ok(exportedJson.nodes.some((node) => String(node.name).startsWith("procplant-placement-decal-glb-draw:")), JSON.stringify(exportedJson.nodes.map((node) => node.name))); assert.ok(exportedJson.images.some((image) => image.mimeType === "image/png" && Number.isInteger(image.bufferView)));
  const reimportPath = join(temp, "adopted-reimport.glb");
  await writeFile(reimportPath, exported);
  await evaluate("document.body.insertAdjacentHTML('beforeend', '<input id=glbReimportProbe type=file>')");
  await setFile("#glbReimportProbe", reimportPath);
  const reimportState = await evaluate(`(async () => { const { GLTFLoader } = await import('/@id/three/addons/loaders/GLTFLoader.js'); const bytes = await document.querySelector('#glbReimportProbe').files[0].arrayBuffer(); const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes, '', resolve, reject)); const names=[]; let mapped=0; gltf.scene.traverse((object) => { names.push(object.name); const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []; mapped += materials.filter((material) => material.map).length; }); return { names, mapped }; })()`);
  assert.ok(reimportState.names.some((name) => String(name).startsWith("procplant-placement-decal-glb-draw")), JSON.stringify(reimportState));
  assert.ok(reimportState.mapped > 0, JSON.stringify(reimportState));
  await evaluate("document.querySelector('#undoPlacement').click()");
  await waitFor(() => evaluate("Number(document.querySelector('#app')?.dataset.organPlacementCount ?? -1) === 0"), "undo disposal");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "pass", upload: true, liveWebgl: placed.gpu.version, draws: placed.draws, triangles: placed.triangles, exportedBytes: exported.byteLength, embeddedPng: true, gltfLoaderReimported: true, reimportMappedMaterials: reimportState.mapped, undoCount: 0 }));
} finally {
  socket?.close();
  for (const handle of [browser, vite]) if (handle && handle.exitCode === null) { handle.kill(); await new Promise((resolveWait) => setTimeout(resolveWait, 300)); }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
