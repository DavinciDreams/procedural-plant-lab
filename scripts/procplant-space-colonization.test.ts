import assert from "node:assert/strict";
import * as THREE from "three";
import {
  cloneProcPlantFreeformCrown,
  growProcPlantSpaceColonization,
  PROCPLANT_FREEFORM_CROWN_CONTRACT,
  PROCPLANT_FREEFORM_CROWN_MAX_VOLUMES,
  PROCPLANT_FREEFORM_CROWN_VERSION,
  sampleProcPlantCrownAttractors,
  deserializeProcPlantFreeformCrown,
  serializeProcPlantFreeformCrown,
  validateProcPlantFreeformCrown,
  type ProcPlantCrownVolume,
  type ProcPlantFreeformCrown,
} from "../src/procplant-space-colonization";
import { createProcPlantAuthoringGraph } from "../src/procplant-authoring-graph";
import { procPlantPresets } from "../src/procplants";

const volume: ProcPlantCrownVolume = {
  shape: "ellipsoid",
  center: new THREE.Vector3(0, 3.5, 0),
  radii: new THREE.Vector3(2.4, 2.1, 1.8),
};

const sampleA = sampleProcPlantCrownAttractors(volume, 128, 42);
const sampleB = sampleProcPlantCrownAttractors(volume, 128, 42);
assert.deepEqual(sampleA.map((point) => point.toArray()), sampleB.map((point) => point.toArray()));
assert.equal(sampleA.length, 128);
for (const point of sampleA) {
  const local = point.clone().sub(volume.center).divide(volume.radii);
  assert.ok(local.lengthSq() <= 1 + 1e-10);
}
assert.deepEqual(volume.center.toArray(), [0, 3.5, 0]);
assert.deepEqual(volume.radii.toArray(), [2.4, 2.1, 1.8]);

const freeform: ProcPlantFreeformCrown = {
  contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
  version: PROCPLANT_FREEFORM_CROWN_VERSION,
  volumes: [
    { id: "left-lobe", shape: "ellipsoid", center: [-1.8, 3.2, 0], dimensions: [1.2, 1.45, 1] },
    { id: "right-lobe", shape: "box", center: [1.65, 3.65, 0.25], dimensions: [1.4, 1.8, 1.5], weight: 1.4 },
  ],
};
const freeformSnapshot = JSON.stringify(freeform);
const freeformA = sampleProcPlantCrownAttractors(freeform, 256, 91);
const freeformB = sampleProcPlantCrownAttractors(freeform, 256, 91);
assert.deepEqual(freeformA.map((point) => point.toArray()), freeformB.map((point) => point.toArray()));
assert.equal(JSON.stringify(freeform), freeformSnapshot, "sampling must not mutate the authored field");
assert.ok(freeformA.some((point) => point.x < -0.8) && freeformA.some((point) => point.x > 0.9));
for (const point of freeformA) {
  const ellipsoid = point.clone().sub(new THREE.Vector3(-1.8, 3.2, 0)).divide(new THREE.Vector3(1.2, 1.45, 1)).lengthSq() <= 1 + 1e-10;
  const box = Math.abs(point.x - 1.65) <= 0.7 && Math.abs(point.y - 3.65) <= 0.9 && Math.abs(point.z - 0.25) <= 0.75;
  assert.ok(ellipsoid || box, "every attraction point must lie in an authored control volume");
}
assert.notEqual(cloneProcPlantFreeformCrown(freeform).volumes, freeform.volumes);
assert.deepEqual(deserializeProcPlantFreeformCrown(serializeProcPlantFreeformCrown(freeform)), freeform);
const halfTurn = Math.sqrt(0.5);
const rotatedBox: ProcPlantFreeformCrown = {
  contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
  version: PROCPLANT_FREEFORM_CROWN_VERSION,
  volumes: [{
    id: "rotated-box",
    shape: "box",
    center: [0, 2, 0],
    dimensions: [4, 1, 1],
    weight: 2.5,
    rotation: [0, halfTurn, 0, halfTurn],
  }],
};
const rotatedSamples = sampleProcPlantCrownAttractors(rotatedBox, 256, 17);
assert.ok(rotatedSamples.every((point) => Math.abs(point.x) <= 0.5 + 1e-10));
assert.ok(rotatedSamples.some((point) => Math.abs(point.z) > 1.5), "yaw must rotate the long box axis into world Z");
assert.deepEqual(deserializeProcPlantFreeformCrown(serializeProcPlantFreeformCrown(rotatedBox)), rotatedBox);
const carvedCrown: ProcPlantFreeformCrown = {
  contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
  version: PROCPLANT_FREEFORM_CROWN_VERSION,
  volumes: [
    { id: "outer", shape: "box", center: [0, 2, 0], dimensions: [4, 4, 4] },
    { id: "cutout", operation: "subtract", shape: "box", center: [0, 2, 0], dimensions: [2, 2, 2] },
  ],
};
const carvedSamples = sampleProcPlantCrownAttractors(carvedCrown, 512, 31);
assert.ok(carvedSamples.every((point) =>
  Math.abs(point.x) > 1 || Math.abs(point.y - 2) > 1 || Math.abs(point.z) > 1),
"subtractive volumes must carve every sampled attraction point");
assert.throws(() => sampleProcPlantCrownAttractors({
  ...carvedCrown,
  volumes: [carvedCrown.volumes[0]!, { ...carvedCrown.volumes[1]!, dimensions: [4, 4, 4] }],
}, 1, 31), /could sample only 0\/1 attractors after 1000 attempts/);
const authoredGenome = structuredClone(procPlantPresets.colonizedHazelShrub);
authoredGenome.spaceColonization!.freeform = cloneProcPlantFreeformCrown(freeform);
const authoringGraph = createProcPlantAuthoringGraph(authoredGenome, 19);
const architectureNode = authoringGraph.nodes.find((node) => node.stage === "architecture")!;
assert.deepEqual(architectureNode.parameters?.freeformCrown, freeform,
  "the versioned freeform field must persist in canonical graph state");
