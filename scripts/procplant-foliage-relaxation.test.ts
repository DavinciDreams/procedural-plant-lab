import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createProcPlantFoliageCandidatesFromAttachments,
  relaxProcPlantFoliageCandidates,
  relaxProcPlantGraphFoliage,
  type ProcPlantFoliageCandidate,
} from "../src/procplant-foliage-relaxation";
import type { ProcPlantGraph } from "../src/procplants";

const candidate = (id: string, position: THREE.Vector3): ProcPlantFoliageCandidate => ({
  id,
  parentSegmentId: "segment:trunk",
  position,
  supportTangent: new THREE.Vector3(0, 1, 0),
  forward: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(0, 0, 1),
  halfWidth: 0.16,
  halfLength: 0.34,
  halfThickness: 0.008,
});

const source = [
  candidate("leaf-c", new THREE.Vector3(0, 0.004, 0)),
  candidate("leaf-a", new THREE.Vector3(0, 0, 0)),
  candidate("leaf-d", new THREE.Vector3(0, 0.006, 0.02)),
  candidate("leaf-b", new THREE.Vector3(0, 0.002, 0)),
];
const sourceSnapshot = source.map((entry) => entry.position.toArray());
const options = {
  maxIterations: 32,
  maxOffset: 0.72,
  maxRotationRadians: 0.5,
  separationPadding: 0.002,
  translationStrength: 0.95,
  rotationStrength: 0.12,
};
const relaxed = relaxProcPlantFoliageCandidates(source, [], options);
const reversed = relaxProcPlantFoliageCandidates([...source].reverse(), [], options);
const serialize = (result: typeof relaxed) => result.attachments.map((entry) => ({
  id: entry.id,
  position: entry.position.toArray(),
  forward: entry.forward.toArray(),
  right: entry.right.toArray(),
  rotation: entry.rotationRadians,
}));
assert.deepEqual(serialize(relaxed), serialize(reversed));
assert.deepEqual(relaxed.report, reversed.report);
assert.deepEqual(source.map((entry) => entry.position.toArray()), sourceSnapshot, "source candidates must not mutate");
assert.deepEqual(relaxed.attachments.map((entry) => entry.id), ["leaf-a", "leaf-b", "leaf-c", "leaf-d"]);
assert.ok(relaxed.report.initialCollisionCount > 0);
assert.equal(
  relaxed.report.unresolvedCollisionCount,
  0,
  JSON.stringify({ report: relaxed.report, offsets: relaxed.attachments.map((entry) => entry.offset.toArray()) }),
);
for (const entry of relaxed.attachments) {
  assert.ok(entry.offset.length() <= options.maxOffset + 1e-8);
  assert.ok(Math.abs(entry.rotationRadians) <= options.maxRotationRadians + 1e-8);
  assert.ok(Math.abs(entry.offset.dot(entry.supportTangent)) < 1e-8);
  assert.ok(Math.abs(entry.forward.dot(entry.right)) < 1e-8);
}
console.log("ok 1 - card relaxation is deterministic, order-independent, bounded, and non-mutating");

const immovable = relaxProcPlantFoliageCandidates(source.slice(0, 2), [], {
  maxIterations: 3,
  maxOffset: 0,
  maxRotationRadians: 0,
  separationPadding: 0,
});
assert.equal(immovable.report.iterations, 3);
assert.ok(immovable.report.unresolvedCollisionCount > 0);
assert.ok(immovable.report.unresolved.every((collision) => collision.type === "organ-organ"));
assert.ok(immovable.attachments.every((entry) => entry.offset.lengthSq() === 0 && entry.rotationRadians === 0));
console.log("ok 2 - fixed iteration bounds report impossible overlaps instead of looping");

const capsuleCandidate = candidate("capsule-leaf", new THREE.Vector3(0.18, 0.8, 0));
capsuleCandidate.halfWidth = 0.08;
capsuleCandidate.halfLength = 0.16;
const capsuleResult = relaxProcPlantFoliageCandidates([capsuleCandidate], [{
  id: "stem:main",
  start: new THREE.Vector3(0, 0, 0),
  end: new THREE.Vector3(0, 2, 0),
  radius: 0.16,
}], {
  maxIterations: 24,
  maxOffset: 0.5,
  maxRotationRadians: 0,
  stemClearance: 0.02,
  separationPadding: 0,
  translationStrength: 1,
});
assert.ok(capsuleResult.report.initialCollisionCount > 0);
assert.equal(capsuleResult.report.unresolvedCollisionCount, 0);
assert.ok(capsuleResult.attachments[0]!.position.x > capsuleCandidate.position.x);
console.log("ok 3 - simple stem capsules push card bounds beyond requested clearance");

