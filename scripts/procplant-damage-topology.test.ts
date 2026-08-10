import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildProcPlantTemplateFromGraph,
  procPlantPresets,
  type ProcPlantAttachmentAnchor,
  type ProcPlantGraph,
  type ProcPlantOrgan,
  type ProcPlantSegmentRecord,
  type ProcPlantStemNode,
} from "../src/procplants";
import { buildProcPlantOrganVariants } from "../src/procplant-organ-variants";
import {
  applyProcPlantDamageTopologyPlan,
  buildProcPlantDamagedVariantTopology,
  createProcPlantDamageTopologyGraphSignature,
  createProcPlantDamageTopologyPlan,
  deserializeProcPlantDamageTopologyPlan,
  PROCPLANT_DAMAGE_TOPOLOGY_MAX_BROKEN_BRANCHES,
  serializeProcPlantDamageTopologyPlan,
} from "../src/procplant-damage-topology";

const positions: Array<[number, number, number]> = [
  [0, 0, 0], [0, 1, 0], [0.8, 1.5, 0], [1.5, 1.9, 0], [-0.8, 1.45, 0],
];
const stems: ProcPlantStemNode[] = positions.map(([x, y, z], index) => ({
  position: new THREE.Vector3(x, y, z),
  direction: new THREE.Vector3(0, 1, 0),
  radius: Math.max(0.025, 0.12 - index * 0.018),
  depth: index === 0 ? 0 : index <= 2 || index === 4 ? 1 : 2,
  t: index / (positions.length - 1),
  index,
}));
const records: ProcPlantSegmentRecord[] = [
  { id: "trunk", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 1 },
  { id: "branch-a", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 2, depth: 1, axialStart: 1, axialEnd: 1.9 },
  { id: "twig-a", parentSegmentId: "branch-a", startNodeIndex: 2, endNodeIndex: 3, depth: 2, axialStart: 1.9, axialEnd: 2.7 },
  { id: "branch-b", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 4, depth: 1, axialStart: 1, axialEnd: 1.85 },
];
const organs: ProcPlantOrgan[] = [
  [0.1, 1, 0], [0.8, 1.5, 0], [1.5, 1.9, 0], [-0.8, 1.45, 0],
].map(([x, y, z]) => ({
  kind: "leaf",
  position: new THREE.Vector3(x, y, z),
  direction: new THREE.Vector3(0.7, 0.7, 0).normalize(),
  right: new THREE.Vector3(0, 0, 1),
  scale: 0.22,
  t: 1,
}));
const attachment = (id: string, parentSegmentId: string, organIndex: number, depth: number): ProcPlantAttachmentAnchor => ({
  id,
  parentSegmentId,
  axialT: 1,
  position: organs[organIndex]!.position.clone(),
  tangent: new THREE.Vector3(0.7, 0.7, 0).normalize(),
  right: new THREE.Vector3(0, 0, 1),
  up: new THREE.Vector3(-0.7, 0.7, 0).normalize(),
  kind: "leaf",
  depth,
  sway: 0.5,
  organIndex,
});
const graph: ProcPlantGraph = {
  stems,
  segments: [[0, 1], [1, 2], [2, 3], [1, 4]],
  organs,
  segmentRecords: [records[2]!, records[0]!, records[3]!, records[1]!],
  attachments: [
    attachment("leaf:twig-a", "twig-a", 2, 2),
    attachment("leaf:trunk", "trunk", 0, 0),
    attachment("leaf:branch-b", "branch-b", 3, 1),
    attachment("leaf:branch-a", "branch-a", 1, 1),
  ],
};
const snapshot = () => JSON.stringify({
  stems: graph.stems.map((stem) => ({ ...stem, position: stem.position.toArray(), direction: stem.direction.toArray() })),
  segments: graph.segments,
  organs: graph.organs.map((organ) => ({ ...organ, position: organ.position.toArray(), direction: organ.direction.toArray(), right: organ.right.toArray() })),
  records: graph.segmentRecords,
  attachments: graph.attachments.map((entry) => ({
    ...entry,
    position: entry.position.toArray(),
    tangent: entry.tangent.toArray(),
    right: entry.right.toArray(),
    up: entry.up.toArray(),
  })),
});
const sourceBefore = snapshot();
const damagedMasks = buildProcPlantOrganVariants(graph.attachments, {
  season: "summer",
  health: 0,
  maturity: 0,
  wetness: 0,
  snowLoad: 0,
  seed: 0xdecafbad,
});

