import * as THREE from "three";

export const PROCPLANT_CUTOUT_CONTRACT = "procplants.cutout" as const;
export const PROCPLANT_CUTOUT_VERSION = 1 as const;
export const PROCPLANT_CUTOUT_SWAY_ATTRIBUTE = "procplantSway" as const;

export interface ProcPlantCutoutPoint {
  x: number;
  y: number;
}

export interface ProcPlantAlphaMask {
  width: number;
  height: number;
  /** One alpha byte per pixel, row-major from the top-left. */
  alpha: ArrayLike<number>;
}

export interface ProcPlantCutoutMetadata {
  /** Local normalized coordinates, origin at the bottom-left of the source image. */
  pivot: ProcPlantCutoutPoint;
  attachment: ProcPlantCutoutPoint;
  bendAxis: {
    origin: ProcPlantCutoutPoint;
    direction: ProcPlantCutoutPoint;
  };
}

export interface ProcPlantCutoutTraceOptions {
  /** Normalized alpha threshold [0..1]. Pixels strictly above it are solid. */
  threshold?: number;
  /** Ramer-Douglas-Peucker tolerance measured in source pixels. */
  simplifyTolerance?: number;
}

export type ProcPlantCutoutContourRole = "island" | "hole";

/** Stable containment information for one entry in `ProcPlantCutout.contours`. */
export interface ProcPlantCutoutContourTopology {
  index: number;
  parentIndex: number | null;
  depth: number;
  role: ProcPlantCutoutContourRole;
  /** Absolute area in normalized source-image coordinates. */
  area: number;
  winding: "clockwise" | "counterClockwise";
}

export interface ProcPlantCutout {
  contract: typeof PROCPLANT_CUTOUT_CONTRACT;
  version: typeof PROCPLANT_CUTOUT_VERSION;
  id: string;
  width: number;
  height: number;
  threshold: number;
  /** Largest connected silhouette, normalized to local bottom-left coordinates. */
  contour: ProcPlantCutoutPoint[];
  /** Every traced boundary, largest first. Includes island and hole boundaries. */
  contours: ProcPlantCutoutPoint[][];
  /** Parent/depth classification for `contours`; omitted only by legacy callers. */
  topology?: ProcPlantCutoutContourTopology[];
  metadata: ProcPlantCutoutMetadata;
}

export type ProcPlantCutoutContourEdit =
  | { kind: "move-point"; contourId: string; pointIndex: number; point: ProcPlantCutoutPoint }
  | { kind: "insert-point"; contourId: string; afterPointIndex: number; point: ProcPlantCutoutPoint }
  | { kind: "delete-point"; contourId: string; pointIndex: number }
  | { kind: "add-contour"; contourId: string; points: readonly ProcPlantCutoutPoint[] }
  | { kind: "delete-contour"; contourId: string };

export interface ProcPlantCutoutContourIssue {
  code: "out-of-bounds" | "duplicate-point" | "zero-area" | "self-intersection" | "contour-intersection";
  contourId: string;
  pointIndex?: number;
  otherContourId?: string;
  message: string;
}

export interface ProcPlantCutoutContourEditOptions {
  /** IDs returned by a prior edit. Omit to derive stable IDs from the cutout ID and contour index. */
  contourIds?: readonly string[];
  /** Normalized cutout contours normally remain inside [0, 1]. */
  allowOutOfBounds?: boolean;
  /** Self-touching/crossing boundaries cannot be triangulated reliably and are rejected by default. */
  allowIntersections?: boolean;
}

export interface ProcPlantCutoutContourEditResult {
  cutout: ProcPlantCutout;
  /** IDs follow the returned, area-sorted contour order and remain valid for the next edit call. */
  contourIds: string[];
  issues: ProcPlantCutoutContourIssue[];
  operationsApplied: number;
}

export interface ProcPlantCutoutAtlasEntry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
  /** Bottom-left UV rectangle for the source pixels, excluding padding. */
  uv: { u0: number; v0: number; u1: number; v1: number };
  metadata: ProcPlantCutoutMetadata;
  atlasMetadata: ProcPlantCutoutMetadata;
  /** Source-local boundaries copied from the cutout, including holes. */
  contours?: ProcPlantCutoutPoint[][];
  /** The same boundaries transformed into atlas UV coordinates. */
  atlasContours?: ProcPlantCutoutPoint[][];
  topology?: ProcPlantCutoutContourTopology[];
}

export interface ProcPlantCutoutAtlas {
  contract: typeof PROCPLANT_CUTOUT_CONTRACT;
  version: typeof PROCPLANT_CUTOUT_VERSION;
  width: number;
  height: number;
  padding: number;
  entries: ProcPlantCutoutAtlasEntry[];
}

