import * as THREE from "three";
import type {
  ProcPlantAttachmentAnchor,
  ProcPlantAttachmentKind,
  ProcPlantGraph,
  ProcPlantOrgan,
} from "./procplants";

export const PROCPLANT_FOLIAGE_RELAXATION_CONTRACT = "procplants.foliage-relaxation" as const;
export const PROCPLANT_FOLIAGE_RELAXATION_VERSION = 1 as const;

export interface ProcPlantFoliageCandidate {
  id: string;
  parentSegmentId: string | null;
  position: THREE.Vector3;
  supportTangent: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  halfWidth: number;
  halfLength: number;
  halfThickness?: number;
}

export interface ProcPlantFoliageFootprint {
  width: number;
  length: number;
  thickness?: number;
}

export interface ProcPlantStemCapsule {
  id: string;
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
}

export interface ProcPlantFoliageRelaxationOptions {
  maxIterations?: number;
  maxOffset?: number;
  maxRotationRadians?: number;
  separationPadding?: number;
  stemClearance?: number;
  translationStrength?: number;
  rotationStrength?: number;
  broadPhase?: "auto" | "spatial-hash" | "exhaustive";
  spatialHashThreshold?: number;
  spatialCellSize?: number;
}

export interface ProcPlantFoliageGraphOptions extends ProcPlantFoliageRelaxationOptions {
  includeKinds?: readonly ProcPlantAttachmentKind[];
  defaultWidthRatio?: number;
  defaultThicknessRatio?: number;
  footprints?: Readonly<Record<string, ProcPlantFoliageFootprint>>;
  stemRadiusScale?: number;
}

export interface ProcPlantRelaxedFoliageAttachment {
  id: string;
  parentSegmentId: string | null;
  originalPosition: THREE.Vector3;
  position: THREE.Vector3;
  offset: THREE.Vector3;
  supportTangent: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  normal: THREE.Vector3;
  rotationRadians: number;
  halfWidth: number;
  halfLength: number;
  halfThickness: number;
}

export type ProcPlantFoliageCollision =
  | { type: "organ-organ"; a: string; b: string; penetration: number }
  | { type: "stem"; attachmentId: string; capsuleId: string; penetration: number };

export interface ProcPlantFoliageRelaxationReport {
  contract: typeof PROCPLANT_FOLIAGE_RELAXATION_CONTRACT;
  version: typeof PROCPLANT_FOLIAGE_RELAXATION_VERSION;
  iterations: number;
  initialCollisionCount: number;
  unresolvedCollisionCount: number;
  unresolved: ProcPlantFoliageCollision[];
  maxOffsetReachedIds: string[];
  maxRotationReachedIds: string[];
}

export interface ProcPlantFoliageRelaxationAudit {
  requestedBroadPhase: "auto" | "spatial-hash" | "exhaustive";
  broadPhase: "spatial-hash" | "exhaustive";
  spatialCellSize: number | null;
  possibleOrganPairsPerPass: number;
  organPairPasses: number;
  organPairsTested: number;
  organPairsTestedByPass: number[];
  spatialBucketCountsByPass: number[];
  stemTests: number;
}

export interface ProcPlantFoliageRelaxationResult {
  attachments: ProcPlantRelaxedFoliageAttachment[];
  report: ProcPlantFoliageRelaxationReport;
  audit: ProcPlantFoliageRelaxationAudit;
}

export interface ProcPlantGraphFoliageRelaxationResult extends ProcPlantFoliageRelaxationResult {
  graph: ProcPlantGraph;
}

const DEFAULT_FOLIAGE_KINDS: readonly ProcPlantAttachmentKind[] = [
  "leaf",
  "flower",
  "grassBlade",
  "fernLeaflet",
  "coniferSpray",
  "fernFrond",
  "palmFrond",
  "mossTuft",
];

