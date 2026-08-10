import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildProcPlantTemplate,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantGraph,
  type ProcPlantTemplate,
} from "../src/procplants";
import { createProcPlantAuthoringGraph } from "../src/procplant-authoring-graph";
import {
  applyProcPlantGeneratorGraphOperations,
  createProcPlantGeneratorGraph,
  PROCPLANT_GENERATOR_GRAPH_MAX_NODES,
} from "../src/procplant-generator-graph";
import {
  compileProcPlantProductionDag,
  ProcPlantProductionDagError,
} from "../src/procplant-production-dag";

const templateHash = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.uv0, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const structure = (graph: ProcPlantGraph) => ({
  stems: graph.stems.map((stem) => ({
    position: stem.position.toArray(), direction: stem.direction.toArray(),
    radius: stem.radius, depth: stem.depth, t: stem.t, index: stem.index,
  })),
  segments: graph.segments,
});

const genome = {
  ...structuredClone(procPlantPresets.understoryShrub!),
  id: "productionDagShrub",
  accessoryOrgans: [{ kind: "berry" as const, count: 3, size: 0.08, color: 0x8f2638 }],
};
const seed = 0x51face;
const environment = defaultPlantEnvironment();
const sourceSnapshot = structuredClone(genome);
const canonical = createProcPlantAuthoringGraph(genome, seed);
const legacy = buildProcPlantTemplate(genome, seed, environment);
const canonicalResult = compileProcPlantProductionDag(genome, canonical, environment, { canonicalSeed: seed });
assert.equal(canonicalResult.path, "legacy-canonical");
assert.strictEqual(templateHash(canonicalResult.build.template), templateHash(legacy.template));
assert.deepEqual(structure(canonicalResult.build.graph), structure(legacy.graph));
assert.equal(canonicalResult.records.length, 9);
assert.ok(canonicalResult.records.every((record) => record.status === "legacy"));
const reorderedCanonical = structuredClone(canonical);
reorderedCanonical.nodes.reverse();
const reorderedCanonicalResult = compileProcPlantProductionDag(genome, reorderedCanonical, environment, { canonicalSeed: seed });
assert.equal(reorderedCanonicalResult.path, "legacy-canonical");
assert.equal(templateHash(reorderedCanonicalResult.build.template), templateHash(legacy.template));

const stage = new Map(canonical.nodes.map((node) => [node.stage, node]));
const foliage = stage.get("foliage")!;
const branching = stage.get("branching")!;
const architecture = stage.get("architecture")!;
const material = stage.get("material")!;
const reproductive = stage.get("reproductive")!;
const edited = applyProcPlantGeneratorGraphOperations(canonical, [
  { op: "set-seed", nodeId: foliage.id, value: 1001 },
  { op: "set-seed", nodeId: branching.id, value: 2002 },
]);
const compiledA = compileProcPlantProductionDag(genome, edited, environment, { canonicalSeed: seed });
const compiledB = compileProcPlantProductionDag(genome, edited, environment, { canonicalSeed: seed });
assert.equal(compiledA.path, "typed-artifacts");
assert.equal(templateHash(compiledA.build.template), templateHash(compiledB.build.template));
assert.deepEqual(compiledA.records, compiledB.records);
assert.deepEqual(compiledA.records.map((record) => record.stage), [
  "source", "architecture", "branching", "foliage", "deformation", "reproductive", "material", "lod", "output",
]);
assert.ok(compiledA.records.every((record) => record.status === "executed"));
assert.deepEqual(Object.values(compiledA.artifacts).map((artifact) => artifact.stage).sort(), [
  "architecture", "branching", "deformation", "foliage", "lod", "material", "output", "reproductive", "source",
]);
assert.notEqual(templateHash(compiledA.build.template), templateHash(legacy.template));
assert.deepEqual(genome, sourceSnapshot, "production DAG compilation must not mutate its source genome");

const foliageSeedChanged = applyProcPlantGeneratorGraphOperations(edited, [
  { op: "set-seed", nodeId: foliage.id, value: 1002 },
]);
const compiledFoliageChanged = compileProcPlantProductionDag(genome, foliageSeedChanged, environment, { canonicalSeed: seed });
assert.deepEqual(structure(compiledFoliageChanged.build.graph), structure(compiledA.build.graph),
  "foliage seed must not perturb architecture or branching artifacts");
