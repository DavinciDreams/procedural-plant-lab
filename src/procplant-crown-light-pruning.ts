import {
  createProcPlantCrownLightSampler,
  evaluateProcPlantCrownLight,
  type ProcPlantCrownLightDiagnostics,
  type ProcPlantCrownLightOptions,
} from "./procplant-crown-light";
import type { ProcPlantGraphResourceGrowthOptions } from "./procplant-graph-resource-growth";
import {
  createProcPlantGrowthSimulationState,
  stepProcPlantGrowthSimulation,
} from "./procplant-growth-simulation";
import {
  applyProcPlantGrowthTopologyPlan,
  createProcPlantGrowthTopologyPlan,
  type ProcPlantGrowthTopologyPlan,
} from "./procplant-growth-topology";
import {
  buildProcPlantTemplate,
  buildProcPlantTemplateFromGraph,
  defaultPlantEnvironment,
  type ProcPlantBuildResult,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantGraph,
  type ProcPlantWeberPennBuildOptions,
} from "./procplants";

export const PROCPLANT_CROWN_LIGHT_PRUNING_CONTRACT = "procplants.crown-light-pruning" as const;
export const PROCPLANT_CROWN_LIGHT_PRUNING_VERSION = 1 as const;

export type ProcPlantCrownLightPruningBackend =
  | "procplant-graph"
  | "weber-penn"
  | "branch-module-graph"
  | "space-colonization";

export interface ProcPlantCrownLightPruningOptions {
  /** Explicit opt-in. Omitted or false preserves the source graph exactly. */
  enabled?: boolean;
  /** Consecutive identical evidence steps required before a cut. */
  confirmationSteps?: number;
  /** Maximum independent ancestor cuts applied in one generation. */
  maxCuts?: number;
  /** Hard aggregate cap over light samples, candidate tests, and simulated segment steps. */
  maxWorkUnits?: number;
  resourceInputPerStep?: number;
  crownLight?: ProcPlantCrownLightOptions;
  resourceGrowth?: ProcPlantGraphResourceGrowthOptions;
}

export type ProcPlantCrownLightPruningStatus =
  | "disabled"
  | "applied"
  | "no-op"
  | "budget-exceeded"
  | "unsupported-graph"
  | "unsupported-backend";

export interface ProcPlantCrownLightPruningCounts {
  stems: number;
  segments: number;
  organs: number;
  attachments: number;
}

export interface ProcPlantCrownLightPruningAudit {
  contract: typeof PROCPLANT_CROWN_LIGHT_PRUNING_CONTRACT;
  version: typeof PROCPLANT_CROWN_LIGHT_PRUNING_VERSION;
  status: ProcPlantCrownLightPruningStatus;
  backend: ProcPlantCrownLightPruningBackend;
  targetGraphSignature: string | null;
  actualGraphSignature: string | null;
  confirmationSteps: number;
  maxCuts: number;
  maxWorkUnits: number;
  workUnits: number;
  candidateRootIds: string[];
  appliedRootIds: string[];
  deferredRootIds: string[];
  removedSegmentIds: string[];
  removedAttachmentIds: string[];
  before: ProcPlantCrownLightPruningCounts;
  after: ProcPlantCrownLightPruningCounts;
  lightDiagnostics: ProcPlantCrownLightDiagnostics | null;
  note: string;
}

export interface ProcPlantCrownLightPruningResult {
  graph: ProcPlantGraph;
  audit: ProcPlantCrownLightPruningAudit;
}

export interface ProcPlantCrownLightPruningBuildOptions extends ProcPlantWeberPennBuildOptions {
  crownLightPruning: ProcPlantCrownLightPruningOptions;
}

export interface ProcPlantCrownLightPruningBuildAudit extends ProcPlantCrownLightPruningAudit {
  templateTrianglesBefore: number;
  templateTrianglesAfter: number;
}

export interface ProcPlantCrownLightPruningBuildResult extends ProcPlantBuildResult {
  crownLightPruning: ProcPlantCrownLightPruningBuildAudit;
}

const HARD_MAX_CONFIRMATION_STEPS = 8;
const HARD_MAX_CUTS = 32;
const HARD_MAX_WORK_UNITS = 2_500_000;
const HARD_MAX_SEGMENTS = 4096;
const HARD_MAX_SAMPLES = 32;
const HARD_MAX_CANDIDATE_TESTS = 2_000_000;
const HARD_MAX_OCCLUDERS = 10_000;
const HARD_MAX_HASH_CELLS = 250_000;
const HARD_MAX_RAY_CELLS = 4096;
const stableCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const hashText = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const vectorKey = (value: { x: number; y: number; z: number }) => [value.x, value.y, value.z]
  .map((entry) => Number.isFinite(entry) ? entry.toPrecision(17) : String(entry)).join(",");

