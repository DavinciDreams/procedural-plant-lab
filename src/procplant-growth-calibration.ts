import type { ProcPlantGraph } from "./procplants";
import type {
  ProcPlantGraphLightSampler,
  ProcPlantGraphResourceGrowthOptions,
} from "./procplant-graph-resource-growth";
import {
  stepProcPlantGrowthSimulation,
  type ProcPlantGrowthSimulationState,
  type ProcPlantGrowthSimulationStepResult,
} from "./procplant-growth-simulation";

export const PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION = 1 as const;
export const PROCPLANT_CALIBRATED_GROWTH_STEP_VERSION = 1 as const;

export type ProcPlantGrowthCalibrationId =
  | "vnp17-evergreen-needleleaf-forest"
  | "vnp17-deciduous-broadleaf-forest"
  | "vnp17-grassland"
  | "vnp17-cropland";

export interface ProcPlantGrowthCalibrationProvenance {
  title: string;
  organization: string;
  sourceVersion: string;
  table: string;
  url: string;
}

/**
 * A plant-functional-type light-use-efficiency record.
 *
 * The V1 units and scalar meanings follow the official VNP17 GPP/NPP user
 * guide. This is intentionally a PFT contract rather than a species claim.
 */
export interface ProcPlantGrowthCalibrationV1 {
  version: typeof PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION;
  id: string;
  label: string;
  maximumLightUseEfficiencyKgCarbonPerMjApar: number;
  minimumDailyTemperatureZeroEfficiencyCelsius: number;
  minimumDailyTemperatureFullEfficiencyCelsius: number;
  vaporPressureDeficitFullEfficiencyPascal: number;
  vaporPressureDeficitZeroEfficiencyPascal: number;
  specificLeafAreaSquareMetersPerKgLeafCarbon: number;
  provenance: ProcPlantGrowthCalibrationProvenance;
}

const VNP17_PROVENANCE: ProcPlantGrowthCalibrationProvenance = Object.freeze({
  title: "VNP17/VJ117 User's Guide",
  organization: "NASA Land Processes Distributed Active Archive Center",
  sourceVersion: "Version 1",
  table: "Biome Properties Look-Up Table (BPLUT)",
  url: "https://lpdaac.usgs.gov/documents/2255/VNP17_User_Guide_V1.pdf",
});

const preset = (
  id: ProcPlantGrowthCalibrationId,
  label: string,
  maximumLightUseEfficiencyKgCarbonPerMjApar: number,
  minimumDailyTemperatureZeroEfficiencyCelsius: number,
  minimumDailyTemperatureFullEfficiencyCelsius: number,
  vaporPressureDeficitFullEfficiencyPascal: number,
  vaporPressureDeficitZeroEfficiencyPascal: number,
  specificLeafAreaSquareMetersPerKgLeafCarbon: number,
): Readonly<ProcPlantGrowthCalibrationV1> => Object.freeze({
  version: PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION,
  id,
  label,
  maximumLightUseEfficiencyKgCarbonPerMjApar,
  minimumDailyTemperatureZeroEfficiencyCelsius,
  minimumDailyTemperatureFullEfficiencyCelsius,
  vaporPressureDeficitFullEfficiencyPascal,
  vaporPressureDeficitZeroEfficiencyPascal,
  specificLeafAreaSquareMetersPerKgLeafCarbon,
  provenance: VNP17_PROVENANCE,
});

/** Four bounded VNP17 PFT records copied with their published units. */
export const PROCPLANT_GROWTH_CALIBRATION_PRESETS: Readonly<
  Record<ProcPlantGrowthCalibrationId, Readonly<ProcPlantGrowthCalibrationV1>>
