import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildProcPlantImpostorAtlas,
  createProcPlantImpostorAtlasTexture,
  createProcPlantImpostorCapturePlan,
} from "../src/procplant-impostor";
import {
  createProcPlantDenseImpostorPool,
  createProcPlantDenseImpostorPoolFromChannelRender,
  estimateProcPlantDenseImpostorSavings,
} from "../src/procplant-dense-impostor-pool";

const plan = createProcPlantImpostorCapturePlan({
  min: { x: -0.6, y: 0, z: -0.4 },
  max: { x: 0.6, y: 2, z: 0.4 },
}, { width: 4, height: 4, azimuthCount: 8, elevations: [0] });
const atlas = await buildProcPlantImpostorAtlas(plan, async ({ view, width, height }) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba.set([view.index * 24, 80 + view.index, 140, 255], pixel * 4);
  }
  return { id: view.id, width, height, rgba };
}, { padding: 1, powerOfTwo: true });

const placement = (x: number, y: number, z: number, yaw = 0, scale = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
  new THREE.Vector3(scale, scale, scale),
);

const oriented = [placement(0, 0, 0, 0), placement(0, 0, 0, Math.PI)];
const orientedPool = createProcPlantDenseImpostorPool(atlas, oriented, { frustumCulled: false, viewHysteresis: 0 });
try {
  const stats = orientedPool.update(new THREE.Vector3(0, 1, 20));
  assert.equal(stats.visible, 2);
  assert.notEqual(
    orientedPool.getPlacementView(0),
    orientedPool.getPlacementView(1),
    "placement rotation must transform camera direction into plant-local atlas space",
  );
  assert.equal(orientedPool.meshes.filter((mesh) => mesh.count > 0).length, 2);
  assert.ok(orientedPool.meshes.every((mesh) => mesh.material === orientedPool.material));
  assert.ok(orientedPool.meshes.every((mesh) => (mesh.geometry.index?.count ?? 0) === 6));
} finally {
  orientedPool.dispose();
}

const densePlacements = Array.from({ length: 1024 }, (_, index) => {
  const radius = 12 + (index % 29) * 0.8;
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return placement(
    Math.cos(angle) * radius,
    0,
    Math.sin(angle) * radius,
    (index % 32) * Math.PI / 16,
    0.7 + (index % 7) * 0.08,
  );
});
const densePool = createProcPlantDenseImpostorPool(atlas, densePlacements, {
  frustumCulled: false,
  viewHysteresis: 0.03,
});
const mirrorPool = createProcPlantDenseImpostorPool(atlas, densePlacements, {
  frustumCulled: false,
  viewHysteresis: 0.03,
});
try {
  const cameraA = new THREE.Vector3(38, 9, 24);
  const first = densePool.update(cameraA);
  const mirrored = mirrorPool.update(cameraA);
  assert.equal(first.visible, densePlacements.length);
  assert.equal(first.culled, 0);
  assert.equal(first.triangles, densePlacements.length * 2);
  assert.deepEqual(Array.from(first.viewCounts), Array.from(mirrored.viewCounts));
  assert.equal(first.draws, first.viewCounts.filter((count) => count > 0).length);
  assert.ok(first.draws <= atlas.entries.length, "draws must remain bounded by atlas view count");
  assert.equal(first.lastMigrations, densePlacements.length);
  assert.equal(mirrored.lastMigrations, densePlacements.length);

  const buffers = densePool.meshes.map((mesh) => mesh.instanceMatrix.array);
  const geometries = densePool.meshes.map((mesh) => mesh.geometry);
  const sharedStatsCounts = densePool.stats.viewCounts;
  const stableCounts = Array.from(first.viewCounts);
  const second = densePool.update(cameraA);
  assert.equal(second.lastMigrations, 0);
  assert.deepEqual(Array.from(second.viewCounts), stableCounts);
  assert.equal(second.viewCounts, sharedStatsCounts);
  assert.ok(densePool.meshes.every((mesh, index) => mesh.instanceMatrix.array === buffers[index]));
  assert.ok(densePool.meshes.every((mesh, index) => mesh.geometry === geometries[index]));

  const changed = densePool.update(new THREE.Vector3(-42, 12, -18));
  assert.ok(changed.lastMigrations > 0);
  const mirroredChanged = mirrorPool.update(new THREE.Vector3(-42, 12, -18));
  assert.deepEqual(Array.from(changed.viewCounts), Array.from(mirroredChanged.viewCounts));
  assert.equal(changed.totalMigrations, densePlacements.length + changed.lastMigrations);

  const savings = estimateProcPlantDenseImpostorSavings(1_872, changed);
  assert.equal(savings.fullGeometryTriangles, densePlacements.length * 1_872);
  assert.equal(savings.impostorTriangles, densePlacements.length * 2);
  assert.ok(savings.triangleReduction > 0.998);
  assert.equal(savings.naiveCardDraws, densePlacements.length);
  assert.equal(savings.pooledDraws, changed.draws);
  assert.ok(savings.drawsSaved >= densePlacements.length - atlas.entries.length);
} finally {
  densePool.dispose();
  mirrorPool.dispose();
}