/** Bind visibility evidence to exact stable topology, geometry, and attached crown parts. */
export const createProcPlantCrownLightPruningGraphSignature = (graph: ProcPlantGraph) => {
  const records = [...graph.segmentRecords].sort((left, right) => stableCompare(left.id, right.id));
  const attachments = [...graph.attachments].sort((left, right) => stableCompare(left.id, right.id));
  const source = [
    ...records.map((record) => {
      const start = graph.stems[record.startNodeIndex];
      const end = graph.stems[record.endNodeIndex];
      return [
        "s", record.id, record.parentSegmentId ?? "root", record.depth,
        start ? vectorKey(start.position) : "missing", start?.radius ?? "missing",
        end ? vectorKey(end.position) : "missing", end?.radius ?? "missing",
      ].join("|");
    }),
    ...attachments.map((attachment) => {
      const organ = attachment.organIndex === null ? null : graph.organs[attachment.organIndex];
      return [
        "a", attachment.id, attachment.kind, attachment.parentSegmentId ?? "root",
        attachment.organIndex ?? "none", vectorKey(attachment.position), vectorKey(attachment.tangent),
        vectorKey(attachment.right), vectorKey(attachment.up),
        organ?.kind ?? "none", organ ? vectorKey(organ.position) : "none",
        organ ? vectorKey(organ.direction) : "none", organ ? vectorKey(organ.right) : "none", organ?.scale ?? "none",
      ].join("|");
    }),
    ...graph.organs.map((organ, index) => [
      "o", index, organ.kind, vectorKey(organ.position), vectorKey(organ.direction),
      vectorKey(organ.right), organ.scale, organ.t,
    ].join("|")),
  ].join("\n");
  return `clp1:${hashText(source)}:${records.length}:${attachments.length}`;
};

const counts = (graph: ProcPlantGraph): ProcPlantCrownLightPruningCounts => ({
  stems: graph.stems.length,
  segments: graph.segmentRecords.length,
  organs: graph.organs.length,
  attachments: graph.attachments.length,
});

const boundedInteger = (value: number, label: string, min: number, max: number) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
};

