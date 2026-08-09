import type { ProcPlantGraph, ProcPlantSegmentRecord } from "./procplants";
import type { ProcPlantGraphLightSampler } from "./procplant-graph-resource-growth";
import type { ProcPlantGrowthVector, ProcPlantLightSample } from "./procplant-resource-growth";

export const PROCPLANT_CROWN_LIGHT_CONTRACT = "procplants.crown-light" as const;
export const PROCPLANT_CROWN_LIGHT_VERSION = 1 as const;

export interface ProcPlantCrownLightDirection {
  direction: ProcPlantGrowthVector;
  weight?: number;
}

export interface ProcPlantCrownLightOptions {
  directions?: readonly ProcPlantCrownLightDirection[];
  hemisphereSampleCount?: number;
  maxSamplesPerTarget?: number;
  maxAttachmentTargets?: number;
  maxSegmentTargets?: number;
  maxOccluders?: number;
  maxHashCells?: number;
  maxRayCellsPerSample?: number;
  candidateTestBudget?: number;
  maxDistance?: number;
  cellSize?: number;
  stemRadiusScale?: number;
  organRadiusScale?: number;
  includeStemOccluders?: boolean;
  includeOrganOccluders?: boolean;
}

export interface ProcPlantCrownDirectionalVisibility {
  direction: ProcPlantGrowthVector;
  weight: number;
  visibility: 0 | 1;
}

export interface ProcPlantCrownLightTargetResult {
  lightFraction: number;
  lightDirection: ProcPlantGrowthVector;
  sampleCount: number;
  occludedSamples: number;
  directionalSamples: ProcPlantCrownDirectionalVisibility[];
}

export interface ProcPlantAttachmentCrownLightResult extends ProcPlantCrownLightTargetResult {
  attachmentId: string;
  parentSegmentId: string | null;
}

export interface ProcPlantSegmentCrownLightResult extends ProcPlantCrownLightTargetResult {
  segmentId: string;
  parentSegmentId: string | null;
}

export interface ProcPlantCrownLightDiagnostics {
  attachmentTargets: number;
  segmentTargets: number;
  stemOccluders: number;
  organOccluders: number;
  hashCells: number;
  samplesCast: number;
  occludedSamples: number;
  candidateTests: number;
  exhaustiveCandidateTests: number;
  maxCandidatesPerRay: number;
  maxRayCellsVisited: number;
  candidateTestBudget: number;
}

export interface ProcPlantCrownLightResult {
  contract: typeof PROCPLANT_CROWN_LIGHT_CONTRACT;
  version: typeof PROCPLANT_CROWN_LIGHT_VERSION;
  attachments: ProcPlantAttachmentCrownLightResult[];
  segments: ProcPlantSegmentCrownLightResult[];
  diagnostics: ProcPlantCrownLightDiagnostics;
  approximation: string;
}

interface Bounds {
  min: ProcPlantGrowthVector;
  max: ProcPlantGrowthVector;
}

interface StemOccluder {
  type: "stem";
  id: string;
  segmentId: string;
  start: ProcPlantGrowthVector;
  end: ProcPlantGrowthVector;
  radius: number;
  bounds: Bounds;
}

interface OrganOccluder {
  type: "organ";
  id: string;
  organIndex: number;
  center: ProcPlantGrowthVector;
  axis: ProcPlantGrowthVector;
  right: ProcPlantGrowthVector;
  normal: ProcPlantGrowthVector;
  radius: number;
  bounds: Bounds;
}

type Occluder = StemOccluder | OrganOccluder;

interface Target {
  type: "attachment" | "segment";
  id: string;
  parentSegmentId: string | null;
  position: ProcPlantGrowthVector;
  excludedSegmentIds: Set<string>;
  excludedOrganIndex: number | null;
}

