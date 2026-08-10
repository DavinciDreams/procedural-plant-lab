import * as THREE from "three";
import type { GLTFExporterOptions } from "three/addons/exporters/GLTFExporter.js";
import { exportProcPlantScenesGlb } from "./procplant-export";
import { encodeProcPlantImpostorPng } from "./procplant-impostor-image";
import {
  PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT,
  PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION,
  type ProcPlantMaterializedPlacementDecal,
  type ProcPlantPlacementDecalBinding,
} from "./procplant-organ-placement-overrides";
import { createProcPlantThreePlacementDecalGeometry } from "./procplant-placement-decal-three";

export const PROCPLANT_PLACEMENT_DECAL_PIXELS_CONTRACT = "procplants.placement-decal-pixels" as const;
export const PROCPLANT_PLACEMENT_DECAL_PIXELS_VERSION = 1 as const;
export const PROCPLANT_PLACEMENT_DECAL_GLB_CONTRACT = "procplants.placement-decal-glb" as const;
export const PROCPLANT_PLACEMENT_DECAL_GLB_VERSION = 1 as const;
export const PROCPLANT_PLACEMENT_DECAL_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const PROCPLANT_PLACEMENT_DECAL_MAX_PIXELS = 4096 * 4096;
export const PROCPLANT_PLACEMENT_DECAL_MAX_GLB_BYTES = 512 * 1024 * 1024;

export type ProcPlantPlacementDecalSourceMimeType = "image/png" | "image/webp" | "image/jpeg";

export interface ProcPlantPlacementDecalPixelSourceInput {
  binding: ProcPlantPlacementDecalBinding;
  sourceMimeType: ProcPlantPlacementDecalSourceMimeType;
  sourceBytes: Uint8Array;
  width: number;
  height: number;
  /** Browser-decoded RGBA8 pixels, in upper-left row order. */
  rgba: Uint8Array;
  sourceName?: string;
  roughness?: number;
  metalness?: number;
  alphaCutoff?: number;
}

export interface ProcPlantPlacementDecalPixelSource {
  contract: typeof PROCPLANT_PLACEMENT_DECAL_PIXELS_CONTRACT;
  version: typeof PROCPLANT_PLACEMENT_DECAL_PIXELS_VERSION;
  binding: ProcPlantPlacementDecalBinding;
  sourceMimeType: ProcPlantPlacementDecalSourceMimeType;
  sourceName?: string;
  sourceBytes: Uint8Array;
  sourceSha256: string;
  width: number;
  height: number;
  rgba: Uint8Array;
  rgbaSha256: string;
  pngBytes: Uint8Array;
  pngSha256: string;
  roughness: number;
  metalness: number;
  alphaCutoff: number;
}

export interface PreparedProcPlantPlacementDecalGlbDraws {
  contract: typeof PROCPLANT_PLACEMENT_DECAL_GLB_CONTRACT;
  version: typeof PROCPLANT_PLACEMENT_DECAL_GLB_VERSION;
  root: THREE.Group;
  meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
  nodeNames: string[];
  operationIds: string[];
  binding: ProcPlantPlacementDecalBinding;
  sourceSha256: string;
  rgbaSha256: string;
  pngSha256: string;
  roughness: number;
  metalness: number;
  alphaCutoff: number;
  readonly disposed: boolean;
  dispose(): void;
}

export interface ProcPlantPlacementDecalBoundGlb {
  contract: typeof PROCPLANT_PLACEMENT_DECAL_GLB_CONTRACT;
  version: typeof PROCPLANT_PLACEMENT_DECAL_GLB_VERSION;
  bytes: ArrayBuffer;
  contentHash: string;
  draws: number;
  vertices: number;
  triangles: number;
  embeddedMimeType: "image/png";
  embeddedBytes: number;
}

export interface ProcPlantPlacementDecalGlbOptions {
  exporter?: Omit<GLTFExporterOptions, "binary">;
  maxGlbBytes?: number;
}

const finiteUnit = (value: number, fallback: number) => Number.isFinite(value)
  ? THREE.MathUtils.clamp(value, 0, 1)
  : fallback;

