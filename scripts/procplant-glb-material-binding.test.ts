import assert from "node:assert/strict";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";
import { bakeProcPlantMaterials } from "../src/procplant-material-bake";
import {
  declareProcPlantGeometryUv0,
  exportProcPlantGlbWithBakedMaterials,
  prepareProcPlantGlbMaterialBinding,
} from "../src/procplant-glb-material-binding";

const graph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "bound-leaf",
  textures: [{ id: "normal", uri: "normal.png", mimeType: "image/png", role: "normal", colorSpace: "linear" }],
  nodes: [
    { id: "base", kind: "color", value: [0.2, 0.6, 0.1, 0.75] },
    { id: "opacity", kind: "scalar", value: 0.8 },
    { id: "ao", kind: "scalar", value: 0.9 },
    { id: "rough", kind: "scalar", value: 0.65 },
    { id: "metal", kind: "scalar", value: 0 },
    { id: "normalSample", kind: "texture-sample", texture: "normal", channel: "normal" },
    { id: "emissive", kind: "color", value: [0.01, 0.02, 0] },
  ],
  surfaces: [{
    slot: "leaf",
    channels: { baseColor: "base", opacity: "opacity", ambientOcclusion: "ao", roughness: "rough", metalness: "metal", normal: "normalSample", emissive: "emissive" },
    alphaMode: "mask",
    alphaCutoff: 0.35,
    doubleSided: true,
  }],
};
const baked = bakeProcPlantMaterials(compileProcPlantMaterialGraph(graph), [
  { textureId: "normal", width: 1, height: 1, rgba: Uint8Array.of(128, 128, 255, 255) },
], { width: 2, height: 2 });

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
geometry.setIndex([0, 1, 2]);
const uvContract = declareProcPlantGeometryUv0(geometry);
assert.equal(uvContract.origin, "upper-left");
const originalMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const mesh = new THREE.Mesh(geometry, originalMaterial);
mesh.name = "leaf-mesh";
const scene = new THREE.Scene();
scene.name = "material-binding-scene";
scene.add(mesh);
const input = { scene, meshes: [mesh] };
const bakedBefore = baked.contentHash;

const resultA = await exportProcPlantGlbWithBakedMaterials(input, baked);
const resultB = await exportProcPlantGlbWithBakedMaterials(input, baked);
assert.equal(resultA.contentHash, resultB.contentHash);
assert.deepEqual(new Uint8Array(resultA.bytes), new Uint8Array(resultB.bytes));
assert.equal(baked.contentHash, bakedBefore);
assert.equal(mesh.material, originalMaterial, "binding must not replace runtime materials");

