import type { ProcPlantGraph } from "./procplants";
import {
  evaluateProcPlantGraphResourceGrowth,
  type ProcPlantGraphLightSampleContext,
  type ProcPlantGraphResourceGrowthOptions,
  type ProcPlantSegmentGrowthRecommendation,
} from "./procplant-graph-resource-growth";
import type { ProcPlantLightSample } from "./procplant-resource-growth";

export const PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION = 1 as const;

export const PROCPLANT_GROWTH_SIMULATION_LIMITATIONS = [
  "Resource, vigor, and growth values are normalized procedural heuristics, not calibrated plant physiology.",
  "Light and occlusion are supplied by the caller; the simulator does not raycast or model radiative transfer.",
  "Confirmed self-prune actions are recommendations only and do not remove graph segments.",
] as const;

export interface ProcPlantGrowthSimulationSegmentState {
  segmentId: string;
  active: boolean;
  accumulatedGrowth: number;
  activationEvidenceSteps: number;
  selfPruneEvidenceSteps: number;
  selfPruneConfirmed: boolean;
}

export interface ProcPlantGrowthSimulationState {
  version: typeof PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION;
  graphSignature: string;
  completedSteps: number;
  reserveResource: number;
  segments: ProcPlantGrowthSimulationSegmentState[];
}

export interface ProcPlantGrowthSimulationInitialOptions {
  initialReserveResource?: number;
  initiallyDormantSegmentIds?: readonly string[];
}

export interface ProcPlantGrowthSimulationLightContext extends ProcPlantGraphLightSampleContext {
  step: number;
  active: boolean;
  accumulatedGrowth: number;
  activationEvidenceSteps: number;
  selfPruneEvidenceSteps: number;
  selfPruneConfirmed: boolean;
}

export type ProcPlantGrowthSimulationLightSampler = (
  context: Readonly<ProcPlantGrowthSimulationLightContext>,
) => readonly ProcPlantLightSample[];

export interface ProcPlantGrowthSimulationStepOptions {
  adapter?: ProcPlantGraphResourceGrowthOptions;
  resourceInput?: number;
  activationConfirmationSteps?: number;
  selfPruneConfirmationSteps?: number;
  evidenceRecoveryPerStep?: number;
}

export type ProcPlantGrowthSimulationAction =
  | "activate"
  | "grow"
  | "hold"
  | "self-prune-candidate"
  | "self-prune-confirmed";

export interface ProcPlantGrowthSimulationSegmentResult {
  segmentId: string;
  activeBefore: boolean;
  activeAfter: boolean;
  action: ProcPlantGrowthSimulationAction;
  sourceRecommendation: ProcPlantSegmentGrowthRecommendation;
  lightExposure: number;
  vigor: number;
  growthScale: number;
  growthResource: number;
  accumulatedGrowth: number;
  activationEvidenceSteps: number;
  selfPruneEvidenceSteps: number;
  selfPruneConfirmed: boolean;
}

export interface ProcPlantGrowthSimulationStepResult {
  version: typeof PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION;
  step: number;
  previousReserveResource: number;
  resourceInput: number;
  grossResource: number;
  maintenanceResource: number;
  growthResource: number;
  reserveResource: number;
  segments: ProcPlantGrowthSimulationSegmentResult[];
  state: ProcPlantGrowthSimulationState;
  limitations: readonly string[];
}

const EPSILON = 1e-12;
const stableCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