export interface ProcPlantCutoutAtlasOptions {
  padding?: number;
  width?: number;
  powerOfTwo?: boolean;
  maxWidth?: number;
}

export interface ProcPlantCutoutRaster {
  id: string;
  width: number;
  height: number;
  /** RGBA bytes, row-major from the top-left. */
  rgba: Uint8ClampedArray;
}

export type ProcPlantAtlasCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface ProcPlantCutoutGeometryOptions {
  /** World-space height. Width defaults to the source aspect ratio times height. */
  height?: number;
  width?: number;
  atlasEntry?: ProcPlantCutoutAtlasEntry;
}

const DEFAULT_METADATA: ProcPlantCutoutMetadata = {
  pivot: { x: 0.5, y: 0 },
  attachment: { x: 0.5, y: 0 },
  bendAxis: { origin: { x: 0.5, y: 0 }, direction: { x: 0, y: 1 } },
};

const clonePoint = (point: ProcPlantCutoutPoint): ProcPlantCutoutPoint => ({ x: point.x, y: point.y });

const cloneMetadata = (metadata: ProcPlantCutoutMetadata): ProcPlantCutoutMetadata => ({
  pivot: clonePoint(metadata.pivot),
  attachment: clonePoint(metadata.attachment),
  bendAxis: {
    origin: clonePoint(metadata.bendAxis.origin),
    direction: clonePoint(metadata.bendAxis.direction),
  },
});

const validatePoint = (point: ProcPlantCutoutPoint, label: string) => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`${label} must be finite`);
};

const validateMetadata = (metadata: ProcPlantCutoutMetadata) => {
  validatePoint(metadata.pivot, "metadata.pivot");
  validatePoint(metadata.attachment, "metadata.attachment");
  validatePoint(metadata.bendAxis.origin, "metadata.bendAxis.origin");
  validatePoint(metadata.bendAxis.direction, "metadata.bendAxis.direction");
  if (Math.hypot(metadata.bendAxis.direction.x, metadata.bendAxis.direction.y) < 1e-8) {
    throw new Error("metadata.bendAxis.direction must be non-zero");
  }
};

const pointKey = (point: ProcPlantCutoutPoint) => `${point.x},${point.y}`;

const signedArea = (points: readonly ProcPlantCutoutPoint[]) => {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
};

const cloneTopology = (
  topology: readonly ProcPlantCutoutContourTopology[],
): ProcPlantCutoutContourTopology[] => topology.map((entry) => ({ ...entry }));

const pointInPolygon = (
  point: ProcPlantCutoutPoint,
  polygon: readonly ProcPlantCutoutPoint[],
) => {
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index++) {
    const a = polygon[index]!;
    const b = polygon[prior]!;
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x
    ) inside = !inside;
  }
  return inside;
};

const classifyContourTopology = (
  contours: readonly (readonly ProcPlantCutoutPoint[])[],
): ProcPlantCutoutContourTopology[] => {
  const signedAreas = contours.map(signedArea);
  const areas = signedAreas.map(Math.abs);
  const parents = contours.map((contour, index) => {
    let parentIndex: number | null = null;
    let parentArea = Number.POSITIVE_INFINITY;
    const sample = contour[0]!;
    for (let candidate = 0; candidate < contours.length; candidate++) {
      if (candidate === index || areas[candidate]! <= areas[index]! + 1e-12) continue;
      if (areas[candidate]! < parentArea && pointInPolygon(sample, contours[candidate]!)) {
        parentIndex = candidate;
        parentArea = areas[candidate]!;
      }
    }
    return parentIndex;
  });
  const depths = parents.map((_, index) => {
    let depth = 0;
    let parent = parents[index];
    while (parent !== null) {
      depth++;
      parent = parents[parent];
      if (depth > contours.length) throw new Error("cutout contour containment cycle");
    }
    return depth;
  });
  return contours.map((_, index) => ({
    index,
    parentIndex: parents[index]!,
    depth: depths[index]!,
    role: depths[index]! % 2 === 0 ? "island" : "hole",
    area: areas[index]!,
    winding: signedAreas[index]! < 0 ? "clockwise" : "counterClockwise",
  }));
};

const contourEditId = (cutoutId: string, index: number) => `${cutoutId}:contour:${index}`;

export const getProcPlantCutoutContourIds = (cutout: ProcPlantCutout): string[] =>
  cutoutContours(cutout).map((_, index) => contourEditId(cutout.id, index));

const pointOnSegment = (
  point: ProcPlantCutoutPoint,
  start: ProcPlantCutoutPoint,
  end: ProcPlantCutoutPoint,
  epsilon = 1e-9,
) => {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > epsilon) return false;
  return point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon;
};

