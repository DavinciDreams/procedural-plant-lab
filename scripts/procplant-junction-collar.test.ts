import assert from "node:assert/strict";
import {
  buildProcPlantJunctionCollars,
  type ProcPlantJunctionCollarAnchor,
} from "../src/procplant-junction-collar";

const baseAnchor = (overrides: Partial<ProcPlantJunctionCollarAnchor> = {}): ProcPlantJunctionCollarAnchor => ({
  id: "collar:a",
  surfacePosition: [1, 0, 0],
  supportTangent: [0, 1, 0],
  outward: [1, 0, 0],
  surfaceRadius: 1,
  branchRadius: 0.3,
  strength: 0.5,
  axialLength: 0.75,
  radialReach: 0.8,
  shellThickness: 0.2,
  ...overrides,
});

const source = new Float32Array([
  1, 0, 0,
  1, 0.25, 0,
  1, -0.25, 0,
  0, 0, 1,
  -1, 0, 0,
]);
const sourceSnapshot = source.slice();

const disabled = buildProcPlantJunctionCollars(source, [baseAnchor()], { enabled: false });
assert.equal(disabled.positions, source, "disabled collars must reuse the exact source position reference");
assert.equal(disabled.collarDisplacement, null);
assert.equal(disabled.audit.sourcePositionsReused, true);

const noInfluence = buildProcPlantJunctionCollars(source, [baseAnchor({
  id: "collar:far",
  surfacePosition: [11, 0, 0],
})]);
assert.equal(noInfluence.positions, source, "zero-influence collars must be a zero-copy no-op");
assert.deepEqual(noInfluence.audit.unmatchedAnchorIds, ["collar:far"]);
assert.equal(noInfluence.audit.affectedVertices, 0);

const anchorA = baseAnchor();
const angle = 0.12;
const anchorB = baseAnchor({
  id: "collar:b",
  surfacePosition: [Math.cos(angle), 0.08, Math.sin(angle)],
  outward: [Math.cos(angle), 0, Math.sin(angle)],
  strength: 0.4,
});
const ordered = buildProcPlantJunctionCollars(source, [anchorA, anchorB], { maximumDisplacement: 0.25 });
const reversed = buildProcPlantJunctionCollars(source, [anchorB, anchorA], { maximumDisplacement: 0.25 });
assert.deepEqual(ordered.positions, reversed.positions, "stable anchor IDs must make overlap independent of input order");
assert.deepEqual(ordered.collarDisplacement, reversed.collarDisplacement);
assert.deepEqual(ordered.collarWeight, reversed.collarWeight);
assert.deepEqual(source, sourceSnapshot, "collar deformation must not mutate imported positions");
assert.ok(Array.from(ordered.positions).every(Number.isFinite), "deformed positions must stay finite");

const symmetric = buildProcPlantJunctionCollars(source, [anchorA]);
assert.ok(symmetric.collarDisplacement);
assert.equal(symmetric.collarDisplacement![3], symmetric.collarDisplacement![6], "axial mirror points need equal radial swell");
assert.equal(symmetric.collarWeight![1], symmetric.collarWeight![2], "axial mirror points need equal collar weight");

const negativeSource = new Float32Array([-1, 0, 0]);
const mirrored = buildProcPlantJunctionCollars(negativeSource, [baseAnchor({
  id: "collar:mirrored",
  surfacePosition: [-1, 0, 0],
  outward: [-2, 0, 0],
  supportTangent: [0, -3, 0],
})]);
assert.ok(mirrored.collarDisplacement![0]! < 0, "mirrored and non-unit frames must swell in their mirrored radial direction");
assert.ok(Math.abs(mirrored.collarDisplacement![0]!) === Math.abs(symmetric.collarDisplacement![0]!));

const rotated = buildProcPlantJunctionCollars(new Float32Array([0, 1, 0]), [baseAnchor({
  id: "collar:rotated",
  surfacePosition: [0, 1, 0],
  supportTangent: [0, 0, 4],
  outward: [0, 2, 0.2],
})]);
assert.ok(rotated.collarDisplacement![1]! > 0, "arbitrary frames must orient the collar away from their local spine");
assert.ok(Math.abs(rotated.collarDisplacement![2]!) < 1e-6, "outward is orthogonalized against the support tangent");

const overlap = buildProcPlantJunctionCollars(new Float32Array([1, 0, 0]), [
  baseAnchor({ id: "collar:one", strength: 1 }),
  baseAnchor({ id: "collar:two", strength: 1 }),
], { maximumDisplacement: 0.2 });
assert.ok(Math.abs(overlap.audit.maxDisplacement - 0.2) < 1e-12, "overlap displacement must obey the explicit cap");
assert.ok(Math.abs(overlap.collarDisplacement![0]! - 0.2) < 1e-6);
assert.equal(overlap.audit.matchedAnchors, 2);

assert.throws(() => buildProcPlantJunctionCollars(source, [anchorA], { maxVertices: 4 }), /maxVertices/);
assert.throws(() => buildProcPlantJunctionCollars(source, [anchorA, anchorB], { maxAnchors: 1 }), /maxAnchors/);
assert.throws(() => buildProcPlantJunctionCollars(source, [anchorA, anchorB], { maxWorkItems: 9 }), /maxWorkItems/);
assert.throws(() => buildProcPlantJunctionCollars(source, [baseAnchor({ branchRadius: 2.1 })]), /branchRadius/);
assert.throws(() => buildProcPlantJunctionCollars(source, [anchorA], { maximumDisplacement: Number.POSITIVE_INFINITY }), /finite/);
assert.throws(() => buildProcPlantJunctionCollars(source, [anchorA], { maximumBranchRadiusScale: 9 }), /at most 8/);
assert.throws(() => buildProcPlantJunctionCollars(source, [anchorA], { maximumDisplacement: 2.1 }), /local-radius bound/);

console.log("ok 1 - disabled and unmatched collars are exact zero-copy no-ops");
console.log("ok 2 - deterministic overlap is order independent and nonmutating");
console.log("ok 3 - symmetric, mirrored, and arbitrary frames orient collars stably");
console.log("ok 4 - overlap displacement and vertex/anchor/work limits are bounded");
console.log("1..4");
