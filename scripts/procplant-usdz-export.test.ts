import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";
import { bakeProcPlantMaterials } from "../src/procplant-material-bake";
import { exportProcPlantUsda } from "../src/procplant-usd-export";
import { exportProcPlantUsdz } from "../src/procplant-usdz-export";
import type { ProcPlantTemplate } from "../src/procplants";

const triangle: ProcPlantTemplate = {
  pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]),
  nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uv0: new Float32Array([0, 0, 1, 0, 0.5, 1]),
  col: new Float32Array([0.2, 0.4, 0.6, 0.3, 0.5, 0.7, 0.4, 0.6, 0.8]),
  tintable: new Uint8Array([0, 1, 1]),
  sway: new Float32Array([0, 0.5, 1]),
  idx: new Uint32Array([0, 1, 2]),
};

const graph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "usd-leaf",
  textures: [{ id: "normal-map", uri: "normal.png", mimeType: "image/png", role: "normal", colorSpace: "linear" }],
  nodes: [
    { id: "base", kind: "color", value: [0.2, 0.6, 0.1, 0.75] },
    { id: "opacity", kind: "scalar", value: 0.8 },
    { id: "ao", kind: "scalar", value: 0.9 },
    { id: "rough", kind: "scalar", value: 0.65 },
    { id: "metal", kind: "scalar", value: 0.1 },
    { id: "normal", kind: "texture-sample", texture: "normal-map", channel: "normal" },
    { id: "emissive", kind: "color", value: [0.01, 0.02, 0] },
  ],
  surfaces: [{
    slot: "leaf",
    channels: { baseColor: "base", opacity: "opacity", ambientOcclusion: "ao", roughness: "rough", metalness: "metal", normal: "normal", emissive: "emissive" },
    alphaMode: "mask",
    alphaCutoff: 0.35,
    doubleSided: true,
  }],
};
const baked = bakeProcPlantMaterials(compileProcPlantMaterialGraph(graph), [
  { textureId: "normal-map", width: 1, height: 1, rgba: Uint8Array.of(128, 128, 255, 255) },
], { width: 2, height: 2 });
const before = baked.images.map((image) => [...image.bytes]);

const plain = exportProcPlantUsda(triangle, { name: "USD leaf" });
assert.equal(plain.assets.length, 0);
assert.doesNotMatch(plain.text, /UsdPreviewSurface|primvars:st|material:binding/);
assert.equal(createHash("sha256").update(plain.text).digest("hex"), "0092eeb0793441c440a3a3361d0ac165eb8cf1ffed0db0bfa87f70fbd723d999",
  "the no-material USDA bytes must remain identical to the cumulative contract-v3 baseline");

