import assert from "node:assert/strict";
import * as THREE from "three";
import type { ProcPlantGraph } from "../src/procplants";
import {
  PROCPLANT_ORGAN_PLACEMENT_CONTRACT,
  PROCPLANT_ORGAN_PLACEMENT_VERSION,
  appendProcPlantOrganPlacement,
  applyProcPlantOrganPlacementOverrides,
  createProcPlantOrganPlacementPackage,
  createProcPlantOrganPlacementTarget,
  deriveProcPlantOrganPlacementAzimuth,
  procPlantOrganPlacementGraphSignature,
  serializeProcPlantOrganPlacementPackage,
  undoLastProcPlantOrganPlacement,
  type ProcPlantOrganPlacementPackage,
} from "../src/procplant-organ-placement-overrides";

const graphFixture = (): ProcPlantGraph => ({
  stems: [
    { position: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.1, depth: 0, t: 0, index: 0 },
    { position: new THREE.Vector3(0, 1, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.07, depth: 0, t: 0.5, index: 1 },
    { position: new THREE.Vector3(1, 1.6, 0), direction: new THREE.Vector3(1, 0.6, 0).normalize(), radius: 0.035, depth: 1, t: 1, index: 2 },
  ],
  segments: [[0, 1], [1, 2]],
  segmentRecords: [
    { id: "trunk:0", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 0.5 },
    { id: "branch:0", parentSegmentId: "trunk:0", startNodeIndex: 1, endNodeIndex: 2, depth: 1, axialStart: 0.5, axialEnd: 1 },
  ],
  organs: [],
  attachments: [{
    id: "existing-frame",
    parentSegmentId: "branch:0",
    axialT: 0.4,
    position: new THREE.Vector3(0.4, 1.24, 0),
    tangent: new THREE.Vector3(1, 0.6, 0).normalize(),
    right: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0.5145, -0.8575, 0),
    kind: "leaf-site",
    depth: 1,
    sway: 0.2,
    organIndex: null,
  }],
});

const graph = graphFixture();
const reversedRecords = { ...graph, segmentRecords: [...graph.segmentRecords].reverse() };
assert.equal(procPlantOrganPlacementGraphSignature(graph), procPlantOrganPlacementGraphSignature(reversedRecords));

const target = createProcPlantOrganPlacementTarget("fixture", 42, graph);
let placementPackage = createProcPlantOrganPlacementPackage(target);
const first = appendProcPlantOrganPlacement(placementPackage, {
  kind: "leaf",
  segmentId: "branch:0",
  axialT: 0.4,
  azimuth: 0.5,
  scale: 0.24,
});
assert.equal(first.reason, null);
assert(first.operation);
assert.equal(placementPackage.operations.length, 0, "append must not mutate the source package");
placementPackage = first.package;

const tooClose = appendProcPlantOrganPlacement(placementPackage, {
  kind: "flower",
  segmentId: "branch:0",
  axialT: 0.42,
  azimuth: 1,
  scale: 0.8,
});
assert.equal(tooClose.reason, "spacing");
assert.strictEqual(tooClose.package, placementPackage);

const second = appendProcPlantOrganPlacement(placementPackage, {
  kind: "fruit",
  segmentId: "branch:0",
  axialT: 0.72,
  azimuth: -0.8,
  scale: 0.16,
  color: 0xc7472f,
  secondaryColor: 0x6e281c,
});
assert(second.operation);
placementPackage = second.package;
assert.notEqual(first.operation.id, second.operation.id);

const serializedA = serializeProcPlantOrganPlacementPackage({ ...placementPackage, operations: [...placementPackage.operations].reverse() });
const serializedB = serializeProcPlantOrganPlacementPackage(placementPackage);
assert.equal(serializedA, serializedB, "serialization order must be deterministic");
assert.deepEqual(JSON.parse(serializedA).operations.map((operation: { ordinal: number }) => operation.ordinal), [0, 1]);

const sourceOrganArray = graph.organs;
const sourceAttachmentArray = graph.attachments;
const applied = applyProcPlantOrganPlacementOverrides(graph, target, placementPackage);
assert.equal(applied.changed, true);
assert.equal(applied.targetMatched, true);
assert.deepEqual(applied.appliedOperationIds, [first.operation.id, second.operation.id]);
assert.notStrictEqual(applied.graph, graph);
assert.strictEqual(graph.organs, sourceOrganArray);
assert.strictEqual(graph.attachments, sourceAttachmentArray);
assert.equal(graph.organs.length, 0);
assert.deepEqual(applied.graph.organs.map((organ) => organ.kind), ["leaf", "fruit"]);
for (const attachment of applied.graph.attachments.slice(graph.attachments.length)) {
  assert(Math.abs(attachment.tangent.length() - 1) < 1e-6);
  assert(Math.abs(attachment.right.length() - 1) < 1e-6);
  assert(Math.abs(attachment.up.length() - 1) < 1e-6);
  assert(Math.abs(attachment.tangent.dot(attachment.right)) < 1e-6);
  assert(attachment.tangent.clone().cross(attachment.right).dot(attachment.up) > 0.9999);
}

