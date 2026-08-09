import assert from "node:assert/strict";
import * as THREE from "three";
import { createProcPlantManualMeshSpine } from "../src/procplant-mesh-helper";
import {
  addProcPlantHeroSpineEditorPoint,
  createProcPlantHeroSpineEditorState,
  deleteProcPlantHeroSpineEditorPoint,
  moveProcPlantHeroSpineEditorPoint,
  procPlantHeroSpineEditorStateToSpine,
  selectProcPlantHeroSpineEditorPoint,
} from "../src/procplant-hero-spine-editor";

const spine = createProcPlantManualMeshSpine([
  { position: new THREE.Vector3(0, 0, 0), radius: 0.4, age: 0, branchOrder: 0 },
  { position: new THREE.Vector3(0.1, 1, 0), radius: 0.28, age: 0.5, branchOrder: 0 },
  { position: new THREE.Vector3(0.2, 2, 0.1), radius: 0.12, age: 1, branchOrder: 0 },
]);
const spineSnapshot = JSON.stringify(spine.samples.map((sample) => ({
  position: sample.position.toArray(),
  radius: sample.radius,
  age: sample.age,
})));

const first = createProcPlantHeroSpineEditorState(spine, "fnv1a32:source");
const second = createProcPlantHeroSpineEditorState(spine, "fnv1a32:source");
assert.deepEqual(first, second, "editor initialization must be deterministic");
assert.equal(first.points.length, 3);

const selected = selectProcPlantHeroSpineEditorPoint(first, first.points[1]!.id);
const added = addProcPlantHeroSpineEditorPoint(selected);
assert.equal(added.points.length, 4);
assert.equal(added.selectedPointId, "spine-point-003");
const moved = moveProcPlantHeroSpineEditorPoint(added, added.selectedPointId!, [0.35, 1.3, -0.15]);
assert.deepEqual(moved.points.find((point) => point.id === moved.selectedPointId)!.position, [0.35, 1.3, -0.15]);
const deleted = deleteProcPlantHeroSpineEditorPoint(moved);
assert.equal(deleted.points.length, 3);
assert.notEqual(deleted.contentHash, moved.contentHash);

const rebuilt = procPlantHeroSpineEditorStateToSpine(moved);
assert.equal(rebuilt.samples.length, 4);
assert.equal(rebuilt.samples[0]!.age, 0);
assert.equal(rebuilt.samples.at(-1)!.age, 1);
assert.equal(JSON.stringify(spine.samples.map((sample) => ({
  position: sample.position.toArray(),
  radius: sample.radius,
  age: sample.age,
}))), spineSnapshot, "editor operations must not mutate the source spine");

assert.throws(
  () => moveProcPlantHeroSpineEditorPoint(moved, moved.points[1]!.id, moved.points[0]!.position),
  /degenerate/,
);
assert.throws(
  () => procPlantHeroSpineEditorStateToSpine({ ...moved, contentHash: "fnv1a32:tampered" }),
  /content hash/,
);
let minimal = deleteProcPlantHeroSpineEditorPoint(first, first.points[1]!.id);
assert.equal(minimal.points.length, 2);
assert.throws(() => deleteProcPlantHeroSpineEditorPoint(minimal), /at least two/);

console.log("procplant hero spine editor state tests passed");
