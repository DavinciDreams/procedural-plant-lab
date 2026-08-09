import * as THREE from "three";
import {
  buildProcPlantParallelTransportFrames,
  PROCPLANT_BRANCH_SWAY_ATTRIBUTE,
  PROCPLANT_BRANCH_U_ATTRIBUTE,
  PROCPLANT_BRANCH_V_ATTRIBUTE,
  type ProcPlantTubeFrame,
  type ProcPlantTubeSample,
} from "./procplant-tube";

export const PROCPLANT_SPINE_SEGMENT_ATTRIBUTE = "procplantSpineSegment" as const;
export const PROCPLANT_SPINE_T_ATTRIBUTE = "procplantSpineT" as const;
export const PROCPLANT_SPINE_RADIUS_ATTRIBUTE = "procplantSpineRadius" as const;

export interface ProcPlantMeshSpine {
  contract: "procplants.mesh-spine";
  version: 1;
  source: "auto-fit" | "manual";
  samples: ProcPlantTubeSample[];
}

export interface ProcPlantMeshSpineFitOptions {
  samples?: number;
  axis?: "x" | "y" | "z";
  bandScale?: number;
  minimumRadius?: number;
}

export interface ProcPlantMeshSpineBinding {
  contract: "procplants.mesh-spine-binding";
  version: 1;
  vertexCount: number;
  uv: Float32Array;
  branchU: Float32Array;
  branchV: Float32Array;
  sway: Float32Array;
  spineSegment: Uint16Array | Uint32Array;
  spineT: Float32Array;
  spineRadius: Float32Array;
}

export interface ProcPlantMeshAnchor {
  id: string;
  sampleIndex: number;
  axialT: number;
  radius: number;
  position: [number, number, number];
  tangent: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
}

export type ProcPlantMeshAttachmentClass = "leaf" | "branch" | "accessory";

export interface ProcPlantMeshAttachmentSpec {
  /** Stable caller-owned group ID, used as part of every emitted record ID. */
  id: string;
  kind: ProcPlantMeshAttachmentClass;
  count: number;
  startT?: number;
  endT?: number;
  clearance?: number;
  minimumSpacing?: number;
  tiltRadians?: number;
  rollRadians?: number;
  azimuthOffsetRadians?: number;
  azimuthJitterRadians?: number;
  scale?: number | readonly [number, number, number];
}

export interface ProcPlantMeshAttachmentOptions {
  seed?: number;
  minimumSpacing?: number;
  clearance?: number;
  maxCandidatesPerAttachment?: number;
}

export interface ProcPlantMeshAttachmentRecord {
  id: string;
  groupId: string;
  kind: ProcPlantMeshAttachmentClass;
  candidateIndex: number;
  spineSegment: number;
  spineT: number;
  axialT: number;
  azimuthRadians: number;
  surfaceRadius: number;
  clearance: number;
  minimumSpacing: number;
  sway: number;
  surfacePosition: [number, number, number];
  position: [number, number, number];
  supportTangent: [number, number, number];
  outward: [number, number, number];
  tangent: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  scale: [number, number, number];
  /** Column-major local-to-mesh matrix with X=right, Y=up, Z=tangent. */
  transform: number[];
}

export interface ProcPlantMeshAttachmentGroupResult {
  id: string;
  kind: ProcPlantMeshAttachmentClass;
  requested: number;
  emitted: number;
  rejectedForSpacing: number;
}

export interface ProcPlantMeshAttachmentPackage {
  contract: "procplants.mesh-attachments";
  version: 1;
  seed: number;
  requested: number;
  emitted: number;
  groups: ProcPlantMeshAttachmentGroupResult[];
  attachments: ProcPlantMeshAttachmentRecord[];
}

const validatePositions = (positions: ArrayLike<number>) => {
  if (positions.length < 6 || positions.length % 3 !== 0) {
    throw new Error("mesh helper positions must contain at least two xyz vertices");
  }
  for (let index = 0; index < positions.length; index++) {
    if (!Number.isFinite(positions[index])) throw new Error(`mesh helper position ${index} must be finite`);
  }
};

