import * as THREE from "three";
import {
  bindProcPlantFiveTierAtlas,
  compileProcPlantFiveTierLods,
  hashProcPlantFiveTierTemplate,
  PROCPLANT_FIVE_TIER_PACKAGE_CONTRACT,
  PROCPLANT_FIVE_TIER_PACKAGE_VERSION,
  type ProcPlantFiveTierCompileOptions,
  type ProcPlantFiveTierLodPackage,
} from "./procplant-five-tier-lod";
import {
  createProcPlantImpostorAtlasLayout,
  createProcPlantImpostorCapturePlan,
  hashProcPlantImpostorAtlasContent,
  PROCPLANT_IMPOSTOR_CONTRACT,
  PROCPLANT_IMPOSTOR_VERSION,
  type ProcPlantImpostorAtlas,
  type ProcPlantImpostorCapturePlan,
} from "./procplant-impostor";
import { bakeProcPlantThreeImpostor } from "./procplant-impostor-three";
import { createProcPlantThreeGeometry } from "./procplant-three-geometry";
import {
  compileProcPlantLods,
  defaultPlantEnvironment,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantTemplate,
} from "./procplants";

export const PROCPLANT_FIVE_TIER_ATLAS_BUILD_CONTRACT = "procplants.five-tier-atlas-build" as const;
export const PROCPLANT_FIVE_TIER_ATLAS_BUILD_VERSION = 1 as const;
export const PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT = "procplants.five-tier-atlas-asset" as const;
export const PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION = 1 as const;

const MAX_CAPTURE_DIMENSION = 2048;
const MAX_CAPTURE_VIEWS = 64;
const MAX_ATLAS_DIMENSION = 8192;
const MAX_ATLAS_BYTES = 256 * 1024 * 1024;
const DEFAULT_DOCUMENT_BYTES = 384 * 1024 * 1024;

export interface ProcPlantFiveTierAtlasBuildOptions {
  width?: number;
  height?: number;
  azimuthCount?: number;
  azimuthOffset?: number;
  elevations?: readonly number[];
  padding?: number;
  samples?: number;
  maxAtlasSize?: number;
  maxAtlasBytes?: number;
}

export interface ProcPlantFiveTierAtlasBuildManifest {
  contract: typeof PROCPLANT_FIVE_TIER_ATLAS_BUILD_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_ATLAS_BUILD_VERSION;
  cacheKey: string;
  source: {
    genomeId: string;
    seed: number;
    lod0ContentHash: string;
  };
  renderer: {
    api: "caller-owned-three-webgl";
    output: "rgba8-srgb-straight-alpha";
    materialPolicy: "procplant-vertex-color-unlit-v1";
  };
  capture: {
    plan: ProcPlantImpostorCapturePlan;
    samples: number;
  };
  atlas: {
    padding: number;
    powerOfTwo: true;
    maxSize: number;
    maxBytes: number;
    expectedWidth: number;
    expectedHeight: number;
    expectedRgbaBytes: number;
  };
}

export interface ProcPlantFiveTierAtlasAsset {
  contract: typeof PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION;
  cacheKey: string;
  build: ProcPlantFiveTierAtlasBuildManifest;
  atlas: ProcPlantImpostorAtlas;
  capture: {
    api: "three-webgl-render-target-readback";
    threeRevision: string;
    samplesRequested: number;
    samplesUsed: number;
    rendererMaxTextureSize: number;
  };
}

export interface ProcPlantFiveTierAtlasAssetDocument {
  contract: typeof PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION;
  cacheKey: string;
  build: ProcPlantFiveTierAtlasBuildManifest;
  capture: ProcPlantFiveTierAtlasAsset["capture"];
  atlas: {
    contract: typeof PROCPLANT_IMPOSTOR_CONTRACT;
    version: typeof PROCPLANT_IMPOSTOR_VERSION;
    contentHash: string;
    width: number;
    height: number;
    padding: number;
    rgbaEncoding: "base64-rgba8-top-left";
    rgbaByteLength: number;
    rgbaBase64: string;
  };
}

export interface ProcPlantFiveTierAtlasAssetReadOptions {
  maxDocumentBytes?: number;
  maxAtlasBytes?: number;
  maxAtlasSize?: number;
}

