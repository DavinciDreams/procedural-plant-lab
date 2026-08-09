import type { ProcPlantAttachmentKind, ProcPlantGraph, ProcPlantSegmentRecord } from "./procplants";
import {
  evaluateProcPlantResourceGrowth,
  type ProcPlantBudRole,
  type ProcPlantGrowthDecision,
  type ProcPlantLightSample,
  type ProcPlantResourceGrowthOptions,
  type ProcPlantResourceNode,
  type ProcPlantGrowthVector,
} from "./procplant-resource-growth";

export const PROCPLANT_GRAPH_RESOURCE_GROWTH_CONTRACT_VERSION = 1 as const;

export interface ProcPlantGraphLightSampleContext {
  segmentId: string;
  parentSegmentId: string | null;
  topologyDepth: number;
  authoredDepth: number;
  budRole: ProcPlantBudRole;
  start: ProcPlantGrowthVector;
  end: ProcPlantGrowthVector;
  direction: ProcPlantGrowthVector;
  length: number;
  meanRadius: number;
  approximateLeafArea: number;
}

export type ProcPlantGraphLightSampler = (
  context: Readonly<ProcPlantGraphLightSampleContext>,
) => readonly ProcPlantLightSample[];

export interface ProcPlantGraphResourceGrowthOptions {
  resourceGrowth?: ProcPlantResourceGrowthOptions;
  leafAreaScale?: number;
  unresolvedFoliageArea?: number;
  maintenanceCostPerVolume?: number;
  growthDemandPerVolume?: number;
  minimumGrowthDemand?: number;
  selfPruneLightThreshold?: number;
  selfPruneVigorThreshold?: number;
  minimumSelfPruneDepth?: number;
  /** Existing segments omitted from this list are treated as dormant resource sinks. */
  activeSegmentIds?: readonly string[];
}

export type ProcPlantSegmentGrowthRecommendation = "extend" | "maintain" | "conserve" | "self-prune";

export interface ProcPlantSegmentResourceRecommendation {
  segmentId: string;
  parentSegmentId: string | null;
  topologyDepth: number;
  budRole: ProcPlantBudRole;
  approximateLeafArea: number;
  structuralVolume: number;
  lightExposure: number;
  lightDirection: ProcPlantGrowthVector;
  producedResource: number;
  maintenanceResource: number;
  growthResource: number;
  vigor: number;
  growthScale: number;
  resourceDecision: ProcPlantGrowthDecision;
  recommendation: ProcPlantSegmentGrowthRecommendation;
  recommendSelfPrune: boolean;
}

export interface ProcPlantGraphResourceGrowthResult {
  version: typeof PROCPLANT_GRAPH_RESOURCE_GROWTH_CONTRACT_VERSION;
  segments: ProcPlantSegmentResourceRecommendation[];
  grossResource: number;
  maintenanceResource: number;
  growthResource: number;
  reserveResource: number;
  limitations: readonly string[];
}

export const PROCPLANT_GRAPH_RESOURCE_ADAPTER_LIMITATIONS = [
  "Leaf area is approximated from foliage attachment scale squared; it is not mesh surface area.",
  "The adapter evaluates one timestep and does not mutate topology or persist reserves between calls.",
  "Self-prune outputs are recommendations for low-light, low-vigor subtrees and should be confirmed over multiple timesteps before removal.",
] as const;

interface SegmentMetrics {
  record: ProcPlantSegmentRecord;
  start: ProcPlantGrowthVector;
  end: ProcPlantGrowthVector;
  direction: ProcPlantGrowthVector;
  length: number;
  meanRadius: number;
  structuralVolume: number;
  approximateLeafArea: number;
  topologyDepth: number;
  budRole: ProcPlantBudRole;
}

const SYNTHETIC_ROOT_ID = "procplant-graph-resource:root";
const EPSILON = 1e-12;
const stableCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