const axisIndex = (axis: "x" | "y" | "z") => axis === "x" ? 0 : axis === "y" ? 1 : 2;

const radialIndices = (axis: number): readonly [number, number] =>
  axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];

/** Fit a stable center/radius spine through bands of an imported trunk mesh. */
export const fitProcPlantMeshSpine = (
  positions: ArrayLike<number>,
  options: ProcPlantMeshSpineFitOptions = {},
): ProcPlantMeshSpine => {
  validatePositions(positions);
  const sampleCount = Math.max(2, Math.min(128, Math.round(options.samples ?? 12)));
  const axis = axisIndex(options.axis ?? "y");
  const [radialA, radialB] = radialIndices(axis);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let component = 0; component < 3; component++) {
      min[component] = Math.min(min[component]!, positions[offset + component]!);
      max[component] = Math.max(max[component]!, positions[offset + component]!);
    }
  }
  const span = max[axis]! - min[axis]!;
  if (span <= 1e-8) throw new Error("mesh helper fit axis must have non-zero extent");
  const step = span / (sampleCount - 1);
  const halfBand = step * THREE.MathUtils.clamp(options.bandScale ?? 0.72, 0.1, 2);
  const minimumRadius = Math.max(1e-5, options.minimumRadius ?? span * 0.002);
  const samples: ProcPlantTubeSample[] = [];

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const target = min[axis]! + step * sampleIndex;
    let sumA = 0;
    let sumB = 0;
    let count = 0;
    let bandMinA = Infinity;
    let bandMaxA = -Infinity;
    let bandMinB = Infinity;
    let bandMaxB = -Infinity;
    let nearestDelta = Infinity;
    for (let offset = 0; offset < positions.length; offset += 3) {
      const delta = Math.abs(positions[offset + axis]! - target);
      if (delta <= halfBand) {
        sumA += positions[offset + radialA]!;
        sumB += positions[offset + radialB]!;
        bandMinA = Math.min(bandMinA, positions[offset + radialA]!);
        bandMaxA = Math.max(bandMaxA, positions[offset + radialA]!);
        bandMinB = Math.min(bandMinB, positions[offset + radialB]!);
        bandMaxB = Math.max(bandMaxB, positions[offset + radialB]!);
        count++;
      }
      nearestDelta = Math.min(nearestDelta, delta);
    }
    if (count === 0) {
      for (let offset = 0; offset < positions.length; offset += 3) {
        if (Math.abs(Math.abs(positions[offset + axis]! - target) - nearestDelta) <= 1e-7) {
          sumA += positions[offset + radialA]!;
          sumB += positions[offset + radialB]!;
          bandMinA = Math.min(bandMinA, positions[offset + radialA]!);
          bandMaxA = Math.max(bandMaxA, positions[offset + radialA]!);
          bandMinB = Math.min(bandMinB, positions[offset + radialB]!);
          bandMaxB = Math.max(bandMaxB, positions[offset + radialB]!);
          count++;
        }
      }
    }
    const center = [0, 0, 0];
    center[axis] = target;
    // Midrange is insensitive to duplicated seam vertices in indexed or
    // non-indexed cylindrical meshes; fall back to the mean for degenerate bands.
    center[radialA] = Number.isFinite(bandMinA + bandMaxA)
      ? (bandMinA + bandMaxA) * 0.5
      : sumA / Math.max(1, count);
    center[radialB] = Number.isFinite(bandMinB + bandMaxB)
      ? (bandMinB + bandMaxB) * 0.5
      : sumB / Math.max(1, count);
    let radius = minimumRadius;
    for (let offset = 0; offset < positions.length; offset += 3) {
      if (Math.abs(positions[offset + axis]! - target) > halfBand && count > 1) continue;
      radius = Math.max(radius, Math.hypot(
        positions[offset + radialA]! - center[radialA]!,
        positions[offset + radialB]! - center[radialB]!,
      ));
    }
    samples.push({
      position: new THREE.Vector3(center[0], center[1], center[2]),
      radius,
      age: sampleIndex / (sampleCount - 1),
      branchOrder: 0,
    });
  }
  buildProcPlantParallelTransportFrames(samples);
  return { contract: "procplants.mesh-spine", version: 1, source: "auto-fit", samples };
};