const omitted = buildProcPlantDamagedVariantTopology(graph, damagedMasks);
assert.equal(omitted.audit.status, "disabled");
assert.strictEqual(omitted.graph, graph, "omitted damage topology must preserve the exact source graph reference");
assert.deepEqual(omitted.scars, []);
assert.equal(snapshot(), sourceBefore, "omitted damage topology must preserve canonical graph bytes");

const missingPlanA = createProcPlantDamageTopologyPlan(graph, damagedMasks, {
  enabled: true,
  missingOrganRate: 1,
  brokenBranchRate: 0,
  maxMissingOrgans: 1,
});
const missingPlanB = createProcPlantDamageTopologyPlan({
  ...graph,
  segmentRecords: [...graph.segmentRecords].reverse(),
  attachments: [...graph.attachments].reverse(),
}, damagedMasks, {
  enabled: true,
  missingOrganRate: 1,
  brokenBranchRate: 0,
  maxMissingOrgans: 1,
});
assert.deepEqual(missingPlanB, missingPlanA, "selection must not depend on public IR ordering");
assert.equal(missingPlanA.missingAttachmentIds.length, 1);
assert.equal(missingPlanA.selection.organCandidatesOmittedByCap, 3);
const missing = applyProcPlantDamageTopologyPlan(graph, missingPlanA);
assert.equal(missing.audit.status, "applied");
assert.deepEqual(missing.audit.appliedMissingAttachmentIds, missingPlanA.missingAttachmentIds);
assert.equal(missing.graph.attachments.length, graph.attachments.length - 1);
assert.equal(missing.graph.organs.length, graph.organs.length - 1);
for (const entry of missing.graph.attachments) {
  assert.ok(entry.organIndex === null || missing.graph.organs[entry.organIndex], "retained attachment indices must be repaired");
}
assert.equal(snapshot(), sourceBefore, "organ loss must not mutate source IR");

const breakPlan = createProcPlantDamageTopologyPlan(graph, damagedMasks, {
  enabled: true,
  missingOrganRate: 0,
  brokenBranchRate: 1,
  maxBrokenBranches: 3,
  maxScars: 1,
});
assert.deepEqual(breakPlan.brokenSegmentIds, ["branch-a", "branch-b", "twig-a"]);
const serialized = serializeProcPlantDamageTopologyPlan(breakPlan);
assert.deepEqual(deserializeProcPlantDamageTopologyPlan(serialized), breakPlan);
assert.equal(serializeProcPlantDamageTopologyPlan(deserializeProcPlantDamageTopologyPlan(serialized)), serialized);
const broken = applyProcPlantDamageTopologyPlan(graph, breakPlan);
assert.equal(broken.audit.status, "partial", "a scar cap smaller than root cuts must be explicit in audit status");
assert.deepEqual(broken.audit.appliedBrokenRootSegmentIds, ["branch-a", "branch-b"]);
assert.deepEqual(broken.audit.brokenSegmentIdsCoveredByAncestor, ["twig-a"]);
assert.deepEqual(broken.audit.removedSegmentIds, ["branch-a", "branch-b", "twig-a"]);
assert.deepEqual(broken.graph.segmentRecords.map((record) => record.id), ["trunk"]);
assert.equal(broken.scars.length, 1);
assert.deepEqual(broken.audit.scarOmittedSegmentIds, ["branch-b"]);
assert.deepEqual(JSON.parse(JSON.stringify(broken.scars)), broken.scars, "scar records must be plain export-ready data");
assert.match(broken.scars[0]!.id, /^damage-scar:[0-9a-f]{8}$/);
assert.equal(broken.scars[0]!.sourceSegmentId, "branch-a");
assert.equal(broken.scars[0]!.parentSegmentId, "trunk");
assert.equal(broken.scars[0]!.position.length, 3);
assert.equal(broken.scars[0]!.tangent.length, 3);
const sourceTemplate = buildProcPlantTemplateFromGraph(procPlantPresets.understoryShrub!, graph);
const brokenTemplate = buildProcPlantTemplateFromGraph(procPlantPresets.understoryShrub!, broken.graph);
assert.ok(brokenTemplate.stats.stems < sourceTemplate.stats.stems);
assert.ok(brokenTemplate.stats.triangles < sourceTemplate.stats.triangles, "broken branches must remove real compiled geometry");
assert.equal(snapshot(), sourceBefore, "branch damage must not mutate source IR");

