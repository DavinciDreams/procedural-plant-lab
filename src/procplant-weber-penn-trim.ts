import type { ProcPlantAttachmentAnchor, ProcPlantGraph } from "./procplants";
import {
  computeBakedTreeTopologySignature,
  filterBakedTreeGeometry,
  type BakedTree,
} from "./vendor/proc-tree/index";

export const PROCPLANT_WEBER_PENN_TRIM_CONTRACT = "procplants.weber-penn-trim-overrides" as const;
export const PROCPLANT_WEBER_PENN_TRIM_VERSION = 1 as const;

export interface ProcPlantWeberPennTrimTarget {
  backend: "weber-penn";
  genomeId: string;
  seed: number;
  /** Required for geometry-changing baked trim; binds edits to exact source buffers. */
  topologySignature?: string;
}

export type ProcPlantWeberPennStableAttachmentKind = "leaf-site" | "branch-tip";

export type ProcPlantWeberPennTrimSelection =
  | { kind: "attachment-ids"; attachmentIds: readonly string[] }
  | { kind: "attachment-kind"; attachmentKinds: readonly ProcPlantWeberPennStableAttachmentKind[] }
  /** Whole owners whose native tip/leaf attachment height is within the source-normalized [0, 1] range. */
  | { kind: "axial-range"; min: number; max: number }
  /** Whole owners selected by their native tip/leaf attachment height after source normalization. */
  | { kind: "height-plane"; height: number; side: "above" | "below" }
  | { kind: "segment-ids"; segmentIds: readonly string[] }
  | { kind: "branch-depth"; minDepth?: number; maxDepth?: number };

export interface ProcPlantWeberPennTrimOperation {
  id: string;
  action: "remove" | "retain";
  selection: ProcPlantWeberPennTrimSelection;
}

export interface ProcPlantWeberPennTrimOverrideSet {
  contract: typeof PROCPLANT_WEBER_PENN_TRIM_CONTRACT;
  version: typeof PROCPLANT_WEBER_PENN_TRIM_VERSION;
  target: ProcPlantWeberPennTrimTarget;
  operations: ProcPlantWeberPennTrimOperation[];
}

export interface ProcPlantWeberPennTrimSource {
  target: ProcPlantWeberPennTrimTarget;
  graph: ProcPlantGraph;
}

export type ProcPlantWeberPennTrimOperationStatus = "applied" | "no-match" | "unsupported";

export interface ProcPlantWeberPennTrimOperationAudit {
  operationId: string;
  status: ProcPlantWeberPennTrimOperationStatus;
  matchedAttachmentIds: string[];
  removedAttachmentIds: string[];
  unknownAttachmentIds: string[];
  reason: string | null;
}

export type ProcPlantWeberPennTrimStatus =
  | "no-op"
  | "applied"
  | "partial"
  | "unsupported"
  | "target-mismatch";

export interface ProcPlantWeberPennTrimAudit {
  status: ProcPlantWeberPennTrimStatus;
  beforeAttachments: number;
  afterAttachments: number;
  retainedAttachmentIds: string[];
  removedAttachmentIds: string[];
  unstableAttachmentIds: string[];
  operations: ProcPlantWeberPennTrimOperationAudit[];
  geometryChanged: false;
  bakedBranchTopologySupported: false;
  nativeLeafGeometrySupported: false;
  note: string;
}

export interface ProcPlantWeberPennTrimResult {
  contract: typeof PROCPLANT_WEBER_PENN_TRIM_CONTRACT;
  version: typeof PROCPLANT_WEBER_PENN_TRIM_VERSION;
  graph: ProcPlantGraph;
  audit: ProcPlantWeberPennTrimAudit;
}

const stableCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const MAX_OPERATIONS = 256;
const MAX_SELECTION_IDS = 50_000;
const MAX_SOURCE_STEMS = 100_000;
const MAX_SOURCE_LEAVES = 250_000;
const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};

const normalizeTarget = (target: ProcPlantWeberPennTrimTarget): ProcPlantWeberPennTrimTarget => {
  if (target.backend !== "weber-penn") throw new Error("trim target backend must be weber-penn");
  if (typeof target.genomeId !== "string" || !target.genomeId.trim()) throw new Error("trim target genomeId must be non-empty");
  if (!Number.isInteger(target.seed) || target.seed < 0 || target.seed > 0xffffffff) {
    throw new Error("trim target seed must be an unsigned 32-bit integer");
  }
  if (target.topologySignature !== undefined && !/^fnv1a32:[0-9a-f]{8}$/.test(target.topologySignature)) {
    throw new Error("trim target topologySignature must be a canonical fnv1a32 signature");
  }
  return {
    backend: "weber-penn",
    genomeId: target.genomeId,
    seed: target.seed,
    ...(target.topologySignature === undefined ? {} : { topologySignature: target.topologySignature }),
  };
};

