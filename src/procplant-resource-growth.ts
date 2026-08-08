export interface ProcPlantGrowthVector {
  x: number;
  y: number;
  z: number;
}

export const PROCPLANT_RESOURCE_GROWTH_CONTRACT_VERSION = 1 as const;

/** A directional light probe. Irradiance and occlusion are normalized to [0, 1]. */
export interface ProcPlantLightSample {
  direction: ProcPlantGrowthVector;
  irradiance: number;
  occlusion?: number;
  weight?: number;
}

export type ProcPlantBudRole = "apical" | "lateral";

export interface ProcPlantResourceNode {
  id: string;
  parentId: string | null;
  budRole: ProcPlantBudRole;
  active: boolean;
  lightSamples: readonly ProcPlantLightSample[];
  photosyntheticArea: number;
  maintenanceDemand: number;
  growthDemand: number;
  sinkStrength: number;
}

export interface ProcPlantResourceGrowthOptions {
  initialResource?: number;
  lightUseEfficiency?: number;
  reserveFraction?: number;
  apicalDominance?: number;
  apicalControlDecay?: number;
  minimumActivationLight?: number;
  activationResourceThreshold?: number;
  minimumGrowthLight?: number;
  growthResourceThreshold?: number;
  maintenanceSurvivalFraction?: number;
}

export type ProcPlantGrowthDecision =
  | "grow"
  | "activate"
  | "hold"
  | "dormant"
  | "resource-deficit";

export interface ProcPlantNodeResourceResult {
  id: string;
  parentId: string | null;
  depth: number;
  lightExposure: number;
  lightDirection: ProcPlantGrowthVector;
  producedResource: number;
  maintenanceDemand: number;
  maintenanceResource: number;
  growthDemand: number;
  growthResource: number;
  sinkWeight: number;
  apicalSuppression: number;
  growthFraction: number;
  decision: ProcPlantGrowthDecision;
}

export interface ProcPlantResourceGrowthResult {
  version: typeof PROCPLANT_RESOURCE_GROWTH_CONTRACT_VERSION;
  nodes: ProcPlantNodeResourceResult[];
  grossResource: number;
  maintenanceResource: number;
  growthResource: number;
  reserveResource: number;
}

interface ResolvedOptions {
  initialResource: number;
  lightUseEfficiency: number;
  reserveFraction: number;
  apicalDominance: number;
  apicalControlDecay: number;
  minimumActivationLight: number;
  activationResourceThreshold: number;
  minimumGrowthLight: number;
  growthResourceThreshold: number;
  maintenanceSurvivalFraction: number;
}

interface LightSummary {
  exposure: number;
  direction: ProcPlantGrowthVector;
}

const EPSILON = 1e-12;

