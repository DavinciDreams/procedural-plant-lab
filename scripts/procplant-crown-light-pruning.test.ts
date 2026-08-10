import assert from "node:assert/strict";
import {
  applyProcPlantCrownLightPruning,
  buildProcPlantGraph,
  buildProcPlantTemplate,
  buildProcPlantTemplateWithCrownLightPruning,
  defaultPlantEnvironment,
  createProcPlantCrownLightPruningGraphSignature,
  procPlantPresets,
} from "../src/index";

const seed = 73;
const environment = defaultPlantEnvironment();
const nativeCandidates = Object.entries(procPlantPresets)
  .filter(([, candidate]) => !candidate.branchModules && !candidate.weberPenn && !candidate.spaceColonization)
  .map(([id, candidate]) => ({ id, candidate, graph: buildProcPlantGraph(candidate, seed, environment) }))
  .filter(({ graph: candidateGraph }) => candidateGraph.segmentRecords.length > 3 && candidateGraph.segmentRecords.every((record) =>
    candidateGraph.stems[record.startNodeIndex]!.position.distanceTo(candidateGraph.stems[record.endNodeIndex]!.position) > 1e-12));
assert.ok(nativeCandidates.length > 0, "fixture needs a resource-growth-compatible native graph preset");
const { candidate: genome } = nativeCandidates[0]!;
const canonicalA = buildProcPlantTemplate(genome, seed, environment);
const canonicalB = buildProcPlantTemplate(genome, seed, environment);
for (const key of ["pos", "nrm", "uv0", "col", "tintable", "sway", "idx"] as const) {
  assert.deepEqual(canonicalA.template[key], canonicalB.template[key], `canonical ${key} bytes must remain deterministic`);
}

const graph = buildProcPlantGraph(genome, seed, environment);
const snapshot = () => JSON.stringify({
  stems: graph.stems.map((stem) => ({ ...stem, position: stem.position.toArray(), direction: stem.direction.toArray() })),
  segments: graph.segments,
  organs: graph.organs.map((organ) => ({ ...organ, position: organ.position.toArray(), direction: organ.direction.toArray(), right: organ.right.toArray() })),
  records: graph.segmentRecords,
  attachments: graph.attachments.map((attachment) => ({
    ...attachment,
    position: attachment.position.toArray(),
    tangent: attachment.tangent.toArray(),
    right: attachment.right.toArray(),
    up: attachment.up.toArray(),
  })),
});
const sourceSnapshot = snapshot();
const geometryBoundClone = {
  ...graph,
  stems: graph.stems.map((stem) => ({ ...stem, position: stem.position.clone(), direction: stem.direction.clone() })),
};
geometryBoundClone.stems[graph.segmentRecords[0]!.startNodeIndex]!.position.x += 0.001;
assert.notEqual(
  createProcPlantCrownLightPruningGraphSignature(graph),
  createProcPlantCrownLightPruningGraphSignature(geometryBoundClone),
  "light evidence target must bind exact geometry, not topology IDs alone",
);

const pruning = {
  enabled: true,
  confirmationSteps: 3,
  maxCuts: 1,
  maxWorkUnits: 500_000,
  crownLight: { hemisphereSampleCount: 8, candidateTestBudget: 200_000 },
  resourceGrowth: {
    leafAreaScale: 0,
    maintenanceCostPerVolume: 10,
    selfPruneLightThreshold: 1,
    selfPruneVigorThreshold: 1,
    minimumSelfPruneDepth: 1,
  },
} as const;