export interface ProcPlantFiveTierAtlasCaptureOptions {
  signal?: AbortSignal;
}

const textEncoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const record = (value: unknown, label: string) => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
};

const integer = (value: unknown, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value as number;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonical manifest numbers must be finite");
  return value;
};

const canonicalJson = (value: unknown) => JSON.stringify(canonicalize(value));

const fnv1a32 = (value: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of value) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32-${hash.toString(16).padStart(8, "0")}`;
};

const manifestCacheKey = (manifest: Omit<ProcPlantFiveTierAtlasBuildManifest, "cacheKey">) =>
  `procplants-lod5-atlas-v1-${fnv1a32(textEncoder.encode(canonicalJson(manifest))).slice("fnv1a32-".length)}`;

const templateBounds = (template: ProcPlantTemplate) => {
  if (template.pos.length < 3 || template.pos.length % 3 !== 0) throw new Error("LOD0 template must contain xyz positions");
  const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
  for (let offset = 0; offset < template.pos.length; offset += 3) {
    const x = template.pos[offset]!;
    const y = template.pos[offset + 1]!;
    const z = template.pos[offset + 2]!;
    if (![x, y, z].every(Number.isFinite)) throw new Error("LOD0 template positions must be finite");
    min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
  }
  const dx = max.x - min.x;
  const dy = max.y - min.y;
  const dz = max.z - min.z;
  const epsilon = Math.max(Math.hypot(dx, dy, dz) * 1e-5, 1e-4);
  if (dx <= 0) { min.x -= epsilon; max.x += epsilon; }
  if (dy <= 0) { min.y -= epsilon; max.y += epsilon; }
  if (dz <= 0) { min.z -= epsilon; max.z += epsilon; }
  return { min, max };
};

const planOptions = (plan: ProcPlantImpostorCapturePlan) => {
  const elevations = [...new Map(plan.views.map((view) => [view.elevationIndex, view.elevation])).entries()]
    .sort(([left], [right]) => left - right).map(([, elevation]) => elevation);
  if (elevations.length === 0 || plan.views.length % elevations.length !== 0) {
    throw new Error("five-tier atlas build plan has inconsistent elevation groups");
  }
  return {
    width: plan.width,
    height: plan.height,
    azimuthCount: plan.views.length / elevations.length,
    azimuthOffset: plan.views[0]!.azimuth,
    elevations,
    pivot: plan.pivot,
  };
};

export const validateProcPlantFiveTierAtlasBuildManifest = (
  value: unknown,
): ProcPlantFiveTierAtlasBuildManifest => {
  const manifest = record(value, "five-tier atlas build manifest") as unknown as ProcPlantFiveTierAtlasBuildManifest;
  if (manifest.contract !== PROCPLANT_FIVE_TIER_ATLAS_BUILD_CONTRACT
    || manifest.version !== PROCPLANT_FIVE_TIER_ATLAS_BUILD_VERSION) {
    throw new Error("unsupported five-tier atlas build manifest contract/version");
  }
  if (typeof manifest.cacheKey !== "string" || !/^procplants-lod5-atlas-v1-[0-9a-f]{8}$/.test(manifest.cacheKey)) {
    throw new Error("five-tier atlas build cacheKey is invalid");
  }
  const source = record(manifest.source, "five-tier atlas build source") as unknown as ProcPlantFiveTierAtlasBuildManifest["source"];
  if (typeof source.genomeId !== "string" || !source.genomeId
    || !/^fnv1a32-[0-9a-f]{8}$/.test(source.lod0ContentHash)) {
    throw new Error("five-tier atlas build source identity is invalid");
  }
  integer(source.seed, 0, 0xffffffff, "five-tier atlas build seed");
  const renderer = record(manifest.renderer, "five-tier atlas build renderer") as unknown as ProcPlantFiveTierAtlasBuildManifest["renderer"];
  if (renderer.api !== "caller-owned-three-webgl" || renderer.output !== "rgba8-srgb-straight-alpha"
    || renderer.materialPolicy !== "procplant-vertex-color-unlit-v1") {
    throw new Error("unsupported five-tier atlas renderer/material policy");
  }
  const capture = record(manifest.capture, "five-tier atlas build capture") as unknown as ProcPlantFiveTierAtlasBuildManifest["capture"];
  const plan = record(capture.plan, "five-tier atlas build capture plan") as unknown as ProcPlantImpostorCapturePlan;
  if (plan.contract !== PROCPLANT_IMPOSTOR_CONTRACT || plan.version !== PROCPLANT_IMPOSTOR_VERSION) {
    throw new Error("unsupported five-tier impostor capture plan");
  }
  integer(plan.width, 16, MAX_CAPTURE_DIMENSION, "five-tier capture width");
  integer(plan.height, 16, MAX_CAPTURE_DIMENSION, "five-tier capture height");
  if (!Array.isArray(plan.views) || plan.views.length < 1 || plan.views.length > MAX_CAPTURE_VIEWS) {
    throw new Error(`five-tier capture plan requires 1-${MAX_CAPTURE_VIEWS} views`);
  }
  const rebuiltPlan = createProcPlantImpostorCapturePlan(plan.bounds, planOptions(plan));
  if (canonicalJson(rebuiltPlan) !== canonicalJson(plan)) throw new Error("five-tier capture plan is not canonical");
  integer(capture.samples, 0, 16, "five-tier capture samples");
  const atlas = record(manifest.atlas, "five-tier atlas build limits") as unknown as ProcPlantFiveTierAtlasBuildManifest["atlas"];
  const padding = integer(atlas.padding, 0, 64, "five-tier atlas padding");
  if (atlas.powerOfTwo !== true) throw new Error("five-tier atlas build requires a power-of-two atlas");
  const maxSize = integer(atlas.maxSize, 16, MAX_ATLAS_DIMENSION, "five-tier atlas maxSize");
  const maxBytes = integer(atlas.maxBytes, 1, MAX_ATLAS_BYTES, "five-tier atlas maxBytes");
  const layout = createProcPlantImpostorAtlasLayout(plan, { padding, powerOfTwo: true, maxSize });
  const expectedBytes = layout.width * layout.height * 4;
  if (expectedBytes > maxBytes || atlas.expectedWidth !== layout.width || atlas.expectedHeight !== layout.height
    || atlas.expectedRgbaBytes !== expectedBytes) {
    throw new Error("five-tier atlas expected layout/byte budget is inconsistent");
  }
  const { cacheKey: _cacheKey, ...body } = manifest;
  if (manifest.cacheKey !== manifestCacheKey(body)) throw new Error("five-tier atlas build cacheKey is stale");
  return manifest;
};

export const createProcPlantFiveTierAtlasBuildManifest = (
  genome: ProcPlantGenome,
  seed = 1,
  environment: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: ProcPlantFiveTierAtlasBuildOptions = {},
): ProcPlantFiveTierAtlasBuildManifest => {
  const seed32 = seed >>> 0;
  const lod0 = compileProcPlantLods(genome, seed32, environment)[0]!.template;
  const width = integer(options.width ?? 128, 16, MAX_CAPTURE_DIMENSION, "five-tier capture width");
  const height = integer(options.height ?? 128, 16, MAX_CAPTURE_DIMENSION, "five-tier capture height");
  const azimuthCount = integer(options.azimuthCount ?? 8, 1, MAX_CAPTURE_VIEWS, "five-tier azimuthCount");
  const elevations = options.elevations ?? [0, Math.PI / 6];
  if (!Array.isArray(elevations) || elevations.length < 1 || azimuthCount * elevations.length > MAX_CAPTURE_VIEWS) {
    throw new Error(`five-tier atlas build requires 1-${MAX_CAPTURE_VIEWS} total views`);
  }
  const plan = createProcPlantImpostorCapturePlan(templateBounds(lod0), {
    width,
    height,
    azimuthCount,
    azimuthOffset: options.azimuthOffset,
    elevations,
  });
  const padding = integer(options.padding ?? 4, 0, 64, "five-tier atlas padding");
  const maxSize = integer(options.maxAtlasSize ?? 4096, 16, MAX_ATLAS_DIMENSION, "five-tier atlas maxSize");
  const maxBytes = integer(options.maxAtlasBytes ?? 64 * 1024 * 1024, 1, MAX_ATLAS_BYTES, "five-tier atlas maxBytes");
  const layout = createProcPlantImpostorAtlasLayout(plan, { padding, powerOfTwo: true, maxSize });
  const expectedRgbaBytes = layout.width * layout.height * 4;
  if (expectedRgbaBytes > maxBytes) throw new Error(`five-tier atlas layout exceeds maxAtlasBytes (${expectedRgbaBytes} > ${maxBytes})`);
  const body: Omit<ProcPlantFiveTierAtlasBuildManifest, "cacheKey"> = {
    contract: PROCPLANT_FIVE_TIER_ATLAS_BUILD_CONTRACT,
    version: PROCPLANT_FIVE_TIER_ATLAS_BUILD_VERSION,
    source: { genomeId: genome.id, seed: seed32, lod0ContentHash: hashProcPlantFiveTierTemplate(lod0) },
    renderer: {
      api: "caller-owned-three-webgl",
      output: "rgba8-srgb-straight-alpha",
      materialPolicy: "procplant-vertex-color-unlit-v1",
    },
    capture: {
      plan,
      samples: integer(options.samples ?? 4, 0, 16, "five-tier capture samples"),
    },
    atlas: {
      padding,
      powerOfTwo: true,
      maxSize,
      maxBytes,
      expectedWidth: layout.width,
      expectedHeight: layout.height,
      expectedRgbaBytes,
    },
  };
  return validateProcPlantFiveTierAtlasBuildManifest({ ...body, cacheKey: manifestCacheKey(body) });
};

const assertManifestSource = (
  manifest: ProcPlantFiveTierAtlasBuildManifest,
  genome: ProcPlantGenome,
  environment: ProcPlantEnvironment,
) => {
  if (genome.id !== manifest.source.genomeId) throw new Error("five-tier atlas manifest genome does not match requested genome");
  const lod0 = compileProcPlantLods(genome, manifest.source.seed, environment)[0]!.template;
  if (hashProcPlantFiveTierTemplate(lod0) !== manifest.source.lod0ContentHash) {
    throw new Error("five-tier atlas manifest is stale for the current LOD0 geometry");
  }
  const expected = createProcPlantFiveTierAtlasBuildManifest(genome, manifest.source.seed, environment, {
    width: manifest.capture.plan.width,
    height: manifest.capture.plan.height,
    azimuthCount: planOptions(manifest.capture.plan).azimuthCount,
    azimuthOffset: planOptions(manifest.capture.plan).azimuthOffset,
    elevations: planOptions(manifest.capture.plan).elevations,
    padding: manifest.atlas.padding,
    samples: manifest.capture.samples,
    maxAtlasSize: manifest.atlas.maxSize,
    maxAtlasBytes: manifest.atlas.maxBytes,
  });
  if (canonicalJson(expected) !== canonicalJson(manifest)) {
    throw new Error("five-tier atlas manifest does not match the deterministic source build plan");
  }
  return lod0;
};

const validateAtlasForManifest = (manifest: ProcPlantFiveTierAtlasBuildManifest, atlas: ProcPlantImpostorAtlas) => {
  if (atlas.contract !== PROCPLANT_IMPOSTOR_CONTRACT || atlas.version !== PROCPLANT_IMPOSTOR_VERSION
    || atlas.width !== manifest.atlas.expectedWidth || atlas.height !== manifest.atlas.expectedHeight
    || atlas.padding !== manifest.atlas.padding || atlas.rgba.byteLength !== manifest.atlas.expectedRgbaBytes
    || canonicalJson(atlas.plan) !== canonicalJson(manifest.capture.plan)) {
    throw new Error("five-tier captured atlas does not match its build manifest");
  }
  const layout = createProcPlantImpostorAtlasLayout(atlas.plan, {
    padding: atlas.padding,
    powerOfTwo: true,
    maxSize: manifest.atlas.maxSize,
  });
  if (canonicalJson(layout.entries) !== canonicalJson(atlas.entries)
    || atlas.selection.strategy !== "maximum-direction-dot"
    || atlas.selection.direction !== "plant-to-camera"
    || atlas.selection.upAxis !== "+Y"
    || atlas.selection.azimuthZero !== "+Z"
    || atlas.selection.positiveAzimuth !== "toward +X"
    || canonicalJson(atlas.selection.orderedViewIds) !== canonicalJson(atlas.entries.map((entry) => entry.id))) {
    throw new Error("five-tier captured atlas layout/selection is inconsistent");
  }
  const contentHash = hashProcPlantImpostorAtlasContent(atlas.plan, atlas.width, atlas.height, atlas.padding, atlas.entries, atlas.rgba);
  if (contentHash !== atlas.contentHash) throw new Error("five-tier captured atlas content hash is stale");
};

/**
 * Execute a versioned build manifest with a caller-owned real WebGL renderer.
 * This is deliberately a browser/caller step: headless Node does not pretend to
 * own a WebGL implementation. Renderer and source resources remain caller-owned.
 */
export const captureProcPlantFiveTierAtlasAsset = async (
  renderer: THREE.WebGLRenderer,
  manifestValue: ProcPlantFiveTierAtlasBuildManifest,
  genome: ProcPlantGenome,
  environment: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: ProcPlantFiveTierAtlasCaptureOptions = {},
): Promise<ProcPlantFiveTierAtlasAsset> => {
  const manifest = validateProcPlantFiveTierAtlasBuildManifest(manifestValue);
  const lod0 = assertManifestSource(manifest, genome, environment);
  if (!(renderer as THREE.WebGLRenderer & { isWebGLRenderer?: boolean })?.isWebGLRenderer) {
    throw new Error("five-tier atlas capture requires a caller-owned Three WebGLRenderer");
  }
  if (renderer.capabilities.maxTextureSize < Math.max(manifest.atlas.expectedWidth, manifest.atlas.expectedHeight)) {
    throw new Error("five-tier atlas capture exceeds the WebGL renderer maxTextureSize");
  }
  const prepared = createProcPlantThreeGeometry(lod0);
  prepared.geometry.clearGroups();
  const material = new THREE.MeshBasicMaterial({
    name: "procplant-lod5-capture-vertex-color",
    vertexColors: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: false,
  });
  const source = new THREE.Mesh(prepared.geometry, material);
  source.name = `procplant-${manifest.source.genomeId}-lod0-atlas-source`;
  let baked: Awaited<ReturnType<typeof bakeProcPlantThreeImpostor>> | null = null;
  try {
    const capturePlanOptions = planOptions(manifest.capture.plan);
    baked = await bakeProcPlantThreeImpostor(renderer, source, {
      ...capturePlanOptions,
      padding: manifest.atlas.padding,
      samples: manifest.capture.samples,
      signal: options.signal,
    });
    validateAtlasForManifest(manifest, baked.atlas);
    return {
      contract: PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT,
      version: PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION,
      cacheKey: manifest.cacheKey,
      build: manifest,
      atlas: baked.atlas,
      capture: {
        api: "three-webgl-render-target-readback",
        threeRevision: THREE.REVISION,
        samplesRequested: manifest.capture.samples,
        samplesUsed: Math.min(manifest.capture.samples, Math.max(0, renderer.capabilities.maxSamples ?? 0)),
        rendererMaxTextureSize: renderer.capabilities.maxTextureSize,
      },
    };
  } finally {
    baked?.dispose();
    prepared.geometry.dispose();
    material.dispose();
  }
};

const bytesToBase64 = (bytes: Uint8Array | Uint8ClampedArray) => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
  }
  return btoa(binary);
};

const base64ToBytes = (value: string, expectedBytes: number) => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("five-tier atlas asset RGBA base64 is invalid");
  }
  const expectedCharacters = Math.ceil(expectedBytes / 3) * 4;
  if (value.length !== expectedCharacters) throw new Error("five-tier atlas asset RGBA base64 length is inconsistent");
  const binary = atob(value);
  if (binary.length !== expectedBytes) throw new Error("five-tier atlas asset decoded RGBA length is inconsistent");
  return Uint8ClampedArray.from(binary, (character) => character.charCodeAt(0));
};

export const serializeProcPlantFiveTierAtlasAsset = (assetValue: ProcPlantFiveTierAtlasAsset) => {
  const asset = validateProcPlantFiveTierAtlasAsset(assetValue);
  const document: ProcPlantFiveTierAtlasAssetDocument = {
    contract: asset.contract,
    version: asset.version,
    cacheKey: asset.cacheKey,
    build: asset.build,
    capture: asset.capture,
    atlas: {
      contract: asset.atlas.contract,
      version: asset.atlas.version,
      contentHash: asset.atlas.contentHash,
      width: asset.atlas.width,
      height: asset.atlas.height,
      padding: asset.atlas.padding,
      rgbaEncoding: "base64-rgba8-top-left",
      rgbaByteLength: asset.atlas.rgba.byteLength,
      rgbaBase64: bytesToBase64(asset.atlas.rgba),
    },
  };
  return JSON.stringify(document);
};

export const parseProcPlantFiveTierAtlasAsset = (
  serialized: string,
  options: ProcPlantFiveTierAtlasAssetReadOptions = {},
): ProcPlantFiveTierAtlasAsset => {
  if (typeof serialized !== "string") throw new Error("five-tier atlas asset document must be text");
  const maxDocumentBytes = integer(options.maxDocumentBytes ?? DEFAULT_DOCUMENT_BYTES, 1, 512 * 1024 * 1024, "maxDocumentBytes");
  if (serialized.length > maxDocumentBytes) throw new Error("five-tier atlas asset document exceeds maxDocumentBytes");
  if (textEncoder.encode(serialized).byteLength > maxDocumentBytes) throw new Error("five-tier atlas asset document exceeds maxDocumentBytes");
  let value: unknown;
  try { value = JSON.parse(serialized); } catch (error) {
    throw new Error(`five-tier atlas asset is invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  const document = record(value, "five-tier atlas asset document") as unknown as ProcPlantFiveTierAtlasAssetDocument;
  if (document.contract !== PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT || document.version !== PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION) {
    throw new Error("unsupported five-tier atlas asset contract/version");
  }
  const build = validateProcPlantFiveTierAtlasBuildManifest(document.build);
  if (document.cacheKey !== build.cacheKey) throw new Error("five-tier atlas asset cacheKey does not match its build manifest");
  const capture = record(document.capture, "five-tier atlas asset capture") as unknown as ProcPlantFiveTierAtlasAsset["capture"];
  if (capture.api !== "three-webgl-render-target-readback" || typeof capture.threeRevision !== "string" || !capture.threeRevision
    || capture.samplesRequested !== build.capture.samples
    || !Number.isInteger(capture.samplesUsed) || capture.samplesUsed < 0 || capture.samplesUsed > capture.samplesRequested
    || !Number.isInteger(capture.rendererMaxTextureSize) || capture.rendererMaxTextureSize < Math.max(build.atlas.expectedWidth, build.atlas.expectedHeight)) {
    throw new Error("five-tier atlas asset capture provenance is invalid");
  }
  const encoded = record(document.atlas, "five-tier atlas asset atlas") as unknown as ProcPlantFiveTierAtlasAssetDocument["atlas"];
  if (encoded.contract !== PROCPLANT_IMPOSTOR_CONTRACT || encoded.version !== PROCPLANT_IMPOSTOR_VERSION
    || encoded.rgbaEncoding !== "base64-rgba8-top-left" || encoded.width !== build.atlas.expectedWidth
    || encoded.height !== build.atlas.expectedHeight || encoded.padding !== build.atlas.padding
    || encoded.rgbaByteLength !== build.atlas.expectedRgbaBytes || typeof encoded.contentHash !== "string") {
    throw new Error("five-tier atlas asset metadata does not match its build manifest");
  }
  const maxAtlasBytes = integer(options.maxAtlasBytes ?? build.atlas.maxBytes, 1, MAX_ATLAS_BYTES, "maxAtlasBytes");
  const maxAtlasSize = integer(options.maxAtlasSize ?? build.atlas.maxSize, 16, MAX_ATLAS_DIMENSION, "maxAtlasSize");
  if (encoded.rgbaByteLength > maxAtlasBytes || encoded.width > maxAtlasSize || encoded.height > maxAtlasSize) {
    throw new Error("five-tier atlas asset exceeds caller resource limits");
  }
  if (typeof encoded.rgbaBase64 !== "string") throw new Error("five-tier atlas asset RGBA payload is missing");
  const layout = createProcPlantImpostorAtlasLayout(build.capture.plan, {
    padding: build.atlas.padding,
    powerOfTwo: true,
    maxSize: build.atlas.maxSize,
  });
  const atlas: ProcPlantImpostorAtlas = {
    contract: PROCPLANT_IMPOSTOR_CONTRACT,
    version: PROCPLANT_IMPOSTOR_VERSION,
    width: encoded.width,
    height: encoded.height,
    padding: encoded.padding,
    rgba: base64ToBytes(encoded.rgbaBase64, encoded.rgbaByteLength),
    plan: build.capture.plan,
    entries: layout.entries,
    selection: {
      strategy: "maximum-direction-dot",
      direction: "plant-to-camera",
      upAxis: "+Y",
      azimuthZero: "+Z",
      positiveAzimuth: "toward +X",
      orderedViewIds: layout.entries.map((entry) => entry.id),
    },
    contentHash: encoded.contentHash,
  };
  const asset: ProcPlantFiveTierAtlasAsset = {
    contract: document.contract,
    version: document.version,
    cacheKey: document.cacheKey,
    build,
    atlas,
    capture,
  };
  return validateProcPlantFiveTierAtlasAsset(asset);
};