> = Object.freeze({
  "vnp17-evergreen-needleleaf-forest": preset(
    "vnp17-evergreen-needleleaf-forest", "Evergreen needleleaf forest",
    0.001031, -8, 3.6, 650, 4636, 15.40168,
  ),
  "vnp17-deciduous-broadleaf-forest": preset(
    "vnp17-deciduous-broadleaf-forest", "Deciduous broadleaf forest",
    0.001593, -6, 21.4, 650, 3434, 37.22949,
  ),
  "vnp17-grassland": preset(
    "vnp17-grassland", "Grassland",
    0.001301, -8, 5, 650, 4156, 35.75488,
  ),
  "vnp17-cropland": preset(
    "vnp17-cropland", "Cropland",
    0.001848, -8, 21.5, 650, 4963, 40.31786,
  ),
});

export type ProcPlantGrowthCalibrationReference =
  | ProcPlantGrowthCalibrationId
  | Readonly<ProcPlantGrowthCalibrationV1>;

export interface ProcPlantGrowthCalibrationClimate {
  /** Incident photosynthetically active radiation for one day. */
  incidentParMjPerSquareMeterPerDay: number;
  minimumDailyTemperatureCelsius: number;
  daylightVaporPressureDeficitPascal: number;
  /** Fractional days represented by this step; capped at 31. */
  timestepDays?: number;
}

export interface ProcPlantGrowthCalibrationGeometry {
  /** Conversion for all graph positions and organ scales. */
  metersPerSceneUnit: number;
  /** Projected leaf area represented by organ.scale squared. */
  projectedLeafAreaFactor?: number;
  /** Area assigned to an unresolved foliage attachment. */
  unresolvedFoliageAreaSquareMeters?: number;
}

export interface ProcPlantGrowthCalibrationCarbonBudget {
  /** Caller-calibrated structural maintenance demand. */
  maintenanceCarbonKgPerCubicMeterPerDay: number;
  /** Caller-calibrated potential structural growth demand. */
  potentialGrowthCarbonKgPerCubicMeterPerDay: number;
  minimumGrowthDemandKgCarbon?: number;
  reserveFraction?: number;
  apicalDominance?: number;
  apicalControlDecay?: number;
  minimumActivationLight?: number;
  activationResourceThresholdKgCarbon?: number;
  minimumGrowthLight?: number;
  growthResourceThresholdKgCarbon?: number;
  maintenanceSurvivalFraction?: number;
  selfPruneLightThreshold?: number;
  selfPruneVigorThreshold?: number;
  minimumSelfPruneDepth?: number;
}

export interface ProcPlantGrowthCalibrationAudit {
  version: typeof PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION;
  calibrationId: string;
  temperatureScalar: number;
  vaporPressureDeficitScalar: number;
  environmentalScalar: number;
  effectiveLightUseEfficiencyKgCarbonPerMjApar: number;
  incidentParMjPerSquareMeterPerDay: number;
  timestepDays: number;
  productionKgCarbonPerSquareMeterAtFullExposure: number;
  specificLeafAreaSquareMetersPerKgLeafCarbon: number;
  provenance: ProcPlantGrowthCalibrationProvenance;
}

export interface ProcPlantCalibratedGraphGrowthBridge {
  version: typeof PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION;
  calibration: ProcPlantGrowthCalibrationAudit;
  adapter: ProcPlantGraphResourceGrowthOptions;
  units: {
    resource: "kg-carbon";
    length: "scene-unit";
    lightExposure: "fraction-of-incident-par";
  };
  limitations: readonly string[];
}

export const PROCPLANT_GROWTH_CALIBRATION_LIMITATIONS = [
  "The bundled records are remotely sensed plant-functional-type parameters, not species, genotype, or site calibrations.",
  "The bridge applies VNP17 light-use-efficiency and climate scalars to projected procedural leaf area; it does not implement canopy radiative transfer or reproduce the VNP17 pixel algorithm.",
  "Structural maintenance and potential growth demand are caller-supplied coefficients because scene-unit tube volume is not measured plant carbon mass.",
  "The existing simulator's vigor, apical control, activation, and self-prune decisions remain normalized procedural heuristics and are not physiologically validated.",
] as const;

