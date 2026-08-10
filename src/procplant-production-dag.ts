import * as THREE from "three";
import {
  buildProcPlantGraphIr,
  buildProcPlantTemplate,
  buildProcPlantTemplateFromGraph,
  compileProcPlantLods,
  compileProcPlantLodsFromTemplate,
  defaultPlantEnvironment,
  type ProcPlantCompiledLod,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantGraph,
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

export type ProcPlantProductionStageArtifact =
  | ProcPlantSourceStageArtifact
  | ProcPlantGraphStageArtifact
  | ProcPlantMaterialStageArtifact
  | ProcPlantLodStageArtifact
  | ProcPlantOutputStageArtifact;

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

const assertSupportedBackend = (genome: ProcPlantGenome) => {
  const bespokeBroadPatch = bespokeBroadPatchFor(genome);
  const unsupported = [
    genome.weberPenn && "weber-penn",
    genome.branchModules && "branch-module-graph",
    genome.spaceColonization && "space-colonization",
    genome.vine && "guided-vine",
    genome.grass && "grass-specialization",
    genome.fern && !bespokeBroadPatch && "fern-specialization",
    genome.groundcover && !bespokeBroadPatch && "groundcover-specialization",
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
  if (artifact.kind === "graph") return artifact.graph.stems.length + artifact.graph.segments.length + artifact.graph.organs.length;
  if (artifact.kind === "material") return artifact.template.pos.length / 3 + artifact.template.idx.length;
  if (artifact.kind === "lod") return artifact.lods.reduce((sum, lod) => sum + lod.vertices + lod.triangles, 0);
  return artifact.build.template.pos.length / 3 + artifact.build.template.idx.length;
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

  assertSupportedBackend(genome);
  const bespokeBroadPatch = bespokeBroadPatchFor(genome);
  const canonicalNodeByStage = new Map(canonical.nodes.map((node) => [node.stage, node]));
  const maximumWork = options.maxWork ?? PROCPLANT_PRODUCTION_DAG_MAX_WORK;
  if (!Number.isInteger(maximumWork) || maximumWork < 1 || maximumWork > PROCPLANT_PRODUCTION_DAG_MAX_WORK) {
    throw new ProcPlantProductionDagError(`maxWork must be an integer in 1..${PROCPLANT_PRODUCTION_DAG_MAX_WORK}`);
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    validateProductionNodeParameters(node, genome);
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
      const builtGraph = bespokeBroadPatch
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
        genome: architectureGenome, environment: source.environment, graph: builtGraph,
        runtime: { windFlex: architectureGenome.treeRealism?.windFlex ?? 0.35, phototropism: architectureGenome.lightResponse.phototropism },
      });
    } else if (node.stage === "branching") {
      const inputs = graphArtifacts(node, dependencies);
      const base = mergeGraphArtifacts(inputs);
      artifact = withArtifactHash({
        kind: "graph", stage: "branching", nodeId, seed, lineage: lineageFor(node, inputs),
        genome: inputs[0]!.genome, environment: inputs[0]!.environment,
        graph: bespokeBroadPatch ? base : addBranches(base, inputs[0]!.genome, node, seed), runtime: inputs[0]!.runtime,
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
        graph: bespokeBroadPatch
          ? addBespokeBroadPatchFoliage(
              base,
              foliageGenome,
              bespokeBroadPatch,
              node,
              canonicalNodeByStage.get("foliage")!,
              seed,
            )
          : addFoliage(base, foliageGenome, node, seed),
        runtime: inputs[0]!.runtime,
      });
    } else if (node.stage === "reproductive") {
      const inputs = graphArtifacts(node, dependencies);
      const base = mergeGraphArtifacts(inputs);
      artifact = withArtifactHash({
        kind: "graph", stage: "reproductive", nodeId, seed, lineage: lineageFor(node, inputs),
        genome: inputs[0]!.genome, environment: inputs[0]!.environment,
        graph: bespokeBroadPatch
          ? addBespokeBroadPatchFlowers(
              base,
              inputs[0]!.genome,
              bespokeBroadPatch,
              node,
              canonicalNodeByStage.get("reproductive")!,
              seed,
            )
          : addReproductiveOrgans(base, inputs[0]!.genome, node, seed),
        runtime: inputs[0]!.runtime,
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
      const base = bespokeBroadPatch ? mergeBespokeBroadPatchArtifacts(inputs) : mergeGraphArtifacts(inputs);
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
