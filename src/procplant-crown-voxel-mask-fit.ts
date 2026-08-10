import {
  PROCPLANT_FREEFORM_CROWN_CONTRACT,
  PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
  PROCPLANT_FREEFORM_CROWN_VERSION,
  validateProcPlantFreeformCrown,
  type ProcPlantFreeformCrown,
  type ProcPlantFreeformCrownV1,
  type ProcPlantFreeformCrownV2,
} from "./procplant-space-colonization";

export const PROCPLANT_CROWN_VOXEL_MASK_FIT_CONTRACT = "procplants.crown-voxel-mask-fit" as const;
export const PROCPLANT_CROWN_VOXEL_MASK_FIT_VERSION = 1 as const;
export const PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION = 64 as const;
export const PROCPLANT_CROWN_VOXEL_MASK_MAX_VOXELS = 262_144 as const;
export const PROCPLANT_CROWN_VOXEL_MASK_MAX_COMPONENTS = 16 as const;
export const PROCPLANT_CROWN_VOXEL_MASK_MAX_CONTOURS = 128 as const;
export const PROCPLANT_CROWN_VOXEL_MASK_MAX_LOBES = 16 as const;
export const PROCPLANT_CROWN_VOXEL_MASK_MAX_WORK_UNITS = 4_000_000 as const;

export interface ProcPlantCrownVoxelMask {
  /** X-, Y-, and Z-axis voxel counts. Occupancy is x-fastest, then z, then y. */
  dimensions: readonly [number, number, number];
  /** Integer bytes. Values strictly above the fit threshold are occupied. */
  occupancy: ArrayLike<number>;
}

export interface ProcPlantCrownVoxelMaskFitOptions {
  /** World-space center of the complete voxel grid. */
  center: readonly [number, number, number];
  /** Explicit world-space size of one voxel on each axis. */
  voxelSize: readonly [number, number, number];
  threshold?: number;
  /** Maximum number of vertical fit bands. */
  lobes?: number;
  /** Spline mode is intentionally limited to masks with one contour per occupied Y slice. */
  constraint?: "lobes" | "spline";
}

export interface ProcPlantCrownVoxelFitLobe {
  id: string;
  voxelBounds: {
    minimum: readonly [number, number, number];
    maximum: readonly [number, number, number];
  };
  center: readonly [number, number, number];
  radii: readonly [number, number, number];
  occupiedVoxels: number;
  fillRatio: number;
}

export interface ProcPlantCrownVoxelMaskFitResult {
  contract: typeof PROCPLANT_CROWN_VOXEL_MASK_FIT_CONTRACT;
  version: typeof PROCPLANT_CROWN_VOXEL_MASK_FIT_VERSION;
  source: {
    dimensions: readonly [number, number, number];
    center: readonly [number, number, number];
    voxelSize: readonly [number, number, number];
    threshold: number;
    foregroundVoxels: number;
    occupiedBounds: {
      minimum: readonly [number, number, number];
      maximum: readonly [number, number, number];
    };
    /** Stable FNV-1a hash of the thresholded voxels and explicit fit inputs. */
    hash: string;
  };
  audit: {
    connectedComponents: number;
    cavityComponents: number;
    sliceContours: number;
    maximumSliceContours: number;
    workUnits: number;
    lobeCount: number;
    constraint: "lobes" | "spline";
    ordering: "x-fastest-then-z-then-y";
  };
  lobes: ProcPlantCrownVoxelFitLobe[];
  /** Directly consumable by the existing constructive space-colonization crown path. */
  crown: ProcPlantFreeformCrown;
}

interface VoxelAnalysis {
  solid: Uint8Array;
  foregroundVoxels: number;
  minimum: [number, number, number];
  maximum: [number, number, number];
  connectedComponents: number;
  cavityComponents: number;
  sliceContours: number;
  maximumSliceContours: number;
  workUnits: number;
}

const validateInteger = (value: number, minimum: number, maximum: number, label: string) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
};

