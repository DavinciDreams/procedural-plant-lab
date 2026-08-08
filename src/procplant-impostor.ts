import * as THREE from "three";

export const PROCPLANT_IMPOSTOR_CONTRACT = "procplants.impostor-atlas" as const;
export const PROCPLANT_IMPOSTOR_VERSION = 1 as const;

export type ProcPlantImpostorVec3 = Readonly<{ x: number; y: number; z: number }>;

export interface ProcPlantImpostorBounds {
  min: ProcPlantImpostorVec3;
  max: ProcPlantImpostorVec3;
}

export interface ProcPlantImpostorProjection {
  /** Orthographic extents in the view's right/up basis, relative to the plant pivot. */
  left: number;
  right: number;
  bottom: number;
  top: number;
  /** Depth extents along the plant-to-camera direction, relative to the pivot. */
  minDepth: number;
  maxDepth: number;
  near: number;
  far: number;
}

export interface ProcPlantImpostorCaptureView {
  id: string;
  index: number;
  azimuthIndex: number;
  elevationIndex: number;
  /** Radians; zero looks from +Z and positive angles rotate toward +X. */
  azimuth: number;
  /** Radians above the XZ plane. */
  elevation: number;
  /** Unit vector from the plant pivot toward the camera. */
  outward: ProcPlantImpostorVec3;
  /** Camera basis; `forward` points from camera toward the plant. */
  camera: {
    position: ProcPlantImpostorVec3;
    target: ProcPlantImpostorVec3;
    forward: ProcPlantImpostorVec3;
    right: ProcPlantImpostorVec3;
    up: ProcPlantImpostorVec3;
  };
  projection: ProcPlantImpostorProjection;
  /** Pivot in normalized view-image coordinates, origin at bottom-left. */
  projectedPivot: { u: number; v: number };
  projectedWidth: number;
  projectedHeight: number;
}

export interface ProcPlantImpostorCapturePlan {
  contract: typeof PROCPLANT_IMPOSTOR_CONTRACT;
  version: typeof PROCPLANT_IMPOSTOR_VERSION;
  width: number;
  height: number;
  bounds: ProcPlantImpostorBounds;
  pivot: ProcPlantImpostorVec3;
  views: ProcPlantImpostorCaptureView[];
}

export interface ProcPlantImpostorCapturePlanOptions {
  width?: number;
  height?: number;
  azimuthCount?: number;
  azimuthOffset?: number;
  /** Explicit elevations in radians. They are canonicalized into ascending order. */
  elevations?: readonly number[];
  pivot?: ProcPlantImpostorVec3;
}

export interface ProcPlantImpostorCaptureRequest {
  plan: ProcPlantImpostorCapturePlan;
  view: ProcPlantImpostorCaptureView;
  width: number;
  height: number;
}

export interface ProcPlantImpostorRaster {
  id?: string;
  width: number;
  height: number;
  /** RGBA bytes, row-major from the top-left. */
  rgba: Uint8ClampedArray | Uint8Array;
}

export type ProcPlantImpostorCapture = (
  request: ProcPlantImpostorCaptureRequest,
) => Promise<ProcPlantImpostorRaster>;

export type ProcPlantImpostorRasterDilation = (
  raster: ProcPlantImpostorRaster,
  padding: number,
) => Required<ProcPlantImpostorRaster>;

export interface ProcPlantImpostorAtlasOptions {
  padding?: number;
  width?: number;
  powerOfTwo?: boolean;
  maxSize?: number;
  signal?: AbortSignal;
  /** Optional channel-aware gutter dilation; omitted preserves legacy RGBA edge copying exactly. */
  dilate?: ProcPlantImpostorRasterDilation;
}

export interface ProcPlantImpostorAtlasEntry {
  id: string;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
  /** Bottom-left UV bounds of captured pixels, excluding padding. */
  uv: { u0: number; v0: number; u1: number; v1: number };
  /** Bottom-left UV bounds including the edge-dilated gutter. */
  paddedUv: { u0: number; v0: number; u1: number; v1: number };
  view: ProcPlantImpostorCaptureView;
}