const assertFiniteInRange = (value: number, label: string, min: number, max = Number.POSITIVE_INFINITY) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite and in [${min}, ${max}]`);
  }
};

export const createProcPlantGrowthSimulationGraphSignature = (graph: ProcPlantGraph) => {
  const records = [...graph.segmentRecords].sort((a, b) => stableCompare(a.id, b.id));
  const seen = new Set<string>();
  let source = "procplant-growth-simulation:v1";
  for (const record of records) {
    if (seen.has(record.id)) throw new Error(`duplicate segment id: ${record.id}`);
    seen.add(record.id);
    source += `|${record.id}>${record.parentSegmentId ?? "root"}`;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `pgs1:${(hash >>> 0).toString(16).padStart(8, "0")}:${records.length}`;
};

const canonicalState = (state: ProcPlantGrowthSimulationState): ProcPlantGrowthSimulationState => {
  if (state.version !== PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION) {
    throw new Error(`unsupported growth simulation state version: ${String(state.version)}`);
  }
  if (typeof state.graphSignature !== "string" || state.graphSignature.length === 0) throw new Error("graphSignature must be non-empty");
  if (!Number.isInteger(state.completedSteps) || state.completedSteps < 0) throw new Error("completedSteps must be a non-negative integer");
  assertFiniteInRange(state.reserveResource, "reserveResource", 0);
  if (!Array.isArray(state.segments)) throw new Error("growth simulation state segments must be an array");
  const seen = new Set<string>();
  const segments = [...state.segments]
    .sort((a, b) => stableCompare(a.segmentId, b.segmentId))
    .map((segment): ProcPlantGrowthSimulationSegmentState => {
      if (typeof segment.segmentId !== "string" || segment.segmentId.length === 0) throw new Error("state segmentId must be non-empty");
      if (seen.has(segment.segmentId)) throw new Error(`duplicate state segment id: ${segment.segmentId}`);
      seen.add(segment.segmentId);
      if (typeof segment.active !== "boolean") throw new Error(`${segment.segmentId}.active must be boolean`);
      if (typeof segment.selfPruneConfirmed !== "boolean") throw new Error(`${segment.segmentId}.selfPruneConfirmed must be boolean`);
      assertFiniteInRange(segment.accumulatedGrowth, `${segment.segmentId}.accumulatedGrowth`, 0);
      if (!Number.isInteger(segment.activationEvidenceSteps) || segment.activationEvidenceSteps < 0) {
        throw new Error(`${segment.segmentId}.activationEvidenceSteps must be a non-negative integer`);
      }
      if (!Number.isInteger(segment.selfPruneEvidenceSteps) || segment.selfPruneEvidenceSteps < 0) {
        throw new Error(`${segment.segmentId}.selfPruneEvidenceSteps must be a non-negative integer`);
      }
      return {
        segmentId: segment.segmentId,
        active: segment.active,
        accumulatedGrowth: segment.accumulatedGrowth,
        activationEvidenceSteps: segment.activationEvidenceSteps,
        selfPruneEvidenceSteps: segment.selfPruneEvidenceSteps,
        selfPruneConfirmed: segment.selfPruneConfirmed,
      };
    });
  return {
    version: PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION,
    graphSignature: state.graphSignature,
    completedSteps: state.completedSteps,
    reserveResource: state.reserveResource,
    segments,
  };
};

export const createProcPlantGrowthSimulationState = (
  graph: ProcPlantGraph,
  options: ProcPlantGrowthSimulationInitialOptions = {},
): ProcPlantGrowthSimulationState => {
  const reserveResource = options.initialReserveResource ?? 0;
  assertFiniteInRange(reserveResource, "initialReserveResource", 0);
  const dormant = new Set(options.initiallyDormantSegmentIds ?? []);
  const segmentIds = graph.segmentRecords.map((record) => record.id).sort(stableCompare);
  if (segmentIds.length === 0) throw new Error("growth simulation requires at least one graph segment");
  const known = new Set(segmentIds);
  for (const id of dormant) if (!known.has(id)) throw new Error(`initiallyDormantSegmentIds references missing segment: ${id}`);
  return canonicalState({
    version: PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION,
    graphSignature: createProcPlantGrowthSimulationGraphSignature(graph),
    completedSteps: 0,
    reserveResource,
    segments: segmentIds.map((segmentId) => ({
      segmentId,
      active: !dormant.has(segmentId),
      accumulatedGrowth: 0,
      activationEvidenceSteps: 0,
      selfPruneEvidenceSteps: 0,
      selfPruneConfirmed: false,
    })),
  });
};

export const serializeProcPlantGrowthSimulationState = (state: ProcPlantGrowthSimulationState) => JSON.stringify(canonicalState(state));

export const deserializeProcPlantGrowthSimulationState = (serialized: string): ProcPlantGrowthSimulationState => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("growth simulation state must be valid JSON");
  }
  if (!value || typeof value !== "object") throw new Error("growth simulation state must be an object");
  return canonicalState(value as ProcPlantGrowthSimulationState);
};

/** Canonically serialize a step audit with stable segment ordering and normalized state. */
export const serializeProcPlantGrowthSimulationStepResult = (result: ProcPlantGrowthSimulationStepResult) => {
  if (result.version !== PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION) {
    throw new Error(`unsupported growth simulation result version: ${String(result.version)}`);
  }
  return JSON.stringify({
    ...result,
    segments: [...result.segments].sort((a, b) => stableCompare(a.segmentId, b.segmentId)),
    state: canonicalState(result.state),
    limitations: [...result.limitations],
  });
};

/** Advance a graph-bound simulation state without mutating the graph or prior state. */
export const stepProcPlantGrowthSimulation = (
  graph: ProcPlantGraph,
  sourceState: ProcPlantGrowthSimulationState,
  sampleLight: ProcPlantGrowthSimulationLightSampler,
  options: ProcPlantGrowthSimulationStepOptions = {},
): ProcPlantGrowthSimulationStepResult => {
  const state = canonicalState(sourceState);
  const signature = createProcPlantGrowthSimulationGraphSignature(graph);
  if (state.graphSignature !== signature) throw new Error("growth simulation state does not match the supplied graph topology");
  const graphIds = [...graph.segmentRecords].map((record) => record.id).sort(stableCompare);
  if (graphIds.length !== state.segments.length || graphIds.some((id, index) => id !== state.segments[index]!.segmentId)) {
    throw new Error("growth simulation state segment IDs do not match the supplied graph");
  }
  const resourceInput = options.resourceInput ?? options.adapter?.resourceGrowth?.initialResource ?? 0;
  const activationConfirmationSteps = options.activationConfirmationSteps ?? 1;
  const selfPruneConfirmationSteps = options.selfPruneConfirmationSteps ?? 3;
  const evidenceRecoveryPerStep = options.evidenceRecoveryPerStep ?? 1;
  assertFiniteInRange(resourceInput, "resourceInput", 0);
  if (!Number.isInteger(activationConfirmationSteps) || activationConfirmationSteps < 1) {
    throw new Error("activationConfirmationSteps must be an integer of at least 1");
  }
  if (!Number.isInteger(selfPruneConfirmationSteps) || selfPruneConfirmationSteps < 1) {
    throw new Error("selfPruneConfirmationSteps must be an integer of at least 1");
  }
  if (!Number.isInteger(evidenceRecoveryPerStep) || evidenceRecoveryPerStep < 1) {
    throw new Error("evidenceRecoveryPerStep must be an integer of at least 1");
  }

  const stateById = new Map(state.segments.map((segment) => [segment.segmentId, segment]));
  const activeSegmentIds = state.segments.filter((segment) => segment.active).map((segment) => segment.segmentId);
  const adapter = options.adapter ?? {};
  const adapterResult = evaluateProcPlantGraphResourceGrowth(graph, (context) => {
    const segmentState = stateById.get(context.segmentId)!;
    return sampleLight({
      ...context,
      step: state.completedSteps,
      active: segmentState.active,
      accumulatedGrowth: segmentState.accumulatedGrowth,
      activationEvidenceSteps: segmentState.activationEvidenceSteps,
      selfPruneEvidenceSteps: segmentState.selfPruneEvidenceSteps,
      selfPruneConfirmed: segmentState.selfPruneConfirmed,
    });
  }, {
    ...adapter,
    activeSegmentIds,
    resourceGrowth: {
      ...adapter.resourceGrowth,
      initialResource: state.reserveResource + resourceInput,
    },
  });

  const nextSegmentStates: ProcPlantGrowthSimulationSegmentState[] = [];
  const segmentResults: ProcPlantGrowthSimulationSegmentResult[] = [];
  for (const result of adapterResult.segments) {
    const previous = stateById.get(result.segmentId)!;
    const activationEvidence = !previous.active && result.resourceDecision === "activate"
      ? previous.activationEvidenceSteps + 1
      : Math.max(0, previous.activationEvidenceSteps - evidenceRecoveryPerStep);
    const activeAfter = previous.active || activationEvidence >= activationConfirmationSteps;
    const pruneEvidence = result.recommendSelfPrune
      ? previous.selfPruneEvidenceSteps + 1
      : Math.max(0, previous.selfPruneEvidenceSteps - evidenceRecoveryPerStep);
    const selfPruneConfirmed = previous.selfPruneConfirmed || pruneEvidence >= selfPruneConfirmationSteps;

    let action: ProcPlantGrowthSimulationAction = "hold";
    if (selfPruneConfirmed) action = "self-prune-confirmed";
    else if (pruneEvidence > 0) action = "self-prune-candidate";
    else if (!previous.active && activeAfter) action = "activate";
    else if (previous.active && result.resourceDecision === "grow") action = "grow";
    const committedGrowth = action === "grow" ? result.growthScale : 0;
    const accumulatedGrowth = previous.accumulatedGrowth + committedGrowth;
    const nextState: ProcPlantGrowthSimulationSegmentState = {
      segmentId: result.segmentId,
      active: activeAfter,
      accumulatedGrowth,
      activationEvidenceSteps: activeAfter ? 0 : activationEvidence,
      selfPruneEvidenceSteps: pruneEvidence,
      selfPruneConfirmed,
    };
    nextSegmentStates.push(nextState);
    segmentResults.push({
      segmentId: result.segmentId,
      activeBefore: previous.active,
      activeAfter,
      action,
      sourceRecommendation: result.recommendation,
      lightExposure: result.lightExposure,
      vigor: result.vigor,
      growthScale: result.growthScale,
      growthResource: result.growthResource,
      accumulatedGrowth,
      activationEvidenceSteps: nextState.activationEvidenceSteps,
      selfPruneEvidenceSteps: pruneEvidence,
      selfPruneConfirmed,
    });
  }
  const nextState = canonicalState({
    version: PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION,
    graphSignature: signature,
    completedSteps: state.completedSteps + 1,
    reserveResource: adapterResult.reserveResource,
    segments: nextSegmentStates,
  });
  return {
    version: PROCPLANT_GROWTH_SIMULATION_CONTRACT_VERSION,
    step: state.completedSteps,
    previousReserveResource: state.reserveResource,
    resourceInput,
    grossResource: adapterResult.grossResource,
    maintenanceResource: adapterResult.maintenanceResource,
    growthResource: adapterResult.growthResource,
    reserveResource: adapterResult.reserveResource,
    segments: segmentResults,
    state: nextState,
    limitations: PROCPLANT_GROWTH_SIMULATION_LIMITATIONS,
  };
};