export const createProcPlantManualMeshSpine = (
  samples: readonly ProcPlantTubeSample[],
): ProcPlantMeshSpine => {
  const cloned = samples.map((sample) => ({ ...sample, position: sample.position.clone() }));
  buildProcPlantParallelTransportFrames(cloned);
  return { contract: "procplants.mesh-spine", version: 1, source: "manual", samples: cloned };
};

const cumulativeSpineLengths = (samples: readonly ProcPlantTubeSample[]) => {
  const cumulative = new Float64Array(samples.length);
  for (let index = 1; index < samples.length; index++) {
    cumulative[index] = cumulative[index - 1]! + samples[index]!.position.distanceTo(samples[index - 1]!.position);
  }
  return cumulative;
};

/** Bind imported mesh vertices to a spine and produce bark/wind/anchor attributes. */
export const bindProcPlantMeshToSpine = (
  positions: ArrayLike<number>,
  spine: ProcPlantMeshSpine,
  options: { barkRepeatLength?: number; swayPower?: number } = {},
): ProcPlantMeshSpineBinding => {
  validatePositions(positions);
  if (spine.contract !== "procplants.mesh-spine" || spine.version !== 1) throw new Error("unsupported mesh spine contract");
  const frames = buildProcPlantParallelTransportFrames(spine.samples);
  const cumulative = cumulativeSpineLengths(spine.samples);
  const totalLength = Math.max(1e-8, cumulative.at(-1)!);
  const barkRepeatLength = Math.max(1e-5, options.barkRepeatLength ?? 1);
  const swayPower = Math.max(0.1, options.swayPower ?? 1.8);
  const vertexCount = positions.length / 3;
  const uv = new Float32Array(vertexCount * 2);
  const branchU = new Float32Array(vertexCount);
  const branchV = new Float32Array(vertexCount);
  const sway = new Float32Array(vertexCount);
  const spineSegment = spine.samples.length - 1 <= 0xffff ? new Uint16Array(vertexCount) : new Uint32Array(vertexCount);
  const spineT = new Float32Array(vertexCount);
  const spineRadius = new Float32Array(vertexCount);
  const vertex = new THREE.Vector3();
  const segment = new THREE.Vector3();
  const relative = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const radial = new THREE.Vector3();

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    vertex.fromArray(positions as ArrayLike<number>, vertexIndex * 3);
    let bestSegment = 0;
    let bestT = 0;
    let bestDistanceSq = Infinity;
    for (let segmentIndex = 0; segmentIndex < spine.samples.length - 1; segmentIndex++) {
      const start = spine.samples[segmentIndex]!.position;
      const end = spine.samples[segmentIndex + 1]!.position;
      segment.subVectors(end, start);
      const lengthSq = segment.lengthSq();
      relative.subVectors(vertex, start);
      const t = lengthSq > 0 ? THREE.MathUtils.clamp(relative.dot(segment) / lengthSq, 0, 1) : 0;
      closest.copy(start).addScaledVector(segment, t);
      const distanceSq = closest.distanceToSquared(vertex);
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestSegment = segmentIndex;
        bestT = t;
      }
    }
    const start = spine.samples[bestSegment]!;
    const end = spine.samples[bestSegment + 1]!;
    const frame: ProcPlantTubeFrame = frames[bestT < 0.5 ? bestSegment : bestSegment + 1]!;
    closest.copy(start.position).lerp(end.position, bestT);
    radial.subVectors(vertex, closest);
    const angle = Math.atan2(radial.dot(frame.up), radial.dot(frame.right));
    const axialDistance = cumulative[bestSegment]! + start.position.distanceTo(end.position) * bestT;
    const axial = axialDistance / totalLength;
    const radius = THREE.MathUtils.lerp(start.radius, end.radius, bestT);
    uv[vertexIndex * 2] = (angle / (Math.PI * 2) + 1) % 1;
    uv[vertexIndex * 2 + 1] = axialDistance / barkRepeatLength;
    branchU[vertexIndex] = axial;
    branchV[vertexIndex] = uv[vertexIndex * 2]!;
    sway[vertexIndex] = axial ** swayPower;
    spineSegment[vertexIndex] = bestSegment;
    spineT[vertexIndex] = bestT;
    spineRadius[vertexIndex] = radius;
  }
  return {
    contract: "procplants.mesh-spine-binding",
    version: 1,
    vertexCount,
    uv,
    branchU,
    branchV,
    sway,
    spineSegment,
    spineT,
    spineRadius,
  };
};