const moved = graphFixture();
moved.stems[1]!.position.set(2, 2, 1);
moved.stems[2]!.position.set(3.5, 2.5, 1.5);
assert.equal(procPlantOrganPlacementGraphSignature(moved), target.graphSignature, "geometry motion must preserve the topology signature");
const movedTarget = createProcPlantOrganPlacementTarget("fixture", 42, moved);
const movedApplied = applyProcPlantOrganPlacementOverrides(moved, movedTarget, placementPackage);
assert.equal(movedApplied.changed, true);
assert.notDeepEqual(movedApplied.graph.organs[0]!.position.toArray(), applied.graph.organs[0]!.position.toArray());

const mismatch = applyProcPlantOrganPlacementOverrides(graph, createProcPlantOrganPlacementTarget("fixture", 43, graph), placementPackage);
assert.strictEqual(mismatch.graph, graph, "target mismatch must preserve the exact source reference");
assert.equal(mismatch.changed, false);
assert.equal(mismatch.targetMatched, false);
assert.equal(mismatch.unsupported[0]?.reason, "target-mismatch");

const empty = applyProcPlantOrganPlacementOverrides(graph, target, createProcPlantOrganPlacementPackage(target));
assert.strictEqual(empty.graph, graph, "an empty valid package is an exact reference no-op");

const wrongVersion = { ...placementPackage, version: 99 } as unknown as ProcPlantOrganPlacementPackage;
const unsupportedVersion = applyProcPlantOrganPlacementOverrides(graph, target, wrongVersion);
assert.strictEqual(unsupportedVersion.graph, graph);
assert.equal(unsupportedVersion.unsupported[0]?.reason, "unsupported-version");

const bogus = {
  contract: PROCPLANT_ORGAN_PLACEMENT_CONTRACT,
  version: PROCPLANT_ORGAN_PLACEMENT_VERSION,
  target,
  operations: [{ ...first.operation, id: "bogus", segmentId: "not-a-segment" }],
} satisfies ProcPlantOrganPlacementPackage;
const missingSegment = applyProcPlantOrganPlacementOverrides(graph, target, bogus);
assert.strictEqual(missingSegment.graph, graph);
assert.equal(missingSegment.unsupported[0]?.reason, "missing-segment");

const collisionGraph = graphFixture();
collisionGraph.attachments.push({ ...collisionGraph.attachments[0]!, id: `placement:${first.operation.id}` });
const collisionApplied = applyProcPlantOrganPlacementOverrides(collisionGraph, createProcPlantOrganPlacementTarget("fixture", 42, collisionGraph), {
  ...placementPackage,
  operations: [first.operation],
});
assert.equal(collisionApplied.graph.attachments.at(-1)?.id, `placement:${first.operation.id}:1`);

let capped = createProcPlantOrganPlacementPackage(target);
for (let index = 0; index < 2; index++) {
  capped = appendProcPlantOrganPlacement(capped, {
    kind: "leaf",
    segmentId: index === 0 ? "trunk:0" : "branch:0",
    axialT: 0.2,
    azimuth: index,
    scale: 0.2,
  }, { maxOverrides: 2, minAxialSpacing: 0 }).package;
}
const capResult = appendProcPlantOrganPlacement(capped, {
  kind: "leaf",
  segmentId: "branch:0",
  axialT: 0.8,
  azimuth: 2,
  scale: 0.2,
}, { maxOverrides: 2, minAxialSpacing: 0 });
assert.equal(capResult.reason, "cap");

const overCapPackage: ProcPlantOrganPlacementPackage = {
  ...placementPackage,
  operations: Array.from({ length: 97 }, (_, index) => ({
    ...first.operation,
    id: `over-cap-${index}`,
    ordinal: index,
    axialT: index / 100,
  })),
};
const overCapApplied = applyProcPlantOrganPlacementOverrides(graph, target, overCapPackage);
assert(overCapApplied.unsupported.some((entry) => entry.operationId === "over-cap-96" && entry.reason === "cap"));

const azimuth = deriveProcPlantOrganPlacementAzimuth(graph, "branch:0", 0.4, new THREE.Vector3(0.4, 1.24, 1));
assert(azimuth !== null && Number.isFinite(azimuth));
assert.equal(deriveProcPlantOrganPlacementAzimuth(graph, "missing", 0.4, new THREE.Vector3()), null);

const undone = undoLastProcPlantOrganPlacement(placementPackage);
assert.equal(undone.operations.length, 1);
assert.equal(undone.operations[0]?.id, first.operation.id);
assert.equal(undoLastProcPlantOrganPlacement(createProcPlantOrganPlacementPackage(target)).operations.length, 0);

console.log("procplant organ placement override tests passed");
