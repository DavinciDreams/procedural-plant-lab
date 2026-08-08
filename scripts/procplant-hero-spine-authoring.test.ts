import assert from "node:assert/strict";
import * as THREE from "three";
import {
  authorProcPlantHeroSpine,
  createProcPlantHeroSpineGeometry,
  selectProcPlantHeroSpineMesh,
  type ProcPlantHeroSpineAuthoringOptions,
} from "../src/procplant-hero-spine-authoring";
import type {
  ProcPlantHeroGlbImportPackage,
  ProcPlantHeroGlbMeshPrimitive,
} from "../src/procplant-hero-glb-import";
import { createProcPlantManualMeshSpine } from "../src/procplant-mesh-helper";
import { PROCPLANT_BRANCH_SWAY_ATTRIBUTE } from "../src/procplant-tube";
import { createProcPlantLabHeroExportScene } from "../src/procplant-lab-authoring-imports";

const cylinder = new THREE.CylinderGeometry(1, 1.25, 4, 16, 4, false);
const positions = new Float32Array(cylinder.getAttribute("position").array);
const normals = new Float32Array(cylinder.getAttribute("normal").array);
const uv0 = new Float32Array(cylinder.getAttribute("uv").array);
const indices = new Uint32Array(cylinder.getIndex()!.array);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const primitive = (
  instanceId: string,
  nodePath: string,
  meshIndex: number,
): ProcPlantHeroGlbMeshPrimitive => ({
  instanceId,
  nodeIndex: meshIndex,
  nodePath,
  meshIndex,
  primitiveIndex: 0,
  name: `trunk-${meshIndex}`,
  materialIndex: 0,
  transformsBaked: false,
  worldMatrix: identity,
  positions,
  normals,
  uv0,
  indices,
});
const packageSource: ProcPlantHeroGlbImportPackage = {
  contract: "procplants.hero-glb-import",
  version: 1,
  inspection: {
    contract: "procplants.hero-glb-import",
    version: 1,
    contentHash: "fixture-hero-hash",
    byteLength: 4096,
    generator: "focused-test",
    scenes: 1,
    nodes: 2,
    meshes: 2,
    meshInstances: 2,
    primitives: 2,
    materials: 1,
    textures: 0,
    images: [],
    primitivesDetail: [],
    extensionsUsed: [],
    extensionsRequired: [],
  },
  meshes: [
    primitive("node:000000:mesh:000000:primitive:000000", "node:000000", 0),
    primitive("node:000001:mesh:000001:primitive:000000", "node:000001", 1),
  ],
  textures: [],
};

assert.equal(
  selectProcPlantHeroSpineMesh(packageSource, { instanceId: packageSource.meshes[1]!.instanceId }),
  packageSource.meshes[1],
);
assert.equal(
  selectProcPlantHeroSpineMesh(packageSource, { nodePath: "node:000000", meshIndex: 0, primitiveIndex: 0 }),
  packageSource.meshes[0],
);
assert.throws(() => selectProcPlantHeroSpineMesh(packageSource, { instanceId: "missing" }), /did not match/);
const ambiguous = { ...packageSource, meshes: [packageSource.meshes[0]!, packageSource.meshes[0]!] };
assert.throws(() => selectProcPlantHeroSpineMesh(ambiguous, { instanceId: packageSource.meshes[0]!.instanceId }), /ambiguous/);
console.log("ok 1 - stable instance and node/mesh/primitive provenance selectors fail closed");

