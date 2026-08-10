import assert from "node:assert/strict";
import * as THREE from "three";
import {
  PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT,
  PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION,
  appendProcPlantOrganPlacement,
  applyProcPlantOrganPlacementOverrides,
  createProcPlantOrganPlacementPackage,
  createProcPlantOrganPlacementTarget,
} from "../src/procplant-organ-placement-overrides";
import type { ProcPlantGraph } from "../src/procplants";
import {
  PROCPLANT_THREE_PLACEMENT_DECAL_CONTRACT,
  createProcPlantThreePlacementDecalBinding,
  createProcPlantThreePlacementDecalDraws,
} from "../src/procplant-placement-decal-three";

const graph: ProcPlantGraph = {
  stems: [
    { position: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.1, depth: 0, t: 0, index: 0 },
    { position: new THREE.Vector3(0, 1, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.08, depth: 0, t: 1, index: 1 },
  ],
  segments: [[0, 1]],
  segmentRecords: [{ id: "trunk:0", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 1 }],
  organs: [],
  attachments: [],
};
const target = createProcPlantOrganPlacementTarget("decal-fixture", 42, graph);
const binding = {
  contract: PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT,
  version: PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION,
  materialId: "renderer-scar-material",
  textureId: "user-scar-texture",
  uvSet: 0,
  uvRect: [0.125, 0.25, 0.875, 0.75],
} as const;
const appended = appendProcPlantOrganPlacement(createProcPlantOrganPlacementPackage(target), {
  kind: "decal",
  segmentId: "trunk:0",
  axialT: 0.5,
  azimuth: 0,
  scale: 0.18,
  decal: binding,
});
assert(appended.operation);
const applied = applyProcPlantOrganPlacementOverrides(graph, target, appended.package, { decalBindings: [binding] });
assert.equal(applied.decals.length, 1);

const texture = new THREE.DataTexture(Uint8Array.of(91, 47, 26, 255), 1, 1);
texture.needsUpdate = true;
const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.2 });
let materialDisposals = 0;
let textureDisposals = 0;
material.addEventListener("dispose", () => materialDisposals++);
texture.addEventListener("dispose", () => textureDisposals++);
const borrowed = createProcPlantThreePlacementDecalBinding({ binding, material, texture });
assert.equal(borrowed.metadata.contract, PROCPLANT_THREE_PLACEMENT_DECAL_CONTRACT);
assert.equal(borrowed.metadata.exportSupport, "metadata-only");
assert.equal(borrowed.metadata.materialOwnership, "borrowed");
assert.equal(borrowed.metadata.textureOwnership, "borrowed");

const draws = createProcPlantThreePlacementDecalDraws(applied.decals, borrowed);
assert.equal(draws.audit.draws, 1);
assert.equal(draws.audit.vertices, 4);
assert.equal(draws.audit.triangles, 2);
assert.equal(draws.audit.uv0Pairs, 4);
assert.equal(draws.root.children.length, 1);
const mesh = draws.root.children[0] as THREE.Mesh;
assert.strictEqual(mesh.material, material, "draws must borrow the exact renderer material");
assert.deepEqual([...mesh.geometry.getAttribute("uv").array], [...applied.decals[0]!.template.uv0]);
assert.equal(mesh.geometry.getAttribute("procplantSway").count, 4);
assert.equal(mesh.geometry.index?.count, 6);
let geometryDisposals = 0;
mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
draws.dispose();
draws.dispose();
assert.equal(geometryDisposals, 1, "draw disposal must release owned geometry exactly once");
assert.equal(materialDisposals, 0, "draw disposal must not release the borrowed binding material");
assert.equal(textureDisposals, 0, "draw disposal must not release the borrowed binding texture");
borrowed.dispose();
assert.equal(materialDisposals, 0, "borrowed binding disposal must preserve renderer resources");
assert.equal(textureDisposals, 0, "borrowed binding disposal must preserve renderer resources");
assert.throws(() => createProcPlantThreePlacementDecalDraws(applied.decals, borrowed), /disposed/);

const ownedTexture = texture.clone();
const ownedMaterial = new THREE.MeshBasicMaterial({ map: ownedTexture });
let ownedMaterialDisposals = 0;
let ownedTextureDisposals = 0;
ownedMaterial.addEventListener("dispose", () => ownedMaterialDisposals++);
ownedTexture.addEventListener("dispose", () => ownedTextureDisposals++);
const owned = createProcPlantThreePlacementDecalBinding({
  binding,
  material: ownedMaterial,
  texture: ownedTexture,
  materialOwnership: "owned",
  textureOwnership: "owned",
});
owned.dispose();
owned.dispose();
assert.equal(ownedMaterialDisposals, 1);
assert.equal(ownedTextureDisposals, 1);

assert.throws(() => createProcPlantThreePlacementDecalBinding({
  binding,
  material: new THREE.MeshBasicMaterial(),
  texture,
}), /exact bound texture/);
const otherBinding = { ...binding, textureId: "other-texture" };
const otherTexture = texture.clone();
const otherMaterial = new THREE.MeshBasicMaterial({ map: otherTexture });
const other = createProcPlantThreePlacementDecalBinding({ binding: otherBinding, material: otherMaterial, texture: otherTexture });
assert.throws(() => createProcPlantThreePlacementDecalDraws(applied.decals, other), /exactly match/);
assert.throws(() => createProcPlantThreePlacementDecalDraws([], other), /1\.\.96/);
other.dispose();

console.log("ok 1 - renderer-owned placement decal bindings materialize exact UV0 draws with deterministic ownership and fail-closed mismatches");
