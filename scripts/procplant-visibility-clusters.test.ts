import assert from "node:assert/strict";
import {
  buildProcPlantVisibilityClusters,
  createProcPlantVisibilitySelector,
  createProcPlantVisibilityView,
  createProcPlantVisibilityViewFromMatrix,
} from "../src/procplant-visibility-clusters";

const source = {
  centers: new Float64Array([
    17, 0, 0,
    -1, 0, 0,
    1, 0, 0,
    2, 0, 0,
    3, 0, 0,
    4, 0, 0,
  ]),
  radii: new Float64Array([0.5, 0.25, 0.1, 0.2, 0.3, 0.4]),
};
const first = buildProcPlantVisibilityClusters(source, { cellSize: 16, maxInstancesPerCluster: 2 });
const second = buildProcPlantVisibilityClusters(source, { cellSize: 16, maxInstancesPerCluster: 2 });
assert.equal(first.contentHash, second.contentHash);
assert.deepEqual(first.clusterCells, new Int32Array([-1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]));
assert.deepEqual(first.clusterOffsets, new Uint32Array([0, 1, 3, 5, 6]));
assert.deepEqual(first.clusterInstanceIndices, new Uint32Array([1, 2, 3, 4, 5, 0]));
assert.ok(first.byteLength > 0);
for (let cluster = 0; cluster < first.clusterCount; cluster++) {
  const boundOffset = cluster * 4;
  const cx = first.clusterBounds[boundOffset]!;
  const cy = first.clusterBounds[boundOffset + 1]!;
  const cz = first.clusterBounds[boundOffset + 2]!;
  const cr = first.clusterBounds[boundOffset + 3]!;
  for (let cursor = first.clusterOffsets[cluster]!; cursor < first.clusterOffsets[cluster + 1]!; cursor++) {
    const instance = first.clusterInstanceIndices[cursor]!;
    const offset = instance * 4;
    const separation = Math.hypot(
      first.instanceBounds[offset]! - cx,
      first.instanceBounds[offset + 1]! - cy,
      first.instanceBounds[offset + 2]! - cz,
    ) + first.instanceBounds[offset + 3]!;
    assert.ok(separation <= cr + 1e-6, `cluster ${cluster} must conservatively contain instance ${instance}`);
  }
}
console.log("ok 1 - deterministic cell ordering, bounded cluster splits, and conservative GPU bounds");

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const webglView = createProcPlantVisibilityViewFromMatrix(identity, [0, 0, 0]);
const webgpuView = createProcPlantVisibilityViewFromMatrix(identity, [0, 0, 0], { clipSpace: "zero-to-one" });
assert.deepEqual(Array.from(webglView.planes), [
  1, 0, 0, 1, -1, 0, 0, 1,
  0, 1, 0, 1, 0, -1, 0, 1,
  0, 0, 1, 1, 0, 0, -1, 1,
]);
assert.deepEqual(Array.from(webgpuView.planes.slice(16, 20)), [0, 0, 1, 0]);
console.log("ok 2 - column-major frustum extraction distinguishes WebGL and WebGPU near clip planes");

const selectorSource = buildProcPlantVisibilityClusters({
  centers: new Float32Array([0.1, 0, 0, 0.8, 0, 0, 2, 0, 0, 0, 0, -0.8]),
  radii: new Float32Array([0.05, 0.05, 0.05, 0.05]),
}, { cellSize: 1, maxInstancesPerCluster: 4 });
const selector = createProcPlantVisibilitySelector(selectorSource, [0, 0.5, 0.75]);
const resultObject = selector.result;
const visibleBuffer = resultObject.visibleInstanceIndices;
const lodBuffer = resultObject.lodInstanceIndices;
const selected = selector.select(webglView);
assert.equal(selected, resultObject);
assert.deepEqual(Array.from(selected.visibleInstanceIndices.slice(0, selected.visibleInstanceCount)), [3, 0, 1]);
assert.deepEqual(Array.from(selected.lodCounts), [1, 0, 2]);
assert.deepEqual(Array.from(selected.lodOffsets), [0, 1, 1, 3]);
assert.deepEqual(Array.from(selected.lodInstanceIndices.slice(0, selected.visibleInstanceCount)), [0, 3, 1]);
assert.equal(selected.instanceLods[2], -1);
const masked = selector.select(webglView, new Uint8Array([1, 0, 1, 1]));
assert.deepEqual(Array.from(masked.visibleInstanceIndices.slice(0, masked.visibleInstanceCount)), [3, 0]);
assert.equal(masked.maskedCandidateCount, 1);
assert.equal(masked.visibleInstanceIndices, visibleBuffer);
assert.equal(masked.lodInstanceIndices, lodBuffer);
assert.throws(() => selector.select(webglView, new Uint8Array(1)), /mask length/);
console.log("ok 3 - allocation-stable reference selection compacts original IDs by deterministic LOD");