export interface ProcPlantImpostorAtlasLayout {
  width: number;
  height: number;
  padding: number;
  entries: ProcPlantImpostorAtlasEntry[];
}

export interface ProcPlantImpostorAtlas {
  contract: typeof PROCPLANT_IMPOSTOR_CONTRACT;
  version: typeof PROCPLANT_IMPOSTOR_VERSION;
  width: number;
  height: number;
  padding: number;
  /** RGBA bytes, row-major from the top-left. */
  rgba: Uint8ClampedArray;
  plan: ProcPlantImpostorCapturePlan;
  entries: ProcPlantImpostorAtlasEntry[];
  selection: {
    strategy: "maximum-direction-dot";
    direction: "plant-to-camera";
    upAxis: "+Y";
    azimuthZero: "+Z";
    positiveAzimuth: "toward +X";
    orderedViewIds: string[];
  };
  contentHash: string;
}

export interface ProcPlantImpostorGeometryOptions {
  mode?: "billboard" | "cross";
  viewId?: string;
  scale?: number;
}

export interface ProcPlantImpostorViewSelection {
  entry: ProcPlantImpostorAtlasEntry;
  score: number;
}

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

const cloneVec3 = (value: ProcPlantImpostorVec3): ProcPlantImpostorVec3 => ({
  x: value.x,
  y: value.y,
  z: value.z,
});

const validateVec3 = (value: ProcPlantImpostorVec3, label: string) => {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`${label} must be finite`);
};

const addScaled = (a: ProcPlantImpostorVec3, b: ProcPlantImpostorVec3, scale: number): ProcPlantImpostorVec3 => ({
  x: a.x + b.x * scale,
  y: a.y + b.y * scale,
  z: a.z + b.z * scale,
});

const negate = (value: ProcPlantImpostorVec3): ProcPlantImpostorVec3 => ({
  x: -value.x,
  y: -value.y,
  z: -value.z,
});

const dot = (a: ProcPlantImpostorVec3, b: ProcPlantImpostorVec3) =>
  a.x * b.x + a.y * b.y + a.z * b.z;

const cross = (a: ProcPlantImpostorVec3, b: ProcPlantImpostorVec3): ProcPlantImpostorVec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const normalize = (value: ProcPlantImpostorVec3, label: string): ProcPlantImpostorVec3 => {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(length) || length < EPSILON) throw new Error(`${label} must be non-zero and finite`);
  return { x: value.x / length, y: value.y / length, z: value.z / length };
};

const canonicalAngle = (angle: number) => {
  const result = angle % TAU;
  return result < 0 ? result + TAU : result;
};

const nextPowerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(1, value)));

const boundsCorners = (bounds: ProcPlantImpostorBounds): ProcPlantImpostorVec3[] => {
  const result: ProcPlantImpostorVec3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) result.push({ x, y, z });
    }
  }
  return result;
};

const relativeTo = (point: ProcPlantImpostorVec3, pivot: ProcPlantImpostorVec3): ProcPlantImpostorVec3 => ({
  x: point.x - pivot.x,
  y: point.y - pivot.y,
  z: point.z - pivot.z,
});

const cloneView = (view: ProcPlantImpostorCaptureView): ProcPlantImpostorCaptureView => ({
  ...view,
  outward: cloneVec3(view.outward),
  camera: {
    position: cloneVec3(view.camera.position),
    target: cloneVec3(view.camera.target),
    forward: cloneVec3(view.camera.forward),
    right: cloneVec3(view.camera.right),
    up: cloneVec3(view.camera.up),
  },
  projection: { ...view.projection },
  projectedPivot: { ...view.projectedPivot },
});

