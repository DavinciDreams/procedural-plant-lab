import * as THREE from "three";
import {
  buildProcPlantImpostorGeometry,
  PROCPLANT_IMPOSTOR_CONTRACT,
  PROCPLANT_IMPOSTOR_VERSION,
  type ProcPlantImpostorAtlas,
} from "./procplant-impostor";
import { encodeProcPlantImpostorPng } from "./procplant-impostor-image";
import {
  compileProcPlantLods,
  defaultPlantEnvironment,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantTemplate,
} from "./procplants";

/**
 * Explicit opt-in contract for the PRD's five semantically distinct LODs.
 * The default/Tellus runtime continues to emit runtime-lod-selection v1.
 */
export const PROCPLANT_FIVE_TIER_LOD_CONTRACT = "procplants.runtime-lod-selection" as const;
export const PROCPLANT_FIVE_TIER_LOD_VERSION = 2 as const;
export const PROCPLANT_FIVE_TIER_PACKAGE_CONTRACT = "procplants.five-tier-lod-package" as const;
export const PROCPLANT_FIVE_TIER_PACKAGE_VERSION = 1 as const;

export type ProcPlantFiveTierLodLevel = 0 | 1 | 2 | 3 | 4;
export type ProcPlantFiveTierLodLabel =
  | "full"
  | "rebuilt-reduced"
  | "clumped-cross"
  | "tree-impostor-cross"
  | "baked-billboard";

export interface ProcPlantFiveTierLodTier {
  id: string;
  level: ProcPlantFiveTierLodLevel;
  label: ProcPlantFiveTierLodLabel;
  minDistance: number;
  maxProjectedScreenHeight: number;
  triangles: number;
  vertices: number;
  representation: "procedural-mesh" | "procedural-cross-card" | "baked-atlas-cross" | "baked-atlas-billboard";
  templateContentHash: string;
}

export interface ProcPlantFiveTierLodSelectionContract {
  contract: typeof PROCPLANT_FIVE_TIER_LOD_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_LOD_VERSION;
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
  tiers: ProcPlantFiveTierLodTier[];
}

export interface ProcPlantFiveTierLodObservation {
  distance: number;
  projectedScreenHeight?: number;
  instanceMaxWorldScale?: number;
  previousTierId?: string;
  previousCulled?: boolean;
}

export interface ProcPlantFiveTierLodSelection {
  tierId: string;
  tierIndex: number;
  level: ProcPlantFiveTierLodLevel;
  culled: boolean;
  reason: "initial" | "stable" | "distance" | "screen" | "distance-and-screen" | "culled";
}

export interface ProcPlantFiveTierAtlasBinding {
  atlas: ProcPlantImpostorAtlas;
  atlasContentHash: string;
  genomeId: string;
  seed: number;
  /** Hash of the exact LOD0 geometry from which the caller baked the atlas. */
  sourceLod0ContentHash: string;
}

export interface ProcPlantFiveTierCompiledLod extends ProcPlantFiveTierLodTier {
  distance: number;
  template: ProcPlantTemplate;
}

export interface ProcPlantFiveTierLodPackage {
  contract: typeof PROCPLANT_FIVE_TIER_PACKAGE_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_PACKAGE_VERSION;
  genomeId: string;
  seed: number;
  sourceLod0ContentHash: string;
  lodSelection: ProcPlantFiveTierLodSelectionContract;
  lods: ProcPlantFiveTierCompiledLod[];
  impostor: {
    contract: typeof PROCPLANT_IMPOSTOR_CONTRACT;
    version: typeof PROCPLANT_IMPOSTOR_VERSION;
    contentHash: string;
    width: number;
    height: number;
    viewCount: number;
    viewCoverage: "azimuth" | "hemisphere";
  };
  /** Borrowed. The package never mutates or disposes caller-owned atlas bytes. */
  atlas: ProcPlantImpostorAtlas;
  /** Present only when compiled from a validated persisted WebGL atlas asset. */
  atlasAsset?: {
    contract: "procplants.five-tier-atlas-asset";
    version: 1;
    cacheKey: string;
    buildContract: "procplants.five-tier-atlas-build";
    buildVersion: 1;
    genomeId: string;
    seed: number;
    sourceLod0ContentHash: string;
    atlasContentHash: string;
  };
}

