import type { ProcPlantAttachmentAnchor, ProcPlantGraph } from "./procplants";

export const PROCPLANT_WEBER_PENN_TRIM_CONTRACT = "procplants.weber-penn-trim-overrides" as const;
export const PROCPLANT_WEBER_PENN_TRIM_VERSION = 1 as const;

export interface ProcPlantWeberPennTrimTarget {
  backend: "weber-penn";
  genomeId: string;
  seed: number;
}

export type ProcPlantWeberPennStableAttachmentKind = "leaf-site" | "branch-tip";

export type ProcPlantWeberPennTrimSelection =
  | { kind: "attachment-ids"; attachmentIds: readonly string[] }
  | { kind: "attachment-kind"; attachmentKinds: readonly ProcPlantWeberPennStableAttachmentKind[] }
  | { kind: "axial-range"; min: number; max: number }
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
  return { backend: "weber-penn", genomeId: target.genomeId, seed: target.seed };
};

const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort(stableCompare);

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
  left.backend === right.backend && left.genomeId === right.genomeId && left.seed === right.seed;

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