export const createProcPlantImpostorCapturePlan = (
  bounds: ProcPlantImpostorBounds,
  options: ProcPlantImpostorCapturePlanOptions = {},
): ProcPlantImpostorCapturePlan => {
  validateVec3(bounds.min, "impostor bounds.min");
  validateVec3(bounds.max, "impostor bounds.max");
  if (
    bounds.max.x <= bounds.min.x ||
    bounds.max.y <= bounds.min.y ||
    bounds.max.z <= bounds.min.z
  ) throw new Error("impostor bounds must have positive size on every axis");
  const width = options.width ?? 128;
  const height = options.height ?? 128;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("impostor capture dimensions must be positive integers");
  }
  const azimuthCount = options.azimuthCount ?? 8;
  if (!Number.isInteger(azimuthCount) || azimuthCount < 1 || azimuthCount > 64) {
    throw new Error("impostor azimuthCount must be an integer in [1, 64]");
  }
  const azimuthOffset = options.azimuthOffset ?? 0;
  if (!Number.isFinite(azimuthOffset)) throw new Error("impostor azimuthOffset must be finite");
  const elevations = [...(options.elevations ?? [0])].sort((a, b) => a - b);
  if (elevations.length < 1 || elevations.length > 16) {
    throw new Error("impostor elevations must contain between 1 and 16 values");
  }
  for (let index = 0; index < elevations.length; index++) {
    const elevation = elevations[index]!;
    if (!Number.isFinite(elevation) || elevation < -Math.PI / 2 || elevation > Math.PI / 2) {
      throw new Error("impostor elevations must be finite radians in [-PI/2, PI/2]");
    }
    if (index > 0 && Math.abs(elevation - elevations[index - 1]!) < EPSILON) {
      throw new Error("impostor elevations must be unique");
    }
  }
  const pivot = cloneVec3(options.pivot ?? {
    x: (bounds.min.x + bounds.max.x) * 0.5,
    y: bounds.min.y,
    z: (bounds.min.z + bounds.max.z) * 0.5,
  });
  validateVec3(pivot, "impostor pivot");
  const corners = boundsCorners(bounds);
  const diagonal = Math.hypot(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  );
  const views: ProcPlantImpostorCaptureView[] = [];
  for (let elevationIndex = 0; elevationIndex < elevations.length; elevationIndex++) {
    const elevation = elevations[elevationIndex]!;
    for (let azimuthIndex = 0; azimuthIndex < azimuthCount; azimuthIndex++) {
      const azimuth = canonicalAngle(azimuthOffset + azimuthIndex * TAU / azimuthCount);
      const horizontal = Math.cos(elevation);
      const outward = normalize({
        x: Math.sin(azimuth) * horizontal,
        y: Math.sin(elevation),
        z: Math.cos(azimuth) * horizontal,
      }, "impostor view direction");
      const forward = negate(outward);
      let right = cross(forward, { x: 0, y: 1, z: 0 });
      if (Math.hypot(right.x, right.y, right.z) < EPSILON) {
        right = { x: Math.cos(azimuth), y: 0, z: -Math.sin(azimuth) };
      }
      right = normalize(right, "impostor camera right");
      const up = normalize(cross(right, forward), "impostor camera up");
      let left = Number.POSITIVE_INFINITY;
      let rightExtent = Number.NEGATIVE_INFINITY;
      let bottom = Number.POSITIVE_INFINITY;
      let top = Number.NEGATIVE_INFINITY;
      let minDepth = Number.POSITIVE_INFINITY;
      let maxDepth = Number.NEGATIVE_INFINITY;
      for (const corner of corners) {
        const relative = relativeTo(corner, pivot);
        const viewX = dot(relative, right);
        const viewY = dot(relative, up);
        const depth = dot(relative, outward);
        left = Math.min(left, viewX);
        rightExtent = Math.max(rightExtent, viewX);
        bottom = Math.min(bottom, viewY);
        top = Math.max(top, viewY);
        minDepth = Math.min(minDepth, depth);
        maxDepth = Math.max(maxDepth, depth);
      }
      const projectedWidth = rightExtent - left;
      const projectedHeight = top - bottom;
      const distance = diagonal * 2 + Math.max(Math.abs(minDepth), Math.abs(maxDepth), 1);
      const depthMargin = Math.max(diagonal * 0.05, 0.01);
      const index = views.length;
      views.push({
        id: `e${String(elevationIndex).padStart(2, "0")}-a${String(azimuthIndex).padStart(2, "0")}`,
        index,
        azimuthIndex,
        elevationIndex,
        azimuth,
        elevation,
        outward,
        camera: {
          position: addScaled(pivot, outward, distance),
          target: cloneVec3(pivot),
          forward,
          right,
          up,
        },
        projection: {
          left,
          right: rightExtent,
          bottom,
          top,
          minDepth,
          maxDepth,
          near: Math.max(0.001, distance - maxDepth - depthMargin),
          far: distance - minDepth + depthMargin,
        },
        projectedPivot: {
          u: -left / projectedWidth,
          v: -bottom / projectedHeight,
        },
        projectedWidth,
        projectedHeight,
      });
    }
  }
  return {
    contract: PROCPLANT_IMPOSTOR_CONTRACT,
    version: PROCPLANT_IMPOSTOR_VERSION,
    width,
    height,
    bounds: { min: cloneVec3(bounds.min), max: cloneVec3(bounds.max) },
    pivot,
    views,
  };
};