const validateVector = (
  value: unknown,
  label: string,
  predicate: (component: number) => boolean,
): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((component) => Number.isFinite(component) && predicate(component))) {
    throw new Error(`${label} must contain three finite values within spatial limits`);
  }
  return [value[0]!, value[1]!, value[2]!];
};

const numberBytes = (value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return bytes;
};

const fnv1a = (values: Iterable<number>) => {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const analyzeVoxels = (
  mask: ProcPlantCrownVoxelMask,
  dimensions: readonly [number, number, number],
  thresholdByte: number,
): VoxelAnalysis => {
  const [width, height, depth] = dimensions;
  const voxelCount = width * height * depth;
  const solid = new Uint8Array(voxelCount);
  let foregroundVoxels = 0;
  const minimum: [number, number, number] = [width, height, depth];
  const maximum: [number, number, number] = [-1, -1, -1];
  let workUnits = 0;
  const bumpWork = () => {
    workUnits++;
    if (workUnits > PROCPLANT_CROWN_VOXEL_MASK_MAX_WORK_UNITS) {
      throw new Error("crown voxel-mask fit exceeds the work cap");
    }
  };
  const indexOf = (x: number, y: number, z: number) => x + width * (z + depth * y);
  const coordinatesOf = (index: number): [number, number, number] => {
    const x = index % width;
    const yz = Math.floor(index / width);
    const z = yz % depth;
    const y = Math.floor(yz / depth);
    return [x, y, z];
  };

  for (let index = 0; index < voxelCount; index++) {
    const occupancy = Number(mask.occupancy[index]);
    bumpWork();
    if (!Number.isInteger(occupancy) || occupancy < 0 || occupancy > 255) {
      throw new Error(`crown voxel-mask occupancy ${index} must be an integer byte`);
    }
    if (occupancy <= thresholdByte) continue;
    solid[index] = 1;
    foregroundVoxels++;
    const [x, y, z] = coordinatesOf(index);
    minimum[0] = Math.min(minimum[0], x);
    minimum[1] = Math.min(minimum[1], y);
    minimum[2] = Math.min(minimum[2], z);
    maximum[0] = Math.max(maximum[0], x);
    maximum[1] = Math.max(maximum[1], y);
    maximum[2] = Math.max(maximum[2], z);
  }
  if (foregroundVoxels === 0) throw new Error("crown voxel-mask contains no occupied voxels above the threshold");

  const queue = new Int32Array(voxelCount);
  const forEachNeighbor = (index: number, visit: (candidate: number) => void) => {
    const [x, y, z] = coordinatesOf(index);
    if (x > 0) visit(index - 1);
    if (x + 1 < width) visit(index + 1);
    if (z > 0) visit(index - width);
    if (z + 1 < depth) visit(index + width);
    if (y > 0) visit(index - width * depth);
    if (y + 1 < height) visit(index + width * depth);
  };
  const flood = (start: number, target: 0 | 1, visited: Uint8Array) => {
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      bumpWork();
      forEachNeighbor(index, (candidate) => {
        if (visited[candidate] === 0 && solid[candidate] === target) {
          visited[candidate] = 1;
          queue[tail++] = candidate;
        }
      });
    }
  };

  const occupiedVisited = new Uint8Array(voxelCount);
  let connectedComponents = 0;
  for (let index = 0; index < voxelCount; index++) {
    if (solid[index] === 0 || occupiedVisited[index] !== 0) continue;
    connectedComponents++;
    if (connectedComponents > PROCPLANT_CROWN_VOXEL_MASK_MAX_COMPONENTS) {
      throw new Error("crown voxel-mask exceeds the connected-component cap");
    }
    flood(index, 1, occupiedVisited);
  }
  if (connectedComponents !== 1) {
    throw new Error(`crown voxel-mask is disconnected: expected one component, received ${connectedComponents}`);
  }

  const emptyVisited = new Uint8Array(voxelCount);
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        if (x !== 0 && x !== width - 1 && y !== 0 && y !== height - 1 && z !== 0 && z !== depth - 1) continue;
        const index = indexOf(x, y, z);
        if (solid[index] === 0 && emptyVisited[index] === 0) flood(index, 0, emptyVisited);
      }
    }
  }
  let cavityComponents = 0;
  for (let index = 0; index < voxelCount; index++) {
    if (solid[index] !== 0 || emptyVisited[index] !== 0) continue;
    cavityComponents++;
    if (cavityComponents > PROCPLANT_CROWN_VOXEL_MASK_MAX_COMPONENTS) {
      throw new Error("crown voxel-mask exceeds the cavity-component cap");
    }
    flood(index, 0, emptyVisited);
  }
  if (cavityComponents > 0) {
    throw new Error(`crown voxel-mask is holed: filled volume required, received ${cavityComponents} enclosed cavity component${cavityComponents === 1 ? "" : "s"}`);
  }

  let sliceContours = 0;
  let maximumSliceContours = 0;
  const sliceVisited = new Uint8Array(width * depth);
  const sliceQueue = new Int32Array(width * depth);
  for (let y = minimum[1]; y <= maximum[1]; y++) {
    sliceVisited.fill(0);
    let contours = 0;
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const sliceIndex = x + width * z;
        if (sliceVisited[sliceIndex] !== 0 || solid[indexOf(x, y, z)] === 0) continue;
        contours++;
        sliceContours++;
        if (sliceContours > PROCPLANT_CROWN_VOXEL_MASK_MAX_CONTOURS) {
          throw new Error("crown voxel-mask exceeds the slice-contour cap");
        }
        let head = 0;
        let tail = 0;
        sliceQueue[tail++] = sliceIndex;
        sliceVisited[sliceIndex] = 1;
        while (head < tail) {
          const current = sliceQueue[head++]!;
          bumpWork();
          const currentX = current % width;
          const currentZ = Math.floor(current / width);
          const visit = (candidateX: number, candidateZ: number) => {
            const candidate = candidateX + width * candidateZ;
            if (sliceVisited[candidate] === 0 && solid[indexOf(candidateX, y, candidateZ)] === 1) {
              sliceVisited[candidate] = 1;
              sliceQueue[tail++] = candidate;
            }
          };
          if (currentX > 0) visit(currentX - 1, currentZ);
          if (currentX + 1 < width) visit(currentX + 1, currentZ);
          if (currentZ > 0) visit(currentX, currentZ - 1);
          if (currentZ + 1 < depth) visit(currentX, currentZ + 1);
        }
      }
    }
    maximumSliceContours = Math.max(maximumSliceContours, contours);
  }

  return {
    solid,
    foregroundVoxels,
    minimum,
    maximum,
    connectedComponents,
    cavityComponents,
    sliceContours,
    maximumSliceContours,
    workUnits,
  };
};

