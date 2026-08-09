import assert from "node:assert/strict";
import {
  queryProcPlantClearance,
  queryProcPlantSceneObject,
  sampleProcPlantGrowthTip,
  type ProcPlantSceneGuideObject,
} from "../src/procplant-guide-query";

const close = (actual: number, expected: number, epsilon = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be close to ${expected}`);
};

const primitives: ProcPlantSceneGuideObject[] = [
  { id: "sphere", role: "obstacle", shape: "sphere", center: [0, 0, 0], radius: 1 },
  { id: "capsule", role: "obstacle", shape: "capsule", start: [0, 0, 0], end: [0, 2, 0], radius: 0.5 },
  { id: "ground", role: "obstacle", shape: "plane", point: [0, 0, 0], normal: [0, 2, 0] },
  { id: "box", role: "obstacle", shape: "box", center: [0, 0, 0], halfExtents: [1, 2, 3] },
];

const sphere = queryProcPlantSceneObject(primitives[0]!, [2.5, 0, 0]);
close(sphere.distance, 1.5);
assert.deepEqual(sphere.closestPoint, [1, 0, 0]);
assert.deepEqual(sphere.normal, [1, 0, 0]);
assert.equal(sphere.inside, false);

const capsule = queryProcPlantSceneObject(primitives[1]!, [1.5, 1, 0]);
close(capsule.distance, 1);
assert.deepEqual(capsule.closestPoint, [0.5, 1, 0]);

const plane = queryProcPlantSceneObject(primitives[2]!, [4, -0.25, 7]);
close(plane.distance, -0.25);
assert.deepEqual(plane.closestPoint, [4, 0, 7]);
assert.equal(plane.inside, true);

const boxOutside = queryProcPlantSceneObject(primitives[3]!, [2, 3, 3]);
close(boxOutside.distance, Math.SQRT2);
close(boxOutside.closestPoint[0], 1);
close(boxOutside.closestPoint[1], 2);
close(boxOutside.closestPoint[2], 3);
const boxInside = queryProcPlantSceneObject(primitives[3]!, [0.75, 0, 0]);
close(boxInside.distance, -0.25);
assert.deepEqual(boxInside.normal, [1, 0, 0]);

const clearance = queryProcPlantClearance([primitives[0]!], [1.4, 0, 0], 0.5);
close(clearance.clearance!, -0.1);
assert.equal(clearance.colliding, true);
assert.equal(clearance.nearest?.objectId, "sphere");
assert.deepEqual(queryProcPlantClearance([], [0, 0, 0]), {
  contract: "procplants.scene-guide-query",
  version: 1,
  clearanceRadius: 0,
  clearance: null,
  colliding: false,
  nearest: null,
});

const guideObjects: ProcPlantSceneGuideObject[] = [
  {
    id: "trunk-clearance",
    role: "obstacle",
    shape: "capsule",
    start: [0, -2, 0],
    end: [0, 2, 0],
    radius: 0.5,
    strength: 1.5,
    influenceRadius: 2,
  },
  {
    id: "trellis",
    role: "attractor",
    shape: "capsule",
    start: [2, 0, -2],
    end: [2, 0, 2],
    radius: 0.05,
    strength: 1,
    influenceRadius: 5,
  },
  {
    id: "lamp-heat",
    role: "repulsor",
    shape: "sphere",
    center: [-1, 0, 0],
    radius: 0.2,
    strength: 0.5,
    influenceRadius: 3,
  },
];

const options = {
  position: [0.55, 0, 0] as [number, number, number],
  direction: [0, 1, 0] as [number, number, number],
  stepLength: 0.4,
  tipRadius: 0.12,
};
const first = sampleProcPlantGrowthTip(guideObjects, options);
const reordered = sampleProcPlantGrowthTip([...guideObjects].reverse(), options);
assert.deepEqual(first, reordered, "stable IDs must make sampling independent of input array order");
assert.ok(first.steeredDirection[0] > 0, "trellis attraction and trunk repulsion should steer away from the trunk");
assert.deepEqual(first.contributions.map((entry) => entry.objectId), ["lamp-heat", "trellis", "trunk-clearance"]);
assert.doesNotThrow(() => JSON.parse(JSON.stringify(first)));
assert.ok(JSON.stringify(first).length > 0);

const penetration = sampleProcPlantGrowthTip([
  { id: "wall", role: "obstacle", shape: "plane", point: [0, 0, 0], normal: [1, 0, 0], influenceRadius: 0.05, strength: 0 },
], {
  position: [0.1, 0, 0],
  direction: [-1, 0, 0],
  stepLength: 0.3,
  tipRadius: 0.05,
});
assert.equal(penetration.blocked, true);
assert.deepEqual(penetration.resolvedObjectIds, ["wall"]);
assert.ok(penetration.resolvedPosition[0] >= 0.05);
assert.ok((penetration.clearance ?? -1) >= -1e-8);

const sourceSnapshot = JSON.stringify(guideObjects);
sampleProcPlantGrowthTip(guideObjects, options);
assert.equal(JSON.stringify(guideObjects), sourceSnapshot, "queries must not mutate scene data");
assert.throws(() => queryProcPlantClearance([
  { id: "same", role: "obstacle", shape: "sphere", center: [0, 0, 0], radius: 1 },
  { id: "same", role: "attractor", shape: "sphere", center: [1, 0, 0], radius: 1 },
], [0, 0, 0]), /duplicate scene object id/);
assert.throws(() => sampleProcPlantGrowthTip([], { position: [0, 0, 0], direction: [0, 0, 0], stepLength: 1 }), /direction/);

console.log("procplant scene guide-query tests passed");
