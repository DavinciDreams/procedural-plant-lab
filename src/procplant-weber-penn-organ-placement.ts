import * as THREE from "three";
import type {
  ProcPlantAttachmentAnchor,
  ProcPlantGraph,
} from "./procplants";
import type { ProcPlantWeberPennTrimTarget } from "./procplant-weber-penn-trim";

export const PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_CONTRACT = "procplants.weber-penn-organ-placement-overrides" as const;
export const PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_VERSION = 1 as const;
export const PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_MAX_OVERRIDES = 96;

export const PROCPLANT_WEBER_PENN_PLACEABLE_ORGAN_KINDS = Object.freeze([
  "leaf",
  "flower",
  "fruit",
  "berry",
  "cone",
] as const);
export type ProcPlantWeberPennPlaceableOrganKind = typeof PROCPLANT_WEBER_PENN_PLACEABLE_ORGAN_KINDS[number];

export interface ProcPlantWeberPennOrganPlacementOperation {
  id: string;
  ordinal: number;
  kind: ProcPlantWeberPennPlaceableOrganKind;
  /** Exact stable native leaf-site or branch-tip identity. Mid-stem coordinates are intentionally absent. */
  attachmentId: string;
  roll: number;
  scale: number;
  color?: number;
  secondaryColor?: number;
}

export interface ProcPlantWeberPennOrganPlacementPackage {
  contract: typeof PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_CONTRACT;
  version: typeof PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_VERSION;
  target: ProcPlantWeberPennTrimTarget & { topologySignature: string };
  operations: ProcPlantWeberPennOrganPlacementOperation[];
}

export interface ProcPlantWeberPennOrganPlacementInput {
  kind: ProcPlantWeberPennPlaceableOrganKind;
  attachmentId: string;
  roll?: number;
  scale: number;
  color?: number;
  secondaryColor?: number;
}

export interface ProcPlantWeberPennOrganPlacementAppendResult {
  package: ProcPlantWeberPennOrganPlacementPackage;
  operation: ProcPlantWeberPennOrganPlacementOperation | null;
  reason: "cap" | "occupied" | "invalid" | null;
}

export type ProcPlantWeberPennOrganPlacementOperationStatus = "applied" | "unsupported";
export interface ProcPlantWeberPennOrganPlacementOperationAudit {
  operationId: string;
  status: ProcPlantWeberPennOrganPlacementOperationStatus;
  attachmentId: string;
  ownerStemId: string | null;
  outputAttachmentId: string | null;
  reason: "invalid" | "missing-attachment" | "missing-owner" | "incompatible-kind" | "flower-unavailable" | "occupied" | null;
}

export interface ProcPlantWeberPennOrganPlacementAudit {
  status: "no-op" | "applied" | "partial" | "unsupported" | "target-mismatch";
  sourceTopologySignature: string;
  beforeOrgans: number;
  afterOrgans: number;
  beforeAttachments: number;
  afterAttachments: number;
  appliedOperationIds: string[];
  operations: ProcPlantWeberPennOrganPlacementOperationAudit[];
}

export interface ProcPlantWeberPennOrganPlacementSource {
  target: ProcPlantWeberPennTrimTarget & { topologySignature: string };
  graph: ProcPlantGraph;
  /** Exact native attachment identity to baked owner stem identity. */
  attachmentStemIds: Readonly<Record<string, string>>;
  flowerAvailable: boolean;
}

export interface ProcPlantWeberPennOrganPlacementResult {
  graph: ProcPlantGraph;
  changed: boolean;
  audit: ProcPlantWeberPennOrganPlacementAudit;
}

const KIND_SET: ReadonlySet<string> = new Set(PROCPLANT_WEBER_PENN_PLACEABLE_ORGAN_KINDS);
const isKind = (value: unknown): value is ProcPlantWeberPennPlaceableOrganKind =>
  typeof value === "string" && KIND_SET.has(value);
const isStableAttachmentId = (value: unknown) =>
  typeof value === "string" && /^weber-penn:(leaf-site|branch-tip):\d+$/.test(value);
const quantized = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const normalizeAngle = (value: number) => {
  const tau = Math.PI * 2;
  return ((value % tau) + tau) % tau;
};
const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
const cloneTarget = (target: ProcPlantWeberPennOrganPlacementPackage["target"]) => ({ ...target });
const sortedOperations = (operations: readonly ProcPlantWeberPennOrganPlacementOperation[]) =>
  [...operations].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));

const normalizeTarget = (target: ProcPlantWeberPennTrimTarget): ProcPlantWeberPennOrganPlacementPackage["target"] => {
  if (target.backend !== "weber-penn" || !target.genomeId || !Number.isSafeInteger(target.seed) || !target.topologySignature) {
    throw new Error("Weber-Penn organ placement requires an exact topology-bound target");
  }
  return { ...target, topologySignature: target.topologySignature };
};

