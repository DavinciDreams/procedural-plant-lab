import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildProcPlantTemplate,
  buildWeberPennProcPlantStageParts,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";
import { createProcPlantAuthoringGraph } from "../src/procplant-authoring-graph";
import { applyProcPlantGeneratorGraphOperations } from "../src/procplant-generator-graph";
import { compileProcPlantProductionDag, ProcPlantProductionDagError } from "../src/procplant-production-dag";
import {
  applyProcPlantWeberPennTrimOverrides,
  createProcPlantWeberPennTrimOverrideSet,
} from "../src/procplant-weber-penn-trim";

const hashTemplate = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.uv0, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const branchPrefix = (template: ProcPlantTemplate, vertexCount: number) => ({
  pos: Array.from(template.pos.slice(0, vertexCount * 3)),
  nrm: Array.from(template.nrm.slice(0, vertexCount * 3)),
  uv0: Array.from(template.uv0.slice(0, vertexCount * 2)),
  col: Array.from(template.col.slice(0, vertexCount * 3)),
  tintable: Array.from(template.tintable.slice(0, vertexCount)),
  sway: Array.from(template.sway.slice(0, vertexCount)),
});

const genome = structuredClone(procPlantPresets.oakCanopy!);
genome.id = "weberPennProductionDagOak";
genome.weberPenn = { ...genome.weberPenn!, maxBranchDepth: 2, maxStems: 24, maxLeaves: 48 };
const seed = 0x8eb3_2026;
const environment = defaultPlantEnvironment();
const sourceSnapshot = structuredClone(genome);
const canonical = createProcPlantAuthoringGraph(genome, seed);
const legacy = buildProcPlantTemplate(genome, seed, environment);
const canonicalResult = compileProcPlantProductionDag(genome, canonical, environment, { canonicalSeed: seed });
assert.equal(canonicalResult.path, "legacy-canonical");
assert.equal(hashTemplate(canonicalResult.build.template), hashTemplate(legacy.template));
for (const key of ["pos", "nrm", "uv0", "col", "tintable", "sway", "idx"] as const) {
  assert.deepEqual(Array.from(canonicalResult.build.template[key]), Array.from(legacy.template[key]),
    `canonical Weber-Penn ${key} bytes must remain exact`);
}

const canonicalParts = buildWeberPennProcPlantStageParts(
  genome, seed, environment, { structure: seed, foliage: seed },
);
assert.equal(hashTemplate(canonicalParts.build.template), hashTemplate(legacy.template));
assert.ok(canonicalParts.structure.idx.length > 0);
assert.ok(canonicalParts.nativeFoliage.idx.length > 0);
assert.ok(canonicalParts.sourceStemCount > 1);
assert.ok(canonicalParts.sourceLeafCount > 1);

const stages = new Map(canonical.nodes.map((node) => [node.stage, node]));
const architecture = stages.get("architecture")!;
const branching = stages.get("branching")!;
const foliage = stages.get("foliage")!;
const material = stages.get("material")!;
const lod = stages.get("lod")!;
const deformation = stages.get("deformation")!;
const lodOnlyGraph = applyProcPlantGeneratorGraphOperations(canonical, [{
  op: "set-parameters", nodeId: lod.id, value: { levels: [0, 2, 3] },
}]);
const lodOnly = compileProcPlantProductionDag(genome, lodOnlyGraph, environment, { canonicalSeed: seed });
assert.equal(lodOnly.path, "typed-artifacts");
assert.equal(hashTemplate(lodOnly.build.template), hashTemplate(legacy.template),
  "an LOD-only edit must preserve exact legacy LOD0 bytes through the typed Weber-Penn stages");
assert.deepEqual(lodOnly.lods.map((entry) => entry.level), [0, 2, 3]);
const edited = applyProcPlantGeneratorGraphOperations(canonical, [
  { op: "set-seed", nodeId: branching.id, value: 0x1001 },
  { op: "set-seed", nodeId: foliage.id, value: 0x2002 },
]);
const compiledA = compileProcPlantProductionDag(genome, edited, environment, { canonicalSeed: seed });
const compiledB = compileProcPlantProductionDag(genome, edited, environment, { canonicalSeed: seed });
assert.equal(compiledA.path, "typed-artifacts");
assert.equal(hashTemplate(compiledA.build.template), hashTemplate(compiledB.build.template));
assert.deepEqual(compiledA.records, compiledB.records);
assert.equal(compiledA.artifacts[architecture.id]?.kind, "weber-penn-plan");
assert.equal(compiledA.artifacts[branching.id]?.kind, "weber-penn-parts");
assert.equal(compiledA.artifacts[foliage.id]?.kind, "weber-penn-parts");
assert.equal(compiledA.artifacts[material.id]?.kind, "material");
assert.equal(compiledA.artifacts[lod.id]?.kind, "lod");
assert.equal(compiledA.artifacts[stages.get("output")!.id]?.kind, "output");
assert.deepEqual(genome, sourceSnapshot, "typed Weber-Penn compilation must not mutate its source genome");

