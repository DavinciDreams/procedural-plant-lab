import assert from "node:assert/strict";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";

const graph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "forest-materials",
  textures: [
    { id: "barkColor", uri: "textures/bark-color.webp", mimeType: "image/webp", role: "color", colorSpace: "srgb", width: 1024, height: 1024, byteLength: 240_000 },
    { id: "barkNormal", uri: "textures/bark-normal.ktx2", mimeType: "image/ktx2", role: "normal", colorSpace: "linear", width: 1024, height: 1024, byteLength: 310_000 },
    { id: "barkData", uri: "textures/bark-data.png", mimeType: "image/png", role: "data", colorSpace: "linear", width: 1024, height: 1024, byteLength: 180_000, uvSet: 1 },
    { id: "leafColor", uri: "textures/leaf.png", mimeType: "image/png", role: "color", colorSpace: "srgb", width: 512, height: 512, byteLength: 90_000, wrapS: "clamp", wrapT: "clamp" },
  ],
  nodes: [
    { id: "barkTint", kind: "color", value: [0.72, 0.63, 0.5] },
    { id: "barkColorSample", kind: "texture-sample", texture: "barkColor", channel: "rgb" },
    { id: "barkBase", kind: "multiply", a: "barkTint", b: "barkColorSample" },
    { id: "barkNormalSample", kind: "texture-sample", texture: "barkNormal", channel: "normal" },
    { id: "barkRoughness", kind: "texture-sample", texture: "barkData", channel: "r" },
    { id: "mossNoise", kind: "noise", noise: "ridge", seed: 91, scale: 2.5, octaves: 4 },
    { id: "mossMask", kind: "clamp", input: "mossNoise", min: 0.1, max: 0.8 },
    { id: "wetness", kind: "scalar", value: 0.15 },
    { id: "leafTint", kind: "color", value: [0.8, 1, 0.72, 1] },
    { id: "leafColorSample", kind: "texture-sample", texture: "leafColor", channel: "rgb" },
    { id: "leafBase", kind: "multiply", a: "leafColorSample", b: "leafTint" },
    { id: "leafOpacity", kind: "texture-sample", texture: "leafColor", channel: "a" },
    { id: "unusedScalar", kind: "scalar", value: 99 },
  ],
  surfaces: [
    {
      slot: "bark",
      channels: {
        baseColor: "barkBase",
        normal: "barkNormalSample",
        roughness: "barkRoughness",
        mossMask: "mossMask",
        wetnessMask: "wetness",
      },
    },
    {
      slot: "leaf",
      channels: { baseColor: "leafBase", opacity: "leafOpacity" },
      doubleSided: true,
      alphaMode: "mask",
      alphaCutoff: 0.38,
    },
  ],
  metadata: { biome: "temperate", authored: true, revision: 2 },
};

const sourceBefore = JSON.stringify(graph);
const compiled = compileProcPlantMaterialGraph(graph);
assert.equal(JSON.stringify(graph), sourceBefore, "compilation must not mutate the authoring graph");
assert.equal(compiled.contract, "procplants.compiled-material-graph");
assert.match(compiled.contentHash, /^fnv1a32:[0-9a-f]{8}$/);
assert.deepEqual(compiled.surfaces.map((surface) => surface.slot), ["bark", "leaf"]);
assert.ok(!compiled.nodes.some((node) => node.id === "unusedScalar"));
assert.deepEqual(compiled.diagnostics, ["unused node omitted: unusedScalar"]);
assert.equal(compiled.requirements.textureCount, 4);
assert.equal(compiled.requirements.estimatedTextureBytes, 820_000);
assert.equal(compiled.requirements.expressionBakeCount, 1);
assert.equal(compiled.requirements.usesProceduralNoise, true);
assert.equal(compiled.requirements.usesUv1, true);

const bark = compiled.surfaces.find((surface) => surface.slot === "bark")!;
assert.deepEqual(bark.bindings.baseColor, {
  kind: "factor-texture",
  valueType: "color",
  factor: [0.72, 0.63, 0.5],
  texture: compiled.textures.findIndex((texture) => texture.id === "barkColor"),
  channel: "rgb",
});
assert.equal(bark.bindings.normal?.kind, "texture");
assert.equal(bark.bindings.roughness?.kind, "texture");
assert.deepEqual(bark.bindings.wetnessMask, { kind: "constant", valueType: "scalar", value: 0.15 });
assert.deepEqual(bark.bindings.mossMask, {
  kind: "expression",
  valueType: "scalar",
  node: bark.channels.mossMask,
  requiresBake: true,
});
const leaf = compiled.surfaces.find((surface) => surface.slot === "leaf")!;
assert.equal(leaf.doubleSided, true);
assert.equal(leaf.alphaMode, "mask");
assert.equal(leaf.alphaCutoff, 0.38);
assert.equal(leaf.bindings.baseColor?.kind, "factor-texture");
assert.equal(leaf.bindings.opacity?.kind, "texture");
console.log("ok 1 - material graph compiles bark/leaf PBR channels into portable constant, texture, and bake plans");