const segmentOrientation = (
  a: ProcPlantCutoutPoint,
  b: ProcPlantCutoutPoint,
  c: ProcPlantCutoutPoint,
  epsilon = 1e-9,
) => {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(cross) <= epsilon ? 0 : Math.sign(cross);
};

const segmentsIntersect = (
  a: ProcPlantCutoutPoint,
  b: ProcPlantCutoutPoint,
  c: ProcPlantCutoutPoint,
  d: ProcPlantCutoutPoint,
) => {
  const abC = segmentOrientation(a, b, c);
  const abD = segmentOrientation(a, b, d);
  const cdA = segmentOrientation(c, d, a);
  const cdB = segmentOrientation(c, d, b);
  if (abC !== abD && cdA !== cdB) return true;
  return (abC === 0 && pointOnSegment(c, a, b)) ||
    (abD === 0 && pointOnSegment(d, a, b)) ||
    (cdA === 0 && pointOnSegment(a, c, d)) ||
    (cdB === 0 && pointOnSegment(b, c, d));
};

export const validateProcPlantCutoutContours = (
  contours: readonly (readonly ProcPlantCutoutPoint[])[],
  contourIds: readonly string[] = contours.map((_, index) => `contour:${index}`),
): ProcPlantCutoutContourIssue[] => {
  if (contourIds.length !== contours.length) throw new Error("contourIds must match the contour count");
  const issues: ProcPlantCutoutContourIssue[] = [];
  for (let contourIndex = 0; contourIndex < contours.length; contourIndex++) {
    const contour = contours[contourIndex]!;
    const contourId = contourIds[contourIndex]!;
    if (contour.length < 3) throw new Error(`${contourId} requires at least three points`);
    for (let pointIndex = 0; pointIndex < contour.length; pointIndex++) {
      const point = contour[pointIndex]!;
      validatePoint(point, `${contourId} point ${pointIndex}`);
      if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
        issues.push({
          code: "out-of-bounds",
          contourId,
          pointIndex,
          message: `${contourId} point ${pointIndex} is outside normalized cutout bounds`,
        });
      }
      const next = contour[(pointIndex + 1) % contour.length]!;
      if (Math.hypot(point.x - next.x, point.y - next.y) <= 1e-9) {
        issues.push({
          code: "duplicate-point",
          contourId,
          pointIndex,
          message: `${contourId} has a zero-length edge at point ${pointIndex}`,
        });
      }
    }
    if (Math.abs(signedArea(contour)) <= 1e-10) {
      issues.push({ code: "zero-area", contourId, message: `${contourId} has zero area` });
    }
    for (let first = 0; first < contour.length; first++) {
      const firstNext = (first + 1) % contour.length;
      for (let second = first + 1; second < contour.length; second++) {
        const secondNext = (second + 1) % contour.length;
        if (first === second || firstNext === second || secondNext === first) continue;
        if (segmentsIntersect(contour[first]!, contour[firstNext]!, contour[second]!, contour[secondNext]!)) {
          issues.push({
            code: "self-intersection",
            contourId,
            pointIndex: first,
            message: `${contourId} edges ${first} and ${second} intersect`,
          });
        }
      }
    }
  }
  for (let firstContour = 0; firstContour < contours.length; firstContour++) {
    const first = contours[firstContour]!;
    for (let secondContour = firstContour + 1; secondContour < contours.length; secondContour++) {
      const second = contours[secondContour]!;
      let intersects = false;
      for (let firstEdge = 0; firstEdge < first.length && !intersects; firstEdge++) {
        for (let secondEdge = 0; secondEdge < second.length; secondEdge++) {
          if (segmentsIntersect(
            first[firstEdge]!,
            first[(firstEdge + 1) % first.length]!,
            second[secondEdge]!,
            second[(secondEdge + 1) % second.length]!,
          )) {
            intersects = true;
            break;
          }
        }
      }
      if (intersects) {
        issues.push({
          code: "contour-intersection",
          contourId: contourIds[firstContour]!,
          otherContourId: contourIds[secondContour]!,
          message: `${contourIds[firstContour]} intersects ${contourIds[secondContour]}`,
        });
      }
    }
  }
  return issues;
};

