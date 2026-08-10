import assert from "node:assert/strict";
import { createProcPlantTriangleMeshIndex } from "../src/procplant-mesh-query";
import {
  appendProcPlantVineGuidePointOnStaticSupport,
  snapProcPlantVineGuidePointToStaticSupport,
} from "../src/procplant-vine-surface-authoring";
import {
  applyProcPlantVineGuidePackage,
  createProcPlantVineGuidePackage,
  createProcPlantVineGuideTarget,
  serializeProcPlantVineGuidePackage,
} from "../src/procplant-vine-guide-authoring";
import { buildProcPlantTemplate, defaultPlantEnvironment, procPlantPresets } from "../src/procplants";

const close = (actual: number, expected: number, epsilon = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be close to ${expected}`);
};

const wall = createProcPlantTriangleMeshIndex({
  id: "wall-mesh",
  positions: new Float32Array([
    -2, 0, 0, 2, 0, 0, 2, 3, 0, -2, 3, 0,
  ]),
  indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
});
const supports = {
  meshes: [wall],
  primitives: [
    { id: "disabled", role: "obstacle", enabled: false, shape: "sphere", center: [0, 0, 0] as [number, number, number], radius: 10 },
  ],
};
const sourceSnapshot = JSON.stringify(supports);
const snapped = snapProcPlantVineGuidePointToStaticSupport([0.25, 1, 0.2], supports, {
  clearance: 0.04,
  maxSnapDistance: 0.5,
});
assert.equal(snapped.status, "snapped");
assert.equal(snapped.reason, null);
assert.equal(snapped.supportId, "wall-mesh");
assert.equal(snapped.supportKind, "triangle-mesh");
assert.deepEqual(snapped.supportPoint, [0.25, 1, 0]);
assert.deepEqual(snapped.supportNormal, [0, 0, 1]);
assert.deepEqual(snapped.position, [0.25, 1, 0.04]);
close(snapped.surfaceDistance!, 0.2);
close(snapped.verifiedClearance!, 0);
assert.ok(snapped.audit.nodeVisits > 0);
assert.ok(snapped.audit.triangleTests > 0);
assert.equal(JSON.stringify(supports), sourceSnapshot, "static support snapshots must not be mutated");

const reordered = snapProcPlantVineGuidePointToStaticSupport([0.25, 1, 0.2], {
  primitives: [
    { id: "far-plane", role: "obstacle", shape: "plane", point: [0, 0, -1], normal: [0, 0, 1] },
    ...supports.primitives,
  ],
  meshes: [...supports.meshes].reverse(),
}, { supportIds: ["wall-mesh"], clearance: 0.04, maxSnapDistance: 0.5 });
assert.equal(reordered.supportId, "wall-mesh");
assert.deepEqual(reordered.position, snapped.position, "input ordering must not affect the nearest static snap");

const far = snapProcPlantVineGuidePointToStaticSupport([0, 1, 2], { meshes: [wall] }, { maxSnapDistance: 0.5 });
assert.equal(far.status, "unsupported");
assert.equal(far.reason, "beyond-snap-distance");
assert.equal(far.position, null);

const empty = snapProcPlantVineGuidePointToStaticSupport([0, 0, 0], {});
assert.equal(empty.reason, "no-static-support");
assert.equal(empty.position, null);

const primitiveSnap = snapProcPlantVineGuidePointToStaticSupport([1, 0.2, 2], {
  primitives: [{ id: "ground-plane", role: "obstacle", shape: "plane", point: [0, 0, 0], normal: [0, 1, 0] }],
}, { supportIds: ["ground-plane"], clearance: 0.05, maxSnapDistance: 0.5 });
assert.equal(primitiveSnap.status, "snapped");
assert.equal(primitiveSnap.supportKind, "primitive");
assert.deepEqual(primitiveSnap.position, [1, 0.05, 2]);
close(primitiveSnap.verifiedClearance!, 0);

const colliding = snapProcPlantVineGuidePointToStaticSupport([0, 1, 0.2], {
  meshes: [wall],
  primitives: [{
    id: "blocking-sphere",
    role: "obstacle",
    shape: "sphere",
    center: [0, 1, 0.04],
    radius: 0.08,
  }],
}, { supportIds: ["wall-mesh"], clearance: 0.04, maxSnapDistance: 0.5 });
assert.equal(colliding.status, "unsupported");
assert.equal(colliding.reason, "clearance-collision");
assert.equal(colliding.collidingObjectId, "blocking-sphere");
assert.equal(colliding.position, null, "a colliding result must fail closed instead of appending a corrected guess");

assert.throws(() => snapProcPlantVineGuidePointToStaticSupport([0, 0, 0], {
  meshes: [{ ...wall, id: "duplicate" }],
  primitives: [{ id: "duplicate", role: "obstacle", shape: "plane", point: [0, 0, 0], normal: [0, 1, 0] }],
}), /duplicate static vine support id/);
assert.throws(() => snapProcPlantVineGuidePointToStaticSupport([0, 0, Number.NaN], {}), /finite 3-number tuple/);
assert.throws(() => snapProcPlantVineGuidePointToStaticSupport([0, 0, 0], { meshes: [wall] }, {
  supportIds: ["missing"],
}), /unknown static vine support id/);

const genome = structuredClone(procPlantPresets.floweringWallCreeper!);
const seed = 0x510face;
let authored = createProcPlantVineGuidePackage(createProcPlantVineGuideTarget(genome, seed));
const first = appendProcPlantVineGuidePointOnStaticSupport(authored, [-0.5, 0.3, 0.2], { meshes: [wall] }, {
  clearance: 0.04,
  maxSnapDistance: 0.5,
});
assert.equal(first.changed, true);
authored = first.authored;
const rejected = appendProcPlantVineGuidePointOnStaticSupport(authored, [0, 1, 2], { meshes: [wall] }, { maxSnapDistance: 0.5 });
assert.equal(rejected.changed, false);
assert.strictEqual(rejected.authored, authored, "failed snaps preserve the exact authored package reference");
const second = appendProcPlantVineGuidePointOnStaticSupport(authored, [0.5, 1.5, 0.2], { meshes: [wall] }, {
  clearance: 0.04,
  maxSnapDistance: 0.5,
});
authored = second.authored;
const expectedPositions = [[-0.5, 0.3, 0.04], [0.5, 1.5, 0.04]];
authored.points.forEach((entry, pointIndex) => entry.position.forEach((value, axis) => {
  close(value, expectedPositions[pointIndex]![axis]!);
}));
const serialized = serializeProcPlantVineGuidePackage(authored);
assert.equal(serialized.includes("wall-mesh"), false, "the V1 package stores materialized points, not a false live support binding");
const applied = applyProcPlantVineGuidePackage(genome, seed, authored);
assert.equal(applied.status, "applied");
const template = buildProcPlantTemplate(applied.genome, seed, defaultPlantEnvironment());
assert.ok(template.graph.stems.length > 1, "materialized support points must build real guided-vine geometry");

console.log(JSON.stringify({
  support: snapped.supportId,
  clearance: snapped.clearance,
  verifiedClearance: snapped.verifiedClearance,
  points: authored.points.length,
  stems: template.graph.stems.length,
  serializedBytes: new TextEncoder().encode(serialized).byteLength,
}));
