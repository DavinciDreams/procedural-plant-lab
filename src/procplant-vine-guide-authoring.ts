import type { ProcPlantGenome, ProcPlantGuidePoint } from "./procplants";

export const PROCPLANT_VINE_GUIDE_AUTHORING_CONTRACT = "procplants.vine-guide-authoring" as const;
export const PROCPLANT_VINE_GUIDE_AUTHORING_VERSION = 1 as const;
export const PROCPLANT_VINE_GUIDE_SOURCE_SIGNATURE_VERSION = 1 as const;
export const PROCPLANT_VINE_GUIDE_MAX_POINTS = 32;
export const PROCPLANT_VINE_GUIDE_MAX_COORDINATE = 1_000_000;
export const PROCPLANT_VINE_GUIDE_MIN_POINT_SPACING = 1e-4;

export interface ProcPlantVineGuideTarget {
  genomeId: string;
  seed: number;
  sourceSignatureVersion: typeof PROCPLANT_VINE_GUIDE_SOURCE_SIGNATURE_VERSION;
  sourceSignature: string;
}

export interface ProcPlantVineGuidePoint {
  id: string;
  ordinal: number;
  position: ProcPlantGuidePoint;
}

export interface ProcPlantVineGuidePackage {
  contract: typeof PROCPLANT_VINE_GUIDE_AUTHORING_CONTRACT;
  version: typeof PROCPLANT_VINE_GUIDE_AUTHORING_VERSION;
  target: ProcPlantVineGuideTarget;
  nextOrdinal: number;
  points: ProcPlantVineGuidePoint[];
}

export type ProcPlantVineGuideApplyStatus = "canonical" | "draft" | "applied" | "unsupported";

export interface ProcPlantVineGuideApplyResult {
  genome: ProcPlantGenome;
  changed: boolean;
  targetMatched: boolean;
  status: ProcPlantVineGuideApplyStatus;
  reason: "no-package" | "insufficient-points" | "target-mismatch" | "unsupported-genome" | null;
}

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const finiteCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= PROCPLANT_VINE_GUIDE_MAX_COORDINATE;

const validPosition = (value: unknown): value is ProcPlantGuidePoint =>
  Array.isArray(value) && value.length === 3 && value.every(finiteCoordinate);

const validIdentifier = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 128;

const cloneTarget = (target: ProcPlantVineGuideTarget): ProcPlantVineGuideTarget => ({ ...target });
const clonePoint = (point: ProcPlantVineGuidePoint): ProcPlantVineGuidePoint => ({
  id: point.id,
  ordinal: point.ordinal,
  position: [...point.position] as [number, number, number],
});

const stableSource = (genome: ProcPlantGenome) => JSON.stringify({
  id: genome.id,
  nodeCount: genome.nodeCount,
  vine: genome.vine ?? null,
});

export const procPlantVineGuideSourceSignature = (genome: ProcPlantGenome) =>
  `vine-v${PROCPLANT_VINE_GUIDE_SOURCE_SIGNATURE_VERSION}-${fnv1a(stableSource(genome))}`;

export const createProcPlantVineGuideTarget = (
  genome: ProcPlantGenome,
  seed: number,
): ProcPlantVineGuideTarget => {
  if (!genome.vine) throw new Error("vine guide authoring requires a vine genome");
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("vine guide authoring seed must be a non-negative safe integer");
  return {
    genomeId: genome.id,
    seed,
    sourceSignatureVersion: PROCPLANT_VINE_GUIDE_SOURCE_SIGNATURE_VERSION,
    sourceSignature: procPlantVineGuideSourceSignature(genome),
  };
};

export const createProcPlantVineGuidePackage = (
  target: ProcPlantVineGuideTarget,
): ProcPlantVineGuidePackage => ({
  contract: PROCPLANT_VINE_GUIDE_AUTHORING_CONTRACT,
  version: PROCPLANT_VINE_GUIDE_AUTHORING_VERSION,
  target: cloneTarget(target),
  nextOrdinal: 0,
  points: [],
});