const assertBinding = (binding: ProcPlantPlacementDecalBinding) => {
  if (
    binding?.contract !== PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT
    || binding.version !== PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION
    || binding.uvSet !== 0
    || typeof binding.materialId !== "string"
    || binding.materialId.length < 1
    || binding.materialId.length > 128
    || typeof binding.textureId !== "string"
    || binding.textureId.length < 1
    || binding.textureId.length > 128
    || !Array.isArray(binding.uvRect)
    || binding.uvRect.length !== 4
    || binding.uvRect.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || binding.uvRect[2]! <= binding.uvRect[0]!
    || binding.uvRect[3]! <= binding.uvRect[1]!
  ) throw new Error("placement decal GLB requires an exact UV0 material/texture binding");
};

const copyBinding = (binding: ProcPlantPlacementDecalBinding): ProcPlantPlacementDecalBinding => Object.freeze({
  ...binding,
  uvRect: Object.freeze([...binding.uvRect]) as unknown as readonly [number, number, number, number],
});

const sameBinding = (left: ProcPlantPlacementDecalBinding, right: ProcPlantPlacementDecalBinding) =>
  left.contract === right.contract
  && left.version === right.version
  && left.materialId === right.materialId
  && left.textureId === right.textureId
  && left.uvSet === right.uvSet
  && left.uvRect.every((value, index) => value === right.uvRect[index]);

const sha256 = async (bytes: Uint8Array) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("placement decal pixel adoption requires Web Crypto SHA-256");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes.slice().buffer));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const validatePixelInput = (input: ProcPlantPlacementDecalPixelSourceInput) => {
  assertBinding(input.binding);
  if (!["image/png", "image/webp", "image/jpeg"].includes(input.sourceMimeType)) {
    throw new Error("placement decal source must be PNG, WebP, or JPEG");
  }
  if (!(input.sourceBytes instanceof Uint8Array) || input.sourceBytes.byteLength < 1
    || input.sourceBytes.byteLength > PROCPLANT_PLACEMENT_DECAL_MAX_SOURCE_BYTES) {
    throw new Error(`placement decal source bytes must be 1..${PROCPLANT_PLACEMENT_DECAL_MAX_SOURCE_BYTES}`);
  }
  const bytes = input.sourceBytes;
  const signatureMatches = input.sourceMimeType === "image/png"
    ? bytes.byteLength >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : input.sourceMimeType === "image/jpeg"
      ? bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.byteLength >= 12
        && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
        && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (!signatureMatches) throw new Error(`placement decal source bytes do not match ${input.sourceMimeType}`);
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height)
    || input.width < 1 || input.height < 1 || input.width > 4096 || input.height > 4096
    || input.width * input.height > PROCPLANT_PLACEMENT_DECAL_MAX_PIXELS) {
    throw new Error("placement decal decoded dimensions exceed 4096x4096 or 16 megapixels");
  }
  const expected = input.width * input.height * 4;
  if (!(input.rgba instanceof Uint8Array) || input.rgba.byteLength !== expected) {
    throw new Error(`placement decal decoded RGBA must contain exactly ${expected} bytes`);
  }
  if (input.sourceName !== undefined && (typeof input.sourceName !== "string" || input.sourceName.length < 1 || input.sourceName.length > 256)) {
    throw new Error("placement decal sourceName must contain 1..256 characters");
  }
};

const assertPixelSourceMetadata = (source: ProcPlantPlacementDecalPixelSource) => {
  if (source?.contract !== PROCPLANT_PLACEMENT_DECAL_PIXELS_CONTRACT
    || source.version !== PROCPLANT_PLACEMENT_DECAL_PIXELS_VERSION) {
    throw new Error("unsupported placement decal pixel-source contract/version");
  }
  if (![source.sourceSha256, source.rgbaSha256, source.pngSha256].every((hash) => /^sha256:[0-9a-f]{64}$/.test(hash))) {
    throw new Error("placement decal pixel-source hashes must be full lowercase SHA-256 values");
  }
  if (![source.roughness, source.metalness, source.alphaCutoff].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error("placement decal material factors must remain finite values in [0, 1]");
  }
};

