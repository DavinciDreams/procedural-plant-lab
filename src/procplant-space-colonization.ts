import * as THREE from "three";

export const PROCPLANT_FREEFORM_CROWN_CONTRACT = "procplants.freeform-crown" as const;
export const PROCPLANT_FREEFORM_CROWN_VERSION = 1 as const;
export const PROCPLANT_FREEFORM_CROWN_MAX_VOLUMES = 24 as const;
export const PROCPLANT_FREEFORM_CROWN_MAX_SERIALIZED_CHARS = 8192 as const;

export interface ProcPlantCrownControlVolume {
  id: string;
  /** Add to the crown by default, or carve the positive union when set to subtract. */
  operation?: "add" | "subtract";
  shape: "ellipsoid" | "box";
  center: readonly [number, number, number];
  /** Ellipsoid radii or full box size, depending on `shape`. */
  dimensions: readonly [number, number, number];
  /** Relative attraction density. Geometric volume is also accounted for. */
  weight?: number;
  /** Optional normalized local-to-world quaternion. Omission preserves axis-aligned V1 behavior. */
  rotation?: readonly [number, number, number, number];
}

export interface ProcPlantFreeformCrown {
  contract: typeof PROCPLANT_FREEFORM_CROWN_CONTRACT;
  version: typeof PROCPLANT_FREEFORM_CROWN_VERSION;
  volumes: readonly ProcPlantCrownControlVolume[];
}

export type ProcPlantCrownVolume =
  | { shape: "ellipsoid"; center: THREE.Vector3; radii: THREE.Vector3; rotation?: THREE.Quaternion }
  | { shape: "box"; center: THREE.Vector3; size: THREE.Vector3; rotation?: THREE.Quaternion };

export type ProcPlantCrownDomain = ProcPlantCrownVolume | ProcPlantFreeformCrown;

export interface ProcPlantSpaceColonizationOptions {
  seed?: number;
  volume: ProcPlantCrownDomain;
  attractorCount?: number;
  root?: THREE.Vector3;
  initialDirection?: THREE.Vector3;
  segmentLength?: number;
  influenceRadius?: number;
  killRadius?: number;
  collisionRadius?: number;
  maxSteps?: number;
  maxNodes?: number;
  maxChildren?: number;
  tropism?: THREE.Vector3;
  tropismStrength?: number;
  directionJitter?: number;
  pipeExponent?: number;
  tipRadius?: number;
}

export interface ProcPlantColonizationNode {
  id: string;
  parentId: string | null;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  depth: number;
  radius: number;
  childCount: number;
}

export interface ProcPlantColonizationSegment {
  id: string;
  parentSegmentId: string | null;
  startNodeId: string;
  endNodeId: string;
  depth: number;
}

export interface ProcPlantSpaceColonizationResult {
  nodes: ProcPlantColonizationNode[];
  segments: ProcPlantColonizationSegment[];
  remainingAttractors: THREE.Vector3[];
  steps: number;
  stats: {
    sampledAttractors: number;
    reachedAttractors: number;
    rejectedCollisions: number;
    terminalTips: number;
  };
}

const seededRandom = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ value >>> 15, 1 | value);
    mixed = mixed + Math.imul(mixed ^ mixed >>> 7, 61 | mixed) ^ mixed;
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
};

const finitePositive = (value: number, fallback: number, label: string) => {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) throw new Error(`${label} must be finite and positive`);
  return resolved;
};

const CONTROL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;