const sortedUnique = (values: readonly string[]) => {
  if (values.length > MAX_SELECTION_IDS) throw new Error(`trim selection exceeds ${MAX_SELECTION_IDS} ids`);
  if (values.some((value) => typeof value !== "string" || !value)) throw new Error("trim selection ids must be non-empty strings");
  return [...new Set(values)].sort(stableCompare);
};

const normalizeSelection = (selection: ProcPlantWeberPennTrimSelection): ProcPlantWeberPennTrimSelection => {
  if (selection.kind === "attachment-ids") {
    return { kind: selection.kind, attachmentIds: sortedUnique(selection.attachmentIds) };
  }
  if (selection.kind === "attachment-kind") {
    const attachmentKinds = sortedUnique(selection.attachmentKinds);
    if (attachmentKinds.some((kind) => kind !== "leaf-site" && kind !== "branch-tip")) {
      throw new Error("attachmentKinds must contain only leaf-site or branch-tip");
    }
    return { kind: selection.kind, attachmentKinds: attachmentKinds as ProcPlantWeberPennStableAttachmentKind[] };
  }
  if (selection.kind === "axial-range") {
    const min = finite(selection.min, "axial-range.min");
    const max = finite(selection.max, "axial-range.max");
    if (min < 0 || max > 1 || min > max) throw new Error("axial range must satisfy 0 <= min <= max <= 1");
    return { kind: selection.kind, min, max };
  }
  if (selection.kind === "height-plane") {
    return { kind: selection.kind, height: finite(selection.height, "height-plane.height"), side: selection.side };
  }
  if (selection.kind === "segment-ids") {
    return { kind: selection.kind, segmentIds: sortedUnique(selection.segmentIds) };
  }
  const minDepth = selection.minDepth ?? 0;
  const maxDepth = selection.maxDepth ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(minDepth) || !Number.isInteger(maxDepth) || minDepth < 0 || minDepth > maxDepth) {
    throw new Error("branch depth must use non-negative integer bounds with minDepth <= maxDepth");
  }
  return { kind: selection.kind, minDepth, maxDepth };
};

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const createProcPlantWeberPennTrimOperation = (
  action: ProcPlantWeberPennTrimOperation["action"],
  selection: ProcPlantWeberPennTrimSelection,
): ProcPlantWeberPennTrimOperation => {
  const normalized = normalizeSelection(selection);
  const fingerprint = JSON.stringify({ action, selection: normalized });
  return { id: `wp-trim:${fnv1a(fingerprint)}`, action, selection: normalized };
};

const normalizeOperation = (operation: ProcPlantWeberPennTrimOperation): ProcPlantWeberPennTrimOperation => {
  if (typeof operation.id !== "string" || !operation.id.trim()) throw new Error("trim operation id must be non-empty");
  if (operation.action !== "remove" && operation.action !== "retain") throw new Error("trim operation action must be remove or retain");
  return { id: operation.id, action: operation.action, selection: normalizeSelection(operation.selection) };
};

export const createProcPlantWeberPennTrimOverrideSet = (
  target: ProcPlantWeberPennTrimTarget,
  operations: readonly ProcPlantWeberPennTrimOperation[] = [],
): ProcPlantWeberPennTrimOverrideSet => {
  const normalizedOperations = operations.map(normalizeOperation);
  if (normalizedOperations.length > MAX_OPERATIONS) throw new Error(`trim override set exceeds ${MAX_OPERATIONS} operations`);
  const ids = new Set<string>();
  for (const operation of normalizedOperations) {
    if (ids.has(operation.id)) throw new Error(`duplicate trim operation id: ${operation.id}`);
    ids.add(operation.id);
  }
  return {
    contract: PROCPLANT_WEBER_PENN_TRIM_CONTRACT,
    version: PROCPLANT_WEBER_PENN_TRIM_VERSION,
    target: normalizeTarget(target),
    operations: normalizedOperations,
  };
};

const normalizeOverrideSet = (value: ProcPlantWeberPennTrimOverrideSet) => {
  if (value.contract !== PROCPLANT_WEBER_PENN_TRIM_CONTRACT) throw new Error(`unsupported trim contract: ${String(value.contract)}`);
  if (value.version !== PROCPLANT_WEBER_PENN_TRIM_VERSION) throw new Error(`unsupported trim version: ${String(value.version)}`);
  return createProcPlantWeberPennTrimOverrideSet(value.target, value.operations);
};

