import assert from "node:assert/strict";
import * as THREE from "three";
import {
  materializeProcPlantAttachments,
  type ProcPlantAttachmentPrototype,
} from "../src/procplant-attachment-materializer";
import {
  createProcPlantManualMeshSpine,
  createProcPlantMeshAttachments,
} from "../src/procplant-mesh-helper";

const spine = createProcPlantManualMeshSpine([
  { position: new THREE.Vector3(0, 0, 0), radius: 0.4 },
  { position: new THREE.Vector3(0.1, 1, 0), radius: 0.32 },
  { position: new THREE.Vector3(-0.05, 2, 0.1), radius: 0.2 },
]);
const source = createProcPlantMeshAttachments(spine, [
  { id: "hero-branches", kind: "branch", count: 3, startT: 0.1, endT: 0.8, scale: 0.4 },
  { id: "hero-leaves", kind: "leaf", count: 2, startT: 0.2, endT: 0.95, scale: 0.2 },
  { id: "hero-organs-00-berry", kind: "accessory", count: 4, startT: 0.15, endT: 0.9, scale: 0.08 },
], { seed: 91, maxCandidatesPerAttachment: 8 });
const sourceSnapshot = JSON.stringify(source);

const makePrototypes = () => {
  const branchGeometry = new THREE.CylinderGeometry(0.04, 0.1, 1, 5, 1, false);
  branchGeometry.rotateX(Math.PI / 2);
  branchGeometry.translate(0, 0, 0.5);
  const accessoryGeometry = new THREE.OctahedronGeometry(0.5, 0);
  const branchMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
  const accessoryMaterial = new THREE.MeshStandardMaterial({ color: 0xaa2244 });
  const prototypes: ProcPlantAttachmentPrototype[] = [
    {
      id: "branch-stub",
      groupIds: ["hero-branches"],
      geometry: branchGeometry,
      material: branchMaterial,
      ownsGeometry: true,
      ownsMaterial: true,
    },
    {
      id: "berry",
      groupIds: ["hero-organs-00-berry"],
      geometry: accessoryGeometry,
      material: accessoryMaterial,
      ownsGeometry: true,
      ownsMaterial: true,
    },
  ];
  return { prototypes, branchGeometry, accessoryGeometry, branchMaterial, accessoryMaterial };
};

const firstResources = makePrototypes();
const first = materializeProcPlantAttachments(source, firstResources.prototypes);
const secondResources = makePrototypes();
const second = materializeProcPlantAttachments(source, secondResources.prototypes);
assert.deepEqual(first.audit, second.audit, "materialization diagnostics must be deterministic across fresh Three resources");
assert.match(first.audit.contentHash, /^fnv1a32:[0-9a-f]{8}$/);
assert.equal(first.audit.sourceAttachments, 9);
assert.equal(first.audit.candidateAttachments, 7);
assert.equal(first.audit.skippedAttachments, 2);
assert.equal(first.audit.materializedAttachments, 7);
assert.equal(first.audit.branchInstances, 3);
assert.equal(first.audit.accessoryInstances, 4);
assert.equal(first.audit.instanceDraws, 2);
assert.equal(first.audit.unmatchedAttachmentIds.length, 0);
assert.equal(first.group.children.length, 2);
assert.equal(first.meshes.length, 2);
assert.equal(
  first.audit.materializedTriangles,
  first.audit.prototypes.reduce((sum, prototype) => sum + prototype.prototypeTriangles * prototype.instances, 0),
);
assert.equal(
  first.audit.materializedVertices,
  first.audit.prototypes.reduce((sum, prototype) => sum + prototype.prototypeVertices * prototype.instances, 0),
);

