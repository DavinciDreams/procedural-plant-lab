import * as THREE from "three";
import {
  PROCPLANT_BRANCH_AGE_ATTRIBUTE,
  PROCPLANT_BRANCH_ORDER_ATTRIBUTE,
  PROCPLANT_BRANCH_SWAY_ATTRIBUTE,
  PROCPLANT_BRANCH_TINTABLE_ATTRIBUTE,
  PROCPLANT_BRANCH_U_ATTRIBUTE,
  PROCPLANT_BRANCH_V_ATTRIBUTE,
  type ProcPlantTubeSample,
} from "./procplant-tube";

export const PROCPLANT_WATERTIGHT_JUNCTION_CONTRACT = "procplants.watertight-junction" as const;
export const PROCPLANT_WATERTIGHT_JUNCTION_VERSION = 1 as const;
export const PROCPLANT_JUNCTION_CHAIN_ATTRIBUTE = "procplantJunctionChain" as const;

export const PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS = Object.freeze({
  chains: 4,
  children: 3,
  segments: 4,
  gridAxis: 72,
  gridCells: 180_000,
  workItems: 1_500_000,
  triangles: 300_000,
  topologyIntersectionTests: 2_000_000,
});

export type ProcPlantWatertightJunctionDiagnosticCode =
  | "disabled"
  | "invalid-input"
  | "unsupported-valence"
  | "unsupported-topology"
  | "unsupported-angle"
  | "unsupported-radius-ratio"
  | "unsupported-segment-length"
  | "grid-cap-exceeded"
  | "work-cap-exceeded"
  | "triangle-cap-exceeded"
  | "topology-validation-failed";

export interface ProcPlantWatertightJunctionDiagnostic {
  code: ProcPlantWatertightJunctionDiagnosticCode;
  message: string;
}

/**
 * V1 deliberately supports one straight parent segment and one to three
 * straight child segments meeting at one endpoint. Curved/multi-junction
 * networks fail closed to the caller's visual-collar geometry.
 */
export interface ProcPlantWatertightJunctionChain {
  id: string;
  role: "parent" | "child";
  samples: readonly [ProcPlantTubeSample, ProcPlantTubeSample];
}

export interface ProcPlantWatertightJunctionOptions {
  /** Omission is the exact legacy path. */
  enabled?: boolean;
  /** Sampling density relative to the smallest endpoint radius. */
  cellsPerMinimumRadius?: number;
  barkRepeatLength?: number;
  color?: THREE.ColorRepresentation;
  maxGridCells?: number;
  maxWorkItems?: number;
  maxTriangles?: number;
  maxTopologyIntersectionTests?: number;
}

export interface ProcPlantMeshTopologyOptions {
  maxTriangles?: number;
  maxIntersectionTests?: number;
  positionEpsilon?: number;
  areaEpsilon?: number;
}

export interface ProcPlantMeshTopologyAudit {
  contract: "procplants.mesh-topology";
  version: 1;
  vertices: number;
  triangles: number;
  components: number;
  componentTriangles: readonly number[];
  componentBounds: readonly { min: readonly [number, number, number]; max: readonly [number, number, number] }[];
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentWindingEdges: number;
  degenerateTriangles: number;
  duplicateTriangles: number;
  selfIntersections: number;
  selfIntersectionPairs: readonly (readonly [number, number])[];
  intersectionTests: number;
  intersectionCheckComplete: boolean;
  closedTwoManifold: boolean;
}

export interface ProcPlantWatertightJunctionAudit {
  contract: typeof PROCPLANT_WATERTIGHT_JUNCTION_CONTRACT;
  version: typeof PROCPLANT_WATERTIGHT_JUNCTION_VERSION;
  mode: "disabled" | "fallback-collar" | "watertight";
  sourceGeometryReused: boolean;
  chains: number;
  segments: number;
  grid: readonly [number, number, number] | null;
  gridCells: number;
  workItems: number;
  triangles: number;
  topology: ProcPlantMeshTopologyAudit | null;
  diagnostics: readonly ProcPlantWatertightJunctionDiagnostic[];
}

export interface ProcPlantWatertightJunctionResult {
  geometry: THREE.BufferGeometry | null;
  audit: ProcPlantWatertightJunctionAudit;
}

interface ValidatedSegment {
  id: string;
  chainIndex: number;
  role: "parent" | "child";
  start: THREE.Vector3;
  end: THREE.Vector3;
  startRadius: number;
  endRadius: number;
  startAge: number;
  endAge: number;
  branchOrder: number;
  direction: THREE.Vector3;
  length: number;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

interface NearestSegmentPoint {
  segment: ValidatedSegment;
  t: number;
  center: THREE.Vector3;
  radius: number;
  value: number;
}

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;

const boundedInteger = (value: number | undefined, fallback: number, hardCap: number, label: string) => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > hardCap) {
    throw new Error(`${label} must be an integer in [1, ${hardCap}]`);
  }
  return resolved;
};

