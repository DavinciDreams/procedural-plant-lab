import assert from "node:assert/strict";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { exportProcPlantScenesGlb } from "../src/procplant-export";
import { encodeProcPlantImpostorPng } from "../src/procplant-impostor-image";
import {
  PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT,
  PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION,
  appendProcPlantOrganPlacement,
  applyProcPlantOrganPlacementOverrides,
  createProcPlantOrganPlacementPackage,
  createProcPlantOrganPlacementTarget,
} from "../src/procplant-organ-placement-overrides";
import {
  bindProcPlantPlacementDecalsIntoGlb,
  createProcPlantPlacementDecalPixelSource,
  exportProcPlantSceneGlbWithPlacementDecals,
  prepareProcPlantPlacementDecalGlbDraws,
} from "../src/procplant-placement-decal-glb";
import type { ProcPlantGraph } from "../src/procplants";

const graph: ProcPlantGraph = {
  stems: [
    { position: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.1, depth: 0, t: 0, index: 0 },
    { position: new THREE.Vector3(0, 1, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.08, depth: 0, t: 1, index: 1 },
  ],
  segments: [[0, 1]],
  segmentRecords: [{ id: "trunk:0", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 1 }],
  organs: [],
  attachments: [],
};
const target = createProcPlantOrganPlacementTarget("decal-glb-fixture", 73, graph);
const binding = {
  contract: PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT,
  version: PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION,
  materialId: "scar-material-sha",
  textureId: "scar-texture-sha",
  uvSet: 0,
  uvRect: [0.125, 0.25, 0.875, 0.75],
} as const;
const appended = appendProcPlantOrganPlacement(createProcPlantOrganPlacementPackage(target), {
  kind: "decal",
  segmentId: "trunk:0",
  axialT: 0.5,
  azimuth: 0.25,
  scale: 0.18,
  decal: binding,
});
assert(appended.operation);
const applied = applyProcPlantOrganPlacementOverrides(graph, target, appended.package, { decalBindings: [binding] });
assert.equal(applied.decals.length, 1);

const rgba = Uint8Array.of(
  210, 40, 20, 255, 20, 170, 30, 0,
  30, 50, 220, 128, 245, 230, 30, 255,
);
const originalPng = encodeProcPlantImpostorPng(rgba, 2, 2);
const pixelSource = await createProcPlantPlacementDecalPixelSource({
  binding,
  sourceMimeType: "image/png",
  sourceName: "real-scar.png",
  sourceBytes: originalPng,
  width: 2,
  height: 2,
  rgba,
  alphaCutoff: 0.08,
});
assert.match(pixelSource.sourceSha256, /^sha256:[0-9a-f]{64}$/);
assert.match(pixelSource.rgbaSha256, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(pixelSource.pngBytes, originalPng);

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
geometry.setIndex([0, 1, 2]);
const plantMaterial = new THREE.MeshStandardMaterial({ color: 0x779944 });
const plant = new THREE.Mesh(geometry, plantMaterial);
plant.name = "base-plant";
const scene = new THREE.Scene();
scene.name = "decal-glb-scene";
scene.add(plant);

const first = await exportProcPlantSceneGlbWithPlacementDecals(scene, applied.decals, pixelSource);
const second = await exportProcPlantSceneGlbWithPlacementDecals(scene, applied.decals, pixelSource);
assert.deepEqual(new Uint8Array(first.bytes), new Uint8Array(second.bytes));
assert.equal(first.contentHash, second.contentHash);
assert.equal(first.draws, 1);
assert.equal(first.vertices, 4);
assert.equal(first.triangles, 2);
assert.equal(first.embeddedMimeType, "image/png");
assert.equal(scene.children.length, 1, "convenience export must not mutate the source scene");

const parseGlb = (bytes: ArrayBuffer) => {
  const view = new DataView(bytes);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)).trim());
  const binaryHeader = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryHeader, true);
  return { json, binary: new Uint8Array(bytes, binaryHeader + 8, binaryLength) };
};
const parsed = parseGlb(first.bytes);
const decalNode = parsed.json.nodes.find((node: { name?: string }) => node.name?.startsWith("procplant-placement-decal-glb-draw:"));
assert(decalNode);
const primitive = parsed.json.meshes[decalNode.mesh].primitives[0];
assert.equal(parsed.json.accessors[primitive.attributes.POSITION].count, 4);
assert.equal(parsed.json.accessors[primitive.attributes.TEXCOORD_0].count, 4);
assert.equal(parsed.json.accessors[primitive.indices].count, 6);
const material = parsed.json.materials[primitive.material];
assert.equal(material.name, binding.materialId);
assert.equal(material.alphaMode, "MASK");
assert.equal(material.alphaCutoff, 0.08);
assert.equal(material.doubleSided, true);
assert.equal(material.pbrMetallicRoughness.baseColorTexture.texCoord, 0);
const texture = parsed.json.textures[material.pbrMetallicRoughness.baseColorTexture.index];
const image = parsed.json.images[texture.source];
assert.equal(image.mimeType, "image/png");
const imageView = parsed.json.bufferViews[image.bufferView];
assert.deepEqual(
  parsed.binary.slice(imageView.byteOffset, imageView.byteOffset + imageView.byteLength),
  pixelSource.pngBytes,
);
assert.equal(parsed.json.asset.extras.procplantsPlacementDecals.sourceSha256, pixelSource.sourceSha256);
assert.equal(parsed.json.asset.extras.procplantsPlacementDecals.rgbaSha256, pixelSource.rgbaSha256);
assert.equal(parsed.json.asset.extras.procplantsPlacementDecals.draws[0].operationId, applied.decals[0]!.operationId);
console.log("ok 1 - decoded pixels export as deterministic embedded PNG with exact two-triangle UV0 material binding");