export const dilateProcPlantImpostorRaster = (
  raster: ProcPlantImpostorRaster,
  padding: number,
): Required<ProcPlantImpostorRaster> => {
  if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width <= 0 || raster.height <= 0) {
    throw new Error("impostor raster dimensions must be positive integers");
  }
  if (raster.rgba.length !== raster.width * raster.height * 4) {
    throw new Error("impostor raster must contain exactly width * height * 4 RGBA bytes");
  }
  if (!Number.isInteger(padding) || padding < 0) {
    throw new Error("impostor raster padding must be a non-negative integer");
  }
  const width = raster.width + padding * 2;
  const height = raster.height + padding * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.max(0, Math.min(raster.height - 1, y - padding));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.max(0, Math.min(raster.width - 1, x - padding));
      const sourceOffset = (sourceY * raster.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = raster.rgba[sourceOffset]!;
      rgba[targetOffset + 1] = raster.rgba[sourceOffset + 1]!;
      rgba[targetOffset + 2] = raster.rgba[sourceOffset + 2]!;
      rgba[targetOffset + 3] = raster.rgba[sourceOffset + 3]!;
    }
  }
  return { id: raster.id ?? "", width, height, rgba };
};

export const createProcPlantImpostorAtlasLayout = (
  plan: ProcPlantImpostorCapturePlan,
  options: ProcPlantImpostorAtlasOptions,
): ProcPlantImpostorAtlasLayout => {
  const padding = options.padding ?? 4;
  if (!Number.isInteger(padding) || padding < 0) throw new Error("impostor atlas padding must be a non-negative integer");
  const outerWidth = plan.width + padding * 2;
  const outerHeight = plan.height + padding * 2;
  const maxSize = options.maxSize ?? 8192;
  if (!Number.isInteger(maxSize) || maxSize <= 0) throw new Error("impostor atlas maxSize must be a positive integer");
  const totalArea = outerWidth * outerHeight * plan.views.length;
  let width = options.width ?? Math.max(outerWidth, Math.ceil(Math.sqrt(totalArea)));
  if (options.powerOfTwo ?? true) width = nextPowerOfTwo(width);
  if (!Number.isInteger(width) || width <= 0 || width > maxSize || width < outerWidth) {
    throw new Error(`impostor atlas width ${width} cannot fit a ${outerWidth}-pixel padded view`);
  }
  const columns = Math.max(1, Math.floor(width / outerWidth));
  let height = Math.ceil(plan.views.length / columns) * outerHeight;
  if (options.powerOfTwo ?? true) height = nextPowerOfTwo(height);
  if (height > maxSize) throw new Error(`impostor atlas height ${height} exceeds maxSize ${maxSize}`);
  const entries = plan.views.map((view, index): ProcPlantImpostorAtlasEntry => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const outerX = column * outerWidth;
    const outerY = row * outerHeight;
    const x = outerX + padding;
    const y = outerY + padding;
    return {
      id: view.id,
      index,
      x,
      y,
      width: plan.width,
      height: plan.height,
      padding,
      uv: {
        u0: x / width,
        v0: 1 - (y + plan.height) / height,
        u1: (x + plan.width) / width,
        v1: 1 - y / height,
      },
      paddedUv: {
        u0: outerX / width,
        v0: 1 - (outerY + outerHeight) / height,
        u1: (outerX + outerWidth) / width,
        v1: 1 - outerY / height,
      },
      view: cloneView(view),
    };
  });
  return { width, height, padding, entries };
};