export const serializeProcPlantWeberPennTrimOverrides = (value: ProcPlantWeberPennTrimOverrideSet) =>
  JSON.stringify(normalizeOverrideSet(value));

export const deserializeProcPlantWeberPennTrimOverrides = (serialized: string): ProcPlantWeberPennTrimOverrideSet => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Weber-Penn trim overrides must be valid JSON");
  }
  if (!value || typeof value !== "object") throw new Error("Weber-Penn trim overrides must be an object");
  return normalizeOverrideSet(value as ProcPlantWeberPennTrimOverrideSet);
};

const stableAttachmentKind = (attachment: ProcPlantAttachmentAnchor): ProcPlantWeberPennStableAttachmentKind | null => {
  const match = /^weber-penn:(leaf-site|branch-tip):(\d+)$/.exec(attachment.id);
  if (!match || attachment.parentSegmentId !== null || attachment.kind !== match[1]) return null;
  return match[1] as ProcPlantWeberPennStableAttachmentKind;
};

const cloneAttachment = (attachment: ProcPlantAttachmentAnchor): ProcPlantAttachmentAnchor => ({
  ...attachment,
  position: attachment.position.clone(),
  tangent: attachment.tangent.clone(),
  right: attachment.right.clone(),
  up: attachment.up.clone(),
});

const targetMatches = (left: ProcPlantWeberPennTrimTarget, right: ProcPlantWeberPennTrimTarget) =>
  left.backend === right.backend &&
  left.genomeId === right.genomeId &&
  left.seed === right.seed &&
  left.topologySignature === right.topologySignature;

const unsupportedSelectionReason = (selection: ProcPlantWeberPennTrimSelection) => {
  if (selection.kind === "segment-ids") return "Weber-Penn attachment IR has no stable segment identities.";
  if (selection.kind === "branch-depth") return "Weber-Penn attachment IR has no lossless branch depth or ancestry.";
  return null;
};

const matchesSelection = (attachment: ProcPlantAttachmentAnchor, selection: ProcPlantWeberPennTrimSelection) => {
  if (selection.kind === "attachment-ids") return selection.attachmentIds.includes(attachment.id);
  if (selection.kind === "attachment-kind") return selection.attachmentKinds.includes(attachment.kind as ProcPlantWeberPennStableAttachmentKind);
  if (selection.kind === "axial-range") return attachment.axialT >= selection.min && attachment.axialT <= selection.max;
  if (selection.kind === "height-plane") return selection.side === "above"
    ? attachment.position.y > selection.height
    : attachment.position.y < selection.height;
  return false;
};

const unchangedAudit = (
  source: ProcPlantWeberPennTrimSource,
  status: ProcPlantWeberPennTrimStatus,
  note: string,
): ProcPlantWeberPennTrimResult => ({
  contract: PROCPLANT_WEBER_PENN_TRIM_CONTRACT,
  version: PROCPLANT_WEBER_PENN_TRIM_VERSION,
  graph: source.graph,
  audit: {
    status,
    beforeAttachments: source.graph.attachments.length,
    afterAttachments: source.graph.attachments.length,
    retainedAttachmentIds: source.graph.attachments.map((attachment) => attachment.id).sort(stableCompare),
    removedAttachmentIds: [],
    unstableAttachmentIds: source.graph.attachments.filter((attachment) => !stableAttachmentKind(attachment)).map((attachment) => attachment.id).sort(stableCompare),
    operations: [],
    geometryChanged: false,
    bakedBranchTopologySupported: false,
    nativeLeafGeometrySupported: false,
    note,
  },
});

/**
 * Apply serialized overrides to stable Weber-Penn attachment identities only.
 * Baked branches and native leaf triangles are intentionally left unchanged.
 */
