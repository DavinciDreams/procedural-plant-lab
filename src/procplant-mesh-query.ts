import type { ProcPlantVec3 } from "./procplant-guide-query";

export const PROCPLANT_MESH_QUERY_CONTRACT = "procplants.triangle-mesh-query" as const;
export const PROCPLANT_MESH_QUERY_VERSION = 1 as const;

export interface ProcPlantTriangleMeshSource {
  id: string;
  positions: ArrayLike<number>;
  indices?: ArrayLike<number>;
  /** Column-major affine matrix, matching glTF/WebGL conventions. */
  worldMatrix?: ArrayLike<number>;
  /** Enables signed ray-parity queries. Requires closed, outward-wound topology. */
  closed?: boolean;
}

export interface ProcPlantTriangleMeshBuildOptions {
  leafSize?: number;
  maxDepth?: number;
  maxVertices?: number;
  maxTriangles?: number;
  maxNodes?: number;
  degenerateAreaEpsilon?: number;
}

export interface ProcPlantTriangleMeshQueryOptions {
  mode?: "bvh" | "exhaustive";
  signed?: boolean;
  maxNodeVisits?: number;
  maxTriangleTests?: number;
}

export interface ProcPlantIndexedTriangle {
  sourceTriangleIndex: number;
  a: ProcPlantVec3;
  b: ProcPlantVec3;
  c: ProcPlantVec3;
  normal: ProcPlantVec3;
  minimum: ProcPlantVec3;
  maximum: ProcPlantVec3;
  centroid: ProcPlantVec3;
}

export interface ProcPlantMeshBvhNode {
  minimum: ProcPlantVec3;
  maximum: ProcPlantVec3;
  left: number | null;
  right: number | null;
  triangleIndices: number[];
}

export interface ProcPlantTriangleMeshIndex {
  contract: typeof PROCPLANT_MESH_QUERY_CONTRACT;
  version: typeof PROCPLANT_MESH_QUERY_VERSION;
  id: string;
  closed: boolean;
  rootNode: number;
  triangles: ProcPlantIndexedTriangle[];
  nodes: ProcPlantMeshBvhNode[];
  stats: {
    sourceVertices: number;
    sourceTriangles: number;
    triangles: number;
    degenerateTriangles: number;
    nodes: number;
    leaves: number;
    maximumDepth: number;
  };
}

export interface ProcPlantTriangleMeshQuery {
  objectId: string;
  role: "obstacle";
  shape: "triangle-mesh";
  /** Signed for closed meshes when requested; otherwise unsigned. */
  distance: number;
  closestPoint: ProcPlantVec3;
  normal: ProcPlantVec3;
  inside: boolean;
  triangleIndex: number;
  audit: {
    mode: "bvh" | "exhaustive";
    nodeVisits: number;
    closestTriangleTests: number;
    rayTriangleTests: number;
    totalTriangleTests: number;
  };
}

export interface ProcPlantMeshClearanceQuery {
  contract: typeof PROCPLANT_MESH_QUERY_CONTRACT;
  version: typeof PROCPLANT_MESH_QUERY_VERSION;
  clearanceRadius: number;
  clearance: number | null;
  colliding: boolean;
  nearest: ProcPlantTriangleMeshQuery | null;
  audit: {
    meshes: number;
    nodeVisits: number;
    triangleTests: number;
  };
}

export interface ProcPlantMeshObstacleResolution {
  contract: typeof PROCPLANT_MESH_QUERY_CONTRACT;
  version: typeof PROCPLANT_MESH_QUERY_VERSION;
  sourcePosition: ProcPlantVec3;
  resolvedPosition: ProcPlantVec3;
  correction: ProcPlantVec3;
  blocked: boolean;
  clearance: number | null;
  nearestObstacleId: string | null;
  resolvedObjectIds: string[];
  passes: number;
  audit: { nodeVisits: number; triangleTests: number };
}

const EPSILON = 1e-10;
const RAY_EPSILON = 1e-9;
const RAY_DIRECTION = (() => {
  const direction: ProcPlantVec3 = [1, 0.3713906763541037, 0.17320508075688773];
  const magnitude = Math.hypot(...direction);
  return direction.map((value) => value / magnitude) as ProcPlantVec3;
})();

