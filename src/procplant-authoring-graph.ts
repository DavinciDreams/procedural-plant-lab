import type { ProcPlantGenome } from "./procplants";
import { PROCPLANT_GENERATOR_CONTRACT_REVISION } from "./procplant-contract";
import {
  cloneProcPlantFreeformCrown,
  validateProcPlantFreeformCrown,
  type ProcPlantFreeformCrown,
} from "./procplant-space-colonization";
import {
  createProcPlantGeneratorGraph,
  createProcPlantGeneratorNodeId,
  deriveProcPlantGeneratorNodeSeed,
  evaluateProcPlantGeneratorCurve,
  summarizeProcPlantGeneratorGraph,
  validateProcPlantGeneratorGraph,
  type ProcPlantGeneratorGraph,
  type ProcPlantGeneratorNode,
  type ProcPlantGeneratorPreviewSummary,
} from "./procplant-generator-graph";

const curveMean = (curve: { base: number; tip: number }) => (curve.base + curve.tip) * 0.5;

export const createProcPlantAuthoringGraph = (
  genome: ProcPlantGenome,
  seed = 1,
): ProcPlantGeneratorGraph => {
  const namespace = `genome:${genome.id}`;
  const ids = {
    source: createProcPlantGeneratorNodeId("source", "Genome source", namespace),
    architecture: createProcPlantGeneratorNodeId("architecture", "Primary architecture", namespace),
    branching: createProcPlantGeneratorNodeId("branching", "Branch hierarchy", namespace),
    foliage: createProcPlantGeneratorNodeId("foliage", "Foliage organs", namespace),
    reproductive: createProcPlantGeneratorNodeId("reproductive", "Flowers and accessories", namespace),
    deformation: createProcPlantGeneratorNodeId("deformation", "Environment and wind", namespace),
    material: createProcPlantGeneratorNodeId("material", "Plant materials", namespace),
    lod: createProcPlantGeneratorNodeId("lod", "Runtime LODs", namespace),
    output: createProcPlantGeneratorNodeId("output", "Runtime package", namespace),
  };
  const branchCount = genome.weberPenn?.maxStems
    ?? genome.branchModules?.moduleBudget
    ?? genome.spaceColonization?.maxNodes
    ?? Math.max(1, Math.round(genome.nodeCount * curveMean(genome.branchChance)));
  const foliageCount = genome.weberPenn?.maxLeaves
    ?? genome.spaceColonization?.terminalLeafCount
    ?? Math.max(1, Math.round(genome.nodeCount * curveMean(genome.leaf.density)));
  const reproductiveCount = (genome.flower?.petals ?? 0)
    + (genome.accessoryOrgans ?? []).reduce((sum, organ) => sum + organ.count, 0);
  const backend = genome.weberPenn
    ? "weber-penn"
    : genome.branchModules
      ? "branch-module-graph"
      : genome.spaceColonization
        ? "space-colonization"
      : genome.vine
        ? "guided-vine"
        : "procplant-graph";

  return createProcPlantGeneratorGraph([
    {
      id: ids.source,
      label: "Genome source",
      stage: "source",
      enabled: true,
      dependsOn: [],
      count: 1,
      placement: { mode: "origin" },
      parameters: { genomeId: genome.id, habit: genome.habit, backend },
    },
    {
      id: ids.architecture,
      label: "Primary architecture",
      stage: "architecture",
      enabled: true,
      dependsOn: [ids.source],
      count: genome.spaceColonization?.attractorCount ?? genome.nodeCount,
      placement: { mode: "nodes", spacing: curveMean(genome.internode) },
      parentScope: { mode: "root" },
      curve: { ...genome.internode },
      parameters: {
        apicalDominance: genome.apicalDominance,
        phyllotaxisAngle: genome.phyllotaxisAngle,
        ...(genome.spaceColonization?.freeform
          ? { freeformCrown: cloneProcPlantFreeformCrown(genome.spaceColonization.freeform) }
          : {}),
      },
    },
    {
      id: ids.branching,
      label: "Branch hierarchy",
      stage: "branching",
      enabled: branchCount > 0,
      dependsOn: [ids.architecture],
      count: branchCount,
      placement: { mode: "nodes", density: curveMean(genome.branchChance) },
      parentScope: {
        mode: "stages",
        stages: ["architecture", "branching"],
        maxDepth: genome.weberPenn?.maxBranchDepth ?? genome.branchModules?.levels,
      },
      curve: { ...genome.branchChance },
      parameters: { angle: { ...genome.branchAngle }, backend },
    },
    {
      id: ids.foliage,
      label: "Foliage organs",
      stage: "foliage",
      enabled: foliageCount > 0,
      dependsOn: [ids.architecture, ids.branching],
      count: foliageCount,
      placement: {
        mode: genome.weberPenn || genome.branchModules ? "tips" : "nodes",
        density: curveMean(genome.leaf.density),
      },
      parentScope: { mode: "stages", stages: ["architecture", "branching"] },
      curve: { ...genome.leaf.length },
      parameters: {
        shape: genome.leaf.shape,
        phyllotaxy: genome.phyllotaxy?.mode ?? "spiral",
        foliageKind: genome.moss
          ? "mossTuft"
          : genome.habit === "conifer"
            ? "coniferSpray"
            : genome.habit === "fern"
              ? "fernFrond"
              : genome.habit === "palm"
                ? "palmFrond"
                : "leaf",
      },
    },
    {
      id: ids.reproductive,
      label: "Flowers and accessories",
      stage: "reproductive",
      enabled: reproductiveCount > 0,
      dependsOn: [ids.architecture, ids.branching],
      count: reproductiveCount,
      placement: { mode: "tips", density: genome.groundcover?.flowerRate ?? 1 },
      parentScope: { mode: "stages", stages: ["architecture", "branching"] },
      parameters: {
        flower: Boolean(genome.flower),
        accessories: (genome.accessoryOrgans ?? []).map((organ) => organ.kind),
      },
    },
    {
      id: ids.deformation,
      label: "Environment and wind",
      stage: "deformation",
      enabled: true,
      dependsOn: [ids.architecture, ids.branching, ids.foliage],
      count: 1,
      parentScope: { mode: "all" },
      parameters: {
        windFlex: genome.treeRealism?.windFlex ?? 0.35,
        phototropism: genome.lightResponse?.phototropism ?? 0,
      },
    },
    {
      id: ids.material,
      label: "Plant materials",
      stage: "material",
      enabled: true,
      dependsOn: [ids.foliage, ids.reproductive],
      count: 2,
      parentScope: { mode: "all" },
      parameters: { leafColorA: genome.leaf.colorA, leafColorB: genome.leaf.colorB },
    },
    {
      id: ids.lod,
      label: "Runtime LODs",
      stage: "lod",
      enabled: true,
      dependsOn: [ids.deformation, ids.material],
      count: 4,
      placement: { mode: "volume" },
      parameters: { levels: [0, 1, 2, 3] },
    },
    {
      id: ids.output,
      label: "Runtime package",
      stage: "output",
      enabled: true,
      dependsOn: [ids.lod],
      count: 1,
      parameters: { generatorContractRevision: PROCPLANT_GENERATOR_CONTRACT_REVISION },
    },
  ], seed >>> 0, { kind: "procplant-genome", id: genome.id, version: 1 });
};