const visibilityMask = Uint8Array.from(densePlacements, (_, index) => index % 3 === 0 ? 1 : 0);
const visiblePlacements = densePlacements.filter((_, index) => visibilityMask[index] === 1);
const maskedPool = createProcPlantDenseImpostorPool(atlas, densePlacements, {
  frustumCulled: false,
  viewHysteresis: 0,
});
const referencePool = createProcPlantDenseImpostorPool(atlas, visiblePlacements, {
  frustumCulled: false,
  viewHysteresis: 0,
});
try {
  const camera = new THREE.Vector3(31, 8, -27);
  const matrixBuffers = maskedPool.meshes.map((mesh) => mesh.instanceMatrix.array);
  maskedPool.setVisibilityMask(visibilityMask);
  const masked = maskedPool.update(camera);
  const reference = referencePool.update(camera);
  assert.equal(masked.visible, visiblePlacements.length);
  assert.equal(masked.masked, densePlacements.length - visiblePlacements.length);
  assert.equal(masked.culled, 0);
  assert.equal(masked.visible + masked.masked + masked.culled, masked.placements);
  assert.equal(masked.draws, reference.draws);
  assert.equal(masked.triangles, reference.triangles);
  assert.deepEqual(Array.from(masked.viewCounts), Array.from(reference.viewCounts));
  for (let view = 0; view < maskedPool.meshes.length; view++) {
    const actual = maskedPool.meshes[view]!;
    const expected = referencePool.meshes[view]!;
    assert.equal(actual.count, expected.count);
    assert.deepEqual(
      Array.from(actual.instanceMatrix.array.slice(0, actual.count * 16)),
      Array.from(expected.instanceMatrix.array.slice(0, expected.count * 16)),
    );
  }
  maskedPool.setVisibilityMask(visibilityMask);
  maskedPool.update(camera);
  assert.ok(maskedPool.meshes.every((mesh, index) => mesh.instanceMatrix.array === matrixBuffers[index]));
  assert.equal(maskedPool.setPlacementVisible(1, true), true);
  assert.equal(maskedPool.update(camera).visible, visiblePlacements.length + 1);
  assert.equal(maskedPool.setPlacementVisible(-1, true), false);
  assert.throws(() => maskedPool.setVisibilityMask(new Uint8Array(2)), /mask length/);
  maskedPool.setVisibilityMask(null);
  assert.equal(maskedPool.update(camera).visible, densePlacements.length);
} finally {
  maskedPool.dispose();
  referencePool.dispose();
}

