export const PROCPLANT_VISIBILITY_CLUSTER_CONTRACT = "procplant.visibility-clusters" as const;
export const PROCPLANT_VISIBILITY_CLUSTER_VERSION = 1 as const;

export interface ProcPlantPackedInstanceBoundsSource {
  /** XYZ centers, tightly packed. */
  centers: ArrayLike<number>;
  /** Optional bounding-sphere radii. Omitted radii are zero. */
  radii?: ArrayLike<number>;
}

export interface ProcPlantVisibilityClusterOptions {
  cellSize?: number;
  maxInstancesPerCluster?: number;
  maxInstances?: number;
  origin?: readonly [number, number, number];
}

/** Renderer-independent, storage-buffer-ready visibility data. Treat arrays as immutable. */
export interface ProcPlantVisibilityClusterSet {
  readonly contract: typeof PROCPLANT_VISIBILITY_CLUSTER_CONTRACT;
  readonly version: typeof PROCPLANT_VISIBILITY_CLUSTER_VERSION;
  readonly contentHash: string;
  readonly instanceCount: number;
  readonly clusterCount: number;
  readonly cellSize: number;
  readonly maxInstancesPerCluster: number;
  readonly origin: Float32Array;
  /** vec4(center.xyz, radius), indexed by original instance ID. */
  readonly instanceBounds: Float32Array;
  /** vec4(center.xyz, conservative radius), indexed by cluster ID. */
  readonly clusterBounds: Float32Array;
  /** ivec3 cell coordinate, indexed by cluster ID. */
  readonly clusterCells: Int32Array;
  /** Original instance IDs grouped by cluster. */
  readonly clusterInstanceIndices: Uint32Array;
  /** Start offsets into clusterInstanceIndices; length is clusterCount + 1. */
  readonly clusterOffsets: Uint32Array;
  readonly byteLength: number;
}

export type ProcPlantClipSpace = "negative-one-to-one" | "zero-to-one";

export interface ProcPlantVisibilityView {
  /** Six normalized vec4 planes ordered left, right, bottom, top, near, far. */
  readonly planes: Float32Array;
  readonly cameraPosition: Float32Array;
  readonly maxDistance: number;
}

export interface ProcPlantVisibilitySelection {
  visibleClusterCount: number;
  candidateInstanceCount: number;
  visibleInstanceCount: number;
  rejectedClusterCount: number;
  rejectedClusterInstances: number;
  maskedCandidateCount: number;
  frustumCulledCandidateCount: number;
  distanceCulledCandidateCount: number;
  /** Valid prefix is visibleClusterCount. */
  readonly visibleClusterIndices: Uint32Array;
  /** Valid prefix is visibleInstanceCount, in deterministic cluster order. */
  readonly visibleInstanceIndices: Uint32Array;
  /** Original-instance-indexed LOD, or -1 when not visible. */
  readonly instanceLods: Int16Array;
  readonly lodCounts: Uint32Array;
  /** Prefix sums into lodInstanceIndices; length is lodCounts.length + 1. */
  readonly lodOffsets: Uint32Array;
  /** Valid prefix is visibleInstanceCount, compacted by LOD then cluster order. */
  readonly lodInstanceIndices: Uint32Array;
}

const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};

const positive = (value: number, label: string) => {
  finite(value, label);
  if (value <= 0) throw new Error(`${label} must be positive`);
  return value;
};

const FLOAT32_SCRATCH = new DataView(new ArrayBuffer(4));

const finiteFloat32 = (value: number, label: string) => {
  const rounded = Math.fround(finite(value, label));
  if (!Number.isFinite(rounded)) throw new Error(`${label} exceeds float32 capacity`);
  return rounded;
};

const nextUpFloat32 = (value: number) => {
  const rounded = Math.fround(value);
  if (!Number.isFinite(rounded)) throw new Error("visibility radius exceeds float32 capacity");
  if (rounded >= value) return rounded;
  FLOAT32_SCRATCH.setFloat32(0, rounded, true);
  FLOAT32_SCRATCH.setUint32(0, FLOAT32_SCRATCH.getUint32(0, true) + 1, true);
  return FLOAT32_SCRATCH.getFloat32(0, true);
};

