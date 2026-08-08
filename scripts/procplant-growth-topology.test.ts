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
import {
  createProcPlantGrowthSimulationState,
  stepProcPlantGrowthSimulation,
} from "../src/procplant-growth-simulation";
import {
  applyProcPlantGrowthTopologyPlan,
  createProcPlantGrowthTopologyPlan,
  deserializeProcPlantGrowthTopologyPlan,
  serializeProcPlantGrowthTopologyPlan,
  type ProcPlantGrowthTopologyPlan,
} from "../src/procplant-growth-topology";
import { pruneProcPlantGraph } from "../src/procplant-pruning";

const stems: ProcPlantStemNode[] = [
  [0, 0, 0], [0, 1, 0], [1, 1.3, 0], [2, 1.5, 0],
].map(([x, y, z], index) => ({
  position: new THREE.Vector3(x, y, z),
  direction: new THREE.Vector3(0, 1, 0),
  radius: 0.08,
  depth: index === 0 ? 0 : index - 1,
  t: index / 3,
  index,
}));
const records: ProcPlantSegmentRecord[] = [
  { id: "trunk", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 1 },
  { id: "shade", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 2, depth: 1, axialStart: 1, axialEnd: 2 },
  { id: "shade-tip", parentSegmentId: "shade", startNodeIndex: 2, endNodeIndex: 3, depth: 2, axialStart: 2, axialEnd: 3 },
];
const organs: ProcPlantOrgan[] = [0, 1].map((index) => ({
  kind: "leaf",
  position: new THREE.Vector3(index + 1, 1.3 + index * 0.2, 0),
  direction: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(0, 0, 1),
  scale: 0.2,
  t: 1,
}));
const attachment = (id: string, parentSegmentId: string, organIndex: number): ProcPlantAttachmentAnchor => ({
  id,
  parentSegmentId,
  axialT: 1,
  position: organs[organIndex]!.position.clone(),
  tangent: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(0, 0, 1),
  up: new THREE.Vector3(0, -1, 0),
  kind: "leaf",
  depth: organIndex + 1,
  sway: 0.5,
  organIndex,
});
const dormantBud: ProcPlantAttachmentAnchor = {
  id: "bud:shade-tip",
  parentSegmentId: "shade-tip",
  axialT: 1,
  position: stems[3]!.position.clone(),
  tangent: new THREE.Vector3(1, 0.2, 0).normalize(),
  right: new THREE.Vector3(0, 0, 1),
  up: new THREE.Vector3(-0.196116, 0.980581, 0),
  kind: "branch-tip",
  depth: 2,
  sway: 0.65,
  organIndex: null,
};
const graph: ProcPlantGraph = {
  stems,
  segments: [[0, 1], [1, 2], [2, 3]],
  organs,
  segmentRecords: [records[2]!, records[0]!, records[1]!],
  attachments: [attachment("leaf:tip", "shade-tip", 1), dormantBud, attachment("leaf:shade", "shade", 0)],
};
const sourceSnapshot = {
  stems: graph.stems.map((stem) => ({ position: stem.position.toArray(), direction: stem.direction.toArray(), radius: stem.radius })),
  segments: graph.segmentRecords.map((record) => ({ ...record })),
  attachments: graph.attachments.map((entry) => ({ id: entry.id, organIndex: entry.organIndex, position: entry.position.toArray(), tangent: entry.tangent.toArray() })),
};

