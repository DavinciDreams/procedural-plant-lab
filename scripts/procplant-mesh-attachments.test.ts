import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createProcPlantManualMeshSpine,
  createProcPlantMeshAttachments,
  type ProcPlantMeshAttachmentSpec,
} from "../src/procplant-mesh-helper";

const spine = createProcPlantManualMeshSpine([
  { position: new THREE.Vector3(0, 0, 0), radius: 0.42 },
  { position: new THREE.Vector3(0.08, 1.2, 0.03), radius: 0.36 },
  { position: new THREE.Vector3(0.2, 2.5, -0.04), radius: 0.29 },
  { position: new THREE.Vector3(0.08, 3.8, 0.12), radius: 0.2 },
  { position: new THREE.Vector3(-0.1, 5.1, 0.18), radius: 0.12 },
]);

const specs: ProcPlantMeshAttachmentSpec[] = [
  {
    id: "03-fruit",
    kind: "accessory",
    count: 3,
    startT: 0.28,
    endT: 0.9,
    clearance: 0.08,
    minimumSpacing: 0.22,
    rollRadians: 0.17,
    scale: [0.7, 0.9, 0.8],
  },
  {
    id: "01-branches",
    kind: "branch",
    count: 4,
    startT: 0.12,
    endT: 0.82,
    clearance: 0.025,
    minimumSpacing: 0.3,
    tiltRadians: 0.86,
  },
  {
    id: "02-leaves",
    kind: "leaf",
    count: 9,
    startT: 0.16,
    endT: 0.98,
    clearance: 0.045,
    minimumSpacing: 0.14,
    scale: 0.65,
  },
];

const options = { seed: 0x1234abcd, minimumSpacing: 0.12, maxCandidatesPerAttachment: 64 };
const first = createProcPlantMeshAttachments(spine, specs, options);
const second = createProcPlantMeshAttachments(spine, [...specs].reverse(), options);
const tiltByGroup = new Map<string, number>([
  ["01-branches", 0.86],
  ["02-leaves", Math.PI * 0.42],
  ["03-fruit", Math.PI * 0.48],
]);
assert.deepEqual(first, second, "attachment output must not depend on caller spec order");
assert.equal(first.contract, "procplants.mesh-attachments");
assert.equal(first.requested, 16);
assert.equal(first.emitted, 16);
assert.deepEqual(first.groups.map((group) => group.id), ["01-branches", "02-leaves", "03-fruit"]);
assert.equal(new Set(first.attachments.map((attachment) => attachment.id)).size, first.attachments.length);

for (const attachment of first.attachments) {
  const surface = new THREE.Vector3().fromArray(attachment.surfacePosition);
  const position = new THREE.Vector3().fromArray(attachment.position);
  const support = new THREE.Vector3().fromArray(attachment.supportTangent);
  const outward = new THREE.Vector3().fromArray(attachment.outward);
  const tangent = new THREE.Vector3().fromArray(attachment.tangent);
  const right = new THREE.Vector3().fromArray(attachment.right);
  const up = new THREE.Vector3().fromArray(attachment.up);
  assert.ok(Math.abs(position.distanceTo(surface) - attachment.clearance) < 1e-8);
  assert.ok(Math.abs(support.dot(outward)) < 1e-6);
  assert.ok(Math.abs(tangent.length() - 1) < 1e-6);
  assert.ok(Math.abs(right.length() - 1) < 1e-6);
  assert.ok(Math.abs(up.length() - 1) < 1e-6);
  assert.ok(Math.abs(tangent.dot(right)) < 1e-6);
  assert.ok(Math.abs(tangent.dot(up)) < 1e-6);
  assert.ok(Math.abs(right.dot(up)) < 1e-6);
  assert.ok(new THREE.Vector3().crossVectors(tangent, right).dot(up) > 0.999999);
  const expectedTilt = tiltByGroup.get(attachment.groupId)!;
  assert.ok(Math.abs(support.dot(tangent) - Math.cos(expectedTilt)) < 1e-6);
  assert.ok(Math.abs(outward.dot(tangent) - Math.sin(expectedTilt)) < 1e-6);

  const transform = new THREE.Matrix4().fromArray(attachment.transform);
  const matrixPosition = new THREE.Vector3().setFromMatrixPosition(transform);
  assert.ok(matrixPosition.distanceTo(position) < 1e-8);
  assert.ok(transform.determinant() > 0, "attachment transform must remain right-handed after scaling");
  const elements = transform.elements;
  assert.ok(new THREE.Vector3(elements[0], elements[1], elements[2]).normalize().distanceTo(right) < 1e-8);
  assert.ok(new THREE.Vector3(elements[4], elements[5], elements[6]).normalize().distanceTo(up) < 1e-8);
  assert.ok(new THREE.Vector3(elements[8], elements[9], elements[10]).normalize().distanceTo(tangent) < 1e-8);
}
for (let left = 0; left < first.attachments.length; left++) {
  for (let right = left + 1; right < first.attachments.length; right++) {
    const a = new THREE.Vector3().fromArray(first.attachments[left]!.position);
    const b = new THREE.Vector3().fromArray(first.attachments[right]!.position);
    const spacing = Math.max(
      first.attachments[left]!.minimumSpacing,
      first.attachments[right]!.minimumSpacing,
    );
    assert.ok(a.distanceTo(b) + 1e-8 >= spacing);
  }
}
console.log("ok 1 - imported-mesh attachments are deterministic, spaced, clear, and right-handed");

const prefixSpec: ProcPlantMeshAttachmentSpec = {
  id: "stable-leaves",
  kind: "leaf",
  count: 3,
  startT: 0.2,
  endT: 0.8,
  azimuthJitterRadians: 0,
};
const prefix = createProcPlantMeshAttachments(spine, [prefixSpec], { seed: 99 });
const expanded = createProcPlantMeshAttachments(spine, [{ ...prefixSpec, count: 7 }], { seed: 99 });
assert.deepEqual(expanded.attachments.slice(0, 3), prefix.attachments);
console.log("ok 2 - increasing a group count preserves its stable attachment prefix");

const constrained = createProcPlantMeshAttachments(spine, [{
  id: "constrained",
  kind: "branch",
  count: 5,
  startT: 0.5,
  endT: 0.5,
  minimumSpacing: 100,
}], { seed: 7, maxCandidatesPerAttachment: 4 });
assert.equal(constrained.emitted, 1);
assert.equal(constrained.groups[0]!.emitted, 1);
assert.equal(constrained.groups[0]!.rejectedForSpacing, 19);
console.log("ok 3 - impossible spacing reports a deterministic shortfall without overlap");

assert.throws(() => createProcPlantMeshAttachments(spine, [
  { id: "duplicate", kind: "leaf", count: 1 },
  { id: "duplicate", kind: "branch", count: 1 },
]), /duplicate mesh attachment spec id/);
assert.throws(() => createProcPlantMeshAttachments(spine, [
  { id: "bad-scale", kind: "accessory", count: 1, scale: [1, 0, 1] },
]), /finite positive components/);
assert.throws(() => createProcPlantMeshAttachments(spine, [
  { id: "bad-range", kind: "leaf", count: 1, startT: 0.8, endT: 0.2 },
]), /0 <= startT <= endT <= 1/);
console.log("ok 4 - attachment specs reject duplicate IDs and invalid ranges/scales");
console.log("1..4");