export const applyProcPlantCutoutContourEdits = (
  cutout: ProcPlantCutout,
  edits: readonly ProcPlantCutoutContourEdit[],
  options: ProcPlantCutoutContourEditOptions = {},
): ProcPlantCutoutContourEditResult => {
  const contours = cutoutContours(cutout);
  if (contours.length === 0) throw new Error("cutout requires at least one editable contour");
  const contourIds = options.contourIds
    ? [...options.contourIds]
    : contours.map((_, index) => contourEditId(cutout.id, index));
  if (contourIds.length !== contours.length) throw new Error("contourIds must match the cutout contour count");
  if (new Set(contourIds).size !== contourIds.length || contourIds.some((id) => !id.trim())) {
    throw new Error("contourIds must be non-empty and unique");
  }
  const requireContour = (id: string) => {
    const index = contourIds.indexOf(id);
    if (index < 0) throw new Error(`unknown cutout contour ID: ${id}`);
    return index;
  };
  for (const edit of edits) {
    if (edit.kind === "add-contour") {
      if (!edit.contourId.trim() || contourIds.includes(edit.contourId)) {
        throw new Error(`new contour ID must be non-empty and unique: ${edit.contourId}`);
      }
      if (edit.points.length < 3) throw new Error(`${edit.contourId} requires at least three points`);
      contours.push(edit.points.map(clonePoint));
      contourIds.push(edit.contourId);
      continue;
    }
    const contourIndex = requireContour(edit.contourId);
    const contour = contours[contourIndex]!;
    if (edit.kind === "delete-contour") {
      if (contours.length === 1) throw new Error("cannot delete the last cutout contour");
      contours.splice(contourIndex, 1);
      contourIds.splice(contourIndex, 1);
    } else if (edit.kind === "move-point") {
      if (!Number.isInteger(edit.pointIndex) || edit.pointIndex < 0 || edit.pointIndex >= contour.length) {
        throw new Error(`point index is outside ${edit.contourId}`);
      }
      validatePoint(edit.point, "edited contour point");
      contour[edit.pointIndex] = clonePoint(edit.point);
    } else if (edit.kind === "insert-point") {
      if (!Number.isInteger(edit.afterPointIndex) || edit.afterPointIndex < 0 || edit.afterPointIndex >= contour.length) {
        throw new Error(`insertion index is outside ${edit.contourId}`);
      }
      validatePoint(edit.point, "inserted contour point");
      contour.splice(edit.afterPointIndex + 1, 0, clonePoint(edit.point));
    } else {
      if (!Number.isInteger(edit.pointIndex) || edit.pointIndex < 0 || edit.pointIndex >= contour.length) {
        throw new Error(`point index is outside ${edit.contourId}`);
      }
      if (contour.length <= 3) throw new Error(`${edit.contourId} must retain at least three points`);
      contour.splice(edit.pointIndex, 1);
    }
  }
  const issues = validateProcPlantCutoutContours(contours, contourIds);
  const rejected = issues.filter((issue) =>
    (issue.code === "out-of-bounds" && !options.allowOutOfBounds) ||
    ((issue.code === "self-intersection" || issue.code === "contour-intersection") && !options.allowIntersections) ||
    issue.code === "duplicate-point" || issue.code === "zero-area",
  );
  if (rejected.length > 0) throw new Error(`invalid cutout contour edit: ${rejected[0]!.message}`);

  const ordered = contours.map((contour, index) => ({
    contour,
    contourId: contourIds[index]!,
    area: Math.abs(signedArea(contour)),
  })).sort((a, b) => b.area - a.area || a.contourId.localeCompare(b.contourId));
  const sortedContours = ordered.map((entry) => entry.contour.map(clonePoint));
  const sortedIds = ordered.map((entry) => entry.contourId);
  return {
    cutout: {
      ...cutout,
      contour: sortedContours[0]!.map(clonePoint),
      contours: sortedContours,
      topology: classifyContourTopology(sortedContours),
      metadata: cloneMetadata(cutout.metadata),
    },
    contourIds: sortedIds,
    issues,
    operationsApplied: edits.length,
  };
};

const cutoutContours = (cutout: ProcPlantCutout): ProcPlantCutoutPoint[][] => {
  const source = cutout.contours?.length ? cutout.contours : [cutout.contour];
  return source
    .filter((contour) => contour.length >= 3)
    .map((contour) => contour.map(clonePoint));
};

const canonicalizeClosedContour = (points: readonly ProcPlantCutoutPoint[]) => {
  if (points.length === 0) return [];
  let start = 0;
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!;
    const current = points[start]!;
    if (point.y < current.y || (point.y === current.y && point.x < current.x)) start = index;
  }
  return points.map((_, index) => clonePoint(points[(start + index) % points.length]!));
};

const perpendicularDistance = (
  point: ProcPlantCutoutPoint,
  start: ProcPlantCutoutPoint,
  end: ProcPlantCutoutPoint,
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
};

const simplifyOpenContour = (points: readonly ProcPlantCutoutPoint[], tolerance: number): ProcPlantCutoutPoint[] => {
  if (points.length <= 2) return points.map(clonePoint);
  let farthest = -1;
  let maxDistance = tolerance;
  for (let index = 1; index < points.length - 1; index++) {
    const distance = perpendicularDistance(points[index]!, points[0]!, points[points.length - 1]!);
    if (distance > maxDistance) {
      farthest = index;
      maxDistance = distance;
    }
  }
  if (farthest < 0) return [clonePoint(points[0]!), clonePoint(points[points.length - 1]!)];
  const left = simplifyOpenContour(points.slice(0, farthest + 1), tolerance);
  const right = simplifyOpenContour(points.slice(farthest), tolerance);
  return [...left.slice(0, -1), ...right];
};