const fitLobes = (
  analysis: VoxelAnalysis,
  dimensions: readonly [number, number, number],
  center: readonly [number, number, number],
  voxelSize: readonly [number, number, number],
  requestedLobes: number,
) => {
  const [width, , depth] = dimensions;
  const occupiedHeight = analysis.maximum[1] - analysis.minimum[1] + 1;
  const lobeCount = Math.min(requestedLobes, occupiedHeight);
  const lobes: ProcPlantCrownVoxelFitLobe[] = [];
  let workUnits = 0;
  const indexOf = (x: number, y: number, z: number) => x + width * (z + depth * y);
  for (let lobeIndex = 0; lobeIndex < lobeCount; lobeIndex++) {
    const yStart = analysis.minimum[1] + Math.floor(lobeIndex * occupiedHeight / lobeCount);
    const yEnd = analysis.minimum[1] + Math.floor((lobeIndex + 1) * occupiedHeight / lobeCount) - 1;
    const minimum: [number, number, number] = [width, yStart, depth];
    const maximum: [number, number, number] = [-1, yEnd, -1];
    let occupiedVoxels = 0;
    for (let y = yStart; y <= yEnd; y++) {
      for (let z = analysis.minimum[2]; z <= analysis.maximum[2]; z++) {
        for (let x = analysis.minimum[0]; x <= analysis.maximum[0]; x++) {
          workUnits++;
          if (analysis.workUnits + workUnits > PROCPLANT_CROWN_VOXEL_MASK_MAX_WORK_UNITS) {
            throw new Error("crown voxel-mask fit exceeds the work cap");
          }
          if (analysis.solid[indexOf(x, y, z)] === 0) continue;
          occupiedVoxels++;
          minimum[0] = Math.min(minimum[0], x);
          minimum[2] = Math.min(minimum[2], z);
          maximum[0] = Math.max(maximum[0], x);
          maximum[2] = Math.max(maximum[2], z);
        }
      }
    }
    if (occupiedVoxels === 0) throw new Error(`crown voxel-mask lobe ${lobeIndex} contains no occupied voxels`);
    const extents: [number, number, number] = [
      maximum[0] - minimum[0] + 1,
      maximum[1] - minimum[1] + 1,
      maximum[2] - minimum[2] + 1,
    ];
    const lobeCenter: [number, number, number] = [
      center[0] + ((minimum[0] + maximum[0] + 1) * 0.5 - dimensions[0] * 0.5) * voxelSize[0],
      center[1] + ((minimum[1] + maximum[1] + 1) * 0.5 - dimensions[1] * 0.5) * voxelSize[1],
      center[2] + ((minimum[2] + maximum[2] + 1) * 0.5 - dimensions[2] * 0.5) * voxelSize[2],
    ];
    const radii: [number, number, number] = [
      extents[0] * voxelSize[0] * 0.5,
      // Slight vertical overlap keeps adjacent band constraints constructive.
      extents[1] * voxelSize[1] * 0.56,
      extents[2] * voxelSize[2] * 0.5,
    ];
    lobes.push({
      id: `voxel-lobe-${String(lobeIndex).padStart(2, "0")}`,
      voxelBounds: { minimum, maximum },
      center: lobeCenter,
      radii,
      occupiedVoxels,
      fillRatio: occupiedVoxels / (extents[0] * extents[1] * extents[2]),
    });
  }
  return { lobes, workUnits };
};

