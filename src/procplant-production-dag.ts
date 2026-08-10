import * as THREE from "three";
import {
  buildProcPlantGraphIr,
  buildProcPlantClumpStageParts,
  buildProcPlantTemplate,
  buildProcPlantTemplateFromGraph,
  compileProcPlantClumpStageLods,
  compileProcPlantLods,
  compileProcPlantLodsFromTemplate,
  createProcPlantClumpStagePlan,
  defaultPlantEnvironment,
  materializeProcPlantInstancedParts,
  type ProcPlantClumpStagePlan,
  type ProcPlantCompiledLod,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantGraph,
  type ProcPlantInstancedParts,
  type ProcPlantOrgan,
  type ProcPlantStats,
  type ProcPlantStemNode,
  type ProcPlantTemplate,
} from "./procplants";
import { createProcPlantAuthoringGraph } from "./procplant-authoring-graph";
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

const assertSupportedBackend = (genome: ProcPlantGenome) => {
  const unsupported = [
    genome.weberPenn && "weber-penn",
    genome.branchModules && "branch-module-graph",
    genome.spaceColonization && "space-colonization",
    genome.vine && "guided-vine",
    genome.grass && "grass-specialization",
    genome.fern && "fern-specialization",
    genome.groundcover && "groundcover-specialization",
    genome.moss && "moss-specialization",
    genome.clump && "clump-specialization",
  ].filter(Boolean);
  if (unsupported.length > 0) {
    throw new ProcPlantProductionDagError(`typed production DAG does not support backend features: ${unsupported.join(", ")}`);
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
    if (parameters.backend !== "procplant-graph") {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.backend is unsupported by the typed graph backend`);
    }
  } else if (node.stage === "architecture") {
    finite(parameters.apicalDominance, `${node.id}.parameters.apicalDominance`, 0, 1);
    finite(parameters.phyllotaxisAngle, `${node.id}.parameters.phyllotaxisAngle`, -Math.PI * 2, Math.PI * 2);
    if (parameters.freeformCrown !== undefined) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.freeformCrown requires the unsupported space-colonization backend`);
    }
    if ((node.count ?? 0) < 1) throw new ProcPlantProductionDagError(`${node.id}.count must be at least one`);
  } else if (node.stage === "branching") {
    if (parameters.backend !== "procplant-graph") {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.backend is unsupported by the typed graph backend`);
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
  } else if (node.stage === "foliage") {
    if (!["leaf", "coniferSpray", "palmFrond", "mossTuft"].includes(String(parameters.foliageKind))) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.foliageKind is unsupported by the typed graph backend`);
    }
    if (!["lanceolate", "ovate", "cordate", "palmate", "spatulate", "fan", "linear", "round", "frond", "blade"].includes(String(parameters.shape))) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.shape is unsupported by the typed graph backend`);
    }
    if (!["spiral", "alternate", "opposite", "decussate", "whorled"].includes(String(parameters.phyllotaxy))) {
      throw new ProcPlantProductionDagError(`${node.id}.parameters.phyllotaxy is unsupported by the typed graph backend`);
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

  const maximumWork = options.maxWork ?? PROCPLANT_PRODUCTION_DAG_MAX_WORK;
  if (!Number.isInteger(maximumWork) || maximumWork < 1 || maximumWork > PROCPLANT_PRODUCTION_DAG_MAX_WORK) {
    throw new ProcPlantProductionDagError(`maxWork must be an integer in 1..${PROCPLANT_PRODUCTION_DAG_MAX_WORK}`);
  }
  if (genome.clump && genome.clump.count > 1) {
    return compileProcPlantClumpProductionDag(genome, graph, canonical, order, environment, maximumWork);
  }
  assertSupportedBackend(genome);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    validateProductionNodeParameters(node, genome);
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
    const seed = node.seedOverride ?? deriveProcPlantGeneratorNodeSeed(graph.seed, node.id);
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
        apicalDominance: Number(node.parameters?.apicalDominance ?? source.genome.apicalDominance),
        phyllotaxisAngle: Number(node.parameters?.phyllotaxisAngle ?? source.genome.phyllotaxisAngle),
      };
      const builtGraph = createArchitectureGraph(architectureGenome, source.environment, node, seed);
      artifact = withArtifactHash({
        kind: "graph", stage: "architecture", nodeId, seed, lineage: lineageFor(node, sources),
        genome: architectureGenome, environment: source.environment, graph: builtGraph,
        runtime: { windFlex: architectureGenome.treeRealism?.windFlex ?? 0.35, phototropism: architectureGenome.lightResponse.phototropism },
      });
    } else if (node.stage === "branching") {
      const inputs = graphArtifacts(node, dependencies);
      const base = mergeGraphArtifacts(inputs);
      artifact = withArtifactHash({
        kind: "graph", stage: "branching", nodeId, seed, lineage: lineageFor(node, inputs),
        genome: inputs[0]!.genome, environment: inputs[0]!.environment,
        graph: addBranches(base, inputs[0]!.genome, node, seed), runtime: inputs[0]!.runtime,
      });
    } else if (node.stage === "foliage") {
      const inputs = graphArtifacts(node, dependencies);
      const base = mergeGraphArtifacts(inputs);
      const foliageGenome: ProcPlantGenome = {
        ...inputs[0]!.genome,
        leaf: { ...inputs[0]!.genome.leaf, shape: node.parameters?.shape as ProcPlantGenome["leaf"]["shape"] },
        phyllotaxy: {
          ...(inputs[0]!.genome.phyllotaxy ?? { mode: "spiral" as const }),
          mode: node.parameters?.phyllotaxy as NonNullable<ProcPlantGenome["phyllotaxy"]>["mode"],
        },
      };
      artifact = withArtifactHash({
        kind: "graph", stage: "foliage", nodeId, seed, lineage: lineageFor(node, inputs),
        genome: foliageGenome, environment: inputs[0]!.environment,
        graph: addFoliage(base, foliageGenome, node, seed), runtime: inputs[0]!.runtime,
      });
    } else if (node.stage === "reproductive") {
      const inputs = graphArtifacts(node, dependencies);
      const base = mergeGraphArtifacts(inputs);
      artifact = withArtifactHash({
        kind: "graph", stage: "reproductive", nodeId, seed, lineage: lineageFor(node, inputs),
        genome: inputs[0]!.genome, environment: inputs[0]!.environment,
        graph: addReproductiveOrgans(base, inputs[0]!.genome, node, seed), runtime: inputs[0]!.runtime,
      });
    } else if (node.stage === "deformation") {
      const inputs = graphArtifacts(node, dependencies);
      const base = mergeGraphArtifacts(inputs);
      artifact = withArtifactHash({
        kind: "graph", stage: "deformation", nodeId, seed, lineage: lineageFor(node, inputs),
        genome: inputs[0]!.genome, environment: inputs[0]!.environment, graph: base,
        runtime: {
          windFlex: Number(node.parameters?.windFlex ?? inputs[0]!.runtime.windFlex),
          phototropism: Number(node.parameters?.phototropism ?? inputs[0]!.runtime.phototropism),
        },
      });
    } else if (node.stage === "material") {
      const inputs = graphArtifacts(node, dependencies);
      const base = mergeGraphArtifacts(inputs);
      const materialGenome = cloneGenomeForMaterial(inputs[0]!.genome, node);
      const build = buildProcPlantTemplateFromGraph(materialGenome, base, inputs[0]!.environment);
      artifact = withArtifactHash({
        kind: "material", stage: "material", nodeId, seed, lineage: lineageFor(node, inputs),
        genome: materialGenome, environment: inputs[0]!.environment, graph: build.graph,
        template: build.template, stats: build.stats,
      });
    } else if (node.stage === "lod") {
      const materials = scopedDependencies.filter((entry): entry is ProcPlantMaterialStageArtifact => entry.kind === "material");
      const deformations = scopedDependencies.filter((entry): entry is ProcPlantGraphStageArtifact => entry.kind === "graph" && entry.stage === "deformation");
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
    if (artifact.kind === "graph" && (artifact.graph.stems.length > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_STEMS || artifact.graph.organs.length > PROCPLANT_PRODUCTION_DAG_MAX_GRAPH_ORGANS)) {
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
