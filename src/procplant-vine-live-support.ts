import * as THREE from "three";
import type { ProcPlantGuidePoint } from "./procplants";
import {
  deserializeProcPlantVineGuidePackage,
  serializeProcPlantVineGuidePackage,
  updateProcPlantVineGuidePoint,
  type ProcPlantVineGuidePackage,
  type ProcPlantVineGuideTarget,
} from "./procplant-vine-guide-authoring";

export const PROCPLANT_VINE_LIVE_SUPPORT_CONTRACT = "procplants.vine-live-support" as const;
export const PROCPLANT_VINE_LIVE_SUPPORT_VERSION = 1 as const;
export const PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION = 1 as const;
export const PROCPLANT_VINE_LIVE_SUPPORT_MAX_BINDINGS = 32;
export const PROCPLANT_VINE_LIVE_SUPPORT_MAX_SUPPORTS = 128;
export const PROCPLANT_VINE_LIVE_SUPPORT_MAX_SERIALIZED_BYTES = 16_384;

export type ProcPlantVineLiveSupportKind = "object3d" | "triangle-mesh";
export type ProcPlantMatrix4Tuple = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

/**
 * Ephemeral caller-owned pose. `supportSignature` identifies support geometry,
 * not its transform, so translation/rotation/scale may be rebuilt without
 * invalidating an attachment. Deformed geometry must use a new signature.
 */
export interface ProcPlantVineLiveSupportPose {
  id: string;
  kind: ProcPlantVineLiveSupportKind;
  supportSignatureVersion: typeof PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION;
  supportSignature: string;
  localToGuide: ProcPlantMatrix4Tuple;
}

export interface ProcPlantVineLiveSupportBinding {
  pointId: string;
  supportId: string;
  supportKind: ProcPlantVineLiveSupportKind;
  supportSignatureVersion: typeof PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION;
  supportSignature: string;
  /** Position in support-local coordinates. */
  supportLocalPosition: ProcPlantGuidePoint;
}

export interface ProcPlantVineLiveSupportPackage {
  contract: typeof PROCPLANT_VINE_LIVE_SUPPORT_CONTRACT;
  version: typeof PROCPLANT_VINE_LIVE_SUPPORT_VERSION;
  target: ProcPlantVineGuideTarget;
  guideSignatureVersion: typeof PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION;
  guideSignature: string;
  bindings: ProcPlantVineLiveSupportBinding[];
}

export type ProcPlantVineLiveSupportRebuildReason =
  | "target-mismatch"
  | "guide-signature-mismatch"
  | "missing-support"
  | "support-kind-mismatch"
  | "support-signature-mismatch"
  | "motion-limit"
  | "invalid-rebuilt-guide";

export interface ProcPlantVineLiveSupportRebuildResult {
  status: "rebuilt" | "stale";
  reason: ProcPlantVineLiveSupportRebuildReason | null;
  authored: ProcPlantVineGuidePackage;
  attachment: ProcPlantVineLiveSupportPackage;
  changed: boolean;
  pointId: string | null;
  supportId: string | null;
  audit: { bindings: number; suppliedSupports: number; transformedPoints: number };
}

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
const finitePoint = (value: unknown): value is ProcPlantGuidePoint =>
  Array.isArray(value) && value.length === 3
  && value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) <= 1_000_000);
const sameTarget = (left: ProcPlantVineGuideTarget, right: ProcPlantVineGuideTarget) =>
  left.genomeId === right.genomeId && left.seed === right.seed
  && left.sourceSignatureVersion === right.sourceSignatureVersion
  && left.sourceSignature === right.sourceSignature;

export const procPlantVineGuidePackageSignature = (authored: ProcPlantVineGuidePackage) =>
  `guide-v${PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION}-${fnv1a(serializeProcPlantVineGuidePackage(authored))}`;

const cloneBinding = (binding: ProcPlantVineLiveSupportBinding): ProcPlantVineLiveSupportBinding => ({
  ...binding,
  supportLocalPosition: [...binding.supportLocalPosition] as ProcPlantGuidePoint,
});
const clonePackage = (attachment: ProcPlantVineLiveSupportPackage): ProcPlantVineLiveSupportPackage => ({
  contract: attachment.contract,
  version: attachment.version,
  target: { ...attachment.target },
  guideSignatureVersion: attachment.guideSignatureVersion,
  guideSignature: attachment.guideSignature,
  bindings: attachment.bindings.map(cloneBinding),
});