export const previewProcPlantAuthoringGraph = (
  genome: ProcPlantGenome,
  seed = 1,
): ProcPlantGeneratorPreviewSummary => summarizeProcPlantGeneratorGraph(
  createProcPlantAuthoringGraph(genome, seed),
);

export const PROCPLANT_AUTHORING_GENOME_ADAPTER_VERSION = 2 as const;

export type ProcPlantAuthoringGenomeControl =
  | "graph-seed"
  | "label"
  | "enabled"
  | "count"
  | "curve"
  | "dependencies"
  | "seed-override"
  | "placement"
  | "parent-scope"
  | "parameters";

export interface ProcPlantAuthoringGenomeAuditEntry {
  nodeId: string;
  stage: ProcPlantGeneratorNode["stage"];
  control: ProcPlantAuthoringGenomeControl;
  before: unknown;
  after: unknown;
  reason: string;
}

export interface ProcPlantAuthoringGenomeApplyResult {
  version: typeof PROCPLANT_AUTHORING_GENOME_ADAPTER_VERSION;
  genome: ProcPlantGenome;
  changed: boolean;
  applied: ProcPlantAuthoringGenomeAuditEntry[];
  unsupported: ProcPlantAuthoringGenomeAuditEntry[];
  executionSeed: number;
  executionRecords: Array<{
    nodeId: string;
    stage: ProcPlantGeneratorNode["stage"];
    seed: number;
    status: "executed" | "disabled";
    dependencyIds: string[];
    outputHash: string | null;
  }>;
}

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalValue(entry)]));
  }
  return value;
};

const sameValue = (left: unknown, right: unknown) =>
  JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));

const validGrowthCurve = (curve: { base: number; tip: number; curve: number }, bounded = false) =>
  [curve.base, curve.tip, curve.curve].every(Number.isFinite) &&
  curve.base >= 0 && curve.tip >= 0 && curve.curve > 0 &&
  (!bounded || (curve.base <= 1 && curve.tip <= 1));

const scaledDensityForCount = (
  source: { base: number; tip: number; curve: number },
  count: number,
  nodeCount: number,
) => {
  if (nodeCount <= 0 || count > nodeCount) return null;
  const desiredMean = count / nodeCount;
  const mean = curveMean(source);
  if (mean <= 1e-12) return { base: desiredMean, tip: desiredMean, curve: source.curve };
  const scale = desiredMean / mean;
  const next = { base: source.base * scale, tip: source.tip * scale, curve: source.curve };
  return next.base <= 1 && next.tip <= 1 ? next : null;
};

/**
 * Apply the canonical graph controls that have real ProcPlantGenome compiler seams.
 * Dependency and other DAG-only changes are audited but never claimed as compiler changes.
 */
