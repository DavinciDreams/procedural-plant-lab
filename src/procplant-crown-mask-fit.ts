import {
  PROCPLANT_FREEFORM_CROWN_CONTRACT,
  PROCPLANT_FREEFORM_CROWN_VERSION,
  type ProcPlantFreeformCrownV1,
} from "./procplant-space-colonization";
import type { ProcPlantAlphaMask } from "./procplant-cutout";

export const PROCPLANT_CROWN_MASK_FIT_CONTRACT = "procplants.crown-mask-fit" as const;
export const PROCPLANT_CROWN_MASK_FIT_VERSION = 1 as const;
export const PROCPLANT_CROWN_MASK_MAX_DIMENSION = 512 as const;
export const PROCPLANT_CROWN_MASK_MAX_PIXELS = 262_144 as const;
export const PROCPLANT_CROWN_MASK_MAX_CONTOURS = 16 as const;
export const PROCPLANT_CROWN_MASK_MAX_BANDS = 16 as const;
export const PROCPLANT_CROWN_MASK_MAX_WORK_UNITS = 2_000_000 as const;

export interface ProcPlantCrownMaskWorldBounds {
  /** World-space center for the explicitly supplied fitting box. */
  center: readonly [number, number, number];
  /** Full world-space dimensions. Depth is an authored assumption, not reconstructed from the image. */
  dimensions: readonly [number, number, number];
}

export interface ProcPlantCrownMaskFitOptions {
  /** Normalized alpha threshold [0..1]. Pixels strictly above it belong to the silhouette. */
  threshold?: number;
  /** Number of overlapping ellipsoid constraints. */
  bands?: number;
  /** Required explicit scale/depth assumption for the 2D-to-3D fit. */
  bounds: ProcPlantCrownMaskWorldBounds;
}

export interface ProcPlantCrownMaskFitBand {
  id: string;
  /** Inclusive source-row range, top-down. */
  sourceRows: readonly [number, number];
  /** Inclusive horizontal foreground extent inside the band. */
  sourceColumns: readonly [number, number];
  center: readonly [number, number, number];
  /** Ellipsoid radii in world units. */
  radii: readonly [number, number, number];
  foregroundPixels: number;
}

export interface ProcPlantCrownMaskFitResult {
  contract: typeof PROCPLANT_CROWN_MASK_FIT_CONTRACT;
  version: typeof PROCPLANT_CROWN_MASK_FIT_VERSION;
  source: {
    width: number;
    height: number;
    threshold: number;
    foregroundPixels: number;
    silhouetteBounds: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    };
    /** Stable FNV-1a hash of the thresholded source mask and fit inputs. */
    hash: string;
  };
  audit: {
    islandContours: number;
    holeContours: number;
    workUnits: number;
    bandCount: number;
    /** Documents the only inferred axis in this contract. */
    depthPolicy: "explicit-bounds-scaled-by-band-width";
  };
  bands: ProcPlantCrownMaskFitBand[];
  /** Directly consumable as `spaceColonization.freeform`. */
  crown: ProcPlantFreeformCrownV1;
}

const validateInteger = (value: number, minimum: number, maximum: number, label: string) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
};

const validateBounds = (bounds: ProcPlantCrownMaskWorldBounds) => {
  if (!bounds || !Array.isArray(bounds.center) || bounds.center.length !== 3 ||
    !Array.isArray(bounds.dimensions) || bounds.dimensions.length !== 3 ||
    ![...bounds.center, ...bounds.dimensions].every(Number.isFinite)) {
    throw new Error("crown mask bounds require finite 3D center and dimensions");
  }
  if (bounds.center.some((value) => Math.abs(value) > 1_000_000) ||
    bounds.dimensions.some((value) => value <= 0 || value > 10_000)) {
    throw new Error("crown mask bounds exceed spatial limits");
  }
};