/**
 * Fits a bounded binary 3D authoring mask to the existing constructive crown
 * constraints. It is a coarse occupancy fit, not surface reconstruction,
 * photogrammetry, metric capture, or species inference.
 */
export const fitProcPlantCrownVoxelMask = (
  mask: ProcPlantCrownVoxelMask,
  options: ProcPlantCrownVoxelMaskFitOptions,
): ProcPlantCrownVoxelMaskFitResult => {
  if (!mask || typeof mask !== "object" || !Array.isArray(mask.dimensions) || mask.dimensions.length !== 3) {
    throw new Error("crown voxel-mask requires explicit X/Y/Z dimensions");
  }
  const dimensions: [number, number, number] = [
    validateInteger(mask.dimensions[0], 1, PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION, "crown voxel-mask width"),
    validateInteger(mask.dimensions[1], 1, PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION, "crown voxel-mask height"),
    validateInteger(mask.dimensions[2], 1, PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION, "crown voxel-mask depth"),
  ];
  const voxelCount = dimensions[0] * dimensions[1] * dimensions[2];
  if (voxelCount > PROCPLANT_CROWN_VOXEL_MASK_MAX_VOXELS) throw new Error("crown voxel-mask exceeds the voxel cap");
  if (!mask.occupancy || mask.occupancy.length !== voxelCount) {
    throw new Error("crown voxel-mask occupancy length must equal width times height times depth");
  }
  const center = validateVector(options?.center, "crown voxel-mask center", (component) => Math.abs(component) <= 1_000_000);
  const voxelSize = validateVector(options?.voxelSize, "crown voxel-mask voxelSize", (component) => component > 0 && component <= 10_000);
  if (dimensions.some((dimension, axis) => dimension * voxelSize[axis]! > 10_000)) {
    throw new Error("crown voxel-mask world extent exceeds spatial limits");
  }
  if (dimensions.some((dimension, axis) => Math.abs(center[axis]!) + dimension * voxelSize[axis]! * 0.5 > 1_000_000)) {
    throw new Error("crown voxel-mask transformed world bounds exceed spatial limits");
  }
  const threshold = options.threshold ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("crown voxel-mask threshold must be finite in [0, 1]");
  }
  const requestedLobes = validateInteger(options.lobes ?? 8, 1, PROCPLANT_CROWN_VOXEL_MASK_MAX_LOBES, "crown voxel-mask lobes");
  const constraint = options.constraint ?? "lobes";
  if (constraint !== "lobes" && constraint !== "spline") throw new Error("crown voxel-mask constraint must be lobes or spline");
  const analysis = analyzeVoxels(mask, dimensions, threshold * 255);
  const lobeFit = fitLobes(analysis, dimensions, center, voxelSize, requestedLobes);
  const { lobes } = lobeFit;
  if (constraint === "spline" && analysis.maximumSliceContours !== 1) {
    throw new Error("crown voxel-mask is ambiguous for a single spline constraint: every occupied Y slice must have one contour");
  }
  if (constraint === "spline" && lobes.length < 2) {
    throw new Error("crown voxel-mask spline constraint requires at least two occupied vertical bands");
  }

  let crown: ProcPlantFreeformCrown;
  if (constraint === "lobes") {
    crown = {
      contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
      version: PROCPLANT_FREEFORM_CROWN_VERSION,
      volumes: lobes.map((lobe) => ({
        id: lobe.id,
        shape: "ellipsoid" as const,
        center: lobe.center,
        dimensions: lobe.radii,
        weight: lobe.fillRatio,
      })),
    } satisfies ProcPlantFreeformCrownV1;
  } else {
    crown = {
      contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
      version: PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
      volumes: [],
      splines: [{
        id: "voxel-spline-00",
        points: lobes.map((lobe, index) => ({
          id: `voxel-spline-00-point-${String(index).padStart(2, "0")}`,
          position: lobe.center,
          radius: Math.max(lobe.radii[0], lobe.radii[2]),
        })),
      }],
    } satisfies ProcPlantFreeformCrownV2;
  }
  validateProcPlantFreeformCrown(crown);

  const hashValues = [
    ...dimensions.flatMap((value) => Array.from(numberBytes(value))),
    ...center.flatMap((value) => Array.from(numberBytes(value))),
    ...voxelSize.flatMap((value) => Array.from(numberBytes(value))),
    ...numberBytes(threshold),
    ...numberBytes(requestedLobes),
    constraint === "lobes" ? 0 : 1,
    ...analysis.solid,
  ];
  return {
    contract: PROCPLANT_CROWN_VOXEL_MASK_FIT_CONTRACT,
    version: PROCPLANT_CROWN_VOXEL_MASK_FIT_VERSION,
    source: {
      dimensions,
      center,
      voxelSize,
      threshold,
      foregroundVoxels: analysis.foregroundVoxels,
      occupiedBounds: { minimum: analysis.minimum, maximum: analysis.maximum },
      hash: fnv1a(hashValues),
    },
    audit: {
      connectedComponents: analysis.connectedComponents,
      cavityComponents: analysis.cavityComponents,
      sliceContours: analysis.sliceContours,
      maximumSliceContours: analysis.maximumSliceContours,
      workUnits: analysis.workUnits + lobeFit.workUnits,
      lobeCount: lobes.length,
      constraint,
      ordering: "x-fastest-then-z-then-y",
    },
    lobes,
    crown,
  };
};
