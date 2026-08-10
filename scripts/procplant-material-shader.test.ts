import assert from "node:assert/strict";
import * as THREE from "three";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";
import {
  compileProcPlantMaterialShaderPlan,
  validateProcPlantMaterialShaderPlan,
} from "../src/procplant-material-shader";
import {
  createProcPlantThreeMaterialShaderResources,
  installProcPlantThreeMaterialShader,
} from "../src/procplant-three-material-shader";
import { createProcPlantWindUniforms, installProcPlantWindShader } from "../src/procplant-wind";

const graph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "shader-fixture",
  textures: [
    { id: "albedo", uri: "albedo.png", mimeType: "image/png", role: "color", colorSpace: "srgb", scale: [2, 3], offset: [0.1, -0.2], rotation: 0.25, wrapS: "mirror", wrapT: "clamp" },
    { id: "normal", uri: "normal.png", mimeType: "image/png", role: "normal", colorSpace: "linear" },
  ],
  nodes: [
    { id: "zero", kind: "scalar", value: 0 },
    { id: "one", kind: "scalar", value: 1 },
    { id: "noise", kind: "noise", noise: "ridge", seed: 77, scale: 4, octaves: 3, lacunarity: 2, gain: 0.5 },
    { id: "remap", kind: "remap", input: "noise", inMin: 0, inMax: 1, outMin: 0.15, outMax: 0.85 },
    { id: "clamped", kind: "clamp", input: "remap", min: 0.2, max: 0.8 },
    { id: "inverse", kind: "one-minus", input: "clamped" },
    { id: "rough", kind: "multiply", a: "clamped", b: "inverse" },
    { id: "green", kind: "color", value: [0.05, 0.8, 0.12] },
    { id: "sample", kind: "texture-sample", texture: "albedo", channel: "rgb" },
    { id: "base", kind: "mix", a: "sample", b: "green", factor: "clamped" },
    { id: "normalSample", kind: "texture-sample", texture: "normal", channel: "normal" },
  ],
  surfaces: [{
    slot: "leaf",
    channels: { baseColor: "base", roughness: "rough", metalness: "zero", opacity: "one", ambientOcclusion: "inverse", emissive: "green", normal: "normalSample" },
    doubleSided: true,
  }],
};
const compiled = compileProcPlantMaterialGraph(graph);
const planA = compileProcPlantMaterialShaderPlan(compiled);
const planB = compileProcPlantMaterialShaderPlan(compiled);
assert.deepEqual(planA, planB);
assert.equal(planA.ready, true);
assert.match(planA.contentHash, /^fnv1a32:[0-9a-f]{8}$/);
assert.equal(planA.textures.length, 1, "delegated normal input must not allocate a custom sampler");
assert.equal(planA.textures[0]!.id, "albedo");
assert.equal(planA.surfaces[0]!.textureIds[0], "albedo");
assert.match(planA.surfaces[0]!.fragmentPrelude, /ppValueNoise/);
assert.match(planA.surfaces[0]!.fragmentPrelude, /ppSrgbToLinear/);
assert.match(planA.surfaces[0]!.fragmentPrelude, /procplantTexture_0/);
assert.match(planA.surfaces[0]!.fragmentPrelude, /1\.0 - abs/);
assert.ok(planA.diagnostics.some((diagnostic) => diagnostic.code === "delegated-normal" && !diagnostic.blocking));
assert.equal(validateProcPlantMaterialShaderPlan(planA), planA);
const mutated = structuredClone(planA);
mutated.surfaces[0]!.fragmentPrelude += "\n// mutation";
assert.throws(() => validateProcPlantMaterialShaderPlan(mutated), /contentHash mismatch/);