const boundedFinite = (value: number, label: string, min: number, max: number) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite and in [${min}, ${max}]`);
  }
  return value;
};

const normalize = (options: ProcPlantCrownLightPruningOptions) => {
  const confirmationSteps = boundedInteger(options.confirmationSteps ?? 3, "confirmationSteps", 1, HARD_MAX_CONFIRMATION_STEPS);
  const maxCuts = boundedInteger(options.maxCuts ?? 8, "maxCuts", 1, HARD_MAX_CUTS);
  const maxWorkUnits = boundedInteger(options.maxWorkUnits ?? 500_000, "maxWorkUnits", 1, HARD_MAX_WORK_UNITS);
  const resourceInputPerStep = boundedFinite(options.resourceInputPerStep ?? 0, "resourceInputPerStep", 0, 1_000_000);
  const crownLight = { ...options.crownLight };
  crownLight.hemisphereSampleCount = boundedInteger(crownLight.hemisphereSampleCount ?? 12, "hemisphereSampleCount", 1, HARD_MAX_SAMPLES);
  crownLight.maxSamplesPerTarget = boundedInteger(crownLight.maxSamplesPerTarget ?? HARD_MAX_SAMPLES, "maxSamplesPerTarget", 1, HARD_MAX_SAMPLES);
  crownLight.maxSegmentTargets = boundedInteger(crownLight.maxSegmentTargets ?? HARD_MAX_SEGMENTS, "maxSegmentTargets", 1, HARD_MAX_SEGMENTS);
  crownLight.maxAttachmentTargets = boundedInteger(crownLight.maxAttachmentTargets ?? HARD_MAX_SEGMENTS, "maxAttachmentTargets", 1, HARD_MAX_SEGMENTS);
  crownLight.candidateTestBudget = boundedInteger(crownLight.candidateTestBudget ?? 250_000, "candidateTestBudget", 1, HARD_MAX_CANDIDATE_TESTS);
  crownLight.maxOccluders = boundedInteger(crownLight.maxOccluders ?? HARD_MAX_OCCLUDERS, "maxOccluders", 1, HARD_MAX_OCCLUDERS);
  crownLight.maxHashCells = boundedInteger(crownLight.maxHashCells ?? HARD_MAX_HASH_CELLS, "maxHashCells", 1, HARD_MAX_HASH_CELLS);
  crownLight.maxRayCellsPerSample = boundedInteger(crownLight.maxRayCellsPerSample ?? HARD_MAX_RAY_CELLS, "maxRayCellsPerSample", 1, HARD_MAX_RAY_CELLS);
  return { confirmationSteps, maxCuts, maxWorkUnits, resourceInputPerStep, crownLight, resourceGrowth: options.resourceGrowth };
};

const emptyAudit = (
  graph: ProcPlantGraph,
  status: ProcPlantCrownLightPruningStatus,
  note: string,
  values: { confirmationSteps: number; maxCuts: number; maxWorkUnits: number },
  backend: ProcPlantCrownLightPruningBackend = "procplant-graph",
): ProcPlantCrownLightPruningAudit => ({
  contract: PROCPLANT_CROWN_LIGHT_PRUNING_CONTRACT,
  version: PROCPLANT_CROWN_LIGHT_PRUNING_VERSION,
  status,
  backend,
  targetGraphSignature: backend === "procplant-graph" && graph.segmentRecords.length > 0
    ? createProcPlantCrownLightPruningGraphSignature(graph)
    : null,
  actualGraphSignature: backend === "procplant-graph" && graph.segmentRecords.length > 0
    ? createProcPlantCrownLightPruningGraphSignature(graph)
    : null,
  confirmationSteps: values.confirmationSteps,
  maxCuts: values.maxCuts,
  maxWorkUnits: values.maxWorkUnits,
  workUnits: 0,
  candidateRootIds: [],
  appliedRootIds: [],
  deferredRootIds: [],
  removedSegmentIds: [],
  removedAttachmentIds: [],
  before: counts(graph),
  after: counts(graph),
  lightDiagnostics: null,
  note,
});

export const createUnsupportedProcPlantCrownLightPruningAudit = (
  graph: ProcPlantGraph,
  backend: Exclude<ProcPlantCrownLightPruningBackend, "procplant-graph">,
  options: ProcPlantCrownLightPruningOptions,
): ProcPlantCrownLightPruningAudit => {
  const values = normalize(options);
  return emptyAudit(
    graph,
    options.enabled === true ? "unsupported-backend" : "disabled",
    options.enabled === true
      ? `Crown-light pruning is fail-closed for ${backend}; only the native procplant graph backend is supported.`
      : "Crown-light pruning was not enabled; canonical generation was preserved.",
    values,
    backend,
  );
};

const rootCandidates = (graph: ProcPlantGraph, plan: ProcPlantGrowthTopologyPlan) => {
  const recordById = new Map(graph.segmentRecords.map((record) => [record.id, record]));
  const candidates = new Set(plan.recommendations
    .filter((entry) => entry.kind === "self-prune")
    .map((entry) => entry.segmentId));
  return [...candidates].filter((id) => {
    let parentId = recordById.get(id)?.parentSegmentId ?? null;
    while (parentId) {
      if (candidates.has(parentId)) return false;
      parentId = recordById.get(parentId)?.parentSegmentId ?? null;
    }
    return true;
  }).sort(stableCompare);
};

const budgetMessage = (error: unknown) => error instanceof Error && /(cap exceeded|budget exceeded|target cap)/i.test(error.message)
  ? error.message
  : null;

/**
 * Run one bounded, deterministic visibility evaluation, confirm its resource-growth
 * recommendation over repeated identical evidence steps, then apply only capped
 * ancestor cuts through the existing topology-repair implementation.
 */
export const applyProcPlantCrownLightPruning = (
  source: ProcPlantGraph,
  options: ProcPlantCrownLightPruningOptions = {},
): ProcPlantCrownLightPruningResult => {
  const values = normalize(options);
  if (options.enabled !== true) {
    return { graph: source, audit: emptyAudit(source, "disabled", "Crown-light pruning was not enabled; source identity was preserved.", values) };
  }
  if (source.segmentRecords.length === 0 || source.segmentRecords.length > HARD_MAX_SEGMENTS) {
    return {
      graph: source,
      audit: emptyAudit(source, "budget-exceeded", `Native graph segment count must be in [1, ${HARD_MAX_SEGMENTS}].`, values),
    };
  }

  let light;
  try {
    light = evaluateProcPlantCrownLight(source, values.crownLight);
  } catch (error) {
    const reason = budgetMessage(error);
    if (!reason) throw error;
    return { graph: source, audit: emptyAudit(source, "budget-exceeded", `${reason}; source identity was preserved.`, values) };
  }
  const workUnits = light.diagnostics.samplesCast
    + light.diagnostics.candidateTests
    + source.segmentRecords.length * values.confirmationSteps;
  if (workUnits > values.maxWorkUnits) {
    const audit = emptyAudit(source, "budget-exceeded", `Aggregate work ${workUnits} exceeded cap ${values.maxWorkUnits}; source identity was preserved.`, values);
    audit.workUnits = workUnits;
    audit.lightDiagnostics = light.diagnostics;
    return { graph: source, audit };
  }

  const sampleLight = createProcPlantCrownLightSampler(light);
  let state;
  let lastStep = null as ReturnType<typeof stepProcPlantGrowthSimulation> | null;
  try {
    state = createProcPlantGrowthSimulationState(source);
    for (let step = 0; step < values.confirmationSteps; step++) {
      lastStep = stepProcPlantGrowthSimulation(source, state, sampleLight, {
        adapter: values.resourceGrowth,
        resourceInput: values.resourceInputPerStep,
        activationConfirmationSteps: values.confirmationSteps,
        selfPruneConfirmationSteps: values.confirmationSteps,
      });
      state = lastStep.state;
    }
  } catch (error) {
    const audit = emptyAudit(source, "unsupported-graph", `The native graph is not compatible with bounded resource-growth evaluation (${error instanceof Error ? error.message : String(error)}); source identity was preserved.`, values);
    audit.workUnits = light.diagnostics.samplesCast + light.diagnostics.candidateTests;
    audit.lightDiagnostics = light.diagnostics;
    return { graph: source, audit };
  }
  const completePlan = createProcPlantGrowthTopologyPlan(source, lastStep!);
  const candidates = rootCandidates(source, completePlan);
  const selected = candidates.slice(0, values.maxCuts);
  const selectedSet = new Set(selected);
  const deferred = candidates.slice(values.maxCuts);
  const limitedPlan: ProcPlantGrowthTopologyPlan = {
    ...completePlan,
    recommendations: completePlan.recommendations.filter((entry) => entry.kind === "self-prune" && selectedSet.has(entry.segmentId)),
  };
  const applied = applyProcPlantGrowthTopologyPlan(source, limitedPlan);
  const status: ProcPlantCrownLightPruningStatus = applied.audit.appliedSelfPruneRootIds.length > 0 ? "applied" : "no-op";
  const before = counts(source);
  const after = counts(applied.graph);
  return {
    graph: applied.graph,
    audit: {
      contract: PROCPLANT_CROWN_LIGHT_PRUNING_CONTRACT,
      version: PROCPLANT_CROWN_LIGHT_PRUNING_VERSION,
      status,
      backend: "procplant-graph",
      targetGraphSignature: createProcPlantCrownLightPruningGraphSignature(source),
      actualGraphSignature: createProcPlantCrownLightPruningGraphSignature(source),
      confirmationSteps: values.confirmationSteps,
      maxCuts: values.maxCuts,
      maxWorkUnits: values.maxWorkUnits,
      workUnits,
      candidateRootIds: candidates,
      appliedRootIds: applied.audit.appliedSelfPruneRootIds,
      deferredRootIds: deferred,
      removedSegmentIds: applied.audit.removedSegmentIds,
      removedAttachmentIds: applied.audit.removedAttachmentIds,
      before,
      after,
      lightDiagnostics: light.diagnostics,
      note: status === "applied"
        ? "Cuts are deterministic geometric/resource heuristics applied through stable descendant, attachment, and organ repair. They are not species physiology or spectral radiative transfer."
        : "No confirmed capped self-prune root matched this graph; source identity was preserved.",
    },
  };
};

/**
 * Explicit full-entry generation path. Keeping this composition outside the base
 * compiler means core/Tellus and default browser startup do not load the opt-in
 * visibility and resource-growth machinery.
 */
export const buildProcPlantTemplateWithCrownLightPruning = (
  genome: ProcPlantGenome,
  seed = 1,
  environment: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: ProcPlantCrownLightPruningBuildOptions = { crownLightPruning: {} },
): ProcPlantCrownLightPruningBuildResult => {
  const before = buildProcPlantTemplate(genome, seed, environment, { trimOverrides: options.trimOverrides });
  let pruning: ProcPlantCrownLightPruningResult;
  if (genome.spaceColonization) {
    pruning = { graph: before.graph, audit: createUnsupportedProcPlantCrownLightPruningAudit(before.graph, "space-colonization", options.crownLightPruning) };
  } else if (genome.branchModules) {
    pruning = { graph: before.graph, audit: createUnsupportedProcPlantCrownLightPruningAudit(before.graph, "branch-module-graph", options.crownLightPruning) };
  } else if (genome.weberPenn) {
    pruning = { graph: before.graph, audit: createUnsupportedProcPlantCrownLightPruningAudit(before.graph, "weber-penn", options.crownLightPruning) };
  } else {
    pruning = applyProcPlantCrownLightPruning(before.graph, options.crownLightPruning);
  }
  const after = pruning.graph === before.graph
    ? before
    : buildProcPlantTemplateFromGraph(genome, pruning.graph, environment);
  return {
    ...after,
    crownLightPruning: {
      ...pruning.audit,
      templateTrianglesBefore: before.stats.triangles,
      templateTrianglesAfter: after.stats.triangles,
    },
  };
};