const branchArtifact = compiledA.artifacts[branching.id];
const foliageArtifact = compiledA.artifacts[foliage.id];
assert.equal(branchArtifact?.kind, "weber-penn-parts");
assert.equal(foliageArtifact?.kind, "weber-penn-parts");
if (branchArtifact?.kind === "weber-penn-parts" && foliageArtifact?.kind === "weber-penn-parts") {
  assert.equal(hashTemplate(branchArtifact.parts.structure), hashTemplate(foliageArtifact.parts.structure),
    "native foliage materialization must preserve the exact structure soup");
  assert.equal(branchArtifact.structureSeed, 0x1001);
  assert.equal(branchArtifact.foliageSeed, null);
  assert.equal(foliageArtifact.foliageSeed, 0x2002);
}

const structureSeedChanged = applyProcPlantGeneratorGraphOperations(edited, [
  { op: "set-seed", nodeId: branching.id, value: 0x1002 },
]);
const structureChanged = compileProcPlantProductionDag(genome, structureSeedChanged, environment, { canonicalSeed: seed });
const changedBranchArtifact = structureChanged.artifacts[branching.id];
assert.equal(changedBranchArtifact?.kind, "weber-penn-parts");
if (branchArtifact?.kind === "weber-penn-parts" && changedBranchArtifact?.kind === "weber-penn-parts") {
  assert.notEqual(hashTemplate(changedBranchArtifact.parts.structure), hashTemplate(branchArtifact.parts.structure),
    "branching seed edits must drive the real vendor topology and structure soup");
}

const foliageSeedChanged = applyProcPlantGeneratorGraphOperations(edited, [
  { op: "set-seed", nodeId: foliage.id, value: 0x2003 },
]);
const foliageChanged = compileProcPlantProductionDag(genome, foliageSeedChanged, environment, { canonicalSeed: seed });
const changedFoliageArtifact = foliageChanged.artifacts[foliage.id];
assert.equal(changedFoliageArtifact?.kind, "weber-penn-parts");
if (foliageArtifact?.kind === "weber-penn-parts" && changedFoliageArtifact?.kind === "weber-penn-parts") {
  assert.equal(hashTemplate(changedFoliageArtifact.parts.structure), hashTemplate(foliageArtifact.parts.structure),
    "foliage seed edits must not perturb the baked structure soup");
  assert.notEqual(hashTemplate(changedFoliageArtifact.parts.nativeFoliage), hashTemplate(foliageArtifact.parts.nativeFoliage),
    "foliage seed edits must drive real native-leaf post-bake variation");
  assert.deepEqual(
    branchPrefix(foliageChanged.build.template, changedFoliageArtifact.parts.structure.pos.length / 3),
    branchPrefix(compiledA.build.template, foliageArtifact.parts.structure.pos.length / 3),
    "foliage seed edits must preserve branch vertex attributes in the final materialized template",
  );
}

const foliageBudgetGraph = applyProcPlantGeneratorGraphOperations(edited, [
  { op: "set-count", nodeId: foliage.id, value: 24 },
]);
const foliageBudgetChanged = compileProcPlantProductionDag(genome, foliageBudgetGraph, environment, { canonicalSeed: seed });
const budgetFoliageArtifact = foliageBudgetChanged.artifacts[foliage.id];
assert.equal(budgetFoliageArtifact?.kind, "weber-penn-parts");
if (foliageArtifact?.kind === "weber-penn-parts" && budgetFoliageArtifact?.kind === "weber-penn-parts") {
  assert.equal(hashTemplate(budgetFoliageArtifact.parts.structure), hashTemplate(foliageArtifact.parts.structure),
    "native foliage budgets must reuse the exact normalized structure soup");
  assert.ok(budgetFoliageArtifact.parts.nativeFoliage.idx.length < foliageArtifact.parts.nativeFoliage.idx.length,
    "maxLeaves count edits must reduce the real native-foliage soup");
}