export interface ProcPlantFiveTierCompileOptions {
  bakedAtlas: ProcPlantFiveTierAtlasBinding;
  /** Hard resource ceiling for untrusted/imported baked assets. Defaults to 4096. */
  maxAtlasSize?: number;
  hysteresisRatio?: number;
  cullDistance?: number;
  cullProjectedScreenHeight?: number;
}

export interface ProcPlantFiveTierGlbExportOptions {
  name?: string;
  alphaTest?: number;
}

const textEncoder = new TextEncoder();

const hashBytes = (hash: number, bytes: Uint8Array) => {
  let result = hash >>> 0;
  for (const byte of bytes) {
    result ^= byte;
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result;
};

/** Stable FNV-1a hash used by bindings and deterministic regression fixtures. */
export const hashProcPlantFiveTierTemplate = (template: ProcPlantTemplate) => {
  let hash = hashBytes(0x811c9dc5, textEncoder.encode("procplants.five-tier-template:v1"));
  for (const [name, values] of [
    ["pos", template.pos],
    ["nrm", template.nrm],
    ["uv0", template.uv0],
    ["col", template.col],
    ["tintable", template.tintable],
    ["sway", template.sway],
    ["idx", template.idx],
  ] as const) {
    hash = hashBytes(hash, textEncoder.encode(`${name}:${values.length}:`));
    hash = hashBytes(hash, new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
  }
  return `fnv1a32-${hash.toString(16).padStart(8, "0")}`;
};

const templateFromImpostorGeometry = (geometry: THREE.BufferGeometry): ProcPlantTemplate => {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  if (!position || position.itemSize !== 3 || !normal || normal.itemSize !== 3 || !uv || uv.itemSize !== 2 || !index) {
    throw new Error("five-tier impostor geometry requires indexed position, normal, and UV attributes");
  }
  const vertices = position.count;
  const pos = new Float32Array(vertices * 3);
  const nrm = new Float32Array(vertices * 3);
  const uv0 = new Float32Array(vertices * 2);
  const col = new Float32Array(vertices * 3).fill(1);
  const tintable = new Uint8Array(vertices).fill(1);
  const sway = new Float32Array(vertices);
  for (let vertex = 0; vertex < vertices; vertex++) {
    pos.set([position.getX(vertex), position.getY(vertex), position.getZ(vertex)], vertex * 3);
    nrm.set([normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)], vertex * 3);
    uv0.set([uv.getX(vertex), uv.getY(vertex)], vertex * 2);
  }
  const idx = new Uint32Array(index.count);
  for (let offset = 0; offset < index.count; offset++) idx[offset] = index.getX(offset);
  return { pos, nrm, uv0, col, tintable, sway, idx };
};

export const createProcPlantFiveTierImpostorTemplate = (
  atlas: ProcPlantImpostorAtlas,
  mode: "cross" | "billboard",
  viewId = atlas.entries[0]?.id,
) => {
  if (!viewId) throw new Error("five-tier impostor atlas requires at least one baked view");
  const geometry = buildProcPlantImpostorGeometry(atlas, { mode, viewId });
  try {
    return templateFromImpostorGeometry(geometry);
  } finally {
    geometry.dispose();
  }
};

const validateAtlas = (binding: ProcPlantFiveTierAtlasBinding, maxAtlasSize: number) => {
  const { atlas } = binding;
  if (atlas.contract !== PROCPLANT_IMPOSTOR_CONTRACT || atlas.version !== PROCPLANT_IMPOSTOR_VERSION) {
    throw new Error("five-tier LOD requires a supported baked ProcPlant impostor atlas");
  }
  if (!Number.isInteger(maxAtlasSize) || maxAtlasSize < 16 || maxAtlasSize > 16384) {
    throw new Error("five-tier maxAtlasSize must be an integer in [16, 16384]");
  }
  if (!Number.isInteger(atlas.width) || !Number.isInteger(atlas.height)
    || atlas.width <= 0 || atlas.height <= 0
    || atlas.width > maxAtlasSize || atlas.height > maxAtlasSize) {
    throw new Error(`five-tier baked atlas exceeds the ${maxAtlasSize}px resource ceiling`);
  }
  if (atlas.rgba.byteLength !== atlas.width * atlas.height * 4) {
    throw new Error("five-tier baked atlas RGBA byte length is invalid");
  }
  if (!atlas.contentHash || atlas.entries.length === 0 || atlas.entries.length > 256) {
    throw new Error("five-tier baked atlas requires a content hash and 1-256 views");
  }
  const ids = atlas.entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => atlas.selection.orderedViewIds[index] !== id)) {
    throw new Error("five-tier baked atlas view IDs must be unique and match selection order");
  }
};

