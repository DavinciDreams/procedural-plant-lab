import * as THREE from "three";
import {
  buildSpaceColonizedProcPlantStageParts,
  buildBranchModuleProcPlantStageParts,
  addGuidedVineProcPlantFoliage,
  addGuidedVineProcPlantReproductiveOrgans,
  buildGuidedVineProcPlantArchitectureGraph,
  buildProcPlantGraphIr,
  buildProcPlantClumpStageParts,
  buildProcPlantTemplate,
  buildProcPlantTemplateFromGraph,
  buildWeberPennProcPlantStageParts,
  compileProcPlantClumpStageLods,
  compileProcPlantLods,
  compileProcPlantLodsFromTemplate,
  createProcPlantClumpStagePlan,
  defaultPlantEnvironment,
  materializeProcPlantParts,
  materializeBranchModuleProcPlantParts,
  materializeProcPlantInstancedParts,
  type ProcPlantClumpStagePlan,
  type ProcPlantCompiledLod,
  type ProcPlantBranchModuleStageParts,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantGraph,
  type ProcPlantInstancedParts,
  type ProcPlantOrgan,
  type ProcPlantStats,
  type ProcPlantStemNode,
  type ProcPlantTemplate,
  type ProcPlantWeberPennStageParts,
} from "./procplants";
import { createProcPlantAuthoringGraph } from "./procplant-authoring-graph";
import {
  cloneProcPlantFreeformCrown,
  type ProcPlantFreeformCrown,
} from "./procplant-space-colonization";
import {
  deriveProcPlantGeneratorNodeSeed,
  evaluateProcPlantGeneratorCurve,
  summarizeProcPlantGeneratorGraph,
  validateProcPlantGeneratorGraph,
  type ProcPlantGeneratorGraph,
  type ProcPlantGeneratorNode,
  type ProcPlantGeneratorStage,
  type ProcPlantParentScope,
} from "./procplant-generator-graph";

export const PROCPLANT_PRODUCTION_DAG_RESULT_VERSION = 1 as const;
export const PROCPLANT_PRODUCTION_DAG_MAX_WORK = 1_000_000 as const;
export const PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_STEMS = 100_000 as const;
export const PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_ORGANS = 100_000 as const;

interface ArtifactBase<TKind extends string, TStage extends ProcPlantGeneratorStage> {
  kind: TKind;
  stage: TStage;
  nodeId: string;
  seed: number;
  lineage: readonly string[];
  hash: string;
}

export interface ProcPlantSourceStageArtifact extends ArtifactBase<"source", "source"> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
}

export interface ProcPlantGraphStageArtifact extends ArtifactBase<
  "graph",
  "architecture" | "branching" | "foliage" | "reproductive" | "deformation"
> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  graph: ProcPlantGraph;
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantSpaceColonizationPlanStageArtifact extends ArtifactBase<"space-colonization-plan", "architecture"> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantWeberPennPlanStageArtifact extends ArtifactBase<"weber-penn-plan", "architecture"> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantBranchModulePlanStageArtifact extends ArtifactBase<"branch-module-plan", "architecture"> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantSpaceColonizationPartsStageArtifact extends ArtifactBase<
  "space-colonization-parts",
  "branching" | "foliage" | "deformation"
> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  parts: ProcPlantInstancedParts;
  growthSeed: number;
  foliageSeed: number | null;
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantWeberPennPartsStageArtifact extends ArtifactBase<
  "weber-penn-parts",
  "branching" | "foliage" | "deformation"
> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  parts: ProcPlantWeberPennStageParts;
  structureSeed: number;
  foliageSeed: number | null;
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantBranchModulePartsStageArtifact extends ArtifactBase<
  "branch-module-parts",
  "branching" | "foliage" | "deformation"
> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  parts: ProcPlantBranchModuleStageParts;
  structureSeed: number;
  foliageSeed: number | null;
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantMaterialStageArtifact extends ArtifactBase<"material", "material"> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  graph: ProcPlantGraph;
  template: ProcPlantTemplate;
  stats: ProcPlantStats;
}

export interface ProcPlantLodStageArtifact extends ArtifactBase<"lod", "lod"> {
  genome: ProcPlantGenome;
  graph: ProcPlantGraph;
  lods: ProcPlantCompiledLod[];
  stats: ProcPlantStats;
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantOutputStageArtifact extends ArtifactBase<"output", "output"> {
  build: { template: ProcPlantTemplate; graph: ProcPlantGraph; stats: ProcPlantStats };
  lods: ProcPlantCompiledLod[];
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantClumpTransformStageArtifact extends ArtifactBase<"clump-transforms", "architecture"> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  plan: ProcPlantClumpStagePlan;
  runtime: { windFlex: number; phototropism: number };
}

export interface ProcPlantClumpPartsStageArtifact extends ArtifactBase<"clump-parts", "foliage"> {
  genome: ProcPlantGenome;
  environment: ProcPlantEnvironment;
  plan: ProcPlantClumpStagePlan;
  parts: ProcPlantInstancedParts;
  runtime: { windFlex: number; phototropism: number };
}

export type ProcPlantProductionStageArtifact =
  | ProcPlantSourceStageArtifact
  | ProcPlantGraphStageArtifact
  | ProcPlantSpaceColonizationPlanStageArtifact
  | ProcPlantSpaceColonizationPartsStageArtifact
  | ProcPlantBranchModulePlanStageArtifact
  | ProcPlantBranchModulePartsStageArtifact
  | ProcPlantWeberPennPlanStageArtifact
  | ProcPlantWeberPennPartsStageArtifact
  | ProcPlantMaterialStageArtifact
  | ProcPlantLodStageArtifact
  | ProcPlantOutputStageArtifact
  | ProcPlantClumpTransformStageArtifact
  | ProcPlantClumpPartsStageArtifact;

type WithoutArtifactHash<T> = T extends { hash: string } ? Omit<T, "hash"> : never;
type ProcPlantUnhashedStageArtifact = WithoutArtifactHash<ProcPlantProductionStageArtifact>;

export interface ProcPlantProductionDagRecord {
  nodeId: string;
  stage: ProcPlantGeneratorStage;
  seed: number;
  status: "executed" | "disabled" | "legacy";
  dependencyIds: string[];
  artifactKind: ProcPlantProductionStageArtifact["kind"] | null;
  artifactHash: string | null;
  work: number;
}

export interface ProcPlantProductionDagResult {
  version: typeof PROCPLANT_PRODUCTION_DAG_RESULT_VERSION;
  path: "legacy-canonical" | "typed-artifacts";
  graph: ProcPlantGeneratorGraph;
  previewHash: string;
  artifacts: Record<string, ProcPlantProductionStageArtifact>;
  records: ProcPlantProductionDagRecord[];
  build: { template: ProcPlantTemplate; graph: ProcPlantGraph; stats: ProcPlantStats };
  lods: ProcPlantCompiledLod[];
  work: number;
}

export interface ProcPlantProductionDagOptions {
  canonicalSeed?: number;
  maxWork?: number;
}

export class ProcPlantProductionDagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcPlantProductionDagError";
  }
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
};

const stableJson = (value: unknown) => JSON.stringify(stableValue(value));

const fnv1a = (value: string, seed = 0x811c9dc5) => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const hashValue = (value: unknown) => fnv1a(stableJson(value)).toString(16).padStart(8, "0");

const randomFromSeed = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const cloneGenomeForMaterial = (genome: ProcPlantGenome, node: ProcPlantGeneratorNode): ProcPlantGenome => ({
  ...genome,
  leaf: {
    ...genome.leaf,
    colorA: Number(node.parameters?.leafColorA ?? genome.leaf.colorA),
    colorB: Number(node.parameters?.leafColorB ?? genome.leaf.colorB),
  },
});

const cloneGraph = (graph: ProcPlantGraph): ProcPlantGraph => buildProcPlantGraphIr(
  graph.stems.map((stem, index) => ({
    ...stem,
    index,
    position: stem.position.clone(),
    direction: stem.direction.clone(),
  })),
  graph.segments.map(([start, end]) => [start, end]),
  graph.organs.map((organ) => ({
    ...organ,
    position: organ.position.clone(),
    direction: organ.direction.clone(),
    right: organ.right.clone(),
  })),
);

const graphStructureSignature = (graph: ProcPlantGraph) => hashValue({
  stems: graph.stems.map((stem) => ({
    position: stem.position.toArray(), direction: stem.direction.toArray(),
    radius: stem.radius, depth: stem.depth, t: stem.t,
  })),
  segments: graph.segments,
});

const organSignature = (organ: ProcPlantOrgan) => stableJson({
  kind: organ.kind, position: organ.position.toArray(), direction: organ.direction.toArray(),
  right: organ.right.toArray(), scale: organ.scale, t: organ.t,
  bend: organ.bend, color: organ.color, secondaryColor: organ.secondaryColor,
});

const graphHash = (graph: ProcPlantGraph) => hashValue({
  structure: graphStructureSignature(graph),
  organs: graph.organs.map(organSignature),
});

const templateHash = (template: ProcPlantTemplate) => {
  let hash = 0x811c9dc5;
  for (const array of [template.pos, template.nrm, template.uv0, template.col, template.tintable, template.sway, template.idx]) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const graphSemantics = (graph: ProcPlantGeneratorGraph) => ({
  ...graph,
  nodes: [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id)).map((node) => ({
    ...node,
    dependsOn: [...node.dependsOn].sort(),
  })),
});

const sameGraphSemantics = (left: ProcPlantGeneratorGraph, right: ProcPlantGeneratorGraph) =>
  stableJson(graphSemantics(left)) === stableJson(graphSemantics(right));

const productionBackend = (genome: ProcPlantGenome) => genome.weberPenn
  ? "weber-penn"
  : genome.branchModules
    ? "branch-module-graph"
    : genome.spaceColonization
      ? "space-colonization"
      : genome.vine
        ? "guided-vine"
        : "procplant-graph";

type ProcPlantHerbaceousBackend = "grass" | "fern" | "groundcover" | "moss";

type ProcPlantBespokeBroadPatch = "maidenhairFernPatch" | "woodlandVioletCarpet" | "trilliumPatch" | "horsetailColony";

const BESPOKE_BROAD_PATCH_FOLIAGE_PER_CLUSTER: Readonly<Record<ProcPlantBespokeBroadPatch, number>> = Object.freeze({
  maidenhairFernPatch: 7,
  woodlandVioletCarpet: 3,
  trilliumPatch: 3,
  horsetailColony: 15,
});

const authoredGenomeId = (genome: Pick<ProcPlantGenome, "id">) => genome.id.split("@", 1)[0]!;

const bespokeBroadPatchFor = (genome: ProcPlantGenome): ProcPlantBespokeBroadPatch | null => {
  const id = authoredGenomeId(genome);
  if (!genome.groundcover || !Object.prototype.hasOwnProperty.call(BESPOKE_BROAD_PATCH_FOLIAGE_PER_CLUSTER, id)) return null;
  if (genome.weberPenn || genome.branchModules || genome.spaceColonization || genome.vine || genome.moss || genome.clump) return null;
  if ((genome.accessoryOrgans?.length ?? 0) > 0) return null;
  return id as ProcPlantBespokeBroadPatch;
};

const scaledBespokeBroadPatchCount = (
  baseline: number,
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
  minimum: number,
  maximum: number,
) => {
  const canonicalCount = Math.max(1, canonicalNode.count ?? 1);
  return Math.max(minimum, Math.min(maximum, Math.round(baseline * Math.max(1, node.count ?? 1) / canonicalCount)));
};

/**
 * The typed herbaceous path is intentionally narrower than the legacy graph.
 * Clumps transform independently generated whole shoots after graph generation,
 * guided moss consumes a support path, and four broad patches have bespoke
 * structure/organ coupling. Those forms need their own staged contracts.
 */
const herbaceousBackendFor = (genome: ProcPlantGenome): ProcPlantHerbaceousBackend | null => {
  if (genome.clump || genome.vine || genome.weberPenn || genome.branchModules || genome.spaceColonization) return null;
  if ((genome.accessoryOrgans?.length ?? 0) > 0) return null;
  if ((genome.fern || genome.moss) && genome.flower) return null;
  if (genome.groundcover) {
    return bespokeBroadPatchFor(genome) ? null : "groundcover";
  }
  if (genome.moss) return "moss";
  if (genome.grass && genome.habit === "grass") return "grass";
  if (genome.fern && genome.habit === "fern") return "fern";
  return null;
};

const assertSupportedBackend = (genome: ProcPlantGenome) => {
  const herbaceousBackend = herbaceousBackendFor(genome);
  const bespokeBroadPatch = bespokeBroadPatchFor(genome);
  const unsupported = [
    genome.grass && herbaceousBackend !== "grass" && "grass-specialization",
    genome.fern && herbaceousBackend !== "fern" && herbaceousBackend !== "groundcover" && !bespokeBroadPatch && "fern-specialization",
    genome.groundcover && herbaceousBackend !== "groundcover" && !bespokeBroadPatch && "groundcover-specialization",
    genome.moss && !genome.vine && herbaceousBackend !== "moss" && "moss-specialization",
    genome.clump && "clump-specialization",
  ].filter(Boolean);
  if (unsupported.length > 0) {
    throw new ProcPlantProductionDagError(`typed production DAG does not support backend features: ${unsupported.join(", ")}`);
  }
  if (genome.spaceColonization && (genome.flower || (genome.accessoryOrgans?.length ?? 0) > 0)) {
    throw new ProcPlantProductionDagError("typed space-colonization DAG does not support reproductive organs");
  }
  if (genome.branchModules && (genome.flower || (genome.accessoryOrgans?.length ?? 0) > 0)) {
    throw new ProcPlantProductionDagError("typed branch-module DAG does not support reproductive organs");
  }
  if (genome.weberPenn && (genome.flower || (genome.accessoryOrgans?.length ?? 0) > 0)) {
    throw new ProcPlantProductionDagError("typed Weber-Penn DAG does not support reproductive or accessory organs");
  }
};

const ALLOWED_ARTIFACT_STAGES: Record<ProcPlantGeneratorStage, readonly ProcPlantGeneratorStage[]> = {
  source: [],
  architecture: ["source"],
  branching: ["architecture", "branching"],
  foliage: ["architecture", "branching"],
  reproductive: ["architecture", "branching", "foliage", "reproductive"],
  deformation: ["architecture", "branching", "foliage", "reproductive", "deformation"],
  material: ["architecture", "branching", "foliage", "reproductive", "deformation"],
  lod: ["material", "deformation"],
  output: ["lod"],
};

const PARAMETER_KEYS: Record<ProcPlantGeneratorStage, readonly string[]> = {
  source: ["backend", "genomeId", "habit"],
  architecture: ["apicalDominance", "phyllotaxisAngle", "freeformCrown"],
  branching: ["angle", "backend"],
  foliage: ["foliageKind", "phyllotaxy", "shape"],
  reproductive: ["accessories", "flower"],
  deformation: ["phototropism", "windFlex"],
  material: ["leafColorA", "leafColorB"],
  lod: ["levels"],
  output: ["generatorContractRevision"],
};