assert.notDeepEqual(
  compiledFoliageChanged.build.graph.organs.map((organ) => organ.position.toArray()),
  compiledA.build.graph.organs.map((organ) => organ.position.toArray()),
  "foliage seed must drive only its independently seeded organ placement",
);

const branchSeedChanged = applyProcPlantGeneratorGraphOperations(edited, [
  { op: "set-seed", nodeId: branching.id, value: 2003 },
]);
const compiledBranchChanged = compileProcPlantProductionDag(genome, branchSeedChanged, environment, { canonicalSeed: seed });
const architectureCount = (architecture.count ?? genome.nodeCount) + 1;
assert.deepEqual(
  structure(compiledBranchChanged.build.graph).stems.slice(0, architectureCount),
  structure(compiledA.build.graph).stems.slice(0, architectureCount),
  "branch seed must preserve the independently seeded architecture prefix",
);
assert.notDeepEqual(structure(compiledBranchChanged.build.graph), structure(compiledA.build.graph));

const reordered = structuredClone(edited);
reordered.nodes.reverse();
const compiledReordered = compileProcPlantProductionDag(genome, reordered, environment, { canonicalSeed: seed });
assert.equal(templateHash(compiledReordered.build.template), templateHash(compiledA.build.template));
assert.deepEqual(compiledReordered.records, compiledA.records, "declaration order must not alter typed DAG execution");

const trunkFoliage = applyProcPlantGeneratorGraphOperations(edited, [
  { op: "remove-dependency", nodeId: foliage.id, dependencyId: branching.id },
  { op: "set-parent-scope", nodeId: foliage.id, value: { mode: "stages", stages: ["architecture"], maxDepth: 0 } },
]);
const trunkResult = compileProcPlantProductionDag(genome, trunkFoliage, environment, { canonicalSeed: seed });
assert.notEqual(templateHash(trunkResult.build.template), templateHash(compiledA.build.template));
const foliageArtifact = trunkResult.artifacts[foliage.id];
assert.equal(foliageArtifact?.kind, "graph");
if (foliageArtifact?.kind === "graph") {
  assert.ok(foliageArtifact.graph.organs.every((organ) => {
    const nearest = foliageArtifact.graph.stems.reduce((best, stem) =>
      stem.position.distanceToSquared(organ.position) < best.position.distanceToSquared(organ.position) ? stem : best,
    foliageArtifact.graph.stems[0]!);
    return nearest.depth === 0;
  }), "maxDepth=0 parent scope must materialize foliage only on the architecture axis");
}

const scopedByNode = applyProcPlantGeneratorGraphOperations(edited, [{
  op: "set-parent-scope", nodeId: foliage.id, value: { mode: "nodes", nodeIds: [architecture.id], maxDepth: 0 },
}]);
const scopedByNodeResult = compileProcPlantProductionDag(genome, scopedByNode, environment, { canonicalSeed: seed });
assert.equal(
  scopedByNodeResult.artifacts[foliage.id]?.hash,
  trunkResult.artifacts[foliage.id]?.hash,
  "node parent scope and equivalent stage rewire must select the same architecture artifact",
);
const invalidNodeScope = applyProcPlantGeneratorGraphOperations(edited, [{
  op: "set-parent-scope", nodeId: foliage.id, value: { mode: "nodes", nodeIds: [stage.get("source")!.id] },
}]);
assert.throws(
  () => compileProcPlantProductionDag(genome, invalidNodeScope, environment, { canonicalSeed: seed }),
  /requires at least one graph artifact input/,
);

