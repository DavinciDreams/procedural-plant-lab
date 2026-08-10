import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildProcPlantInstancedParts,
  buildProcPlantTemplate,
  compileProcPlantLods,
  createProcPlantClumpStagePlan,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";
import { createProcPlantAuthoringGraph } from "../src/procplant-authoring-graph";
import { applyProcPlantGeneratorGraphOperations } from "../src/procplant-generator-graph";
import {
  compileProcPlantProductionDag,
  ProcPlantProductionDagError,
  type ProcPlantClumpPartsStageArtifact,
  type ProcPlantClumpTransformStageArtifact,
} from "../src/procplant-production-dag";

const templateHash = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.uv0, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const footprint = (template: ProcPlantTemplate) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < template.pos.length; index += 3) {
    minX = Math.min(minX, template.pos[index]!);
    maxX = Math.max(maxX, template.pos[index]!);
    minZ = Math.min(minZ, template.pos[index + 2]!);
    maxZ = Math.max(maxZ, template.pos[index + 2]!);
  }
  return [maxX - minX, maxZ - minZ] as const;
};

const matrices = (artifact: ProcPlantClumpTransformStageArtifact | ProcPlantClumpPartsStageArtifact) =>
  artifact.plan.transforms.map((matrix) => [...matrix.elements]);

const seed = 612_072;
const environment = defaultPlantEnvironment();
const genome = procPlantPresets.furGrass!;
const snapshot = structuredClone(genome);
const canonical = createProcPlantAuthoringGraph(genome, seed);
const canonicalBuild = buildProcPlantTemplate(genome, seed, environment);
const canonicalLods = compileProcPlantLods(genome, seed, environment);
const canonicalParts = buildProcPlantInstancedParts(genome, seed, environment);
const expectedFurGrassHashes = [
  "fc2aa243d1f9247bef2e84a4fc705d8b4e44eea6fbde46d7251f7b33e0c2cd2b",
  "01d06ff04a42ddd4018b1dbd8dcd9713777e24074068eccbc2fdd7e8e5449f5b",
  "8e86a2a493787f6f974d0934408e8b3ad31ffa7d7d4e288530803b8bd140d4ca",
  "f71348881d1d97a1279d45a9f21c3dbe125b1396c957ebbb729de8dac2b80b7a",
];
assert.deepEqual(canonicalLods.map((lod) => templateHash(lod.template)), expectedFurGrassHashes);
assert.deepEqual(canonicalLods.map((lod) => lod.triangles), [380, 126, 4, 2]);
assert.deepEqual(canonicalLods.map((lod) => lod.vertices), [1140, 378, 8, 4]);
const canonicalResult = compileProcPlantProductionDag(genome, canonical, environment, { canonicalSeed: seed });
assert.equal(canonicalResult.path, "legacy-canonical");
assert.equal(templateHash(canonicalResult.build.template), templateHash(canonicalBuild.template));
assert.deepEqual(canonicalResult.lods.map((lod) => templateHash(lod.template)), canonicalLods.map((lod) => templateHash(lod.template)));
assert.deepEqual(genome, snapshot);

const stages = new Map(canonical.nodes.map((node) => [node.stage, node]));
const seeded = applyProcPlantGeneratorGraphOperations(canonical, [
  { op: "set-seed", nodeId: stages.get("architecture")!.id, value: seed },
  { op: "set-seed", nodeId: stages.get("foliage")!.id, value: seed },
]);
const typed = compileProcPlantProductionDag(genome, seeded, environment, { canonicalSeed: seed });
assert.equal(typed.path, "typed-artifacts");
assert.deepEqual(typed.lods.map((lod) => templateHash(lod.template)), canonicalLods.map((lod) => templateHash(lod.template)),
  "explicit legacy-equivalent stage seeds must preserve every canonical clump LOD byte");