const validateProductionNodeParameters = (node: ProcPlantGeneratorNode, genome: ProcPlantGenome) => {
  const parameters = node.parameters ?? {};
  const allowed = new Set(PARAMETER_KEYS[node.stage]);
  const unknown = Object.keys(parameters).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new ProcPlantProductionDagError(`${node.id}.parameters contains unsupported keys: ${unknown.sort().join(", ")}`);
  const finite = (value: unknown, label: string, minimum: number, maximum: number) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw new ProcPlantProductionDagError(`${label} must be finite in [${minimum}, ${maximum}]`);
    }
  };
  const placementModes: Partial<Record<ProcPlantGeneratorStage, readonly string[]>> = {
    source: ["origin"], architecture: ["origin", "nodes"], branching: ["nodes", "tips"],
    foliage: ["nodes", "tips"], reproductive: ["nodes", "tips"], lod: ["volume"],
  };
  if (node.placement && !(placementModes[node.stage] ?? []).includes(node.placement.mode)) {
    throw new ProcPlantProductionDagError(`${node.id}.placement.mode ${node.placement.mode} is unsupported for ${node.stage} artifacts`);
  }
  if (node.stage === "source") {
    if (parameters.genomeId !== genome.id || parameters.habit !== genome.habit) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters must preserve source genome identity`);
    }
    const backend = productionBackend(genome);
    if (parameters.backend !== backend || !["procplant-graph", "space-colonization", "branch-module-graph", "guided-vine", "weber-penn"].includes(backend)) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.backend ${String(parameters.backend)} is unsupported by the typed production backend`);
    }
  } else if (node.stage === "architecture") {
    finite(parameters.apicalDominance, `${node.id}.parameters.apicalDominance`, 0, 1);
    finite(parameters.phyllotaxisAngle, `${node.id}.parameters.phyllotaxisAngle`, -Math.PI * 2, Math.PI * 2);
    if (parameters.freeformCrown !== undefined) {
      if (!genome.spaceColonization) {
        throw new ProcPlantProductionDagError(`${node.id}.parameters.freeformCrown requires the space-colonization backend`);
      }
      try {
        cloneProcPlantFreeformCrown(parameters.freeformCrown as ProcPlantFreeformCrown);
      } catch (error) {
        throw new ProcPlantProductionDagError(`${node.id}.parameters.freeformCrown is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if ((node.count ?? 0) < 1 || (node.count ?? 0) > (genome.spaceColonization ? 100_000 : PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_STEMS)) {
      throw new ProcPlantProductionDagError(`${node.id}.count is outside the supported architecture range`);
    }
  } else if (node.stage === "branching") {
    const backend = productionBackend(genome);
    if (parameters.backend !== backend || !["procplant-graph", "space-colonization", "branch-module-graph", "guided-vine", "weber-penn"].includes(backend)) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.backend ${String(parameters.backend)} is unsupported by the typed production backend`);
    }
    const angle = parameters.angle;
    if (!angle || typeof angle !== "object" || Array.isArray(angle)) throw new ProcPlantProductionDagError(`${node.id}.parameters.angle must be an object`);
    const record = angle as Record<string, unknown>;
    if (stableJson(Object.keys(record).sort()) !== stableJson(["depthDecay", "mean", "spread"])) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.angle must contain depthDecay, mean, and spread only`);
    }
    finite(record.mean, `${node.id}.parameters.angle.mean`, 0, Math.PI);
    finite(record.spread, `${node.id}.parameters.angle.spread`, 0, Math.PI);
    finite(record.depthDecay, `${node.id}.parameters.angle.depthDecay`, 0, 1);
    if (genome.spaceColonization && ((node.count ?? 0) < 2 || (node.count ?? 0) > 100_000)) {
      throw new ProcPlantProductionDagError(`${node.id}.count must be in 2..100000 for space colonization`);
    }
    if (genome.branchModules && ((node.count ?? 0) < 1 || (node.count ?? 0) > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_STEMS)) {
      throw new ProcPlantProductionDagError(`${node.id}.count is outside the supported branch-module range`);
    }
  } else if (node.stage === "foliage") {
    if (!["leaf", "grassBlade", "coniferSpray", "palmFrond", "mossTuft"].includes(String(parameters.foliageKind))) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.foliageKind is unsupported by the typed graph backend`);
    }
    if (!["lanceolate", "ovate", "cordate", "palmate", "spatulate", "fan", "linear", "round", "frond", "blade"].includes(String(parameters.shape))) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.shape is unsupported by the typed graph backend`);
    }
    if (!["spiral", "alternate", "opposite", "decussate", "whorled"].includes(String(parameters.phyllotaxy))) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.phyllotaxy is unsupported by the typed graph backend`);
    }
    if (genome.spaceColonization && ((node.count ?? 0) < 1 || (node.count ?? 0) > 6)) {
      throw new ProcPlantProductionDagError(`${node.id}.count must be in 1..6 for space-colonization terminal foliage`);
    }
  } else if (node.stage === "reproductive") {
    if (typeof parameters.flower !== "boolean" || !Array.isArray(parameters.accessories)) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters must define boolean flower and accessory array values`);
    }
    if (parameters.accessories.some((kind) => !["fruit", "berry", "cone", "thorn", "aerialRoot"].includes(String(kind)))) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.accessories contains an unsupported organ kind`);
    }
  } else if (node.stage === "deformation") {
    finite(parameters.windFlex, `${node.id}.parameters.windFlex`, 0, 2);
    finite(parameters.phototropism, `${node.id}.parameters.phototropism`, 0, 1);
  } else if (node.stage === "material") {
    for (const key of ["leafColorA", "leafColorB"] as const) {
      const value = parameters[key];
      if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 0xffffff) {
        throw new ProcPlantProductionDagError(`${node.id}.parameters.${key} must be a 24-bit integer color`);
      }
    }
  } else if (node.stage === "output") {
    if (!Number.isInteger(parameters.generatorContractRevision) || Number(parameters.generatorContractRevision) < 1) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.generatorContractRevision must be a positive integer`);
    }
  }
};

const validateSpaceColonizationNodeSemantics = (
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode | undefined,
) => {
  if (!canonicalNode || canonicalNode.id !== node.id) {
    throw new ProcPlantProductionDagError(`${node.id} is not a canonical space-colonization stage; additional specialized nodes are unsupported`);
  }
  if (node.stage === "reproductive" && node.enabled) {
    throw new ProcPlantProductionDagError(`${node.id} reproductive execution is unsupported for space colonization`);
  }
  if (node.stage === "architecture" && node.seedOverride !== canonicalNode.seedOverride) {
    throw new ProcPlantProductionDagError(`${node.id} has no stochastic architecture operation; seed overrides are unsupported`);
  }
  if (["architecture", "branching", "foliage"].includes(node.stage)) {
    if (stableJson(node.placement) !== stableJson(canonicalNode.placement)) {
      throw new ProcPlantProductionDagError(`${node.id}.placement cannot be projected into the space-colonization backend`);
    }
    if (node.parentScope?.maxDepth !== undefined) {
      throw new ProcPlantProductionDagError(`${node.id}.parentScope.maxDepth cannot be projected into the space-colonization backend`);
    }
  }
  if ((node.stage === "architecture" || node.stage === "branching") && stableJson(node.curve) !== stableJson(canonicalNode.curve)) {
    throw new ProcPlantProductionDagError(`${node.id}.curve cannot be projected into the space-colonization backend`);
  }
  if (node.stage === "architecture") {
    const actual = node.parameters ?? {};
    const expected = canonicalNode.parameters ?? {};
    if (actual.apicalDominance !== expected.apicalDominance) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.apicalDominance cannot be projected into the space-colonization backend`);
    }
  }
  if (node.stage === "branching" && stableJson(node.parameters) !== stableJson(canonicalNode.parameters)) {
    throw new ProcPlantProductionDagError(`${node.id}.parameters cannot be projected into the space-colonization backend`);
  }
};

const validateBranchModuleNodeSemantics = (
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode | undefined,
) => {
  if (!canonicalNode || canonicalNode.id !== node.id) {
    throw new ProcPlantProductionDagError(`${node.id} is not a canonical branch-module stage; additional specialized nodes are unsupported`);
  }
  if (node.enabled !== canonicalNode.enabled) {
    throw new ProcPlantProductionDagError(`${node.id}.enabled cannot be projected into the branch-module backend`);
  }
  if (stableJson([...node.dependsOn].sort()) !== stableJson([...canonicalNode.dependsOn].sort())) {
    throw new ProcPlantProductionDagError(`${node.id}.dependsOn cannot be rewired for the branch-module backend`);
  }
  if (node.stage !== "branching" && node.stage !== "foliage" && node.seedOverride !== canonicalNode.seedOverride) {
    throw new ProcPlantProductionDagError(`${node.id} has no independent stochastic operation; seed overrides are unsupported`);
  }
  if (node.stage === "reproductive" && node.enabled) {
    throw new ProcPlantProductionDagError(`${node.id} reproductive execution is unsupported for branch modules`);
  }

  if (["architecture", "branching", "foliage"].includes(node.stage)
    && stableJson(node.placement) !== stableJson(canonicalNode.placement)) {
    throw new ProcPlantProductionDagError(`${node.id}.placement cannot be projected into the branch-module backend`);
  }

  if (node.stage === "branching") {
    const actualScope = node.parentScope;
    const expectedScope = canonicalNode.parentScope;
    if (!actualScope || !expectedScope || actualScope.mode !== "stages" || expectedScope.mode !== "stages"
      || stableJson([...actualScope.stages].sort()) !== stableJson([...expectedScope.stages].sort())) {
      throw new ProcPlantProductionDagError(`${node.id}.parentScope cannot be rewired for the branch-module backend`);
    }
    if (actualScope.maxDepth !== undefined
      && (!Number.isInteger(actualScope.maxDepth) || actualScope.maxDepth < 1 || actualScope.maxDepth > 6)) {
      throw new ProcPlantProductionDagError(`${node.id}.parentScope.maxDepth must be an integer in 1..6 for branch modules`);
    }
  } else if (stableJson(node.parentScope) !== stableJson(canonicalNode.parentScope)) {
    throw new ProcPlantProductionDagError(`${node.id}.parentScope cannot be projected into the branch-module backend`);
  }

  if (node.stage !== "architecture" && node.stage !== "foliage"
    && stableJson(node.curve) !== stableJson(canonicalNode.curve)) {
    throw new ProcPlantProductionDagError(`${node.id}.curve cannot be projected into the branch-module backend`);
  }

  if (node.stage !== "architecture" && node.stage !== "branching"
    && stableJson(node.count) !== stableJson(canonicalNode.count)) {
    throw new ProcPlantProductionDagError(`${node.id}.count cannot be projected into the branch-module backend`);
  }

  if (node.stage === "foliage") {
    const actual = node.parameters ?? {};
    const expected = canonicalNode.parameters ?? {};
    if (actual.foliageKind !== expected.foliageKind || actual.phyllotaxy !== expected.phyllotaxy) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters only supports branch-module leaf shape edits`);
    }
  } else if (node.stage !== "material" && node.stage !== "deformation" && node.stage !== "lod"
    && stableJson(node.parameters) !== stableJson(canonicalNode.parameters)) {
    throw new ProcPlantProductionDagError(`${node.id}.parameters cannot be projected into the branch-module backend`);
  }
};

const validateGuidedVineGraphSemantics = (
  graph: ProcPlantGeneratorGraph,
  canonical: ProcPlantGeneratorGraph,
) => {
  const canonicalById = new Map(canonical.nodes.map((node) => [node.id, node]));
  if (graph.nodes.length !== canonical.nodes.length || graph.nodes.some((node) => !canonicalById.has(node.id))) {
    throw new ProcPlantProductionDagError("guided-vine adapter requires the canonical nine-stage node set");
  }
  const exact = (left: unknown, right: unknown) => stableJson(left) === stableJson(right);
  for (const node of graph.nodes) {
    const expected = canonicalById.get(node.id)!;
    if (node.stage !== expected.stage || node.enabled !== expected.enabled) {
      throw new ProcPlantProductionDagError(`${node.id} guided-vine stage/enabled state cannot be projected`);
    }
    if (!exact([...node.dependsOn].sort(), [...expected.dependsOn].sort())) {
      throw new ProcPlantProductionDagError(`${node.id} guided-vine dependency rewire cannot be projected`);
    }
    if (!exact(node.placement, expected.placement)) {
      throw new ProcPlantProductionDagError(`${node.id} guided-vine placement cannot be projected`);
    }
    if (!exact(node.parentScope, expected.parentScope)) {
      throw new ProcPlantProductionDagError(`${node.id} guided-vine parent scope cannot be projected`);
    }
    if (node.seedOverride !== undefined && (!node.enabled || (node.stage !== "foliage" && node.stage !== "reproductive"))) {
      throw new ProcPlantProductionDagError(`${node.id} has no independently seeded guided-vine operation`);
    }
    if (node.stage === "architecture") {
      if (!Number.isInteger(node.count) || Number(node.count) < 2 || Number(node.count) > 96) {
        throw new ProcPlantProductionDagError(`${node.id}.count must be an integer in 2..96`);
      }
      if (!exact(node.curve, expected.curve) || !exact(node.parameters, expected.parameters)) {
        throw new ProcPlantProductionDagError(
          `${node.id} static guide/support and collision inputs are immutable in the guided-vine adapter`,
        );
      }
    } else if (node.stage === "foliage") {
      if (!Number.isInteger(node.count) || Number(node.count) < 0 || Number(node.count) > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_ORGANS) {
        throw new ProcPlantProductionDagError(`${node.id}.count must be an integer in 0..${PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_ORGANS}`);
      }
      if (node.parameters?.foliageKind !== expected.parameters?.foliageKind) {
        throw new ProcPlantProductionDagError(`${node.id}.parameters.foliageKind is immutable for the guided-vine backend`);
      }
    } else if (node.stage === "reproductive") {
      if (!Number.isInteger(node.count) || Number(node.count) < 0 || Number(node.count) > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_ORGANS) {
        throw new ProcPlantProductionDagError(`${node.id}.count must be an integer in 0..${PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_ORGANS}`);
      }
      if (!exact(node.curve, expected.curve) || !exact(node.parameters, expected.parameters)) {
        throw new ProcPlantProductionDagError(`${node.id} guided-vine reproductive gene kinds are immutable`);
      }
    } else if (node.stage === "deformation" || node.stage === "material" || node.stage === "lod") {
      if (!exact(node.count, expected.count) || !exact(node.curve, expected.curve)) {
        throw new ProcPlantProductionDagError(`${node.id} guided-vine stage count/curve cannot be projected`);
      }
    } else if (!exact(node.count, expected.count) || !exact(node.curve, expected.curve) || !exact(node.parameters, expected.parameters)) {
      throw new ProcPlantProductionDagError(`${node.id} guided-vine stage controls cannot be projected`);
    }
  }
};

const validateHerbaceousNodeSemantics = (
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
  genome: ProcPlantGenome,
  backend: ProcPlantHerbaceousBackend,
) => {
  const unchanged = (key: keyof ProcPlantGeneratorNode) => stableJson(node[key]) === stableJson(canonicalNode[key]);
  if (node.stage === "architecture") {
    if (!unchanged("curve") || !unchanged("placement")) {
      throw new ProcPlantProductionDagError(`${node.id} edited architecture curve/placement is unsupported by the ${backend} adapter`);
    }
    if ((backend === "grass" || backend === "fern") && (!unchanged("count") || !unchanged("seedOverride"))) {
      throw new ProcPlantProductionDagError(`${node.id} architecture count/seed is deterministic for the ${backend} adapter`);
    }
    const parameters = node.parameters ?? {};
    if (parameters.apicalDominance !== genome.apicalDominance || parameters.freeformCrown !== undefined) {
      throw new ProcPlantProductionDagError(`${node.id} apical/freeform architecture semantics are unsupported by the ${backend} adapter`);
    }
  } else if (node.stage === "branching") {
    if (!["count", "curve", "placement", "parameters", "seedOverride"].every((key) => unchanged(key as keyof ProcPlantGeneratorNode))) {
      throw new ProcPlantProductionDagError(`${node.id} edited branch generation is unsupported by the ${backend} adapter`);
    }
  } else if (node.stage === "foliage") {
    const expectedKind = backend === "grass" ? "grassBlade" : backend === "fern" ? "palmFrond" : backend === "moss" ? "mossTuft" : "leaf";
    if (node.parameters?.foliageKind !== expectedKind) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.foliageKind must remain ${expectedKind} for the ${backend} adapter`);
    }
    if (node.parameters?.phyllotaxy !== (genome.phyllotaxy?.mode ?? "spiral")) {
      throw new ProcPlantProductionDagError(`${node.id} edited phyllotaxy mode is unsupported by the ${backend} adapter`);
    }
    if (backend !== "groundcover" && node.parameters?.shape !== genome.leaf.shape) {
      throw new ProcPlantProductionDagError(`${node.id} edited foliage shape is unsupported by the ${backend} instance geometry`);
    }
    if (!unchanged("placement")) {
      throw new ProcPlantProductionDagError(`${node.id} edited foliage placement is unsupported by the ${backend} adapter`);
    }
  } else if (node.stage === "reproductive" && !unchanged("placement")) {
    throw new ProcPlantProductionDagError(`${node.id} edited reproductive placement is unsupported by the ${backend} adapter`);
  }
};

