import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createProcPlantInstanceLodPool,
  type ProcPlantInstanceLodLevel,
  type ProcPlantInstanceLodPoolOptions,
} from "../src/procplant-instance-lod-pool";
import {
  createProcPlantThreeVisibilityLodAdapter,
  PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_CONTRACT,
  PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_VERSION,
} from "../src/procplant-three-visibility-lod-adapter";

const placement = (x: number, y = 0, z = 0) => new THREE.Matrix4().makeTranslation(x, y, z);

const createPool = (
  placements: readonly THREE.Matrix4[],
  options: ProcPlantInstanceLodPoolOptions = {},
) => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const levels: ProcPlantInstanceLodLevel[] = [
    { distance: 0, geometry, material, name: "near" },
    { distance: 5, geometry, material, name: "far" },
  ];
  return createProcPlantInstanceLodPool(placements, levels, {
    ownGeometries: true,
    ownMaterials: true,
    ...options,
  });
};

const createCamera = () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
};

{
  const pool = createPool([
    placement(0, 0, -2),
    placement(1.4, 0, -2),
    placement(3, 0, -2),
    placement(0, 0, 2),
  ], {
    clusteredCulling: { cellSize: 0.5, maxInstancesPerCluster: 1 },
    frustumCulled: false,
  });
  const adapter = createProcPlantThreeVisibilityLodAdapter(pool);
  const camera = createCamera();
  const stats = adapter.update(camera);
  const selectedLodCounts = stats.selectedLodCounts;
  const poolLodCounts = stats.poolLodCounts;
  const scratchBytes = stats.stableScratchBytes;
  const clusters = pool.visibilityClusters;

  assert.equal(stats.contract, PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_CONTRACT);
  assert.equal(stats.version, PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_VERSION);
  assert.equal(stats.frustumVisibleInstances, 2, "a box intersecting the right plane must remain conservatively visible");
  assert.equal(stats.frustumRejectedInstances, 2);
  assert.equal(stats.poolVisibleInstances, 2);
  assert.equal(stats.poolCulledInstances, 2);
  assert.equal(pool.stats.visibilityRejected, 2);
  assert.equal(pool.stats.exactSelectionTests, 2);
  assert.notEqual(pool.getPlacementLod(0), null);
  assert.notEqual(pool.getPlacementLod(1), null, "geometry radius must prevent center-only edge popping");
  assert.equal(pool.getPlacementLod(2), null);
  assert.equal(pool.getPlacementLod(3), null);
  assert.equal(stats.viewRevision, 1);
  assert.equal(stats.viewChanged, true);
  assert.equal(stats.selectorRebuilds, 1);
  assert.ok(stats.clusterHash);

  assert.strictEqual(adapter.update(camera), stats, "updates must reuse the public stats object");
  assert.strictEqual(stats.selectedLodCounts, selectedLodCounts);
  assert.strictEqual(stats.poolLodCounts, poolLodCounts);
  assert.strictEqual(pool.visibilityClusters, clusters, "camera-only updates must retain immutable clusters");
  assert.equal(stats.stableScratchBytes, scratchBytes);
  assert.equal(stats.selectorRebuilds, 1);
  assert.equal(stats.viewRevision, 1);
  assert.equal(stats.viewChanged, false);

  camera.position.x = 3;
  camera.lookAt(3, 0, -1);
  camera.updateMatrixWorld(true);
  adapter.update(camera);
  assert.equal(stats.viewRevision, 2, "camera transforms must invalidate the cached view revision");
  assert.equal(stats.viewChanged, true);
  assert.notEqual(pool.getPlacementLod(2), null, "camera motion must update live frustum adoption");
  assert.equal(pool.getPlacementLod(0), null);

  camera.position.x = 0;
  camera.lookAt(0, 0, -1);
  camera.right = 4;
  camera.left = -4;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  adapter.update(camera);
  assert.equal(stats.viewRevision, 3, "projection changes must invalidate the cached view revision");
  assert.equal(stats.frustumVisibleInstances, 3);

  const oldHash = stats.clusterHash;
  assert.equal(pool.setPlacementMatrix(2, placement(0.3, 0, -2)), true);
  camera.right = 1;
  camera.left = -1;
  camera.updateProjectionMatrix();
  adapter.update(camera);
  assert.equal(stats.selectorRebuilds, 2, "placement mutation must rebuild and adopt the selector contract");
  assert.notEqual(stats.clusterHash, oldHash);
  assert.equal(stats.frustumVisibleInstances, 3);
  assert.equal(stats.poolVisibleInstances, 3);

  assert.throws(() => pool.update(new THREE.Vector3(), new Uint8Array(1)), /mask length/);
  adapter.dispose();
  assert.throws(() => adapter.update(camera), /disposed/);
  assert.throws(() => adapter.setEnabled(false), /disposed/);
  pool.update(new THREE.Vector3(), null);
  adapter.dispose();
  pool.dispose();
}