const hashBytes = (bytes: Uint8Array, seed = 0x811c9dc5) => {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const atlasHash = (
  plan: ProcPlantImpostorCapturePlan,
  width: number,
  height: number,
  padding: number,
  entries: readonly ProcPlantImpostorAtlasEntry[],
  rgba: Uint8ClampedArray,
) => {
  const metadata = JSON.stringify({
    contract: PROCPLANT_IMPOSTOR_CONTRACT,
    version: PROCPLANT_IMPOSTOR_VERSION,
    width,
    height,
    padding,
    capture: {
      width: plan.width,
      height: plan.height,
      bounds: plan.bounds,
      pivot: plan.pivot,
    },
    entries: entries.map((entry) => ({
      id: entry.id,
      x: entry.x,
      y: entry.y,
      uv: entry.uv,
      azimuth: entry.view.azimuth,
      elevation: entry.view.elevation,
      outward: entry.view.outward,
      projectedPivot: entry.view.projectedPivot,
      projectedWidth: entry.view.projectedWidth,
      projectedHeight: entry.view.projectedHeight,
    })),
  });
  const metadataBytes = new TextEncoder().encode(metadata);
  const first = hashBytes(metadataBytes);
  const final = hashBytes(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), first);
  return `fnv1a32-${final.toString(16).padStart(8, "0")}`;
};

export const buildProcPlantImpostorAtlas = async (
  plan: ProcPlantImpostorCapturePlan,
  capture: ProcPlantImpostorCapture,
  options: ProcPlantImpostorAtlasOptions = {},
): Promise<ProcPlantImpostorAtlas> => {
  if (plan.contract !== PROCPLANT_IMPOSTOR_CONTRACT || plan.version !== PROCPLANT_IMPOSTOR_VERSION) {
    throw new Error("unsupported procplant impostor capture plan");
  }
  if (plan.views.length === 0) throw new Error("impostor capture plan requires at least one view");
  const layout = createProcPlantImpostorAtlasLayout(plan, options);
  const atlasRgba = new Uint8ClampedArray(layout.width * layout.height * 4);
  for (const entry of layout.entries) {
    if (options.signal?.aborted) throw new DOMException("Impostor capture aborted", "AbortError");
    let raster: ProcPlantImpostorRaster;
    try {
      raster = await capture({ plan, view: entry.view, width: plan.width, height: plan.height });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`impostor capture failed for ${entry.id}: ${detail}`);
    }
    if (!raster || typeof raster !== "object") {
      throw new Error(`impostor capture returned no raster for ${entry.id}`);
    }
    if (raster.id !== undefined && raster.id !== entry.id) {
      throw new Error(`impostor capture returned id ${raster.id} for ${entry.id}`);
    }
    if (raster.width !== plan.width || raster.height !== plan.height) {
      throw new Error(`impostor capture dimensions do not match plan for ${entry.id}`);
    }
    if (raster.rgba.length !== plan.width * plan.height * 4) {
      throw new Error(`impostor capture returned invalid RGBA length for ${entry.id}`);
    }
    const dilated = (options.dilate ?? dilateProcPlantImpostorRaster)({
      id: entry.id,
      width: raster.width,
      height: raster.height,
      rgba: new Uint8ClampedArray(raster.rgba),
    }, entry.padding);
    if (
      dilated.width !== raster.width + entry.padding * 2 ||
      dilated.height !== raster.height + entry.padding * 2 ||
      dilated.rgba.length !== dilated.width * dilated.height * 4
    ) throw new Error(`impostor dilation returned invalid dimensions for ${entry.id}`);
    const targetX = entry.x - entry.padding;
    const targetY = entry.y - entry.padding;
    for (let row = 0; row < dilated.height; row++) {
      const sourceOffset = row * dilated.width * 4;
      const targetOffset = ((targetY + row) * layout.width + targetX) * 4;
      atlasRgba.set(dilated.rgba.subarray(sourceOffset, sourceOffset + dilated.width * 4), targetOffset);
    }
  }
  const contentHash = atlasHash(plan, layout.width, layout.height, layout.padding, layout.entries, atlasRgba);
  return {
    contract: PROCPLANT_IMPOSTOR_CONTRACT,
    version: PROCPLANT_IMPOSTOR_VERSION,
    width: layout.width,
    height: layout.height,
    padding: layout.padding,
    rgba: atlasRgba,
    plan,
    entries: layout.entries,
    selection: {
      strategy: "maximum-direction-dot",
      direction: "plant-to-camera",
      upAxis: "+Y",
      azimuthZero: "+Z",
      positiveAzimuth: "toward +X",
      orderedViewIds: layout.entries.map((entry) => entry.id),
    },
    contentHash,
  };
};