const validateWeberPennNodeSemantics = (
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode | undefined,
) => {
  if (!canonicalNode || canonicalNode.id !== node.id || canonicalNode.stage !== node.stage) {
    throw new ProcPlantProductionDagError(`${node.id} is not a canonical Weber-Penn stage; additional specialized nodes are unsupported`);
  }
  if (stableJson([...node.dependsOn].sort()) !== stableJson([...canonicalNode.dependsOn].sort())) {
    throw new ProcPlantProductionDagError(`${node.id}.dependsOn cannot be rewired in the Weber-Penn backend`);
  }
  if (node.enabled !== canonicalNode.enabled) {
    throw new ProcPlantProductionDagError(`${node.id}.enabled cannot be projected into the Weber-Penn backend`);
  }
  if (stableJson(node.placement) !== stableJson(canonicalNode.placement)) {
    throw new ProcPlantProductionDagError(`${node.id}.placement cannot be projected into the Weber-Penn backend`);
  }
  if (node.stage === "branching") {
    const actualScope = node.parentScope;
    const expectedScope = canonicalNode.parentScope;
    if (actualScope?.mode !== "stages" || expectedScope?.mode !== "stages" ||
        stableJson(actualScope.stages) !== stableJson(expectedScope.stages)) {
      throw new ProcPlantProductionDagError(`${node.id}.parentScope cannot be projected into the Weber-Penn backend`);
    }
    if (actualScope.maxDepth !== undefined && (!Number.isInteger(actualScope.maxDepth) || actualScope.maxDepth < 0 || actualScope.maxDepth > 3)) {
      throw new ProcPlantProductionDagError(`${node.id}.parentScope.maxDepth must be an integer in 0..3 for Weber-Penn`);
    }
  } else if (stableJson(node.parentScope) !== stableJson(canonicalNode.parentScope)) {
    throw new ProcPlantProductionDagError(`${node.id}.parentScope cannot be projected into the Weber-Penn backend`);
  }
  if (stableJson(node.curve) !== stableJson(canonicalNode.curve)) {
    throw new ProcPlantProductionDagError(`${node.id}.curve cannot be projected into the Weber-Penn backend`);
  }
  if (node.seedOverride !== canonicalNode.seedOverride && node.stage !== "branching" && node.stage !== "foliage") {
    throw new ProcPlantProductionDagError(`${node.id} has no independent Weber-Penn stochastic stage; seed overrides are unsupported`);
  }
  if (node.stage === "branching") {
    if (!Number.isInteger(node.count) || node.count! < 1 || node.count! > 2_000) {
      throw new ProcPlantProductionDagError(`${node.id}.count must be an integer in 1..2000 for Weber-Penn maxStems`);
    }
  } else if (node.stage === "foliage") {
    if (!Number.isInteger(node.count) || node.count! < 1 || node.count! > 50_000) {
      throw new ProcPlantProductionDagError(`${node.id}.count must be an integer in 1..50000 for Weber-Penn maxLeaves`);
    }
  } else if (node.count !== canonicalNode.count) {
    throw new ProcPlantProductionDagError(`${node.id}.count cannot be projected into the Weber-Penn backend`);
  }
  if (!["deformation", "material", "lod"].includes(node.stage) &&
      stableJson(node.parameters) !== stableJson(canonicalNode.parameters)) {
    throw new ProcPlantProductionDagError(`${node.id}.parameters cannot be projected into the Weber-Penn backend`);
  }
};

const validateBespokeBroadPatchNode = (
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
  genome: ProcPlantGenome,
  patch: ProcPlantBespokeBroadPatch,
) => {
  const unchanged = (key: keyof ProcPlantGeneratorNode) => stableJson(node[key]) === stableJson(canonicalNode[key]);
  if (!unchanged("dependsOn") || !unchanged("placement") || !unchanged("parentScope")) {
    throw new ProcPlantProductionDagError(`${node.id} edited dependency/placement/parent-scope semantics are unsupported by the ${patch} adapter`);
  }
  if (node.stage === "architecture") {
    const projected = scaledBespokeBroadPatchCount(genome.groundcover!.clusters, node, canonicalNode, 0, 100_000);
    if (!node.enabled || !Number.isInteger(node.count) || Number(node.count) < 1 || projected < 3 || projected > 24) {
      throw new ProcPlantProductionDagError(`${node.id}.count must project to 3..24 enabled broad-patch clusters`);
    }
    if (!unchanged("curve") || !unchanged("parameters")) {
      throw new ProcPlantProductionDagError(`${node.id} edited curve/architecture parameters are unsupported by the ${patch} adapter`);
    }
    return;
  }
  if (node.stage === "branching") {
    if (!["enabled", "count", "curve", "parameters", "seedOverride"].every((key) => unchanged(key as keyof ProcPlantGeneratorNode))) {
      throw new ProcPlantProductionDagError(`${node.id} edited branching is unsupported because ${patch} owns support topology in architecture`);
    }
    return;
  }
  if (node.stage === "foliage") {
    const baseline = genome.groundcover!.clusters * BESPOKE_BROAD_PATCH_FOLIAGE_PER_CLUSTER[patch];
    const projected = scaledBespokeBroadPatchCount(baseline, node, canonicalNode, 0, 1_000_000);
    if (!node.enabled || !Number.isInteger(node.count) || Number(node.count) < 1 || projected < 1 || projected > 100_000) {
      throw new ProcPlantProductionDagError(`${node.id}.count must project to 1..100000 enabled broad-patch foliage organs`);
    }
    if (node.parameters?.foliageKind !== "leaf" || node.parameters?.phyllotaxy !== canonicalNode.parameters?.phyllotaxy) {
      throw new ProcPlantProductionDagError(`${node.id} edited foliage kind/phyllotaxy is unsupported by the ${patch} branch-relative placement adapter`);
    }
    return;
  }
  if (node.stage === "reproductive") {
    if (!genome.flower) {
      if (!["enabled", "count", "curve", "parameters", "seedOverride"].every((key) => unchanged(key as keyof ProcPlantGeneratorNode))) {
        throw new ProcPlantProductionDagError(`${node.id} cannot enable reproductive organs for non-flowering ${patch}`);
      }
      return;
    }
    const baseline = Math.max(1, Math.round(genome.groundcover!.clusters * (genome.groundcover!.flowerRate ?? 0)));
    const projected = scaledBespokeBroadPatchCount(baseline, node, canonicalNode, 0, 1_000_000);
    if (node.enabled && (!Number.isInteger(node.count) || Number(node.count) < 1 || projected < 1 || projected > 24)) {
      throw new ProcPlantProductionDagError(`${node.id}.count must project to 1..24 broad-patch flowers when enabled`);
    }
    if (!unchanged("curve") || !unchanged("parameters")) {
      throw new ProcPlantProductionDagError(`${node.id} edited reproductive curve/organ semantics are unsupported by the ${patch} adapter`);
    }
    return;
  }
  if (!unchanged("enabled") || !unchanged("count") || !unchanged("curve") || !unchanged("seedOverride")) {
    throw new ProcPlantProductionDagError(`${node.id} edited ${node.stage} lifecycle/count/seed semantics are unsupported by the ${patch} adapter`);
  }
};

const tangentBasis = (direction: THREE.Vector3) => {
  const forward = direction.clone().normalize();
  const right = Math.abs(forward.y) > 0.92
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { forward, right, up };
};

const rotateFromAxis = (axis: THREE.Vector3, azimuth: number, elevation: number) => {
  const { forward, right, up } = tangentBasis(axis);
  const lateral = right.multiplyScalar(Math.cos(azimuth)).add(up.multiplyScalar(Math.sin(azimuth))).normalize();
  return forward.multiplyScalar(Math.cos(elevation)).add(lateral.multiplyScalar(Math.sin(elevation))).normalize();
};

const curveValue = (node: ProcPlantGeneratorNode, genome: ProcPlantGenome, t: number) =>
  node.curve ? evaluateProcPlantGeneratorCurve(node.curve, t) :
    genome.internode.base + (genome.internode.tip - genome.internode.base) * Math.pow(t, genome.internode.curve);

const scaledHerbaceousCount = (
  baseline: number,
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
) => {
  const canonicalCount = Math.max(1, canonicalNode.count ?? 1);
  return Math.max(1, Math.min(100_000, Math.round(baseline * Math.max(1, node.count ?? 1) / canonicalCount)));
};

const herbaceousRoot = (genome: ProcPlantGenome): ProcPlantStemNode => ({
  position: new THREE.Vector3(),
  direction: new THREE.Vector3(0, 1, 0),
  radius: genome.moss ? 0.0025 : genome.groundcover ? 0.004 : 0.018,
  depth: 0,
  t: 0,
  index: 0,
});

const createHerbaceousArchitectureGraph = (
  genome: ProcPlantGenome,
  environment: ProcPlantEnvironment,
  backend: ProcPlantHerbaceousBackend,
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
  seed: number,
) => {
  const root = herbaceousRoot(genome);
  if (backend === "grass" || backend === "fern") return buildProcPlantGraphIr([root], [], []);
  const random = randomFromSeed(seed);
  const geneCount = backend === "moss" ? genome.moss!.clumps : genome.groundcover!.clusters;
  const count = scaledHerbaceousCount(geneCount, node, canonicalNode);
  const radius = backend === "moss" ? genome.moss!.radius : genome.groundcover!.radius;
  const height = backend === "moss" ? genome.moss!.height : genome.groundcover!.height;
  const jitter = backend === "moss" ? THREE.MathUtils.clamp(genome.moss!.surfaceJitter ?? 0.2, 0, 1) : 1;
  const shade = 1 - THREE.MathUtils.clamp(environment.light, 0, 1);
  const stems: ProcPlantStemNode[] = [root];
  const segments: Array<[number, number]> = [];
  let previous = root;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const t = count > 1 ? ordinal / (count - 1) : 0;
    const yaw = ordinal * 2.399963229728653 + (genome.phyllotaxy?.phase ?? 0) + (random() - 0.5) * 0.34 * jitter;
    const spread = ordinal === 0 ? 0 : radius * Math.sqrt(t) * (0.84 + random() * 0.24);
    const position = new THREE.Vector3(
      Math.cos(yaw) * spread,
      backend === "moss" ? 0.004 + random() * height * jitter * 0.12 : 0.012 + random() * height * (0.06 + shade * 0.02),
      Math.sin(yaw) * spread,
    );
    const direction = position.clone().sub(previous.position);
    if (direction.lengthSq() < 1e-8) direction.set(Math.cos(yaw), backend === "moss" ? 0.04 : 0.12, Math.sin(yaw));
    direction.normalize();
    const stem: ProcPlantStemNode = {
      position,
      direction,
      radius: root.radius * THREE.MathUtils.lerp(0.9, 0.42, t),
      depth: 0,
      t,
      index: stems.length,
    };
    stems.push(stem);
    if (backend === "moss" || genome.groundcover!.runners) segments.push([previous.index, stem.index]);
    previous = stem;
  }
  return buildProcPlantGraphIr(stems, segments, []);
};

const addHerbaceousFoliage = (
  source: ProcPlantGraph,
  genome: ProcPlantGenome,
  environment: ProcPlantEnvironment,
  backend: ProcPlantHerbaceousBackend,
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
  seed: number,
) => {
  const graph = cloneGraph(source);
  const random = randomFromSeed(seed);
  const shade = 1 - THREE.MathUtils.clamp(environment.light, 0, 1);
  const heightStretch = 1 + shade * genome.lightResponse.shadeAvoidance;
  if (backend === "grass") {
    const count = scaledHerbaceousCount(genome.grass!.blades, node, canonicalNode);
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const t = count > 1 ? ordinal / (count - 1) : 0;
      const azimuth = ordinal * (genome.phyllotaxisAngle || 2.399963229728653) + (random() - 0.5) * 0.16;
      const lean = 0.36 + random() * 0.24;
      graph.organs.push({
        kind: "grassBlade",
        position: new THREE.Vector3((random() - 0.5) * 0.2, 0, (random() - 0.5) * 0.2),
        direction: rotateFromAxis(new THREE.Vector3(0, 1, 0), azimuth, lean),
        right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)),
        scale: curveValue(node, genome, t) * heightStretch * (1 - (genome.grass!.heightJitter ?? 0.2) * random()),
        t,
      });
    }
  } else if (backend === "fern") {
    const baseline = Math.max(4, Math.min(9, Math.round(genome.fern!.pinnae / 3)));
    const count = scaledHerbaceousCount(baseline, node, canonicalNode);
    const frondLength = genome.nodeCount * (genome.internode.base + genome.internode.tip) * 0.5
      * (0.4 + genome.fern!.arch * 0.16) * heightStretch;
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const yaw = ordinal * (genome.phyllotaxisAngle || 2.399963229728653) + (random() - 0.5) * 0.16;
      const frame = rotateFromAxis(new THREE.Vector3(0, 1, 0), yaw, 1.02 + genome.fern!.arch * 0.18 + random() * 0.1);
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).projectOnPlane(frame).normalize();
      graph.organs.push({
        kind: "palmFrond",
        position: new THREE.Vector3((random() - 0.5) * 0.045, 0.018 + random() * 0.018, (random() - 0.5) * 0.045),
        direction: frame,
        right,
        scale: frondLength * (0.84 + random() * 0.22),
        t: ordinal / Math.max(1, count - 1),
      });
    }
  } else {
    const candidates = graph.stems.slice(1);
    if (candidates.length < 1) throw new ProcPlantProductionDagError(`${node.id} requires herbaceous support nodes`);
    const baseline = backend === "moss"
      ? candidates.length * Math.max(1, Math.min(4, Math.round(genome.moss!.tuftsPerClump)))
      : candidates.length * Math.max(1, Math.min(5, Math.round(genome.groundcover!.leavesPerCluster)));
    const count = scaledHerbaceousCount(baseline, node, canonicalNode);
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const support = candidates[ordinal % candidates.length]!;
      const local = Math.floor(ordinal / candidates.length);
      const azimuth = ordinal * (genome.phyllotaxisAngle || 2.399963229728653) + (random() - 0.5) * 0.18;
      const direction = rotateFromAxis(
        support.direction,
        azimuth,
        backend === "moss" ? Math.PI / 2.8 : 0.86 + random() * 0.2,
      ).add(new THREE.Vector3(0, backend === "moss" ? 0.72 : 0.42 + shade * 0.12, 0)).normalize();
      let right = tangentBasis(support.direction).right.applyAxisAngle(support.direction, azimuth).projectOnPlane(direction);
      if (right.lengthSq() < 1e-8) right = tangentBasis(direction).right;
      right.normalize();
      graph.organs.push({
        kind: backend === "moss" ? "mossTuft" : "leaf",
        position: support.position.clone().addScaledVector(right, local * (backend === "moss" ? genome.moss!.height * 0.04 : genome.groundcover!.radius * 0.018)),
        direction,
        right,
        scale: backend === "moss"
          ? genome.moss!.height * (0.78 + random() * 0.3)
          : curveValue(node, genome, support.t) * (0.9 + random() * 0.22),
        t: support.t,
      });
    }
  }
  return buildProcPlantGraphIr(graph.stems, graph.segments, graph.organs);
};

