import assert from "node:assert/strict";
import * as THREE from "three";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";
import { bakeProcPlantMaterials, type ProcPlantMaterialPixelSource } from "../src/procplant-material-bake";
import {
  createProcPlantThreeBakedMaterials,
  disposeProcPlantThreeBakedMaterials,
  ensureProcPlantThreeMaterialUv2,
} from "../src/procplant-three-material-adapter";

const graph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "three-live-material-fixture",
  textures: [
    { id: "color", uri: "color.png", mimeType: "image/png", role: "color", colorSpace: "srgb" },
    { id: "normal", uri: "normal.png", mimeType: "image/png", role: "normal", colorSpace: "linear" },
    { id: "orm", uri: "orm.png", mimeType: "image/png", role: "data", colorSpace: "linear" },
  ],
  nodes: [
    { id: "base", kind: "texture-sample", texture: "color", channel: "rgb" },
    { id: "opacity", kind: "texture-sample", texture: "color", channel: "a" },
    { id: "normalSample", kind: "texture-sample", texture: "normal", channel: "normal" },
    { id: "ao", kind: "texture-sample", texture: "orm", channel: "r" },
    { id: "rough", kind: "texture-sample", texture: "orm", channel: "g" },
    { id: "metal", kind: "texture-sample", texture: "orm", channel: "b" },
    { id: "emissive", kind: "color", value: [0.25, 0.1, 0.5] },
  ],
  surfaces: [
    { slot: "bark", channels: { baseColor: "base", normal: "normalSample", ambientOcclusion: "ao", roughness: "rough", metalness: "metal", emissive: "emissive" } },
    { slot: "leaf", channels: { baseColor: "base", opacity: "opacity", normal: "normalSample", ambientOcclusion: "ao", roughness: "rough", metalness: "metal", emissive: "emissive" }, alphaMode: "mask", alphaCutoff: 0.37, doubleSided: true },
  ],
};
const sources: ProcPlantMaterialPixelSource[] = [
  { textureId: "color", width: 1, height: 1, rgba: Uint8Array.of(128, 64, 32, 192) },
  { textureId: "normal", width: 1, height: 1, rgba: Uint8Array.of(128, 128, 255, 255) },
  { textureId: "orm", width: 1, height: 1, rgba: Uint8Array.of(51, 102, 153, 255) },
];
const baked = bakeProcPlantMaterials(compileProcPlantMaterialGraph(graph), sources, { width: 2, height: 2 });
const bakedBefore = baked.images.map((image) => [...image.rgba]);
const first = createProcPlantThreeBakedMaterials(baked, { ormUvChannel: 1 });
const second = createProcPlantThreeBakedMaterials(baked, { ormUvChannel: 1 });
assert.deepEqual(first.audit, second.audit, "adapter audit must be deterministic");
assert.deepEqual(baked.images.map((image) => [...image.rgba]), bakedBefore, "adapter must not mutate baked pixels");
assert.notStrictEqual((first.textures[0]!.image as { data: Uint8Array }).data, baked.images[0]!.rgba, "DataTexture must own copied pixels");
assert.notStrictEqual(first.bark, first.organ, "bark and organ require separate material objects");
assert.equal(first.materialsBySlot.get("bark"), first.bark);
assert.equal(first.materialsBySlot.get("leaf"), first.organ);
assert.equal(first.bark.side, THREE.FrontSide);
assert.equal(first.bark.transparent, false);
assert.equal(first.organ.side, THREE.DoubleSide);
assert.equal(first.organ.transparent, false);
assert.equal(first.organ.alphaTest, 0.37);
assert.equal(first.organ.depthWrite, true);

