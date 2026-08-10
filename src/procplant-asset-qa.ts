import {
  defaultPlantEnvironment,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantInstancedParts,
} from "./procplants";
import {
  inspectProcPlantReadiness,
  type ProcPlantExportProfileId,
  type ProcPlantReadinessReport,
} from "./plant-readiness";

export type ProcPlantAssetQaProfileId =
  | "tellus-realtime"
  | "threejs-glb"
  | "unity-urp"
  | "unreal-foliage"
  | "cinema-hero"
  | "mobile-low-poly"
  | "billboard-only";

export interface ProcPlantTextureQaInput {
  id: string;
  width: number;
  height: number;
  channels?: 1 | 2 | 3 | 4;
  bytesPerChannel?: 1 | 2 | 4;
  mipmapped?: boolean;
  compressedBytes?: number;
}

export interface ProcPlantAssetQaOptions {
  textures?: readonly ProcPlantTextureQaInput[];
  /** Fraction of an alpha-tested card covered by visible pixels. */
  cutoutCoverage?: number;
  providesUvs?: boolean;
  providesTangents?: boolean;
  branchLeafIntersections?: number;
  /** Exact already-authored geometry, used when edits differ from the genome compiler source. */
  structuralParts?: ProcPlantInstancedParts;
}

export interface ProcPlantAssetQaProfile {
  id: ProcPlantAssetQaProfileId;
  structuralProfile: ProcPlantExportProfileId;
  maxTextureBytes: number;
  maxEstimatedOverdraw: number;
  requireUvs: boolean;
  requireTangents: boolean;
  exportContract: {
    texture: {
      maxDimension: number;
      packing: "separate-pbr" | "base-orm-normal" | "rgba-atlas";
      mipmaps: boolean;
      compression: "png" | "ktx2-etc1s-uastc";
    };
    /** Default-scale generator distances; scaled plant packages retain their authored distances. */
    lodDistances: readonly [number, number, number, number];
    windPacking: "explicit-sway-phase" | "vertex-color-rgb" | "none";
    billboard: {
      enabled: boolean;
      views: number;
      channels: readonly ("color" | "normal" | "depth")[];
      maxAtlasDimension: number;
    };
    collision: "none" | "bounds-box" | "trunk-capsule";
    metadataSchema: "procplants.glb-export.v1" | "procplants.runtime-package.v1";
  };
}