const assertFiniteInRange = (value: number, label: string, min: number, max: number) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite and in [${min}, ${max}]`);
  }
};

const assertNonEmpty = (value: string, label: string) => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
};

/** Validate and detach a catalog or caller-authored calibration record. */
export const resolveProcPlantGrowthCalibration = (
  reference: ProcPlantGrowthCalibrationReference,
): ProcPlantGrowthCalibrationV1 => {
  const source = typeof reference === "string" ? PROCPLANT_GROWTH_CALIBRATION_PRESETS[reference] : reference;
  if (!source) throw new Error(`unknown growth calibration: ${String(reference)}`);
  if (source.version !== PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION) {
    throw new Error(`unsupported growth calibration version: ${String(source.version)}`);
  }
  assertNonEmpty(source.id, "calibration.id");
  assertNonEmpty(source.label, "calibration.label");
  assertFiniteInRange(source.maximumLightUseEfficiencyKgCarbonPerMjApar, "maximumLightUseEfficiencyKgCarbonPerMjApar", 0, 0.02);
  assertFiniteInRange(source.minimumDailyTemperatureZeroEfficiencyCelsius, "minimumDailyTemperatureZeroEfficiencyCelsius", -100, 70);
  assertFiniteInRange(source.minimumDailyTemperatureFullEfficiencyCelsius, "minimumDailyTemperatureFullEfficiencyCelsius", -100, 70);
  if (source.minimumDailyTemperatureFullEfficiencyCelsius <= source.minimumDailyTemperatureZeroEfficiencyCelsius) {
    throw new Error("minimumDailyTemperatureFullEfficiencyCelsius must exceed the zero-efficiency threshold");
  }
  assertFiniteInRange(source.vaporPressureDeficitFullEfficiencyPascal, "vaporPressureDeficitFullEfficiencyPascal", 0, 20_000);
  assertFiniteInRange(source.vaporPressureDeficitZeroEfficiencyPascal, "vaporPressureDeficitZeroEfficiencyPascal", 0, 20_000);
  if (source.vaporPressureDeficitZeroEfficiencyPascal <= source.vaporPressureDeficitFullEfficiencyPascal) {
    throw new Error("vaporPressureDeficitZeroEfficiencyPascal must exceed the full-efficiency threshold");
  }
  assertFiniteInRange(source.specificLeafAreaSquareMetersPerKgLeafCarbon, "specificLeafAreaSquareMetersPerKgLeafCarbon", 0.01, 1_000);
  assertNonEmpty(source.provenance.title, "calibration.provenance.title");
  assertNonEmpty(source.provenance.organization, "calibration.provenance.organization");
  assertNonEmpty(source.provenance.sourceVersion, "calibration.provenance.sourceVersion");
  assertNonEmpty(source.provenance.table, "calibration.provenance.table");
  if (!/^https:\/\//.test(source.provenance.url)) throw new Error("calibration.provenance.url must be an https URL");
  return {
    ...source,
    provenance: { ...source.provenance },
  };
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Resolve the documented VNP17 linear Tmin and VPD attenuation ramps. */
export const evaluateProcPlantGrowthCalibration = (
  reference: ProcPlantGrowthCalibrationReference,
  climate: Readonly<ProcPlantGrowthCalibrationClimate>,
): ProcPlantGrowthCalibrationAudit => {
  const calibration = resolveProcPlantGrowthCalibration(reference);
  const timestepDays = climate.timestepDays ?? 1;
  assertFiniteInRange(climate.incidentParMjPerSquareMeterPerDay, "incidentParMjPerSquareMeterPerDay", 0, 100);
  assertFiniteInRange(climate.minimumDailyTemperatureCelsius, "minimumDailyTemperatureCelsius", -100, 70);
  assertFiniteInRange(climate.daylightVaporPressureDeficitPascal, "daylightVaporPressureDeficitPascal", 0, 20_000);
  assertFiniteInRange(timestepDays, "timestepDays", Number.MIN_VALUE, 31);

  const temperatureScalar = clamp01(
    (climate.minimumDailyTemperatureCelsius - calibration.minimumDailyTemperatureZeroEfficiencyCelsius) /
    (calibration.minimumDailyTemperatureFullEfficiencyCelsius - calibration.minimumDailyTemperatureZeroEfficiencyCelsius),
  );
  const vaporPressureDeficitScalar = clamp01(
    (calibration.vaporPressureDeficitZeroEfficiencyPascal - climate.daylightVaporPressureDeficitPascal) /
    (calibration.vaporPressureDeficitZeroEfficiencyPascal - calibration.vaporPressureDeficitFullEfficiencyPascal),
  );
  const environmentalScalar = temperatureScalar * vaporPressureDeficitScalar;
  const effectiveLightUseEfficiencyKgCarbonPerMjApar =
    calibration.maximumLightUseEfficiencyKgCarbonPerMjApar * environmentalScalar;
  return {
    version: PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION,
    calibrationId: calibration.id,
    temperatureScalar,
    vaporPressureDeficitScalar,
    environmentalScalar,
    effectiveLightUseEfficiencyKgCarbonPerMjApar,
    incidentParMjPerSquareMeterPerDay: climate.incidentParMjPerSquareMeterPerDay,
    timestepDays,
    productionKgCarbonPerSquareMeterAtFullExposure:
      effectiveLightUseEfficiencyKgCarbonPerMjApar * climate.incidentParMjPerSquareMeterPerDay * timestepDays,
    specificLeafAreaSquareMetersPerKgLeafCarbon: calibration.specificLeafAreaSquareMetersPerKgLeafCarbon,
    provenance: { ...calibration.provenance },
  };
};

/**
 * Map a physical-units calibration into the existing graph resource adapter.
 * Light samples remain normalized fractions of incident PAR in [0, 1].
 */
export const createProcPlantCalibratedGraphGrowthBridge = (
  reference: ProcPlantGrowthCalibrationReference,
  climate: Readonly<ProcPlantGrowthCalibrationClimate>,
  geometry: Readonly<ProcPlantGrowthCalibrationGeometry>,
  budget: Readonly<ProcPlantGrowthCalibrationCarbonBudget>,
): ProcPlantCalibratedGraphGrowthBridge => {
  const calibration = evaluateProcPlantGrowthCalibration(reference, climate);
  const projectedLeafAreaFactor = geometry.projectedLeafAreaFactor ?? 1;
  const unresolvedFoliageAreaSquareMeters = geometry.unresolvedFoliageAreaSquareMeters ?? 0;
  assertFiniteInRange(geometry.metersPerSceneUnit, "metersPerSceneUnit", Number.MIN_VALUE, 1_000);
  assertFiniteInRange(projectedLeafAreaFactor, "projectedLeafAreaFactor", 0, 10);
  assertFiniteInRange(unresolvedFoliageAreaSquareMeters, "unresolvedFoliageAreaSquareMeters", 0, 1_000);
  assertFiniteInRange(budget.maintenanceCarbonKgPerCubicMeterPerDay, "maintenanceCarbonKgPerCubicMeterPerDay", 0, 10);
  assertFiniteInRange(budget.potentialGrowthCarbonKgPerCubicMeterPerDay, "potentialGrowthCarbonKgPerCubicMeterPerDay", 0, 100);
  assertFiniteInRange(budget.minimumGrowthDemandKgCarbon ?? 0, "minimumGrowthDemandKgCarbon", 0, 100);

  const timestepDays = calibration.timestepDays;
  const squareMetersPerSceneUnitSquared = geometry.metersPerSceneUnit ** 2;
  const cubicMetersPerSceneUnitCubed = geometry.metersPerSceneUnit ** 3;
  const adapter: ProcPlantGraphResourceGrowthOptions = {
    leafAreaScale: squareMetersPerSceneUnitSquared * projectedLeafAreaFactor,
    unresolvedFoliageArea: unresolvedFoliageAreaSquareMeters,
    maintenanceCostPerVolume:
      budget.maintenanceCarbonKgPerCubicMeterPerDay * cubicMetersPerSceneUnitCubed * timestepDays,
    growthDemandPerVolume:
      budget.potentialGrowthCarbonKgPerCubicMeterPerDay * cubicMetersPerSceneUnitCubed * timestepDays,
    minimumGrowthDemand: budget.minimumGrowthDemandKgCarbon ?? 0,
    selfPruneLightThreshold: budget.selfPruneLightThreshold,
    selfPruneVigorThreshold: budget.selfPruneVigorThreshold,
    minimumSelfPruneDepth: budget.minimumSelfPruneDepth,
    resourceGrowth: {
      lightUseEfficiency: calibration.productionKgCarbonPerSquareMeterAtFullExposure,
      reserveFraction: budget.reserveFraction,
      apicalDominance: budget.apicalDominance,
      apicalControlDecay: budget.apicalControlDecay,
      minimumActivationLight: budget.minimumActivationLight,
      activationResourceThreshold: budget.activationResourceThresholdKgCarbon,
      minimumGrowthLight: budget.minimumGrowthLight,
      growthResourceThreshold: budget.growthResourceThresholdKgCarbon,
      maintenanceSurvivalFraction: budget.maintenanceSurvivalFraction,
    },
  };
  return {
    version: PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION,
    calibration,
    adapter,
    units: {
      resource: "kg-carbon",
      length: "scene-unit",
      lightExposure: "fraction-of-incident-par",
    },
    limitations: PROCPLANT_GROWTH_CALIBRATION_LIMITATIONS,
  };
};

export interface ProcPlantCalibratedGrowthStepOptions {
  calibration: ProcPlantGrowthCalibrationReference;
  climate: Readonly<ProcPlantGrowthCalibrationClimate>;
  geometry: Readonly<ProcPlantGrowthCalibrationGeometry>;
  carbonBudget: Readonly<ProcPlantGrowthCalibrationCarbonBudget>;
  resourceInputKgCarbon?: number;
  activationConfirmationSteps?: number;
  selfPruneConfirmationSteps?: number;
  evidenceRecoveryPerStep?: number;
}

export interface ProcPlantCalibratedGrowthStepResult {
  version: typeof PROCPLANT_CALIBRATED_GROWTH_STEP_VERSION;
  calibration: ProcPlantGrowthCalibrationAudit;
  simulation: ProcPlantGrowthSimulationStepResult;
  units: ProcPlantCalibratedGraphGrowthBridge["units"];
  limitations: readonly string[];
}

/** Advance the existing stateful simulator with an explicit physical-units bridge. */
export const stepProcPlantCalibratedGrowthSimulation = (
  graph: ProcPlantGraph,
  state: ProcPlantGrowthSimulationState,
  sampleLight: ProcPlantGraphLightSampler,
  options: Readonly<ProcPlantCalibratedGrowthStepOptions>,
): ProcPlantCalibratedGrowthStepResult => {
  const bridge = createProcPlantCalibratedGraphGrowthBridge(
    options.calibration,
    options.climate,
    options.geometry,
    options.carbonBudget,
  );
  const resourceInputKgCarbon = options.resourceInputKgCarbon ?? 0;
  assertFiniteInRange(resourceInputKgCarbon, "resourceInputKgCarbon", 0, 1_000_000);
  const simulation = stepProcPlantGrowthSimulation(graph, state, sampleLight, {
    adapter: bridge.adapter,
    resourceInput: resourceInputKgCarbon,
    activationConfirmationSteps: options.activationConfirmationSteps,
    selfPruneConfirmationSteps: options.selfPruneConfirmationSteps,
    evidenceRecoveryPerStep: options.evidenceRecoveryPerStep,
  });
  return {
    version: PROCPLANT_CALIBRATED_GROWTH_STEP_VERSION,
    calibration: bridge.calibration,
    simulation,
    units: bridge.units,
    limitations: bridge.limitations,
  };
};