export const bindProcPlantFiveTierAtlas = (
  atlas: ProcPlantImpostorAtlas,
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): ProcPlantFiveTierAtlasBinding => ({
  atlas,
  atlasContentHash: atlas.contentHash,
  genomeId: genome.id,
  seed: seed >>> 0,
  sourceLod0ContentHash: hashProcPlantFiveTierTemplate(compileProcPlantLods(genome, seed, env)[0]!.template),
});

const SCREEN_THRESHOLDS = [1, 0.22, 0.075, 0.025, 0.009] as const;

export const validateProcPlantFiveTierLodSelectionContract = (
  value: ProcPlantFiveTierLodSelectionContract,
) => {
  if (value.contract !== PROCPLANT_FIVE_TIER_LOD_CONTRACT || value.version !== PROCPLANT_FIVE_TIER_LOD_VERSION) {
    throw new Error("unsupported ProcPlant five-tier runtime LOD contract or version");
  }
  if (value.policy.mode !== "hybrid"
    || value.policy.distanceMetric !== "camera-to-bounds-center-world-units"
    || value.policy.distanceNormalization !== "divide-by-instance-max-world-scale"
    || value.policy.screenMetric !== "projected-bounds-height-over-viewport-height"
    || value.policy.culling.rule !== "either") {
    throw new Error("unsupported ProcPlant five-tier selection policy");
  }
  if (!Number.isFinite(value.policy.hysteresisRatio)
    || value.policy.hysteresisRatio < 0 || value.policy.hysteresisRatio >= 0.5) {
    throw new Error("five-tier hysteresisRatio must be finite in [0, 0.5)");
  }
  if (value.tiers.length !== 5) throw new Error("five-tier runtime LOD contract requires exactly five tiers");
  const labels: readonly ProcPlantFiveTierLodLabel[] = [
    "full", "rebuilt-reduced", "clumped-cross", "tree-impostor-cross", "baked-billboard",
  ];
  const representations: readonly ProcPlantFiveTierLodTier["representation"][] = [
    "procedural-mesh", "procedural-mesh", "procedural-cross-card", "baked-atlas-cross", "baked-atlas-billboard",
  ];
  let priorDistance = -1;
  let priorScreen = Number.POSITIVE_INFINITY;
  for (let level = 0; level < value.tiers.length; level++) {
    const tier = value.tiers[level]!;
    if (tier.level !== level || tier.label !== labels[level] || tier.id !== `lod${level}-${labels[level]}`
      || tier.representation !== representations[level]) {
      throw new Error(`five-tier LOD${level} identity is invalid`);
    }
    if (!Number.isFinite(tier.minDistance) || tier.minDistance < priorDistance
      || !Number.isFinite(tier.maxProjectedScreenHeight) || tier.maxProjectedScreenHeight <= 0
      || tier.maxProjectedScreenHeight > priorScreen
      || !Number.isFinite(tier.triangles) || tier.triangles <= 0
      || !Number.isFinite(tier.vertices) || tier.vertices <= 0
      || !/^fnv1a32-[0-9a-f]{8}$/.test(tier.templateContentHash)) {
      throw new Error(`five-tier LOD${level} thresholds, costs, or hash are invalid`);
    }
    priorDistance = tier.minDistance;
    priorScreen = tier.maxProjectedScreenHeight;
  }
  if (!Number.isFinite(value.policy.culling.minDistance)
    || value.policy.culling.minDistance <= priorDistance
    || !Number.isFinite(value.policy.culling.maxProjectedScreenHeight)
    || value.policy.culling.maxProjectedScreenHeight < 0
    || value.policy.culling.maxProjectedScreenHeight >= priorScreen) {
    throw new Error("five-tier culling must occur beyond the baked billboard tier");
  }
  return value;
};