export const applyProcPlantWeberPennTrimOverrides = (
  sourceValue: ProcPlantWeberPennTrimSource,
  overrideValue: ProcPlantWeberPennTrimOverrideSet,
): ProcPlantWeberPennTrimResult => {
  const source = { target: normalizeTarget(sourceValue.target), graph: sourceValue.graph };
  const overrides = normalizeOverrideSet(overrideValue);
  if (!targetMatches(source.target, overrides.target)) {
    return unchangedAudit(source, "target-mismatch", "Override target genome/seed does not match the generated Weber-Penn graph.");
  }
  if (overrides.operations.length === 0) {
    return unchangedAudit(source, "no-op", "No overrides supplied; the legacy graph is returned by reference without changes.");
  }
  if (source.graph.segmentRecords.length > 0 || source.graph.segments.length > 0 || source.graph.stems.length > 0) {
    return unchangedAudit(source, "unsupported", "The supplied graph contains segment topology and is not the current attachment-only Weber-Penn IR.");
  }

  const stableIds = new Set(source.graph.attachments.filter(stableAttachmentKind).map((attachment) => attachment.id));
  const allIds = new Set(source.graph.attachments.map((attachment) => attachment.id));
  let retained = [...source.graph.attachments];
  const audits: ProcPlantWeberPennTrimOperationAudit[] = [];
  for (const operation of overrides.operations) {
    const unsupportedReason = unsupportedSelectionReason(operation.selection);
    if (unsupportedReason) {
      audits.push({
        operationId: operation.id,
        status: "unsupported",
        matchedAttachmentIds: [],
        removedAttachmentIds: [],
        unknownAttachmentIds: [],
        reason: unsupportedReason,
      });
      continue;
    }
    const unknownAttachmentIds = operation.selection.kind === "attachment-ids"
      ? operation.selection.attachmentIds.filter((id) => !allIds.has(id))
      : [];
    const matched = retained
      .filter((attachment) => stableIds.has(attachment.id) && matchesSelection(attachment, operation.selection))
      .map((attachment) => attachment.id)
      .sort(stableCompare);
    if (matched.length === 0) {
      audits.push({
        operationId: operation.id,
        status: "no-match",
        matchedAttachmentIds: [],
        removedAttachmentIds: [],
        unknownAttachmentIds,
        reason: "Selection matched no retained stable Weber-Penn attachments.",
      });
      continue;
    }
    const matchedIds = new Set(matched);
    const before = retained;
    retained = operation.action === "remove"
      ? retained.filter((attachment) => !matchedIds.has(attachment.id))
      : retained.filter((attachment) => !stableIds.has(attachment.id) || matchedIds.has(attachment.id));
    const retainedIds = new Set(retained.map((attachment) => attachment.id));
    audits.push({
      operationId: operation.id,
      status: "applied",
      matchedAttachmentIds: matched,
      removedAttachmentIds: before.filter((attachment) => !retainedIds.has(attachment.id)).map((attachment) => attachment.id).sort(stableCompare),
      unknownAttachmentIds,
      reason: null,
    });
  }

  const retainedIds = new Set(retained.map((attachment) => attachment.id));
  const removedAttachmentIds = source.graph.attachments
    .filter((attachment) => !retainedIds.has(attachment.id))
    .map((attachment) => attachment.id)
    .sort(stableCompare);
  const applied = audits.filter((audit) => audit.status === "applied").length;
  const unsupported = audits.filter((audit) => audit.status === "unsupported").length;
  const status: ProcPlantWeberPennTrimStatus = applied > 0
    ? unsupported > 0 ? "partial" : "applied"
    : unsupported > 0 ? "unsupported" : "no-op";
  const graph = removedAttachmentIds.length === 0
    ? source.graph
    : { ...source.graph, attachments: retained.map(cloneAttachment) };
  return {
    contract: PROCPLANT_WEBER_PENN_TRIM_CONTRACT,
    version: PROCPLANT_WEBER_PENN_TRIM_VERSION,
    graph,
    audit: {
      status,
      beforeAttachments: source.graph.attachments.length,
      afterAttachments: graph.attachments.length,
      retainedAttachmentIds: graph.attachments.map((attachment) => attachment.id).sort(stableCompare),
      removedAttachmentIds,
      unstableAttachmentIds: source.graph.attachments.filter((attachment) => !stableAttachmentKind(attachment)).map((attachment) => attachment.id).sort(stableCompare),
      operations: audits,
      geometryChanged: false,
      bakedBranchTopologySupported: false,
      nativeLeafGeometrySupported: false,
      note: "Only stable attachment anchors were filtered. Rebuilding baked branch/native-leaf geometry requires future vendor topology identities.",
    },
  };
};

export interface ProcPlantWeberPennBakedTrimSource {
  target: ProcPlantWeberPennTrimTarget;
  baked: BakedTree;
}

export interface ProcPlantWeberPennBakedTrimOperationAudit {
  operationId: string;
  status: ProcPlantWeberPennTrimOperationStatus;
  matchedStemIds: string[];
  matchedLeafIds: string[];
  removedStemIds: string[];
  removedLeafIds: string[];
  unknownIds: string[];
  reason: string | null;
}