{
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(10, 0, 0);
  const material = new THREE.MeshBasicMaterial();
  const pool = createProcPlantInstanceLodPool([placement(0)], [
    { distance: 0, geometry, material },
    { distance: 5, geometry, material },
  ], {
    clusteredCulling: { cellSize: 1 },
    maxDistance: 1,
    ownGeometries: true,
    ownMaterials: true,
  });
  pool.update(new THREE.Vector3(0, 0, 0));
  assert.equal(pool.stats.visible, 1, "geometry-aware cluster bounds must retain legacy placement-origin distance semantics");
  assert.equal(pool.stats.broadPhaseRejected, 0);
  pool.dispose();
}

{
  const pool = createPool([
    placement(0, 0, -2),
    placement(10, 0, -2),
  ], { frustumCulled: false });
  const adapter = createProcPlantThreeVisibilityLodAdapter(pool, { enabled: false });
  const camera = createCamera();
  const stats = adapter.update(camera);

  assert.equal(stats.enabled, false);
  assert.equal(stats.legacyUpdates, 1);
  assert.equal(stats.selectorRebuilds, 0);
  assert.equal(stats.poolVisibleInstances, 2, "disabled adoption must preserve distance-only legacy behavior");
  assert.equal(pool.stats.visibilityRejected, 0);
  assert.deepEqual(Array.from(stats.selectedLodCounts), [0, 0]);

  adapter.setEnabled(true);
  assert.throws(() => adapter.update(camera), /clusteredCulling/);
  adapter.setEnabled(false);
  adapter.update(camera);
  assert.equal(stats.poolVisibleInstances, 2);
  adapter.dispose();
  pool.dispose();
}

{
  const pool = createPool([
    placement(0, 0, -2),
    placement(4, 0, -2),
  ], {
    clusteredCulling: { cellSize: 1, maxInstancesPerCluster: 1 },
    frustumCulled: false,
  });
  pool.root.position.x = 10;
  const camera = createCamera();
  camera.position.x = 10;
  camera.lookAt(10, 0, -1);
  camera.updateMatrixWorld(true);
  const adapter = createProcPlantThreeVisibilityLodAdapter(pool);
  const stats = adapter.update(camera);

  assert.equal(stats.frustumVisibleInstances, 1, "camera and root world transforms must resolve into pool-local space");
  assert.equal(stats.poolVisibleInstances, 1);
  assert.notEqual(pool.getPlacementLod(0), null);
  assert.equal(pool.getPlacementLod(1), null);

  pool.root.position.x = 12;
  adapter.update(camera);
  assert.equal(stats.viewChanged, true, "pool matrix changes must invalidate the local frustum");
  assert.equal(stats.viewRevision, 2);
  adapter.dispose();
  pool.dispose();
}

{
  const pool = createPool([placement(0, 0, -2)], {
    clusteredCulling: { cellSize: 1 },
  });
  const adapter = createProcPlantThreeVisibilityLodAdapter(pool, { disposePool: true });
  adapter.dispose();
  assert.throws(() => pool.update(new THREE.Vector3()), /disposed/);
}

{
  const pool = createPool([placement(0, 0, -2)], { clusteredCulling: { cellSize: 1 } });
  assert.throws(() => createProcPlantThreeVisibilityLodAdapter(pool, { maxDistance: -1 }), /maxDistance/);
  assert.throws(() => createProcPlantThreeVisibilityLodAdapter(pool, { frustumPadding: Number.NaN }), /frustumPadding/);
  assert.throws(() => createProcPlantThreeVisibilityLodAdapter(pool, { enabled: 1 as unknown as boolean }), /enabled/);
  pool.dispose();
}

for (const coordinateSystem of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) {
  for (const reversedDepth of [false, true]) {
    const placements = [
      placement(0, 0, -2),
      placement(0.9, 0, -2),
      placement(4, 0, -2),
      placement(0, 0, 2),
      placement(0, 0, -30),
    ];
    const pool = createPool(placements, {
      clusteredCulling: { cellSize: 1, maxInstancesPerCluster: 1 },
      frustumCulled: false,
    });
    class VisibilityTestCamera extends THREE.PerspectiveCamera {
      constructor(private readonly useReversedDepth: boolean) {
        super(60, 1, 0.1, 20);
      }

      override get reversedDepth() {
        return this.useReversedDepth;
      }
    }
    const camera = new VisibilityTestCamera(reversedDepth);
    camera.coordinateSystem = coordinateSystem;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const adapter = createProcPlantThreeVisibilityLodAdapter(pool, { frustumPadding: 0 });
    adapter.update(camera);

    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      coordinateSystem,
      reversedDepth,
    );
    const radius = Math.sqrt(0.75);
    for (let index = 0; index < placements.length; index++) {
      const center = new THREE.Vector3().setFromMatrixPosition(placements[index]!);
      const expected = frustum.intersectsSphere(new THREE.Sphere(center, radius));
      assert.equal(
        pool.getPlacementLod(index) !== null,
        expected,
        `${coordinateSystem}/${reversedDepth} placement ${index} must match Three.Frustum`,
      );
    }
    adapter.dispose();
    pool.dispose();
  }
}

console.log("procplant Three.js visibility LOD adapter tests passed");