assert.throws(() => validateProcPlantFreeformCrown({ ...freeform, version: 2 as 1 }), /contract or version/);
assert.throws(() => validateProcPlantFreeformCrown({
  ...freeform,
  volumes: Array.from({ length: PROCPLANT_FREEFORM_CROWN_MAX_VOLUMES + 1 }, (_, index) => ({
    id: `volume-${index}`, shape: "box" as const, center: [0, 1, 0] as const, dimensions: [1, 1, 1] as const,
  })),
}), /1\.\.24 control volumes/);
assert.throws(() => validateProcPlantFreeformCrown({
  ...freeform,
  volumes: [freeform.volumes[0]!, { ...freeform.volumes[0]! }],
}), /invalid or duplicate id/);
assert.throws(() => validateProcPlantFreeformCrown({
  ...freeform,
  volumes: [{ ...freeform.volumes[0]!, rotation: [0, 1, 0, 1] }],
}), /rotation quaternion must be normalized/);
assert.throws(() => validateProcPlantFreeformCrown({
  ...freeform,
  volumes: [{ ...freeform.volumes[0]!, operation: "subtract" }],
}), /at least one additive/);
assert.throws(() => validateProcPlantFreeformCrown({
  ...freeform,
  volumes: [freeform.volumes[0]!, { ...freeform.volumes[1]!, operation: "subtract", weight: 1 }],
}), /cannot define attraction weight/);

const options = {
  volume,
  seed: 77,
  attractorCount: 260,
  segmentLength: 0.24,
  influenceRadius: 1.15,
  killRadius: 0.28,
  collisionRadius: 0.075,
  maxSteps: 120,
  maxNodes: 900,
  maxChildren: 2,
  tropismStrength: 0.06,
};
const first = growProcPlantSpaceColonization(options);
const second = growProcPlantSpaceColonization(options);
const compact = (result: typeof first) => ({
  nodes: result.nodes.map((node) => [node.id, node.parentId, ...node.position.toArray(), ...node.direction.toArray(), node.depth, node.radius, node.childCount]),
  segments: result.segments,
  remaining: result.remainingAttractors.map((point) => point.toArray()),
  stats: result.stats,
});
assert.deepEqual(compact(first), compact(second));
assert.ok(first.nodes.length > 24, `expected a developed crown, received ${first.nodes.length} nodes`);
assert.equal(first.segments.length, first.nodes.length - 1);
assert.ok(first.stats.reachedAttractors > 0);
assert.ok(first.stats.terminalTips > 1);

const sculpted = growProcPlantSpaceColonization({ ...options, volume: freeform });
const sculptedAgain = growProcPlantSpaceColonization({ ...options, volume: freeform });
assert.deepEqual(compact(sculpted), compact(sculptedAgain));
assert.notDeepEqual(
  sculpted.nodes.slice(0, 24).map((node) => node.position.toArray()),
  first.nodes.slice(0, 24).map((node) => node.position.toArray()),
  "the freeform field must drive real crown geometry rather than editor-only metadata",
);

const nodeById = new Map(first.nodes.map((node) => [node.id, node]));
for (const segment of first.segments) {
  const start = nodeById.get(segment.startNodeId);
  const end = nodeById.get(segment.endNodeId);
  assert.ok(start && end);
  assert.equal(end.parentId, start.id);
  assert.ok(start.radius >= end.radius - 1e-10, "pipe-model radius must not widen toward a tip");
  assert.ok(Number.isFinite(end.radius) && end.radius > 0);
  assert.ok(Math.abs(end.direction.length() - 1) < 1e-6);
}

assert.throws(() => growProcPlantSpaceColonization({
  volume,
  influenceRadius: 0.2,
  killRadius: 0.3,
}), /killRadius/);

console.log("procplant space-colonization tests passed");