const matrixFromTuple = (tuple: readonly number[], label: string) => {
  if (tuple.length !== 16 || tuple.some((entry) => !Number.isFinite(entry) || Math.abs(entry) > 1e12)) {
    throw new Error(`${label} must contain 16 finite bounded values`);
  }
  const matrix = new THREE.Matrix4().fromArray(tuple);
  if (Math.abs(matrix.determinant()) < 1e-12) throw new Error(`${label} must be invertible`);
  return matrix;
};

const assertPose = (pose: ProcPlantVineLiveSupportPose) => {
  if (!validId(pose.id)) throw new Error("live support id must be non-empty and at most 128 characters");
  if (pose.kind !== "object3d" && pose.kind !== "triangle-mesh") throw new Error("unsupported live support kind");
  if (pose.supportSignatureVersion !== PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION || !validId(pose.supportSignature)) {
    throw new Error("invalid live support signature");
  }
  matrixFromTuple(pose.localToGuide, `${pose.id}.localToGuide`);
};

function assertAttachment(value: unknown): asserts value is ProcPlantVineLiveSupportPackage {
  if (!value || typeof value !== "object") throw new Error("live support package must be an object");
  const candidate = value as Partial<ProcPlantVineLiveSupportPackage>;
  if (candidate.contract !== PROCPLANT_VINE_LIVE_SUPPORT_CONTRACT || candidate.version !== PROCPLANT_VINE_LIVE_SUPPORT_VERSION) {
    throw new Error("unsupported live support package");
  }
  const target = candidate.target as Partial<ProcPlantVineGuideTarget> | undefined;
  if (!target || !validId(target.genomeId) || !Number.isSafeInteger(target.seed) || Number(target.seed) < 0
    || target.sourceSignatureVersion !== 1 || !validId(target.sourceSignature)) throw new Error("invalid live support target");
  if (candidate.guideSignatureVersion !== PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION || !validId(candidate.guideSignature)) {
    throw new Error("invalid live support guide signature");
  }
  if (!Array.isArray(candidate.bindings) || candidate.bindings.length > PROCPLANT_VINE_LIVE_SUPPORT_MAX_BINDINGS) {
    throw new Error(`live support package supports at most ${PROCPLANT_VINE_LIVE_SUPPORT_MAX_BINDINGS} bindings`);
  }
  const points = new Set<string>();
  for (const binding of candidate.bindings) {
    if (!binding || !validId(binding.pointId) || !validId(binding.supportId)
      || (binding.supportKind !== "object3d" && binding.supportKind !== "triangle-mesh")
      || binding.supportSignatureVersion !== PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION
      || !validId(binding.supportSignature) || !finitePoint(binding.supportLocalPosition)
      || points.has(binding.pointId)) throw new Error("invalid live support binding");
    points.add(binding.pointId);
  }
}

export const createProcPlantVineLiveSupportPackage = (
  authored: ProcPlantVineGuidePackage,
): ProcPlantVineLiveSupportPackage => ({
  contract: PROCPLANT_VINE_LIVE_SUPPORT_CONTRACT,
  version: PROCPLANT_VINE_LIVE_SUPPORT_VERSION,
  target: { ...authored.target },
  guideSignatureVersion: PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION,
  guideSignature: procPlantVineGuidePackageSignature(authored),
  bindings: [],
});

export const serializeProcPlantVineLiveSupportPackage = (attachment: ProcPlantVineLiveSupportPackage) => {
  assertAttachment(attachment);
  return JSON.stringify(clonePackage(attachment));
};

export const deserializeProcPlantVineLiveSupportPackage = (serialized: string) => {
  if (new TextEncoder().encode(serialized).byteLength > PROCPLANT_VINE_LIVE_SUPPORT_MAX_SERIALIZED_BYTES) {
    throw new Error("live support package exceeds the 16 KiB serialized limit");
  }
  const parsed: unknown = JSON.parse(serialized);
  assertAttachment(parsed);
  return clonePackage(parsed);
};

/**
 * Capture an Object3D pose without updating either object. Callers explicitly
 * own `updateWorldMatrix`/animation/morph updates before capturing a new pose.
 */
