import * as THREE from "three";
import {
  PROCPLANT_MATERIAL_BAKE_CONTRACT,
  PROCPLANT_MATERIAL_BAKE_VERSION,
  type ProcPlantBakedImageUsage,
  type ProcPlantBakedMaterialBundle,
  type ProcPlantBakedMaterialImage,
} from "./procplant-material-bake";

export const PROCPLANT_THREE_MATERIAL_ADAPTER_CONTRACT = "procplants.three-material-adapter" as const;
export const PROCPLANT_THREE_MATERIAL_ADAPTER_VERSION = 1 as const;

export interface ProcPlantThreeMaterialAdapterOptions {
  barkSlot?: string;
  organSlot?: string;
  /** 0 uses `uv`; 1 uses current Three's `uv1` (historically called UV2). */
  ormUvChannel?: 0 | 1;
  maxMaterials?: number;
  maxImages?: number;
  maxTextureWidth?: number;
  maxTextureHeight?: number;
  maxTexturePixels?: number;
  maxTextureBytes?: number;
}

export interface ProcPlantThreeMaterialUvRequirement {
  ormTextureChannel: 0 | 1;
  attribute: "uv" | "uv1";
  /** Older Three integrations commonly call the second UV attribute `uv2`. */
  legacyAttribute: "uv2";
  requiresSecondaryUv: boolean;
}

export interface ProcPlantThreeTextureAudit {
  textureIndex: number;
  name: string;
  usage: ProcPlantBakedImageUsage;
  width: number;
  height: number;
  bytes: number;
  colorSpace: "srgb" | "linear";
  contentHash: string;
  bindings: string[];
}

export interface ProcPlantThreeMaterialAudit {
  role: "bark" | "organ";
  slot: string;
  materialIndex: number;
  alphaMode: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff: number;
  doubleSided: boolean;
  textureIndexes: {
    baseColor: number | null;
    orm: number | null;
    normal: number | null;
    emissive: number | null;
  };
}

export interface ProcPlantThreeMaterialAdapterAudit {
  contract: typeof PROCPLANT_THREE_MATERIAL_ADAPTER_CONTRACT;
  version: typeof PROCPLANT_THREE_MATERIAL_ADAPTER_VERSION;
  sourceId: string;
  sourceContentHash: string;
  barkSlot: string;
  organSlot: string;
  uv: ProcPlantThreeMaterialUvRequirement;
  materials: ProcPlantThreeMaterialAudit[];
  textures: ProcPlantThreeTextureAudit[];
  ownedTextureBytes: number;
  auditHash: string;
}

export interface ProcPlantThreeBakedMaterialSet {
  bark: THREE.MeshStandardMaterial;
  organ: THREE.MeshStandardMaterial;
  materialsBySlot: ReadonlyMap<string, THREE.MeshStandardMaterial>;
  textures: readonly THREE.DataTexture[];
  uv: ProcPlantThreeMaterialUvRequirement;
  audit: ProcPlantThreeMaterialAdapterAudit;
}

export interface ProcPlantThreeUv2Options {
  /** Copy UV0 when the required secondary set is absent. Disabled by default. */
  copyUv0?: boolean;
  /** Accept a legacy `uv2` attribute and alias it to current Three's `uv1`. */
  acceptLegacyUv2?: boolean;
}

export interface ProcPlantThreeUv2Audit {
  requiredAttribute: "uv" | "uv1";
  source: "uv0" | "uv1" | "legacy-uv2" | "copied-uv0";
  vertices: number;
  mutated: boolean;
}

type JsonRecord = Record<string, unknown>;
type AlphaMode = "OPAQUE" | "MASK" | "BLEND";

interface ValidatedMaterial {
  role: "bark" | "organ";
  slot: string;
  index: number;
  alphaMode: AlphaMode;
  alphaCutoff: number;
  doubleSided: boolean;
  baseColorFactor: [number, number, number, number];
  metallicFactor: number;
  roughnessFactor: number;
  emissiveFactor: [number, number, number];
  aoStrength: number;
  normalScale: number;
  textures: { baseColor: number | null; orm: number | null; normal: number | null; emissive: number | null };
}