const addHerbaceousReproductiveOrgans = (
  source: ProcPlantGraph,
  genome: ProcPlantGenome,
  backend: ProcPlantHerbaceousBackend,
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
  seed: number,
) => {
  const graph = cloneGraph(source);
  if (!genome.flower || !node.parameters?.flower) return graph;
  const random = randomFromSeed(seed);
  if (backend === "grass") {
    const blades = graph.organs.filter((organ) => organ.kind === "grassBlade");
    if (blades.length < 1) throw new ProcPlantProductionDagError(`${node.id} requires grass foliage input`);
    const tallest = blades.reduce((best, organ) => organ.scale > best.scale ? organ : best, blades[0]!);
    graph.organs.push({
      kind: "flower",
      position: tallest.position.clone().addScaledVector(tallest.direction, tallest.scale * 0.92),
      direction: tallest.direction.clone(),
      right: tallest.right.clone(),
      scale: 0.5 + random() * 0.1,
      t: 1,
    });
  } else if (backend === "groundcover") {
    const supports = graph.stems.slice(1);
    if (supports.length < 1) throw new ProcPlantProductionDagError(`${node.id} requires groundcover support input`);
    const baseline = Math.max(1, Math.round(supports.length * (genome.groundcover!.flowerRate ?? 0)));
    const count = scaledHerbaceousCount(baseline, node, canonicalNode);
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const support = supports[Math.floor(((ordinal + random()) / count) * supports.length)]!;
      const direction = new THREE.Vector3((random() - 0.5) * 0.08, 1, (random() - 0.5) * 0.08).normalize();
      graph.organs.push({
        kind: "flower",
        position: support.position.clone().addScaledVector(direction, genome.groundcover!.height * (0.72 + random() * 0.28)),
        direction,
        right: tangentBasis(direction).right,
        scale: 0.7 + random() * 0.2,
        t: 1,
      });
    }
  } else {
    throw new ProcPlantProductionDagError(`${node.id} flower semantics are unsupported for ${backend}`);
  }
  return buildProcPlantGraphIr(graph.stems, graph.segments, graph.organs);
};

const broadPatchBranchFrame = (
  support: ProcPlantStemNode,
  azimuth: number,
  divergence: number,
  upBias: number,
) => {
  const branch = support.direction.clone().normalize();
  const basis = tangentBasis(branch);
  const radial = basis.right.clone().applyAxisAngle(branch, azimuth).normalize();
  const direction = branch.clone().multiplyScalar(Math.cos(divergence))
    .addScaledVector(radial, Math.sin(divergence))
    .add(new THREE.Vector3(0, upBias, 0))
    .normalize();
  const desiredNormal = new THREE.Vector3(0, 0.82, 0).addScaledVector(radial, 0.18).projectOnPlane(direction);
  if (desiredNormal.lengthSq() < 1e-8) desiredNormal.copy(basis.up);
  desiredNormal.normalize();
  return { direction, right: desiredNormal.cross(direction).normalize(), radial };
};

const broadPatchRoot = (): ProcPlantStemNode => ({
  position: new THREE.Vector3(),
  direction: new THREE.Vector3(0, 1, 0),
  radius: 0.018,
  depth: 0,
  t: 0,
  index: 0,
});

const createBespokeBroadPatchArchitecture = (
  genome: ProcPlantGenome,
  environment: ProcPlantEnvironment,
  patch: ProcPlantBespokeBroadPatch,
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
  seed: number,
) => {
  const cover = genome.groundcover!;
  const clusterCount = scaledBespokeBroadPatchCount(cover.clusters, node, canonicalNode, 3, 24);
  const random = randomFromSeed(seed);
  const shade = 1 - THREE.MathUtils.clamp(environment.light, 0, 1);
  const heightStretch = 1 + shade * genome.lightResponse.shadeAvoidance;
  const root = broadPatchRoot();
  const stems: ProcPlantStemNode[] = [root];
  const segments: Array<[number, number]> = [];
  const addStem = (
    previous: ProcPlantStemNode,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    radiusScale: number,
    t: number,
  ) => {
    const stem: ProcPlantStemNode = {
      position,
      direction: direction.clone().normalize(),
      radius: Math.max(0.0015, previous.radius * radiusScale),
      depth: 0,
      t,
      index: stems.length,
    };
    stems.push(stem);
    segments.push([previous.index, stem.index]);
    return stem;
  };
  for (let cluster = 0; cluster < clusterCount; cluster++) {
    const t = clusterCount > 1 ? cluster / (clusterCount - 1) : 0;
    const yaw = cluster * 2.399963229728653 + (genome.phyllotaxy?.phase ?? 0) + (random() - 0.5) * 0.28;
    const spread = cluster === 0 ? 0 : cover.radius * (0.26 + Math.sqrt(t) * 0.74) * (0.9 + random() * 0.18);
    const radial = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const base: ProcPlantStemNode = {
      position: new THREE.Vector3(radial.x * spread, 0.006, radial.z * spread),
      direction: new THREE.Vector3(0, 1, 0),
      radius: root.radius * (patch === "horsetailColony" ? 0.72 : 0.52),
      depth: 0,
      t,
      index: stems.length,
    };
    stems.push(base);
    if (patch === "maidenhairFernPatch") {
      let previous = base;
      for (let level = 1; level <= 3; level++) {
        const levelT = level / 3;
        const direction = new THREE.Vector3(0, 1, 0).addScaledVector(radial, 0.18 + levelT * 0.22)
          .add(new THREE.Vector3((random() - 0.5) * 0.06, 0, (random() - 0.5) * 0.06)).normalize();
        previous = addStem(
          previous,
          previous.position.clone().addScaledVector(direction, cover.height * heightStretch / 3 * (0.88 + random() * 0.18)),
          direction,
          0.72,
          levelT,
        );
      }
    } else if (patch === "woodlandVioletCarpet") {
      const direction = new THREE.Vector3(0, 1, 0).addScaledVector(radial, 0.08).normalize();
      addStem(base, base.position.clone().addScaledVector(direction, cover.height * 0.28 * (0.82 + random() * 0.2)), direction, 0.58, t);
    } else if (patch === "trilliumPatch") {
      const direction = new THREE.Vector3(0, 1, 0).addScaledVector(radial, 0.1)
        .add(new THREE.Vector3((random() - 0.5) * 0.035, 0, (random() - 0.5) * 0.035)).normalize();
      addStem(base, base.position.clone().addScaledVector(direction, cover.height * heightStretch * (0.58 + random() * 0.12)), direction, 0.6, 0.64);
    } else {
      let previous = base;
      for (let level = 1; level <= 4; level++) {
        const levelT = level / 4;
        const direction = new THREE.Vector3(0, 1, 0).addScaledVector(radial, 0.045 + t * 0.04)
          .add(new THREE.Vector3((random() - 0.5) * 0.025, 0, (random() - 0.5) * 0.025)).normalize();
        previous = addStem(
          previous,
          previous.position.clone().addScaledVector(direction, cover.height * heightStretch / 4 * (0.9 + random() * 0.16)),
          direction,
          0.82,
          levelT,
        );
      }
    }
  }
  return buildProcPlantGraphIr(stems, segments, []);
};

const broadPatchClusterSupports = (graph: ProcPlantGraph, patch: ProcPlantBespokeBroadPatch) => {
  const stride = patch === "maidenhairFernPatch" ? 4 : patch === "horsetailColony" ? 5 : 2;
  const clusters: ProcPlantStemNode[][] = [];
  for (let offset = 1; offset + stride <= graph.stems.length; offset += stride) {
    clusters.push(graph.stems.slice(offset, offset + stride));
  }
  return clusters;
};

const addBespokeBroadPatchFoliage = (
  source: ProcPlantGraph,
  genome: ProcPlantGenome,
  patch: ProcPlantBespokeBroadPatch,
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
  seed: number,
) => {
  const graph = cloneGraph(source);
  const clusters = broadPatchClusterSupports(graph, patch);
  if (clusters.length < 1) throw new ProcPlantProductionDagError(`${node.id} requires broad-patch support stems`);
  const random = randomFromSeed(seed);
  const baselinePerCluster = BESPOKE_BROAD_PATCH_FOLIAGE_PER_CLUSTER[patch];
  const count = scaledBespokeBroadPatchCount(
    clusters.length * baselinePerCluster,
    node,
    canonicalNode,
    1,
    100_000,
  );
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const clusterIndex = ordinal % clusters.length;
    const localOrdinal = Math.floor(ordinal / clusters.length);
    const local = localOrdinal % baselinePerCluster;
    const cycle = Math.floor(localOrdinal / baselinePerCluster);
    const supports = clusters[clusterIndex]!;
    let support: ProcPlantStemNode;
    let azimuth: number;
    let divergence: number;
    let upBias: number;
    if (patch === "maidenhairFernPatch") {
      support = supports[local < 6 ? 1 + Math.floor(local / 2) : 3]!;
      azimuth = local < 6 ? (local % 2) * Math.PI + (Math.floor(local / 2) + 1) * 0.48 : Math.PI * 0.5;
      divergence = local < 6 ? 1.04 + support.t * 0.12 : 0.72;
      upBias = local < 6 ? 0.3 : 0.42;
    } else if (patch === "woodlandVioletCarpet") {
      support = supports[1]!;
      azimuth = local * Math.PI * 2 / 3;
      divergence = 1.06 + random() * 0.08;
      upBias = 0.38;
    } else if (patch === "trilliumPatch") {
      support = supports[1]!;
      azimuth = local * Math.PI * 2 / 3;
      divergence = 1.17;
      upBias = 0.3;
    } else {
      support = supports[1 + Math.floor(local / 5)]!;
      azimuth = (local % 5) * Math.PI * 2 / 5 + (Math.floor(local / 5) + 1) * 0.34;
      divergence = 1.22;
      upBias = -0.04;
    }
    azimuth += cycle * 0.27 + (random() - 0.5) * 0.035;
    const frame = broadPatchBranchFrame(support, azimuth, divergence, upBias);
    graph.organs.push({
      kind: "leaf",
      position: support.position.clone().addScaledVector(frame.radial, support.radius + 0.002),
      direction: frame.direction,
      right: frame.right,
      scale: curveValue(node, genome, support.t) * (0.88 + random() * 0.18),
      t: support.t,
    });
  }
  return buildProcPlantGraphIr(graph.stems, graph.segments, graph.organs);
};

const addBespokeBroadPatchFlowers = (
  source: ProcPlantGraph,
  genome: ProcPlantGenome,
  patch: ProcPlantBespokeBroadPatch,
  node: ProcPlantGeneratorNode,
  canonicalNode: ProcPlantGeneratorNode,
  seed: number,
) => {
  const graph = cloneGraph(source);
  if (!node.parameters?.flower || !genome.flower) return graph;
  if (patch !== "woodlandVioletCarpet" && patch !== "trilliumPatch") {
    throw new ProcPlantProductionDagError(`${node.id} flowers are unsupported for ${patch}`);
  }
  const supports = broadPatchClusterSupports(graph, patch).map((cluster) => cluster[1]!);
  if (supports.length < 1) throw new ProcPlantProductionDagError(`${node.id} requires broad-patch flower supports`);
  const random = randomFromSeed(seed);
  const count = scaledBespokeBroadPatchCount(
    Math.max(1, Math.round(supports.length * (genome.groundcover!.flowerRate ?? 0))),
    node,
    canonicalNode,
    1,
    24,
  );
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const support = supports[Math.min(supports.length - 1, Math.floor(((ordinal + random()) / count) * supports.length))]!;
    const direction = support.direction.clone()
      .add(new THREE.Vector3((random() - 0.5) * 0.08, 0.16, (random() - 0.5) * 0.08))
      .normalize();
    const flowerTip: ProcPlantStemNode = {
      position: support.position.clone().addScaledVector(
        direction,
        genome.groundcover!.height * (patch === "trilliumPatch" ? 0.34 + random() * 0.08 : 0.66 + random() * 0.22),
      ),
      direction,
      radius: Math.max(0.0015, support.radius * 0.42),
      depth: support.depth,
      t: 1,
      index: graph.stems.length,
    };
    graph.stems.push(flowerTip);
    graph.segments.push([support.index, flowerTip.index]);
    graph.organs.push({
      kind: "flower",
      position: flowerTip.position.clone().addScaledVector(direction, flowerTip.radius),
      direction,
      right: tangentBasis(direction).right,
      scale: (patch === "trilliumPatch" ? 0.9 : 0.82) + random() * (patch === "trilliumPatch" ? 0.14 : 0.16),
      t: 1,
    });
  }
  return buildProcPlantGraphIr(graph.stems, graph.segments, graph.organs);
};

