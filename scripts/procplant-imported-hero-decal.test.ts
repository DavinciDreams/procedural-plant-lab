import assert from "node:assert/strict";
import * as THREE from "three";
import {
  appendProcPlantImportedHeroDecal,
  applyProcPlantImportedHeroDecals,
  createProcPlantImportedHeroDecalPackage,
  inspectProcPlantImportedHeroDecalTarget,
  parseProcPlantImportedHeroDecals,
  PROCPLANT_IMPORTED_HERO_DECAL_MAX_OPERATIONS,
  serializeProcPlantImportedHeroDecals,
  undoLastProcPlantImportedHeroDecal,
} from "../src/procplant-imported-hero-decal";
import type { ProcPlantHeroSpineAuthoringPackage } from "../src/procplant-hero-spine-authoring";
import type { ProcPlantPlacementDecalBinding } from "../src/procplant-organ-placement-overrides";

const geometry = new THREE.BoxGeometry(1, 2, 1, 1, 1, 1).toNonIndexed();
geometry.setIndex(Array.from({ length: geometry.getAttribute("position").count }, (_, index) => index));
const authored = {
  contentHash: "fnv1a32:authoring",
  provenance: {
    sourceContentHash: "fnv1a32:source",
    instanceId: "node:0/mesh:0/primitive:0",
    nodePath: "root/trunk",
    meshIndex: 0,
    primitiveIndex: 0,
    materialIndex: 0,
    transformsBaked: true,
  },
} as ProcPlantHeroSpineAuthoringPackage;
const inspection = inspectProcPlantImportedHeroDecalTarget(authored, geometry);
const sourcePositions = (geometry.getAttribute("position") as THREE.BufferAttribute).array.slice();
const sourceNormals = (geometry.getAttribute("normal") as THREE.BufferAttribute).array.slice();
const sourceIndices = geometry.getIndex()!.array.slice();
assert.equal(inspection.reason, "static");
assert.ok(inspection.target);
assert.equal(inspection.target.triangleCount, 12);
assert.match(inspection.target.geometrySignature, /^geometry-v1-fnv1a32:/);

const binding: ProcPlantPlacementDecalBinding = {
  contract: "procplants.placement-decal-binding",
  version: 1,
  materialId: "user-decal-material",
  textureId: "sha256:user-decal",
  uvSet: 0,
  uvRect: [0.1, 0.2, 0.9, 0.8],
};
const index = geometry.getIndex()!;
const position = geometry.getAttribute("position") as THREE.BufferAttribute;
const ia = index.getX(0); const ib = index.getX(1); const ic = index.getX(2);
const point = new THREE.Vector3().fromBufferAttribute(position, ia)
  .add(new THREE.Vector3().fromBufferAttribute(position, ib))
  .add(new THREE.Vector3().fromBufferAttribute(position, ic)).multiplyScalar(1 / 3);
let decalPackage = createProcPlantImportedHeroDecalPackage(inspection.target);
const appended = appendProcPlantImportedHeroDecal(decalPackage, geometry, { triangleIndex: 0, localPoint: point, size: 0.25, binding });
assert.equal(appended.reason, null);
assert.ok(appended.operation);
decalPackage = appended.package;
assert.deepEqual(appended.operation.barycentric.map((value) => Number(value.toFixed(5))), [0.33333, 0.33333, 0.33333]);

const applied = applyProcPlantImportedHeroDecals(inspection.target, geometry, decalPackage, [binding]);
assert.equal(applied.targetMatched, true);
assert.equal(applied.decals.length, 1);
assert.deepEqual([...applied.decals[0]!.template.uv0].map((value) => Number(value.toFixed(5))), [0.1, 0.8, 0.9, 0.8, 0.9, 0.2, 0.1, 0.2]);
assert.deepEqual([...applied.decals[0]!.template.idx], [0, 1, 2, 0, 2, 3]);
assert.equal(applied.decals[0]!.template.pos.length, 12);
assert.equal(applied.unsupported.length, 0);
assert.deepEqual((geometry.getAttribute("position") as THREE.BufferAttribute).array, sourcePositions, "targeting must not mutate imported positions");
assert.deepEqual((geometry.getAttribute("normal") as THREE.BufferAttribute).array, sourceNormals, "targeting must not mutate imported normals");
assert.deepEqual(geometry.getIndex()!.array, sourceIndices, "targeting must not mutate imported indices");

const missing = applyProcPlantImportedHeroDecals(inspection.target, geometry, decalPackage, []);
assert.equal(missing.decals.length, 0);
assert.deepEqual(missing.unsupported.map(({ reason }) => reason), ["missing-binding"]);

const staleGeometry = geometry.clone();
(staleGeometry.getAttribute("position") as THREE.BufferAttribute).setX(0, 9);
const stale = applyProcPlantImportedHeroDecals(inspection.target, staleGeometry, decalPackage, [binding]);
assert.equal(stale.targetMatched, false);
assert.equal(stale.decals.length, 0);
assert.deepEqual(stale.unsupported, [{ operationId: null, reason: "target-mismatch" }]);

const json = serializeProcPlantImportedHeroDecals(decalPackage);
assert.deepEqual(parseProcPlantImportedHeroDecals(json), decalPackage);
assert.throws(() => parseProcPlantImportedHeroDecals(JSON.stringify({ ...decalPackage, operations: [{ ...decalPackage.operations[0], triangleIndex: 999 }] })), /invalid imported-hero decal package/);
assert.equal(undoLastProcPlantImportedHeroDecal(decalPackage).operations.length, 0);

let capped = createProcPlantImportedHeroDecalPackage(inspection.target);
for (let count = 0; count < PROCPLANT_IMPORTED_HERO_DECAL_MAX_OPERATIONS; count++) {
  const result = appendProcPlantImportedHeroDecal(capped, geometry, { triangleIndex: count % 12, localPoint: point, size: 0.1, binding });
  assert.ok(result.operation);
  capped = result.package;
}
assert.equal(appendProcPlantImportedHeroDecal(capped, geometry, { triangleIndex: 0, localPoint: point, size: 0.1, binding }).reason, "cap");
assert.equal(inspectProcPlantImportedHeroDecalTarget({ ...authored, provenance: { ...authored.provenance, materialIndex: null } } as ProcPlantHeroSpineAuthoringPackage, geometry).reason, "ambiguous-material");
assert.equal(inspectProcPlantImportedHeroDecalTarget({ ...authored, provenance: { ...authored.provenance, transformsBaked: false } } as ProcPlantHeroSpineAuthoringPackage, geometry).reason, "unbaked-transform");

console.log("Imported-hero decal contract tests passed: exact triangle/geometry provenance, UV0 draw, stale/missing fail-closed behavior, undo/JSON, and hard cap.");