const fnv1a = (values: Iterable<number>) => {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const numberBytes = (value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return bytes;
};

interface MaskAnalysis {
  solid: Uint8Array;
  foregroundPixels: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  islandContours: number;
  holeContours: number;
  workUnits: number;
}

const analyzeMask = (mask: ProcPlantAlphaMask, thresholdByte: number): MaskAnalysis => {
  const { width, height } = mask;
  const pixels = width * height;
  const solid = new Uint8Array(pixels);
  let foregroundPixels = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let workUnits = 0;

  for (let index = 0; index < pixels; index++) {
    const alpha = Number(mask.alpha[index]);
    workUnits++;
    if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) {
      throw new Error(`crown mask alpha ${index} must be an integer byte`);
    }
    if (alpha <= thresholdByte) continue;
    solid[index] = 1;
    foregroundPixels++;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  if (foregroundPixels === 0) throw new Error("crown mask contains no foreground above the threshold");

  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  const flood = (start: number, target: 0 | 1) => {
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      workUnits++;
      if (workUnits > PROCPLANT_CROWN_MASK_MAX_WORK_UNITS) throw new Error("crown mask fit exceeds the work cap");
      const x = index % width;
      const y = Math.floor(index / width);
      const visit = (candidate: number) => {
        if (visited[candidate] === 0 && solid[candidate] === target) {
          visited[candidate] = 1;
          queue[tail++] = candidate;
        }
      };
      if (x > 0) visit(index - 1);
      if (x + 1 < width) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y + 1 < height) visit(index + width);
    }
  };

  let islandContours = 0;
  for (let index = 0; index < pixels; index++) {
    if (solid[index] === 1 && visited[index] === 0) {
      islandContours++;
      if (islandContours > PROCPLANT_CROWN_MASK_MAX_CONTOURS) throw new Error("crown mask exceeds the contour cap");
      flood(index, 1);
    }
  }
  if (islandContours !== 1) {
    throw new Error(`crown mask is ambiguous: expected one connected silhouette, received ${islandContours}`);
  }

  visited.fill(0);
  for (let x = 0; x < width; x++) {
    const topIndex = x;
    const bottomIndex = (height - 1) * width + x;
    if (solid[topIndex] === 0 && visited[topIndex] === 0) flood(topIndex, 0);
    if (solid[bottomIndex] === 0 && visited[bottomIndex] === 0) flood(bottomIndex, 0);
  }
  for (let y = 0; y < height; y++) {
    const leftIndex = y * width;
    const rightIndex = leftIndex + width - 1;
    if (solid[leftIndex] === 0 && visited[leftIndex] === 0) flood(leftIndex, 0);
    if (solid[rightIndex] === 0 && visited[rightIndex] === 0) flood(rightIndex, 0);
  }
  let holeContours = 0;
  for (let index = 0; index < pixels; index++) {
    if (solid[index] === 0 && visited[index] === 0) {
      holeContours++;
      if (islandContours + holeContours > PROCPLANT_CROWN_MASK_MAX_CONTOURS) throw new Error("crown mask exceeds the contour cap");
      flood(index, 0);
    }
  }
  if (holeContours > 0) {
    throw new Error(`crown mask is ambiguous: filled silhouette required, received ${holeContours} hole contour${holeContours === 1 ? "" : "s"}`);
  }
  return { solid, foregroundPixels, left, top, right, bottom, islandContours, holeContours, workUnits };
};

/**
 * Fits a filled frontal crown silhouette into a bounded stack of ellipsoids.
 * The source image supplies only X/Y occupancy. Callers must author the world
 * scale and depth; this function does not perform metric reconstruction.
 */
