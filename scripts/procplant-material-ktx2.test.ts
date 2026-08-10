import assert from "node:assert/strict";
import * as THREE from "three";
import { read } from "ktx-parse";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";
import { bakeProcPlantMaterials } from "../src/procplant-material-bake";
import {
  classifyProcPlantMaterialAlpha,
  encodeProcPlantBakedMaterialsKtx2,
  selectProcPlantMaterialKtx2Policy,
} from "../src/procplant-material-ktx2";
import { declareProcPlantGeometryUv0, exportProcPlantGlbWithBakedMaterials } from "../src/procplant-glb-material-binding";
import { createProcPlantKtx2NodeEncoder } from "./procplant-ktx2-node-encoder";

const graph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "ktx2-fixture",
  textures: [{ id: "normal", uri: "normal.png", mimeType: "image/png", role: "normal", colorSpace: "linear" }],
  nodes: [
    { id: "base", kind: "color", value: [0.2, 0.6, 0.1, 1] },
    { id: "ao", kind: "scalar", value: 0.9 },
    { id: "rough", kind: "scalar", value: 0.65 },
    { id: "metal", kind: "scalar", value: 0 },
    { id: "normalSample", kind: "texture-sample", texture: "normal", channel: "normal" },
    { id: "emissive", kind: "color", value: [0.01, 0.02, 0] },
  ],
  surfaces: [{
    slot: "leaf",
    channels: { baseColor: "base", ambientOcclusion: "ao", roughness: "rough", metalness: "metal", normal: "normalSample", emissive: "emissive" },
    alphaMode: "opaque",
  }],
};
const normalPixels = new Uint8Array(4 * 4 * 4);
for (let offset = 0; offset < normalPixels.length; offset += 4) normalPixels.set([128, 128, 255, 255], offset);
const baked = bakeProcPlantMaterials(compileProcPlantMaterialGraph(graph), [
  { textureId: "normal", width: 4, height: 4, rgba: normalPixels },
], { width: 4, height: 4 });
const bakedPixelsBefore = baked.images.map((image) => image.rgba.slice());
const encoder = createProcPlantKtx2NodeEncoder();
const encodedA = await encodeProcPlantBakedMaterialsKtx2(baked, encoder);
const encodedB = await encodeProcPlantBakedMaterialsKtx2(baked, encoder);
assert.equal(encodedA.contentHash, encodedB.contentHash);
assert.equal(encodedA.determinismExpectation, "byte-stable-with-pinned-wasm-and-options");
assert.equal(encodedA.images.length, 4);
for (let index = 0; index < encodedA.images.length; index++) {
  const image = encodedA.images[index]!;
  assert.deepEqual(image.bytes, encodedB.images[index]!.bytes, `${image.usage} bytes should repeat with pinned WASM/options`);
  assert.deepEqual(baked.images[index]!.rgba, bakedPixelsBefore[index], "encoding must not mutate baked RGBA pixels");
  const container = read(image.bytes);
  assert.equal(container.pixelWidth, 4);
  assert.equal(container.pixelHeight, 4);
  assert.equal(container.levels.length, 3);
  assert.equal(image.policy.colorSpace, image.usage === "baseColor" || image.usage === "emissive" ? "srgb" : "linear");
  assert.equal(image.policy.codec, image.usage === "baseColor" || image.usage === "emissive" ? "etc1s" : "uastc");
}
assert.equal(classifyProcPlantMaterialAlpha(Uint8Array.of(1, 2, 3, 255, 1, 2, 3, 0)), "binary");
assert.equal(classifyProcPlantMaterialAlpha(Uint8Array.of(1, 2, 3, 128)), "translucent");
assert.equal(selectProcPlantMaterialKtx2Policy("baseColor", "srgb", "binary").codec, "uastc");
assert.equal(selectProcPlantMaterialKtx2Policy("normal", "linear", "opaque").normalMapPreset, true);
assert.throws(() => selectProcPlantMaterialKtx2Policy("normal", "srgb", "opaque"), /requires linear/);
await assert.rejects(() => encodeProcPlantBakedMaterialsKtx2(baked, encoder, { maxImages: 3 }), /maxImages/);
const badDimensions = structuredClone(baked);
badDimensions.images[0]!.width = 3;
await assert.rejects(() => encodeProcPlantBakedMaterialsKtx2(badDimensions, encoder), /width|multiples of 4/);
console.log("ok 1 - exact-pinned lazy encoder applies deterministic role/color/alpha policy with mipmaps and caps");

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
geometry.setIndex([0, 1, 2]);
declareProcPlantGeometryUv0(geometry);
const material = new THREE.MeshStandardMaterial();
const mesh = new THREE.Mesh(geometry, material);
mesh.name = "ktx2-leaf";
const scene = new THREE.Scene();
scene.add(mesh);
const result = await exportProcPlantGlbWithBakedMaterials({ scene, meshes: [mesh] }, baked, { textureEncoding: encodedA });
const view = new DataView(result.bytes);
const jsonLength = view.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(new Uint8Array(result.bytes, 20, jsonLength)).trim());
const binaryHeader = 20 + jsonLength;
const binary = new Uint8Array(result.bytes, binaryHeader + 8, view.getUint32(binaryHeader, true));
assert.deepEqual(json.extensionsUsed, ["KHR_texture_basisu"]);
assert.deepEqual(json.extensionsRequired, ["KHR_texture_basisu"]);
assert.equal(json.images.length, 4);
for (let index = 0; index < json.images.length; index++) {
  const image = json.images[index];
  assert.equal(image.mimeType, "image/ktx2");
  assert.equal(json.textures[index].source, undefined, "KTX2-only texture must not claim a core PNG fallback");
  assert.equal(json.textures[index].extensions.KHR_texture_basisu.source, index);
  const bufferView = json.bufferViews[image.bufferView];
  assert.deepEqual(binary.subarray(bufferView.byteOffset, bufferView.byteOffset + 12), encodedA.images[index]!.bytes.subarray(0, 12));
}
assert.equal(json.asset.extras.procplantsMaterialBinding.textureEncoding.contentHash, encodedA.contentHash);
const mismatched = structuredClone(encodedA);
mismatched.sourceBakeContentHash = "fnv1a32:00000000";
await assert.rejects(() => exportProcPlantGlbWithBakedMaterials({ scene, meshes: [mesh] }, baked, { textureEncoding: mismatched }), /does not match/);
const mutated = structuredClone(encodedA);
mutated.images[0]!.bytes[12] ^= 1;
await assert.rejects(() => exportProcPlantGlbWithBakedMaterials({ scene, meshes: [mesh] }, baked, { textureEncoding: mutated }), /contentHash|metadata, policy, or bytes/);
geometry.dispose();
material.dispose();
console.log("ok 2 - exported GLB embeds validated KTX2 payloads and requires KHR_texture_basisu without a false fallback");
