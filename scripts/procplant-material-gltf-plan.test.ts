import assert from "node:assert/strict";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";
import { planProcPlantGltfMaterials } from "../src/procplant-material-gltf-plan";

const graph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "gltf-direct",
  textures: [
    { id: "leaf", uri: "leaf.webp", mimeType: "image/webp", role: "color", colorSpace: "srgb", wrapS: "clamp", wrapT: "clamp" },
    { id: "normal", uri: "normal.ktx2", mimeType: "image/ktx2", role: "normal", colorSpace: "linear" },
    { id: "orm", uri: "orm.ktx2", mimeType: "image/ktx2", role: "data", colorSpace: "linear", uvSet: 1, scale: [2, 2] },
    { id: "glow", uri: "glow.webp", mimeType: "image/webp", role: "color", colorSpace: "srgb" },
  ],
  nodes: [
    { id: "tint", kind: "color", value: [0.7, 0.9, 0.6] },
    { id: "leafRgb", kind: "texture-sample", texture: "leaf", channel: "rgb" },
    { id: "base", kind: "multiply", a: "tint", b: "leafRgb" },
    { id: "alpha", kind: "texture-sample", texture: "leaf", channel: "a" },
    { id: "normalSample", kind: "texture-sample", texture: "normal", channel: "normal" },
    { id: "rough", kind: "texture-sample", texture: "orm", channel: "g" },
    { id: "metal", kind: "texture-sample", texture: "orm", channel: "b" },
    { id: "ao", kind: "texture-sample", texture: "orm", channel: "r" },
    { id: "glowRgb", kind: "texture-sample", texture: "glow", channel: "rgb" },
    { id: "glowFactor", kind: "color", value: [0.2, 0.3, 0.1] },
    { id: "emissive", kind: "multiply", a: "glowRgb", b: "glowFactor" },
  ],
  surfaces: [{
    slot: "leaf",
    channels: { baseColor: "base", opacity: "alpha", normal: "normalSample", roughness: "rough", metalness: "metal", ambientOcclusion: "ao", emissive: "emissive" },
    doubleSided: true,
    alphaMode: "mask",
    alphaCutoff: 0.42,
  }],
};

const compiled = compileProcPlantMaterialGraph(graph);
const before = JSON.stringify(compiled);
const plan = planProcPlantGltfMaterials(compiled);
assert.equal(JSON.stringify(compiled), before, "planning must not mutate compiled input");
assert.equal(plan.ready, true);
assert.deepEqual(plan.extensionsUsed, ["KHR_texture_transform"]);
const leaf = plan.materials[0]!;
assert.deepEqual(leaf.pbrMetallicRoughness.baseColorFactor, [0.7, 0.9, 0.6, 1]);
assert.equal(leaf.pbrMetallicRoughness.baseColorTexture?.textureId, "leaf");
assert.deepEqual(leaf.pbrMetallicRoughness.metallicRoughnessTexture?.channels, ["g", "b"]);
assert.equal(leaf.pbrMetallicRoughness.metallicRoughnessTexture?.texCoord, 1);
assert.equal(leaf.pbrMetallicRoughness.metallicRoughnessTexture?.transform?.extension, "KHR_texture_transform");
assert.equal(leaf.occlusionTexture?.textureId, "orm");
assert.equal(leaf.normalTexture?.textureId, "normal");
assert.deepEqual(leaf.emissiveFactor, [0.2, 0.3, 0.1]);
assert.deepEqual(leaf.diagnostics, [{ code: "texture-transform-extension", blocking: false, channel: "roughness", message: "leaf.roughness uses KHR_texture_transform" }, { code: "texture-transform-extension", blocking: false, channel: "ambientOcclusion", message: "leaf.ambientOcclusion uses KHR_texture_transform" }]);
console.log("ok 1 - direct glTF PBR channels, shared ORM packing, alpha, UV set, and texture transforms are planned losslessly");

