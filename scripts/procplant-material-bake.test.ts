import assert from "node:assert/strict";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";
import { bakeProcPlantMaterials, type ProcPlantMaterialPixelSource } from "../src/procplant-material-bake";

const directGraph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "baked-leaf",
  textures: [
    { id: "leaf", uri: "leaf.png", mimeType: "image/png", role: "color", colorSpace: "srgb" },
    { id: "normal", uri: "normal.png", mimeType: "image/png", role: "normal", colorSpace: "linear" },
    { id: "orm", uri: "orm.png", mimeType: "image/png", role: "data", colorSpace: "linear" },
  ],
  nodes: [
    { id: "leafRgb", kind: "texture-sample", texture: "leaf", channel: "rgb" },
    { id: "tint", kind: "color", value: [0.5, 1, 0.25, 0.5] },
    { id: "base", kind: "multiply", a: "leafRgb", b: "tint" },
    { id: "opacity", kind: "texture-sample", texture: "leaf", channel: "a" },
    { id: "normalSample", kind: "texture-sample", texture: "normal", channel: "normal" },
    { id: "ao", kind: "texture-sample", texture: "orm", channel: "r" },
    { id: "rough", kind: "texture-sample", texture: "orm", channel: "g" },
    { id: "metal", kind: "texture-sample", texture: "orm", channel: "b" },
    { id: "emissive", kind: "color", value: [0.25, 0, 1] },
  ],
  surfaces: [{
    slot: "leaf",
    channels: { baseColor: "base", opacity: "opacity", normal: "normalSample", ambientOcclusion: "ao", roughness: "rough", metalness: "metal", emissive: "emissive" },
    alphaMode: "mask",
    alphaCutoff: 0.4,
    doubleSided: true,
  }],
};