const createSelectionContract = (
  lods: readonly ProcPlantFiveTierCompiledLod[],
  options: ProcPlantFiveTierCompileOptions,
): ProcPlantFiveTierLodSelectionContract => {
  const lastDistance = lods[4]!.distance;
  const contract: ProcPlantFiveTierLodSelectionContract = {
    contract: PROCPLANT_FIVE_TIER_LOD_CONTRACT,
    version: PROCPLANT_FIVE_TIER_LOD_VERSION,
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
    tiers: lods.map(({ template: _template, distance, ...tier }) => ({ ...tier, minDistance: distance })),
  };
  return validateProcPlantFiveTierLodSelectionContract(contract);
};

export const compileProcPlantFiveTierLods = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
  options?: ProcPlantFiveTierCompileOptions,
): ProcPlantFiveTierLodPackage => {
  if (!options?.bakedAtlas) {
    throw new Error("five-tier LOD compilation requires an explicit bakedAtlas binding; no proxy billboard is synthesized");
  }
  validateAtlas(options.bakedAtlas, options.maxAtlasSize ?? 4096);
  const seed32 = seed >>> 0;
  if (options.bakedAtlas.genomeId !== genome.id || options.bakedAtlas.seed !== seed32) {
    throw new Error("five-tier baked atlas binding does not match the requested genome and seed");
  }
  if (options.bakedAtlas.atlasContentHash !== options.bakedAtlas.atlas.contentHash) {
    throw new Error("five-tier baked atlas binding content hash is stale");
  }
  const legacy = compileProcPlantLods(genome, seed32, env);
  const sourceHash = hashProcPlantFiveTierTemplate(legacy[0]!.template);
  if (options.bakedAtlas.sourceLod0ContentHash !== sourceHash) {
    throw new Error("five-tier baked atlas binding is stale for the current LOD0 geometry");
  }
  const atlas = options.bakedAtlas.atlas;
  const cross = createProcPlantFiveTierImpostorTemplate(atlas, "cross");
  const billboard = createProcPlantFiveTierImpostorTemplate(atlas, "billboard");
  const distances = [legacy[0]!.distance, legacy[1]!.distance, legacy[2]!.distance, legacy[3]!.distance, legacy[3]!.distance * 1.65] as const;
  const labels: readonly ProcPlantFiveTierLodLabel[] = [
    "full", "rebuilt-reduced", "clumped-cross", "tree-impostor-cross", "baked-billboard",
  ];
  const representations: readonly ProcPlantFiveTierLodTier["representation"][] = [
    "procedural-mesh", "procedural-mesh", "procedural-cross-card", "baked-atlas-cross", "baked-atlas-billboard",
  ];
  const templates = [legacy[0]!.template, legacy[1]!.template, legacy[2]!.template, cross, billboard] as const;
  const lods = templates.map((template, level): ProcPlantFiveTierCompiledLod => ({
    id: `lod${level}-${labels[level]}`,
    level: level as ProcPlantFiveTierLodLevel,
    label: labels[level]!,
    distance: distances[level]!,
    minDistance: distances[level]!,
    maxProjectedScreenHeight: SCREEN_THRESHOLDS[level]!,
    triangles: template.idx.length / 3,
    vertices: template.pos.length / 3,
    representation: representations[level]!,
    templateContentHash: hashProcPlantFiveTierTemplate(template),
    template,
  }));
  const elevations = new Set(atlas.entries.map((entry) => entry.view.elevationIndex));
  return {
    contract: PROCPLANT_FIVE_TIER_PACKAGE_CONTRACT,
    version: PROCPLANT_FIVE_TIER_PACKAGE_VERSION,
    genomeId: genome.id,
    seed: seed32,
    sourceLod0ContentHash: sourceHash,
    lodSelection: createSelectionContract(lods, options),
    lods,
    impostor: {
      contract: atlas.contract,
      version: atlas.version,
      contentHash: atlas.contentHash,
      width: atlas.width,
      height: atlas.height,
      viewCount: atlas.entries.length,
      viewCoverage: elevations.size > 1 ? "hemisphere" : "azimuth",
    },
    atlas,
  };
};