const directA = applyProcPlantCrownLightPruning(graph, pruning);
const directB = applyProcPlantCrownLightPruning(graph, pruning);
assert.equal(directA.audit.status, "applied");
assert.deepEqual(directA.audit, directB.audit, "audit and target binding must be deterministic");
assert.equal(directA.audit.appliedRootIds.length, 1, "cut cap must limit independent ancestor cuts");
assert.ok(directA.audit.candidateRootIds.length > directA.audit.appliedRootIds.length, "fixture must exercise deferred candidates");
assert.equal(directA.audit.deferredRootIds.length, directA.audit.candidateRootIds.length - 1);
assert.ok(directA.audit.workUnits <= directA.audit.maxWorkUnits);
assert.equal(directA.audit.targetGraphSignature, directA.audit.actualGraphSignature);
assert.ok(directA.graph.segmentRecords.length < graph.segmentRecords.length, "a real subtree must be removed");
assert.ok(directA.graph.attachments.length < graph.attachments.length, "attached crown parts must be repaired/removed");
assert.equal(snapshot(), sourceSnapshot, "pruning must not mutate source graph vectors or arrays");

const integrated = buildProcPlantTemplateWithCrownLightPruning(genome, seed, environment, { crownLightPruning: pruning });
assert.equal(integrated.crownLightPruning?.status, "applied");
assert.equal(integrated.crownLightPruning?.appliedRootIds.length, 1);
assert.ok(integrated.stats.triangles < canonicalA.stats.triangles, "integrated pruning must reduce actual compiled template triangles");
assert.equal(integrated.crownLightPruning?.templateTrianglesBefore, canonicalA.stats.triangles);
assert.equal(integrated.crownLightPruning?.templateTrianglesAfter, integrated.stats.triangles);
assert.equal(integrated.stats.stems, integrated.graph.segmentRecords.length);
assert.ok(integrated.graph.attachments.every((attachment) =>
  attachment.parentSegmentId === null || integrated.graph.segmentRecords.some((record) => record.id === attachment.parentSegmentId)),
"all retained attachments must reference retained topology");

const budgetClosed = applyProcPlantCrownLightPruning(graph, { ...pruning, maxWorkUnits: 1 });
assert.equal(budgetClosed.audit.status, "budget-exceeded");
assert.equal(budgetClosed.graph, graph, "work-cap failure must preserve exact source identity");

const incompatibleGraph = buildProcPlantGraph(procPlantPresets.roseBush!, seed, environment);
const incompatible = applyProcPlantCrownLightPruning(incompatibleGraph, pruning);
assert.equal(incompatible.audit.status, "unsupported-graph");
assert.equal(incompatible.graph, incompatibleGraph, "unsupported native topology must fail closed with exact source identity");

const unsupportedGenome = Object.values(procPlantPresets).find((candidate) => candidate.branchModules)!;
assert.ok(unsupportedGenome.branchModules, "fixture must exercise a non-native generator");
const unsupportedCanonical = buildProcPlantTemplate(unsupportedGenome, seed, environment);
const unsupported = buildProcPlantTemplateWithCrownLightPruning(unsupportedGenome, seed, environment, { crownLightPruning: pruning });
assert.equal(unsupported.crownLightPruning?.status, "unsupported-backend");
assert.equal(unsupported.crownLightPruning?.backend, "branch-module-graph");
assert.deepEqual(unsupported.template.idx, unsupportedCanonical.template.idx, "unsupported backend must preserve canonical geometry");
assert.deepEqual(unsupported.template.pos, unsupportedCanonical.template.pos, "unsupported backend must preserve canonical vertex bytes");

assert.throws(() => applyProcPlantCrownLightPruning(graph, { ...pruning, maxCuts: 33 }), /maxCuts/);
assert.throws(() => applyProcPlantCrownLightPruning(graph, {
  ...pruning,
  crownLight: { ...pruning.crownLight, maxHashCells: 250_001 },
}), /maxHashCells/);
assert.match(directA.audit.note, /not species physiology or spectral radiative transfer/i);

console.log(JSON.stringify({
  before: canonicalA.stats,
  after: integrated.stats,
  candidateRoots: directA.audit.candidateRootIds.length,
  appliedRoots: directA.audit.appliedRootIds,
  deferredRoots: directA.audit.deferredRootIds.length,
  workUnits: directA.audit.workUnits,
  light: directA.audit.lightDiagnostics,
}, null, 2));
console.log("procplant crown-light pruning integration tests passed");
