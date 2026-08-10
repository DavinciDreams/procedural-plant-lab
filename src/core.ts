/**
 * Runtime/compiler surface for Tellus and other downstream consumers.
 * Browser authoring, debug UI, CLI, cutout tooling, and GLB export intentionally
 * remain available only from the full `procplants` entry.
 */
export * from "./procplant-contract";
export type * from "./procplants";
export {
  PHI,
  GOLDEN_ANGLE_RADIANS,
  procPlantPhyllotaxyOrgansPerNode,
  resolveProcPlantPhyllotaxy,
  resolveProcPlantVinePath,
  defaultPlantEnvironment,
  PROCPLANT_ACCESSORY_KINDS,
  PROCPLANT_BASE_INSTANCE_KINDS,
  PROCPLANT_FOLIAGE_CLUSTER_KINDS,
  PROCPLANT_SUPPORTED_INSTANCE_KINDS,
  isProcPlantSupportedInstanceKind,
  procPlantPresets,
  procPlantPresetIds,
  hybridizePlantGenomes,
  buildProcPlantGraph,
  inspectProcPlantSpaceColonizationChains,
  buildProcPlantGraphIr,
  buildProcPlantInstancedParts,
  buildProcPlantInstancePrototype,
  createProcPlantClumpStagePlan,
  buildProcPlantClumpStageParts,
  materializeProcPlantInstancedParts,
  buildProcPlantTemplateFromGraph,
  buildProcPlantTemplate,
  compileProcPlantClumpStageLods,
  compileProcPlantLods,
  compileProcPlantLodsFromTemplate,
  procPlantEcologyProfiles,
  scoreProcPlantForEcology,
  resolveProcPlantCommunity,
  applyProcPlantForceFields,
  estimateProcPlantLods,
  buildProcPlantRuntimePackage,
} from "./procplants";
export * from "./procplant-chain-tube-overrides";
export * from "./procplant-spline-crown";
export * from "./procplant-production-dag";
export * from "./procplant-weber-penn-organ-placement";
export * from "./plant-readiness";
export * from "./plant-variants";
export * from "./procplant-organ-variants";
export * from "./procplant-visibility-clusters";
export * from "./procplant-webgpu-visibility";
export * from "./procplant-surface-partition";
export * from "./biome-mix";
export * from "./tellus-export";