const sourceSnapshots = packageSource.meshes.map((mesh) => ({
  positions: new Float32Array(mesh.positions),
  normals: mesh.normals ? new Float32Array(mesh.normals) : null,
  uv0: mesh.uv0 ? new Float32Array(mesh.uv0) : null,
  indices: mesh.indices ? new Uint32Array(mesh.indices) : null,
  worldMatrix: [...mesh.worldMatrix],
}));
const options: ProcPlantHeroSpineAuthoringOptions = {
  selector: { instanceId: packageSource.meshes[1]!.instanceId },
  autoFit: { samples: 7, axis: "y" },
  barkRepeatLength: 0.75,
  swayPower: 2,
  emitSpineAnchorsEvery: 2,
  attachmentSpecs: [{
    id: "primary-branches",
    kind: "branch",
    count: 3,
    startT: 0.25,
    endT: 0.75,
    clearance: 0,
    minimumSpacing: 0.2,
  }],
  attachmentOptions: { seed: 73, maxCandidatesPerAttachment: 32 },
  collars: { branchRadiusScale: 0.45, strength: 0.6 },
};
const authoredA = authorProcPlantHeroSpine(packageSource, options);
const authoredB = authorProcPlantHeroSpine(packageSource, options);
assert.equal(authoredA.contentHash, authoredB.contentHash);
assert.deepEqual(authoredA.positions, authoredB.positions);
assert.equal(authoredA.provenance.instanceId, packageSource.meshes[1]!.instanceId);
assert.equal(authoredA.provenance.sourceContentHash, "fixture-hero-hash");
assert.equal(authoredA.audit.selectedBy, "instanceId");
assert.equal(authoredA.audit.spineSource, "auto-fit");
assert.equal(authoredA.audit.spineSamples, 7);
assert.equal(authoredA.binding.vertexCount, positions.length / 3);
assert.equal(authoredA.binding.uv.length, authoredA.binding.vertexCount * 2);
assert.equal(authoredA.binding.branchU.length, authoredA.binding.vertexCount);
assert.equal(authoredA.binding.sway.length, authoredA.binding.vertexCount);
assert.equal(authoredA.binding.spineSegment.length, authoredA.binding.vertexCount);
assert.equal(authoredA.attachments?.emitted, 3);
assert.equal(authoredA.audit.collarAnchors, 3);
assert.ok(authoredA.spineAnchors.length >= 4);
assert.ok(authoredA.collars && authoredA.collars.audit.affectedVertices > 0);
assert.equal(authoredA.audit.normalsRecomputed, true);
assert.match(authoredA.audit.warnings.join(" "), /node-local/);
assert.match(authoredA.audit.warnings.join(" "), /watertight/);
assert.ok(authoredA.audit.unsupportedBoundaries.some((boundary) => /skinned/.test(boundary)));
assert.ok(authoredA.audit.unsupportedBoundaries.some((boundary) => /compressed/.test(boundary)));
assert.ok(authoredA.audit.unsupportedBoundaries.some((boundary) => /external/.test(boundary)));
for (let index = 0; index < packageSource.meshes.length; index++) {
  const mesh = packageSource.meshes[index]!;
  const snapshot = sourceSnapshots[index]!;
  assert.deepEqual(mesh.positions, snapshot.positions);
  assert.deepEqual(mesh.normals, snapshot.normals);
  assert.deepEqual(mesh.uv0, snapshot.uv0);
  assert.deepEqual(mesh.indices, snapshot.indices);
  assert.deepEqual(mesh.worldMatrix, snapshot.worldMatrix);
}
console.log("ok 2 - auto-fit binding, deterministic attachments/collars, audits, and source nonmutation");

const renderGeometry = createProcPlantHeroSpineGeometry(authoredA);
assert.equal(renderGeometry.getAttribute("position").count, authoredA.audit.vertexCount);
assert.equal(renderGeometry.getAttribute("uv").count, authoredA.audit.vertexCount);
assert.equal(renderGeometry.getAttribute(PROCPLANT_BRANCH_SWAY_ATTRIBUTE).count, authoredA.audit.vertexCount);
assert.equal(renderGeometry.getAttribute("procplantSpineSegment").count, authoredA.audit.vertexCount);
assert.equal(renderGeometry.getAttribute("procplantCollarWeight").count, authoredA.audit.vertexCount);
assert.equal(renderGeometry.index?.count, indices.length);
assert.equal(renderGeometry.userData.procplantHeroSpine.contentHash, authoredA.contentHash);
assert.deepEqual(renderGeometry.userData.procplantHeroSpine.provenance.worldMatrix, identity);
renderGeometry.dispose();
console.log("ok 3 - minimal Three adapter emits owned render/export attributes and provenance metadata");