const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};

const boundedInteger = (value: number, label: string, minimum: number, maximum: number) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
};

const vector = (value: ArrayLike<number>, offset: number, label: string): ProcPlantVec3 => [
  finite(value[offset]!, `${label}[${offset}]`),
  finite(value[offset + 1]!, `${label}[${offset + 1}]`),
  finite(value[offset + 2]!, `${label}[${offset + 2}]`),
];

const add = (a: ProcPlantVec3, b: ProcPlantVec3): ProcPlantVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: ProcPlantVec3, b: ProcPlantVec3): ProcPlantVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (value: ProcPlantVec3, amount: number): ProcPlantVec3 => [value[0] * amount, value[1] * amount, value[2] * amount];
const dot = (a: ProcPlantVec3, b: ProcPlantVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ProcPlantVec3, b: ProcPlantVec3): ProcPlantVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lengthSquared = (value: ProcPlantVec3) => dot(value, value);
const length = (value: ProcPlantVec3) => Math.sqrt(lengthSquared(value));
const normalize = (value: ProcPlantVec3, fallback: ProcPlantVec3 = [1, 0, 0]): ProcPlantVec3 => {
  const magnitude = length(value);
  return magnitude > EPSILON ? scale(value, 1 / magnitude) : [...fallback];
};
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

const validatePoint = (point: ProcPlantVec3, label = "point") => vector(point, 0, label);

const transformedPoint = (point: ProcPlantVec3, matrix?: ArrayLike<number>): ProcPlantVec3 => {
  if (!matrix) return [...point];
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
  if (!Number.isFinite(w) || Math.abs(w) < EPSILON) throw new Error("worldMatrix produces an invalid homogeneous coordinate");
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / w,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / w,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) / w,
  ];
};

const matrixDeterminant3 = (matrix?: ArrayLike<number>) => matrix
  ? matrix[0]! * (matrix[5]! * matrix[10]! - matrix[9]! * matrix[6]!)
    - matrix[4]! * (matrix[1]! * matrix[10]! - matrix[9]! * matrix[2]!)
    + matrix[8]! * (matrix[1]! * matrix[6]! - matrix[5]! * matrix[2]!)
  : 1;

const triangleBounds = (a: ProcPlantVec3, b: ProcPlantVec3, c: ProcPlantVec3) => ({
  minimum: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])] as ProcPlantVec3,
  maximum: [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])] as ProcPlantVec3,
  centroid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] as ProcPlantVec3,
});

const unionBounds = (triangles: readonly ProcPlantIndexedTriangle[], indices: readonly number[]) => {
  const minimum: ProcPlantVec3 = [Infinity, Infinity, Infinity];
  const maximum: ProcPlantVec3 = [-Infinity, -Infinity, -Infinity];
  const centroidMinimum: ProcPlantVec3 = [Infinity, Infinity, Infinity];
  const centroidMaximum: ProcPlantVec3 = [-Infinity, -Infinity, -Infinity];
  for (const triangleIndex of indices) {
    const triangle = triangles[triangleIndex]!;
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], triangle.minimum[axis]);
      maximum[axis] = Math.max(maximum[axis], triangle.maximum[axis]);
      centroidMinimum[axis] = Math.min(centroidMinimum[axis], triangle.centroid[axis]);
      centroidMaximum[axis] = Math.max(centroidMaximum[axis], triangle.centroid[axis]);
    }
  }
  return { minimum, maximum, centroidMinimum, centroidMaximum };
};