export const createProcPlantWeberPennOrganPlacementPackage = (
  target: ProcPlantWeberPennTrimTarget,
): ProcPlantWeberPennOrganPlacementPackage => ({
  contract: PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_CONTRACT,
  version: PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_VERSION,
  target: normalizeTarget(target),
  operations: [],
});

export const appendProcPlantWeberPennOrganPlacement = (
  placementPackage: ProcPlantWeberPennOrganPlacementPackage,
  input: ProcPlantWeberPennOrganPlacementInput,
): ProcPlantWeberPennOrganPlacementAppendResult => {
  if (placementPackage.operations.length >= PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_MAX_OVERRIDES) {
    return { package: placementPackage, operation: null, reason: "cap" };
  }
  if (!isKind(input.kind) || !isStableAttachmentId(input.attachmentId) || !Number.isFinite(input.scale) || input.scale <= 0 ||
    (input.roll !== undefined && !Number.isFinite(input.roll))) {
    return { package: placementPackage, operation: null, reason: "invalid" };
  }
  if (placementPackage.operations.some((operation) => operation.attachmentId === input.attachmentId)) {
    return { package: placementPackage, operation: null, reason: "occupied" };
  }
  const ordinal = placementPackage.operations.reduce((maximum, operation) => Math.max(maximum, operation.ordinal), -1) + 1;
  const scale = quantized(THREE.MathUtils.clamp(input.scale, 0.01, 5));
  const roll = quantized(normalizeAngle(input.roll ?? 0));
  const identity = `${placementPackage.target.topologySignature}|${input.attachmentId}|${input.kind}|${roll}|${scale}|${ordinal}`;
  const operation: ProcPlantWeberPennOrganPlacementOperation = {
    id: `weber-placed-${fnv1a(identity)}`,
    ordinal,
    kind: input.kind,
    attachmentId: input.attachmentId,
    roll,
    scale,
    ...(input.color === undefined ? {} : { color: input.color >>> 0 }),
    ...(input.secondaryColor === undefined ? {} : { secondaryColor: input.secondaryColor >>> 0 }),
  };
  return {
    package: { ...placementPackage, target: cloneTarget(placementPackage.target), operations: sortedOperations([...placementPackage.operations, operation]) },
    operation,
    reason: null,
  };
};

export const undoLastProcPlantWeberPennOrganPlacement = (
  placementPackage: ProcPlantWeberPennOrganPlacementPackage,
): ProcPlantWeberPennOrganPlacementPackage => {
  if (placementPackage.operations.length === 0) return placementPackage;
  const operations = sortedOperations(placementPackage.operations);
  operations.pop();
  return { ...placementPackage, target: cloneTarget(placementPackage.target), operations };
};

export interface ProcPlantWeberPennPickerPlacementInput {
  placementPackage: ProcPlantWeberPennOrganPlacementPackage | null;
  target: ProcPlantWeberPennTrimTarget;
  attachments: readonly ProcPlantAttachmentAnchor[];
  pickerStemIds: Readonly<Record<string, string>>;
  attachmentStemIds: Readonly<Record<string, string>>;
  pickerSegmentId: string;
  localPoint: THREE.Vector3;
  kind: unknown;
  flowerAvailable: boolean;
  scale: number;
  color?: number;
  secondaryColor?: number;
}

export interface ProcPlantWeberPennPickerPlacementResult {
  package: ProcPlantWeberPennOrganPlacementPackage;
  operation: ProcPlantWeberPennOrganPlacementOperation | null;
  attachmentId: string | null;
  ownerStemId: string | null;
  reason: ProcPlantWeberPennOrganPlacementAppendResult["reason"] | "missing-frame" | "missing-owner" |
    "incompatible-kind" | "flower-unavailable" | "target-mismatch";
}

