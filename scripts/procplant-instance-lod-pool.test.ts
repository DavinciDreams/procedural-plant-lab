import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createProcPlantInstanceLodPool,
  type ProcPlantInstanceLodLevel,
} from "../src/procplant-instance-lod-pool";

const placement = (x: number, y = 0, z = 0) => new THREE.Matrix4().makeTranslation(x, y, z);

const createLevels = (
  geometry = new THREE.BoxGeometry(1, 1, 1),
  material = new THREE.MeshBasicMaterial(),
): ProcPlantInstanceLodLevel[] => [
  { distance: 0, geometry, material, name: "near" },
  { distance: 10, geometry, material, name: "middle" },
  { distance: 30, geometry, material, name: "far" },
];

{
  const pool = createProcPlantInstanceLodPool([placement(0)], createLevels(), { hysteresis: 0.1 });
  const stats = pool.stats;
  const lodCounts = stats.lodCounts;

  assert.strictEqual(pool.update(new THREE.Vector3(-9.9, 0, 0)), stats, "update must reuse the stats object");
  assert.strictEqual(pool.stats.lodCounts, lodCounts, "updates must reuse the LOD counts array");
  assert.equal(pool.getPlacementLod(0), 0);
  assert.deepEqual(Array.from(stats.lodCounts), [1, 0, 0]);
  assert.equal(stats.lastMigrations, 1);
  assert.equal(stats.totalMigrations, 1);

  pool.update(new THREE.Vector3(-10.9, 0, 0));
  assert.equal(pool.getPlacementLod(0), 0, "upper hysteresis band must retain the near tier");
  assert.equal(stats.lastMigrations, 0);

  pool.update(new THREE.Vector3(-11, 0, 0));
  assert.equal(pool.getPlacementLod(0), 1, "crossing the upper boundary must enter the middle tier");
  assert.equal(stats.lastMigrations, 1);

  pool.update(new THREE.Vector3(-9, 0, 0));
  assert.equal(pool.getPlacementLod(0), 1, "lower hysteresis boundary is exclusive");
  assert.equal(stats.lastMigrations, 0);

  pool.update(new THREE.Vector3(-8.9, 0, 0));
  assert.equal(pool.getPlacementLod(0), 0, "crossing below the lower boundary must return to the near tier");
  assert.equal(stats.lastMigrations, 1);
  assert.equal(stats.totalMigrations, 3);
  pool.dispose();
}

{
  const pool = createProcPlantInstanceLodPool([placement(0)], createLevels(), {
    hysteresis: 0.1,
    maxDistance: 50,
  });

  pool.update(new THREE.Vector3(-49, 0, 0));
  assert.equal(pool.getPlacementLod(0), 2);
  assert.equal(pool.stats.visible, 1);

  pool.update(new THREE.Vector3(-55, 0, 0));
  assert.equal(pool.stats.visible, 1, "visible placements must remain through the outward culling boundary");

  pool.update(new THREE.Vector3(-55.1, 0, 0));
  assert.equal(pool.getPlacementLod(0), null);
  assert.equal(pool.stats.visible, 0);
  assert.equal(pool.stats.culled, 1);
  assert.deepEqual(Array.from(pool.stats.lodCounts), [0, 0, 0]);

  pool.update(new THREE.Vector3(-45.1, 0, 0));
  assert.equal(pool.stats.culled, 1, "culled placements must remain hidden through the inward boundary");

  pool.update(new THREE.Vector3(-45, 0, 0));
  assert.equal(pool.getPlacementLod(0), 2);
  assert.equal(pool.stats.visible, 1);
  assert.equal(pool.stats.culled, 0);
  pool.dispose();
}

{
  const source = placement(2);
  const pool = createProcPlantInstanceLodPool([source], createLevels());
  source.setPosition(99, 0, 0);
  pool.update(new THREE.Vector3(0, 0, 0));
  assert.equal(pool.getPlacementLod(0), 0, "the pool must own a deterministic copy of input matrices");

  assert.equal(pool.setPlacementMatrix(0, placement(35, 2, -3)), true);
  assert.equal(pool.setPlacementMatrix(1, placement(0)), false, "out-of-range placement updates must be rejected");
  pool.update(new THREE.Vector3(0, 0, 0));
  assert.equal(pool.getPlacementLod(0), 2);
  assert.equal(pool.stats.lastMigrations, 1);
  assert.deepEqual(Array.from(pool.stats.lodCounts), [0, 0, 1]);

  const copied = new THREE.Matrix4();
  pool.meshes[2].getMatrixAt(0, copied);
  const copiedPosition = new THREE.Vector3().setFromMatrixPosition(copied);
  assert.deepEqual(copiedPosition.toArray(), [35, 2, -3], "matrix updates must reach the active tier buffer");
  pool.dispose();
}

{
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  let geometryDisposals = 0;
  let materialDisposals = 0;
  geometry.addEventListener("dispose", () => geometryDisposals++);
  material.addEventListener("dispose", () => materialDisposals++);

  const pool = createProcPlantInstanceLodPool([placement(0)], createLevels(geometry, material), {
    ownGeometries: true,
    ownMaterials: true,
  });
  const parent = new THREE.Group();
  parent.add(pool.root);
  pool.dispose();

  assert.equal(parent.children.length, 0, "dispose must detach the pool root");
  assert.equal(pool.root.children.length, 0, "dispose must release mesh references");
  assert.equal(geometryDisposals, 1, "shared owned geometry must be disposed once");
  assert.equal(materialDisposals, 1, "shared owned material must be disposed once");
  assert.throws(() => pool.update(new THREE.Vector3()), /disposed/);

  pool.dispose();
  assert.equal(geometryDisposals, 1, "dispose must be idempotent for geometry");
  assert.equal(materialDisposals, 1, "dispose must be idempotent for material");
}