export const validateProcPlantFiveTierLodPackage = (
  value: ProcPlantFiveTierLodPackage,
  options: { maxAtlasSize?: number } = {},
) => {
  if (value.contract !== PROCPLANT_FIVE_TIER_PACKAGE_CONTRACT
    || value.version !== PROCPLANT_FIVE_TIER_PACKAGE_VERSION) {
    throw new Error("unsupported ProcPlant five-tier LOD package");
  }
  if (!value.genomeId || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) {
    throw new Error("five-tier LOD package genomeId or seed is invalid");
  }
  validateAtlas({
    atlas: value.atlas,
    atlasContentHash: value.atlas.contentHash,
    genomeId: value.genomeId,
    seed: value.seed,
    sourceLod0ContentHash: value.sourceLod0ContentHash,
  }, options.maxAtlasSize ?? 4096);
  validateProcPlantFiveTierLodSelectionContract(value.lodSelection);
  if (value.lods.length !== 5 || value.sourceLod0ContentHash !== value.lods[0]?.templateContentHash) {
    throw new Error("five-tier LOD package must contain five tiers bound to LOD0");
  }
  for (let level = 0; level < 5; level++) {
    const lod = value.lods[level]!;
    const tier = value.lodSelection.tiers[level]!;
    const vertices = lod.template.pos.length / 3;
    const triangles = lod.template.idx.length / 3;
    const contentHash = hashProcPlantFiveTierTemplate(lod.template);
    if (lod.level !== level || lod.id !== tier.id || lod.label !== tier.label
      || lod.representation !== tier.representation || lod.distance !== tier.minDistance
      || lod.maxProjectedScreenHeight !== tier.maxProjectedScreenHeight
      || lod.vertices !== vertices || lod.triangles !== triangles
      || lod.vertices !== tier.vertices || lod.triangles !== tier.triangles
      || lod.templateContentHash !== contentHash || lod.templateContentHash !== tier.templateContentHash) {
      throw new Error(`five-tier LOD${level} geometry or selection metadata is inconsistent`);
    }
  }
  const elevations = new Set(value.atlas.entries.map((entry) => entry.view.elevationIndex));
  if (value.impostor.contract !== value.atlas.contract || value.impostor.version !== value.atlas.version
    || value.impostor.contentHash !== value.atlas.contentHash
    || value.impostor.width !== value.atlas.width || value.impostor.height !== value.atlas.height
    || value.impostor.viewCount !== value.atlas.entries.length
    || value.impostor.viewCoverage !== (elevations.size > 1 ? "hemisphere" : "azimuth")) {
    throw new Error("five-tier LOD package impostor metadata is inconsistent");
  }
  if (value.atlasAsset !== undefined && (
    value.atlasAsset.contract !== "procplants.five-tier-atlas-asset"
    || value.atlasAsset.version !== 1
    || value.atlasAsset.buildContract !== "procplants.five-tier-atlas-build"
    || value.atlasAsset.buildVersion !== 1
    || !/^procplants-lod5-atlas-v1-[0-9a-f]{8}$/.test(value.atlasAsset.cacheKey)
    || value.atlasAsset.genomeId !== value.genomeId
    || value.atlasAsset.seed !== value.seed
    || value.atlasAsset.sourceLod0ContentHash !== value.sourceLod0ContentHash
    || value.atlasAsset.atlasContentHash !== value.atlas.contentHash
  )) throw new Error("five-tier LOD package atlas asset provenance is invalid");
  return value;
};