export const createProcPlantVineLiveSupportPoseFromObject3D = (
  support: THREE.Object3D,
  options: {
    id: string;
    kind?: ProcPlantVineLiveSupportKind;
    supportSignature: string;
    guideRoot?: THREE.Object3D | null;
  },
): ProcPlantVineLiveSupportPose => {
  const localToGuide = options.guideRoot
    ? options.guideRoot.matrixWorld.clone().invert().multiply(support.matrixWorld)
    : support.matrixWorld.clone();
  const pose: ProcPlantVineLiveSupportPose = {
    id: options.id,
    kind: options.kind ?? (support instanceof THREE.Mesh ? "triangle-mesh" : "object3d"),
    supportSignatureVersion: PROCPLANT_VINE_LIVE_SUPPORT_SIGNATURE_VERSION,
    supportSignature: options.supportSignature,
    localToGuide: localToGuide.toArray() as unknown as ProcPlantMatrix4Tuple,
  };
  assertPose(pose);
  return pose;
};

const supportLocalPoint = (guidePosition: ProcPlantGuidePoint, support: ProcPlantVineLiveSupportPose): ProcPlantGuidePoint => {
  assertPose(support);
  const local = new THREE.Vector3(...guidePosition).applyMatrix4(matrixFromTuple(support.localToGuide, `${support.id}.localToGuide`).invert());
  const result = local.toArray() as ProcPlantGuidePoint;
  if (!finitePoint(result)) throw new Error("attached support-local point is outside the bounded coordinate range");
  return result;
};

export const attachProcPlantVineGuidePointToLiveSupport = (
  authored: ProcPlantVineGuidePackage,
  attachment: ProcPlantVineLiveSupportPackage,
  pointId: string,
  support: ProcPlantVineLiveSupportPose,
): ProcPlantVineLiveSupportPackage => {
  assertAttachment(attachment);
  assertPose(support);
  if (!sameTarget(authored.target, attachment.target) || procPlantVineGuidePackageSignature(authored) !== attachment.guideSignature) {
    throw new Error("live support package is stale for the supplied vine guide");
  }
  const point = authored.points.find((entry) => entry.id === pointId);
  if (!point) throw new Error(`unknown vine guide point: ${pointId}`);
  const binding: ProcPlantVineLiveSupportBinding = {
    pointId,
    supportId: support.id,
    supportKind: support.kind,
    supportSignatureVersion: support.supportSignatureVersion,
    supportSignature: support.supportSignature,
    supportLocalPosition: supportLocalPoint(point.position, support),
  };
  const bindings = attachment.bindings.filter((entry) => entry.pointId !== pointId);
  if (bindings.length >= PROCPLANT_VINE_LIVE_SUPPORT_MAX_BINDINGS) throw new Error("live support binding cap exceeded");
  bindings.push(binding);
  bindings.sort((left, right) => left.pointId.localeCompare(right.pointId));
  return { ...clonePackage(attachment), bindings };
};

const staleResult = (
  authored: ProcPlantVineGuidePackage,
  attachment: ProcPlantVineLiveSupportPackage,
  reason: ProcPlantVineLiveSupportRebuildReason,
  suppliedSupports: number,
  pointId: string | null = null,
  supportId: string | null = null,
): ProcPlantVineLiveSupportRebuildResult => ({
  status: "stale", reason, authored, attachment, changed: false, pointId, supportId,
  audit: { bindings: attachment.bindings.length, suppliedSupports, transformedPoints: 0 },
});

/**
 * Atomically materialize attached points after caller-owned transform updates.
 * Geometry-signature drift fails closed: rebuild the mesh query index, resnap,
 * then explicitly call `rebindProcPlantVineGuidePointToLiveSupport`.
 */