/**
 * Capture real source provenance and browser-decoded pixels. Export always
 * embeds a deterministic core glTF PNG, including when the source was WebP or
 * JPEG, so no optional image extension is invented.
 */
export const createProcPlantPlacementDecalPixelSource = async (
  input: ProcPlantPlacementDecalPixelSourceInput,
): Promise<ProcPlantPlacementDecalPixelSource> => {
  validatePixelInput(input);
  const sourceBytes = input.sourceBytes.slice();
  const rgba = input.rgba.slice();
  const pngBytes = encodeProcPlantImpostorPng(rgba, input.width, input.height);
  const [sourceSha256, rgbaSha256, pngSha256] = await Promise.all([
    sha256(sourceBytes),
    sha256(rgba),
    sha256(pngBytes),
  ]);
  return Object.freeze({
    contract: PROCPLANT_PLACEMENT_DECAL_PIXELS_CONTRACT,
    version: PROCPLANT_PLACEMENT_DECAL_PIXELS_VERSION,
    binding: copyBinding(input.binding),
    sourceMimeType: input.sourceMimeType,
    ...(input.sourceName ? { sourceName: input.sourceName } : {}),
    sourceBytes,
    sourceSha256,
    width: input.width,
    height: input.height,
    rgba,
    rgbaSha256,
    pngBytes,
    pngSha256,
    roughness: finiteUnit(input.roughness ?? 0.82, 0.82),
    metalness: finiteUnit(input.metalness ?? 0, 0),
    alphaCutoff: finiteUnit(input.alphaCutoff ?? (input.sourceMimeType === "image/jpeg" ? 0 : 0.08), 0.08),
  });
};

const validatePixelSource = async (source: ProcPlantPlacementDecalPixelSource) => {
  assertPixelSourceMetadata(source);
  validatePixelInput(source);
  if (!(source.pngBytes instanceof Uint8Array) || source.pngBytes.byteLength < 1) {
    throw new Error("placement decal pixel source is missing deterministic PNG bytes");
  }
  const regeneratedPng = encodeProcPlantImpostorPng(source.rgba, source.width, source.height);
  const [sourceHash, rgbaHash, pngHash, regeneratedHash] = await Promise.all([
    sha256(source.sourceBytes), sha256(source.rgba), sha256(source.pngBytes), sha256(regeneratedPng),
  ]);
  if (sourceHash !== source.sourceSha256 || rgbaHash !== source.rgbaSha256
    || pngHash !== source.pngSha256 || regeneratedHash !== source.pngSha256
    || source.pngBytes.byteLength !== regeneratedPng.byteLength
    || source.pngBytes.some((byte, index) => byte !== regeneratedPng[index])) {
    throw new Error("placement decal pixel/source bytes no longer match their exact SHA-256 provenance");
  }
};

const exactDecalMatch = (decal: ProcPlantMaterializedPlacementDecal, binding: ProcPlantPlacementDecalBinding) =>
  decal.materialId === binding.materialId
  && decal.textureId === binding.textureId
  && decal.uvSet === 0
  && decal.template.uv0.length === 8
  && decal.template.uv0.every((value, index) => value === [
    binding.uvRect[0], binding.uvRect[3],
    binding.uvRect[2], binding.uvRect[3],
    binding.uvRect[2], binding.uvRect[1],
    binding.uvRect[0], binding.uvRect[1],
  ][index]);