const materialEdited = applyProcPlantGeneratorGraphOperations(edited, [{
  op: "set-parameters",
  nodeId: material.id,
  value: { leafColorA: 0x174b2a, leafColorB: 0x8dbb58 },
}]);
const materialChanged = compileProcPlantProductionDag(genome, materialEdited, environment, { canonicalSeed: seed });
assert.notEqual(hashTemplate(materialChanged.build.template), hashTemplate(compiledA.build.template));
if (foliageArtifact?.kind === "weber-penn-parts") {
  assert.deepEqual(
    branchPrefix(materialChanged.build.template, foliageArtifact.parts.structure.pos.length / 3),
    branchPrefix(compiledA.build.template, foliageArtifact.parts.structure.pos.length / 3),
    "leaf material edits must preserve branch geometry and bark attributes",
  );
}

const lodEdited = applyProcPlantGeneratorGraphOperations(edited, [
  { op: "set-parameters", nodeId: deformation.id, value: { windFlex: 0.77, phototropism: 0.19 } },
  { op: "set-parameters", nodeId: lod.id, value: { levels: [0, 2, 3] } },
]);
const lodChanged = compileProcPlantProductionDag(genome, lodEdited, environment, { canonicalSeed: seed });
assert.deepEqual(lodChanged.lods.map((entry) => entry.level), [0, 2, 3]);
const outputArtifact = lodChanged.artifacts[stages.get("output")!.id];
assert.equal(outputArtifact?.kind, "output");
if (outputArtifact?.kind === "output") {
  assert.deepEqual(outputArtifact.runtime, { windFlex: 0.77, phototropism: 0.19 },
    "deformation runtime values must reach the real output artifact through LOD compilation");
}

const expectClosed = (graph: typeof canonical, pattern: RegExp) => assert.throws(
  () => compileProcPlantProductionDag(genome, graph, environment, { canonicalSeed: seed }),
  (error) => error instanceof ProcPlantProductionDagError && pattern.test(error.message),
);
expectClosed(applyProcPlantGeneratorGraphOperations(edited, [
  { op: "set-seed", nodeId: architecture.id, value: 9 },
]), /seed overrides are unsupported/);
const rewired = structuredClone(edited);
rewired.nodes.find((node) => node.id === foliage.id)!.dependsOn = [architecture.id];
expectClosed(rewired, /cannot be rewired/);
const placed = structuredClone(edited);
placed.nodes.find((node) => node.id === foliage.id)!.placement = { mode: "nodes" };
expectClosed(placed, /placement cannot be projected/);
const scoped = structuredClone(edited);
scoped.nodes.find((node) => node.id === foliage.id)!.parentScope = { mode: "tips" };
expectClosed(scoped, /parentScope cannot be projected/);
expectClosed(applyProcPlantGeneratorGraphOperations(edited, [
  { op: "set-count", nodeId: architecture.id, value: (architecture.count ?? 1) + 1 },
]), /count cannot be projected/);

const templateSnapshot = Array.from(compiledA.build.template.idx);
const trimTarget = { backend: "weber-penn" as const, genomeId: genome.id, seed: 0x1001 };
const emptyTrim = applyProcPlantWeberPennTrimOverrides(
  { target: trimTarget, graph: compiledA.build.graph },
  createProcPlantWeberPennTrimOverrideSet(trimTarget),
);
assert.equal(emptyTrim.audit.status, "no-op");
assert.strictEqual(emptyTrim.graph, compiledA.build.graph,
  "typed execution must preserve the existing attachment-only trim compatibility boundary");
assert.equal(emptyTrim.audit.bakedBranchTopologySupported, false);
assert.equal(emptyTrim.audit.nativeLeafGeometrySupported, false);
assert.deepEqual(Array.from(compiledA.build.template.idx), templateSnapshot,
  "attachment-only trim compatibility must not mutate staged baked geometry");

console.log(JSON.stringify({
  canonicalHash: hashTemplate(legacy.template),
  typedHash: hashTemplate(compiledA.build.template),
  structureTriangles: branchArtifact?.kind === "weber-penn-parts" ? branchArtifact.parts.structure.idx.length / 3 : null,
  nativeFoliageTriangles: foliageArtifact?.kind === "weber-penn-parts" ? foliageArtifact.parts.nativeFoliage.idx.length / 3 : null,
  lods: lodChanged.lods.map((entry) => [entry.level, entry.triangles]),
}));
console.log("procplant Weber-Penn production DAG tests passed");