export const PROCPLANT_ASSET_QA_PROFILES: Readonly<Record<ProcPlantAssetQaProfileId, ProcPlantAssetQaProfile>> = {
  "tellus-realtime": {
    id: "tellus-realtime",
    structuralProfile: "tellus-realtime",
    maxTextureBytes: 16 * 1024 * 1024,
    maxEstimatedOverdraw: 2.5,
    requireUvs: false,
    requireTangents: false,
    exportContract: {
      texture: { maxDimension: 2048, packing: "base-orm-normal", mipmaps: true, compression: "ktx2-etc1s-uastc" },
      lodDistances: [0, 18, 42, 86], windPacking: "explicit-sway-phase",
      billboard: { enabled: true, views: 16, channels: ["color", "normal", "depth"], maxAtlasDimension: 2048 },
      collision: "trunk-capsule", metadataSchema: "procplants.runtime-package.v1",
    },
  },
  "threejs-glb": {
    id: "threejs-glb",
    structuralProfile: "web-preview",
    maxTextureBytes: 32 * 1024 * 1024,
    maxEstimatedOverdraw: 3,
    requireUvs: false,
    requireTangents: false,
    exportContract: {
      texture: { maxDimension: 4096, packing: "separate-pbr", mipmaps: true, compression: "ktx2-etc1s-uastc" },
      lodDistances: [0, 18, 42, 86], windPacking: "explicit-sway-phase",
      billboard: { enabled: true, views: 16, channels: ["color", "normal", "depth"], maxAtlasDimension: 4096 },
      collision: "bounds-box", metadataSchema: "procplants.glb-export.v1",
    },
  },
  "unity-urp": {
    id: "unity-urp",
    structuralProfile: "tellus-realtime",
    maxTextureBytes: 24 * 1024 * 1024,
    maxEstimatedOverdraw: 2.5,
    requireUvs: true,
    requireTangents: true,
    exportContract: {
      texture: { maxDimension: 4096, packing: "base-orm-normal", mipmaps: true, compression: "ktx2-etc1s-uastc" },
      lodDistances: [0, 18, 42, 86], windPacking: "vertex-color-rgb",
      billboard: { enabled: true, views: 16, channels: ["color", "normal"], maxAtlasDimension: 4096 },
      collision: "trunk-capsule", metadataSchema: "procplants.glb-export.v1",
    },
  },
  "unreal-foliage": {
    id: "unreal-foliage",
    structuralProfile: "tellus-realtime",
    maxTextureBytes: 32 * 1024 * 1024,
    maxEstimatedOverdraw: 2.5,
    requireUvs: true,
    requireTangents: true,
    exportContract: {
      texture: { maxDimension: 4096, packing: "base-orm-normal", mipmaps: true, compression: "ktx2-etc1s-uastc" },
      lodDistances: [0, 18, 42, 86], windPacking: "vertex-color-rgb",
      billboard: { enabled: true, views: 16, channels: ["color", "normal"], maxAtlasDimension: 4096 },
      collision: "trunk-capsule", metadataSchema: "procplants.glb-export.v1",
    },
  },
  "cinema-hero": {
    id: "cinema-hero",
    structuralProfile: "hero-asset",
    maxTextureBytes: 128 * 1024 * 1024,
    maxEstimatedOverdraw: 4,
    requireUvs: true,
    requireTangents: true,
    exportContract: {
      texture: { maxDimension: 8192, packing: "separate-pbr", mipmaps: true, compression: "png" },
      lodDistances: [0, 24, 60, 120], windPacking: "explicit-sway-phase",
      billboard: { enabled: false, views: 0, channels: [], maxAtlasDimension: 0 },
      collision: "none", metadataSchema: "procplants.glb-export.v1",
    },
  },
  "mobile-low-poly": {
    id: "mobile-low-poly",
    structuralProfile: "tellus-realtime",
    maxTextureBytes: 8 * 1024 * 1024,
    maxEstimatedOverdraw: 1.9,
    requireUvs: false,
    requireTangents: false,
    exportContract: {
      texture: { maxDimension: 1024, packing: "rgba-atlas", mipmaps: true, compression: "ktx2-etc1s-uastc" },
      lodDistances: [0, 12, 28, 54], windPacking: "explicit-sway-phase",
      billboard: { enabled: true, views: 8, channels: ["color"], maxAtlasDimension: 1024 },
      collision: "bounds-box", metadataSchema: "procplants.runtime-package.v1",
    },
  },
  "billboard-only": {
    id: "billboard-only",
    structuralProfile: "web-preview",
    maxTextureBytes: 8 * 1024 * 1024,
    maxEstimatedOverdraw: 1.6,
    requireUvs: true,
    requireTangents: false,
    exportContract: {
      texture: { maxDimension: 2048, packing: "rgba-atlas", mipmaps: true, compression: "ktx2-etc1s-uastc" },
      lodDistances: [0, 0, 0, 0], windPacking: "none",
      billboard: { enabled: true, views: 16, channels: ["color", "normal", "depth"], maxAtlasDimension: 2048 },
      collision: "none", metadataSchema: "procplants.glb-export.v1",
    },
  },
};

export interface ProcPlantAssetQaReport {
  version: 2;
  profile: ProcPlantAssetQaProfileId;
  ready: boolean;
  score: number;
  structural: ProcPlantReadinessReport;
  overdraw: {
    method: "coverage-estimate";
    cutoutCoverage: number;
    estimatedRatio: number;
  };
  textures: {
    count: number;
    estimatedBytes: number;
    budgetBytes: number;
  };
  attributes: {
    positions: true;
    normals: true;
    vertexColors: true;
    sway: true;
    uvs: boolean;
    tangents: boolean;
  };
  intersections: {
    branchLeaf: number;
    method: "caller-supplied";
  };
  exportContract: ProcPlantAssetQaProfile["exportContract"];
  warnings: string[];
}

