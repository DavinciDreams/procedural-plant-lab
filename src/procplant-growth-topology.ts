import type { ProcPlantGraph } from "./procplants";
import {
  createProcPlantGrowthSimulationGraphSignature,
  PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION,
  type ProcPlantGrowthSimulationStepResult,
} from "./procplant-growth-simulation";
import { pruneProcPlantGraph, type ProcPlantPruningAudit } from "./procplant-pruning";

export const PROCPLANT_GROWTH_TOPOLOGY_CONTRACT = "procplants.growth-topology-plan" as const;
export const PROCPLANT_GROWTH_TOPOLOGY_VERSION = 1 as const;

export interface ProcPlantGrowthTopologyTarget {
  graphSignature: string;
  sourceStep: number;
  completedSteps: number;
}

export type ProcPlantGrowthTopologyRecommendation =
  | {
      kind: "self-prune";
      segmentId: string;
      confirmed: true;
      evidenceSteps: number;
    }
  | {
      kind: "activate";
      segmentId: string;
      confirmed: true;
      evidenceSteps: number;
    };

export interface ProcPlantGrowthTopologyPlan {
  contract: typeof PROCPLANT_GROWTH_TOPOLOGY_CONTRACT;
  version: typeof PROCPLANT_GROWTH_TOPOLOGY_VERSION;
  target: ProcPlantGrowthTopologyTarget;
  recommendations: ProcPlantGrowthTopologyRecommendation[];
}

export type ProcPlantGrowthTopologyEntryStatus =
  | "applied"
  | "covered-by-ancestor"
  | "unmatched"
  | "unsupported";

export interface ProcPlantGrowthTopologyAuditEntry {
  kind: ProcPlantGrowthTopologyRecommendation["kind"];
  segmentId: string;
  status: ProcPlantGrowthTopologyEntryStatus;
  reason: string;
}

export type ProcPlantGrowthTopologyStatus =
  | "no-op"
  | "applied"
  | "partial"
  | "unsupported"
  | "unmatched"
  | "target-mismatch";

export interface ProcPlantGrowthTopologyAudit {
  status: ProcPlantGrowthTopologyStatus;
  targetGraphSignature: string;
  actualGraphSignature: string;
  requestedSelfPruneIds: string[];
  appliedSelfPruneRootIds: string[];
  removedSegmentIds: string[];
  removedAttachmentIds: string[];
  removedOrganCount: number;
  requestedActivationSegmentIds: string[];
  activatedBudIds: string[];
  addedSegmentIds: string[];
  addedAttachmentIds: string[];
  entries: ProcPlantGrowthTopologyAuditEntry[];
  pruning: ProcPlantPruningAudit | null;
  note: string;
}

export interface ProcPlantGrowthTopologyResult {
  contract: typeof PROCPLANT_GROWTH_TOPOLOGY_CONTRACT;
  version: typeof PROCPLANT_GROWTH_TOPOLOGY_VERSION;
  graph: ProcPlantGraph;
  audit: ProcPlantGrowthTopologyAudit;
}

export interface ProcPlantGrowthTopologyApplyOptions {
  /** New shoot length relative to its parent segment. */
  shootLengthScale?: number;
  minShootLength?: number;
  maxShootLength?: number;
  radiusScale?: number;
  maxActivations?: number;
}

const stableCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const normalizeTarget = (target: ProcPlantGrowthTopologyTarget): ProcPlantGrowthTopologyTarget => {
  if (typeof target.graphSignature !== "string" || !target.graphSignature) throw new Error("growth topology graphSignature must be non-empty");
  if (!Number.isInteger(target.sourceStep) || target.sourceStep < 0) throw new Error("growth topology sourceStep must be a non-negative integer");
  if (!Number.isInteger(target.completedSteps) || target.completedSteps !== target.sourceStep + 1) {
    throw new Error("growth topology completedSteps must equal sourceStep + 1");
  }
  return { ...target };
};