const manual = createProcPlantManualMeshSpine([
  { position: new THREE.Vector3(0, -2, 0), radius: 1.2, age: 0, branchOrder: 0 },
  { position: new THREE.Vector3(0.1, 0, 0), radius: 1.1, age: 0.5, branchOrder: 0 },
  { position: new THREE.Vector3(0, 2, 0), radius: 1, age: 1, branchOrder: 0 },
]);
const withoutNormals: ProcPlantHeroGlbImportPackage = {
  ...packageSource,
  meshes: [{ ...packageSource.meshes[0]!, normals: undefined }],
};
const manualAuthored = authorProcPlantHeroSpine(withoutNormals, {
  selector: { nodePath: "node:000000", meshIndex: 0, primitiveIndex: 0 },
  manualSpine: manual,
});
assert.equal(manualAuthored.audit.spineSource, "manual");
assert.equal(manualAuthored.audit.normalsRecomputed, true);
assert.equal(manualAuthored.normals.length, manualAuthored.positions.length);
assert.notEqual(manualAuthored.spine, manual);
assert.notEqual(manualAuthored.spine.samples[0]!.position, manual.samples[0]!.position);
assert.equal(manualAuthored.attachments, null);
assert.equal(manualAuthored.collars, null);
console.log("ok 4 - manual spines and missing-normal primitives produce independent complete geometry data");

assert.throws(() => authorProcPlantHeroSpine(packageSource, { ...options, maxVertices: 8 }), /maxVertices/);
assert.throws(() => authorProcPlantHeroSpine(packageSource, { ...options, maxBindingWorkItems: 100 }), /maxBindingWorkItems/);
assert.throws(() => authorProcPlantHeroSpine(packageSource, { ...options, maxOutputBytes: 100 }), /maxOutputBytes/);
assert.throws(() => authorProcPlantHeroSpine(packageSource, {
  ...options,
  maxAttachments: 2,
}), /maxAttachments/);
assert.throws(() => authorProcPlantHeroSpine(packageSource, {
  ...options,
  autoFit: { samples: 129 },
}), /samples/);
const invalidIndexSource: ProcPlantHeroGlbImportPackage = {
  ...packageSource,
  meshes: [{ ...packageSource.meshes[0]!, indices: new Uint32Array([0, 1, 999_999]) }],
};
assert.throws(() => authorProcPlantHeroSpine(invalidIndexSource, {
  selector: { instanceId: invalidIndexSource.meshes[0]!.instanceId },
}), /exceeds the vertex count/);
console.log("ok 5 - strict mesh, work, sample, attachment, and topology caps reject before authoring");

const preview = new THREE.Group();
preview.position.set(12, 3, -7);
preview.rotation.set(0.2, -0.4, 0.1);
preview.scale.setScalar(0.125);
preview.updateMatrix();
const previewChild = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshBasicMaterial());
previewChild.position.set(1, 2, 3);
preview.add(previewChild);
const previewMatrix = preview.matrix.toArray();
const exportScene = createProcPlantLabHeroExportScene(preview, { contentHash: "fixture" });
const exportRoot = exportScene.children[0] as THREE.Group;
assert.notEqual(exportRoot, preview);
assert.deepEqual(exportRoot.position.toArray(), [0, 0, 0]);
assert.deepEqual(exportRoot.quaternion.toArray(), [0, 0, 0, 1]);
assert.deepEqual(exportRoot.scale.toArray(), [1, 1, 1]);
assert.deepEqual((exportRoot.children[0] as THREE.Mesh).position.toArray(), [1, 2, 3]);
assert.deepEqual(preview.matrix.toArray(), previewMatrix, "export preparation must not mutate the live preview");
previewChild.geometry.dispose();
(previewChild.material as THREE.Material).dispose();
console.log("ok 6 - hero export strips display-only fit transforms without mutating authored content");
console.log("1..6");

cylinder.dispose();
