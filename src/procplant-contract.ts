/**
 * Canonical public contract revision shared by the library entry point and
 * serialized Tellus packages. Increment this for incompatible changes to
 * genomes, attachment IR, instance kinds, or compiled geometry semantics.
 */
export const PROCPLANT_GENERATOR_CONTRACT_REVISION = 2 as const;

export const PROCPLANT_RUNTIME_LOD_CONTRACT = "procplants.runtime-lod-selection" as const;
export const PROCPLANT_RUNTIME_LOD_VERSION = 1 as const;

export type ProcPlantRuntimeLodLevel = 0 | 1 | 2 | 3;
export type ProcPlantRuntimeLodLabel = "full" | "clustered" | "billboard-cross" | "impostor";

export interface ProcPlantRuntimeLodTierSource {
  level: ProcPlantRuntimeLodLevel;
  label: ProcPlantRuntimeLodLabel;
  distance: number;
  triangleBudget?: number;
  triangles?: number;
  organBudget?: number;
}

export interface ProcPlantRuntimeLodTier {
  id: string;
  level: ProcPlantRuntimeLodLevel;
  label: ProcPlantRuntimeLodLabel;
  /** Enter this tier at or beyond this normalized world-space distance. */
  minDistance: number;
  /** Enter this tier at or below this viewport-height fraction. */
  maxProjectedScreenHeight: number;
  triangleBudget: number;
  organBudget?: number;
}

export interface ProcPlantRuntimeLodSelectionContract {
  contract: typeof PROCPLANT_RUNTIME_LOD_CONTRACT;
  version: typeof PROCPLANT_RUNTIME_LOD_VERSION;
  policy: {
    mode: "hybrid";
    distanceMetric: "camera-to-bounds-center-world-units";
    distanceNormalization: "divide-by-instance-max-world-scale";
    screenMetric: "projected-bounds-height-over-viewport-height";
    hysteresisRatio: number;
    culling: {
      rule: "either";
      minDistance: number;
      maxProjectedScreenHeight: number;
    };
  };
  tiers: ProcPlantRuntimeLodTier[];
}

export interface ProcPlantRuntimeLodObservation {
  distance: number;
  /** Bounds height divided by viewport pixel height; omit for distance-only fallback. */
  projectedScreenHeight?: number;
  /** Maximum absolute world-axis scale. Defaults to one. */
  instanceMaxWorldScale?: number;
  previousTierId?: string;
  previousCulled?: boolean;
}

export interface ProcPlantRuntimeLodSelection {
  tierId: string;
  tierIndex: number;
  level: ProcPlantRuntimeLodLevel;
  culled: boolean;
  reason: "initial" | "stable" | "distance" | "screen" | "distance-and-screen" | "culled";
}

const screenThresholdForLevel = (level: ProcPlantRuntimeLodLevel) =>
  ([1, 0.22, 0.075, 0.025] as const)[level];

export const createProcPlantRuntimeLodSelectionContract = (
  sources: readonly ProcPlantRuntimeLodTierSource[],
  options: {
    hysteresisRatio?: number;
    cullDistance?: number;
    cullProjectedScreenHeight?: number;
  } = {},
): ProcPlantRuntimeLodSelectionContract => {
  const tiers = [...sources]
    .sort((left, right) => left.level - right.level)
    .map((source): ProcPlantRuntimeLodTier => ({
      id: `lod${source.level}-${source.label}`,
      level: source.level,
      label: source.label,
      minDistance: source.distance,
      maxProjectedScreenHeight: screenThresholdForLevel(source.level),
      triangleBudget: source.triangleBudget ?? source.triangles ?? 0,
      ...(source.organBudget === undefined ? {} : { organBudget: source.organBudget }),
    }));
  const lastDistance = tiers.at(-1)?.minDistance ?? 0;
  const contract: ProcPlantRuntimeLodSelectionContract = {
    contract: PROCPLANT_RUNTIME_LOD_CONTRACT,
    version: PROCPLANT_RUNTIME_LOD_VERSION,
    policy: {
      mode: "hybrid",
      distanceMetric: "camera-to-bounds-center-world-units",
      distanceNormalization: "divide-by-instance-max-world-scale",
      screenMetric: "projected-bounds-height-over-viewport-height",
      hysteresisRatio: options.hysteresisRatio ?? 0.12,
      culling: {
        rule: "either",
        minDistance: options.cullDistance ?? Math.max(lastDistance * 2.25, lastDistance + 1),
        maxProjectedScreenHeight: options.cullProjectedScreenHeight ?? 0.003,
      },
    },
    tiers,
  };
  validateProcPlantRuntimeLodSelectionContract(contract);
  return contract;
};