function assertValidPackage(value: unknown): asserts value is ProcPlantVineGuidePackage {
  if (!value || typeof value !== "object") throw new Error("vine guide package must be an object");
  const candidate = value as Partial<ProcPlantVineGuidePackage>;
  if (candidate.contract !== PROCPLANT_VINE_GUIDE_AUTHORING_CONTRACT) throw new Error("unsupported vine guide contract");
  if (candidate.version !== PROCPLANT_VINE_GUIDE_AUTHORING_VERSION) throw new Error("unsupported vine guide version");
  const target = candidate.target as Partial<ProcPlantVineGuideTarget> | undefined;
  if (!target || !validIdentifier(target.genomeId) || !Number.isSafeInteger(target.seed) || Number(target.seed) < 0
    || target.sourceSignatureVersion !== PROCPLANT_VINE_GUIDE_SOURCE_SIGNATURE_VERSION
    || !validIdentifier(target.sourceSignature)) {
    throw new Error("invalid vine guide target");
  }
  if (!Number.isSafeInteger(candidate.nextOrdinal) || Number(candidate.nextOrdinal) < 0) {
    throw new Error("invalid vine guide next ordinal");
  }
  if (!Array.isArray(candidate.points) || candidate.points.length > PROCPLANT_VINE_GUIDE_MAX_POINTS) {
    throw new Error(`vine guide supports at most ${PROCPLANT_VINE_GUIDE_MAX_POINTS} points`);
  }
  const ids = new Set<string>();
  let previousOrdinal = -1;
  let previousPosition: ProcPlantGuidePoint | null = null;
  for (const point of candidate.points) {
    if (!point || typeof point !== "object" || !validIdentifier(point.id)
      || !Number.isSafeInteger(point.ordinal) || point.ordinal < 0 || point.ordinal <= previousOrdinal
      || point.ordinal >= Number(candidate.nextOrdinal)
      || point.id !== `vine-guide-point:${String(point.ordinal).padStart(4, "0")}`
      || ids.has(point.id) || !validPosition(point.position)
      || (previousPosition !== null && Math.hypot(
        point.position[0] - previousPosition[0],
        point.position[1] - previousPosition[1],
        point.position[2] - previousPosition[2],
      ) < PROCPLANT_VINE_GUIDE_MIN_POINT_SPACING)) {
      throw new Error("invalid vine guide point record");
    }
    ids.add(point.id);
    previousOrdinal = point.ordinal;
    previousPosition = point.position;
  }
}

const clonedPackage = (value: ProcPlantVineGuidePackage): ProcPlantVineGuidePackage => ({
  contract: value.contract,
  version: value.version,
  target: cloneTarget(value.target),
  nextOrdinal: value.nextOrdinal,
  points: value.points.map(clonePoint),
});

export const appendProcPlantVineGuidePoint = (
  authored: ProcPlantVineGuidePackage,
  position: ProcPlantGuidePoint,
): ProcPlantVineGuidePackage => {
  assertValidPackage(authored);
  if (!validPosition(position)) throw new Error("vine guide point coordinates must be finite and bounded");
  if (authored.points.length >= PROCPLANT_VINE_GUIDE_MAX_POINTS) {
    throw new Error(`vine guide supports at most ${PROCPLANT_VINE_GUIDE_MAX_POINTS} points`);
  }
  const previous = authored.points.at(-1)?.position;
  if (previous && Math.hypot(position[0] - previous[0], position[1] - previous[1], position[2] - previous[2]) < PROCPLANT_VINE_GUIDE_MIN_POINT_SPACING) {
    throw new Error("vine guide point is too close to the preceding point");
  }
  const ordinal = authored.nextOrdinal;
  return {
    ...clonedPackage(authored),
    nextOrdinal: ordinal + 1,
    points: [...authored.points.map(clonePoint), {
      id: `vine-guide-point:${String(ordinal).padStart(4, "0")}`,
      ordinal,
      position: [...position] as [number, number, number],
    }],
  };
};