const reordered: ProcPlantMaterialGraph = {
  ...graph,
  textures: [...graph.textures].reverse(),
  nodes: [...graph.nodes].reverse(),
  surfaces: [...graph.surfaces].reverse(),
  metadata: { revision: 2, authored: true, biome: "temperate" },
};
assert.deepEqual(compileProcPlantMaterialGraph(reordered), compiled, "declaration order must not change compiled output");

const constants: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "constant-fold",
  textures: [],
  nodes: [
    { id: "a", kind: "scalar", value: 0.25 },
    { id: "b", kind: "scalar", value: 2 },
    { id: "product", kind: "multiply", a: "a", b: "b" },
    { id: "rough", kind: "remap", input: "product", inMin: 0, inMax: 1, outMin: 0.2, outMax: 1 },
  ],
  surfaces: [{ slot: "bark", channels: { roughness: "rough" } }],
};
assert.deepEqual(compileProcPlantMaterialGraph(constants).surfaces[0]?.bindings.roughness, {
  kind: "constant",
  valueType: "scalar",
  value: 0.6000000000000001,
});
console.log("ok 2 - compiler output and hashes are deterministic and constant expression chains fold eagerly");

const colorPromotion: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "constant-color-promotion",
  textures: [],
  nodes: [
    { id: "rgb", kind: "color", value: [0.5, 0.25, 1] },
    { id: "rgba", kind: "color", value: [0.2, 0.4, 0.5, 0.3] },
    { id: "forward", kind: "multiply", a: "rgb", b: "rgba" },
    { id: "reverse", kind: "multiply", a: "rgba", b: "rgb" },
  ],
  surfaces: [
    { slot: "forward", channels: { baseColor: "forward" }, alphaMode: "blend" },
    { slot: "reverse", channels: { baseColor: "reverse" }, alphaMode: "blend" },
  ],
};
const promoted = compileProcPlantMaterialGraph(colorPromotion);
assert.deepEqual(promoted.surfaces[0]?.bindings.baseColor, {
  kind: "constant", valueType: "color", value: [0.1, 0.1, 0.5, 0.3],
});
assert.deepEqual(promoted.surfaces[1]?.bindings.baseColor, promoted.surfaces[0]?.bindings.baseColor,
  "RGB/RGBA constant multiplication must promote RGB alpha to one independent of operand order");
console.log("ok 3 - RGB and RGBA constants promote consistently without dropping authored alpha");

const expectGraphError = (mutate: (draft: ProcPlantMaterialGraph) => void, pattern: RegExp, options = {}) => {
  const draft = structuredClone(graph);
  mutate(draft);
  assert.throws(() => compileProcPlantMaterialGraph(draft, options), pattern);
};
expectGraphError((draft) => {
  draft.nodes = [
    { id: "a", kind: "one-minus", input: "b" },
    { id: "b", kind: "one-minus", input: "a" },
  ];
  draft.surfaces = [{ slot: "bark", channels: { roughness: "a" } }];
}, /material graph cycle/);
expectGraphError((draft) => { draft.surfaces[0]!.channels.roughness = "barkBase"; }, /requires scalar.*produces color/);
expectGraphError((draft) => { (draft.nodes.find((node) => node.id === "barkBase") as { a: string }).a = "missing"; }, /references missing node/);
expectGraphError((draft) => { draft.textures[0]!.uri = "data:image/png;base64,AAAA"; }, /disallowed scheme/);
expectGraphError((draft) => { draft.textures[1]!.colorSpace = "srgb"; }, /normal textures must use linear/);
expectGraphError((draft) => { draft.surfaces[1]!.alphaCutoff = 2; }, /must be in \[0, 1\]/);
expectGraphError((draft) => { draft.surfaces[0]!.doubleSided = "yes" as never; }, /doubleSided must be boolean/);
expectGraphError((draft) => { draft.metadata = { nested: {} as never }; }, /must be string, number, boolean, or null/);
expectGraphError(() => {}, /unused material nodes/, { rejectUnused: true });
expectGraphError(() => {}, /exceeds maxNodes/, { maxNodes: 1 });
expectGraphError(() => {}, /exceeds maxTextures/, { maxTextures: 1 });
expectGraphError(() => {}, /exceeds maxTextureBytes/, { maxTextureBytes: 10 });
console.log("ok 4 - graph cycles, type errors, unsafe textures, unused nodes, and resource caps fail closed");
console.log("1..4");
