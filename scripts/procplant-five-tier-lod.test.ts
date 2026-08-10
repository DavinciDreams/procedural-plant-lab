import assert from "node:assert/strict";
import {
  bindProcPlantFiveTierAtlas,
  compileProcPlantFiveTierLods,
  exportProcPlantFiveTierLodGlb,
  hashProcPlantFiveTierTemplate,
  PROCPLANT_FIVE_TIER_LOD_VERSION,
  selectProcPlantFiveTierLod,
  validateProcPlantFiveTierLodPackage,
  validateProcPlantFiveTierLodSelectionContract,
} from "../src/procplant-five-tier-lod";
import { validateProcPlantGlb } from "../src/procplant-glb-validation";
import {
  buildProcPlantImpostorAtlas,
  createProcPlantImpostorCapturePlan,
} from "../src/procplant-impostor";
import {
  buildProcPlantRuntimePackage,
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantPresets,
} from "../src/procplants";

const genome = procPlantPresets.phiFern!;
const seed = 612072;
const environment = defaultPlantEnvironment();
const legacyBefore = compileProcPlantLods(genome, seed, environment);
const plan = createProcPlantImpostorCapturePlan({
  min: { x: -0.7, y: 0, z: -0.7 },
  max: { x: 0.7, y: 1.8, z: 0.7 },
}, { width: 16, height: 16, azimuthCount: 4, elevations: [0, Math.PI / 6] });
const atlas = await buildProcPlantImpostorAtlas(plan, async ({ view, width, height }) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const inside = Math.abs(x - width / 2) + Math.abs(y - height / 2) < width * 0.7;
      rgba.set([
        28 + view.azimuthIndex * 21,
        126 + view.elevationIndex * 45,
        54 + ((x + y) % 3) * 18,
        inside ? 255 : 0,
      ], offset);
    }
  }
  return { id: view.id, width, height, rgba };
}, { padding: 2, powerOfTwo: true, maxSize: 256 });

assert.throws(
  () => compileProcPlantFiveTierLods(genome, seed, environment),
  /explicit bakedAtlas binding/,
  "the five-tier opt-in must never synthesize a fake baked billboard",
);

const binding = bindProcPlantFiveTierAtlas(atlas, genome, seed, environment);
const packageA = compileProcPlantFiveTierLods(genome, seed, environment, { bakedAtlas: binding });
const packageB = compileProcPlantFiveTierLods(genome, seed, environment, { bakedAtlas: binding });
assert.equal(packageA.lodSelection.version, PROCPLANT_FIVE_TIER_LOD_VERSION);
assert.deepEqual(packageA.lods.map((lod) => lod.level), [0, 1, 2, 3, 4]);
assert.deepEqual(packageA.lods.map((lod) => lod.label), [
  "full", "rebuilt-reduced", "clumped-cross", "tree-impostor-cross", "baked-billboard",
]);
assert.deepEqual(packageA.lods.map((lod) => lod.representation), [
  "procedural-mesh", "procedural-mesh", "procedural-cross-card", "baked-atlas-cross", "baked-atlas-billboard",
]);
assert.deepEqual(packageA.lods.map((lod) => lod.triangles), [352, 264, 4, 4, 2]);
assert.deepEqual(packageA.lods.map((lod) => lod.vertices), [704, 528, 8, 8, 4]);
assert.deepEqual(
  packageA.lods.map((lod) => lod.templateContentHash),
  packageB.lods.map((lod) => lod.templateContentHash),
  "all five template hashes must be deterministic",
);
// Indexed-frond revision. The previous expanded hashes were eea44b90,
// 0484d1e5, and b74db5e0 for LOD0-2; triangle-position parity is frozen by
// test:conifer-fern-budget while this fixture records the intentional packing.
assert.deepEqual(packageA.lods.map((lod) => lod.templateContentHash), [
  "fnv1a32-add017a3",
  "fnv1a32-eda0c53e",
  "fnv1a32-d58ce000",
  "fnv1a32-c8f7b108",
  "fnv1a32-492999c5",
], "Phi Fern five-tier geometry hashes must remain fixture-stable");
assert.equal(atlas.contentHash, "fnv1a32-f908e9f6", "fixture atlas hash must remain stable");
assert.equal(packageA.impostor.viewCoverage, "hemisphere");
assert.equal(packageA.impostor.viewCount, 8);
assert.strictEqual(validateProcPlantFiveTierLodPackage(packageA), packageA);
assert.strictEqual(validateProcPlantFiveTierLodSelectionContract(packageA.lodSelection), packageA.lodSelection);
assert.throws(() => validateProcPlantFiveTierLodPackage({
  ...packageA,
  lods: packageA.lods.map((lod, level) => level === 4 ? { ...lod, triangles: 4 } : lod),
}), /inconsistent/);