export const simplifyProcPlantCutoutContour = (
  input: readonly ProcPlantCutoutPoint[],
  tolerance = 0.75,
): ProcPlantCutoutPoint[] => {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("simplify tolerance must be finite and non-negative");
  const deduplicated: ProcPlantCutoutPoint[] = [];
  for (const point of input) {
    validatePoint(point, "contour point");
    const prior = deduplicated[deduplicated.length - 1];
    if (!prior || prior.x !== point.x || prior.y !== point.y) deduplicated.push(clonePoint(point));
  }
  if (
    deduplicated.length > 1 &&
    deduplicated[0]!.x === deduplicated[deduplicated.length - 1]!.x &&
    deduplicated[0]!.y === deduplicated[deduplicated.length - 1]!.y
  ) deduplicated.pop();
  if (deduplicated.length <= 3) return canonicalizeClosedContour(deduplicated);

  const canonical = canonicalizeClosedContour(deduplicated);
  let split = 1;
  let farthestSq = -1;
  for (let index = 1; index < canonical.length; index++) {
    const dx = canonical[index]!.x - canonical[0]!.x;
    const dy = canonical[index]!.y - canonical[0]!.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > farthestSq) {
      farthestSq = distanceSq;
      split = index;
    }
  }
  const first = simplifyOpenContour(canonical.slice(0, split + 1), tolerance);
  const second = simplifyOpenContour([...canonical.slice(split), canonical[0]!], tolerance);
  const simplified = [...first.slice(0, -1), ...second.slice(0, -1)];
  return canonicalizeClosedContour(simplified.length >= 3 ? simplified : canonical);
};

type BoundaryEdge = {
  start: ProcPlantCutoutPoint;
  end: ProcPlantCutoutPoint;
  direction: 0 | 1 | 2 | 3;
};

const edgeDirection = (start: ProcPlantCutoutPoint, end: ProcPlantCutoutPoint): BoundaryEdge["direction"] => {
  if (end.x > start.x) return 0;
  if (end.y > start.y) return 1;
  if (end.x < start.x) return 2;
  return 3;
};

export const traceProcPlantAlphaMask = (
  mask: ProcPlantAlphaMask,
  options: ProcPlantCutoutTraceOptions = {},
): ProcPlantCutoutPoint[][] => {
  if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width <= 0 || mask.height <= 0) {
    throw new Error("alpha mask dimensions must be positive integers");
  }
  if (mask.alpha.length !== mask.width * mask.height) throw new Error("alpha mask must contain one byte per pixel");
  const threshold = options.threshold ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("alpha threshold must be in [0, 1]");
  const tolerance = options.simplifyTolerance ?? 0.75;
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < mask.width && y < mask.height && (mask.alpha[y * mask.width + x] ?? 0) > threshold * 255;
  const edges: BoundaryEdge[] = [];
  const add = (start: ProcPlantCutoutPoint, end: ProcPlantCutoutPoint) =>
    edges.push({ start, end, direction: edgeDirection(start, end) });
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x, y - 1)) add({ x, y }, { x: x + 1, y });
      if (!solid(x + 1, y)) add({ x: x + 1, y }, { x: x + 1, y: y + 1 });
      if (!solid(x, y + 1)) add({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
      if (!solid(x - 1, y)) add({ x, y: y + 1 }, { x, y });
    }
  }
  edges.sort((a, b) =>
    a.start.y - b.start.y || a.start.x - b.start.x || a.direction - b.direction ||
    a.end.y - b.end.y || a.end.x - b.end.x,
  );
  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const list = outgoing.get(pointKey(edge.start)) ?? [];
    list.push(index);
    outgoing.set(pointKey(edge.start), list);
  });
  const used = new Uint8Array(edges.length);
  const contours: ProcPlantCutoutPoint[][] = [];
  const turnRank = (incoming: number, outgoingDirection: number) => {
    const turn = (outgoingDirection - incoming + 4) % 4;
    return turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3;
  };
  for (let startIndex = 0; startIndex < edges.length; startIndex++) {
    if (used[startIndex]) continue;
    const contour: ProcPlantCutoutPoint[] = [];
    const first = edges[startIndex]!;
    let edgeIndex = startIndex;
    for (let guard = 0; guard <= edges.length; guard++) {
      if (used[edgeIndex]) break;
      const edge = edges[edgeIndex]!;
      used[edgeIndex] = 1;
      contour.push(edge.start);
      if (pointKey(edge.end) === pointKey(first.start)) break;
      const candidates = (outgoing.get(pointKey(edge.end)) ?? [])
        .filter((candidate) => !used[candidate])
        .sort((a, b) =>
          turnRank(edge.direction, edges[a]!.direction) - turnRank(edge.direction, edges[b]!.direction) || a - b,
        );
      if (candidates.length === 0) throw new Error("alpha mask produced an open silhouette boundary");
      edgeIndex = candidates[0]!;
    }
    if (contour.length >= 3) contours.push(simplifyProcPlantCutoutContour(contour, tolerance));
  }
  return contours
    .filter((contour) => contour.length >= 3)
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)) ||
      pointKey(a[0]!).localeCompare(pointKey(b[0]!)))
    .map((contour) => contour.map((point) => ({
      x: point.x / mask.width,
      y: 1 - point.y / mask.height,
    })));
};

