export const PROCPLANT_GUIDE_QUERY_CONTRACT = "procplants.scene-guide-query" as const;
export const PROCPLANT_GUIDE_QUERY_VERSION = 1 as const;

export type ProcPlantVec3 = [number, number, number];
export type ProcPlantGuideRole = "obstacle" | "attractor" | "repulsor";
export type ProcPlantGuideFalloff = "linear" | "smooth" | "quadratic";

interface ProcPlantSceneObjectBase {
  id: string;
  role: ProcPlantGuideRole;
  enabled?: boolean;
  strength?: number;
  influenceRadius?: number;
  falloff?: ProcPlantGuideFalloff;
}

export type ProcPlantSceneGuideObject = ProcPlantSceneObjectBase & (
  | { shape: "sphere"; center: ProcPlantVec3; radius: number }
  | { shape: "capsule"; start: ProcPlantVec3; end: ProcPlantVec3; radius: number }
  | { shape: "plane"; point: ProcPlantVec3; normal: ProcPlantVec3 }
  | { shape: "box"; center: ProcPlantVec3; halfExtents: ProcPlantVec3 }
);

export interface ProcPlantObjectQuery {
  objectId: string;
  role: ProcPlantGuideRole;
  shape: ProcPlantSceneGuideObject["shape"];
  /** Signed distance to the surface. Negative values are inside an obstacle volume. */
  distance: number;
  closestPoint: ProcPlantVec3;
  normal: ProcPlantVec3;
  inside: boolean;
}

export interface ProcPlantClearanceQuery {
  contract: typeof PROCPLANT_GUIDE_QUERY_CONTRACT;
  version: typeof PROCPLANT_GUIDE_QUERY_VERSION;
  clearanceRadius: number;
  /** Null when the scene contains no enabled obstacle. */
  clearance: number | null;
  colliding: boolean;
  nearest: ProcPlantObjectQuery | null;
}

export interface ProcPlantGrowthTipSampleOptions {
  position: ProcPlantVec3;
  direction: ProcPlantVec3;
  stepLength: number;
  tipRadius?: number;
  steeringStrength?: number;
  maxResolvePasses?: number;
}

export interface ProcPlantGuideContribution {
  objectId: string;
  role: ProcPlantGuideRole;
  shape: ProcPlantSceneGuideObject["shape"];
  distance: number;
  weight: number;
  direction: ProcPlantVec3;
}

export interface ProcPlantGrowthTipSample {
  contract: typeof PROCPLANT_GUIDE_QUERY_CONTRACT;
  version: typeof PROCPLANT_GUIDE_QUERY_VERSION;
  position: ProcPlantVec3;
  steeredDirection: ProcPlantVec3;
  candidatePosition: ProcPlantVec3;
  resolvedPosition: ProcPlantVec3;
  resolvedDirection: ProcPlantVec3;
  correction: ProcPlantVec3;
  blocked: boolean;
  clearance: number | null;
  nearestObstacleId: string | null;
  resolvedObjectIds: string[];
  contributions: ProcPlantGuideContribution[];
}

const EPSILON = 1e-9;

const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};