const mergeBespokeBroadPatchArtifacts = (artifacts: readonly ProcPlantGraphStageArtifact[]) => {
  const foliage = artifacts.find((artifact) => artifact.stage === "foliage");
  if (!foliage) throw new ProcPlantProductionDagError("bespoke broad-patch material requires a foliage artifact");
  const merged = cloneGraph(foliage.graph);
  const reproductive = artifacts.find((artifact) => artifact.stage === "reproductive");
  if (!reproductive) return merged;
  const prefixCount = merged.stems.length;
  if (reproductive.graph.stems.length < prefixCount) {
    throw new ProcPlantProductionDagError("bespoke broad-patch reproductive topology lost its architecture prefix");
  }
  for (let index = 0; index < prefixCount; index++) {
    const left = merged.stems[index]!;
    const right = reproductive.graph.stems[index]!;
    if (
      !left.position.equals(right.position) || !left.direction.equals(right.direction) ||
      left.radius !== right.radius || left.depth !== right.depth || left.t !== right.t
    ) {
      throw new ProcPlantProductionDagError("bespoke broad-patch reproductive topology does not share the foliage architecture prefix");
    }
  }
  const remap = (index: number) => index < prefixCount ? index : prefixCount + (index - prefixCount);
  for (const stem of reproductive.graph.stems.slice(prefixCount)) {
    merged.stems.push({
      ...stem,
      index: merged.stems.length,
      position: stem.position.clone(),
      direction: stem.direction.clone(),
    });
  }
  for (const [start, end] of reproductive.graph.segments) {
    if (end < prefixCount) continue;
    merged.segments.push([remap(start), remap(end)]);
  }
  for (const organ of reproductive.graph.organs) {
    merged.organs.push({
      ...organ,
      position: organ.position.clone(),
      direction: organ.direction.clone(),
      right: organ.right.clone(),
    });
  }
  return buildProcPlantGraphIr(merged.stems, merged.segments, merged.organs);
};

const createArchitectureGraph = (
  genome: ProcPlantGenome,
  environment: ProcPlantEnvironment,
  node: ProcPlantGeneratorNode,
  seed: number,
) => {
  const count = Math.max(1, node.count ?? genome.nodeCount);
  const random = randomFromSeed(seed);
  const stems: ProcPlantStemNode[] = [];
  const segments: Array<[number, number]> = [];
  const root: ProcPlantStemNode = {
    position: new THREE.Vector3(), direction: new THREE.Vector3(0, 1, 0),
    radius: genome.habit === "tree" || genome.habit === "conifer" ? 0.052 : 0.024,
    depth: 0, t: 0, index: 0,
  };
  stems.push(root);
  let previous = root;
  const shade = 1 - THREE.MathUtils.clamp(environment.light, 0, 1);
  const heightStretch = 1 + shade * genome.lightResponse.shadeAvoidance;
  const phototropism = Number(node.parameters?.phototropism ?? genome.lightResponse.phototropism);
  const spacing = node.placement?.spacing ?? 1;
  const jitter = node.placement?.jitter ?? 0.1;
  for (let index = 1; index <= count; index++) {
    const t = index / count;
    const direction = previous.direction.clone()
      .add(new THREE.Vector3((random() - 0.5) * jitter, phototropism * t * 0.02, (random() - 0.5) * jitter))
      .normalize();
    const position = previous.position.clone().addScaledVector(direction, curveValue(node, genome, t) * spacing * heightStretch);
    const stem: ProcPlantStemNode = {
      position, direction, radius: previous.radius * THREE.MathUtils.lerp(0.96, 0.76, t),
      depth: 0, t, index: stems.length,
    };
    stems.push(stem);
    segments.push([previous.index, stem.index]);
    previous = stem;
  }
  return buildProcPlantGraphIr(stems, segments, []);
};

const scopeDependencies = (
  node: ProcPlantGeneratorNode,
  dependencies: readonly ProcPlantProductionStageArtifact[],
) => {
  if (node.parentScope?.mode === "nodes") {
    const ids = new Set(node.parentScope.nodeIds);
    return dependencies.filter((artifact) => ids.has(artifact.nodeId));
  }
  if (node.parentScope?.mode === "stages") {
    const stages = new Set(node.parentScope.stages);
    return dependencies.filter((artifact) => stages.has(artifact.stage));
  }
  return dependencies;
};

const graphArtifacts = (node: ProcPlantGeneratorNode, dependencies: readonly ProcPlantProductionStageArtifact[]) => {
  const artifacts = scopeDependencies(node, dependencies).filter(
    (artifact): artifact is ProcPlantGraphStageArtifact => artifact.kind === "graph",
  );
  if (artifacts.length < 1) throw new ProcPlantProductionDagError(`${node.id} requires at least one graph artifact input`);
  return artifacts;
};

const spaceColonizationPlanArtifact = (
  node: ProcPlantGeneratorNode,
  dependencies: readonly ProcPlantProductionStageArtifact[],
) => {
  const plans = scopeDependencies(node, dependencies).filter(
    (artifact): artifact is ProcPlantSpaceColonizationPlanStageArtifact => artifact.kind === "space-colonization-plan",
  );
  if (plans.length !== 1) throw new ProcPlantProductionDagError(`${node.id} requires exactly one space-colonization architecture plan`);
  return plans[0]!;
};

const spaceColonizationPartsArtifact = (
  node: ProcPlantGeneratorNode,
  dependencies: readonly ProcPlantProductionStageArtifact[],
) => {
  const candidates = scopeDependencies(node, dependencies).filter(
    (artifact): artifact is ProcPlantSpaceColonizationPartsStageArtifact => artifact.kind === "space-colonization-parts",
  );
  const retained = candidates.filter((candidate) => !candidates.some((other) =>
    other !== candidate && candidate.lineage.every((id) => other.lineage.includes(id)) && other.lineage.length > candidate.lineage.length));
  if (retained.length !== 1) throw new ProcPlantProductionDagError(`${node.id} requires exactly one terminal space-colonization parts artifact`);
  return retained[0]!;
};

const branchModulePlanArtifact = (
  node: ProcPlantGeneratorNode,
  dependencies: readonly ProcPlantProductionStageArtifact[],
) => {
  const artifacts = scopeDependencies(node, dependencies).filter(
    (artifact): artifact is ProcPlantBranchModulePlanStageArtifact => artifact.kind === "branch-module-plan",
  );
  if (artifacts.length !== 1) throw new ProcPlantProductionDagError(`${node.id} requires exactly one branch-module architecture plan`);
  return artifacts[0]!;
};

const branchModulePartsArtifact = (
  node: ProcPlantGeneratorNode,
  dependencies: readonly ProcPlantProductionStageArtifact[],
  expectedStage: ProcPlantBranchModulePartsStageArtifact["stage"],
) => {
  const artifacts = scopeDependencies(node, dependencies).filter(
    (artifact): artifact is ProcPlantBranchModulePartsStageArtifact =>
      artifact.kind === "branch-module-parts" && artifact.stage === expectedStage,
  );
  if (artifacts.length !== 1) throw new ProcPlantProductionDagError(`${node.id} requires exactly one branch-module ${expectedStage} artifact`);
  return artifacts[0]!;
};

const guidedVineTerminalGraphArtifact = (
  node: ProcPlantGeneratorNode,
  dependencies: readonly ProcPlantProductionStageArtifact[],
) => {
  const inputs = graphArtifacts(node, dependencies);
  const foliage = inputs.filter((entry) => entry.stage === "foliage");
  const reproductive = inputs.filter((entry) => entry.stage === "reproductive");
  if (foliage.length !== 1 || reproductive.length > 1) {
    throw new ProcPlantProductionDagError(`${node.id} requires one guided-vine foliage artifact and at most one reproductive artifact`);
  }
  return reproductive[0] ?? foliage[0]!;
};

const weberPennPlanArtifact = (
  node: ProcPlantGeneratorNode,
  dependencies: readonly ProcPlantProductionStageArtifact[],
) => {
  const plans = scopeDependencies(node, dependencies).filter(
    (artifact): artifact is ProcPlantWeberPennPlanStageArtifact => artifact.kind === "weber-penn-plan",
  );
  if (plans.length !== 1) throw new ProcPlantProductionDagError(`${node.id} requires exactly one Weber-Penn architecture plan`);
  return plans[0]!;
};

const weberPennPartsArtifact = (
  node: ProcPlantGeneratorNode,
  dependencies: readonly ProcPlantProductionStageArtifact[],
) => {
  const candidates = scopeDependencies(node, dependencies).filter(
    (artifact): artifact is ProcPlantWeberPennPartsStageArtifact => artifact.kind === "weber-penn-parts",
  );
  const retained = candidates.filter((candidate) => !candidates.some((other) =>
    other !== candidate && candidate.lineage.every((id) => other.lineage.includes(id)) && other.lineage.length > candidate.lineage.length));
  if (retained.length !== 1) throw new ProcPlantProductionDagError(`${node.id} requires exactly one terminal Weber-Penn parts artifact`);
  return retained[0]!;
};

const mergeGraphArtifacts = (artifacts: readonly ProcPlantGraphStageArtifact[]) => {
  const sorted = [...artifacts].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const retained = sorted.filter((candidate) => !sorted.some((other) =>
    other !== candidate && candidate.lineage.every((id) => other.lineage.includes(id)) && other.lineage.length > candidate.lineage.length));
  const first = retained[0]!;
  const sameStructure = retained.every((artifact) => graphStructureSignature(artifact.graph) === graphStructureSignature(first.graph));
  if (sameStructure) {
    const organs: ProcPlantOrgan[] = [];
    const seen = new Set<string>();
    for (const artifact of retained) {
      for (const organ of artifact.graph.organs) {
        const signature = organSignature(organ);
        if (seen.has(signature)) continue;
        seen.add(signature);
        organs.push({ ...organ, position: organ.position.clone(), direction: organ.direction.clone(), right: organ.right.clone() });
      }
    }
    const base = cloneGraph(first.graph);
    return buildProcPlantGraphIr(base.stems, base.segments, organs);
  }
  const stems: ProcPlantStemNode[] = [];
  const segments: Array<[number, number]> = [];
  const organs: ProcPlantOrgan[] = [];
  for (const artifact of retained) {
    const offset = stems.length;
    for (const stem of artifact.graph.stems) stems.push({
      ...stem, index: stems.length, position: stem.position.clone(), direction: stem.direction.clone(),
    });
    for (const [start, end] of artifact.graph.segments) segments.push([start + offset, end + offset]);
    for (const organ of artifact.graph.organs) organs.push({
      ...organ, position: organ.position.clone(), direction: organ.direction.clone(), right: organ.right.clone(),
    });
  }
  return buildProcPlantGraphIr(stems, segments, organs);
};

const graphCandidates = (graph: ProcPlantGraph, scope?: ProcPlantParentScope) => {
  const parents = new Set(graph.segments.map(([start]) => start));
  let candidates = scope?.mode === "root"
    ? graph.stems.filter((stem) => stem.index === 0)
    : scope?.mode === "tips"
      ? graph.stems.filter((stem) => !parents.has(stem.index))
      : graph.stems;
  if (scope?.maxDepth !== undefined) candidates = candidates.filter((stem) => stem.depth <= scope.maxDepth!);
  return candidates.sort((left, right) => left.index - right.index);
};

const placementCandidates = (graph: ProcPlantGraph, node: ProcPlantGeneratorNode) => {
  const candidates = graphCandidates(graph, node.parentScope);
  if (node.placement?.mode === "origin") return candidates.filter((stem) => stem.index === 0);
  if (node.placement?.mode === "tips") {
    const parents = new Set(graph.segments.map(([start]) => start));
    return candidates.filter((stem) => !parents.has(stem.index));
  }
  return candidates;
};

const addBranches = (source: ProcPlantGraph, genome: ProcPlantGenome, node: ProcPlantGeneratorNode, seed: number) => {
  const graph = cloneGraph(source);
  const candidates = placementCandidates(graph, node).filter((stem) => stem.index > 0 || node.parentScope?.mode === "root");
  if (candidates.length < 1) throw new ProcPlantProductionDagError(`${node.id}.parentScope selects no structural parents`);
  const random = randomFromSeed(seed);
  const count = node.count ?? Math.max(1, Math.round(genome.nodeCount * 0.2));
  const angle = node.parameters?.angle as { mean?: number; spread?: number } | undefined;
  const mean = angle?.mean ?? genome.branchAngle.mean;
  const spread = angle?.spread ?? genome.branchAngle.spread;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const stratum = (ordinal + random()) / Math.max(1, count);
    const parent = candidates[Math.min(candidates.length - 1, Math.floor(stratum * candidates.length))]!;
    const maxDepth = node.parentScope?.maxDepth;
    if (maxDepth !== undefined && parent.depth >= maxDepth) continue;
    const azimuth = ordinal * 2.399963229728653 + (random() - 0.5) * 0.45;
    const elevation = mean + (random() - 0.5) * spread;
    let previous = parent;
    const chainLength = Math.max(1, Math.min(6, Math.round(2 + (1 - parent.t) * 3)));
    for (let step = 1; step <= chainLength; step++) {
      const direction = rotateFromAxis(previous.direction, azimuth + step * 0.12, elevation * Math.pow(0.82, step - 1));
      const length = Math.max(0.015, curveValue(node, genome, step / chainLength) * (0.58 - step * 0.045));
      const stem: ProcPlantStemNode = {
        position: previous.position.clone().addScaledVector(direction, length), direction,
        radius: Math.max(0.0015, parent.radius * 0.62 * Math.pow(0.76, step)),
        depth: parent.depth + 1, t: THREE.MathUtils.clamp(parent.t + step / chainLength * (1 - parent.t), 0, 1),
        index: graph.stems.length,
      };
      graph.stems.push(stem);
      graph.segments.push([previous.index, stem.index]);
      previous = stem;
    }
  }
  return buildProcPlantGraphIr(graph.stems, graph.segments, graph.organs);
};

const addFoliage = (source: ProcPlantGraph, genome: ProcPlantGenome, node: ProcPlantGeneratorNode, seed: number) => {
  const graph = cloneGraph(source);
  const candidates = placementCandidates(graph, node).filter((stem) => stem.index > 0 || node.parentScope?.mode === "root");
  if (candidates.length < 1) throw new ProcPlantProductionDagError(`${node.id}.parentScope selects no foliage parents`);
  const random = randomFromSeed(seed);
  const count = node.count ?? candidates.length;
  const kindValue = String(node.parameters?.foliageKind ?? "leaf");
  const kind: ProcPlantOrgan["kind"] = kindValue === "coniferSpray" || kindValue === "palmFrond" || kindValue === "mossTuft"
    ? kindValue
    : "leaf";
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const stratum = (ordinal + random()) / Math.max(1, count);
    const parent = candidates[Math.min(candidates.length - 1, Math.floor(stratum * candidates.length))]!;
    const azimuth = ordinal * (genome.phyllotaxisAngle || 2.399963229728653) + (random() - 0.5) * 0.18;
    const direction = rotateFromAxis(parent.direction, azimuth, 1.05 + (random() - 0.5) * 0.22)
      .add(new THREE.Vector3(0, 0.14, 0)).normalize();
    let right = tangentBasis(parent.direction).right.applyAxisAngle(parent.direction, azimuth).projectOnPlane(direction);
    if (right.lengthSq() < 1e-8) right = tangentBasis(direction).right;
    right.normalize();
    graph.organs.push({
      kind,
      position: parent.position.clone().addScaledVector(direction, parent.radius * 0.5),
      direction,
      right,
      scale: Math.max(0.01, curveValue(node, genome, parent.t) * (0.84 + random() * 0.28)),
      t: parent.t,
    });
  }
  return buildProcPlantGraphIr(graph.stems, graph.segments, graph.organs);
};