const assertFiniteInRange = (value: number, label: string, min: number, max = Number.POSITIVE_INFINITY) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite and in [${min}, ${max}]`);
  }
};

const resolveOptions = (options: ProcPlantResourceGrowthOptions): ResolvedOptions => {
  const resolved: ResolvedOptions = {
    initialResource: options.initialResource ?? 0,
    lightUseEfficiency: options.lightUseEfficiency ?? 1,
    reserveFraction: options.reserveFraction ?? 0.1,
    apicalDominance: options.apicalDominance ?? 0.65,
    apicalControlDecay: options.apicalControlDecay ?? 0.85,
    minimumActivationLight: options.minimumActivationLight ?? 0.3,
    activationResourceThreshold: options.activationResourceThreshold ?? 0.15,
    minimumGrowthLight: options.minimumGrowthLight ?? 0.1,
    growthResourceThreshold: options.growthResourceThreshold ?? 0.08,
    maintenanceSurvivalFraction: options.maintenanceSurvivalFraction ?? 0.5,
  };

  assertFiniteInRange(resolved.initialResource, "initialResource", 0);
  assertFiniteInRange(resolved.lightUseEfficiency, "lightUseEfficiency", 0);
  assertFiniteInRange(resolved.reserveFraction, "reserveFraction", 0, 1);
  assertFiniteInRange(resolved.apicalDominance, "apicalDominance", 0, 1);
  assertFiniteInRange(resolved.apicalControlDecay, "apicalControlDecay", 0, 1);
  assertFiniteInRange(resolved.minimumActivationLight, "minimumActivationLight", 0, 1);
  assertFiniteInRange(resolved.activationResourceThreshold, "activationResourceThreshold", 0);
  assertFiniteInRange(resolved.minimumGrowthLight, "minimumGrowthLight", 0, 1);
  assertFiniteInRange(resolved.growthResourceThreshold, "growthResourceThreshold", 0);
  assertFiniteInRange(resolved.maintenanceSurvivalFraction, "maintenanceSurvivalFraction", 0, 1);
  return resolved;
};

/** Combine directional probes into normalized exposure and a weighted light-seeking direction. */
export const summarizeProcPlantLight = (samples: readonly ProcPlantLightSample[]): LightSummary => {
  let totalWeight = 0;
  let exposureSum = 0;
  let directionX = 0;
  let directionY = 0;
  let directionZ = 0;

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    const label = `lightSamples[${index}]`;
    assertFiniteInRange(sample.irradiance, `${label}.irradiance`, 0, 1);
    const occlusion = sample.occlusion ?? 0;
    const weight = sample.weight ?? 1;
    assertFiniteInRange(occlusion, `${label}.occlusion`, 0, 1);
    assertFiniteInRange(weight, `${label}.weight`, Number.MIN_VALUE);
    const { x, y, z } = sample.direction;
    if (![x, y, z].every(Number.isFinite)) throw new Error(`${label}.direction must be finite`);
    const directionLength = Math.hypot(x, y, z);
    if (directionLength <= EPSILON) throw new Error(`${label}.direction must be non-zero`);

    const transmittedLight = sample.irradiance * (1 - occlusion);
    const contribution = transmittedLight * weight;
    totalWeight += weight;
    exposureSum += contribution;
    directionX += x / directionLength * contribution;
    directionY += y / directionLength * contribution;
    directionZ += z / directionLength * contribution;
  }

  const exposure = totalWeight > 0 ? exposureSum / totalWeight : 0;
  const directionLength = Math.hypot(directionX, directionY, directionZ);
  const direction = directionLength > EPSILON
    ? { x: directionX / directionLength, y: directionY / directionLength, z: directionZ / directionLength }
    : { x: 0, y: 1, z: 0 };
  return { exposure, direction };
};

const validateAndIndexNodes = (nodes: readonly ProcPlantResourceNode[]) => {
  if (nodes.length === 0) throw new Error("resource growth requires at least one node");
  const nodeById = new Map<string, ProcPlantResourceNode>();
  for (const node of nodes) {
    if (typeof node.id !== "string" || node.id.trim().length === 0) throw new Error("node id must be a non-empty string");
    if (nodeById.has(node.id)) throw new Error(`duplicate node id: ${node.id}`);
    assertFiniteInRange(node.photosyntheticArea, `${node.id}.photosyntheticArea`, 0);
    assertFiniteInRange(node.maintenanceDemand, `${node.id}.maintenanceDemand`, 0);
    assertFiniteInRange(node.growthDemand, `${node.id}.growthDemand`, 0);
    assertFiniteInRange(node.sinkStrength, `${node.id}.sinkStrength`, 0);
    summarizeProcPlantLight(node.lightSamples);
    nodeById.set(node.id, node);
  }

  const roots = nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1) throw new Error(`resource growth requires exactly one root; received ${roots.length}`);
  for (const node of nodes) {
    if (node.parentId !== null && !nodeById.has(node.parentId)) {
      throw new Error(`${node.id}.parentId references missing node: ${node.parentId}`);
    }
    if (node.parentId === node.id) throw new Error(`resource growth topology contains a cycle at ${node.id}`);
  }

  const depthById = new Map<string, number>();
  const visiting = new Set<string>();
  const resolveDepth = (node: ProcPlantResourceNode): number => {
    const known = depthById.get(node.id);
    if (known !== undefined) return known;
    if (visiting.has(node.id)) throw new Error(`resource growth topology contains a cycle at ${node.id}`);
    visiting.add(node.id);
    const depth = node.parentId === null ? 0 : resolveDepth(nodeById.get(node.parentId)!) + 1;
    visiting.delete(node.id);
    depthById.set(node.id, depth);
    return depth;
  };
  for (const node of nodes) resolveDepth(node);
  return { nodeById, depthById };
};

const allocateCapped = (pool: number, demands: readonly number[], weights: readonly number[]) => {
  const allocations = demands.map(() => 0);
  let remaining = pool;
  let eligible = demands
    .map((demand, index) => ({ demand, index, weight: weights[index]! }))
    .filter(({ demand, weight }) => demand > EPSILON && weight > EPSILON);

  while (remaining > EPSILON && eligible.length > 0) {
    const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
    const saturated = eligible.filter((entry) => {
      const residualDemand = entry.demand - allocations[entry.index]!;
      return remaining * entry.weight / totalWeight >= residualDemand - EPSILON;
    });
    if (saturated.length === 0) {
      for (const entry of eligible) allocations[entry.index]! += remaining * entry.weight / totalWeight;
      remaining = 0;
      break;
    }
    const saturatedIndices = new Set(saturated.map((entry) => entry.index));
    for (const entry of saturated) {
      const amount = entry.demand - allocations[entry.index]!;
      allocations[entry.index]! += amount;
      remaining -= amount;
    }
    eligible = eligible.filter((entry) => !saturatedIndices.has(entry.index));
  }
  return allocations;
};

/**
 * Evaluate one deterministic source/sink growth step.
 *
 * Light-derived production is pooled, maintenance is paid first, a configurable
 * reserve is retained, and the remainder is distributed with capped weighted
 * allocation. Lateral sinks are suppressed by illuminated apical siblings.
 */
export const evaluateProcPlantResourceGrowth = (
  inputNodes: readonly ProcPlantResourceNode[],
  options: ProcPlantResourceGrowthOptions = {},
): ProcPlantResourceGrowthResult => {
  const resolved = resolveOptions(options);
  const { depthById } = validateAndIndexNodes(inputNodes);
  const nodes = [...inputNodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const light = new Map(nodes.map((node) => [node.id, summarizeProcPlantLight(node.lightSamples)]));
  const childrenByParent = new Map<string, ProcPlantResourceNode[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  const production = nodes.map((node) => node.photosyntheticArea * light.get(node.id)!.exposure * resolved.lightUseEfficiency);
  const grossResource = resolved.initialResource + production.reduce((sum, value) => sum + value, 0);
  const maintenanceDemands = nodes.map((node) => node.maintenanceDemand);
  const maintenanceAllocations = allocateCapped(grossResource, maintenanceDemands, maintenanceDemands);
  const maintenanceResource = maintenanceAllocations.reduce((sum, value) => sum + value, 0);
  const postMaintenanceResource = Math.max(0, grossResource - maintenanceResource);
  const requestedReserve = postMaintenanceResource * resolved.reserveFraction;
  const growthPool = postMaintenanceResource - requestedReserve;

  const apicalSuppression = nodes.map((node) => {
    if (node.budRole !== "lateral" || node.parentId === null) return 0;
    const apicalSignal = (childrenByParent.get(node.parentId) ?? [])
      .filter((sibling) => sibling.id !== node.id && sibling.budRole === "apical")
      .reduce((strongest, sibling) => {
        const activity = sibling.active ? 1 : 0.5;
        return Math.max(strongest, light.get(sibling.id)!.exposure * activity);
      }, 0);
    const parentDepth = Math.max(0, depthById.get(node.id)! - 1);
    return Math.min(1, resolved.apicalDominance * Math.pow(resolved.apicalControlDecay, parentDepth) * apicalSignal);
  });
  const sinkWeights = nodes.map((node, index) => {
    if (node.growthDemand <= EPSILON || node.sinkStrength <= EPSILON) return 0;
    const exposure = light.get(node.id)!.exposure;
    const depth = depthById.get(node.id)!;
    const roleFactor = node.budRole === "apical"
      ? 1 + resolved.apicalDominance * 0.5 * Math.pow(resolved.apicalControlDecay, depth)
      : 1 - apicalSuppression[index]!;
    return node.sinkStrength * (0.2 + exposure * 0.8) * roleFactor;
  });
  const growthDemands = nodes.map((node) => node.growthDemand);
  const growthAllocations = allocateCapped(growthPool, growthDemands, sinkWeights);
  const growthResource = growthAllocations.reduce((sum, value) => sum + value, 0);
  const reserveResource = grossResource - maintenanceResource - growthResource;

  const results = nodes.map((node, index): ProcPlantNodeResourceResult => {
    const maintenanceFraction = node.maintenanceDemand > EPSILON
      ? maintenanceAllocations[index]! / node.maintenanceDemand
      : 1;
    const growthFraction = node.growthDemand > EPSILON
      ? Math.min(1, growthAllocations[index]! / node.growthDemand)
      : 0;
    const exposure = light.get(node.id)!.exposure;
    let decision: ProcPlantGrowthDecision;
    if (maintenanceFraction + EPSILON < resolved.maintenanceSurvivalFraction) {
      decision = "resource-deficit";
    } else if (!node.active) {
      decision = exposure + EPSILON >= resolved.minimumActivationLight &&
        growthAllocations[index]! + EPSILON >= resolved.activationResourceThreshold
        ? "activate"
        : "dormant";
    } else {
      decision = exposure + EPSILON >= resolved.minimumGrowthLight &&
        growthAllocations[index]! + EPSILON >= resolved.growthResourceThreshold
        ? "grow"
        : "hold";
    }

    return {
      id: node.id,
      parentId: node.parentId,
      depth: depthById.get(node.id)!,
      lightExposure: exposure,
      lightDirection: light.get(node.id)!.direction,
      producedResource: production[index]!,
      maintenanceDemand: node.maintenanceDemand,
      maintenanceResource: maintenanceAllocations[index]!,
      growthDemand: node.growthDemand,
      growthResource: growthAllocations[index]!,
      sinkWeight: sinkWeights[index]!,
      apicalSuppression: apicalSuppression[index]!,
      growthFraction,
      decision,
    };
  });

  const finiteOutputs = [grossResource, maintenanceResource, growthResource, reserveResource]
    .concat(results.flatMap((node) => [
      node.lightExposure,
      node.lightDirection.x,
      node.lightDirection.y,
      node.lightDirection.z,
      node.producedResource,
      node.maintenanceResource,
      node.growthResource,
      node.sinkWeight,
      node.apicalSuppression,
      node.growthFraction,
    ]));
  if (!finiteOutputs.every(Number.isFinite)) throw new Error("resource growth produced a non-finite result");
  return {
    version: PROCPLANT_RESOURCE_GROWTH_CONTRACT_VERSION,
    nodes: results,
    grossResource,
    maintenanceResource,
    growthResource,
    reserveResource,
  };
};