export const createProcPlantCutout = (
  id: string,
  mask: ProcPlantAlphaMask,
  metadata: ProcPlantCutoutMetadata = DEFAULT_METADATA,
  options: ProcPlantCutoutTraceOptions = {},
): ProcPlantCutout => {
  if (!id.trim()) throw new Error("cutout id must not be empty");
  validateMetadata(metadata);
  const contours = traceProcPlantAlphaMask(mask, options);
  if (contours.length === 0) throw new Error(`alpha mask for ${id} contains no solid silhouette`);
  const topology = classifyContourTopology(contours);
  return {
    contract: PROCPLANT_CUTOUT_CONTRACT,
    version: PROCPLANT_CUTOUT_VERSION,
    id,
    width: mask.width,
    height: mask.height,
    threshold: options.threshold ?? 0.5,
    contour: contours[0]!.map(clonePoint),
    contours,
    topology,
    metadata: cloneMetadata(metadata),
  };
};

const nextPowerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(1, value)));

const atlasPoint = (
  point: ProcPlantCutoutPoint,
  uv: ProcPlantCutoutAtlasEntry["uv"],
): ProcPlantCutoutPoint => ({
  x: uv.u0 + point.x * (uv.u1 - uv.u0),
  y: uv.v0 + point.y * (uv.v1 - uv.v0),
});

const atlasMetadata = (
  metadata: ProcPlantCutoutMetadata,
  uv: ProcPlantCutoutAtlasEntry["uv"],
): ProcPlantCutoutMetadata => {
  const direction = {
    x: metadata.bendAxis.direction.x * (uv.u1 - uv.u0),
    y: metadata.bendAxis.direction.y * (uv.v1 - uv.v0),
  };
  const length = Math.hypot(direction.x, direction.y) || 1;
  return {
    pivot: atlasPoint(metadata.pivot, uv),
    attachment: atlasPoint(metadata.attachment, uv),
    bendAxis: {
      origin: atlasPoint(metadata.bendAxis.origin, uv),
      direction: { x: direction.x / length, y: direction.y / length },
    },
  };
};