export const fitProcPlantCrownMask = (
  mask: ProcPlantAlphaMask,
  options: ProcPlantCrownMaskFitOptions,
): ProcPlantCrownMaskFitResult => {
  if (!mask || typeof mask !== "object") throw new Error("crown mask is required");
  const width = validateInteger(mask.width, 1, PROCPLANT_CROWN_MASK_MAX_DIMENSION, "crown mask width");
  const height = validateInteger(mask.height, 1, PROCPLANT_CROWN_MASK_MAX_DIMENSION, "crown mask height");
  const pixels = width * height;
  if (pixels > PROCPLANT_CROWN_MASK_MAX_PIXELS) throw new Error("crown mask exceeds the pixel cap");
  if (!mask.alpha || mask.alpha.length !== pixels) throw new Error("crown mask alpha length must equal width times height");
  validateBounds(options?.bounds);
  const threshold = options.threshold ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("crown mask threshold must be finite in [0, 1]");
  const requestedBands = validateInteger(options.bands ?? 8, 1, PROCPLANT_CROWN_MASK_MAX_BANDS, "crown mask bands");
  const thresholdByte = threshold * 255;
  const analysis = analyzeMask(mask, thresholdByte);
  const silhouetteHeight = analysis.bottom - analysis.top + 1;
  const bandCount = Math.min(requestedBands, silhouetteHeight);
  const silhouetteWidth = analysis.right - analysis.left + 1;
  const [worldWidth, worldHeight, worldDepth] = options.bounds.dimensions;
  const [centerX, centerY, centerZ] = options.bounds.center;
  const bands: ProcPlantCrownMaskFitBand[] = [];

  for (let bandIndex = 0; bandIndex < bandCount; bandIndex++) {
    const rowStart = analysis.top + Math.floor(bandIndex * silhouetteHeight / bandCount);
    const rowEnd = analysis.top + Math.floor((bandIndex + 1) * silhouetteHeight / bandCount) - 1;
    let columnStart = width;
    let columnEnd = -1;
    let foregroundPixels = 0;
    for (let y = rowStart; y <= rowEnd; y++) {
      for (let x = analysis.left; x <= analysis.right; x++) {
        if (analysis.solid[y * width + x] === 0) continue;
        foregroundPixels++;
        if (x < columnStart) columnStart = x;
        if (x > columnEnd) columnEnd = x;
      }
    }
    if (foregroundPixels === 0) throw new Error(`crown mask band ${bandIndex} contains no foreground`);
    const sourceCenterX = (columnStart + columnEnd + 1) * 0.5;
    const sourceCenterY = (rowStart + rowEnd + 1) * 0.5;
    const bandWidth = columnEnd - columnStart + 1;
    const bandHeight = rowEnd - rowStart + 1;
    const widthFraction = bandWidth / silhouetteWidth;
    const radii: [number, number, number] = [
      worldWidth * bandWidth / width * 0.5,
      worldHeight * bandHeight / height * 0.56,
      worldDepth * widthFraction * 0.5,
    ];
    const center: [number, number, number] = [
      centerX + (sourceCenterX / width - 0.5) * worldWidth,
      centerY + (0.5 - sourceCenterY / height) * worldHeight,
      centerZ,
    ];
    bands.push({
      id: `mask-band-${String(bandIndex).padStart(2, "0")}`,
      sourceRows: [rowStart, rowEnd],
      sourceColumns: [columnStart, columnEnd],
      center,
      radii,
      foregroundPixels,
    });
  }

  const crown: ProcPlantFreeformCrownV1 = {
    contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
    version: PROCPLANT_FREEFORM_CROWN_VERSION,
    volumes: bands.map((band) => ({
      id: band.id,
      shape: "ellipsoid",
      center: band.center,
      dimensions: band.radii,
      weight: band.foregroundPixels /
        ((band.sourceColumns[1] - band.sourceColumns[0] + 1) * (band.sourceRows[1] - band.sourceRows[0] + 1)),
    })),
  };
  const hashValues = [
    width & 0xff, width >>> 8, height & 0xff, height >>> 8,
    ...numberBytes(threshold), ...numberBytes(requestedBands),
    ...options.bounds.center.flatMap((value) => Array.from(numberBytes(value))),
    ...options.bounds.dimensions.flatMap((value) => Array.from(numberBytes(value))),
    ...analysis.solid,
  ];
  return {
    contract: PROCPLANT_CROWN_MASK_FIT_CONTRACT,
    version: PROCPLANT_CROWN_MASK_FIT_VERSION,
    source: {
      width,
      height,
      threshold,
      foregroundPixels: analysis.foregroundPixels,
      silhouetteBounds: { left: analysis.left, top: analysis.top, right: analysis.right, bottom: analysis.bottom },
      hash: fnv1a(hashValues),
    },
    audit: {
      islandContours: analysis.islandContours,
      holeContours: analysis.holeContours,
      workUnits: analysis.workUnits,
      bandCount,
      depthPolicy: "explicit-bounds-scaled-by-band-width",
    },
    bands,
    crown,
  };
};