export const prepareProcPlantPlacementDecalGlbDraws = (
  decals: readonly ProcPlantMaterializedPlacementDecal[],
  source: ProcPlantPlacementDecalPixelSource,
): PreparedProcPlantPlacementDecalGlbDraws => {
  assertPixelSourceMetadata(source);
  assertBinding(source.binding);
  if (decals.length < 1 || decals.length > 96) throw new Error("placement decal GLB draws must contain 1..96 entries");
  if (!decals.every((decal) => exactDecalMatch(decal, source.binding))) {
    throw new Error("placement decal GLB draws do not exactly match the pixel-source binding");
  }
  const operationIds = new Set<string>();
  const root = new THREE.Group();
  root.name = `procplant-placement-decal-glb:${source.binding.textureId}`;
  const material = new THREE.MeshStandardMaterial({
    name: `procplant-placement-decal-placeholder:${source.binding.materialId}`,
    color: 0xffffff,
    roughness: source.roughness,
    metalness: source.metalness,
    side: THREE.DoubleSide,
  });
  const meshes: PreparedProcPlantPlacementDecalGlbDraws["meshes"] = [];
  try {
    for (const decal of [...decals].sort((left, right) => left.operationId.localeCompare(right.operationId))) {
      if (!decal.operationId || operationIds.has(decal.operationId)) throw new Error("placement decal GLB operation IDs must be non-empty and unique");
      operationIds.add(decal.operationId);
      const geometry = createProcPlantThreePlacementDecalGeometry(decal);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `procplant-placement-decal-glb-draw:${decal.operationId}`;
      mesh.userData.procplantPlacementDecalGlb = {
        contract: PROCPLANT_PLACEMENT_DECAL_GLB_CONTRACT,
        version: PROCPLANT_PLACEMENT_DECAL_GLB_VERSION,
        operationId: decal.operationId,
        materialId: source.binding.materialId,
        textureId: source.binding.textureId,
        sourceSha256: source.sourceSha256,
        rgbaSha256: source.rgbaSha256,
        pngSha256: source.pngSha256,
        uvSet: 0,
      };
      meshes.push(mesh);
      root.add(mesh);
    }
  } catch (error) {
    for (const mesh of meshes) mesh.geometry.dispose();
    material.dispose();
    root.clear();
    throw error;
  }
  const nodeNames = meshes.map((mesh) => mesh.name);
  let disposed = false;
  return {
    contract: PROCPLANT_PLACEMENT_DECAL_GLB_CONTRACT,
    version: PROCPLANT_PLACEMENT_DECAL_GLB_VERSION,
    root,
    meshes,
    nodeNames,
    operationIds: [...operationIds].sort(),
    binding: copyBinding(source.binding),
    sourceSha256: source.sourceSha256,
    rgbaSha256: source.rgbaSha256,
    pngSha256: source.pngSha256,
    roughness: source.roughness,
    metalness: source.metalness,
    alphaCutoff: source.alphaCutoff,
    get disposed() { return disposed; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const mesh of meshes) mesh.geometry.dispose();
      material.dispose();
      root.clear();
    },
  };
};

const align4 = (value: number) => Math.ceil(value / 4) * 4;
const uint32 = (target: Uint8Array, offset: number, value: number) =>
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value, true);

const parseGlb = (source: ArrayBuffer, maxBytes: number) => {
  if (source.byteLength < 20 || source.byteLength > maxBytes) throw new Error("base placement-decal GLB is truncated or exceeds maxGlbBytes");
  const view = new DataView(source);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== source.byteLength) {
    throw new Error("base placement-decal GLB has an invalid header");
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength + 8 > source.byteLength) {
    throw new Error("base placement-decal GLB has an invalid JSON chunk");
  }
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(source, 20, jsonLength)).trim()) as Record<string, any>;
  const binaryHeader = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryHeader, true);
  if (view.getUint32(binaryHeader + 4, true) !== 0x004e4942 || binaryHeader + 8 + binaryLength !== source.byteLength) {
    throw new Error("base placement-decal GLB must contain exactly one BIN chunk");
  }
  const declared = json.buffers?.[0]?.byteLength;
  if (!Number.isInteger(declared) || declared < 0 || declared > binaryLength) throw new Error("base placement-decal GLB has an invalid buffer length");
  return { json, binary: new Uint8Array(source, binaryHeader + 8, declared).slice() };
};