/** Snap a live picker hit to a real native frame while storing only that exact stable identity. */
export const appendProcPlantWeberPennOrganPlacementFromPicker = (
  input: ProcPlantWeberPennPickerPlacementInput,
): ProcPlantWeberPennPickerPlacementResult => {
  if (!isKind(input.kind)) {
    return { package: input.placementPackage ?? createProcPlantWeberPennOrganPlacementPackage(input.target), operation: null, attachmentId: null, ownerStemId: null, reason: "incompatible-kind" };
  }
  if (input.kind === "flower" && !input.flowerAvailable) {
    return { package: input.placementPackage ?? createProcPlantWeberPennOrganPlacementPackage(input.target), operation: null, attachmentId: null, ownerStemId: null, reason: "flower-unavailable" };
  }
  const hitOwner = input.pickerStemIds[input.pickerSegmentId];
  const exact = hitOwner ? input.attachments.filter((anchor) => input.attachmentStemIds[anchor.id] === hitOwner) : [];
  const candidates = (exact.length > 0 ? exact : input.attachments)
    .filter((anchor) => anchor.kind === "leaf-site" || anchor.kind === "branch-tip")
    .sort((left, right) => left.position.distanceToSquared(input.localPoint) - right.position.distanceToSquared(input.localPoint) || left.id.localeCompare(right.id));
  const anchor = candidates[0];
  if (!anchor) {
    return { package: input.placementPackage ?? createProcPlantWeberPennOrganPlacementPackage(input.target), operation: null, attachmentId: null, ownerStemId: null, reason: "missing-frame" };
  }
  const ownerStemId = input.attachmentStemIds[anchor.id] ?? null;
  if (!ownerStemId) {
    return { package: input.placementPackage ?? createProcPlantWeberPennOrganPlacementPackage(input.target), operation: null, attachmentId: anchor.id, ownerStemId, reason: "missing-owner" };
  }
  if (input.kind === "cone" && anchor.kind !== "branch-tip") {
    return { package: input.placementPackage ?? createProcPlantWeberPennOrganPlacementPackage(input.target), operation: null, attachmentId: anchor.id, ownerStemId, reason: "incompatible-kind" };
  }
  const placementPackage = input.placementPackage ?? createProcPlantWeberPennOrganPlacementPackage(input.target);
  if (placementPackage.target.genomeId !== input.target.genomeId || placementPackage.target.seed !== input.target.seed ||
    placementPackage.target.topologySignature !== input.target.topologySignature) {
    return { package: placementPackage, operation: null, attachmentId: anchor.id, ownerStemId, reason: "target-mismatch" };
  }
  const radial = input.localPoint.clone().sub(anchor.position).projectOnPlane(anchor.tangent);
  const roll = radial.lengthSq() < 1e-10 ? 0 : Math.atan2(radial.normalize().dot(anchor.up), radial.dot(anchor.right));
  const appended = appendProcPlantWeberPennOrganPlacement(placementPackage, {
    kind: input.kind,
    attachmentId: anchor.id,
    roll,
    scale: input.scale,
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.secondaryColor === undefined ? {} : { secondaryColor: input.secondaryColor }),
  });
  return { ...appended, attachmentId: anchor.id, ownerStemId };
};

export { applyProcPlantWeberPennOrganPlacementOverrides } from "./procplant-weber-penn-organ-placement-apply";

export const serializeProcPlantWeberPennOrganPlacementPackage = (
  placementPackage: ProcPlantWeberPennOrganPlacementPackage,
) => JSON.stringify({
  contract: placementPackage.contract,
  version: placementPackage.version,
  target: cloneTarget(placementPackage.target),
  operations: sortedOperations(placementPackage.operations).map((operation) => ({ ...operation })),
});

export const deserializeProcPlantWeberPennOrganPlacementPackage = (
  serialized: string,
): ProcPlantWeberPennOrganPlacementPackage => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Weber-Penn organ placements must be valid JSON");
  }
  if (!value || typeof value !== "object") throw new Error("Weber-Penn organ placements must be an object");
  const candidate = value as ProcPlantWeberPennOrganPlacementPackage;
  if (candidate.contract !== PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_CONTRACT ||
    candidate.version !== PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_VERSION || !Array.isArray(candidate.operations)) {
    throw new Error("Unsupported Weber-Penn organ placement package");
  }
  const target = normalizeTarget(candidate.target);
  const operations = sortedOperations(candidate.operations).map((operation) => {
    if (!operation || typeof operation !== "object" || typeof operation.id !== "string" || !operation.id ||
      !Number.isSafeInteger(operation.ordinal) || operation.ordinal < 0 || !isKind(operation.kind) ||
      !isStableAttachmentId(operation.attachmentId) || !Number.isFinite(operation.roll) ||
      !Number.isFinite(operation.scale) || operation.scale <= 0) {
      throw new Error("Invalid Weber-Penn organ placement operation");
    }
    return {
      id: operation.id,
      ordinal: operation.ordinal,
      kind: operation.kind,
      attachmentId: operation.attachmentId,
      roll: quantized(normalizeAngle(operation.roll)),
      scale: quantized(THREE.MathUtils.clamp(operation.scale, 0.01, 5)),
      ...(operation.color === undefined ? {} : { color: operation.color >>> 0 }),
      ...(operation.secondaryColor === undefined ? {} : { secondaryColor: operation.secondaryColor >>> 0 }),
    };
  });
  return { contract: candidate.contract, version: candidate.version, target, operations };
};