const finiteDimension = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
};

export const estimateProcPlantTextureBytes = (textures: readonly ProcPlantTextureQaInput[] = []) =>
  textures.reduce((total, texture) => {
    if (texture.compressedBytes !== undefined) {
      if (!Number.isFinite(texture.compressedBytes) || texture.compressedBytes < 0) {
        throw new Error(`${texture.id}.compressedBytes must be finite and non-negative.`);
      }
      return total + Math.round(texture.compressedBytes);
    }
    const width = finiteDimension(texture.width, `${texture.id}.width`);
    const height = finiteDimension(texture.height, `${texture.id}.height`);
    const channels = texture.channels ?? 4;
    const bytesPerChannel = texture.bytesPerChannel ?? 1;
    const mipFactor = texture.mipmapped === false ? 1 : 4 / 3;
    return total + Math.ceil(width * height * channels * bytesPerChannel * mipFactor);
  }, 0);

export const inspectProcPlantAssetQa = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
  profileId: ProcPlantAssetQaProfileId = "tellus-realtime",
  options: ProcPlantAssetQaOptions = {},
): ProcPlantAssetQaReport => {
  const profile = PROCPLANT_ASSET_QA_PROFILES[profileId];
  const structural = inspectProcPlantReadiness(genome, seed, env, profile.structuralProfile, options.structuralParts);
  const coverage = Math.min(1, Math.max(0.05, options.cutoutCoverage ?? 1));
  const organFraction = structural.geometry.triangles > 0
    ? structural.geometry.organTriangles / structural.geometry.triangles
    : 0;
  const estimatedOverdraw = 1 + organFraction * (1 / coverage - 1);
  const textureBytes = estimateProcPlantTextureBytes(options.textures);
  const intersections = Math.max(0, Math.round(options.branchLeafIntersections ?? 0));
  const attributes = {
    positions: true as const,
    normals: true as const,
    vertexColors: true as const,
    sway: true as const,
    uvs: options.providesUvs ?? false,
    tangents: options.providesTangents ?? false,
  };
  const warnings = [...structural.warnings];
  if (estimatedOverdraw > profile.maxEstimatedOverdraw) {
    warnings.push(`Estimated alpha overdraw ${estimatedOverdraw.toFixed(2)} exceeds ${profile.maxEstimatedOverdraw.toFixed(2)}.`);
  }
  if (textureBytes > profile.maxTextureBytes) {
    warnings.push(`Texture memory ${textureBytes} bytes exceeds ${profile.maxTextureBytes}.`);
  }
  if (profile.requireUvs && !attributes.uvs) warnings.push("UVs are required by this export profile.");
  if (profile.requireTangents && !attributes.tangents) warnings.push("Tangents are required by this export profile.");
  if (intersections > 0) warnings.push(`${intersections} branch/leaf intersections require review.`);

  let score = structural.score;
  if (estimatedOverdraw > profile.maxEstimatedOverdraw) score -= Math.min(15, Math.ceil((estimatedOverdraw - profile.maxEstimatedOverdraw) * 8));
  if (textureBytes > profile.maxTextureBytes) score -= Math.min(15, Math.ceil((textureBytes / profile.maxTextureBytes - 1) * 10));
  if (profile.requireUvs && !attributes.uvs) score -= 10;
  if (profile.requireTangents && !attributes.tangents) score -= 8;
  if (intersections > 0) score -= Math.min(12, intersections);
  score = Math.max(0, score);

  return {
    version: 2,
    profile: profileId,
    ready: structural.ready && warnings.length === 0 && score >= 80,
    score,
    structural,
    overdraw: {
      method: "coverage-estimate",
      cutoutCoverage: coverage,
      estimatedRatio: estimatedOverdraw,
    },
    textures: {
      count: options.textures?.length ?? 0,
      estimatedBytes: textureBytes,
      budgetBytes: profile.maxTextureBytes,
    },
    attributes,
    intersections: {
      branchLeaf: intersections,
      method: "caller-supplied",
    },
    exportContract: profile.exportContract,
    warnings,
  };
};