export const validateProcPlantFreeformCrown = (field: ProcPlantFreeformCrown): ProcPlantFreeformCrown => {
  if (field?.contract !== PROCPLANT_FREEFORM_CROWN_CONTRACT || field.version !== PROCPLANT_FREEFORM_CROWN_VERSION) {
    throw new Error("unsupported freeform crown contract or version");
  }
  if (!Array.isArray(field.volumes) || field.volumes.length < 1 || field.volumes.length > PROCPLANT_FREEFORM_CROWN_MAX_VOLUMES) {
    throw new Error(`freeform crown must contain 1..${PROCPLANT_FREEFORM_CROWN_MAX_VOLUMES} control volumes`);
  }
  const ids = new Set<string>();
  let additiveVolumes = 0;
  for (const [index, volume] of field.volumes.entries()) {
    if (!CONTROL_ID.test(volume.id) || ids.has(volume.id)) throw new Error(`freeform crown volume ${index} has an invalid or duplicate id`);
    ids.add(volume.id);
    if (volume.shape !== "ellipsoid" && volume.shape !== "box") throw new Error(`freeform crown volume ${volume.id} has an invalid shape`);
    if (volume.operation !== undefined && volume.operation !== "add" && volume.operation !== "subtract") {
      throw new Error(`freeform crown volume ${volume.id} has an invalid operation`);
    }
    if (volume.operation !== "subtract") additiveVolumes++;
    if (!Array.isArray(volume.center) || volume.center.length !== 3 ||
      !Array.isArray(volume.dimensions) || volume.dimensions.length !== 3 ||
      ![...volume.center, ...volume.dimensions].every(Number.isFinite)) {
      throw new Error(`freeform crown volume ${volume.id} requires finite 3D center and dimensions`);
    }
    if (volume.center.some((value: number) => Math.abs(value) > 1_000_000) ||
      volume.dimensions.some((value: number) => value <= 0 || value > 10_000)) {
      throw new Error(`freeform crown volume ${volume.id} exceeds spatial limits`);
    }
    if (volume.weight !== undefined && (!Number.isFinite(volume.weight) || volume.weight <= 0 || volume.weight > 100)) {
      throw new Error(`freeform crown volume ${volume.id} weight must be finite in (0, 100]`);
    }
    if (volume.operation === "subtract" && volume.weight !== undefined) {
      throw new Error(`subtractive freeform crown volume ${volume.id} cannot define attraction weight`);
    }
    if (volume.rotation !== undefined) {
      if (!Array.isArray(volume.rotation) || volume.rotation.length !== 4 || !volume.rotation.every(Number.isFinite)) {
        throw new Error(`freeform crown volume ${volume.id} rotation must be a finite quaternion`);
      }
      const lengthSq = volume.rotation.reduce((sum: number, value: number) => sum + value * value, 0);
      if (Math.abs(lengthSq - 1) > 1e-5) {
        throw new Error(`freeform crown volume ${volume.id} rotation quaternion must be normalized`);
      }
    }
  }
  if (additiveVolumes === 0) throw new Error("freeform crown requires at least one additive control volume");
  return field;
};

export const cloneProcPlantFreeformCrown = (field: ProcPlantFreeformCrown): ProcPlantFreeformCrown => {
  validateProcPlantFreeformCrown(field);
  return {
    contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
    version: PROCPLANT_FREEFORM_CROWN_VERSION,
    volumes: field.volumes.map((volume) => ({
      id: volume.id,
      ...(volume.operation === undefined ? {} : { operation: volume.operation }),
      shape: volume.shape,
      center: [...volume.center] as [number, number, number],
      dimensions: [...volume.dimensions] as [number, number, number],
      ...(volume.weight === undefined ? {} : { weight: volume.weight }),
      ...(volume.rotation === undefined ? {} : { rotation: [...volume.rotation] as [number, number, number, number] }),
    })),
  };
};

export const serializeProcPlantFreeformCrown = (field: ProcPlantFreeformCrown): string => {
  const serialized = JSON.stringify(cloneProcPlantFreeformCrown(field));
  if (serialized.length > PROCPLANT_FREEFORM_CROWN_MAX_SERIALIZED_CHARS) {
    throw new Error(`serialized freeform crown exceeds ${PROCPLANT_FREEFORM_CROWN_MAX_SERIALIZED_CHARS} characters`);
  }
  return serialized;
};

