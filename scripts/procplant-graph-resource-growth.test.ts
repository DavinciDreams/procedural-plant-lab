import assert from "node:assert/strict";
import * as THREE from "three";
import {
  PROCPLANT_GRAPH_RESOURCE_GROWTH_CONTRACT_VERSION,
  evaluateProcPlantGraphResourceGrowth,
  type ProcPlantGraphLightSampleContext,
} from "../src/procplant-graph-resource-growth";
import type {
  ProcPlantAttachmentAnchor,
  ProcPlantGraph,
  ProcPlantOrgan,
  ProcPlantSegmentRecord,
  ProcPlantStemNode,
} from "../src/procplants";

const positions = [
  [0, 0, 0],
  [0, 1, 0],
  [0, 2, 0],
  [1, 2, 0],
  [-1, 1.5, 0],
  [-2, 2, 0],
] as const;
const stems: ProcPlantStemNode[] = positions.map(([x, y, z], index) => ({
  position: new THREE.Vector3(x, y, z),
  direction: new THREE.Vector3(0, 1, 0),
  radius: index === 0 ? 0.14 : 0.1,
  depth: 0,
  t: index / (positions.length - 1),
  index,
}));
const recordsById = new Map<string, ProcPlantSegmentRecord>([
  ["trunk", { id: "trunk", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 1 }],
  ["leader", { id: "leader", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 2, depth: 0, axialStart: 1, axialEnd: 2 }],
  ["sunny", { id: "sunny", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 3, depth: 1, axialStart: 1, axialEnd: 2 }],
  ["shade", { id: "shade", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 4, depth: 1, axialStart: 1, axialEnd: 2 }],
  ["shade-tip", { id: "shade-tip", parentSegmentId: "shade", startNodeIndex: 4, endNodeIndex: 5, depth: 2, axialStart: 2, axialEnd: 3 }],
]);
const organs: ProcPlantOrgan[] = [
  { kind: "leaf", position: new THREE.Vector3(), direction: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0), scale: 2, t: 1 },
  { kind: "leaf", position: new THREE.Vector3(), direction: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0), scale: 1, t: 1 },
];
const attachment = (id: string, parentSegmentId: string, organIndex: number | null, kind: "leaf" | "leaf-site"): ProcPlantAttachmentAnchor => ({
  id,
  parentSegmentId,
  axialT: 1,
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 0, 1),
  kind,
  depth: 0,
  sway: 0,
  organIndex,
});
const graph: ProcPlantGraph = {
  stems,
  segments: [[0, 1], [1, 2], [1, 3], [1, 4], [4, 5]],
  organs,
  segmentRecords: [recordsById.get("shade-tip")!, recordsById.get("sunny")!, recordsById.get("trunk")!, recordsById.get("shade")!, recordsById.get("leader")!],
  attachments: [
    attachment("leaf:leader", "leader", 0, "leaf"),
    attachment("site:sunny", "sunny", null, "leaf-site"),
    attachment("leaf:trunk", "trunk", 1, "leaf"),
  ],
};

const snapshot = {
  records: graph.segmentRecords.map((record) => ({ ...record })),
  stems: graph.stems.map((stem) => ({ position: stem.position.toArray(), radius: stem.radius })),
  attachments: graph.attachments.map((item) => ({ id: item.id, parentSegmentId: item.parentSegmentId, organIndex: item.organIndex })),
};
const callOrder: string[] = [];
const irradianceById: Record<string, number> = { trunk: 0.7, leader: 0.95, sunny: 0.8, shade: 0.04, "shade-tip": 0.02 };
const sampleLight = (context: Readonly<ProcPlantGraphLightSampleContext>) => {
  callOrder.push(context.segmentId);
  return [{ direction: { x: 0.2, y: 1, z: 0 }, irradiance: irradianceById[context.segmentId]! }];
};
const options = {
  leafAreaScale: 0.5,
  unresolvedFoliageArea: 0.2,
  maintenanceCostPerVolume: 1,
  growthDemandPerVolume: 100,
  selfPruneLightThreshold: 0.1,
  selfPruneVigorThreshold: 0.25,
  resourceGrowth: { reserveFraction: 0.1, apicalDominance: 0.9 },
};
const first = evaluateProcPlantGraphResourceGrowth(graph, sampleLight, options);
assert.equal(first.version, PROCPLANT_GRAPH_RESOURCE_GROWTH_CONTRACT_VERSION);
assert.deepEqual(callOrder, ["leader", "shade", "shade-tip", "sunny", "trunk"], "sampling order must follow stable segment IDs");
assert.deepEqual(first.segments.map((segment) => segment.segmentId), callOrder);