const fallback = (
  legacyGeometry: THREE.BufferGeometry | null,
  chains: number,
  diagnostics: ProcPlantWatertightJunctionDiagnostic[],
  metrics: Partial<Pick<ProcPlantWatertightJunctionAudit, "segments" | "grid" | "gridCells" | "workItems" | "triangles">> = {},
): ProcPlantWatertightJunctionResult => ({
  geometry: legacyGeometry,
  audit: {
    contract: PROCPLANT_WATERTIGHT_JUNCTION_CONTRACT,
    version: PROCPLANT_WATERTIGHT_JUNCTION_VERSION,
    mode: diagnostics[0]?.code === "disabled" ? "disabled" : "fallback-collar",
    sourceGeometryReused: legacyGeometry !== null,
    chains,
    segments: metrics.segments ?? 0,
    grid: metrics.grid ?? null,
    gridCells: metrics.gridCells ?? 0,
    workItems: metrics.workItems ?? 0,
    triangles: metrics.triangles ?? 0,
    topology: null,
    diagnostics,
  },
});

const chooseFrame = (direction: THREE.Vector3) => {
  const reference = Math.abs(direction.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(reference, direction).normalize();
  return { right, up: new THREE.Vector3().crossVectors(direction, right).normalize() };
};

const validateChains = (
  chains: readonly ProcPlantWatertightJunctionChain[],
): { segments: ValidatedSegment[]; diagnostics: ProcPlantWatertightJunctionDiagnostic[] } => {
  const diagnostics: ProcPlantWatertightJunctionDiagnostic[] = [];
  if (chains.length < 2 || chains.length > PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.chains) {
    diagnostics.push({ code: "unsupported-valence", message: "V1 requires one parent and one to three child chains." });
    return { segments: [], diagnostics };
  }
  const parents = chains.filter((chain) => chain.role === "parent");
  const children = chains.filter((chain) => chain.role === "child");
  if (parents.length !== 1 || children.length < 1 || children.length > PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.children) {
    diagnostics.push({ code: "unsupported-valence", message: "V1 requires exactly one parent and one to three children." });
    return { segments: [], diagnostics };
  }
  if (new Set(chains.map((chain) => chain.id)).size !== chains.length || chains.some((chain) => !chain.id.trim())) {
    diagnostics.push({ code: "invalid-input", message: "Junction chain ids must be non-empty and unique." });
    return { segments: [], diagnostics };
  }
  const hub = parents[0]!.samples[1].position;
  const allRadii = chains.flatMap((chain) => chain.samples.map((sample) => sample.radius));
  if (!allRadii.every(finitePositive)) {
    diagnostics.push({ code: "invalid-input", message: "Every junction sample radius must be finite and positive." });
    return { segments: [], diagnostics };
  }
  const hubTolerance = Math.min(...allRadii) * 1e-5;
  const segments: ValidatedSegment[] = [];
  for (let chainIndex = 0; chainIndex < chains.length; chainIndex++) {
    const chain = chains[chainIndex]!;
    const [a, b] = chain.samples;
    const values = [a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z];
    if (!values.every(Number.isFinite)) {
      diagnostics.push({ code: "invalid-input", message: `Chain ${chain.id} contains a non-finite position.` });
      return { segments: [], diagnostics };
    }
    const chainHub = chain.role === "parent" ? b.position : a.position;
    if (chainHub.distanceTo(hub) > hubTolerance) {
      diagnostics.push({ code: "unsupported-topology", message: `Chain ${chain.id} does not share the single V1 junction endpoint.` });
      return { segments: [], diagnostics };
    }
    const start = a.position.clone();
    const end = b.position.clone();
    const delta = end.clone().sub(start);
    const length = delta.length();
    const maxRadius = Math.max(a.radius, b.radius);
    if (!Number.isFinite(length) || length < maxRadius * 1.5 || length > maxRadius * 32) {
      diagnostics.push({ code: "unsupported-segment-length", message: `Chain ${chain.id} length must be between 1.5x and 32x its maximum radius.` });
      return { segments: [], diagnostics };
    }
    const direction = delta.multiplyScalar(1 / length);
    const frame = chooseFrame(direction);
    segments.push({
      id: chain.id,
      chainIndex,
      role: chain.role,
      start,
      end,
      startRadius: a.radius,
      endRadius: b.radius,
      startAge: THREE.MathUtils.clamp(a.age ?? 0, 0, 1),
      endAge: THREE.MathUtils.clamp(b.age ?? 1, 0, 1),
      branchOrder: Math.round(a.branchOrder ?? b.branchOrder ?? (chain.role === "parent" ? 0 : 1)),
      direction,
      length,
      ...frame,
    });
  }
  const outward = segments.map((segment) => segment.role === "parent" ? segment.direction.clone().negate() : segment.direction.clone());
  for (let first = 0; first < outward.length; first++) {
    for (let second = first + 1; second < outward.length; second++) {
      const angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(outward[first]!.dot(outward[second]!), -1, 1)));
      if (angle < 25 || angle > 155) {
        diagnostics.push({ code: "unsupported-angle", message: `Branch separation ${angle.toFixed(2)} degrees is outside the proven [25, 155] degree range.` });
        return { segments: [], diagnostics };
      }
    }
  }
  const parentHubRadius = parents[0]!.samples[1].radius;
  for (const child of children) {
    const ratio = child.samples[0].radius / parentHubRadius;
    if (ratio < 0.2 || ratio > 0.9) {
      diagnostics.push({ code: "unsupported-radius-ratio", message: `Child/parent junction radius ratio ${ratio.toFixed(3)} is outside [0.2, 0.9].` });
      return { segments: [], diagnostics };
    }
  }
  return { segments, diagnostics };
};