const initial = createProcPlantGrowthSimulationState(graph);
const step = stepProcPlantGrowthSimulation(graph, initial, (context) => [{
  direction: { x: 0, y: 1, z: 0 },
  irradiance: context.segmentId === "trunk" ? 1 : 0,
}], {
  selfPruneConfirmationSteps: 1,
  adapter: {
    selfPruneLightThreshold: 0.1,
    selfPruneVigorThreshold: 0.5,
    minimumSelfPruneDepth: 1,
    resourceGrowth: { lightUseEfficiency: 0 },
  },
});
assert.equal(step.segments.find((entry) => entry.segmentId === "shade")!.selfPruneConfirmed, true);
const plan = createProcPlantGrowthTopologyPlan(graph, step);
assert.deepEqual(plan.recommendations.map((entry) => [entry.kind, entry.segmentId]), [["self-prune", "shade"]]);
const serialized = serializeProcPlantGrowthTopologyPlan(plan);
assert.deepEqual(deserializeProcPlantGrowthTopologyPlan(serialized), plan);
assert.equal(serializeProcPlantGrowthTopologyPlan(deserializeProcPlantGrowthTopologyPlan(serialized)), serialized);

const applied = applyProcPlantGrowthTopologyPlan(graph, plan);
assert.equal(applied.audit.status, "applied");
assert.deepEqual(applied.audit.appliedSelfPruneRootIds, ["shade"]);
assert.deepEqual(applied.audit.removedSegmentIds, ["shade", "shade-tip"]);
assert.deepEqual(applied.audit.removedAttachmentIds, ["bud:shade-tip", "leaf:shade", "leaf:tip"]);
assert.equal(applied.audit.removedOrganCount, 2);
assert.deepEqual(applied.graph.segmentRecords.map((record) => record.id), ["trunk"]);
const expected = pruneProcPlantGraph({
  ...graph,
  segmentRecords: [...graph.segmentRecords].sort((left, right) => left.id.localeCompare(right.id)),
  attachments: [...graph.attachments].sort((left, right) => left.id.localeCompare(right.id)),
}, { operation: "remove", selection: { kind: "segmentIds", segmentIds: ["shade"] } });
assert.deepEqual(applied.graph, expected.graph, "confirmed topology mutation must use existing pruning repair semantics exactly");
assert.deepEqual(sourceSnapshot, {
  stems: graph.stems.map((stem) => ({ position: stem.position.toArray(), direction: stem.direction.toArray(), radius: stem.radius })),
  segments: graph.segmentRecords.map((record) => ({ ...record })),
  attachments: graph.attachments.map((entry) => ({ id: entry.id, organIndex: entry.organIndex, position: entry.position.toArray(), tangent: entry.tangent.toArray() })),
}, "topology application must not mutate the source graph");

const noConfirmationStep = stepProcPlantGrowthSimulation(graph, initial, () => [{
  direction: { x: 0, y: 1, z: 0 }, irradiance: 0,
}], { selfPruneConfirmationSteps: 3 });
const noOpPlan = createProcPlantGrowthTopologyPlan(graph, noConfirmationStep);
const noOp = applyProcPlantGrowthTopologyPlan(graph, noOpPlan);
assert.equal(noOp.audit.status, "no-op");
assert.strictEqual(noOp.graph, graph, "no confirmed recommendations must preserve the exact source reference");

const dormant = createProcPlantGrowthSimulationState(graph, { initiallyDormantSegmentIds: ["shade-tip"] });
const activationStep = stepProcPlantGrowthSimulation(graph, dormant, () => [{
  direction: { x: 0, y: 1, z: 0 }, irradiance: 1,
}], {
  resourceInput: 2,
  activationConfirmationSteps: 1,
  adapter: { resourceGrowth: { activationResourceThreshold: 0.001, minimumActivationLight: 0.1 } },
});
assert.equal(activationStep.segments.find((entry) => entry.segmentId === "shade-tip")!.action, "activate");
const activationPlan = createProcPlantGrowthTopologyPlan(graph, activationStep);
const activation = applyProcPlantGrowthTopologyPlan(graph, activationPlan);
assert.equal(activation.audit.status, "applied");
assert.deepEqual(activation.audit.requestedActivationSegmentIds, ["shade-tip"]);
assert.deepEqual(activation.audit.activatedBudIds, ["bud:shade-tip"]);
assert.equal(activation.audit.addedSegmentIds.length, 1);
assert.match(activation.audit.addedSegmentIds[0]!, /^growth:0:[0-9a-f]{8}$/);
assert.deepEqual(activation.audit.addedAttachmentIds, [`${activation.audit.addedSegmentIds[0]}:tip`]);
assert.equal(activation.graph.segmentRecords.length, graph.segmentRecords.length + 1);
assert.equal(activation.graph.stems.length, graph.stems.length + 1);
assert.equal(activation.graph.segments.length, graph.segments.length + 1);
assert.equal(activation.graph.attachments.some((entry) => entry.id === "bud:shade-tip"), false,
  "materialized dormant bud must be consumed");
