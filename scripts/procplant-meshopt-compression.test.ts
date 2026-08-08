import assert from "node:assert/strict";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import {
  compressProcPlantGlbMeshopt,
  PROCPLANT_MESHOPT_EXTENSION,
} from "../src/procplant-meshopt-compression";
import { exportProcPlantGlb } from "../src/procplant-export";
import { compileProcPlantLods, defaultPlantEnvironment, procPlantPresets } from "../src/procplants";

interface ExtensionDef {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: "ATTRIBUTES" | "TRIANGLES";
}

interface GlbJson {
  buffers: Array<{ byteLength: number; extensions?: Record<string, unknown> }>;
  bufferViews: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    extensions?: { EXT_meshopt_compression?: ExtensionDef };
  }>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

const parseGlb = (source: ArrayBuffer) => {
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.length);
  const jsonLength = view.getUint32(12, true);
  const binaryHeader = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryHeader, true);
  return {
    json: JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd()) as GlbJson,
    binary: bytes.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength),
  };
};

const phiLod = compileProcPlantLods(procPlantPresets.phiFern, 4242, defaultPlantEnvironment())[0]!;
const source = await exportProcPlantGlb(phiLod.template, {
  name: "phi-fern-meshopt",
  genomeId: procPlantPresets.phiFern.id,
  seed: 4242,
});
const first = await compressProcPlantGlbMeshopt(source, { compatibility: "required" });
const second = await compressProcPlantGlbMeshopt(source, { compatibility: "required" });
assert.deepEqual(new Uint8Array(second.bytes), new Uint8Array(first.bytes), "meshopt GLB bytes must be deterministic");
assert.ok(first.bytes.byteLength < source.byteLength, "required meshopt output must reduce representative geometry bytes");
assert.equal(first.stats.exactGeometry, true);
assert.equal(first.stats.texturesCompressed, false);
assert.ok(first.stats.compressedBufferViews > 0);
assert.ok(first.stats.attributeBufferViews > 0);
assert.ok(first.stats.triangleBufferViews > 0);

const original = parseGlb(source);
const required = parseGlb(first.bytes);
assert.ok(required.json.extensionsUsed?.includes(PROCPLANT_MESHOPT_EXTENSION));
assert.ok(required.json.extensionsRequired?.includes(PROCPLANT_MESHOPT_EXTENSION));
assert.equal(required.json.buffers.length, 2);
assert.deepEqual(required.json.buffers[1]?.extensions?.[PROCPLANT_MESHOPT_EXTENSION], { fallback: true });
await MeshoptDecoder.ready;
for (let index = 0; index < required.json.bufferViews.length; index++) {
  const compressedView = required.json.bufferViews[index]!;
  const extension = compressedView.extensions?.EXT_meshopt_compression;
  if (!extension) continue;
  assert.equal(compressedView.buffer, 1);
  assert.equal(compressedView.byteLength, extension.count * extension.byteStride);
  const compressed = required.binary.subarray(
    extension.byteOffset ?? 0,
    (extension.byteOffset ?? 0) + extension.byteLength,
  );
  const decoded = new Uint8Array(extension.count * extension.byteStride);
  MeshoptDecoder.decodeGltfBuffer(decoded, extension.count, extension.byteStride, compressed, extension.mode);
  const originalView = original.json.bufferViews[index]!;
  const originalBytes = original.binary.subarray(
    originalView.byteOffset ?? 0,
    (originalView.byteOffset ?? 0) + originalView.byteLength,
  );
  assert.deepEqual(decoded, originalBytes, `bufferView ${index} must decode byte-exactly`);
}

const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(first.bytes, "");
let meshCount = 0;
loaded.scene.traverse((object) => {
  if ("isMesh" in object && object.isMesh) meshCount++;
});
assert.ok(meshCount > 0, "Three GLTFLoader must decode at least one mesh");
console.log(`ok 1 - required EXT_meshopt decodes byte-exactly and loads in Three (${source.byteLength} -> ${first.bytes.byteLength})`);

const fallback = await compressProcPlantGlbMeshopt(source, { compatibility: "fallback" });
const fallbackJson = parseGlb(fallback.bytes).json;
assert.ok(fallbackJson.extensionsUsed?.includes(PROCPLANT_MESHOPT_EXTENSION));
assert.ok(!fallbackJson.extensionsRequired?.includes(PROCPLANT_MESHOPT_EXTENSION));
assert.equal(fallbackJson.buffers.length, 1);
assert.ok(fallbackJson.bufferViews.some((view) =>
  view.buffer === 0 && Boolean(view.extensions?.EXT_meshopt_compression)));
const fallbackLoaded = await new GLTFLoader().parseAsync(fallback.bytes, "");
assert.ok(fallbackLoaded.scene.children.length > 0, "fallback GLB must load without a meshopt decoder");
console.log("ok 2 - optional fallback mode retains core glTF bytes for loaders without meshopt");

await assert.rejects(
  compressProcPlantGlbMeshopt(source, { maxInputBytes: 1024 }),
  /exceeds maxInputBytes/,
);
await assert.rejects(
  compressProcPlantGlbMeshopt(source, { maxBufferViews: 1 }),
  /exceeds maxBufferViews/,
);
await assert.rejects(
  compressProcPlantGlbMeshopt(source, { maxOutputBytes: 1024 }),
  /exceeds maxOutputBytes/,
);
console.log("ok 3 - meshopt resource caps reject oversized sources, view counts, and outputs");
console.log("1..3");