for (const material of [first.bark, first.organ]) {
  assert.ok(material.map);
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.ok(material.emissiveMap);
  assert.equal(material.emissiveMap.colorSpace, THREE.SRGBColorSpace,
    "glTF emissive pixels are sRGB-encoded and Three converts samples to linear");
  assert.ok(material.normalMap);
  assert.equal(material.normalMap.colorSpace, THREE.NoColorSpace);
  assert.ok(material.aoMap);
  assert.strictEqual(material.aoMap, material.roughnessMap, "packed ORM texture must be shared for AO red and roughness green");
  assert.strictEqual(material.aoMap, material.metalnessMap, "packed ORM texture must be shared for AO red and metalness blue");
  assert.equal(material.aoMap.colorSpace, THREE.NoColorSpace);
  assert.equal(material.aoMap.channel, 1);
  const ormImage = material.aoMap.image as { data: Uint8Array };
  assert.deepEqual([...ormImage.data.subarray(0, 4)], [51, 102, 153, 255], "ORM bytes must preserve AO=R, roughness=G, metalness=B");
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
assert.throws(() => ensureProcPlantThreeMaterialUv2(geometry, first.uv), /requires current Three attribute uv1/);
const uvAudit = ensureProcPlantThreeMaterialUv2(geometry, first.uv, { copyUv0: true });
assert.deepEqual(uvAudit, { requiredAttribute: "uv1", source: "copied-uv0", vertices: 3, mutated: true });
assert.notStrictEqual(geometry.getAttribute("uv1"), geometry.getAttribute("uv"));
assert.deepEqual([...geometry.getAttribute("uv1").array], [...geometry.getAttribute("uv").array]);
const legacy = new THREE.BufferGeometry();
legacy.setAttribute("position", geometry.getAttribute("position").clone());
legacy.setAttribute("uv2", geometry.getAttribute("uv").clone());
assert.equal(ensureProcPlantThreeMaterialUv2(legacy, first.uv, { acceptLegacyUv2: true }).source, "legacy-uv2");
assert.strictEqual(legacy.getAttribute("uv1"), legacy.getAttribute("uv2"));

const sharedBake = structuredClone(baked);
const barkMaterial = sharedBake.gltf.materials.find((material) => material.name === "bark")! as Record<string, any>;
const leafMaterial = sharedBake.gltf.materials.find((material) => material.name === "leaf")! as Record<string, any>;
leafMaterial.pbrMetallicRoughness.baseColorTexture.index = barkMaterial.pbrMetallicRoughness.baseColorTexture.index;
leafMaterial.pbrMetallicRoughness.metallicRoughnessTexture.index = barkMaterial.pbrMetallicRoughness.metallicRoughnessTexture.index;
leafMaterial.occlusionTexture.index = barkMaterial.occlusionTexture.index;
leafMaterial.normalTexture.index = barkMaterial.normalTexture.index;
leafMaterial.emissiveTexture.index = barkMaterial.emissiveTexture.index;
const shared = createProcPlantThreeBakedMaterials(sharedBake);
assert.strictEqual(shared.bark.map, shared.organ.map, "materials referencing one baked texture must share one DataTexture");
assert.strictEqual(shared.bark.aoMap, shared.organ.aoMap);
assert.strictEqual(shared.bark.normalMap, shared.organ.normalMap);
assert.strictEqual(shared.bark.emissiveMap, shared.organ.emissiveMap);

const blendedBake = structuredClone(baked);
const blendedLeaf = blendedBake.gltf.materials.find((material) => material.name === "leaf")! as Record<string, any>;
blendedLeaf.alphaMode = "BLEND";
delete blendedLeaf.alphaCutoff;
const blended = createProcPlantThreeBakedMaterials(blendedBake);
assert.equal(blended.organ.transparent, true);
assert.equal(blended.organ.depthWrite, false);
assert.equal(blended.organ.alphaTest, 0);

let materialDisposals = 0;
let textureDisposals = 0;
first.bark.addEventListener("dispose", () => materialDisposals++);
first.organ.addEventListener("dispose", () => materialDisposals++);
for (const texture of first.textures) texture.addEventListener("dispose", () => textureDisposals++);
disposeProcPlantThreeBakedMaterials(first);
disposeProcPlantThreeBakedMaterials(first);
assert.equal(materialDisposals, 2, "owned materials must dispose exactly once");
assert.equal(textureDisposals, first.textures.length, "owned textures must dispose exactly once");
disposeProcPlantThreeBakedMaterials(second);
disposeProcPlantThreeBakedMaterials(shared);
disposeProcPlantThreeBakedMaterials(blended);
geometry.dispose();
legacy.dispose();

const notReady = structuredClone(baked);
notReady.ready = false;
assert.throws(() => createProcPlantThreeBakedMaterials(notReady), /requires a ready bake/);
assert.throws(() => createProcPlantThreeBakedMaterials(baked, { maxImages: 1 }), /exceeds maxImages/);
assert.throws(() => createProcPlantThreeBakedMaterials(baked, { maxTextureBytes: 1 }), /exceeds maxTextureBytes/);
const badPixels = structuredClone(baked);
badPixels.images[0]!.rgba = new Uint8Array(3);
assert.throws(() => createProcPlantThreeBakedMaterials(badPixels), /width \* height \* 4/);
const badColorSpace = structuredClone(baked);
badColorSpace.images.find((image) => image.usage === "normal")!.colorSpace = "srgb";
assert.throws(() => createProcPlantThreeBakedMaterials(badColorSpace), /invalid colorSpace/);
const badOrm = structuredClone(baked);
const badBark = badOrm.gltf.materials.find((material) => material.name === "bark")! as Record<string, any>;
badBark.occlusionTexture.index = badBark.pbrMetallicRoughness.baseColorTexture.index;
assert.throws(() => createProcPlantThreeBakedMaterials(badOrm), /one packed ORM texture/);
assert.throws(() => createProcPlantThreeBakedMaterials(baked, { barkSlot: "missing" }), /require slots/);

console.log(`procplant Three material adapter tests passed (${first.textures.length} owned textures; audit ${first.audit.auditHash})`);
