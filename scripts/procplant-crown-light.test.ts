import assert from "node:assert/strict";
import * as THREE from "three";
import type { ProcPlantAttachmentAnchor, ProcPlantGraph, ProcPlantOrgan, ProcPlantSegmentRecord, ProcPlantStemNode } from "../src/procplants";
import {
  createProcPlantCrownLightSampler,
  evaluateProcPlantCrownLight,
} from "../src/procplant-crown-light";
import { evaluateProcPlantGraphResourceGrowth } from "../src/procplant-graph-resource-growth";

const points = [
  [0, -1, 0], [0, 0, 0],
  [-1, 1.2, 0], [1, 1.2, 0],
  [3, -1, 0], [3, 0, 0],
] as const;
const stems: ProcPlantStemNode[] = points.map(([x, y, z], index) => ({
  position: new THREE.Vector3(x, y, z),
  direction: new THREE.Vector3(0, 1, 0),
  radius: index === 2 || index === 3 ? 0.52 : 0.08,
  depth: 0,
  t: index % 2,
  index,
}));
const records: ProcPlantSegmentRecord[] = [
  { id: "target", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 1 },
  { id: "shade-bar", parentSegmentId: null, startNodeIndex: 2, endNodeIndex: 3, depth: 0, axialStart: 0, axialEnd: 1 },
  { id: "open-axis", parentSegmentId: null, startNodeIndex: 4, endNodeIndex: 5, depth: 0, axialStart: 0, axialEnd: 1 },
];
const attachment = (id: string, x: number, parentSegmentId: string): ProcPlantAttachmentAnchor => ({
  id,
  parentSegmentId,
  axialT: 1,
  position: new THREE.Vector3(x, 0, 0),
  tangent: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 0, 1),
  kind: "branch-tip",
  depth: 0,
  sway: 0,
  organIndex: null,
});
const graph: ProcPlantGraph = {
  stems,
  segments: [[0, 1], [2, 3], [4, 5]],
  organs: [],
  segmentRecords: [records[2]!, records[0]!, records[1]!],
  attachments: [attachment("open", 3, "open-axis"), attachment("shaded", 0, "target")],
};
const snapshot = {
  records: graph.segmentRecords.map((record) => ({ ...record })),
  attachments: graph.attachments.map((entry) => ({ id: entry.id, position: entry.position.toArray() })),
};
const options = { hemisphereSampleCount: 24, maxDistance: 2.5, cellSize: 0.3 };
const first = evaluateProcPlantCrownLight(graph, options);
const byAttachment = new Map(first.attachments.map((entry) => [entry.attachmentId, entry]));
assert.ok(byAttachment.get("open")!.lightFraction > 0.9, "open crown target should retain most hemisphere light");
assert.ok(byAttachment.get("shaded")!.lightFraction < byAttachment.get("open")!.lightFraction - 0.2,
  "overhead capsule should reduce the shaded target light fraction");
assert.ok(first.segments.find((entry) => entry.segmentId === "shade-bar")!.lightFraction > 0,
  "segment probes must exclude their own capsule");
assert.ok(first.diagnostics.candidateTests < first.diagnostics.exhaustiveCandidateTests,
  "spatial hashing should reduce intersection work for the sparse crown");
assert.match(first.approximation, /not calibrated/);

const reordered = evaluateProcPlantCrownLight({
  ...graph,
  segmentRecords: [...graph.segmentRecords].reverse(),
  attachments: [...graph.attachments].reverse(),
}, options);
assert.deepEqual(first, reordered, "public IR array order must not affect light probes or diagnostics");
assert.deepEqual(snapshot, {
  records: graph.segmentRecords.map((record) => ({ ...record })),
  attachments: graph.attachments.map((entry) => ({ id: entry.id, position: entry.position.toArray() })),
}, "light evaluation must not mutate the source graph");

const resource = evaluateProcPlantGraphResourceGrowth(graph, createProcPlantCrownLightSampler(first), {
  unresolvedFoliageArea: 0.2,
  resourceGrowth: { initialResource: 1 },
});
for (const segment of resource.segments) {
  const light = first.segments.find((entry) => entry.segmentId === segment.segmentId)!;
  assert.ok(Math.abs(segment.lightExposure - light.lightFraction) < 1e-12,
    "crown samples must plug directly into the resource-growth callback");
}

const parentGraph: ProcPlantGraph = {
  ...graph,
  segmentRecords: [
    records[0]!,
    { ...records[1]!, id: "child", parentSegmentId: "target", startNodeIndex: 1, endNodeIndex: 2 },
  ],
  segments: [[0, 1], [1, 2]],
  attachments: [],
};
const parentExcluded = evaluateProcPlantCrownLight(parentGraph, {
  directions: [{ direction: { x: 0, y: 1, z: 0 } }],
  maxDistance: 2,
});
assert.equal(parentExcluded.segments.find((entry) => entry.segmentId === "child")!.lightFraction, 1,
  "child probes must exclude self and immediate parent capsules");

const card = (x: number): ProcPlantOrgan => ({
  kind: "leaf",
  position: new THREE.Vector3(x, 1, 0),
  direction: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(0, 0, 1),
  scale: 0.8,
  t: 1,
});
const cardAttachment = (id: string, x: number, organIndex: number | null): ProcPlantAttachmentAnchor => ({
  ...attachment(id, x, "target"),
  position: new THREE.Vector3(x, organIndex === null ? 0 : 1, 0),
  organIndex,
  kind: organIndex === null ? "branch-tip" : "leaf",
});
const cardGraph: ProcPlantGraph = {
  stems: [],
  segments: [],
  segmentRecords: [],
  organs: [card(0), card(3)],
  attachments: [
    cardAttachment("shade-under-card", 0, null),
    cardAttachment("self-card-a", 0, 0),
    cardAttachment("self-card-b", 3, 1),
  ],
};
const cardOptions = { directions: [{ direction: { x: 0, y: 1, z: 0 } }], maxDistance: 2 };
const cardLight = evaluateProcPlantCrownLight(cardGraph, cardOptions);
assert.equal(cardLight.attachments.find((entry) => entry.attachmentId === "shade-under-card")!.lightFraction, 0,
  "a horizontal organ card must occlude a target below it");
assert.equal(cardLight.attachments.find((entry) => entry.attachmentId === "self-card-a")!.lightFraction, 1,
  "an attachment must exclude its own organ card");
const reorderedCards = evaluateProcPlantCrownLight({
  ...cardGraph,
  organs: [cardGraph.organs[1]!, cardGraph.organs[0]!],
  attachments: cardGraph.attachments.map((entry) => ({
    ...entry,
    organIndex: entry.organIndex === 0 ? 1 : entry.organIndex === 1 ? 0 : null,
  })).reverse(),
}, cardOptions);
assert.deepEqual(cardLight, reorderedCards, "organ reordering with repaired public indices must preserve results and work diagnostics");

assert.throws(() => evaluateProcPlantCrownLight(graph, { maxAttachmentTargets: 1 }), /attachment target cap/);
assert.throws(() => evaluateProcPlantCrownLight(graph, { candidateTestBudget: 1, cellSize: 10 }), /candidate-test budget/);

console.log("procplant crown-light tests passed");