/** Build a deterministic median-split triangle BVH without mutating source buffers. */
export const createProcPlantTriangleMeshIndex = (
  source: ProcPlantTriangleMeshSource,
  options: ProcPlantTriangleMeshBuildOptions = {},
): ProcPlantTriangleMeshIndex => {
  if (!source.id.trim()) throw new Error("triangle mesh id must be non-empty");
  if (source.positions.length < 9 || source.positions.length % 3 !== 0) {
    throw new Error(`${source.id}.positions must contain at least one xyz triangle`);
  }
  const sourceVertices = source.positions.length / 3;
  const maxVertices = boundedInteger(options.maxVertices ?? 1_000_000, "maxVertices", 3, 5_000_000);
  const maxTriangles = boundedInteger(options.maxTriangles ?? 500_000, "maxTriangles", 1, 2_000_000);
  if (sourceVertices > maxVertices) throw new Error(`${source.id} exceeds maxVertices (${sourceVertices} > ${maxVertices})`);
  if (source.worldMatrix) {
    if (source.worldMatrix.length !== 16) throw new Error(`${source.id}.worldMatrix must contain 16 values`);
    for (let index = 0; index < 16; index++) finite(source.worldMatrix[index]!, `${source.id}.worldMatrix[${index}]`);
    if (Math.abs(source.worldMatrix[3]!) > EPSILON || Math.abs(source.worldMatrix[7]!) > EPSILON ||
      Math.abs(source.worldMatrix[11]!) > EPSILON || Math.abs(source.worldMatrix[15]!) < EPSILON) {
      throw new Error(`${source.id}.worldMatrix must be affine`);
    }
    if (Math.abs(matrixDeterminant3(source.worldMatrix)) < EPSILON) throw new Error(`${source.id}.worldMatrix must be invertible`);
  }
  const indexed = source.indices !== undefined;
  if (indexed && (source.indices!.length === 0 || source.indices!.length % 3 !== 0)) {
    throw new Error(`${source.id}.indices must contain triangle tuples`);
  }
  if (!indexed && sourceVertices % 3 !== 0) throw new Error(`${source.id} non-indexed positions must contain complete triangles`);
  const sourceTriangles = indexed ? source.indices!.length / 3 : sourceVertices / 3;
  if (sourceTriangles > maxTriangles) throw new Error(`${source.id} exceeds maxTriangles (${sourceTriangles} > ${maxTriangles})`);
  const leafSize = boundedInteger(options.leafSize ?? 8, "leafSize", 1, 64);
  const maxDepth = boundedInteger(options.maxDepth ?? 32, "maxDepth", 1, 64);
  const maxNodes = boundedInteger(options.maxNodes ?? Math.max(1, sourceTriangles * 2), "maxNodes", 1, 4_000_000);
  const areaEpsilon = finite(options.degenerateAreaEpsilon ?? 1e-12, "degenerateAreaEpsilon");
  if (areaEpsilon < 0) throw new Error("degenerateAreaEpsilon must be non-negative");
  const transformedVertices = Array.from({ length: sourceVertices }, (_, index) =>
    transformedPoint(vector(source.positions, index * 3, `${source.id}.positions`), source.worldMatrix)
  );
  const reflected = matrixDeterminant3(source.worldMatrix) < 0;
  const triangles: ProcPlantIndexedTriangle[] = [];
  let degenerateTriangles = 0;
  for (let triangleIndex = 0; triangleIndex < sourceTriangles; triangleIndex++) {
    const indices = indexed
      ? [source.indices![triangleIndex * 3]!, source.indices![triangleIndex * 3 + 1]!, source.indices![triangleIndex * 3 + 2]!]
      : [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2];
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= sourceVertices) {
        throw new Error(`${source.id}.indices references invalid vertex ${index}`);
      }
    }
    const a = transformedVertices[indices[0]!]!;
    let b = transformedVertices[indices[1]!]!;
    let c = transformedVertices[indices[2]!]!;
    if (reflected) [b, c] = [c, b];
    const crossValue = cross(subtract(b, a), subtract(c, a));
    if (lengthSquared(crossValue) <= areaEpsilon * areaEpsilon) {
      degenerateTriangles++;
      continue;
    }
    const bounds = triangleBounds(a, b, c);
    triangles.push({
      sourceTriangleIndex: triangleIndex,
      a: [...a], b: [...b], c: [...c],
      normal: normalize(crossValue),
      ...bounds,
    });
  }
  if (triangles.length === 0) throw new Error(`${source.id} contains no non-degenerate triangles`);

  const nodes: ProcPlantMeshBvhNode[] = [];
  let leaves = 0;
  let maximumDepth = 0;
  const buildNode = (triangleIndices: number[], depth: number): number => {
    if (nodes.length >= maxNodes) throw new Error(`${source.id} exceeds maxNodes (${maxNodes})`);
    maximumDepth = Math.max(maximumDepth, depth);
    const bounds = unionBounds(triangles, triangleIndices);
    const nodeIndex = nodes.length;
    nodes.push({ minimum: bounds.minimum, maximum: bounds.maximum, left: null, right: null, triangleIndices: [] });
    if (triangleIndices.length <= leafSize || depth >= maxDepth) {
      nodes[nodeIndex]!.triangleIndices = [...triangleIndices].sort((left, right) =>
        triangles[left]!.sourceTriangleIndex - triangles[right]!.sourceTriangleIndex
      );
      leaves++;
      return nodeIndex;
    }
    let axis = 0;
    const spans = bounds.centroidMaximum.map((value, index) => value - bounds.centroidMinimum[index]) as ProcPlantVec3;
    if (spans[1] > spans[axis]) axis = 1;
    if (spans[2] > spans[axis]) axis = 2;
    triangleIndices.sort((left, right) =>
      triangles[left]!.centroid[axis] - triangles[right]!.centroid[axis]
      || triangles[left]!.sourceTriangleIndex - triangles[right]!.sourceTriangleIndex
    );
    const midpoint = Math.floor(triangleIndices.length / 2);
    if (midpoint === 0 || midpoint === triangleIndices.length) {
      nodes[nodeIndex]!.triangleIndices = [...triangleIndices];
      leaves++;
      return nodeIndex;
    }
    nodes[nodeIndex]!.left = buildNode(triangleIndices.slice(0, midpoint), depth + 1);
    nodes[nodeIndex]!.right = buildNode(triangleIndices.slice(midpoint), depth + 1);
    return nodeIndex;
  };
  const rootNode = buildNode(triangles.map((_, index) => index), 0);
  return {
    contract: PROCPLANT_MESH_QUERY_CONTRACT,
    version: PROCPLANT_MESH_QUERY_VERSION,
    id: source.id,
    closed: source.closed ?? false,
    rootNode,
    triangles,
    nodes,
    stats: { sourceVertices, sourceTriangles, triangles: triangles.length, degenerateTriangles, nodes: nodes.length, leaves, maximumDepth },
  };
};