const byId = new Map(first.segments.map((segment) => [segment.segmentId, segment]));
assert.equal(byId.get("leader")!.budRole, "apical");
assert.equal(byId.get("sunny")!.budRole, "lateral");
assert.equal(byId.get("shade")!.budRole, "lateral");
assert.equal(byId.get("shade-tip")!.budRole, "apical");
assert.equal(byId.get("leader")!.approximateLeafArea, 2, "organ area uses scale squared times leafAreaScale");
assert.equal(byId.get("sunny")!.approximateLeafArea, 0.2, "unresolved leaf sites use the explicit fallback area");
assert.equal(byId.get("shade")!.approximateLeafArea, 0);
assert.ok(byId.get("leader")!.growthScale > byId.get("shade")!.growthScale);
assert.equal(byId.get("shade")!.recommendSelfPrune, true, "highest wholly weak branch should carry the cut recommendation");
assert.equal(byId.get("shade-tip")!.recommendSelfPrune, false, "descendant cuts are redundant when the parent branch is recommended");
assert.equal(byId.get("trunk")!.recommendSelfPrune, false, "root segments are protected by the minimum prune depth");
assert.ok(first.limitations.some((text) => text.includes("one timestep")));

assert.deepEqual(snapshot, {
  records: graph.segmentRecords.map((record) => ({ ...record })),
  stems: graph.stems.map((stem) => ({ position: stem.position.toArray(), radius: stem.radius })),
  attachments: graph.attachments.map((item) => ({ id: item.id, parentSegmentId: item.parentSegmentId, organIndex: item.organIndex })),
}, "adapter must not mutate the public graph");

const reorderedGraph: ProcPlantGraph = {
  ...graph,
  segmentRecords: [...graph.segmentRecords].reverse(),
  attachments: [...graph.attachments].reverse(),
};
const reordered = evaluateProcPlantGraphResourceGrowth(reorderedGraph, (context) => [{
  direction: { x: 0.2, y: 1, z: 0 },
  irradiance: irradianceById[context.segmentId]!,
}], options);
assert.deepEqual(first, reordered, "graph and attachment array order must not affect recommendations");

const multiRoot = evaluateProcPlantGraphResourceGrowth({
  ...graph,
  segmentRecords: [
    recordsById.get("trunk")!,
    { ...recordsById.get("leader")!, parentSegmentId: null },
  ],
}, (context) => [{ direction: { x: 0, y: 1, z: 0 }, irradiance: irradianceById[context.segmentId]! }], options);
assert.ok(multiRoot.segments.every((segment) => segment.topologyDepth === 0 && segment.budRole === "apical"),
  "multiple graph roots must remain independent apical axes under the synthetic resource root");

assert.throws(() => evaluateProcPlantGraphResourceGrowth({
  ...graph,
  segmentRecords: [{ ...recordsById.get("trunk")!, endNodeIndex: 99 }],
}, () => []), /endNodeIndex/);
assert.throws(() => evaluateProcPlantGraphResourceGrowth({
  ...graph,
  segmentRecords: [
    { ...recordsById.get("shade")!, parentSegmentId: "shade-tip" },
    { ...recordsById.get("shade-tip")!, parentSegmentId: "shade" },
  ],
}, () => []), /cycle/);
assert.throws(() => evaluateProcPlantGraphResourceGrowth(graph, () => [{
  direction: { x: 0, y: 1, z: 0 },
  irradiance: Number.NaN,
}]), /irradiance/);

console.log("procplant graph resource-growth tests passed");