const EPSILON = 1e-8;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const stableCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const add = (a: ProcPlantGrowthVector, b: ProcPlantGrowthVector) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a: ProcPlantGrowthVector, b: ProcPlantGrowthVector) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const multiply = (value: ProcPlantGrowthVector, scale: number) => ({ x: value.x * scale, y: value.y * scale, z: value.z * scale });
const dot = (a: ProcPlantGrowthVector, b: ProcPlantGrowthVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: ProcPlantGrowthVector, b: ProcPlantGrowthVector) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const lengthSquared = (value: ProcPlantGrowthVector) => dot(value, value);
const normalize = (value: ProcPlantGrowthVector, label: string) => {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`${label} must be finite`);
  const length = Math.sqrt(lengthSquared(value));
  if (length <= EPSILON) throw new Error(`${label} must be non-zero`);
  return multiply(value, 1 / length);
};
const point = (value: { x: number; y: number; z: number }, label: string) => {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`${label} must be finite`);
  return { x: value.x, y: value.y, z: value.z };
};
const finiteRange = (value: number, label: string, min: number, max = Number.POSITIVE_INFINITY) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be finite and in [${min}, ${max}]`);
  return value;
};
const positiveInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
};

/** Stable Fibonacci samples over the world-up hemisphere. */
export const createProcPlantHemisphereLightDirections = (count = 16): ProcPlantCrownLightDirection[] => {
  positiveInteger(count, "hemisphere sample count");
  return Array.from({ length: count }, (_, index) => {
    const y = (index + 0.5) / count;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const azimuth = index * GOLDEN_ANGLE;
    return {
      direction: { x: Math.cos(azimuth) * radial, y, z: Math.sin(azimuth) * radial },
      weight: 1,
    };
  });
};

class SpatialHash {
  readonly cells = new Map<string, number[]>();
  maxRayCellsVisited = 0;
  constructor(readonly cellSize: number, readonly maxCells: number, readonly maxRayCells: number) {}
  private coordinate(value: number) { return Math.floor(value / this.cellSize); }
  private key(x: number, y: number, z: number) { return `${x},${y},${z}`; }

  insert(index: number, bounds: Bounds) {
    const minX = this.coordinate(bounds.min.x);
    const minY = this.coordinate(bounds.min.y);
    const minZ = this.coordinate(bounds.min.z);
    const maxX = this.coordinate(bounds.max.x);
    const maxY = this.coordinate(bounds.max.y);
    const maxZ = this.coordinate(bounds.max.z);
    for (let z = minZ; z <= maxZ; z++) for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = this.key(x, y, z);
      if (!this.cells.has(key) && this.cells.size >= this.maxCells) throw new Error(`crown light hash-cell cap exceeded (${this.maxCells})`);
      const values = this.cells.get(key) ?? [];
      values.push(index);
      this.cells.set(key, values);
    }
  }

  queryRay(origin: ProcPlantGrowthVector, direction: ProcPlantGrowthVector, maxDistance: number) {
    let x = this.coordinate(origin.x);
    let y = this.coordinate(origin.y);
    let z = this.coordinate(origin.z);
    const stepX = Math.sign(direction.x);
    const stepY = Math.sign(direction.y);
    const stepZ = Math.sign(direction.z);
    const nextBoundary = (coordinate: number, step: number) => (coordinate + (step > 0 ? 1 : 0)) * this.cellSize;
    let maxX = stepX === 0 ? Number.POSITIVE_INFINITY : (nextBoundary(x, stepX) - origin.x) / direction.x;
    let maxY = stepY === 0 ? Number.POSITIVE_INFINITY : (nextBoundary(y, stepY) - origin.y) / direction.y;
    let maxZ = stepZ === 0 ? Number.POSITIVE_INFINITY : (nextBoundary(z, stepZ) - origin.z) / direction.z;
    const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : this.cellSize / Math.abs(direction.x);
    const deltaY = stepY === 0 ? Number.POSITIVE_INFINITY : this.cellSize / Math.abs(direction.y);
    const deltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : this.cellSize / Math.abs(direction.z);
    const candidates = new Set<number>();
    let distance = 0;
    let visited = 0;
    while (distance <= maxDistance + EPSILON) {
      visited++;
      if (visited > this.maxRayCells) throw new Error(`crown light ray-cell cap exceeded (${this.maxRayCells})`);
      for (const index of this.cells.get(this.key(x, y, z)) ?? []) candidates.add(index);
      const next = Math.min(maxX, maxY, maxZ);
      if (!Number.isFinite(next) || next > maxDistance) break;
      if (maxX <= next + EPSILON) { x += stepX; maxX += deltaX; }
      if (maxY <= next + EPSILON) { y += stepY; maxY += deltaY; }
      if (maxZ <= next + EPSILON) { z += stepZ; maxZ += deltaZ; }
      distance = next;
    }
    this.maxRayCellsVisited = Math.max(this.maxRayCellsVisited, visited);
    return [...candidates].sort((left, right) => left - right);
  }
}

const segmentDistanceSquared = (
  p1: ProcPlantGrowthVector,
  q1: ProcPlantGrowthVector,
  p2: ProcPlantGrowthVector,
  q2: ProcPlantGrowthVector,
) => {
  const d1 = subtract(q1, p1);
  const d2 = subtract(q2, p2);
  const r = subtract(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a <= EPSILON && e <= EPSILON) return lengthSquared(r);
  if (a <= EPSILON) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= EPSILON) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = dot(d1, d2);
      const denominator = a * e - b * b;
      if (Math.abs(denominator) > EPSILON) s = Math.max(0, Math.min(1, (b * f - c * e) / denominator));
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  const first = add(p1, multiply(d1, s));
  const second = add(p2, multiply(d2, t));
  return lengthSquared(subtract(first, second));
};

const rayHitsOccluder = (
  origin: ProcPlantGrowthVector,
  direction: ProcPlantGrowthVector,
  maxDistance: number,
  occluder: Occluder,
) => {
  if (occluder.type === "stem") {
    const rayEnd = add(origin, multiply(direction, maxDistance));
    return segmentDistanceSquared(origin, rayEnd, occluder.start, occluder.end) <= occluder.radius * occluder.radius;
  }
  const denominator = dot(direction, occluder.normal);
  if (Math.abs(denominator) <= EPSILON) return false;
  const distance = dot(subtract(occluder.center, origin), occluder.normal) / denominator;
  if (distance <= EPSILON || distance > maxDistance) return false;
  const hit = add(origin, multiply(direction, distance));
  const local = subtract(hit, occluder.center);
  const axisDistance = dot(local, occluder.axis);
  const rightDistance = dot(local, occluder.right);
  return axisDistance * axisDistance + rightDistance * rightDistance <= occluder.radius * occluder.radius;
};

const stemOccluder = (graph: ProcPlantGraph, record: ProcPlantSegmentRecord, radiusScale: number): StemOccluder => {
  const startNode = graph.stems[record.startNodeIndex];
  const endNode = graph.stems[record.endNodeIndex];
  if (!startNode || !endNode) throw new Error(`${record.id} references a missing stem node`);
  const start = point(startNode.position, `${record.id}.start`);
  const end = point(endNode.position, `${record.id}.end`);
  const radius = Math.max(
    finiteRange(startNode.radius, `${record.id}.startRadius`, 0),
    finiteRange(endNode.radius, `${record.id}.endRadius`, 0),
  ) * radiusScale;
  return {
    type: "stem",
    id: `stem:${record.id}`,
    segmentId: record.id,
    start,
    end,
    radius,
    bounds: {
      min: { x: Math.min(start.x, end.x) - radius, y: Math.min(start.y, end.y) - radius, z: Math.min(start.z, end.z) - radius },
      max: { x: Math.max(start.x, end.x) + radius, y: Math.max(start.y, end.y) + radius, z: Math.max(start.z, end.z) + radius },
    },
  };
};

const organOccluder = (graph: ProcPlantGraph, organIndex: number, stableId: string, radiusScale: number): OrganOccluder => {
  const organ = graph.organs[organIndex]!;
  const center = point(organ.position, `organ[${organIndex}].position`);
  const axis = normalize(organ.direction, `organ[${organIndex}].direction`);
  let right = normalize(organ.right, `organ[${organIndex}].right`);
  right = normalize(subtract(right, multiply(axis, dot(axis, right))), `organ[${organIndex}].right projection`);
  const normal = normalize(cross(axis, right), `organ[${organIndex}].normal`);
  const radius = finiteRange(organ.scale, `organ[${organIndex}].scale`, 0) * radiusScale;
  return {
    type: "organ",
    id: `organ:${stableId}`,
    organIndex,
    center,
    axis,
    right,
    normal,
    radius,
    bounds: {
      min: { x: center.x - radius, y: center.y - radius, z: center.z - radius },
      max: { x: center.x + radius, y: center.y + radius, z: center.z + radius },
    },
  };
};

const targetResult = (
  target: Target,
  directions: readonly Required<ProcPlantCrownLightDirection>[],
  occluders: readonly Occluder[],
  hash: SpatialHash,
  maxDistance: number,
  diagnostics: ProcPlantCrownLightDiagnostics,
) => {
  const directionalSamples: ProcPlantCrownDirectionalVisibility[] = [];
  let visibleWeight = 0;
  let totalWeight = 0;
  let lightX = 0;
  let lightY = 0;
  let lightZ = 0;
  let occludedSamples = 0;
  for (const sample of directions) {
    const origin = add(target.position, multiply(sample.direction, EPSILON * 10));
    const candidates = hash.queryRay(origin, sample.direction, maxDistance);
    diagnostics.maxCandidatesPerRay = Math.max(diagnostics.maxCandidatesPerRay, candidates.length);
    let occluded = false;
    for (const candidate of candidates) {
      const occluder = occluders[candidate]!;
      if (occluder.type === "stem" && target.excludedSegmentIds.has(occluder.segmentId)) continue;
      if (occluder.type === "organ" && target.excludedOrganIndex === occluder.organIndex) continue;
      diagnostics.candidateTests++;
      if (diagnostics.candidateTests > diagnostics.candidateTestBudget) {
        throw new Error(`crown light candidate-test budget exceeded (${diagnostics.candidateTestBudget})`);
      }
      if (rayHitsOccluder(origin, sample.direction, maxDistance, occluder)) {
        occluded = true;
        break;
      }
    }
    const visibility: 0 | 1 = occluded ? 0 : 1;
    directionalSamples.push({ direction: { ...sample.direction }, weight: sample.weight, visibility });
    totalWeight += sample.weight;
    if (visibility) {
      visibleWeight += sample.weight;
      lightX += sample.direction.x * sample.weight;
      lightY += sample.direction.y * sample.weight;
      lightZ += sample.direction.z * sample.weight;
    } else {
      occludedSamples++;
    }
  }
  const length = Math.hypot(lightX, lightY, lightZ);
  return {
    lightFraction: totalWeight > 0 ? visibleWeight / totalWeight : 0,
    lightDirection: length > EPSILON ? { x: lightX / length, y: lightY / length, z: lightZ / length } : { x: 0, y: 1, z: 0 },
    sampleCount: directions.length,
    occludedSamples,
    directionalSamples,
  };
};

/** Evaluate order-independent, conservative crown occlusion for public Plant IR. */
export const evaluateProcPlantCrownLight = (
  graph: ProcPlantGraph,
  options: ProcPlantCrownLightOptions = {},
): ProcPlantCrownLightResult => {
  const maxSamples = positiveInteger(options.maxSamplesPerTarget ?? 64, "maxSamplesPerTarget");
  const maxAttachmentTargets = positiveInteger(options.maxAttachmentTargets ?? 4096, "maxAttachmentTargets");
  const maxSegmentTargets = positiveInteger(options.maxSegmentTargets ?? 4096, "maxSegmentTargets");
  const maxOccluders = positiveInteger(options.maxOccluders ?? 20_000, "maxOccluders");
  const maxHashCells = positiveInteger(options.maxHashCells ?? 250_000, "maxHashCells");
  const maxRayCells = positiveInteger(options.maxRayCellsPerSample ?? 8192, "maxRayCellsPerSample");
  const candidateTestBudget = positiveInteger(options.candidateTestBudget ?? 2_000_000, "candidateTestBudget");
  const maxDistance = finiteRange(options.maxDistance ?? 4, "maxDistance", EPSILON);
  const cellSize = finiteRange(options.cellSize ?? 0.35, "cellSize", EPSILON);
  const stemRadiusScale = finiteRange(options.stemRadiusScale ?? 1.15, "stemRadiusScale", 0);
  const organRadiusScale = finiteRange(options.organRadiusScale ?? 0.5, "organRadiusScale", 0);
  if (graph.attachments.length > maxAttachmentTargets) throw new Error(`attachment target cap exceeded (${maxAttachmentTargets})`);
  if (graph.segmentRecords.length > maxSegmentTargets) throw new Error(`segment target cap exceeded (${maxSegmentTargets})`);

  const sourceDirections = options.directions ?? createProcPlantHemisphereLightDirections(options.hemisphereSampleCount ?? 16);
  if (sourceDirections.length === 0 || sourceDirections.length > maxSamples) throw new Error(`light sample count must be in [1, ${maxSamples}]`);
  const directions = sourceDirections.map((sample, index) => ({
    direction: normalize(sample.direction, `directions[${index}]`),
    weight: finiteRange(sample.weight ?? 1, `directions[${index}].weight`, Number.MIN_VALUE),
  }));

  const records = [...graph.segmentRecords].sort((left, right) => stableCompare(left.id, right.id));
  const recordIds = new Set<string>();
  const recordById = new Map<string, ProcPlantSegmentRecord>();
  for (const record of records) {
    if (!record.id.trim() || recordIds.has(record.id)) throw new Error(`invalid or duplicate segment id: ${record.id}`);
    recordIds.add(record.id);
    recordById.set(record.id, record);
  }
  for (const record of records) {
    if (record.parentSegmentId !== null && !recordById.has(record.parentSegmentId)) {
      throw new Error(`${record.id}.parentSegmentId references missing segment ${record.parentSegmentId}`);
    }
  }
  const attachmentIds = new Set<string>();
  for (const attachment of graph.attachments) {
    if (!attachment.id.trim() || attachmentIds.has(attachment.id)) throw new Error(`invalid or duplicate attachment id: ${attachment.id}`);
    attachmentIds.add(attachment.id);
    if (attachment.organIndex !== null && !graph.organs[attachment.organIndex]) {
      throw new Error(`${attachment.id}.organIndex references a missing organ`);
    }
  }
  const occluders: Occluder[] = [];
  if (options.includeStemOccluders !== false) occluders.push(...records.map((record) => stemOccluder(graph, record, stemRadiusScale)));
  if (options.includeOrganOccluders !== false) {
    const attachmentIdsByOrgan = new Map<number, string[]>();
    for (const attachment of graph.attachments) {
      if (attachment.organIndex === null) continue;
      const ids = attachmentIdsByOrgan.get(attachment.organIndex) ?? [];
      ids.push(attachment.id);
      attachmentIdsByOrgan.set(attachment.organIndex, ids);
    }
    for (let index = 0; index < graph.organs.length; index++) {
      const organ = graph.organs[index]!;
      const attachmentIds = (attachmentIdsByOrgan.get(index) ?? []).sort(stableCompare);
      const stableId = attachmentIds.length > 0
        ? attachmentIds.join("|")
        : JSON.stringify([
          organ.kind,
          organ.position.x, organ.position.y, organ.position.z,
          organ.direction.x, organ.direction.y, organ.direction.z,
          organ.right.x, organ.right.y, organ.right.z,
          organ.scale,
        ]);
      occluders.push(organOccluder(graph, index, stableId, organRadiusScale));
    }
  }
  occluders.sort((left, right) => stableCompare(left.id, right.id));
  if (occluders.length > maxOccluders) throw new Error(`crown light occluder cap exceeded (${maxOccluders})`);
  const hash = new SpatialHash(cellSize, maxHashCells, maxRayCells);
  occluders.forEach((occluder, index) => hash.insert(index, occluder.bounds));

  const attachmentTargets: Target[] = [...graph.attachments]
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((attachment) => ({
      type: "attachment",
      id: attachment.id,
      parentSegmentId: attachment.parentSegmentId,
      position: point(attachment.position, `${attachment.id}.position`),
      excludedSegmentIds: new Set(attachment.parentSegmentId ? [attachment.parentSegmentId] : []),
      excludedOrganIndex: attachment.organIndex,
    }));
  const segmentTargets: Target[] = records.map((record) => {
    const end = graph.stems[record.endNodeIndex];
    if (!end) throw new Error(`${record.id}.endNodeIndex references a missing stem node`);
    return {
      type: "segment",
      id: record.id,
      parentSegmentId: record.parentSegmentId,
      position: point(end.position, `${record.id}.end`),
      excludedSegmentIds: new Set([record.id, ...(record.parentSegmentId ? [record.parentSegmentId] : [])]),
      excludedOrganIndex: null,
    };
  });
  const diagnostics: ProcPlantCrownLightDiagnostics = {
    attachmentTargets: attachmentTargets.length,
    segmentTargets: segmentTargets.length,
    stemOccluders: occluders.filter((occluder) => occluder.type === "stem").length,
    organOccluders: occluders.filter((occluder) => occluder.type === "organ").length,
    hashCells: hash.cells.size,
    samplesCast: (attachmentTargets.length + segmentTargets.length) * directions.length,
    occludedSamples: 0,
    candidateTests: 0,
    exhaustiveCandidateTests: (attachmentTargets.length + segmentTargets.length) * directions.length * occluders.length,
    maxCandidatesPerRay: 0,
    maxRayCellsVisited: 0,
    candidateTestBudget,
  };
  const attachments = attachmentTargets.map((target): ProcPlantAttachmentCrownLightResult => {
    const result = targetResult(target, directions, occluders, hash, maxDistance, diagnostics);
    diagnostics.occludedSamples += result.occludedSamples;
    return { attachmentId: target.id, parentSegmentId: target.parentSegmentId, ...result };
  });
  const segments = segmentTargets.map((target): ProcPlantSegmentCrownLightResult => {
    const result = targetResult(target, directions, occluders, hash, maxDistance, diagnostics);
    diagnostics.occludedSamples += result.occludedSamples;
    return { segmentId: target.id, parentSegmentId: target.parentSegmentId, ...result };
  });
  diagnostics.maxRayCellsVisited = hash.maxRayCellsVisited;
  return {
    contract: PROCPLANT_CROWN_LIGHT_CONTRACT,
    version: PROCPLANT_CROWN_LIGHT_VERSION,
    attachments,
    segments,
    diagnostics,
    approximation: "Binary visibility against conservative stem capsules and two-sided circular organ cards; not calibrated radiative transfer.",
  };
};

/** Reuse directional segment visibility as the existing resource-growth light callback. */
export const createProcPlantCrownLightSampler = (result: ProcPlantCrownLightResult): ProcPlantGraphLightSampler => {
  const bySegmentId = new Map(result.segments.map((segment) => [segment.segmentId, segment]));
  return (context): readonly ProcPlantLightSample[] => {
    const segment = bySegmentId.get(context.segmentId);
    if (!segment) throw new Error(`crown light result has no segment ${context.segmentId}`);
    return segment.directionalSamples.map((sample) => ({
      direction: { ...sample.direction },
      irradiance: sample.visibility,
      weight: sample.weight,
    }));
  };
};