const legacyAfter = compileProcPlantLods(genome, seed, environment);
assert.deepEqual(
  legacyAfter.map((lod) => hashProcPlantFiveTierTemplate(lod.template)),
  legacyBefore.map((lod) => hashProcPlantFiveTierTemplate(lod.template)),
  "opting into five tiers must not mutate canonical four-tier templates",
);
assert.deepEqual(
  packageA.lods.slice(0, 3).map((lod) => lod.templateContentHash),
  legacyBefore.slice(0, 3).map((lod) => hashProcPlantFiveTierTemplate(lod.template)),
  "LOD0-2 must reuse the exact established template bytes",
);
const defaultRuntime = buildProcPlantRuntimePackage(genome, seed, environment);
assert.equal(defaultRuntime.lodSelection.version, 1);
assert.deepEqual(defaultRuntime.lods.map((lod) => lod.level), [0, 1, 2, 3]);

assert.equal(selectProcPlantFiveTierLod(packageA.lodSelection, {
  distance: packageA.lods[4]!.distance + 1,
}).level, 4);
assert.equal(selectProcPlantFiveTierLod(packageA.lodSelection, {
  distance: 0,
  projectedScreenHeight: 0.008,
}).level, 4);
assert.equal(selectProcPlantFiveTierLod(packageA.lodSelection, {
  distance: packageA.lods[4]!.distance * 1.04,
  previousTierId: packageA.lods[3]!.id,
}).level, 3, "LOD4 coarsening must respect hysteresis");
assert.equal(selectProcPlantFiveTierLod(packageA.lodSelection, {
  distance: packageA.lods[4]!.distance * 1.2,
  previousTierId: packageA.lods[3]!.id,
}).level, 4);

assert.throws(() => compileProcPlantFiveTierLods(genome, seed, environment, {
  bakedAtlas: { ...binding, seed: seed + 1 },
}), /does not match/);
assert.throws(() => compileProcPlantFiveTierLods(genome, seed, environment, {
  bakedAtlas: { ...binding, sourceLod0ContentHash: "fnv1a32-deadbeef" },
}), /stale/);
assert.throws(() => compileProcPlantFiveTierLods(genome, seed, environment, {
  bakedAtlas: { ...binding, atlasContentHash: "fnv1a32-deadbeef" },
}), /content hash is stale/);
assert.throws(() => compileProcPlantFiveTierLods(genome, seed, environment, {
  bakedAtlas: binding,
  maxAtlasSize: 16,
}), /resource ceiling/);

const glbA = await exportProcPlantFiveTierLodGlb(packageA, { name: "phi-fern-lod5" });
const glbB = await exportProcPlantFiveTierLodGlb(packageA, { name: "phi-fern-lod5" });
assert.deepEqual(new Uint8Array(glbA), new Uint8Array(glbB), "five-tier GLB bytes must be deterministic");
const validation = await validateProcPlantGlb(glbA);
assert.equal(validation.valid, true);
assert.equal(validation.meshes, 5);
assert.equal(validation.primitives, 5);
const view = new DataView(glbA);
assert.equal(view.getUint32(0, true), 0x46546c67);
const jsonLength = view.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glbA, 20, jsonLength)).trim()) as {
  scene?: number;
  scenes: Array<{ nodes?: number[] }>;
  nodes: Array<{ name?: string; extras?: { procplantFiveTierLod?: { level?: number; representation?: string } } }>;
  images?: unknown[];
  extensionsUsed?: string[];
  extras?: { procplantFiveTierLod?: { lodSelection?: { version?: number }; selection?: string; scenes?: unknown[] } };
};
assert.equal(json.extras?.procplantFiveTierLod?.lodSelection?.version, 2);
assert.equal(json.extras?.procplantFiveTierLod?.selection, "select-gltf-scene");
assert.equal(json.scene, 0);
assert.equal(json.scenes.length, 5);
assert.deepEqual(json.scenes.map((scene) => scene.nodes), [[0], [1], [2], [3], [4]]);
assert.deepEqual(json.nodes.map((node) => node.extras?.procplantFiveTierLod?.level), [0, 1, 2, 3, 4]);
assert.equal(json.nodes[3]?.extras?.procplantFiveTierLod?.representation, "baked-atlas-cross");
assert.equal(json.nodes[4]?.extras?.procplantFiveTierLod?.representation, "baked-atlas-billboard");
assert.ok((json.images?.length ?? 0) >= 1, "five-tier GLB must embed the real baked atlas image");
assert.equal(json.extensionsUsed?.some((extension) => /lod/i.test(extension)) ?? false, false,
  "five-tier metadata must not advertise a nonexistent Khronos LOD extension");

console.log(JSON.stringify({
  atlas: { hash: atlas.contentHash, width: atlas.width, height: atlas.height, views: atlas.entries.length },
  costs: packageA.lods.map(({ level, triangles, vertices, templateContentHash }) => ({ level, triangles, vertices, templateContentHash })),
  glbBytes: glbA.byteLength,
  glbHash: validation.contentHash,
}));
console.log("procplant five-tier LOD contract tests passed");