export const validateProcPlantRuntimeLodSelectionContract = (
  value: ProcPlantRuntimeLodSelectionContract,
): ProcPlantRuntimeLodSelectionContract => {
  if (value.contract !== PROCPLANT_RUNTIME_LOD_CONTRACT || value.version !== PROCPLANT_RUNTIME_LOD_VERSION) {
    throw new Error("unsupported ProcPlant runtime LOD contract or version");
  }
  if (value.policy.mode !== "hybrid"
    || value.policy.distanceMetric !== "camera-to-bounds-center-world-units"
    || value.policy.distanceNormalization !== "divide-by-instance-max-world-scale"
    || value.policy.screenMetric !== "projected-bounds-height-over-viewport-height"
    || value.policy.culling.rule !== "either") {
    throw new Error("unsupported ProcPlant runtime LOD selection policy");
  }
  const hysteresis = value.policy.hysteresisRatio;
  if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= 0.5) {
    throw new Error("runtime LOD hysteresisRatio must be finite in [0, 0.5)");
  }
  if (!Number.isFinite(value.policy.culling.minDistance) || value.policy.culling.minDistance <= 0
    || !Number.isFinite(value.policy.culling.maxProjectedScreenHeight)
    || value.policy.culling.maxProjectedScreenHeight < 0
    || value.policy.culling.maxProjectedScreenHeight >= 1) {
    throw new Error("runtime LOD culling thresholds are invalid");
  }
  if (!Array.isArray(value.tiers) || value.tiers.length === 0) throw new Error("runtime LOD contract requires at least one tier");
  const ids = new Set<string>();
  let priorLevel = -1;
  let priorDistance = -1;
  let priorScreenHeight = Number.POSITIVE_INFINITY;
  for (const tier of value.tiers) {
    if (!/^lod[0-3]-(full|clustered|billboard-cross|impostor)$/.test(tier.id) || ids.has(tier.id)) {
      throw new Error(`runtime LOD tier id is invalid or duplicated: ${tier.id}`);
    }
    if (tier.id !== `lod${tier.level}-${tier.label}`) throw new Error(`${tier.id} does not match its level and label`);
    if (tier.level <= priorLevel || tier.minDistance < priorDistance) throw new Error("runtime LOD tiers must increase by level and distance");
    if (!Number.isFinite(tier.minDistance) || tier.minDistance < 0
      || !Number.isFinite(tier.maxProjectedScreenHeight) || tier.maxProjectedScreenHeight <= 0
      || tier.maxProjectedScreenHeight > priorScreenHeight
      || !Number.isFinite(tier.triangleBudget) || tier.triangleBudget < 0) {
      throw new Error(`runtime LOD tier ${tier.id} contains invalid thresholds or budgets`);
    }
    if (tier.organBudget !== undefined && (!Number.isFinite(tier.organBudget) || tier.organBudget < 0)) {
      throw new Error(`runtime LOD tier ${tier.id} has an invalid organ budget`);
    }
    ids.add(tier.id);
    priorLevel = tier.level;
    priorDistance = tier.minDistance;
    priorScreenHeight = tier.maxProjectedScreenHeight;
  }
  if (value.policy.culling.minDistance <= priorDistance
    || value.policy.culling.maxProjectedScreenHeight >= priorScreenHeight) {
    throw new Error("runtime LOD culling must occur beyond the coarsest tier thresholds");
  }
  return value;
};