for (const mesh of first.meshes) {
  const prototypeId = mesh.userData.procplantAttachmentPrototype.id as string;
  const prototype = firstResources.prototypes.find((entry) => entry.id === prototypeId)!;
  assert.strictEqual(mesh.geometry, prototype.geometry, "every cohort must share its one supplied prototype geometry");
  assert.strictEqual(mesh.material, prototype.material, "every cohort must share its one supplied prototype material");
  const groupIds = new Set(prototype.groupIds);
  const records = source.attachments.filter((attachment) => groupIds.has(attachment.groupId));
  assert.equal(mesh.count, records.length);
  for (let index = 0; index < records.length; index++) {
    const actual = new THREE.Matrix4();
    mesh.getMatrixAt(index, actual);
    const expected = records[index]!.transform.map(Math.fround);
    assert.deepEqual(actual.toArray(), expected, `${prototypeId} instance ${index} must preserve the exact float32 transform`);
  }
}
assert.equal(JSON.stringify(source), sourceSnapshot, "materialization must not mutate attachment records");
console.log("ok 1 - branch/accessory records become deterministic shared-prototype instances with exact diagnostics");

const partialGeometry = new THREE.BoxGeometry(1, 1, 1);
const partialMaterial = new THREE.MeshBasicMaterial();
const partial = materializeProcPlantAttachments(source, [{
  id: "branch-only",
  groupIds: ["hero-branches"],
  geometry: partialGeometry,
  material: partialMaterial,
}], { failOnUnmatched: false });
assert.equal(partial.audit.materializedAttachments, 3);
assert.deepEqual(
  partial.audit.unmatchedAttachmentIds,
  source.attachments.filter((attachment) => attachment.kind === "accessory").map((attachment) => attachment.id).sort(),
);
partial.dispose();
partialGeometry.dispose();
partialMaterial.dispose();
const missingGeometry = new THREE.BoxGeometry(1, 1, 1);
const missingMaterial = new THREE.MeshBasicMaterial();
assert.throws(() => materializeProcPlantAttachments(source, [{
  id: "branch-only",
  groupIds: ["hero-branches"],
  geometry: missingGeometry,
  material: missingMaterial,
}]), /lack prototype mappings/);
missingGeometry.dispose();
missingMaterial.dispose();
const duplicateGeometryA = new THREE.BoxGeometry(1, 1, 1);
const duplicateGeometryB = new THREE.BoxGeometry(1, 1, 1);
const duplicateMaterialA = new THREE.MeshBasicMaterial();
const duplicateMaterialB = new THREE.MeshBasicMaterial();
assert.throws(() => materializeProcPlantAttachments(source, [
  { id: "duplicate-a", groupIds: ["hero-branches"], geometry: duplicateGeometryA, material: duplicateMaterialA },
  { id: "duplicate-b", groupIds: ["hero-branches"], geometry: duplicateGeometryB, material: duplicateMaterialB },
]), /maps to both/);
duplicateGeometryA.dispose();
duplicateGeometryB.dispose();
duplicateMaterialA.dispose();
duplicateMaterialB.dispose();
console.log("ok 2 - missing and ambiguous prototype mappings fail closed or remain explicitly audited");

let geometryDisposals = 0;
let materialDisposals = 0;
let meshDisposals = 0;
for (const geometry of [firstResources.branchGeometry, firstResources.accessoryGeometry]) {
  geometry.addEventListener("dispose", () => geometryDisposals++);
}
for (const material of [firstResources.branchMaterial, firstResources.accessoryMaterial]) {
  material.addEventListener("dispose", () => materialDisposals++);
}
for (const mesh of first.meshes) mesh.addEventListener("dispose", () => meshDisposals++);
const branchPositionSnapshot = new Float32Array(firstResources.branchGeometry.getAttribute("position").array);
first.dispose();
first.dispose();
assert.equal(first.isDisposed(), true);
assert.equal(first.group.children.length, 0);
assert.equal(geometryDisposals, 2, "owned prototype geometries must be disposed exactly once");
assert.equal(materialDisposals, 2, "owned prototype materials must be disposed exactly once");
assert.equal(meshDisposals, 2, "instance-owned GPU buffers must be disposed exactly once");
assert.deepEqual(
  new Float32Array(firstResources.branchGeometry.getAttribute("position").array),
  branchPositionSnapshot,
  "disposal must not mutate prototype vertex data",
);
second.dispose();
assert.equal(JSON.stringify(source), sourceSnapshot, "disposal must not mutate the source package");
console.log("ok 3 - explicit ownership provides idempotent disposal without mutating source or prototype bytes");
console.log("1..3");