export const deserializeProcPlantFreeformCrown = (serialized: string): ProcPlantFreeformCrown => {
  if (typeof serialized !== "string" || serialized.length < 1 || serialized.length > PROCPLANT_FREEFORM_CROWN_MAX_SERIALIZED_CHARS) {
    throw new Error(`serialized freeform crown must contain 1..${PROCPLANT_FREEFORM_CROWN_MAX_SERIALIZED_CHARS} characters`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`invalid freeform crown JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("freeform crown JSON must contain an object");
  return cloneProcPlantFreeformCrown(parsed as ProcPlantFreeformCrown);
};

const cloneVolume = (volume: ProcPlantCrownVolume): ProcPlantCrownVolume => volume.shape === "ellipsoid"
  ? { shape: "ellipsoid", center: volume.center.clone(), radii: volume.radii.clone(), ...(volume.rotation ? { rotation: volume.rotation.clone() } : {}) }
  : { shape: "box", center: volume.center.clone(), size: volume.size.clone(), ...(volume.rotation ? { rotation: volume.rotation.clone() } : {}) };

const validateVolume = (volume: ProcPlantCrownVolume) => {
  const dimensions = volume.shape === "ellipsoid" ? volume.radii : volume.size;
  if (![volume.center.x, volume.center.y, volume.center.z, dimensions.x, dimensions.y, dimensions.z,
    ...(volume.rotation ? [volume.rotation.x, volume.rotation.y, volume.rotation.z, volume.rotation.w] : [])].every(Number.isFinite)) {
    throw new Error("crown volume values must be finite");
  }
  if (dimensions.x <= 0 || dimensions.y <= 0 || dimensions.z <= 0) {
    throw new Error("crown volume dimensions must be positive");
  }
  if (volume.rotation && Math.abs(volume.rotation.lengthSq() - 1) > 1e-5) {
    throw new Error("crown volume rotation quaternion must be normalized");
  }
};

const isFreeformCrown = (domain: ProcPlantCrownDomain): domain is ProcPlantFreeformCrown =>
  "contract" in domain;

const controlToVolume = (control: ProcPlantCrownControlVolume): ProcPlantCrownVolume => {
  const center = new THREE.Vector3(...control.center);
  const dimensions = new THREE.Vector3(...control.dimensions);
  const rotation = control.rotation ? new THREE.Quaternion(...control.rotation) : undefined;
  return control.shape === "ellipsoid"
    ? { shape: "ellipsoid", center, radii: dimensions, ...(rotation ? { rotation } : {}) }
    : { shape: "box", center, size: dimensions, ...(rotation ? { rotation } : {}) };
};

const domainVolumes = (domain: ProcPlantCrownDomain): ProcPlantCrownVolume[] =>
  isFreeformCrown(domain)
    ? cloneProcPlantFreeformCrown(domain).volumes.map(controlToVolume)
    : [cloneVolume(domain)];

const domainCenter = (domain: ProcPlantCrownDomain) => {
  if (!isFreeformCrown(domain)) return domain.center.clone();
  validateProcPlantFreeformCrown(domain);
  const center = new THREE.Vector3();
  let total = 0;
  for (const control of domain.volumes) {
    if (control.operation === "subtract") continue;
    const weight = control.weight ?? 1;
    center.addScaledVector(new THREE.Vector3(...control.center), weight);
    total += weight;
  }
  return center.multiplyScalar(1 / total);
};

/** Deterministically sample attraction points without mutating the supplied volume. */
export const sampleProcPlantCrownAttractors = (
  source: ProcPlantCrownDomain,
  count: number,
  seed = 1,
): THREE.Vector3[] => {
  if (!Number.isInteger(count) || count < 0 || count > 100_000) throw new Error("attractor count must be an integer in [0, 100000]");
  if (!isFreeformCrown(source)) {
    const volume = cloneVolume(source);
    validateVolume(volume);
    const random = seededRandom(seed);
    const points: THREE.Vector3[] = [];
    while (points.length < count) {
      const unit = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (volume.shape === "ellipsoid") {
        if (unit.lengthSq() > 1) continue;
        unit.multiply(volume.radii);
        if (volume.rotation) unit.applyQuaternion(volume.rotation);
        points.push(unit.add(volume.center));
      } else {
        unit.multiply(volume.size).multiplyScalar(0.5);
        if (volume.rotation) unit.applyQuaternion(volume.rotation);
        points.push(unit.add(volume.center));
      }
    }
    return points;
  }
  const field = cloneProcPlantFreeformCrown(source);
  const additiveControls = field.volumes.filter((control) => control.operation !== "subtract");
  const subtractiveVolumes = field.volumes.filter((control) => control.operation === "subtract").map(controlToVolume);
  const volumes = additiveControls.map(controlToVolume);
  const cumulativeWeights: number[] = [];
  let totalWeight = 0;
  for (let index = 0; index < volumes.length; index++) {
    const dimensions = additiveControls[index]!.dimensions;
    const shapeFactor = additiveControls[index]!.shape === "ellipsoid" ? 4 * Math.PI / 3 : 1;
    totalWeight += dimensions[0] * dimensions[1] * dimensions[2] * shapeFactor * (additiveControls[index]!.weight ?? 1);
    cumulativeWeights.push(totalWeight);
  }
  const random = seededRandom(seed);
  const points: THREE.Vector3[] = [];
  const maximumAttempts = Math.max(1_000, count * 100);
  let attempts = 0;
  while (points.length < count && attempts++ < maximumAttempts) {
    const selection = random() * totalWeight;
    let selectedIndex = cumulativeWeights.findIndex((weight) => selection < weight);
    if (selectedIndex < 0) selectedIndex = volumes.length - 1;
    const volume = volumes[selectedIndex]!;
    const unit = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    if (volume.shape === "ellipsoid") {
      if (unit.lengthSq() > 1) continue;
      unit.multiply(volume.radii);
      if (volume.rotation) unit.applyQuaternion(volume.rotation);
      unit.add(volume.center);
      if (!subtractiveVolumes.some((candidate) => insideVolume(unit, candidate))) points.push(unit);
    } else {
      unit.multiply(volume.size).multiplyScalar(0.5);
      if (volume.rotation) unit.applyQuaternion(volume.rotation);
      unit.add(volume.center);
      if (!subtractiveVolumes.some((candidate) => insideVolume(unit, candidate))) points.push(unit);
    }
  }
  if (points.length !== count) {
    throw new Error(`freeform crown could sample only ${points.length}/${count} attractors after ${maximumAttempts} attempts`);
  }
  return points;
};

class SpatialHash {
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly cellSize: number) {}

  private coordinate(value: number) {
    return Math.floor(value / this.cellSize);
  }

  private key(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }

  rebuild(nodes: readonly ProcPlantColonizationNode[]) {
    this.cells.clear();
    for (let index = 0; index < nodes.length; index++) {
      const position = nodes[index]!.position;
      const key = this.key(this.coordinate(position.x), this.coordinate(position.y), this.coordinate(position.z));
      const values = this.cells.get(key) ?? [];
      values.push(index);
      this.cells.set(key, values);
    }
  }

  query(position: THREE.Vector3, radius: number, out: number[]) {
    out.length = 0;
    const reach = Math.ceil(radius / this.cellSize);
    const cx = this.coordinate(position.x);
    const cy = this.coordinate(position.y);
    const cz = this.coordinate(position.z);
    for (let z = cz - reach; z <= cz + reach; z++) {
      for (let y = cy - reach; y <= cy + reach; y++) {
        for (let x = cx - reach; x <= cx + reach; x++) {
          const values = this.cells.get(this.key(x, y, z));
          if (values) out.push(...values);
        }
      }
    }
    return out;
  }
}

const insideVolume = (point: THREE.Vector3, volume: ProcPlantCrownVolume) => {
  const local = point.clone().sub(volume.center);
  if (volume.rotation) local.applyQuaternion(volume.rotation.clone().invert());
  if (volume.shape === "box") {
    return Math.abs(local.x) <= volume.size.x * 0.5 &&
      Math.abs(local.y) <= volume.size.y * 0.5 &&
      Math.abs(local.z) <= volume.size.z * 0.5;
  }
  local.divide(volume.radii);
  return local.lengthSq() <= 1;
};

const insideCrownDomain = (
  point: THREE.Vector3,
  domain: ProcPlantCrownDomain,
  volumes: readonly ProcPlantCrownVolume[],
) => {
  if (!isFreeformCrown(domain)) return insideVolume(point, volumes[0]!);
  let insideAdditive = false;
  for (let index = 0; index < volumes.length; index++) {
    const inside = insideVolume(point, volumes[index]!);
    if (domain.volumes[index]!.operation === "subtract") {
      if (inside) return false;
    } else if (inside) insideAdditive = true;
  }
  return insideAdditive;
};

const finalizePipeRadii = (nodes: ProcPlantColonizationNode[], exponent: number, tipRadius: number) => {
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const flow = new Float64Array(nodes.length);
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!;
    if (flow[index] === 0) flow[index] = 1;
    node.radius = tipRadius * Math.pow(flow[index], 1 / exponent);
    if (node.parentId) {
      const parent = indexById.get(node.parentId);
      if (parent !== undefined) flow[parent] += flow[index];
    }
  }
};

/**
 * Grow a static crown skeleton using a spatially indexed 3D space-colonization pass.
 * The output is deterministic and contains pipe-model radii ready for tube meshing.
 */
export const growProcPlantSpaceColonization = (
  options: ProcPlantSpaceColonizationOptions,
): ProcPlantSpaceColonizationResult => {
  if (isFreeformCrown(options.volume)) validateProcPlantFreeformCrown(options.volume);
  else validateVolume(options.volume);
  const crownVolumes = domainVolumes(options.volume);
  const seed = options.seed ?? 1;
  const attractorCount = Math.max(1, Math.min(100_000, Math.round(options.attractorCount ?? 420)));
  const segmentLength = finitePositive(options.segmentLength ?? 0.22, 0.22, "segmentLength");
  const influenceRadius = finitePositive(options.influenceRadius ?? segmentLength * 5, segmentLength * 5, "influenceRadius");
  const killRadius = finitePositive(options.killRadius ?? segmentLength * 1.35, segmentLength * 1.35, "killRadius");
  const collisionRadius = Math.max(0, options.collisionRadius ?? segmentLength * 0.42);
  if (killRadius >= influenceRadius) throw new Error("killRadius must be smaller than influenceRadius");
  const maxSteps = Math.max(1, Math.min(10_000, Math.round(options.maxSteps ?? 180)));
  const maxNodes = Math.max(2, Math.min(100_000, Math.round(options.maxNodes ?? 4_000)));
  const maxChildren = Math.max(1, Math.min(8, Math.round(options.maxChildren ?? 2)));
  const pipeExponent = finitePositive(options.pipeExponent ?? 2.2, 2.2, "pipeExponent");
  const tipRadius = finitePositive(options.tipRadius ?? segmentLength * 0.055, segmentLength * 0.055, "tipRadius");
  const tropismStrength = THREE.MathUtils.clamp(options.tropismStrength ?? 0.08, 0, 1);
  const directionJitter = THREE.MathUtils.clamp(options.directionJitter ?? 0.04, 0, 1);
  const tropism = (options.tropism ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
  const crownCenter = domainCenter(options.volume);
  const root = (options.root ?? new THREE.Vector3(crownCenter.x, 0, crownCenter.z)).clone();
  const initialDirection = (options.initialDirection ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
  const random = seededRandom(seed ^ 0x9e3779b9);
  let attractors = sampleProcPlantCrownAttractors(options.volume, attractorCount, seed ^ 0x85ebca6b);
  const nodes: ProcPlantColonizationNode[] = [{
    id: "crown-node:0",
    parentId: null,
    position: root,
    direction: initialDirection,
    depth: 0,
    radius: tipRadius,
    childCount: 0,
  }];
  const segments: ProcPlantColonizationSegment[] = [];
  const segmentByEndNode = new Map<string, string>();
  const hash = new SpatialHash(Math.max(influenceRadius, collisionRadius * 2, segmentLength));
  const nearby: number[] = [];
  const sums: THREE.Vector3[] = [];
  const counts: number[] = [];
  let rejectedCollisions = 0;
  let steps = 0;

  for (; steps < maxSteps && nodes.length < maxNodes && attractors.length > 0; steps++) {
    hash.rebuild(nodes);
    sums.length = nodes.length;
    counts.length = nodes.length;
    for (let index = 0; index < nodes.length; index++) {
      sums[index] = new THREE.Vector3();
      counts[index] = 0;
    }
    const surviving: THREE.Vector3[] = [];
    for (const attractor of attractors) {
      hash.query(attractor, influenceRadius, nearby);
      let nearest = -1;
      let nearestDistanceSq = Number.POSITIVE_INFINITY;
      let reached = false;
      for (const nodeIndex of nearby) {
        const node = nodes[nodeIndex]!;
        const distanceSq = node.position.distanceToSquared(attractor);
        if (distanceSq <= killRadius * killRadius) {
          reached = true;
          break;
        }
        if (node.childCount < maxChildren && distanceSq < nearestDistanceSq && distanceSq <= influenceRadius * influenceRadius) {
          nearest = nodeIndex;
          nearestDistanceSq = distanceSq;
        }
      }
      if (reached) continue;
      surviving.push(attractor);
      if (nearest >= 0) {
        sums[nearest]!.add(attractor.clone().sub(nodes[nearest]!.position).normalize());
        counts[nearest] = counts[nearest]! + 1;
      }
    }
    attractors = surviving;

    const additions: Array<{ parentIndex: number; direction: THREE.Vector3; position: THREE.Vector3 }> = [];
    for (let parentIndex = 0; parentIndex < nodes.length && nodes.length + additions.length < maxNodes; parentIndex++) {
      if (!counts[parentIndex]) continue;
      const parent = nodes[parentIndex]!;
      const direction = sums[parentIndex]!.multiplyScalar(1 / counts[parentIndex]!).normalize();
      direction.lerp(tropism, tropismStrength);
      direction.add(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(directionJitter));
      if (parent.childCount > 0) {
        direction.addScaledVector(parent.direction, -0.12 * parent.childCount);
      }
      direction.normalize();
      const position = parent.position.clone().addScaledVector(direction, segmentLength);
      if (!insideCrownDomain(position, options.volume, crownVolumes) && parent.position.distanceTo(crownCenter) > influenceRadius) continue;
      if (collisionRadius > 0) {
        hash.query(position, collisionRadius, nearby);
        const collision = nearby.some((nodeIndex) => nodeIndex !== parentIndex && nodes[nodeIndex]!.position.distanceToSquared(position) < collisionRadius ** 2);
        if (collision) {
          rejectedCollisions++;
          continue;
        }
      }
      additions.push({ parentIndex, direction, position });
    }

    // If the root has not entered the crown's influence volume, extend it toward
    // the nearest attractor so sparse or elevated volumes cannot deadlock.
    if (additions.length === 0 && attractors.length > 0 && nodes.length < maxNodes) {
      let parentIndex = nodes.length - 1;
      let nearest = attractors[0]!;
      let distanceSq = nodes[parentIndex]!.position.distanceToSquared(nearest);
      for (const attractor of attractors) {
        const candidate = nodes[parentIndex]!.position.distanceToSquared(attractor);
        if (candidate < distanceSq) {
          nearest = attractor;
          distanceSq = candidate;
        }
      }
      const direction = nearest.clone().sub(nodes[parentIndex]!.position).normalize().lerp(tropism, tropismStrength).normalize();
      additions.push({ parentIndex, direction, position: nodes[parentIndex]!.position.clone().addScaledVector(direction, segmentLength) });
    }

    if (additions.length === 0) break;
    for (const addition of additions) {
      const parent = nodes[addition.parentIndex]!;
      const node: ProcPlantColonizationNode = {
        id: `crown-node:${nodes.length}`,
        parentId: parent.id,
        position: addition.position,
        direction: addition.direction,
        depth: parent.depth + 1,
        radius: tipRadius,
        childCount: 0,
      };
      const segment: ProcPlantColonizationSegment = {
        id: `crown-segment:${segments.length}`,
        parentSegmentId: segmentByEndNode.get(parent.id) ?? null,
        startNodeId: parent.id,
        endNodeId: node.id,
        depth: node.depth,
      };
      parent.childCount++;
      nodes.push(node);
      segments.push(segment);
      segmentByEndNode.set(node.id, segment.id);
    }
  }

  finalizePipeRadii(nodes, pipeExponent, tipRadius);
  return {
    nodes,
    segments,
    remainingAttractors: attractors.map((point) => point.clone()),
    steps,
    stats: {
      sampledAttractors: attractorCount,
      reachedAttractors: attractorCount - attractors.length,
      rejectedCollisions,
      terminalTips: nodes.filter((node) => node.childCount === 0).length,
    },
  };
};