const blockedGraph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "gltf-blocked",
  textures: [
    { id: "barkData", uri: "bark-data.png", mimeType: "image/png", role: "data", colorSpace: "linear" },
    { id: "leaf", uri: "leaf.png", mimeType: "image/png", role: "color", colorSpace: "srgb" },
  ],
  nodes: [
    { id: "leafRgb", kind: "texture-sample", texture: "leaf", channel: "rgb" },
    { id: "roughR", kind: "texture-sample", texture: "barkData", channel: "r" },
    { id: "noise", kind: "noise", noise: "fbm", seed: 1, scale: 2, octaves: 2 },
    { id: "moss", kind: "scalar", value: 0.5 },
  ],
  surfaces: [{ slot: "bark", channels: { baseColor: "leafRgb", roughness: "roughR", height: "noise", mossMask: "moss" }, alphaMode: "blend" }],
};
const blocked = planProcPlantGltfMaterials(compileProcPlantMaterialGraph(blockedGraph));
assert.equal(blocked.ready, false);
assert.deepEqual(blocked.materials[0]!.diagnostics.map((entry) => entry.code), [
  "requires-bake",
  "opacity-texture-mismatch",
  "requires-channel-pack",
  "unsupported-core-channel",
]);
assert.ok(blocked.materials[0]!.diagnostics.every((entry) => entry.blocking));
console.log("ok 2 - expressions, unpacked channels, implicit alpha, and non-core masks fail closed with explicit bake/pack diagnostics");

const scalarGraph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "gltf-constants",
  textures: [],
  nodes: [
    { id: "color", kind: "color", value: [0.4, 0.5, 0.6, 0.8] },
    { id: "opacity", kind: "scalar", value: 0.5 },
    { id: "rough", kind: "scalar", value: 0.65 },
    { id: "metal", kind: "scalar", value: 0 },
    { id: "ao", kind: "scalar", value: 1 },
  ],
  surfaces: [{ slot: "petal", channels: { baseColor: "color", opacity: "opacity", roughness: "rough", metalness: "metal", ambientOcclusion: "ao" }, alphaMode: "blend" }],
};
const constants = planProcPlantGltfMaterials(compileProcPlantMaterialGraph(scalarGraph)).materials[0]!;
assert.equal(constants.ready, true);
assert.deepEqual(constants.pbrMetallicRoughness.baseColorFactor, [0.4, 0.5, 0.6, 0.4]);
assert.equal(constants.pbrMetallicRoughness.roughnessFactor, 0.65);
assert.equal(constants.pbrMetallicRoughness.metallicFactor, 0);
assert.equal(constants.occlusionTexture, undefined);
assert.deepEqual(constants.diagnostics, []);
assert.throws(() => planProcPlantGltfMaterials(compileProcPlantMaterialGraph(scalarGraph), { maxMaterials: 0 }), /maxMaterials/);
const malformed = structuredClone(compileProcPlantMaterialGraph(scalarGraph));
malformed.materials = [] as never;
malformed.surfaces[0]!.doubleSided = "yes" as never;
assert.throws(() => planProcPlantGltfMaterials(malformed), /invalid compiled surface settings/);
const hdrGraph = structuredClone(scalarGraph);
hdrGraph.id = "gltf-hdr-requires-bake";
(hdrGraph.nodes.find((node) => node.id === "color") as { value: [number, number, number] }).value = [2, 0.5, 0.25];
const hdrPlan = planProcPlantGltfMaterials(compileProcPlantMaterialGraph(hdrGraph)).materials[0]!;
assert.equal(hdrPlan.ready, false);
assert.match(hdrPlan.diagnostics[0]?.message ?? "", /normalize or bake/);
console.log("ok 3 - constant PBR factors combine deterministically, while out-of-range authoring values require an explicit bake");

const opaqueAlphaGraph = structuredClone(scalarGraph);
opaqueAlphaGraph.id = "gltf-opaque-alpha";
opaqueAlphaGraph.surfaces[0]!.alphaMode = "opaque";
const opaqueAlpha = planProcPlantGltfMaterials(compileProcPlantMaterialGraph(opaqueAlphaGraph)).materials[0]!;
assert.equal(opaqueAlpha.ready, false);
assert.equal(opaqueAlpha.diagnostics.at(-1)?.code, "opaque-alpha-discarded");
assert.match(opaqueAlpha.diagnostics.at(-1)?.message ?? "", /OPAQUE core glTF ignores alpha/);
console.log("ok 4 - opaque materials do not claim lossless export when authored alpha would be discarded");
console.log("1..4");
