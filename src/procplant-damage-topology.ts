import type {
  ProcPlantAttachmentAnchor,
  ProcPlantGraph,
  ProcPlantOrgan,
  ProcPlantStemNode,
} from "./procplants";
import {
  buildProcPlantOrganVariants,
  type ProcPlantOrganVariantPackage,
} from "./procplant-organ-variants";
import { pruneProcPlantGraph, type ProcPlantPruningAudit } from "./procplant-pruning";

export const PROCPLANT_DAMAGE_TOPOLOGY_CONTRACT = "procplants.damage-topology" as const;
export const PROCPLANT_DAMAGE_TOPOLOGY_VERSION = 1 as const;
export const PROCPLANT_DAMAGE_TOPOLOGY_MAX_ATTACHMENTS = 500_000;
export const PROCPLANT_DAMAGE_TOPOLOGY_MAX_SEGMENTS = 250_000;
export const PROCPLANT_DAMAGE_TOPOLOGY_MAX_MISSING_ORGANS = 4_096;
export const PROCPLANT_DAMAGE_TOPOLOGY_MAX_BROKEN_BRANCHES = 256;
export const PROCPLANT_DAMAGE_TOPOLOGY_MAX_SCARS = 256;

export interface ProcPlantDamageTopologyOptions {
  /** Explicit opt-in. Omitted or false preserves the source graph reference exactly. */
  enabled?: boolean;
  missingOrganRate?: number;
  brokenBranchRate?: number;
  minBreakDepth?: number;
  maxMissingOrgans?: number;
  maxBrokenBranches?: number;
  maxScars?: number;
}

export interface ProcPlantNormalizedDamageTopologyOptions {
  enabled: boolean;
  missingOrganRate: number;
  brokenBranchRate: number;
  minBreakDepth: number;
  maxMissingOrgans: number;
  maxBrokenBranches: number;
  maxScars: number;
}

export interface ProcPlantDamageTopologyTarget {
  graphSignature: string;
  organVariantFingerprint: string;
}

export interface ProcPlantDamageTopologySelectionAudit {
  severity: number;
  eligibleOrganCount: number;
  eligibleBranchCount: number;
  selectedMissingOrganCount: number;
  selectedBrokenBranchCount: number;
  organCandidatesOmittedByCap: number;
  branchCandidatesOmittedByCap: number;
}

export interface ProcPlantDamageTopologyPlan {
  contract: typeof PROCPLANT_DAMAGE_TOPOLOGY_CONTRACT;
  version: typeof PROCPLANT_DAMAGE_TOPOLOGY_VERSION;
  target: ProcPlantDamageTopologyTarget;
  options: ProcPlantNormalizedDamageTopologyOptions;
  missingAttachmentIds: string[];
  brokenSegmentIds: string[];
  selection: ProcPlantDamageTopologySelectionAudit;
  fingerprint: string;
}

export interface ProcPlantDamageScarRecord {
  id: string;
  kind: "branch-break";
  cause: "health-age-damage";
  sourceSegmentId: string;
  parentSegmentId: string | null;
  position: [number, number, number];
  tangent: [number, number, number];
  radius: number;
  depth: number;
}

export type ProcPlantDamageTopologyStatus =
  | "disabled"
  | "no-op"
  | "applied"
  | "partial"
  | "target-mismatch";

export interface ProcPlantDamageTopologyAudit {
  status: ProcPlantDamageTopologyStatus;
  targetGraphSignature: string;
  actualGraphSignature: string;
  requestedMissingAttachmentIds: string[];
  appliedMissingAttachmentIds: string[];
  missingAttachmentIdsCoveredByBreak: string[];
  requestedBrokenSegmentIds: string[];
  appliedBrokenRootSegmentIds: string[];
  brokenSegmentIdsCoveredByAncestor: string[];
  removedSegmentIds: string[];
  removedAttachmentIds: string[];
  removedOrganCount: number;
  scarOmittedSegmentIds: string[];
  pruning: ProcPlantPruningAudit | null;
  selection: ProcPlantDamageTopologySelectionAudit;
  note: string;
}