const closestPointOnTriangle = (point: ProcPlantVec3, triangle: ProcPlantIndexedTriangle): ProcPlantVec3 => {
  const ab = subtract(triangle.b, triangle.a);
  const ac = subtract(triangle.c, triangle.a);
  const ap = subtract(point, triangle.a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [...triangle.a];
  const bp = subtract(point, triangle.b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [...triangle.b];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(triangle.a, scale(ab, d1 / (d1 - d3)));
  const cp = subtract(point, triangle.c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [...triangle.c];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(triangle.a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return add(triangle.b, scale(subtract(triangle.c, triangle.b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }
  const denominator = 1 / (va + vb + vc);
  return add(triangle.a, add(scale(ab, vb * denominator), scale(ac, vc * denominator)));
};

const pointBoundsDistanceSquared = (point: ProcPlantVec3, minimum: ProcPlantVec3, maximum: ProcPlantVec3) => {
  let distance = 0;
  for (let axis = 0; axis < 3; axis++) {
    const delta = point[axis] < minimum[axis]
      ? minimum[axis] - point[axis]
      : point[axis] > maximum[axis] ? point[axis] - maximum[axis] : 0;
    distance += delta * delta;
  }
  return distance;
};

const rayIntersectsBounds = (origin: ProcPlantVec3, minimum: ProcPlantVec3, maximum: ProcPlantVec3) => {
  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const inverse = 1 / RAY_DIRECTION[axis];
    let axisNear = (minimum[axis] - origin[axis]) * inverse;
    let axisFar = (maximum[axis] - origin[axis]) * inverse;
    if (axisNear > axisFar) [axisNear, axisFar] = [axisFar, axisNear];
    near = Math.max(near, axisNear);
    far = Math.min(far, axisFar);
    if (far < near) return false;
  }
  return far > RAY_EPSILON;
};

const rayTriangleDistance = (origin: ProcPlantVec3, triangle: ProcPlantIndexedTriangle) => {
  const edge1 = subtract(triangle.b, triangle.a);
  const edge2 = subtract(triangle.c, triangle.a);
  const p = cross(RAY_DIRECTION, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < RAY_EPSILON) return null;
  const inverse = 1 / determinant;
  const tVector = subtract(origin, triangle.a);
  const u = dot(tVector, p) * inverse;
  if (u < -RAY_EPSILON || u > 1 + RAY_EPSILON) return null;
  const q = cross(tVector, edge1);
  const v = dot(RAY_DIRECTION, q) * inverse;
  if (v < -RAY_EPSILON || u + v > 1 + RAY_EPSILON) return null;
  const distance = dot(edge2, q) * inverse;
  return distance > RAY_EPSILON ? distance : null;
};

interface QueryWork {
  nodeVisits: number;
  closestTriangleTests: number;
  rayTriangleTests: number;
  maxNodeVisits: number;
  maxTriangleTests: number;
}

const visitNode = (work: QueryWork) => {
  work.nodeVisits++;
  if (work.nodeVisits > work.maxNodeVisits) throw new Error(`mesh query exceeded maxNodeVisits (${work.maxNodeVisits})`);
};
const testTriangle = (work: QueryWork, ray: boolean) => {
  if (ray) work.rayTriangleTests++;
  else work.closestTriangleTests++;
  if (work.closestTriangleTests + work.rayTriangleTests > work.maxTriangleTests) {
    throw new Error(`mesh query exceeded maxTriangleTests (${work.maxTriangleTests})`);
  }
};

const candidateTriangles = (
  index: ProcPlantTriangleMeshIndex,
  point: ProcPlantVec3,
  mode: "bvh" | "exhaustive",
  work: QueryWork,
) => {
  if (mode === "exhaustive") return index.triangles.map((_, triangleIndex) => triangleIndex);
  const pending = [{ nodeIndex: index.rootNode, distance: pointBoundsDistanceSquared(point, index.nodes[index.rootNode]!.minimum, index.nodes[index.rootNode]!.maximum) }];
  const candidates: number[] = [];
  let bestDistance = Infinity;
  while (pending.length > 0) {
    pending.sort((left, right) => left.distance - right.distance || left.nodeIndex - right.nodeIndex);
    const current = pending.shift()!;
    if (current.distance > bestDistance + EPSILON) continue;
    visitNode(work);
    const node = index.nodes[current.nodeIndex]!;
    if (node.left === null && node.right === null) {
      for (const triangleIndex of node.triangleIndices) {
        candidates.push(triangleIndex);
        testTriangle(work, false);
        const closest = closestPointOnTriangle(point, index.triangles[triangleIndex]!);
        bestDistance = Math.min(bestDistance, lengthSquared(subtract(point, closest)));
      }
      continue;
    }
    for (const childIndex of [node.left, node.right]) {
      if (childIndex === null) continue;
      const child = index.nodes[childIndex]!;
      const distance = pointBoundsDistanceSquared(point, child.minimum, child.maximum);
      if (distance <= bestDistance + EPSILON) pending.push({ nodeIndex: childIndex, distance });
    }
  }
  return candidates.sort((left, right) => index.triangles[left]!.sourceTriangleIndex - index.triangles[right]!.sourceTriangleIndex);
};

const rayCandidates = (
  index: ProcPlantTriangleMeshIndex,
  point: ProcPlantVec3,
  mode: "bvh" | "exhaustive",
  work: QueryWork,
) => {
  if (mode === "exhaustive") return index.triangles.map((_, triangleIndex) => triangleIndex);
  const pending = [index.rootNode];
  const candidates: number[] = [];
  while (pending.length > 0) {
    pending.sort((a, b) => a - b);
    const nodeIndex = pending.shift()!;
    visitNode(work);
    const node = index.nodes[nodeIndex]!;
    if (!rayIntersectsBounds(point, node.minimum, node.maximum)) continue;
    if (node.left === null && node.right === null) candidates.push(...node.triangleIndices);
    else {
      if (node.left !== null) pending.push(node.left);
      if (node.right !== null) pending.push(node.right);
    }
  }
  return candidates.sort((left, right) => index.triangles[left]!.sourceTriangleIndex - index.triangles[right]!.sourceTriangleIndex);
};

/** Exact closest point with optional signed closed-mesh distance. */
export const queryProcPlantTriangleMesh = (
  index: ProcPlantTriangleMeshIndex,
  sourcePoint: ProcPlantVec3,
  options: ProcPlantTriangleMeshQueryOptions = {},
): ProcPlantTriangleMeshQuery => {
  if (index.contract !== PROCPLANT_MESH_QUERY_CONTRACT || index.version !== PROCPLANT_MESH_QUERY_VERSION) {
    throw new Error("unsupported triangle mesh query index");
  }
  const point = validatePoint(sourcePoint);
  const mode = options.mode ?? "bvh";
  if (mode !== "bvh" && mode !== "exhaustive") throw new Error("mesh query mode must be bvh or exhaustive");
  const work: QueryWork = {
    nodeVisits: 0,
    closestTriangleTests: 0,
    rayTriangleTests: 0,
    maxNodeVisits: boundedInteger(
      options.maxNodeVisits ?? Math.max(1, index.nodes.length * 4),
      "maxNodeVisits",
      1,
      20_000_000,
    ),
    maxTriangleTests: boundedInteger(
      options.maxTriangleTests ?? Math.max(1, index.triangles.length * 3),
      "maxTriangleTests",
      1,
      20_000_000,
    ),
  };
  let nearestTriangle = -1;
  let nearestSourceIndex = Infinity;
  let closestPoint: ProcPlantVec3 = [0, 0, 0];
  let bestDistanceSquared = Infinity;
  for (const triangleIndex of candidateTriangles(index, point, mode, work)) {
    testTriangle(work, false);
    const triangle = index.triangles[triangleIndex]!;
    const candidate = closestPointOnTriangle(point, triangle);
    const distanceSquared = lengthSquared(subtract(point, candidate));
    if (
      distanceSquared < bestDistanceSquared - EPSILON ||
      (Math.abs(distanceSquared - bestDistanceSquared) <= EPSILON && triangle.sourceTriangleIndex < nearestSourceIndex)
    ) {
      nearestTriangle = triangleIndex;
      nearestSourceIndex = triangle.sourceTriangleIndex;
      closestPoint = candidate;
      bestDistanceSquared = distanceSquared;
    }
  }
  if (nearestTriangle < 0) throw new Error(`${index.id} query found no triangle candidate`);
  let inside = false;
  if ((options.signed ?? true) && index.closed && bestDistanceSquared > EPSILON * EPSILON) {
    const intersections: number[] = [];
    for (const triangleIndex of rayCandidates(index, point, mode, work)) {
      testTriangle(work, true);
      const distance = rayTriangleDistance(point, index.triangles[triangleIndex]!);
      if (distance !== null) intersections.push(distance);
    }
    intersections.sort((a, b) => a - b);
    let uniqueIntersections = 0;
    let prior = -Infinity;
    for (const distance of intersections) {
      if (Math.abs(distance - prior) <= 1e-7 * Math.max(1, Math.abs(distance))) continue;
      uniqueIntersections++;
      prior = distance;
    }
    inside = uniqueIntersections % 2 === 1;
  }
  const triangle = index.triangles[nearestTriangle]!;
  const offset = subtract(point, closestPoint);
  const unsignedDistance = Math.sqrt(bestDistanceSquared);
  let normal = inside ? [...triangle.normal] as ProcPlantVec3 : normalize(offset, triangle.normal);
  if (!inside && dot(normal, offset) < 0) normal = scale(normal, -1);
  return {
    objectId: index.id,
    role: "obstacle",
    shape: "triangle-mesh",
    distance: inside ? -unsignedDistance : unsignedDistance,
    closestPoint,
    normal,
    inside,
    triangleIndex: nearestSourceIndex,
    audit: {
      mode,
      nodeVisits: work.nodeVisits,
      closestTriangleTests: work.closestTriangleTests,
      rayTriangleTests: work.rayTriangleTests,
      totalTriangleTests: work.closestTriangleTests + work.rayTriangleTests,
    },
  };
};

const stableIndexes = (source: readonly ProcPlantTriangleMeshIndex[]) => {
  const indexes = [...source].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (let index = 1; index < indexes.length; index++) {
    if (indexes[index - 1]!.id === indexes[index]!.id) throw new Error(`duplicate triangle mesh id: ${indexes[index]!.id}`);
  }
  return indexes;
};

/** Aggregate mesh clearance with the same clearance/colliding/nearest shape as primitive guide queries. */
export const queryProcPlantMeshClearance = (
  source: readonly ProcPlantTriangleMeshIndex[],
  point: ProcPlantVec3,
  clearanceRadius = 0,
  options: ProcPlantTriangleMeshQueryOptions = {},
): ProcPlantMeshClearanceQuery => {
  const radius = finite(clearanceRadius, "clearanceRadius");
  if (radius < 0) throw new Error("clearanceRadius must not be negative");
  let clearance: number | null = null;
  let nearest: ProcPlantTriangleMeshQuery | null = null;
  let nodeVisits = 0;
  let triangleTests = 0;
  const indexes = stableIndexes(source);
  for (const index of indexes) {
    const query = queryProcPlantTriangleMesh(index, point, options);
    nodeVisits += query.audit.nodeVisits;
    triangleTests += query.audit.totalTriangleTests;
    const candidate = query.distance - radius;
    if (clearance === null || candidate < clearance - EPSILON ||
      (Math.abs(candidate - clearance) <= EPSILON && query.objectId < nearest!.objectId)) {
      clearance = candidate;
      nearest = query;
    }
  }
  return {
    contract: PROCPLANT_MESH_QUERY_CONTRACT,
    version: PROCPLANT_MESH_QUERY_VERSION,
    clearanceRadius: radius,
    clearance,
    colliding: clearance !== null && clearance < 0,
    nearest,
    audit: { meshes: indexes.length, nodeVisits, triangleTests },
  };
};

/** Bounded obstacle projection suitable for a growth-tip candidate position. */
export const resolveProcPlantMeshObstacles = (
  meshes: readonly ProcPlantTriangleMeshIndex[],
  sourcePoint: ProcPlantVec3,
  clearanceRadius = 0,
  maxPasses = 4,
  options: ProcPlantTriangleMeshQueryOptions = {},
): ProcPlantMeshObstacleResolution => {
  const sourcePosition = validatePoint(sourcePoint);
  const passesLimit = boundedInteger(maxPasses, "maxPasses", 1, 32);
  let resolvedPosition: ProcPlantVec3 = [...sourcePosition];
  const resolvedIds = new Set<string>();
  let passes = 0;
  let nodeVisits = 0;
  let triangleTests = 0;
  for (let pass = 0; pass < passesLimit; pass++) {
    const clearance = queryProcPlantMeshClearance(meshes, resolvedPosition, clearanceRadius, options);
    nodeVisits += clearance.audit.nodeVisits;
    triangleTests += clearance.audit.triangleTests;
    if (!clearance.colliding || !clearance.nearest || clearance.clearance === null) break;
    resolvedPosition = add(resolvedPosition, scale(clearance.nearest.normal, -clearance.clearance + 1e-8));
    resolvedIds.add(clearance.nearest.objectId);
    passes = pass + 1;
  }
  const finalClearance = queryProcPlantMeshClearance(meshes, resolvedPosition, clearanceRadius, options);
  nodeVisits += finalClearance.audit.nodeVisits;
  triangleTests += finalClearance.audit.triangleTests;
  const correction = subtract(resolvedPosition, sourcePosition);
  return {
    contract: PROCPLANT_MESH_QUERY_CONTRACT,
    version: PROCPLANT_MESH_QUERY_VERSION,
    sourcePosition,
    resolvedPosition,
    correction,
    blocked: lengthSquared(correction) > EPSILON * EPSILON,
    clearance: finalClearance.clearance,
    nearestObstacleId: finalClearance.nearest?.objectId ?? null,
    resolvedObjectIds: [...resolvedIds].sort(),
    passes,
    audit: { nodeVisits, triangleTests },
  };
};