export const selectProcPlantImpostorView = (
  atlas: ProcPlantImpostorAtlas,
  plantToCamera: ProcPlantImpostorVec3,
): ProcPlantImpostorViewSelection => {
  const direction = normalize(plantToCamera, "plant-to-camera direction");
  if (atlas.entries.length === 0) throw new Error("impostor atlas has no views");
  let entry = atlas.entries[0]!;
  let score = dot(direction, entry.view.outward);
  for (let index = 1; index < atlas.entries.length; index++) {
    const candidate = atlas.entries[index]!;
    const candidateScore = dot(direction, candidate.view.outward);
    if (candidateScore > score + EPSILON) {
      entry = candidate;
      score = candidateScore;
    }
  }
  return { entry, score };
};

/**
 * Convert WebGL's bottom-left readback order into the top-left raster contract
 * used by the deterministic atlas packer. The source is never mutated.
 */
export const flipProcPlantImpostorRgbaRows = (
  source: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("impostor readback dimensions must be positive integers");
  }
  if (source.length !== width * height * 4) {
    throw new Error("impostor readback must contain exactly width * height * 4 RGBA bytes");
  }
  const result = new Uint8ClampedArray(source.length);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    const sourceOffset = (height - row - 1) * rowBytes;
    result.set(source.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes);
  }
  return result;
};

/** Change only atlas UVs, preserving the allocated billboard/cross buffers. */
export const updateProcPlantImpostorGeometryView = (
  geometry: THREE.BufferGeometry,
  atlas: ProcPlantImpostorAtlas,
  viewId: string,
) => {
  const entry = atlas.entries.find((candidate) => candidate.id === viewId);
  if (!entry) throw new Error(`impostor atlas view not found: ${viewId}`);
  const uv = geometry.getAttribute("uv");
  const localUv = geometry.getAttribute("impostorUv");
  if (!(uv instanceof THREE.BufferAttribute) || !(localUv instanceof THREE.BufferAttribute) || uv.count !== localUv.count) {
    throw new Error("impostor geometry requires aligned uv and impostorUv attributes");
  }
  for (let vertex = 0; vertex < uv.count; vertex++) {
    const u = localUv.getX(vertex);
    const v = localUv.getY(vertex);
    uv.setXY(
      vertex,
      entry.uv.u0 + u * (entry.uv.u1 - entry.uv.u0),
      entry.uv.v0 + v * (entry.uv.v1 - entry.uv.v0),
    );
  }
  uv.needsUpdate = true;
  const metadata = geometry.userData.procplantImpostor;
  if (metadata && typeof metadata === "object") {
    metadata.viewId = entry.id;
    metadata.projectedPivot = { ...entry.view.projectedPivot };
    metadata.uv = { ...entry.uv };
    metadata.paddedUv = { ...entry.paddedUv };
  }
  return entry;
};