const gridSize = 100;
const gridCenters = new Float32Array(gridSize * gridSize * 3);
const gridRadii = new Float32Array(gridSize * gridSize).fill(0.25);
for (let z = 0; z < gridSize; z++) {
  for (let x = 0; x < gridSize; x++) {
    const instance = z * gridSize + x;
    gridCenters[instance * 3] = x - gridSize / 2;
    gridCenters[instance * 3 + 2] = z - gridSize / 2;
  }
}
const grid = buildProcPlantVisibilityClusters({ centers: gridCenters, radii: gridRadii }, {
  cellSize: 8,
  maxInstancesPerCluster: 128,
});
const localPlanes = new Float32Array([
  1, 0, 0, 8, -1, 0, 0, 8,
  0, 1, 0, 2, 0, -1, 0, 2,
  0, 0, 1, 8, 0, 0, -1, 8,
]);
const localView = createProcPlantVisibilityView(localPlanes, [0, 1, 0], 30);
const gridSelector = createProcPlantVisibilitySelector(grid, [0, 12, 24]);
const gridSelection = gridSelector.select(localView);
assert.equal(grid.instanceCount, 10_000);
assert.ok(grid.clusterCount < 200);
assert.ok(gridSelection.candidateInstanceCount < grid.instanceCount * 0.125, `${gridSelection.candidateInstanceCount} candidates should be much smaller than 10,000`);
assert.equal(gridSelection.visibleInstanceCount, 17 * 17, "clustered selection must match the exact sphere/frustum reference");
assert.equal(gridSelection.lodCounts.reduce((sum, count) => sum + count, 0), gridSelection.visibleInstanceCount);
assert.equal(
  gridSelection.visibleInstanceCount + gridSelection.maskedCandidateCount + gridSelection.frustumCulledCandidateCount
    + gridSelection.distanceCulledCandidateCount + gridSelection.rejectedClusterInstances,
  grid.instanceCount,
);
const gridVisibleBuffer = gridSelection.visibleInstanceIndices;
const visibleIds = Array.from(gridSelection.visibleInstanceIndices.slice(0, gridSelection.visibleInstanceCount));
const repeated = gridSelector.select(localView);
assert.equal(repeated, gridSelection);
assert.equal(repeated.visibleInstanceIndices, gridVisibleBuffer);
assert.deepEqual(Array.from(repeated.visibleInstanceIndices.slice(0, repeated.visibleInstanceCount)), visibleIds);
console.log(`ok 4 - clustered broad phase reduced 10,000 placements to ${gridSelection.candidateInstanceCount} candidates`);

assert.throws(() => buildProcPlantVisibilityClusters({ centers: [0, 1] }), /xyz tuples/);
assert.throws(() => buildProcPlantVisibilityClusters({ centers: [0, 0, 0], radii: [-1] }), /non-negative/);
assert.throws(() => buildProcPlantVisibilityClusters({ centers: [0, 0, 0] }, { maxInstancesPerCluster: 0 }), /\[1, 65535\]/);
assert.throws(() => buildProcPlantVisibilityClusters({ centers: [0, 0, 0, 1, 0, 0] }, { maxInstances: 1 }), /exceeds maxInstances/);
assert.throws(() => createProcPlantVisibilityView(new Float32Array(24), [0, 0, 0]), /zero normal/);
assert.throws(() => createProcPlantVisibilitySelector(first, [1]), /start at zero/);
assert.throws(() => createProcPlantVisibilityViewFromMatrix(identity, [0, 0, 0], { clipSpace: "invalid" as never }), /clipSpace/);
assert.throws(() => buildProcPlantVisibilityClusters({ centers: [Number.MAX_VALUE, 0, 0] }), /float32 capacity/);
console.log("ok 5 - malformed bounds, planes, cluster caps, and LOD contracts fail closed");
console.log("1..5");