const addReproductiveOrgans = (source: ProcPlantGraph, genome: ProcPlantGenome, node: ProcPlantGeneratorNode, seed: number) => {
  const graph = cloneGraph(source);
  const candidates = placementCandidates(graph, node).filter((stem) => stem.index > 0 || node.parentScope?.mode === "root");
  if (candidates.length < 1) throw new ProcPlantProductionDagError(`${node.id}.parentScope selects no reproductive parents`);
  const random = randomFromSeed(seed);
  const wantsFlower = Boolean(node.parameters?.flower);
  const accessories = Array.isArray(node.parameters?.accessories) ? node.parameters.accessories.map(String) : [];
  if (!wantsFlower && accessories.length === 0) return graph;
  const count = node.count ?? 1;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const parent = candidates[Math.min(candidates.length - 1, Math.floor(((ordinal + random()) / count) * candidates.length))]!;
    const accessory = accessories.length > 0 && (!wantsFlower || ordinal % 2 === 1)
      ? accessories[ordinal % accessories.length]
      : null;
    const supportedAccessories = new Set(["fruit", "berry", "cone", "thorn", "aerialRoot"]);
    if (accessory && !supportedAccessories.has(accessory)) {
      throw new ProcPlantProductionDagError(`${node.id} requests unsupported accessory kind ${accessory}`);
    }
    const direction = accessory === "fruit" || accessory === "berry"
      ? new THREE.Vector3(0, -1, 0)
      : parent.direction.clone().add(new THREE.Vector3((random() - 0.5) * 0.2, 0.18, (random() - 0.5) * 0.2)).normalize();
    graph.organs.push({
      kind: (accessory ?? "flower") as ProcPlantOrgan["kind"],
      position: parent.position.clone().addScaledVector(parent.direction, Math.max(0.01, parent.radius)),
      direction,
      right: tangentBasis(direction).right,
      scale: 0.78 + random() * 0.32,
      t: parent.t,
    });
  }
  return buildProcPlantGraphIr(graph.stems, graph.segments, graph.organs);
};

const lineageFor = (node: ProcPlantGeneratorNode, dependencies: readonly ProcPlantProductionStageArtifact[]) =>
  [...new Set([...dependencies.flatMap((artifact) => artifact.lineage), node.id])].sort();

const artifactHashPayload = (artifact: ProcPlantUnhashedStageArtifact) => {
  if (artifact.kind === "source") return { kind: artifact.kind, stage: artifact.stage, nodeId: artifact.nodeId, seed: artifact.seed, lineage: artifact.lineage, genomeId: artifact.genome.id };
  if (artifact.kind === "clump-transforms") return {
    kind: artifact.kind, nodeId: artifact.nodeId, seed: artifact.seed, lineage: artifact.lineage,
    shootSeed: artifact.plan.shootSeed, placementSeed: artifact.plan.placementSeed,
    shootSeeds: artifact.plan.shootSeeds,
    scales: artifact.plan.scales,
    transforms: artifact.plan.transforms.map((matrix) => matrix.elements),
  };
  if (artifact.kind === "clump-parts") return {
    kind: artifact.kind, nodeId: artifact.nodeId, seed: artifact.seed, lineage: artifact.lineage,
    plan: {
      shootSeed: artifact.plan.shootSeed, placementSeed: artifact.plan.placementSeed,
      shootSeeds: artifact.plan.shootSeeds, scales: artifact.plan.scales,
      transforms: artifact.plan.transforms.map((matrix) => matrix.elements),
    },
    graph: graphHash(artifact.parts.graph),
    template: templateHash(materializeProcPlantInstancedParts(artifact.genome, artifact.parts)),
  };
  if (artifact.kind === "graph") return { kind: artifact.kind, stage: artifact.stage, nodeId: artifact.nodeId, seed: artifact.seed, lineage: artifact.lineage, graph: graphHash(artifact.graph), runtime: artifact.runtime };
  if (artifact.kind === "space-colonization-plan") return {
    kind: artifact.kind, stage: artifact.stage, nodeId: artifact.nodeId, seed: artifact.seed,
    lineage: artifact.lineage, gene: artifact.genome.spaceColonization, runtime: artifact.runtime,
  };
  if (artifact.kind === "space-colonization-parts") return {
    kind: artifact.kind, stage: artifact.stage, nodeId: artifact.nodeId, seed: artifact.seed,
    lineage: artifact.lineage, graph: graphHash(artifact.parts.graph), stems: templateHash(artifact.parts.stems),
    growthSeed: artifact.growthSeed, foliageSeed: artifact.foliageSeed, runtime: artifact.runtime,
  };
  if (artifact.kind === "branch-module-plan") return {
    kind: artifact.kind, stage: artifact.stage, nodeId: artifact.nodeId, seed: artifact.seed,
    lineage: artifact.lineage, branchModules: artifact.genome.branchModules,
    nodeCount: artifact.genome.nodeCount, internode: artifact.genome.internode, runtime: artifact.runtime,
  };
  if (artifact.kind === "branch-module-parts") return {
    kind: artifact.kind, stage: artifact.stage, nodeId: artifact.nodeId, seed: artifact.seed,
    lineage: artifact.lineage, graph: graphHash(artifact.parts.graph),
    stems: templateHash(artifact.parts.stems), foliage: templateHash(artifact.parts.foliage),
    structureSeed: artifact.structureSeed, foliageSeed: artifact.foliageSeed, runtime: artifact.runtime,
  };
  if (artifact.kind === "weber-penn-plan") return {
    kind: artifact.kind, stage: artifact.stage, nodeId: artifact.nodeId, seed: artifact.seed,
    lineage: artifact.lineage, species: artifact.genome.weberPenn?.species, runtime: artifact.runtime,
  };
  if (artifact.kind === "weber-penn-parts") return {
    kind: artifact.kind, stage: artifact.stage, nodeId: artifact.nodeId, seed: artifact.seed,
    lineage: artifact.lineage, structure: templateHash(artifact.parts.structure),
    nativeFoliage: artifact.foliageSeed === null ? null : templateHash(artifact.parts.nativeFoliage),
    structureSeed: artifact.structureSeed, foliageSeed: artifact.foliageSeed, runtime: artifact.runtime,
  };
  if (artifact.kind === "material") return { kind: artifact.kind, nodeId: artifact.nodeId, seed: artifact.seed, lineage: artifact.lineage, graph: graphHash(artifact.graph), template: templateHash(artifact.template) };
  if (artifact.kind === "lod") return { kind: artifact.kind, nodeId: artifact.nodeId, seed: artifact.seed, lineage: artifact.lineage, levels: artifact.lods.map((lod) => [lod.level, templateHash(lod.template)]), runtime: artifact.runtime };
  return { kind: artifact.kind, nodeId: artifact.nodeId, seed: artifact.seed, lineage: artifact.lineage, template: templateHash(artifact.build.template), runtime: artifact.runtime };
};

const withArtifactHash = <T extends ProcPlantUnhashedStageArtifact>(artifact: T) => ({
  ...artifact,
  hash: hashValue(artifactHashPayload(artifact)),
}) as T & { hash: string };

const assertArtifactInputs = (node: ProcPlantGeneratorNode, dependencies: readonly ProcPlantProductionStageArtifact[]) => {
  const stages = dependencies.map((artifact) => artifact.stage);
  const allowed = ALLOWED_ARTIFACT_STAGES[node.stage];
  const unsupported = stages.filter((stage) => !allowed.includes(stage));
  if (unsupported.length > 0) {
    throw new ProcPlantProductionDagError(`${node.id} cannot consume artifact stages: ${[...new Set(unsupported)].sort().join(", ")}`);
  }
};

const nodeWork = (node: ProcPlantGeneratorNode) => node.enabled ? node.count ?? 1 : 0;

const artifactWork = (artifact: ProcPlantProductionStageArtifact) => {
  if (artifact.kind === "source") return 1;
  if (artifact.kind === "clump-transforms") return artifact.plan.transforms.length;
  if (artifact.kind === "clump-parts") return artifact.parts.graph.stems.length + artifact.parts.graph.segments.length + artifact.parts.instances.length;
  if (artifact.kind === "graph") return artifact.graph.stems.length + artifact.graph.segments.length + artifact.graph.organs.length;
  if (artifact.kind === "space-colonization-plan") return 1 + (artifact.genome.spaceColonization?.freeform?.volumes.length ?? 0);
  if (artifact.kind === "space-colonization-parts") return artifact.parts.graph.stems.length
    + artifact.parts.graph.segments.length + artifact.parts.graph.organs.length
    + artifact.parts.stems.pos.length / 3 + artifact.parts.instances.length;
  if (artifact.kind === "branch-module-plan") return 1;
  if (artifact.kind === "branch-module-parts") return artifact.parts.graph.stems.length
    + artifact.parts.graph.segments.length
    + artifact.parts.stems.pos.length / 3 + artifact.parts.foliage.pos.length / 3;
  if (artifact.kind === "weber-penn-plan") return 1;
  if (artifact.kind === "weber-penn-parts") {
    const structure = artifact.parts.structure.pos.length / 3 + artifact.parts.structure.idx.length;
    const foliage = artifact.foliageSeed === null
      ? 0
      : artifact.parts.nativeFoliage.pos.length / 3 + artifact.parts.nativeFoliage.idx.length;
    return structure + foliage;
  }
  if (artifact.kind === "material") return artifact.template.pos.length / 3 + artifact.template.idx.length;
  if (artifact.kind === "lod") return artifact.lods.reduce((sum, lod) => sum + lod.vertices + lod.triangles, 0);
  return artifact.build.template.pos.length / 3 + artifact.build.template.idx.length;
};

const clumpNodeMap = (graph: ProcPlantGeneratorGraph) => new Map(
  graph.nodes.map((node) => [node.stage, node] as const),
);

const assertSupportedClumpGraph = (
  genome: ProcPlantGenome,
  graph: ProcPlantGeneratorGraph,
  canonical: ProcPlantGeneratorGraph,
) => {
  if (!genome.clump || genome.clump.count <= 1) throw new ProcPlantProductionDagError("clump-specialized DAG requires clump.count > 1");
  if (genome.id.split("@", 1)[0] === "daylilyFlower") {
    throw new ProcPlantProductionDagError("typed clump DAG does not support the specialized daylily crown/scapes backend");
  }
  if (graph.nodes.length !== canonical.nodes.length) {
    throw new ProcPlantProductionDagError("typed clump DAG does not support added or removed stages");
  }
  const canonicalById = new Map(canonical.nodes.map((node) => [node.id, node]));
  const normalizeNode = (node: ProcPlantGeneratorNode, reference: ProcPlantGeneratorNode) => {
    const normalized = structuredClone(node);
    if (node.stage === "architecture" || node.stage === "foliage") delete normalized.seedOverride;
    if (node.stage === "material" || node.stage === "lod") normalized.parameters = structuredClone(reference.parameters);
    return normalized;
  };
  for (const node of graph.nodes) {
    const reference = canonicalById.get(node.id);
    if (!reference || stableJson(normalizeNode(node, reference)) !== stableJson(normalizeNode(reference, reference))) {
      throw new ProcPlantProductionDagError(`typed clump DAG does not support edited ${node.stage} semantics at ${node.id}`);
    }
  }
  const nodes = clumpNodeMap(graph);
  if (nodes.size !== graph.nodes.length) throw new ProcPlantProductionDagError("typed clump DAG requires exactly one node per canonical stage");
  const material = nodes.get("material")!;
  const materialKeys = Object.keys(material.parameters ?? {}).sort();
  if (stableJson(materialKeys) !== stableJson(["leafColorA", "leafColorB"])) {
    throw new ProcPlantProductionDagError(`${material.id}.parameters supports leafColorA and leafColorB only`);
  }
  for (const key of ["leafColorA", "leafColorB"] as const) {
    const value = material.parameters?.[key];
    if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 0xffffff) {
      throw new ProcPlantProductionDagError(`${material.id}.parameters.${key} must be a 24-bit integer color`);
    }
  }
  const lod = nodes.get("lod")!;
  const lodKeys = Object.keys(lod.parameters ?? {}).sort();
  const levels = lod.parameters?.levels;
  if (stableJson(lodKeys) !== stableJson(["levels"]) || !Array.isArray(levels) || levels.length < 1 ||
    levels.some((level) => !Number.isInteger(level) || Number(level) < 0 || Number(level) > 3)) {
    throw new ProcPlantProductionDagError(`${lod.id}.parameters.levels must contain LOD indices 0..3`);
  }
  return nodes;
};

const compileProcPlantClumpProductionDag = (
  genome: ProcPlantGenome,
  graph: ProcPlantGeneratorGraph,
  canonical: ProcPlantGeneratorGraph,
  order: readonly string[],
  environment: ProcPlantEnvironment,
  maximumWork: number,
): ProcPlantProductionDagResult => {
  const nodes = assertSupportedClumpGraph(genome, graph, canonical);
  const source = nodes.get("source")!;
  const architecture = nodes.get("architecture")!;
  const foliage = nodes.get("foliage")!;
  const material = nodes.get("material")!;
  const lod = nodes.get("lod")!;
  const output = nodes.get("output")!;
  const shootSeed = (foliage.seedOverride ?? graph.seed) >>> 0;
  const placementSeed = (architecture.seedOverride ?? graph.seed) >>> 0;
  const materialGenome: ProcPlantGenome = {
    ...genome,
    leaf: {
      ...genome.leaf,
      colorA: Number(material.parameters?.leafColorA),
      colorB: Number(material.parameters?.leafColorB),
    },
  };
  const runtime = {
    windFlex: genome.treeRealism?.windFlex ?? 0.35,
    phototropism: genome.lightResponse.phototropism,
  };
  const plan = createProcPlantClumpStagePlan(materialGenome, shootSeed, placementSeed);
  const parts = buildProcPlantClumpStageParts(materialGenome, plan, environment);
  if (parts.graph.stems.length > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_STEMS ||
    parts.graph.organs.length > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_ORGANS ||
    parts.instances.length > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_ORGANS) {
    throw new ProcPlantProductionDagError("clump foliage stage exceeds production geometry caps");
  }
  const template = materializeProcPlantInstancedParts(materialGenome, parts);
  const levels = lod.parameters!.levels as (0 | 1 | 2 | 3)[];
  const lods = compileProcPlantClumpStageLods(materialGenome, shootSeed, placementSeed, environment, levels);
  const full = lods.find((entry) => entry.level === 0);
  if (!full) throw new ProcPlantProductionDagError(`${output.id} requires LOD level 0 for runtime output`);
  if (templateHash(full.template) !== templateHash(template)) {
    throw new ProcPlantProductionDagError("clump material and LOD0 stages produced different canonical bytes");
  }
  const artifacts: Record<string, ProcPlantProductionStageArtifact> = Object.create(null) as Record<string, ProcPlantProductionStageArtifact>;
  artifacts[source.id] = withArtifactHash({
    kind: "source", stage: "source", nodeId: source.id, seed: graph.seed, lineage: [source.id], genome, environment,
  });
  artifacts[architecture.id] = withArtifactHash({
    kind: "clump-transforms", stage: "architecture", nodeId: architecture.id, seed: placementSeed,
    lineage: [source.id, architecture.id].sort(), genome: materialGenome, environment, plan, runtime,
  });
  artifacts[foliage.id] = withArtifactHash({
    kind: "clump-parts", stage: "foliage", nodeId: foliage.id, seed: shootSeed,
    lineage: [source.id, architecture.id, foliage.id].sort(), genome: materialGenome, environment, plan, parts, runtime,
  });
  const stats: ProcPlantStats = {
    stems: parts.stats.stems,
    leaves: parts.stats.leaves,
    flowers: parts.stats.flowers,
    ...(parts.stats.accessories === undefined ? {} : { accessories: parts.stats.accessories }),
    triangles: template.idx.length / 3,
  };
  artifacts[material.id] = withArtifactHash({
    kind: "material", stage: "material", nodeId: material.id,
    seed: deriveProcPlantGeneratorNodeSeed(graph.seed, material.id),
    lineage: [source.id, architecture.id, foliage.id, material.id].sort(), genome: materialGenome,
    environment, graph: parts.graph, template, stats,
  });
  artifacts[lod.id] = withArtifactHash({
    kind: "lod", stage: "lod", nodeId: lod.id, seed: deriveProcPlantGeneratorNodeSeed(graph.seed, lod.id),
    lineage: [source.id, architecture.id, foliage.id, material.id, lod.id].sort(), genome: materialGenome,
    graph: parts.graph, lods, stats, runtime,
  });
  artifacts[output.id] = withArtifactHash({
    kind: "output", stage: "output", nodeId: output.id, seed: deriveProcPlantGeneratorNodeSeed(graph.seed, output.id),
    lineage: [source.id, architecture.id, foliage.id, material.id, lod.id, output.id].sort(),
    build: { template: full.template, graph: parts.graph, stats: { ...stats, triangles: full.triangles } }, lods, runtime,
  });
  const records: ProcPlantProductionDagRecord[] = [];
  let work = 0;
  for (const nodeId of order) {
    const node = graph.nodes.find((entry) => entry.id === nodeId)!;
    const artifact = artifacts[nodeId];
    const operationWork = nodeWork(node);
    const materializedWork = artifact ? artifactWork(artifact) : 0;
    work += operationWork + materializedWork;
    if (work > maximumWork) throw new ProcPlantProductionDagError(`production DAG exceeds the ${maximumWork} work cap at ${node.id}`);
    records.push({
      nodeId,
      stage: node.stage,
      seed: node.stage === "architecture" ? placementSeed : node.stage === "foliage" ? shootSeed : node.seedOverride ?? deriveProcPlantGeneratorNodeSeed(graph.seed, node.id),
      status: !node.enabled ? "disabled" : artifact ? "executed" : "legacy",
      dependencyIds: [...node.dependsOn].sort(),
      artifactKind: artifact?.kind ?? null,
      artifactHash: artifact?.hash ?? null,
      work: operationWork + materializedWork,
    });
  }
  return {
    version: PROCPLANT_PRODUCTION_DAG_RESULT_VERSION,
    path: "typed-artifacts",
    graph,
    previewHash: summarizeProcPlantGeneratorGraph(graph).hash,
    artifacts,
    records,
    build: (artifacts[output.id] as ProcPlantOutputStageArtifact).build,
    lods,
    work,
  };
};