export const selectProcPlantFiveTierLod = (
  contract: ProcPlantFiveTierLodSelectionContract,
  observation: ProcPlantFiveTierLodObservation,
): ProcPlantFiveTierLodSelection => {
  validateProcPlantFiveTierLodSelectionContract(contract);
  if (!Number.isFinite(observation.distance) || observation.distance < 0) {
    throw new Error("five-tier LOD observation distance must be finite and non-negative");
  }
  if (observation.projectedScreenHeight !== undefined
    && (!Number.isFinite(observation.projectedScreenHeight) || observation.projectedScreenHeight < 0)) {
    throw new Error("five-tier projectedScreenHeight must be finite and non-negative");
  }
  const scale = observation.instanceMaxWorldScale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("five-tier instanceMaxWorldScale must be finite and positive");
  const distance = observation.distance / scale;
  const screen = observation.projectedScreenHeight;
  const hysteresis = contract.policy.hysteresisRatio;
  const previousIndex = observation.previousTierId === undefined
    ? -1
    : contract.tiers.findIndex((tier) => tier.id === observation.previousTierId);
  if (observation.previousTierId !== undefined && previousIndex < 0) {
    throw new Error(`unknown previous five-tier LOD: ${observation.previousTierId}`);
  }
  const desiredIndex = () => {
    let distanceIndex = 0;
    let screenIndex = 0;
    for (let index = 1; index < contract.tiers.length; index++) {
      if (distance >= contract.tiers[index]!.minDistance) distanceIndex = index;
      if (screen !== undefined && screen <= contract.tiers[index]!.maxProjectedScreenHeight) screenIndex = index;
    }
    return Math.max(distanceIndex, screenIndex);
  };
  const rawCull = distance >= contract.policy.culling.minDistance
    || (screen !== undefined && screen <= contract.policy.culling.maxProjectedScreenHeight);
  const culled = observation.previousCulled
    ? !(distance < contract.policy.culling.minDistance * (1 - hysteresis)
      && (screen === undefined || screen > contract.policy.culling.maxProjectedScreenHeight * (1 + hysteresis)))
    : distance >= contract.policy.culling.minDistance * (1 + (previousIndex >= 0 ? hysteresis : 0))
      || (screen !== undefined && screen <= contract.policy.culling.maxProjectedScreenHeight * (1 - (previousIndex >= 0 ? hysteresis : 0)));
  let tierIndex = previousIndex >= 0 ? previousIndex : desiredIndex();
  if (previousIndex >= 0 && !culled) {
    while (tierIndex < contract.tiers.length - 1) {
      const next = contract.tiers[tierIndex + 1]!;
      if (distance < next.minDistance * (1 + hysteresis)
        && (screen === undefined || screen > next.maxProjectedScreenHeight * (1 - hysteresis))) break;
      tierIndex++;
    }
    while (tierIndex > 0) {
      const current = contract.tiers[tierIndex]!;
      if (distance >= current.minDistance * (1 - hysteresis)
        || (screen !== undefined && screen <= current.maxProjectedScreenHeight * (1 + hysteresis))) break;
      tierIndex--;
    }
  }
  const tier = contract.tiers[tierIndex]!;
  const distanceSelected = tierIndex > 0 && distance >= tier.minDistance;
  const screenSelected = tierIndex > 0 && screen !== undefined && screen <= tier.maxProjectedScreenHeight;
  return {
    tierId: tier.id,
    tierIndex,
    level: tier.level,
    culled: previousIndex < 0 ? rawCull : culled,
    reason: culled
      ? "culled"
      : previousIndex < 0
        ? "initial"
        : tierIndex === previousIndex
          ? "stable"
          : distanceSelected && screenSelected
            ? "distance-and-screen"
            : screenSelected ? "screen" : "distance",
  };
};

const atlasManifest = (atlas: ProcPlantImpostorAtlas) => ({
  contract: atlas.contract,
  version: atlas.version,
  contentHash: atlas.contentHash,
  width: atlas.width,
  height: atlas.height,
  padding: atlas.padding,
  selection: atlas.selection,
  entries: atlas.entries.map((entry) => ({
    id: entry.id,
    uv: entry.uv,
    paddedUv: entry.paddedUv,
    outward: entry.view.outward,
    elevation: entry.view.elevation,
    projectedPivot: entry.view.projectedPivot,
  })),
});