const activatedRecord = activation.graph.segmentRecords.find((entry) => entry.id === activation.audit.addedSegmentIds[0])!;
assert.equal(activatedRecord.parentSegmentId, "shade-tip");
const activatedTip = activation.graph.attachments.find((entry) => entry.id === activation.audit.addedAttachmentIds[0])!;
assert.equal(activatedTip.parentSegmentId, activatedRecord.id);
assert.equal(activatedTip.kind, "branch-tip");
assert.equal(activatedTip.organIndex, null);
assert.ok(activation.graph.stems[activatedRecord.endNodeIndex]!.position.distanceTo(stems[3]!.position) > 0.04);
const sourceTemplate = buildProcPlantTemplateFromGraph(procPlantPresets.understoryShrub!, graph);
const activatedTemplate = buildProcPlantTemplateFromGraph(procPlantPresets.understoryShrub!, activation.graph);
assert.ok(activatedTemplate.stats.stems > sourceTemplate.stats.stems);
assert.ok(activatedTemplate.stats.triangles > sourceTemplate.stats.triangles,
  "materialized bud shoots must compile into additional real stem geometry");
const activationReordered = applyProcPlantGrowthTopologyPlan({
  ...graph,
  segmentRecords: [...graph.segmentRecords].reverse(),
  attachments: [...graph.attachments].reverse(),
}, activationPlan);
assert.deepEqual(activationReordered, activation, "bud materialization must be independent of public IR ordering");
const replay = applyProcPlantGrowthTopologyPlan(activation.graph, activationPlan);
assert.equal(replay.audit.status, "target-mismatch", "a topology-bound plan must not replay after materialization");
assert.deepEqual(sourceSnapshot, {
  stems: graph.stems.map((stem) => ({ position: stem.position.toArray(), direction: stem.direction.toArray(), radius: stem.radius })),
  segments: graph.segmentRecords.map((record) => ({ ...record })),
  attachments: graph.attachments.map((entry) => ({ id: entry.id, organIndex: entry.organIndex, position: entry.position.toArray(), tangent: entry.tangent.toArray() })),
}, "bud activation must not mutate the source graph");

const noBudGraph = { ...graph, attachments: graph.attachments.filter((entry) => entry.kind !== "branch-tip") };
const noBudInitial = createProcPlantGrowthSimulationState(noBudGraph, { initiallyDormantSegmentIds: ["shade-tip"] });
const noBudStep = stepProcPlantGrowthSimulation(noBudGraph, noBudInitial, () => [{
  direction: { x: 0, y: 1, z: 0 }, irradiance: 1,
}], {
  resourceInput: 2,
  activationConfirmationSteps: 1,
  adapter: { resourceGrowth: { activationResourceThreshold: 0.001, minimumActivationLight: 0.1 } },
});
const noBud = applyProcPlantGrowthTopologyPlan(noBudGraph, createProcPlantGrowthTopologyPlan(noBudGraph, noBudStep));
assert.equal(noBud.audit.status, "unsupported");
assert.strictEqual(noBud.graph, noBudGraph);
assert.match(noBud.audit.entries[0]!.reason, /no stable terminal branch-tip/);
assert.throws(() => applyProcPlantGrowthTopologyPlan(graph, activationPlan, { shootLengthScale: 0 }), /shootLengthScale/);