export const applyProcPlantMeshSpineBinding = (
  geometry: THREE.BufferGeometry,
  binding: ProcPlantMeshSpineBinding,
) => {
  const positions = geometry.getAttribute("position");
  if (!positions || positions.count !== binding.vertexCount) {
    throw new Error("mesh spine binding vertex count does not match geometry positions");
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(binding.uv.slice(), 2));
  geometry.setAttribute(PROCPLANT_BRANCH_U_ATTRIBUTE, new THREE.BufferAttribute(binding.branchU.slice(), 1));
  geometry.setAttribute(PROCPLANT_BRANCH_V_ATTRIBUTE, new THREE.BufferAttribute(binding.branchV.slice(), 1));
  geometry.setAttribute(PROCPLANT_BRANCH_SWAY_ATTRIBUTE, new THREE.BufferAttribute(binding.sway.slice(), 1));
  geometry.setAttribute(PROCPLANT_SPINE_SEGMENT_ATTRIBUTE, new THREE.BufferAttribute(binding.spineSegment.slice(), 1));
  geometry.setAttribute(PROCPLANT_SPINE_T_ATTRIBUTE, new THREE.BufferAttribute(binding.spineT.slice(), 1));
  geometry.setAttribute(PROCPLANT_SPINE_RADIUS_ATTRIBUTE, new THREE.BufferAttribute(binding.spineRadius.slice(), 1));
  geometry.userData.procplantMeshSpineBinding = {
    contract: binding.contract,
    version: binding.version,
    vertexCount: binding.vertexCount,
  };
  return geometry;
};

export const createProcPlantMeshSpineAnchors = (
  spine: ProcPlantMeshSpine,
  every = 1,
): ProcPlantMeshAnchor[] => {
  const step = Math.max(1, Math.round(every));
  const frames = buildProcPlantParallelTransportFrames(spine.samples);
  const cumulative = cumulativeSpineLengths(spine.samples);
  const total = Math.max(1e-8, cumulative.at(-1)!);
  const anchors: ProcPlantMeshAnchor[] = [];
  for (let index = 0; index < spine.samples.length; index += step) {
    const sample = spine.samples[index]!;
    const frame = frames[index]!;
    anchors.push({
      id: `mesh-spine:${index.toString().padStart(4, "0")}`,
      sampleIndex: index,
      axialT: cumulative[index]! / total,
      radius: sample.radius,
      position: sample.position.toArray(),
      tangent: frame.tangent.toArray(),
      right: frame.right.toArray(),
      up: frame.up.toArray(),
    });
  }
  const lastIndex = spine.samples.length - 1;
  if (anchors.at(-1)?.sampleIndex !== lastIndex) {
    const sample = spine.samples[lastIndex]!;
    const frame = frames[lastIndex]!;
    anchors.push({
      id: `mesh-spine:${lastIndex.toString().padStart(4, "0")}`,
      sampleIndex: lastIndex,
      axialT: 1,
      radius: sample.radius,
      position: sample.position.toArray(),
      tangent: frame.tangent.toArray(),
      right: frame.right.toArray(),
      up: frame.up.toArray(),
    });
  }
  return anchors;
};

const meshAttachmentHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const meshAttachmentMix = (value: number) => {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
};

const meshAttachmentUnit = (value: number) => meshAttachmentMix(value) / 0x100000000;

const finiteAttachmentNumber = (value: number, label: string, minimum = -Infinity) => {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be finite${minimum > -Infinity ? ` and at least ${minimum}` : ""}`);
  }
  return value;
};

const meshAttachmentScale = (
  value: ProcPlantMeshAttachmentSpec["scale"],
  label: string,
): [number, number, number] => {
  const scale = typeof value === "number"
    ? [value, value, value]
    : value === undefined
      ? [1, 1, 1]
      : [...value];
  if (scale.length !== 3 || scale.some((component) => !Number.isFinite(component) || component <= 0)) {
    throw new Error(`${label}.scale must contain three finite positive components`);
  }
  return [scale[0]!, scale[1]!, scale[2]!];
};

const defaultAttachmentTilt = (kind: ProcPlantMeshAttachmentClass) =>
  kind === "branch" ? Math.PI * 0.3 : kind === "leaf" ? Math.PI * 0.42 : Math.PI * 0.48;

interface ProcPlantInterpolatedSpineFrame {
  segment: number;
  segmentT: number;
  position: THREE.Vector3;
  radius: number;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

const interpolateProcPlantSpineFrame = (
  spine: ProcPlantMeshSpine,
  frames: readonly ProcPlantTubeFrame[],
  cumulative: Float64Array,
  totalLength: number,
  axialT: number,
): ProcPlantInterpolatedSpineFrame => {
  const distance = THREE.MathUtils.clamp(axialT, 0, 1) * totalLength;
  let segment = Math.max(0, spine.samples.length - 2);
  for (let index = 0; index < spine.samples.length - 1; index++) {
    if (distance <= cumulative[index + 1]! + 1e-10) {
      segment = index;
      break;
    }
  }
  const startDistance = cumulative[segment]!;
  const segmentLength = Math.max(1e-10, cumulative[segment + 1]! - startDistance);
  const segmentT = THREE.MathUtils.clamp((distance - startDistance) / segmentLength, 0, 1);
  const start = spine.samples[segment]!;
  const end = spine.samples[segment + 1]!;
  const startFrame = frames[segment]!;
  const endFrame = frames[segment + 1]!;
  const tangent = startFrame.tangent.clone().lerp(endFrame.tangent, segmentT).normalize();
  let right = startFrame.right.clone().lerp(endFrame.right, segmentT).projectOnPlane(tangent);
  if (right.lengthSq() < 1e-10) right.copy(startFrame.up).cross(tangent);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
  return {
    segment,
    segmentT,
    position: start.position.clone().lerp(end.position, segmentT),
    radius: THREE.MathUtils.lerp(start.radius, end.radius, segmentT),
    tangent,
    right,
    up,
  };
};

const tuple3 = (value: THREE.Vector3): [number, number, number] => [value.x, value.y, value.z];

/**
 * Select deterministic attachment anchors on the radius envelope of a
 * spine-bound imported mesh. This emits placement frames and transforms; it
 * deliberately does not boolean-blend collars into the imported topology.
 */
export const createProcPlantMeshAttachments = (
  spine: ProcPlantMeshSpine,
  specs: readonly ProcPlantMeshAttachmentSpec[],
  options: ProcPlantMeshAttachmentOptions = {},
): ProcPlantMeshAttachmentPackage => {
  if (spine.contract !== "procplants.mesh-spine" || spine.version !== 1) {
    throw new Error("unsupported mesh spine contract");
  }
  const seed = options.seed ?? 1;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("mesh attachment seed must be a uint32");
  }
  const globalSpacing = finiteAttachmentNumber(options.minimumSpacing ?? 0, "mesh attachment minimumSpacing", 0);
  const globalClearance = finiteAttachmentNumber(options.clearance ?? 0.01, "mesh attachment clearance", 0);
  const maxCandidatesPerAttachment = Math.round(finiteAttachmentNumber(
    options.maxCandidatesPerAttachment ?? 48,
    "mesh attachment maxCandidatesPerAttachment",
    1,
  ));
  if (maxCandidatesPerAttachment > 512) {
    throw new Error("mesh attachment maxCandidatesPerAttachment must be at most 512");
  }

  const seenIds = new Set<string>();
  const normalizedSpecs = specs.map((spec, index) => {
    if (!spec.id.trim()) throw new Error(`mesh attachment specs[${index}].id must be non-empty`);
    if (seenIds.has(spec.id)) throw new Error(`duplicate mesh attachment spec id: ${spec.id}`);
    seenIds.add(spec.id);
    if (!(["leaf", "branch", "accessory"] as const).includes(spec.kind)) {
      throw new Error(`mesh attachment specs[${index}].kind is invalid`);
    }
    if (!Number.isInteger(spec.count) || spec.count < 0 || spec.count > 4096) {
      throw new Error(`mesh attachment specs[${index}].count must be an integer in [0, 4096]`);
    }
    const startT = finiteAttachmentNumber(spec.startT ?? 0.08, `${spec.id}.startT`, 0);
    const endT = finiteAttachmentNumber(spec.endT ?? 0.98, `${spec.id}.endT`, 0);
    if (startT > 1 || endT > 1 || endT < startT) {
      throw new Error(`${spec.id} requires 0 <= startT <= endT <= 1`);
    }
    return {
      ...spec,
      startT,
      endT,
      clearance: finiteAttachmentNumber(spec.clearance ?? globalClearance, `${spec.id}.clearance`, 0),
      minimumSpacing: Math.max(
        globalSpacing,
        finiteAttachmentNumber(spec.minimumSpacing ?? 0, `${spec.id}.minimumSpacing`, 0),
      ),
      tiltRadians: finiteAttachmentNumber(spec.tiltRadians ?? defaultAttachmentTilt(spec.kind), `${spec.id}.tiltRadians`),
      rollRadians: finiteAttachmentNumber(spec.rollRadians ?? 0, `${spec.id}.rollRadians`),
      azimuthOffsetRadians: finiteAttachmentNumber(
        spec.azimuthOffsetRadians ?? 0,
        `${spec.id}.azimuthOffsetRadians`,
      ),
      azimuthJitterRadians: finiteAttachmentNumber(
        spec.azimuthJitterRadians ?? 0.12,
        `${spec.id}.azimuthJitterRadians`,
        0,
      ),
      scale: meshAttachmentScale(spec.scale, spec.id),
    };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

  const frames = buildProcPlantParallelTransportFrames(spine.samples);
  const cumulative = cumulativeSpineLengths(spine.samples);
  const totalLength = Math.max(1e-8, cumulative.at(-1)!);
  const attachments: ProcPlantMeshAttachmentRecord[] = [];
  const groups: ProcPlantMeshAttachmentGroupResult[] = [];
  const goldenRatioConjugate = 0.6180339887498949;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (const spec of normalizedSpecs) {
    const groupSeed = meshAttachmentMix((seed ^ meshAttachmentHash(spec.id)) >>> 0);
    const axialPhase = meshAttachmentUnit(groupSeed ^ 0xa511e9b3);
    const azimuthPhase = meshAttachmentUnit(groupSeed ^ 0x63d83595) * Math.PI * 2;
    const groupRecords: ProcPlantMeshAttachmentRecord[] = [];
    let rejectedForSpacing = 0;
    const candidateLimit = Math.max(spec.count, spec.count * maxCandidatesPerAttachment);
    for (let candidateIndex = 0; candidateIndex < candidateLimit && groupRecords.length < spec.count; candidateIndex++) {
      const sequenceT = (axialPhase + candidateIndex * goldenRatioConjugate) % 1;
      const axialT = THREE.MathUtils.lerp(spec.startT, spec.endT, sequenceT);
      const frame = interpolateProcPlantSpineFrame(spine, frames, cumulative, totalLength, axialT);
      const jitter = (meshAttachmentUnit(groupSeed ^ Math.imul(candidateIndex + 1, 0x9e3779b9)) - 0.5)
        * spec.azimuthJitterRadians;
      const azimuthRadians = spec.azimuthOffsetRadians + azimuthPhase + candidateIndex * goldenAngle + jitter;
      const outward = frame.right.clone().multiplyScalar(Math.cos(azimuthRadians))
        .addScaledVector(frame.up, Math.sin(azimuthRadians)).normalize();
      const surfacePosition = frame.position.clone().addScaledVector(outward, frame.radius);
      const position = surfacePosition.clone().addScaledVector(outward, spec.clearance);
      const conflictsWith = (attachment: ProcPlantMeshAttachmentRecord) => {
        const spacing = Math.max(spec.minimumSpacing, attachment.minimumSpacing);
        return spacing > 0 &&
          position.distanceToSquared(new THREE.Vector3().fromArray(attachment.position)) + 1e-12 < spacing * spacing;
      };
      if (attachments.some(conflictsWith) || groupRecords.some(conflictsWith)) {
        rejectedForSpacing++;
        continue;
      }

      const tangent = frame.tangent.clone().multiplyScalar(Math.cos(spec.tiltRadians))
        .addScaledVector(outward, Math.sin(spec.tiltRadians)).normalize();
      let right = new THREE.Vector3().crossVectors(outward, frame.tangent).normalize();
      if (right.lengthSq() < 1e-10) right.copy(frame.right).projectOnPlane(tangent).normalize();
      let up = new THREE.Vector3().crossVectors(tangent, right).normalize();
      if (spec.rollRadians !== 0) {
        right.applyAxisAngle(tangent, spec.rollRadians).normalize();
        up = new THREE.Vector3().crossVectors(tangent, right).normalize();
      }
      const handedness = new THREE.Vector3().crossVectors(tangent, right).dot(up);
      if (handedness < 0.999999) throw new Error(`invalid generated mesh attachment frame: ${spec.id}`);
      const basisRight = right.clone().multiplyScalar(spec.scale[0]);
      const basisUp = up.clone().multiplyScalar(spec.scale[1]);
      const basisTangent = tangent.clone().multiplyScalar(spec.scale[2]);
      const transform = new THREE.Matrix4()
        .makeBasis(basisRight, basisUp, basisTangent)
        .setPosition(position)
        .toArray();
      groupRecords.push({
        id: `mesh-attachment:${spec.id}:${candidateIndex.toString().padStart(6, "0")}`,
        groupId: spec.id,
        kind: spec.kind,
        candidateIndex,
        spineSegment: frame.segment,
        spineT: frame.segmentT,
        axialT,
        azimuthRadians,
        surfaceRadius: frame.radius,
        clearance: spec.clearance,
        minimumSpacing: spec.minimumSpacing,
        sway: axialT ** 1.8,
        surfacePosition: tuple3(surfacePosition),
        position: tuple3(position),
        supportTangent: tuple3(frame.tangent),
        outward: tuple3(outward),
        tangent: tuple3(tangent),
        right: tuple3(right),
        up: tuple3(up),
        scale: spec.scale,
        transform,
      });
    }
    attachments.push(...groupRecords);
    groups.push({
      id: spec.id,
      kind: spec.kind,
      requested: spec.count,
      emitted: groupRecords.length,
      rejectedForSpacing,
    });
  }

  return {
    contract: "procplants.mesh-attachments",
    version: 1,
    seed,
    requested: normalizedSpecs.reduce((sum, spec) => sum + spec.count, 0),
    emitted: attachments.length,
    groups,
    attachments,
  };
};