const capped = createProcPlantDamageTopologyPlan(graph, damagedMasks, {
  enabled: true,
  missingOrganRate: 1,
  brokenBranchRate: 1,
  maxMissingOrgans: 1,
  maxBrokenBranches: 1,
});
assert.equal(capped.missingAttachmentIds.length, 1);
assert.equal(capped.brokenSegmentIds.length, 1);
assert.equal(capped.selection.organCandidatesOmittedByCap, 3);
assert.equal(capped.selection.branchCandidatesOmittedByCap, 2);
assert.throws(() => createProcPlantDamageTopologyPlan(graph, damagedMasks, {
  maxBrokenBranches: PROCPLANT_DAMAGE_TOPOLOGY_MAX_BROKEN_BRANCHES + 1,
}), /maxBrokenBranches/);

const healthyMasks = buildProcPlantOrganVariants(graph.attachments, {
  season: "summer",
  health: 1,
  maturity: 1,
  wetness: 0,
  snowLoad: 0,
  seed: 7,
});
const healthy = buildProcPlantDamagedVariantTopology(graph, healthyMasks, {
  enabled: true,
  missingOrganRate: 1,
  brokenBranchRate: 1,
});
assert.equal(healthy.audit.status, "no-op");
assert.strictEqual(healthy.graph, graph);

const staleGraph: ProcPlantGraph = {
  ...graph,
  stems: graph.stems.map((stem, index) => index === 2
    ? { ...stem, position: stem.position.clone().addScalar(0.01) }
    : stem),
};
const stale = applyProcPlantDamageTopologyPlan(staleGraph, breakPlan);
assert.equal(stale.audit.status, "target-mismatch");
assert.strictEqual(stale.graph, staleGraph, "stale plans must preserve the supplied graph reference");
assert.notEqual(createProcPlantDamageTopologyGraphSignature(staleGraph), breakPlan.target.graphSignature);
assert.throws(() => deserializeProcPlantDamageTopologyPlan(JSON.stringify({
  ...breakPlan,
  brokenSegmentIds: ["branch-b"],
})), /selection counts|fingerprint mismatch/);
const staleMasks = buildProcPlantOrganVariants(graph.attachments.slice(1), damagedMasks.spec);
assert.throws(() => createProcPlantDamageTopologyPlan(graph, staleMasks, { enabled: true }), /does not match/);
assert.equal(snapshot(), sourceBefore);

console.log("ok 1 - omitted and healthy damage topology paths preserve canonical source identity");
console.log("ok 2 - organ loss is deterministic, capped, attachment-aware, and repairs organ indices");
console.log("ok 3 - branch breaks honor ancestry and emit capped export-ready scar records");
console.log("ok 4 - signatures reject stale graphs, stale masks, and tampered serialized plans");