const normalizeRecommendation = (
  recommendation: ProcPlantGrowthTopologyRecommendation,
): ProcPlantGrowthTopologyRecommendation => {
  if (recommendation.kind !== "self-prune" && recommendation.kind !== "activate") {
    throw new Error(`unsupported growth topology recommendation: ${String((recommendation as { kind?: unknown }).kind)}`);
  }
  if (typeof recommendation.segmentId !== "string" || !recommendation.segmentId) {
    throw new Error("growth topology segmentId must be non-empty");
  }
  if (recommendation.confirmed !== true) throw new Error("growth topology recommendations must be confirmed");
  if (!Number.isInteger(recommendation.evidenceSteps) || recommendation.evidenceSteps < 1) {
    throw new Error("growth topology evidenceSteps must be a positive integer");
  }
  return { ...recommendation };
};

const normalizePlan = (plan: ProcPlantGrowthTopologyPlan): ProcPlantGrowthTopologyPlan => {
  if (plan.contract !== PROCPLANT_GROWTH_TOPOLOGY_CONTRACT) throw new Error(`unsupported growth topology contract: ${String(plan.contract)}`);
  if (plan.version !== PROCPLANT_GROWTH_TOPOLOGY_VERSION) throw new Error(`unsupported growth topology version: ${String(plan.version)}`);
  if (!Array.isArray(plan.recommendations)) throw new Error("growth topology recommendations must be an array");
  const recommendations = plan.recommendations.map(normalizeRecommendation).sort((left, right) =>
    stableCompare(left.segmentId, right.segmentId) || stableCompare(left.kind, right.kind));
  const keys = new Set<string>();
  for (const recommendation of recommendations) {
    const key = `${recommendation.kind}:${recommendation.segmentId}`;
    if (keys.has(key)) throw new Error(`duplicate growth topology recommendation: ${key}`);
    keys.add(key);
  }
  return {
    contract: PROCPLANT_GROWTH_TOPOLOGY_CONTRACT,
    version: PROCPLANT_GROWTH_TOPOLOGY_VERSION,
    target: normalizeTarget(plan.target),
    recommendations,
  };
};

/** Build a target-bound plan from confirmed decisions in one simulation step. */
export const createProcPlantGrowthTopologyPlan = (
  graph: ProcPlantGraph,
  step: ProcPlantGrowthSimulationStepResult,
): ProcPlantGrowthTopologyPlan => {
  if (step.version !== PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION) {
    throw new Error(`unsupported growth simulation result version: ${String(step.version)}`);
  }
  const signature = createProcPlantGrowthSimulationGraphSignature(graph);
  if (step.state.graphSignature !== signature) throw new Error("growth simulation result does not match the supplied graph topology");
  if (step.state.completedSteps !== step.step + 1) throw new Error("growth simulation result has inconsistent step state");
  const graphIds = new Set(graph.segmentRecords.map((record) => record.id));
  const seen = new Set<string>();
  const recommendations: ProcPlantGrowthTopologyRecommendation[] = [];
  for (const segment of step.segments) {
    if (seen.has(segment.segmentId)) throw new Error(`duplicate simulation segment result: ${segment.segmentId}`);
    seen.add(segment.segmentId);
    if (!graphIds.has(segment.segmentId)) throw new Error(`simulation result references missing graph segment: ${segment.segmentId}`);
    if (segment.selfPruneConfirmed) {
      recommendations.push({
        kind: "self-prune",
        segmentId: segment.segmentId,
        confirmed: true,
        evidenceSteps: Math.max(1, segment.selfPruneEvidenceSteps),
      });
    } else if (segment.action === "activate") {
      recommendations.push({
        kind: "activate",
        segmentId: segment.segmentId,
        confirmed: true,
        evidenceSteps: Math.max(1, segment.activationEvidenceSteps),
      });
    }
  }
  return normalizePlan({
    contract: PROCPLANT_GROWTH_TOPOLOGY_CONTRACT,
    version: PROCPLANT_GROWTH_TOPOLOGY_VERSION,
    target: { graphSignature: signature, sourceStep: step.step, completedSteps: step.state.completedSteps },
    recommendations,
  });
};

export const serializeProcPlantGrowthTopologyPlan = (plan: ProcPlantGrowthTopologyPlan) => JSON.stringify(normalizePlan(plan));

export const deserializeProcPlantGrowthTopologyPlan = (serialized: string): ProcPlantGrowthTopologyPlan => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("growth topology plan must be valid JSON");
  }
  if (!value || typeof value !== "object") throw new Error("growth topology plan must be an object");
  return normalizePlan(value as ProcPlantGrowthTopologyPlan);
};