assert.equal(templateHash(typed.build.template), templateHash(canonicalLods[0]!.template));
assert.equal(typed.build.stats.triangles, canonicalLods[0]!.triangles);
assert.equal(canonicalParts.instances.length, 190);
assert.deepEqual(Object.fromEntries(canonicalParts.instances.map((instance) => [instance.kind, canonicalParts.instances.filter((entry) => entry.kind === instance.kind).length])), {
  grassBlade: 190,
});

const architectureArtifact = typed.artifacts[stages.get("architecture")!.id];
const foliageArtifact = typed.artifacts[stages.get("foliage")!.id];
assert.equal(architectureArtifact?.kind, "clump-transforms");
assert.equal(foliageArtifact?.kind, "clump-parts");
if (architectureArtifact?.kind !== "clump-transforms" || foliageArtifact?.kind !== "clump-parts") {
  throw new Error("typed clump stage artifacts were not materialized");
}
assert.equal(architectureArtifact.plan.transforms.length, 5);
assert.equal(foliageArtifact.parts.instances.length, 190);

const architectureChanged = applyProcPlantGeneratorGraphOperations(seeded, [
  { op: "set-seed", nodeId: stages.get("architecture")!.id, value: seed + 1 },
]);
const architectureResult = compileProcPlantProductionDag(genome, architectureChanged, environment, { canonicalSeed: seed });
const changedArchitecture = architectureResult.artifacts[stages.get("architecture")!.id];
assert.equal(changedArchitecture?.kind, "clump-transforms");
if (changedArchitecture?.kind !== "clump-transforms") throw new Error("missing changed clump transform artifact");
assert.deepEqual(changedArchitecture.plan.shootSeeds, architectureArtifact.plan.shootSeeds,
  "placement seed must not perturb independently seeded shoot generation");
assert.notDeepEqual(matrices(changedArchitecture), matrices(architectureArtifact));

const foliageChanged = applyProcPlantGeneratorGraphOperations(seeded, [
  { op: "set-seed", nodeId: stages.get("foliage")!.id, value: seed + 1 },
]);
const foliageResult = compileProcPlantProductionDag(genome, foliageChanged, environment, { canonicalSeed: seed });
const changedFoliageArchitecture = foliageResult.artifacts[stages.get("architecture")!.id];
const changedFoliage = foliageResult.artifacts[stages.get("foliage")!.id];
assert.equal(changedFoliageArchitecture?.kind, "clump-transforms");
assert.equal(changedFoliage?.kind, "clump-parts");
if (changedFoliageArchitecture?.kind !== "clump-transforms" || changedFoliage?.kind !== "clump-parts") {
  throw new Error("missing foliage-seeded clump artifacts");
}
assert.deepEqual(matrices(changedFoliageArchitecture), matrices(architectureArtifact),
  "shoot seed must not perturb independently seeded clump placement");
assert.notDeepEqual(changedFoliage.plan.shootSeeds, foliageArtifact.plan.shootSeeds);
assert.notEqual(templateHash(foliageResult.build.template), templateHash(typed.build.template));

const materialEdited = applyProcPlantGeneratorGraphOperations(seeded, [{
  op: "set-parameters",
  nodeId: stages.get("material")!.id,
  value: { leafColorA: 0x193e18, leafColorB: 0x8acb56 },
}]);
const materialResult = compileProcPlantProductionDag(genome, materialEdited, environment, { canonicalSeed: seed });
assert.notEqual(templateHash(materialResult.build.template), templateHash(typed.build.template));
assert.deepEqual(materialResult.build.template.pos, typed.build.template.pos,
  "material stage edits must preserve clump geometry positions");

const lodEdited = applyProcPlantGeneratorGraphOperations(seeded, [{
  op: "set-parameters", nodeId: stages.get("lod")!.id, value: { levels: [0, 2, 3] },
}]);
const lodResult = compileProcPlantProductionDag(genome, lodEdited, environment, { canonicalSeed: seed });
assert.deepEqual(lodResult.lods.map((lod) => lod.level), [0, 2, 3]);

