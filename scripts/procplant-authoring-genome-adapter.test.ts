import assert from "node:assert/strict";
import { buildProcPlantTemplate, defaultPlantEnvironment, procPlantPresets } from "../src/procplants";
import {
  applyProcPlantAuthoringGraphToGenome,
  createProcPlantAuthoringGraph,
} from "../src/procplant-authoring-graph";
import { applyProcPlantGeneratorGraphOperations } from "../src/procplant-generator-graph";

const seed = 42;
const source = procPlantPresets.phiFern!;
const canonical = createProcPlantAuthoringGraph(source, seed);
const unchanged = applyProcPlantAuthoringGraphToGenome(source, canonical, seed);
assert.strictEqual(unchanged.genome, source, "canonical graph must preserve the exact source genome reference");
assert.equal(unchanged.changed, false);
assert.deepEqual(unchanged.applied, []);
assert.deepEqual(unchanged.unsupported, []);
assert.equal(unchanged.executionSeed, seed);
assert.equal(unchanged.executionRecords.length, 9);

const byStage = new Map(canonical.nodes.map((node) => [node.stage, node]));
const architecture = byStage.get("architecture")!;
const branching = byStage.get("branching")!;
const foliage = byStage.get("foliage")!;
const lod = byStage.get("lod")!;
const sourceSnapshot = JSON.parse(JSON.stringify(source));
const edited = applyProcPlantGeneratorGraphOperations(canonical, [
  { op: "set-count", nodeId: architecture.id, value: architecture.count! + 2 },
  { op: "set-curve", nodeId: architecture.id, value: { base: 0.24, tip: 0.1, curve: 1.4 } },
  { op: "set-curve", nodeId: branching.id, value: { base: 0.26, tip: 0.12, curve: 1.1 } },
  { op: "set-count", nodeId: foliage.id, value: Math.min(architecture.count! + 2, foliage.count! + 1) },
  { op: "set-curve", nodeId: foliage.id, value: { base: 0.3, tip: 0.16, curve: 0.9 } },
  { op: "set-count", nodeId: lod.id, value: 3 },
  { op: "remove-dependency", nodeId: lod.id, dependencyId: byStage.get("material")!.id },
]);
const applied = applyProcPlantAuthoringGraphToGenome(source, edited, seed);
assert.notStrictEqual(applied.genome, source);
assert.equal(applied.genome.nodeCount, architecture.count! + 2);
assert.deepEqual(applied.genome.internode, { base: 0.24, tip: 0.1, curve: 1.4 });
assert.deepEqual(applied.genome.branchChance, { base: 0.26, tip: 0.12, curve: 1.1 });
assert.deepEqual(applied.genome.leaf.length, { base: 0.3, tip: 0.16, curve: 0.9 });
assert.equal(applied.applied.filter((entry) => entry.stage === "architecture").length, 2);
assert.ok(applied.unsupported.some((entry) => entry.stage === "lod" && entry.control === "count"));
assert.ok(applied.unsupported.some((entry) => entry.stage === "lod" && entry.control === "dependencies"));
assert.deepEqual(JSON.parse(JSON.stringify(source)), sourceSnapshot, "adapter must not mutate the source genome");

const disabledBranchGraph = applyProcPlantGeneratorGraphOperations(canonical, [
  { op: "set-enabled", nodeId: branching.id, value: false },
]);
const disabledBranches = applyProcPlantAuthoringGraphToGenome(source, disabledBranchGraph, seed);
assert.equal(disabledBranches.genome.branchChance.base, 0);
assert.equal(disabledBranches.genome.branchChance.tip, 0);
assert.ok(disabledBranches.applied.some((entry) => entry.stage === "branching" && entry.control === "enabled"));

const unsupportedOnlyGraph = applyProcPlantGeneratorGraphOperations(canonical, [
  { op: "set-count", nodeId: lod.id, value: 2 },
]);
const unsupportedOnly = applyProcPlantAuthoringGraphToGenome(source, unsupportedOnlyGraph, seed);
assert.strictEqual(unsupportedOnly.genome, source, "unsupported-only edits must preserve the source reference");
assert.equal(unsupportedOnly.changed, false);