export interface ProcPlantDamageTopologyResult {
  contract: typeof PROCPLANT_DAMAGE_TOPOLOGY_CONTRACT;
  version: typeof PROCPLANT_DAMAGE_TOPOLOGY_VERSION;
  graph: ProcPlantGraph;
  scars: ProcPlantDamageScarRecord[];
  audit: ProcPlantDamageTopologyAudit;
}

const stableCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const hashHex = (value: string) => fnv1a(value).toString(16).padStart(8, "0");

const random01 = (seed: number, id: string, channel: number) => {
  let state = (seed ^ fnv1a(id) ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x1_0000_0000;
};

const finiteUnit = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be in [0, 1]`);
  return value;
};

const boundedInteger = (value: number, label: string, minimum: number, maximum: number) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
};

const normalizeOptions = (
  options: ProcPlantDamageTopologyOptions = {},
): ProcPlantNormalizedDamageTopologyOptions => ({
  enabled: options.enabled === true,
  missingOrganRate: finiteUnit(options.missingOrganRate ?? 0.62, "damage missingOrganRate"),
  brokenBranchRate: finiteUnit(options.brokenBranchRate ?? 0.24, "damage brokenBranchRate"),
  minBreakDepth: boundedInteger(options.minBreakDepth ?? 1, "damage minBreakDepth", 1, 64),
  maxMissingOrgans: boundedInteger(
    options.maxMissingOrgans ?? 256,
    "damage maxMissingOrgans",
    0,
    PROCPLANT_DAMAGE_TOPOLOGY_MAX_MISSING_ORGANS,
  ),
  maxBrokenBranches: boundedInteger(
    options.maxBrokenBranches ?? 32,
    "damage maxBrokenBranches",
    0,
    PROCPLANT_DAMAGE_TOPOLOGY_MAX_BROKEN_BRANCHES,
  ),
  maxScars: boundedInteger(options.maxScars ?? 32, "damage maxScars", 0, PROCPLANT_DAMAGE_TOPOLOGY_MAX_SCARS),
});

const vectorSignature = (value: { x: number; y: number; z: number }) =>
  `${value.x.toPrecision(12)},${value.y.toPrecision(12)},${value.z.toPrecision(12)}`;

const assertFiniteVector = (value: { x: number; y: number; z: number }, label: string) => {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`${label} must be finite`);
};

const assertFiniteValues = (entries: ReadonlyArray<readonly [number, string]>) => {
  for (const [value, label] of entries) if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

/** Signature includes topology, attachment ancestry, and the geometry needed to anchor a break scar. */
export const createProcPlantDamageTopologyGraphSignature = (graph: ProcPlantGraph) => {
  if (graph.segmentRecords.length > PROCPLANT_DAMAGE_TOPOLOGY_MAX_SEGMENTS) {
    throw new Error(`damage topology segment cap exceeded (${PROCPLANT_DAMAGE_TOPOLOGY_MAX_SEGMENTS})`);
  }
  if (graph.attachments.length > PROCPLANT_DAMAGE_TOPOLOGY_MAX_ATTACHMENTS) {
    throw new Error(`damage topology attachment cap exceeded (${PROCPLANT_DAMAGE_TOPOLOGY_MAX_ATTACHMENTS})`);
  }
  const segmentIds = new Set<string>();
  const attachmentIds = new Set<string>();
  let source = `${PROCPLANT_DAMAGE_TOPOLOGY_CONTRACT}:target:v1`;
  const orderedRecords = [...graph.segmentRecords].sort((left, right) => stableCompare(left.id, right.id));
  for (const record of orderedRecords) {
    if (!record.id) throw new Error("damage topology segment IDs must be non-empty");
    if (segmentIds.has(record.id)) throw new Error(`duplicate damage topology segment ID: ${record.id}`);
    segmentIds.add(record.id);
    const start = graph.stems[record.startNodeIndex];
    const end = graph.stems[record.endNodeIndex];
    if (!start || !end) throw new Error(`damage topology segment ${record.id} references a missing stem node`);
    if (!Number.isInteger(record.depth) || record.depth < 0) throw new Error(`damage topology segment ${record.id} depth must be a non-negative integer`);
    assertFiniteVector(start.position, `damage topology segment ${record.id} start position`);
    assertFiniteVector(end.position, `damage topology segment ${record.id} end position`);
    assertFiniteVector(start.direction, `damage topology segment ${record.id} start direction`);
    assertFiniteVector(end.direction, `damage topology segment ${record.id} end direction`);
    assertFiniteValues([
      [record.axialStart, `damage topology segment ${record.id} axialStart`],
      [record.axialEnd, `damage topology segment ${record.id} axialEnd`],
    ]);
    if (!Number.isFinite(start.radius) || start.radius < 0) throw new Error(`damage topology segment ${record.id} start radius must be finite and non-negative`);
    if (!Number.isFinite(end.radius) || end.radius < 0) throw new Error(`damage topology segment ${record.id} end radius must be finite and non-negative`);
    source += `|s:${record.id}>${record.parentSegmentId ?? "root"}:${record.startNodeIndex}:${record.endNodeIndex}:${record.depth}:${record.axialStart.toPrecision(12)}:${record.axialEnd.toPrecision(12)}:${vectorSignature(start.position)}:${vectorSignature(end.position)}:${vectorSignature(start.direction)}:${vectorSignature(end.direction)}:${start.radius.toPrecision(12)}:${end.radius.toPrecision(12)}`;
  }
  const recordsById = new Map(orderedRecords.map((record) => [record.id, record]));
  for (const record of orderedRecords) {
    if (record.parentSegmentId !== null && !segmentIds.has(record.parentSegmentId)) {
      throw new Error(`damage topology segment ${record.id} references a missing parent segment`);
    }
    const ancestry = new Set([record.id]);
    let parentId = record.parentSegmentId;
    while (parentId) {
      if (ancestry.has(parentId)) throw new Error(`damage topology segment ancestry contains a cycle at ${parentId}`);
      ancestry.add(parentId);
      parentId = recordsById.get(parentId)?.parentSegmentId ?? null;
    }
  }
  for (const attachment of [...graph.attachments].sort((left, right) => stableCompare(left.id, right.id))) {
    if (!attachment.id) throw new Error("damage topology attachment IDs must be non-empty");
    if (attachmentIds.has(attachment.id)) throw new Error(`duplicate damage topology attachment ID: ${attachment.id}`);
    attachmentIds.add(attachment.id);
    if (attachment.parentSegmentId !== null && !segmentIds.has(attachment.parentSegmentId)) {
      throw new Error(`damage topology attachment ${attachment.id} references a missing parent segment`);
    }
    if (attachment.organIndex !== null && (!Number.isInteger(attachment.organIndex) || attachment.organIndex < 0)) {
      throw new Error(`damage topology attachment ${attachment.id} has an invalid organ index`);
    }
    const organ = attachment.organIndex === null ? null : graph.organs[attachment.organIndex];
    if (attachment.organIndex !== null && !organ) {
      throw new Error(`damage topology attachment ${attachment.id} references a missing organ`);
    }
    assertFiniteVector(attachment.position, `damage topology attachment ${attachment.id} position`);
    assertFiniteVector(attachment.tangent, `damage topology attachment ${attachment.id} tangent`);
    assertFiniteVector(attachment.right, `damage topology attachment ${attachment.id} right`);
    assertFiniteVector(attachment.up, `damage topology attachment ${attachment.id} up`);
    assertFiniteValues([
      [attachment.axialT, `damage topology attachment ${attachment.id} axialT`],
      [attachment.depth, `damage topology attachment ${attachment.id} depth`],
      [attachment.sway, `damage topology attachment ${attachment.id} sway`],
    ]);
    if (organ && (!Number.isFinite(organ.scale) || organ.scale < 0)) {
      throw new Error(`damage topology attachment ${attachment.id} organ scale must be finite and non-negative`);
    }
    if (organ) {
      assertFiniteVector(organ.position, `damage topology attachment ${attachment.id} organ position`);
      assertFiniteVector(organ.direction, `damage topology attachment ${attachment.id} organ direction`);
      assertFiniteVector(organ.right, `damage topology attachment ${attachment.id} organ right`);
      assertFiniteValues([[organ.t, `damage topology attachment ${attachment.id} organ t`]]);
    }
    source += `|a:${attachment.id}>${attachment.parentSegmentId ?? "root"}:${attachment.kind}:${attachment.organIndex ?? "none"}:${attachment.axialT.toPrecision(12)}:${attachment.depth}:${attachment.sway.toPrecision(12)}:${vectorSignature(attachment.position)}:${vectorSignature(attachment.tangent)}:${vectorSignature(attachment.right)}:${vectorSignature(attachment.up)}:${organ ? `${organ.kind}:${organ.scale.toPrecision(12)}:${organ.t.toPrecision(12)}:${vectorSignature(organ.position)}:${vectorSignature(organ.direction)}:${vectorSignature(organ.right)}:${organ.color ?? "none"}:${organ.secondaryColor ?? "none"}:${organ.bend ?? "none"}` : "none"}`;
  }
  return `pdt1:${hashHex(source)}:${graph.segmentRecords.length}:${graph.attachments.length}:${graph.organs.length}`;
};

const planFingerprint = (plan: Omit<ProcPlantDamageTopologyPlan, "fingerprint">) => hashHex(JSON.stringify(plan));

const normalizePlan = (value: ProcPlantDamageTopologyPlan): ProcPlantDamageTopologyPlan => {
  if (value.contract !== PROCPLANT_DAMAGE_TOPOLOGY_CONTRACT) {
    throw new Error(`unsupported damage topology contract: ${String(value.contract)}`);
  }
  if (value.version !== PROCPLANT_DAMAGE_TOPOLOGY_VERSION) {
    throw new Error(`unsupported damage topology version: ${String(value.version)}`);
  }
  if (!value.target?.graphSignature || !value.target.organVariantFingerprint) {
    throw new Error("damage topology target signatures must be non-empty");
  }
  const options = normalizeOptions(value.options);
  if (options.enabled !== value.options.enabled) throw new Error("damage topology enabled must be boolean");
  const normalizeIds = (ids: readonly string[], label: string, cap: number) => {
    if (!Array.isArray(ids) || ids.length > cap) throw new Error(`${label} exceeds its cap (${cap})`);
    if (ids.some((id) => typeof id !== "string" || !id)) throw new Error(`${label} must contain non-empty IDs`);
    const ordered = [...ids].sort(stableCompare);
    if (new Set(ordered).size !== ordered.length) throw new Error(`${label} must not contain duplicate IDs`);
    return ordered;
  };
  const missingAttachmentIds = normalizeIds(value.missingAttachmentIds, "damage missingAttachmentIds", options.maxMissingOrgans);
  const brokenSegmentIds = normalizeIds(value.brokenSegmentIds, "damage brokenSegmentIds", options.maxBrokenBranches);
  const selection = { ...value.selection };
  for (const [label, entry] of Object.entries(selection)) {
    if (!Number.isFinite(entry) || entry < 0) throw new Error(`damage selection ${label} must be finite and non-negative`);
  }
  if (selection.severity > 1) throw new Error("damage selection severity must be in [0, 1]");
  for (const [label, entry] of Object.entries(selection).filter(([key]) => key !== "severity")) {
    if (!Number.isInteger(entry)) throw new Error(`damage selection ${label} must be an integer`);
  }
  if (selection.selectedMissingOrganCount !== missingAttachmentIds.length ||
    selection.selectedBrokenBranchCount !== brokenSegmentIds.length) {
    throw new Error("damage selection counts must match selected topology IDs");
  }
  const normalizedWithoutFingerprint: Omit<ProcPlantDamageTopologyPlan, "fingerprint"> = {
    contract: PROCPLANT_DAMAGE_TOPOLOGY_CONTRACT,
    version: PROCPLANT_DAMAGE_TOPOLOGY_VERSION,
    target: { ...value.target },
    options,
    missingAttachmentIds,
    brokenSegmentIds,
    selection,
  };
  const fingerprint = planFingerprint(normalizedWithoutFingerprint);
  if (value.fingerprint !== fingerprint) throw new Error("damage topology plan fingerprint mismatch");
  return { ...normalizedWithoutFingerprint, fingerprint };
};

const orderedByScoreThenId = <T extends { id: string; score: number }>(left: T, right: T) =>
  left.score - right.score || stableCompare(left.id, right.id);

/**
 * Derive an explicit, deterministic topology plan from existing health/age masks.
 * Rates are procedural art controls, not calibrated physiology or disease models.
 */
export const createProcPlantDamageTopologyPlan = (
  graph: ProcPlantGraph,
  organVariants: ProcPlantOrganVariantPackage,
  inputOptions: ProcPlantDamageTopologyOptions = {},
): ProcPlantDamageTopologyPlan => {
  const options = normalizeOptions(inputOptions);
  const graphSignature = createProcPlantDamageTopologyGraphSignature(graph);
  const rebuiltVariants = buildProcPlantOrganVariants(graph.attachments, organVariants.spec);
  if (rebuiltVariants.fingerprint !== organVariants.fingerprint) {
    throw new Error("organ variant package does not match the supplied graph attachments");
  }
  const severity = clamp01((1 - rebuiltVariants.spec.health) * 0.82 + (1 - rebuiltVariants.spec.maturity) * 0.18);
  const stateById = new Map(rebuiltVariants.states.map((state) => [state.attachmentId, state]));
  const eligibleOrgans = [...graph.attachments]
    .filter((attachment) => attachment.organIndex !== null && stateById.has(attachment.id))
    .sort((left, right) => stableCompare(left.id, right.id));
  const eligibleBranches = [...graph.segmentRecords]
    .filter((record) => record.parentSegmentId !== null && record.depth >= options.minBreakDepth)
    .sort((left, right) => left.depth - right.depth || stableCompare(left.id, right.id));
  const organCandidates = options.enabled && severity > 0
    ? eligibleOrgans.flatMap((attachment) => {
        const state = stateById.get(attachment.id)!;
        const probability = clamp01(severity * options.missingOrganRate * (0.82 + (1 - state.health) * 0.18));
        const score = random01(rebuiltVariants.spec.seed, attachment.id, 19);
        return score < probability ? [{ id: attachment.id, score }] : [];
      }).sort(orderedByScoreThenId)
    : [];
  const branchCandidates = options.enabled && severity > 0
    ? eligibleBranches.flatMap((record) => {
        const probability = clamp01(severity * options.brokenBranchRate);
        const score = random01(rebuiltVariants.spec.seed, record.id, 23);
        return score < probability ? [{ id: record.id, score, depth: record.depth }] : [];
      }).sort((left, right) => left.depth - right.depth || orderedByScoreThenId(left, right))
    : [];
  const missingAttachmentIds = organCandidates.slice(0, options.maxMissingOrgans).map((entry) => entry.id).sort(stableCompare);
  const brokenSegmentIds = branchCandidates.slice(0, options.maxBrokenBranches).map((entry) => entry.id).sort(stableCompare);
  const selection: ProcPlantDamageTopologySelectionAudit = {
    severity,
    eligibleOrganCount: eligibleOrgans.length,
    eligibleBranchCount: eligibleBranches.length,
    selectedMissingOrganCount: missingAttachmentIds.length,
    selectedBrokenBranchCount: brokenSegmentIds.length,
    organCandidatesOmittedByCap: Math.max(0, organCandidates.length - missingAttachmentIds.length),
    branchCandidatesOmittedByCap: Math.max(0, branchCandidates.length - brokenSegmentIds.length),
  };
  const withoutFingerprint: Omit<ProcPlantDamageTopologyPlan, "fingerprint"> = {
    contract: PROCPLANT_DAMAGE_TOPOLOGY_CONTRACT,
    version: PROCPLANT_DAMAGE_TOPOLOGY_VERSION,
    target: { graphSignature, organVariantFingerprint: rebuiltVariants.fingerprint },
    options,
    missingAttachmentIds,
    brokenSegmentIds,
    selection,
  };
  return { ...withoutFingerprint, fingerprint: planFingerprint(withoutFingerprint) };
};

export const serializeProcPlantDamageTopologyPlan = (plan: ProcPlantDamageTopologyPlan) =>
  JSON.stringify(normalizePlan(plan));

export const deserializeProcPlantDamageTopologyPlan = (serialized: string): ProcPlantDamageTopologyPlan => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("damage topology plan must be valid JSON");
  }
  if (!value || typeof value !== "object") throw new Error("damage topology plan must be an object");
  return normalizePlan(value as ProcPlantDamageTopologyPlan);
};

const cloneStem = (stem: ProcPlantStemNode, index: number): ProcPlantStemNode => ({
  ...stem,
  index,
  position: stem.position.clone(),
  direction: stem.direction.clone(),
});

const cloneOrgan = (organ: ProcPlantOrgan): ProcPlantOrgan => ({
  ...organ,
  position: organ.position.clone(),
  direction: organ.direction.clone(),
  right: organ.right.clone(),
});

const cloneAttachment = (attachment: ProcPlantAttachmentAnchor, organIndex: number | null): ProcPlantAttachmentAnchor => ({
  ...attachment,
  organIndex,
  position: attachment.position.clone(),
  tangent: attachment.tangent.clone(),
  right: attachment.right.clone(),
  up: attachment.up.clone(),
});

const removeAttachmentsAndRepair = (graph: ProcPlantGraph, removedIds: ReadonlySet<string>): ProcPlantGraph => {
  if (removedIds.size === 0) return graph;
  const removedOrganIndices = new Set<number>();
  for (const attachment of graph.attachments) {
    if (removedIds.has(attachment.id) && attachment.organIndex !== null) removedOrganIndices.add(attachment.organIndex);
  }
  const retainedAttachments = graph.attachments.filter((attachment) => !removedIds.has(attachment.id));
  const stillReferencedOrganIndices = new Set(
    retainedAttachments.flatMap((attachment) => attachment.organIndex === null ? [] : [attachment.organIndex]),
  );
  const oldToNewOrgan = new Map<number, number>();
  const organs: ProcPlantOrgan[] = [];
  graph.organs.forEach((organ, oldIndex) => {
    if (removedOrganIndices.has(oldIndex) && !stillReferencedOrganIndices.has(oldIndex)) return;
    oldToNewOrgan.set(oldIndex, organs.length);
    organs.push(cloneOrgan(organ));
  });
  return {
    stems: graph.stems.map(cloneStem),
    segments: graph.segments.map(([start, end]) => [start, end]),
    organs,
    segmentRecords: graph.segmentRecords.map((record) => ({ ...record })),
    attachments: retainedAttachments.map((attachment) => cloneAttachment(
      attachment,
      attachment.organIndex === null ? null : oldToNewOrgan.get(attachment.organIndex) ?? null,
    )),
  };
};

const unchangedResult = (
  graph: ProcPlantGraph,
  plan: ProcPlantDamageTopologyPlan,
  actualGraphSignature: string,
  status: Extract<ProcPlantDamageTopologyStatus, "disabled" | "no-op" | "target-mismatch">,
  note: string,
): ProcPlantDamageTopologyResult => ({
  contract: PROCPLANT_DAMAGE_TOPOLOGY_CONTRACT,
  version: PROCPLANT_DAMAGE_TOPOLOGY_VERSION,
  graph,
  scars: [],
  audit: {
    status,
    targetGraphSignature: plan.target.graphSignature,
    actualGraphSignature,
    requestedMissingAttachmentIds: [...plan.missingAttachmentIds],
    appliedMissingAttachmentIds: [],
    missingAttachmentIdsCoveredByBreak: [],
    requestedBrokenSegmentIds: [...plan.brokenSegmentIds],
    appliedBrokenRootSegmentIds: [],
    brokenSegmentIdsCoveredByAncestor: [],
    removedSegmentIds: [],
    removedAttachmentIds: [],
    removedOrganCount: 0,
    scarOmittedSegmentIds: [],
    pruning: null,
    selection: { ...plan.selection },
    note,
  },
});

const ancestorInSet = (
  segmentId: string,
  selected: ReadonlySet<string>,
  records: ReadonlyMap<string, { parentSegmentId: string | null }>,
) => {
  let parentId = records.get(segmentId)?.parentSegmentId ?? null;
  while (parentId) {
    if (selected.has(parentId)) return parentId;
    parentId = records.get(parentId)?.parentSegmentId ?? null;
  }
  return null;
};

const scarForSegment = (
  graph: ProcPlantGraph,
  segmentId: string,
  targetSignature: string,
): ProcPlantDamageScarRecord => {
  const record = graph.segmentRecords.find((entry) => entry.id === segmentId)!;
  const start = graph.stems[record.startNodeIndex]!;
  const end = graph.stems[record.endNodeIndex]!;
  const tangent = end.position.clone().sub(start.position);
  if (tangent.lengthSq() <= 1e-12) tangent.copy(start.direction);
  if (tangent.lengthSq() <= 1e-12) tangent.set(0, 1, 0);
  tangent.normalize();
  return {
    id: `damage-scar:${hashHex(`${targetSignature}:${segmentId}`)}`,
    kind: "branch-break",
    cause: "health-age-damage",
    sourceSegmentId: segmentId,
    parentSegmentId: record.parentSegmentId,
    position: [start.position.x, start.position.y, start.position.z],
    tangent: [tangent.x, tangent.y, tangent.z],
    radius: Math.max(0, start.radius),
    depth: record.depth,
  };
};

/** Apply a validated plan with stable pruning and organ-index repair. */
export const applyProcPlantDamageTopologyPlan = (
  source: ProcPlantGraph,
  planValue: ProcPlantDamageTopologyPlan,
): ProcPlantDamageTopologyResult => {
  const plan = normalizePlan(planValue);
  const actualGraphSignature = createProcPlantDamageTopologyGraphSignature(source);
  if (actualGraphSignature !== plan.target.graphSignature) {
    return unchangedResult(source, plan, actualGraphSignature, "target-mismatch", "Plan target does not match this graph and was not applied.");
  }
  if (!plan.options.enabled) {
    return unchangedResult(source, plan, actualGraphSignature, "disabled", "Damage topology is opt-in; source graph and canonical geometry are unchanged.");
  }
  if (plan.missingAttachmentIds.length === 0 && plan.brokenSegmentIds.length === 0) {
    return unchangedResult(source, plan, actualGraphSignature, "no-op", "No deterministic damage candidates passed the authored rates and caps.");
  }

  const recordById = new Map(source.segmentRecords.map((record) => [record.id, record]));
  const requestedBreakSet = new Set(plan.brokenSegmentIds.filter((id) => {
    const record = recordById.get(id);
    return record !== undefined && record.parentSegmentId !== null && record.depth >= plan.options.minBreakDepth;
  }));
  const appliedBrokenRootSegmentIds = [...requestedBreakSet]
    .filter((id) => !ancestorInSet(id, requestedBreakSet, recordById))
    .sort(stableCompare);
  const brokenSegmentIdsCoveredByAncestor = [...requestedBreakSet]
    .filter((id) => ancestorInSet(id, requestedBreakSet, recordById) !== null)
    .sort(stableCompare);
  const canonicalSource: ProcPlantGraph = {
    ...source,
    segmentRecords: [...source.segmentRecords].sort((left, right) => stableCompare(left.id, right.id)),
    attachments: [...source.attachments].sort((left, right) => stableCompare(left.id, right.id)),
  };
  const pruned = appliedBrokenRootSegmentIds.length > 0
    ? pruneProcPlantGraph(canonicalSource, {
        operation: "remove",
        selection: { kind: "segmentIds", segmentIds: appliedBrokenRootSegmentIds },
      })
    : null;
  const afterBreaks = pruned?.graph ?? canonicalSource;
  const afterBreakAttachmentIds = new Set(afterBreaks.attachments.map((attachment) => attachment.id));
  const missingAttachmentIdsCoveredByBreak = plan.missingAttachmentIds
    .filter((id) => source.attachments.some((attachment) => attachment.id === id && attachment.organIndex !== null) && !afterBreakAttachmentIds.has(id))
    .sort(stableCompare);
  const appliedMissingAttachmentIds = plan.missingAttachmentIds
    .filter((id) => afterBreaks.attachments.some((attachment) => attachment.id === id && attachment.organIndex !== null))
    .sort(stableCompare);
  const graph = removeAttachmentsAndRepair(afterBreaks, new Set(appliedMissingAttachmentIds));
  const retainedSegmentIds = new Set(graph.segmentRecords.map((record) => record.id));
  const retainedAttachmentIds = new Set(graph.attachments.map((attachment) => attachment.id));
  const removedSegmentIds = source.segmentRecords.filter((record) => !retainedSegmentIds.has(record.id)).map((record) => record.id).sort(stableCompare);
  const removedAttachmentIds = source.attachments.filter((attachment) => !retainedAttachmentIds.has(attachment.id)).map((attachment) => attachment.id).sort(stableCompare);
  const scarSegmentIds = appliedBrokenRootSegmentIds.slice(0, plan.options.maxScars);
  const scarOmittedSegmentIds = appliedBrokenRootSegmentIds.slice(plan.options.maxScars);
  const scars = scarSegmentIds.map((segmentId) => scarForSegment(source, segmentId, plan.target.graphSignature));
  const requestedMissingApplicable = plan.missingAttachmentIds.filter((id) =>
    source.attachments.some((attachment) => attachment.id === id && attachment.organIndex !== null));
  const partial = requestedMissingApplicable.length !== plan.missingAttachmentIds.length ||
    requestedBreakSet.size !== plan.brokenSegmentIds.length || scarOmittedSegmentIds.length > 0;
  return {
    contract: PROCPLANT_DAMAGE_TOPOLOGY_CONTRACT,
    version: PROCPLANT_DAMAGE_TOPOLOGY_VERSION,
    graph,
    scars,
    audit: {
      status: partial ? "partial" : "applied",
      targetGraphSignature: plan.target.graphSignature,
      actualGraphSignature,
      requestedMissingAttachmentIds: [...plan.missingAttachmentIds],
      appliedMissingAttachmentIds,
      missingAttachmentIdsCoveredByBreak,
      requestedBrokenSegmentIds: [...plan.brokenSegmentIds],
      appliedBrokenRootSegmentIds,
      brokenSegmentIdsCoveredByAncestor,
      removedSegmentIds,
      removedAttachmentIds,
      removedOrganCount: source.organs.length - graph.organs.length,
      scarOmittedSegmentIds,
      pruning: pruned?.audit ?? null,
      selection: { ...plan.selection },
      note: "Missing organs and broken branches are deterministic procedural damage controls, not simulated pathology or calibrated physiology.",
    },
  };
};

/** Convenience wrapper; omitted options remain a strict identity operation. */
export const buildProcPlantDamagedVariantTopology = (
  graph: ProcPlantGraph,
  organVariants: ProcPlantOrganVariantPackage,
  options: ProcPlantDamageTopologyOptions = {},
) => applyProcPlantDamageTopologyPlan(graph, createProcPlantDamageTopologyPlan(graph, organVariants, options));
