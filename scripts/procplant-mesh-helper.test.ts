import assert from "node:assert/strict";
import * as THREE from "three";
import {
  applyProcPlantMeshSpineBinding,
  bindProcPlantMeshToSpine,
  createProcPlantMeshSpineAnchors,
  fitProcPlantMeshSpine,
  PROCPLANT_SPINE_SEGMENT_ATTRIBUTE,
} from "../src/procplant-mesh-helper";

const geometry = new THREE.CylinderGeometry(0.5, 0.8, 4, 12, 8, true);
geometry.rotateY(0.37);
const positions = geometry.getAttribute("position").array;
const first = fitProcPlantMeshSpine(positions, { samples: 9, axis: "y" });
const second = fitProcPlantMeshSpine(positions, { samples: 9, axis: "y" });
assert.deepEqual(
  first.samples.map((sample) => [...sample.position.toArray(), sample.radius]),
  second.samples.map((sample) => [...sample.position.toArray(), sample.radius]),
);
assert.equal(first.samples.length, 9);
assert.ok(first.samples.every((sample) => Math.abs(sample.position.x) < 1e-5 && Math.abs(sample.position.z) < 1e-5));
assert.ok(first.samples[0]!.radius > first.samples.at(-1)!.radius);

const binding = bindProcPlantMeshToSpine(positions, first, { barkRepeatLength: 1.25 });
assert.equal(binding.vertexCount, geometry.getAttribute("position").count);
assert.ok(Array.from(binding.uv).every(Number.isFinite));
assert.ok(Array.from(binding.branchU).every((value) => value >= 0 && value <= 1));
assert.ok(Array.from(binding.sway).every((value) => value >= 0 && value <= 1));
applyProcPlantMeshSpineBinding(geometry, binding);
assert.equal(geometry.getAttribute("uv").count, binding.vertexCount);
assert.equal(geometry.getAttribute(PROCPLANT_SPINE_SEGMENT_ATTRIBUTE).count, binding.vertexCount);

const anchors = createProcPlantMeshSpineAnchors(first, 2);
assert.deepEqual(anchors.map((anchor) => anchor.sampleIndex), [0, 2, 4, 6, 8]);
for (const anchor of anchors) {
  const tangent = new THREE.Vector3().fromArray(anchor.tangent);
  const right = new THREE.Vector3().fromArray(anchor.right);
  const up = new THREE.Vector3().fromArray(anchor.up);
  assert.ok(Math.abs(tangent.dot(right)) < 1e-6);
  assert.ok(Math.abs(tangent.dot(up)) < 1e-6);
  assert.ok(new THREE.Vector3().crossVectors(tangent, right).dot(up) > 0.999);
}

geometry.dispose();
console.log("procplant mesh helper tests passed");