export interface ProcPlantWeberPennBakedTrimAudit {
  status: ProcPlantWeberPennTrimStatus;
  sourceTopologySignature: string;
  resultTopologySignature: string;
  beforeBranchTriangles: number;
  afterBranchTriangles: number;
  beforeNativeLeafTriangles: number;
  afterNativeLeafTriangles: number;
  removedStemIds: string[];
  removedLeafIds: string[];
  operations: ProcPlantWeberPennBakedTrimOperationAudit[];
  geometryChanged: boolean;
  bakedBranchTopologySupported: true;
  nativeLeafGeometrySupported: true;
  note: string;
}

export interface ProcPlantWeberPennBakedTrimResult {
  contract: typeof PROCPLANT_WEBER_PENN_TRIM_CONTRACT;
  version: typeof PROCPLANT_WEBER_PENN_TRIM_VERSION;
  baked: BakedTree;
  audit: ProcPlantWeberPennBakedTrimAudit;
}

export const bindProcPlantWeberPennTrimTarget = (
  target: Omit<ProcPlantWeberPennTrimTarget, "topologySignature">,
  baked: BakedTree,
): ProcPlantWeberPennTrimTarget => normalizeTarget({
  ...target,
  topologySignature: baked.topology.signature,
});

const stemId = (index: number) => `weber-penn:stem:${index}`;
const parseStemId = (value: string) => {
  const match = /^weber-penn:stem:(\d+)$/.exec(value);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
};

const branchTipId = (index: number) => `weber-penn:branch-tip:${index}`;
const parseBranchTipId = (value: string) => {
  const match = /^weber-penn:branch-tip:(\d+)$/.exec(value);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
};

const validateRangePartition = (
  ranges: readonly { vertexStart: number; vertexCount: number; indexStart: number; indexCount: number }[],
  vertexCount: number,
  indexCount: number,
  label: string,
) => {
  let nextVertex = 0;
  let nextIndex = 0;
  for (const range of [...ranges].sort((left, right) =>
    left.indexStart - right.indexStart ||
    left.vertexStart - right.vertexStart ||
    Number(right.indexCount === 0) - Number(left.indexCount === 0)
  )) {
    if (range.vertexStart !== nextVertex || range.indexStart !== nextIndex ||
      !Number.isSafeInteger(range.vertexCount) || range.vertexCount < 0 ||
      !Number.isSafeInteger(range.indexCount) || range.indexCount < 0) {
      throw new Error(`${label} ranges must form an exact non-overlapping partition`);
    }
    nextVertex += range.vertexCount;
    nextIndex += range.indexCount;
  }
  if (nextVertex !== vertexCount || nextIndex !== indexCount) {
    throw new Error(`${label} ranges do not cover the complete baked soup`);
  }
};

const validateBakedTrimSource = (source: ProcPlantWeberPennBakedTrimSource) => {
  const stems = source.baked.topology.stems;
  const leaves = source.baked.topology.leaves;
  if (stems.length > MAX_SOURCE_STEMS) throw new Error(`baked trim source exceeds ${MAX_SOURCE_STEMS} stems`);
  if (leaves.length > MAX_SOURCE_LEAVES) throw new Error(`baked trim source exceeds ${MAX_SOURCE_LEAVES} native leaves`);
  const byIndex = new Map<number, (typeof stems)[number]>();
  for (const stem of stems) {
    if (!Number.isSafeInteger(stem.stemIndex) || stem.stemIndex < 0 || byIndex.has(stem.stemIndex)) {
      throw new Error("baked trim source has duplicate or invalid stem indices");
    }
    byIndex.set(stem.stemIndex, stem);
  }
  for (const stem of stems) {
    if (stem.parentStemIndex !== null) {
      const parent = byIndex.get(stem.parentStemIndex);
      if (!parent || !parent.childStemIndices.includes(stem.stemIndex)) {
        throw new Error(`baked trim source has non-reciprocal ancestry for ${stemId(stem.stemIndex)}`);
      }
    }
    for (const childIndex of stem.childStemIndices) {
      if (byIndex.get(childIndex)?.parentStemIndex !== stem.stemIndex) {
        throw new Error(`baked trim source has non-reciprocal child ${stemId(childIndex)}`);
      }
    }
    const ownsGeometry = stem.baked && (stem.vertexCount > 0 || stem.indexCount > 0);
    if ((ownsGeometry && !Number.isFinite(stem.tipHeightYUp)) ||
      (stem.tipHeightYUp !== null && !Number.isFinite(stem.tipHeightYUp))) {
      throw new Error(`baked trim source has invalid tip-height metadata for ${stemId(stem.stemIndex)}`);
    }
  }
  const leafIndices = new Set<number>();
  const attachmentIds = new Set<string>();
  for (const leaf of leaves) {
    if (leafIndices.has(leaf.leafIndex) || attachmentIds.has(leaf.attachmentId) || !byIndex.has(leaf.parentStemIndex) ||
      !Number.isFinite(leaf.attachmentHeightYUp)) {
      throw new Error("baked trim source has duplicate leaves or a leaf without native parent ownership");
    }
    leafIndices.add(leaf.leafIndex);
    attachmentIds.add(leaf.attachmentId);
  }
  validateRangePartition(
    stems.filter((stem) => stem.baked),
    source.baked.branches.positions.length / 3,
    source.baked.branches.indices.length,
    "branch",
  );
  validateRangePartition(
    leaves,
    source.baked.leaves.positions.length / 3,
    source.baked.leaves.indices.length,
    "native leaf",
  );
};