const assertFiniteInRange = (value: number, label: string, min: number, max = Number.POSITIVE_INFINITY) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite and in [${min}, ${max}]`);
  }
};

const vectorFrom = (value: { x: number; y: number; z: number }, label: string): ProcPlantGrowthVector => {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`${label} must be finite`);
  return { x: value.x, y: value.y, z: value.z };
};

const foliageKinds = new Set<ProcPlantAttachmentKind>([
  "leaf",
  "leaf-site",
  "grassBlade",
  "fernLeaflet",
  "coniferSpray",
  "palmFrond",
  "mossTuft",
]);

const validateTopology = (graph: ProcPlantGraph) => {
  if (graph.segmentRecords.length === 0) throw new Error("graph resource growth requires at least one segment record");
  const recordById = new Map<string, ProcPlantSegmentRecord>();
  for (const record of graph.segmentRecords) {
    if (typeof record.id !== "string" || record.id.trim().length === 0) throw new Error("segment id must be a non-empty string");
    if (recordById.has(record.id)) throw new Error(`duplicate segment id: ${record.id}`);
    if (!Number.isInteger(record.startNodeIndex) || !graph.stems[record.startNodeIndex]) {
      throw new Error(`${record.id}.startNodeIndex references a missing stem node`);
    }
    if (!Number.isInteger(record.endNodeIndex) || !graph.stems[record.endNodeIndex]) {
      throw new Error(`${record.id}.endNodeIndex references a missing stem node`);
    }
    assertFiniteInRange(record.depth, `${record.id}.depth`, 0);
    recordById.set(record.id, record);
  }
  for (const record of graph.segmentRecords) {
    if (record.parentSegmentId !== null && !recordById.has(record.parentSegmentId)) {
      throw new Error(`${record.id}.parentSegmentId references missing segment: ${record.parentSegmentId}`);
    }
    if (record.parentSegmentId === record.id) throw new Error(`graph segment topology contains a cycle at ${record.id}`);
  }

  const depthById = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (record: ProcPlantSegmentRecord): number => {
    const known = depthById.get(record.id);
    if (known !== undefined) return known;
    if (visiting.has(record.id)) throw new Error(`graph segment topology contains a cycle at ${record.id}`);
    visiting.add(record.id);
    const depth = record.parentSegmentId === null ? 0 : depthOf(recordById.get(record.parentSegmentId)!) + 1;
    visiting.delete(record.id);
    depthById.set(record.id, depth);
    return depth;
  };
  for (const record of graph.segmentRecords) depthOf(record);
  return { recordById, depthById };
};

const approximateLeafAreaBySegment = (
  graph: ProcPlantGraph,
  leafAreaScale: number,
  unresolvedFoliageArea: number,
) => {
  const areaBySegment = new Map<string, number>();
  const attachments = [...graph.attachments].sort((a, b) => stableCompare(a.id, b.id));
  for (const attachment of attachments) {
    if (attachment.parentSegmentId === null || !foliageKinds.has(attachment.kind)) continue;
    let area = unresolvedFoliageArea;
    if (attachment.organIndex !== null) {
      const organ = graph.organs[attachment.organIndex];
      if (organ) {
        assertFiniteInRange(organ.scale, `organ[${attachment.organIndex}].scale`, 0);
        area = organ.scale * organ.scale * leafAreaScale;
      }
    }
    areaBySegment.set(attachment.parentSegmentId, (areaBySegment.get(attachment.parentSegmentId) ?? 0) + area);
  }
  return areaBySegment;
};

const inferBudRoles = (
  records: readonly ProcPlantSegmentRecord[],
  directions: ReadonlyMap<string, ProcPlantGrowthVector>,
) => {
  const roleById = new Map<string, ProcPlantBudRole>();
  const childrenByParent = new Map<string, ProcPlantSegmentRecord[]>();
  for (const record of records) {
    if (record.parentSegmentId === null) {
      roleById.set(record.id, "apical");
      continue;
    }
    const children = childrenByParent.get(record.parentSegmentId) ?? [];
    children.push(record);
    childrenByParent.set(record.parentSegmentId, children);
  }
  for (const [parentId, children] of childrenByParent) {
    const parentDirection = directions.get(parentId)!;
    const ranked = [...children].sort((a, b) => {
      const aDirection = directions.get(a.id)!;
      const bDirection = directions.get(b.id)!;
      const alignmentA = parentDirection.x * aDirection.x + parentDirection.y * aDirection.y + parentDirection.z * aDirection.z;
      const alignmentB = parentDirection.x * bDirection.x + parentDirection.y * bDirection.y + parentDirection.z * bDirection.z;
      return alignmentB - alignmentA || stableCompare(a.id, b.id);
    });
    ranked.forEach((record, index) => roleById.set(record.id, index === 0 ? "apical" : "lateral"));
  }
  return roleById;
};

/**
 * Adapt the stable public segment IR to one deterministic resource-growth step.
 * The source graph and its Three.js vectors are read only and never cloned or mutated.
 */
export const evaluateProcPlantGraphResourceGrowth = (
  graph: ProcPlantGraph,
  sampleLight: ProcPlantGraphLightSampler,
  options: ProcPlantGraphResourceGrowthOptions = {},
): ProcPlantGraphResourceGrowthResult => {
  const leafAreaScale = options.leafAreaScale ?? 1;
  const unresolvedFoliageArea = options.unresolvedFoliageArea ?? 0.01;
  const maintenanceCostPerVolume = options.maintenanceCostPerVolume ?? 0.25;
  const growthDemandPerVolume = options.growthDemandPerVolume ?? 1;
  const minimumGrowthDemand = options.minimumGrowthDemand ?? 0.01;
  const selfPruneLightThreshold = options.selfPruneLightThreshold ?? 0.12;
  const selfPruneVigorThreshold = options.selfPruneVigorThreshold ?? 0.2;
  const minimumSelfPruneDepth = options.minimumSelfPruneDepth ?? 1;
  assertFiniteInRange(leafAreaScale, "leafAreaScale", 0);
  assertFiniteInRange(unresolvedFoliageArea, "unresolvedFoliageArea", 0);
  assertFiniteInRange(maintenanceCostPerVolume, "maintenanceCostPerVolume", 0);
  assertFiniteInRange(growthDemandPerVolume, "growthDemandPerVolume", 0);
  assertFiniteInRange(minimumGrowthDemand, "minimumGrowthDemand", 0);
  assertFiniteInRange(selfPruneLightThreshold, "selfPruneLightThreshold", 0, 1);
  assertFiniteInRange(selfPruneVigorThreshold, "selfPruneVigorThreshold", 0, 1);
  if (!Number.isInteger(minimumSelfPruneDepth) || minimumSelfPruneDepth < 1) {
    throw new Error("minimumSelfPruneDepth must be an integer of at least 1");
  }

  const { depthById } = validateTopology(graph);
  const records = [...graph.segmentRecords].sort((a, b) => stableCompare(a.id, b.id));
  const activeSegmentIds = options.activeSegmentIds ? new Set(options.activeSegmentIds) : null;
  if (activeSegmentIds) {
    for (const id of activeSegmentIds) {
      if (!records.some((record) => record.id === id)) throw new Error(`activeSegmentIds references missing segment: ${id}`);
    }
  }
  const geometryById = new Map<string, Omit<SegmentMetrics, "record" | "approximateLeafArea" | "topologyDepth" | "budRole">>();
  const directions = new Map<string, ProcPlantGrowthVector>();
  for (const record of records) {
    const startNode = graph.stems[record.startNodeIndex]!;
    const endNode = graph.stems[record.endNodeIndex]!;
    const start = vectorFrom(startNode.position, `${record.id}.start`);
    const end = vectorFrom(endNode.position, `${record.id}.end`);
    assertFiniteInRange(startNode.radius, `${record.id}.startRadius`, 0);
    assertFiniteInRange(endNode.radius, `${record.id}.endRadius`, 0);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dy, dz);
    if (length <= EPSILON) throw new Error(`${record.id} must have non-zero length`);
    const direction = { x: dx / length, y: dy / length, z: dz / length };
    const meanRadius = (startNode.radius + endNode.radius) * 0.5;
    const structuralVolume = Math.PI * meanRadius * meanRadius * length;
    geometryById.set(record.id, { start, end, direction, length, meanRadius, structuralVolume });
    directions.set(record.id, direction);
  }

  const areaBySegment = approximateLeafAreaBySegment(graph, leafAreaScale, unresolvedFoliageArea);
  const roleById = inferBudRoles(records, directions);
  const metrics: SegmentMetrics[] = records.map((record) => ({
    record,
    ...geometryById.get(record.id)!,
    approximateLeafArea: areaBySegment.get(record.id) ?? 0,
    topologyDepth: depthById.get(record.id)!,
    budRole: roleById.get(record.id)!,
  }));

  const resourceNodes: ProcPlantResourceNode[] = [{
    id: SYNTHETIC_ROOT_ID,
    parentId: null,
    budRole: "apical",
    active: true,
    lightSamples: [],
    photosyntheticArea: 0,
    maintenanceDemand: 0,
    growthDemand: 0,
    sinkStrength: 0,
  }];
  for (const metric of metrics) {
    const context: ProcPlantGraphLightSampleContext = {
      segmentId: metric.record.id,
      parentSegmentId: metric.record.parentSegmentId,
      topologyDepth: metric.topologyDepth,
      authoredDepth: metric.record.depth,
      budRole: metric.budRole,
      start: { ...metric.start },
      end: { ...metric.end },
      direction: { ...metric.direction },
      length: metric.length,
      meanRadius: metric.meanRadius,
      approximateLeafArea: metric.approximateLeafArea,
    };
    resourceNodes.push({
      id: `segment:${metric.record.id}`,
      parentId: metric.record.parentSegmentId === null ? SYNTHETIC_ROOT_ID : `segment:${metric.record.parentSegmentId}`,
      budRole: metric.budRole,
      active: activeSegmentIds?.has(metric.record.id) ?? true,
      lightSamples: sampleLight(context),
      photosyntheticArea: metric.approximateLeafArea,
      maintenanceDemand: metric.structuralVolume * maintenanceCostPerVolume,
      growthDemand: Math.max(minimumGrowthDemand, metric.structuralVolume * growthDemandPerVolume),
      sinkStrength: Math.max(EPSILON, metric.meanRadius * metric.meanRadius),
    });
  }

  const resourceResult = evaluateProcPlantResourceGrowth(resourceNodes, options.resourceGrowth);
  const resultBySegmentId = new Map(
    resourceResult.nodes
      .filter((node) => node.id.startsWith("segment:"))
      .map((node) => [node.id.slice("segment:".length), node]),
  );
  const childrenByParent = new Map<string, string[]>();
  for (const record of records) {
    if (record.parentSegmentId === null) continue;
    const children = childrenByParent.get(record.parentSegmentId) ?? [];
    children.push(record.id);
    childrenByParent.set(record.parentSegmentId, children);
  }
  const vigorById = new Map<string, number>();
  const rawPruneCandidate = new Map<string, boolean>();
  for (const metric of metrics) {
    const result = resultBySegmentId.get(metric.record.id)!;
    const maintenanceFraction = result.maintenanceDemand > EPSILON
      ? Math.min(1, result.maintenanceResource / result.maintenanceDemand)
      : 1;
    const vigor = Math.min(1, (maintenanceFraction * 0.65 + result.growthFraction * 0.35) * (0.25 + result.lightExposure * 0.75));
    vigorById.set(metric.record.id, vigor);
    rawPruneCandidate.set(metric.record.id,
      metric.topologyDepth >= minimumSelfPruneDepth &&
      result.lightExposure <= selfPruneLightThreshold &&
      vigor <= selfPruneVigorThreshold &&
      (result.decision === "hold" || result.decision === "resource-deficit"));
  }
  const subtreePrunable = new Map<string, boolean>();
  const resolveSubtreePrunable = (id: string): boolean => {
    const known = subtreePrunable.get(id);
    if (known !== undefined) return known;
    const prunable = rawPruneCandidate.get(id) === true &&
      (childrenByParent.get(id) ?? []).every((childId) => resolveSubtreePrunable(childId));
    subtreePrunable.set(id, prunable);
    return prunable;
  };
  for (const record of records) resolveSubtreePrunable(record.id);

  const segments = metrics.map((metric): ProcPlantSegmentResourceRecommendation => {
    const result = resultBySegmentId.get(metric.record.id)!;
    const parentPrunable = metric.record.parentSegmentId === null
      ? false
      : subtreePrunable.get(metric.record.parentSegmentId) === true;
    const recommendSelfPrune = subtreePrunable.get(metric.record.id) === true && !parentPrunable;
    const recommendation: ProcPlantSegmentGrowthRecommendation = recommendSelfPrune
      ? "self-prune"
      : result.decision === "grow"
        ? "extend"
        : result.decision === "resource-deficit"
          ? "conserve"
          : "maintain";
    return {
      segmentId: metric.record.id,
      parentSegmentId: metric.record.parentSegmentId,
      topologyDepth: metric.topologyDepth,
      budRole: metric.budRole,
      approximateLeafArea: metric.approximateLeafArea,
      structuralVolume: metric.structuralVolume,
      lightExposure: result.lightExposure,
      lightDirection: result.lightDirection,
      producedResource: result.producedResource,
      maintenanceResource: result.maintenanceResource,
      growthResource: result.growthResource,
      vigor: vigorById.get(metric.record.id)!,
      growthScale: result.growthFraction,
      resourceDecision: result.decision,
      recommendation,
      recommendSelfPrune,
    };
  });

  return {
    version: PROCPLANT_GRAPH_RESOURCE_GROWTH_CONTRACT_VERSION,
    segments,
    grossResource: resourceResult.grossResource,
    maintenanceResource: resourceResult.maintenanceResource,
    growthResource: resourceResult.growthResource,
    reserveResource: resourceResult.reserveResource,
    limitations: PROCPLANT_GRAPH_RESOURCE_ADAPTER_LIMITATIONS,
  };
};