const applyLegacyProcPlantAuthoringGraphToGenome = (
  source: ProcPlantGenome,
  graph: ProcPlantGeneratorGraph,
  canonicalSeed = graph.seed,
): ProcPlantAuthoringGenomeApplyResult => {
  validateProcPlantGeneratorGraph(graph);
  const canonical = createProcPlantAuthoringGraph(source, canonicalSeed);
  const expectedById = new Map(canonical.nodes.map((node) => [node.id, node]));
  const actualById = new Map(graph.nodes.map((node) => [node.id, node]));
  const missing = canonical.nodes.filter((node) => !actualById.has(node.id)).map((node) => node.id);
  const extra = graph.nodes.filter((node) => !expectedById.has(node.id)).map((node) => node.id);
  if (missing.length || extra.length) {
    throw new Error(`authoring graph does not match genome ${source.id}; missing=[${missing.join(",")}], extra=[${extra.join(",")}]`);
  }
  for (const expected of canonical.nodes) {
    const actual = actualById.get(expected.id)!;
    if (actual.stage !== expected.stage) throw new Error(`authoring node ${actual.id} stage does not match genome ${source.id}`);
  }
  const sourceNode = graph.nodes.find((node) => node.stage === "source")!;
  if (sourceNode.parameters?.genomeId !== source.id) {
    throw new Error(`authoring graph genome identity ${String(sourceNode.parameters?.genomeId)} does not match ${source.id}`);
  }

  const applied: ProcPlantAuthoringGenomeAuditEntry[] = [];
  const unsupported: ProcPlantAuthoringGenomeAuditEntry[] = [];
  let next: ProcPlantGenome | null = null;
  const mutable = () => {
    if (!next) {
      next = {
        ...source,
        internode: { ...source.internode },
        branchChance: { ...source.branchChance },
        branchAngle: { ...source.branchAngle },
        leaf: {
          ...source.leaf,
          length: { ...source.leaf.length },
          density: { ...source.leaf.density },
        },
        foliage: source.foliage ? { ...source.foliage } : undefined,
        weberPenn: source.weberPenn ? { ...source.weberPenn } : undefined,
        branchModules: source.branchModules ? { ...source.branchModules } : undefined,
      };
    }
    return next;
  };
  const record = (
    destination: ProcPlantAuthoringGenomeAuditEntry[],
    node: ProcPlantGeneratorNode,
    control: ProcPlantAuthoringGenomeControl,
    before: unknown,
    after: unknown,
    reason: string,
  ) => destination.push({ nodeId: node.id, stage: node.stage, control, before, after, reason });

  if (graph.seed !== canonical.seed) {
    record(unsupported, sourceNode, "graph-seed", canonical.seed, graph.seed,
      "Graph seed affects DAG execution only; ProcPlantGenome has no seed field.");
  }

  for (const expected of canonical.nodes) {
    const actual = actualById.get(expected.id)!;
    if (actual.label !== expected.label) record(unsupported, actual, "label", expected.label, actual.label, "Node labels do not affect genome compilation.");
    if (!sameValue([...expected.dependsOn].sort(), [...actual.dependsOn].sort())) {
      record(unsupported, actual, "dependencies", expected.dependsOn, actual.dependsOn,
        "Dependency rewiring changes generic DAG execution, not the current ProcPlantGenome compiler.");
    }
    if (!sameValue(expected.seedOverride, actual.seedOverride)) {
      record(unsupported, actual, "seed-override", expected.seedOverride, actual.seedOverride,
        "Per-node seed overrides have no ProcPlantGenome field.");
    }
    if (!sameValue(expected.placement, actual.placement)) {
      record(unsupported, actual, "placement", expected.placement, actual.placement,
        "Placement controls are preview metadata for the current compiler.");
    }
    if (!sameValue(expected.parentScope, actual.parentScope)) {
      record(unsupported, actual, "parent-scope", expected.parentScope, actual.parentScope,
        "Parent scopes are preview metadata and do not rewrite compiler topology.");
    }
    if (!sameValue(expected.parameters, actual.parameters)) {
      record(unsupported, actual, "parameters", expected.parameters, actual.parameters,
        "Stage parameters are handler metadata; this adapter only maps enabled, count, and curve controls.");
    }

    const enabledChanged = actual.enabled !== expected.enabled;
    const countChanged = actual.count !== expected.count;
    const curveChanged = !sameValue(actual.curve, expected.curve);
    if (actual.stage === "architecture") {
      if (enabledChanged) {
        record(unsupported, actual, "enabled", expected.enabled, actual.enabled,
          "The current compiler requires a primary architecture; use its positive count and curve controls.");
      }
      if (countChanged) {
        if (source.weberPenn) {
          record(unsupported, actual, "count", expected.count, actual.count, "The Weber-Penn compiler derives architecture from its species tree, not genome.nodeCount.");
        } else if (actual.count !== undefined && actual.count >= 1) {
          mutable().nodeCount = actual.count;
          record(applied, actual, "count", expected.count, actual.count, "Mapped to genome.nodeCount.");
        } else {
          record(unsupported, actual, "count", expected.count, actual.count, "Architecture count must be at least one.");
        }
      }
      if (curveChanged) {
        if (source.weberPenn) {
          record(unsupported, actual, "curve", expected.curve, actual.curve, "The Weber-Penn compiler does not consume genome.internode.");
        } else if (actual.curve && validGrowthCurve(actual.curve)) {
          mutable().internode = { ...actual.curve };
          record(applied, actual, "curve", expected.curve, actual.curve, "Mapped to genome.internode.");
        } else {
          record(unsupported, actual, "curve", expected.curve, actual.curve, "Internode curve values must be finite, non-negative, and use a positive exponent.");
        }
      }
      continue;
    }

    if (actual.stage === "branching") {
      if (enabledChanged && !actual.enabled) {
        const genome = mutable();
        if (genome.weberPenn) genome.weberPenn.maxStems = 0;
        else if (genome.branchModules) genome.branchModules.moduleBudget = 0;
        else genome.branchChance = { ...genome.branchChance, base: 0, tip: 0 };
        record(applied, actual, "enabled", expected.enabled, actual.enabled,
          "Disabled the backend branch budget/chance; the compiler has no separate latent enabled flag.");
        if (countChanged) record(unsupported, actual, "count", expected.count, actual.count, "Branch count is masked by the disabled node.");
        if (curveChanged) record(unsupported, actual, "curve", expected.curve, actual.curve, "Branch curve is masked by the disabled node.");
        continue;
      }
      if (enabledChanged) {
        record(unsupported, actual, "enabled", expected.enabled, actual.enabled,
          "Enabling an empty branch stage requires a positive backend count or branch curve.");
      }
      if (curveChanged) {
        if (source.weberPenn || source.branchModules) {
          record(unsupported, actual, "curve", expected.curve, actual.curve,
            `${source.weberPenn ? "Weber-Penn" : "Branch-module"} branching does not consume genome.branchChance.`);
        } else if (actual.curve && validGrowthCurve(actual.curve, true)) {
          mutable().branchChance = { ...actual.curve };
          record(applied, actual, "curve", expected.curve, actual.curve, "Mapped to genome.branchChance.");
        } else {
          record(unsupported, actual, "curve", expected.curve, actual.curve, "Branch chance curve must stay finite in [0, 1] with a positive exponent.");
        }
      }
      if (countChanged) {
        if (actual.count === undefined) {
          record(unsupported, actual, "count", expected.count, actual.count, "Branch count cannot be removed from the canonical projection.");
        } else if (source.weberPenn) {
          mutable().weberPenn!.maxStems = actual.count;
          record(applied, actual, "count", expected.count, actual.count, "Mapped to genome.weberPenn.maxStems.");
        } else if (source.branchModules) {
          mutable().branchModules!.moduleBudget = actual.count;
          record(applied, actual, "count", expected.count, actual.count, "Mapped to genome.branchModules.moduleBudget.");
        } else if (curveChanged && !source.weberPenn && !source.branchModules) {
          const projected = actual.curve && Math.max(1, Math.round((next ?? source).nodeCount * curveMean(actual.curve)));
          if (projected === actual.count) {
            record(applied, actual, "count", expected.count, actual.count, "Count agrees with the applied branchChance projection.");
          } else {
            record(unsupported, actual, "count", expected.count, actual.count, "Count conflicts with the explicit branch curve; the curve takes precedence.");
          }
        } else if (!source.weberPenn && !source.branchModules) {
          const current = next ?? source;
          const density = scaledDensityForCount(current.branchChance, actual.count, current.nodeCount);
          if (density) {
            mutable().branchChance = density;
            record(applied, actual, "count", expected.count, actual.count, "Rescaled genome.branchChance while preserving its base/tip ratio.");
          } else {
            record(unsupported, actual, "count", expected.count, actual.count, "Branch count cannot exceed the architecture node count without a backend budget field.");
          }
        } else {
          record(unsupported, actual, "count", expected.count, actual.count, "Backend branch count could not be mapped.");
        }
      }
      continue;
    }

    if (actual.stage === "foliage") {
      if (enabledChanged && !actual.enabled) {
        const genome = mutable();
        genome.leaf.density = { ...genome.leaf.density, base: 0, tip: 0 };
        if (genome.branchModules) {
          genome.foliage = genome.foliage
            ? { ...genome.foliage, mass: 0 }
            : { mass: 0, clusterDensity: 1.12, whorlDensity: 0.58, tipBias: 0.58, size: 0.48 };
        }
        if (genome.weberPenn) {
          genome.weberPenn.maxLeaves = 0;
          genome.weberPenn.nativeLeaves = false;
          genome.weberPenn.crownFill = false;
          if (genome.foliage) genome.foliage.mass = 0;
        }
        record(applied, actual, "enabled", expected.enabled, actual.enabled,
          "Disabled leaf density and Weber-Penn native/crown-fill foliage where present.");
        if (countChanged) record(unsupported, actual, "count", expected.count, actual.count, "Foliage count is masked by the disabled node.");
        if (curveChanged) record(unsupported, actual, "curve", expected.curve, actual.curve, "Leaf length curve is masked by the disabled node.");
        continue;
      }
      if (enabledChanged) {
        record(unsupported, actual, "enabled", expected.enabled, actual.enabled,
          "Enabling empty foliage requires a positive count; there is no standalone genome enabled flag.");
      }
      if (curveChanged) {
        if (actual.curve && validGrowthCurve(actual.curve)) {
          mutable().leaf.length = { ...actual.curve };
          record(applied, actual, "curve", expected.curve, actual.curve, "Mapped to genome.leaf.length.");
        } else {
          record(unsupported, actual, "curve", expected.curve, actual.curve, "Leaf length curve values must be finite, non-negative, and use a positive exponent.");
        }
      }
      if (countChanged) {
        if (actual.count === undefined) {
          record(unsupported, actual, "count", expected.count, actual.count, "Foliage count cannot be removed from the canonical projection.");
        } else if (source.weberPenn) {
          mutable().weberPenn!.maxLeaves = actual.count;
          record(applied, actual, "count", expected.count, actual.count, "Mapped to genome.weberPenn.maxLeaves.");
        } else if (source.branchModules) {
          record(unsupported, actual, "count", expected.count, actual.count,
            "Branch-module foliage count is controlled by anchors and foliage mass, not genome.leaf.density.");
        } else {
          const current = next ?? source;
          const density = scaledDensityForCount(current.leaf.density, actual.count, current.nodeCount);
          if (density) {
            mutable().leaf.density = density;
            record(applied, actual, "count", expected.count, actual.count, "Rescaled genome.leaf.density while preserving its base/tip ratio.");
          } else {
            record(unsupported, actual, "count", expected.count, actual.count, "Foliage count cannot exceed architecture node count for this backend.");
          }
        }
      }
      continue;
    }

    if (enabledChanged) record(unsupported, actual, "enabled", expected.enabled, actual.enabled, `${actual.stage} enabled state has no mapped ProcPlantGenome compiler control.`);
    if (countChanged) record(unsupported, actual, "count", expected.count, actual.count, `${actual.stage} count has no mapped ProcPlantGenome compiler control.`);
    if (curveChanged) record(unsupported, actual, "curve", expected.curve, actual.curve, `${actual.stage} curve has no mapped ProcPlantGenome compiler control.`);
  }

  return {
    version: PROCPLANT_AUTHORING_GENOME_ADAPTER_VERSION,
    genome: next ?? source,
    changed: next !== null,
    applied,
    unsupported,
    executionSeed: graph.seed,
    executionRecords: [],
  };
};