const unchangedResult = (
  graph: ProcPlantGraph,
  plan: ProcPlantGrowthTopologyPlan,
  actualGraphSignature: string,
  status: ProcPlantGrowthTopologyStatus,
  entries: ProcPlantGrowthTopologyAuditEntry[],
  note: string,
): ProcPlantGrowthTopologyResult => ({
  contract: PROCPLANT_GROWTH_TOPOLOGY_CONTRACT,
  version: PROCPLANT_GROWTH_TOPOLOGY_VERSION,
  graph,
  audit: {
    status,
    targetGraphSignature: plan.target.graphSignature,
    actualGraphSignature,
    requestedSelfPruneIds: plan.recommendations.filter((entry) => entry.kind === "self-prune").map((entry) => entry.segmentId),
    appliedSelfPruneRootIds: [],
    removedSegmentIds: [],
    removedAttachmentIds: [],
    removedOrganCount: 0,
    requestedActivationSegmentIds: plan.recommendations.filter((entry) => entry.kind === "activate").map((entry) => entry.segmentId),
    activatedBudIds: [],
    addedSegmentIds: [],
    addedAttachmentIds: [],
    entries,
    pruning: null,
    note,
  },
});

const normalizedApplyOptions = (options: ProcPlantGrowthTopologyApplyOptions) => {
  const shootLengthScale = options.shootLengthScale ?? 0.55;
  const minShootLength = options.minShootLength ?? 0.04;
  const maxShootLength = options.maxShootLength ?? 2;
  const radiusScale = options.radiusScale ?? 0.68;
  const maxActivations = options.maxActivations ?? 128;
  if (!Number.isFinite(shootLengthScale) || shootLengthScale <= 0 || shootLengthScale > 4) throw new Error("shootLengthScale must be finite in (0, 4]");
  if (!Number.isFinite(minShootLength) || minShootLength <= 0 || minShootLength > 2) throw new Error("minShootLength must be finite in (0, 2]");
  if (!Number.isFinite(maxShootLength) || maxShootLength < minShootLength || maxShootLength > 20) throw new Error("maxShootLength must be finite, at least minShootLength, and at most 20");
  if (!Number.isFinite(radiusScale) || radiusScale <= 0 || radiusScale > 1) throw new Error("radiusScale must be finite in (0, 1]");
  if (!Number.isInteger(maxActivations) || maxActivations < 1 || maxActivations > 1024) throw new Error("maxActivations must be an integer in [1, 1024]");
  return { shootLengthScale, minShootLength, maxShootLength, radiusScale, maxActivations };
};

const stableIdHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const activatedShootId = (sourceStep: number, budId: string) => `growth:${sourceStep}:${stableIdHash(budId)}`;