{
  const gridSize = 100;
  const placements = Array.from({ length: gridSize * gridSize }, (_, instance) => {
    const x = instance % gridSize - gridSize / 2;
    const z = Math.floor(instance / gridSize) - gridSize / 2;
    return placement(x, 0, z);
  });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const legacyChanges: string[] = [];
  const clusteredChanges: string[] = [];
  const legacy = createProcPlantInstanceLodPool(placements, createLevels(geometry, material), {
    hysteresis: 0.1,
    maxDistance: 12,
    frustumCulled: false,
    onPlacementLodChanged: (index, previous, next) => legacyChanges.push(`${index}:${previous}->${next}`),
  });
  const clustered = createProcPlantInstanceLodPool(placements, createLevels(geometry, material), {
    hysteresis: 0.1,
    maxDistance: 12,
    frustumCulled: false,
    clusteredCulling: { cellSize: 8, maxInstancesPerCluster: 128 },
    onPlacementLodChanged: (index, previous, next) => clusteredChanges.push(`${index}:${previous}->${next}`),
  });
  const clusteredStats = clustered.stats;
  const clusteredLodCounts = clustered.stats.lodCounts;
  const clusteredBuffers = clustered.meshes.map((mesh) => mesh.instanceMatrix.array);
  const clusterSet = clustered.visibilityClusters;
  assert.equal(legacy.visibilityClusters, null, "omitted clustering must preserve the exact legacy path");
  assert.ok(clusterSet && clusterSet.clusterCount < 200);

  const assertParity = (camera: THREE.Vector3) => {
    const legacyStats = legacy.update(camera);
    const acceleratedStats = clustered.update(camera);
    assert.equal(acceleratedStats.visible, legacyStats.visible);
    assert.equal(acceleratedStats.culled, legacyStats.culled);
    assert.equal(acceleratedStats.lastMigrations, legacyStats.lastMigrations);
    assert.equal(acceleratedStats.totalMigrations, legacyStats.totalMigrations);
    assert.deepEqual(Array.from(acceleratedStats.lodCounts), Array.from(legacyStats.lodCounts));
    assert.deepEqual(clusteredChanges, legacyChanges, "migration callbacks must retain original placement order and values");
    for (let level = 0; level < clustered.meshes.length; level++) {
      const acceleratedMesh = clustered.meshes[level];
      const legacyMesh = legacy.meshes[level];
      assert.equal(acceleratedMesh.count, legacyMesh.count);
      assert.deepEqual(
        Array.from(acceleratedMesh.instanceMatrix.array.slice(0, acceleratedMesh.count * 16)),
        Array.from(legacyMesh.instanceMatrix.array.slice(0, legacyMesh.count * 16)),
        `LOD${level} matrix bytes must match the legacy placement order`,
      );
    }
    for (let placementIndex = 0; placementIndex < placements.length; placementIndex++) {
      assert.equal(clustered.getPlacementLod(placementIndex), legacy.getPlacementLod(placementIndex));
    }
    return acceleratedStats;
  };

  const first = assertParity(new THREE.Vector3(0, 0, 0));
  assert.equal(legacy.stats.exactSelectionTests, placements.length);
  assert.ok(first.exactSelectionTests < placements.length * 0.125, `${first.exactSelectionTests} exact tests should be much smaller than 10,000`);
  assert.equal(first.exactSelectionTests + first.broadPhaseRejected, placements.length);
  assert.ok(first.clusterBytes < placements.length * 32, "cluster metadata must stay below 32 bytes per placement");
  const firstExactTests = first.exactSelectionTests;
  assertParity(new THREE.Vector3(0, 0, 0));
  assert.equal(clustered.stats, clusteredStats);
  assert.equal(clustered.stats.lodCounts, clusteredLodCounts);
  assert.equal(clustered.visibilityClusters, clusterSet, "camera updates must not rebuild immutable cluster data");
  assert.ok(clustered.meshes.every((mesh, index) => mesh.instanceMatrix.array === clusteredBuffers[index]));
  assert.equal(clustered.stats.exactSelectionTests, firstExactTests);

  assertParity(new THREE.Vector3(8, 0, -6));
  assertParity(new THREE.Vector3(60, 0, 60));
  legacy.setPlacementMatrix(0, placement(60, 0, 60));
  clustered.setPlacementMatrix(0, placement(60, 0, 60));
  assertParity(new THREE.Vector3(60, 0, 60));
  assert.notEqual(clustered.visibilityClusters, clusterSet, "placement mutation must rebuild the spatial contract before selection");

  legacy.dispose();
  clustered.dispose();
  geometry.dispose();
  material.dispose();
  console.log(`clustered LOD parity: ${firstExactTests}/10000 exact tests, ${first.clusterCount} clusters, ${first.clusterBytes} bytes`);
}

console.log("procplant instance LOD pool tests passed");