const parseGlb = (bytes: ArrayBuffer) => {
  const view = new DataView(bytes);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)).trim());
  const binHeader = 20 + jsonLength;
  const binLength = view.getUint32(binHeader, true);
  const binary = new Uint8Array(bytes, binHeader + 8, binLength);
  return { json, binary };
};
const { json, binary } = parseGlb(resultA.bytes);
const node = json.nodes.find((entry: { name?: string }) => entry.name === "leaf-mesh");
const primitive = json.meshes[node.mesh].primitives[0];
assert.ok(Number.isInteger(primitive.attributes.TEXCOORD_0));
const material = json.materials[primitive.material];
assert.equal(material.alphaMode, "MASK");
assert.equal(material.alphaCutoff, 0.35);
assert.equal(material.doubleSided, true);
assert.equal(material.pbrMetallicRoughness.metallicRoughnessTexture.index, material.occlusionTexture.index);
assert.ok(Number.isInteger(material.pbrMetallicRoughness.baseColorTexture.index));
assert.ok(Number.isInteger(material.normalTexture.index));
assert.ok(Number.isInteger(material.emissiveTexture.index));
assert.equal(json.images.length, 4);
for (const image of json.images) {
  const view = json.bufferViews[image.bufferView];
  assert.equal(image.mimeType, "image/png");
  assert.deepEqual([...binary.subarray(view.byteOffset, view.byteOffset + 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
assert.equal(json.asset.extras.procplantsMaterialBinding.contract, "procplants.glb-material-binding");
console.log("ok 1 - UV0-contracted geometry exports deterministic GLB bytes with embedded base/ORM/normal/emissive PNG materials");

const missingContractGeometry = geometry.clone();
delete missingContractGeometry.userData.procplantUv0;
const missingContractMesh = new THREE.Mesh(missingContractGeometry, originalMaterial);
missingContractMesh.name = "missing-contract";
assert.throws(() => prepareProcPlantGlbMaterialBinding({ scene, meshes: [missingContractMesh] }, baked), /missing the explicit/);

const malformedGeometry = geometry.clone();
declareProcPlantGeometryUv0(malformedGeometry);
malformedGeometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0], 2));
const malformedMesh = new THREE.Mesh(malformedGeometry, originalMaterial);
malformedMesh.name = "malformed-uv";
assert.throws(() => prepareProcPlantGlbMaterialBinding({ scene, meshes: [malformedMesh] }, baked), /one UV0 pair per position vertex/);

const noUvGeometry = new THREE.BufferGeometry();
noUvGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
assert.throws(() => declareProcPlantGeometryUv0(noUvGeometry), /geometry\.uv/);
assert.throws(() => prepareProcPlantGlbMaterialBinding(input, baked, { maxVertices: 2 }), /maxVertices/);
const detached = new THREE.Mesh(geometry, originalMaterial);
detached.name = "detached";
assert.throws(() => prepareProcPlantGlbMaterialBinding({ scene, meshes: [detached] }, baked), /not contained in the exported scene/);
const blocked = structuredClone(baked);
blocked.ready = false;
assert.throws(() => prepareProcPlantGlbMaterialBinding(input, blocked), /material bake is not ready/);
console.log("ok 2 - missing, malformed, over-budget, and diagnostically blocked UV/material inputs fail before serialization");

const groupedGraph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "grouped-bark-organ",
  textures: [],
  nodes: [
    { id: "barkColor", kind: "color", value: [0.18, 0.08, 0.03] },
    { id: "barkRough", kind: "scalar", value: 0.9 },
    { id: "organColor", kind: "color", value: [0.04, 0.42, 0.08] },
    { id: "organOpacity", kind: "scalar", value: 0.8 },
    { id: "organRough", kind: "scalar", value: 0.62 },
  ],
  surfaces: [
    { slot: "bark", channels: { baseColor: "barkColor", roughness: "barkRough" } },
    { slot: "organ", channels: { baseColor: "organColor", opacity: "organOpacity", roughness: "organRough" }, alphaMode: "mask", alphaCutoff: 0.4, doubleSided: true },
  ],
};
const groupedBake = bakeProcPlantMaterials(compileProcPlantMaterialGraph(groupedGraph), [], { width: 1, height: 1 });
const groupedGeometry = new THREE.BufferGeometry();
groupedGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
  0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0,
], 3));
groupedGeometry.setAttribute("normal", new THREE.Float32BufferAttribute([
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
], 3));
groupedGeometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
groupedGeometry.setIndex([0, 1, 2, 2, 1, 3]);
groupedGeometry.addGroup(0, 3, 0);
groupedGeometry.addGroup(3, 3, 1);
declareProcPlantGeometryUv0(groupedGeometry);
const groupedPlaceholder = new THREE.MeshStandardMaterial({ color: 0xffffff });
const groupedMesh = new THREE.Mesh(groupedGeometry, groupedPlaceholder);
groupedMesh.name = "grouped-plant";
const groupedScene = new THREE.Scene();
groupedScene.add(groupedMesh);
const groupedInput = { scene: groupedScene, meshes: [groupedMesh] };
const groupedOptions = { groupSlotsByMeshName: { "grouped-plant": ["bark", "organ"] } } as const;
const groupedPrepared = prepareProcPlantGlbMaterialBinding(groupedInput, groupedBake, groupedOptions);
assert.deepEqual(groupedPrepared.assignments.map((assignment) => ({
  groupIndex: assignment.groupIndex,
  primitiveIndex: assignment.primitiveIndex,
  materialIndex: assignment.materialIndex,
  start: assignment.start,
  count: assignment.count,
  slot: assignment.slot,
})), [
  { groupIndex: 0, primitiveIndex: 0, materialIndex: 0, start: 0, count: 3, slot: "bark" },
  { groupIndex: 1, primitiveIndex: 1, materialIndex: 1, start: 3, count: 3, slot: "organ" },
]);
const groupedA = await exportProcPlantGlbWithBakedMaterials(groupedInput, groupedBake, groupedOptions);
const groupedB = await exportProcPlantGlbWithBakedMaterials(groupedInput, groupedBake, groupedOptions);
assert.deepEqual(new Uint8Array(groupedA.bytes), new Uint8Array(groupedB.bytes));
assert.equal(groupedMesh.material, groupedPlaceholder, "group export must not replace the source mesh material");
assert.equal(groupedGeometry.groups.length, 2, "group export must not mutate source geometry groups");
const groupedJson = parseGlb(groupedA.bytes).json;
const groupedNode = groupedJson.nodes.find((entry: { name?: string }) => entry.name === "grouped-plant");
const groupedPrimitives = groupedJson.meshes[groupedNode.mesh].primitives;
assert.equal(groupedPrimitives.length, 2);
assert.deepEqual(groupedPrimitives.map((entry: { indices: number }) => groupedJson.accessors[entry.indices].count), [3, 3]);
assert.deepEqual(groupedPrimitives.map((entry: { material: number }) => groupedJson.materials[entry.material].name), ["bark", "organ"]);
assert.ok(groupedPrimitives.every((entry: { attributes: { TEXCOORD_0?: number } }) => Number.isInteger(entry.attributes.TEXCOORD_0)));