export const packProcPlantCutoutAtlas = (
  cutouts: readonly ProcPlantCutout[],
  options: ProcPlantCutoutAtlasOptions = {},
): ProcPlantCutoutAtlas => {
  if (cutouts.length === 0) throw new Error("atlas requires at least one cutout");
  const padding = options.padding ?? 2;
  if (!Number.isInteger(padding) || padding < 0) throw new Error("atlas padding must be a non-negative integer");
  const ids = new Set<string>();
  for (const cutout of cutouts) {
    if (ids.has(cutout.id)) throw new Error(`duplicate cutout id: ${cutout.id}`);
    ids.add(cutout.id);
  }
  const sorted = [...cutouts].sort((a, b) =>
    b.height - a.height || b.width - a.width || a.id.localeCompare(b.id),
  );
  const totalArea = sorted.reduce((sum, item) => sum + (item.width + padding * 2) * (item.height + padding * 2), 0);
  const widest = Math.max(...sorted.map((item) => item.width + padding * 2));
  const maxWidth = options.maxWidth ?? 4096;
  let width = options.width ?? Math.max(widest, Math.ceil(Math.sqrt(totalArea)));
  if (options.powerOfTwo ?? true) width = nextPowerOfTwo(width);
  if (!Number.isInteger(width) || width <= 0 || width > maxWidth || width < widest) {
    throw new Error(`atlas width ${width} cannot fit the requested cutouts (widest padded item: ${widest})`);
  }

  const placements: Array<{ cutout: ProcPlantCutout; x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  for (const cutout of sorted) {
    const outerWidth = cutout.width + padding * 2;
    const outerHeight = cutout.height + padding * 2;
    if (x > 0 && x + outerWidth > width) {
      x = 0;
      y += shelfHeight;
      shelfHeight = 0;
    }
    placements.push({ cutout, x: x + padding, y: y + padding });
    x += outerWidth;
    shelfHeight = Math.max(shelfHeight, outerHeight);
  }
  let height = y + shelfHeight;
  if (options.powerOfTwo ?? true) height = nextPowerOfTwo(height);
  const entries = placements.map(({ cutout, x: placedX, y: placedY }): ProcPlantCutoutAtlasEntry => {
    const contours = cutoutContours(cutout);
    const topology = classifyContourTopology(contours);
    const uv = {
      u0: placedX / width,
      v0: 1 - (placedY + cutout.height) / height,
      u1: (placedX + cutout.width) / width,
      v1: 1 - placedY / height,
    };
    return {
      id: cutout.id,
      x: placedX,
      y: placedY,
      width: cutout.width,
      height: cutout.height,
      padding,
      uv,
      metadata: cloneMetadata(cutout.metadata),
      atlasMetadata: atlasMetadata(cutout.metadata, uv),
      contours,
      atlasContours: contours.map((contour) => contour.map((point) => atlasPoint(point, uv))),
      topology: cloneTopology(topology),
    };
  });
  return {
    contract: PROCPLANT_CUTOUT_CONTRACT,
    version: PROCPLANT_CUTOUT_VERSION,
    width,
    height,
    padding,
    entries,
  };
};

export const buildProcPlantCutoutGeometry = (
  cutout: ProcPlantCutout,
  options: ProcPlantCutoutGeometryOptions = {},
): THREE.BufferGeometry => {
  const contours = cutoutContours(cutout);
  if (contours.length === 0) throw new Error("cutout contours require at least three points");
  const topology = classifyContourTopology(contours);
  const height = options.height ?? 1;
  const width = options.width ?? height * cutout.width / cutout.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("cutout geometry dimensions must be finite and positive");
  }
  const orderedPoints: ProcPlantCutoutPoint[] = [];
  const indices: number[] = [];
  const geometryContours: Array<ProcPlantCutoutContourTopology & { vertexStart: number; vertexCount: number }> = [];
  for (const island of topology.filter((entry) => entry.role === "island")) {
    const group = [
      island,
      ...topology.filter((entry) => entry.role === "hole" && entry.parentIndex === island.index),
    ];
    const rings = group.map((entry) => contours[entry.index]!.map((point) => new THREE.Vector2(point.x, point.y)));
    const faces = THREE.ShapeUtils.triangulateShape(rings[0]!, rings.slice(1));
    const vertexOffset = orderedPoints.length;
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const entry = group[ringIndex]!;
      const ring = rings[ringIndex]!;
      geometryContours.push({
        ...entry,
        vertexStart: orderedPoints.length,
        vertexCount: ring.length,
      });
      for (const point of ring) orderedPoints.push({ x: point.x, y: point.y });
    }
    for (const face of faces) indices.push(
      vertexOffset + face[0]!,
      vertexOffset + face[1]!,
      vertexOffset + face[2]!,
    );
  }
  if (indices.length === 0) throw new Error("cutout contours could not be triangulated");
  const positions = new Float32Array(orderedPoints.length * 3);
  const normals = new Float32Array(orderedPoints.length * 3);
  const uvs = new Float32Array(orderedPoints.length * 2);
  const sway = new Float32Array(orderedPoints.length);
  const axisLength = Math.hypot(cutout.metadata.bendAxis.direction.x, cutout.metadata.bendAxis.direction.y);
  const axis = {
    x: cutout.metadata.bendAxis.direction.x / axisLength,
    y: cutout.metadata.bendAxis.direction.y / axisLength,
  };
  let maxProjection = 0;
  for (const point of orderedPoints) {
    maxProjection = Math.max(
      maxProjection,
      (point.x - cutout.metadata.bendAxis.origin.x) * axis.x +
        (point.y - cutout.metadata.bendAxis.origin.y) * axis.y,
    );
  }
  const uvRect = options.atlasEntry?.uv ?? { u0: 0, v0: 0, u1: 1, v1: 1 };
  for (let index = 0; index < orderedPoints.length; index++) {
    const point = orderedPoints[index]!;
    positions[index * 3] = (point.x - cutout.metadata.pivot.x) * width;
    positions[index * 3 + 1] = (point.y - cutout.metadata.pivot.y) * height;
    normals[index * 3 + 2] = 1;
    uvs[index * 2] = uvRect.u0 + point.x * (uvRect.u1 - uvRect.u0);
    uvs[index * 2 + 1] = uvRect.v0 + point.y * (uvRect.v1 - uvRect.v0);
    const projection =
      (point.x - cutout.metadata.bendAxis.origin.x) * axis.x +
      (point.y - cutout.metadata.bendAxis.origin.y) * axis.y;
    sway[index] = maxProjection > 1e-8 ? THREE.MathUtils.clamp(projection / maxProjection, 0, 1) : 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute(PROCPLANT_CUTOUT_SWAY_ATTRIBUTE, new THREE.BufferAttribute(sway, 1));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.procplantCutout = {
    contract: cutout.contract,
    version: cutout.version,
    id: cutout.id,
    metadata: cloneMetadata(cutout.metadata),
    atlasUv: { ...uvRect },
    contours: contours.map((contour) => contour.map(clonePoint)),
    atlasContours: contours.map((contour) => contour.map((point) => atlasPoint(point, uvRect))),
    topology: cloneTopology(topology),
    geometryContours,
    attachmentPosition: [
      (cutout.metadata.attachment.x - cutout.metadata.pivot.x) * width,
      (cutout.metadata.attachment.y - cutout.metadata.pivot.y) * height,
      0,
    ],
    bendAxis: [axis.x * width, axis.y * height, 0],
  };
  return geometry;
};