const vector = (value: ProcPlantVec3, label: string): ProcPlantVec3 => {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must be a 3-number tuple`);
  return [finite(value[0], `${label}[0]`), finite(value[1], `${label}[1]`), finite(value[2], `${label}[2]`)];
};

const add = (left: ProcPlantVec3, right: ProcPlantVec3): ProcPlantVec3 =>
  [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
const subtract = (left: ProcPlantVec3, right: ProcPlantVec3): ProcPlantVec3 =>
  [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
const scale = (value: ProcPlantVec3, amount: number): ProcPlantVec3 =>
  [value[0] * amount, value[1] * amount, value[2] * amount];
const dot = (left: ProcPlantVec3, right: ProcPlantVec3) =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
const length = (value: ProcPlantVec3) => Math.hypot(value[0], value[1], value[2]);
const normalize = (value: ProcPlantVec3, fallback: ProcPlantVec3 = [1, 0, 0]): ProcPlantVec3 => {
  const magnitude = length(value);
  return magnitude > EPSILON ? scale(value, 1 / magnitude) : [...fallback];
};
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const sign = (value: number) => value < 0 ? -1 : 1;

const validateObject = (object: ProcPlantSceneGuideObject) => {
  if (!object.id.trim()) throw new Error("scene object id must not be empty");
  const strength = finite(object.strength ?? 1, `${object.id}.strength`);
  if (strength < 0) throw new Error(`${object.id}.strength must not be negative`);
  const influenceRadius = finite(object.influenceRadius ?? 1, `${object.id}.influenceRadius`);
  if (influenceRadius <= 0) throw new Error(`${object.id}.influenceRadius must be positive`);
  if (object.shape === "sphere") {
    vector(object.center, `${object.id}.center`);
    if (finite(object.radius, `${object.id}.radius`) <= 0) throw new Error(`${object.id}.radius must be positive`);
  } else if (object.shape === "capsule") {
    const start = vector(object.start, `${object.id}.start`);
    const end = vector(object.end, `${object.id}.end`);
    if (finite(object.radius, `${object.id}.radius`) <= 0) throw new Error(`${object.id}.radius must be positive`);
    if (length(subtract(end, start)) <= EPSILON) throw new Error(`${object.id} capsule endpoints must differ`);
  } else if (object.shape === "plane") {
    vector(object.point, `${object.id}.point`);
    if (length(vector(object.normal, `${object.id}.normal`)) <= EPSILON) throw new Error(`${object.id}.normal must not be zero`);
  } else {
    vector(object.center, `${object.id}.center`);
    const halfExtents = vector(object.halfExtents, `${object.id}.halfExtents`);
    if (halfExtents.some((component) => component <= 0)) throw new Error(`${object.id}.halfExtents must be positive`);
  }
};

const stableObjects = (objects: readonly ProcPlantSceneGuideObject[]) => {
  const enabled = objects.filter((object) => object.enabled !== false).slice().sort((left, right) => left.id.localeCompare(right.id));
  for (let index = 0; index < enabled.length; index++) {
    validateObject(enabled[index]!);
    if (index > 0 && enabled[index - 1]!.id === enabled[index]!.id) throw new Error(`duplicate scene object id: ${enabled[index]!.id}`);
  }
  return enabled;
};

const capsuleAxisPoint = (point: ProcPlantVec3, start: ProcPlantVec3, end: ProcPlantVec3) => {
  const axis = subtract(end, start);
  const axisLengthSq = dot(axis, axis);
  const t = clamp(dot(subtract(point, start), axis) / axisLengthSq, 0, 1);
  return add(start, scale(axis, t));
};

/** Query one primitive using a conventional signed-distance surface result. */
export const queryProcPlantSceneObject = (
  object: ProcPlantSceneGuideObject,
  sourcePoint: ProcPlantVec3,
): ProcPlantObjectQuery => {
  validateObject(object);
  const point = vector(sourcePoint, "point");
  let distance: number;
  let normal: ProcPlantVec3;
  let closestPoint: ProcPlantVec3;

  if (object.shape === "sphere") {
    const offset = subtract(point, object.center);
    const magnitude = length(offset);
    normal = normalize(offset);
    distance = magnitude - object.radius;
    closestPoint = add(object.center, scale(normal, object.radius));
  } else if (object.shape === "capsule") {
    const axisPoint = capsuleAxisPoint(point, object.start, object.end);
    const offset = subtract(point, axisPoint);
    const magnitude = length(offset);
    normal = normalize(offset);
    distance = magnitude - object.radius;
    closestPoint = add(axisPoint, scale(normal, object.radius));
  } else if (object.shape === "plane") {
    normal = normalize(object.normal);
    distance = dot(subtract(point, object.point), normal);
    closestPoint = subtract(point, scale(normal, distance));
  } else {
    const local = subtract(point, object.center);
    const excess: ProcPlantVec3 = [
      Math.abs(local[0]) - object.halfExtents[0],
      Math.abs(local[1]) - object.halfExtents[1],
      Math.abs(local[2]) - object.halfExtents[2],
    ];
    const outside: ProcPlantVec3 = [Math.max(0, excess[0]), Math.max(0, excess[1]), Math.max(0, excess[2])];
    const outsideDistance = length(outside);
    if (outsideDistance > EPSILON) {
      normal = normalize([outside[0] * sign(local[0]), outside[1] * sign(local[1]), outside[2] * sign(local[2])]);
      distance = outsideDistance;
    } else {
      let axis = 0;
      if (excess[1] > excess[axis]) axis = 1;
      if (excess[2] > excess[axis]) axis = 2;
      normal = [0, 0, 0];
      normal[axis] = sign(local[axis]);
      distance = excess[axis];
    }
    closestPoint = subtract(point, scale(normal, distance));
  }

  return {
    objectId: object.id,
    role: object.role,
    shape: object.shape,
    distance,
    closestPoint,
    normal,
    inside: distance < 0,
  };
};

const nearestObstacle = (
  objects: readonly ProcPlantSceneGuideObject[],
  point: ProcPlantVec3,
  clearanceRadius: number,
) => {
  let nearest: ProcPlantObjectQuery | null = null;
  let clearance: number | null = null;
  for (const object of objects) {
    if (object.role !== "obstacle") continue;
    const query = queryProcPlantSceneObject(object, point);
    const candidate = query.distance - clearanceRadius;
    if (clearance === null || candidate < clearance || (candidate === clearance && query.objectId < nearest!.objectId)) {
      nearest = query;
      clearance = candidate;
    }
  }
  return { nearest, clearance };
};

/** Find the nearest enabled obstacle, accounting for branch/tip thickness. */
export const queryProcPlantClearance = (
  objects: readonly ProcPlantSceneGuideObject[],
  sourcePoint: ProcPlantVec3,
  clearanceRadius = 0,
): ProcPlantClearanceQuery => {
  const point = vector(sourcePoint, "point");
  const radius = finite(clearanceRadius, "clearanceRadius");
  if (radius < 0) throw new Error("clearanceRadius must not be negative");
  const { nearest, clearance } = nearestObstacle(stableObjects(objects), point, radius);
  return {
    contract: PROCPLANT_GUIDE_QUERY_CONTRACT,
    version: PROCPLANT_GUIDE_QUERY_VERSION,
    clearanceRadius: radius,
    clearance,
    colliding: clearance !== null && clearance < 0,
    nearest,
  };
};

const guideTarget = (object: ProcPlantSceneGuideObject, point: ProcPlantVec3): ProcPlantVec3 => {
  if (object.shape === "sphere") return [...object.center];
  if (object.shape === "capsule") return capsuleAxisPoint(point, object.start, object.end);
  if (object.shape === "plane") return queryProcPlantSceneObject(object, point).closestPoint;
  return [
    clamp(point[0], object.center[0] - object.halfExtents[0], object.center[0] + object.halfExtents[0]),
    clamp(point[1], object.center[1] - object.halfExtents[1], object.center[1] + object.halfExtents[1]),
    clamp(point[2], object.center[2] - object.halfExtents[2], object.center[2] + object.halfExtents[2]),
  ];
};

const falloffWeight = (object: ProcPlantSceneGuideObject, distance: number) => {
  const radius = object.influenceRadius ?? 1;
  const proximity = 1 - clamp(Math.max(0, distance) / radius, 0, 1);
  if ((object.falloff ?? "smooth") === "linear") return proximity;
  if (object.falloff === "quadratic") return proximity * proximity;
  return proximity * proximity * (3 - 2 * proximity);
};

/**
 * Blend guide attraction and obstacle/repulsor avoidance for one growth tip,
 * then project its candidate point outside enabled obstacles. No render objects,
 * callbacks, or random state are used, so the result is deterministic and JSON-safe.
 */
export const sampleProcPlantGrowthTip = (
  sourceObjects: readonly ProcPlantSceneGuideObject[],
  options: ProcPlantGrowthTipSampleOptions,
): ProcPlantGrowthTipSample => {
  const objects = stableObjects(sourceObjects);
  const position = vector(options.position, "position");
  const sourceDirection = vector(options.direction, "direction");
  if (length(sourceDirection) <= EPSILON) throw new Error("direction must not be zero");
  const baseDirection = normalize(sourceDirection);
  const stepLength = finite(options.stepLength, "stepLength");
  if (stepLength <= 0) throw new Error("stepLength must be positive");
  const tipRadius = finite(options.tipRadius ?? 0, "tipRadius");
  if (tipRadius < 0) throw new Error("tipRadius must not be negative");
  const steeringStrength = finite(options.steeringStrength ?? 1, "steeringStrength");
  if (steeringStrength < 0) throw new Error("steeringStrength must not be negative");
  const maxResolvePasses = Math.max(1, Math.min(16, Math.round(options.maxResolvePasses ?? 4)));
  const contributions: ProcPlantGuideContribution[] = [];
  let steering: ProcPlantVec3 = [0, 0, 0];

  for (const object of objects) {
    const query = queryProcPlantSceneObject(object, position);
    let contributionDirection: ProcPlantVec3;
    let influenceDistance: number;
    if (object.role === "attractor") {
      const toward = subtract(guideTarget(object, position), position);
      influenceDistance = length(toward);
      if (influenceDistance <= EPSILON || influenceDistance > (object.influenceRadius ?? 1)) continue;
      contributionDirection = scale(toward, 1 / influenceDistance);
    } else {
      influenceDistance = query.distance - tipRadius;
      if (influenceDistance > (object.influenceRadius ?? 1)) continue;
      contributionDirection = query.normal;
    }
    const weight = falloffWeight(object, influenceDistance) * (object.strength ?? 1);
    if (weight <= 0) continue;
    steering = add(steering, scale(contributionDirection, weight));
    contributions.push({
      objectId: object.id,
      role: object.role,
      shape: object.shape,
      distance: influenceDistance,
      weight,
      direction: contributionDirection,
    });
  }

  const steeredDirection = normalize(add(baseDirection, scale(steering, steeringStrength)), baseDirection);
  const candidatePosition = add(position, scale(steeredDirection, stepLength));
  let resolvedPosition: ProcPlantVec3 = [...candidatePosition];
  const resolvedIds = new Set<string>();
  for (let pass = 0; pass < maxResolvePasses; pass++) {
    let changed = false;
    for (const object of objects) {
      if (object.role !== "obstacle") continue;
      const query = queryProcPlantSceneObject(object, resolvedPosition);
      const deficit = tipRadius - query.distance;
      if (deficit <= EPSILON) continue;
      resolvedPosition = add(resolvedPosition, scale(query.normal, deficit + EPSILON));
      resolvedIds.add(object.id);
      changed = true;
    }
    if (!changed) break;
  }
  const correction = subtract(resolvedPosition, candidatePosition);
  const displacement = subtract(resolvedPosition, position);
  const resolvedDirection = normalize(displacement, steeredDirection);
  const finalClearance = nearestObstacle(objects, resolvedPosition, tipRadius);

  return {
    contract: PROCPLANT_GUIDE_QUERY_CONTRACT,
    version: PROCPLANT_GUIDE_QUERY_VERSION,
    position: [...position],
    steeredDirection,
    candidatePosition,
    resolvedPosition,
    resolvedDirection,
    correction,
    blocked: length(correction) > EPSILON,
    clearance: finalClearance.clearance,
    nearestObstacleId: finalClearance.nearest?.objectId ?? null,
    resolvedObjectIds: [...resolvedIds].sort(),
    contributions,
  };
};