/** Embed deterministic decoded pixels and bind only the exact authored UV0 draws. */
export const bindProcPlantPlacementDecalsIntoGlb = async (
  baseGlb: ArrayBuffer,
  prepared: PreparedProcPlantPlacementDecalGlbDraws,
  source: ProcPlantPlacementDecalPixelSource,
  options: Pick<ProcPlantPlacementDecalGlbOptions, "maxGlbBytes"> = {},
): Promise<ProcPlantPlacementDecalBoundGlb> => {
  const maxGlbBytes = options.maxGlbBytes ?? PROCPLANT_PLACEMENT_DECAL_MAX_GLB_BYTES;
  if (!Number.isInteger(maxGlbBytes) || maxGlbBytes < 1 || maxGlbBytes > 1024 * 1024 * 1024) throw new Error("maxGlbBytes must be an integer in 1..1GiB");
  if (prepared.disposed || prepared.contract !== PROCPLANT_PLACEMENT_DECAL_GLB_CONTRACT
    || prepared.version !== PROCPLANT_PLACEMENT_DECAL_GLB_VERSION) throw new Error("placement decal GLB draws are disposed or unsupported");
  if (!sameBinding(prepared.binding, source.binding)
    || prepared.sourceSha256 !== source.sourceSha256
    || prepared.rgbaSha256 !== source.rgbaSha256
    || prepared.pngSha256 !== source.pngSha256
    || prepared.roughness !== source.roughness
    || prepared.metalness !== source.metalness
    || prepared.alphaCutoff !== source.alphaCutoff) {
    throw new Error("prepared placement decal GLB draws do not match the exact pixel source");
  }
  await validatePixelSource(source);
  const { json, binary } = parseGlb(baseGlb, maxGlbBytes);
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const nodeByName = new Map<string, any>();
  for (const node of nodes) if (typeof node.name === "string") {
    if (nodeByName.has(node.name)) throw new Error(`base GLB contains duplicate node name ${node.name}`);
    nodeByName.set(node.name, node);
  }
  const primitives: any[] = [];
  for (const nodeName of prepared.nodeNames) {
    const node = nodeByName.get(nodeName);
    const mesh = node && Number.isInteger(node.mesh) ? meshes[node.mesh] : undefined;
    if (!mesh || !Array.isArray(mesh.primitives) || mesh.primitives.length !== 1) throw new Error(`base GLB is missing exact decal node ${nodeName}`);
    const primitive = mesh.primitives[0];
    if (!primitive.attributes || !Number.isInteger(primitive.attributes.TEXCOORD_0)
      || !Number.isInteger(primitive.attributes.POSITION)
      || !Number.isInteger(primitive.indices)
      || json.accessors?.[primitive.attributes.POSITION]?.count !== 4
      || json.accessors?.[primitive.attributes.TEXCOORD_0]?.count !== 4
      || json.accessors?.[primitive.indices]?.count !== 6) {
      throw new Error(`${nodeName} must remain one exact four-vertex/two-triangle TEXCOORD_0 primitive`);
    }
    primitives.push(primitive);
  }
  if (primitives.length !== prepared.meshes.length) throw new Error("base GLB decal node count does not match prepared draws");

  json.bufferViews ??= [];
  json.images ??= [];
  json.samplers ??= [];
  json.textures ??= [];
  json.materials ??= [];
  const aligned = align4(binary.byteLength);
  const binaryLength = aligned + source.pngBytes.byteLength;
  if (!Number.isSafeInteger(binaryLength) || binaryLength > maxGlbBytes) throw new Error("placement decal PNG exceeds maxGlbBytes");
  const bufferView = json.bufferViews.length;
  json.bufferViews.push({
    buffer: 0,
    byteOffset: aligned,
    byteLength: source.pngBytes.byteLength,
    name: `procplant-placement-decal-image:${source.binding.textureId}`,
  });
  const image = json.images.length;
  json.images.push({ bufferView, mimeType: "image/png", name: source.binding.textureId });
  const sampler = json.samplers.length;
  json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 });
  const texture = json.textures.length;
  json.textures.push({ source: image, sampler, name: source.binding.textureId });
  const material = json.materials.length;
  json.materials.push({
    name: source.binding.materialId,
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      baseColorTexture: { index: texture, texCoord: 0 },
      metallicFactor: source.metalness,
      roughnessFactor: source.roughness,
    },
    ...(source.alphaCutoff > 0 ? { alphaMode: "MASK", alphaCutoff: source.alphaCutoff } : { alphaMode: "OPAQUE" }),
    doubleSided: true,
    extras: {
      procplantsPlacementDecal: {
        contract: PROCPLANT_PLACEMENT_DECAL_GLB_CONTRACT,
        version: PROCPLANT_PLACEMENT_DECAL_GLB_VERSION,
        materialId: source.binding.materialId,
        textureId: source.binding.textureId,
        uvSet: 0,
        uvRect: [...source.binding.uvRect],
        sourceMimeType: source.sourceMimeType,
        sourceSha256: source.sourceSha256,
        rgbaSha256: source.rgbaSha256,
        pngSha256: source.pngSha256,
        width: source.width,
        height: source.height,
      },
    },
  });
  for (const primitive of primitives) primitive.material = material;
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    procplantsPlacementDecals: {
      contract: PROCPLANT_PLACEMENT_DECAL_GLB_CONTRACT,
      version: PROCPLANT_PLACEMENT_DECAL_GLB_VERSION,
      binding: { ...source.binding, uvRect: [...source.binding.uvRect] },
      sourceMimeType: source.sourceMimeType,
      ...(source.sourceName ? { sourceName: source.sourceName } : {}),
      sourceSha256: source.sourceSha256,
      rgbaSha256: source.rgbaSha256,
      pngSha256: source.pngSha256,
      width: source.width,
      height: source.height,
      embeddedMimeType: "image/png",
      draws: prepared.operationIds.map((operationId, index) => ({ operationId, node: prepared.nodeNames[index] })),
    },
  };
  json.buffers[0].byteLength = binaryLength;
  const jsonRaw = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(align4(jsonRaw.byteLength)).fill(0x20);
  jsonPadded.set(jsonRaw);
  const binaryPadded = new Uint8Array(align4(binaryLength));
  binaryPadded.set(binary);
  binaryPadded.set(source.pngBytes, aligned);
  const total = 12 + 8 + jsonPadded.byteLength + 8 + binaryPadded.byteLength;
  if (total > maxGlbBytes) throw new Error(`placement decal GLB exceeds maxGlbBytes (${total} > ${maxGlbBytes})`);
  const output = new Uint8Array(total);
  uint32(output, 0, 0x46546c67); uint32(output, 4, 2); uint32(output, 8, total);
  uint32(output, 12, jsonPadded.byteLength); uint32(output, 16, 0x4e4f534a); output.set(jsonPadded, 20);
  const binHeader = 20 + jsonPadded.byteLength;
  uint32(output, binHeader, binaryPadded.byteLength); uint32(output, binHeader + 4, 0x004e4942); output.set(binaryPadded, binHeader + 8);
  return {
    contract: PROCPLANT_PLACEMENT_DECAL_GLB_CONTRACT,
    version: PROCPLANT_PLACEMENT_DECAL_GLB_VERSION,
    bytes: output.buffer,
    contentHash: await sha256(output),
    draws: primitives.length,
    vertices: primitives.length * 4,
    triangles: primitives.length * 2,
    embeddedMimeType: "image/png",
    embeddedBytes: source.pngBytes.byteLength,
  };
};

/** Convenience path for a scene that does not need another material rewriter. */
export const exportProcPlantSceneGlbWithPlacementDecals = async (
  scene: THREE.Scene,
  decals: readonly ProcPlantMaterializedPlacementDecal[],
  source: ProcPlantPlacementDecalPixelSource,
  options: ProcPlantPlacementDecalGlbOptions = {},
): Promise<ProcPlantPlacementDecalBoundGlb> => {
  const exportScene = scene.clone(true);
  const prepared = prepareProcPlantPlacementDecalGlbDraws(decals, source);
  exportScene.add(prepared.root);
  try {
    const base = await exportProcPlantScenesGlb(exportScene, options.exporter);
    return await bindProcPlantPlacementDecalsIntoGlb(base, prepared, source, options);
  } finally {
    prepared.dispose();
  }
};
