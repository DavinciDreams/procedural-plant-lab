import assert from "node:assert/strict";
import * as THREE from "three";
import {
  applyProcPlantSpatialForceFields,
  type ProcPlantSpatialForceField,
} from "../src/procplant-spatial-force";
import {
  buildProcPlantInstancedParts,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantGraph,
  type ProcPlantStemNode,
} from "../src/procplants";

const stem = (index: number, x: number, y: number, z: number): ProcPlantStemNode => ({
  index,
  position: new THREE.Vector3(x, y, z),
  direction: new THREE.Vector3(0, 1, 0),
  radius: 0.08 * (1 - index * 0.12),
  depth: index > 1 ? 1 : 0,
  t: index / 3,
});

const fixtureGraph = (reverseRecords = false): ProcPlantGraph => {
  const graph: ProcPlantGraph = {
    stems: [stem(0, 0, 0, 0), stem(1, 0, 1, 0), stem(2, 0, 2, 0), stem(3, 1, 1.5, 0)],
    segments: [[0, 1], [1, 2], [1, 3]],
    organs: [{
      kind: "leaf",
      position: new THREE.Vector3(0.1, 1.5, 0),
      direction: new THREE.Vector3(1, 0.2, 0).normalize(),
      right: new THREE.Vector3(0, 0, 1),
      scale: 0.3,
      t: 0.75,
    }],
    segmentRecords: [
      { id: "segment:root", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 0.5 },
      { id: "segment:leader", parentSegmentId: "segment:root", startNodeIndex: 1, endNodeIndex: 2, depth: 0, axialStart: 0.5, axialEnd: 1 },
      { id: "segment:branch", parentSegmentId: "segment:root", startNodeIndex: 1, endNodeIndex: 3, depth: 1, axialStart: 0.5, axialEnd: 1 },
    ],
    attachments: [{
      id: "attachment:leaf",
      parentSegmentId: "segment:leader",
      axialT: 0.5,
      position: new THREE.Vector3(0.1, 1.5, 0),
      tangent: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 0, -1),
      kind: "leaf",
      depth: 0,
      sway: 0.7,
      organIndex: 0,
    }],
  };
  if (reverseRecords) {
    graph.segmentRecords.reverse();
    graph.segments.reverse();
  }
  return graph;
};

const field = (overrides: Partial<ProcPlantSpatialForceField> = {}): ProcPlantSpatialForceField => ({
  contract: "procplants.spatial-force-field",
  version: 1,
  id: "field:direction",
  type: "direction",
  position: [0, 2, 0],
  direction: [1, 0, 0],
  radius: 0.3,
  strength: 0.4,
  falloff: 1.5,
  ...overrides,
});

const positions = (graph: ProcPlantGraph) => graph.stems.map((node) => node.position.toArray());
const frameCoordinates = (graph: ProcPlantGraph) => {
  const attachment = graph.attachments[0]!;
  const record = graph.segmentRecords.find((entry) => entry.id === attachment.parentSegmentId)!;
  const start = graph.stems[record.startNodeIndex]!.position;
  const end = graph.stems[record.endNodeIndex]!.position;
  const reference = start.clone().lerp(end, attachment.axialT);
  const offset = attachment.position.clone().sub(reference);
  return [offset.dot(attachment.right), offset.dot(attachment.up), offset.dot(attachment.tangent)];
};

const source = fixtureGraph();
const sourceSnapshot = JSON.stringify(source);
const localOnly = applyProcPlantSpatialForceFields(source, [field()], { iterations: 2, maximumDisplacement: 0.25 });
assert.equal(source.stems[0]!.position.equals(localOnly.graph.stems[0]!.position), true, "root must remain anchored");
assert.equal(source.stems[1]!.position.equals(localOnly.graph.stems[1]!.position), true, "nodes outside support must remain local");
assert.ok(localOnly.graph.stems[2]!.position.x > 0, "the supported leader tip must bend with the direction field");
assert.equal(source.stems[3]!.position.equals(localOnly.graph.stems[3]!.position), true, "a sibling outside the field must remain unchanged");
assert.equal(JSON.stringify(source), sourceSnapshot, "spatial force deformation must not mutate its source graph");
assert.ok(localOnly.audit.maxDisplacement <= 0.25 + 1e-10);
const sourceLocal = frameCoordinates(source);
const deformedLocal = frameCoordinates(localOnly.graph);
assert.ok(deformedLocal.every((value, index) => Math.abs(value - sourceLocal[index]!) < 1e-8), "attachment local coordinates must survive segment bending");
assert.ok(localOnly.graph.organs[0]!.position.distanceTo(localOnly.graph.attachments[0]!.position) < 1e-8, "organ and attachment world positions must stay synchronized");

for (const record of localOnly.graph.segmentRecords) {
  const pair = localOnly.graph.segments.find(([start, end]) => start === record.startNodeIndex && end === record.endNodeIndex);
  assert.ok(pair, `${record.id} connectivity must remain represented by shared node indices`);
  assert.ok(localOnly.graph.stems[record.startNodeIndex]!.position.distanceTo(localOnly.graph.stems[record.endNodeIndex]!.position) > 1e-6);
}
for (const attachment of localOnly.graph.attachments) {
  assert.ok(Math.abs(attachment.tangent.length() - 1) < 1e-6);
  assert.ok(Math.abs(attachment.right.length() - 1) < 1e-6);
  assert.ok(Math.abs(attachment.up.length() - 1) < 1e-6);
  assert.ok(Math.abs(attachment.tangent.dot(attachment.right)) < 1e-6);
  assert.ok(new THREE.Vector3().crossVectors(attachment.tangent, attachment.right).dot(attachment.up) > 0.999999);
}