const uv1Graph = structuredClone(graph);
uv1Graph.textures[0]!.uvSet = 1;
const uv1Plan = compileProcPlantMaterialShaderPlan(compileProcPlantMaterialGraph(uv1Graph));
assert.equal(uv1Plan.ready, false);
assert.ok(uv1Plan.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-uv-set" && diagnostic.blocking));
const channelGraph = structuredClone(graph);
channelGraph.surfaces[0]!.channels.height = "noise";
const channelPlan = compileProcPlantMaterialShaderPlan(compileProcPlantMaterialGraph(channelGraph));
assert.equal(channelPlan.ready, false);
assert.ok(channelPlan.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-channel"));
const implicitAlphaGraph = structuredClone(graph);
(implicitAlphaGraph.nodes.find((node) => node.id === "green") as { value: number[] }).value = [0.05, 0.8, 0.12, 0.5];
delete implicitAlphaGraph.surfaces[0]!.channels.opacity;
const implicitAlphaPlan = compileProcPlantMaterialShaderPlan(compileProcPlantMaterialGraph(implicitAlphaGraph));
assert.equal(implicitAlphaPlan.ready, false);
assert.ok(implicitAlphaPlan.diagnostics.some((diagnostic) => /non-opaque color alpha/.test(diagnostic.message)));
assert.equal(compileProcPlantMaterialShaderPlan(compiled, { maxOperations: 2 }).ready, false);
assert.equal(compileProcPlantMaterialShaderPlan(compiled, { maxNoiseOctaves: 2 }).ready, false);
console.log("ok 1 - generated shader plan is deterministic, bounded, versioned, and fails closed on unsupported semantics");

const rgba = new Uint8Array(4 * 4 * 4);
for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([80, 170, 40, 255], offset);
const resources = createProcPlantThreeMaterialShaderResources(planA, [{ textureId: "albedo", width: 4, height: 4, rgba }]);
assert.equal(resources.ownedBytes, rgba.byteLength);
assert.notStrictEqual((resources.textures[0]!.image as { data: Uint8Array }).data, rgba);
assert.equal(resources.textures[0]!.colorSpace, THREE.NoColorSpace, "explicit GLSL sRGB decoding must not be duplicated by the renderer");
assert.equal(resources.textures[0]!.userData.procplantGeneratedShader.sourceColorSpace, "srgb");
const wind = createProcPlantWindUniforms();
const material = installProcPlantWindShader(new THREE.MeshStandardMaterial({ vertexColors: true }), wind);
const windCompile = material.onBeforeCompile;
const installation = installProcPlantThreeMaterialShader(material, planA, "leaf", resources);
assert.match(installation.cacheKey, /procplant-wind-v1/);
assert.ok(installation.cacheKey.includes(planA.contentHash));
assert.equal(material.customProgramCacheKey(), installation.cacheKey);
assert.equal(material.userData.procplantGeneratedShader.delegatedNormal, true);
const shader = {
  uniforms: {} as Record<string, { value: unknown }>,
  vertexShader: "#include <common>\nvoid main(){\n#include <begin_vertex>\n}",
  fragmentShader: `void main() {
#include <clipping_planes_fragment>
#include <map_fragment>
#include <roughnessmap_fragment>
#include <metalnessmap_fragment>
#include <emissivemap_fragment>
#include <aomap_fragment>
}`,
} as Parameters<THREE.MeshStandardMaterial["onBeforeCompile"]>[0];
material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
assert.match(shader.vertexShader, /procplantWindWave/, "generated shader must preserve the prior wind hook");
assert.match(shader.fragmentShader, /ProcplantMaterialValues/);
assert.match(shader.fragmentShader, /diffuseColor\.rgb = procplantMaterial\.baseColor/);
assert.match(shader.fragmentShader, /roughnessFactor = procplantMaterial\.roughness/);
assert.match(shader.fragmentShader, /procplantAmbientOcclusion/);
assert.strictEqual(shader.uniforms.procplantTexture_0!.value, resources.textures[0]);
assert.strictEqual(shader.uniforms.procplantWindTime, wind.time);
let textureDisposals = 0;
resources.textures[0]!.addEventListener("dispose", () => textureDisposals++);
installation.dispose();
installation.dispose();
assert.equal(installation.disposed, true);
assert.strictEqual(material.onBeforeCompile, windCompile);
assert.equal(material.customProgramCacheKey(), "procplant-wind-v1");
assert.equal(material.userData.procplantGeneratedShader, undefined);
resources.dispose();
resources.dispose();
assert.equal(textureDisposals, 1);
material.dispose();
console.log("ok 2 - Three adapter composes wind/PBR hooks, uses stable cache keys, and restores/disposes owned state once");

assert.throws(() => createProcPlantThreeMaterialShaderResources(planA, []), /explicit RGBA pixels/);
console.log("ok 3 - source texture ownership is explicit and missing live resources fail before renderer mutation");