export const validateProcPlantFiveTierAtlasAsset = (
  value: ProcPlantFiveTierAtlasAsset,
): ProcPlantFiveTierAtlasAsset => {
  if (value.contract !== PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT || value.version !== PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION) {
    throw new Error("unsupported five-tier atlas asset contract/version");
  }
  const manifest = validateProcPlantFiveTierAtlasBuildManifest(value.build);
  if (value.cacheKey !== manifest.cacheKey) throw new Error("five-tier atlas asset cacheKey is stale");
  if (value.capture.api !== "three-webgl-render-target-readback" || !value.capture.threeRevision
    || value.capture.samplesRequested !== manifest.capture.samples
    || !Number.isInteger(value.capture.samplesUsed) || value.capture.samplesUsed < 0
    || value.capture.samplesUsed > value.capture.samplesRequested
    || !Number.isInteger(value.capture.rendererMaxTextureSize)
    || value.capture.rendererMaxTextureSize < Math.max(manifest.atlas.expectedWidth, manifest.atlas.expectedHeight)) {
    throw new Error("five-tier atlas asset requires WebGL readback provenance");
  }
  validateAtlasForManifest(manifest, value.atlas);
  return value;
};

/** Compile the v2 package only after asset, cache, source, and atlas validation. */
export const compileProcPlantFiveTierLodsFromAtlasAsset = (
  genome: ProcPlantGenome,
  assetValue: ProcPlantFiveTierAtlasAsset,
  environment: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: Omit<ProcPlantFiveTierCompileOptions, "bakedAtlas"> = {},
): ProcPlantFiveTierLodPackage => {
  const asset = validateProcPlantFiveTierAtlasAsset(assetValue);
  assertManifestSource(asset.build, genome, environment);
  const compiled = compileProcPlantFiveTierLods(genome, asset.build.source.seed, environment, {
    ...options,
    bakedAtlas: bindProcPlantFiveTierAtlas(asset.atlas, genome, asset.build.source.seed, environment),
  });
  if (compiled.contract !== PROCPLANT_FIVE_TIER_PACKAGE_CONTRACT || compiled.version !== PROCPLANT_FIVE_TIER_PACKAGE_VERSION) {
    throw new Error("five-tier atlas asset produced an unsupported LOD package");
  }
  return {
    ...compiled,
    atlasAsset: {
      contract: asset.contract,
      version: asset.version,
      cacheKey: asset.cacheKey,
      buildContract: asset.build.contract,
      buildVersion: asset.build.version,
      genomeId: asset.build.source.genomeId,
      seed: asset.build.source.seed,
      sourceLod0ContentHash: asset.build.source.lod0ContentHash,
      atlasContentHash: asset.atlas.contentHash,
    },
  };
};
