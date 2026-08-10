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

const explicitPlan = createProcPlantClumpStagePlan(genome, seed, seed);
assert.deepEqual(explicitPlan.shootSeeds, [612072, 614821, 617570, 620319, 623068]);
const [coverageX, coverageZ] = footprint(canonicalLods[0]!.template);
assert.ok(coverageX >= 0.75 && coverageZ >= 0.75, "furGrass clump must retain broad ground coverage");
assert.ok(canonicalLods[0]!.triangles <= 400, "furGrass LOD0 must remain bounded for dense placement");
assert.ok(canonicalLods[1]!.triangles < canonicalLods[0]!.triangles);
const stackPhiLods = compileProcPlantLods(procPlantPresets.phiFern!, seed, environment);
// Indexed-frond revision; prior expanded-template hashes were cf7afaee,
// 48544897, 465807d8, and 37d57f14. Expanded triangle-position parity is
// frozen independently by test:conifer-fern-budget.
assert.deepEqual(stackPhiLods.map((lod) => templateHash(lod.template)), [
  "5602ddea3c9d40cb573a53b43e8d2ba521ee605f3122fa70ca9de09dc2c7d1ff",
  "161332d966db1b31342d1b2c5f784d5dcec1593e12c9fd0f005a83a86a81fdda",
  "5743f07b64d02a8f28126b1c0f4d5033fb411598131885f8c389bc3931720454",
  "b43aadf6805c16be92787fb5c5a9af9b9e6c875f6d2c5f7e93893a3849b59e76",
], "the approved indexed Phi bytes must remain untouched by the clump seam");
assert.deepEqual(stackPhiLods.map((lod) => lod.triangles), [352, 264, 4, 2]);
assert.deepEqual(stackPhiLods.map((lod) => lod.vertices), [704, 528, 8, 4]);
const stackPhiParts = buildProcPlantInstancedParts(procPlantPresets.phiFern!, seed, environment);
assert.equal(stackPhiParts.instances.length, 8);
assert.ok(stackPhiParts.instances.every((instance) => instance.kind === "fernFrond"));
const [phiCoverageX, phiCoverageZ] = footprint(stackPhiLods[0]!.template);
assert.ok(phiCoverageX >= 1.2 && phiCoverageZ >= 1.2, "approved Phi must retain broad two-axis coverage");

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
