import assert from "node:assert/strict";
import {
  createProcPlantTriangleMeshIndex,
  queryProcPlantMeshClearance,
  queryProcPlantTriangleMesh,
  resolveProcPlantMeshObstacles,
  type ProcPlantTriangleMeshIndex,
  type ProcPlantTriangleMeshQuery,
  type ProcPlantTriangleMeshSource,
} from "../src/procplant-mesh-query";

const close = (actual: number, expected: number, epsilon = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be close to ${expected}`);
};

const closeVector = (actual: readonly number[], expected: readonly number[], epsilon = 1e-8) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index]!, epsilon));
};

const compareQueries = (bvh: ProcPlantTriangleMeshQuery, exhaustive: ProcPlantTriangleMeshQuery) => {
  assert.equal(bvh.objectId, exhaustive.objectId);
  assert.equal(bvh.role, exhaustive.role);
  assert.equal(bvh.shape, exhaustive.shape);
  assert.equal(bvh.inside, exhaustive.inside);
  assert.equal(bvh.triangleIndex, exhaustive.triangleIndex);
  close(bvh.distance, exhaustive.distance);
  closeVector(bvh.closestPoint, exhaustive.closestPoint);
  closeVector(bvh.normal, exhaustive.normal);
};

const cubePositions = new Float64Array([
  -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
  -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
]);
const cubeIndices = new Uint16Array([
  0, 2, 1, 0, 3, 2,
  4, 5, 6, 4, 6, 7,
  0, 4, 7, 0, 7, 3,
  1, 2, 6, 1, 6, 5,
  0, 1, 5, 0, 5, 4,
  3, 7, 6, 3, 6, 2,
]);
const cubeSource: ProcPlantTriangleMeshSource = {
  id: "cube",
  positions: cubePositions,
  indices: cubeIndices,
  closed: true,
};
const cubePositionsSnapshot = [...cubePositions];
const cubeIndicesSnapshot = [...cubeIndices];
const cube = createProcPlantTriangleMeshIndex(cubeSource, { leafSize: 2 });
assert.deepEqual(cube.stats, {
  sourceVertices: 8,
  sourceTriangles: 12,
  triangles: 12,
  degenerateTriangles: 0,
  nodes: 15,
  leaves: 8,
  maximumDepth: 3,
});
assert.deepEqual([...cubePositions], cubePositionsSnapshot, "indexing must not mutate positions");
assert.deepEqual([...cubeIndices], cubeIndicesSnapshot, "indexing must not mutate indices");

const outsideBvh = queryProcPlantTriangleMesh(cube, [0, 0, 2]);
const outsideExhaustive = queryProcPlantTriangleMesh(cube, [0, 0, 2], { mode: "exhaustive" });
compareQueries(outsideBvh, outsideExhaustive);
close(outsideBvh.distance, 1);
closeVector(outsideBvh.closestPoint, [0, 0, 1]);
assert.equal(outsideBvh.inside, false);

const insideBvh = queryProcPlantTriangleMesh(cube, [0, 0, 0]);
const insideExhaustive = queryProcPlantTriangleMesh(cube, [0, 0, 0], { mode: "exhaustive" });
compareQueries(insideBvh, insideExhaustive);
close(insideBvh.distance, -1);
assert.equal(insideBvh.inside, true);

const nonIndexedPositions: number[] = [];
for (const vertexIndex of cubeIndices) {
  nonIndexedPositions.push(
    cubePositions[vertexIndex * 3]!,
    cubePositions[vertexIndex * 3 + 1]!,
    cubePositions[vertexIndex * 3 + 2]!,
  );
}
const transformed = createProcPlantTriangleMeshIndex({
  id: "transformed-cube",
  positions: new Float32Array(nonIndexedPositions),
  closed: true,
  worldMatrix: new Float64Array([
    0, 2, 0, 0,
    -1, 0, 0, 0,
    0, 0, 0.5, 0,
    3, 4, 5, 1,
  ]),
}, { leafSize: 2 });
const transformedBvh = queryProcPlantTriangleMesh(transformed, [3, 8, 5]);
const transformedExhaustive = queryProcPlantTriangleMesh(transformed, [3, 8, 5], { mode: "exhaustive" });
compareQueries(transformedBvh, transformedExhaustive);
close(transformedBvh.distance, 2);
closeVector(transformedBvh.closestPoint, [3, 6, 5]);

const reflected = createProcPlantTriangleMeshIndex({
  ...cubeSource,
  id: "reflected-cube",
  worldMatrix: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1],
});
const reflectedInside = queryProcPlantTriangleMesh(reflected, [5, 0, 0]);
assert.equal(reflectedInside.inside, true, "reflected transforms must preserve outward winding");
close(reflectedInside.distance, -1);

const degenerateIndices = new Uint16Array([...cubeIndices, 0, 0, 0]);
const withDegenerate = createProcPlantTriangleMeshIndex({
  ...cubeSource,
  id: "cube-with-degenerate",
  indices: degenerateIndices,
});
assert.equal(withDegenerate.stats.sourceTriangles, 13);
assert.equal(withDegenerate.stats.triangles, 12);
assert.equal(withDegenerate.stats.degenerateTriangles, 1);
assert.equal(queryProcPlantTriangleMesh(withDegenerate, [0, 0, 2]).triangleIndex, 2,
  "equidistant face triangles must use the lowest source triangle index");

const sameCubeA: ProcPlantTriangleMeshIndex = { ...cube, id: "mesh-a" };
const sameCubeB: ProcPlantTriangleMeshIndex = { ...cube, id: "mesh-b" };
const clearance = queryProcPlantMeshClearance([sameCubeB, sameCubeA], [0, 0, 1.4], 0.5);
close(clearance.clearance!, -0.1);
assert.equal(clearance.colliding, true);
assert.equal(clearance.nearest?.objectId, "mesh-a", "mesh IDs must provide stable aggregate ties");
assert.throws(() => queryProcPlantMeshClearance([sameCubeA, sameCubeA], [0, 0, 0]), /duplicate triangle mesh id/);

const resolution = resolveProcPlantMeshObstacles([cube], [0, 0, 0], 0, 4);
assert.equal(resolution.blocked, true);
assert.deepEqual(resolution.resolvedObjectIds, ["cube"]);
assert.ok(resolution.passes >= 1 && resolution.passes <= 4);
assert.ok((resolution.clearance ?? -1) >= -1e-8);
assert.ok(Math.hypot(...resolution.correction) >= 1);

assert.throws(() => createProcPlantTriangleMeshIndex(cubeSource, { maxTriangles: 5 }), /exceeds maxTriangles/);
assert.throws(() => createProcPlantTriangleMeshIndex(cubeSource, { leafSize: 1, maxNodes: 1 }), /exceeds maxNodes/);
assert.throws(() => createProcPlantTriangleMeshIndex({
  ...cubeSource,
  id: "perspective",
  worldMatrix: [1, 0, 0.1, 0.1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
}), /must be affine/);
assert.throws(() => createProcPlantTriangleMeshIndex({
  id: "only-degenerate",
  positions: [0, 0, 0, 0, 0, 0, 0, 0, 0],
}), /no non-degenerate triangles/);
assert.throws(() => queryProcPlantTriangleMesh(cube, [0, 0, 2], {
  mode: "exhaustive",
  maxTriangleTests: 1,
}), /exceeded maxTriangleTests/);
assert.throws(() => queryProcPlantTriangleMesh(cube, [0, 0, 2], { maxNodeVisits: 1 }), /exceeded maxNodeVisits/);

const gridSize = 60;
const gridPositions: number[] = [];
for (let y = 0; y <= gridSize; y++) {
  for (let x = 0; x <= gridSize; x++) gridPositions.push(x - gridSize / 2, y - gridSize / 2, 0);
}
const gridIndices: number[] = [];
for (let y = 0; y < gridSize; y++) {
  for (let x = 0; x < gridSize; x++) {
    const a = y * (gridSize + 1) + x;
    const b = a + 1;
    const d = a + gridSize + 1;
    const c = d + 1;
    gridIndices.push(a, b, c, a, c, d);
  }
}
const grid = createProcPlantTriangleMeshIndex({
  id: "large-grid",
  positions: new Float32Array(gridPositions),
  indices: new Uint32Array(gridIndices),
}, { leafSize: 4 });
const gridBvh = queryProcPlantTriangleMesh(grid, [0.1, 0.1, 3], { signed: false });
const gridExhaustive = queryProcPlantTriangleMesh(grid, [0.1, 0.1, 3], { mode: "exhaustive", signed: false });
compareQueries(gridBvh, gridExhaustive);
close(gridBvh.distance, 3);
assert.ok(gridBvh.audit.totalTriangleTests < gridExhaustive.audit.totalTriangleTests / 10,
  `expected BVH triangle work ${gridBvh.audit.totalTriangleTests} to be < 10% of ${gridExhaustive.audit.totalTriangleTests}`);
assert.ok(gridBvh.audit.nodeVisits < grid.nodes.length);

console.log(JSON.stringify({
  message: "procplant triangle mesh query tests passed",
  gridTriangles: grid.stats.triangles,
  gridBvhNodes: grid.stats.nodes,
  bvhTriangleTests: gridBvh.audit.totalTriangleTests,
  exhaustiveTriangleTests: gridExhaustive.audit.totalTriangleTests,
  bvhNodeVisits: gridBvh.audit.nodeVisits,
}));