export const compileProcPlantProductionDag = (
  genome: ProcPlantGenome,
  sourceGraph: ProcPlantGeneratorGraph,
  environment: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: ProcPlantProductionDagOptions = {},
): ProcPlantProductionDagResult => {
  const order = validateProcPlantGeneratorGraph(sourceGraph);
  if (!sourceGraph.target || sourceGraph.target.kind !== "procplant-genome" || sourceGraph.target.version !== 1 || sourceGraph.target.id !== genome.id) {
    throw new ProcPlantProductionDagError(`production graph target does not match genome ${genome.id}`);
  }
  const graph = structuredClone(sourceGraph);
  const preview = summarizeProcPlantGeneratorGraph(graph);
  const canonicalSeed = options.canonicalSeed ?? graph.seed;
  const canonical = createProcPlantAuthoringGraph(genome, canonicalSeed);
  if (sameGraphSemantics(graph, canonical)) {
    const build = buildProcPlantTemplate(genome, canonicalSeed, environment);
    const lods = compileProcPlantLods(genome, canonicalSeed, environment);
    return {
      version: PROCPLANT_PRODUCTION_DAG_RESULT_VERSION,
      path: "legacy-canonical",
      graph,
      previewHash: preview.hash,
      artifacts: {},
      records: order.map((nodeId) => {
        const node = graph.nodes.find((entry) => entry.id === nodeId)!;
        return {
          nodeId, stage: node.stage,
          seed: node.seedOverride ?? deriveProcPlantGeneratorNodeSeed(graph.seed, node.id),
          status: "legacy" as const, dependencyIds: [...node.dependsOn].sort(),
          artifactKind: null, artifactHash: null, work: nodeWork(node),
        };
      }),
      build,
      lods,
      work: graph.nodes.reduce((sum, node) => sum + nodeWork(node), 0),
    };
  }

  if (genome.vine) validateGuidedVineGraphSemantics(graph, canonical);
  const maximumWork = options.maxWork ?? PROCPLANT_PRODUCTION_DAG_MAX_WORK;
  if (!Number.isInteger(maximumWork) || maximumWork < 1 || maximumWork > PROCPLANT_PRODUCTION_DAG_MAX_WORK) {
    throw new ProcPlantProductionDagError(`maxWork must be an integer in 1..${PROCPLANT_PRODUCTION_DAG_MAX_WORK}`);
  }
  if (genome.clump && genome.clump.count > 1) {
    return compileProcPlantClumpProductionDag(genome, graph, canonical, order, environment, maximumWork);
  }
  assertSupportedBackend(genome);
  const herbaceousBackend = herbaceousBackendFor(genome);
  const bespokeBroadPatch = bespokeBroadPatchFor(genome);
  const canonicalNodeByStage = new Map(canonical.nodes.map((node) => [node.stage, node]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const canonicalNodeById = new Map(canonical.nodes.map((node) => [node.id, node]));
  if (genome.weberPenn && graph.nodes.length !== canonical.nodes.length) {
    throw new ProcPlantProductionDagError("Weber-Penn production graphs require the canonical nine-stage node set");
  }
  for (const node of graph.nodes) {
    validateProductionNodeParameters(node, genome);
    if (genome.spaceColonization) validateSpaceColonizationNodeSemantics(node, canonicalNodeById.get(node.id));
    if (genome.branchModules) validateBranchModuleNodeSemantics(node, canonicalNodeById.get(node.id));
    if (herbaceousBackend) {
      validateHerbaceousNodeSemantics(node, canonicalNodeByStage.get(node.stage) ?? node, genome, herbaceousBackend);
    }
    if (genome.weberPenn) validateWeberPennNodeSemantics(node, canonicalNodeById.get(node.id));
    if (bespokeBroadPatch) {
      validateBespokeBroadPatchNode(node, canonicalNodeByStage.get(node.stage) ?? node, genome, bespokeBroadPatch);
    }
    const unsupported = node.dependsOn
      .map((id) => nodeById.get(id)!)
      .filter((dependency) => !ALLOWED_ARTIFACT_STAGES[node.stage].includes(dependency.stage));
    if (unsupported.length > 0) {
      throw new ProcPlantProductionDagError(`${node.id} cannot consume artifact stages: ${[...new Set(unsupported.map((entry) => entry.stage))].sort().join(", ")}`);
    }
  }
  const artifacts: Record<string, ProcPlantProductionStageArtifact> = Object.create(null) as Record<string, ProcPlantProductionStageArtifact>;
  const records: ProcPlantProductionDagRecord[] = [];
  let work = 0;
  for (const nodeId of order) {
    const node = nodeById.get(nodeId)!;
    const seed = genome.weberPenn && (node.stage === "branching" || node.stage === "foliage")
      ? node.seedOverride ?? graph.seed
      : node.seedOverride ?? deriveProcPlantGeneratorNodeSeed(graph.seed, node.id);
    const dependencyIds = [...node.dependsOn].sort();
    if (!node.enabled) {
      records.push({ nodeId, stage: node.stage, seed, status: "disabled", dependencyIds, artifactKind: null, artifactHash: null, work: 0 });
      continue;
    }
    const dependencies = dependencyIds.map((id) => artifacts[id]).filter((artifact): artifact is ProcPlantProductionStageArtifact => Boolean(artifact));
    assertArtifactInputs(node, dependencies);
    const scopedDependencies = scopeDependencies(node, dependencies);
    const operationWork = nodeWork(node);
    work += operationWork;
    if (work > maximumWork) throw new ProcPlantProductionDagError(`production DAG exceeds the ${maximumWork} work cap at ${node.id}`);

    let artifact: ProcPlantProductionStageArtifact;
    if (node.stage === "source") {
      if (dependencies.length !== 0) throw new ProcPlantProductionDagError(`${node.id} source stage cannot have dependencies`);
      artifact = withArtifactHash({
        kind: "source", stage: "source", nodeId, seed, lineage: [nodeId], genome, environment,
      });
    } else if (node.stage === "architecture") {
      const sources = scopedDependencies.filter((entry): entry is ProcPlantSourceStageArtifact => entry.kind === "source");
      if (sources.length !== 1) throw new ProcPlantProductionDagError(`${node.id} requires exactly one source artifact`);
      const source = sources[0]!;
      const architectureGenome: ProcPlantGenome = {
        ...source.genome,
        nodeCount: node.count ?? source.genome.nodeCount,
        internode: node.curve ? { ...node.curve } : source.genome.internode,
        apicalDominance: Number(node.parameters?.apicalDominance ?? source.genome.apicalDominance),
        phyllotaxisAngle: Number(node.parameters?.phyllotaxisAngle ?? source.genome.phyllotaxisAngle),
        ...(source.genome.spaceColonization
          ? {
            spaceColonization: {
              ...source.genome.spaceColonization,
              attractorCount: node.count!,
              freeform: node.parameters?.freeformCrown === undefined
                ? undefined
                : cloneProcPlantFreeformCrown(node.parameters.freeformCrown as ProcPlantFreeformCrown),
            },
          }
          : {}),
      };
      const runtime = { windFlex: architectureGenome.treeRealism?.windFlex ?? 0.35, phototropism: architectureGenome.lightResponse.phototropism };
      if (architectureGenome.weberPenn) {
        artifact = withArtifactHash({
          kind: "weber-penn-plan", stage: "architecture", nodeId, seed, lineage: lineageFor(node, sources),
          genome: architectureGenome, environment: source.environment, runtime,
        });
      } else if (architectureGenome.spaceColonization) {
        artifact = withArtifactHash({
          kind: "space-colonization-plan", stage: "architecture", nodeId, seed,
          lineage: lineageFor(node, sources), genome: architectureGenome,
          environment: source.environment, runtime,
        });
      } else if (architectureGenome.branchModules) {
        artifact = withArtifactHash({
          kind: "branch-module-plan", stage: "architecture", nodeId, seed,
          lineage: lineageFor(node, sources), genome: architectureGenome,
          environment: source.environment, runtime,
        });
      } else {
        const builtGraph = architectureGenome.vine
          ? buildGuidedVineProcPlantArchitectureGraph(architectureGenome, node.count)
          : herbaceousBackend
            ? createHerbaceousArchitectureGraph(
                architectureGenome,
                source.environment,
                herbaceousBackend,
                node,
                canonicalNodeByStage.get("architecture")!,
                seed,
              )
            : bespokeBroadPatch
              ? createBespokeBroadPatchArchitecture(
                  architectureGenome,
                  source.environment,
                  bespokeBroadPatch,
                  node,
                  canonicalNodeByStage.get("architecture")!,
                  seed,
                )
              : createArchitectureGraph(architectureGenome, source.environment, node, seed);
        artifact = withArtifactHash({
          kind: "graph", stage: "architecture", nodeId, seed, lineage: lineageFor(node, sources),
          genome: architectureGenome, environment: source.environment, graph: builtGraph, runtime,
        });
      }
    } else if (node.stage === "branching") {
      if (genome.weberPenn) {
        const input = weberPennPlanArtifact(node, dependencies);
        const branchedGenome: ProcPlantGenome = {
          ...input.genome,
          weberPenn: {
            ...input.genome.weberPenn!,
            maxStems: node.count!,
            maxBranchDepth: node.parentScope?.maxDepth,
          },
        };
        const parts = buildWeberPennProcPlantStageParts(
          branchedGenome, seed, input.environment, { structure: seed, foliage: seed },
        );
        artifact = withArtifactHash({
          kind: "weber-penn-parts", stage: "branching", nodeId, seed,
          lineage: lineageFor(node, [input]), genome: branchedGenome, environment: input.environment,
          parts, structureSeed: seed, foliageSeed: null, runtime: input.runtime,
        });
      } else if (genome.spaceColonization) {
        const input = spaceColonizationPlanArtifact(node, dependencies);
        const branchedGenome: ProcPlantGenome = {
          ...input.genome,
          spaceColonization: { ...input.genome.spaceColonization!, maxNodes: node.count! },
        };
        const parts = buildSpaceColonizedProcPlantStageParts(
          branchedGenome, { growth: seed, foliage: 0 }, input.environment, { includeFoliage: false },
        );
        artifact = withArtifactHash({
          kind: "space-colonization-parts", stage: "branching", nodeId, seed,
          lineage: lineageFor(node, [input]), genome: branchedGenome, environment: input.environment,
          parts, growthSeed: seed, foliageSeed: null, runtime: input.runtime,
        });
      } else if (genome.branchModules) {
        const input = branchModulePlanArtifact(node, dependencies);
        const branchedGenome: ProcPlantGenome = {
          ...input.genome,
          branchModules: {
            ...input.genome.branchModules!,
            moduleBudget: node.count!,
            levels: node.parentScope?.maxDepth ?? input.genome.branchModules!.levels,
          },
        };
        const parts = buildBranchModuleProcPlantStageParts(
          branchedGenome, { structure: seed, foliage: 0 }, input.environment, { includeFoliage: false },
        );
        artifact = withArtifactHash({
          kind: "branch-module-parts", stage: "branching", nodeId, seed,
          lineage: lineageFor(node, [input]), genome: branchedGenome, environment: input.environment,
          parts, structureSeed: seed, foliageSeed: null, runtime: input.runtime,
        });
      } else {
        const inputs = graphArtifacts(node, dependencies);
        const base = mergeGraphArtifacts(inputs);
        artifact = withArtifactHash({
          kind: "graph", stage: "branching", nodeId, seed, lineage: lineageFor(node, inputs),
          genome: inputs[0]!.genome, environment: inputs[0]!.environment,
          graph: herbaceousBackend || bespokeBroadPatch ? base : addBranches(base, inputs[0]!.genome, node, seed),
          runtime: inputs[0]!.runtime,
        });
      }
    } else if (node.stage === "foliage") {
      if (genome.weberPenn) {
        const input = weberPennPartsArtifact(node, dependencies);
        if (input.stage !== "branching") throw new ProcPlantProductionDagError(`${node.id} requires a Weber-Penn branching artifact`);
        const foliageGenome: ProcPlantGenome = {
          ...input.genome,
          weberPenn: { ...input.genome.weberPenn!, maxLeaves: node.count! },
        };
        const parts = buildWeberPennProcPlantStageParts(
          foliageGenome, input.structureSeed, input.environment,
          { structure: input.structureSeed, foliage: seed },
          input.parts,
        );
        artifact = withArtifactHash({
          kind: "weber-penn-parts", stage: "foliage", nodeId, seed,
          lineage: lineageFor(node, [input]), genome: foliageGenome, environment: input.environment,
          parts, structureSeed: input.structureSeed, foliageSeed: seed, runtime: input.runtime,
        });
      } else if (genome.spaceColonization) {
        const input = spaceColonizationPartsArtifact(node, dependencies);
        if (input.stage !== "branching") throw new ProcPlantProductionDagError(`${node.id} requires a space-colonization branching artifact`);
        const foliageGenome: ProcPlantGenome = {
          ...input.genome,
          leaf: {
            ...input.genome.leaf,
            shape: node.parameters?.shape as ProcPlantGenome["leaf"]["shape"],
            length: node.curve ? { ...node.curve } : input.genome.leaf.length,
          },
          phyllotaxy: {
            ...(input.genome.phyllotaxy ?? { mode: "spiral" as const }),
            mode: node.parameters?.phyllotaxy as NonNullable<ProcPlantGenome["phyllotaxy"]>["mode"],
          },
          spaceColonization: { ...input.genome.spaceColonization!, terminalLeafCount: node.count! },
        };
        const parts = buildSpaceColonizedProcPlantStageParts(
          foliageGenome, { growth: input.growthSeed, foliage: seed }, input.environment,
        );
        artifact = withArtifactHash({
          kind: "space-colonization-parts", stage: "foliage", nodeId, seed,
          lineage: lineageFor(node, [input]), genome: foliageGenome, environment: input.environment,
          parts, growthSeed: input.growthSeed, foliageSeed: seed, runtime: input.runtime,
        });
      } else if (genome.branchModules) {
        const input = branchModulePartsArtifact(node, dependencies, "branching");
        if (input.stage !== "branching") throw new ProcPlantProductionDagError(`${node.id} requires a branch-module branching artifact`);
        const foliageGenome: ProcPlantGenome = {
          ...input.genome,
          leaf: {
            ...input.genome.leaf,
            shape: node.parameters?.shape as ProcPlantGenome["leaf"]["shape"],
            length: node.curve ? { ...node.curve } : input.genome.leaf.length,
          },
        };
        const parts = buildBranchModuleProcPlantStageParts(
          foliageGenome, { structure: input.structureSeed, foliage: seed }, input.environment,
        );
        artifact = withArtifactHash({
          kind: "branch-module-parts", stage: "foliage", nodeId, seed,
          lineage: lineageFor(node, [input]), genome: foliageGenome, environment: input.environment,
          parts, structureSeed: input.structureSeed, foliageSeed: seed, runtime: input.runtime,
        });
      } else {
        const inputs = graphArtifacts(node, dependencies);
        const base = mergeGraphArtifacts(inputs);
        const foliageGenome: ProcPlantGenome = {
          ...inputs[0]!.genome,
          leaf: {
            ...inputs[0]!.genome.leaf,
            shape: node.parameters?.shape as ProcPlantGenome["leaf"]["shape"],
            ...(inputs[0]!.genome.vine && node.curve ? { length: { ...node.curve } } : {}),
          },
          phyllotaxy: {
            ...(inputs[0]!.genome.phyllotaxy ?? { mode: "spiral" as const }),
            mode: node.parameters?.phyllotaxy as NonNullable<ProcPlantGenome["phyllotaxy"]>["mode"],
          },
        };
        const foliageGraph = foliageGenome.vine
          ? addGuidedVineProcPlantFoliage(foliageGenome, base, seed, node.count)
          : herbaceousBackend
            ? addHerbaceousFoliage(
                base,
                foliageGenome,
                inputs[0]!.environment,
                herbaceousBackend,
                node,
                canonicalNodeByStage.get("foliage")!,
                seed,
              )
            : bespokeBroadPatch
              ? addBespokeBroadPatchFoliage(
                  base,
                  foliageGenome,
                  bespokeBroadPatch,
                  node,
                  canonicalNodeByStage.get("foliage")!,
                  seed,
                )
              : addFoliage(base, foliageGenome, node, seed);
        artifact = withArtifactHash({
          kind: "graph", stage: "foliage", nodeId, seed, lineage: lineageFor(node, inputs),
          genome: foliageGenome, environment: inputs[0]!.environment,
          graph: foliageGraph, runtime: inputs[0]!.runtime,
        });
      }
    } else if (node.stage === "reproductive") {
      const inputs = graphArtifacts(node, dependencies);
      const base = bespokeBroadPatch
        ? mergeGraphArtifacts(inputs.filter((entry) => entry.stage !== "foliage"))
        : mergeGraphArtifacts(inputs);
      const reproductiveGraph = inputs[0]!.genome.vine
        ? addGuidedVineProcPlantReproductiveOrgans(inputs[0]!.genome, base, seed, node.count)
        : herbaceousBackend
          ? addHerbaceousReproductiveOrgans(
              base,
              inputs[0]!.genome,
              herbaceousBackend,
              node,
              canonicalNodeByStage.get("reproductive")!,
              seed,
            )
          : bespokeBroadPatch
            ? addBespokeBroadPatchFlowers(
                base,
                inputs[0]!.genome,
                bespokeBroadPatch,
                node,
                canonicalNodeByStage.get("reproductive")!,
                seed,
              )
            : addReproductiveOrgans(base, inputs[0]!.genome, node, seed);
      artifact = withArtifactHash({
        kind: "graph", stage: "reproductive", nodeId, seed, lineage: lineageFor(node, inputs),
        genome: inputs[0]!.genome, environment: inputs[0]!.environment,
        graph: reproductiveGraph, runtime: inputs[0]!.runtime,
      });
    } else if (node.stage === "deformation") {
      if (genome.weberPenn) {
        const input = weberPennPartsArtifact(node, dependencies);
        artifact = withArtifactHash({
          ...input, stage: "deformation", nodeId, seed, lineage: lineageFor(node, [input]),
          runtime: {
            windFlex: Number(node.parameters?.windFlex ?? input.runtime.windFlex),
            phototropism: Number(node.parameters?.phototropism ?? input.runtime.phototropism),
          },
        });
      } else if (genome.spaceColonization) {
        const input = spaceColonizationPartsArtifact(node, dependencies);
        artifact = withArtifactHash({
          ...input, stage: "deformation", nodeId, seed, lineage: lineageFor(node, [input]),
          runtime: {
            windFlex: Number(node.parameters?.windFlex ?? input.runtime.windFlex),
            phototropism: Number(node.parameters?.phototropism ?? input.runtime.phototropism),
          },
        });
      } else if (genome.branchModules) {
        const input = branchModulePartsArtifact(node, dependencies, "foliage");
        artifact = withArtifactHash({
          ...input, stage: "deformation", nodeId, seed, lineage: lineageFor(node, [input]),
          runtime: {
            windFlex: Number(node.parameters?.windFlex ?? input.runtime.windFlex),
            phototropism: Number(node.parameters?.phototropism ?? input.runtime.phototropism),
          },
        });
      } else {
        const inputs = graphArtifacts(node, dependencies);
        const terminal = genome.vine ? guidedVineTerminalGraphArtifact(node, dependencies) : null;
        const base = terminal ? cloneGraph(terminal.graph) : mergeGraphArtifacts(inputs);
        artifact = withArtifactHash({
          kind: "graph", stage: "deformation", nodeId, seed, lineage: lineageFor(node, inputs),
          genome: terminal?.genome ?? inputs[0]!.genome,
          environment: terminal?.environment ?? inputs[0]!.environment,
          graph: base,
          runtime: {
            windFlex: Number(node.parameters?.windFlex ?? terminal?.runtime.windFlex ?? inputs[0]!.runtime.windFlex),
            phototropism: Number(node.parameters?.phototropism ?? terminal?.runtime.phototropism ?? inputs[0]!.runtime.phototropism),
          },
        });
      }
    } else if (node.stage === "material") {
      if (genome.weberPenn) {
        const input = weberPennPartsArtifact(node, dependencies);
        if (input.foliageSeed === null) throw new ProcPlantProductionDagError(`${node.id} requires a populated Weber-Penn foliage artifact`);
        const materialGenomeBase = cloneGenomeForMaterial(input.genome, node);
        const requestedLeafColor = materialGenomeBase.leaf.colorA;
        const materialGenome: ProcPlantGenome = {
          ...materialGenomeBase,
          weberPenn: {
            ...materialGenomeBase.weberPenn!,
            leafColor: requestedLeafColor === genome.leaf.colorA
              ? materialGenomeBase.weberPenn!.leafColor
              : requestedLeafColor,
          },
        };
        const parts = buildWeberPennProcPlantStageParts(
          materialGenome, input.structureSeed, input.environment,
          { structure: input.structureSeed, foliage: input.foliageSeed },
          input.parts,
        );
        artifact = withArtifactHash({
          kind: "material", stage: "material", nodeId, seed, lineage: lineageFor(node, [input]),
          genome: materialGenome, environment: input.environment, graph: parts.build.graph,
          template: parts.build.template, stats: parts.build.stats,
        });
      } else if (genome.spaceColonization) {
        const input = spaceColonizationPartsArtifact(node, dependencies);
        if (input.foliageSeed === null) throw new ProcPlantProductionDagError(`${node.id} requires a populated space-colonization foliage artifact`);
        const materialGenome = cloneGenomeForMaterial(input.genome, node);
        const parts = buildSpaceColonizedProcPlantStageParts(
          materialGenome, { growth: input.growthSeed, foliage: input.foliageSeed }, input.environment,
        );
        const template = materializeProcPlantParts(materialGenome, parts);
        artifact = withArtifactHash({
          kind: "material", stage: "material", nodeId, seed, lineage: lineageFor(node, [input]),
          genome: materialGenome, environment: input.environment, graph: parts.graph, template,
          stats: { ...parts.stats, triangles: template.idx.length / 3 },
        });
      } else if (genome.branchModules) {
        const input = branchModulePartsArtifact(node, dependencies, "foliage");
        if (input.foliageSeed === null) throw new ProcPlantProductionDagError(`${node.id} requires a populated branch-module foliage artifact`);
        const materialGenome = cloneGenomeForMaterial(input.genome, node);
        materialGenome.branchModules = {
          ...materialGenome.branchModules!,
          leafColor: Number(node.parameters?.leafColorA ?? materialGenome.leaf.colorA),
        };
        const parts = buildBranchModuleProcPlantStageParts(
          materialGenome, { structure: input.structureSeed, foliage: input.foliageSeed }, input.environment,
        );
        const template = materializeBranchModuleProcPlantParts(parts);
        artifact = withArtifactHash({
          kind: "material", stage: "material", nodeId, seed, lineage: lineageFor(node, [input]),
          genome: materialGenome, environment: input.environment, graph: parts.graph, template,
          stats: { ...parts.stats, triangles: template.idx.length / 3 },
        });
      } else {
        const inputs = graphArtifacts(node, dependencies);
        const terminal = genome.vine ? guidedVineTerminalGraphArtifact(node, dependencies) : null;
        const base = terminal
          ? cloneGraph(terminal.graph)
          : bespokeBroadPatch
            ? mergeBespokeBroadPatchArtifacts(inputs)
            : mergeGraphArtifacts(inputs);
        const materialGenome = cloneGenomeForMaterial(terminal?.genome ?? inputs[0]!.genome, node);
        const materialEnvironment = terminal?.environment ?? inputs[0]!.environment;
        const build = buildProcPlantTemplateFromGraph(materialGenome, base, materialEnvironment);
        artifact = withArtifactHash({
          kind: "material", stage: "material", nodeId, seed, lineage: lineageFor(node, inputs),
          genome: materialGenome, environment: materialEnvironment, graph: build.graph,
          template: build.template, stats: build.stats,
        });
      }
    } else if (node.stage === "lod") {
      const materials = scopedDependencies.filter((entry): entry is ProcPlantMaterialStageArtifact => entry.kind === "material");
      const deformations = scopedDependencies.filter((entry): entry is ProcPlantGraphStageArtifact | ProcPlantSpaceColonizationPartsStageArtifact | ProcPlantBranchModulePartsStageArtifact | ProcPlantWeberPennPartsStageArtifact =>
        (entry.kind === "graph" || entry.kind === "space-colonization-parts" || entry.kind === "branch-module-parts" || entry.kind === "weber-penn-parts") && entry.stage === "deformation");
      if (materials.length !== 1) throw new ProcPlantProductionDagError(`${node.id} requires exactly one material artifact`);
      if (deformations.length > 1) throw new ProcPlantProductionDagError(`${node.id} accepts at most one deformation artifact`);
      const material = materials[0]!;
      const levels = node.parameters?.levels;
      if (!Array.isArray(levels) || levels.length < 1 || levels.some((level) => !Number.isInteger(level) || Number(level) < 0 || Number(level) > 3)) {
        throw new ProcPlantProductionDagError(`${node.id}.parameters.levels must contain LOD indices 0..3`);
      }
      const lods = compileProcPlantLodsFromTemplate(material.genome, material.template, levels as (0 | 1 | 2 | 3)[]);
      artifact = withArtifactHash({
        kind: "lod", stage: "lod", nodeId, seed, lineage: lineageFor(node, scopedDependencies),
        genome: material.genome, graph: material.graph, lods, stats: material.stats,
        runtime: deformations[0]?.runtime ?? { windFlex: material.genome.treeRealism?.windFlex ?? 0.35, phototropism: material.genome.lightResponse.phototropism },
      });
    } else {
      const lods = scopedDependencies.filter((entry): entry is ProcPlantLodStageArtifact => entry.kind === "lod");
      if (lods.length !== 1) throw new ProcPlantProductionDagError(`${node.id} requires exactly one LOD artifact`);
      const input = lods[0]!;
      const full = input.lods.find((lod) => lod.level === 0);
      if (!full) throw new ProcPlantProductionDagError(`${node.id} requires LOD level 0 for runtime output`);
      artifact = withArtifactHash({
        kind: "output", stage: "output", nodeId, seed, lineage: lineageFor(node, lods),
        build: { template: full.template, graph: input.graph, stats: { ...input.stats, triangles: full.triangles } },
        lods: input.lods, runtime: input.runtime,
      });
    }
    const boundedGraph = artifact.kind === "graph" ? artifact.graph
      : artifact.kind === "space-colonization-parts" ? artifact.parts.graph
      : artifact.kind === "branch-module-parts" ? artifact.parts.graph
        : null;
    if (boundedGraph && (boundedGraph.stems.length > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_STEMS || boundedGraph.organs.length > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_ORGANS)) {
      throw new ProcPlantProductionDagError(`${node.id} exceeds production graph geometry caps`);
    }
    const materializedWork = artifactWork(artifact);
    work += materializedWork;
    if (work > maximumWork) throw new ProcPlantProductionDagError(`production DAG exceeds the ${maximumWork} work cap at ${node.id}`);
    artifacts[nodeId] = artifact;
    records.push({
      nodeId, stage: node.stage, seed, status: "executed", dependencyIds,
      artifactKind: artifact.kind, artifactHash: artifact.hash, work: operationWork + materializedWork,
    });
  }
  const outputs = Object.values(artifacts).filter((artifact): artifact is ProcPlantOutputStageArtifact => artifact.kind === "output");
  if (outputs.length !== 1) throw new ProcPlantProductionDagError(`production DAG must produce exactly one enabled output artifact; received ${outputs.length}`);
  const output = outputs[0]!;
  return {
    version: PROCPLANT_PRODUCTION_DAG_RESULT_VERSION,
    path: "typed-artifacts",
    graph,
    previewHash: preview.hash,
    artifacts,
    records,
    build: output.build,
    lods: output.lods,
    work,
  };
};