export const updateProcPlantVineGuidePoint = (
  authored: ProcPlantVineGuidePackage,
  pointId: string,
  position: ProcPlantGuidePoint,
): ProcPlantVineGuidePackage => {
  assertValidPackage(authored);
  if (!validPosition(position)) throw new Error("vine guide point coordinates must be finite and bounded");
  const index = authored.points.findIndex((point) => point.id === pointId);
  if (index < 0) throw new Error(`unknown vine guide point: ${pointId}`);
  for (const neighborIndex of [index - 1, index + 1]) {
    const neighbor = authored.points[neighborIndex]?.position;
    if (neighbor && Math.hypot(position[0] - neighbor[0], position[1] - neighbor[1], position[2] - neighbor[2]) < PROCPLANT_VINE_GUIDE_MIN_POINT_SPACING) {
      throw new Error("vine guide point is too close to an adjacent point");
    }
  }
  const next = clonedPackage(authored);
  next.points[index] = { ...next.points[index]!, position: [...position] as [number, number, number] };
  return next;
};

export const undoLastProcPlantVineGuidePoint = (
  authored: ProcPlantVineGuidePackage,
): ProcPlantVineGuidePackage => {
  assertValidPackage(authored);
  if (authored.points.length === 0) return authored;
  const next = clonedPackage(authored);
  next.points.pop();
  return next;
};

export const serializeProcPlantVineGuidePackage = (authored: ProcPlantVineGuidePackage): string => {
  assertValidPackage(authored);
  return JSON.stringify(clonedPackage(authored));
};

export const deserializeProcPlantVineGuidePackage = (serialized: string): ProcPlantVineGuidePackage => {
  if (serialized.length > 16_384) throw new Error("vine guide package exceeds the 16 KiB serialized limit");
  const parsed: unknown = JSON.parse(serialized);
  assertValidPackage(parsed);
  return clonedPackage(parsed);
};

const sameTarget = (left: ProcPlantVineGuideTarget, right: ProcPlantVineGuideTarget) =>
  left.genomeId === right.genomeId
  && left.seed === right.seed
  && left.sourceSignatureVersion === right.sourceSignatureVersion
  && left.sourceSignature === right.sourceSignature;

/**
 * Applies only a static authored centerline. The result deliberately disables
 * synthesized support clearance, sag, and inertial drift; it does not claim
 * live support collision, attachment, deformation, or surface conformance.
 */
export const applyProcPlantVineGuidePackage = (
  genome: ProcPlantGenome,
  seed: number,
  authored: ProcPlantVineGuidePackage | null | undefined,
): ProcPlantVineGuideApplyResult => {
  if (!authored) return { genome, changed: false, targetMatched: true, status: "canonical", reason: "no-package" };
  assertValidPackage(authored);
  if (!genome.vine) return { genome, changed: false, targetMatched: false, status: "unsupported", reason: "unsupported-genome" };
  const target = createProcPlantVineGuideTarget(genome, seed);
  if (!sameTarget(target, authored.target)) {
    return { genome, changed: false, targetMatched: false, status: "unsupported", reason: "target-mismatch" };
  }
  if (authored.points.length < 2) {
    return { genome, changed: false, targetMatched: true, status: "draft", reason: "insufficient-points" };
  }
  const guide = authored.points.map((point) => [...point.position] as [number, number, number]);
  return {
    genome: {
      ...genome,
      vine: {
        ...genome.vine,
        mode: "follow",
        guide,
        adhesion: 1,
        avoidanceRadius: 0,
        sag: 0,
      },
    },
    changed: true,
    targetMatched: true,
    status: "applied",
    reason: null,
  };
};