const nearestSegmentPoint = (point: THREE.Vector3, segments: readonly ValidatedSegment[]): NearestSegmentPoint => {
  let best: NearestSegmentPoint | null = null;
  const delta = new THREE.Vector3();
  const center = new THREE.Vector3();
  for (const segment of segments) {
    delta.copy(point).sub(segment.start);
    const t = THREE.MathUtils.clamp(delta.dot(segment.direction) / segment.length, 0, 1);
    center.copy(segment.start).addScaledVector(segment.direction, t * segment.length);
    const radius = THREE.MathUtils.lerp(segment.startRadius, segment.endRadius, t);
    const value = point.distanceTo(center) - radius;
    if (!best || value < best.value || (value === best.value && segment.chainIndex < best.segment.chainIndex)) {
      best = { segment, t, center: center.clone(), radius, value };
    }
  }
  return best!;
};

const signedField = (point: THREE.Vector3, segments: readonly ValidatedSegment[]) => nearestSegmentPoint(point, segments).value;

const triangleAreaSquared = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
  b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() * 0.25;

const project2 = (point: THREE.Vector3, axis: number): [number, number] =>
  axis === 0 ? [point.y, point.z] : axis === 1 ? [point.x, point.z] : [point.x, point.y];

const orient2 = (a: readonly number[], b: readonly number[], c: readonly number[]) =>
  (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);

const pointInTriangle2 = (p: readonly number[], a: readonly number[], b: readonly number[], c: readonly number[], epsilon: number) => {
  const d1 = orient2(p, a, b);
  const d2 = orient2(p, b, c);
  const d3 = orient2(p, c, a);
  return (d1 >= -epsilon && d2 >= -epsilon && d3 >= -epsilon) || (d1 <= epsilon && d2 <= epsilon && d3 <= epsilon);
};

const segmentsIntersect2 = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], epsilon: number) => {
  const abC = orient2(a, b, c);
  const abD = orient2(a, b, d);
  const cdA = orient2(c, d, a);
  const cdB = orient2(c, d, b);
  return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon));
};

const segmentTriangleIntersection = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  epsilon: number,
) => {
  const direction = end.clone().sub(start);
  const edge1 = b.clone().sub(a);
  const edge2 = c.clone().sub(a);
  const p = direction.clone().cross(edge2);
  const determinant = edge1.dot(p);
  if (Math.abs(determinant) <= epsilon) return false;
  const inverse = 1 / determinant;
  const tvec = start.clone().sub(a);
  const u = tvec.dot(p) * inverse;
  if (u < -epsilon || u > 1 + epsilon) return false;
  const q = tvec.clone().cross(edge1);
  const v = direction.dot(q) * inverse;
  if (v < -epsilon || u + v > 1 + epsilon) return false;
  const t = edge2.dot(q) * inverse;
  return t > epsilon && t < 1 - epsilon;
};

const trianglesIntersect = (
  first: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  second: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  epsilon: number,
) => {
  const firstNormal = first[1].clone().sub(first[0]).cross(first[2].clone().sub(first[0]));
  const secondNormal = second[1].clone().sub(second[0]).cross(second[2].clone().sub(second[0]));
  const coplanar = firstNormal.clone().cross(secondNormal).lengthSq() <= epsilon * epsilon
    && Math.abs(firstNormal.dot(second[0].clone().sub(first[0]))) <= epsilon * Math.max(1, firstNormal.length());
  if (coplanar) {
    const normal = firstNormal.clone().normalize();
    const axis = Math.abs(normal.x) > Math.abs(normal.y)
      ? (Math.abs(normal.x) > Math.abs(normal.z) ? 0 : 2)
      : (Math.abs(normal.y) > Math.abs(normal.z) ? 1 : 2);
    const a = first.map((point) => project2(point, axis));
    const b = second.map((point) => project2(point, axis));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (segmentsIntersect2(a[i]!, a[(i + 1) % 3]!, b[j]!, b[(j + 1) % 3]!, epsilon)) return true;
    }
    return pointInTriangle2(a[0]!, b[0]!, b[1]!, b[2]!, epsilon)
      || pointInTriangle2(b[0]!, a[0]!, a[1]!, a[2]!, epsilon);
  }
  for (let edge = 0; edge < 3; edge++) {
    if (segmentTriangleIntersection(first[edge]!, first[(edge + 1) % 3]!, ...second, epsilon)) return true;
    if (segmentTriangleIntersection(second[edge]!, second[(edge + 1) % 3]!, ...first, epsilon)) return true;
  }
  return false;
};