const texturedA = exportProcPlantUsda(triangle, { name: "USD leaf", material: { baked } });
const texturedB = exportProcPlantUsda(triangle, { name: "USD leaf", material: { baked } });
assert.equal(texturedA.text, texturedB.text);
assert.deepEqual(texturedA.assets, texturedB.assets);
assert.equal(texturedA.assets.length, 4);
assert.match(texturedA.text, /prepend apiSchemas = \["MaterialBindingAPI"\]/);
assert.match(texturedA.text, /rel material:binding = <\/ProcPlant_USD_leaf\/Looks\/leaf>/);
assert.match(texturedA.text, /uniform token info:id = "UsdPreviewSurface"/);
assert.match(texturedA.text, /uniform token info:id = "UsdPrimvarReader_float2"/);
assert.match(texturedA.text, /texCoord2f\[\] primvars:st = \[\s*\(0, 1\), \(1, 1\), \(0\.5, 0\)/,
  "glTF-style upper-left UV0 must be t-flipped into USD's lower-left convention");
assert.equal((texturedA.text.match(/token inputs:sourceColorSpace = "sRGB"/g) ?? []).length, 2);
assert.equal((texturedA.text.match(/token inputs:sourceColorSpace = "raw"/g) ?? []).length, 2);
assert.match(texturedA.text, /float4 inputs:scale = \(2, 2, 2, 1\)/);
assert.match(texturedA.text, /float4 inputs:bias = \(-1, -1, -1, 0\)/);
assert.match(texturedA.text, /float inputs:opacityThreshold = 0\.35/);
assert.deepEqual(baked.images.map((image) => [...image.bytes]), before, "USDA export must not mutate baked sources");
texturedA.assets[0]!.bytes[0] = 0;
assert.equal(baked.images[0]!.bytes[0], 137, "returned assets must own copied bytes");
console.log("ok 1 - textured USDA binds color-correct Preview Surface PBR and copied PNG assets without changing plain output semantics");

const packageA = exportProcPlantUsdz(triangle, { name: "USD leaf", material: { baked } });
const packageB = exportProcPlantUsdz(triangle, { name: "USD leaf", material: { baked } });
assert.equal(packageA.contentHash, packageB.contentHash);
assert.deepEqual(packageA.bytes, packageB.bytes);
assert.equal(packageA.fileName, "procplant-usd-leaf.usdz");
assert.equal(packageA.defaultLayer, "procplant-usd-leaf.usda");
assert.equal(packageA.entries[0]!.path, packageA.defaultLayer);
assert.equal(packageA.entries.length, 5);
for (const entry of packageA.entries) {
  assert.equal(entry.dataOffset % 64, 0, `${entry.path} must start on a 64-byte boundary`);
  assert.equal(entry.compression, "store");
  assert.match(entry.crc32, /^[0-9a-f]{8}$/);
  assert.ok(entry.bytes > 0);
}
assert.equal(new DataView(packageA.bytes.buffer, packageA.bytes.byteOffset + packageA.bytes.byteLength - 22, 4).getUint32(0, true), 0x06054b50);
assert.deepEqual(baked.images.map((image) => [...image.bytes]), before, "USDZ export must not mutate baked sources");
console.log(`ok 2 - USDZ is byte-deterministic, stored, bounded, and 64-byte aligns all ${packageA.entries.length} payloads`);

const withoutUv = { ...triangle, uv0: new Float32Array(0) };
assert.throws(() => exportProcPlantUsda(withoutUv, { material: { baked } }), /one uv tuple|one UV0 pair/i);
assert.throws(() => exportProcPlantUsda(triangle, { material: { baked, assetDirectory: "../escape" } }), /safe package-relative/);
assert.throws(() => exportProcPlantUsda(triangle, { material: { baked, maxAssets: 1 } }), /maxAssets/);
assert.throws(() => exportProcPlantUsdz(triangle, { material: { baked }, maxPackageBytes: 1024 }), /maxPackageBytes/);
const notReady = { ...baked, ready: false };
assert.throws(() => exportProcPlantUsda(triangle, { material: { baked: notReady } }), /ready procplants material bake/);
const ktx2 = {
  ...baked,
  images: baked.images.map((image, index) => index === 0
    ? { ...image, mimeType: "image/ktx2", bytes: Uint8Array.of(0xab, 0x4b, 0x54, 0x58) }
    : image),
};
assert.throws(() => exportProcPlantUsda(triangle, { material: { baked: ktx2 as never } }), /KTX2 and external resources are unsupported/);
const wrongColorSpace = {
  ...baked,
  images: baked.images.map((image, index) => index === 0 ? { ...image, colorSpace: "linear" as const } : image),
};
assert.throws(() => exportProcPlantUsda(triangle, { material: { baked: wrongColorSpace } }), /does not match baseColor\/srgb/);
const multi = { ...baked, gltf: { ...baked.gltf, materials: [...baked.gltf.materials, { ...baked.gltf.materials[0], name: "bark" }] } };
assert.throws(() => exportProcPlantUsda(triangle, { material: { baked: multi } }), /requires an explicit slot/);
console.log("ok 3 - texture, path, package, readiness, slot, and work limits fail closed");
console.log("1..3");