const desiredTierIndex = (
  contract: ProcPlantRuntimeLodSelectionContract,
  normalizedDistance: number,
  screenHeight: number | undefined,
) => {
  let distanceIndex = 0;
  let screenIndex = 0;
  for (let index = 1; index < contract.tiers.length; index++) {
    if (normalizedDistance >= contract.tiers[index]!.minDistance) distanceIndex = index;
    if (screenHeight !== undefined && screenHeight <= contract.tiers[index]!.maxProjectedScreenHeight) screenIndex = index;
  }
  return Math.max(distanceIndex, screenIndex);
};

export const selectProcPlantRuntimeLod = (
  contract: ProcPlantRuntimeLodSelectionContract,
  observation: ProcPlantRuntimeLodObservation,
): ProcPlantRuntimeLodSelection => {
  validateProcPlantRuntimeLodSelectionContract(contract);
  if (!Number.isFinite(observation.distance) || observation.distance < 0) throw new Error("LOD observation distance must be finite and non-negative");
  if (observation.projectedScreenHeight !== undefined
    && (!Number.isFinite(observation.projectedScreenHeight) || observation.projectedScreenHeight < 0)) {
    throw new Error("LOD projectedScreenHeight must be finite and non-negative");
  }
  const scale = observation.instanceMaxWorldScale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("LOD instanceMaxWorldScale must be finite and positive");
  const distance = observation.distance / scale;
  const screen = observation.projectedScreenHeight;
  const hysteresis = contract.policy.hysteresisRatio;
  const previousIndex = observation.previousTierId === undefined
    ? -1
    : contract.tiers.findIndex((tier) => tier.id === observation.previousTierId);
  if (observation.previousTierId !== undefined && previousIndex < 0) throw new Error(`unknown previous LOD tier: ${observation.previousTierId}`);

  const rawCull = distance >= contract.policy.culling.minDistance
    || (screen !== undefined && screen <= contract.policy.culling.maxProjectedScreenHeight);
  const culled = observation.previousCulled
    ? !(distance < contract.policy.culling.minDistance * (1 - hysteresis)
      && (screen === undefined || screen > contract.policy.culling.maxProjectedScreenHeight * (1 + hysteresis)))
    : distance >= contract.policy.culling.minDistance * (1 + (previousIndex >= 0 ? hysteresis : 0))
      || (screen !== undefined && screen <= contract.policy.culling.maxProjectedScreenHeight * (1 - (previousIndex >= 0 ? hysteresis : 0)));

  let tierIndex = previousIndex >= 0 ? previousIndex : desiredTierIndex(contract, distance, screen);
  if (previousIndex >= 0 && !culled) {
    while (tierIndex < contract.tiers.length - 1) {
      const next = contract.tiers[tierIndex + 1]!;
      const distanceWantsCoarser = distance >= next.minDistance * (1 + hysteresis);
      const screenWantsCoarser = screen !== undefined && screen <= next.maxProjectedScreenHeight * (1 - hysteresis);
      if (!distanceWantsCoarser && !screenWantsCoarser) break;
      tierIndex++;
    }
    while (tierIndex > 0) {
      const current = contract.tiers[tierIndex]!;
      const distanceAllowsFiner = distance < current.minDistance * (1 - hysteresis);
      const screenAllowsFiner = screen === undefined || screen > current.maxProjectedScreenHeight * (1 + hysteresis);
      if (!distanceAllowsFiner || !screenAllowsFiner) break;
      tierIndex--;
    }
  }
  const tier = contract.tiers[tierIndex]!;
  const distanceSelected = distance >= tier.minDistance && tierIndex > 0;
  const screenSelected = screen !== undefined && screen <= tier.maxProjectedScreenHeight && tierIndex > 0;
  return {
    tierId: tier.id,
    tierIndex,
    level: tier.level,
    culled: rawCull && previousIndex < 0 ? true : culled,
    reason: culled
      ? "culled"
      : previousIndex < 0
        ? "initial"
        : tierIndex === previousIndex
          ? "stable"
          : distanceSelected && screenSelected
            ? "distance-and-screen"
            : screenSelected
              ? "screen"
              : "distance",
  };
};