const graph: ProcPlantGraph = {
  stems: [
    { position: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.05, depth: 0, t: 0, index: 0 },
    { position: new THREE.Vector3(0, 2, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.03, depth: 0, t: 1, index: 1 },
  ],
  segments: [[0, 1]],
  segmentRecords: [{
    id: "segment:trunk",
    parentSegmentId: null,
    startNodeIndex: 0,
    endNodeIndex: 1,
    depth: 0,
    axialStart: 0,
    axialEnd: 1,
  }],
  organs: [
    { kind: "leaf", position: new THREE.Vector3(0.1, 1, 0), direction: new THREE.Vector3(1, 0, 0), right: new THREE.Vector3(0, 0, 1), scale: 0.5, t: 0.5 },
    { kind: "leaf", position: new THREE.Vector3(0.1, 1.004, 0), direction: new THREE.Vector3(1, 0, 0), right: new THREE.Vector3(0, 0, 1), scale: 0.5, t: 0.52 },
  ],
  attachments: [0, 1].map((index) => ({
    id: `attachment:${index}:leaf`,
    parentSegmentId: "segment:trunk",
    axialT: 0.5 + index * 0.002,
    position: new THREE.Vector3(0.1, 1 + index * 0.004, 0),
    tangent: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(1, 0, 0),
    kind: "leaf" as const,
    depth: 0,
    sway: 0.6,
    organIndex: index,
  })),
};
const graphSnapshot = graph.organs.map((organ) => organ.position.toArray());
const attachmentCandidates = createProcPlantFoliageCandidatesFromAttachments(graph.attachments, {
  "attachment:0:leaf": { width: 0.2, length: 0.6 },
});
assert.equal(attachmentCandidates.length, 2);
assert.equal(attachmentCandidates[0]!.halfWidth, 0.1);
assert.equal(attachmentCandidates[0]!.halfLength, 0.3);
assert.ok(attachmentCandidates[0]!.forward.equals(graph.attachments[0]!.up));
const graphResult = relaxProcPlantGraphFoliage(graph, {
  stemRadiusScale: 0,
  maxIterations: 24,
  maxOffset: 0.5,
  separationPadding: 0,
});
assert.deepEqual(graph.organs.map((organ) => organ.position.toArray()), graphSnapshot);
assert.notEqual(graphResult.graph, graph);
assert.deepEqual(graphResult.graph.attachments.map((attachment) => attachment.id), graph.attachments.map((attachment) => attachment.id));
assert.ok(graphResult.graph.organs.some((organ, index) => !organ.position.equals(graph.organs[index]!.position)));
for (const attachment of graphResult.graph.attachments) {
  assert.ok(new THREE.Vector3().crossVectors(attachment.tangent, attachment.right).dot(attachment.up) > 0.999999);
  assert.equal(attachment.parentSegmentId, "segment:trunk");
}
console.log("ok 4 - public ProcPlantGraph attachments and organs can be relaxed as a cloned graph");

const exhaustiveReference = relaxProcPlantFoliageCandidates(source, [], {
  ...options,
  broadPhase: "exhaustive",
});
const spatialReference = relaxProcPlantFoliageCandidates([...source].reverse(), [], {
  ...options,
  broadPhase: "spatial-hash",
});
assert.deepEqual(serialize(exhaustiveReference), serialize(spatialReference));
assert.deepEqual(exhaustiveReference.report, spatialReference.report);
assert.equal(exhaustiveReference.audit.broadPhase, "exhaustive");
assert.equal(spatialReference.audit.broadPhase, "spatial-hash");
assert.deepEqual(
  exhaustiveReference.audit.organPairsTestedByPass,
  spatialReference.audit.organPairsTestedByPass,
  "the dense reference set should retain every exhaustive pair in the grid",
);
console.log("ok 5 - spatial and exhaustive broad phases preserve exact dense-set results and collision reports");

const sparse = Array.from({ length: 256 }, (_, index) => candidate(
  `sparse-${index.toString().padStart(4, "0")}`,
  new THREE.Vector3((index % 32) * 2, Math.floor(index / 32) * 2, 0),
)).map((entry) => ({ ...entry, halfWidth: 0.05, halfLength: 0.1, halfThickness: 0.003 }));
const sparseSpatial = relaxProcPlantFoliageCandidates(sparse, [], {
  broadPhase: "auto",
  maxIterations: 2,
  separationPadding: 0,
});
const sparseExhaustive = relaxProcPlantFoliageCandidates([...sparse].reverse(), [], {
  broadPhase: "exhaustive",
  maxIterations: 2,
  separationPadding: 0,
});
assert.deepEqual(serialize(sparseSpatial), serialize(sparseExhaustive));
assert.deepEqual(sparseSpatial.report, sparseExhaustive.report);
assert.equal(sparseSpatial.audit.broadPhase, "spatial-hash");
assert.equal(sparseSpatial.audit.possibleOrganPairsPerPass, 32_640);
assert.ok(sparseSpatial.audit.spatialBucketCountsByPass.every((count) => count > 0));
assert.ok(
  sparseSpatial.audit.organPairsTested * 100 < sparseExhaustive.audit.organPairsTested,
  `${sparseSpatial.audit.organPairsTested} spatial versus ${sparseExhaustive.audit.organPairsTested} exhaustive`,
);
console.log(
  `ok 6 - default spatial hashing tests ${sparseSpatial.audit.organPairsTested} versus `
  + `${sparseExhaustive.audit.organPairsTested} exhaustive pairs in a large sparse canopy`,
);
console.log("1..6");