const unchangedBakedAudit = (
  source: ProcPlantWeberPennBakedTrimSource,
  status: ProcPlantWeberPennTrimStatus,
  note: string,
  operations: ProcPlantWeberPennBakedTrimOperationAudit[] = [],
): ProcPlantWeberPennBakedTrimResult => ({
  contract: PROCPLANT_WEBER_PENN_TRIM_CONTRACT,
  version: PROCPLANT_WEBER_PENN_TRIM_VERSION,
  baked: source.baked,
  audit: {
    status,
    sourceTopologySignature: source.baked.topology.signature,
    resultTopologySignature: source.baked.topology.signature,
    beforeBranchTriangles: source.baked.branches.indices.length / 3,
    afterBranchTriangles: source.baked.branches.indices.length / 3,
    beforeNativeLeafTriangles: source.baked.leaves.indices.length / 3,
    afterNativeLeafTriangles: source.baked.leaves.indices.length / 3,
    removedStemIds: [],
    removedLeafIds: [],
    operations,
    geometryChanged: false,
    bakedBranchTopologySupported: true,
    nativeLeafGeometrySupported: true,
    note,
  },
});

/**
 * Atomically remove baked Weber-Penn stem/native-leaf ranges. Branch-tip and
 * normalized-height selectors operate on whole native owners; they never split
 * or infer a partial triangle range. Any stale binding, unsupported selector,
 * or unmatched identity returns the exact source by reference.
 */