const finite = (value: number, label: string, minimum = -Infinity) => {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be finite${minimum > -Infinity ? ` and at least ${minimum}` : ""}`);
  }
  return value;
};

const stableHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const stableFallback = (id: string, tangent: THREE.Vector3) => {
  const axis = stableHash(id) % 3;
  const reference = axis === 0
    ? new THREE.Vector3(1, 0, 0)
    : axis === 1
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
  let direction = reference.projectOnPlane(tangent);
  if (direction.lengthSq() < 1e-10) direction = new THREE.Vector3(1, 1, 1).projectOnPlane(tangent);
  return direction.normalize();
};

const validateVector = (value: THREE.Vector3, label: string) => {
  if (!(value instanceof THREE.Vector3) || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new Error(`${label} must be a finite Vector3`);
  }
};

interface RelaxationState {
  source: ProcPlantFoliageCandidate;
  supportTangent: THREE.Vector3;
  originalForward: THREE.Vector3;
  originalRight: THREE.Vector3;
  originalPosition: THREE.Vector3;
  offset: THREE.Vector3;
  rotation: number;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  normal: THREE.Vector3;
  center: THREE.Vector3;
  half: [number, number, number];
}

const refreshState = (state: RelaxationState) => {
  state.forward.copy(state.originalForward).applyAxisAngle(state.supportTangent, state.rotation).normalize();
  state.right.copy(state.originalRight).applyAxisAngle(state.supportTangent, state.rotation).projectOnPlane(state.forward);
  if (state.right.lengthSq() < 1e-10) state.right.copy(stableFallback(state.source.id, state.forward));
  state.right.normalize();
  state.normal.crossVectors(state.right, state.forward).normalize();
  state.center.copy(state.originalPosition).add(state.offset).addScaledVector(state.forward, state.source.halfLength);
};

const candidateState = (candidate: ProcPlantFoliageCandidate): RelaxationState => {
  if (!candidate.id.trim()) throw new Error("foliage candidate id must be non-empty");
  validateVector(candidate.position, `${candidate.id}.position`);
  validateVector(candidate.supportTangent, `${candidate.id}.supportTangent`);
  validateVector(candidate.forward, `${candidate.id}.forward`);
  validateVector(candidate.right, `${candidate.id}.right`);
  const supportTangent = candidate.supportTangent.clone();
  const forward = candidate.forward.clone();
  if (supportTangent.lengthSq() < 1e-10 || forward.lengthSq() < 1e-10) {
    throw new Error(`${candidate.id} supportTangent and forward must be non-zero`);
  }
  supportTangent.normalize();
  forward.normalize();
  let right = candidate.right.clone().projectOnPlane(forward);
  if (right.lengthSq() < 1e-10) right = stableFallback(candidate.id, forward);
  right.normalize();
  const halfWidth = finite(candidate.halfWidth, `${candidate.id}.halfWidth`, 1e-8);
  const halfLength = finite(candidate.halfLength, `${candidate.id}.halfLength`, 1e-8);
  const halfThickness = finite(candidate.halfThickness ?? Math.min(halfWidth, halfLength) * 0.03, `${candidate.id}.halfThickness`, 1e-8);
  const state: RelaxationState = {
    source: candidate,
    supportTangent,
    originalForward: forward,
    originalRight: right,
    originalPosition: candidate.position.clone(),
    offset: new THREE.Vector3(),
    rotation: 0,
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    center: new THREE.Vector3(),
    half: [halfWidth, halfLength, halfThickness],
  };
  refreshState(state);
  return state;
};

const stateAxes = (state: RelaxationState): readonly THREE.Vector3[] => [state.right, state.forward, state.normal];

const cardAxisPenetration = (
  a: RelaxationState,
  b: RelaxationState,
  sourceAxis: THREE.Vector3,
  padding: number,
) => {
  const axis = sourceAxis.clone().normalize();
  const aAxes = stateAxes(a);
  const bAxes = stateAxes(b);
  const aRadius = a.half.reduce((sum, half, index) => sum + (half + padding) * Math.abs(axis.dot(aAxes[index]!)), 0);
  const bRadius = b.half.reduce((sum, half, index) => sum + (half + padding) * Math.abs(axis.dot(bAxes[index]!)), 0);
  return Math.max(0, aRadius + bRadius - Math.abs(b.center.clone().sub(a.center).dot(axis)));
};

const cardOverlap = (a: RelaxationState, b: RelaxationState, padding: number) => {
  const aAxes = stateAxes(a);
  const bAxes = stateAxes(b);
  const delta = b.center.clone().sub(a.center);
  const axes: THREE.Vector3[] = [...aAxes.map((axis) => axis.clone()), ...bAxes.map((axis) => axis.clone())];
  for (const aAxis of aAxes) {
    for (const bAxis of bAxes) {
      const cross = new THREE.Vector3().crossVectors(aAxis, bAxis);
      if (cross.lengthSq() > 1e-12) axes.push(cross.normalize());
    }
  }
  let minimumPenetration = Infinity;
  let minimumAxis = new THREE.Vector3();
  for (const axis of axes) {
    axis.normalize();
    const aRadius = a.half.reduce((sum, half, index) => sum + (half + padding) * Math.abs(axis.dot(aAxes[index]!)), 0);
    const bRadius = b.half.reduce((sum, half, index) => sum + (half + padding) * Math.abs(axis.dot(bAxes[index]!)), 0);
    const signedDistance = delta.dot(axis);
    const penetration = aRadius + bRadius - Math.abs(signedDistance);
    if (penetration <= 1e-9) return null;
    if (penetration < minimumPenetration) {
      minimumPenetration = penetration;
      minimumAxis.copy(axis).multiplyScalar(signedDistance < 0 ? -1 : 1);
    }
  }
  if (delta.lengthSq() < 1e-14 && (stableHash(`${a.source.id}|${b.source.id}`) & 1) !== 0) minimumAxis.negate();
  return { axis: minimumAxis, penetration: minimumPenetration };
};

const capsuleAxisPoint = (point: THREE.Vector3, capsule: ProcPlantStemCapsule) => {
  const axis = capsule.end.clone().sub(capsule.start);
  const t = THREE.MathUtils.clamp(point.clone().sub(capsule.start).dot(axis) / axis.lengthSq(), 0, 1);
  return capsule.start.clone().addScaledVector(axis, t);
};

const stemOverlap = (
  state: RelaxationState,
  capsule: ProcPlantStemCapsule,
  clearance: number,
  padding: number,
) => {
  const axisPoint = capsuleAxisPoint(state.center, capsule);
  let direction = state.center.clone().sub(axisPoint);
  const distance = direction.length();
  if (distance < 1e-10) direction = stableFallback(`${state.source.id}|${capsule.id}`, state.supportTangent);
  else direction.multiplyScalar(1 / distance);
  const cardRadius = Math.hypot(state.half[0] + padding, state.half[1] + padding, state.half[2] + padding);
  const penetration = capsule.radius + clearance + cardRadius - distance;
  return penetration > 1e-9 ? { axis: direction, penetration } : null;
};

const validateCapsules = (capsules: readonly ProcPlantStemCapsule[]) => {
  const sorted = [...capsules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (let index = 0; index < sorted.length; index++) {
    const capsule = sorted[index]!;
    if (!capsule.id.trim()) throw new Error("stem capsule id must be non-empty");
    if (index > 0 && sorted[index - 1]!.id === capsule.id) throw new Error(`duplicate stem capsule id: ${capsule.id}`);
    validateVector(capsule.start, `${capsule.id}.start`);
    validateVector(capsule.end, `${capsule.id}.end`);
    finite(capsule.radius, `${capsule.id}.radius`, 1e-8);
    if (capsule.start.distanceToSquared(capsule.end) < 1e-12) throw new Error(`${capsule.id} endpoints must differ`);
  }
  return sorted;
};

type ProcPlantOrganPair = readonly [number, number];

const exhaustiveOrganPairs = (count: number): ProcPlantOrganPair[] => {
  const pairs: ProcPlantOrganPair[] = [];
  for (let left = 0; left < count; left++) {
    for (let right = left + 1; right < count; right++) pairs.push([left, right]);
  }
  return pairs;
};

const cardBoundingRadius = (state: RelaxationState, padding: number) =>
  Math.hypot(state.half[0] + padding, state.half[1] + padding, state.half[2] + padding);

const spatialOrganPairs = (
  states: readonly RelaxationState[],
  padding: number,
  cellSize: number,
) => {
  const buckets = new Map<string, number[]>();
  for (let index = 0; index < states.length; index++) {
    const state = states[index]!;
    const radius = cardBoundingRadius(state, padding) + 1e-9;
    const minimum = state.center.clone().addScalar(-radius).multiplyScalar(1 / cellSize).floor();
    const maximum = state.center.clone().addScalar(radius).multiplyScalar(1 / cellSize).floor();
    const cells = (maximum.x - minimum.x + 1) * (maximum.y - minimum.y + 1) * (maximum.z - minimum.z + 1);
    if (cells > 4096) {
      throw new Error("spatialCellSize is too small for the foliage candidate extents");
    }
    for (let x = minimum.x; x <= maximum.x; x++) {
      for (let y = minimum.y; y <= maximum.y; y++) {
        for (let z = minimum.z; z <= maximum.z; z++) {
          const key = `${x},${y},${z}`;
          const bucket = buckets.get(key) ?? [];
          bucket.push(index);
          buckets.set(key, bucket);
        }
      }
    }
  }
  const pairKeys = new Set<string>();
  for (const bucket of buckets.values()) {
    for (let left = 0; left < bucket.length; left++) {
      for (let right = left + 1; right < bucket.length; right++) {
        pairKeys.add(`${bucket[left]!}:${bucket[right]!}`);
      }
    }
  }
  const pairs = [...pairKeys].map((key): ProcPlantOrganPair => {
    const separator = key.indexOf(":");
    return [Number(key.slice(0, separator)), Number(key.slice(separator + 1))];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { pairs, bucketCount: buckets.size };
};

const buildOrganPairs = (
  states: readonly RelaxationState[],
  padding: number,
  broadPhase: "spatial-hash" | "exhaustive",
  cellSize: number,
) => broadPhase === "spatial-hash"
  ? spatialOrganPairs(states, padding, cellSize)
  : { pairs: exhaustiveOrganPairs(states.length), bucketCount: 0 };

const detectCollisions = (
  states: readonly RelaxationState[],
  capsules: readonly ProcPlantStemCapsule[],
  padding: number,
  stemClearance: number,
  organPairs: readonly ProcPlantOrganPair[],
) => {
  const collisions: ProcPlantFoliageCollision[] = [];
  for (const [left, right] of organPairs) {
    const overlap = cardOverlap(states[left]!, states[right]!, padding);
    if (overlap) collisions.push({
      type: "organ-organ",
      a: states[left]!.source.id,
      b: states[right]!.source.id,
      penetration: overlap.penetration,
    });
  }
  for (const state of states) {
    for (const capsule of capsules) {
      const overlap = stemOverlap(state, capsule, stemClearance, padding);
      if (overlap) collisions.push({
        type: "stem",
        attachmentId: state.source.id,
        capsuleId: capsule.id,
        penetration: overlap.penetration,
      });
    }
  }
  return collisions;
};

/** Deterministically relax card-like foliage candidates without mutating input. */
export const relaxProcPlantFoliageCandidates = (
  candidates: readonly ProcPlantFoliageCandidate[],
  capsules: readonly ProcPlantStemCapsule[] = [],
  options: ProcPlantFoliageRelaxationOptions = {},
): ProcPlantFoliageRelaxationResult => {
  const states = candidates.map(candidateState).sort((a, b) =>
    a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0
  );
  for (let index = 1; index < states.length; index++) {
    if (states[index - 1]!.source.id === states[index]!.source.id) {
      throw new Error(`duplicate foliage candidate id: ${states[index]!.source.id}`);
    }
  }
  const stableCapsules = validateCapsules(capsules);
  const maxIterations = Math.max(1, Math.min(64, Math.round(finite(options.maxIterations ?? 12, "maxIterations", 1))));
  const maxOffset = finite(options.maxOffset ?? 0.18, "maxOffset", 0);
  const maxRotation = finite(options.maxRotationRadians ?? 0.38, "maxRotationRadians", 0);
  const padding = finite(options.separationPadding ?? 0.006, "separationPadding", 0);
  const stemClearance = finite(options.stemClearance ?? 0.004, "stemClearance", 0);
  const translationStrength = THREE.MathUtils.clamp(finite(options.translationStrength ?? 0.72, "translationStrength", 0), 0, 1);
  const rotationStrength = THREE.MathUtils.clamp(finite(options.rotationStrength ?? 0.18, "rotationStrength", 0), 0, 1);
  const requestedBroadPhase = options.broadPhase ?? "auto";
  if (!(requestedBroadPhase === "auto" || requestedBroadPhase === "spatial-hash" || requestedBroadPhase === "exhaustive")) {
    throw new Error("broadPhase must be auto, spatial-hash, or exhaustive");
  }
  const spatialHashThreshold = options.spatialHashThreshold ?? 24;
  if (!Number.isInteger(spatialHashThreshold) || spatialHashThreshold < 2) {
    throw new Error("spatialHashThreshold must be an integer of at least 2");
  }
  const broadPhase: "spatial-hash" | "exhaustive" = requestedBroadPhase === "auto"
    ? states.length >= spatialHashThreshold ? "spatial-hash" : "exhaustive"
    : requestedBroadPhase;
  const automaticCellSize = states.reduce(
    (maximum, state) => Math.max(maximum, cardBoundingRadius(state, padding) * 2),
    1e-6,
  );
  const spatialCellSize = options.spatialCellSize === undefined
    ? automaticCellSize
    : finite(options.spatialCellSize, "spatialCellSize", 1e-8);
  const organPairsTestedByPass: number[] = [];
  const spatialBucketCountsByPass: number[] = [];
  let stemTests = 0;
  let initialCollisionCount = 0;
  let iterations = 0;

  for (let pass = 0; pass < maxIterations; pass++) {
    const pairSelection = buildOrganPairs(states, padding, broadPhase, spatialCellSize);
    organPairsTestedByPass.push(pairSelection.pairs.length);
    spatialBucketCountsByPass.push(pairSelection.bucketCount);
    const translations = states.map(() => new THREE.Vector3());
    const rotations = new Float64Array(states.length);
    const weights = new Uint32Array(states.length);
    let collisionCount = 0;
    for (const [left, right] of pairSelection.pairs) {
        const a = states[left]!;
        const b = states[right]!;
        const overlap = cardOverlap(a, b, padding);
        if (!overlap) continue;
        collisionCount++;
        const correction = overlap.axis.clone().multiplyScalar(overlap.penetration * 0.5);
        let aCorrection = correction.clone().negate().projectOnPlane(a.supportTangent);
        let bCorrection = correction.clone().projectOnPlane(b.supportTangent);
        if (aCorrection.lengthSq() < 1e-12 || bCorrection.lengthSq() < 1e-12) {
          const pairFallback = stableFallback(`${a.source.id}|${b.source.id}`, a.supportTangent);
          const fallbackPenetration = Math.max(
            overlap.penetration,
            cardAxisPenetration(a, b, pairFallback, padding),
          );
          aCorrection = pairFallback.clone().multiplyScalar(-fallbackPenetration * 0.5);
          let bFallback = pairFallback.clone().projectOnPlane(b.supportTangent);
          if (bFallback.lengthSq() < 1e-12) bFallback = stableFallback(`${a.source.id}|${b.source.id}`, b.supportTangent);
          bCorrection = bFallback.normalize().multiplyScalar(fallbackPenetration * 0.5);
        }
        translations[left]!.add(aCorrection);
        translations[right]!.add(bCorrection);
        const sign = (stableHash(`${a.source.id}|${b.source.id}`) & 1) === 0 ? 1 : -1;
        const normalizedPenetration = overlap.penetration / Math.max(a.half[0], a.half[1], b.half[0], b.half[1], 1e-8);
        rotations[left] += sign * normalizedPenetration;
        rotations[right] -= sign * normalizedPenetration;
        weights[left]++;
        weights[right]++;
    }
    for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
      const state = states[stateIndex]!;
      for (const capsule of stableCapsules) {
        stemTests++;
        const overlap = stemOverlap(state, capsule, stemClearance, padding);
        if (!overlap) continue;
        collisionCount++;
        let correction = overlap.axis.clone().multiplyScalar(overlap.penetration).projectOnPlane(state.supportTangent);
        if (correction.lengthSq() < 1e-12) {
          correction = stableFallback(`${state.source.id}|${capsule.id}`, state.supportTangent).multiplyScalar(overlap.penetration);
        }
        translations[stateIndex]!.add(correction);
        weights[stateIndex]++;
      }
    }
    if (pass === 0) initialCollisionCount = collisionCount;
    if (collisionCount === 0) break;
    iterations = pass + 1;
    for (let index = 0; index < states.length; index++) {
      const state = states[index]!;
      const weight = Math.max(1, weights[index]!);
      state.offset.addScaledVector(translations[index]!, translationStrength / weight).projectOnPlane(state.supportTangent);
      if (state.offset.length() > maxOffset) state.offset.setLength(maxOffset);
      state.rotation = THREE.MathUtils.clamp(
        state.rotation + rotations[index]! * rotationStrength / weight,
        -maxRotation,
        maxRotation,
      );
      refreshState(state);
    }
  }

  const finalPairSelection = buildOrganPairs(states, padding, broadPhase, spatialCellSize);
  organPairsTestedByPass.push(finalPairSelection.pairs.length);
  spatialBucketCountsByPass.push(finalPairSelection.bucketCount);
  stemTests += states.length * stableCapsules.length;
  const unresolved = detectCollisions(
    states,
    stableCapsules,
    padding,
    stemClearance,
    finalPairSelection.pairs,
  );
  return {
    attachments: states.map((state) => ({
      id: state.source.id,
      parentSegmentId: state.source.parentSegmentId,
      originalPosition: state.originalPosition.clone(),
      position: state.originalPosition.clone().add(state.offset),
      offset: state.offset.clone(),
      supportTangent: state.supportTangent.clone(),
      forward: state.forward.clone(),
      right: state.right.clone(),
      normal: state.normal.clone(),
      rotationRadians: state.rotation,
      halfWidth: state.half[0],
      halfLength: state.half[1],
      halfThickness: state.half[2],
    })),
    report: {
      contract: PROCPLANT_FOLIAGE_RELAXATION_CONTRACT,
      version: PROCPLANT_FOLIAGE_RELAXATION_VERSION,
      iterations,
      initialCollisionCount,
      unresolvedCollisionCount: unresolved.length,
      unresolved,
      maxOffsetReachedIds: states.filter((state) => maxOffset > 0 && state.offset.length() >= maxOffset - 1e-8).map((state) => state.source.id),
      maxRotationReachedIds: states.filter((state) => maxRotation > 0 && Math.abs(state.rotation) >= maxRotation - 1e-8).map((state) => state.source.id),
    },
    audit: {
      requestedBroadPhase,
      broadPhase,
      spatialCellSize: broadPhase === "spatial-hash" ? spatialCellSize : null,
      possibleOrganPairsPerPass: states.length * (states.length - 1) / 2,
      organPairPasses: organPairsTestedByPass.length,
      organPairsTested: organPairsTestedByPass.reduce((sum, count) => sum + count, 0),
      organPairsTestedByPass,
      spatialBucketCountsByPass,
      stemTests,
    },
  };
};

export const createProcPlantFoliageCandidatesFromAttachments = (
  attachments: readonly ProcPlantAttachmentAnchor[],
  footprints: Readonly<Record<string, ProcPlantFoliageFootprint>> = {},
): ProcPlantFoliageCandidate[] => attachments.map((attachment) => {
  const footprint = footprints[attachment.id] ?? { width: 0.12, length: 0.24, thickness: 0.008 };
  return {
    id: attachment.id,
    parentSegmentId: attachment.parentSegmentId,
    position: attachment.position.clone(),
    supportTangent: attachment.tangent.clone(),
    forward: attachment.up.clone(),
    right: attachment.right.clone(),
    halfWidth: finite(footprint.width, `${attachment.id}.width`, 1e-8) * 0.5,
    halfLength: finite(footprint.length, `${attachment.id}.length`, 1e-8) * 0.5,
    halfThickness: finite(footprint.thickness ?? Math.min(footprint.width, footprint.length) * 0.03, `${attachment.id}.thickness`, 1e-8) * 0.5,
  };
});

export const createProcPlantStemCapsulesFromGraph = (
  graph: ProcPlantGraph,
  radiusScale = 1,
): ProcPlantStemCapsule[] => {
  const scale = finite(radiusScale, "stemRadiusScale", 0);
  if (scale === 0) return [];
  return graph.segmentRecords.map((record) => {
    const start = graph.stems[record.startNodeIndex];
    const end = graph.stems[record.endNodeIndex];
    if (!start || !end) throw new Error(`segment ${record.id} references missing stem nodes`);
    return {
      id: record.id,
      start: start.position.clone(),
      end: end.position.clone(),
      radius: Math.max(start.radius, end.radius) * scale,
    };
  });
};

const graphCandidates = (
  graph: ProcPlantGraph,
  options: ProcPlantFoliageGraphOptions,
) => {
  const included = new Set(options.includeKinds ?? DEFAULT_FOLIAGE_KINDS);
  const widthRatio = finite(options.defaultWidthRatio ?? 0.45, "defaultWidthRatio", 1e-8);
  const thicknessRatio = finite(options.defaultThicknessRatio ?? 0.025, "defaultThicknessRatio", 1e-8);
  return graph.attachments.flatMap((attachment): ProcPlantFoliageCandidate[] => {
    if (!included.has(attachment.kind)) return [];
    const organ = attachment.organIndex === null ? undefined : graph.organs[attachment.organIndex];
    const footprint = options.footprints?.[attachment.id];
    const length = footprint?.length ?? Math.max(0.01, organ?.scale ?? 0.2);
    const width = footprint?.width ?? length * widthRatio;
    const thickness = footprint?.thickness ?? length * thicknessRatio;
    return [{
      id: attachment.id,
      parentSegmentId: attachment.parentSegmentId,
      position: (organ?.position ?? attachment.position).clone(),
      supportTangent: attachment.tangent.clone(),
      forward: (organ?.direction ?? attachment.up).clone(),
      right: (organ?.right ?? attachment.right).clone(),
      halfWidth: finite(width, `${attachment.id}.width`, 1e-8) * 0.5,
      halfLength: finite(length, `${attachment.id}.length`, 1e-8) * 0.5,
      halfThickness: finite(thickness, `${attachment.id}.thickness`, 1e-8) * 0.5,
    }];
  });
};

const cloneOrgan = (organ: ProcPlantOrgan): ProcPlantOrgan => ({
  ...organ,
  position: organ.position.clone(),
  direction: organ.direction.clone(),
  right: organ.right.clone(),
});

/** Relax a public graph directly and return a structurally cloned graph. */
export const relaxProcPlantGraphFoliage = (
  source: ProcPlantGraph,
  options: ProcPlantFoliageGraphOptions = {},
): ProcPlantGraphFoliageRelaxationResult => {
  const result = relaxProcPlantFoliageCandidates(
    graphCandidates(source, options),
    createProcPlantStemCapsulesFromGraph(source, options.stemRadiusScale ?? 1),
    options,
  );
  const relaxedById = new Map(result.attachments.map((attachment) => [attachment.id, attachment]));
  const organs = source.organs.map(cloneOrgan);
  const attachments = source.attachments.map((attachment): ProcPlantAttachmentAnchor => {
    const relaxed = relaxedById.get(attachment.id);
    if (!relaxed) return {
      ...attachment,
      position: attachment.position.clone(),
      tangent: attachment.tangent.clone(),
      right: attachment.right.clone(),
      up: attachment.up.clone(),
    };
    if (attachment.organIndex !== null && organs[attachment.organIndex]) {
      organs[attachment.organIndex]!.position.copy(relaxed.position);
      organs[attachment.organIndex]!.direction.copy(relaxed.forward);
      organs[attachment.organIndex]!.right.copy(relaxed.right);
    }
    const tangent = attachment.tangent.clone().normalize();
    let right = attachment.right.clone().applyAxisAngle(tangent, relaxed.rotationRadians).projectOnPlane(tangent);
    if (right.lengthSq() < 1e-10) right = stableFallback(attachment.id, tangent);
    right.normalize();
    return {
      ...attachment,
      position: relaxed.position.clone(),
      tangent,
      right,
      up: new THREE.Vector3().crossVectors(tangent, right).normalize(),
    };
  });
  return {
    ...result,
    graph: {
      stems: source.stems.map((stem) => ({
        ...stem,
        position: stem.position.clone(),
        direction: stem.direction.clone(),
      })),
      segments: source.segments.map(([start, end]) => [start, end]),
      organs,
      segmentRecords: source.segmentRecords.map((record) => ({ ...record })),
      attachments,
    },
  };
};