/** Audit indexed topology and bounded triangle self-intersections. */
export const auditProcPlantMeshTopology = (
  geometry: THREE.BufferGeometry,
  options: ProcPlantMeshTopologyOptions = {},
): ProcPlantMeshTopologyAudit => {
  const position = geometry.getAttribute("position");
  const index = geometry.index;
  if (!position || position.itemSize !== 3 || !index) throw new Error("mesh topology audit requires indexed xyz positions");
  const triangles = index.count / 3;
  const maxTriangles = boundedInteger(options.maxTriangles, PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.triangles, PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.triangles, "mesh topology maxTriangles");
  const maxIntersectionTests = boundedInteger(options.maxIntersectionTests, 500_000, PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.topologyIntersectionTests, "mesh topology maxIntersectionTests");
  if (!Number.isInteger(triangles) || triangles > maxTriangles) throw new Error(`mesh topology triangle count exceeds maxTriangles (${maxTriangles})`);
  const positionEpsilon = options.positionEpsilon ?? 1e-7;
  const areaEpsilon = options.areaEpsilon ?? 1e-16;
  if (!finitePositive(positionEpsilon) || !finitePositive(areaEpsilon)) throw new Error("mesh topology epsilons must be finite and positive");
  const points = Array.from({ length: position.count }, (_, vertex) => {
    const point = new THREE.Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`mesh topology position ${vertex} must be finite`);
    return point;
  });
  const edgeUses = new Map<string, number[]>();
  const triangleKeys = new Set<string>();
  const triangleVertices: Array<readonly [number, number, number]> = [];
  const triangleBounds: THREE.Box3[] = [];
  let degenerateTriangles = 0;
  let duplicateTriangles = 0;
  for (let triangle = 0; triangle < triangles; triangle++) {
    const vertices = [index.getX(triangle * 3), index.getX(triangle * 3 + 1), index.getX(triangle * 3 + 2)] as [number, number, number];
    if (vertices.some((vertex) => !Number.isInteger(vertex) || vertex < 0 || vertex >= position.count)) throw new Error(`mesh topology triangle ${triangle} index is out of range`);
    triangleVertices.push(vertices);
    const sorted = [...vertices].sort((a, b) => a - b).join(":");
    if (triangleKeys.has(sorted)) duplicateTriangles++;
    else triangleKeys.add(sorted);
    if (new Set(vertices).size < 3 || triangleAreaSquared(points[vertices[0]]!, points[vertices[1]]!, points[vertices[2]]!) <= areaEpsilon) degenerateTriangles++;
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge]!;
      const b = vertices[(edge + 1) % 3]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const uses = edgeUses.get(key) ?? [];
      uses.push(a < b ? 1 : -1);
      edgeUses.set(key, uses);
    }
    triangleBounds.push(new THREE.Box3().setFromPoints(vertices.map((vertex) => points[vertex]!)));
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentWindingEdges = 0;
  for (const uses of edgeUses.values()) {
    if (uses.length === 1) boundaryEdges++;
    else if (uses.length !== 2) nonManifoldEdges++;
    else if (uses[0] === uses[1]) inconsistentWindingEdges++;
  }
  const parent = Array.from({ length: triangles }, (_, indexValue) => indexValue);
  const find = (value: number): number => parent[value] === value ? value : (parent[value] = find(parent[value]!));
  const unite = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const owners = new Map<string, number>();
  for (let triangle = 0; triangle < triangleVertices.length; triangle++) {
    const vertices = triangleVertices[triangle]!;
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge]!;
      const b = vertices[(edge + 1) % 3]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, triangle);
      else unite(owner, triangle);
    }
  }
  const componentCounts = new Map<number, number>();
  const componentBoxes = new Map<number, THREE.Box3>();
  for (let triangle = 0; triangle < triangles; triangle++) {
    const root = find(triangle);
    componentCounts.set(root, (componentCounts.get(root) ?? 0) + 1);
    const box = componentBoxes.get(root) ?? new THREE.Box3();
    box.union(triangleBounds[triangle]!);
    componentBoxes.set(root, box);
  }
  const orderedComponents = [...componentCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const componentTriangles = orderedComponents.map((entry) => entry[1]);
  const componentBounds = orderedComponents.map(([root]) => {
    const box = componentBoxes.get(root)!;
    return { min: [box.min.x, box.min.y, box.min.z] as const, max: [box.max.x, box.max.y, box.max.z] as const };
  });
  const components = componentTriangles.length;
  const order = Array.from({ length: triangles }, (_, triangle) => triangle).sort((a, b) => triangleBounds[a]!.min.x - triangleBounds[b]!.min.x || a - b);
  let selfIntersections = 0;
  const selfIntersectionPairs: Array<readonly [number, number]> = [];
  let intersectionTests = 0;
  let intersectionCheckComplete = true;
  outer: for (let firstOrder = 0; firstOrder < order.length; firstOrder++) {
    const firstIndex = order[firstOrder]!;
    const firstBounds = triangleBounds[firstIndex]!;
    const firstVertices = triangleVertices[firstIndex]!;
    for (let secondOrder = firstOrder + 1; secondOrder < order.length; secondOrder++) {
      const secondIndex = order[secondOrder]!;
      const secondBounds = triangleBounds[secondIndex]!;
      if (secondBounds.min.x > firstBounds.max.x + positionEpsilon) break;
      if (secondBounds.min.y > firstBounds.max.y + positionEpsilon || secondBounds.max.y < firstBounds.min.y - positionEpsilon
        || secondBounds.min.z > firstBounds.max.z + positionEpsilon || secondBounds.max.z < firstBounds.min.z - positionEpsilon) continue;
      const secondVertices = triangleVertices[secondIndex]!;
      if (firstVertices.some((vertex) => secondVertices.includes(vertex))) continue;
      intersectionTests++;
      if (intersectionTests > maxIntersectionTests) {
        intersectionCheckComplete = false;
        break outer;
      }
      const firstPoints = firstVertices.map((vertex) => points[vertex]!) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      const secondPoints = secondVertices.map((vertex) => points[vertex]!) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      if (trianglesIntersect(firstPoints, secondPoints, positionEpsilon)) {
        selfIntersections++;
        if (selfIntersectionPairs.length < 16) selfIntersectionPairs.push([firstIndex, secondIndex]);
      }
    }
  }
  const closedTwoManifold = triangles > 0 && components === 1 && boundaryEdges === 0 && nonManifoldEdges === 0
    && inconsistentWindingEdges === 0 && degenerateTriangles === 0 && duplicateTriangles === 0
    && selfIntersections === 0 && intersectionCheckComplete;
  return {
    contract: "procplants.mesh-topology",
    version: 1,
    vertices: position.count,
    triangles,
    components,
    componentTriangles,
    componentBounds,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentWindingEdges,
    degenerateTriangles,
    duplicateTriangles,
    selfIntersections,
    selfIntersectionPairs,
    intersectionTests,
    intersectionCheckComplete,
    closedTwoManifold,
  };
};