const hashVisibilitySet = (arrays: readonly ArrayBufferView[], numbers: readonly number[]) => {
  let hash = 0x811c9dc5;
  const byte = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const character of `${PROCPLANT_VISIBILITY_CLUSTER_CONTRACT}:${PROCPLANT_VISIBILITY_CLUSTER_VERSION}`) {
    const code = character.charCodeAt(0);
    byte(code & 255);
    byte(code >>> 8);
  }
  const scratch = new DataView(new ArrayBuffer(8));
  for (const value of numbers) {
    scratch.setFloat64(0, value, true);
    for (let index = 0; index < 8; index++) byte(scratch.getUint8(index));
  }
  for (const array of arrays) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const value of bytes) byte(value);
  }
  return hash.toString(16).padStart(8, "0");
};

interface CellBucket {
  x: number;
  y: number;
  z: number;
  indices: number[];
}

export const buildProcPlantVisibilityClusters = (
  source: ProcPlantPackedInstanceBoundsSource,
  options: ProcPlantVisibilityClusterOptions = {},
): ProcPlantVisibilityClusterSet => {
  if (!Number.isInteger(source.centers.length) || source.centers.length % 3 !== 0) {
    throw new Error("visibility centers must contain complete xyz tuples");
  }
  const instanceCount = source.centers.length / 3;
  if (instanceCount > 0xffffffff) throw new Error("visibility instance count exceeds uint32 capacity");
  const maxInstances = options.maxInstances ?? 10_000_000;
  if (!Number.isInteger(maxInstances) || maxInstances < 1 || maxInstances > 100_000_000) {
    throw new Error("visibility maxInstances must be an integer in [1, 100000000]");
  }
  if (instanceCount > maxInstances) throw new Error(`visibility instance count exceeds maxInstances (${instanceCount} > ${maxInstances})`);
  if (source.radii && source.radii.length !== instanceCount) {
    throw new Error("visibility radii must match the instance count");
  }
  const cellSize = finiteFloat32(positive(options.cellSize ?? 32, "visibility cellSize"), "visibility cellSize");
  const maxInstancesPerCluster = options.maxInstancesPerCluster ?? 256;
  if (!Number.isInteger(maxInstancesPerCluster) || maxInstancesPerCluster < 1 || maxInstancesPerCluster > 65535) {
    throw new Error("visibility maxInstancesPerCluster must be an integer in [1, 65535]");
  }
  const originValues = options.origin ?? [0, 0, 0];
  const origin = new Float32Array([
    finiteFloat32(originValues[0], "visibility origin.x"),
    finiteFloat32(originValues[1], "visibility origin.y"),
    finiteFloat32(originValues[2], "visibility origin.z"),
  ]);
  const instanceBounds = new Float32Array(instanceCount * 4);
  const buckets = new Map<string, CellBucket>();
  for (let instance = 0; instance < instanceCount; instance++) {
    const sourceOffset = instance * 3;
    const x = finiteFloat32(Number(source.centers[sourceOffset]), `visibility center ${instance}.x`);
    const y = finiteFloat32(Number(source.centers[sourceOffset + 1]), `visibility center ${instance}.y`);
    const z = finiteFloat32(Number(source.centers[sourceOffset + 2]), `visibility center ${instance}.z`);
    const radiusValue = finite(Number(source.radii?.[instance] ?? 0), `visibility radius ${instance}`);
    if (radiusValue < 0) throw new Error(`visibility radius ${instance} must be non-negative`);
    const radius = nextUpFloat32(radiusValue);
    const boundOffset = instance * 4;
    instanceBounds[boundOffset] = x;
    instanceBounds[boundOffset + 1] = y;
    instanceBounds[boundOffset + 2] = z;
    instanceBounds[boundOffset + 3] = radius;
    const cellX = Math.floor((x - origin[0]!) / cellSize);
    const cellY = Math.floor((y - origin[1]!) / cellSize);
    const cellZ = Math.floor((z - origin[2]!) / cellSize);
    if (cellX < -0x80000000 || cellX > 0x7fffffff || cellY < -0x80000000 || cellY > 0x7fffffff || cellZ < -0x80000000 || cellZ > 0x7fffffff) {
      throw new Error(`visibility cell coordinate exceeds int32 capacity at instance ${instance}`);
    }
    const key = `${cellX},${cellY},${cellZ}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.indices.push(instance);
    else buckets.set(key, { x: cellX, y: cellY, z: cellZ, indices: [instance] });
  }
  const cells = [...buckets.values()].sort((left, right) => left.x - right.x || left.y - right.y || left.z - right.z);
  const clusterCount = cells.reduce((sum, cell) => sum + Math.ceil(cell.indices.length / maxInstancesPerCluster), 0);
  const clusterBounds = new Float32Array(clusterCount * 4);
  const clusterCells = new Int32Array(clusterCount * 3);
  const clusterInstanceIndices = new Uint32Array(instanceCount);
  const clusterOffsets = new Uint32Array(clusterCount + 1);
  let cluster = 0;
  let cursor = 0;
  for (const cell of cells) {
    for (let start = 0; start < cell.indices.length; start += maxInstancesPerCluster) {
      const end = Math.min(start + maxInstancesPerCluster, cell.indices.length);
      clusterOffsets[cluster] = cursor;
      const cellOffset = cluster * 3;
      clusterCells[cellOffset] = cell.x;
      clusterCells[cellOffset + 1] = cell.y;
      clusterCells[cellOffset + 2] = cell.z;
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (let local = start; local < end; local++) {
        const instance = cell.indices[local]!;
        clusterInstanceIndices[cursor++] = instance;
        const offset = instance * 4;
        const x = instanceBounds[offset]!;
        const y = instanceBounds[offset + 1]!;
        const z = instanceBounds[offset + 2]!;
        const radius = instanceBounds[offset + 3]!;
        minX = Math.min(minX, x - radius);
        minY = Math.min(minY, y - radius);
        minZ = Math.min(minZ, z - radius);
        maxX = Math.max(maxX, x + radius);
        maxY = Math.max(maxY, y + radius);
        maxZ = Math.max(maxZ, z + radius);
      }
      const exactX = (minX + maxX) * 0.5;
      const exactY = (minY + maxY) * 0.5;
      const exactZ = (minZ + maxZ) * 0.5;
      const centerX = Math.fround(exactX);
      const centerY = Math.fround(exactY);
      const centerZ = Math.fround(exactZ);
      const halfX = (maxX - minX) * 0.5;
      const halfY = (maxY - minY) * 0.5;
      const halfZ = (maxZ - minZ) * 0.5;
      const centerError = Math.hypot(centerX - exactX, centerY - exactY, centerZ - exactZ);
      const radius = nextUpFloat32(Math.hypot(halfX, halfY, halfZ) + centerError);
      const clusterOffset = cluster * 4;
      clusterBounds[clusterOffset] = centerX;
      clusterBounds[clusterOffset + 1] = centerY;
      clusterBounds[clusterOffset + 2] = centerZ;
      clusterBounds[clusterOffset + 3] = radius;
      cluster++;
    }
  }
  clusterOffsets[clusterCount] = cursor;
  const arrays = [origin, instanceBounds, clusterBounds, clusterCells, clusterInstanceIndices, clusterOffsets] as const;
  const contentHash = hashVisibilitySet(arrays, [instanceCount, clusterCount, cellSize, maxInstancesPerCluster]);
  return Object.freeze({
    contract: PROCPLANT_VISIBILITY_CLUSTER_CONTRACT,
    version: PROCPLANT_VISIBILITY_CLUSTER_VERSION,
    contentHash,
    instanceCount,
    clusterCount,
    cellSize,
    maxInstancesPerCluster,
    origin,
    instanceBounds,
    clusterBounds,
    clusterCells,
    clusterInstanceIndices,
    clusterOffsets,
    byteLength: arrays.reduce((sum, array) => sum + array.byteLength, 0),
  });
};

export const createProcPlantVisibilityView = (
  planes: ArrayLike<number>,
  cameraPosition: ArrayLike<number>,
  maxDistance = Infinity,
): ProcPlantVisibilityView => {
  if (planes.length !== 24) throw new Error("visibility view requires exactly six vec4 planes");
  if (cameraPosition.length !== 3) throw new Error("visibility cameraPosition must be xyz");
  if (Number.isNaN(maxDistance) || maxDistance < 0) throw new Error("visibility maxDistance must be non-negative");
  const resolvedMaxDistance = maxDistance === Infinity
    ? Infinity
    : finiteFloat32(maxDistance, "visibility maxDistance");
  const normalized = new Float32Array(24);
  for (let plane = 0; plane < 6; plane++) {
    const offset = plane * 4;
    const x = finite(Number(planes[offset]), `visibility plane ${plane}.x`);
    const y = finite(Number(planes[offset + 1]), `visibility plane ${plane}.y`);
    const z = finite(Number(planes[offset + 2]), `visibility plane ${plane}.z`);
    const d = finite(Number(planes[offset + 3]), `visibility plane ${plane}.d`);
    const length = Math.hypot(x, y, z);
    if (length <= 1e-20) throw new Error(`visibility plane ${plane} has a zero normal`);
    normalized[offset] = finiteFloat32(x / length, `visibility normalized plane ${plane}.x`);
    normalized[offset + 1] = finiteFloat32(y / length, `visibility normalized plane ${plane}.y`);
    normalized[offset + 2] = finiteFloat32(z / length, `visibility normalized plane ${plane}.z`);
    normalized[offset + 3] = finiteFloat32(d / length, `visibility normalized plane ${plane}.d`);
  }
  const camera = new Float32Array([
    finiteFloat32(Number(cameraPosition[0]), "visibility cameraPosition.x"),
    finiteFloat32(Number(cameraPosition[1]), "visibility cameraPosition.y"),
    finiteFloat32(Number(cameraPosition[2]), "visibility cameraPosition.z"),
  ]);
  return Object.freeze({ planes: normalized, cameraPosition: camera, maxDistance: resolvedMaxDistance });
};

export const createProcPlantVisibilityViewFromMatrix = (
  viewProjection: ArrayLike<number>,
  cameraPosition: ArrayLike<number>,
  options: { clipSpace?: ProcPlantClipSpace; maxDistance?: number } = {},
) => {
  if (viewProjection.length !== 16) throw new Error("visibility viewProjection must be a column-major mat4");
  const clipSpace = options.clipSpace ?? "negative-one-to-one";
  if (clipSpace !== "negative-one-to-one" && clipSpace !== "zero-to-one") {
    throw new Error("visibility clipSpace must be negative-one-to-one or zero-to-one");
  }
  const m = Array.from({ length: 16 }, (_, index) => finite(Number(viewProjection[index]), `visibility matrix ${index}`));
  const planes = new Float64Array(24);
  const write = (plane: number, a: number, b: number, c: number, d: number) => planes.set([a, b, c, d], plane * 4);
  write(0, m[3]! + m[0]!, m[7]! + m[4]!, m[11]! + m[8]!, m[15]! + m[12]!);
  write(1, m[3]! - m[0]!, m[7]! - m[4]!, m[11]! - m[8]!, m[15]! - m[12]!);
  write(2, m[3]! + m[1]!, m[7]! + m[5]!, m[11]! + m[9]!, m[15]! + m[13]!);
  write(3, m[3]! - m[1]!, m[7]! - m[5]!, m[11]! - m[9]!, m[15]! - m[13]!);
  if (clipSpace === "zero-to-one") {
    write(4, m[2]!, m[6]!, m[10]!, m[14]!);
  } else {
    write(4, m[3]! + m[2]!, m[7]! + m[6]!, m[11]! + m[10]!, m[15]! + m[14]!);
  }
  write(5, m[3]! - m[2]!, m[7]! - m[6]!, m[11]! - m[10]!, m[15]! - m[14]!);
  return createProcPlantVisibilityView(planes, cameraPosition, options.maxDistance);
};

const sphereVisible = (planes: Float32Array, x: number, y: number, z: number, radius: number) => {
  for (let plane = 0; plane < 6; plane++) {
    const offset = plane * 4;
    if (planes[offset]! * x + planes[offset + 1]! * y + planes[offset + 2]! * z + planes[offset + 3]! < -radius) return false;
  }
  return true;
};

/** Allocation-stable CPU reference for WebGL workers or WebGPU compute parity tests. */
export class ProcPlantVisibilitySelector {
  readonly result: ProcPlantVisibilitySelection;
  readonly lodDistances: Float32Array;
  private readonly lodWriteOffsets: Uint32Array;

  constructor(readonly clusters: ProcPlantVisibilityClusterSet, lodDistances: ArrayLike<number>) {
    if (lodDistances.length < 1 || lodDistances.length > 32) throw new Error("visibility selector requires 1-32 LOD distances");
    this.lodDistances = new Float32Array(lodDistances.length);
    for (let level = 0; level < lodDistances.length; level++) {
      const distance = finiteFloat32(Number(lodDistances[level]), `visibility LOD distance ${level}`);
      if (distance < 0 || (level === 0 && distance !== 0) || (level > 0 && distance <= this.lodDistances[level - 1]!)) {
        throw new Error("visibility LOD distances must start at zero and strictly increase");
      }
      this.lodDistances[level] = distance;
    }
    this.lodWriteOffsets = new Uint32Array(lodDistances.length);
    this.result = {
      visibleClusterCount: 0,
      candidateInstanceCount: 0,
      visibleInstanceCount: 0,
      rejectedClusterCount: 0,
      rejectedClusterInstances: 0,
      maskedCandidateCount: 0,
      frustumCulledCandidateCount: 0,
      distanceCulledCandidateCount: 0,
      visibleClusterIndices: new Uint32Array(clusters.clusterCount),
      visibleInstanceIndices: new Uint32Array(clusters.instanceCount),
      instanceLods: new Int16Array(clusters.instanceCount),
      lodCounts: new Uint32Array(lodDistances.length),
      lodOffsets: new Uint32Array(lodDistances.length + 1),
      lodInstanceIndices: new Uint32Array(clusters.instanceCount),
    };
  }

  select(view: ProcPlantVisibilityView, visibilityMask?: ArrayLike<number> | null): ProcPlantVisibilitySelection {
    if (visibilityMask && visibilityMask.length !== this.clusters.instanceCount) {
      throw new Error("visibility mask length must match the instance count");
    }
    const result = this.result;
    result.visibleClusterCount = 0;
    result.candidateInstanceCount = 0;
    result.visibleInstanceCount = 0;
    result.rejectedClusterCount = 0;
    result.rejectedClusterInstances = 0;
    result.maskedCandidateCount = 0;
    result.frustumCulledCandidateCount = 0;
    result.distanceCulledCandidateCount = 0;
    result.instanceLods.fill(-1);
    result.lodCounts.fill(0);
    const cameraX = view.cameraPosition[0]!;
    const cameraY = view.cameraPosition[1]!;
    const cameraZ = view.cameraPosition[2]!;
    for (let cluster = 0; cluster < this.clusters.clusterCount; cluster++) {
      const boundOffset = cluster * 4;
      const x = this.clusters.clusterBounds[boundOffset]!;
      const y = this.clusters.clusterBounds[boundOffset + 1]!;
      const z = this.clusters.clusterBounds[boundOffset + 2]!;
      const radius = this.clusters.clusterBounds[boundOffset + 3]!;
      const outsideFrustum = !sphereVisible(view.planes, x, y, z, radius);
      const distance = Math.max(0, Math.hypot(x - cameraX, y - cameraY, z - cameraZ) - radius);
      const outsideDistance = distance > view.maxDistance;
      const start = this.clusters.clusterOffsets[cluster]!;
      const end = this.clusters.clusterOffsets[cluster + 1]!;
      if (outsideFrustum || outsideDistance) {
        result.rejectedClusterCount++;
        result.rejectedClusterInstances += end - start;
        continue;
      }
      result.visibleClusterIndices[result.visibleClusterCount++] = cluster;
      result.candidateInstanceCount += end - start;
      for (let cursor = start; cursor < end; cursor++) {
        const instance = this.clusters.clusterInstanceIndices[cursor]!;
        if (visibilityMask && Number(visibilityMask[instance]) === 0) {
          result.maskedCandidateCount++;
          continue;
        }
        const instanceOffset = instance * 4;
        const instanceX = this.clusters.instanceBounds[instanceOffset]!;
        const instanceY = this.clusters.instanceBounds[instanceOffset + 1]!;
        const instanceZ = this.clusters.instanceBounds[instanceOffset + 2]!;
        const instanceRadius = this.clusters.instanceBounds[instanceOffset + 3]!;
        if (!sphereVisible(view.planes, instanceX, instanceY, instanceZ, instanceRadius)) {
          result.frustumCulledCandidateCount++;
          continue;
        }
        const instanceDistance = Math.max(0, Math.hypot(instanceX - cameraX, instanceY - cameraY, instanceZ - cameraZ) - instanceRadius);
        if (instanceDistance > view.maxDistance) {
          result.distanceCulledCandidateCount++;
          continue;
        }
        let lod = 0;
        while (lod + 1 < this.lodDistances.length && instanceDistance >= this.lodDistances[lod + 1]!) lod++;
        result.visibleInstanceIndices[result.visibleInstanceCount++] = instance;
        result.instanceLods[instance] = lod;
        result.lodCounts[lod]++;
      }
    }
    result.lodOffsets[0] = 0;
    for (let level = 0; level < result.lodCounts.length; level++) {
      result.lodOffsets[level + 1] = result.lodOffsets[level]! + result.lodCounts[level]!;
      this.lodWriteOffsets[level] = result.lodOffsets[level]!;
    }
    for (let visible = 0; visible < result.visibleInstanceCount; visible++) {
      const instance = result.visibleInstanceIndices[visible]!;
      const lod = result.instanceLods[instance]!;
      result.lodInstanceIndices[this.lodWriteOffsets[lod]!] = instance;
      this.lodWriteOffsets[lod]++;
    }
    return result;
  }
}

export const createProcPlantVisibilitySelector = (
  clusters: ProcPlantVisibilityClusterSet,
  lodDistances: ArrayLike<number>,
) => new ProcPlantVisibilitySelector(clusters, lodDistances);