const impossibleCountGraph = applyProcPlantGeneratorGraphOperations(canonical, [
  { op: "set-count", nodeId: foliage.id, value: architecture.count! + 100 },
]);
const impossibleCount = applyProcPlantAuthoringGraphToGenome(source, impossibleCountGraph, seed);
assert.strictEqual(impossibleCount.genome, source, "rejected compiler controls must not force a cloned output");
assert.ok(impossibleCount.unsupported.some((entry) => entry.stage === "foliage" && entry.control === "count"));

const wpSource = procPlantPresets.blueSpruce!;
const wpGraph = createProcPlantAuthoringGraph(wpSource, seed);
const wpBranch = wpGraph.nodes.find((node) => node.stage === "branching")!;
const wpFoliage = wpGraph.nodes.find((node) => node.stage === "foliage")!;
const wpEdited = applyProcPlantGeneratorGraphOperations(wpGraph, [
  { op: "set-count", nodeId: wpBranch.id, value: 23 },
  { op: "set-count", nodeId: wpFoliage.id, value: 47 },
]);
const wpApplied = applyProcPlantAuthoringGraphToGenome(wpSource, wpEdited, seed);
assert.equal(wpApplied.genome.weberPenn!.maxStems, 23);
assert.equal(wpApplied.genome.weberPenn!.maxLeaves, 47);

const wrongIdentity = applyProcPlantGeneratorGraphOperations(canonical, [{
  op: "set-parameters",
  nodeId: byStage.get("source")!.id,
  value: { ...byStage.get("source")!.parameters, genomeId: "different-genome" },
}]);
assert.throws(() => applyProcPlantAuthoringGraphToGenome(source, wrongIdentity, seed), /identity/);

const floweringSource = procPlantPresets.meadowFlower!;
const floweringGraph = createProcPlantAuthoringGraph(floweringSource, seed);
const floweringApplied = applyProcPlantAuthoringGraphToGenome(floweringSource, floweringGraph, seed);
assert.equal(floweringApplied.executionRecords.length, 9);
assert.equal(floweringApplied.executionRecords.filter((record) => record.status === "executed").length, 9,
  "all nine canonical handlers must execute for a fully enabled flowering genome");

const seedBranch = canonical.nodes.find((node) => node.stage === "branching")!;
const seededGraph = applyProcPlantGeneratorGraphOperations(canonical, [{ op: "set-seed", nodeId: seedBranch.id, value: 99 }]);
const seededA = applyProcPlantAuthoringGraphToGenome(source, seededGraph, seed);
const seededB = applyProcPlantAuthoringGraphToGenome(source, seededGraph, seed);
assert.equal(seededA.executionSeed, seededB.executionSeed);
assert.notEqual(seededA.executionSeed, seed);
assert.ok(seededA.applied.some((entry) => entry.control === "seed-override"));

const rewireSource = procPlantPresets.meadowFlower!;
const rewireCanonical = createProcPlantAuthoringGraph(rewireSource, seed);
const foliageNode = rewireCanonical.nodes.find((node) => node.stage === "foliage")!;
const rewireBranching = rewireCanonical.nodes.find((node) => node.stage === "branching")!;
const rewiredGraph = applyProcPlantGeneratorGraphOperations(rewireCanonical, [
  { op: "remove-dependency", nodeId: foliageNode.id, dependencyId: rewireBranching.id },
  { op: "set-parent-scope", nodeId: foliageNode.id, value: { mode: "stages", stages: ["architecture"] } },
]);
const rewiredA = applyProcPlantAuthoringGraphToGenome(rewireSource, rewiredGraph, seed);
const rewiredB = applyProcPlantAuthoringGraphToGenome(rewireSource, rewiredGraph, seed);
assert.equal(rewiredA.executionSeed, rewiredB.executionSeed);
assert.equal(rewiredA.executionSeed, seed, "dataflow rewiring changes a compiled genome field, not the global seed");
assert.notDeepEqual(rewiredA.genome.leaf.density, rewireSource.leaf.density);
const defaultTemplate = buildProcPlantTemplate(rewireSource, seed, defaultPlantEnvironment()).template;
const rewiredTemplateA = buildProcPlantTemplate(rewiredA.genome, rewiredA.executionSeed, defaultPlantEnvironment()).template;
const rewiredTemplateB = buildProcPlantTemplate(rewiredB.genome, rewiredB.executionSeed, defaultPlantEnvironment()).template;
assert.deepEqual(Array.from(rewiredTemplateA.pos), Array.from(rewiredTemplateB.pos));
assert.notDeepEqual(Array.from(rewiredTemplateA.pos), Array.from(defaultTemplate.pos),
  "supported dependency rewiring must change deterministic compiled geometry");