const priorCreateImageBitmap = globalThis.createImageBitmap;
const priorSelf = (globalThis as { self?: typeof globalThis }).self;
Object.defineProperty(globalThis, "self", { configurable: true, writable: true, value: globalThis });
Object.defineProperty(globalThis, "createImageBitmap", {
  configurable: true,
  writable: true,
  value: async () => ({ width: 2, height: 2, close() {} }) as ImageBitmap,
});
try {
  const loaded = await new GLTFLoader().parseAsync(first.bytes, "");
  let decalMesh: THREE.Mesh | undefined;
  loaded.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((candidate) => candidate.name === binding.materialId)) decalMesh = object;
  });
  assert(decalMesh?.isMesh);
  assert.equal(decalMesh.geometry.getAttribute("uv").count, 4);
  assert.equal(decalMesh.geometry.index?.count, 6);
  const loadedMaterial = decalMesh.material as THREE.MeshStandardMaterial;
  assert.equal(loadedMaterial.name, binding.materialId);
  assert(loadedMaterial.map?.isTexture, "GLTFLoader must import the embedded decal image as a texture map");
  assert.equal(loadedMaterial.alphaTest, 0.08);
  assert.equal(loadedMaterial.side, THREE.DoubleSide);
} finally {
  if (priorCreateImageBitmap) Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, writable: true, value: priorCreateImageBitmap });
  else delete (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (priorSelf) Object.defineProperty(globalThis, "self", { configurable: true, writable: true, value: priorSelf });
  else delete (globalThis as { self?: typeof globalThis }).self;
}
console.log("ok 2 - Three GLTFLoader re-import preserves exact decal UVs, topology, PBR material, and embedded texture");

const wrongBinding = { ...binding, textureId: "wrong-texture" };
const wrongSource = await createProcPlantPlacementDecalPixelSource({
  binding: wrongBinding,
  sourceMimeType: "image/png",
  sourceBytes: originalPng,
  width: 2,
  height: 2,
  rgba,
});
assert.throws(() => prepareProcPlantPlacementDecalGlbDraws(applied.decals, wrongSource), /do not exactly match/);
assert.throws(() => prepareProcPlantPlacementDecalGlbDraws(applied.decals, {
  ...pixelSource,
  roughness: Number.NaN,
}), /material factors/);
await assert.rejects(() => createProcPlantPlacementDecalPixelSource({
  binding,
  sourceMimeType: "image/png",
  sourceBytes: new Uint8Array(),
  width: 2,
  height: 2,
  rgba,
}), /source bytes/);
await assert.rejects(() => createProcPlantPlacementDecalPixelSource({
  binding,
  sourceMimeType: "image/webp",
  sourceBytes: originalPng,
  width: 2,
  height: 2,
  rgba,
}), /do not match image\/webp/);
await assert.rejects(() => createProcPlantPlacementDecalPixelSource({
  binding,
  sourceMimeType: "image/png",
  sourceBytes: originalPng,
  width: 2,
  height: 2,
  rgba: rgba.subarray(0, 12),
}), /exactly 16 bytes/);

const prepared = prepareProcPlantPlacementDecalGlbDraws(applied.decals, pixelSource);
const baseWithoutDraws = await exportProcPlantScenesGlb(scene);
await assert.rejects(() => bindProcPlantPlacementDecalsIntoGlb(baseWithoutDraws, prepared, pixelSource), /missing exact decal node/);
const mutated = { ...pixelSource, rgba: pixelSource.rgba.slice() };
mutated.rgba[0] ^= 0xff;
await assert.rejects(() => bindProcPlantPlacementDecalsIntoGlb(baseWithoutDraws, prepared, mutated), /no longer match/);
prepared.dispose();
await assert.rejects(() => bindProcPlantPlacementDecalsIntoGlb(baseWithoutDraws, prepared, pixelSource), /disposed or unsupported/);
console.log("ok 3 - missing bytes, decoded-pixel mutation, binding mismatch, absent nodes, and disposed preparation fail closed");

geometry.dispose();
plantMaterial.dispose();
console.log("1..3");