export const applyProcPlantWeberPennBakedTrimOverrides = (
  sourceValue: ProcPlantWeberPennBakedTrimSource,
  overrideValue: ProcPlantWeberPennTrimOverrideSet,
): ProcPlantWeberPennBakedTrimResult => {
  validateBakedTrimSource(sourceValue);
  const source = { target: normalizeTarget(sourceValue.target), baked: sourceValue.baked };
  const overrides = normalizeOverrideSet(overrideValue);
  const computedSignature = computeBakedTreeTopologySignature(source.baked);
  if (source.baked.topology.signature !== computedSignature ||
    source.target.topologySignature !== computedSignature ||
    !targetMatches(source.target, overrides.target)) {
    return unchangedBakedAudit(source, "target-mismatch", "Baked trim binding is stale or does not match the exact source topology and buffers.");
  }
  if (overrides.operations.length === 0) {
    return unchangedBakedAudit(source, "no-op", "No overrides supplied; the exact legacy baked tree is returned by reference.");
  }

  const stemByIndex = new Map(source.baked.topology.stems.map((stem) => [stem.stemIndex, stem]));
  const leafById = new Map(source.baked.topology.leaves.map((leaf) => [leaf.attachmentId, leaf]));
  const leafByIndex = new Map(source.baked.topology.leaves.map((leaf) => [leaf.leafIndex, leaf]));
  const bakedStemIndices = new Set(source.baked.topology.stems.filter((stem) => stem.baked).map((stem) => stem.stemIndex));
  const sourceTipStemIndices = new Set(source.baked.topology.stems
    .filter((stem) => stem.baked && !stem.childStemIndices.some((child) => bakedStemIndices.has(child)))
    .map((stem) => stem.stemIndex));
  const sourceTipById = new Map([...sourceTipStemIndices].map((index) => [branchTipId(index), index]));
  const normalizedHeight = (y: number) => (y - source.baked.min.y) / Math.max(1e-9, source.baked.max.y - source.baked.min.y);
  const stemHeight = (index: number) => {
    const height = stemByIndex.get(index)?.tipHeightYUp;
    return Number.isFinite(height) ? normalizedHeight(height!) : null;
  };
  const leafHeight = (index: number) => normalizedHeight(leafByIndex.get(index)!.attachmentHeightYUp);
  const heightMatches = (value: number, selection: Extract<ProcPlantWeberPennTrimSelection, { kind: "axial-range" | "height-plane" }>) =>
    selection.kind === "axial-range"
      ? value >= selection.min && value <= selection.max
      : selection.side === "above" ? value > selection.height : value < selection.height;
  let retainedStems = new Set(stemByIndex.keys());
  let retainedLeaves = new Set(source.baked.topology.leaves.map((leaf) => leaf.leafIndex));
  const audits: ProcPlantWeberPennBakedTrimOperationAudit[] = [];

  const descendants = (roots: ReadonlySet<number>) => {
    const result = new Set(roots);
    const queue = [...roots];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const stem = stemByIndex.get(queue[cursor]!);
      for (const child of stem?.childStemIndices ?? []) {
        if (!result.has(child)) {
          result.add(child);
          queue.push(child);
        }
      }
    }
    return result;
  };
  const ancestors = (roots: ReadonlySet<number>) => {
    const result = new Set(roots);
    for (const root of roots) {
      let parent = stemByIndex.get(root)?.parentStemIndex ?? null;
      while (parent !== null && !result.has(parent)) {
        result.add(parent);
        parent = stemByIndex.get(parent)?.parentStemIndex ?? null;
      }
    }
    return result;
  };

  for (const operation of overrides.operations) {
    const beforeStems = new Set(retainedStems);
    const beforeLeaves = new Set(retainedLeaves);
    let matchedStems = new Set<number>();
    let matchedLeaves = new Set<number>();
    let unknownIds: string[] = [];
    let unsupported: string | null = null;

    if (operation.selection.kind === "segment-ids") {
      const requested = operation.selection.segmentIds.map((id) => ({ id, index: parseStemId(id) }));
      unknownIds = requested.filter(({ index }) => index === null || !stemByIndex.has(index)).map(({ id }) => id);
      matchedStems = new Set(requested.flatMap(({ index }) => index !== null && retainedStems.has(index) ? [index] : []));
    } else if (operation.selection.kind === "branch-depth") {
      const selection = operation.selection;
      matchedStems = new Set([...retainedStems].filter((index) => {
        const depth = stemByIndex.get(index)!.depth;
        return depth >= (selection.minDepth ?? 0) && depth <= (selection.maxDepth ?? Number.MAX_SAFE_INTEGER);
      }));
    } else if (operation.selection.kind === "attachment-ids") {
      unknownIds = operation.selection.attachmentIds.filter((id) => !leafById.has(id) && !sourceTipById.has(id));
      matchedLeaves = new Set(operation.selection.attachmentIds.flatMap((id) => {
        const leaf = leafById.get(id);
        return leaf && retainedLeaves.has(leaf.leafIndex) ? [leaf.leafIndex] : [];
      }));
      matchedStems = new Set(operation.selection.attachmentIds.flatMap((id) => {
        const index = sourceTipById.get(id) ?? parseBranchTipId(id);
        return index !== null && sourceTipStemIndices.has(index) && retainedStems.has(index) ? [index] : [];
      }));
    } else if (operation.selection.kind === "attachment-kind") {
      if (operation.selection.attachmentKinds.includes("branch-tip")) {
        matchedStems = new Set([...sourceTipStemIndices].filter((index) => retainedStems.has(index)));
      }
      if (operation.selection.attachmentKinds.includes("leaf-site")) {
        matchedLeaves = new Set(retainedLeaves);
      }
    } else if (operation.selection.kind === "axial-range") {
      matchedStems = new Set([...retainedStems].filter((index) => {
        const height = stemHeight(index);
        return height !== null && heightMatches(height, operation.selection as Extract<ProcPlantWeberPennTrimSelection, { kind: "axial-range" }>);
      }));
      matchedLeaves = new Set([...retainedLeaves].filter((index) =>
        heightMatches(leafHeight(index), operation.selection as Extract<ProcPlantWeberPennTrimSelection, { kind: "axial-range" }>)));
    } else {
      matchedStems = new Set([...retainedStems].filter((index) => {
        const height = stemHeight(index);
        return height !== null && heightMatches(height, operation.selection as Extract<ProcPlantWeberPennTrimSelection, { kind: "height-plane" }>);
      }));
      matchedLeaves = new Set([...retainedLeaves].filter((index) =>
        heightMatches(leafHeight(index), operation.selection as Extract<ProcPlantWeberPennTrimSelection, { kind: "height-plane" }>)));
    }

    const noMatch = matchedStems.size === 0 && matchedLeaves.size === 0;
    if (unsupported || unknownIds.length > 0 || noMatch) {
      audits.push({
        operationId: operation.id,
        status: unsupported ? "unsupported" : "no-match",
        matchedStemIds: [...matchedStems].map(stemId).sort(stableCompare),
        matchedLeafIds: source.baked.topology.leaves.filter((leaf) => matchedLeaves.has(leaf.leafIndex)).map((leaf) => leaf.attachmentId).sort(stableCompare),
        removedStemIds: [],
        removedLeafIds: [],
        unknownIds: unknownIds.sort(stableCompare),
        reason: unsupported ?? (unknownIds.length > 0 ? "Selection contains identities that are not present in the bound source." : "Selection matched no retained baked geometry."),
      });
      return unchangedBakedAudit(
        source,
        unsupported ? "unsupported" : "no-op",
        "Baked trim is atomic; an unsupported or unmatched operation left all source geometry unchanged.",
        audits,
      );
    }

    if (matchedStems.size > 0) {
      if (operation.action === "remove") {
        const removed = descendants(matchedStems);
        retainedStems = new Set([...retainedStems].filter((index) => !removed.has(index)));
      } else {
        const kept = ancestors(matchedStems);
        retainedStems = new Set([...retainedStems].filter((index) => kept.has(index)));
      }
      retainedLeaves = new Set([...retainedLeaves].filter((leafIndex) => {
        const leaf = leafByIndex.get(leafIndex)!;
        return retainedStems.has(leaf.parentStemIndex);
      }));
    }
    if (matchedLeaves.size > 0) {
      retainedLeaves = operation.action === "remove"
        ? new Set([...retainedLeaves].filter((index) => !matchedLeaves.has(index)))
        : new Set([...retainedLeaves].filter((index) => matchedLeaves.has(index)));
    }

    const removedStemIds = [...beforeStems].filter((index) => !retainedStems.has(index)).map(stemId).sort(stableCompare);
    const removedLeafIds = source.baked.topology.leaves
      .filter((leaf) => beforeLeaves.has(leaf.leafIndex) && !retainedLeaves.has(leaf.leafIndex))
      .map((leaf) => leaf.attachmentId)
      .sort(stableCompare);
    audits.push({
      operationId: operation.id,
      status: "applied",
      matchedStemIds: [...matchedStems].map(stemId).sort(stableCompare),
      matchedLeafIds: source.baked.topology.leaves.filter((leaf) => matchedLeaves.has(leaf.leafIndex)).map((leaf) => leaf.attachmentId).sort(stableCompare),
      removedStemIds,
      removedLeafIds,
      unknownIds: [],
      reason: null,
    });
  }

  if (![...retainedStems].some((index) => stemByIndex.get(index)?.baked)) {
    const last = audits.at(-1);
    if (last) {
      last.status = "unsupported";
      last.removedStemIds = [];
      last.removedLeafIds = [];
      last.reason = "Trim would remove the complete baked branch skeleton and leave no exportable plant geometry.";
    }
    return unchangedBakedAudit(
      source,
      "unsupported",
      "Baked trim is atomic; removing the complete branch skeleton is not exportable and left the source unchanged.",
      audits,
    );
  }

  const baked = filterBakedTreeGeometry(source.baked, retainedStems, retainedLeaves);
  const removedStemIds = source.baked.topology.stems.filter((stem) => !retainedStems.has(stem.stemIndex)).map((stem) => stemId(stem.stemIndex)).sort(stableCompare);
  const removedLeafIds = source.baked.topology.leaves.filter((leaf) => !retainedLeaves.has(leaf.leafIndex)).map((leaf) => leaf.attachmentId).sort(stableCompare);
  const geometryChanged = baked.branches.indices.length !== source.baked.branches.indices.length || baked.leaves.indices.length !== source.baked.leaves.indices.length;
  return {
    contract: PROCPLANT_WEBER_PENN_TRIM_CONTRACT,
    version: PROCPLANT_WEBER_PENN_TRIM_VERSION,
    baked,
    audit: {
      status: geometryChanged ? "applied" : "no-op",
      sourceTopologySignature: source.baked.topology.signature,
      resultTopologySignature: baked.topology.signature,
      beforeBranchTriangles: source.baked.branches.indices.length / 3,
      afterBranchTriangles: baked.branches.indices.length / 3,
      beforeNativeLeafTriangles: source.baked.leaves.indices.length / 3,
      afterNativeLeafTriangles: baked.leaves.indices.length / 3,
      removedStemIds,
      removedLeafIds,
      operations: audits,
      geometryChanged,
      bakedBranchTopologySupported: true,
      nativeLeafGeometrySupported: true,
      note: geometryChanged
        ? "Selected baked ranges were removed with descendant closure, ancestor retention, and native leaf ownership repair."
        : "Selections changed no baked triangles.",
    },
  };
};
