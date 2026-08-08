import * as THREE from "three";
import {
  createProcPlantRuntimeLodSelectionContract,
  type ProcPlantRuntimeLodSelectionContract,
} from "./procplant-contract";
import {
  bakeTree,
  generateTreeData,
  SPECIES,
  type BakeOptions,
  type SpeciesId,
  type TreeData,
} from "./vendor/proc-tree/index";
import { getLeafShape } from "./vendor/proc-tree/LeafShapes";
import {
  growProcPlantSpaceColonization,
  PROCPLANT_FREEFORM_CROWN_CONTRACT,
  PROCPLANT_FREEFORM_CROWN_VERSION,
  type ProcPlantFreeformCrown,
} from "./procplant-space-colonization";
import {
  createProcPlantSweptTubeGeometry,
  PROCPLANT_BRANCH_SWAY_ATTRIBUTE,
  PROCPLANT_BRANCH_TINTABLE_ATTRIBUTE,
} from "./procplant-tube";
import { declareProcPlantGeometryUv0 } from "./procplant-uv0";

export interface ProcPlantTemplate {
  pos: Float32Array;
  nrm: Float32Array;
  /** Lossless glTF TEXCOORD_0 source. Values may tile outside [0, 1]. */
  uv0: Float32Array;
  col: Float32Array;
  tintable: Uint8Array;
  sway: Float32Array;
  idx: Uint32Array;
}

export type ProcPlantHabit =
  | "grass"
  | "fern"
  | "flower"
  | "tropical"
  | "shrub"
  | "vine"
  | "moss"
  | "tree"
  | "conifer"
  | "palm";

export type LeafShapeKind =
  | "lanceolate"
  | "ovate"
  | "cordate"
  | "palmate"
  | "spatulate"
  | "fan"
  | "linear"
  | "round"
  | "frond"
  | "blade";

export interface CurveGene {
  base: number;
  tip: number;
  curve: number;
}

export type ProcPlantPhyllotaxyMode = "spiral" | "alternate" | "opposite" | "decussate" | "whorled";

export interface ProcPlantPhyllotaxy {
  mode: ProcPlantPhyllotaxyMode;
  /** Organs per whorl. Used by `whorled`; defaults to three. */
  whorlCount?: number;
  /** Deterministic azimuth offset in radians. */
  phase?: number;
}

export interface ProcPlantPhyllotaxySample {
  mode: ProcPlantPhyllotaxyMode;
  azimuth: number;
  whorlIndex: number;
  indexInWhorl: number;
  whorlCount: number;
}

export interface ProcPlantGenome {
  id: string;
  habit: ProcPlantHabit;
  nodeCount: number;
  internode: CurveGene;
  phyllotaxisAngle: number;
  /** Optional first-class arrangement; absent preserves the legacy spiral exactly. */
  phyllotaxy?: ProcPlantPhyllotaxy;
  branchChance: CurveGene;
  branchAngle: { mean: number; spread: number; depthDecay: number };
  apicalDominance: number;
  leaf: {
    shape: LeafShapeKind;
    length: CurveGene;
    widthRatio: number;
    density: CurveGene;
    curl: number;
    serration: number;
    venation: number;
    colorA: number;
    colorB: number;
  };
  flower?: {
    whorls: number;
    petals: number;
    radius: number;
    color: number;
    centerColor: number;
    mesh?: ProcPlantFlowerMeshKind;
  };
  grass?: {
    blades: number;
    furBias: number;
    heightJitter: number;
  };
  fern?: {
    pinnae: number;
    leafletPairs: number;
    arch: number;
  };
  /** Low, spreading vegetation rendered as a small number of broad leaf clusters. */
  groundcover?: {
    radius: number;
    clusters: number;
    leavesPerCluster: number;
    height: number;
    flowerRate?: number;
    runners?: boolean;
  };
  /** Optional authored path/support behavior for static climbing and hanging plants. */
  vine?: ProcPlantVineGene;
  /** Optional compact tuft distribution. May also decorate a vine path. */
  moss?: ProcPlantMossGene;
  accessoryOrgans?: ProcPlantAccessoryGene[];
  foliage?: {
    mass: number;
    clusterDensity: number;
    whorlDensity: number;
    tipBias: number;
    size?: number;
  };
  /**
   * Grow this plant as a clump of several offset rosettes/shoots instead of a
   * single stalk. Applies to the procplant-graph backend (herbaceous plants,
   * grasses, ferns, flowers) — Weber&Penn trees ignore it. Makes daylilies,
   * grasses, and meadow flowers render as a believable mound of foliage with
   * multiple flowering stems rather than one lonely shoot.
   */
  clump?: {
    /** Number of shoots in the clump (1 = single plant, off). */
    count: number;
    /** Ground radius (in local units) the shoots spread across. */
    radius: number;
    /** Extra positional randomness added to the spread [0..1]. */
    jitter?: number;
    /** Per-shoot scale variation [0..1]; 0 = uniform, 1 = up to ±50%. */
    scaleVar?: number;
    /** Outward lean of peripheral shoots in radians (arching mound look). */
    lean?: number;
    /** Flowering scapes per leaf crown [0..1.5], used by ground flowers such as daylily. */
    flowerDensity?: number;
  };
  treeRealism?: {
    crownSpread: number;
    crownTaper: number;
    trunkFlare: number;
    trunkBend: number;
    branchGnarl: number;
    windFlex: number;
    colorVariance: number;
  };
  weberPenn?: {
    species: SpeciesId;
    nativeLeaves?: boolean;
    crownFill?: boolean;
    foliageSource?: "species" | "procplants" | "conifer-spray" | "ez-leaf-card";
    fillAnchor?: "leaf-sites" | "branch-tips";
    maxBranchDepth?: number;
    maxStems?: number;
    maxLeaves?: number;
    leafScaleMultiplier?: number;
    blossomScaleMultiplier?: number;
    radialSegments?: number;
    branchSamples?: number;
    barkColor?: number;
    leafColor?: number;
  };
  branchModules?: {
    palette: "excurrent-conifer" | "decurrent-broadleaf" | "weeping" | "shrub" | "palm-ish" | "vine-ish";
    moduleBudget?: number;
    levels?: number;
    vigor?: number;
    branchDensity?: number;
    branchAngle?: number;
    spread?: number;
    droop?: number;
    tropism?: number;
    gnarliness?: number;
    collisionBias?: number;
    junctionBlend?: number;
    foliageSource?: "procplants" | "conifer-spray" | "ez-leaf-card";
    barkColor?: number;
    leafColor?: number;
  };
  /**
   * Opt-in volumetric crown architecture. Existing genomes omit this and keep
   * their legacy graph, Weber-Penn, or branch-module backend unchanged.
   */
  spaceColonization?: ProcPlantSpaceColonizationGene;
  tree?: {
    crown: "rounded" | "columnar" | "umbrella" | "spreading" | "propRoot";
    crownStart: number;
    leafClusterScale: number;
    exposedTrunk: number;
  };
  lightResponse: {
    shadeAvoidance: number;
    leafBoostInShade: number;
    branchSuppressionInShade: number;
    phototropism: number;
  };
}

export interface ProcPlantSpaceColonizationGene {
  volume: {
    shape: "ellipsoid" | "box";
    center: readonly [number, number, number];
    /** Ellipsoid radii or full box size, depending on `shape`. */
    dimensions: readonly [number, number, number];
  };
  /** Optional sculpted union of bounded control volumes. Omit for exact legacy behavior. */
  freeform?: ProcPlantFreeformCrown;
  attractorCount: number;
  segmentLength: number;
  influenceRadius: number;
  killRadius: number;
  collisionRadius: number;
  maxSteps: number;
  maxNodes: number;
  maxChildren?: number;
  tropism?: readonly [number, number, number];
  tropismStrength?: number;
  directionJitter?: number;
  pipeExponent?: number;
  tipRadius?: number;
  radialSegments?: number;
  barkColor?: number;
  barkIrregularity?: number;
  /** Swept-chain junction collar strength; root chains use 7/12 of this value. */
  collarStrength?: number;
  collarLength?: number;
  junctionAo?: number;
  /** Place non-terminal foliage every N distal skeleton nodes. */
  foliageSpacing?: number;
  /** Number of leaves placed around each terminal twig. */
  terminalLeafCount?: number;
  foliageStart?: number;
  leafScale?: number;
}

export type ProcPlantFlowerMeshKind = "flobot-daylily" | "flobot-cup" | "flobot-petal-2" | "flobot-pink-flower";

export type ProcPlantAccessoryKind = "fruit" | "berry" | "cone" | "thorn" | "aerialRoot";

export interface ProcPlantAccessoryGene {
  kind: ProcPlantAccessoryKind;
  count: number;
  size: number;
  color: number;
  secondaryColor?: number;
  startT?: number;
  endT?: number;
  minDepth?: number;
  maxDepth?: number;
}

export type ProcPlantVineMode = "climb" | "hang" | "wrap" | "follow";
export type ProcPlantGuidePoint = readonly [number, number, number];

export interface ProcPlantVineSupport {
  /** Axis origin, or the attachment point for a hanging strand. */
  position?: ProcPlantGuidePoint;
  /** Support axis for climbing/wrapping. Defaults to world up. */
  direction?: ProcPlantGuidePoint;
  radius?: number;
  height?: number;
}

export interface ProcPlantVineGene {
  mode: ProcPlantVineMode;
  /** Optional polyline used by `follow`; other modes synthesize a support guide. */
  guide?: readonly ProcPlantGuidePoint[];
  support?: ProcPlantVineSupport;
  /** Turns around the support axis. Fractional values are supported. */
  turns?: number;
  /** Attraction to the guide versus inertial continuation [0..1]. */
  adhesion?: number;
  /** Coarse static clearance from the support and non-neighboring vine nodes. */
  avoidanceRadius?: number;
  /** Downward catenary-like displacement baked into the generated path. */
  sag?: number;
  /** Place foliage every N path nodes. */
  leafEvery?: number;
  /** Place a flower every N path nodes when a flower gene exists; 0 disables it. */
  flowerEvery?: number;
  flowerStartT?: number;
}

export interface ProcPlantMossGene {
  clumps: number;
  radius: number;
  height: number;
  tuftsPerClump: number;
  surfaceJitter?: number;
}

export interface ProcPlantEnvironment {
  light: number;
  moisture: number;
  crowding: number;
  biomeWarmth: number;
}

export interface ProcPlantStats {
  stems: number;
  leaves: number;
  flowers: number;
  accessories?: number;
  triangles: number;
}

export type ProcPlantBiomeId =
  | "tropical-rain-forest"
  | "temperate-rain-forest"
  | "desert"
  | "tundra"
  | "taiga"
  | "grassland"
  | "savanna"
  | "estuary"
  | "coastal"
  | "arctic-alpine";

export type ProcPlantSubstrateKind =
  | "sand"
  | "clay"
  | "silt"
  | "loam"
  | "limestone"
  | "shale"
  | "granite"
  | "peat"
  | "volcanic"
  | "ice";

export interface ProcPlantEcologySample {
  biome?: ProcPlantBiomeId;
  substrate: ProcPlantSubstrateKind;
  elevation: number;
  slope: number;
  warmth: number;
  moisture: number;
  seasonality: number;
  salinity: number;
  wind: number;
  light: number;
}

export interface ProcPlantEcologyProfile {
  presetId: string;
  dominance: number;
  biomeAffinity: Partial<Record<ProcPlantBiomeId, number>>;
  substrateAffinity: Partial<Record<ProcPlantSubstrateKind, number>>;
  warmth: [number, number, number];
  moisture: [number, number, number];
  elevation: [number, number, number];
  seasonality?: [number, number, number];
  salinity?: [number, number, number];
  wind?: [number, number, number];
}

export interface ProcPlantCommunityEntry {
  presetId: string;
  score: number;
  genome: ProcPlantGenome;
}

export interface ProcPlantLodPackage {
  level: 0 | 1 | 2 | 3;
  label: "full" | "clustered" | "billboard-cross" | "impostor";
  distance: number;
  triangleBudget: number;
  organBudget: number;
}

export interface ProcPlantRuntimePackage {
  version: 1;
  seed: number;
  genomeId: string;
  architecture: {
    backend: "procplant-graph" | "weber-penn" | "branch-module-graph" | "space-colonization";
    species?: string;
    habit: ProcPlantHabit;
  };
  stats: ProcPlantStats;
  wind: {
    trunkSway: number;
    branchSway: number;
    leafFlutter: number;
  };
  lods: ProcPlantLodPackage[];
  lodSelection: ProcPlantRuntimeLodSelectionContract;
  ecology?: ProcPlantEcologyProfile;
}

export interface ProcPlantForceField {
  type: "direction" | "magnet" | "curl" | "avoid" | "surfaceFollow" | "windShape";
  position?: THREE.Vector3;
  direction?: THREE.Vector3;
  radius: number;
  strength: number;
}

export type ProcPlantInstanceKind =
  | "leaf"
  | "grassBlade"
  | "petal"
  | "flowerDisc"
  | "daylilyBloom"
  | "hibiscusBloom"
  | "flobotCupBloom"
  | "flobotPetal2Bloom"
  | "flobotPinkBloom"
  | "foxgloveBloom"
  | "flowerCenter"
  | ProcPlantAccessoryKind;
export type ProcPlantFoliageClusterKind = "coniferSpray" | "palmFrond" | "mossTuft";

export interface ProcPlantInstance {
  kind: ProcPlantInstanceKind | ProcPlantFoliageClusterKind;
  matrix: THREE.Matrix4;
  color: THREE.Color;
  sway: number;
}

export interface ProcPlantInstancedParts {
  stems: ProcPlantTemplate;
  instances: ProcPlantInstance[];
  graph: ProcPlantGraph;
  stats: ProcPlantStats & {
    instances: number;
    stemTriangles: number;
  };
}

export interface ProcPlantStemNode {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  radius: number;
  depth: number;
  t: number;
  index: number;
}

export type ProcPlantOrganKind = "leaf" | "flower" | "grassBlade" | "fernLeaflet" | ProcPlantFoliageClusterKind | ProcPlantAccessoryKind;

export interface ProcPlantOrgan {
  kind: ProcPlantOrganKind;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  right: THREE.Vector3;
  scale: number;
  t: number;
  bend?: number;
  color?: number;
  secondaryColor?: number;
}

type StemNode = ProcPlantStemNode;
type Organ = ProcPlantOrgan;

export interface ProcPlantSegmentRecord {
  id: string;
  parentSegmentId: string | null;
  startNodeIndex: number;
  endNodeIndex: number;
  depth: number;
  axialStart: number;
  axialEnd: number;
}

export type ProcPlantAttachmentKind = ProcPlantOrganKind | "leaf-site" | "branch-tip";

export interface ProcPlantAttachmentAnchor {
  id: string;
  parentSegmentId: string | null;
  axialT: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  kind: ProcPlantAttachmentKind;
  depth: number;
  sway: number;
  organIndex: number | null;
}

export interface ProcPlantGraph {
  stems: StemNode[];
  segments: Array<[number, number]>;
  organs: Organ[];
  segmentRecords: ProcPlantSegmentRecord[];
  attachments: ProcPlantAttachmentAnchor[];
}

export interface ProcPlantCompiledLod {
  level: 0 | 1 | 2 | 3;
  label: "full" | "clustered" | "billboard-cross" | "impostor";
  distance: number;
  template: ProcPlantTemplate;
  triangles: number;
  vertices: number;
}

const GOLDEN_ANGLE = THREE.MathUtils.degToRad(137.50776405);
const UP = new THREE.Vector3(0, 1, 0);

export const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_ANGLE_RADIANS = GOLDEN_ANGLE;

export const procPlantPhyllotaxyOrgansPerNode = (genome: ProcPlantGenome): number => {
  const mode = genome.phyllotaxy?.mode;
  if (mode === "opposite" || mode === "decussate") return 2;
  if (mode === "whorled") return Math.max(2, Math.min(12, Math.round(genome.phyllotaxy?.whorlCount ?? 3)));
  return 1;
};

/** Resolve a stable attachment azimuth for both legacy and authored phyllotaxy. */
export const resolveProcPlantPhyllotaxy = (
  genome: ProcPlantGenome,
  ordinal: number,
  organInNode?: number,
): ProcPlantPhyllotaxySample => {
  const authored = genome.phyllotaxy;
  if (!authored) {
    return {
      mode: "spiral",
      azimuth: ordinal * genome.phyllotaxisAngle,
      whorlIndex: Math.floor(ordinal),
      indexInWhorl: 0,
      whorlCount: 1,
    };
  }
  const phase = authored.phase ?? 0;
  if (authored.mode === "spiral") {
    return {
      mode: "spiral",
      azimuth: phase + ordinal * genome.phyllotaxisAngle,
      whorlIndex: Math.floor(ordinal),
      indexInWhorl: 0,
      whorlCount: 1,
    };
  }
  const whorlCount = procPlantPhyllotaxyOrgansPerNode(genome);
  const whole = Math.floor(ordinal);
  const fractional = ordinal - whole;
  const explicitSlot = organInNode !== undefined;
  const whorlIndex = explicitSlot ? whole : Math.floor(whole / whorlCount);
  const indexInWhorl = ((explicitSlot ? Math.floor(organInNode) : whole) % whorlCount + whorlCount) % whorlCount;
  const fractionalTurn = fractional * genome.phyllotaxisAngle;
  let azimuth: number;
  if (authored.mode === "alternate") {
    azimuth = phase + whole * Math.PI + fractionalTurn;
  } else if (authored.mode === "opposite") {
    azimuth = phase + indexInWhorl * Math.PI + fractionalTurn;
  } else if (authored.mode === "decussate") {
    azimuth = phase + whorlIndex * Math.PI / 2 + indexInWhorl * Math.PI + fractionalTurn;
  } else {
    azimuth = phase + whorlIndex * genome.phyllotaxisAngle + indexInWhorl * Math.PI * 2 / whorlCount + fractionalTurn;
  }
  return { mode: authored.mode, azimuth, whorlIndex, indexInWhorl, whorlCount };
};

const vectorFromGuidePoint = (
  point: ProcPlantGuidePoint | undefined,
  fallback: THREE.Vector3,
) => point ? new THREE.Vector3(point[0], point[1], point[2]) : fallback.clone();

const sampleProcPlantGuidePolyline = (guide: readonly ProcPlantGuidePoint[], t: number): THREE.Vector3 => {
  if (guide.length === 0) return new THREE.Vector3();
  if (guide.length === 1) return vectorFromGuidePoint(guide[0], new THREE.Vector3());
  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < guide.length; i++) {
    total += vectorFromGuidePoint(guide[i], new THREE.Vector3()).distanceTo(
      vectorFromGuidePoint(guide[i - 1], new THREE.Vector3()),
    );
    lengths.push(total);
  }
  if (total < 1e-6) return vectorFromGuidePoint(guide[0], new THREE.Vector3());
  const distance = THREE.MathUtils.clamp(t, 0, 1) * total;
  let segment = 0;
  while (segment < lengths.length - 2 && lengths[segment + 1]! < distance) segment++;
  const startDistance = lengths[segment]!;
  const endDistance = lengths[segment + 1]!;
  const localT = (distance - startDistance) / Math.max(1e-6, endDistance - startDistance);
  return vectorFromGuidePoint(guide[segment], new THREE.Vector3()).lerp(
    vectorFromGuidePoint(guide[segment + 1], new THREE.Vector3()),
    localT,
  );
};

/** Resolve the complete static centerline used by a vine genome. */
export const resolveProcPlantVinePath = (
  gene: ProcPlantVineGene,
  nodeCount: number,
): THREE.Vector3[] => {
  const count = Math.max(2, Math.min(96, Math.round(nodeCount)));
  const origin = vectorFromGuidePoint(gene.support?.position, new THREE.Vector3());
  const axis = vectorFromGuidePoint(gene.support?.direction, UP);
  if (axis.lengthSq() < 1e-8) axis.copy(UP);
  axis.normalize();
  const height = Math.max(0.08, gene.support?.height ?? 1.6);
  const supportRadius = Math.max(0, gene.support?.radius ?? 0.08);
  const avoidance = Math.max(0, gene.avoidanceRadius ?? 0.025);
  const adhesion = THREE.MathUtils.clamp(gene.adhesion ?? 0.86, 0, 1);
  const turns = gene.turns ?? (gene.mode === "wrap" ? 2.25 : 0.35);
  const sag = Math.max(0, gene.sag ?? (gene.mode === "hang" ? 0.2 : 0.04));
  const reference = Math.abs(axis.dot(UP)) > 0.94 ? new THREE.Vector3(1, 0, 0) : UP;
  const right = new THREE.Vector3().crossVectors(axis, reference).normalize();
  const forward = new THREE.Vector3().crossVectors(right, axis).normalize();
  const radialDistance = supportRadius + avoidance;
  const validGuide = gene.guide && gene.guide.length >= 2 ? gene.guide : undefined;
  const idealAt = (t: number) => {
    if (gene.mode === "follow" && validGuide) {
      return sampleProcPlantGuidePolyline(validGuide, t).addScaledVector(UP, -Math.sin(Math.PI * t) * sag);
    }
    if (gene.mode === "hang") {
      const angle = t * Math.PI * 2 * turns;
      return origin.clone()
        .addScaledVector(axis, -height * t)
        .addScaledVector(right, Math.sin(angle) * radialDistance * (0.35 + t * 0.65))
        .addScaledVector(forward, (Math.cos(angle) - 1) * radialDistance * 0.35)
        .addScaledVector(UP, -Math.sin(Math.PI * t) * sag);
    }
    const angle = t * Math.PI * 2 * turns;
    const radius = gene.mode === "wrap" ? radialDistance : radialDistance * (0.92 + 0.08 * Math.sin(t * Math.PI));
    return origin.clone()
      .addScaledVector(axis, height * t)
      .addScaledVector(right, Math.cos(angle) * radius)
      .addScaledVector(forward, Math.sin(angle) * radius)
      .addScaledVector(UP, -Math.sin(Math.PI * t) * sag);
  };
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const ideal = idealAt(t);
    let point = ideal;
    if (points.length >= 2 && adhesion < 0.999) {
      const previous = points[points.length - 1]!;
      const before = points[points.length - 2]!;
      const inertial = previous.clone().add(previous.clone().sub(before));
      point = inertial.lerp(ideal, adhesion);
    }
    if (gene.mode === "climb" || gene.mode === "wrap") {
      const along = point.clone().sub(origin).dot(axis);
      const onAxis = origin.clone().addScaledVector(axis, along);
      const radial = point.clone().sub(onAxis);
      if (radial.lengthSq() < radialDistance * radialDistance) {
        if (radial.lengthSq() < 1e-8) radial.copy(right);
        point.copy(onAxis).add(radial.normalize().multiplyScalar(radialDistance));
      }
    }
    for (let priorIndex = 0; priorIndex < points.length - 2; priorIndex++) {
      const prior = points[priorIndex]!;
      const delta = point.clone().sub(prior);
      if (delta.lengthSq() < avoidance * avoidance && avoidance > 0) {
        let distance = delta.length();
        if (distance < 1e-8) {
          delta.copy(right).applyAxisAngle(axis, i * GOLDEN_ANGLE);
          distance = 0;
        }
        point.add(delta.normalize().multiplyScalar(avoidance - distance));
      }
    }
    points.push(point);
  }
  return points;
};

export const defaultPlantEnvironment = (): ProcPlantEnvironment => ({
  light: 0.78,
  moisture: 0.65,
  crowding: 0.25,
  biomeWarmth: 0.7,
});

/** Variant IDs append `@season-health-maturity`; authored shape dispatch uses the stable preset ID. */
const authoredProcPlantId = (genome: Pick<ProcPlantGenome, "id">) => genome.id.split("@", 1)[0]!;

export const procPlantPresets: Record<string, ProcPlantGenome> = {
  furGrass: {
    id: "furGrass",
    habit: "grass",
    nodeCount: 9,
    internode: { base: 0.12, tip: 0.07, curve: 0.95 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.02, tip: 0, curve: 1 },
    branchAngle: { mean: 0.18, spread: 0.1, depthDecay: 0.7 },
    apicalDominance: 0.9,
    leaf: {
      shape: "blade",
      length: { base: 0.42, tip: 0.76, curve: 1.2 },
      widthRatio: 0.035,
      density: { base: 1, tip: 0.9, curve: 1 },
      curl: 0.22,
      serration: 0,
      venation: 0.15,
      colorA: 0x395f20,
      colorB: 0xa6cf62,
    },
    grass: { blades: 38, furBias: 0.9, heightJitter: 0.38 },
    clump: { count: 5, radius: 0.22, jitter: 0.6, scaleVar: 0.32, lean: 0.5 },
    lightResponse: {
      shadeAvoidance: 0.45,
      leafBoostInShade: 0.2,
      branchSuppressionInShade: 0.4,
      phototropism: 0.18,
    },
  },
  phiFern: {
    id: "phiFern",
    habit: "fern",
    nodeCount: 18,
    internode: { base: 0.09, tip: 0.055, curve: 1.1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.72, spread: 0.18, depthDecay: 0.55 },
    apicalDominance: 0.55,
    leaf: {
      shape: "frond",
      length: { base: 0.19, tip: 0.08, curve: 0.85 },
      widthRatio: 0.28,
      density: { base: 0.95, tip: 0.65, curve: 1 },
      curl: 0.18,
      serration: 0.15,
      venation: 0.45,
      colorA: 0x224f1d,
      colorB: 0x73b851,
    },
    fern: { pinnae: 19, leafletPairs: 5, arch: 0.72 },
    clump: { count: 6, radius: 0.26, jitter: 0.55, scaleVar: 0.3, lean: 0.62 },
    lightResponse: {
      shadeAvoidance: 0.2,
      leafBoostInShade: 0.45,
      branchSuppressionInShade: 0.1,
      phototropism: 0.1,
    },
  },
  brackenFernMat: {
    id: "brackenFernMat",
    habit: "fern",
    nodeCount: 13,
    internode: { base: 0.1, tip: 0.065, curve: 1.08 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.82, spread: 0.2, depthDecay: 0.58 },
    apicalDominance: 0.48,
    leaf: {
      shape: "frond",
      length: { base: 0.22, tip: 0.1, curve: 0.92 },
      widthRatio: 0.34,
      density: { base: 0.9, tip: 0.56, curve: 1 },
      curl: 0.24,
      serration: 0.22,
      venation: 0.35,
      colorA: 0x294f24,
      colorB: 0x83ad52,
    },
    fern: { pinnae: 14, leafletPairs: 4, arch: 0.9 },
    clump: { count: 5, radius: 0.52, jitter: 0.62, scaleVar: 0.28, lean: 0.34 },
    lightResponse: {
      shadeAvoidance: 0.18,
      leafBoostInShade: 0.38,
      branchSuppressionInShade: 0.1,
      phototropism: 0.08,
    },
  },
  maidenhairFernPatch: {
    id: "maidenhairFernPatch",
    habit: "fern",
    nodeCount: 7,
    internode: { base: 0.08, tip: 0.05, curve: 1.05 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "opposite" },
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.76, spread: 0.16, depthDecay: 0.7 },
    apicalDominance: 0.42,
    leaf: {
      shape: "fan",
      length: { base: 0.16, tip: 0.1, curve: 0.9 },
      widthRatio: 0.88,
      density: { base: 0.92, tip: 0.7, curve: 1 },
      curl: 0.06,
      serration: 0.08,
      venation: 0.34,
      colorA: 0x214c32,
      colorB: 0x78b86c,
    },
    fern: { pinnae: 12, leafletPairs: 4, arch: 0.82 },
    groundcover: { radius: 0.9, clusters: 8, leavesPerCluster: 5, height: 0.48 },
    lightResponse: { shadeAvoidance: 0.14, leafBoostInShade: 0.42, branchSuppressionInShade: 0.08, phototropism: 0.06 },
  },
  woodlandVioletCarpet: {
    id: "woodlandVioletCarpet",
    habit: "flower",
    nodeCount: 5,
    internode: { base: 0.07, tip: 0.045, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "whorled", whorlCount: 3 },
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.36, spread: 0.12, depthDecay: 0.72 },
    apicalDominance: 0.24,
    leaf: {
      shape: "cordate",
      length: { base: 0.17, tip: 0.12, curve: 0.92 },
      widthRatio: 0.92,
      density: { base: 0.95, tip: 0.74, curve: 1 },
      curl: 0.045,
      serration: 0.02,
      venation: 0.4,
      colorA: 0x285335,
      colorB: 0x77a85a,
    },
    flower: { whorls: 1, petals: 5, radius: 0.075, color: 0x7652b5, centerColor: 0xf1d65b },
    groundcover: { radius: 1.02, clusters: 14, leavesPerCluster: 3, height: 0.18, flowerRate: 0.66 },
    lightResponse: { shadeAvoidance: 0.16, leafBoostInShade: 0.34, branchSuppressionInShade: 0.12, phototropism: 0.06 },
  },
  trilliumPatch: {
    id: "trilliumPatch",
    habit: "flower",
    nodeCount: 6,
    internode: { base: 0.08, tip: 0.05, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "whorled", whorlCount: 3 },
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.42, spread: 0.1, depthDecay: 0.74 },
    apicalDominance: 0.62,
    leaf: {
      shape: "ovate",
      length: { base: 0.3, tip: 0.22, curve: 0.95 },
      widthRatio: 0.62,
      density: { base: 0.92, tip: 0.68, curve: 1 },
      curl: 0.05,
      serration: 0.01,
      venation: 0.58,
      colorA: 0x274d2c,
      colorB: 0x6f9650,
    },
    flower: { whorls: 1, petals: 3, radius: 0.13, color: 0xf3efe3, centerColor: 0xd9bd52 },
    groundcover: { radius: 0.92, clusters: 8, leavesPerCluster: 3, height: 0.34, flowerRate: 0.78 },
    lightResponse: { shadeAvoidance: 0.18, leafBoostInShade: 0.3, branchSuppressionInShade: 0.12, phototropism: 0.07 },
  },
  horsetailColony: {
    id: "horsetailColony",
    habit: "fern",
    nodeCount: 8,
    internode: { base: 0.09, tip: 0.055, curve: 1.04 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "whorled", whorlCount: 5 },
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 1.08, spread: 0.1, depthDecay: 0.78 },
    apicalDominance: 0.88,
    leaf: {
      shape: "linear",
      length: { base: 0.13, tip: 0.07, curve: 1.1 },
      widthRatio: 0.08,
      density: { base: 1, tip: 0.76, curve: 1 },
      curl: 0.02,
      serration: 0,
      venation: 0.16,
      colorA: 0x315a35,
      colorB: 0x789663,
    },
    fern: { pinnae: 10, leafletPairs: 3, arch: 0.18 },
    groundcover: { radius: 0.9, clusters: 9, leavesPerCluster: 5, height: 0.68 },
    lightResponse: { shadeAvoidance: 0.28, leafBoostInShade: 0.18, branchSuppressionInShade: 0.1, phototropism: 0.08 },
  },
  meadowFlower: {
    id: "meadowFlower",
    habit: "flower",
    nodeCount: 10,
    internode: { base: 0.11, tip: 0.08, curve: 1.05 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.08, tip: 0.02, curve: 1.8 },
    branchAngle: { mean: 0.55, spread: 0.18, depthDecay: 0.62 },
    apicalDominance: 0.82,
    leaf: {
      shape: "lanceolate",
      length: { base: 0.42, tip: 0.2, curve: 0.75 },
      widthRatio: 0.18,
      density: { base: 0.78, tip: 0.35, curve: 1.35 },
      curl: 0.1,
      serration: 0.08,
      venation: 0.55,
      colorA: 0x315f25,
      colorB: 0x89be54,
    },
    flower: {
      whorls: 2,
      petals: 5,
      radius: 0.22,
      color: 0xffc0d7,
      centerColor: 0xf4c94c,
    },
    clump: { count: 6, radius: 0.28, jitter: 0.6, scaleVar: 0.3, lean: 0.34 },
    lightResponse: {
      shadeAvoidance: 0.72,
      leafBoostInShade: 0.18,
      branchSuppressionInShade: 0.45,
      phototropism: 0.28,
    },
  },
  echinaceaFlower: {
    id: "echinaceaFlower",
    habit: "flower",
    nodeCount: 11,
    internode: { base: 0.14, tip: 0.1, curve: 0.95 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.01, tip: 0, curve: 1.4 },
    branchAngle: { mean: 0.36, spread: 0.12, depthDecay: 0.7 },
    apicalDominance: 0.9,
    leaf: {
      shape: "lanceolate",
      length: { base: 0.48, tip: 0.18, curve: 1.25 },
      widthRatio: 0.32,
      density: { base: 0.92, tip: 0.16, curve: 2.1 },
      curl: 0.08,
      serration: 0.22,
      venation: 0.7,
      colorA: 0x31572a,
      colorB: 0x86ad59,
    },
    flower: {
      whorls: 1,
      petals: 13,
      radius: 0.25,
      color: 0xf08ae0,
      centerColor: 0xd09239,
    },
    clump: { count: 5, radius: 0.3, jitter: 0.55, scaleVar: 0.28, lean: 0.28 },
    lightResponse: {
      shadeAvoidance: 0.68,
      leafBoostInShade: 0.16,
      branchSuppressionInShade: 0.42,
      phototropism: 0.22,
    },
  },
  hibiscusBloom: {
    id: "hibiscusBloom",
    habit: "flower",
    nodeCount: 9,
    internode: { base: 0.12, tip: 0.08, curve: 0.95 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.08, tip: 0.02, curve: 1.4 },
    branchAngle: { mean: 0.48, spread: 0.18, depthDecay: 0.72 },
    apicalDominance: 0.72,
    leaf: {
      shape: "ovate",
      length: { base: 0.42, tip: 0.24, curve: 1.05 },
      widthRatio: 0.5,
      density: { base: 0.82, tip: 0.46, curve: 1.2 },
      curl: 0.12,
      serration: 0.08,
      venation: 0.72,
      colorA: 0x285b31,
      colorB: 0x78af55,
    },
    flower: {
      whorls: 1,
      petals: 5,
      radius: 0.34,
      color: 0xff4f6f,
      centerColor: 0xffd75a,
    },
    lightResponse: {
      shadeAvoidance: 0.52,
      leafBoostInShade: 0.3,
      branchSuppressionInShade: 0.24,
      phototropism: 0.18,
    },
  },
  flobotCupFlower: {
    id: "flobotCupFlower",
    habit: "flower",
    nodeCount: 8,
    internode: { base: 0.11, tip: 0.075, curve: 0.98 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.04, tip: 0.015, curve: 1.35 },
    branchAngle: { mean: 0.34, spread: 0.14, depthDecay: 0.7 },
    apicalDominance: 0.82,
    leaf: {
      shape: "spatulate",
      length: { base: 0.36, tip: 0.18, curve: 1.12 },
      widthRatio: 0.38,
      density: { base: 0.9, tip: 0.32, curve: 1.65 },
      curl: 0.1,
      serration: 0.04,
      venation: 0.48,
      colorA: 0x2f6432,
      colorB: 0x82b85a,
    },
    flower: {
      whorls: 1,
      petals: 1,
      radius: 0.32,
      color: 0xff7d68,
      centerColor: 0xffd35c,
      mesh: "flobot-cup",
    },
    clump: { count: 4, radius: 0.24, jitter: 0.55, scaleVar: 0.22, lean: 0.24 },
    lightResponse: {
      shadeAvoidance: 0.55,
      leafBoostInShade: 0.22,
      branchSuppressionInShade: 0.28,
      phototropism: 0.18,
    },
  },
  flobotPetal2Flower: {
    id: "flobotPetal2Flower",
    habit: "flower",
    nodeCount: 9,
    internode: { base: 0.12, tip: 0.08, curve: 0.96 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.05, tip: 0.02, curve: 1.4 },
    branchAngle: { mean: 0.38, spread: 0.16, depthDecay: 0.7 },
    apicalDominance: 0.82,
    leaf: {
      shape: "ovate",
      length: { base: 0.4, tip: 0.2, curve: 1.08 },
      widthRatio: 0.46,
      density: { base: 0.84, tip: 0.36, curve: 1.45 },
      curl: 0.12,
      serration: 0.06,
      venation: 0.6,
      colorA: 0x2b5c33,
      colorB: 0x83b45e,
    },
    flower: {
      whorls: 1,
      petals: 5,
      radius: 0.33,
      color: 0xff6aa8,
      centerColor: 0xffcf5f,
      mesh: "flobot-petal-2",
    },
    clump: { count: 4, radius: 0.28, jitter: 0.5, scaleVar: 0.22, lean: 0.26 },
    lightResponse: {
      shadeAvoidance: 0.58,
      leafBoostInShade: 0.2,
      branchSuppressionInShade: 0.3,
      phototropism: 0.18,
    },
  },
  flobotPinkFlower: {
    id: "flobotPinkFlower",
    habit: "flower",
    nodeCount: 8,
    internode: { base: 0.1, tip: 0.07, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.035, tip: 0.012, curve: 1.35 },
    branchAngle: { mean: 0.34, spread: 0.14, depthDecay: 0.7 },
    apicalDominance: 0.84,
    leaf: {
      shape: "round",
      length: { base: 0.32, tip: 0.17, curve: 1.1 },
      widthRatio: 0.55,
      density: { base: 0.86, tip: 0.34, curve: 1.5 },
      curl: 0.08,
      serration: 0.02,
      venation: 0.42,
      colorA: 0x306332,
      colorB: 0x8fc45f,
    },
    flower: {
      whorls: 1,
      petals: 5,
      radius: 0.3,
      color: 0xff8bc6,
      centerColor: 0xffd94f,
      mesh: "flobot-pink-flower",
    },
    clump: { count: 5, radius: 0.3, jitter: 0.58, scaleVar: 0.25, lean: 0.22 },
    lightResponse: {
      shadeAvoidance: 0.55,
      leafBoostInShade: 0.2,
      branchSuppressionInShade: 0.28,
      phototropism: 0.16,
    },
  },
  daylilyFlower: {
    id: "daylilyFlower",
    habit: "flower",
    nodeCount: 10,
    internode: { base: 0.15, tip: 0.1, curve: 0.92 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.02, tip: 0.01, curve: 1.35 },
    branchAngle: { mean: 0.28, spread: 0.1, depthDecay: 0.72 },
    apicalDominance: 0.9,
    leaf: {
      shape: "linear",
      length: { base: 0.86, tip: 0.48, curve: 1.05 },
      widthRatio: 0.06,
      density: { base: 1, tip: 0.3, curve: 1.8 },
      curl: 0.16,
      serration: 0,
      venation: 0.28,
      colorA: 0x365e2c,
      colorB: 0xa8bf62,
    },
    flower: {
      whorls: 2,
      petals: 3,
      radius: 0.27,
      color: 0xff8f2f,
      centerColor: 0xffd158,
      mesh: "flobot-daylily",
    },
    clump: { count: 10, radius: 0.42, jitter: 0.62, scaleVar: 0.24, lean: 0.46, flowerDensity: 0.32 },
    lightResponse: {
      shadeAvoidance: 0.58,
      leafBoostInShade: 0.12,
      branchSuppressionInShade: 0.4,
      phototropism: 0.16,
    },
  },
  foxgloveSpike: {
    id: "foxgloveSpike",
    habit: "flower",
    nodeCount: 13,
    internode: { base: 0.13, tip: 0.085, curve: 1.05 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.01, tip: 0, curve: 1.4 },
    branchAngle: { mean: 0.32, spread: 0.1, depthDecay: 0.72 },
    apicalDominance: 0.94,
    leaf: {
      shape: "ovate",
      length: { base: 0.34, tip: 0.16, curve: 1.35 },
      widthRatio: 0.42,
      density: { base: 0.82, tip: 0.18, curve: 2 },
      curl: 0.1,
      serration: 0.18,
      venation: 0.6,
      colorA: 0x2d572f,
      colorB: 0x86aa58,
    },
    flower: {
      whorls: 2,
      petals: 5,
      radius: 0.12,
      color: 0xd06ad8,
      centerColor: 0xf5d3ef,
    },
    lightResponse: {
      shadeAvoidance: 0.72,
      leafBoostInShade: 0.16,
      branchSuppressionInShade: 0.45,
      phototropism: 0.22,
    },
  },
  tulipCup: {
    id: "tulipCup",
    habit: "flower",
    nodeCount: 8,
    internode: { base: 0.13, tip: 0.09, curve: 0.95 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.18, spread: 0.08, depthDecay: 0.7 },
    apicalDominance: 0.96,
    leaf: {
      shape: "lanceolate",
      length: { base: 0.62, tip: 0.34, curve: 1.05 },
      widthRatio: 0.2,
      density: { base: 0.9, tip: 0.22, curve: 1.8 },
      curl: 0.12,
      serration: 0.01,
      venation: 0.42,
      colorA: 0x315f30,
      colorB: 0x9fbb5f,
    },
    flower: {
      whorls: 2,
      petals: 3,
      radius: 0.24,
      color: 0xff9a66,
      centerColor: 0xffd56a,
    },
    lightResponse: {
      shadeAvoidance: 0.48,
      leafBoostInShade: 0.14,
      branchSuppressionInShade: 0.36,
      phototropism: 0.14,
    },
  },
  poppyFlower: {
    id: "poppyFlower",
    habit: "flower",
    nodeCount: 9,
    internode: { base: 0.13, tip: 0.09, curve: 0.95 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.01, tip: 0, curve: 1.3 },
    branchAngle: { mean: 0.34, spread: 0.12, depthDecay: 0.72 },
    apicalDominance: 0.88,
    leaf: {
      shape: "frond",
      length: { base: 0.3, tip: 0.14, curve: 1.25 },
      widthRatio: 0.26,
      density: { base: 0.74, tip: 0.18, curve: 2 },
      curl: 0.08,
      serration: 0.26,
      venation: 0.42,
      colorA: 0x3a612e,
      colorB: 0x95b661,
    },
    flower: {
      whorls: 1,
      petals: 4,
      radius: 0.28,
      color: 0xff2f1f,
      centerColor: 0x282414,
    },
    lightResponse: {
      shadeAvoidance: 0.66,
      leafBoostInShade: 0.14,
      branchSuppressionInShade: 0.42,
      phototropism: 0.2,
    },
  },
  sunflowerTower: {
    id: "sunflowerTower",
    habit: "flower",
    nodeCount: 14,
    internode: { base: 0.16, tip: 0.1, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.03, tip: 0.01, curve: 1.6 },
    branchAngle: { mean: 0.4, spread: 0.14, depthDecay: 0.7 },
    apicalDominance: 0.92,
    leaf: {
      shape: "cordate",
      length: { base: 0.42, tip: 0.24, curve: 1.2 },
      widthRatio: 0.52,
      density: { base: 0.7, tip: 0.34, curve: 1.55 },
      curl: 0.08,
      serration: 0.14,
      venation: 0.7,
      colorA: 0x31572a,
      colorB: 0x8baa4d,
    },
    flower: {
      whorls: 2,
      petals: 17,
      radius: 0.32,
      color: 0xffd22e,
      centerColor: 0x5b3b1b,
    },
    lightResponse: {
      shadeAvoidance: 0.78,
      leafBoostInShade: 0.14,
      branchSuppressionInShade: 0.42,
      phototropism: 0.24,
    },
  },
  cloverGroundcover: {
    id: "cloverGroundcover",
    habit: "vine",
    nodeCount: 12,
    internode: { base: 0.11, tip: 0.08, curve: 1.05 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.18, tip: 0.08, curve: 1.25 },
    branchAngle: { mean: 0.42, spread: 0.2, depthDecay: 0.72 },
    apicalDominance: 0.28,
    leaf: {
      shape: "round",
      length: { base: 0.14, tip: 0.1, curve: 0.9 },
      widthRatio: 0.82,
      density: { base: 0.95, tip: 0.8, curve: 1 },
      curl: 0.035,
      serration: 0.01,
      venation: 0.48,
      colorA: 0x25562d,
      colorB: 0x79b853,
    },
    flower: {
      whorls: 1,
      petals: 9,
      radius: 0.09,
      color: 0xf4e8ff,
      centerColor: 0xd8c4ee,
    },
    groundcover: { radius: 0.72, clusters: 11, leavesPerCluster: 3, height: 0.12, flowerRate: 0.22, runners: true },
    lightResponse: {
      shadeAvoidance: 0.18,
      leafBoostInShade: 0.32,
      branchSuppressionInShade: 0.18,
      phototropism: 0.06,
    },
  },
  woodSorrelCarpet: {
    id: "woodSorrelCarpet",
    habit: "vine",
    nodeCount: 8,
    internode: { base: 0.1, tip: 0.065, curve: 1.05 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.08, tip: 0.02, curve: 1.2 },
    branchAngle: { mean: 0.34, spread: 0.18, depthDecay: 0.72 },
    apicalDominance: 0.22,
    leaf: {
      shape: "cordate",
      length: { base: 0.16, tip: 0.11, curve: 0.9 },
      widthRatio: 0.9,
      density: { base: 0.94, tip: 0.76, curve: 1 },
      curl: 0.035,
      serration: 0,
      venation: 0.34,
      colorA: 0x2b6033,
      colorB: 0x92c85f,
    },
    flower: { whorls: 1, petals: 5, radius: 0.075, color: 0xf7f1ee, centerColor: 0xf2d45c },
    groundcover: { radius: 0.78, clusters: 10, leavesPerCluster: 3, height: 0.1, flowerRate: 0.28, runners: true },
    lightResponse: {
      shadeAvoidance: 0.12,
      leafBoostInShade: 0.36,
      branchSuppressionInShade: 0.12,
      phototropism: 0.05,
    },
  },
  woodlandAnemoneCarpet: {
    id: "woodlandAnemoneCarpet",
    habit: "flower",
    nodeCount: 7,
    internode: { base: 0.09, tip: 0.06, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.03, tip: 0, curve: 1.4 },
    branchAngle: { mean: 0.28, spread: 0.12, depthDecay: 0.7 },
    apicalDominance: 0.64,
    leaf: {
      shape: "palmate",
      length: { base: 0.26, tip: 0.16, curve: 1 },
      widthRatio: 0.7,
      density: { base: 0.9, tip: 0.55, curve: 1 },
      curl: 0.06,
      serration: 0.2,
      venation: 0.42,
      colorA: 0x285331,
      colorB: 0x7fa95a,
    },
    flower: { whorls: 1, petals: 6, radius: 0.13, color: 0xf5f2e4, centerColor: 0xe3c64b },
    groundcover: { radius: 0.86, clusters: 9, leavesPerCluster: 2, height: 0.2, flowerRate: 0.48 },
    lightResponse: {
      shadeAvoidance: 0.24,
      leafBoostInShade: 0.32,
      branchSuppressionInShade: 0.18,
      phototropism: 0.08,
    },
  },
  creepingPhloxCarpet: {
    id: "creepingPhloxCarpet",
    habit: "flower",
    nodeCount: 7,
    internode: { base: 0.08, tip: 0.05, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.08, tip: 0.02, curve: 1.2 },
    branchAngle: { mean: 0.3, spread: 0.14, depthDecay: 0.72 },
    apicalDominance: 0.3,
    leaf: {
      shape: "linear",
      length: { base: 0.18, tip: 0.11, curve: 0.96 },
      widthRatio: 0.2,
      density: { base: 0.94, tip: 0.72, curve: 1 },
      curl: 0.04,
      serration: 0,
      venation: 0.18,
      colorA: 0x315c30,
      colorB: 0x8eb45b,
    },
    flower: { whorls: 1, petals: 5, radius: 0.11, color: 0xd78df0, centerColor: 0xf3d96a },
    groundcover: { radius: 0.95, clusters: 12, leavesPerCluster: 2, height: 0.1, flowerRate: 0.6, runners: true },
    lightResponse: {
      shadeAvoidance: 0.32,
      leafBoostInShade: 0.2,
      branchSuppressionInShade: 0.2,
      phototropism: 0.08,
    },
  },
  wildStrawberryGroundcover: {
    id: "wildStrawberryGroundcover",
    habit: "vine",
    nodeCount: 8,
    internode: { base: 0.1, tip: 0.065, curve: 1.04 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "alternate" },
    branchChance: { base: 0.12, tip: 0.04, curve: 1.2 },
    branchAngle: { mean: 0.38, spread: 0.18, depthDecay: 0.72 },
    apicalDominance: 0.2,
    leaf: {
      shape: "round",
      length: { base: 0.18, tip: 0.12, curve: 0.92 },
      widthRatio: 0.78,
      density: { base: 0.92, tip: 0.72, curve: 1 },
      curl: 0.04,
      serration: 0.22,
      venation: 0.38,
      colorA: 0x285b2d,
      colorB: 0x86bd58,
    },
    flower: { whorls: 1, petals: 5, radius: 0.075, color: 0xf8f3e8, centerColor: 0xe7c94e },
    groundcover: { radius: 0.72, clusters: 8, leavesPerCluster: 3, height: 0.12, flowerRate: 0.2, runners: true },
    accessoryOrgans: [{ kind: "fruit", count: 4, size: 0.085, color: 0xc8322d, secondaryColor: 0xf0a64c, startT: 0.28 }],
    lightResponse: { shadeAvoidance: 0.16, leafBoostInShade: 0.28, branchSuppressionInShade: 0.16, phototropism: 0.06 },
  },
  winterberryShrub: {
    id: "winterberryShrub",
    habit: "shrub",
    nodeCount: 11,
    internode: { base: 0.11, tip: 0.065, curve: 1.18 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "alternate" },
    branchChance: { base: 0.34, tip: 0.14, curve: 1.25 },
    branchAngle: { mean: 0.62, spread: 0.24, depthDecay: 0.72 },
    apicalDominance: 0.34,
    leaf: {
      shape: "ovate",
      length: { base: 0.2, tip: 0.13, curve: 0.94 },
      widthRatio: 0.5,
      density: { base: 0.72, tip: 0.58, curve: 1 },
      curl: 0.06,
      serration: 0.16,
      venation: 0.5,
      colorA: 0x315831,
      colorB: 0x89a95a,
    },
    accessoryOrgans: [{ kind: "berry", count: 10, size: 0.07, color: 0xd83a28, secondaryColor: 0x6d1f18, startT: 0.38 }],
    lightResponse: { shadeAvoidance: 0.28, leafBoostInShade: 0.2, branchSuppressionInShade: 0.18, phototropism: 0.12 },
  },
  shorePineCones: {
    id: "shorePineCones",
    habit: "conifer",
    nodeCount: 12,
    internode: { base: 0.15, tip: 0.065, curve: 1.24 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "whorled", whorlCount: 3 },
    branchChance: { base: 0.28, tip: 0.1, curve: 1.26 },
    branchAngle: { mean: 0.78, spread: 0.2, depthDecay: 0.72 },
    apicalDominance: 0.76,
    leaf: {
      shape: "linear",
      length: { base: 0.52, tip: 0.22, curve: 1.16 },
      widthRatio: 0.15,
      density: { base: 0.78, tip: 0.56, curve: 1 },
      curl: 0.16,
      serration: 0,
      venation: 0.05,
      colorA: 0x254033,
      colorB: 0x718a62,
    },
    foliage: { mass: 0.78, clusterDensity: 0.82, whorlDensity: 0.72, tipBias: 0.48, size: 0.62 },
    accessoryOrgans: [{ kind: "cone", count: 6, size: 0.13, color: 0x705036, secondaryColor: 0xa77b4c, startT: 0.34, endT: 0.86 }],
    lightResponse: { shadeAvoidance: 0.24, leafBoostInShade: 0.1, branchSuppressionInShade: 0.16, phototropism: 0.06 },
  },
  thornyBramble: {
    id: "thornyBramble",
    habit: "shrub",
    nodeCount: 10,
    internode: { base: 0.12, tip: 0.07, curve: 1.12 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "alternate" },
    branchChance: { base: 0.4, tip: 0.18, curve: 1.2 },
    branchAngle: { mean: 0.68, spread: 0.26, depthDecay: 0.7 },
    apicalDominance: 0.3,
    leaf: {
      shape: "ovate",
      length: { base: 0.19, tip: 0.12, curve: 0.96 },
      widthRatio: 0.5,
      density: { base: 0.76, tip: 0.6, curve: 1 },
      curl: 0.08,
      serration: 0.24,
      venation: 0.48,
      colorA: 0x294f2c,
      colorB: 0x789d50,
    },
    accessoryOrgans: [
      { kind: "thorn", count: 14, size: 0.075, color: 0x8b6847, startT: 0.16, endT: 0.9 },
      { kind: "berry", count: 6, size: 0.075, color: 0x2c1838, secondaryColor: 0x8b315b, startT: 0.48 },
    ],
    lightResponse: { shadeAvoidance: 0.3, leafBoostInShade: 0.18, branchSuppressionInShade: 0.2, phototropism: 0.1 },
  },
  epiphyticAroidRoots: {
    id: "epiphyticAroidRoots",
    habit: "tropical",
    nodeCount: 8,
    internode: { base: 0.12, tip: 0.075, curve: 1.06 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "alternate" },
    branchChance: { base: 0.16, tip: 0.05, curve: 1.3 },
    branchAngle: { mean: 0.52, spread: 0.2, depthDecay: 0.7 },
    apicalDominance: 0.58,
    leaf: {
      shape: "cordate",
      length: { base: 0.42, tip: 0.27, curve: 0.9 },
      widthRatio: 0.62,
      density: { base: 0.82, tip: 0.7, curve: 1 },
      curl: 0.12,
      serration: 0,
      venation: 0.72,
      colorA: 0x1f5738,
      colorB: 0x76b565,
    },
    accessoryOrgans: [{ kind: "aerialRoot", count: 6, size: 0.34, color: 0x765f45, secondaryColor: 0xb29a71, startT: 0.3, endT: 0.86 }],
    lightResponse: { shadeAvoidance: 0.36, leafBoostInShade: 0.3, branchSuppressionInShade: 0.2, phototropism: 0.14 },
  },
  climbingIvy: {
    id: "climbingIvy",
    habit: "vine",
    nodeCount: 16,
    internode: { base: 0.12, tip: 0.085, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "alternate" },
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.5, spread: 0.12, depthDecay: 0.7 },
    apicalDominance: 0.88,
    leaf: {
      shape: "palmate",
      length: { base: 0.2, tip: 0.13, curve: 1 },
      widthRatio: 0.74,
      density: { base: 1, tip: 0.82, curve: 1 },
      curl: 0.06,
      serration: 0.08,
      venation: 0.62,
      colorA: 0x234f2d,
      colorB: 0x75a957,
    },
    vine: {
      mode: "climb",
      support: { position: [0, 0, 0], direction: [0, 1, 0], radius: 0.11, height: 1.55 },
      turns: 0.42,
      adhesion: 0.92,
      avoidanceRadius: 0.035,
      leafEvery: 1,
    },
    lightResponse: { shadeAvoidance: 0.3, leafBoostInShade: 0.28, branchSuppressionInShade: 0.2, phototropism: 0.14 },
  },
  canopyLiana: {
    id: "canopyLiana",
    habit: "vine",
    nodeCount: 18,
    internode: { base: 0.14, tip: 0.09, curve: 1.08 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "spiral" },
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.56, spread: 0.14, depthDecay: 0.7 },
    apicalDominance: 0.9,
    leaf: {
      shape: "cordate",
      length: { base: 0.29, tip: 0.17, curve: 1.06 },
      widthRatio: 0.62,
      density: { base: 0.82, tip: 0.68, curve: 1 },
      curl: 0.1,
      serration: 0,
      venation: 0.66,
      colorA: 0x1d5531,
      colorB: 0x70ad55,
    },
    vine: {
      mode: "wrap",
      support: { position: [0, 0, 0], direction: [0, 1, 0], radius: 0.2, height: 2.05 },
      turns: 2.15,
      adhesion: 0.9,
      avoidanceRadius: 0.04,
      sag: 0.05,
      leafEvery: 2,
    },
    accessoryOrgans: [{ kind: "aerialRoot", count: 4, size: 0.24, color: 0x6f563d, startT: 0.24, endT: 0.82 }],
    lightResponse: { shadeAvoidance: 0.42, leafBoostInShade: 0.32, branchSuppressionInShade: 0.2, phototropism: 0.18 },
  },
  floweringWallCreeper: {
    id: "floweringWallCreeper",
    habit: "vine",
    nodeCount: 17,
    internode: { base: 0.12, tip: 0.075, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "alternate" },
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.5, spread: 0.14, depthDecay: 0.7 },
    apicalDominance: 0.86,
    leaf: {
      shape: "ovate",
      length: { base: 0.18, tip: 0.12, curve: 1 },
      widthRatio: 0.58,
      density: { base: 0.96, tip: 0.76, curve: 1 },
      curl: 0.05,
      serration: 0.05,
      venation: 0.5,
      colorA: 0x285b32,
      colorB: 0x82b65d,
    },
    flower: { whorls: 1, petals: 5, radius: 0.09, color: 0xd9a3e8, centerColor: 0xf3df82 },
    vine: {
      mode: "follow",
      guide: [[0, 0, 0], [0.18, 0.42, 0.02], [-0.15, 0.9, 0.035], [0.24, 1.34, 0.02], [-0.06, 1.72, 0]],
      adhesion: 0.94,
      avoidanceRadius: 0.035,
      sag: 0.045,
      leafEvery: 1,
      flowerEvery: 4,
      flowerStartT: 0.42,
    },
    lightResponse: { shadeAvoidance: 0.32, leafBoostInShade: 0.24, branchSuppressionInShade: 0.2, phototropism: 0.12 },
  },
  hangingMoss: {
    id: "hangingMoss",
    habit: "moss",
    nodeCount: 18,
    internode: { base: 0.08, tip: 0.055, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "spiral" },
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.36, spread: 0.1, depthDecay: 0.7 },
    apicalDominance: 0.96,
    leaf: {
      shape: "linear",
      length: { base: 0.11, tip: 0.065, curve: 1 },
      widthRatio: 0.24,
      density: { base: 1, tip: 0.82, curve: 1 },
      curl: 0.1,
      serration: 0,
      venation: 0.12,
      colorA: 0x446a34,
      colorB: 0x9aae62,
    },
    vine: {
      mode: "hang",
      support: { position: [0, 1.65, 0], direction: [0, 1, 0], radius: 0.04, height: 1.48 },
      turns: 0.38,
      adhesion: 0.84,
      avoidanceRadius: 0.025,
      sag: 0.18,
      leafEvery: 1,
    },
    moss: { clumps: 18, radius: 0.06, height: 0.11, tuftsPerClump: 1, surfaceJitter: 0.18 },
    lightResponse: { shadeAvoidance: 0.08, leafBoostInShade: 0.34, branchSuppressionInShade: 0.12, phototropism: 0.04 },
  },
  cushionMoss: {
    id: "cushionMoss",
    habit: "moss",
    nodeCount: 10,
    internode: { base: 0.05, tip: 0.03, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "whorled", whorlCount: 3 },
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.3, spread: 0.08, depthDecay: 0.7 },
    apicalDominance: 0.2,
    leaf: {
      shape: "linear",
      length: { base: 0.07, tip: 0.045, curve: 1 },
      widthRatio: 0.28,
      density: { base: 1, tip: 0.9, curve: 1 },
      curl: 0.04,
      serration: 0,
      venation: 0.08,
      colorA: 0x365f31,
      colorB: 0x91aa55,
    },
    moss: { clumps: 12, radius: 0.62, height: 0.085, tuftsPerClump: 2, surfaceJitter: 0.28 },
    lightResponse: { shadeAvoidance: 0.05, leafBoostInShade: 0.28, branchSuppressionInShade: 0.1, phototropism: 0.02 },
  },
  laceUmbel: {
    id: "laceUmbel",
    habit: "flower",
    nodeCount: 12,
    internode: { base: 0.14, tip: 0.09, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.03, tip: 0.01, curve: 1.7 },
    branchAngle: { mean: 0.6, spread: 0.24, depthDecay: 0.72 },
    apicalDominance: 0.88,
    leaf: {
      shape: "frond",
      length: { base: 0.24, tip: 0.12, curve: 1.25 },
      widthRatio: 0.2,
      density: { base: 0.62, tip: 0.2, curve: 1.9 },
      curl: 0.12,
      serration: 0.2,
      venation: 0.44,
      colorA: 0x2b6234,
      colorB: 0x91bd64,
    },
    flower: {
      whorls: 1,
      petals: 5,
      radius: 0.055,
      color: 0xfff7e8,
      centerColor: 0xf1df8c,
    },
    lightResponse: {
      shadeAvoidance: 0.82,
      leafBoostInShade: 0.16,
      branchSuppressionInShade: 0.46,
      phototropism: 0.26,
    },
  },
  irisBulb: {
    id: "irisBulb",
    habit: "flower",
    nodeCount: 10,
    internode: { base: 0.16, tip: 0.1, curve: 0.92 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.01, tip: 0, curve: 1.3 },
    branchAngle: { mean: 0.22, spread: 0.08, depthDecay: 0.7 },
    apicalDominance: 0.92,
    leaf: {
      shape: "linear",
      length: { base: 0.92, tip: 0.52, curve: 1.05 },
      widthRatio: 0.075,
      density: { base: 1, tip: 0.32, curve: 1.8 },
      curl: 0.1,
      serration: 0,
      venation: 0.32,
      colorA: 0x315d36,
      colorB: 0x9dbb68,
    },
    flower: {
      whorls: 2,
      petals: 3,
      radius: 0.24,
      color: 0xb79cff,
      centerColor: 0xffd26a,
    },
    clump: { count: 5, radius: 0.24, jitter: 0.5, scaleVar: 0.26, lean: 0.4 },
    lightResponse: {
      shadeAvoidance: 0.58,
      leafBoostInShade: 0.12,
      branchSuppressionInShade: 0.4,
      phototropism: 0.16,
    },
  },
  agaveSucculent: {
    id: "agaveSucculent",
    habit: "tropical",
    nodeCount: 8,
    internode: { base: 0.04, tip: 0.025, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 1.1, spread: 0.18, depthDecay: 0.5 },
    apicalDominance: 0.94,
    leaf: {
      shape: "spatulate",
      length: { base: 0.72, tip: 0.42, curve: 0.85 },
      widthRatio: 0.22,
      density: { base: 1, tip: 1, curve: 1 },
      curl: -0.12,
      serration: 0.08,
      venation: 0.18,
      colorA: 0x536f62,
      colorB: 0xb5c9a9,
    },
    lightResponse: {
      shadeAvoidance: 0.08,
      leafBoostInShade: 0.04,
      branchSuppressionInShade: 0.1,
      phototropism: 0.03,
    },
  },
  tropicalAroid: {
    id: "tropicalAroid",
    habit: "tropical",
    nodeCount: 13,
    internode: { base: 0.16, tip: 0.1, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.12, tip: 0.04, curve: 1.4 },
    branchAngle: { mean: 0.78, spread: 0.25, depthDecay: 0.55 },
    apicalDominance: 0.72,
    leaf: {
      shape: "cordate",
      length: { base: 0.72, tip: 0.46, curve: 0.8 },
      widthRatio: 0.62,
      density: { base: 0.75, tip: 0.55, curve: 1 },
      curl: 0.2,
      serration: 0.02,
      venation: 0.85,
      colorA: 0x244d2a,
      colorB: 0x66a94f,
    },
    flower: {
      whorls: 1,
      petals: 1,
      radius: 0.12,
      color: 0xe9f0c9,
      centerColor: 0xf6db6b,
    },
    lightResponse: {
      shadeAvoidance: 0.42,
      leafBoostInShade: 0.62,
      branchSuppressionInShade: 0.22,
      phototropism: 0.2,
    },
  },
  understoryShrub: {
    id: "understoryShrub",
    habit: "shrub",
    nodeCount: 15,
    internode: { base: 0.14, tip: 0.08, curve: 1.15 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.36, tip: 0.12, curve: 1.6 },
    branchAngle: { mean: 0.64, spread: 0.22, depthDecay: 0.68 },
    apicalDominance: 0.48,
    leaf: {
      shape: "ovate",
      length: { base: 0.28, tip: 0.18, curve: 1 },
      widthRatio: 0.42,
      density: { base: 0.9, tip: 0.7, curve: 1 },
      curl: 0.12,
      serration: 0.12,
      venation: 0.6,
      colorA: 0x2d5b24,
      colorB: 0x7fb449,
    },
    lightResponse: {
      shadeAvoidance: 0.38,
      leafBoostInShade: 0.32,
      branchSuppressionInShade: 0.28,
      phototropism: 0.15,
    },
  },
  colonizedHazelShrub: {
    id: "colonizedHazelShrub",
    habit: "shrub",
    nodeCount: 18,
    internode: { base: 0.15, tip: 0.09, curve: 1.08 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "alternate", phase: 0.24 },
    branchChance: { base: 0.38, tip: 0.16, curve: 1.45 },
    branchAngle: { mean: 0.68, spread: 0.22, depthDecay: 0.7 },
    apicalDominance: 0.46,
    leaf: {
      shape: "ovate",
      length: { base: 0.24, tip: 0.17, curve: 0.9 },
      widthRatio: 0.52,
      density: { base: 0.72, tip: 0.96, curve: 0.72 },
      curl: 0.11,
      serration: 0.18,
      venation: 0.68,
      colorA: 0x2b5625,
      colorB: 0x78a947,
    },
    foliage: {
      mass: 0.72,
      clusterDensity: 0.82,
      whorlDensity: 0.44,
      tipBias: 0.84,
      size: 0.92,
    },
    treeRealism: {
      crownSpread: 0.78,
      crownTaper: 0.28,
      trunkFlare: 0.38,
      trunkBend: 0.2,
      branchGnarl: 0.22,
      windFlex: 0.62,
      colorVariance: 0.12,
    },
    spaceColonization: {
      volume: {
        shape: "ellipsoid",
        center: [0, 1.52, 0],
        dimensions: [1.12, 1.02, 0.96],
      },
      attractorCount: 176,
      segmentLength: 0.145,
      influenceRadius: 0.62,
      killRadius: 0.17,
      collisionRadius: 0.045,
      maxSteps: 96,
      maxNodes: 260,
      maxChildren: 2,
      tropism: [0.08, 1, 0.03],
      tropismStrength: 0.045,
      directionJitter: 0.055,
      pipeExponent: 2.2,
      tipRadius: 0.0085,
      radialSegments: 5,
      barkColor: 0x6a5137,
      barkIrregularity: 0.055,
      foliageSpacing: 4,
      terminalLeafCount: 3,
      foliageStart: 0.44,
      leafScale: 0.92,
    },
    lightResponse: {
      shadeAvoidance: 0.28,
      leafBoostInShade: 0.26,
      branchSuppressionInShade: 0.2,
      phototropism: 0.14,
    },
  },
  reedSedge: {
    id: "reedSedge",
    habit: "grass",
    nodeCount: 11,
    internode: { base: 0.18, tip: 0.11, curve: 0.85 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.01, tip: 0, curve: 1 },
    branchAngle: { mean: 0.16, spread: 0.08, depthDecay: 0.6 },
    apicalDominance: 0.94,
    leaf: {
      shape: "linear",
      length: { base: 0.75, tip: 1.35, curve: 1.05 },
      widthRatio: 0.024,
      density: { base: 1, tip: 0.9, curve: 1 },
      curl: 0.1,
      serration: 0,
      venation: 0.2,
      colorA: 0x4a612c,
      colorB: 0xc1bd67,
    },
    grass: { blades: 26, furBias: 0.45, heightJitter: 0.22 },
    flower: {
      whorls: 1,
      petals: 1,
      radius: 0.08,
      color: 0x8a6336,
      centerColor: 0x5f3d25,
    },
    lightResponse: {
      shadeAvoidance: 0.62,
      leafBoostInShade: 0.08,
      branchSuppressionInShade: 0.5,
      phototropism: 0.12,
    },
  },
  desertRosette: {
    id: "desertRosette",
    habit: "tropical",
    nodeCount: 7,
    internode: { base: 0.045, tip: 0.03, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.01, tip: 0, curve: 1 },
    branchAngle: { mean: 1.02, spread: 0.18, depthDecay: 0.45 },
    apicalDominance: 0.88,
    leaf: {
      shape: "spatulate",
      length: { base: 0.62, tip: 0.42, curve: 0.78 },
      widthRatio: 0.34,
      density: { base: 1, tip: 0.95, curve: 1 },
      curl: -0.06,
      serration: 0.03,
      venation: 0.25,
      colorA: 0x5e8567,
      colorB: 0xb7cf9f,
    },
    flower: {
      whorls: 2,
      petals: 6,
      radius: 0.12,
      color: 0xffa85f,
      centerColor: 0xffe08a,
    },
    lightResponse: {
      shadeAvoidance: 0.18,
      leafBoostInShade: 0.05,
      branchSuppressionInShade: 0.15,
      phototropism: 0.04,
    },
  },
  lotusBloom: {
    id: "lotusBloom",
    habit: "flower",
    nodeCount: 8,
    internode: { base: 0.19, tip: 0.12, curve: 0.9 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.03, tip: 0.01, curve: 1.4 },
    branchAngle: { mean: 0.92, spread: 0.2, depthDecay: 0.55 },
    apicalDominance: 0.86,
    leaf: {
      shape: "palmate",
      length: { base: 0.78, tip: 0.44, curve: 0.7 },
      widthRatio: 0.72,
      density: { base: 0.7, tip: 0.42, curve: 1.15 },
      curl: 0.05,
      serration: 0.02,
      venation: 0.9,
      colorA: 0x2e6e45,
      colorB: 0x78b866,
    },
    flower: {
      whorls: 3,
      petals: 8,
      radius: 0.28,
      color: 0xffd7e8,
      centerColor: 0xffcf58,
    },
    lightResponse: {
      shadeAvoidance: 0.38,
      leafBoostInShade: 0.24,
      branchSuppressionInShade: 0.3,
      phototropism: 0.18,
    },
  },
  bambooClump: {
    id: "bambooClump",
    habit: "grass",
    nodeCount: 16,
    internode: { base: 0.22, tip: 0.16, curve: 0.92 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.02, tip: 0, curve: 1 },
    branchAngle: { mean: 0.2, spread: 0.08, depthDecay: 0.6 },
    apicalDominance: 0.96,
    leaf: {
      shape: "linear",
      length: { base: 1.0, tip: 1.8, curve: 1.1 },
      widthRatio: 0.018,
      density: { base: 1, tip: 0.95, curve: 1 },
      curl: 0.04,
      serration: 0,
      venation: 0.12,
      colorA: 0x4b7d35,
      colorB: 0xb8d46c,
    },
    grass: { blades: 18, furBias: 0.12, heightJitter: 0.12 },
    lightResponse: {
      shadeAvoidance: 0.7,
      leafBoostInShade: 0.08,
      branchSuppressionInShade: 0.38,
      phototropism: 0.12,
    },
  },
  fanPalmUnderstory: {
    id: "fanPalmUnderstory",
    habit: "tropical",
    nodeCount: 10,
    internode: { base: 0.11, tip: 0.07, curve: 1.1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.04, tip: 0.01, curve: 1.6 },
    branchAngle: { mean: 0.88, spread: 0.28, depthDecay: 0.55 },
    apicalDominance: 0.8,
    leaf: {
      shape: "fan",
      length: { base: 0.68, tip: 0.54, curve: 0.9 },
      widthRatio: 0.82,
      density: { base: 0.8, tip: 0.68, curve: 1 },
      curl: 0.14,
      serration: 0.18,
      venation: 0.95,
      colorA: 0x286d37,
      colorB: 0x79bd4e,
    },
    lightResponse: {
      shadeAvoidance: 0.28,
      leafBoostInShade: 0.5,
      branchSuppressionInShade: 0.18,
      phototropism: 0.16,
    },
  },
  vincaVine: {
    id: "vincaVine",
    habit: "vine",
    nodeCount: 18,
    internode: { base: 0.17, tip: 0.11, curve: 1.05 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.24, tip: 0.08, curve: 1.35 },
    branchAngle: { mean: 0.48, spread: 0.18, depthDecay: 0.72 },
    apicalDominance: 0.42,
    leaf: {
      shape: "round",
      length: { base: 0.22, tip: 0.16, curve: 0.9 },
      widthRatio: 0.86,
      density: { base: 0.95, tip: 0.78, curve: 1 },
      curl: 0.05,
      serration: 0.01,
      venation: 0.5,
      colorA: 0x244f2d,
      colorB: 0x78af58,
    },
    flower: {
      whorls: 1,
      petals: 5,
      radius: 0.16,
      color: 0xb7a7ff,
      centerColor: 0xf5f0ba,
    },
    lightResponse: {
      shadeAvoidance: 0.46,
      leafBoostInShade: 0.28,
      branchSuppressionInShade: 0.24,
      phototropism: 0.1,
    },
  },
  roseBush: {
    id: "roseBush",
    habit: "shrub",
    nodeCount: 16,
    internode: { base: 0.12, tip: 0.07, curve: 1.22 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.42, tip: 0.16, curve: 1.45 },
    branchAngle: { mean: 0.58, spread: 0.22, depthDecay: 0.74 },
    apicalDominance: 0.34,
    leaf: {
      shape: "round",
      length: { base: 0.2, tip: 0.13, curve: 1 },
      widthRatio: 0.72,
      density: { base: 0.92, tip: 0.76, curve: 1 },
      curl: 0.08,
      serration: 0.28,
      venation: 0.65,
      colorA: 0x2f5b2e,
      colorB: 0x7fac4d,
    },
    flower: {
      whorls: 4,
      petals: 9,
      radius: 0.2,
      color: 0xd84d63,
      centerColor: 0xffc76a,
    },
    lightResponse: {
      shadeAvoidance: 0.34,
      leafBoostInShade: 0.18,
      branchSuppressionInShade: 0.2,
      phototropism: 0.16,
    },
  },
  sugarMaple: {
    id: "sugarMaple",
    habit: "tree",
    nodeCount: 18,
    internode: { base: 0.18, tip: 0.08, curve: 1.2 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "opposite", phase: 0.18 },
    branchChance: { base: 0.32, tip: 0.18, curve: 1.08 },
    branchAngle: { mean: 0.76, spread: 0.27, depthDecay: 0.7 },
    apicalDominance: 0.36,
    leaf: {
      shape: "palmate",
      length: { base: 0.24, tip: 0.18, curve: 0.86 },
      widthRatio: 0.78,
      density: { base: 0.58, tip: 0.94, curve: 0.72 },
      curl: 0.08,
      serration: 0.2,
      venation: 0.82,
      colorA: 0x2d5e2b,
      colorB: 0x96b84f,
    },
    foliage: { mass: 0.82, clusterDensity: 0.94, whorlDensity: 0.5, tipBias: 0.76, size: 0.84 },
    tree: { crown: "rounded", crownStart: 0.34, leafClusterScale: 0.92, exposedTrunk: 0.36 },
    treeRealism: { crownSpread: 0.82, crownTaper: 0.34, trunkFlare: 0.44, trunkBend: 0.14, branchGnarl: 0.24, windFlex: 0.46, colorVariance: 0.14 },
    spaceColonization: {
      volume: { shape: "ellipsoid", center: [0, 1.72, 0], dimensions: [1.48, 1.18, 1.34] },
      attractorCount: 168,
      segmentLength: 0.16,
      influenceRadius: 0.68,
      killRadius: 0.19,
      collisionRadius: 0.05,
      maxSteps: 92,
      maxNodes: 240,
      maxChildren: 2,
      tropism: [0.04, 1, 0.02],
      tropismStrength: 0.04,
      directionJitter: 0.05,
      pipeExponent: 2.25,
      tipRadius: 0.009,
      radialSegments: 4,
      barkColor: 0x66503b,
      barkIrregularity: 0.05,
      foliageSpacing: 4,
      terminalLeafCount: 3,
      foliageStart: 0.42,
      leafScale: 0.86,
    },
    lightResponse: { shadeAvoidance: 0.36, leafBoostInShade: 0.2, branchSuppressionInShade: 0.18, phototropism: 0.13 },
  },
  weepingWillow: {
    id: "weepingWillow",
    habit: "tree",
    nodeCount: 18,
    internode: { base: 0.17, tip: 0.075, curve: 1.22 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "alternate", phase: 0.42 },
    branchChance: { base: 0.22, tip: 0.3, curve: 0.84 },
    branchAngle: { mean: 0.62, spread: 0.2, depthDecay: 0.76 },
    apicalDominance: 0.42,
    leaf: {
      shape: "lanceolate",
      length: { base: 0.19, tip: 0.14, curve: 0.92 },
      widthRatio: 0.2,
      density: { base: 0.52, tip: 0.9, curve: 0.72 },
      curl: 0.18,
      serration: 0.06,
      venation: 0.52,
      colorA: 0x315f32,
      colorB: 0xa5bf62,
    },
    foliage: { mass: 0.74, clusterDensity: 0.82, whorlDensity: 0.36, tipBias: 0.9, size: 0.78 },
    tree: { crown: "spreading", crownStart: 0.42, leafClusterScale: 0.82, exposedTrunk: 0.44 },
    treeRealism: { crownSpread: 0.86, crownTaper: 0.18, trunkFlare: 0.38, trunkBend: 0.2, branchGnarl: 0.22, windFlex: 0.82, colorVariance: 0.12 },
    branchModules: {
      palette: "weeping",
      moduleBudget: 78,
      levels: 3,
      vigor: 0.92,
      branchDensity: 0.72,
      branchAngle: 0.88,
      spread: 1.08,
      droop: 1.28,
      tropism: 0.28,
      gnarliness: 0.18,
      collisionBias: 0.42,
      junctionBlend: 0.66,
      foliageSource: "procplants",
      barkColor: 0x66533a,
      leafColor: 0x315f32,
    },
    lightResponse: { shadeAvoidance: 0.3, leafBoostInShade: 0.28, branchSuppressionInShade: 0.16, phototropism: 0.12 },
  },
  windsweptBonsai: {
    id: "windsweptBonsai",
    habit: "shrub",
    nodeCount: 8,
    internode: { base: 0.11, tip: 0.055, curve: 1.3 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "alternate", phase: 0.7 },
    branchChance: { base: 0.3, tip: 0.18, curve: 1.2 },
    branchAngle: { mean: 0.72, spread: 0.32, depthDecay: 0.66 },
    apicalDominance: 0.28,
    leaf: {
      shape: "ovate",
      length: { base: 0.12, tip: 0.08, curve: 0.9 },
      widthRatio: 0.46,
      density: { base: 0.32, tip: 0.84, curve: 0.58 },
      curl: 0.1,
      serration: 0.08,
      venation: 0.55,
      colorA: 0x254c28,
      colorB: 0x789653,
    },
    foliage: { mass: 0.52, clusterDensity: 0.68, whorlDensity: 0.3, tipBias: 0.96, size: 0.68 },
    tree: { crown: "spreading", crownStart: 0.28, leafClusterScale: 0.7, exposedTrunk: 0.48 },
    treeRealism: { crownSpread: 0.9, crownTaper: 0.22, trunkFlare: 0.62, trunkBend: 0.72, branchGnarl: 0.76, windFlex: 0.28, colorVariance: 0.18 },
    branchModules: {
      palette: "shrub",
      moduleBudget: 54,
      levels: 3,
      vigor: 0.72,
      branchDensity: 0.62,
      branchAngle: 0.82,
      spread: 1.18,
      droop: 0.2,
      tropism: 0.22,
      gnarliness: 0.62,
      collisionBias: 0.52,
      junctionBlend: 0.7,
      foliageSource: "procplants",
      barkColor: 0x594331,
      leafColor: 0x254c28,
    },
    lightResponse: { shadeAvoidance: 0.2, leafBoostInShade: 0.12, branchSuppressionInShade: 0.18, phototropism: 0.08 },
  },
  deadwoodSnag: {
    id: "deadwoodSnag",
    habit: "tree",
    nodeCount: 16,
    internode: { base: 0.18, tip: 0.07, curve: 1.3 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.24, tip: 0.08, curve: 1.3 },
    branchAngle: { mean: 0.8, spread: 0.4, depthDecay: 0.68 },
    apicalDominance: 0.6,
    leaf: {
      shape: "linear",
      length: { base: 0.01, tip: 0.01, curve: 1 },
      widthRatio: 0.1,
      density: { base: 0, tip: 0, curve: 1 },
      curl: 0,
      serration: 0,
      venation: 0,
      colorA: 0x5b503d,
      colorB: 0x81745d,
    },
    foliage: { mass: 0, clusterDensity: 0, whorlDensity: 0, tipBias: 1, size: 0.1 },
    tree: { crown: "columnar", crownStart: 0.18, leafClusterScale: 0, exposedTrunk: 0.9 },
    treeRealism: { crownSpread: 0.5, crownTaper: 0.72, trunkFlare: 0.58, trunkBend: 0.42, branchGnarl: 0.9, windFlex: 0.04, colorVariance: 0.22 },
    branchModules: {
      palette: "decurrent-broadleaf",
      moduleBudget: 62,
      levels: 3,
      vigor: 0.76,
      branchDensity: 0.52,
      branchAngle: 0.96,
      spread: 0.72,
      droop: 0.18,
      tropism: 0.18,
      gnarliness: 0.84,
      collisionBias: 0.58,
      junctionBlend: 0.5,
      foliageSource: "procplants",
      barkColor: 0x62523f,
      leafColor: 0x5b503d,
    },
    lightResponse: { shadeAvoidance: 0, leafBoostInShade: 0, branchSuppressionInShade: 0, phototropism: 0 },
  },
  twilightFantasyTree: {
    id: "twilightFantasyTree",
    habit: "tree",
    nodeCount: 16,
    internode: { base: 0.16, tip: 0.07, curve: 1.18 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    phyllotaxy: { mode: "whorled", whorlCount: 3, phase: 0.36 },
    branchChance: { base: 0.26, tip: 0.2, curve: 1.02 },
    branchAngle: { mean: 0.88, spread: 0.22, depthDecay: 0.72 },
    apicalDominance: 0.44,
    leaf: {
      shape: "cordate",
      length: { base: 0.2, tip: 0.15, curve: 0.86 },
      widthRatio: 0.68,
      density: { base: 0.5, tip: 0.88, curve: 0.68 },
      curl: 0.16,
      serration: 0.04,
      venation: 0.86,
      colorA: 0x30505d,
      colorB: 0x8895bd,
    },
    foliage: { mass: 0.66, clusterDensity: 0.76, whorlDensity: 0.48, tipBias: 0.86, size: 0.8 },
    tree: { crown: "umbrella", crownStart: 0.46, leafClusterScale: 0.86, exposedTrunk: 0.46 },
    treeRealism: { crownSpread: 0.9, crownTaper: 0.2, trunkFlare: 0.46, trunkBend: 0.26, branchGnarl: 0.3, windFlex: 0.58, colorVariance: 0.1 },
    branchModules: {
      palette: "decurrent-broadleaf",
      moduleBudget: 70,
      levels: 3,
      vigor: 0.84,
      branchDensity: 0.68,
      branchAngle: 1.06,
      spread: 1.2,
      droop: 0.08,
      tropism: 0.62,
      gnarliness: 0.24,
      collisionBias: 0.48,
      junctionBlend: 0.72,
      foliageSource: "procplants",
      barkColor: 0x55465f,
      leafColor: 0x30505d,
    },
    lightResponse: { shadeAvoidance: 0.42, leafBoostInShade: 0.22, branchSuppressionInShade: 0.18, phototropism: 0.2 },
  },
  oakCanopy: {
    id: "oakCanopy",
    habit: "tree",
    nodeCount: 18,
    internode: { base: 0.18, tip: 0.08, curve: 1.28 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.34, tip: 0.2, curve: 1.05 },
    branchAngle: { mean: 0.68, spread: 0.32, depthDecay: 0.72 },
    apicalDominance: 0.34,
    leaf: {
      shape: "ovate",
      length: { base: 0.26, tip: 0.2, curve: 0.9 },
      widthRatio: 0.54,
      density: { base: 0.68, tip: 0.92, curve: 0.78 },
      curl: 0.09,
      serration: 0.12,
      venation: 0.66,
      colorA: 0x2a5426,
      colorB: 0x83a94d,
    },
    tree: {
      crown: "spreading",
      crownStart: 0.2,
      leafClusterScale: 1.05,
      exposedTrunk: 0.28,
    },
    foliage: { mass: 1.1, clusterDensity: 1.5, whorlDensity: 0.5, tipBias: 0.62, size: 0.82 },
    treeRealism: { crownSpread: 0.78, crownTaper: 0.36, trunkFlare: 0.46, trunkBend: 0.16, branchGnarl: 0.32, windFlex: 0.42, colorVariance: 0.16 },
    weberPenn: {
      species: "cambridgeOak",
      nativeLeaves: true,
      crownFill: true,
      foliageSource: "procplants",
      fillAnchor: "leaf-sites",
      maxBranchDepth: 3,
      maxStems: 80,
      maxLeaves: 220,
      leafScaleMultiplier: 2.05,
      radialSegments: 4,
      branchSamples: 2,
    },
    lightResponse: {
      shadeAvoidance: 0.42,
      leafBoostInShade: 0.18,
      branchSuppressionInShade: 0.18,
      phototropism: 0.12,
    },
  },
  birchGrove: {
    id: "birchGrove",
    habit: "tree",
    nodeCount: 20,
    internode: { base: 0.2, tip: 0.09, curve: 1.12 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.18, tip: 0.14, curve: 1 },
    branchAngle: { mean: 0.46, spread: 0.22, depthDecay: 0.76 },
    apicalDominance: 0.64,
    leaf: {
      shape: "round",
      length: { base: 0.18, tip: 0.13, curve: 0.9 },
      widthRatio: 0.68,
      density: { base: 0.48, tip: 0.82, curve: 0.72 },
      curl: 0.06,
      serration: 0.22,
      venation: 0.58,
      colorA: 0x4b7034,
      colorB: 0xb6c95e,
    },
    tree: {
      crown: "columnar",
      crownStart: 0.42,
      leafClusterScale: 0.82,
      exposedTrunk: 0.5,
    },
    foliage: { mass: 0.92, clusterDensity: 1.3, whorlDensity: 0.42, tipBias: 0.76, size: 0.68 },
    treeRealism: { crownSpread: 0.46, crownTaper: 0.22, trunkFlare: 0.24, trunkBend: 0.22, branchGnarl: 0.18, windFlex: 0.74, colorVariance: 0.18 },
    weberPenn: {
      species: "silverBirch",
      nativeLeaves: true,
      crownFill: true,
      foliageSource: "procplants",
      fillAnchor: "leaf-sites",
      maxBranchDepth: 3,
      maxStems: 72,
      maxLeaves: 200,
      leafScaleMultiplier: 3.05,
      radialSegments: 4,
      branchSamples: 2,
    },
    lightResponse: {
      shadeAvoidance: 0.58,
      leafBoostInShade: 0.16,
      branchSuppressionInShade: 0.26,
      phototropism: 0.2,
    },
  },
  acaciaUmbrella: {
    id: "acaciaUmbrella",
    habit: "tree",
    nodeCount: 15,
    internode: { base: 0.18, tip: 0.075, curve: 1.25 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.14, tip: 0.34, curve: 0.78 },
    branchAngle: { mean: 0.92, spread: 0.28, depthDecay: 0.74 },
    apicalDominance: 0.42,
    leaf: {
      shape: "round",
      length: { base: 0.13, tip: 0.1, curve: 0.9 },
      widthRatio: 0.58,
      density: { base: 0.36, tip: 0.86, curve: 0.58 },
      curl: 0.08,
      serration: 0.03,
      venation: 0.36,
      colorA: 0x385d2c,
      colorB: 0xa6b75f,
    },
    tree: {
      crown: "umbrella",
      crownStart: 0.56,
      leafClusterScale: 1.14,
      exposedTrunk: 0.56,
    },
    foliage: { mass: 0.98, clusterDensity: 1.35, whorlDensity: 0.55, tipBias: 0.88, size: 0.6 },
    treeRealism: { crownSpread: 0.92, crownTaper: 0.18, trunkFlare: 0.38, trunkBend: 0.18, branchGnarl: 0.28, windFlex: 0.5, colorVariance: 0.14 },
    weberPenn: {
      species: "sassafras",
      nativeLeaves: true,
      crownFill: true,
      foliageSource: "procplants",
      fillAnchor: "leaf-sites",
      maxBranchDepth: 3,
      maxStems: 72,
      maxLeaves: 200,
      leafScaleMultiplier: 2.1,
      radialSegments: 4,
      branchSamples: 2,
    },
    lightResponse: {
      shadeAvoidance: 0.5,
      leafBoostInShade: 0.08,
      branchSuppressionInShade: 0.2,
      phototropism: 0.1,
    },
  },
  mangroveRoots: {
    id: "mangroveRoots",
    habit: "tree",
    nodeCount: 15,
    internode: { base: 0.14, tip: 0.075, curve: 1.15 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.28, tip: 0.18, curve: 1.1 },
    branchAngle: { mean: 0.72, spread: 0.25, depthDecay: 0.72 },
    apicalDominance: 0.38,
    leaf: {
      shape: "ovate",
      length: { base: 0.22, tip: 0.17, curve: 0.88 },
      widthRatio: 0.5,
      density: { base: 0.62, tip: 0.88, curve: 0.82 },
      curl: 0.1,
      serration: 0.02,
      venation: 0.58,
      colorA: 0x24573b,
      colorB: 0x82ad5a,
    },
    tree: {
      crown: "propRoot",
      crownStart: 0.36,
      leafClusterScale: 0.96,
      exposedTrunk: 0.32,
    },
    foliage: { mass: 1.0, clusterDensity: 1.4, whorlDensity: 0.5, tipBias: 0.6, size: 0.7 },
    treeRealism: { crownSpread: 0.68, crownTaper: 0.3, trunkFlare: 0.62, trunkBend: 0.24, branchGnarl: 0.36, windFlex: 0.48, colorVariance: 0.18 },
    weberPenn: {
      species: "blackTupelo",
      nativeLeaves: true,
      crownFill: true,
      foliageSource: "procplants",
      fillAnchor: "leaf-sites",
      maxBranchDepth: 3,
      maxStems: 80,
      maxLeaves: 200,
      leafScaleMultiplier: 2.2,
      radialSegments: 4,
      branchSamples: 2,
    },
    lightResponse: {
      shadeAvoidance: 0.34,
      leafBoostInShade: 0.24,
      branchSuppressionInShade: 0.18,
      phototropism: 0.12,
    },
  },
  blueSpruce: {
    id: "blueSpruce",
    habit: "conifer",
    nodeCount: 18,
    internode: { base: 0.22, tip: 0.085, curve: 1.28 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.22, tip: 0.08, curve: 1.18 },
    branchAngle: { mean: 0.82, spread: 0.2, depthDecay: 0.72 },
    apicalDominance: 0.72,
    leaf: {
      shape: "linear",
      length: { base: 0.78, tip: 0.32, curve: 1.15 },
      widthRatio: 0.18,
      density: { base: 0.92, tip: 0.68, curve: 0.95 },
      curl: 0.18,
      serration: 0,
      venation: 0.08,
      colorA: 0x263f32,
      colorB: 0x6f8f74,
    },
    foliage: { mass: 0.98, clusterDensity: 1.02, whorlDensity: 0.86, tipBias: 0.38, size: 0.78 },
    treeRealism: { crownSpread: 0.44, crownTaper: 0.78, trunkFlare: 0.34, trunkBend: 0.14, branchGnarl: 0.18, windFlex: 0.58, colorVariance: 0.12 },
    weberPenn: {
      species: "smallPine",
      nativeLeaves: false,
      crownFill: true,
      foliageSource: "conifer-spray",
      fillAnchor: "leaf-sites",
      maxBranchDepth: 2,
      maxStems: 64,
      maxLeaves: 160,
      leafScaleMultiplier: 2.6,
      radialSegments: 4,
      branchSamples: 1,
    },
    lightResponse: {
      shadeAvoidance: 0.28,
      leafBoostInShade: 0.12,
      branchSuppressionInShade: 0.18,
      phototropism: 0.08,
    },
  },
  alpineFir: {
    id: "alpineFir",
    habit: "conifer",
    nodeCount: 20,
    internode: { base: 0.2, tip: 0.07, curve: 1.42 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.28, tip: 0.1, curve: 1.32 },
    branchAngle: { mean: 0.74, spread: 0.16, depthDecay: 0.74 },
    apicalDominance: 0.82,
    leaf: {
      shape: "linear",
      length: { base: 0.62, tip: 0.24, curve: 1.2 },
      widthRatio: 0.16,
      density: { base: 0.95, tip: 0.7, curve: 1.08 },
      curl: 0.22,
      serration: 0,
      venation: 0.06,
      colorA: 0x1f392e,
      colorB: 0x6b8a63,
    },
    foliage: { mass: 1.02, clusterDensity: 1.04, whorlDensity: 0.9, tipBias: 0.34, size: 0.7 },
    treeRealism: { crownSpread: 0.36, crownTaper: 0.88, trunkFlare: 0.36, trunkBend: 0.1, branchGnarl: 0.16, windFlex: 0.5, colorVariance: 0.1 },
    weberPenn: {
      species: "balsamFir",
      nativeLeaves: false,
      crownFill: true,
      foliageSource: "conifer-spray",
      fillAnchor: "leaf-sites",
      maxBranchDepth: 2,
      maxStems: 68,
      maxLeaves: 180,
      leafScaleMultiplier: 2.85,
      radialSegments: 4,
      branchSamples: 1,
    },
    lightResponse: {
      shadeAvoidance: 0.22,
      leafBoostInShade: 0.16,
      branchSuppressionInShade: 0.12,
      phototropism: 0.05,
    },
  },
  tundraSmallPine: {
    id: "tundraSmallPine",
    habit: "conifer",
    nodeCount: 16,
    internode: { base: 0.17, tip: 0.065, curve: 1.38 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.24, tip: 0.08, curve: 1.28 },
    branchAngle: { mean: 0.78, spread: 0.18, depthDecay: 0.72 },
    apicalDominance: 0.78,
    leaf: {
      shape: "linear",
      length: { base: 0.68, tip: 0.28, curve: 1.18 },
      widthRatio: 0.17,
      density: { base: 0.92, tip: 0.66, curve: 1.04 },
      curl: 0.24,
      serration: 0,
      venation: 0.06,
      colorA: 0x233d32,
      colorB: 0x708b68,
    },
    foliage: { mass: 1.05, clusterDensity: 1, whorlDensity: 0.82, tipBias: 0.6, size: 0.82 },
    treeRealism: { crownSpread: 0.42, crownTaper: 0.84, trunkFlare: 0.38, trunkBend: 0.38, branchGnarl: 0.32, windFlex: 0.56, colorVariance: 0.12 },
    weberPenn: {
      species: "smallPine",
      nativeLeaves: false,
      crownFill: true,
      foliageSource: "conifer-spray",
      fillAnchor: "leaf-sites",
      maxBranchDepth: 2,
      maxStems: 52,
      maxLeaves: 140,
      leafScaleMultiplier: 3.4,
      radialSegments: 3,
      branchSamples: 1,
      barkColor: 0x5d4327,
      leafColor: 0x263f32,
    },
    lightResponse: {
      shadeAvoidance: 0.2,
      leafBoostInShade: 0.14,
      branchSuppressionInShade: 0.14,
      phototropism: 0.06,
    },
  },
  redwoodSpire: {
    id: "redwoodSpire",
    habit: "conifer",
    nodeCount: 24,
    internode: { base: 0.24, tip: 0.08, curve: 1.22 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.16, tip: 0.06, curve: 1.18 },
    branchAngle: { mean: 0.58, spread: 0.16, depthDecay: 0.78 },
    apicalDominance: 0.9,
    leaf: {
      shape: "linear",
      length: { base: 0.56, tip: 0.22, curve: 1.12 },
      widthRatio: 0.18,
      density: { base: 0.78, tip: 0.58, curve: 1 },
      curl: 0.12,
      serration: 0,
      venation: 0.06,
      colorA: 0x264735,
      colorB: 0x78965e,
    },
    foliage: { mass: 0.9, clusterDensity: 0.92, whorlDensity: 0.58, tipBias: 0.54, size: 0.6 },
    treeRealism: { crownSpread: 0.32, crownTaper: 0.84, trunkFlare: 0.42, trunkBend: 0.12, branchGnarl: 0.22, windFlex: 0.38, colorVariance: 0.1 },
    weberPenn: {
      species: "douglasFir",
      nativeLeaves: false,
      crownFill: true,
      foliageSource: "conifer-spray",
      fillAnchor: "leaf-sites",
      maxBranchDepth: 2,
      maxStems: 64,
      maxLeaves: 170,
      leafScaleMultiplier: 2.45,
      radialSegments: 4,
      branchSamples: 1,
    },
    lightResponse: {
      shadeAvoidance: 0.36,
      leafBoostInShade: 0.12,
      branchSuppressionInShade: 0.12,
      phototropism: 0.06,
    },
  },
  foldedPalm: {
    id: "foldedPalm",
    habit: "palm",
    nodeCount: 15,
    internode: { base: 0.2, tip: 0.14, curve: 0.9 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.01, tip: 0, curve: 1 },
    branchAngle: { mean: 0.95, spread: 0.18, depthDecay: 0.55 },
    apicalDominance: 0.95,
    leaf: {
      shape: "fan",
      length: { base: 0.85, tip: 0.62, curve: 0.85 },
      widthRatio: 0.58,
      density: { base: 1, tip: 1, curve: 1 },
      curl: 0.18,
      serration: 0.08,
      venation: 0.95,
      colorA: 0x2e7438,
      colorB: 0xa4c760,
    },
    lightResponse: {
      shadeAvoidance: 0.42,
      leafBoostInShade: 0.2,
      branchSuppressionInShade: 0.12,
      phototropism: 0.12,
    },
  },
};

const curve = (gene: CurveGene, t: number): number => {
  const u = Math.max(0, Math.min(1, t));
  const shaped = gene.curve === 1 ? u : Math.pow(u, gene.curve);
  return THREE.MathUtils.lerp(gene.base, gene.tip, shaped);
};

const rngFromSeed = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const mixCurve = (a: CurveGene, b: CurveGene, alpha: number): CurveGene => ({
  base: THREE.MathUtils.lerp(a.base, b.base, alpha),
  tip: THREE.MathUtils.lerp(a.tip, b.tip, alpha),
  curve: THREE.MathUtils.lerp(a.curve, b.curve, alpha),
});

export const hybridizePlantGenomes = (
  a: ProcPlantGenome,
  b: ProcPlantGenome,
  alpha: number,
  seed = 1,
): ProcPlantGenome => {
  const rng = rngFromSeed(seed);
  const pick = <T>(left: T, right: T): T => (rng() < alpha ? right : left);
  const habit = pick(a.habit, b.habit);
  return {
    id: `${a.id}-${b.id}-hybrid`,
    habit,
    nodeCount: Math.round(THREE.MathUtils.lerp(a.nodeCount, b.nodeCount, alpha)),
    internode: mixCurve(a.internode, b.internode, alpha),
    phyllotaxisAngle: THREE.MathUtils.lerp(a.phyllotaxisAngle, b.phyllotaxisAngle, alpha),
    phyllotaxy: pick(a.phyllotaxy, b.phyllotaxy),
    branchChance: mixCurve(a.branchChance, b.branchChance, alpha),
    branchAngle: {
      mean: THREE.MathUtils.lerp(a.branchAngle.mean, b.branchAngle.mean, alpha),
      spread: THREE.MathUtils.lerp(a.branchAngle.spread, b.branchAngle.spread, alpha),
      depthDecay: THREE.MathUtils.lerp(a.branchAngle.depthDecay, b.branchAngle.depthDecay, alpha),
    },
    apicalDominance: THREE.MathUtils.lerp(a.apicalDominance, b.apicalDominance, alpha),
    leaf: {
      shape: pick(a.leaf.shape, b.leaf.shape),
      length: mixCurve(a.leaf.length, b.leaf.length, alpha),
      widthRatio: THREE.MathUtils.lerp(a.leaf.widthRatio, b.leaf.widthRatio, alpha),
      density: mixCurve(a.leaf.density, b.leaf.density, alpha),
      curl: THREE.MathUtils.lerp(a.leaf.curl, b.leaf.curl, alpha),
      serration: THREE.MathUtils.lerp(a.leaf.serration, b.leaf.serration, alpha),
      venation: THREE.MathUtils.lerp(a.leaf.venation, b.leaf.venation, alpha),
      colorA: pick(a.leaf.colorA, b.leaf.colorA),
      colorB: pick(a.leaf.colorB, b.leaf.colorB),
    },
    flower: pick(a.flower, b.flower),
    grass: pick(a.grass, b.grass),
    fern: pick(a.fern, b.fern),
    groundcover: pick(a.groundcover, b.groundcover),
    vine: pick(a.vine, b.vine),
    moss: pick(a.moss, b.moss),
    accessoryOrgans: pick(a.accessoryOrgans, b.accessoryOrgans),
    foliage:
      a.foliage || b.foliage
        ? {
            mass: THREE.MathUtils.lerp(a.foliage?.mass ?? 0.55, b.foliage?.mass ?? 0.55, alpha),
            clusterDensity: THREE.MathUtils.lerp(
              a.foliage?.clusterDensity ?? 1,
              b.foliage?.clusterDensity ?? 1,
              alpha,
            ),
            whorlDensity: THREE.MathUtils.lerp(
              a.foliage?.whorlDensity ?? 0.45,
              b.foliage?.whorlDensity ?? 0.45,
              alpha,
            ),
            tipBias: THREE.MathUtils.lerp(a.foliage?.tipBias ?? 0.5, b.foliage?.tipBias ?? 0.5, alpha),
          }
        : undefined,
    treeRealism:
      a.treeRealism || b.treeRealism
        ? {
            crownSpread: THREE.MathUtils.lerp(a.treeRealism?.crownSpread ?? 0.5, b.treeRealism?.crownSpread ?? 0.5, alpha),
            crownTaper: THREE.MathUtils.lerp(a.treeRealism?.crownTaper ?? 0.5, b.treeRealism?.crownTaper ?? 0.5, alpha),
            trunkFlare: THREE.MathUtils.lerp(a.treeRealism?.trunkFlare ?? 0.35, b.treeRealism?.trunkFlare ?? 0.35, alpha),
            trunkBend: THREE.MathUtils.lerp(a.treeRealism?.trunkBend ?? 0.12, b.treeRealism?.trunkBend ?? 0.12, alpha),
            branchGnarl: THREE.MathUtils.lerp(a.treeRealism?.branchGnarl ?? 0.2, b.treeRealism?.branchGnarl ?? 0.2, alpha),
            windFlex: THREE.MathUtils.lerp(a.treeRealism?.windFlex ?? 0.55, b.treeRealism?.windFlex ?? 0.55, alpha),
            colorVariance: THREE.MathUtils.lerp(a.treeRealism?.colorVariance ?? 0.14, b.treeRealism?.colorVariance ?? 0.14, alpha),
          }
        : undefined,
    weberPenn: pick(a.weberPenn, b.weberPenn),
    branchModules: pick(a.branchModules, b.branchModules),
    spaceColonization: pick(a.spaceColonization, b.spaceColonization),
    tree: pick(a.tree, b.tree),
    lightResponse: {
      shadeAvoidance: THREE.MathUtils.lerp(
        a.lightResponse.shadeAvoidance,
        b.lightResponse.shadeAvoidance,
        alpha,
      ),
      leafBoostInShade: THREE.MathUtils.lerp(
        a.lightResponse.leafBoostInShade,
        b.lightResponse.leafBoostInShade,
        alpha,
      ),
      branchSuppressionInShade: THREE.MathUtils.lerp(
        a.lightResponse.branchSuppressionInShade,
        b.lightResponse.branchSuppressionInShade,
        alpha,
      ),
      phototropism: THREE.MathUtils.lerp(
        a.lightResponse.phototropism,
        b.lightResponse.phototropism,
        alpha,
      ),
    },
  };
};

const tangentBasis = (direction: THREE.Vector3) => {
  const forward = direction.clone().normalize();
  const right =
    Math.abs(forward.dot(UP)) > 0.92
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3().crossVectors(forward, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { forward, right, up };
};

const rotateFromAxis = (axis: THREE.Vector3, azimuth: number, elevation: number) => {
  const { forward, right, up } = tangentBasis(axis);
  const lateral = right
    .multiplyScalar(Math.cos(azimuth))
    .add(up.multiplyScalar(Math.sin(azimuth)))
    .normalize();
  return forward
    .multiplyScalar(Math.cos(elevation))
    .add(lateral.multiplyScalar(Math.sin(elevation)))
    .normalize();
};

/**
 * Builds a stable leaf frame from the supporting twig instead of world axes.
 * The blade diverges around the twig (phyllotaxis), while its face turns partly
 * upward toward available light. This keeps foliage attached and readable when
 * a branch bends, droops, or is procedurally warped.
 */
const branchRelativeFoliageFrame = (
  branchDirection: THREE.Vector3,
  azimuth: number,
  divergence: number,
  upBias: number,
  referenceRight?: THREE.Vector3,
) => {
  const branch = branchDirection.clone().normalize();
  const basis = tangentBasis(branch);
  let baseRight = referenceRight?.clone().projectOnPlane(branch);
  if (!baseRight || baseRight.lengthSq() < 0.0001) baseRight = basis.right;
  baseRight.normalize();
  const around = baseRight
    .clone()
    .applyAxisAngle(branch, azimuth)
    .normalize();
  const direction = branch
    .clone()
    .multiplyScalar(Math.cos(divergence))
    .add(around.clone().multiplyScalar(Math.sin(divergence)))
    .add(UP.clone().multiplyScalar(upBias))
    .normalize();
  const desiredNormal = UP.clone()
    .multiplyScalar(0.82)
    .add(around.clone().multiplyScalar(0.18))
    .projectOnPlane(direction);
  if (desiredNormal.lengthSq() < 0.0001) desiredNormal.copy(basis.up);
  desiredNormal.normalize();
  const right = desiredNormal.cross(direction).normalize();
  return { direction, right, radial: around };
};

const buildProcPlantGraphIr = (
  stems: StemNode[],
  segments: Array<[number, number]>,
  organs: Organ[],
): ProcPlantGraph => {
  const assertFrame = (tangent: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, id: string) => {
    const orthogonal = Math.max(Math.abs(tangent.dot(right)), Math.abs(tangent.dot(up)), Math.abs(right.dot(up)));
    const handedness = new THREE.Vector3().crossVectors(tangent, right).dot(up);
    if (orthogonal > 1e-4 || handedness < 0.999) {
      throw new Error(`Invalid right-handed attachment frame: ${id}`);
    }
  };
  const incomingByNode = new Map<number, string>();
  const segmentRecords = segments.map(([startNodeIndex, endNodeIndex], index) => {
    const start = stems[startNodeIndex]!;
    const end = stems[endNodeIndex]!;
    const id = `segment:${index}:${startNodeIndex}-${endNodeIndex}`;
    const record: ProcPlantSegmentRecord = {
      id,
      parentSegmentId: incomingByNode.get(startNodeIndex) ?? null,
      startNodeIndex,
      endNodeIndex,
      depth: end?.depth ?? start?.depth ?? 0,
      axialStart: start?.t ?? 0,
      axialEnd: end?.t ?? 1,
    };
    incomingByNode.set(endNodeIndex, id);
    return record;
  });

  const attachments = organs.map((organ, organIndex): ProcPlantAttachmentAnchor => {
    let bestSegmentIndex = -1;
    let bestAxialT = 0;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const [startIndex, endIndex] = segments[segmentIndex]!;
      const start = stems[startIndex]?.position;
      const end = stems[endIndex]?.position;
      if (!start || !end) continue;
      const span = end.clone().sub(start);
      const lengthSq = span.lengthSq();
      const axialT = lengthSq > 1e-10
        ? THREE.MathUtils.clamp(organ.position.clone().sub(start).dot(span) / lengthSq, 0, 1)
        : 0;
      const nearest = start.clone().addScaledVector(span, axialT);
      const distanceSq = nearest.distanceToSquared(organ.position);
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestSegmentIndex = segmentIndex;
        bestAxialT = axialT;
      }
    }
    const record = bestSegmentIndex >= 0 ? segmentRecords[bestSegmentIndex]! : undefined;
    const tangent = record
      ? stems[record.endNodeIndex]!.position.clone().sub(stems[record.startNodeIndex]!.position).normalize()
      : organ.direction.clone().normalize();
    let right = organ.right.clone().projectOnPlane(tangent);
    if (right.lengthSq() < 0.0001) right = tangentBasis(tangent).right;
    right.normalize();
    const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
    const id = `attachment:${organIndex}:${organ.kind}`;
    assertFrame(tangent, right, up, id);
    return {
      id,
      parentSegmentId: record?.id ?? null,
      axialT: bestAxialT,
      position: organ.position.clone(),
      tangent,
      right,
      up,
      kind: organ.kind,
      depth: record?.depth ?? 0,
      sway: organ.kind === "flower" ? 0.72 : organ.kind === "grassBlade" ? 1 : 0.35 + organ.t * 0.65,
      organIndex,
    };
  });
  return { stems, segments, organs, segmentRecords, attachments };
};

const flowerLoadBend = (
  genome: ProcPlantGenome,
  position: THREE.Vector3,
  scale: number,
  variant: number,
) => {
  if (!genome.flower) return 0;
  const showyLoad = THREE.MathUtils.clamp((genome.flower.radius * scale - 0.16) / 0.22, 0, 1);
  const stemLeverage = THREE.MathUtils.clamp(position.y / 1.25, 0, 1);
  const slenderness =
    authoredProcPlantId(genome) === "sunflowerTower"
      ? 0.68
      : authoredProcPlantId(genome) === "poppyFlower"
        ? 1
        : authoredProcPlantId(genome) === "hibiscusBloom"
          ? 0.78
          : authoredProcPlantId(genome) === "daylilyFlower"
            ? 0.72
            : authoredProcPlantId(genome) === "tulipCup"
              ? 0.52
              : 0.38;
  return THREE.MathUtils.clamp(showyLoad * stemLeverage * slenderness * (0.72 + variant * 0.56), 0, 0.72);
};

const bendFlowerFrame = (organ: Organ, bend: number) => {
  const forward = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  if (bend <= 0.001) {
    return { forward, right, up: new THREE.Vector3().crossVectors(right, forward).normalize() };
  }
  const awayFromUp = forward.clone().projectOnPlane(UP);
  const leanAxis = awayFromUp.lengthSq() > 0.0001 ? awayFromUp.normalize() : right;
  const droopAxis = new THREE.Vector3().crossVectors(leanAxis, UP).normalize();
  const angle = THREE.MathUtils.degToRad(8 + bend * 38);
  const droopedForward = forward.clone().applyAxisAngle(droopAxis, angle).normalize();
  const droopedRight = right.clone().applyAxisAngle(droopAxis, angle).normalize();
  const up = new THREE.Vector3().crossVectors(droopedRight, droopedForward).normalize();
  return { forward: droopedForward, right: droopedRight, up };
};

export const buildProcPlantGraph = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): ProcPlantGraph => {
  if (genome.spaceColonization) return buildSpaceColonizedProcPlantParts(genome, seed, env).graph;
  const rng = rngFromSeed(seed);
  const stems: StemNode[] = [];
  const segments: Array<[number, number]> = [];
  const organs: Organ[] = [];
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const heightStretch = 1 + shade * genome.lightResponse.shadeAvoidance;
  const branchShadePenalty = 1 - shade * genome.lightResponse.branchSuppressionInShade;
  const lightVector = new THREE.Vector3(0.25, 1, 0.12).normalize();
  const rootDirection =
    genome.habit === "vine"
      ? new THREE.Vector3(0.62, 0.28, 0.36).normalize()
      : new THREE.Vector3(0, 1, 0);
  const rootRadius =
    genome.habit === "palm"
      ? 0.055
      : genome.habit === "conifer"
        ? 0.045
        : genome.habit === "tree"
          ? 0.052
          : genome.habit === "shrub"
          ? 0.035
          : genome.habit === "vine"
            ? 0.012
            : 0.018;
  const root: StemNode = {
    position: new THREE.Vector3(0, 0, 0),
    direction: rootDirection,
    radius: rootRadius,
    depth: 0,
    t: 0,
    index: 0,
  };
  stems.push(root);
  const foliageTraits = {
    mass: genome.foliage?.mass ?? (genome.habit === "conifer" ? 0.84 : 0.55),
    clusterDensity: genome.foliage?.clusterDensity ?? 1,
    whorlDensity: genome.foliage?.whorlDensity ?? (genome.habit === "conifer" ? 0.82 : 0.42),
    tipBias: genome.foliage?.tipBias ?? 0.5,
  };
  const addConiferFoliageMass = () => {
    const trunkNodes = stems.filter((node) => node.depth === 0 && node.t > 0.12);
    for (const node of trunkNodes) {
      const t = node.t;
      const crownEnvelope = Math.sin(Math.PI * THREE.MathUtils.clamp(t * 0.92 + 0.04, 0, 1));
      const lowerShelf = THREE.MathUtils.smoothstep(1 - t, 0.05, 0.86);
      const fill = THREE.MathUtils.clamp(
        (0.38 + crownEnvelope * 0.48 + lowerShelf * 0.18) * foliageTraits.mass,
        0,
        1.65,
      );
      const whorls = Math.max(1, Math.round(1.4 + fill * 1.85 * foliageTraits.whorlDensity));
      for (let w = 0; w < whorls; w++) {
        const yaw = resolveProcPlantPhyllotaxy(genome, node.index + w / whorls).azimuth + (Math.PI * 2 * w) / whorls;
        const droop = Math.PI / 2.0 + t * 0.62 + (rng() - 0.5) * 0.12;
        const branchDir = rotateFromAxis(node.direction, yaw, droop);
        const scale =
          curve(genome.leaf.length, t) *
          (1.12 - t * 0.3) *
          (0.78 + fill * 0.22) *
          (0.78 + rng() * 0.22);
        const offset = branchDir.clone().multiplyScalar(0.035 + fill * 0.025);
        organs.push({
          kind: "coniferSpray",
          position: node.position.clone().add(offset),
          direction: branchDir,
          right: tangentBasis(node.direction).right.applyAxisAngle(node.direction, yaw).normalize(),
          scale,
          t,
        });
      }
    }
  };
  const growAxis = (
    startIndex: number,
    depth: number,
    count: number,
    lengthScale: number,
  ) => {
    let previous = stems[startIndex];
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      const axisNoise = (rng() - 0.5) * 0.1;
      const photo = lightVector
        .clone()
        .multiplyScalar(genome.lightResponse.phototropism * t * (0.3 + shade));
      const vinePull =
        genome.habit === "vine"
          ? new THREE.Vector3(0.12, -0.05, 0.08).multiplyScalar(1 - t * 0.35)
          : new THREE.Vector3();
      const direction = previous.direction
        .clone()
        .add(photo)
        .add(vinePull)
        .add(new THREE.Vector3(axisNoise, 0, (rng() - 0.5) * 0.1))
        .normalize();
      const len = curve(genome.internode, t) * lengthScale * heightStretch;
      const position = previous.position.clone().add(direction.clone().multiplyScalar(len));
      const node: StemNode = {
        position,
        direction,
        radius:
          previous.radius *
          THREE.MathUtils.lerp(0.93, 0.72, t) *
          (depth === 0 ? 1 : 0.75),
        depth,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;

      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth;
      const { right } = tangentBasis(direction);
      const organFrame = branchRelativeFoliageFrame(
        direction,
        azimuth,
        Math.PI / 2.6,
        0.16 + genome.lightResponse.phototropism * 0.32,
        right,
      );
      const density = curve(genome.leaf.density, t) * (1 + shade * genome.lightResponse.leafBoostInShade);
      if (genome.habit === "conifer" && t > 0.12 && rng() < density) {
        const downSweep = Math.PI / 2.05 + t * 0.52 + depth * 0.14;
        const sprayCount = depth === 0 && t < 0.88 ? 2 : 1;
        for (let s = 0; s < sprayCount; s++) {
          const sprayYaw = azimuth + s * Math.PI + (rng() - 0.5) * 0.12;
          const sprayFrame = branchRelativeFoliageFrame(
            direction,
            sprayYaw,
            downSweep,
            -0.14 - t * 0.08,
            right,
          );
          organs.push({
            kind: "coniferSpray",
            position,
            direction: sprayFrame.direction,
            right: sprayFrame.right,
            scale:
              curve(genome.leaf.length, t) *
              (1.12 - t * 0.38) *
              Math.pow(0.78, depth) *
              (0.84 + rng() * 0.24) *
              (s === 0 ? 1 : 0.82),
            t,
          });
        }
      } else if (
        (genome.habit !== "palm" &&
          (genome.habit !== "tree" || t > (genome.tree?.crownStart ?? 0.42)) &&
          rng() < density) ||
        genome.habit === "tropical"
      ) {
        organs.push({
          kind: "leaf",
          position,
          direction: organFrame.direction,
          right: organFrame.right,
          scale: curve(genome.leaf.length, t) * (0.85 + rng() * 0.3),
          t,
        });
      }
      const branchChance =
        curve(genome.branchChance, t) *
        branchShadePenalty *
        Math.pow(genome.branchAngle.depthDecay, depth);
      if (
        depth < 2 &&
        i > 2 &&
        i < count - 1 &&
        rng() < branchChance * (1 - genome.apicalDominance * t)
      ) {
        const angle =
          genome.branchAngle.mean +
          (rng() - 0.5) * genome.branchAngle.spread *
            Math.pow(genome.branchAngle.depthDecay, depth);
        const branchDir = rotateFromAxis(direction, azimuth + rng() * 0.35, angle);
        const branchStart: StemNode = {
          position: position.clone(),
          direction: branchDir,
          radius: node.radius * 0.65,
          depth: depth + 1,
          t,
          index: stems.length,
        };
        stems.push(branchStart);
        segments.push([node.index, branchStart.index]);
        growAxis(branchStart.index, depth + 1, Math.max(3, Math.round(count * 0.36)), lengthScale * 0.68);
      }
    }
  };

  const addAccessoryOrgans = () => {
    const genes = genome.accessoryOrgans;
    if (!genes || genes.length === 0) return;
    for (const gene of genes) {
      const startT = THREE.MathUtils.clamp(gene.startT ?? 0.2, 0, 1);
      const endT = THREE.MathUtils.clamp(gene.endT ?? 1, startT, 1);
      const minDepth = Math.max(0, Math.floor(gene.minDepth ?? 0));
      const maxDepth = Math.max(minDepth, Math.floor(gene.maxDepth ?? Number.MAX_SAFE_INTEGER));
      let candidates = stems.filter(
        (node) =>
          node.index !== root.index &&
          node.t >= startT &&
          node.t <= endT &&
          node.depth >= minDepth &&
          node.depth <= maxDepth,
      );
      if (candidates.length === 0) {
        candidates = stems.filter((node) => node.index !== root.index);
      }
      if (candidates.length === 0) continue;
      const count = Math.max(0, Math.min(32, Math.round(gene.count)));
      const size = Math.max(0.003, gene.size);
      for (let i = 0; i < count; i++) {
        const stratum = (i + 0.18 + rng() * 0.64) / Math.max(1, count);
        const node = candidates[Math.min(candidates.length - 1, Math.floor(stratum * candidates.length))]!;
        const sample = resolveProcPlantPhyllotaxy(genome, node.index + i / Math.max(1, count));
        const azimuth = sample.azimuth + (rng() - 0.5) * 0.28;
        const supportRight = tangentBasis(node.direction).right;
        const frame = branchRelativeFoliageFrame(
          node.direction,
          azimuth,
          Math.PI / 2.08,
          gene.kind === "thorn" ? -0.04 : 0.08,
          supportRight,
        );
        let direction = frame.direction.clone();
        if (gene.kind === "fruit" || gene.kind === "berry") {
          direction.lerp(new THREE.Vector3(0, -1, 0), 0.68).normalize();
        } else if (gene.kind === "cone") {
          direction.lerp(new THREE.Vector3(0, -1, 0), 0.36).normalize();
        } else if (gene.kind === "thorn") {
          direction = frame.radial.clone().addScaledVector(node.direction, -0.16).normalize();
        } else {
          direction = frame.radial.clone().multiplyScalar(0.24).add(new THREE.Vector3(0, -1, 0)).normalize();
        }
        let right = frame.right.clone().projectOnPlane(direction);
        if (right.lengthSq() < 0.0001) right = tangentBasis(direction).right;
        right.normalize();
        const attachmentOffset = node.radius + size * (gene.kind === "thorn" ? 0.04 : 0.12);
        organs.push({
          kind: gene.kind,
          position: node.position.clone().addScaledVector(frame.radial, attachmentOffset),
          direction,
          right,
          scale: size * (0.88 + rng() * 0.24),
          t: node.t,
          color: gene.color,
          secondaryColor: gene.secondaryColor,
        });
      }
    }
  };

  const finalizeGraph = () => {
    addAccessoryOrgans();
    return buildProcPlantGraphIr(stems, segments, organs);
  };

  if (genome.vine) {
    const path = resolveProcPlantVinePath(genome.vine, genome.nodeCount);
    root.position.copy(path[0]!);
    root.radius = genome.moss ? 0.004 : Math.max(0.006, root.radius);
    root.direction.copy(path[1]!.clone().sub(path[0]!));
    if (root.direction.lengthSq() < 1e-8) root.direction.copy(UP);
    root.direction.normalize();
    const leafEvery = Math.max(1, Math.round(genome.vine.leafEvery ?? 1));
    const flowerEvery = Math.max(0, Math.round(genome.vine.flowerEvery ?? 0));
    const flowerStartT = THREE.MathUtils.clamp(genome.vine.flowerStartT ?? 0.45, 0, 1);
    const organsPerNode = genome.moss
      ? Math.max(1, Math.min(4, Math.round(genome.moss.tuftsPerClump)))
      : procPlantPhyllotaxyOrgansPerNode(genome);
    let previous = root;
    for (let i = 1; i < path.length; i++) {
      const t = i / Math.max(1, path.length - 1);
      const position = path[i]!.clone();
      const direction = position.clone().sub(previous.position);
      if (direction.lengthSq() < 1e-8) direction.copy(previous.direction);
      direction.normalize();
      const node: StemNode = {
        position,
        direction,
        radius: root.radius * THREE.MathUtils.lerp(0.92, 0.28, t),
        depth: 0,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;

      if (i % leafEvery === 0) {
        for (let slot = 0; slot < organsPerNode; slot++) {
          const sample = resolveProcPlantPhyllotaxy(genome, i, slot);
          const frame = branchRelativeFoliageFrame(
            direction,
            sample.azimuth + (rng() - 0.5) * 0.12,
            genome.moss ? Math.PI / 3.2 : Math.PI / 2.35,
            genome.vine.mode === "hang" ? -0.05 : genome.moss ? 0.48 : 0.22,
            tangentBasis(direction).right,
          );
          const density = THREE.MathUtils.clamp(curve(genome.leaf.density, t), 0, 1.5);
          if (rng() <= density) {
            organs.push({
              kind: genome.moss ? "mossTuft" : "leaf",
              position: position.clone().addScaledVector(frame.radial, node.radius + 0.004),
              direction: frame.direction,
              right: frame.right,
              scale:
                (genome.moss ? genome.moss.height : curve(genome.leaf.length, t)) *
                (0.86 + rng() * 0.24),
              t,
            });
          }
        }
      }
      if (genome.flower && flowerEvery > 0 && t >= flowerStartT && i % flowerEvery === 0) {
        const flowerFrame = branchRelativeFoliageFrame(
          direction,
          resolveProcPlantPhyllotaxy(genome, i + 0.5).azimuth,
          Math.PI / 2.55,
          0.28,
          tangentBasis(direction).right,
        );
        organs.push({
          kind: "flower",
          position: position.clone().addScaledVector(flowerFrame.radial, node.radius + 0.01),
          direction: flowerFrame.direction,
          right: flowerFrame.right,
          scale: 0.72 + rng() * 0.2,
          t,
        });
      }
    }
    return finalizeGraph();
  }

  if (genome.moss) {
    const moss = genome.moss;
    const clumps = Math.max(3, Math.min(32, Math.round(moss.clumps)));
    const tuftsPerClump = Math.max(1, Math.min(4, Math.round(moss.tuftsPerClump)));
    const jitter = THREE.MathUtils.clamp(moss.surfaceJitter ?? 0.2, 0, 1);
    root.radius = 0.0025;
    let previous = root;
    for (let cluster = 1; cluster <= clumps; cluster++) {
      const t = cluster / clumps;
      const yaw = cluster * GOLDEN_ANGLE + (rng() - 0.5) * jitter * 0.5;
      const spread = moss.radius * Math.sqrt(t) * (0.86 + rng() * 0.18);
      const position = new THREE.Vector3(
        Math.cos(yaw) * spread,
        0.004 + rng() * moss.height * jitter * 0.12,
        Math.sin(yaw) * spread,
      );
      const direction = position.clone().sub(previous.position);
      if (direction.lengthSq() < 1e-8) direction.set(Math.cos(yaw), 0, Math.sin(yaw));
      direction.normalize();
      const node: StemNode = {
        position,
        direction,
        radius: 0.0025 * THREE.MathUtils.lerp(0.9, 0.42, t),
        depth: 0,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;
      for (let tuft = 0; tuft < tuftsPerClump; tuft++) {
        const tuftYaw = resolveProcPlantPhyllotaxy(genome, cluster, tuft).azimuth + (rng() - 0.5) * 0.18;
        const frame = branchRelativeFoliageFrame(
          direction,
          tuftYaw,
          Math.PI / 2.8,
          0.72,
          tangentBasis(direction).right,
        );
        const offset = frame.radial.clone().multiplyScalar(moss.height * (tuft - (tuftsPerClump - 1) * 0.5) * 0.28);
        organs.push({
          kind: "mossTuft",
          position: position.clone().add(offset),
          direction: frame.direction,
          right: frame.right,
          scale: moss.height * (0.78 + rng() * 0.3),
          t,
        });
      }
    }
    return finalizeGraph();
  }

  if (genome.habit === "grass") {
    const blades = genome.grass?.blades ?? 30;
    let tallestBlade: Organ | null = null;
    for (let i = 0; i < blades; i++) {
      const t = i / Math.max(1, blades - 1);
      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth + (rng() - 0.5) * 0.16;
      const lean = 0.36 + rng() * 0.24;
      const blade: Organ = {
        kind: "grassBlade",
        position: new THREE.Vector3((rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2),
        direction: rotateFromAxis(UP, azimuth, lean),
        right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)),
        scale:
          curve(genome.leaf.length, t) *
          heightStretch *
          (1 - (genome.grass?.heightJitter ?? 0.2) * rng()),
        t,
      };
      organs.push(blade);
      if (!tallestBlade || blade.scale > tallestBlade.scale) tallestBlade = blade;
    }
    if (genome.flower && tallestBlade) {
      organs.push({
        kind: "flower",
        position: tallestBlade.position
          .clone()
          .add(tallestBlade.direction.clone().multiplyScalar(tallestBlade.scale * 0.92)),
        direction: tallestBlade.direction.clone(),
        right: tallestBlade.right.clone(),
        scale: 0.55,
        t: 1,
      });
    }
    return finalizeGraph();
  }

  const broadGroundcoverId = authoredProcPlantId(genome);
  if (
    genome.groundcover &&
    (broadGroundcoverId === "maidenhairFernPatch" ||
      broadGroundcoverId === "woodlandVioletCarpet" ||
      broadGroundcoverId === "trilliumPatch" ||
      broadGroundcoverId === "horsetailColony")
  ) {
    const cover = genome.groundcover;
    const clusterCount = Math.max(3, Math.min(24, Math.round(cover.clusters)));
    const patchPosition = (cluster: number) => {
      const t = clusterCount > 1 ? cluster / (clusterCount - 1) : 0;
      const yaw = cluster * GOLDEN_ANGLE + (genome.phyllotaxy?.phase ?? 0) + (rng() - 0.5) * 0.28;
      const spread = cluster === 0 ? 0 : cover.radius * (0.26 + Math.sqrt(t) * 0.74) * (0.9 + rng() * 0.18);
      return {
        t,
        yaw,
        radial: new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)),
        position: new THREE.Vector3(Math.cos(yaw) * spread, 0.006, Math.sin(yaw) * spread),
      };
    };
    const addStemNode = (
      previous: StemNode,
      position: THREE.Vector3,
      direction: THREE.Vector3,
      radiusScale: number,
      t: number,
    ) => {
      const node: StemNode = {
        position,
        direction: direction.clone().normalize(),
        radius: Math.max(0.0015, previous.radius * radiusScale),
        depth: 0,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      return node;
    };
    const addSupportedLeaf = (
      support: StemNode,
      azimuth: number,
      divergence: number,
      upBias: number,
      scale: number,
      t: number,
    ) => {
      const frame = branchRelativeFoliageFrame(
        support.direction,
        azimuth,
        divergence,
        upBias,
        tangentBasis(support.direction).right,
      );
      organs.push({
        kind: "leaf",
        position: support.position.clone().addScaledVector(frame.radial, support.radius + 0.002),
        direction: frame.direction,
        right: frame.right,
        scale,
        t,
      });
    };

    for (let cluster = 0; cluster < clusterCount; cluster++) {
      const patch = patchPosition(cluster);
      const base: StemNode = {
        position: patch.position,
        direction: UP.clone(),
        radius: root.radius * (broadGroundcoverId === "horsetailColony" ? 0.72 : 0.52),
        depth: 0,
        t: patch.t,
        index: stems.length,
      };
      stems.push(base);

      if (broadGroundcoverId === "maidenhairFernPatch") {
        let previous = base;
        const levels = 3;
        for (let level = 1; level <= levels; level++) {
          const levelT = level / levels;
          const direction = UP.clone()
            .addScaledVector(patch.radial, 0.18 + levelT * 0.22)
            .add(new THREE.Vector3((rng() - 0.5) * 0.06, 0, (rng() - 0.5) * 0.06))
            .normalize();
          previous = addStemNode(
            previous,
            previous.position.clone().addScaledVector(direction, cover.height * heightStretch / levels * (0.88 + rng() * 0.18)),
            direction,
            0.72,
            levelT,
          );
          for (let side = 0; side < 2; side++) {
            addSupportedLeaf(
              previous,
              patch.yaw + side * Math.PI + level * 0.48,
              1.04 + levelT * 0.12,
              0.3,
              curve(genome.leaf.length, levelT) * (0.86 + rng() * 0.18),
              levelT,
            );
          }
        }
        addSupportedLeaf(previous, patch.yaw + Math.PI * 0.5, 0.72, 0.42, genome.leaf.length.tip, 1);
        continue;
      }

      if (broadGroundcoverId === "woodlandVioletCarpet") {
        const crownDirection = UP.clone().addScaledVector(patch.radial, 0.08).normalize();
        const crown = addStemNode(
          base,
          base.position.clone().addScaledVector(crownDirection, cover.height * 0.28 * (0.82 + rng() * 0.2)),
          crownDirection,
          0.58,
          patch.t,
        );
        for (let leaf = 0; leaf < 3; leaf++) {
          addSupportedLeaf(
            crown,
            patch.yaw + leaf * Math.PI * 2 / 3,
            1.06 + rng() * 0.08,
            0.38,
            curve(genome.leaf.length, patch.t) * (0.88 + rng() * 0.18),
            patch.t,
          );
        }
        if (genome.flower && rng() < (cover.flowerRate ?? 0)) {
          const flowerDirection = UP.clone()
            .addScaledVector(patch.radial, 0.06)
            .add(new THREE.Vector3((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.04))
            .normalize();
          const flowerTip = addStemNode(
            crown,
            crown.position.clone().addScaledVector(flowerDirection, cover.height * (0.66 + rng() * 0.22)),
            flowerDirection,
            0.42,
            1,
          );
          organs.push({
            kind: "flower",
            position: flowerTip.position.clone().addScaledVector(flowerTip.direction, flowerTip.radius),
            direction: flowerTip.direction.clone(),
            right: tangentBasis(flowerTip.direction).right,
            scale: 0.82 + rng() * 0.16,
            t: 1,
          });
        }
        continue;
      }

      if (broadGroundcoverId === "trilliumPatch") {
        const stalkDirection = UP.clone()
          .addScaledVector(patch.radial, 0.1)
          .add(new THREE.Vector3((rng() - 0.5) * 0.035, 0, (rng() - 0.5) * 0.035))
          .normalize();
        const whorl = addStemNode(
          base,
          base.position.clone().addScaledVector(stalkDirection, cover.height * heightStretch * (0.58 + rng() * 0.12)),
          stalkDirection,
          0.6,
          0.64,
        );
        for (let leaf = 0; leaf < 3; leaf++) {
          addSupportedLeaf(
            whorl,
            patch.yaw + leaf * Math.PI * 2 / 3,
            1.17,
            0.3,
            curve(genome.leaf.length, patch.t) * (0.9 + rng() * 0.14),
            0.64,
          );
        }
        if (genome.flower && rng() < (cover.flowerRate ?? 0)) {
          const flowerTip = addStemNode(
            whorl,
            whorl.position.clone().addScaledVector(stalkDirection, cover.height * (0.34 + rng() * 0.08)),
            stalkDirection,
            0.42,
            1,
          );
          organs.push({
            kind: "flower",
            position: flowerTip.position.clone().addScaledVector(flowerTip.direction, flowerTip.radius),
            direction: flowerTip.direction.clone(),
            right: tangentBasis(flowerTip.direction).right,
            scale: 0.9 + rng() * 0.14,
            t: 1,
          });
        }
        continue;
      }

      let previous = base;
      const levels = 4;
      for (let level = 1; level <= levels; level++) {
        const levelT = level / levels;
        const direction = UP.clone()
          .addScaledVector(patch.radial, 0.045 + patch.t * 0.04)
          .add(new THREE.Vector3((rng() - 0.5) * 0.025, 0, (rng() - 0.5) * 0.025))
          .normalize();
        previous = addStemNode(
          previous,
          previous.position.clone().addScaledVector(direction, cover.height * heightStretch / levels * (0.9 + rng() * 0.16)),
          direction,
          0.82,
          levelT,
        );
        if (level >= levels) continue;
        const whorlCount = 5;
        for (let branchlet = 0; branchlet < whorlCount; branchlet++) {
          addSupportedLeaf(
            previous,
            patch.yaw + branchlet * Math.PI * 2 / whorlCount + level * 0.34,
            1.22,
            -0.04,
            curve(genome.leaf.length, levelT) * (0.9 + rng() * 0.12),
            levelT,
          );
        }
      }
    }
    return finalizeGraph();
  }

  if (genome.groundcover) {
    const cover = genome.groundcover;
    const clusterCount = Math.max(3, Math.min(24, Math.round(cover.clusters)));
    const leafCount = Math.max(1, Math.min(5, Math.round(cover.leavesPerCluster)));
    let previousRunner = root;
    for (let cluster = 0; cluster < clusterCount; cluster++) {
      const t = clusterCount > 1 ? cluster / (clusterCount - 1) : 0;
      const yaw = resolveProcPlantPhyllotaxy(genome, cluster).azimuth + (rng() - 0.5) * 0.34;
      const spread = cluster === 0 ? 0 : cover.radius * Math.sqrt(t) * (0.82 + rng() * 0.28);
      const position = new THREE.Vector3(
        Math.cos(yaw) * spread,
        0.012 + rng() * cover.height * 0.08,
        Math.sin(yaw) * spread,
      );
      const runnerDirection = position.clone().sub(previousRunner.position);
      if (cover.runners && cluster > 0 && runnerDirection.lengthSq() > 0.0001) {
        const runner: StemNode = {
          position: position.clone(),
          direction: runnerDirection.normalize(),
          radius: root.radius * 0.22,
          depth: 0,
          t,
          index: stems.length,
        };
        stems.push(runner);
        segments.push([previousRunner.index, runner.index]);
        previousRunner = runner;
      }

      const supportDirection = new THREE.Vector3(Math.cos(yaw), 0.12 + shade * 0.08, Math.sin(yaw)).normalize();
      const supportRight = tangentBasis(supportDirection).right;
      for (let leaf = 0; leaf < leafCount; leaf++) {
        const leafYaw = leaf * (Math.PI * 2 / leafCount) + cluster * 0.21 + (rng() - 0.5) * 0.12;
        const frame = branchRelativeFoliageFrame(
          supportDirection,
          leafYaw,
          0.86 + rng() * 0.2,
          0.42 + shade * 0.12,
          supportRight,
        );
        organs.push({
          kind: "leaf",
          position: position
            .clone()
            .add(new THREE.Vector3(0, cover.height * (0.12 + leaf * 0.025), 0))
            .add(frame.radial.clone().multiplyScalar(cover.radius * 0.018)),
          direction: frame.direction,
          right: frame.right,
          scale: curve(genome.leaf.length, t) * (0.9 + rng() * 0.22),
          t,
        });
      }

      if (genome.flower && rng() < (cover.flowerRate ?? 0) * (0.72 + env.moisture * 0.32)) {
        const stemBase: StemNode = {
          position: position.clone(),
          direction: UP.clone(),
          radius: root.radius * 0.18,
          depth: 0,
          t,
          index: stems.length,
        };
        stems.push(stemBase);
        const stemTip: StemNode = {
          position: position.clone().add(new THREE.Vector3((rng() - 0.5) * 0.025, cover.height * (0.78 + rng() * 0.32), (rng() - 0.5) * 0.025)),
          direction: UP.clone(),
          radius: stemBase.radius * 0.46,
          depth: 0,
          t: 1,
          index: stems.length,
        };
        stems.push(stemTip);
        segments.push([stemBase.index, stemTip.index]);
        organs.push({
          kind: "flower",
          position: stemTip.position.clone(),
          direction: UP.clone(),
          right: tangentBasis(UP).right,
          scale: 0.7 + rng() * 0.2,
          t: 1,
        });
      }
    }
    return finalizeGraph();
  }

  if (genome.habit === "fern" && genome.fern) {
    const fronds = Math.max(4, Math.min(9, Math.round(genome.fern.pinnae / 3)));
    const frondLength =
      genome.nodeCount * curve(genome.internode, 0.28) * (0.4 + genome.fern.arch * 0.16) * heightStretch;
    for (let frond = 0; frond < fronds; frond++) {
      const yaw = resolveProcPlantPhyllotaxy(genome, frond).azimuth + (rng() - 0.5) * 0.16;
      const frame = branchRelativeFoliageFrame(
        UP,
        yaw,
        1.02 + genome.fern.arch * 0.18 + rng() * 0.1,
        -0.04,
      );
      organs.push({
        // The slotted palm-frond card is also an efficient pinnate fern card:
        // one 26-triangle silhouette replaces a chain of many leaflet meshes.
        kind: "palmFrond",
        position: new THREE.Vector3((rng() - 0.5) * 0.045, 0.018 + rng() * 0.018, (rng() - 0.5) * 0.045),
        direction: frame.direction,
        right: frame.right,
        scale: frondLength * (0.84 + rng() * 0.22),
        t: frond / Math.max(1, fronds - 1),
      });
    }
    return finalizeGraph();
  }

  if (authoredProcPlantId(genome) === "agaveSucculent") {
    const leaves = 18;
    for (let i = 0; i < leaves; i++) {
      const t = i / Math.max(1, leaves - 1);
      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth + (rng() - 0.5) * 0.08;
      const lower = i < leaves * 0.45;
      organs.push({
        kind: "leaf",
        position: new THREE.Vector3(0, 0.018 + t * 0.018, 0),
        direction: rotateFromAxis(UP, azimuth, lower ? 1.18 + rng() * 0.16 : 0.78 + rng() * 0.18),
        right: new THREE.Vector3(Math.cos(azimuth + Math.PI / 2), 0, -Math.sin(azimuth + Math.PI / 2)).normalize(),
        scale: curve(genome.leaf.length, t) * (1.08 - t * 0.16) * (0.92 + rng() * 0.16),
        t,
      });
    }
    return finalizeGraph();
  }

  if (authoredProcPlantId(genome) === "tulipCup") {
    const leaves = 5;
    for (let i = 0; i < leaves; i++) {
      const t = i / Math.max(1, leaves - 1);
      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth + (rng() - 0.5) * 0.2;
      organs.push({
        kind: "leaf",
        position: new THREE.Vector3((rng() - 0.5) * 0.035, 0.018 + i * 0.015, (rng() - 0.5) * 0.035),
        direction: rotateFromAxis(UP, azimuth, 0.7 + rng() * 0.22),
        right: new THREE.Vector3(Math.cos(azimuth + Math.PI / 2), 0, -Math.sin(azimuth + Math.PI / 2)).normalize(),
        scale: curve(genome.leaf.length, t) * (0.86 + rng() * 0.16),
        t,
      });
    }
    let previous = root;
    for (let i = 1; i <= genome.nodeCount; i++) {
      const t = i / genome.nodeCount;
      const direction = UP.clone()
        .add(lightVector.clone().multiplyScalar(genome.lightResponse.phototropism * t * (0.2 + shade)))
        .add(new THREE.Vector3((rng() - 0.5) * 0.018, 0, (rng() - 0.5) * 0.018))
        .normalize();
      const node: StemNode = {
        position: previous.position.clone().add(direction.clone().multiplyScalar(curve(genome.internode, t) * heightStretch)),
        direction,
        radius: previous.radius * THREE.MathUtils.lerp(0.92, 0.74, t),
        depth: 0,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;
    }
    organs.push({
      kind: "flower",
      position: previous.position.clone().add(previous.direction.clone().multiplyScalar(0.04)),
      direction: previous.direction.clone(),
      right: tangentBasis(previous.direction).right,
      scale: 1,
      t: 1,
    });
    return finalizeGraph();
  }

  if (authoredProcPlantId(genome) === "hibiscusBloom") {
    let previous = root;
    for (let i = 1; i <= genome.nodeCount; i++) {
      const t = i / genome.nodeCount;
      const direction = UP.clone()
        .add(lightVector.clone().multiplyScalar(genome.lightResponse.phototropism * t * (0.25 + shade)))
        .add(new THREE.Vector3((rng() - 0.5) * 0.06, 0, (rng() - 0.5) * 0.06))
        .normalize();
      const node: StemNode = {
        position: previous.position.clone().add(direction.clone().multiplyScalar(curve(genome.internode, t) * heightStretch)),
        direction,
        radius: previous.radius * THREE.MathUtils.lerp(0.93, 0.74, t),
        depth: 0,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;
      if (i > 1 && i < genome.nodeCount - 1 && rng() < 0.82) {
        const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth;
        const { right } = tangentBasis(direction);
        organs.push({
          kind: "leaf",
          position: node.position.clone(),
          direction: rotateFromAxis(direction, azimuth, 0.78 + t * 0.18),
          right: right.applyAxisAngle(direction, azimuth).normalize(),
          scale: curve(genome.leaf.length, t) * (0.82 + rng() * 0.24),
          t,
        });
      }
    }
    const tipRight = tangentBasis(previous.direction).right;
    organs.push({
      kind: "flower",
      position: previous.position.clone().add(previous.direction.clone().multiplyScalar(0.045)),
      direction: previous.direction.clone().add(lightVector.clone().multiplyScalar(0.12)).normalize(),
      right: tipRight,
      scale: 1,
      t: 1,
    });
    if (rng() < 0.6) {
      const azimuth = resolveProcPlantPhyllotaxy(genome, 1).azimuth;
      organs.push({
        kind: "flower",
        position: previous.position.clone().add(rotateFromAxis(previous.direction, azimuth, 0.85).multiplyScalar(0.18)),
        direction: rotateFromAxis(previous.direction, azimuth, 0.34),
        right: tipRight.clone().applyAxisAngle(previous.direction, azimuth).normalize(),
        scale: 0.72,
        t: 1,
      });
    }
    return finalizeGraph();
  }

  if (authoredProcPlantId(genome) === "poppyFlower") {
    const basalLeaves = 8;
    for (let i = 0; i < basalLeaves; i++) {
      const t = i / Math.max(1, basalLeaves - 1);
      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth + (rng() - 0.5) * 0.24;
      organs.push({
        kind: "leaf",
        position: new THREE.Vector3((rng() - 0.5) * 0.06, 0.018 + rng() * 0.025, (rng() - 0.5) * 0.06),
        direction: rotateFromAxis(UP, azimuth, 1.0 + rng() * 0.2),
        right: new THREE.Vector3(Math.cos(azimuth + Math.PI / 2), 0, -Math.sin(azimuth + Math.PI / 2)).normalize(),
        scale: curve(genome.leaf.length, t) * (0.82 + rng() * 0.22),
        t,
      });
    }
    const stemsForPoppy = 1 + Math.round(rng() * 1.2 + env.light * 0.7);
    for (let s = 0; s < stemsForPoppy; s++) {
      const azimuth = resolveProcPlantPhyllotaxy(genome, s).azimuth + rng() * 0.4;
      const offset = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth)).multiplyScalar(s === 0 ? 0 : 0.08 + rng() * 0.08);
      let previous: StemNode = {
        position: offset,
        direction: UP.clone(),
        radius: root.radius * 0.52,
        depth: 0,
        t: 0,
        index: stems.length,
      };
      stems.push(previous);
      segments.push([root.index, previous.index]);
      const count = genome.nodeCount - s;
      for (let i = 1; i <= count; i++) {
        const t = i / count;
        const direction = UP.clone()
          .add(lightVector.clone().multiplyScalar(genome.lightResponse.phototropism * t * (0.3 + shade)))
          .add(new THREE.Vector3((rng() - 0.5) * 0.035, 0, (rng() - 0.5) * 0.035))
          .normalize();
        const node: StemNode = {
          position: previous.position.clone().add(direction.clone().multiplyScalar(curve(genome.internode, t) * heightStretch * (s === 0 ? 1 : 0.82))),
          direction,
          radius: previous.radius * THREE.MathUtils.lerp(0.94, 0.74, t),
          depth: 0,
          t,
          index: stems.length,
        };
        stems.push(node);
        segments.push([previous.index, node.index]);
        previous = node;
      }
      organs.push({
        kind: "flower",
        position: previous.position.clone().add(previous.direction.clone().multiplyScalar(0.04)),
        direction: previous.direction.clone().add(new THREE.Vector3(0, 0.1, 0)).normalize(),
        right: tangentBasis(previous.direction).right,
        scale: s === 0 ? 1 : 0.78 + rng() * 0.12,
        t: 1,
      });
    }
    return finalizeGraph();
  }

  if (authoredProcPlantId(genome) === "sunflowerTower") {
    let previous = root;
    for (let i = 1; i <= genome.nodeCount; i++) {
      const t = i / genome.nodeCount;
      const direction = UP.clone()
        .add(lightVector.clone().multiplyScalar(genome.lightResponse.phototropism * t * (0.35 + shade)))
        .add(new THREE.Vector3((rng() - 0.5) * 0.035, 0, (rng() - 0.5) * 0.035))
        .normalize();
      const node: StemNode = {
        position: previous.position.clone().add(direction.clone().multiplyScalar(curve(genome.internode, t) * heightStretch)),
        direction,
        radius: previous.radius * THREE.MathUtils.lerp(0.95, 0.78, t),
        depth: 0,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;
      if (i > 1 && i < genome.nodeCount - 2 && i % 2 === 0) {
        const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth;
        const { right } = tangentBasis(direction);
        organs.push({
          kind: "leaf",
          position: node.position.clone(),
          direction: rotateFromAxis(direction, azimuth, 0.86 + t * 0.18),
          right: right.applyAxisAngle(direction, azimuth).normalize(),
          scale: curve(genome.leaf.length, t) * (0.85 + rng() * 0.2),
          t,
        });
      }
    }
    organs.push({
      kind: "flower",
      position: previous.position.clone().add(previous.direction.clone().multiplyScalar(0.05)),
      direction: previous.direction.clone().add(lightVector.clone().multiplyScalar(0.24)).normalize(),
      right: tangentBasis(previous.direction).right,
      scale: 1.15,
      t: 1,
    });
    return finalizeGraph();
  }

  if (authoredProcPlantId(genome) === "irisBulb" || authoredProcPlantId(genome) === "daylilyFlower") {
    const isDaylily = authoredProcPlantId(genome) === "daylilyFlower";
    const strapLeaves = isDaylily ? 11 : 9;
    for (let i = 0; i < strapLeaves; i++) {
      const t = i / Math.max(1, strapLeaves - 1);
      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth + (rng() - 0.5) * 0.18;
      organs.push({
        kind: "grassBlade",
        position: new THREE.Vector3((rng() - 0.5) * 0.05, 0, (rng() - 0.5) * 0.05),
        direction: rotateFromAxis(UP, azimuth, 0.32 + rng() * 0.28),
        right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)).normalize(),
        scale: curve(genome.leaf.length, t) * heightStretch * (isDaylily ? 0.76 + rng() * 0.2 : 0.84 + rng() * 0.18),
        t,
      });
    }
    let previous = root;
    for (let i = 1; i <= genome.nodeCount; i++) {
      const t = i / genome.nodeCount;
      const direction = UP.clone()
        .add(lightVector.clone().multiplyScalar(genome.lightResponse.phototropism * t * (0.25 + shade)))
        .add(new THREE.Vector3((rng() - 0.5) * 0.025, 0, (rng() - 0.5) * 0.025))
        .normalize();
      const node: StemNode = {
        position: previous.position.clone().add(direction.clone().multiplyScalar(curve(genome.internode, t) * heightStretch)),
        direction,
        radius: previous.radius * THREE.MathUtils.lerp(0.93, 0.76, t),
        depth: 0,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;
    }
    organs.push({
      kind: "flower",
      position: previous.position.clone().add(previous.direction.clone().multiplyScalar(0.04)),
      direction: previous.direction.clone(),
      right: tangentBasis(previous.direction).right,
      scale: 1,
      t: 1,
    });
    if (isDaylily && rng() < 0.85) {
      const side = tangentBasis(previous.direction).right;
      for (let i = 0; i < 2; i++) {
        const azimuth = resolveProcPlantPhyllotaxy(genome, i + 1).azimuth;
        organs.push({
          kind: "flower",
          position: previous.position
            .clone()
            .add(rotateFromAxis(previous.direction, azimuth, 0.72).multiplyScalar(0.13 + i * 0.035))
            .add(previous.direction.clone().multiplyScalar(-0.04 * i)),
          direction: rotateFromAxis(previous.direction, azimuth, 0.24),
          right: side.clone().applyAxisAngle(previous.direction, azimuth).normalize(),
          scale: 0.72 - i * 0.08,
          t: 1,
        });
      }
    }
    return finalizeGraph();
  }

  if (authoredProcPlantId(genome) === "foxgloveSpike") {
    const basalLeaves = 7;
    for (let i = 0; i < basalLeaves; i++) {
      const t = i / Math.max(1, basalLeaves - 1);
      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth + (rng() - 0.5) * 0.2;
      organs.push({
        kind: "leaf",
        position: new THREE.Vector3((rng() - 0.5) * 0.055, 0.018 + rng() * 0.025, (rng() - 0.5) * 0.055),
        direction: rotateFromAxis(UP, azimuth, 0.9 + rng() * 0.24),
        right: new THREE.Vector3(Math.cos(azimuth + Math.PI / 2), 0, -Math.sin(azimuth + Math.PI / 2)).normalize(),
        scale: curve(genome.leaf.length, t) * (0.88 + rng() * 0.18),
        t,
      });
    }
    let previous = root;
    for (let i = 1; i <= genome.nodeCount; i++) {
      const t = i / genome.nodeCount;
      const direction = UP.clone()
        .add(lightVector.clone().multiplyScalar(genome.lightResponse.phototropism * t * (0.3 + shade)))
        .add(new THREE.Vector3((rng() - 0.5) * 0.035, 0, (rng() - 0.5) * 0.035))
        .normalize();
      const node: StemNode = {
        position: previous.position.clone().add(direction.clone().multiplyScalar(curve(genome.internode, t) * heightStretch)),
        direction,
        radius: previous.radius * THREE.MathUtils.lerp(0.94, 0.76, t),
        depth: 0,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;
      if (i > 2 && i < genome.nodeCount - 1) {
        const ringCount = i % 2 === 0 ? 2 : 1;
        for (let f = 0; f < ringCount; f++) {
          const azimuth = resolveProcPlantPhyllotaxy(genome, i, f).azimuth +
            (genome.phyllotaxy ? 0 : f * Math.PI) +
            (rng() - 0.5) * 0.2;
          organs.push({
            kind: "flower",
            position: node.position.clone().add(rotateFromAxis(direction, azimuth, 1.22).multiplyScalar(0.09 + rng() * 0.035)),
            direction: rotateFromAxis(direction, azimuth, 1.38).add(new THREE.Vector3(0, -0.72, 0)).normalize(),
            right: tangentBasis(direction).right.applyAxisAngle(direction, azimuth).normalize(),
            scale: (0.72 + t * 0.24) * (0.9 + rng() * 0.12),
            t,
          });
        }
      } else if (i === 2 || i === 3) {
        const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth;
        const { right } = tangentBasis(direction);
        organs.push({
          kind: "leaf",
          position: node.position.clone(),
          direction: rotateFromAxis(direction, azimuth, 0.9),
          right: right.applyAxisAngle(direction, azimuth).normalize(),
          scale: curve(genome.leaf.length, t) * 0.55,
          t,
        });
      }
    }
    return finalizeGraph();
  }

  if (authoredProcPlantId(genome) === "laceUmbel") {
    let previous = root;
    for (let i = 1; i <= genome.nodeCount; i++) {
      const t = i / genome.nodeCount;
      const direction = UP.clone()
        .add(lightVector.clone().multiplyScalar(genome.lightResponse.phototropism * t * (0.35 + shade)))
        .add(new THREE.Vector3((rng() - 0.5) * 0.045, 0, (rng() - 0.5) * 0.045))
        .normalize();
      const node: StemNode = {
        position: previous.position.clone().add(direction.clone().multiplyScalar(curve(genome.internode, t) * heightStretch)),
        direction,
        radius: previous.radius * THREE.MathUtils.lerp(0.93, 0.75, t),
        depth: 0,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;
      if (i % 3 === 1 && i < genome.nodeCount - 2) {
        const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth;
        const { right } = tangentBasis(direction);
        organs.push({
          kind: "leaf",
          position: node.position.clone(),
          direction: rotateFromAxis(direction, azimuth, 0.95),
          right: right.applyAxisAngle(direction, azimuth).normalize(),
          scale: curve(genome.leaf.length, t) * (0.8 + rng() * 0.25),
          t,
        });
      }
    }
    const tip = previous;
    const spokes = 9;
    for (let i = 0; i < spokes; i++) {
      const t = i / Math.max(1, spokes - 1);
      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth;
      const spokeDir = rotateFromAxis(tip.direction, azimuth, 0.82 + rng() * 0.12);
      const spokeStart: StemNode = {
        position: tip.position.clone(),
        direction: spokeDir,
        radius: tip.radius * 0.38,
        depth: 1,
        t,
        index: stems.length,
      };
      stems.push(spokeStart);
      segments.push([tip.index, spokeStart.index]);
      const spokeEnd: StemNode = {
        position: tip.position.clone().add(spokeDir.clone().multiplyScalar(0.24 + rng() * 0.08)),
        direction: spokeDir,
        radius: tip.radius * 0.22,
        depth: 1,
        t,
        index: stems.length,
      };
      stems.push(spokeEnd);
      segments.push([spokeStart.index, spokeEnd.index]);
      const right = tangentBasis(spokeDir).right;
      for (let f = 0; f < 3; f++) {
        const floretYaw = azimuth + (f - 1) * 0.46;
        const floretOffset = rotateFromAxis(UP, floretYaw, 1.45).multiplyScalar(0.035 + f * 0.006);
        organs.push({
          kind: "flower",
          position: spokeEnd.position.clone().add(floretOffset),
          direction: UP.clone().add(spokeDir.clone().multiplyScalar(0.18)).normalize(),
          right,
          scale: 0.46 + rng() * 0.08,
          t: 1,
        });
      }
    }
    return finalizeGraph();
  }

  if (authoredProcPlantId(genome) === "echinaceaFlower") {
    const basalLeaves = 11;
    for (let i = 0; i < basalLeaves; i++) {
      const t = i / Math.max(1, basalLeaves - 1);
      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth + (rng() - 0.5) * 0.22;
      const lowAngle = 1.02 + rng() * 0.22;
      const direction = rotateFromAxis(UP, azimuth, lowAngle)
        .add(new THREE.Vector3(0, -0.05 * rng(), 0))
        .normalize();
      organs.push({
        kind: "leaf",
        position: new THREE.Vector3((rng() - 0.5) * 0.06, 0.015 + rng() * 0.025, (rng() - 0.5) * 0.06),
        direction,
        right: new THREE.Vector3(Math.cos(azimuth + Math.PI / 2), 0, -Math.sin(azimuth + Math.PI / 2)).normalize(),
        scale: curve(genome.leaf.length, t) * (0.9 + rng() * 0.28),
        t: Math.min(0.72, t * 0.55),
      });
    }

    const floweringStems = 1 + Math.round(env.moisture * 1.6 + rng() * 0.65);
    for (let s = 0; s < floweringStems; s++) {
      const azimuth = resolveProcPlantPhyllotaxy(genome, s).azimuth + rng() * 0.4;
      const baseOffset = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth)).multiplyScalar(s === 0 ? 0 : 0.08 + rng() * 0.08);
      const start: StemNode = {
        position: baseOffset.clone(),
        direction: UP.clone(),
        radius: root.radius * (s === 0 ? 0.82 : 0.62),
        depth: 0,
        t: 0,
        index: stems.length,
      };
      stems.push(start);
      segments.push([root.index, start.index]);
      let previous = start;
      const count = Math.max(6, genome.nodeCount - s * 2);
      const stemLean = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth)).multiplyScalar(0.08 + rng() * 0.06);
      for (let i = 1; i <= count; i++) {
        const t = i / count;
        const photo = lightVector
          .clone()
          .multiplyScalar(genome.lightResponse.phototropism * t * (0.25 + shade));
        const direction = UP.clone()
          .add(stemLean.clone().multiplyScalar(t))
          .add(photo)
          .add(new THREE.Vector3((rng() - 0.5) * 0.035, 0, (rng() - 0.5) * 0.035))
          .normalize();
        const position = previous.position
          .clone()
          .add(direction.clone().multiplyScalar(curve(genome.internode, t) * heightStretch * (s === 0 ? 1 : 0.82)));
        const node: StemNode = {
          position,
          direction,
          radius: previous.radius * THREE.MathUtils.lerp(0.92, 0.76, t),
          depth: 0,
          t,
          index: stems.length,
        };
        stems.push(node);
        segments.push([previous.index, node.index]);
        previous = node;

        if (i > 1 && i < count - 2 && i % 3 === 0 && rng() < 0.65 - t * 0.28) {
          const leafAzimuth = azimuth + resolveProcPlantPhyllotaxy(genome, i).azimuth;
          const { right } = tangentBasis(direction);
          organs.push({
            kind: "leaf",
            position,
            direction: rotateFromAxis(direction, leafAzimuth, 0.82 + t * 0.24),
            right: right.applyAxisAngle(direction, leafAzimuth).normalize(),
            scale: curve(genome.leaf.length, t) * (0.46 - t * 0.12) * (0.85 + rng() * 0.2),
            t: 0.55 + t * 0.35,
          });
        }
      }
      organs.push({
        kind: "flower",
        position: previous.position.clone().add(previous.direction.clone().multiplyScalar(0.045)),
        direction: previous.direction.clone().add(new THREE.Vector3(0, 0.18, 0)).normalize(),
        right: tangentBasis(previous.direction).right,
        scale: s === 0 ? 1 : 0.76 + rng() * 0.12,
        t: 1,
      });
    }
  return finalizeGraph();
}

  growAxis(0, 0, genome.nodeCount, 1);

  if (genome.habit === "conifer") {
    addConiferFoliageMass();
  }

  if (genome.habit === "tree" && genome.tree) {
    const crownStart = genome.tree.crownStart;
    const crownNodes = stems.filter((node) => node.t >= crownStart || node.depth > 0);
    const crownLeafChance =
      genome.tree.crown === "umbrella"
        ? 0.52
        : genome.tree.crown === "spreading"
          ? 0.56
        : genome.tree.crown === "columnar"
          ? 0.36
          : 0.46;
    for (const node of crownNodes) {
      const t = THREE.MathUtils.clamp((node.t - crownStart) / Math.max(0.001, 1 - crownStart), 0, 1);
      const crownBulk =
        genome.tree.crown === "umbrella"
          ? Math.sin(t * Math.PI) * 0.5 + 0.5
          : genome.tree.crown === "spreading"
            ? Math.sin(t * Math.PI) * 0.62 + 0.38
          : genome.tree.crown === "columnar"
            ? 0.72 + 0.28 * t
            : Math.sin(t * Math.PI) * 0.72 + 0.28;
      const clusters = Math.max(1, Math.round(genome.tree.leafClusterScale * crownBulk * (node.depth === 0 ? 1 : 1.35)));
      const massClusters = Math.max(
        1,
        Math.round(clusters * foliageTraits.clusterDensity * (0.76 + foliageTraits.mass * 0.56)),
      );
      for (let c = 0; c < massClusters; c++) {
        const tipBoost = THREE.MathUtils.lerp(1, t, foliageTraits.tipBias);
        if (rng() > crownLeafChance * tipBoost + env.moisture * 0.16 + foliageTraits.mass * 0.12) continue;
        const azimuth = resolveProcPlantPhyllotaxy(genome, node.index + c * 0.62).azimuth + (rng() - 0.5) * 0.22;
        const outward =
          genome.tree.crown === "umbrella"
            ? 1.18 + rng() * 0.16
            : genome.tree.crown === "spreading"
              ? 1.12 + rng() * 0.24
            : genome.tree.crown === "columnar"
              ? 0.84 + rng() * 0.18
              : 0.95 + rng() * 0.28;
        const branchBasis = tangentBasis(node.direction);
        const leafFrame = branchRelativeFoliageFrame(
          node.direction,
          azimuth,
          outward,
          genome.tree.crown === "umbrella" || genome.tree.crown === "spreading" ? 0.12 : 0.2,
          branchBasis.right,
        );
        const position = node.position
          .clone()
          .add(leafFrame.radial.clone().multiplyScalar(0.035 + rng() * 0.065))
          .add(node.direction.clone().multiplyScalar(0.012 + rng() * 0.035));
        organs.push({
          kind: "leaf",
          position,
          direction: leafFrame.direction,
          right: leafFrame.right,
          scale:
            curve(genome.leaf.length, node.t) *
            genome.tree.leafClusterScale *
            (0.76 + foliageTraits.mass * 0.18 + rng() * 0.42) *
            (genome.tree.crown === "umbrella" ? 1.12 : genome.tree.crown === "spreading" ? 1.08 : 1),
          t: node.t,
        });
      }
    }

    if (genome.tree.crown === "propRoot") {
      const roots = 7;
      for (let i = 0; i < roots; i++) {
        const t = i / Math.max(1, roots - 1);
        const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth + (rng() - 0.5) * 0.2;
        const rootDir = rotateFromAxis(UP, azimuth, 1.08 + rng() * 0.18);
        const rootStart: StemNode = {
          position: new THREE.Vector3(0, 0.08 + t * 0.12, 0),
          direction: rootDir,
          radius: root.radius * (0.42 + rng() * 0.16),
          depth: 1,
          t,
          index: stems.length,
        };
        stems.push(rootStart);
        segments.push([root.index, rootStart.index]);
        const rootEnd: StemNode = {
          position: rootStart.position
            .clone()
            .add(new THREE.Vector3(Math.cos(azimuth), -0.12 - rng() * 0.08, Math.sin(azimuth)).multiplyScalar(0.42 + rng() * 0.18)),
          direction: rootDir,
          radius: rootStart.radius * 0.55,
          depth: 1,
          t,
          index: stems.length,
        };
        stems.push(rootEnd);
        segments.push([rootStart.index, rootEnd.index]);
      }
    }
  }

  if (genome.habit === "palm") {
    const tip = stems.reduce((best, node) => (node.position.y > best.position.y ? node : best), stems[0]);
    const fronds = 11;
    for (let i = 0; i < fronds; i++) {
      const t = i / Math.max(1, fronds - 1);
      const azimuth = resolveProcPlantPhyllotaxy(genome, i).azimuth;
      const umbrellaAngle = 1.72 + Math.sin(t * Math.PI) * 0.16 + (i % 2) * 0.05;
      organs.push({
        kind: "palmFrond",
        position: tip.position.clone().add(tip.direction.clone().multiplyScalar(0.08)),
        direction: rotateFromAxis(tip.direction, azimuth, umbrellaAngle),
        right: tangentBasis(tip.direction).right.applyAxisAngle(tip.direction, azimuth).normalize(),
        scale: curve(genome.leaf.length, t) * (1.05 + (i % 3) * 0.05),
        t,
      });
    }
  }

  if (genome.flower) {
    const tip = stems.reduce((best, node) => (node.position.y > best.position.y ? node : best), stems[0]);
    organs.push({
      kind: "flower",
      position: tip.position.clone().add(tip.direction.clone().multiplyScalar(0.05)),
      direction: tip.direction.clone(),
      right: tangentBasis(tip.direction).right,
      scale: 1,
      t: 1,
    });
  }

  return finalizeGraph();
};

class TemplateBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv0: number[] = [];
  private col: number[] = [];
  private tintable: number[] = [];
  private sway: number[] = [];
  private idx: number[] = [];

  addQuad(
    corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
    color: THREE.Color,
    tintable = true,
    sway = 1,
    uv0: readonly [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ] = [[0, 0], [1, 0], [1, 1], [0, 1]],
  ) {
    const base = this.pos.length / 3;
    const normal = new THREE.Vector3()
      .subVectors(corners[1], corners[0])
      .cross(new THREE.Vector3().subVectors(corners[2], corners[0]))
      .normalize();
    for (let vertex = 0; vertex < corners.length; vertex++) {
      const corner = corners[vertex]!;
      this.pos.push(corner.x, corner.y, corner.z);
      this.nrm.push(normal.x, normal.y, normal.z);
      this.uv0.push(uv0[vertex][0], uv0[vertex][1]);
      this.col.push(color.r, color.g, color.b);
      this.tintable.push(tintable ? 1 : 0);
      this.sway.push(sway);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  addTriangle(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    color: THREE.Color,
    tint = true,
    sway = 1,
    uv0: readonly [readonly [number, number], readonly [number, number], readonly [number, number]] =
      [[0, 0], [1, 0], [0.5, 1]],
  ) {
    const base = this.pos.length / 3;
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [vertex, p] of [a, b, c].entries()) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(normal.x, normal.y, normal.z);
      this.uv0.push(uv0[vertex][0], uv0[vertex][1]);
      this.col.push(color.r, color.g, color.b);
      this.tintable.push(tint ? 1 : 0);
      this.sway.push(sway);
    }
    this.idx.push(base, base + 1, base + 2);
  }

  build(): ProcPlantTemplate {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      uv0: new Float32Array(this.uv0),
      col: new Float32Array(this.col),
      tintable: new Uint8Array(this.tintable),
      sway: new Float32Array(this.sway),
      idx: new Uint32Array(this.idx),
    };
  }
}

const leafWidthAt = (shape: LeafShapeKind, t: number, serration: number): number => {
  const s = Math.sin(Math.PI * t);
  const notch =
    shape === "cordate" ? 1 - 0.35 * Math.exp(-(((t - 0.12) / 0.12) ** 2)) : 1;
  const tip =
    shape === "lanceolate" || shape === "linear"
      ? s ** 1.6
      : shape === "ovate"
        ? s ** 0.72
        : shape === "round"
          ? Math.sin(Math.PI * Math.min(1, t * 0.96)) ** 0.42 *
            (0.72 + 0.28 * Math.sin(Math.PI * t))
        : shape === "spatulate"
          ? Math.sin(Math.PI * Math.min(1, t * 0.82)) ** 0.55 * (0.45 + t * 0.65)
          : shape === "fan"
            ? Math.sin(Math.PI * Math.min(1, t * 0.72)) ** 0.45 * (0.3 + t)
            : s;
  const lobes =
    shape === "palmate" || shape === "fan"
      ? 0.78 + 0.22 * Math.sin(t * Math.PI * (shape === "fan" ? 14 : 8))
      : 1;
  const teeth = serration > 0 ? 1 + serration * 0.08 * Math.sin(t * Math.PI * 28) : 1;
  return Math.max(0.02, tip * notch * lobes * teeth);
};

interface LeafSurfaceData {
  positions: THREE.Vector3[];
  indices: number[];
  rowCount: number;
  petioleRatio: number;
}

const leafPetioleRatio = (shape: LeafShapeKind): number => {
  if (shape === "cordate" || shape === "palmate" || shape === "fan") return 0.16;
  if (shape === "linear" || shape === "blade" || shape === "frond") return 0.08;
  return 0.12;
};

/** Compact folded leaf surface compatible with Tellus' authored venation contract. */
const createLeafSurfaceData = (
  shape: LeafShapeKind,
  widthRatio: number,
  serration: number,
  curl: number,
  venation: number,
): LeafSurfaceData => {
  // Deliberately lower than the Tellus close-up mesh: vegetation density wins
  // here, while the midrib fold preserves highlights and readable volume.
  const segments = shape === "linear" || shape === "blade" ? 2 : shape === "cordate" || shape === "palmate" || shape === "fan" ? 4 : 3;
  const petioleRatio = leafPetioleRatio(shape);
  const fold = THREE.MathUtils.clamp(venation, 0, 1);
  const rows: THREE.Vector3[][] = [];
  const petioleHalfWidth = Math.max(0.0035, Math.abs(widthRatio) * 0.012);
  rows.push([
    new THREE.Vector3(-petioleHalfWidth, 0, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(petioleHalfWidth, 0, 0),
  ]);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const envelope = Math.sin(Math.PI * t);
    const halfWidth = leafWidthAt(shape, t, serration) * widthRatio * 0.5;
    const asymmetry = envelope * Math.sin((t + 0.17) * Math.PI * 2) * (0.035 + serration * 0.08);
    const y = petioleRatio + t * (1 - petioleRatio);
    const spineZ = envelope * curl;
    const camber = envelope * (0.012 + fold * 0.042);
    const twist = (t - 0.2) * (0.035 + Math.abs(curl) * 0.38);
    rows.push([-1, 0, 1].map((side) => {
      const width = Math.max(0.0015, halfWidth * (1 + side * asymmetry));
      const x = side * width;
      const ridge = camber * (1 - Math.abs(side));
      return new THREE.Vector3(
        x * Math.cos(twist) - ridge * Math.sin(twist),
        y,
        spineZ + x * Math.sin(twist) + ridge * Math.cos(twist),
      );
    }));
  }
  const positions = rows.flat();
  const indices: number[] = [];
  for (let row = 0; row < rows.length - 1; row++) {
    for (let column = 0; column < 2; column++) {
      const ll = row * 3 + column;
      const lr = ll + 1;
      const ul = (row + 1) * 3 + column;
      const ur = ul + 1;
      indices.push(ll, lr, ul, ul, lr, ur);
    }
  }
  return { positions, indices, rowCount: rows.length, petioleRatio };
};

const addLeaf = (
  builder: TemplateBuilder,
  genome: ProcPlantGenome,
  organ: Organ,
  shade: number,
) => {
  const length = organ.scale * (1 + shade * genome.lightResponse.leafBoostInShade);
  const center = organ.position;
  const dir = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  const normal = new THREE.Vector3().crossVectors(right, dir).normalize();
  const color = new THREE.Color(genome.leaf.colorA).lerp(new THREE.Color(genome.leaf.colorB), organ.t);
  const surface = createLeafSurfaceData(
    genome.leaf.shape,
    genome.leaf.widthRatio,
    genome.leaf.serration,
    genome.leaf.curl,
    genome.leaf.venation,
  );
  const points = surface.positions.map((point) => center
    .clone()
    .addScaledVector(right, point.x * length)
    .addScaledVector(dir, point.y * length)
    .addScaledVector(normal, point.z * length));
  for (let i = 0; i < surface.indices.length; i += 3) {
    builder.addTriangle(
      points[surface.indices[i]!]!,
      points[surface.indices[i + 1]!]!,
      points[surface.indices[i + 2]!]!,
      color,
      true,
      0.35 + organ.t * 0.65,
    );
  }
};

const addGrassBlade = (builder: TemplateBuilder, genome: ProcPlantGenome, organ: Organ) => {
  const color = new THREE.Color(genome.leaf.colorA).lerp(new THREE.Color(genome.leaf.colorB), organ.t);
  const length = organ.scale;
  const width = length * genome.leaf.widthRatio;
  const root = organ.position;
  const dir = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  const mid = root.clone().add(dir.clone().multiplyScalar(length * 0.54));
  const tip = root
    .clone()
    .add(dir.clone().multiplyScalar(length))
    .add(new THREE.Vector3(0, -genome.leaf.curl * length * 0.18, 0));
  builder.addTriangle(
    root.clone().add(right.clone().multiplyScalar(-width)),
    root.clone().add(right.clone().multiplyScalar(width)),
    mid.clone().add(right.clone().multiplyScalar(width * 0.42)),
    color,
    true,
    0.45,
  );
  builder.addTriangle(
    root.clone().add(right.clone().multiplyScalar(-width)),
    mid.clone().add(right.clone().multiplyScalar(width * 0.42)),
    tip,
    color,
    true,
    1,
  );
}

const addStemSegment = (
  builder: TemplateBuilder,
  a: StemNode,
  b: StemNode,
  color: THREE.Color,
) => {
  const axis = b.position.clone().sub(a.position).normalize();
  const { right, up } = tangentBasis(axis);
  const sides = 4;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const r0 = right.clone().multiplyScalar(Math.cos(a0)).add(up.clone().multiplyScalar(Math.sin(a0)));
    const r1 = right.clone().multiplyScalar(Math.cos(a1)).add(up.clone().multiplyScalar(Math.sin(a1)));
    builder.addQuad(
      [
        a.position.clone().add(r0.clone().multiplyScalar(a.radius)),
        a.position.clone().add(r1.clone().multiplyScalar(a.radius)),
        b.position.clone().add(r1.clone().multiplyScalar(b.radius)),
        b.position.clone().add(r0.clone().multiplyScalar(b.radius)),
      ],
      color,
      false,
      b.t * 0.5,
    );
  }
};

function geometryForFlobotFlowerMesh(mesh: ProcPlantFlowerMeshKind): THREE.BufferGeometry {
  if (mesh === "flobot-daylily") return createProcPlantDaylilyBloomGeometry();
  if (mesh === "flobot-cup") return createProcPlantFlobotCupBloomGeometry();
  if (mesh === "flobot-petal-2") return createProcPlantFlobotPetal2BloomGeometry();
  return createProcPlantFlobotPinkBloomGeometry();
}

const instanceKindForFlobotFlowerMesh = (mesh: ProcPlantFlowerMeshKind): ProcPlantInstanceKind => {
  if (mesh === "flobot-daylily") return "daylilyBloom";
  if (mesh === "flobot-cup") return "flobotCupBloom";
  if (mesh === "flobot-petal-2") return "flobotPetal2Bloom";
  return "flobotPinkBloom";
};

const addFlower = (builder: TemplateBuilder, genome: ProcPlantGenome, organ: Organ) => {
  if (!genome.flower) return;
  const isEchinacea = authoredProcPlantId(genome) === "echinaceaFlower";
  const petalColor = new THREE.Color(genome.flower.color);
  const centerColor = new THREE.Color(genome.flower.centerColor);
  const radius = genome.flower.radius;
  const bendVariant =
    Math.sin(organ.position.x * 41.7 + organ.position.y * 23.1 + organ.position.z * 67.3 + organ.scale * 11.9) *
      0.5 +
    0.5;
  const frame = bendFlowerFrame(
    organ,
    organ.bend ?? flowerLoadBend(genome, organ.position, organ.scale, bendVariant),
  );
  const { forward, right, up } = frame;
  const flobotBloomGeometry = genome.flower.mesh ? geometryForFlobotFlowerMesh(genome.flower.mesh) : null;
  if (flobotBloomGeometry) {
    const bloomForward =
      genome.flower.mesh === "flobot-daylily" || (genome.flower.mesh === undefined && authoredProcPlantId(genome) === "hibiscusBloom")
        ? forward.clone().negate()
        : forward;
    addTransformedGeometry(
      builder,
      flobotBloomGeometry,
      instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.04)),
        right,
        up,
        bloomForward,
        new THREE.Vector3(radius * 2.25, radius * 2.25, radius * 2.25),
      ),
      petalColor,
      0.62,
    );
    flobotBloomGeometry.dispose();
    const c = organ.position.clone().add(forward.clone().multiplyScalar(-radius * 0.08));
    builder.addTriangle(
      c.clone().add(right.clone().multiplyScalar(-radius * 0.1)),
      c.clone().add(right.clone().multiplyScalar(radius * 0.1)),
      c.clone().add(up.clone().multiplyScalar(radius * 0.13)),
      centerColor,
      false,
      0.22,
    );
    return;
  }
  if (authoredProcPlantId(genome) === "daylilyFlower") {
    const bloomForward = forward.clone().negate();
    const toWorld = (x: number, y: number, z: number) =>
      organ.position
        .clone()
        .add(right.clone().multiplyScalar(x * radius * 2.18))
        .add(up.clone().multiplyScalar(y * radius * 2.18))
        .add(bloomForward.clone().multiplyScalar(z * radius * 1.45));
    const center = toWorld(0, 0, -0.055);
    const rim: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = i * (Math.PI / 6) + Math.PI / 2;
      const isTip = i % 2 === 0;
      const r = isTip ? 0.54 : 0.2;
      const fold = Math.sin(a * 3) * 0.025 + (isTip ? 0.015 : 0);
      rim.push(toWorld(Math.cos(a) * r, Math.sin(a) * r, -0.055 - fold));
    }
    for (let i = 0; i < rim.length; i++) {
      builder.addTriangle(center, rim[i], rim[(i + 1) % rim.length], petalColor, true, 0.6);
    }
    builder.addTriangle(
      toWorld(0, -0.42, 0.32),
      toWorld(-0.24, 0.1, 0.02),
      toWorld(0.24, 0.1, 0.02),
      petalColor,
      true,
      0.6,
    );
    builder.addTriangle(
      center.clone().add(right.clone().multiplyScalar(-radius * 0.13)),
      center.clone().add(right.clone().multiplyScalar(radius * 0.13)),
      center.clone().add(up.clone().multiplyScalar(radius * 0.18)),
      centerColor,
      false,
      0.2,
    );
    return;
  }
  if (authoredProcPlantId(genome) === "hibiscusBloom") {
    const bloomGeometry = createProcPlantHibiscusBloomGeometry();
    addTransformedGeometry(
      builder,
      bloomGeometry,
      instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.04)),
        right,
        up,
        forward.clone().negate(),
        new THREE.Vector3(radius * 2.25, radius * 2.25, radius * 2.25),
      ),
      petalColor,
      0.66,
    );
    bloomGeometry.dispose();
    const c = organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.08));
    builder.addTriangle(
      c.clone().add(right.clone().multiplyScalar(-radius * 0.11)),
      c.clone().add(right.clone().multiplyScalar(radius * 0.11)),
      c.clone().add(up.clone().multiplyScalar(radius * 0.14)),
      centerColor,
      false,
      0.22,
    );
    return;
  }
  if (authoredProcPlantId(genome) === "foxgloveSpike") {
    const bloomForward = forward;
    const toWorld = (x: number, y: number, z: number) =>
      organ.position
        .clone()
        .add(right.clone().multiplyScalar(x * radius * 1.78))
        .add(up.clone().multiplyScalar(y * radius * 1.78))
        .add(bloomForward.clone().multiplyScalar(z * radius * 1.95));
    const apex = toWorld(0, 0, -0.62);
    const base: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + Math.PI / 2;
      base.push(toWorld(Math.cos(a) * 0.24, Math.sin(a) * 0.24, -0.04));
    }
    builder.addTriangle(apex, base[0], base[1], petalColor, true, 0.48);
    builder.addTriangle(apex, base[1], base[2], petalColor, true, 0.48);
    builder.addTriangle(apex, base[2], base[0], petalColor, true, 0.48);

    const center = toWorld(0, 0, 0.045);
    const diamond = [
      toWorld(0, 0.4, 0.05),
      toWorld(0.22, 0, 0.07),
      toWorld(0, -0.22, 0.04),
      toWorld(-0.22, 0, 0.07),
    ];
    for (let i = 0; i < diamond.length; i++) {
      builder.addTriangle(center, diamond[(i + 1) % diamond.length], diamond[i], petalColor, true, 0.48);
    }
    builder.addTriangle(
      center.clone().add(right.clone().multiplyScalar(-radius * 0.08)),
      center.clone().add(right.clone().multiplyScalar(radius * 0.08)),
      center.clone().add(up.clone().multiplyScalar(radius * 0.11)),
      centerColor,
      false,
      0.16,
    );
    return;
  }
  const petals = Math.max(1, genome.flower.petals);
  for (let w = 0; w < genome.flower.whorls; w++) {
    const whorlT = w / Math.max(1, genome.flower.whorls - 1);
    const whorlRadius = radius * (1.08 - whorlT * 0.42);
    const whorlLift = forward.clone().multiplyScalar(radius * whorlT * 0.1);
    const offset = (w / Math.max(1, genome.flower.whorls)) * Math.PI / petals + whorlT * 0.38;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + offset;
      const radial = right.clone().multiplyScalar(Math.cos(a)).add(up.clone().multiplyScalar(Math.sin(a)));
      const base = organ.position.clone().add(whorlLift).add(radial.clone().multiplyScalar(whorlRadius * 0.16));
      const tip = organ.position
        .clone()
        .add(whorlLift)
        .add(forward.clone().multiplyScalar(radius * (isEchinacea ? -0.18 - whorlT * 0.06 : 0.05 + whorlT * 0.24)))
        .add(radial.clone().multiplyScalar(whorlRadius * (isEchinacea ? 1.18 : 1.08)));
      const side = up
        .clone()
        .multiplyScalar(whorlRadius * 0.2 * Math.cos(a))
        .add(right.clone().multiplyScalar(-whorlRadius * 0.2 * Math.sin(a)));
      builder.addTriangle(base.clone().add(side), base.clone().sub(side), tip, petalColor, true, 0.7);
    }
  }
  const c = organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.04));
  builder.addTriangle(
    c.clone().add(right.clone().multiplyScalar(-radius * (isEchinacea ? 0.24 : 0.16))),
    c.clone().add(right.clone().multiplyScalar(radius * (isEchinacea ? 0.24 : 0.16))),
    c.clone().add(up.clone().multiplyScalar(radius * (isEchinacea ? 0.28 : 0.18))),
    centerColor,
    false,
    0.3,
  );
};

const instanceMatrixFromFrame = (
  position: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  forward: THREE.Vector3,
  scale: THREE.Vector3,
) => {
  const basis = new THREE.Matrix4().makeBasis(
    right.clone().normalize(),
    up.clone().normalize(),
    forward.clone().normalize(),
  );
  basis.scale(scale);
  basis.setPosition(position);
  return basis;
};

const leafInstance = (
  genome: ProcPlantGenome,
  organ: Organ,
  shade: number,
): ProcPlantInstance => {
  const length = organ.scale * (1 + shade * genome.lightResponse.leafBoostInShade);
  const dir = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  const normal = new THREE.Vector3().crossVectors(right, dir).normalize();
  normal.negate();
  const color = new THREE.Color(genome.leaf.colorA).lerp(new THREE.Color(genome.leaf.colorB), organ.t);
  return {
    kind: organ.kind === "grassBlade" ? "grassBlade" : "leaf",
    matrix: instanceMatrixFromFrame(
      organ.position,
      right,
      dir,
      normal,
      new THREE.Vector3(length, length, length),
    ),
    color,
    sway: 0.35 + organ.t * 0.65,
  };
};

const grassBladeInstance = (
  genome: ProcPlantGenome,
  organ: Organ,
): ProcPlantInstance => {
  const length = organ.scale;
  const dir = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  const normal = new THREE.Vector3().crossVectors(right, dir).normalize();
  normal.negate();
  const color = new THREE.Color(genome.leaf.colorA).lerp(new THREE.Color(genome.leaf.colorB), organ.t);
  return {
    kind: "grassBlade",
    matrix: instanceMatrixFromFrame(
      organ.position,
      right,
      dir,
      normal,
      new THREE.Vector3(length, length, length),
    ),
    color,
    sway: 1,
  };
};

const coniferSprayInstance = (
  genome: ProcPlantGenome,
  organ: Organ,
): ProcPlantInstance => {
  const length = organ.scale;
  const dir = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  const normal = new THREE.Vector3().crossVectors(right, dir).normalize();
  normal.negate();
  const color = new THREE.Color(genome.leaf.colorA).lerp(new THREE.Color(genome.leaf.colorB), 0.35 + organ.t * 0.45);
  return {
    kind: "coniferSpray",
    matrix: instanceMatrixFromFrame(
      organ.position,
      right,
      dir,
      normal,
      new THREE.Vector3(length, length, length),
    ),
    color,
    sway: 0.45 + organ.t * 0.35,
  };
};

const palmFrondInstance = (
  genome: ProcPlantGenome,
  organ: Organ,
): ProcPlantInstance => {
  const length = organ.scale;
  const dir = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  const normal = new THREE.Vector3().crossVectors(right, dir).normalize();
  normal.negate();
  const color = new THREE.Color(genome.leaf.colorA).lerp(new THREE.Color(genome.leaf.colorB), 0.25 + organ.t * 0.35);
  return {
    kind: "palmFrond",
    matrix: instanceMatrixFromFrame(
      organ.position,
      right,
      dir,
      normal,
      new THREE.Vector3(length, length, length),
    ),
    color,
    sway: 0.85,
  };
};

const mossTuftInstance = (
  genome: ProcPlantGenome,
  organ: Organ,
): ProcPlantInstance => {
  const direction = organ.direction.clone().normalize();
  let right = organ.right.clone().projectOnPlane(direction);
  if (right.lengthSq() < 0.0001) right = tangentBasis(direction).right;
  right.normalize();
  const normal = new THREE.Vector3().crossVectors(right, direction).normalize().negate();
  return {
    kind: "mossTuft",
    matrix: instanceMatrixFromFrame(
      organ.position,
      right,
      direction,
      normal,
      new THREE.Vector3(organ.scale, organ.scale, organ.scale),
    ),
    color: new THREE.Color(genome.leaf.colorA).lerp(new THREE.Color(genome.leaf.colorB), 0.2 + organ.t * 0.5),
    sway: 0.32 + organ.t * 0.22,
  };
};

const isAccessoryOrganKind = (kind: string): kind is ProcPlantAccessoryKind =>
  kind === "fruit" || kind === "berry" || kind === "cone" || kind === "thorn" || kind === "aerialRoot";

const accessoryInstance = (organ: Organ): ProcPlantInstance => {
  if (!isAccessoryOrganKind(organ.kind)) {
    throw new Error(`Expected accessory organ, received ${organ.kind}`);
  }
  const direction = organ.direction.clone().normalize();
  let right = organ.right.clone().projectOnPlane(direction);
  if (right.lengthSq() < 0.0001) right = tangentBasis(direction).right;
  right.normalize();
  const normal = new THREE.Vector3().crossVectors(right, direction).normalize().negate();
  const color = new THREE.Color(organ.color ?? 0x8b6847);
  if (organ.secondaryColor !== undefined) {
    color.lerp(new THREE.Color(organ.secondaryColor), 0.08 + organ.t * 0.12);
  }
  return {
    kind: organ.kind,
    matrix: instanceMatrixFromFrame(
      organ.position,
      right,
      direction,
      normal,
      new THREE.Vector3(organ.scale, organ.scale, organ.scale),
    ),
    color,
    sway: organ.kind === "thorn" ? 0.08 : organ.kind === "aerialRoot" ? 0.18 : 0.28 + organ.t * 0.24,
  };
};

const flowerInstances = (
  genome: ProcPlantGenome,
  organ: Organ,
): ProcPlantInstance[] => {
  if (!genome.flower) return [];
  const authoredId = authoredProcPlantId(genome);
  const isEchinacea = authoredId === "echinaceaFlower";
  const isDaylily = authoredId === "daylilyFlower";
  const isTulip = authoredId === "tulipCup";
  const isFoxglove = authoredId === "foxgloveSpike";
  const isPoppy = authoredId === "poppyFlower";
  const isSunflower = authoredId === "sunflowerTower";
  const isHibiscus = authoredId === "hibiscusBloom";
  const petalColor = new THREE.Color(genome.flower.color);
  const centerColor = new THREE.Color(genome.flower.centerColor);
  const radius = genome.flower.radius * organ.scale;
  const petals = Math.max(1, genome.flower.petals);
  const out: ProcPlantInstance[] = [];
  const bendVariant =
    Math.sin(organ.position.x * 41.7 + organ.position.y * 23.1 + organ.position.z * 67.3 + organ.scale * 11.9) *
      0.5 +
    0.5;
  const frame = bendFlowerFrame(
    organ,
    organ.bend ?? flowerLoadBend(genome, organ.position, organ.scale, bendVariant),
  );
  const { forward, right, up } = frame;
  if (genome.flower.mesh) {
    const bloomForward =
      genome.flower.mesh === "flobot-daylily" || (genome.flower.mesh === undefined && authoredId === "hibiscusBloom")
        ? forward.clone().negate()
        : forward;
    out.push({
      kind: instanceKindForFlobotFlowerMesh(genome.flower.mesh),
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.04)),
        right,
        up,
        bloomForward,
        new THREE.Vector3(radius * 2.25, radius * 2.25, radius * 2.25),
      ),
      color: petalColor,
      sway: 0.62,
    });
    out.push({
      kind: "flowerCenter",
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.08)),
        right,
        up,
        forward.clone().negate(),
        new THREE.Vector3(radius * 0.38, radius * 0.38, radius),
      ),
      color: centerColor,
      sway: 0.22,
    });
    return out;
  }
  if (isDaylily) {
    out.push({
      kind: "daylilyBloom",
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.02)),
        right,
        up,
        forward.clone().negate(),
        new THREE.Vector3(radius * 2.18, radius * 2.18, radius * 1.45),
      ),
      color: petalColor,
      sway: 0.6,
    });
    out.push({
      kind: "flowerCenter",
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.12)),
        right,
        up,
        forward,
        new THREE.Vector3(radius * 0.52, radius * 0.52, radius),
      ),
      color: centerColor,
      sway: 0.2,
    });
    return out;
  }
  if (isFoxglove) {
    out.push({
      kind: "foxgloveBloom",
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.02)),
        right,
        up,
        forward,
        new THREE.Vector3(radius * 1.78, radius * 1.78, radius * 1.95),
      ),
      color: petalColor,
      sway: 0.48,
    });
    out.push({
      kind: "flowerCenter",
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.1)),
        right,
        up,
        forward,
        new THREE.Vector3(radius * 0.38, radius * 0.38, radius),
      ),
      color: centerColor,
      sway: 0.16,
    });
    return out;
  }
  if (isPoppy) {
    out.push({
      kind: "flowerDisc",
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.015)),
        right,
        up,
        forward,
        new THREE.Vector3(radius * 2.15, radius * 2.15, radius),
      ),
      color: petalColor,
      sway: 0.62,
    });
    out.push({
      kind: "flowerCenter",
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.06)),
        right,
        up,
        forward,
        new THREE.Vector3(radius * 0.86, radius * 0.86, radius),
      ),
      color: centerColor,
      sway: 0.22,
    });
    return out;
  }
  if (isHibiscus) {
    out.push({
      kind: "hibiscusBloom",
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.04)),
        right,
        up,
        forward.clone().negate(),
        new THREE.Vector3(radius * 2.25, radius * 2.25, radius * 2.25),
      ),
      color: petalColor,
      sway: 0.66,
    });
    out.push({
      kind: "flowerCenter",
      matrix: instanceMatrixFromFrame(
        organ.position.clone().add(forward.clone().multiplyScalar(-radius * 0.08)),
        right,
        up,
        forward.clone().negate(),
        new THREE.Vector3(radius * 0.42, radius * 0.42, radius),
      ),
      color: centerColor,
      sway: 0.22,
    });
    return out;
  }
  for (let w = 0; w < genome.flower.whorls; w++) {
    const whorlT = w / Math.max(1, genome.flower.whorls - 1);
    const whorlRadius = radius * (1.08 - whorlT * 0.42);
    const whorlLift = forward.clone().multiplyScalar(radius * whorlT * 0.1);
    const offset = (w / Math.max(1, genome.flower.whorls)) * Math.PI / petals + whorlT * 0.38;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + offset;
      const radial = right.clone().multiplyScalar(Math.cos(a)).add(up.clone().multiplyScalar(Math.sin(a))).normalize();
      const side = up
        .clone()
        .multiplyScalar(Math.cos(a))
        .add(right.clone().multiplyScalar(-Math.sin(a)))
        .normalize();
      const petalAxis = isEchinacea
        ? radial.clone().multiplyScalar(1.08).add(forward.clone().multiplyScalar(-0.34 - whorlT * 0.08)).normalize()
        : isTulip
          ? radial.clone().multiplyScalar(0.48 + whorlT * 0.1).add(forward.clone().multiplyScalar(0.88 - whorlT * 0.18)).normalize()
          : isFoxglove
            ? radial.clone().multiplyScalar(0.44).add(forward.clone().multiplyScalar(0.7 - whorlT * 0.2)).normalize()
          : isDaylily
            ? radial.clone().multiplyScalar(1.08).add(forward.clone().multiplyScalar(0.18 - whorlT * 0.08)).normalize()
            : isPoppy
              ? radial.clone().multiplyScalar(1.02).add(forward.clone().multiplyScalar(0.08)).normalize()
            : isSunflower
              ? radial.clone().multiplyScalar(1.1).add(forward.clone().multiplyScalar(0.04)).normalize()
              : isHibiscus
                ? radial.clone().multiplyScalar(1.02).add(forward.clone().multiplyScalar(0.12)).normalize()
              : radial;
      const petalNormal =
        isEchinacea || isDaylily || isTulip || isFoxglove || isPoppy || isSunflower || isHibiscus
          ? new THREE.Vector3().crossVectors(petalAxis, side).normalize().lerp(forward, isTulip ? 0.7 : 0.45).normalize()
          : forward;
      const widthScale = isEchinacea ? 0.78 : isFoxglove ? 0.64 : isTulip ? 0.92 : isPoppy ? 1.35 : isSunflower ? 0.5 : isHibiscus ? 1.28 : 1;
      const lengthScale = isEchinacea ? 1.18 : isDaylily ? 1.2 : isTulip ? 0.98 : isFoxglove ? 0.82 : isPoppy ? 0.94 : isSunflower ? 1.12 : isHibiscus ? 1.05 : 1;
      out.push({
        kind: "petal",
        matrix: instanceMatrixFromFrame(
          organ.position.clone().add(whorlLift).add(radial.clone().multiplyScalar(whorlRadius * 0.16)),
          side,
          petalAxis,
          petalNormal.clone().negate(),
          new THREE.Vector3(whorlRadius * widthScale, whorlRadius * lengthScale, whorlRadius),
        ),
        color: petalColor,
        sway: 0.7,
      });
    }
  }
  out.push({
    kind: "flowerCenter",
    matrix: instanceMatrixFromFrame(
      organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.04)),
      right,
      up,
      forward,
      new THREE.Vector3(
        radius * (isEchinacea ? 1.26 : isTulip ? 0.64 : isPoppy ? 0.72 : isSunflower ? 1.45 : isHibiscus ? 0.42 : 1),
        radius * (isEchinacea ? 1.26 : isTulip ? 0.64 : isPoppy ? 0.72 : isSunflower ? 1.45 : isHibiscus ? 0.42 : 1),
        radius,
      ),
    ),
    color: centerColor,
    sway: 0.25,
  });
  return out;
};

const templateFromSweptTubeGeometry = (
  geometry: THREE.BufferGeometry,
  baseSway: number,
): ProcPlantTemplate => {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const sourceUv0 = geometry.getAttribute("uv");
  const color = geometry.getAttribute("color");
  const sourceSway = geometry.getAttribute(PROCPLANT_BRANCH_SWAY_ATTRIBUTE);
  const sourceTintable = geometry.getAttribute(PROCPLANT_BRANCH_TINTABLE_ATTRIBUTE);
  const index = geometry.index;
  if (!position || !normal || !sourceUv0 || !color || !index) {
    throw new Error("swept tube geometry is missing runtime attributes");
  }
  const pos = new Float32Array(position.count * 3);
  const nrm = new Float32Array(normal.count * 3);
  const uv0 = new Float32Array(position.count * 2);
  const col = new Float32Array(color.count * 3);
  const sway = new Float32Array(position.count);
  const tintable = new Uint8Array(position.count);
  const branchBase = THREE.MathUtils.clamp(baseSway, 0, 1);
  for (let vertex = 0; vertex < position.count; vertex++) {
    const offset = vertex * 3;
    pos[offset] = position.getX(vertex);
    pos[offset + 1] = position.getY(vertex);
    pos[offset + 2] = position.getZ(vertex);
    nrm[offset] = normal.getX(vertex);
    nrm[offset + 1] = normal.getY(vertex);
    nrm[offset + 2] = normal.getZ(vertex);
    uv0[vertex * 2] = sourceUv0.getX(vertex);
    uv0[vertex * 2 + 1] = sourceUv0.getY(vertex);
    col[offset] = color.getX(vertex);
    col[offset + 1] = color.getY(vertex);
    col[offset + 2] = color.getZ(vertex);
    sway[vertex] = THREE.MathUtils.clamp(
      branchBase + (sourceSway?.getX(vertex) ?? 0) * (1 - branchBase),
      0,
      1,
    );
    tintable[vertex] = sourceTintable?.getX(vertex) ? 1 : 0;
  }
  const idx = new Uint32Array(index.count);
  for (let element = 0; element < index.count; element++) idx[element] = index.getX(element);
  return { pos, nrm, uv0, col, tintable, sway, idx };
};

/** Compile an opt-in volumetric crown into swept branch tubes and leaf instances. */
const buildSpaceColonizedProcPlantParts = (
  genome: ProcPlantGenome,
  seed: number,
  env: ProcPlantEnvironment,
): ProcPlantInstancedParts => {
  const gene = genome.spaceColonization;
  if (!gene) throw new Error("space-colonization genome options are required");
  const center = new THREE.Vector3(...gene.volume.center);
  const dimensions = new THREE.Vector3(...gene.volume.dimensions);
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const centerHeightScale = 1 + shade * genome.lightResponse.shadeAvoidance * 0.08;
  const crownHeightScale = 1 + shade * genome.lightResponse.shadeAvoidance * 0.14;
  const crownHorizontalScale = 0.94 + THREE.MathUtils.clamp(env.moisture, 0, 1) * 0.08;
  center.y *= centerHeightScale;
  dimensions.y *= crownHeightScale;
  dimensions.x *= crownHorizontalScale;
  dimensions.z *= crownHorizontalScale;
  const volume = gene.volume.shape === "ellipsoid"
    ? { shape: "ellipsoid" as const, center, radii: dimensions }
    : { shape: "box" as const, center, size: dimensions };
  const crownDomain = gene.freeform ? {
    contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
    version: PROCPLANT_FREEFORM_CROWN_VERSION,
    volumes: gene.freeform.volumes.map((control) => ({
      ...control,
      center: [control.center[0], control.center[1] * centerHeightScale, control.center[2]] as const,
      dimensions: [
        control.dimensions[0] * crownHorizontalScale,
        control.dimensions[1] * crownHeightScale,
        control.dimensions[2] * crownHorizontalScale,
      ] as const,
    })),
  } satisfies ProcPlantFreeformCrown : volume;
  const tropism = gene.tropism ? new THREE.Vector3(...gene.tropism) : UP.clone();
  const growth = growProcPlantSpaceColonization({
    seed,
    volume: crownDomain,
    attractorCount: gene.attractorCount,
    root: new THREE.Vector3(center.x, 0, center.z),
    segmentLength: gene.segmentLength,
    influenceRadius: gene.influenceRadius,
    killRadius: gene.killRadius,
    collisionRadius: gene.collisionRadius,
    maxSteps: gene.maxSteps,
    maxNodes: gene.maxNodes,
    maxChildren: gene.maxChildren,
    tropism,
    tropismStrength: gene.tropismStrength,
    directionJitter: gene.directionJitter,
    pipeExponent: gene.pipeExponent,
    tipRadius: gene.tipRadius,
  });
  const maxDepth = Math.max(1, ...growth.nodes.map((node) => node.depth));
  const nodeIndexById = new Map<string, number>();
  const stems: StemNode[] = growth.nodes.map((node, index) => {
    nodeIndexById.set(node.id, index);
    return {
      position: node.position.clone(),
      direction: node.direction.clone(),
      radius: node.radius,
      depth: node.depth,
      t: node.depth / maxDepth,
      index,
    };
  });
  const segments: Array<[number, number]> = growth.segments.map((segment) => [
    nodeIndexById.get(segment.startNodeId)!,
    nodeIndexById.get(segment.endNodeId)!,
  ]);

  const foliageStart = THREE.MathUtils.clamp(gene.foliageStart ?? 0.46, 0, 1);
  const foliageSpacing = Math.max(1, Math.round(gene.foliageSpacing ?? 4));
  const terminalLeafCount = Math.max(1, Math.min(6, Math.round(gene.terminalLeafCount ?? 3)));
  const leafScale = Math.max(0.05, gene.leafScale ?? 1);
  const rng = rngFromSeed((seed ^ 0x51ed270b) >>> 0);
  const organs: Organ[] = [];
  for (const node of growth.nodes) {
    const t = node.depth / maxDepth;
    if (t < foliageStart) continue;
    const terminal = node.childCount === 0;
    if (!terminal && node.depth % foliageSpacing !== 0) continue;
    const count = terminal ? terminalLeafCount : 1;
    for (let slot = 0; slot < count; slot++) {
      const azimuth = resolveProcPlantPhyllotaxy(genome, node.depth + slot / count, slot).azimuth;
      const frame = branchRelativeFoliageFrame(
        node.direction,
        azimuth,
        terminal ? 1.04 : 0.86,
        0.16 + genome.lightResponse.phototropism * 0.45,
      );
      organs.push({
        kind: "leaf",
        position: node.position.clone().addScaledVector(node.direction, Math.max(node.radius, 0.004) * 0.55),
        direction: frame.direction,
        right: frame.right,
        scale: curve(genome.leaf.length, t) * leafScale * (0.84 + rng() * 0.24),
        t,
      });
    }
  }
  const graph = buildProcPlantGraphIr(stems, segments, organs);

  const nodeById = new Map(growth.nodes.map((node) => [node.id, node]));
  const childrenById = new Map<string, string[]>();
  for (const segment of growth.segments) {
    const children = childrenById.get(segment.startNodeId) ?? [];
    children.push(segment.endNodeId);
    childrenById.set(segment.startNodeId, children);
  }
  let stemTemplate: ProcPlantTemplate = new TemplateBuilder().build();
  const radialSegments = Math.max(3, Math.min(8, Math.round(gene.radialSegments ?? 5)));
  const barkColor = gene.barkColor ?? 0x6d5135;
  const appendChain = (startId: string, firstChildId: string, branchOrder: number) => {
    const chain = [nodeById.get(startId)!, nodeById.get(firstChildId)!];
    let current = chain[1]!;
    let children = childrenById.get(current.id) ?? [];
    while (children.length === 1) {
      current = nodeById.get(children[0]!)!;
      chain.push(current);
      children = childrenById.get(current.id) ?? [];
    }
    const baseT = chain[0]!.depth / maxDepth;
    const geometry = createProcPlantSweptTubeGeometry(
      chain.map((node) => ({
        position: node.position,
        radius: node.radius,
        age: node.depth / maxDepth,
        branchOrder,
      })),
      {
        radialSegments,
        seed: (seed + growth.nodes.indexOf(chain[0]!) * 2654435761 + branchOrder * 2246822519) >>> 0,
        irregularity: gene.barkIrregularity ?? 0.05,
        irregularityFrequency: 1.6 + branchOrder * 0.17,
        collarStrength: gene.collarStrength === undefined
          ? (branchOrder === 0 ? 0.14 : 0.24)
          : gene.collarStrength * (branchOrder === 0 ? 7 / 12 : 1),
        collarLength: gene.collarLength ?? 0.22,
        color: barkColor,
        junctionAo: gene.junctionAo === undefined
          ? (branchOrder === 0 ? 0.1 : 0.2)
          : gene.junctionAo * (branchOrder === 0 ? 0.5 : 1),
        capStart: chain[0]!.parentId === null,
        capEnd: children.length === 0,
      },
    );
    stemTemplate = combineTemplates(stemTemplate, templateFromSweptTubeGeometry(geometry, baseT));
    geometry.dispose();
    for (const childId of children) appendChain(current.id, childId, branchOrder + 1);
  };
  const root = growth.nodes[0]!;
  for (const childId of childrenById.get(root.id) ?? []) appendChain(root.id, childId, 0);

  const instances = organs.map((organ) => leafInstance(genome, organ, shade));
  return {
    stems: stemTemplate,
    instances,
    graph,
    stats: {
      stems: growth.segments.length,
      leaves: organs.length,
      flowers: 0,
      stemTriangles: stemTemplate.idx.length / 3,
      instances: instances.length,
      triangles: stemTemplate.idx.length / 3 + instances.length,
    },
  };
};

export const buildProcPlantInstancedParts = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): ProcPlantInstancedParts => {
  if (genome.spaceColonization) return buildSpaceColonizedProcPlantParts(genome, seed, env);
  if (genome.branchModules) {
    const built = buildBranchModuleGraphTemplate(genome, seed, env);
    return {
      stems: built.template,
      instances: [],
      graph: built.graph,
      stats: {
        ...built.stats,
        stemTriangles: built.template.idx.length / 3,
        instances: 0,
      },
    };
  }
  if (genome.weberPenn) {
    const built = buildWeberPennProcPlantTemplate(genome, seed, env);
    return {
      stems: built.template,
      instances: [],
      graph: built.graph,
      stats: {
        ...built.stats,
        stemTriangles: built.template.idx.length / 3,
        instances: 0,
      },
    };
  }
  const clump = genome.clump;
  if (clump && clump.count > 1) {
    if (authoredProcPlantId(genome) === "daylilyFlower") return buildDaylilyClumpParts(genome, seed, env, clump);
    return buildProcPlantClumpParts(genome, seed, env, clump);
  }
  return buildProcPlantSingleShootParts(genome, seed, env);
};

/** Build one shoot of the procplant-graph backend (leaf/flower/grass organs). */
const buildProcPlantSingleShootParts = (
  genome: ProcPlantGenome,
  seed: number,
  env: ProcPlantEnvironment,
): ProcPlantInstancedParts => {
  const graph = buildProcPlantGraph(genome, seed, env);
  const stemBuilder = new TemplateBuilder();
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const stemColor = new THREE.Color(
    genome.habit === "grass" || genome.habit === "fern" ? 0x3f6d2d : 0x6d5135,
  );
  for (const [ai, bi] of graph.segments) {
    addStemSegment(stemBuilder, graph.stems[ai], graph.stems[bi], stemColor);
  }
  const instances: ProcPlantInstance[] = [];
  let leafCount = 0;
  let flowerCount = 0;
  let accessoryCount = 0;
  for (const organ of graph.organs) {
    if (organ.kind === "grassBlade") {
      instances.push(grassBladeInstance(genome, organ));
      leafCount++;
    } else if (organ.kind === "coniferSpray") {
      instances.push(coniferSprayInstance(genome, organ));
      leafCount++;
    } else if (organ.kind === "palmFrond") {
      instances.push(palmFrondInstance(genome, organ));
      leafCount++;
    } else if (organ.kind === "mossTuft") {
      instances.push(mossTuftInstance(genome, organ));
      leafCount++;
    } else if (organ.kind === "flower") {
      const petals = flowerInstances(genome, organ);
      instances.push(...petals);
      flowerCount++;
    } else if (isAccessoryOrganKind(organ.kind)) {
      instances.push(accessoryInstance(organ));
      accessoryCount++;
    } else {
      instances.push(leafInstance(genome, organ, shade));
      leafCount++;
    }
  }
  const stems = stemBuilder.build();
  return {
    stems,
    instances,
    graph,
    stats: {
      stems: graph.segments.length,
      leaves: leafCount,
      flowers: flowerCount,
      ...(accessoryCount > 0 ? { accessories: accessoryCount } : {}),
      stemTriangles: stems.idx.length / 3,
      instances: instances.length,
      triangles: stems.idx.length / 3 + instances.length,
    },
  };
};

const buildDaylilyClumpParts = (
  genome: ProcPlantGenome,
  seed: number,
  env: ProcPlantEnvironment,
  clump: NonNullable<ProcPlantGenome["clump"]>,
): ProcPlantInstancedParts => {
  const crownCount = Math.max(1, Math.min(36, Math.round(clump.count)));
  const radius = Math.max(0.02, clump.radius);
  const jitter = THREE.MathUtils.clamp(clump.jitter ?? 0.55, 0, 1);
  const scaleVar = THREE.MathUtils.clamp(clump.scaleVar ?? 0.24, 0, 1);
  const lean = THREE.MathUtils.clamp(clump.lean ?? 0.42, 0, 1.4);
  const flowerDensity = THREE.MathUtils.clamp(clump.flowerDensity ?? 0.32, 0, 1.5);
  const rng = rngFromSeed((seed ^ 0x9e3779b9) >>> 0);
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const instances: ProcPlantInstance[] = [];
  const stemBuilder = new TemplateBuilder();
  const stemColor = new THREE.Color(0x6d5135);

  const crownPositions: THREE.Vector3[] = [];
  for (let c = 0; c < crownCount; c++) {
    const ringT = crownCount > 1 ? c / (crownCount - 1) : 0;
    const angle = c * GOLDEN_ANGLE + (rng() - 0.5) * jitter * 1.2;
    const spread = c === 0 ? 0 : radius * (0.25 + Math.sqrt(ringT) * 0.75) * (1 + (rng() - 0.5) * jitter * 0.45);
    const crown = new THREE.Vector3(Math.cos(angle) * spread, 0, Math.sin(angle) * spread);
    crownPositions.push(crown);
    const crownScale = 1 + (rng() - 0.5) * scaleVar;
    const leafCount = Math.max(8, Math.round(10 + env.moisture * 4 + rng() * 4));
    for (let i = 0; i < leafCount; i++) {
      const t = i / Math.max(1, leafCount - 1);
      const yaw = resolveProcPlantPhyllotaxy(genome, i).azimuth + angle * 0.37 + (rng() - 0.5) * 0.35;
      const radial = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const outward = crown.lengthSq() > 0.0001 ? crown.clone().normalize() : radial;
      const dir = UP.clone()
        .add(radial.clone().multiplyScalar(0.34 + rng() * 0.24))
        .add(outward.multiplyScalar(lean * (0.22 + ringT * 0.32)))
        .normalize();
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
      const organ: Organ = {
        kind: "grassBlade",
        position: crown.clone().add(radial.clone().multiplyScalar((rng() - 0.5) * 0.05)),
        direction: dir,
        right,
        scale:
          curve(genome.leaf.length, t) *
          crownScale *
          (1 + shade * genome.lightResponse.leafBoostInShade * 0.28) *
          (0.76 + rng() * 0.24),
        t,
      };
      instances.push(grassBladeInstance(genome, organ));
    }
  }

  const scapeCount = Math.max(1, Math.min(18, Math.round(crownCount * flowerDensity)));
  for (let s = 0; s < scapeCount; s++) {
    const crown = crownPositions[Math.floor(rng() * crownPositions.length)]?.clone() ?? new THREE.Vector3();
    const heightScale = 0.78 + rng() * 0.38;
    const bend = new THREE.Vector3((rng() - 0.5) * 0.08, 0, (rng() - 0.5) * 0.08);
    const nodes = Math.max(4, Math.round(genome.nodeCount * (0.72 + rng() * 0.22)));
    let previous: StemNode = {
      position: crown.clone(),
      direction: UP.clone(),
      radius: 0.018 * heightScale,
      depth: 0,
      t: 0,
      index: 0,
    };
    for (let i = 1; i <= nodes; i++) {
      const t = i / nodes;
      const direction = UP.clone()
        .add(bend.clone().multiplyScalar(t))
        .add(new THREE.Vector3((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.02))
        .normalize();
      const node: StemNode = {
        position: previous.position.clone().add(direction.clone().multiplyScalar(curve(genome.internode, t) * heightScale)),
        direction,
        radius: previous.radius * THREE.MathUtils.lerp(0.92, 0.72, t),
        depth: 0,
        t,
        index: i,
      };
      addStemSegment(stemBuilder, previous, node, stemColor);
      previous = node;
    }
    const basis = tangentBasis(previous.direction);
    const flowerOrgan: Organ = {
      kind: "flower",
      position: previous.position.clone().add(previous.direction.clone().multiplyScalar(0.04)),
      direction: previous.direction.clone(),
      right: basis.right,
      scale: 0.86 + rng() * 0.26,
      t: 1,
    };
    instances.push(...flowerInstances(genome, flowerOrgan));
  }

  const stems = stemBuilder.build();
  return {
    stems,
    instances,
    graph: { stems: [], segments: [], organs: [], segmentRecords: [], attachments: [] },
    stats: {
      stems: scapeCount * Math.max(1, genome.nodeCount - 1),
      leaves: instances.filter((inst) => inst.kind === "grassBlade").length,
      flowers: scapeCount,
      stemTriangles: stems.idx.length / 3,
      instances: instances.length,
      triangles: stems.idx.length / 3 + instances.length,
    },
  };
};

/**
 * Build a clump: several offset shoots of the same genome merged into one part
 * set. Each shoot gets its own seed, a golden-angle placement inside the clump
 * radius, slight scale variation, and an outward lean so the mound arches.
 */
const buildProcPlantClumpParts = (
  genome: ProcPlantGenome,
  seed: number,
  env: ProcPlantEnvironment,
  clump: NonNullable<ProcPlantGenome["clump"]>,
): ProcPlantInstancedParts => {
  const count = Math.max(1, Math.min(24, Math.round(clump.count)));
  const radius = Math.max(0, clump.radius);
  const jitter = THREE.MathUtils.clamp(clump.jitter ?? 0.4, 0, 1);
  const scaleVar = THREE.MathUtils.clamp(clump.scaleVar ?? 0.25, 0, 1);
  const lean = clump.lean ?? 0.18;
  const rng = rngFromSeed((seed ^ 0x27d4eb2f) >>> 0);

  let mergedStems: ProcPlantTemplate | null = null;
  const instances: ProcPlantInstance[] = [];
  const graphStems: StemNode[] = [];
  const graphSegments: Array<[number, number]> = [];
  const graphOrgans: Organ[] = [];
  let leaves = 0;
  let flowers = 0;
  let accessories = 0;
  let stemTriangles = 0;

  for (let i = 0; i < count; i++) {
    const shoot = buildProcPlantSingleShootParts(genome, (seed + i * 2749) >>> 0, env);

    // Placement: first shoot at center, rest spiralled out via golden angle.
    const ringT = count > 1 ? i / (count - 1) : 0;
    const spread = i === 0 ? 0 : radius * (0.35 + ringT * 0.65);
    const angle = i * GOLDEN_ANGLE + (rng() - 0.5) * jitter * 1.4;
    const jitterR = spread * (1 + (rng() - 0.5) * jitter);
    const ox = Math.cos(angle) * jitterR;
    const oz = Math.sin(angle) * jitterR;

    const shootScale = 1 + (rng() - 0.5) * scaleVar;
    // Peripheral shoots lean away from clump center for an arching mound.
    const leanAxis = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const leanQuat = new THREE.Quaternion().setFromAxisAngle(leanAxis, lean * ringT);
    const spinQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0));
    const quat = leanQuat.multiply(spinQuat);

    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(ox, 0, oz),
      quat,
      new THREE.Vector3(shootScale, shootScale, shootScale),
    );

    const transformedStems = transformTemplate(shoot.stems, matrix);
    mergedStems = mergedStems ? combineTemplates(mergedStems, transformedStems) : transformedStems;

    const graphNodeOffset = graphStems.length;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    for (const stem of shoot.graph.stems) {
      graphStems.push({
        ...stem,
        index: graphNodeOffset + stem.index,
        position: stem.position.clone().applyMatrix4(matrix),
        direction: stem.direction.clone().applyMatrix3(normalMatrix).normalize(),
        radius: stem.radius * shootScale,
      });
    }
    for (const [start, end] of shoot.graph.segments) {
      graphSegments.push([graphNodeOffset + start, graphNodeOffset + end]);
    }
    for (const organ of shoot.graph.organs) {
      graphOrgans.push({
        ...organ,
        position: organ.position.clone().applyMatrix4(matrix),
        direction: organ.direction.clone().applyMatrix3(normalMatrix).normalize(),
        right: organ.right.clone().applyMatrix3(normalMatrix).normalize(),
        scale: organ.scale * shootScale,
      });
    }

    for (const inst of shoot.instances) {
      instances.push({
        kind: inst.kind,
        matrix: matrix.clone().multiply(inst.matrix),
        color: inst.color.clone(),
        sway: inst.sway,
      });
    }

    leaves += shoot.stats.leaves;
    flowers += shoot.stats.flowers;
    accessories += shoot.stats.accessories ?? 0;
    stemTriangles += shoot.stats.stemTriangles;
  }

  const stems = mergedStems ?? buildProcPlantSingleShootParts(genome, seed, env).stems;
  const mergedGraph = buildProcPlantGraphIr(graphStems, graphSegments, graphOrgans);
  return {
    stems,
    instances,
    graph: mergedGraph,
    stats: {
      stems: mergedGraph.segments.length,
      leaves,
      flowers,
      ...(accessories > 0 ? { accessories } : {}),
      stemTriangles,
      instances: instances.length,
      triangles: stemTriangles + instances.length,
    },
  };
};

export const createProcPlantLeafGeometry = (
  shape: LeafShapeKind,
  widthRatio: number,
  serration = 0,
  curl = 0,
  venation = 0.5,
): THREE.BufferGeometry => {
  const surface = createLeafSurfaceData(shape, widthRatio, serration, curl, venation);
  const positions = surface.positions.flatMap((point) => [point.x, point.y, point.z]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(surface.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.procPlantLeafSurface = {
    rowCount: surface.rowCount,
    petioleRatio: surface.petioleRatio,
    triangleCount: surface.indices.length / 3,
  };
  return geometry;
};

export const createProcPlantGrassBladeGeometry = (widthRatio: number, curl = 0): THREE.BufferGeometry => {
  const width = widthRatio;
  const positions = new Float32Array([
    -width, 0, 0,
    width, 0, 0,
    width * 0.42, 0.54, 0,
    -width, 0, 0,
    width * 0.42, 0.54, 0,
    0, 1, -curl * 0.18,
  ]);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) normals[i + 2] = 1;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

/** Six-triangle crossed tuft for moss mats and hanging strands. */
export const createProcPlantMossTuftGeometry = (): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < 3; blade++) {
    const angle = blade * Math.PI / 3;
    const across = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(0.16 + blade * 0.025);
    const forward = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const base = positions.length / 3;
    const center = forward.multiplyScalar((blade - 1) * 0.035);
    const points = [
      center.clone().sub(across),
      center.clone().add(across),
      center.clone().add(across.clone().multiplyScalar(0.34)).add(new THREE.Vector3(0, 0.52 + blade * 0.08, 0)),
      center.clone().add(new THREE.Vector3(0, 0.88 + blade * 0.06, (blade - 1) * 0.035)),
    ];
    for (const point of points) positions.push(point.x, point.y, point.z);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const createProcPlantFacetedGeometry = (positions: number[], indices: number[]): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

/** A 24-triangle strawberry-like aggregate fruit, oriented from its attachment along +Y. */
export const createProcPlantFruitGeometry = (): THREE.BufferGeometry => {
  const positions = [0, 0, 0];
  const sides = 6;
  for (let i = 0; i < sides; i++) {
    const angle = i * Math.PI * 2 / sides;
    positions.push(Math.cos(angle) * 0.32, 0.16, Math.sin(angle) * 0.32);
  }
  for (let i = 0; i < sides; i++) {
    const angle = i * Math.PI * 2 / sides;
    positions.push(Math.cos(angle) * 0.5, 0.58, Math.sin(angle) * 0.5);
  }
  positions.push(0, 1.08, 0);
  const indices: number[] = [];
  const tip = 1 + sides * 2;
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    const upper = 1 + i;
    const upperNext = 1 + next;
    const lower = 1 + sides + i;
    const lowerNext = 1 + sides + next;
    indices.push(0, upperNext, upper, upper, upperNext, lowerNext, upper, lowerNext, lower, lower, lowerNext, tip);
  }
  return createProcPlantFacetedGeometry(positions, indices);
};

/** Eight-triangle berry primitive, oriented from its pedicel along +Y. */
export const createProcPlantBerryGeometry = (): THREE.BufferGeometry =>
  createProcPlantFacetedGeometry(
    [
      0, 0, 0,
      0.48, 0.5, 0,
      0, 0.5, 0.48,
      -0.48, 0.5, 0,
      0, 0.5, -0.48,
      0, 1, 0,
    ],
    [0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1],
  );

/** A 24-triangle tapered cone primitive with a broad, faceted scale silhouette. */
export const createProcPlantConeGeometry = (): THREE.BufferGeometry => {
  const positions = [0, 0, 0];
  const sides = 6;
  for (let i = 0; i < sides; i++) {
    const angle = i * Math.PI * 2 / sides;
    positions.push(Math.cos(angle) * 0.2, 0.08, Math.sin(angle) * 0.2);
  }
  for (let i = 0; i < sides; i++) {
    const angle = (i + 0.5) * Math.PI * 2 / sides;
    positions.push(Math.cos(angle) * 0.46, 0.58, Math.sin(angle) * 0.46);
  }
  positions.push(0, 1.08, 0);
  const indices: number[] = [];
  const tip = 1 + sides * 2;
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    const base = 1 + i;
    const baseNext = 1 + next;
    const middle = 1 + sides + i;
    const middleNext = 1 + sides + next;
    indices.push(0, baseNext, base, base, baseNext, middleNext, base, middleNext, middle, middle, middleNext, tip);
  }
  return createProcPlantFacetedGeometry(positions, indices);
};

/** Four-triangle thorn primitive. */
export const createProcPlantThornGeometry = (): THREE.BufferGeometry =>
  createProcPlantFacetedGeometry(
    [-0.28, 0, -0.16, 0.28, 0, -0.16, 0, 0, 0.32, 0, 1, 0],
    [0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0],
  );

/** Eight-triangle tapered aerial-root prism. */
export const createProcPlantAerialRootGeometry = (): THREE.BufferGeometry =>
  createProcPlantFacetedGeometry(
    [-0.08, 0, -0.045, 0.08, 0, -0.045, 0, 0, 0.09, -0.024, 1, -0.014, 0.024, 1, -0.014, 0, 1, 0.028],
    [0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5],
  );

export const createProcPlantConiferSprayGeometry = (detail: "full" | "light" = "full"): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const addQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    const base = positions.length / 3;
    const normal = new THREE.Vector3().subVectors(d, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const p of [a, d, c, b]) {
      positions.push(p.x, p.y, p.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const addNeedlePlate = (
    width: number,
    length: number,
    yOffset: number,
    xOffset: number,
    zOffset: number,
    lean: number,
    ridge: number,
    droop: number,
  ) => {
    const rows = detail === "light" ? 1 : 2;
    const left: THREE.Vector3[] = [];
    const center: THREE.Vector3[] = [];
    const right: THREE.Vector3[] = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const y = yOffset + t * length;
      const widthNow = Math.max(0.004, width * Math.sin(Math.PI * Math.min(1, t * 0.94 + 0.03)) * (1 - t * 0.56));
      const sweep = (t - 0.4) * lean;
      const edgeSag = -(zOffset - t * t * droop);
      const centerRise = -(zOffset + Math.sin(t * Math.PI) * ridge - t * t * droop);
      left.push(new THREE.Vector3(xOffset + sweep - widthNow, y, edgeSag));
      center.push(new THREE.Vector3(xOffset + sweep, y, centerRise));
      right.push(new THREE.Vector3(xOffset + sweep + widthNow, y, edgeSag));
    }
    for (let i = 0; i < rows; i++) {
      addQuad(left[i], center[i], center[i + 1], left[i + 1]);
      addQuad(center[i], right[i], right[i + 1], center[i + 1]);
    }
  };

  addNeedlePlate(0.085, 1.02, 0, 0, 0, 0.02, 0.035, 0.11);
  addNeedlePlate(0.06, 0.82, 0.08, -0.075, -0.022, -0.035, 0.025, 0.12);
  addNeedlePlate(0.06, 0.82, 0.12, 0.08, -0.026, 0.04, 0.025, 0.12);
  if (detail === "full") {
    addNeedlePlate(0.045, 0.62, 0.22, -0.12, -0.042, -0.035, 0.018, 0.1);
    addNeedlePlate(0.045, 0.62, 0.26, 0.13, -0.048, 0.035, 0.018, 0.1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
};

export const createProcPlantPalmFrondGeometry = (): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const addQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    const base = positions.length / 3;
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const p of [a, b, c, d]) {
      positions.push(p.x, p.y, p.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const cuts = 13;
  for (let i = 0; i < cuts; i++) {
    const y0 = i / cuts + 0.006;
    const y1 = (i + 0.76) / cuts;
    const sag0 = -(y0 * y0) * 0.16;
    const sag1 = -(y1 * y1) * 0.16;
    const m0 = Math.sin(Math.PI * y0);
    const m1 = Math.sin(Math.PI * Math.min(1, y1));
    const w0 = m0 ** 0.62 * 0.42;
    const w1 = m1 ** 0.62 * 0.42;
    const fold0 = (i % 2 === 0 ? 1 : -1) * 0.035;
    const fold1 = -fold0;
    addQuad(
      new THREE.Vector3(0, y0, sag0),
      new THREE.Vector3(-w0, y0, fold0 + sag0),
      new THREE.Vector3(-w1, y1, fold1 + sag1),
      new THREE.Vector3(0, y1, sag1),
    );
    addQuad(
      new THREE.Vector3(0, y0, sag0),
      new THREE.Vector3(0, y1, sag1),
      new THREE.Vector3(w1, y1, -fold1 + sag1),
      new THREE.Vector3(w0, y0, -fold0 + sag0),
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
};

const addTransformedGeometry = (
  builder: TemplateBuilder,
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  color: THREE.Color,
  sway = 1,
) => {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = source.getAttribute("position");
  const sourceUv0 = source.getAttribute("uv");
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    const a = p.fromBufferAttribute(pos, i).clone().applyMatrix4(matrix);
    const b = p.fromBufferAttribute(pos, i + 1).clone().applyMatrix4(matrix);
    const c = p.fromBufferAttribute(pos, i + 2).clone().applyMatrix4(matrix);
    const uv0 = sourceUv0 && sourceUv0.count === pos.count
      ? [
          [sourceUv0.getX(i), sourceUv0.getY(i)],
          [sourceUv0.getX(i + 1), sourceUv0.getY(i + 1)],
          [sourceUv0.getX(i + 2), sourceUv0.getY(i + 2)],
        ] as const
      : undefined;
    builder.addTriangle(a, b, c, color, true, sway, uv0);
  }
  if (source !== geometry) source.dispose();
};

const combineTemplates = (base: ProcPlantTemplate, extra: ProcPlantTemplate): ProcPlantTemplate => {
  if (extra.idx.length === 0) return base;
  if (base.idx.length === 0) return extra;
  const baseVerts = base.pos.length / 3;
  const pos = new Float32Array(base.pos.length + extra.pos.length);
  const nrm = new Float32Array(base.nrm.length + extra.nrm.length);
  const uv0 = new Float32Array(base.uv0.length + extra.uv0.length);
  const col = new Float32Array(base.col.length + extra.col.length);
  const tintable = new Uint8Array(base.tintable.length + extra.tintable.length);
  const sway = new Float32Array(base.sway.length + extra.sway.length);
  const idx = new Uint32Array(base.idx.length + extra.idx.length);
  pos.set(base.pos);
  pos.set(extra.pos, base.pos.length);
  nrm.set(base.nrm);
  nrm.set(extra.nrm, base.nrm.length);
  uv0.set(base.uv0);
  uv0.set(extra.uv0, base.uv0.length);
  col.set(base.col);
  col.set(extra.col, base.col.length);
  tintable.set(base.tintable);
  tintable.set(extra.tintable, base.tintable.length);
  sway.set(base.sway);
  sway.set(extra.sway, base.sway.length);
  idx.set(base.idx);
  for (let i = 0; i < extra.idx.length; i++) idx[base.idx.length + i] = extra.idx[i] + baseVerts;
  return { pos, nrm, uv0, col, tintable, sway, idx };
};

const cloneTemplate = (template: ProcPlantTemplate): ProcPlantTemplate => ({
  pos: template.pos.slice(),
  nrm: template.nrm.slice(),
  uv0: template.uv0.slice(),
  col: template.col.slice(),
  tintable: template.tintable.slice(),
  sway: template.sway.slice(),
  idx: template.idx.slice(),
});

const emptyGraph = (): ProcPlantGraph => ({ stems: [], segments: [], organs: [], segmentRecords: [], attachments: [] });

/** Apply a world matrix to every vertex of a template (positions + normals). */
const transformTemplate = (template: ProcPlantTemplate, matrix: THREE.Matrix4): ProcPlantTemplate => {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const pos = new Float32Array(template.pos.length);
  const nrm = new Float32Array(template.nrm.length);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < template.pos.length; i += 3) {
    p.set(template.pos[i]!, template.pos[i + 1]!, template.pos[i + 2]!).applyMatrix4(matrix);
    n.set(template.nrm[i]!, template.nrm[i + 1]!, template.nrm[i + 2]!).applyMatrix3(normalMatrix).normalize();
    pos[i] = p.x; pos[i + 1] = p.y; pos[i + 2] = p.z;
    nrm[i] = n.x; nrm[i + 1] = n.y; nrm[i + 2] = n.z;
  }
  return {
    pos,
    nrm,
    uv0: template.uv0.slice(),
    col: template.col.slice(),
    tintable: template.tintable.slice(),
    sway: template.sway.slice(),
    idx: template.idx.slice(),
  };
};

interface WeberPennFoliageAnchor {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  right: THREE.Vector3;
  kind: "leaf-site" | "branch-tip";
  t: number;
}

const geometryFromWeberPennLeafShape = (genome: ProcPlantGenome): THREE.BufferGeometry => {
  const species = genome.weberPenn?.species;
  const shape = getLeafShape(species ? SPECIES[species]?.leafShape ?? 0 : 0);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const vertex of shape.vertices) {
    positions.push(vertex[0], vertex[1], vertex[2]);
    normals.push(0, 1, 0);
  }
  for (const face of shape.faces) {
    if (face.length === 3) {
      indices.push(face[0]!, face[1]!, face[2]!);
    } else {
      for (let i = 1; i < face.length - 1; i++) {
        indices.push(face[0]!, face[i]!, face[i + 1]!);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
};

const createWeberPennEzLeafCardGeometry = (): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const addCard = (rotation: number) => {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-0.26, 0.18, 0),
      new THREE.Vector3(-0.46, 0.46, 0),
      new THREE.Vector3(-0.34, 0.74, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0.34, 0.74, 0),
      new THREE.Vector3(0.46, 0.46, 0),
      new THREE.Vector3(0.26, 0.18, 0),
    ].map((p) => new THREE.Vector3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c));
    const normal = new THREE.Vector3(s, 0, c).normalize();
    const base = positions.length / 3;
    positions.push(0, 0.42, 0);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(0.5, 0.58);
    for (const point of points) {
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(point.x + 0.5, 1 - point.y);
    }
    for (let i = 1; i <= points.length; i++) {
      const next = i === points.length ? 1 : i + 1;
      indices.push(base, base + i, base + next);
    }
  };
  addCard(0);
  addCard(Math.PI / 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
};

const createWeberPennFoliageGeometry = (genome: ProcPlantGenome, conifer: boolean): THREE.BufferGeometry => {
  const source = genome.weberPenn?.foliageSource ?? "species";
  if (source === "conifer-spray") return createProcPlantConiferSprayGeometry("light");
  if (source === "ez-leaf-card") return createWeberPennEzLeafCardGeometry();
  if (source === "procplants") {
    return createProcPlantLeafGeometry(
      genome.leaf.shape,
      genome.leaf.widthRatio,
      genome.leaf.serration,
      genome.leaf.curl,
      genome.leaf.venation,
    );
  }
  if (conifer && source !== "species") return createProcPlantConiferSprayGeometry("light");
  return geometryFromWeberPennLeafShape(genome);
};

const isWeberPennCrownFillEnabled = (genome: ProcPlantGenome): boolean => {
  const options = genome.weberPenn;
  if (!options) return false;
  if (options.crownFill !== undefined) return options.crownFill;
  return Boolean(options.foliageSource && options.foliageSource !== "species");
};

const isWeberPennConifer = (genome: ProcPlantGenome) => {
  const species = genome.weberPenn?.species.toLowerCase() ?? "";
  return (
    genome.habit === "conifer" ||
    species.includes("fir") ||
    species.includes("pine") ||
    species.includes("spruce") ||
    species.includes("redwood") ||
    species.includes("larch")
  );
};

const hashUnit = (value: number) => {
  const raw = Math.sin(value * 12.9898) * 43758.5453123;
  return raw - Math.floor(raw);
};

const treeRealismTraits = (genome: ProcPlantGenome) => {
  const conifer = isWeberPennConifer(genome);
  return {
    crownSpread: genome.treeRealism?.crownSpread ?? (conifer ? 0.36 : 0.62),
    crownTaper: genome.treeRealism?.crownTaper ?? (conifer ? 0.82 : 0.36),
    trunkFlare: genome.treeRealism?.trunkFlare ?? 0.34,
    trunkBend: genome.treeRealism?.trunkBend ?? (conifer ? 0.1 : 0.16),
    branchGnarl: genome.treeRealism?.branchGnarl ?? (conifer ? 0.16 : 0.26),
    windFlex: genome.treeRealism?.windFlex ?? (conifer ? 0.52 : 0.48),
    colorVariance: genome.treeRealism?.colorVariance ?? 0.14,
  };
};

const weberPennBakeOptions = (genome: ProcPlantGenome): BakeOptions => {
  const options = genome.weberPenn;
  return {
    radialSegments: options?.radialSegments ?? 5,
    branchSamples: options?.branchSamples ?? 3,
    branchCaps: false,
    maxBranchDepth: options?.maxBranchDepth ?? 3,
    maxStems: options?.maxStems ?? 120,
    maxLeaves: options?.maxLeaves ?? 240,
    leafScaleMultiplier: options?.leafScaleMultiplier ?? 2,
    blossomScaleMultiplier: options?.blossomScaleMultiplier ?? options?.leafScaleMultiplier ?? 2,
  };
};

const addWeberPennFoliageMass = (
  builder: TemplateBuilder,
  genome: ProcPlantGenome,
  seed: number,
  env: ProcPlantEnvironment,
  source: ProcPlantTemplate,
  branchVerts: number,
  fillAnchors: WeberPennFoliageAnchor[] = [],
) => {
  if (!isWeberPennCrownFillEnabled(genome)) return 0;
  const leafVerts = source.pos.length / 3 - branchVerts;
  if (leafVerts <= 0 && fillAnchors.length === 0) return 0;
  const rng = rngFromSeed(seed ^ 0x5f3759df);
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const conifer = isWeberPennConifer(genome);
  const foliage = {
    mass: Math.max(0, genome.foliage?.mass ?? 0),
    clusterDensity: genome.foliage?.clusterDensity ?? 1,
    whorlDensity: genome.foliage?.whorlDensity ?? (conifer ? 0.64 : 0.42),
    tipBias: genome.foliage?.tipBias ?? 0.5,
    size: genome.foliage?.size ?? (conifer ? 0.34 : 0.56),
  };
  const budgetBase = conifer ? 128 : 180;
  const budget = Math.round(
    THREE.MathUtils.clamp(
      budgetBase * foliage.mass * foliage.clusterDensity * (0.72 + env.moisture * 0.36),
      0,
      conifer ? 320 : 520,
    ),
  );
  if (budget <= 0) return 0;
  const spread = THREE.MathUtils.clamp(foliage.whorlDensity, 0, 1.6);
  const fillSize = THREE.MathUtils.clamp(foliage.size, 0.05, 1.5);
  const sourceMode = genome.weberPenn?.foliageSource ?? "species";
  const sprayGeometry = createWeberPennFoliageGeometry(genome, conifer);
  const useAttachmentAnchors = fillAnchors.length > 0 && sourceMode !== "species";
  let added = 0;
  for (let i = 0; i < budget; i++) {
    const anchor = useAttachmentAnchors
      ? fillAnchors[Math.floor(rng() * fillAnchors.length)]!
      : undefined;
    const vi = anchor ? 0 : branchVerts + Math.floor(rng() * leafVerts);
    const o = vi * 3;
    const t = anchor?.t ?? THREE.MathUtils.clamp(source.pos[o + 1] ?? 0, 0, 1);
    const tipBoost = THREE.MathUtils.lerp(1, t, foliage.tipBias);
    const acceptBias = conifer ? 0.82 : 0.72;
    if (rng() > acceptBias + tipBoost * 0.3 + foliage.mass * 0.08) continue;
    const position = anchor
      ? anchor.position.clone()
      : new THREE.Vector3(source.pos[o] ?? 0, source.pos[o + 1] ?? 0, source.pos[o + 2] ?? 0);
    const radial = new THREE.Vector3(position.x, 0, position.z);
    if (radial.lengthSq() < 0.0001) radial.set(Math.cos(i), 0, Math.sin(i));
    radial.normalize();
    const yaw = rng() * Math.PI * 2;
    const branchDirection = anchor?.direction.clone().normalize();
    const ezLeafCard = sourceMode === "ez-leaf-card";
    const supportDirection = branchDirection ?? radial;
    const frame = branchRelativeFoliageFrame(
      supportDirection,
      yaw,
      conifer && !ezLeafCard ? 0.42 + spread * 0.12 : 0.8 + spread * 0.16,
      conifer && !ezLeafCard ? -0.12 - t * 0.08 : ezLeafCard ? 0.22 : 0.38,
      anchor?.right,
    );
    const { direction, right } = frame;
    const sourceLength = curve(genome.leaf.length, t);
    const sizeBase = conifer && !ezLeafCard ? 0.32 + fillSize * 0.6 : ezLeafCard ? 0.28 + fillSize * 0.78 : 0.34 + fillSize * 0.55;
    const sourceDamping = sourceMode === "conifer-spray" ? 0.82 : sourceMode === "procplants" ? 0.9 : ezLeafCard ? 0.72 : 1;
    const scale =
      sourceLength *
      sizeBase *
      sourceDamping *
      (0.78 + rng() * 0.34) *
      (1 + shade * genome.lightResponse.leafBoostInShade * 0.25);
    const color = new THREE.Color(genome.leaf.colorA).lerp(
      new THREE.Color(genome.leaf.colorB),
      conifer ? 0.35 + t * 0.45 : t,
    );
    if (ezLeafCard) color.lerp(new THREE.Color(0xffffff), 0.18);
    const normal = new THREE.Vector3().crossVectors(right, direction).normalize().negate();
    const anchorJitter = useAttachmentAnchors ? 0.006 + spread * 0.025 : 0.025 + spread * 0.09;
    const jitteredPosition = position
      .add(frame.radial.multiplyScalar((rng() - 0.5) * anchorJitter))
      .add(new THREE.Vector3(0, (rng() - 0.5) * spread * (useAttachmentAnchors ? 0.012 : 0.035), 0));
    const matrix = instanceMatrixFromFrame(
      jitteredPosition,
      right,
      direction,
      normal,
      new THREE.Vector3(scale, scale, scale),
    );
    addTransformedGeometry(builder, sprayGeometry, matrix, color, 0.38 + t * 0.58);
    added++;
  }
  sprayGeometry.dispose();
  return added;
};

interface BranchModuleAnchor {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  right: THREE.Vector3;
  t: number;
  depth: number;
  nodeIndex: number;
}

const branchModuleDefaults = (genome: ProcPlantGenome) => {
  const palette = genome.branchModules?.palette ?? "decurrent-broadleaf";
  const conifer = palette === "excurrent-conifer";
  const shrub = palette === "shrub";
  const palm = palette === "palm-ish";
  const vine = palette === "vine-ish";
  return {
    palette,
    levels: genome.branchModules?.levels ?? (palm ? 1 : vine ? 4 : shrub ? 3 : 4),
    moduleBudget: genome.branchModules?.moduleBudget ?? (conifer ? 120 : shrub ? 96 : palm ? 34 : 140),
    vigor: genome.branchModules?.vigor ?? 1,
    branchDensity: genome.branchModules?.branchDensity ?? (conifer ? 1.05 : shrub ? 1.25 : palm ? 0.4 : vine ? 0.72 : 1.35),
    branchAngle: genome.branchModules?.branchAngle ?? (conifer ? 0.82 : shrub ? 1.08 : vine ? 0.55 : 1.18),
    spread: genome.branchModules?.spread ?? (conifer ? 0.58 : shrub ? 1.12 : palm ? 1.35 : 1.08),
    droop: genome.branchModules?.droop ?? (palette === "weeping" ? 1.1 : conifer ? 0.32 : vine ? 0.7 : 0.18),
    tropism: genome.branchModules?.tropism ?? (conifer ? 0.72 : vine ? 0.34 : 0.48),
    gnarliness: genome.branchModules?.gnarliness ?? (palette === "decurrent-broadleaf" ? 0.38 : palette === "weeping" ? 0.32 : conifer ? 0.16 : 0.24),
    collisionBias: genome.branchModules?.collisionBias ?? 0.45,
    junctionBlend: genome.branchModules?.junctionBlend ?? (palette === "decurrent-broadleaf" || palette === "weeping" ? 0.58 : 0.24),
    foliageSource: genome.branchModules?.foliageSource ?? (conifer ? "conifer-spray" : "procplants"),
    barkColor: genome.branchModules?.barkColor ?? 0x5d4327,
    leafColor: genome.branchModules?.leafColor ?? genome.leaf.colorA,
  };
};

const branchModuleStemRadius = (base: number, depth: number, t: number, vigor: number) =>
  Math.max(0.003, base * Math.pow(0.58, depth) * THREE.MathUtils.lerp(1.08, 0.24, t) * (0.72 + vigor * 0.28));

const addBranchModuleFoliage = (
  builder: TemplateBuilder,
  genome: ProcPlantGenome,
  seed: number,
  env: ProcPlantEnvironment,
  anchors: BranchModuleAnchor[],
) => {
  const options = branchModuleDefaults(genome);
  const rng = rngFromSeed(seed ^ 0x6d2b79f5);
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const foliage = {
    mass: Math.max(0, genome.foliage?.mass ?? 0.74),
    clusterDensity: genome.foliage?.clusterDensity ?? 1.12,
    whorlDensity: genome.foliage?.whorlDensity ?? 0.58,
    tipBias: genome.foliage?.tipBias ?? 0.58,
    size: genome.foliage?.size ?? 0.48,
  };
  const source = options.foliageSource === "ez-leaf-card" ? "procplants" : options.foliageSource;
  const geometry = source === "conifer-spray"
    ? createProcPlantConiferSprayGeometry("light")
    : createProcPlantLeafGeometry(
      genome.leaf.shape,
      genome.leaf.widthRatio,
      genome.leaf.serration,
      genome.leaf.curl,
      genome.leaf.venation,
    );
  let leaves = 0;
  const budget = Math.round(THREE.MathUtils.clamp(anchors.length * foliage.mass * foliage.clusterDensity * 2.8, 0, 760));
  for (let i = 0; i < budget; i++) {
    const anchor = anchors[Math.floor(Math.pow(rng(), 1.0 + foliage.tipBias) * anchors.length)];
    if (!anchor) continue;
    const t = anchor.t;
    const whorlCount = source === "conifer-spray" ? 2 : Math.max(1, Math.round(1 + foliage.whorlDensity * 2));
    for (let whorl = 0; whorl < whorlCount; whorl++) {
      if (rng() > 0.62 + foliage.mass * 0.12 + t * foliage.tipBias * 0.18) continue;
      const yaw = rng() * Math.PI * 2 + (whorl / whorlCount) * Math.PI * 2;
      const frame = branchRelativeFoliageFrame(
        anchor.direction,
        yaw,
        source === "conifer-spray" ? 0.46 : 0.92,
        source === "conifer-spray" ? -0.14 : 0.32,
        anchor.right,
      );
      const { direction, right } = frame;
      const normal = new THREE.Vector3().crossVectors(right, direction).normalize().negate();
      const scale =
        curve(genome.leaf.length, t) *
        foliage.size *
        (source === "conifer-spray" ? 0.72 : 1) *
        (0.72 + rng() * 0.38) *
        Math.pow(0.86, Math.max(0, anchor.depth - 1)) *
        (1 + shade * genome.lightResponse.leafBoostInShade * 0.25);
      const color = new THREE.Color(options.leafColor)
        .lerp(new THREE.Color(genome.leaf.colorB), source === "conifer-spray" ? 0.36 + t * 0.34 : t * 0.72);
      const matrix = instanceMatrixFromFrame(
        anchor.position.clone()
          .add(direction.clone().multiplyScalar((rng() - 0.5) * 0.035))
          .add(new THREE.Vector3(0, (rng() - 0.5) * 0.018, 0)),
        right,
        direction,
        normal,
        new THREE.Vector3(scale, scale, scale),
      );
      addTransformedGeometry(builder, geometry, matrix, color, 0.4 + t * 0.58);
      leaves++;
    }
  }
  geometry.dispose();
  return leaves;
};

const buildBranchModuleGraphTemplate = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): { template: ProcPlantTemplate; graph: ProcPlantGraph; stats: ProcPlantStats } => {
  const options = branchModuleDefaults(genome);
  const rng = rngFromSeed(seed ^ 0x4f1bbcdc);
  const builder = new TemplateBuilder();
  const stems: StemNode[] = [];
  const segments: Array<[number, number]> = [];
  const organs: Organ[] = [];
  const anchors: BranchModuleAnchor[] = [];
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const crowding = THREE.MathUtils.clamp(env.crowding, 0, 1);
  const lightVector = new THREE.Vector3(0.22, 1, 0.16).normalize();
  const realism = treeRealismTraits({ ...genome, weberPenn: undefined });
  const barkColor = new THREE.Color(options.barkColor);
  const baseRadius = options.palette === "shrub" ? 0.036 : options.palette === "vine-ish" ? 0.014 : 0.058;
  const trunkCount = options.palette === "shrub" ? 3 : 1;
  const height = THREE.MathUtils.clamp(0.8 + genome.nodeCount * curve(genome.internode, 0.15) * 0.22, 0.85, 2.6);
  const modules: Array<{ node: StemNode; direction: THREE.Vector3; depth: number; length: number; vigor: number; t: number }> = [];

  const addNode = (position: THREE.Vector3, direction: THREE.Vector3, radius: number, depth: number, t: number): StemNode => {
    const node: StemNode = { position, direction, radius, depth, t, index: stems.length };
    stems.push(node);
    return node;
  };

  for (let trunk = 0; trunk < trunkCount; trunk++) {
    const yaw = trunkCount === 1 ? 0 : trunk * GOLDEN_ANGLE + (rng() - 0.5) * 0.32;
    const rootDir = options.palette === "vine-ish"
      ? new THREE.Vector3(Math.cos(yaw) * 0.48, 0.56, Math.sin(yaw) * 0.48).normalize()
      : new THREE.Vector3(Math.cos(yaw) * 0.12, 1, Math.sin(yaw) * 0.12).normalize();
    const root = addNode(
      new THREE.Vector3(Math.cos(yaw) * 0.025 * trunk, 0, Math.sin(yaw) * 0.025 * trunk),
      rootDir,
      baseRadius * (trunkCount === 1 ? 1 : 0.72),
      0,
      0,
    );
    const trunkSegments = options.palette === "palm-ish" ? 7 : options.palette === "shrub" ? 5 : 9;
    let previous = root;
    for (let i = 1; i <= trunkSegments; i++) {
      const t = i / trunkSegments;
      const photo = lightVector.clone().multiplyScalar(options.tropism * shade * t * 0.18);
      const crowdNarrowing = new THREE.Vector3(0, crowding * options.collisionBias * t * 0.18, 0);
      const bend = new THREE.Vector3(Math.cos(seed * 0.013 + trunk) * realism.trunkBend, 0, Math.sin(seed * 0.017 + trunk) * realism.trunkBend)
        .multiplyScalar(t * 0.035);
      const dir = previous.direction.clone().add(photo).add(crowdNarrowing).add(bend).normalize();
      const length = height / trunkSegments * (options.palette === "shrub" ? 0.74 : 1) * (0.92 + rng() * 0.16);
      const node = addNode(
        previous.position.clone().add(dir.clone().multiplyScalar(length)),
        dir,
        branchModuleStemRadius(root.radius, 0, t, options.vigor),
        0,
        t,
      );
      segments.push([previous.index, node.index]);
      previous = node;
      const crownStart = options.palette === "excurrent-conifer" ? 0.12 : options.palette === "palm-ish" ? 0.76 : 0.22;
      if (t > crownStart && options.palette !== "palm-ish") {
        const starterCount = options.palette === "excurrent-conifer"
          ? 1
          : options.palette === "shrub"
            ? Math.max(1, Math.round(options.branchDensity))
            : Math.max(1, Math.round(options.branchDensity * (t < 0.88 ? 1.8 : 1.2)));
        for (let starter = 0; starter < starterCount; starter++) {
          modules.push({
            node,
            direction: dir,
            depth: 1,
            length: length * (options.palette === "excurrent-conifer" ? 1.15 : options.palette === "weeping" ? 1.9 : 1.75),
            vigor: options.vigor * (1 - t * 0.18) * (0.88 + starter * 0.04),
            t,
          });
        }
      }
    }
    if (options.palette === "palm-ish") {
      for (let i = 0; i < 18; i++) {
        const yawPalm = i * GOLDEN_ANGLE;
        const direction = rotateFromAxis(previous.direction, yawPalm, Math.PI / 2.25 + (rng() - 0.5) * 0.28);
        anchors.push({
          position: previous.position.clone().add(direction.clone().multiplyScalar(0.035)),
          direction,
          right: tangentBasis(previous.direction).right.applyAxisAngle(previous.direction, yawPalm).normalize(),
          t: 0.96,
          depth: 1,
          nodeIndex: previous.index,
        });
      }
    }
  }

  let moduleCursor = 0;
  while (moduleCursor < modules.length && segments.length < options.moduleBudget) {
    const module = modules[moduleCursor++]!;
    if (module.depth > options.levels) continue;
    const densityBoost = THREE.MathUtils.clamp(options.branchDensity * module.vigor, 0.2, 3.4);
    const children = options.palette === "excurrent-conifer"
      ? Math.max(1, Math.round((module.depth === 1 ? 3 : 2) * densityBoost))
      : options.palette === "weeping"
        ? Math.max(1, Math.round((module.depth === 1 ? 4 : 2) * densityBoost))
        : options.palette === "vine-ish"
          ? Math.max(1, Math.round(densityBoost * 0.8))
          : Math.max(1, Math.round((module.depth === 1 ? 4 : module.depth === 2 ? 3 : 2) * densityBoost));
    for (let child = 0; child < children && segments.length < options.moduleBudget; child++) {
      const yaw = module.node.index * GOLDEN_ANGLE + child * (Math.PI * 2 / children) + (rng() - 0.5) * genome.branchAngle.spread;
      const depthT = module.depth / Math.max(1, options.levels);
      const baseAngle =
        options.palette === "excurrent-conifer" ? Math.PI / 2.05 + depthT * 0.38 :
        options.palette === "weeping" ? Math.PI / 2.2 :
        options.palette === "vine-ish" ? Math.PI / 3.8 :
        Math.PI / 2.65;
      const direction = rotateFromAxis(module.direction, yaw, baseAngle * options.branchAngle * options.spread)
        .add(lightVector.clone().multiplyScalar(options.tropism * shade * 0.12))
        .add(new THREE.Vector3(0, -options.droop * (0.12 + depthT * 0.18), 0))
        .add(new THREE.Vector3(0, crowding * options.collisionBias * 0.08, 0))
        .normalize();
      const chain = options.palette === "vine-ish" ? 3 : module.depth === 1 ? 3 : 2;
      let previous = module.node;
      let chainDir = direction;
      for (let step = 1; step <= chain; step++) {
        const chainT = step / chain;
        const delayedSeparation = THREE.MathUtils.smoothstep(chainT, 0.08, 0.9);
        const separation = THREE.MathUtils.lerp(1, delayedSeparation, options.junctionBlend);
        chainDir = module.direction.clone().lerp(direction, separation).normalize()
          .add(lightVector.clone().multiplyScalar(options.tropism * shade * chainT * 0.08))
          .add(new THREE.Vector3((rng() - 0.5) * options.gnarliness * 0.5, -options.droop * 0.05 * chainT, (rng() - 0.5) * options.gnarliness * 0.5))
          .normalize();
        const length = module.length * Math.pow(options.palette === "decurrent-broadleaf" ? 0.78 : 0.72, module.depth) / chain * (0.86 + rng() * 0.34) * (1 - crowding * options.collisionBias * 0.18);
        const t = THREE.MathUtils.clamp(module.t + (1 - module.t) * chainT * 0.72, 0, 1);
        const node = addNode(
          previous.position.clone().add(chainDir.clone().multiplyScalar(length)),
          chainDir,
          branchModuleStemRadius(baseRadius, module.depth, t, module.vigor),
          module.depth,
          t,
        );
        segments.push([previous.index, node.index]);
        previous = node;
      }
      const tipT = THREE.MathUtils.clamp(previous.t, 0, 1);
      anchors.push({
        position: previous.position.clone(),
        direction: chainDir.clone(),
        right: tangentBasis(chainDir).right,
        t: tipT,
        depth: module.depth,
        nodeIndex: previous.index,
      });
      if (module.depth < options.levels && module.vigor > 0.12) {
        const nextCount = options.palette === "excurrent-conifer"
          ? 2
          : options.palette === "shrub"
            ? Math.max(1, Math.round(1.5 * options.branchDensity))
            : Math.max(1, Math.round(options.branchDensity));
        for (let next = 0; next < nextCount; next++) {
          modules.push({
            node: previous,
            direction: chainDir,
            depth: module.depth + 1,
            length: module.length * (options.palette === "weeping" ? 0.78 : 0.68),
            vigor: module.vigor * (0.62 + rng() * 0.18),
            t: tipT,
          });
        }
      }
    }
  }

  for (const [ai, bi] of segments) {
    const a = stems[ai]!;
    const b = stems[bi]!;
    const bark = barkColor.clone();
    const delta = (hashUnit(seed + bi * 19) - 0.5) * realism.colorVariance * 0.5;
    if (delta > 0) bark.lerp(new THREE.Color(0xffffff), delta);
    else bark.lerp(new THREE.Color(0x050805), -delta);
    addStemSegment(builder, a, b, bark);
  }
  const leaves = addBranchModuleFoliage(builder, genome, seed, env, anchors);
  const template = builder.build();
  const graph = buildProcPlantGraphIr(stems, segments, organs);
  const segmentByEndNode = new Map(graph.segmentRecords.map((segment) => [segment.endNodeIndex, segment]));
  graph.attachments = anchors.map((anchor, index): ProcPlantAttachmentAnchor => {
    const tangent = anchor.direction.clone().normalize();
    let right = anchor.right.clone().projectOnPlane(tangent);
    if (right.lengthSq() < 1e-10) right = tangentBasis(tangent).right;
    right.normalize();
    const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
    const parentSegment = segmentByEndNode.get(anchor.nodeIndex) ?? null;
    return {
      id: `branch-module:branch-tip:${index}`,
      parentSegmentId: parentSegment?.id ?? null,
      axialT: 1,
      position: anchor.position.clone(),
      tangent,
      right,
      up,
      kind: "branch-tip",
      depth: anchor.depth,
      sway: 0.38 + anchor.t * 0.58,
      organIndex: null,
    };
  });
  return {
    template,
    graph,
    stats: {
      stems: segments.length,
      leaves,
      flowers: 0,
      triangles: template.idx.length / 3,
    },
  };
};

export const buildWeberPennProcPlantTemplate = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): { template: ProcPlantTemplate; graph: ProcPlantGraph; stats: ProcPlantStats } => {
  if (!genome.weberPenn) {
    return buildProcPlantTemplate({ ...genome, weberPenn: undefined }, seed, env);
  }
  const nativeLeaves = genome.weberPenn.nativeLeaves !== false;
  const foliageMass = isWeberPennCrownFillEnabled(genome) ? genome.foliage?.mass ?? 0 : 0;
  const bakeOptions = weberPennBakeOptions(genome);
  const generateLeaves = (genome.weberPenn.maxLeaves ?? 1) !== 0 && (nativeLeaves || foliageMass > 0);
  const treeData = generateTreeData(
    genome.weberPenn.species,
    seed >>> 0,
    generateLeaves,
    bakeOptions.maxBranchDepth,
  );
  const baked = bakeTree(treeData, bakeOptions);
  const barkColor = new THREE.Color(genome.weberPenn.barkColor ?? 0x5d4327);
  const leafColor = new THREE.Color(genome.weberPenn.leafColor ?? genome.leaf.colorA);
  const height = Math.max(1e-4, baked.max.y - baked.min.y);
  const scale = 1 / height;
  const cx = (baked.min.x + baked.max.x) * 0.5;
  const cz = (baked.min.z + baked.max.z) * 0.5;
  const baseY = baked.min.y;
  const branchVerts = baked.branches.positions.length / 3;
  const leafVerts = baked.leaves.positions.length / 3;
  const totalVerts = branchVerts + leafVerts;
  const totalIdx = baked.branches.indices.length + (nativeLeaves ? baked.leaves.indices.length : 0);
  const pos = new Float32Array(totalVerts * 3);
  const nrm = new Float32Array(totalVerts * 3);
  const uv0 = new Float32Array(totalVerts * 2);
  const col = new Float32Array(totalVerts * 3);
  const tintable = new Uint8Array(totalVerts);
  const sway = new Float32Array(totalVerts);
  const idx = new Uint32Array(totalIdx);
  const swayFrom = 0.25;
  const realism = treeRealismTraits(genome);
  const conifer = isWeberPennConifer(genome);
  const bendDir = new THREE.Vector3(
    Math.cos((seed >>> 0) * 0.017),
    0,
    Math.sin((seed >>> 0) * 0.017),
  ).normalize();
  const bendAmount = realism.trunkBend * (0.035 + (1 - THREE.MathUtils.clamp(env.moisture, 0, 1)) * 0.025);
  const warpPosition = (x: number, y: number, z: number, vertexSeed: number, isLeaf: boolean) => {
    const h = THREE.MathUtils.clamp(y, 0, 1);
    const p = new THREE.Vector3(x, y, z);
    const radial = new THREE.Vector3(p.x, 0, p.z);
    const radius = radial.length();
    if (radius > 0.0001) {
      radial.normalize();
      const crownT = THREE.MathUtils.smoothstep(h, conifer ? 0.08 : 0.22, 1);
      const taperEnvelope = conifer
        ? THREE.MathUtils.lerp(1.12, 0.36, h)
        : THREE.MathUtils.lerp(0.72 + Math.sin(h * Math.PI) * 0.45, 1 - h * 0.18, realism.crownTaper);
      const crownScale = 1 + crownT * realism.crownSpread * taperEnvelope * (isLeaf ? 0.24 : 0.11);
      const flare = !isLeaf && h < 0.22 ? 1 + realism.trunkFlare * Math.pow(1 - h / 0.22, 2) * 0.34 : 1;
      p.x *= crownScale * flare;
      p.z *= crownScale * flare;
      const gnarl = (hashUnit(vertexSeed) - 0.5) * realism.branchGnarl * (isLeaf ? 0.012 : 0.02) * (0.35 + crownT);
      p.add(radial.multiplyScalar(gnarl));
    }
    p.add(bendDir.clone().multiplyScalar(Math.pow(h, 1.35) * bendAmount));
    return p;
  };
  const makeLeafSiteAnchors = (tree: TreeData): WeberPennFoliageAnchor[] => {
    let leaves = tree.leaves;
    if (leaves.length > (bakeOptions.maxLeaves ?? Infinity)) {
      const step = leaves.length / Math.max(1, bakeOptions.maxLeaves ?? 1);
      const sampled: typeof leaves = [];
      for (let i = 0; i < (bakeOptions.maxLeaves ?? 0); i++) {
        sampled.push(leaves[Math.floor(i * step)]!);
      }
      leaves = sampled;
    }
    return leaves.map((leaf, index) => {
      const leafYUp = new THREE.Vector3(leaf.position.x, leaf.position.z, -leaf.position.y);
      const ny = (leafYUp.y - baseY) * scale;
      const position = warpPosition(
        (leafYUp.x - cx) * scale,
        ny,
        (leafYUp.z - cz) * scale,
        seed + index * 31,
        true,
      );
      const direction = new THREE.Vector3(leaf.direction.x, leaf.direction.z, -leaf.direction.y);
      if (direction.lengthSq() < 0.0001) direction.set(position.x, 0.1, position.z);
      direction.normalize();
      return {
        position,
        direction,
        right: tangentBasis(direction).right,
        kind: "leaf-site" as const,
        t: THREE.MathUtils.clamp(ny, 0, 1),
      };
    });
  };
  const makeBranchTipAnchors = (tree: TreeData): WeberPennFoliageAnchor[] => {
    const maxDepth = bakeOptions.maxBranchDepth ?? Infinity;
    let stems = maxDepth < Infinity
      ? tree.stems.filter((stem) => stem.depth <= maxDepth)
      : tree.stems;
    if (stems.length > (bakeOptions.maxStems ?? Infinity)) {
      stems = [...stems]
        .sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : b.radius - a.radius))
        .slice(0, bakeOptions.maxStems);
    }
    const included = new Set(stems.map((stem) => tree.stems.indexOf(stem)));
    const anchors = stems
      .map((stem, index) => ({ stem, index }))
      .filter(({ stem }) => stem.points.length >= 2)
      .filter(({ stem, index }) => stem.depth > 0 || !stems.some((candidate) => candidate.depth > 0))
      .filter(({ stem }) => !stem.childIndices.some((child) => included.has(child)))
      .map(({ stem, index }) => {
        const end = stem.points[stem.points.length - 1]!.position;
        const prev = stem.points[stem.points.length - 2]!.position;
        const endYUp = new THREE.Vector3(end.x, end.z, -end.y);
        const prevYUp = new THREE.Vector3(prev.x, prev.z, -prev.y);
        const ny = (endYUp.y - baseY) * scale;
        const position = warpPosition(
          (endYUp.x - cx) * scale,
          ny,
          (endYUp.z - cz) * scale,
          seed + index * 43,
          false,
        );
        const prevNy = (prevYUp.y - baseY) * scale;
        const previous = warpPosition(
          (prevYUp.x - cx) * scale,
          prevNy,
          (prevYUp.z - cz) * scale,
          seed + index * 43 - 7,
          false,
        );
        const direction = position.clone().sub(previous);
        if (direction.lengthSq() < 0.0001) direction.set(position.x, 0.1, position.z);
        direction.normalize();
        return {
          position,
          direction,
          right: tangentBasis(direction).right,
          kind: "branch-tip" as const,
          t: THREE.MathUtils.clamp(ny, 0, 1),
        };
      });
    if (anchors.length > 0) return anchors;
    return [];
  };
  const makeFoliageAnchors = (tree: TreeData): WeberPennFoliageAnchor[] => {
    if ((genome.weberPenn?.fillAnchor ?? "leaf-sites") === "branch-tips") {
      return makeBranchTipAnchors(tree);
    }
    const leafSiteAnchors = makeLeafSiteAnchors(tree);
    return leafSiteAnchors.length > 0 ? leafSiteAnchors : makeBranchTipAnchors(tree);
  };
  const varyColor = (color: THREE.Color, vertexSeed: number, amount = realism.colorVariance) => {
    const out = color.clone();
    const delta = (hashUnit(vertexSeed) - 0.5) * amount;
    if (delta > 0) out.lerp(new THREE.Color(0xffffff), delta);
    else out.lerp(new THREE.Color(0x050805), -delta * 0.8);
    return out;
  };

  for (let i = 0; i < branchVerts; i++) {
    const o = i * 3;
    const ny = (baked.branches.positions[o + 1]! - baseY) * scale;
    const warped = warpPosition(
      (baked.branches.positions[o]! - cx) * scale,
      ny,
      (baked.branches.positions[o + 2]! - cz) * scale,
      seed + i * 17,
      false,
    );
    pos[o] = warped.x;
    pos[o + 1] = warped.y;
    pos[o + 2] = warped.z;
    nrm[o] = baked.branches.normals[o]!;
    nrm[o + 1] = baked.branches.normals[o + 1]!;
    nrm[o + 2] = baked.branches.normals[o + 2]!;
    uv0[i * 2] = Math.atan2(baked.branches.normals[o + 2]!, baked.branches.normals[o]!) / (Math.PI * 2) + 0.5;
    uv0[i * 2 + 1] = THREE.MathUtils.clamp(ny, 0, 1);
    const bark = varyColor(barkColor, seed + i * 23, realism.colorVariance * 0.55);
    col[o] = bark.r;
    col[o + 1] = bark.g;
    col[o + 2] = bark.b;
    const w = Math.max(0, (ny - swayFrom) / Math.max(1e-4, 1 - swayFrom));
    sway[i] = w * w * realism.windFlex * 0.62;
  }

  for (let i = 0; i < leafVerts; i++) {
    const src = i * 3;
    const dst = (branchVerts + i) * 3;
    const di = branchVerts + i;
    const ny = (baked.leaves.positions[src + 1]! - baseY) * scale;
    const warped = warpPosition(
      (baked.leaves.positions[src]! - cx) * scale,
      ny,
      (baked.leaves.positions[src + 2]! - cz) * scale,
      seed + i * 31,
      true,
    );
    pos[dst] = warped.x;
    pos[dst + 1] = warped.y;
    pos[dst + 2] = warped.z;
    nrm[dst] = baked.leaves.normals[src]!;
    nrm[dst + 1] = baked.leaves.normals[src + 1]!;
    nrm[dst + 2] = baked.leaves.normals[src + 2]!;
    uv0[di * 2] = THREE.MathUtils.clamp(
      (baked.leaves.positions[src]! - baked.min.x) / Math.max(1e-6, baked.max.x - baked.min.x),
      0,
      1,
    );
    uv0[di * 2 + 1] = THREE.MathUtils.clamp(ny, 0, 1);
    const color = varyColor(
      leafColor.clone().lerp(new THREE.Color(genome.leaf.colorB), THREE.MathUtils.clamp(ny, 0, 1) * 0.55),
      seed + i * 37,
    );
    col[dst] = color.r;
    col[dst + 1] = color.g;
    col[dst + 2] = color.b;
    tintable[di] = 1;
    const w = Math.max(0, (ny - swayFrom) / Math.max(1e-4, 1 - swayFrom));
    sway[di] = Math.min(1, (w * w + w) * (0.72 + realism.windFlex * 0.62));
  }

  baked.branches.indices.forEach((v, i) => {
    idx[i] = v;
  });
  if (nativeLeaves) {
    const offset = baked.branches.indices.length;
    baked.leaves.indices.forEach((v, i) => {
      idx[offset + i] = v + branchVerts;
    });
  }

  const baseTemplate: ProcPlantTemplate = { pos, nrm, uv0, col, tintable, sway, idx };
  const massBuilder = new TemplateBuilder();
  const foliageAnchors = makeFoliageAnchors(treeData);
  const massLeaves = addWeberPennFoliageMass(
    massBuilder,
    genome,
    seed,
    env,
    baseTemplate,
    branchVerts,
    foliageAnchors,
  );
  const template = combineTemplates(baseTemplate, massBuilder.build());
  const graph = emptyGraph();
  graph.attachments = foliageAnchors.map((anchor, index) => {
    const tangent = anchor.direction.clone().normalize();
    const right = anchor.right.clone().projectOnPlane(tangent).normalize();
    const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
    if (Math.max(Math.abs(tangent.dot(right)), Math.abs(tangent.dot(up)), Math.abs(right.dot(up))) > 1e-4 ||
        new THREE.Vector3().crossVectors(tangent, right).dot(up) < 0.999) {
      throw new Error(`Invalid Weber-Penn attachment frame: ${anchor.kind}:${index}`);
    }
    return {
      id: `weber-penn:${anchor.kind}:${index}`,
      // The vendor tree exposes stable sites and tangents, but its baked branch
      // indices do not provide a lossless segment-parent mapping.
      parentSegmentId: null,
      axialT: anchor.t,
      position: anchor.position.clone(),
      tangent,
      right,
      up,
      kind: anchor.kind,
      depth: 0,
      sway: 0.38 + anchor.t * 0.58,
      organIndex: null,
    };
  });
  return {
    template,
    graph,
    stats: {
      stems: baked.branches.indices.length / 6,
      leaves: (nativeLeaves ? Math.round(baked.leaves.indices.length / 6) : 0) + massLeaves,
      flowers: 0,
      triangles: template.idx.length / 3,
    },
  };
};

export const createProcPlantPetalGeometry = (): THREE.BufferGeometry => {
  const positions = new Float32Array([
    0, 0, 0,
    -0.16, 0.24, 0.015,
    -0.2, 0.62, 0.04,
    0, 1, 0.1,
    0.2, 0.62, 0.04,
    0.16, 0.24, 0.015,
  ]);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) normals[i + 2] = 1;
  const indices = new Uint16Array([
    0, 1, 2,
    0, 2, 3,
    0, 3, 4,
    0, 4, 5,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
};

export const createProcPlantFlowerDiscGeometry = (): THREE.BufferGeometry => {
  const segments = 18;
  const positions: number[] = [0, 0, 0.035];
  const normals: number[] = [0, 0, 1];
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * 0.5;
    const y = Math.sin(a) * 0.5;
    const fold = Math.abs(y) * 0.22;
    const ripple = Math.sin(a * 2 + 0.4) * 0.008;
    positions.push(x, y, fold + ripple);
    normals.push(0, 0, 1);
  }
  for (let i = 1; i <= segments; i++) {
    const next = i === segments ? 1 : i + 1;
    indices.push(0, i, next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
};

export const createProcPlantDaylilyBloomGeometry = (): THREE.BufferGeometry => {
  const petalPositions = [
    [-0.05571, 0.19624, 0.06851],
    [0.09955, 0.24579, 0.11406],
    [0.0491, 0.19692, 0.08176],
    [0.04399, 0.04169, -0.04736],
    [-0.03204, 0.25022, -0.1223],
    [0.07267, 0.04101, -0.0065],
    [0.12147, 0.20031, -0.00863],
    [0.1857, 0.24988, 0.00733],
    [-0.03243, 0.2001, -0.07229],
    [0.0297, 0.03939, 0.05386],
    [-0.08814, 0.19748, 0.01044],
    [-0.04162, 0.0389, 0.04471],
    [-0.10529, 0.24409, 0.09995],
    [-0.06554, 0.03953, 0.00571],
    [0.08084, 0.20144, -0.0692],
    [-0.02883, 0.04116, -0.05018],
    [0, 0, 0],
    [-0.12526, 0.24646, -0.00392],
    [-0.06692, 0.24911, -0.09233],
    [0.17775, 0.25075, -0.02858],
    [0.04945, 0.24491, 0.12216],
    [-0.06327, 0.24415, 0.10804],
    [0.10381, 0.25206, -0.11907],
    [-0.14339, 0.24557, 0.03145],
    [0.13327, 0.25186, -0.09332],
  ] as const;
  const petalIndices = [
    3, 16, 15, 11, 9, 2, 11, 2, 0, 5, 3, 14, 5, 14, 6, 0, 2, 20, 0, 20, 21,
    13, 11, 0, 13, 0, 10, 5, 9, 16, 13, 15, 16, 15, 13, 10, 15, 10, 8, 9, 5,
    6, 9, 6, 2, 14, 8, 4, 14, 4, 22, 3, 5, 16, 9, 11, 16, 2, 6, 7, 2, 7, 1,
    10, 0, 12, 10, 12, 23, 3, 15, 8, 3, 8, 14, 11, 13, 16, 6, 14, 24, 6, 24,
    19, 8, 10, 17, 8, 17, 18,
  ] as const;
  const positions: number[] = [];
  const indices: number[] = [];

  const lengthScale = 0.54 / 0.25206;
  const xCenter = 0.02115;
  const petalCount = 6;
  for (let petal = 0; petal < petalCount; petal++) {
    const start = positions.length / 3;
    const angle = petal * (Math.PI * 2 / petalCount) + Math.PI / 2;
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    const rightX = -forwardY;
    const rightY = forwardX;
    const outer = petal % 2 === 0;
    const widthScale = lengthScale * (outer ? 0.92 : 0.7);
    const depthScale = lengthScale * (outer ? 0.72 : 0.54);
    const reachScale = lengthScale * (outer ? 1 : 0.84);
    const basePull = outer ? 0.035 : 0.012;
    const whorlLift = outer ? -0.018 : 0.022;

    for (const [x, y, z] of petalPositions) {
      const localX = (x - xCenter) * widthScale;
      const localY = y * reachScale - basePull;
      const localZ = z * depthScale + whorlLift;
      positions.push(
        rightX * localX + forwardX * localY,
        rightY * localX + forwardY * localY,
        localZ,
      );
    }
    for (let i = 0; i < petalIndices.length; i += 3) {
      indices.push(start + petalIndices[i], start + petalIndices[i + 1], start + petalIndices[i + 2]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

export const createProcPlantHibiscusBloomGeometry = (): THREE.BufferGeometry => {
  const sourcePositions = [
    [-0.08791, 0.1633, 0.3243],
    [-0.31499, 0.1718, 0.15172],
    [-0.16167, 0.16933, 0.19214],
    [0.29381, 0.16596, 0.21903],
    [0.03464, 0.16234, 0.33292],
    [0.12151, 0.16691, 0.21649],
    [0.30449, 0.1724, 0.06775],
    [0.24145, 0.186, -0.24232],
    [0.22823, 0.17713, -0.03397],
    [0.11299, 0.18701, -0.25135],
    [-0.05936, 0.18837, -0.26346],
    [0.02074, 0.1855, -0.2057],
    [-0.3032, 0.17891, -0.01535],
    [-0.20151, 0.18949, -0.27345],
    [-0.21636, 0.18234, -0.10524],
    [0, 0, 0],
  ] as const;
  const sourceIndices = [
    12, 1, 15, 7, 9, 15, 1, 2, 15, 9, 11, 15, 2, 0, 15, 11, 10, 15, 3, 6, 15,
    10, 13, 15, 4, 5, 15, 13, 14, 15, 5, 3, 15, 14, 12, 15, 6, 8, 15, 0, 4, 15,
    8, 7, 15,
  ] as const;
  const positions: number[] = [];

  for (const [x, y, z] of sourcePositions) {
    positions.push(
      x * 1.34,
      z * 1.34,
      (y - 0.165) * 1.85,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([...sourceIndices]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

const createFlobotBloomGeometry = (
  sourcePositions: readonly (readonly [number, number, number])[],
  sourceIndices: readonly number[],
  scale = 1,
): THREE.BufferGeometry => {
  const positions: number[] = [];
  for (const [x, y, z] of sourcePositions) {
    positions.push(
      x * scale,
      z * scale,
      (y - 0.17) * scale * 1.65,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([...sourceIndices]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

export const createProcPlantFlobotCupBloomGeometry = (): THREE.BufferGeometry =>
  createFlobotBloomGeometry(
    [
      [0.20332, 0.22244, 0.06838],
      [0.14908, 0.21936, 0.22378],
      [-0.05318, 0.16404, 0.10202],
      [-0.01576, 0.22566, 0.22597],
      [-0.16077, 0.23356, 0.15682],
      [-0.25692, 0.24161, 0.02656],
      [-0.06784, 0.17127, -0.09832],
      [-0.0519, 0.24163, -0.21237],
      [0.08503, 0.2369, -0.229],
      [-0.18991, 0.24367, -0.11342],
      [0.12841, 0.23453, -0.20831],
      [0.19431, 0.22805, -0.09],
      [0.10551, 0.16148, -0.00733],
      [0, 0, 0],
    ],
    [
      1, 0, 13, 10, 8, 13, 8, 7, 13, 4, 2, 13, 7, 6, 13, 12, 11, 13, 5, 4,
      13, 6, 9, 13, 0, 12, 13, 11, 10, 13, 9, 5, 13, 3, 1, 13, 2, 3, 13,
    ],
    1.42,
  );

export const createProcPlantFlobotPetal2BloomGeometry = (): THREE.BufferGeometry =>
  createFlobotBloomGeometry(
    [
      [0, 0, 0],
      [-0.29756, 0.23606, -0.11639],
      [-0.06628, 0.22962, -0.32914],
      [-0.13106, 0.2235, -0.15982],
      [-0.19991, 0.19815, 0.28082],
      [-0.32067, 0.23198, -0.0297],
      [-0.18936, 0.211, 0.08922],
      [-0.11903, 0.189, 0.30195],
      [0.23901, 0.15582, 0.29387],
      [0.02075, 0.18052, 0.23685],
      [0.25461, 0.15857, 0.23535],
      [0.33075, 0.17203, -0.05027],
      [0.215, 0.17478, 0.06272],
      [0.05289, 0.21613, -0.29801],
      [0.35254, 0.17588, -0.13201],
      [0.13672, 0.19914, -0.17216],
    ],
    [
      11, 14, 0, 7, 9, 0, 2, 3, 0, 13, 2, 0, 12, 11, 0, 3, 1, 0, 14, 15, 0,
      9, 8, 0, 4, 7, 0, 15, 13, 0, 8, 10, 0, 5, 6, 0, 10, 12, 0, 6, 4, 0,
      1, 5, 0,
    ],
    1.18,
  );

export const createProcPlantFlobotPinkBloomGeometry = (): THREE.BufferGeometry =>
  createFlobotBloomGeometry(
    [
      [0.00325, 0.00104, 0.00147],
      [-0.37905, 0.28913, -0.13556],
      [-0.10693, 0.26661, -0.41955],
      [-0.17426, 0.2703, -0.20243],
      [-0.22472, 0.268, 0.35519],
      [-0.40095, 0.28982, -0.02515],
      [-0.22704, 0.27132, 0.11418],
      [-0.12183, 0.25785, 0.37566],
      [0.32546, 0.21534, 0.33885],
      [0.04778, 0.24273, 0.28361],
      [0.34024, 0.21487, 0.26431],
      [0.41237, 0.2126, -0.09948],
      [0.2767, 0.22371, 0.05082],
      [0.04468, 0.25165, -0.3894],
      [0.43302, 0.21195, -0.20358],
      [0.15975, 0.23865, -0.23785],
    ],
    [
      11, 14, 0, 7, 9, 0, 2, 3, 0, 13, 2, 0, 12, 11, 0, 3, 1, 0, 14, 15, 0,
      9, 8, 0, 4, 7, 0, 15, 13, 0, 8, 10, 0, 5, 6, 0, 10, 12, 0, 6, 4, 0,
      1, 5, 0,
    ],
    0.98,
  );

export const createProcPlantFoxgloveBloomGeometry = (): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];

  positions.push(0, 0, -0.62);
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3) + Math.PI / 2;
    positions.push(Math.cos(a) * 0.24, Math.sin(a) * 0.24, -0.04);
  }
  indices.push(0, 1, 2, 0, 2, 3, 0, 3, 1);

  const centerIndex = positions.length / 3;
  positions.push(0, 0, 0.045);
  positions.push(0, 0.4, 0.05, 0.22, 0, 0.07, 0, -0.22, 0.04, -0.22, 0, 0.07);
  indices.push(
    centerIndex, centerIndex + 2, centerIndex + 1,
    centerIndex, centerIndex + 3, centerIndex + 2,
    centerIndex, centerIndex + 4, centerIndex + 3,
    centerIndex, centerIndex + 1, centerIndex + 4,
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

export const createProcPlantFlowerCenterGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.CircleGeometry(0.16, 10);
  geometry.computeBoundingSphere();
  return geometry;
};

const geometryForAccessoryKind = (kind: ProcPlantAccessoryKind): THREE.BufferGeometry => {
  if (kind === "fruit") return createProcPlantFruitGeometry();
  if (kind === "berry") return createProcPlantBerryGeometry();
  if (kind === "cone") return createProcPlantConeGeometry();
  if (kind === "thorn") return createProcPlantThornGeometry();
  return createProcPlantAerialRootGeometry();
};

/**
 * Compile a public graph after graph-space operations such as pruning. This is
 * intentionally limited to the procplant graph backend: Weber-Penn and branch
 * modules bake geometry outside this graph representation.
 */
export const buildProcPlantTemplateFromGraph = (
  genome: ProcPlantGenome,
  graph: ProcPlantGraph,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): { template: ProcPlantTemplate; graph: ProcPlantGraph; stats: ProcPlantStats } => {
  if (genome.branchModules || genome.weberPenn || genome.spaceColonization) {
    throw new Error("buildProcPlantTemplateFromGraph only supports the procplant graph backend");
  }
  const builder = new TemplateBuilder();
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const stemColor = new THREE.Color(
    genome.habit === "grass" || genome.habit === "fern" ? 0x3f6d2d : 0x6d5135,
  );
  for (const [ai, bi] of graph.segments) addStemSegment(builder, graph.stems[ai], graph.stems[bi], stemColor);
  let leafCount = 0;
  let flowerCount = 0;
  let accessoryCount = 0;
  const accessoryGeometries = new Map<ProcPlantAccessoryKind, THREE.BufferGeometry>();
  for (const organ of graph.organs) {
    if (organ.kind === "grassBlade") {
      addGrassBlade(builder, genome, organ);
      leafCount++;
    } else if (organ.kind === "coniferSpray") {
      const inst = coniferSprayInstance(genome, organ);
      const geo = createProcPlantConiferSprayGeometry();
      addTransformedGeometry(builder, geo, inst.matrix, inst.color, inst.sway);
      geo.dispose();
      leafCount++;
    } else if (organ.kind === "palmFrond") {
      const inst = palmFrondInstance(genome, organ);
      const geo = createProcPlantPalmFrondGeometry();
      addTransformedGeometry(builder, geo, inst.matrix, inst.color, inst.sway);
      geo.dispose();
      leafCount++;
    } else if (organ.kind === "mossTuft") {
      const inst = mossTuftInstance(genome, organ);
      const geo = createProcPlantMossTuftGeometry();
      addTransformedGeometry(builder, geo, inst.matrix, inst.color, inst.sway);
      geo.dispose();
      leafCount++;
    } else if (organ.kind === "flower") {
      addFlower(builder, genome, organ);
      flowerCount++;
    } else if (isAccessoryOrganKind(organ.kind)) {
      const inst = accessoryInstance(organ);
      let geometry = accessoryGeometries.get(organ.kind);
      if (!geometry) {
        geometry = geometryForAccessoryKind(organ.kind);
        accessoryGeometries.set(organ.kind, geometry);
      }
      addTransformedGeometry(builder, geometry, inst.matrix, inst.color, inst.sway);
      accessoryCount++;
    } else {
      addLeaf(builder, genome, organ, shade);
      leafCount++;
    }
  }
  for (const geometry of accessoryGeometries.values()) geometry.dispose();
  const template = builder.build();
  return {
    template,
    graph,
    stats: {
      stems: graph.segments.length,
      leaves: leafCount,
      flowers: flowerCount,
      ...(accessoryCount > 0 ? { accessories: accessoryCount } : {}),
      triangles: template.idx.length / 3,
    },
  };
};

export const buildProcPlantTemplate = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): { template: ProcPlantTemplate; graph: ProcPlantGraph; stats: ProcPlantStats } => {
  if (genome.spaceColonization) {
    const parts = buildSpaceColonizedProcPlantParts(genome, seed, env);
    const template = materializeProcPlantParts(genome, parts);
    return {
      template,
      graph: parts.graph,
      stats: {
        stems: parts.stats.stems,
        leaves: parts.stats.leaves,
        flowers: parts.stats.flowers,
        triangles: template.idx.length / 3,
      },
    };
  }
  if (genome.branchModules) return buildBranchModuleGraphTemplate(genome, seed, env);
  if (genome.weberPenn) return buildWeberPennProcPlantTemplate(genome, seed, env);
  const graph = buildProcPlantGraph(genome, seed, env);
  return buildProcPlantTemplateFromGraph(genome, graph, env);
};

export const buildProcPlantObject = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): THREE.Group => {
  const { template } = buildProcPlantTemplate(genome, seed, env);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(template.pos.slice(), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(template.nrm.slice(), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(template.uv0.slice(), 2));
  declareProcPlantGeometryUv0(geometry);
  geometry.setAttribute("color", new THREE.BufferAttribute(template.col.slice(), 3));
  geometry.setIndex(new THREE.BufferAttribute(template.idx.slice(), 1));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = `procplant-${genome.id}`;
  group.userData.procPlant = { genomeId: genome.id, seed };
  group.add(mesh);
  return group;
};

const geometryForCompiledInstance = (
  kind: ProcPlantInstance["kind"],
  genome: ProcPlantGenome,
): THREE.BufferGeometry => {
  if (kind === "leaf") {
    return createProcPlantLeafGeometry(
      genome.leaf.shape,
      genome.leaf.widthRatio,
      genome.leaf.serration,
      genome.leaf.curl,
      genome.leaf.venation,
    );
  }
  if (kind === "grassBlade") return createProcPlantGrassBladeGeometry(genome.leaf.widthRatio, genome.leaf.curl);
  if (kind === "coniferSpray") return createProcPlantConiferSprayGeometry();
  if (kind === "palmFrond") return createProcPlantPalmFrondGeometry();
  if (kind === "mossTuft") return createProcPlantMossTuftGeometry();
  if (kind === "petal") return createProcPlantPetalGeometry();
  if (kind === "flowerDisc") return createProcPlantFlowerDiscGeometry();
  if (kind === "daylilyBloom") return createProcPlantDaylilyBloomGeometry();
  if (kind === "hibiscusBloom") return createProcPlantHibiscusBloomGeometry();
  if (kind === "flobotCupBloom") return createProcPlantFlobotCupBloomGeometry();
  if (kind === "flobotPetal2Bloom") return createProcPlantFlobotPetal2BloomGeometry();
  if (kind === "flobotPinkBloom") return createProcPlantFlobotPinkBloomGeometry();
  if (kind === "foxgloveBloom") return createProcPlantFoxgloveBloomGeometry();
  if (isAccessoryOrganKind(kind)) return geometryForAccessoryKind(kind);
  return createProcPlantFlowerCenterGeometry();
};

const materializeProcPlantParts = (
  genome: ProcPlantGenome,
  parts: ProcPlantInstancedParts,
): ProcPlantTemplate => {
  if (parts.instances.length === 0) return cloneTemplate(parts.stems);
  const builder = new TemplateBuilder();
  const geometries = new Map<ProcPlantInstance["kind"], THREE.BufferGeometry>();
  for (const instance of parts.instances) {
    let geometry = geometries.get(instance.kind);
    if (!geometry) {
      geometry = geometryForCompiledInstance(instance.kind, genome);
      geometries.set(instance.kind, geometry);
    }
    addTransformedGeometry(builder, geometry, instance.matrix, instance.color, instance.sway);
  }
  for (const geometry of geometries.values()) geometry.dispose();
  return combineTemplates(parts.stems, builder.build());
};

const templateBoundsAndColor = (template: ProcPlantTemplate) => {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  if (template.pos.length === 0) box.set(new THREE.Vector3(-0.25, 0, -0.25), new THREE.Vector3(0.25, 1, 0.25));
  for (let i = 0; i < template.pos.length; i += 3) {
    point.set(template.pos[i]!, template.pos[i + 1]!, template.pos[i + 2]!);
    box.expandByPoint(point);
    color.r += template.col[i] ?? 0.3;
    color.g += template.col[i + 1] ?? 0.55;
    color.b += template.col[i + 2] ?? 0.25;
  }
  const vertices = Math.max(1, template.pos.length / 3);
  color.multiplyScalar(1 / vertices);
  return { box, color };
};

const createPlantCardTemplate = (source: ProcPlantTemplate, crossed: boolean): ProcPlantTemplate => {
  const { box, color } = templateBoundsAndColor(source);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const halfWidth = Math.max(0.08, Math.max(size.x, size.z) * 0.5);
  const y0 = box.min.y;
  const y1 = Math.max(y0 + 0.08, box.max.y);
  const builder = new TemplateBuilder();
  builder.addQuad([
    new THREE.Vector3(center.x - halfWidth, y0, center.z),
    new THREE.Vector3(center.x + halfWidth, y0, center.z),
    new THREE.Vector3(center.x + halfWidth, y1, center.z),
    new THREE.Vector3(center.x - halfWidth, y1, center.z),
  ], color, true, 0.7);
  if (crossed) {
    builder.addQuad([
      new THREE.Vector3(center.x, y0, center.z - halfWidth),
      new THREE.Vector3(center.x, y0, center.z + halfWidth),
      new THREE.Vector3(center.x, y1, center.z + halfWidth),
      new THREE.Vector3(center.x, y1, center.z - halfWidth),
    ], color, true, 0.7);
  }
  return builder.build();
};

const createPlantClusterTemplate = (source: ProcPlantTemplate): ProcPlantTemplate => {
  const { box, color } = templateBoundsAndColor(source);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const halfWidth = Math.max(0.06, Math.max(size.x, size.z) * 0.32);
  const y0 = box.min.y;
  const y1 = Math.max(y0 + 0.08, box.max.y);
  const builder = new TemplateBuilder();
  for (let card = 0; card < 3; card++) {
    const yaw = card * Math.PI / 3;
    const offset = (card - 1) * halfWidth * 0.48;
    const axis = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const across = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
    const base = center.clone().addScaledVector(across, offset);
    builder.addQuad([
      base.clone().addScaledVector(axis, -halfWidth).setY(y0),
      base.clone().addScaledVector(axis, halfWidth).setY(y0),
      base.clone().addScaledVector(axis, halfWidth).setY(y1),
      base.clone().addScaledVector(axis, -halfWidth).setY(y1),
    ], color, true, 0.68);
  }
  return builder.build();
};

const reducedLodGenome = (genome: ProcPlantGenome): ProcPlantGenome => ({
  ...genome,
  nodeCount: Math.max(3, Math.round(genome.nodeCount * 0.72)),
  leaf: {
    ...genome.leaf,
    density: {
      ...genome.leaf.density,
      base: genome.leaf.density.base * 0.72,
      tip: genome.leaf.density.tip * 0.72,
    },
  },
  grass: genome.grass ? { ...genome.grass, blades: Math.max(6, Math.round(genome.grass.blades * 0.56)) } : undefined,
  fern: genome.fern ? { ...genome.fern, pinnae: Math.max(9, Math.round(genome.fern.pinnae * 0.62)) } : undefined,
  groundcover: genome.groundcover
    ? { ...genome.groundcover, clusters: Math.max(3, Math.round(genome.groundcover.clusters * 0.56)) }
    : undefined,
  moss: genome.moss
    ? {
        ...genome.moss,
        clumps: Math.max(3, Math.round(genome.moss.clumps * 0.56)),
        tuftsPerClump: Math.max(1, Math.round(genome.moss.tuftsPerClump * 0.72)),
      }
    : undefined,
  clump: genome.clump ? { ...genome.clump, count: Math.max(1, Math.round(genome.clump.count * 0.56)) } : undefined,
  foliage: genome.foliage
    ? { ...genome.foliage, mass: genome.foliage.mass * 0.7, clusterDensity: genome.foliage.clusterDensity * 0.68 }
    : undefined,
  weberPenn: genome.weberPenn
    ? {
        ...genome.weberPenn,
        maxBranchDepth: Math.max(1, (genome.weberPenn.maxBranchDepth ?? 3) - 1),
        maxStems: Math.max(12, Math.round((genome.weberPenn.maxStems ?? 96) * 0.56)),
        maxLeaves: Math.max(24, Math.round((genome.weberPenn.maxLeaves ?? 180) * 0.56)),
        radialSegments: Math.min(3, genome.weberPenn.radialSegments ?? 4),
        branchSamples: 1,
      }
    : undefined,
  branchModules: genome.branchModules
    ? {
        ...genome.branchModules,
        moduleBudget: Math.max(12, Math.round((genome.branchModules.moduleBudget ?? 120) * 0.56)),
        levels: Math.max(1, (genome.branchModules.levels ?? 4) - 1),
      }
    : undefined,
  spaceColonization: genome.spaceColonization
    ? {
        ...genome.spaceColonization,
        attractorCount: Math.max(48, Math.round(genome.spaceColonization.attractorCount * 0.58)),
        maxSteps: Math.max(24, Math.round(genome.spaceColonization.maxSteps * 0.72)),
        maxNodes: Math.max(48, Math.round(genome.spaceColonization.maxNodes * 0.58)),
        radialSegments: Math.max(3, (genome.spaceColonization.radialSegments ?? 5) - 2),
        foliageSpacing: Math.max(2, Math.round((genome.spaceColonization.foliageSpacing ?? 4) * 1.5)),
        terminalLeafCount: Math.max(1, (genome.spaceColonization.terminalLeafCount ?? 3) - 1),
      }
    : undefined,
});

/** Compile deterministic, renderable geometry for every runtime LOD. */
export const compileProcPlantLods = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): ProcPlantCompiledLod[] => {
  const full = materializeProcPlantParts(genome, buildProcPlantInstancedParts(genome, seed, env));
  const fullTriangles = full.idx.length / 3;
  if (fullTriangles <= 6) throw new Error(`ProcPlant LOD compilation requires more than 6 source triangles; received ${fullTriangles}`);
  const reduced = materializeProcPlantParts(
    reducedLodGenome(genome),
    buildProcPlantInstancedParts(reducedLodGenome(genome), seed, env),
  );
  const reducedTriangles = reduced.idx.length / 3;
  // If a stochastic backend happens not to shrink for a particular genome,
  // use a coherent three-card cluster instead of tearing the source topology.
  const clustered = reducedTriangles > 4 && reducedTriangles < fullTriangles
    ? reduced
    : createPlantClusterTemplate(full);
  const billboard = createPlantCardTemplate(full, true);
  const impostor = createPlantCardTemplate(full, false);
  const treeScale = genome.habit === "tree" || genome.habit === "conifer" || genome.habit === "palm" ? 1.5 : 0.75;
  const rows: Array<[ProcPlantCompiledLod["level"], ProcPlantCompiledLod["label"], number, ProcPlantTemplate]> = [
    [0, "full", 0, full],
    [1, "clustered", 18 * treeScale, clustered],
    [2, "billboard-cross", 42 * treeScale, billboard],
    [3, "impostor", 86 * treeScale, impostor],
  ];
  return rows.map(([level, label, distance, template]) => ({
    level,
    label,
    distance,
    template,
    triangles: template.idx.length / 3,
    vertices: template.pos.length / 3,
  }));
};

export const procPlantEcologyProfiles: Record<string, ProcPlantEcologyProfile> = {
  furGrass: {
    presetId: "furGrass",
    dominance: 0.8,
    biomeAffinity: { grassland: 1, savanna: 0.9, coastal: 0.65, tundra: 0.35, "arctic-alpine": 0.3 },
    substrateAffinity: { loam: 1, silt: 0.8, sand: 0.65, clay: 0.6 },
    warmth: [0.15, 0.62, 0.95],
    moisture: [0.18, 0.55, 0.9],
    elevation: [0, 0.28, 0.82],
    wind: [0, 0.45, 1],
  },
  phiFern: {
    presetId: "phiFern",
    dominance: 0.42,
    biomeAffinity: { "temperate-rain-forest": 1, "tropical-rain-forest": 0.86, estuary: 0.46, taiga: 0.35 },
    substrateAffinity: { loam: 0.85, peat: 1, shale: 0.45, granite: 0.35 },
    warmth: [0.28, 0.58, 0.92],
    moisture: [0.55, 0.86, 1],
    elevation: [0, 0.24, 0.7],
  },
  brackenFernMat: {
    presetId: "brackenFernMat",
    dominance: 0.56,
    biomeAffinity: { "temperate-rain-forest": 1, taiga: 0.62, grassland: 0.32, coastal: 0.28 },
    substrateAffinity: { loam: 1, peat: 0.86, shale: 0.5, granite: 0.42 },
    warmth: [0.2, 0.52, 0.82],
    moisture: [0.4, 0.72, 1],
    elevation: [0, 0.3, 0.76],
  },
  maidenhairFernPatch: {
    presetId: "maidenhairFernPatch",
    dominance: 0.48,
    biomeAffinity: { "temperate-rain-forest": 1, "tropical-rain-forest": 0.64, taiga: 0.38, estuary: 0.28 },
    substrateAffinity: { loam: 1, peat: 0.9, limestone: 0.52, shale: 0.38 },
    warmth: [0.24, 0.56, 0.88],
    moisture: [0.5, 0.8, 1],
    elevation: [0, 0.24, 0.68],
  },
  woodlandVioletCarpet: {
    presetId: "woodlandVioletCarpet",
    dominance: 0.52,
    biomeAffinity: { "temperate-rain-forest": 1, taiga: 0.44, grassland: 0.3, coastal: 0.22 },
    substrateAffinity: { loam: 1, silt: 0.76, limestone: 0.62, peat: 0.52 },
    warmth: [0.18, 0.52, 0.82],
    moisture: [0.34, 0.66, 0.94],
    elevation: [0, 0.3, 0.76],
    seasonality: [0.24, 0.62, 1],
  },
  trilliumPatch: {
    presetId: "trilliumPatch",
    dominance: 0.36,
    biomeAffinity: { "temperate-rain-forest": 1, taiga: 0.34, "tropical-rain-forest": 0.2 },
    substrateAffinity: { loam: 1, limestone: 0.74, silt: 0.58, peat: 0.42 },
    warmth: [0.18, 0.5, 0.78],
    moisture: [0.4, 0.7, 0.96],
    elevation: [0, 0.26, 0.7],
    seasonality: [0.34, 0.68, 1],
  },
  horsetailColony: {
    presetId: "horsetailColony",
    dominance: 0.58,
    biomeAffinity: { estuary: 1, "temperate-rain-forest": 0.82, coastal: 0.54, taiga: 0.42 },
    substrateAffinity: { silt: 1, clay: 0.9, peat: 0.86, loam: 0.72 },
    warmth: [0.12, 0.5, 0.84],
    moisture: [0.58, 0.88, 1],
    elevation: [0, 0.14, 0.52],
    salinity: [0, 0.08, 0.28],
  },
  cloverGroundcover: {
    presetId: "cloverGroundcover",
    dominance: 0.7,
    biomeAffinity: { grassland: 1, "temperate-rain-forest": 0.48, coastal: 0.34, taiga: 0.24 },
    substrateAffinity: { loam: 1, clay: 0.72, silt: 0.7, limestone: 0.54 },
    warmth: [0.18, 0.55, 0.88],
    moisture: [0.24, 0.58, 0.9],
    elevation: [0, 0.28, 0.78],
  },
  woodSorrelCarpet: {
    presetId: "woodSorrelCarpet",
    dominance: 0.52,
    biomeAffinity: { "temperate-rain-forest": 1, taiga: 0.48, "tropical-rain-forest": 0.42 },
    substrateAffinity: { loam: 1, peat: 0.92, shale: 0.42 },
    warmth: [0.18, 0.5, 0.82],
    moisture: [0.42, 0.74, 1],
    elevation: [0, 0.26, 0.72],
  },
  woodlandAnemoneCarpet: {
    presetId: "woodlandAnemoneCarpet",
    dominance: 0.4,
    biomeAffinity: { "temperate-rain-forest": 1, taiga: 0.38, grassland: 0.24 },
    substrateAffinity: { loam: 1, limestone: 0.72, silt: 0.58, peat: 0.46 },
    warmth: [0.2, 0.5, 0.78],
    moisture: [0.34, 0.64, 0.9],
    elevation: [0, 0.3, 0.74],
    seasonality: [0.3, 0.66, 1],
  },
  creepingPhloxCarpet: {
    presetId: "creepingPhloxCarpet",
    dominance: 0.46,
    biomeAffinity: { grassland: 1, "arctic-alpine": 0.52, coastal: 0.34, taiga: 0.26 },
    substrateAffinity: { loam: 0.9, limestone: 1, shale: 0.68, granite: 0.5 },
    warmth: [0.14, 0.48, 0.82],
    moisture: [0.2, 0.5, 0.82],
    elevation: [0, 0.42, 0.9],
  },
  reedSedge: {
    presetId: "reedSedge",
    dominance: 0.58,
    biomeAffinity: { estuary: 1, coastal: 0.72, grassland: 0.36, tundra: 0.32 },
    substrateAffinity: { clay: 1, silt: 0.94, peat: 0.86, sand: 0.36 },
    warmth: [0.12, 0.54, 0.92],
    moisture: [0.62, 0.92, 1],
    elevation: [0, 0.08, 0.35],
    salinity: [0, 0.28, 0.78],
  },
  foldedPalm: {
    presetId: "foldedPalm",
    dominance: 0.68,
    biomeAffinity: { "tropical-rain-forest": 1, coastal: 0.82, savanna: 0.46 },
    substrateAffinity: { sand: 0.85, loam: 0.78, silt: 0.62, clay: 0.42 },
    warmth: [0.62, 0.88, 1],
    moisture: [0.34, 0.72, 1],
    elevation: [0, 0.1, 0.42],
    salinity: [0, 0.2, 0.64],
  },
  sugarMaple: {
    presetId: "sugarMaple",
    dominance: 0.84,
    biomeAffinity: { "temperate-rain-forest": 1, grassland: 0.48, taiga: 0.22 },
    substrateAffinity: { loam: 1, silt: 0.76, clay: 0.62, limestone: 0.58 },
    warmth: [0.2, 0.5, 0.78],
    moisture: [0.28, 0.58, 0.86],
    elevation: [0, 0.3, 0.72],
    seasonality: [0.3, 0.72, 1],
  },
  weepingWillow: {
    presetId: "weepingWillow",
    dominance: 0.7,
    biomeAffinity: { estuary: 1, "temperate-rain-forest": 0.78, grassland: 0.34, coastal: 0.3 },
    substrateAffinity: { silt: 1, clay: 0.86, loam: 0.72, peat: 0.66 },
    warmth: [0.24, 0.56, 0.84],
    moisture: [0.56, 0.84, 1],
    elevation: [0, 0.12, 0.44],
    seasonality: [0.24, 0.64, 1],
  },
  windsweptBonsai: {
    presetId: "windsweptBonsai",
    dominance: 0.18,
    biomeAffinity: { "arctic-alpine": 0.76, coastal: 0.68, taiga: 0.56, grassland: 0.24 },
    substrateAffinity: { granite: 1, shale: 0.86, sand: 0.4, loam: 0.28 },
    warmth: [0.08, 0.38, 0.7],
    moisture: [0.18, 0.44, 0.74],
    elevation: [0.18, 0.62, 1],
    wind: [0.28, 0.72, 1],
  },
  deadwoodSnag: {
    presetId: "deadwoodSnag",
    dominance: 0.14,
    biomeAffinity: { taiga: 1, "temperate-rain-forest": 0.84, "arctic-alpine": 0.36, savanna: 0.3 },
    substrateAffinity: { loam: 0.72, peat: 0.7, granite: 0.62, shale: 0.58 },
    warmth: [0.04, 0.45, 0.9],
    moisture: [0.12, 0.58, 1],
    elevation: [0, 0.42, 0.94],
  },
  twilightFantasyTree: {
    presetId: "twilightFantasyTree",
    dominance: 0.12,
    biomeAffinity: { "temperate-rain-forest": 1, "tropical-rain-forest": 0.5, taiga: 0.28 },
    substrateAffinity: { loam: 1, peat: 0.82, granite: 0.46, volcanic: 0.42 },
    warmth: [0.22, 0.56, 0.86],
    moisture: [0.38, 0.7, 0.96],
    elevation: [0, 0.3, 0.72],
    seasonality: [0.16, 0.52, 0.9],
  },
  oakCanopy: {
    presetId: "oakCanopy",
    dominance: 0.92,
    biomeAffinity: { grassland: 0.78, "temperate-rain-forest": 0.72, coastal: 0.34 },
    substrateAffinity: { loam: 1, clay: 0.72, limestone: 0.84, shale: 0.48 },
    warmth: [0.32, 0.58, 0.82],
    moisture: [0.3, 0.55, 0.82],
    elevation: [0, 0.22, 0.64],
    seasonality: [0.2, 0.55, 0.95],
  },
  birchGrove: {
    presetId: "birchGrove",
    dominance: 0.74,
    biomeAffinity: { taiga: 0.74, "temperate-rain-forest": 0.64, grassland: 0.42, "arctic-alpine": 0.32 },
    substrateAffinity: { loam: 0.74, shale: 0.68, granite: 0.56, peat: 0.5, sand: 0.36 },
    warmth: [0.12, 0.42, 0.72],
    moisture: [0.28, 0.58, 0.9],
    elevation: [0, 0.34, 0.82],
    seasonality: [0.25, 0.72, 1],
  },
  acaciaUmbrella: {
    presetId: "acaciaUmbrella",
    dominance: 0.78,
    biomeAffinity: { savanna: 1, desert: 0.38, grassland: 0.34 },
    substrateAffinity: { sand: 0.72, clay: 0.62, loam: 0.52, limestone: 0.42 },
    warmth: [0.56, 0.82, 1],
    moisture: [0.12, 0.32, 0.62],
    elevation: [0, 0.22, 0.58],
    seasonality: [0.42, 0.82, 1],
  },
  mangroveRoots: {
    presetId: "mangroveRoots",
    dominance: 0.76,
    biomeAffinity: { estuary: 1, coastal: 0.76, "tropical-rain-forest": 0.42 },
    substrateAffinity: { clay: 0.92, silt: 1, peat: 0.74, sand: 0.46 },
    warmth: [0.58, 0.82, 1],
    moisture: [0.68, 0.94, 1],
    elevation: [0, 0.04, 0.22],
    salinity: [0.18, 0.52, 0.92],
  },
  blueSpruce: {
    presetId: "blueSpruce",
    dominance: 0.86,
    biomeAffinity: { taiga: 1, "arctic-alpine": 0.76, "temperate-rain-forest": 0.48 },
    substrateAffinity: { granite: 0.86, shale: 0.74, loam: 0.5, peat: 0.42 },
    warmth: [0, 0.25, 0.58],
    moisture: [0.28, 0.56, 0.86],
    elevation: [0.12, 0.58, 1],
    seasonality: [0.35, 0.72, 1],
  },
  alpineFir: {
    presetId: "alpineFir",
    dominance: 0.94,
    biomeAffinity: { taiga: 1, "arctic-alpine": 0.92, "temperate-rain-forest": 0.34 },
    substrateAffinity: { granite: 0.9, shale: 0.82, peat: 0.46, loam: 0.42 },
    warmth: [0, 0.18, 0.5],
    moisture: [0.3, 0.62, 0.94],
    elevation: [0.22, 0.68, 1],
    seasonality: [0.38, 0.78, 1],
  },
  tundraSmallPine: {
    presetId: "tundraSmallPine",
    dominance: 0.76,
    biomeAffinity: { "arctic-alpine": 1, tundra: 0.94, taiga: 0.76 },
    substrateAffinity: { granite: 1, shale: 0.86, peat: 0.48, loam: 0.4 },
    warmth: [0, 0.2, 0.5],
    moisture: [0.18, 0.44, 0.74],
    elevation: [0.3, 0.72, 1],
    seasonality: [0.42, 0.82, 1],
    wind: [0.18, 0.62, 1],
  },
  redwoodSpire: {
    presetId: "redwoodSpire",
    dominance: 0.72,
    biomeAffinity: { "temperate-rain-forest": 1, taiga: 0.42, coastal: 0.34 },
    substrateAffinity: { loam: 0.8, shale: 0.66, granite: 0.5, peat: 0.44 },
    warmth: [0.28, 0.52, 0.76],
    moisture: [0.58, 0.86, 1],
    elevation: [0, 0.34, 0.78],
  },
  desertRosette: {
    presetId: "desertRosette",
    dominance: 0.48,
    biomeAffinity: { desert: 1, savanna: 0.38, coastal: 0.22 },
    substrateAffinity: { sand: 1, limestone: 0.7, volcanic: 0.62, clay: 0.28 },
    warmth: [0.45, 0.82, 1],
    moisture: [0, 0.12, 0.36],
    elevation: [0, 0.28, 0.8],
  },
  wildStrawberryGroundcover: {
    presetId: "wildStrawberryGroundcover",
    dominance: 0.5,
    biomeAffinity: { "temperate-rain-forest": 1, grassland: 0.68, taiga: 0.34, coastal: 0.3 },
    substrateAffinity: { loam: 1, silt: 0.72, peat: 0.58, limestone: 0.46 },
    warmth: [0.18, 0.52, 0.82],
    moisture: [0.32, 0.64, 0.92],
    elevation: [0, 0.3, 0.76],
    seasonality: [0.3, 0.72, 1],
  },
  winterberryShrub: {
    presetId: "winterberryShrub",
    dominance: 0.46,
    biomeAffinity: { "temperate-rain-forest": 1, taiga: 0.62, estuary: 0.44 },
    substrateAffinity: { loam: 0.88, peat: 1, silt: 0.74, clay: 0.54 },
    warmth: [0.12, 0.44, 0.74],
    moisture: [0.46, 0.74, 1],
    elevation: [0, 0.24, 0.66],
    seasonality: [0.36, 0.78, 1],
  },
  colonizedHazelShrub: {
    presetId: "colonizedHazelShrub",
    dominance: 0.54,
    biomeAffinity: { "temperate-rain-forest": 1, grassland: 0.56, taiga: 0.3, coastal: 0.28 },
    substrateAffinity: { loam: 1, limestone: 0.72, clay: 0.58, silt: 0.54 },
    warmth: [0.16, 0.5, 0.82],
    moisture: [0.3, 0.62, 0.9],
    elevation: [0, 0.28, 0.72],
    seasonality: [0.28, 0.66, 1],
    wind: [0, 0.42, 0.82],
  },
  shorePineCones: {
    presetId: "shorePineCones",
    dominance: 0.68,
    biomeAffinity: { coastal: 1, taiga: 0.7, "temperate-rain-forest": 0.42 },
    substrateAffinity: { sand: 1, granite: 0.68, shale: 0.56, loam: 0.4 },
    warmth: [0.08, 0.38, 0.7],
    moisture: [0.2, 0.5, 0.84],
    elevation: [0, 0.16, 0.54],
    wind: [0.18, 0.62, 1],
  },
  thornyBramble: {
    presetId: "thornyBramble",
    dominance: 0.58,
    biomeAffinity: { "temperate-rain-forest": 1, grassland: 0.62, coastal: 0.4, taiga: 0.28 },
    substrateAffinity: { loam: 1, clay: 0.66, silt: 0.62, shale: 0.4 },
    warmth: [0.2, 0.54, 0.86],
    moisture: [0.28, 0.58, 0.9],
    elevation: [0, 0.26, 0.72],
  },
  epiphyticAroidRoots: {
    presetId: "epiphyticAroidRoots",
    dominance: 0.34,
    biomeAffinity: { "tropical-rain-forest": 1, "temperate-rain-forest": 0.22 },
    substrateAffinity: { loam: 0.62, peat: 1, volcanic: 0.56 },
    warmth: [0.58, 0.82, 1],
    moisture: [0.58, 0.86, 1],
    elevation: [0, 0.18, 0.5],
  },
  climbingIvy: {
    presetId: "climbingIvy",
    dominance: 0.48,
    biomeAffinity: { "temperate-rain-forest": 1, "tropical-rain-forest": 0.58, coastal: 0.36 },
    substrateAffinity: { loam: 1, limestone: 0.72, clay: 0.54, shale: 0.42 },
    warmth: [0.2, 0.55, 0.86],
    moisture: [0.3, 0.64, 0.94],
    elevation: [0, 0.26, 0.68],
  },
  canopyLiana: {
    presetId: "canopyLiana",
    dominance: 0.4,
    biomeAffinity: { "tropical-rain-forest": 1, "temperate-rain-forest": 0.38 },
    substrateAffinity: { loam: 0.84, peat: 1, clay: 0.58, volcanic: 0.48 },
    warmth: [0.56, 0.82, 1],
    moisture: [0.54, 0.84, 1],
    elevation: [0, 0.22, 0.58],
  },
  floweringWallCreeper: {
    presetId: "floweringWallCreeper",
    dominance: 0.36,
    biomeAffinity: { "temperate-rain-forest": 0.78, grassland: 0.62, coastal: 0.44 },
    substrateAffinity: { limestone: 1, loam: 0.82, shale: 0.62, clay: 0.46 },
    warmth: [0.28, 0.62, 0.92],
    moisture: [0.22, 0.52, 0.84],
    elevation: [0, 0.24, 0.66],
    seasonality: [0.28, 0.68, 1],
  },
  hangingMoss: {
    presetId: "hangingMoss",
    dominance: 0.44,
    biomeAffinity: { "temperate-rain-forest": 1, "tropical-rain-forest": 0.84, estuary: 0.34 },
    substrateAffinity: { peat: 1, loam: 0.72, shale: 0.56, granite: 0.48 },
    warmth: [0.18, 0.56, 0.9],
    moisture: [0.62, 0.88, 1],
    elevation: [0, 0.24, 0.64],
  },
  cushionMoss: {
    presetId: "cushionMoss",
    dominance: 0.62,
    biomeAffinity: { taiga: 1, "temperate-rain-forest": 0.9, tundra: 0.52, "arctic-alpine": 0.44 },
    substrateAffinity: { peat: 1, granite: 0.82, shale: 0.72, loam: 0.58 },
    warmth: [0.04, 0.38, 0.72],
    moisture: [0.44, 0.76, 1],
    elevation: [0, 0.36, 0.84],
  },
};

const rangeScore = (value: number, [min, ideal, max]: [number, number, number]) => {
  if (value <= min || value >= max) return 0;
  if (value === ideal) return 1;
  return value < ideal
    ? THREE.MathUtils.clamp((value - min) / Math.max(0.0001, ideal - min), 0, 1)
    : THREE.MathUtils.clamp((max - value) / Math.max(0.0001, max - ideal), 0, 1);
};

export const scoreProcPlantForEcology = (
  profile: ProcPlantEcologyProfile,
  sample: ProcPlantEcologySample,
): number => {
  const biomeScore = sample.biome ? profile.biomeAffinity[sample.biome] ?? 0.12 : 0.55;
  const substrateScore = profile.substrateAffinity[sample.substrate] ?? 0.18;
  const climate =
    rangeScore(sample.warmth, profile.warmth) *
    rangeScore(sample.moisture, profile.moisture) *
    rangeScore(sample.elevation, profile.elevation);
  const season = profile.seasonality ? rangeScore(sample.seasonality, profile.seasonality) : 0.82;
  const salinity = profile.salinity ? rangeScore(sample.salinity, profile.salinity) : 1 - sample.salinity * 0.45;
  const wind = profile.wind ? rangeScore(sample.wind, profile.wind) : 1 - sample.wind * 0.22;
  const light = THREE.MathUtils.lerp(0.45, 1.15, sample.light);
  return Math.max(0, profile.dominance * biomeScore * substrateScore * climate * season * salinity * wind * light);
};

export const resolveProcPlantCommunity = (
  sample: ProcPlantEcologySample,
  limit = 6,
): ProcPlantCommunityEntry[] =>
  Object.values(procPlantEcologyProfiles)
    .map((profile) => ({
      presetId: profile.presetId,
      score: scoreProcPlantForEcology(profile, sample),
      genome: procPlantPresets[profile.presetId],
    }))
    .filter((entry): entry is ProcPlantCommunityEntry => Boolean(entry.genome) && entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

export const applyProcPlantForceFields = (
  genome: ProcPlantGenome,
  fields: ProcPlantForceField[],
): ProcPlantGenome => {
  if (fields.length === 0) return genome;
  const realism = treeRealismTraits(genome);
  for (const field of fields) {
    const strength = THREE.MathUtils.clamp(field.strength, -1, 1);
    if (field.type === "windShape" || field.type === "direction") {
      realism.trunkBend = THREE.MathUtils.clamp(realism.trunkBend + Math.abs(strength) * 0.18, 0, 1);
      realism.windFlex = THREE.MathUtils.clamp(realism.windFlex + Math.abs(strength) * 0.22, 0, 1);
    } else if (field.type === "magnet") {
      realism.crownSpread = THREE.MathUtils.clamp(realism.crownSpread + strength * 0.18, 0, 1);
      realism.crownTaper = THREE.MathUtils.clamp(realism.crownTaper - strength * 0.12, 0, 1);
    } else if (field.type === "avoid") {
      realism.crownSpread = THREE.MathUtils.clamp(realism.crownSpread - Math.abs(strength) * 0.16, 0, 1);
      realism.branchGnarl = THREE.MathUtils.clamp(realism.branchGnarl + Math.abs(strength) * 0.18, 0, 1);
    } else if (field.type === "curl") {
      realism.branchGnarl = THREE.MathUtils.clamp(realism.branchGnarl + Math.abs(strength) * 0.28, 0, 1);
    }
  }
  return { ...genome, treeRealism: realism };
};

export const estimateProcPlantLods = (
  stats: ProcPlantStats,
  genome: ProcPlantGenome,
): ProcPlantLodPackage[] => {
  const treeScale = genome.habit === "tree" || genome.habit === "conifer" || genome.habit === "palm" ? 1.5 : 0.75;
  return [
    {
      level: 0,
      label: "full",
      distance: 0,
      triangleBudget: Math.ceil(stats.triangles),
      organBudget: stats.leaves + stats.flowers,
    },
    {
      level: 1,
      label: "clustered",
      distance: 18 * treeScale,
      triangleBudget: Math.ceil(stats.triangles * 0.48),
      organBudget: Math.ceil((stats.leaves + stats.flowers) * 0.5),
    },
    {
      level: 2,
      label: "billboard-cross",
      distance: 42 * treeScale,
      triangleBudget: 32,
      organBudget: 4,
    },
    {
      level: 3,
      label: "impostor",
      distance: 86 * treeScale,
      triangleBudget: 2,
      organBudget: 1,
    },
  ];
};

export const buildProcPlantRuntimePackage = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): ProcPlantRuntimePackage => {
  const built = buildProcPlantTemplate(genome, seed, env);
  const realism = treeRealismTraits(genome);
  const lods = estimateProcPlantLods(built.stats, genome);
  return {
    version: 1,
    seed,
    genomeId: genome.id,
    architecture: {
      backend: genome.spaceColonization
        ? "space-colonization"
        : genome.branchModules
          ? "branch-module-graph"
          : genome.weberPenn
            ? "weber-penn"
            : "procplant-graph",
      species: genome.weberPenn?.species,
      habit: genome.habit,
    },
    stats: built.stats,
    wind: {
      trunkSway: realism.windFlex * 0.24,
      branchSway: realism.windFlex * 0.62,
      leafFlutter: THREE.MathUtils.clamp(0.55 + realism.windFlex * 0.55, 0, 1),
    },
    lods,
    lodSelection: createProcPlantRuntimeLodSelectionContract(lods),
    ecology: procPlantEcologyProfiles[genome.id],
  };
};

export const procPlantPresetIds = Object.keys(procPlantPresets);