const priorCreateImageBitmap = globalThis.createImageBitmap;
const priorSelf = (globalThis as { self?: typeof globalThis }).self;
Object.defineProperty(globalThis, "self", { configurable: true, writable: true, value: globalThis });
Object.defineProperty(globalThis, "createImageBitmap", {
  configurable: true,
  writable: true,
  value: async () => ({ width: 1, height: 1, close() {} }) as ImageBitmap,
});
try {
  const loaded = await new GLTFLoader().parseAsync(groupedA.bytes, "");
  const materialNames: string[] = [];
  loaded.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    assert.ok(object.geometry.getAttribute("uv"), "GLTFLoader must preserve UV0 on every loaded primitive");
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materialNames.push(material.name);
  });
  assert.deepEqual(materialNames.sort(), ["bark", "organ"]);
} finally {
  if (priorCreateImageBitmap) Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, writable: true, value: priorCreateImageBitmap });
  else delete (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (priorSelf) Object.defineProperty(globalThis, "self", { configurable: true, writable: true, value: priorSelf });
  else delete (globalThis as { self?: typeof globalThis }).self;
}
console.log("ok 3 - contiguous bark/organ geometry groups map deterministically to separate GLB primitives and GLTFLoader materials");

assert.throws(() => prepareProcPlantGlbMaterialBinding(groupedInput, groupedBake), /requires an explicit valid procplant material slot/);
assert.throws(() => prepareProcPlantGlbMaterialBinding(groupedInput, groupedBake, {
  slotByMeshName: { "grouped-plant": "bark" },
  groupSlotsByMeshName: { "grouped-plant": ["bark", "organ"] },
}), /must not mix whole-mesh and group/);
const invalidGroups = (groups: Array<{ start: number; count: number; materialIndex: number }>, slots: readonly string[], pattern: RegExp) => {
  const invalidGeometry = groupedGeometry.clone();
  invalidGeometry.clearGroups();
  for (const group of groups) invalidGeometry.addGroup(group.start, group.count, group.materialIndex);
  const invalidMesh = new THREE.Mesh(invalidGeometry, groupedPlaceholder);
  invalidMesh.name = "invalid-groups";
  const invalidScene = new THREE.Scene();
  invalidScene.add(invalidMesh);
  assert.throws(() => prepareProcPlantGlbMaterialBinding(
    { scene: invalidScene, meshes: [invalidMesh] },
    groupedBake,
    { groupSlotsByMeshName: { "invalid-groups": slots } },
  ), pattern);
  invalidGeometry.dispose();
};
invalidGroups([{ start: 0, count: 3, materialIndex: 0 }], ["bark"], /cover every geometry element/);
invalidGroups([{ start: 0, count: 6, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }], ["bark", "organ"], /contiguous, non-overlapping/);
invalidGroups([{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 2 }], ["bark", "organ", "organ"], /dense and exactly covered/);
invalidGroups([{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }], ["bark"], /explicit valid baked slot/);
console.log("ok 4 - grouped binding rejects guessed slots, mixed modes, gaps, overlaps, sparse IDs, and incomplete mappings");

geometry.dispose();
missingContractGeometry.dispose();
malformedGeometry.dispose();
noUvGeometry.dispose();
originalMaterial.dispose();
groupedGeometry.dispose();
groupedPlaceholder.dispose();
console.log("1..4");