const cullPool = createProcPlantDenseImpostorPool(atlas, [placement(0, 0, 0)], {
  maxDistance: 10,
  cullHysteresis: 0.12,
  frustumCulled: false,
});
try {
  assert.equal(cullPool.update(new THREE.Vector3(0, 0, 9.5)).visible, 1);
  assert.equal(cullPool.update(new THREE.Vector3(0, 0, 11.3)).culled, 1);
  assert.equal(cullPool.update(new THREE.Vector3(0, 0, 9.5)).culled, 1, "culled placement must honor re-entry hysteresis");
  const returned = cullPool.update(new THREE.Vector3(0, 0, 8.7));
  assert.equal(returned.visible, 1);
  assert.equal(returned.lastMigrations, 1);
} finally {
  cullPool.dispose();
}

const externalTexture = createProcPlantImpostorAtlasTexture(atlas);
const externalMaterial = new THREE.ShaderMaterial({
  uniforms: { colorAtlas: { value: externalTexture } },
  vertexShader: "void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
  fragmentShader: "void main(){gl_FragColor=vec4(1.0);}",
});
let externalTextureDisposals = 0;
let externalMaterialDisposals = 0;
externalTexture.addEventListener("dispose", () => externalTextureDisposals++);
externalMaterial.addEventListener("dispose", () => externalMaterialDisposals++);
const externalPool = createProcPlantDenseImpostorPoolFromChannelRender({
  atlas,
  texture: externalTexture,
  material: externalMaterial,
  channelMode: "color-normal-depth",
  seasonId: "summer",
}, [placement(0, 0, 0)]);
assert.ok(externalPool.meshes.every((mesh) => mesh.material === externalMaterial));
assert.deepEqual(externalPool.root.userData.procplantDenseImpostorPool, {
  contentHash: atlas.contentHash,
  views: atlas.entries.length,
  placements: 1,
  channelMode: "color-normal-depth",
  seasonId: "summer",
});
externalPool.dispose();
assert.equal(externalTextureDisposals, 0, "borrowed atlas texture must remain caller-owned");
assert.equal(externalMaterialDisposals, 0, "borrowed material must remain caller-owned");
externalMaterial.dispose();
externalTexture.dispose();

const ownedPool = createProcPlantDenseImpostorPool(atlas, [placement(0, 0, 0)]);
let ownedTextureDisposals = 0;
let ownedMaterialDisposals = 0;
let ownedGeometryDisposals = 0;
ownedPool.texture?.addEventListener("dispose", () => ownedTextureDisposals++);
ownedPool.material.addEventListener("dispose", () => ownedMaterialDisposals++);
for (const mesh of ownedPool.meshes) mesh.geometry.addEventListener("dispose", () => ownedGeometryDisposals++);
ownedPool.dispose();
ownedPool.dispose();
assert.equal(ownedTextureDisposals, 1);
assert.equal(ownedMaterialDisposals, 1);
assert.equal(ownedGeometryDisposals, atlas.entries.length);
assert.throws(() => ownedPool.update(new THREE.Vector3()), /disposed/);

assert.throws(() => createProcPlantDenseImpostorPool(atlas, [], { cullHysteresis: 1 }), /cullHysteresis/);
assert.throws(() => createProcPlantDenseImpostorPool(atlas, [], { viewHysteresis: -0.1 }), /viewHysteresis/);
assert.throws(() => estimateProcPlantDenseImpostorSavings(-1, { placements: 1, visible: 1, draws: 1 }), /non-negative/);

console.log("ok 1 - deterministic plant-local atlas view buckets and shared resources");
console.log("ok 2 - allocation-stable matrix buffers, counts, and camera migrations");
console.log("ok 3 - bounded draws and >99.8% dense triangle reduction");
console.log("ok 4 - distance culling hysteresis and stable re-entry");
console.log("ok 5 - explicit borrowed/owned texture, material, and geometry disposal");
console.log("ok 6 - visibility mask matches a filtered reference without replacing render buffers");
console.log("1..6");
