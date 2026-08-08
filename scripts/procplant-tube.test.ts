import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildProcPlantParallelTransportFrames,
  createProcPlantSweptTubeGeometry,
  procPlantPipeModelRadius,
  PROCPLANT_BRANCH_AGE_ATTRIBUTE,
  PROCPLANT_BRANCH_ORDER_ATTRIBUTE,
  PROCPLANT_BRANCH_SWAY_ATTRIBUTE,
  PROCPLANT_BRANCH_U_ATTRIBUTE,
  PROCPLANT_BRANCH_V_ATTRIBUTE,
} from "../src/procplant-tube";

const samples = Array.from({ length: 14 }, (_, index) => {
  const t = index / 13;
  return {
    position: new THREE.Vector3(Math.sin(t * Math.PI * 1.3) * 0.42, t * 3.2, Math.sin(t * Math.PI * 2) * 0.24),
    radius: THREE.MathUtils.lerp(0.32, 0.055, t),
    age: 0.3 + t * 0.7,
    branchOrder: 1,
  };
});

const frames = buildProcPlantParallelTransportFrames(samples);
assert.equal(frames.length, samples.length);
for (let index = 0; index < frames.length; index++) {
  const frame = frames[index]!;
  assert.ok(Math.abs(frame.tangent.length() - 1) < 1e-6);
  assert.ok(Math.abs(frame.right.length() - 1) < 1e-6);
  assert.ok(Math.abs(frame.up.length() - 1) < 1e-6);
  assert.ok(Math.abs(frame.tangent.dot(frame.right)) < 1e-6);
  assert.ok(frame.tangent.clone().cross(frame.right).dot(frame.up) > 0.999);
  if (index > 0) assert.ok(frame.right.dot(frames[index - 1]!.right) >= 0, "parallel frame flipped");
}

const geometry = createProcPlantSweptTubeGeometry(samples, {
  radialSegments: 7,
  seed: 42,
  irregularity: 0.08,
  collarStrength: 0.22,
  capStart: true,
  capEnd: true,
});
assert.equal(geometry.getAttribute("position").count, samples.length * 8 + 2);
assert.equal(geometry.index!.count / 3, (samples.length - 1) * 7 * 2 + 14);
for (const name of [
  "normal",
  "uv",
  "color",
  PROCPLANT_BRANCH_U_ATTRIBUTE,
  PROCPLANT_BRANCH_V_ATTRIBUTE,
  PROCPLANT_BRANCH_ORDER_ATTRIBUTE,
  PROCPLANT_BRANCH_AGE_ATTRIBUTE,
  PROCPLANT_BRANCH_SWAY_ATTRIBUTE,
]) assert.ok(geometry.hasAttribute(name), `missing ${name}`);
const sway = geometry.getAttribute(PROCPLANT_BRANCH_SWAY_ATTRIBUTE);
assert.equal(sway.getX(0), 0);
assert.ok(sway.getX(samples.length * 8 - 1) > 0.99);
assert.ok(geometry.boundingBox && geometry.boundingSphere);

const repeated = createProcPlantSweptTubeGeometry(samples, { radialSegments: 7, seed: 42, irregularity: 0.08 });
const repeatedAgain = createProcPlantSweptTubeGeometry(samples, { radialSegments: 7, seed: 42, irregularity: 0.08 });
assert.deepEqual(
  Array.from(repeated.getAttribute("position").array),
  Array.from(repeatedAgain.getAttribute("position").array),
);

const parent = procPlantPipeModelRadius([0.2, 0.16, 0.11], 2.2);
assert.ok(parent > 0.2);
assert.ok(Math.abs(parent ** 2.2 - (0.2 ** 2.2 + 0.16 ** 2.2 + 0.11 ** 2.2)) < 1e-10);
assert.throws(() => procPlantPipeModelRadius([0.1, -0.2]), /non-negative/);

geometry.dispose();
repeated.dispose();
repeatedAgain.dispose();
console.log("procplant swept-tube tests passed");