const sources: ProcPlantMaterialPixelSource[] = [
  { textureId: "leaf", width: 1, height: 1, rgba: Uint8Array.of(128, 64, 255, 128) },
  { textureId: "normal", width: 1, height: 1, rgba: Uint8Array.of(128, 128, 255, 255) },
  { textureId: "orm", width: 1, height: 1, rgba: Uint8Array.of(64, 128, 255, 255) },
];
const compiled = compileProcPlantMaterialGraph(directGraph);
const compiledBefore = JSON.stringify(compiled);
const sourceBefore = sources.map((source) => [...source.rgba]);
const baked = bakeProcPlantMaterials(compiled, sources);
assert.equal(JSON.stringify(compiled), compiledBefore, "baking must not mutate the compiled graph");
assert.deepEqual(sources.map((source) => [...source.rgba]), sourceBefore, "baking must not mutate source pixels");
assert.equal(baked.ready, true);
assert.equal(baked.images.length, 4);
const base = baked.images.find((image) => image.usage === "baseColor")!;
const orm = baked.images.find((image) => image.usage === "metallicRoughnessOcclusion")!;
const normal = baked.images.find((image) => image.usage === "normal")!;
const emissive = baked.images.find((image) => image.usage === "emissive")!;
assert.deepEqual([...base.rgba], [92, 64, 137, 64], "sRGB must decode to linear before tint multiplication and re-encode after");
assert.deepEqual([...orm.rgba], [64, 128, 255, 255], "ORM must pack AO red, roughness green, and metalness blue in linear space");
assert.deepEqual([...normal.rgba], [128, 128, 255, 255]);
assert.deepEqual([...emissive.rgba], [137, 0, 255, 255]);
for (const image of baked.images) assert.deepEqual([...image.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
const gltf = JSON.parse(new TextDecoder().decode(baked.gltfBytes));
assert.equal(gltf.asset.version, "2.0");
assert.match(gltf.images[0].uri, /^data:image\/png;base64,/);
assert.equal(gltf.materials[0].pbrMetallicRoughness.metallicRoughnessTexture.index, orm.textureIndex);
assert.equal(gltf.materials[0].occlusionTexture.index, orm.textureIndex);
assert.equal(gltf.materials[0].alphaMode, "MASK");
assert.equal(gltf.materials[0].alphaCutoff, 0.4);
const reordered = bakeProcPlantMaterials(compiled, [...sources].reverse());
assert.equal(reordered.contentHash, baked.contentHash);
assert.deepEqual(reordered.gltfBytes, baked.gltfBytes);
console.log("ok 1 - direct DAG channels bake to deterministic color-correct PNG and embedded glTF material bytes");

const proceduralGraph = (seed: number): ProcPlantMaterialGraph => ({
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: `procedural-${seed}`,
  textures: [],
  nodes: [
    { id: "noise", kind: "noise", noise: "ridge", seed, scale: 3.25, octaves: 4, lacunarity: 2.1, gain: 0.55 },
    { id: "minimum", kind: "scalar", value: 0.25 },
    { id: "rough", kind: "multiply", a: "noise", b: "minimum" },
    { id: "green", kind: "color", value: [0.08, 0.3, 0.02] },
  ],
  surfaces: [{ slot: "moss", channels: { baseColor: "green", roughness: "rough" } }],
});
const proceduralA = bakeProcPlantMaterials(compileProcPlantMaterialGraph(proceduralGraph(17)), [], { width: 8, height: 8 });
const proceduralB = bakeProcPlantMaterials(compileProcPlantMaterialGraph(proceduralGraph(17)), [], { width: 8, height: 8 });
const proceduralC = bakeProcPlantMaterials(compileProcPlantMaterialGraph(proceduralGraph(18)), [], { width: 8, height: 8 });
assert.deepEqual(proceduralA.gltfBytes, proceduralB.gltfBytes);
assert.notEqual(proceduralA.images.find((image) => image.usage === "metallicRoughnessOcclusion")!.contentHash,
  proceduralC.images.find((image) => image.usage === "metallicRoughnessOcclusion")!.contentHash);
console.log("ok 2 - seeded fBm/ridge/cellular-capable procedural DAG evaluation is byte-deterministic");

const unsupportedGraph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "unsupported-material-semantics",
  textures: [{ id: "heightMap", uri: "height.png", mimeType: "image/png", role: "height", colorSpace: "linear" }],
  nodes: [
    { id: "height", kind: "texture-sample", texture: "heightMap", channel: "r" },
    { id: "moss", kind: "scalar", value: 0.5 },
  ],
  surfaces: [{ slot: "bark", channels: { height: "height", mossMask: "moss" } }],
};
const unsupported = bakeProcPlantMaterials(compileProcPlantMaterialGraph(unsupportedGraph), [], { width: 2, height: 2 });
assert.equal(unsupported.ready, false);
assert.deepEqual(unsupported.diagnostics.map((diagnostic) => diagnostic.channel), ["height", "mossMask"]);
assert.equal((unsupported.gltf.materials[0]!.extras as { procplantsBakeReady: boolean }).procplantsBakeReady, false);
const clippedGraph = proceduralGraph(19);
clippedGraph.id = "out-of-range-material";
clippedGraph.nodes = [{ id: "rough", kind: "scalar", value: 2 }];
clippedGraph.surfaces = [{ slot: "bark", channels: { roughness: "rough" } }];
const clipped = bakeProcPlantMaterials(compileProcPlantMaterialGraph(clippedGraph), [], { width: 1, height: 1 });
assert.equal(clipped.ready, false);
assert.equal(clipped.diagnostics[0]?.code, "out-of-range-clamped");
const opaqueAlphaGraph = proceduralGraph(20);
opaqueAlphaGraph.id = "opaque-alpha-material";
opaqueAlphaGraph.nodes = [
  { id: "color", kind: "color", value: [0.2, 0.4, 0.6, 0.5] },
];
opaqueAlphaGraph.surfaces = [{ slot: "leaf", channels: { baseColor: "color" }, alphaMode: "opaque" }];
const opaqueAlpha = bakeProcPlantMaterials(compileProcPlantMaterialGraph(opaqueAlphaGraph), [], { width: 1, height: 1 });
assert.equal(opaqueAlpha.ready, false);
assert.equal(opaqueAlpha.diagnostics[0]?.code, "opaque-alpha-discarded");
assert.equal((opaqueAlpha.gltf.materials[0]!.extras as { procplantsBakeReady: boolean }).procplantsBakeReady, false);
assert.throws(() => bakeProcPlantMaterials(compiled, sources.filter((source) => source.textureId !== "leaf")), /requires RGBA pixels for texture leaf/);
assert.throws(() => bakeProcPlantMaterials(compiled, sources, { width: 16, height: 16, maxPixels: 32 }), /maxPixels/);
assert.throws(() => bakeProcPlantMaterials(compiled, sources, { width: 16, height: 16, maxEvaluations: 32 }), /maxEvaluations/);
assert.throws(() => bakeProcPlantMaterials(compiled, sources, { maxOutputBytes: 64 }), /maxOutputBytes/);
console.log("ok 3 - unsupported material semantics remain explicit and structural/resource limits fail closed");
console.log("1..3");