const overlappingFields = [
  field({ id: "field:z", radius: 1.2, strength: 0.18 }),
  field({ id: "field:a", type: "repel", position: [0.2, 1.7, 0], direction: undefined, radius: 0.9, strength: 0.12 }),
  field({ id: "field:curl", type: "curl", position: [0, 1.5, 0], direction: [0, 1, 0], radius: 1.4, strength: 0.08, falloff: 2 }),
];
const ordered = applyProcPlantSpatialForceFields(fixtureGraph(), overlappingFields, { iterations: 3, maximumDisplacement: 0.4 });
const reversed = applyProcPlantSpatialForceFields(fixtureGraph(true), [...overlappingFields].reverse(), { iterations: 3, maximumDisplacement: 0.4 });
assert.deepEqual(positions(ordered.graph), positions(reversed.graph), "field and segment-record order must not change node targets");
assert.deepEqual(ordered.graph.attachments[0]!.position.toArray(), reversed.graph.attachments[0]!.position.toArray());
assert.equal(ordered.audit.targetSignature, reversed.audit.targetSignature, "stable target signatures must ignore source ordering");
assert.ok(positions(ordered.graph).flat().every(Number.isFinite), "curl/overlap output must stay finite");

const attract = applyProcPlantSpatialForceFields(fixtureGraph(), [field({
  id: "field:alias", type: "attract", position: [0.5, 2, 0], direction: undefined, radius: 1, strength: 0.2,
})]);
const magnet = applyProcPlantSpatialForceFields(fixtureGraph(), [field({
  id: "field:alias", type: "magnet", position: [0.5, 2, 0], direction: undefined, radius: 1, strength: 0.2,
})]);
assert.deepEqual(positions(attract.graph), positions(magnet.graph), "magnet must be a stable attract alias");
const repel = applyProcPlantSpatialForceFields(fixtureGraph(), [field({
  id: "field:alias", type: "repel", position: [0.3, 2, 0], direction: undefined, radius: 1, strength: 0.2,
})]);
const avoid = applyProcPlantSpatialForceFields(fixtureGraph(), [field({
  id: "field:alias", type: "avoid", position: [0.3, 2, 0], direction: undefined, radius: 1, strength: 0.2,
})]);
assert.deepEqual(positions(repel.graph), positions(avoid.graph), "avoid must be a stable repel alias");

const generated = buildProcPlantInstancedParts(procPlantPresets.cloverGroundcover!, 77, defaultPlantEnvironment()).graph;
const generatedRecord = generated.segmentRecords.find((record) => record.parentSegmentId !== null) ?? generated.segmentRecords[0]!;
const generatedTarget = generated.stems[generatedRecord.endNodeIndex]!.position;
const generatedResult = applyProcPlantSpatialForceFields(generated, [field({
  id: "field:generated-graph",
  position: [generatedTarget.x, generatedTarget.y, generatedTarget.z],
  radius: 0.35,
  strength: 0.14,
})], { maximumDisplacement: 0.12 });
assert.notEqual(generatedResult.graph, generated, "a generated public graph must produce an immutable target graph");
assert.ok(generatedResult.audit.affectedNodes > 0);
for (const attachment of generatedResult.graph.attachments) {
  assert.ok([attachment.position.x, attachment.position.y, attachment.position.z].every(Number.isFinite));
  assert.ok(Math.abs(attachment.tangent.dot(attachment.right)) < 1e-5);
  assert.ok(new THREE.Vector3().crossVectors(attachment.tangent, attachment.right).dot(attachment.up) > 0.999);
}

assert.equal(applyProcPlantSpatialForceFields(source, []).graph, source, "empty fields need an exact-reference no-op");
assert.equal(applyProcPlantSpatialForceFields(source, [field()], { enabled: false }).graph, source, "disabled deformation needs an exact-reference no-op");
const far = applyProcPlantSpatialForceFields(source, [field({ id: "field:far", position: [50, 50, 50], radius: 1 })]);
assert.equal(far.graph, source, "non-overlapping fields need an exact-reference no-op");
assert.deepEqual(far.audit.unmatchedFieldIds, ["field:far"]);

assert.throws(() => applyProcPlantSpatialForceFields(source, [field()], { maxNodes: 3 }), /maxNodes/);
assert.throws(() => applyProcPlantSpatialForceFields(source, [field()], { maxSegments: 2 }), /maxSegments/);
assert.throws(() => applyProcPlantSpatialForceFields(source, [field(), field({ id: "field:second" })], { maxFields: 1 }), /maxFields/);
assert.throws(() => applyProcPlantSpatialForceFields(source, [field()], { maxWorkItems: 5 }), /maxWorkItems/);
assert.throws(() => applyProcPlantSpatialForceFields(source, [field()], { iterations: 9 }), /iterations/);
assert.throws(() => applyProcPlantSpatialForceFields(source, [field()], { anchoredNodeIndices: [99] }), /anchored node/);

console.log("ok 1 - compact fields are spatially local and keep roots anchored");
console.log("ok 2 - connectivity and segment-relative attachment/organ frames survive bending");
console.log("ok 3 - direction, attract/magnet, repel/avoid, and curl are deterministic across ordering");
console.log("ok 4 - no-op references and node/segment/field/iteration/work caps are explicit");
console.log("1..4");