export const rebuildProcPlantVineGuideFromLiveSupports = (
  authored: ProcPlantVineGuidePackage,
  attachment: ProcPlantVineLiveSupportPackage,
  supports: readonly ProcPlantVineLiveSupportPose[],
  options: { maxPointMotion?: number } = {},
): ProcPlantVineLiveSupportRebuildResult => {
  assertAttachment(attachment);
  if (supports.length > PROCPLANT_VINE_LIVE_SUPPORT_MAX_SUPPORTS) throw new Error("live support pose cap exceeded");
  const maxPointMotion = options.maxPointMotion ?? 1_000;
  if (!Number.isFinite(maxPointMotion) || maxPointMotion < 0 || maxPointMotion > 1_000_000) {
    throw new Error("maxPointMotion must be finite and between 0 and 1000000");
  }
  if (!sameTarget(authored.target, attachment.target)) return staleResult(authored, attachment, "target-mismatch", supports.length);
  if (procPlantVineGuidePackageSignature(authored) !== attachment.guideSignature) {
    return staleResult(authored, attachment, "guide-signature-mismatch", supports.length);
  }
  const poses = new Map<string, ProcPlantVineLiveSupportPose>();
  for (const support of supports) {
    assertPose(support);
    if (poses.has(support.id)) throw new Error(`duplicate live support id: ${support.id}`);
    poses.set(support.id, support);
  }
  const replacement = new Map<string, ProcPlantGuidePoint>();
  for (const binding of attachment.bindings) {
    const pose = poses.get(binding.supportId);
    if (!pose) return staleResult(authored, attachment, "missing-support", supports.length, binding.pointId, binding.supportId);
    if (pose.kind !== binding.supportKind) return staleResult(authored, attachment, "support-kind-mismatch", supports.length, binding.pointId, binding.supportId);
    if (pose.supportSignatureVersion !== binding.supportSignatureVersion || pose.supportSignature !== binding.supportSignature) {
      return staleResult(authored, attachment, "support-signature-mismatch", supports.length, binding.pointId, binding.supportId);
    }
    const next = new THREE.Vector3(...binding.supportLocalPosition)
      .applyMatrix4(matrixFromTuple(pose.localToGuide, `${pose.id}.localToGuide`)).toArray() as ProcPlantGuidePoint;
    const prior = authored.points.find((point) => point.id === binding.pointId)?.position;
    if (!prior) return staleResult(authored, attachment, "guide-signature-mismatch", supports.length, binding.pointId, binding.supportId);
    if (!finitePoint(next) || Math.hypot(next[0] - prior[0], next[1] - prior[1], next[2] - prior[2]) > maxPointMotion) {
      return staleResult(authored, attachment, "motion-limit", supports.length, binding.pointId, binding.supportId);
    }
    replacement.set(binding.pointId, next);
  }
  if (replacement.size === 0) return {
    status: "rebuilt", reason: null, authored, attachment, changed: false, pointId: null, supportId: null,
    audit: { bindings: 0, suppliedSupports: supports.length, transformedPoints: 0 },
  };
  let rebuilt: ProcPlantVineGuidePackage;
  try {
    const raw = JSON.parse(serializeProcPlantVineGuidePackage(authored)) as ProcPlantVineGuidePackage;
    raw.points = raw.points.map((point) => ({
      ...point,
      position: replacement.has(point.id) ? [...replacement.get(point.id)!] as ProcPlantGuidePoint : [...point.position] as ProcPlantGuidePoint,
    }));
    rebuilt = deserializeProcPlantVineGuidePackage(JSON.stringify(raw));
  } catch {
    return staleResult(authored, attachment, "invalid-rebuilt-guide", supports.length);
  }
  const nextAttachment = clonePackage(attachment);
  nextAttachment.guideSignature = procPlantVineGuidePackageSignature(rebuilt);
  return {
    status: "rebuilt", reason: null, authored: rebuilt, attachment: nextAttachment, changed: true, pointId: null, supportId: null,
    audit: { bindings: attachment.bindings.length, suppliedSupports: supports.length, transformedPoints: replacement.size },
  };
};

/**
 * Explicit deformation recovery. The caller must first rebuild/query its mesh
 * and provide the newly resnapped guide-space position; no raw mesh is retained.
 */
export const rebindProcPlantVineGuidePointToLiveSupport = (
  authored: ProcPlantVineGuidePackage,
  attachment: ProcPlantVineLiveSupportPackage,
  pointId: string,
  resnappedGuidePosition: ProcPlantGuidePoint,
  support: ProcPlantVineLiveSupportPose,
) => {
  assertAttachment(attachment);
  if (!sameTarget(authored.target, attachment.target) || procPlantVineGuidePackageSignature(authored) !== attachment.guideSignature) {
    throw new Error("live support package is stale for the supplied vine guide");
  }
  const nextAuthored = updateProcPlantVineGuidePoint(authored, pointId, resnappedGuidePosition);
  const rebased = { ...clonePackage(attachment), guideSignature: procPlantVineGuidePackageSignature(nextAuthored) };
  const withoutPoint = { ...rebased, bindings: rebased.bindings.filter((binding) => binding.pointId !== pointId) };
  return {
    authored: nextAuthored,
    attachment: attachProcPlantVineGuidePointToLiveSupport(nextAuthored, withoutPoint, pointId, support),
  };
};