const CUBE_OFFSETS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
] as const;
const CUBE_TETRAHEDRA = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
] as const;

/**
 * Build a dependency-free implicit union for one bounded parent/children hub.
 * Every candidate is topology-audited before release; otherwise the exact
 * caller-owned collar geometry is returned.
 */
export const createProcPlantWatertightJunctionGeometry = (
  chains: readonly ProcPlantWatertightJunctionChain[],
  options: ProcPlantWatertightJunctionOptions = {},
  legacyGeometry: THREE.BufferGeometry | null = null,
): ProcPlantWatertightJunctionResult => {
  if (options.enabled !== true) {
    return fallback(legacyGeometry, chains.length, [{ code: "disabled", message: "Watertight junction generation is opt-in; legacy collar geometry is unchanged." }]);
  }
  const maxGridCells = boundedInteger(options.maxGridCells, 120_000, PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.gridCells, "watertight junction maxGridCells");
  const maxWorkItems = boundedInteger(options.maxWorkItems, 1_000_000, PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.workItems, "watertight junction maxWorkItems");
  const maxTriangles = boundedInteger(options.maxTriangles, 180_000, PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.triangles, "watertight junction maxTriangles");
  const maxTopologyIntersectionTests = boundedInteger(options.maxTopologyIntersectionTests, 500_000, PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.topologyIntersectionTests, "watertight junction maxTopologyIntersectionTests");
  const cellsPerMinimumRadius = options.cellsPerMinimumRadius ?? 1.75;
  if (!Number.isFinite(cellsPerMinimumRadius) || cellsPerMinimumRadius < 1.25 || cellsPerMinimumRadius > 8) {
    throw new Error("watertight junction cellsPerMinimumRadius must be in [1.25, 8]");
  }
  const validated = validateChains(chains);
  if (validated.diagnostics.length > 0) return fallback(legacyGeometry, chains.length, validated.diagnostics);
  const segments = validated.segments;
  const minimumRadius = Math.min(...segments.flatMap((segment) => [segment.startRadius, segment.endRadius]));
  const maximumRadius = Math.max(...segments.flatMap((segment) => [segment.startRadius, segment.endRadius]));
  const cellSize = minimumRadius / cellsPerMinimumRadius;
  const bounds = new THREE.Box3();
  for (const segment of segments) {
    bounds.expandByPoint(segment.start);
    bounds.expandByPoint(segment.end);
  }
  bounds.expandByScalar(maximumRadius + cellSize * 1.5);
  // A fixed irrational sub-cell phase keeps exact sample centers/radii away
  // from lattice vertices without introducing seed-dependent topology.
  const gridPhase = cellSize * 0.3819660112501051;
  bounds.min.addScalar(-gridPhase);
  bounds.max.addScalar(cellSize - gridPhase);
  const size = bounds.getSize(new THREE.Vector3());
  const grid = [Math.ceil(size.x / cellSize), Math.ceil(size.y / cellSize), Math.ceil(size.z / cellSize)] as [number, number, number];
  if (grid.some((axis) => axis < 2 || axis > PROCPLANT_WATERTIGHT_JUNCTION_HARD_CAPS.gridAxis)) {
    return fallback(legacyGeometry, chains.length, [{ code: "grid-cap-exceeded", message: `Required grid ${grid.join("x")} exceeds the per-axis cap.` }], { segments: segments.length, grid, gridCells: grid[0] * grid[1] * grid[2] });
  }
  const gridCells = grid[0] * grid[1] * grid[2];
  if (gridCells > maxGridCells) {
    return fallback(legacyGeometry, chains.length, [{ code: "grid-cap-exceeded", message: `Required ${gridCells} cells exceed maxGridCells (${maxGridCells}).` }], { segments: segments.length, grid, gridCells });
  }
  const pointCount = (grid[0] + 1) * (grid[1] + 1) * (grid[2] + 1);
  const workItems = pointCount * segments.length + gridCells * CUBE_TETRAHEDRA.length;
  if (workItems > maxWorkItems) {
    return fallback(legacyGeometry, chains.length, [{ code: "work-cap-exceeded", message: `Required ${workItems} work items exceed maxWorkItems (${maxWorkItems}).` }], { segments: segments.length, grid, gridCells, workItems });
  }
  const origin = bounds.min.clone();
  const pointIndex = (x: number, y: number, z: number) => x + (grid[0] + 1) * (y + (grid[1] + 1) * z);
  const pointPosition = (index: number) => {
    const strideX = grid[0] + 1;
    const strideY = grid[1] + 1;
    const z = Math.floor(index / (strideX * strideY));
    const remainder = index - z * strideX * strideY;
    const y = Math.floor(remainder / strideX);
    const x = remainder - y * strideX;
    return new THREE.Vector3(origin.x + x * cellSize, origin.y + y * cellSize, origin.z + z * cellSize);
  };
  const values = new Float64Array(pointCount);
  const isoBias = cellSize * 1e-6;
  for (let index = 0; index < pointCount; index++) values[index] = signedField(pointPosition(index), segments) - isoBias;
  const positions: number[] = [];
  const indices: number[] = [];
  const edgeVertices = new Map<string, number>();
  const vertexForEdge = (a: number, b: number) => {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const key = `${low}:${high}`;
    const cached = edgeVertices.get(key);
    if (cached !== undefined) return cached;
    const va = values[a]!;
    const vb = values[b]!;
    const denominator = va - vb;
    const t = THREE.MathUtils.clamp(Math.abs(denominator) < 1e-14 ? 0.5 : va / denominator, 1e-7, 1 - 1e-7);
    const point = pointPosition(a).lerp(pointPosition(b), t);
    const vertex = positions.length / 3;
    positions.push(point.x, point.y, point.z);
    edgeVertices.set(key, vertex);
    return vertex;
  };
  const pointFromVertex = (vertex: number) => new THREE.Vector3(positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!);
  const appendTriangle = (a: number, b: number, c: number) => {
    if (a === b || b === c || c === a) return;
    const pa = pointFromVertex(a);
    const pb = pointFromVertex(b);
    const pc = pointFromVertex(c);
    if (triangleAreaSquared(pa, pb, pc) <= cellSize ** 4 * 1e-16) return;
    const centroid = pa.clone().add(pb).add(pc).multiplyScalar(1 / 3);
    const h = cellSize * 0.15;
    const gradient = new THREE.Vector3(
      signedField(centroid.clone().add(new THREE.Vector3(h, 0, 0)), segments) - signedField(centroid.clone().add(new THREE.Vector3(-h, 0, 0)), segments),
      signedField(centroid.clone().add(new THREE.Vector3(0, h, 0)), segments) - signedField(centroid.clone().add(new THREE.Vector3(0, -h, 0)), segments),
      signedField(centroid.clone().add(new THREE.Vector3(0, 0, h)), segments) - signedField(centroid.clone().add(new THREE.Vector3(0, 0, -h)), segments),
    );
    const normal = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    if (normal.dot(gradient) < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };
  for (let z = 0; z < grid[2]; z++) for (let y = 0; y < grid[1]; y++) for (let x = 0; x < grid[0]; x++) {
    const cube = CUBE_OFFSETS.map(([dx, dy, dz]) => pointIndex(x + dx, y + dy, z + dz));
    for (const tetra of CUBE_TETRAHEDRA) {
      const tetraPoints = tetra.map((corner) => cube[corner]!);
      const inside = tetraPoints.filter((point) => values[point]! < 0);
      const outside = tetraPoints.filter((point) => values[point]! >= 0);
      if (inside.length === 0 || inside.length === 4) continue;
      if (inside.length === 1 || inside.length === 3) {
        const minority = inside.length === 1 ? inside : outside;
        const majority = inside.length === 1 ? outside : inside;
        const vertices = majority.map((point) => vertexForEdge(minority[0]!, point));
        appendTriangle(vertices[0]!, vertices[1]!, vertices[2]!);
      } else {
        const vertices = [
          vertexForEdge(inside[0]!, outside[0]!),
          vertexForEdge(inside[0]!, outside[1]!),
          vertexForEdge(inside[1]!, outside[1]!),
          vertexForEdge(inside[1]!, outside[0]!),
        ];
        const centroid = vertices.reduce((sum, vertex) => sum.add(pointFromVertex(vertex)), new THREE.Vector3()).multiplyScalar(0.25);
        const h = cellSize * 0.15;
        const normal = new THREE.Vector3(
          signedField(centroid.clone().add(new THREE.Vector3(h, 0, 0)), segments) - signedField(centroid.clone().add(new THREE.Vector3(-h, 0, 0)), segments),
          signedField(centroid.clone().add(new THREE.Vector3(0, h, 0)), segments) - signedField(centroid.clone().add(new THREE.Vector3(0, -h, 0)), segments),
          signedField(centroid.clone().add(new THREE.Vector3(0, 0, h)), segments) - signedField(centroid.clone().add(new THREE.Vector3(0, 0, -h)), segments),
        );
        if (normal.lengthSq() < 1e-16) normal.copy(pointFromVertex(vertices[1]!).sub(pointFromVertex(vertices[0]!)).cross(pointFromVertex(vertices[2]!).sub(pointFromVertex(vertices[0]!))));
        normal.normalize();
        const frame = chooseFrame(normal);
        vertices.sort((a, b) => {
          const offsetA = pointFromVertex(a).sub(centroid);
          const offsetB = pointFromVertex(b).sub(centroid);
          return Math.atan2(offsetA.dot(frame.up), offsetA.dot(frame.right))
            - Math.atan2(offsetB.dot(frame.up), offsetB.dot(frame.right));
        });
        appendTriangle(vertices[0]!, vertices[1]!, vertices[2]!);
        appendTriangle(vertices[0]!, vertices[2]!, vertices[3]!);
      }
      if (indices.length / 3 > maxTriangles) {
        return fallback(legacyGeometry, chains.length, [{ code: "triangle-cap-exceeded", message: `Generated triangles exceed maxTriangles (${maxTriangles}).` }], { segments: segments.length, grid, gridCells, workItems, triangles: indices.length / 3 });
      }
    }
  }
  // Tetrahedra can converge on the same isosurface point through distinct
  // lattice edges near an exact grid corner. Weld those numerically identical
  // points before auditing so topological adjacency reflects geometric
  // adjacency; the tolerance is six orders below one cell.
  const weldTolerance = cellSize * 0.005;
  const weldedPositions: number[] = [];
  const remap = new Uint32Array(positions.length / 3);
  const weldedBins = new Map<string, number[]>();
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const x = positions[vertex * 3]!;
    const y = positions[vertex * 3 + 1]!;
    const z = positions[vertex * 3 + 2]!;
    const bin = [Math.floor(x / weldTolerance), Math.floor(y / weldTolerance), Math.floor(z / weldTolerance)] as const;
    let welded: number | undefined;
    for (let dz = -1; dz <= 1 && welded === undefined; dz++) {
      for (let dy = -1; dy <= 1 && welded === undefined; dy++) {
        for (let dx = -1; dx <= 1 && welded === undefined; dx++) {
          for (const candidate of weldedBins.get(`${bin[0] + dx}:${bin[1] + dy}:${bin[2] + dz}`) ?? []) {
            const offset = candidate * 3;
            const distanceSquared = (x - weldedPositions[offset]!) ** 2
              + (y - weldedPositions[offset + 1]!) ** 2
              + (z - weldedPositions[offset + 2]!) ** 2;
            if (distanceSquared <= weldTolerance ** 2) welded = candidate;
          }
        }
      }
    }
    if (welded === undefined) {
      welded = weldedPositions.length / 3;
      weldedPositions.push(x, y, z);
      const key = `${bin[0]}:${bin[1]}:${bin[2]}`;
      const entries = weldedBins.get(key) ?? [];
      entries.push(welded);
      weldedBins.set(key, entries);
    }
    remap[vertex] = welded;
  }
  const weldedIndices: number[] = [];
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = remap[indices[triangle]!]!;
    const b = remap[indices[triangle + 1]!]!;
    const c = remap[indices[triangle + 2]!]!;
    if (a !== b && b !== c && c !== a) {
      const point = (vertex: number) => new THREE.Vector3(
        weldedPositions[vertex * 3]!,
        weldedPositions[vertex * 3 + 1]!,
        weldedPositions[vertex * 3 + 2]!,
      );
      if (triangleAreaSquared(point(a), point(b), point(c)) > cellSize ** 4 * 1e-14) weldedIndices.push(a, b, c);
    }
  }
  positions.splice(0, positions.length, ...weldedPositions);
  indices.splice(0, indices.length, ...weldedIndices);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const branchU: number[] = [];
  const branchV: number[] = [];
  const branchOrder: number[] = [];
  const branchAge: number[] = [];
  const sway: number[] = [];
  const tintable: number[] = [];
  const chainAttribute: number[] = [];
  const baseColor = new THREE.Color(options.color ?? 0x72583c);
  const barkRepeatLength = Math.max(1e-4, options.barkRepeatLength ?? 1.2);
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const point = pointFromVertex(vertex);
    const nearest = nearestSegmentPoint(point, segments);
    const radial = point.clone().sub(nearest.center);
    if (radial.lengthSq() < 1e-16) radial.copy(nearest.segment.right);
    radial.normalize();
    const v = (Math.atan2(radial.dot(nearest.segment.up), radial.dot(nearest.segment.right)) / (Math.PI * 2) + 1) % 1;
    normals.push(radial.x, radial.y, radial.z);
    uvs.push(v, nearest.t * nearest.segment.length / barkRepeatLength);
    colors.push(baseColor.r, baseColor.g, baseColor.b);
    branchU.push(nearest.t);
    branchV.push(v);
    branchOrder.push(nearest.segment.branchOrder);
    const age = THREE.MathUtils.lerp(nearest.segment.startAge, nearest.segment.endAge, nearest.t);
    branchAge.push(age);
    sway.push(age * age);
    tintable.push(0);
    chainAttribute.push(nearest.segment.chainIndex);
  }
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute(PROCPLANT_BRANCH_U_ATTRIBUTE, new THREE.Float32BufferAttribute(branchU, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_V_ATTRIBUTE, new THREE.Float32BufferAttribute(branchV, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_ORDER_ATTRIBUTE, new THREE.Float32BufferAttribute(branchOrder, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_AGE_ATTRIBUTE, new THREE.Float32BufferAttribute(branchAge, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_SWAY_ATTRIBUTE, new THREE.Float32BufferAttribute(sway, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_TINTABLE_ATTRIBUTE, new THREE.Uint8BufferAttribute(tintable, 1));
  geometry.setAttribute(PROCPLANT_JUNCTION_CHAIN_ATTRIBUTE, new THREE.Uint8BufferAttribute(chainAttribute, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const topology = auditProcPlantMeshTopology(geometry, {
    maxTriangles,
    maxIntersectionTests: maxTopologyIntersectionTests,
    positionEpsilon: cellSize * 1e-6,
    areaEpsilon: cellSize ** 4 * 1e-14,
  });
  if (!topology.closedTwoManifold) {
    geometry.dispose();
    return {
      ...fallback(legacyGeometry, chains.length, [{ code: "topology-validation-failed", message: "Candidate implicit union failed closed-manifold or bounded self-intersection validation." }], { segments: segments.length, grid, gridCells, workItems, triangles: indices.length / 3 }),
      audit: {
        ...fallback(legacyGeometry, chains.length, [], { segments: segments.length, grid, gridCells, workItems, triangles: indices.length / 3 }).audit,
        mode: "fallback-collar",
        topology,
        diagnostics: [{ code: "topology-validation-failed", message: "Candidate implicit union failed closed-manifold or bounded self-intersection validation." }],
      },
    };
  }
  geometry.userData.procplantWatertightJunction = {
    contract: PROCPLANT_WATERTIGHT_JUNCTION_CONTRACT,
    version: PROCPLANT_WATERTIGHT_JUNCTION_VERSION,
    chains: chains.map((chain) => chain.id),
    grid,
    triangles: indices.length / 3,
  };
  return {
    geometry,
    audit: {
      contract: PROCPLANT_WATERTIGHT_JUNCTION_CONTRACT,
      version: PROCPLANT_WATERTIGHT_JUNCTION_VERSION,
      mode: "watertight",
      sourceGeometryReused: false,
      chains: chains.length,
      segments: segments.length,
      grid,
      gridCells,
      workItems,
      triangles: indices.length / 3,
      topology,
      diagnostics: [],
    },
  };
};