/**
 * Export a standards-valid GLB with ordinary extras. No nonexistent Khronos
 * LOD extension is advertised; consumers opt into the version-2 metadata.
 */
export const exportProcPlantFiveTierLodGlb = async (
  source: ProcPlantFiveTierLodPackage,
  options: ProcPlantFiveTierGlbExportOptions = {},
) => {
  validateProcPlantFiveTierLodPackage(source);
  const name = options.name ?? `procplant-${source.genomeId}-five-tier`;
  const sceneExtras = {
    contract: source.contract,
    version: source.version,
    genomeId: source.genomeId,
    seed: source.seed,
    lodSelection: source.lodSelection,
    impostor: atlasManifest(source.atlas),
    ...(source.atlasAsset ? { atlasAsset: source.atlasAsset } : {}),
    standards: { metadata: "glTF-extras", khronosLodExtension: null },
  };
  const binaryParts: Uint8Array[] = [];
  const bufferViews: Array<Record<string, number | string>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  let binaryLength = 0;
  const append = (bytes: Uint8Array, target?: 34962 | 34963, namePart?: string) => {
    const aligned = (binaryLength + 3) & ~3;
    if (aligned > binaryLength) binaryParts.push(new Uint8Array(aligned - binaryLength));
    const index = bufferViews.length;
    bufferViews.push({
      ...(namePart ? { name: namePart } : {}),
      buffer: 0,
      byteOffset: aligned,
      byteLength: bytes.byteLength,
      ...(target ? { target } : {}),
    });
    binaryParts.push(bytes.slice());
    binaryLength = aligned + bytes.byteLength;
    return index;
  };
  const bytesOf = (values: ArrayBufferView) => new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  const addAccessor = (
    view: number,
    componentType: 5121 | 5125 | 5126,
    count: number,
    type: "SCALAR" | "VEC2" | "VEC3",
    extras: Record<string, unknown> = {},
  ) => {
    const index = accessors.length;
    accessors.push({ bufferView: view, byteOffset: 0, componentType, count, type, ...extras });
    return index;
  };
  const meshes: Array<Record<string, unknown>> = [];
  const nodes: Array<Record<string, unknown>> = [];
  for (const lod of source.lods) {
    const template = lod.template;
    const gltfUv = lod.level >= 3
      ? Float32Array.from(template.uv0, (value, index) => index % 2 === 1 ? 1 - value : value)
      : template.uv0;
    const positionView = append(bytesOf(template.pos), 34962, `lod${lod.level}-positions`);
    const normalView = append(bytesOf(template.nrm), 34962, `lod${lod.level}-normals`);
    const uvView = append(bytesOf(gltfUv), 34962, `lod${lod.level}-uv0`);
    const colorView = append(bytesOf(template.col), 34962, `lod${lod.level}-colors`);
    const swayView = append(bytesOf(template.sway), 34962, `lod${lod.level}-sway`);
    const tintableView = append(bytesOf(template.tintable), 34962, `lod${lod.level}-tintable`);
    const indexView = append(bytesOf(template.idx), 34963, `lod${lod.level}-indices`);
    const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (let vertex = 0; vertex < template.pos.length; vertex += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, template.pos[vertex + axis]!);
        max[axis] = Math.max(max[axis]!, template.pos[vertex + axis]!);
      }
    }
    const attributes = {
      POSITION: addAccessor(positionView, 5126, lod.vertices, "VEC3", { min, max }),
      NORMAL: addAccessor(normalView, 5126, lod.vertices, "VEC3"),
      TEXCOORD_0: addAccessor(uvView, 5126, lod.vertices, "VEC2"),
      COLOR_0: addAccessor(colorView, 5126, lod.vertices, "VEC3"),
      _PROCPLANTSWAY: addAccessor(swayView, 5126, lod.vertices, "SCALAR"),
      _PROCPLANTTINTABLE: addAccessor(tintableView, 5121, lod.vertices, "SCALAR"),
    };
    const indices = addAccessor(indexView, 5125, template.idx.length, "SCALAR", {
      min: [template.idx.reduce((lowest, value) => Math.min(lowest, value), Number.POSITIVE_INFINITY)],
      max: [template.idx.reduce((highest, value) => Math.max(highest, value), 0)],
    });
    const meshIndex = meshes.length;
    meshes.push({
      name: `${name}-lod${lod.level}-${lod.label}`,
      primitives: [{ attributes, indices, material: lod.level >= 3 ? 1 : 0, mode: 4 }],
    });
    const nodeMetadata = {
      id: lod.id,
      level: lod.level,
      label: lod.label,
      distance: lod.distance,
      representation: lod.representation,
      triangles: lod.triangles,
      vertices: lod.vertices,
      templateContentHash: lod.templateContentHash,
      ...(lod.level >= 3 ? {
        impostorContentHash: source.impostor.contentHash,
        gltfUvTransform: "v=1-v",
      } : {}),
    };
    nodes.push({
      name: `${name}-lod${lod.level}-${lod.label}`,
      mesh: meshIndex,
      extras: {
        procplant: {
          contract: "procplants.glb-export",
          contractVersion: 1,
          sourceKind: "five-tier-lod-set",
          lod: nodeMetadata,
        },
        procplantFiveTierLod: nodeMetadata,
      },
    });
  }
  const png = encodeProcPlantImpostorPng(source.atlas.rgba, source.atlas.width, source.atlas.height);
  const imageView = append(png, undefined, "five-tier-impostor-atlas-png");
  const alphaCutoff = THREE.MathUtils.clamp(options.alphaTest ?? 0.08, 0, 1);
  const json = {
    asset: { version: "2.0", generator: "procplants five-tier LOD exporter v1" },
    scene: 0,
    scenes: source.lods.map((lod, index) => ({
      name: `${name}-lod${lod.level}-${lod.label}`,
      nodes: [index],
      extras: {
        procplant: {
          contract: "procplants.glb-export",
          contractVersion: 1,
          sourceKind: "five-tier-lod-set",
          genomeId: source.genomeId,
          seed: source.seed,
          lod: { id: lod.id, level: lod.level, label: lod.label },
        },
        procplantFiveTierLod: {
          contract: source.contract,
          version: source.version,
          tierId: lod.id,
          level: lod.level,
          selection: "select-gltf-scene",
        },
      },
    })),
    nodes,
    meshes,
    materials: [
      {
        name: `${name}-vertex-material`,
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.82 },
      },
      {
        name: `${name}-atlas-material`,
        doubleSided: true,
        alphaMode: "MASK",
        alphaCutoff,
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          baseColorTexture: { index: 0, texCoord: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    textures: [{ sampler: 0, source: 0 }],
    images: [{
      name: `${name}-impostor-atlas`,
      bufferView: imageView,
      mimeType: "image/png",
      extras: { contentHash: source.atlas.contentHash, width: source.atlas.width, height: source.atlas.height },
    }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: (binaryLength + 3) & ~3 }],
    extras: {
      procplantFiveTierLod: {
        ...sceneExtras,
        selection: "select-gltf-scene",
        defaultScene: 0,
        scenes: source.lods.map((lod, scene) => ({ scene, tierId: lod.id, level: lod.level })),
      },
    },
  };
  const jsonBytes = textEncoder.encode(JSON.stringify(json));
  const paddedJsonLength = (jsonBytes.byteLength + 3) & ~3;
  const paddedBinaryLength = (binaryLength + 3) & ~3;
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinaryLength;
  const output = new ArrayBuffer(totalLength);
  const outputBytes = new Uint8Array(output);
  const outputView = new DataView(output);
  outputView.setUint32(0, 0x46546c67, true);
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, totalLength, true);
  outputView.setUint32(12, paddedJsonLength, true);
  outputView.setUint32(16, 0x4e4f534a, true);
  outputBytes.fill(0x20, 20, 20 + paddedJsonLength);
  outputBytes.set(jsonBytes, 20);
  const binaryHeader = 20 + paddedJsonLength;
  outputView.setUint32(binaryHeader, paddedBinaryLength, true);
  outputView.setUint32(binaryHeader + 4, 0x004e4942, true);
  let offset = binaryHeader + 8;
  for (const part of binaryParts) {
    outputBytes.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};