const reject = (operations: Parameters<typeof applyProcPlantGeneratorGraphOperations>[1], pattern: RegExp) => assert.throws(
  () => compileProcPlantProductionDag(genome, applyProcPlantGeneratorGraphOperations(seeded, operations), environment, { canonicalSeed: seed }),
  (error) => error instanceof ProcPlantProductionDagError && pattern.test(error.message),
);
reject([{ op: "set-seed", nodeId: stages.get("branching")!.id, value: 9 }], /does not support edited branching semantics/);
reject([{ op: "set-count", nodeId: stages.get("architecture")!.id, value: 3 }], /does not support edited architecture semantics/);
reject([{ op: "remove-dependency", nodeId: stages.get("foliage")!.id, dependencyId: stages.get("architecture")!.id }], /does not support edited foliage semantics/);
reject([{ op: "set-seed", nodeId: stages.get("material")!.id, value: 9 }], /does not support edited material semantics/);
assert.throws(
  () => compileProcPlantProductionDag(genome, seeded, environment, { canonicalSeed: seed, maxWork: 5 }),
  /work cap/,
);

const daylily = procPlantPresets.daylilyFlower!;
const daylilyGraph = createProcPlantAuthoringGraph(daylily, seed);
const daylilyEdited = applyProcPlantGeneratorGraphOperations(daylilyGraph, [{
  op: "set-seed", nodeId: daylilyGraph.nodes.find((node) => node.stage === "architecture")!.id, value: 9,
}]);
assert.throws(
  () => compileProcPlantProductionDag(daylily, daylilyEdited, environment, { canonicalSeed: seed }),
  /does not support the specialized daylily crown\/scapes backend/,
);

const explicitPlan = createProcPlantClumpStagePlan(genome, seed, seed);
assert.deepEqual(explicitPlan.shootSeeds, [612072, 614821, 617570, 620319, 623068]);
const [coverageX, coverageZ] = footprint(canonicalLods[0]!.template);
assert.ok(coverageX >= 0.75 && coverageZ >= 0.75, "furGrass clump must retain broad ground coverage");
assert.ok(canonicalLods[0]!.triangles <= 400, "furGrass LOD0 must remain bounded for dense placement");
assert.ok(canonicalLods[1]!.triangles < canonicalLods[0]!.triangles);
const stackPhiLods = compileProcPlantLods(procPlantPresets.phiFern!, seed, environment);
assert.deepEqual(stackPhiLods.map((lod) => templateHash(lod.template)), [
  "81450805e601c756c2a30ccb5f73cc902cdca4a9f1fc920037952fbd76828c32",
  "ce4ee8ac4b121dc27039c73dfc604160ae96e5bac711ed48524e18c07c1fbeeb",
  "0a5c68606a96eb4ce4ce7a0d847402684fdc6a7414447e256979dab6cce7f31f",
  "c29f6b6410639891453ac638b4393cfc3b858278a6f9bd6bdb7b78e67a3356ce",
], "the PR #13 stack's pre-convergence Phi bytes must remain untouched by the clump seam");
assert.deepEqual(stackPhiLods.map((lod) => lod.triangles), [1872, 624, 4, 2]);

console.log(JSON.stringify({
  legacyHashes: canonicalLods.map((lod) => templateHash(lod.template)),
  triangles: canonicalLods.map((lod) => lod.triangles),
  vertices: canonicalLods.map((lod) => lod.vertices),
  instances: canonicalParts.instances.length,
  footprint: [coverageX, coverageZ],
  stackPhiHashes: stackPhiLods.map((lod) => templateHash(lod.template)),
  stackPhiTriangles: stackPhiLods.map((lod) => lod.triangles),
  typedWork: typed.work,
}));
console.log("procplant clump production DAG tests passed");