const defaultCanvasFactory = (width: number, height: number): ProcPlantAtlasCanvas => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("Canvas atlas creation requires OffscreenCanvas, document, or a canvasFactory");
};

/**
 * Extend the four source edges and corners through a padding gutter. Sampling
 * is nearest/clamped, so every generated texel is reproducible and belongs to
 * this raster only; adjacent atlas entries can never bleed into the gutter.
 */
export const dilateProcPlantCutoutRaster = (
  raster: ProcPlantCutoutRaster,
  padding: number,
): ProcPlantCutoutRaster => {
  if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width <= 0 || raster.height <= 0) {
    throw new Error(`cutout raster dimensions must be positive integers: ${raster.id}`);
  }
  if (raster.rgba.length !== raster.width * raster.height * 4) {
    throw new Error(`cutout raster must contain RGBA bytes: ${raster.id}`);
  }
  if (!Number.isInteger(padding) || padding < 0) throw new Error("raster dilation padding must be a non-negative integer");
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
  return { id: raster.id, width, height, rgba };
};

export const createProcPlantCutoutAtlasCanvas = (
  atlas: ProcPlantCutoutAtlas,
  rasters: readonly ProcPlantCutoutRaster[],
  canvasFactory: (width: number, height: number) => ProcPlantAtlasCanvas = defaultCanvasFactory,
): ProcPlantAtlasCanvas => {
  const rasterById = new Map(rasters.map((raster) => [raster.id, raster]));
  const canvas = canvasFactory(atlas.width, atlas.height);
  if ("width" in canvas) canvas.width = atlas.width;
  if ("height" in canvas) canvas.height = atlas.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("atlas canvas does not provide a 2D context");
  context.clearRect(0, 0, atlas.width, atlas.height);
  for (const entry of atlas.entries) {
    const raster = rasterById.get(entry.id);
    if (!raster) throw new Error(`missing atlas raster: ${entry.id}`);
    if (raster.width !== entry.width || raster.height !== entry.height) {
      throw new Error(`atlas raster dimensions do not match cutout: ${entry.id}`);
    }
    if (raster.rgba.length !== raster.width * raster.height * 4) {
      throw new Error(`atlas raster must contain RGBA bytes: ${entry.id}`);
    }
    const dilated = dilateProcPlantCutoutRaster(raster, entry.padding);
    const image = context.createImageData(dilated.width, dilated.height);
    image.data.set(dilated.rgba);
    context.putImageData(image, entry.x - entry.padding, entry.y - entry.padding);
  }
  return canvas;
};

export const createProcPlantCutoutAtlasTexture = (
  atlas: ProcPlantCutoutAtlas,
  rasters: readonly ProcPlantCutoutRaster[],
  canvasFactory?: (width: number, height: number) => ProcPlantAtlasCanvas,
): THREE.CanvasTexture<ProcPlantAtlasCanvas> => {
  const canvas = createProcPlantCutoutAtlasCanvas(atlas, rasters, canvasFactory);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "procplant-cutout-atlas";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.userData.procplantCutoutAtlas = {
    contract: atlas.contract,
    version: atlas.version,
    width: atlas.width,
    height: atlas.height,
    padding: atlas.padding,
    entries: atlas.entries.map((entry) => {
      const contours = entry.contours ?? [];
      const atlasContours = entry.atlasContours ?? contours.map((contour) =>
        contour.map((point) => atlasPoint(point, entry.uv))
      );
      const topology = entry.topology ?? classifyContourTopology(contours);
      return {
        id: entry.id,
        uv: { ...entry.uv },
        contours: contours.map((contour) => contour.map(clonePoint)),
        atlasContours: atlasContours.map((contour) => contour.map(clonePoint)),
        topology: cloneTopology(topology),
      };
    }),
  };
  texture.needsUpdate = true;
  return texture;
};