/** Apply confirmed self-prune cuts and materialize confirmed terminal dormant buds. */
export const applyProcPlantGrowthTopologyPlan = (
  source: ProcPlantGraph,
  planValue: ProcPlantGrowthTopologyPlan,
  optionsValue: ProcPlantGrowthTopologyApplyOptions = {},
): ProcPlantGrowthTopologyResult => {
  const plan = normalizePlan(planValue);
  const options = normalizedApplyOptions(optionsValue);
  const actualGraphSignature = createProcPlantGrowthSimulationGraphSignature(source);
  if (plan.target.graphSignature !== actualGraphSignature) {
    return unchangedResult(source, plan, actualGraphSignature, "target-mismatch", [],
      "Plan target does not match this graph topology; no mutation was attempted.");
  }
  if (plan.recommendations.length === 0) {
    return unchangedResult(source, plan, actualGraphSignature, "no-op", [],
      "The simulation step contained no confirmed topology recommendations.");
  }

  const recordById = new Map(source.segmentRecords.map((record) => [record.id, record]));
  const pruneIds = new Set<string>();
  const activationRecommendations: Extract<ProcPlantGrowthTopologyRecommendation, { kind: "activate" }>[] = [];
  const entries: ProcPlantGrowthTopologyAuditEntry[] = [];
  for (const recommendation of plan.recommendations) {
    if (!recordById.has(recommendation.segmentId)) {
      entries.push({ kind: recommendation.kind, segmentId: recommendation.segmentId, status: "unmatched", reason: "Stable segment ID is absent from the target graph." });
    } else if (recommendation.kind === "activate") {
      activationRecommendations.push(recommendation);
    } else {
      pruneIds.add(recommendation.segmentId);
    }
  }

  const rootPruneIds = [...pruneIds].filter((id) => {
    let parentId = recordById.get(id)?.parentSegmentId ?? null;
    while (parentId) {
      if (pruneIds.has(parentId)) return false;
      parentId = recordById.get(parentId)?.parentSegmentId ?? null;
    }
    return true;
  }).sort(stableCompare);
  for (const id of [...pruneIds].sort(stableCompare)) {
    const covered = !rootPruneIds.includes(id);
    entries.push({
      kind: "self-prune",
      segmentId: id,
      status: covered ? "covered-by-ancestor" : "applied",
      reason: covered
        ? "A confirmed ancestor cut removes this descendant through stable pruning semantics."
        : "Confirmed cut applied through pruneProcPlantGraph remove semantics.",
    });
  }
  entries.sort((left, right) => stableCompare(left.segmentId, right.segmentId) || stableCompare(left.kind, right.kind));
  const canonicalSource: ProcPlantGraph = {
    ...source,
    segmentRecords: [...source.segmentRecords].sort((left, right) => stableCompare(left.id, right.id)),
    attachments: [...source.attachments].sort((left, right) => stableCompare(left.id, right.id)),
  };
  const pruned = rootPruneIds.length > 0
    ? pruneProcPlantGraph(canonicalSource, {
        operation: "remove",
        selection: { kind: "segmentIds", segmentIds: rootPruneIds },
      })
    : null;
  let graph = pruned?.graph ?? canonicalSource;
  const retainedSegmentIds = new Set(graph.segmentRecords.map((record) => record.id));
  const retainedAttachmentIds = new Set(graph.attachments.map((attachment) => attachment.id));
  const removedSegmentIds = canonicalSource.segmentRecords.filter((record) => !retainedSegmentIds.has(record.id)).map((record) => record.id).sort(stableCompare);
  const removedAttachmentIds = canonicalSource.attachments.filter((attachment) => !retainedAttachmentIds.has(attachment.id)).map((attachment) => attachment.id).sort(stableCompare);
  const activatedBudIds: string[] = [];
  const addedSegmentIds: string[] = [];
  const addedAttachmentIds: string[] = [];
  for (const recommendation of activationRecommendations) {
    if (!retainedSegmentIds.has(recommendation.segmentId)) {
      entries.push({ kind: "activate", segmentId: recommendation.segmentId, status: "covered-by-ancestor", reason: "A confirmed prune removed the segment that owned this dormant terminal bud." });
      continue;
    }
    if (addedSegmentIds.length >= options.maxActivations) {
      entries.push({ kind: "activate", segmentId: recommendation.segmentId, status: "unsupported", reason: `Activation cap ${options.maxActivations} was reached.` });
      continue;
    }
    const buds = graph.attachments
      .filter((attachment) => attachment.kind === "branch-tip" && attachment.parentSegmentId === recommendation.segmentId)
      .sort((left, right) => stableCompare(left.id, right.id));
    const bud = buds[0];
    if (!bud) {
      entries.push({ kind: "activate", segmentId: recommendation.segmentId, status: "unsupported", reason: "The segment has no stable terminal branch-tip attachment to materialize as a shoot." });
      continue;
    }
    const parentRecord = graph.segmentRecords.find((record) => record.id === recommendation.segmentId)!;
    const startNode = graph.stems[parentRecord.endNodeIndex];
    if (!startNode) {
      entries.push({ kind: "activate", segmentId: recommendation.segmentId, status: "unsupported", reason: "The terminal bud parent has no valid end node." });
      continue;
    }
    const tangent = bud.tangent.clone();
    if (tangent.lengthSq() <= 1e-12) {
      entries.push({ kind: "activate", segmentId: recommendation.segmentId, status: "unsupported", reason: "The terminal bud tangent is degenerate." });
      continue;
    }
    tangent.normalize();
    const parentStart = graph.stems[parentRecord.startNodeIndex]?.position;
    const parentLength = parentStart ? parentStart.distanceTo(startNode.position) : 0;
    const length = Math.max(options.minShootLength, Math.min(options.maxShootLength, parentLength * options.shootLengthScale));
    const segmentId = activatedShootId(plan.target.sourceStep, bud.id);
    const attachmentId = `${segmentId}:tip`;
    if (retainedSegmentIds.has(segmentId) || graph.attachments.some((attachment) => attachment.id === attachmentId)) {
      entries.push({ kind: "activate", segmentId: recommendation.segmentId, status: "unsupported", reason: "The deterministic activated-shoot identity already exists." });
      continue;
    }
    const endNodeIndex = graph.stems.length;
    const endPosition = startNode.position.clone().addScaledVector(tangent, length);
    graph = {
      ...graph,
      stems: [...graph.stems, {
        position: endPosition,
        direction: tangent.clone(),
        radius: Math.max(0.001, startNode.radius * options.radiusScale),
        depth: parentRecord.depth + 1,
        t: 1,
        index: endNodeIndex,
      }],
      segments: [...graph.segments, [parentRecord.endNodeIndex, endNodeIndex]],
      segmentRecords: [...graph.segmentRecords, {
        id: segmentId,
        parentSegmentId: recommendation.segmentId,
        startNodeIndex: parentRecord.endNodeIndex,
        endNodeIndex,
        depth: parentRecord.depth + 1,
        axialStart: parentRecord.axialEnd,
        axialEnd: parentRecord.axialEnd + length,
      }].sort((left, right) => stableCompare(left.id, right.id)),
      attachments: [
        ...graph.attachments.filter((attachment) => attachment.id !== bud.id),
        {
          ...bud,
          id: attachmentId,
          parentSegmentId: segmentId,
          axialT: 1,
          position: endPosition.clone(),
          tangent: tangent.clone(),
          right: bud.right.clone(),
          up: bud.up.clone(),
          depth: parentRecord.depth + 1,
          organIndex: null,
        },
      ].sort((left, right) => stableCompare(left.id, right.id)),
    };
    retainedSegmentIds.add(segmentId);
    retainedAttachmentIds.delete(bud.id);
    retainedAttachmentIds.add(attachmentId);
    activatedBudIds.push(bud.id);
    addedSegmentIds.push(segmentId);
    addedAttachmentIds.push(attachmentId);
    entries.push({ kind: "activate", segmentId: recommendation.segmentId, status: "applied", reason: `Terminal dormant bud ${bud.id} materialized as ${segmentId}.` });
  }
  if (rootPruneIds.length === 0 && addedSegmentIds.length === 0) {
    const unsupported = entries.some((entry) => entry.status === "unsupported");
    const unmatched = entries.some((entry) => entry.status === "unmatched");
    return unchangedResult(source, plan, actualGraphSignature,
      unsupported ? "unsupported" : unmatched ? "unmatched" : "no-op", entries.sort((left, right) => stableCompare(left.segmentId, right.segmentId) || stableCompare(left.kind, right.kind)),
      "No supported confirmed topology change matched the target graph.");
  }
  const hasNonApplied = entries.some((entry) => entry.status === "unsupported" || entry.status === "unmatched");
  entries.sort((left, right) => stableCompare(left.segmentId, right.segmentId) || stableCompare(left.kind, right.kind));
  return {
    contract: PROCPLANT_GROWTH_TOPOLOGY_CONTRACT,
    version: PROCPLANT_GROWTH_TOPOLOGY_VERSION,
    graph,
    audit: {
      status: hasNonApplied ? "partial" : "applied",
      targetGraphSignature: plan.target.graphSignature,
      actualGraphSignature,
      requestedSelfPruneIds: [...pruneIds].sort(stableCompare),
      appliedSelfPruneRootIds: rootPruneIds,
      removedSegmentIds,
      removedAttachmentIds,
      removedOrganCount: source.organs.length - graph.organs.length,
      requestedActivationSegmentIds: activationRecommendations.map((entry) => entry.segmentId).sort(stableCompare),
      activatedBudIds: activatedBudIds.sort(stableCompare),
      addedSegmentIds: addedSegmentIds.sort(stableCompare),
      addedAttachmentIds: addedAttachmentIds.sort(stableCompare),
      entries,
      pruning: pruned?.audit ?? null,
      note: "Confirmed cuts use stable pruning; confirmed terminal branch-tip buds materialize bounded deterministic shoots. Values remain procedural decisions, not calibrated biology.",
    },
  };
};