const piecewise = applyProcPlantGeneratorGraphOperations(canonical, [{
  op: "set-curve",
  nodeId: architecture.id,
  value: {
    base: source.internode.base,
    tip: source.internode.tip,
    curve: source.internode.curve,
    points: [
      { t: 0, value: source.internode.base },
      { t: 0.5, value: source.internode.base * 0.9 + source.internode.tip * 0.1 },
      { t: 1, value: source.internode.tip },
    ],
  },
}]);
const piecewiseApplied = applyProcPlantAuthoringGraphToGenome(source, piecewise, seed);
assert.notEqual(piecewiseApplied.genome.internode.curve, source.internode.curve);
assert.ok(piecewiseApplied.applied.some((entry) => entry.stage === "architecture" && entry.control === "curve"));

const architectureParameters = { ...architecture.parameters, apicalDominance: 0.2, phyllotaxisAngle: 1.5 };
const branchingParameters = { ...branching.parameters, angle: { mean: 0.4, spread: 0.2, depthDecay: 0.6 } };
const material = canonical.nodes.find((node) => node.stage === "material")!;
const deformation = canonical.nodes.find((node) => node.stage === "deformation")!;
const parameterGraph = applyProcPlantGeneratorGraphOperations(canonical, [
  { op: "set-parameters", nodeId: architecture.id, value: architectureParameters },
  { op: "set-parameters", nodeId: branching.id, value: branchingParameters },
  { op: "set-parameters", nodeId: foliage.id, value: { ...foliage.parameters, shape: "round", phyllotaxy: "opposite" } },
  { op: "set-parameters", nodeId: deformation.id, value: { ...deformation.parameters, phototropism: 0.7 } },
  { op: "set-parameters", nodeId: material.id, value: { leafColorA: 0x123456, leafColorB: 0x789abc } },
]);
const parameterApplied = applyProcPlantAuthoringGraphToGenome(source, parameterGraph, seed);
assert.equal(parameterApplied.genome.apicalDominance, 0.2);
assert.equal(parameterApplied.genome.phyllotaxisAngle, 1.5);
assert.deepEqual(parameterApplied.genome.branchAngle, branchingParameters.angle);
assert.equal(parameterApplied.genome.leaf.shape, "round");
assert.equal(parameterApplied.genome.phyllotaxy?.mode, "opposite");
assert.equal(parameterApplied.genome.lightResponse.phototropism, 0.7);
assert.equal(parameterApplied.genome.leaf.colorA, 0x123456);

const wpParentGraph = applyProcPlantGeneratorGraphOperations(wpGraph, [{
  op: "set-parent-scope",
  nodeId: wpBranch.id,
  value: { ...wpBranch.parentScope!, maxDepth: 2 },
}]);
const wpParentApplied = applyProcPlantAuthoringGraphToGenome(wpSource, wpParentGraph, seed);
assert.equal(wpParentApplied.genome.weberPenn?.maxBranchDepth, 2);

const invalidParameters = applyProcPlantGeneratorGraphOperations(canonical, [{
  op: "set-parameters", nodeId: architecture.id, value: { ...architecture.parameters, unsafeMutation: true },
}]);
assert.throws(() => applyProcPlantAuthoringGraphToGenome(source, invalidParameters, seed), /allow-list/);
assert.deepEqual(JSON.parse(JSON.stringify(source)), sourceSnapshot, "invalid parameters must fail before source mutation");

const wrongTarget = { ...canonical, target: { kind: "procplant-genome", id: "other", version: 1 } as const };
assert.throws(() => applyProcPlantAuthoringGraphToGenome(source, wrongTarget, seed), /target/);

console.log("procplant authoring graph-to-genome adapter tests passed");