const extraBranchGraph = structuredClone(edited);
const extraBranchId = "branching:secondary-branch-pass:dag-test";
extraBranchGraph.nodes.push({
  ...structuredClone(branching),
  id: extraBranchId,
  label: "Secondary branch pass",
  dependsOn: [branching.id],
  seedOverride: 3003,
  count: 2,
  parentScope: { mode: "stages", stages: ["branching"], maxDepth: 3 },
});
const extraFoliage = extraBranchGraph.nodes.find((node) => node.id === foliage.id)!;
extraFoliage.dependsOn = [extraBranchId];
extraFoliage.parentScope = { mode: "stages", stages: ["branching"], maxDepth: 3 };
const extraBranchResult = compileProcPlantProductionDag(genome, extraBranchGraph, environment, { canonicalSeed: seed });
assert.equal(extraBranchResult.artifacts[extraBranchId]?.stage, "branching");
assert.ok(extraBranchResult.build.graph.stems.length > compiledA.build.graph.stems.length,
  "an additional typed branching node must materially extend the production structure");

const lodGraph = applyProcPlantGeneratorGraphOperations(edited, [{
  op: "set-parameters", nodeId: stage.get("lod")!.id, value: { levels: [0, 2, 3] },
}]);
const lodResult = compileProcPlantProductionDag(genome, lodGraph, environment, { canonicalSeed: seed });
assert.deepEqual(lodResult.lods.map((lod) => lod.level), [0, 2, 3], "LOD stage parameters must select real emitted LOD artifacts");

const badType = applyProcPlantGeneratorGraphOperations(canonical, [
  { op: "remove-dependency", nodeId: material.id, dependencyId: foliage.id },
  { op: "remove-dependency", nodeId: material.id, dependencyId: reproductive.id },
  { op: "add-dependency", nodeId: material.id, dependencyId: stage.get("source")!.id },
  { op: "set-seed", nodeId: material.id, value: 9 },
]);
assert.throws(
  () => compileProcPlantProductionDag(genome, badType, environment, { canonicalSeed: seed }),
  (error) => error instanceof ProcPlantProductionDagError && /cannot consume artifact stages: source/.test(error.message),
);
assert.throws(
  () => compileProcPlantProductionDag(genome, edited, environment, { canonicalSeed: seed, maxWork: 5 }),
  /work cap/,
);

const tooManyNodes = Array.from({ length: PROCPLANT_GENERATOR_GRAPH_MAX_NODES + 1 }, (_, index) => ({
  id: `source:${index}`,
  label: `Source ${index}`,
  stage: "source" as const,
  enabled: true,
  dependsOn: [],
}));
assert.throws(() => createProcPlantGeneratorGraph(tooManyNodes, seed), /1\.\.64 nodes/);
const tooManyEdges = Array.from({ length: 24 }, (_, index) => ({
  id: `source:edge-${index}`,
  label: `Edge ${index}`,
  stage: "source" as const,
  enabled: true,
  dependsOn: Array.from({ length: index }, (_unused, dependency) => `source:edge-${dependency}`),
}));
assert.throws(() => createProcPlantGeneratorGraph(tooManyEdges, seed), /edge cap/);
const tooMuchWork = Array.from({ length: 11 }, (_, index) => ({
  id: `source:work-${index}`,
  label: `Work ${index}`,
  stage: "source" as const,
  enabled: true,
  dependsOn: [],
  count: 100_000,
}));
assert.throws(() => createProcPlantGeneratorGraph(tooMuchWork, seed), /operation cap/);

const unsupportedGenome = procPlantPresets.cloverGroundcover!;
const unsupportedGraph = applyProcPlantGeneratorGraphOperations(
  createProcPlantAuthoringGraph(unsupportedGenome, seed),
  [{ op: "set-seed", nodeId: createProcPlantAuthoringGraph(unsupportedGenome, seed).nodes.find((node) => node.stage === "foliage")!.id, value: 7 }],
);
assert.throws(
  () => compileProcPlantProductionDag(unsupportedGenome, unsupportedGraph, environment, { canonicalSeed: seed }),
  /does not support backend features/,
);

console.log(JSON.stringify({
  canonicalHash: templateHash(canonicalResult.build.template),
  typedHash: templateHash(compiledA.build.template),
  typedStems: compiledA.build.graph.stems.length,
  typedOrgans: compiledA.build.graph.organs.length,
  work: compiledA.work,
}));
console.log("procplant production DAG tests passed");