export const buildProcPlantImpostorGeometry = (
  atlas: ProcPlantImpostorAtlas,
  options: ProcPlantImpostorGeometryOptions = {},
): THREE.BufferGeometry => {
  const mode = options.mode ?? "billboard";
  if (mode !== "billboard" && mode !== "cross") throw new Error(`unsupported impostor geometry mode: ${mode}`);
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("impostor geometry scale must be finite and positive");
  const entry = options.viewId === undefined
    ? atlas.entries[0]
    : atlas.entries.find((candidate) => candidate.id === options.viewId);
  if (!entry) throw new Error(`impostor atlas view not found: ${options.viewId ?? "<first>"}`);
  const view = entry.view;
  const x0 = -view.projectedPivot.u * view.projectedWidth * scale;
  const x1 = (1 - view.projectedPivot.u) * view.projectedWidth * scale;
  const y0 = -view.projectedPivot.v * view.projectedHeight * scale;
  const y1 = (1 - view.projectedPivot.v) * view.projectedHeight * scale;
  const cardCount = mode === "cross" ? 2 : 1;
  const positions = new Float32Array(cardCount * 4 * 3);
  const normals = new Float32Array(cardCount * 4 * 3);
  const localUvs = new Float32Array(cardCount * 4 * 2);
  const atlasUvs = new Float32Array(cardCount * 4 * 2);
  const cardIndices = new Float32Array(cardCount * 4);
  const indices = new Uint16Array(cardCount * 6);
  const local = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
  for (let card = 0; card < cardCount; card++) {
    for (let corner = 0; corner < 4; corner++) {
      const [u, v] = local[corner]!;
      const horizontal = u === 0 ? x0 : x1;
      const vertical = v === 0 ? y0 : y1;
      const vertex = card * 4 + corner;
      if (card === 0) {
        positions.set([horizontal, vertical, 0], vertex * 3);
        normals.set([0, 0, 1], vertex * 3);
      } else {
        positions.set([0, vertical, -horizontal], vertex * 3);
        normals.set([1, 0, 0], vertex * 3);
      }
      localUvs.set([u, v], vertex * 2);
      atlasUvs.set([
        entry.uv.u0 + u * (entry.uv.u1 - entry.uv.u0),
        entry.uv.v0 + v * (entry.uv.v1 - entry.uv.v0),
      ], vertex * 2);
      cardIndices[vertex] = card;
    }
    const vertex = card * 4;
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], card * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(atlasUvs, 2));
  geometry.setAttribute("impostorUv", new THREE.BufferAttribute(localUvs, 2));
  geometry.setAttribute("impostorCard", new THREE.BufferAttribute(cardIndices, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.procplantImpostor = {
    contract: atlas.contract,
    version: atlas.version,
    mode,
    viewId: entry.id,
    contentHash: atlas.contentHash,
    pivotPosition: [0, 0, 0],
    projectedPivot: { ...view.projectedPivot },
    uv: { ...entry.uv },
    paddedUv: { ...entry.paddedUv },
    pixelOrigin: "top-left",
    uvOrigin: "bottom-left",
    textureFlipY: true,
    selection: {
      ...atlas.selection,
      orderedViewIds: [...atlas.selection.orderedViewIds],
      views: atlas.entries.map((candidate) => ({
        id: candidate.id,
        outward: cloneVec3(candidate.view.outward),
        uv: { ...candidate.uv },
        projectedPivot: { ...candidate.view.projectedPivot },
        projectedWidth: candidate.view.projectedWidth,
        projectedHeight: candidate.view.projectedHeight,
      })),
    },
  };
  return geometry;
};

export const createProcPlantImpostorAtlasTexture = (
  atlas: ProcPlantImpostorAtlas,
): THREE.DataTexture => {
  if (atlas.rgba.length !== atlas.width * atlas.height * 4) throw new Error("impostor atlas RGBA length is invalid");
  const texture = new THREE.DataTexture(
    new Uint8Array(atlas.rgba),
    atlas.width,
    atlas.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "procplant-impostor-atlas";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.userData.procplantImpostor = {
    contract: atlas.contract,
    version: atlas.version,
    contentHash: atlas.contentHash,
    entries: atlas.entries.map((entry) => ({ id: entry.id, uv: { ...entry.uv } })),
  };
  texture.needsUpdate = true;
  return texture;
};