const AUTHORING_DEPENDENCY_STAGES: Record<ProcPlantGeneratorNode["stage"], ReadonlySet<ProcPlantGeneratorNode["stage"]>> = {
  source: new Set(),
  architecture: new Set(["source"]),
  branching: new Set(["source", "architecture"]),
  foliage: new Set(["source", "architecture", "branching"]),
  reproductive: new Set(["source", "architecture", "branching"]),
  deformation: new Set(["source", "architecture", "branching", "foliage"]),
  material: new Set(["source", "foliage", "reproductive"]),
  lod: new Set(["deformation", "material"]),
  output: new Set(["lod"]),
};

const hashText = (value: string, seed = 0x811c9dc5) => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const assertParameterKeys = (node: ProcPlantGeneratorNode, keys: readonly string[]) => {
  const actual = Object.keys(node.parameters ?? {}).sort();
  const expected = [...keys].sort();
  if (!sameValue(actual, expected)) {
    throw new Error(`${node.id}.parameters must contain only the stage allow-list: ${expected.join(", ")}`);
  }
};

const assertNumberParameter = (value: unknown, label: string, minimum: number, maximum: number) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be finite in [${minimum}, ${maximum}]`);
  }
  return value;
};

const validateAuthoringParameters = (
  node: ProcPlantGeneratorNode,
  expected: ProcPlantGeneratorNode,
) => {
  const parameters = node.parameters ?? {};
  if (node.stage === "source") {
    assertParameterKeys(node, ["backend", "genomeId", "habit"]);
    if (!sameValue(parameters, expected.parameters)) throw new Error(`${node.id}.parameters are immutable source identity fields`);
  } else if (node.stage === "architecture") {
    const expectsFreeform = expected.parameters?.freeformCrown !== undefined;
    assertParameterKeys(node, ["apicalDominance", "phyllotaxisAngle", ...(expectsFreeform ? ["freeformCrown"] : [])]);
    assertNumberParameter(parameters.apicalDominance, `${node.id}.parameters.apicalDominance`, 0, 1);
    assertNumberParameter(parameters.phyllotaxisAngle, `${node.id}.parameters.phyllotaxisAngle`, -Math.PI * 2, Math.PI * 2);
    if (expectsFreeform) validateProcPlantFreeformCrown(parameters.freeformCrown as ProcPlantFreeformCrown);
  } else if (node.stage === "branching") {
    assertParameterKeys(node, ["angle", "backend"]);
    if (parameters.backend !== expected.parameters?.backend) throw new Error(`${node.id}.parameters.backend is immutable`);
    const angle = parameters.angle;
    if (!angle || typeof angle !== "object" || Array.isArray(angle)) throw new Error(`${node.id}.parameters.angle must be an object`);
    const angleRecord = angle as Record<string, unknown>;
    if (!sameValue(Object.keys(angleRecord).sort(), ["depthDecay", "mean", "spread"])) {
      throw new Error(`${node.id}.parameters.angle must contain mean, spread, and depthDecay only`);
    }
    assertNumberParameter(angleRecord.mean, `${node.id}.parameters.angle.mean`, 0, Math.PI);
    assertNumberParameter(angleRecord.spread, `${node.id}.parameters.angle.spread`, 0, Math.PI);
    assertNumberParameter(angleRecord.depthDecay, `${node.id}.parameters.angle.depthDecay`, 0, 1);
  } else if (node.stage === "foliage") {
    assertParameterKeys(node, ["foliageKind", "phyllotaxy", "shape"]);
    if (parameters.foliageKind !== expected.parameters?.foliageKind) throw new Error(`${node.id}.parameters.foliageKind is backend-derived and immutable`);
    const shapes = new Set(["lanceolate", "ovate", "cordate", "palmate", "spatulate", "fan", "linear", "round", "frond", "blade"]);
    const phyllotaxy = new Set(["spiral", "alternate", "opposite", "decussate", "whorled"]);
    if (!shapes.has(String(parameters.shape))) throw new Error(`${node.id}.parameters.shape is invalid`);
    if (!phyllotaxy.has(String(parameters.phyllotaxy))) throw new Error(`${node.id}.parameters.phyllotaxy is invalid`);
  } else if (node.stage === "reproductive") {
    assertParameterKeys(node, ["accessories", "flower"]);
    if (typeof parameters.flower !== "boolean") throw new Error(`${node.id}.parameters.flower must be boolean`);
    if (!Array.isArray(parameters.accessories) || parameters.accessories.some((kind) => typeof kind !== "string")) {
      throw new Error(`${node.id}.parameters.accessories must be an array of existing accessory kinds`);
    }
    const existing = new Set((expected.parameters?.accessories as string[] | undefined) ?? []);
    if ((parameters.accessories as string[]).some((kind) => !existing.has(kind))) {
      throw new Error(`${node.id}.parameters.accessories cannot introduce an accessory gene`);
    }
  } else if (node.stage === "deformation") {
    assertParameterKeys(node, ["phototropism", "windFlex"]);
    assertNumberParameter(parameters.windFlex, `${node.id}.parameters.windFlex`, 0, 2);
    assertNumberParameter(parameters.phototropism, `${node.id}.parameters.phototropism`, 0, 1);
  } else if (node.stage === "material") {
    assertParameterKeys(node, ["leafColorA", "leafColorB"]);
    for (const key of ["leafColorA", "leafColorB"] as const) {
      const value = parameters[key];
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffff) {
        throw new Error(`${node.id}.parameters.${key} must be a 24-bit integer color`);
      }
    }
  } else if (node.stage === "lod") {
    assertParameterKeys(node, ["levels"]);
    if (!Array.isArray(parameters.levels) || parameters.levels.some((level) => !Number.isInteger(level) || (level as number) < 0 || (level as number) > 3)) {
      throw new Error(`${node.id}.parameters.levels must contain LOD indices 0..3`);
    }
  } else {
    assertParameterKeys(node, ["generatorContractRevision"]);
    if (!Number.isInteger(parameters.generatorContractRevision) || (parameters.generatorContractRevision as number) < 1) {
      throw new Error(`${node.id}.parameters.generatorContractRevision must be a positive integer`);
    }
  }
};

const projectGeneratorCurve = (curve: NonNullable<ProcPlantGeneratorNode["curve"]>) => {
  if (!curve.points?.length) return { base: curve.base, tip: curve.tip, curve: curve.curve };
  const samples = 64;
  let integral = 0;
  for (let index = 0; index <= samples; index++) {
    const value = evaluateProcPlantGeneratorCurve(curve, index / samples);
    integral += value * (index === 0 || index === samples ? 0.5 : 1);
  }
  const mean = integral / samples;
  const base = evaluateProcPlantGeneratorCurve(curve, 0);
  const tip = evaluateProcPlantGeneratorCurve(curve, 1);
  const delta = tip - base;
  const denominator = mean - base;
  const exponent = Math.abs(delta) < 1e-12 || Math.abs(denominator) < 1e-12
    ? curve.curve
    : Math.max(0.05, Math.min(12, delta / denominator - 1));
  return { base, tip, curve: exponent };
};

interface AuthoringHandlerContext {
  node: ProcPlantGeneratorNode;
  expected: ProcPlantGeneratorNode;
  read: () => ProcPlantGenome;
  mutate: () => ProcPlantGenome;
  recordApplied: (control: ProcPlantAuthoringGenomeControl, before: unknown, after: unknown, reason: string) => void;
  recordUnsupported: (control: ProcPlantAuthoringGenomeControl, before: unknown, after: unknown, reason: string) => void;
  dependencies: ReadonlyMap<string, AuthoringStageOutput>;
  expectedDependencyCapacity: number;
}

interface AuthoringStageOutput {
  stage: ProcPlantGeneratorNode["stage"];
  capacity: number;
  hash: string;
}

type AuthoringStageHandler = (context: AuthoringHandlerContext) => void;

const AUTHORING_STAGE_HANDLERS: Record<ProcPlantGeneratorNode["stage"], AuthoringStageHandler> = {
  source: () => {},
  architecture: ({ node, expected, mutate, recordApplied }) => {
    if (sameValue(node.parameters, expected.parameters)) return;
    const genome = mutate();
    genome.apicalDominance = node.parameters!.apicalDominance as number;
    genome.phyllotaxisAngle = node.parameters!.phyllotaxisAngle as number;
    if (genome.spaceColonization && node.parameters!.freeformCrown) {
      genome.spaceColonization = {
        ...genome.spaceColonization,
        freeform: cloneProcPlantFreeformCrown(node.parameters!.freeformCrown as ProcPlantFreeformCrown),
      };
    }
    recordApplied("parameters", expected.parameters, node.parameters, "Applied allow-listed architecture controls.");
  },
  branching: ({ node, expected, mutate, recordApplied }) => {
    if (sameValue(node.parameters, expected.parameters)) return;
    const angle = node.parameters!.angle as ProcPlantGenome["branchAngle"];
    mutate().branchAngle = { ...angle };
    recordApplied("parameters", expected.parameters, node.parameters, "Applied allow-listed branch angle controls.");
  },
  foliage: ({ node, expected, read, mutate, recordApplied, recordUnsupported, dependencies, expectedDependencyCapacity }) => {
    if (!sameValue(node.parameters, expected.parameters)) {
      const genome = mutate();
      genome.leaf.shape = node.parameters!.shape as ProcPlantGenome["leaf"]["shape"];
      const mode = node.parameters!.phyllotaxy as NonNullable<ProcPlantGenome["phyllotaxy"]>["mode"];
      genome.phyllotaxy = { ...(genome.phyllotaxy ?? { mode }), mode };
      recordApplied("parameters", expected.parameters, node.parameters, "Applied allow-listed leaf shape and phyllotaxy controls.");
    }
    if (!sameValue([...node.dependsOn].sort(), [...expected.dependsOn].sort())) {
      const structuralInputs = [...dependencies.values()].filter((output) => output.stage === "architecture" || output.stage === "branching");
      const architectureInput = structuralInputs.find((output) => output.stage === "architecture");
      const capacity = structuralInputs.reduce((sum, output) => sum + output.capacity, 0);
      const density = architectureInput && node.count !== undefined
        ? scaledDensityForCount(read().leaf.density, node.count, capacity)
        : null;
      if (density) {
        const genome = mutate();
        genome.leaf.density = density;
        if (expectedDependencyCapacity > 0 && capacity > 0) {
          const sizeScale = Math.sqrt(capacity / expectedDependencyCapacity);
          genome.leaf.length = {
            ...genome.leaf.length,
            base: genome.leaf.length.base * sizeScale,
            tip: genome.leaf.length.tip * sizeScale,
          };
        }
        recordApplied("dependencies", expected.dependsOn, node.dependsOn,
          "Foliage consumed rewired architecture/branching capacity outputs and recompiled leaf density and scale.");
      } else {
        recordUnsupported("dependencies", expected.dependsOn, node.dependsOn,
          "Rewired foliage inputs do not provide a representable structural capacity.");
      }
    }
  },
  reproductive: ({ node, expected, read, mutate, recordApplied, recordUnsupported }) => {
    if (!sameValue(node.parameters, expected.parameters)) {
      const wantsFlower = node.parameters!.flower as boolean;
      const accessories = node.parameters!.accessories as string[];
      if (wantsFlower && !expected.parameters!.flower) {
        recordUnsupported("parameters", expected.parameters, node.parameters, "A flower gene cannot be synthesized by the canonical DAG.");
      } else {
        const genome = mutate();
        if (!wantsFlower) genome.flower = undefined;
        if (genome.accessoryOrgans) genome.accessoryOrgans = genome.accessoryOrgans.filter((gene) => accessories.includes(gene.kind));
        recordApplied("parameters", expected.parameters, node.parameters, "Filtered existing reproductive genes without synthesizing new geometry genes.");
      }
    }
    if (node.count === expected.count || node.count === undefined) return;
    const current = read();
    if (current.flower && !(current.accessoryOrgans?.length)) {
      const genome = mutate();
      genome.flower = { ...current.flower, petals: Math.max(1, node.count) };
      recordApplied("count", expected.count, node.count, "Mapped reproductive count to flower petal count.");
    } else if (!current.flower && current.accessoryOrgans?.length === 1) {
      const genome = mutate();
      genome.accessoryOrgans = [{ ...current.accessoryOrgans[0]!, count: node.count }];
      recordApplied("count", expected.count, node.count, "Mapped reproductive count to the single accessory gene count.");
    } else {
      recordUnsupported("count", expected.count, node.count, "Mixed reproductive genes do not have one unambiguous count seam.");
    }
  },
  deformation: ({ node, expected, read, mutate, recordApplied, recordUnsupported }) => {
    if (!node.enabled && node.enabled !== expected.enabled) {
      const genome = mutate();
      if (genome.treeRealism) genome.treeRealism = { ...genome.treeRealism, windFlex: 0 };
      genome.lightResponse = { ...genome.lightResponse, phototropism: 0 };
      recordApplied("enabled", expected.enabled, node.enabled, "Disabled mapped wind-flex and phototropism deformation controls.");
    }
    if (sameValue(node.parameters, expected.parameters)) return;
    const windFlex = node.parameters!.windFlex as number;
    const phototropism = node.parameters!.phototropism as number;
    let mapped = false;
    if (windFlex !== expected.parameters!.windFlex && read().treeRealism) {
      const genome = mutate();
      genome.treeRealism = { ...genome.treeRealism!, windFlex };
      mapped = true;
    } else if (windFlex !== expected.parameters!.windFlex) {
      recordUnsupported("parameters", expected.parameters!.windFlex, windFlex, "This genome has no treeRealism wind-flex compiler seam.");
    }
    if (phototropism !== expected.parameters!.phototropism) {
      const genome = mutate();
      genome.lightResponse = { ...genome.lightResponse, phototropism };
      mapped = true;
    }
    if (mapped) recordApplied("parameters", expected.parameters, node.parameters, "Applied available deformation controls.");
  },
  material: ({ node, expected, mutate, recordApplied }) => {
    if (sameValue(node.parameters, expected.parameters)) return;
    const genome = mutate();
    genome.leaf = {
      ...genome.leaf,
      colorA: node.parameters!.leafColorA as number,
      colorB: node.parameters!.leafColorB as number,
    };
    recordApplied("parameters", expected.parameters, node.parameters, "Applied leaf material colors.");
  },
  lod: ({ node, expected, recordUnsupported }) => {
    if (!sameValue(node.parameters, expected.parameters)) {
      recordUnsupported("parameters", expected.parameters, node.parameters, "The monolithic LOD compiler always emits its fixed supported level set.");
    }
  },
  output: ({ node, expected, recordUnsupported }) => {
    if (!sameValue(node.parameters, expected.parameters)) {
      recordUnsupported("parameters", expected.parameters, node.parameters, "Runtime package contract revision is not mutable through a genome.");
    }
  },
};

/** Execute the canonical nine-stage DAG through built-in, allow-listed handlers. */
export const applyProcPlantAuthoringGraphToGenome = (
  source: ProcPlantGenome,
  graph: ProcPlantGeneratorGraph,
  canonicalSeed = graph.seed,
): ProcPlantAuthoringGenomeApplyResult => {
  const order = validateProcPlantGeneratorGraph(graph);
  const canonical = createProcPlantAuthoringGraph(source, canonicalSeed);
  if (!graph.target || graph.target.kind !== "procplant-genome" || graph.target.version !== 1 || graph.target.id !== source.id) {
    throw new Error(`authoring graph target does not match genome ${source.id}`);
  }
  const expectedById = new Map(canonical.nodes.map((node) => [node.id, node]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    const expected = expectedById.get(node.id);
    if (!expected || expected.stage !== node.stage) throw new Error(`authoring node ${node.id} is not part of target ${source.id}`);
    validateAuthoringParameters(node, expected);
    for (const dependencyId of node.dependsOn) {
      const dependency = nodeById.get(dependencyId)!;
      if (!AUTHORING_DEPENDENCY_STAGES[node.stage].has(dependency.stage)) {
        throw new Error(`${node.id} cannot consume ${dependency.stage} output from ${dependency.id}`);
      }
    }
    if (node.stage !== "source" && node.enabled && node.dependsOn.length === 0) {
      throw new Error(`${node.id} requires at least one dependency output`);
    }
    if (node.parentScope?.mode === "nodes") {
      const closure = new Set<string>();
      const visit = (id: string) => {
        for (const dependency of nodeById.get(id)?.dependsOn ?? []) {
          if (!closure.has(dependency)) { closure.add(dependency); visit(dependency); }
        }
      };
      visit(node.id);
      if (node.parentScope.nodeIds.some((id) => !closure.has(id))) throw new Error(`${node.id}.parentScope references a node outside its dependency ancestry`);
    }
    if (node.parentScope?.mode === "stages") {
      const dependencyStages = new Set(node.dependsOn.map((id) => nodeById.get(id)!.stage));
      dependencyStages.add(node.stage);
      if (node.parentScope.stages.some((stage) => !dependencyStages.has(stage))) {
        throw new Error(`${node.id}.parentScope references a stage outside its direct dependency outputs`);
      }
    }
  }

  const legacy = applyLegacyProcPlantAuthoringGraphToGenome(source, graph, canonicalSeed);
  const handledControls = new Set<ProcPlantAuthoringGenomeControl>([
    "graph-seed", "dependencies", "seed-override", "placement", "parent-scope", "parameters",
  ]);
  const applied = [...legacy.applied];
  const unsupported = legacy.unsupported.filter((entry) => !handledControls.has(entry.control)
    && !(entry.stage === "reproductive" && entry.control === "count")
    && !(entry.stage === "deformation" && entry.control === "enabled"));
  let genome = legacy.genome;
  let changed = legacy.changed;
  const mutate = () => {
    if (genome === source || genome === legacy.genome && !legacy.changed) {
      genome = {
        ...genome,
        internode: { ...genome.internode },
        branchChance: { ...genome.branchChance },
        branchAngle: { ...genome.branchAngle },
        leaf: { ...genome.leaf, length: { ...genome.leaf.length }, density: { ...genome.leaf.density } },
        phyllotaxy: genome.phyllotaxy ? { ...genome.phyllotaxy } : undefined,
        flower: genome.flower ? { ...genome.flower } : undefined,
        accessoryOrgans: genome.accessoryOrgans?.map((gene) => ({ ...gene })),
        treeRealism: genome.treeRealism ? { ...genome.treeRealism } : undefined,
        lightResponse: { ...genome.lightResponse },
        groundcover: genome.groundcover ? { ...genome.groundcover } : undefined,
        weberPenn: genome.weberPenn ? { ...genome.weberPenn } : undefined,
        branchModules: genome.branchModules ? { ...genome.branchModules } : undefined,
      };
    }
    changed = true;
    return genome;
  };
  const recordFor = (
    destination: ProcPlantAuthoringGenomeAuditEntry[],
    node: ProcPlantGeneratorNode,
    control: ProcPlantAuthoringGenomeControl,
    before: unknown,
    after: unknown,
    reason: string,
  ) => destination.push({ nodeId: node.id, stage: node.stage, control, before, after, reason });

  const sourceNode = graph.nodes.find((node) => node.stage === "source")!;
  let executionChanged = false;
  if (graph.seed !== canonical.seed) {
    executionChanged = true;
    recordFor(applied, sourceNode, "graph-seed", canonical.seed, graph.seed, "Applied as the monolithic generator execution seed.");
  }
  const stageOutputs = new Map<string, AuthoringStageOutput>();
  const executionRecords: ProcPlantAuthoringGenomeApplyResult["executionRecords"] = [];
  for (const nodeId of order) {
    const node = nodeById.get(nodeId)!;
    const expected = expectedById.get(nodeId)!;
    const seed = node.seedOverride ?? deriveProcPlantGeneratorNodeSeed(graph.seed, node.id);
    const dependencyIds = [...node.dependsOn].sort();
    const dependencyChanged = !sameValue([...expected.dependsOn].sort(), dependencyIds);
    if (node.seedOverride !== expected.seedOverride) {
      if (node.enabled) {
        executionChanged = true;
        recordFor(applied, node, "seed-override", expected.seedOverride, node.seedOverride,
          "Projected deterministically into the generator's single global seed; true per-stage RNG streams are not exposed by the monolithic compiler.");
      } else {
        recordFor(unsupported, node, "seed-override", expected.seedOverride, node.seedOverride, "Disabled stages do not execute or consume a seed override.");
      }
    }
    if (!node.enabled && node.stage === "deformation" && node.enabled !== expected.enabled) {
      const next = mutate();
      if (next.treeRealism) next.treeRealism = { ...next.treeRealism, windFlex: 0 };
      next.lightResponse = { ...next.lightResponse, phototropism: 0 };
      recordFor(applied, node, "enabled", expected.enabled, node.enabled,
        "Disabled mapped wind-flex and phototropism deformation controls.");
    }
    if (!node.enabled) {
      executionRecords.push({ nodeId, stage: node.stage, seed, status: "disabled", dependencyIds, outputHash: null });
      continue;
    }
    const dependencies = new Map(dependencyIds.flatMap((id) => {
      const output = stageOutputs.get(id);
      return output ? [[id, output] as const] : [];
    }));
    const dependencyHashes = [...dependencies.values()].map((output) => output.hash);
    const outputHash = hashText(JSON.stringify(canonicalValue({ node, seed, dependencyHashes }))).toString(16).padStart(8, "0");
    const recordApplied = (control: ProcPlantAuthoringGenomeControl, before: unknown, after: unknown, reason: string) =>
      recordFor(applied, node, control, before, after, reason);
    const recordUnsupported = (control: ProcPlantAuthoringGenomeControl, before: unknown, after: unknown, reason: string) =>
      recordFor(unsupported, node, control, before, after, reason);
    const expectedDependencyCapacity = expected.dependsOn
      .map((id) => expectedById.get(id)?.count ?? 1)
      .reduce((sum, value) => sum + value, 0);
    AUTHORING_STAGE_HANDLERS[node.stage]({
      node, expected, read: () => genome, mutate, recordApplied, recordUnsupported, dependencies, expectedDependencyCapacity,
    });
    if (dependencyChanged && node.stage !== "foliage") {
      recordUnsupported("dependencies", expected.dependsOn, dependencyIds,
        "This valid wiring edit has no stage-output seam in the monolithic compiler.");
    }

    if (node.curve?.points?.length && !sameValue(node.curve, expected.curve)) {
      const projected = projectGeneratorCurve(node.curve);
      if (node.stage === "architecture") mutate().internode = projected;
      else if (node.stage === "branching" && !source.weberPenn && !source.branchModules) mutate().branchChance = projected;
      else if (node.stage === "foliage") mutate().leaf.length = projected;
      else recordUnsupported("curve", expected.curve, node.curve, `${node.stage} has no CurveGene projection seam.`);
      const entry = applied.find((candidate) => candidate.nodeId === node.id && candidate.control === "curve");
      if (entry) entry.reason = "Projected the monotone piecewise scalar profile into the closest supported CurveGene.";
    }

    if (!sameValue(node.placement, expected.placement)) {
      const before = expected.placement;
      const after = node.placement;
      if (after?.mode !== before?.mode) {
        recordUnsupported("placement", before, after, "Placement mode changes require an organ-level compiler, not the monolithic genome compiler.");
      } else if (node.stage === "architecture" && after?.spacing !== undefined && before?.spacing) {
        const ratio = after.spacing / before.spacing;
        const current = mutate().internode;
        mutate().internode = { ...current, base: current.base * ratio, tip: current.tip * ratio };
        recordApplied("placement", before, after, "Mapped node spacing to internode scale.");
      } else if (node.stage === "branching" && after?.density !== undefined && before?.density && !source.weberPenn && !source.branchModules) {
        const ratio = after.density / before.density;
        const current = mutate().branchChance;
        mutate().branchChance = { ...current, base: Math.min(1, current.base * ratio), tip: Math.min(1, current.tip * ratio) };
        recordApplied("placement", before, after, "Mapped node density to branch chance.");
      } else if (node.stage === "foliage" && after?.density !== undefined && before?.density && !source.weberPenn && !source.branchModules) {
        const ratio = after.density / before.density;
        const current = mutate().leaf.density;
        mutate().leaf.density = { ...current, base: Math.min(1, current.base * ratio), tip: Math.min(1, current.tip * ratio) };
        recordApplied("placement", before, after, "Mapped node density to leaf density.");
      } else if (node.stage === "reproductive" && after?.density !== undefined && genome.groundcover) {
        mutate().groundcover!.flowerRate = after.density;
        recordApplied("placement", before, after, "Mapped reproductive density to groundcover flower rate.");
      } else {
        recordUnsupported("placement", before, after, `${node.stage} placement has no safe genome compiler seam.`);
      }
    }

    if (!sameValue(node.parentScope, expected.parentScope)) {
      const before = expected.parentScope;
      const after = node.parentScope;
      if (node.stage === "branching" && after?.maxDepth !== undefined && source.weberPenn) {
        mutate().weberPenn!.maxBranchDepth = after.maxDepth;
        recordApplied("parent-scope", before, after, "Mapped parent maxDepth to Weber-Penn maxBranchDepth.");
      } else if (node.stage === "branching" && after?.maxDepth !== undefined && source.branchModules) {
        mutate().branchModules!.levels = after.maxDepth;
        recordApplied("parent-scope", before, after, "Mapped parent maxDepth to branch-module levels.");
      } else {
        recordUnsupported("parent-scope", before, after, "This parent scope cannot be represented by the monolithic genome compiler.");
      }
    }
    stageOutputs.set(node.id, { stage: node.stage, capacity: node.count ?? 1, hash: outputHash });
    executionRecords.push({ nodeId, stage: node.stage, seed, status: "executed", dependencyIds, outputHash });
  }

  const terminalHash = [...executionRecords].reverse().find((record) => record.outputHash)?.outputHash ?? "00000000";
  const executionSeed = executionChanged
    ? hashText(`${graph.seed}|${terminalHash}|${summarizeProcPlantGeneratorGraph(graph).hash}`, 0x9e3779b9)
    : graph.seed;
  return {
    version: PROCPLANT_AUTHORING_GENOME_ADAPTER_VERSION,
    genome: changed ? genome : source,
    changed,
    applied,
    unsupported,
    executionSeed,
    executionRecords,
  };
};