const shadeBud: ProcPlantAttachmentAnchor = {
  ...dormantBud,
  id: "bud:shade",
  parentSegmentId: "shade",
  position: stems[2]!.position.clone(),
  depth: 1,
};
const cappedGraph = { ...graph, attachments: [...graph.attachments, shadeBud] };
const cappedInitial = createProcPlantGrowthSimulationState(cappedGraph, { initiallyDormantSegmentIds: ["shade", "shade-tip"] });
const cappedStep = stepProcPlantGrowthSimulation(cappedGraph, cappedInitial, () => [{
  direction: { x: 0, y: 1, z: 0 }, irradiance: 1,
}], {
  resourceInput: 5,
  activationConfirmationSteps: 1,
  adapter: { resourceGrowth: { activationResourceThreshold: 0.001, minimumActivationLight: 0.1 } },
});
const capped = applyProcPlantGrowthTopologyPlan(cappedGraph, createProcPlantGrowthTopologyPlan(cappedGraph, cappedStep), { maxActivations: 1 });
assert.equal(capped.audit.status, "partial");
assert.equal(capped.audit.addedSegmentIds.length, 1);
assert.equal(capped.audit.entries.filter((entry) => entry.kind === "activate" && entry.status === "unsupported").length, 1);
assert.match(capped.audit.entries.find((entry) => entry.kind === "activate" && entry.status === "unsupported")!.reason, /cap 1/);

const pruneActivationPlan = deserializeProcPlantGrowthTopologyPlan(JSON.stringify({
  ...plan,
  recommendations: [
    { kind: "self-prune", segmentId: "shade", confirmed: true, evidenceSteps: 2 },
    { kind: "activate", segmentId: "shade-tip", confirmed: true, evidenceSteps: 2 },
  ],
}));
const pruneActivation = applyProcPlantGrowthTopologyPlan(graph, pruneActivationPlan);
assert.equal(pruneActivation.audit.status, "applied");
assert.deepEqual(pruneActivation.audit.addedSegmentIds, []);
assert.equal(pruneActivation.audit.entries.find((entry) => entry.kind === "activate")!.status, "covered-by-ancestor");

const unknownPlan = deserializeProcPlantGrowthTopologyPlan(JSON.stringify({
  ...plan,
  recommendations: [{ kind: "self-prune", segmentId: "missing", confirmed: true, evidenceSteps: 2 }],
}));
const unmatched = applyProcPlantGrowthTopologyPlan(graph, unknownPlan);
assert.equal(unmatched.audit.status, "unmatched");
assert.strictEqual(unmatched.graph, graph);

const reordered = applyProcPlantGrowthTopologyPlan({
  ...graph,
  segmentRecords: [...graph.segmentRecords].reverse(),
  attachments: [...graph.attachments].reverse(),
}, deserializeProcPlantGrowthTopologyPlan(serialized));
assert.deepEqual(reordered.audit, applied.audit, "audit and canonical mutation must be stable across public IR ordering");
assert.deepEqual(reordered.graph, applied.graph);

const changedGraph = { ...graph, segmentRecords: graph.segmentRecords.filter((record) => record.id !== "shade-tip") };
const mismatch = applyProcPlantGrowthTopologyPlan(changedGraph, plan);
assert.equal(mismatch.audit.status, "target-mismatch");
assert.strictEqual(mismatch.graph, changedGraph);

const coveredPlan: ProcPlantGrowthTopologyPlan = deserializeProcPlantGrowthTopologyPlan(JSON.stringify({
  ...plan,
  recommendations: [
    { kind: "self-prune", segmentId: "shade", confirmed: true, evidenceSteps: 2 },
    { kind: "self-prune", segmentId: "shade-tip", confirmed: true, evidenceSteps: 2 },
  ],
}));
const covered = applyProcPlantGrowthTopologyPlan(graph, coveredPlan);
assert.deepEqual(covered.audit.appliedSelfPruneRootIds, ["shade"]);
assert.equal(covered.audit.entries.find((entry) => entry.segmentId === "shade-tip")!.status, "covered-by-ancestor");

console.log("procplant growth-topology mutation tests passed");