const HARD_MAX_MATERIALS = 128;
const HARD_MAX_IMAGES = 512;
const HARD_MAX_DIMENSION = 8192;
const HARD_MAX_PIXELS = 67_108_864;
const HARD_MAX_BYTES = 1024 * 1024 * 1024;

const integer = (value: unknown, fallback: number, min: number, max: number, label: string) => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || (resolved as number) < min || (resolved as number) > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  }
  return resolved as number;
};

const record = (value: unknown, label: string): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonRecord;
};

const finite = (value: unknown, fallback: number, min: number, max: number, label: string) => {
  const resolved = value ?? fallback;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} must be finite in [${min}, ${max}]`);
  }
  return resolved;
};

const factor = <Length extends 3 | 4>(
  value: unknown,
  fallback: readonly number[],
  length: Length,
  label: string,
): Length extends 3 ? [number, number, number] : [number, number, number, number] => {
  const resolved = value ?? fallback;
  if (!Array.isArray(resolved) || resolved.length !== length) throw new Error(`${label} must contain ${length} values`);
  const output = resolved.map((component, index) => finite(component, 0, 0, 1, `${label}[${index}]`));
  return output as never;
};

const textureIndex = (value: unknown, label: string): number | null => {
  if (value === undefined) return null;
  const info = record(value, label);
  if (!Number.isInteger(info.index) || (info.index as number) < 0) throw new Error(`${label}.index must be a non-negative integer`);
  if (info.texCoord !== undefined && info.texCoord !== 0) {
    throw new Error(`${label}.texCoord must be zero in the baked material contract`);
  }
  return info.index as number;
};

const stableHash = (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};

const validateUvAttribute = (geometry: THREE.BufferGeometry, attributeName: string, label: string) => {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute(attributeName);
  if (!position || position.itemSize !== 3 || position.count === 0) throw new Error(`${label}.position must contain xyz vertices`);
  if (!uv || uv.itemSize !== 2 || uv.count !== position.count) {
    throw new Error(`${label}.${attributeName} must contain one UV pair per position vertex`);
  }
  for (let index = 0; index < uv.count; index++) {
    if (!Number.isFinite(uv.getX(index)) || !Number.isFinite(uv.getY(index))) {
      throw new Error(`${label}.${attributeName}[${index}] must be finite`);
    }
  }
  return { position, uv };
};

/**
 * Satisfy the selected ORM UV requirement explicitly. In Three r181 the second
 * UV set is `uv1`; `uv2` is accepted only as an opt-in legacy source.
 */
export const ensureProcPlantThreeMaterialUv2 = (
  geometry: THREE.BufferGeometry,
  requirement: ProcPlantThreeMaterialUvRequirement,
  options: ProcPlantThreeUv2Options = {},
  label = "geometry",
): ProcPlantThreeUv2Audit => {
  if (requirement.ormTextureChannel === 0) {
    const { position } = validateUvAttribute(geometry, "uv", label);
    return { requiredAttribute: "uv", source: "uv0", vertices: position.count, mutated: false };
  }
  const existing = geometry.getAttribute("uv1");
  if (existing) {
    const { position } = validateUvAttribute(geometry, "uv1", label);
    return { requiredAttribute: "uv1", source: "uv1", vertices: position.count, mutated: false };
  }
  const legacy = geometry.getAttribute("uv2");
  if (legacy && options.acceptLegacyUv2 === true) {
    validateUvAttribute(geometry, "uv2", label);
    geometry.setAttribute("uv1", legacy);
    return { requiredAttribute: "uv1", source: "legacy-uv2", vertices: legacy.count, mutated: true };
  }
  if (options.copyUv0 === true) {
    const { position, uv } = validateUvAttribute(geometry, "uv", label);
    geometry.setAttribute("uv1", uv.clone());
    return { requiredAttribute: "uv1", source: "copied-uv0", vertices: position.count, mutated: true };
  }
  throw new Error(`${label} requires current Three attribute uv1 (historically UV2); provide it or opt into copying UV0`);
};

const expectedColorSpace = (usage: ProcPlantBakedImageUsage) =>
  usage === "baseColor" || usage === "emissive" ? "srgb" as const : "linear" as const;

const validateImage = (
  image: ProcPlantBakedMaterialImage,
  index: number,
  maxWidth: number,
  maxHeight: number,
  maxPixels: number,
) => {
  if (!image || typeof image !== "object") throw new Error(`baked image ${index} must be an object`);
  if (!Number.isInteger(image.width) || image.width < 1 || image.width > maxWidth ||
      !Number.isInteger(image.height) || image.height < 1 || image.height > maxHeight) {
    throw new Error(`baked image ${index} dimensions exceed adapter limits`);
  }
  const pixels = image.width * image.height;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) throw new Error(`baked image ${index} exceeds maxTexturePixels`);
  if (!(image.rgba instanceof Uint8Array) || image.rgba.byteLength !== pixels * 4) {
    throw new Error(`baked image ${index}.rgba must contain exactly width * height * 4 bytes`);
  }
  if (!Number.isInteger(image.textureIndex) || image.textureIndex !== index) {
    throw new Error(`baked image ${index} must have canonical textureIndex ${index}`);
  }
  if (!["baseColor", "metallicRoughnessOcclusion", "normal", "emissive"].includes(image.usage)) {
    throw new Error(`baked image ${index} has unsupported usage`);
  }
  if (image.colorSpace !== expectedColorSpace(image.usage)) {
    throw new Error(`baked image ${index} ${image.usage} has invalid colorSpace ${image.colorSpace}`);
  }
  if (typeof image.name !== "string" || !image.name || typeof image.contentHash !== "string" || !image.contentHash) {
    throw new Error(`baked image ${index} requires stable name and contentHash`);
  }
  return image.rgba.byteLength;
};

const validateMaterial = (
  material: unknown,
  index: number,
  role: "bark" | "organ",
  slot: string,
): ValidatedMaterial => {
  const source = record(material, `baked material ${index}`);
  if (source.name !== slot) throw new Error(`baked material ${index} does not match requested ${role} slot ${slot}`);
  const extras = source.extras === undefined ? null : record(source.extras, `${slot}.extras`);
  if (extras?.procplantsBakeReady === false) throw new Error(`${slot} is not marked ready for live material adoption`);
  if (typeof source.doubleSided !== "boolean") throw new Error(`${slot}.doubleSided must be boolean`);
  const alphaMode = source.alphaMode ?? "OPAQUE";
  if (alphaMode !== "OPAQUE" && alphaMode !== "MASK" && alphaMode !== "BLEND") throw new Error(`${slot}.alphaMode is unsupported`);
  const alphaCutoff = alphaMode === "MASK" ? finite(source.alphaCutoff, 0.5, 0, 1, `${slot}.alphaCutoff`) : 0;
  const pbr = record(source.pbrMetallicRoughness, `${slot}.pbrMetallicRoughness`);
  const baseColor = factor(pbr.baseColorFactor, [1, 1, 1, 1], 4, `${slot}.baseColorFactor`);
  const metallicFactor = finite(pbr.metallicFactor, 1, 0, 1, `${slot}.metallicFactor`);
  const roughnessFactor = finite(pbr.roughnessFactor, 1, 0, 1, `${slot}.roughnessFactor`);
  const baseTexture = textureIndex(pbr.baseColorTexture, `${slot}.baseColorTexture`);
  const metallicRoughnessTexture = textureIndex(pbr.metallicRoughnessTexture, `${slot}.metallicRoughnessTexture`);
  const occlusion = source.occlusionTexture === undefined ? null : record(source.occlusionTexture, `${slot}.occlusionTexture`);
  const occlusionTexture = occlusion ? textureIndex(occlusion, `${slot}.occlusionTexture`) : null;
  if (metallicRoughnessTexture !== occlusionTexture) {
    throw new Error(`${slot} must bind one packed ORM texture to occlusion and metallic-roughness`);
  }
  const normal = source.normalTexture === undefined ? null : record(source.normalTexture, `${slot}.normalTexture`);
  const emissive = source.emissiveTexture === undefined ? null : record(source.emissiveTexture, `${slot}.emissiveTexture`);
  return {
    role,
    slot,
    index,
    alphaMode,
    alphaCutoff,
    doubleSided: source.doubleSided,
    baseColorFactor: baseColor,
    metallicFactor,
    roughnessFactor,
    emissiveFactor: factor(source.emissiveFactor, [0, 0, 0], 3, `${slot}.emissiveFactor`),
    aoStrength: occlusion ? finite(occlusion.strength, 1, 0, 1, `${slot}.occlusionTexture.strength`) : 1,
    normalScale: normal ? finite(normal.scale, 1, 0, 16, `${slot}.normalTexture.scale`) : 1,
    textures: {
      baseColor: baseTexture,
      orm: metallicRoughnessTexture,
      normal: normal ? textureIndex(normal, `${slot}.normalTexture`) : null,
      emissive: emissive ? textureIndex(emissive, `${slot}.emissiveTexture`) : null,
    },
  };
};

const disposedSets = new WeakSet<ProcPlantThreeBakedMaterialSet>();

/** Convert a ready two-surface bake into owned live Three.js resources. */
export const createProcPlantThreeBakedMaterials = (
  baked: ProcPlantBakedMaterialBundle,
  options: ProcPlantThreeMaterialAdapterOptions = {},
): ProcPlantThreeBakedMaterialSet => {
  if (baked.contract !== PROCPLANT_MATERIAL_BAKE_CONTRACT || baked.version !== PROCPLANT_MATERIAL_BAKE_VERSION) {
    throw new Error("unsupported procplant material bake contract/version");
  }
  if (!baked.ready || baked.diagnostics.length !== 0) {
    throw new Error("live Three material adoption requires a ready bake without blocking diagnostics");
  }
  if (!Array.isArray(baked.images) || !Array.isArray(baked.gltf.images) || !Array.isArray(baked.gltf.textures) ||
      !Array.isArray(baked.gltf.materials)) throw new Error("baked material tables must be arrays");
  const maxMaterials = integer(options.maxMaterials, 16, 2, HARD_MAX_MATERIALS, "maxMaterials");
  const maxImages = integer(options.maxImages, 32, 1, HARD_MAX_IMAGES, "maxImages");
  const maxWidth = integer(options.maxTextureWidth, 4096, 1, HARD_MAX_DIMENSION, "maxTextureWidth");
  const maxHeight = integer(options.maxTextureHeight, 4096, 1, HARD_MAX_DIMENSION, "maxTextureHeight");
  const maxPixels = integer(options.maxTexturePixels, 16_777_216, 1, HARD_MAX_PIXELS, "maxTexturePixels");
  const maxBytes = integer(options.maxTextureBytes, 256 * 1024 * 1024, 1, HARD_MAX_BYTES, "maxTextureBytes");
  if (baked.gltf.materials.length > maxMaterials) throw new Error(`Three material adapter exceeds maxMaterials (${baked.gltf.materials.length} > ${maxMaterials})`);
  if (baked.images.length > maxImages) throw new Error(`Three material adapter exceeds maxImages (${baked.images.length} > ${maxImages})`);
  if (baked.images.length !== baked.gltf.images.length || baked.images.length !== baked.gltf.textures.length) {
    throw new Error("baked image and texture tables are inconsistent");
  }
  if (baked.gltf.extras.contract !== baked.contract || baked.gltf.extras.version !== baked.version ||
      baked.gltf.extras.sourceId !== baked.sourceId || baked.gltf.extras.sourceContentHash !== baked.sourceContentHash ||
      baked.gltf.extras.ready !== true) {
    throw new Error("baked glTF extras do not match the ready material bundle");
  }
  if (!Number.isInteger(baked.width) || baked.width < 1 || baked.width > maxWidth ||
      !Number.isInteger(baked.height) || baked.height < 1 || baked.height > maxHeight) {
    throw new Error("baked material dimensions exceed adapter limits");
  }
  let textureBytes = 0;
  let texturePixels = 0;
  for (let index = 0; index < baked.images.length; index++) {
    const image = baked.images[index]!;
    textureBytes += validateImage(image, index, maxWidth, maxHeight, maxPixels);
    texturePixels += image.width * image.height;
    if (!Number.isSafeInteger(texturePixels) || texturePixels > maxPixels) {
      throw new Error(`Three material adapter exceeds maxTexturePixels (${texturePixels} > ${maxPixels})`);
    }
    if (!Number.isSafeInteger(textureBytes) || textureBytes > maxBytes) {
      throw new Error(`Three material adapter exceeds maxTextureBytes (${textureBytes} > ${maxBytes})`);
    }
    if (image.width !== baked.width || image.height !== baked.height) {
      throw new Error(`baked image ${index} dimensions do not match its material bundle`);
    }
    const gltfImage = record(baked.gltf.images[index], `baked glTF image ${index}`);
    if (gltfImage.name !== image.name || gltfImage.mimeType !== image.mimeType ||
        typeof gltfImage.uri !== "string" || !gltfImage.uri.startsWith("data:image/png;base64,")) {
      throw new Error(`baked glTF image ${index} does not match raw image metadata`);
    }
    const texture = record(baked.gltf.textures[index], `baked texture ${index}`);
    if (texture.source !== index || texture.name !== image.name) {
      throw new Error(`baked texture ${index} must reference canonical image ${index}`);
    }
  }
  const barkSlot = options.barkSlot ?? "bark";
  const organSlot = options.organSlot ?? "leaf";
  if (!barkSlot || !organSlot || barkSlot === organSlot) throw new Error("barkSlot and organSlot must be non-empty and distinct");
  const materialIndexes = new Map<string, number>();
  baked.gltf.materials.forEach((material, index) => {
    const slot = record(material, `baked material ${index}`).name;
    if (typeof slot !== "string" || !slot) throw new Error(`baked material ${index} is missing a slot name`);
    if (materialIndexes.has(slot)) throw new Error(`duplicate baked material slot ${slot}`);
    materialIndexes.set(slot, index);
  });
  const barkIndex = materialIndexes.get(barkSlot);
  const organIndex = materialIndexes.get(organSlot);
  if (barkIndex === undefined || organIndex === undefined) throw new Error(`baked materials require slots ${barkSlot} and ${organSlot}`);
  const validated = [
    validateMaterial(baked.gltf.materials[barkIndex], barkIndex, "bark", barkSlot),
    validateMaterial(baked.gltf.materials[organIndex], organIndex, "organ", organSlot),
  ];
  const requiredUsage = new Map<number, ProcPlantBakedImageUsage>();
  const bindings = new Map<number, string[]>();
  const requireTexture = (index: number | null, usage: ProcPlantBakedImageUsage, binding: string) => {
    if (index === null) return;
    const image = baked.images[index];
    if (!image) throw new Error(`${binding} references missing baked texture ${index}`);
    if (image.usage !== usage) throw new Error(`${binding} requires ${usage}, received ${image.usage}`);
    const prior = requiredUsage.get(index);
    if (prior && prior !== usage) throw new Error(`baked texture ${index} has conflicting usages`);
    requiredUsage.set(index, usage);
    const rows = bindings.get(index) ?? [];
    rows.push(binding);
    bindings.set(index, rows);
  };
  for (const material of validated) {
    requireTexture(material.textures.baseColor, "baseColor", `${material.role}.map`);
    requireTexture(material.textures.orm, "metallicRoughnessOcclusion", `${material.role}.aoMap`);
    requireTexture(material.textures.orm, "metallicRoughnessOcclusion", `${material.role}.roughnessMap`);
    requireTexture(material.textures.orm, "metallicRoughnessOcclusion", `${material.role}.metalnessMap`);
    requireTexture(material.textures.normal, "normal", `${material.role}.normalMap`);
    requireTexture(material.textures.emissive, "emissive", `${material.role}.emissiveMap`);
  }
  const ormUvChannel = options.ormUvChannel ?? 0;
  if (ormUvChannel !== 0 && ormUvChannel !== 1) throw new Error("ormUvChannel must be 0 or 1");
  const uv: ProcPlantThreeMaterialUvRequirement = {
    ormTextureChannel: ormUvChannel,
    attribute: ormUvChannel === 0 ? "uv" : "uv1",
    legacyAttribute: "uv2",
    requiresSecondaryUv: ormUvChannel === 1 && validated.some((material) => material.textures.orm !== null),
  };
  const textureByIndex = new Map<number, THREE.DataTexture>();
  for (const index of [...requiredUsage.keys()].sort((a, b) => a - b)) {
    const image = baked.images[index]!;
    const texture = new THREE.DataTexture(image.rgba.slice(), image.width, image.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.name = image.name;
    texture.colorSpace = image.colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.channel = image.usage === "metallicRoughnessOcclusion" ? ormUvChannel : 0;
    texture.needsUpdate = true;
    texture.userData.procplant = {
      sourceContentHash: baked.sourceContentHash,
      textureIndex: index,
      usage: image.usage,
      contentHash: image.contentHash,
    };
    textureByIndex.set(index, texture);
  }
  const materialByRole = new Map<"bark" | "organ", THREE.MeshStandardMaterial>();
  for (const source of validated) {
    const texture = (index: number | null) => index === null ? null : textureByIndex.get(index)!;
    const color = new THREE.Color().setRGB(source.baseColorFactor[0], source.baseColorFactor[1], source.baseColorFactor[2], THREE.LinearSRGBColorSpace);
    const emissive = new THREE.Color().setRGB(source.emissiveFactor[0], source.emissiveFactor[1], source.emissiveFactor[2], THREE.LinearSRGBColorSpace);
    const material = new THREE.MeshStandardMaterial({
      name: `procplant-${source.slot}`,
      color,
      opacity: source.baseColorFactor[3],
      map: texture(source.textures.baseColor),
      roughness: source.roughnessFactor,
      roughnessMap: texture(source.textures.orm),
      metalness: source.metallicFactor,
      metalnessMap: texture(source.textures.orm),
      aoMap: texture(source.textures.orm),
      aoMapIntensity: source.aoStrength,
      normalMap: texture(source.textures.normal),
      normalScale: new THREE.Vector2(source.normalScale, source.normalScale),
      emissive,
      emissiveMap: texture(source.textures.emissive),
      side: source.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: source.alphaMode === "BLEND",
      depthWrite: source.alphaMode !== "BLEND",
      alphaTest: source.alphaMode === "MASK" ? source.alphaCutoff : 0,
    });
    material.userData.procplant = {
      sourceContentHash: baked.sourceContentHash,
      slot: source.slot,
      role: source.role,
      alphaMode: source.alphaMode,
    };
    materialByRole.set(source.role, material);
  }
  const materialAudits: ProcPlantThreeMaterialAudit[] = validated.map((source) => ({
    role: source.role,
    slot: source.slot,
    materialIndex: source.index,
    alphaMode: source.alphaMode,
    alphaCutoff: source.alphaCutoff,
    doubleSided: source.doubleSided,
    textureIndexes: { ...source.textures },
  }));
  const textureAudits: ProcPlantThreeTextureAudit[] = [...textureByIndex.keys()].sort((a, b) => a - b).map((index) => {
    const image = baked.images[index]!;
    return {
      textureIndex: index,
      name: image.name,
      usage: image.usage,
      width: image.width,
      height: image.height,
      bytes: image.rgba.byteLength,
      colorSpace: image.colorSpace,
      contentHash: image.contentHash,
      bindings: [...bindings.get(index)!],
    };
  });
  const auditBase = {
    contract: PROCPLANT_THREE_MATERIAL_ADAPTER_CONTRACT,
    version: PROCPLANT_THREE_MATERIAL_ADAPTER_VERSION,
    sourceId: baked.sourceId,
    sourceContentHash: baked.sourceContentHash,
    barkSlot,
    organSlot,
    uv,
    materials: materialAudits,
    textures: textureAudits,
    ownedTextureBytes: textureAudits.reduce((sum, texture) => sum + texture.bytes, 0),
  };
  const audit: ProcPlantThreeMaterialAdapterAudit = { ...auditBase, auditHash: stableHash(auditBase) };
  const bark = materialByRole.get("bark")!;
  const organ = materialByRole.get("organ")!;
  return {
    bark,
    organ,
    materialsBySlot: new Map([[barkSlot, bark], [organSlot, organ]]),
    textures: [...textureByIndex.values()],
    uv,
    audit,
  };
};

/** Dispose only the resources allocated by createProcPlantThreeBakedMaterials. */
export const disposeProcPlantThreeBakedMaterials = (prepared: ProcPlantThreeBakedMaterialSet) => {
  if (disposedSets.has(prepared)) return;
  disposedSets.add(prepared);
  prepared.bark.dispose();
  prepared.organ.dispose();
  for (const texture of prepared.textures) texture.dispose();
};
