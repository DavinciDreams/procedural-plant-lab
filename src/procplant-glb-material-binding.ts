import * as THREE from "three";
import type { GLTFExporterOptions } from "three/addons/exporters/GLTFExporter.js";
import {
  PROCPLANT_MATERIAL_BAKE_CONTRACT,
  PROCPLANT_MATERIAL_BAKE_VERSION,
  type ProcPlantBakedMaterialBundle,
} from "./procplant-material-bake";
import {
  PROCPLANT_MATERIAL_KTX2_CONTRACT,
  PROCPLANT_MATERIAL_KTX2_VERSION,
  validateProcPlantMaterialKtx2Bundle,
  type ProcPlantMaterialKtx2Bundle,
} from "./procplant-material-ktx2";
import { exportProcPlantScenesGlb } from "./procplant-export";
import {
  PROCPLANT_UV0_CONTRACT,
  PROCPLANT_UV0_VERSION,
  declareProcPlantGeometryUv0,
  requireProcPlantGeometryUv0,
} from "./procplant-uv0";
export { PROCPLANT_UV0_CONTRACT, PROCPLANT_UV0_VERSION, declareProcPlantGeometryUv0 } from "./procplant-uv0";
export type { ProcPlantUv0Contract } from "./procplant-uv0";

export const PROCPLANT_GLB_MATERIAL_BINDING_CONTRACT = "procplants.glb-material-binding" as const;
export const PROCPLANT_GLB_MATERIAL_BINDING_VERSION = 1 as const;

export interface ProcPlantGlbMaterialBindingInput {
  scene: THREE.Scene;
  meshes: readonly THREE.Mesh[];
}

export interface ProcPlantGlbMaterialBindingOptions {
  slotByMeshName?: Readonly<Record<string, string>>;
  /** Explicit materialIndex -> baked slot mapping for grouped geometry. */
  groupSlotsByMeshName?: Readonly<Record<string, readonly string[]>>;
  exporter?: Omit<GLTFExporterOptions, "binary">;
  maxMeshes?: number;
  maxVertices?: number;
  maxGroups?: number;
  maxIndexElements?: number;
  maxImages?: number;
  maxImageBytes?: number;
  maxGlbBytes?: number;
  /** Optional pre-encoded build-time payload. PNG remains the default and fallback-free KTX2 is explicit. */
  textureEncoding?: ProcPlantMaterialKtx2Bundle;
}

export interface ProcPlantGlbMaterialAssignment {
  meshName: string;
  slot: string;
  bakedMaterial: number;
  /** Present only for an explicitly mapped BufferGeometry group. */
  groupIndex?: number;
  primitiveIndex?: number;
  materialIndex?: number;
  start?: number;
  count?: number;
}

export interface PreparedProcPlantGlbMaterialBinding {
  contract: typeof PROCPLANT_GLB_MATERIAL_BINDING_CONTRACT;
  version: typeof PROCPLANT_GLB_MATERIAL_BINDING_VERSION;
  sourceId: string;
  sourceContentHash: string;
  assignments: ProcPlantGlbMaterialAssignment[];
  maxGlbBytes: number;
}

export interface ProcPlantMaterialBoundGlb {
  contract: typeof PROCPLANT_GLB_MATERIAL_BINDING_CONTRACT;
  version: typeof PROCPLANT_GLB_MATERIAL_BINDING_VERSION;
  assignments: ProcPlantGlbMaterialAssignment[];
  bytes: ArrayBuffer;
  contentHash: string;
}

const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  return value;
};

const hashBytes = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};

const validateUv = (geometry: THREE.BufferGeometry, label: string) => {
  return requireProcPlantGeometryUv0(geometry, label);
};

/** Validate all geometry, slots, baked bytes, and resource caps before GLB serialization. */
export const prepareProcPlantGlbMaterialBinding = (
  input: ProcPlantGlbMaterialBindingInput,
  baked: ProcPlantBakedMaterialBundle,
  options: ProcPlantGlbMaterialBindingOptions = {},
): PreparedProcPlantGlbMaterialBinding => {
  if (baked.contract !== PROCPLANT_MATERIAL_BAKE_CONTRACT || baked.version !== PROCPLANT_MATERIAL_BAKE_VERSION) {
    throw new Error("unsupported procplant material bake contract/version");
  }
  if (!baked.ready) throw new Error("material bake is not ready; resolve blocking diagnostics before GLB binding");
  if (!Array.isArray(input.meshes) || input.meshes.length === 0) throw new Error("GLB material binding requires at least one mesh");
  const maxMeshes = integer(options.maxMeshes ?? 128, 1, 4096, "maxMeshes");
  const maxVertices = integer(options.maxVertices ?? 10_000_000, 1, 100_000_000, "maxVertices");
  const maxGroups = integer(options.maxGroups ?? 512, 1, 8192, "maxGroups");
  const maxIndexElements = integer(options.maxIndexElements ?? 30_000_000, 1, 300_000_000, "maxIndexElements");
  const maxImages = integer(options.maxImages ?? 128, 1, 1024, "maxImages");
  const maxImageBytes = integer(options.maxImageBytes ?? 256 * 1024 * 1024, 1, 1024 * 1024 * 1024, "maxImageBytes");
  const maxGlbBytes = integer(options.maxGlbBytes ?? 512 * 1024 * 1024, 1, 1024 * 1024 * 1024, "maxGlbBytes");
  if (input.meshes.length > maxMeshes) throw new Error(`GLB material binding exceeds maxMeshes (${input.meshes.length} > ${maxMeshes})`);
  if (baked.images.length > maxImages) throw new Error(`GLB material binding exceeds maxImages (${baked.images.length} > ${maxImages})`);
  const imageBytes = baked.images.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  if (!Number.isSafeInteger(imageBytes) || imageBytes > maxImageBytes) throw new Error(`GLB material binding exceeds maxImageBytes (${imageBytes} > ${maxImageBytes})`);
  const materialBySlot = new Map<string, number>();
  baked.gltf.materials.forEach((material, index) => {
    const slot = material.name;
    if (typeof slot !== "string" || !slot) throw new Error(`baked material ${index} is missing a slot name`);
    if (materialBySlot.has(slot)) throw new Error(`duplicate baked material slot ${slot}`);
    materialBySlot.set(slot, index);
  });
  const meshNames = new Set<string>();
  let vertices = 0;
  let groupCount = 0;
  let indexElements = 0;
  const assignments: ProcPlantGlbMaterialAssignment[] = [];
  for (const mesh of input.meshes) {
    if (!mesh?.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) throw new Error("GLB material binding accepts BufferGeometry meshes only");
    if (!mesh.name || meshNames.has(mesh.name)) throw new Error("GLB material binding mesh names must be non-empty and unique");
    meshNames.add(mesh.name);
    vertices += validateUv(mesh.geometry, mesh.name);
    if (input.scene.getObjectById(mesh.id) !== mesh) throw new Error(`${mesh.name} is not contained in the exported scene`);
    if (!Number.isSafeInteger(vertices) || vertices > maxVertices) throw new Error(`GLB material binding exceeds maxVertices (${vertices} > ${maxVertices})`);
    const explicitSlot = options.slotByMeshName?.[mesh.name] ?? mesh.userData.procplantMaterialSlot;
    const groupSlots = options.groupSlotsByMeshName?.[mesh.name];
    if (groupSlots !== undefined) {
      if (explicitSlot !== undefined) throw new Error(`${mesh.name} must not mix whole-mesh and group material slot bindings`);
      const groups = mesh.geometry.groups;
      groupCount += groups.length;
      if (groups.length === 0 || groupCount > maxGroups) throw new Error(`grouped material binding requires 1-${maxGroups} total geometry groups`);
      const index = mesh.geometry.index;
      const positionCount = mesh.geometry.getAttribute("position").count;
      if (index && (index.itemSize !== 1 || index.normalized || !(
        index.array instanceof Uint8Array || index.array instanceof Uint16Array || index.array instanceof Uint32Array
      ))) throw new Error(`${mesh.name}.index must be an unnormalized unsigned scalar accessor`);
      const elementCount = index?.count ?? positionCount;
      indexElements += elementCount;
      if (!Number.isSafeInteger(indexElements) || indexElements > maxIndexElements) {
        throw new Error(`grouped material binding exceeds maxIndexElements (${indexElements} > ${maxIndexElements})`);
      }
      if (index) for (let indexElement = 0; indexElement < index.count; indexElement++) {
        const vertex = index.getX(indexElement);
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= positionCount) throw new Error(`${mesh.name}.index[${indexElement}] is out of range`);
      }
      if (elementCount % 3 !== 0) throw new Error(`${mesh.name} geometry elements must form complete triangles`);
      let cursor = 0;
      const usedMaterialIndexes = new Set<number>();
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex]!;
        if (!Number.isInteger(group.start) || !Number.isInteger(group.count) || group.start !== cursor || group.count <= 0 ||
          group.start % 3 !== 0 || group.count % 3 !== 0) {
          throw new Error(`${mesh.name} groups must be ordered, contiguous, non-overlapping triangle ranges`);
        }
        if (!Number.isInteger(group.materialIndex) || group.materialIndex < 0 || group.materialIndex > 255) {
          throw new Error(`${mesh.name} group ${groupIndex} has an invalid materialIndex`);
        }
        const slot = groupSlots[group.materialIndex];
        if (typeof slot !== "string" || !slot || !materialBySlot.has(slot)) {
          throw new Error(`${mesh.name} group ${groupIndex} requires an explicit valid baked slot for materialIndex ${group.materialIndex}`);
        }
        usedMaterialIndexes.add(group.materialIndex);
        assignments.push({
          meshName: mesh.name,
          slot,
          bakedMaterial: materialBySlot.get(slot)!,
          groupIndex,
          primitiveIndex: groupIndex,
          materialIndex: group.materialIndex,
          start: group.start,
          count: group.count,
        });
        cursor += group.count;
      }
      if (cursor !== elementCount) throw new Error(`${mesh.name} groups must cover every geometry element exactly once`);
      const materialIndexes = [...usedMaterialIndexes].sort((left, right) => left - right);
      if (materialIndexes.some((value, index) => value !== index) || groupSlots.length !== materialIndexes.length) {
        throw new Error(`${mesh.name} group material indexes and slot mapping must be dense and exactly covered`);
      }
      continue;
    }
    const slot = typeof explicitSlot === "string" && explicitSlot
      ? explicitSlot
      : materialBySlot.size === 1 ? materialBySlot.keys().next().value as string : undefined;
    if (!slot || !materialBySlot.has(slot)) throw new Error(`${mesh.name} requires an explicit valid procplant material slot`);
    assignments.push({ meshName: mesh.name, slot, bakedMaterial: materialBySlot.get(slot)! });
  }
  return {
    contract: PROCPLANT_GLB_MATERIAL_BINDING_CONTRACT,
    version: PROCPLANT_GLB_MATERIAL_BINDING_VERSION,
    sourceId: baked.sourceId,
    sourceContentHash: baked.sourceContentHash,
    assignments,
    maxGlbBytes,
  };
};

const align4 = (value: number) => Math.ceil(value / 4) * 4;
const uint32 = (target: Uint8Array, offset: number, value: number) => new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value, true);

const parseGlb = (source: ArrayBuffer, maxBytes: number) => {
  if (source.byteLength < 20 || source.byteLength > maxBytes) throw new Error("base GLB is truncated or exceeds maxGlbBytes");
  const view = new DataView(source);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== source.byteLength) {
    throw new Error("base GLB has an invalid header");
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength + 8 > source.byteLength) throw new Error("base GLB has an invalid JSON chunk");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(source, 20, jsonLength)).trim()) as Record<string, any>;
  const binaryHeader = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryHeader, true);
  if (view.getUint32(binaryHeader + 4, true) !== 0x004e4942 || binaryHeader + 8 + binaryLength !== source.byteLength) {
    throw new Error("base GLB must contain exactly one BIN chunk");
  }
  const declared = json.buffers?.[0]?.byteLength;
  if (!Number.isInteger(declared) || declared < 0 || declared > binaryLength) throw new Error("base GLB has an invalid buffer length");
  return { json, binary: new Uint8Array(source, binaryHeader + 8, declared).slice() };
};

const adjustMaterialTextureIndexes = (material: Record<string, any>, textureBase: number) => {
  const copy = structuredClone(material);
  const infos = [copy.pbrMetallicRoughness?.baseColorTexture, copy.pbrMetallicRoughness?.metallicRoughnessTexture,
    copy.normalTexture, copy.occlusionTexture, copy.emissiveTexture];
  for (const info of infos) if (info) info.index += textureBase;
  return copy;
};

/** Purely embeds already-encoded PNGs and rewires UV0 primitives in an existing GLB. */
export const bindProcPlantBakedMaterialsIntoGlb = (
  baseGlb: ArrayBuffer,
  baked: ProcPlantBakedMaterialBundle,
  prepared: PreparedProcPlantGlbMaterialBinding,
  textureEncoding?: ProcPlantMaterialKtx2Bundle,
): ProcPlantMaterialBoundGlb => {
  if (prepared.contract !== PROCPLANT_GLB_MATERIAL_BINDING_CONTRACT || prepared.version !== PROCPLANT_GLB_MATERIAL_BINDING_VERSION) {
    throw new Error("unsupported prepared GLB material binding contract/version");
  }
  if (baked.contract !== PROCPLANT_MATERIAL_BAKE_CONTRACT || baked.version !== PROCPLANT_MATERIAL_BAKE_VERSION || !baked.ready) {
    throw new Error("GLB material binding requires a ready supported material bake");
  }
  if (prepared.sourceId !== baked.sourceId || prepared.sourceContentHash !== baked.sourceContentHash) {
    throw new Error("prepared GLB material binding does not match the material bake source");
  }
  if (textureEncoding) {
    if (textureEncoding.contract !== PROCPLANT_MATERIAL_KTX2_CONTRACT || textureEncoding.version !== PROCPLANT_MATERIAL_KTX2_VERSION) {
      throw new Error("unsupported procplant material KTX2 contract/version");
    }
    if (textureEncoding.sourceBakeContentHash !== baked.contentHash || textureEncoding.images.length !== baked.images.length) {
      throw new Error("material KTX2 bundle does not match the material bake");
    }
    validateProcPlantMaterialKtx2Bundle(baked, textureEncoding);
    for (let index = 0; index < baked.images.length; index++) {
      const source = baked.images[index]!;
      const encoded = textureEncoding.images[index]!;
      if (encoded.name !== source.name || encoded.usage !== source.usage || encoded.width !== source.width || encoded.height !== source.height ||
        !(encoded.bytes instanceof Uint8Array) || encoded.bytes.byteLength === 0) {
        throw new Error(`material KTX2 image ${index} does not match the material bake`);
      }
    }
  }
  const { json, binary } = parseGlb(baseGlb, prepared.maxGlbBytes);
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const nodeByName = new Map<string, any>();
  for (const node of nodes) if (typeof node.name === "string") {
    if (nodeByName.has(node.name)) throw new Error(`base GLB contains duplicate node name ${node.name}`);
    nodeByName.set(node.name, node);
  }
  json.bufferViews ??= [];
  json.images ??= [];
  json.textures ??= [];
  json.materials ??= [];
  const textureBase = json.textures.length;
  const materialBase = json.materials.length;
  if (baked.images.length !== baked.gltf.images.length || baked.images.length !== baked.gltf.textures.length) {
    throw new Error("material bake image and texture tables are inconsistent");
  }
  const binaryParts: Uint8Array[] = [binary];
  let binaryLength = binary.byteLength;
  for (let imageIndex = 0; imageIndex < baked.images.length; imageIndex++) {
    const image = baked.images[imageIndex]!;
    const encoded = textureEncoding?.images[imageIndex];
    const imageBytes = encoded?.bytes ?? image.bytes;
    const aligned = align4(binaryLength);
    const nextBinaryLength = aligned + imageBytes.byteLength;
    if (!Number.isSafeInteger(nextBinaryLength) || nextBinaryLength > prepared.maxGlbBytes) {
      throw new Error(`material-bound GLB image payload exceeds maxGlbBytes (${nextBinaryLength} > ${prepared.maxGlbBytes})`);
    }
    if (aligned > binaryLength) binaryParts.push(new Uint8Array(aligned - binaryLength));
    binaryLength = aligned;
    const bufferView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: imageBytes.byteLength, name: image.name });
    json.images.push({ bufferView, mimeType: encoded ? "image/ktx2" : "image/png", name: image.name });
    const source = json.images.length - 1;
    json.textures.push(encoded ? { extensions: { KHR_texture_basisu: { source } }, name: image.name } : { source, name: image.name });
    binaryParts.push(imageBytes);
    binaryLength = nextBinaryLength;
  }
  if (textureEncoding) {
    json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), "KHR_texture_basisu"])];
    json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), "KHR_texture_basisu"])];
  }
  for (const material of baked.gltf.materials) json.materials.push(adjustMaterialTextureIndexes(material, textureBase));
  const assignmentsByMesh = new Map<string, ProcPlantGlbMaterialAssignment[]>();
  for (const assignment of prepared.assignments) {
    if (!Number.isInteger(assignment.bakedMaterial) || assignment.bakedMaterial < 0 || assignment.bakedMaterial >= baked.gltf.materials.length) {
      throw new Error("prepared GLB material assignments are invalid");
    }
    if (baked.gltf.materials[assignment.bakedMaterial]?.name !== assignment.slot) {
      throw new Error("prepared GLB material assignment slot does not match its baked material");
    }
    const list = assignmentsByMesh.get(assignment.meshName) ?? [];
    list.push(assignment);
    assignmentsByMesh.set(assignment.meshName, list);
  }
  for (const [meshName, assignments] of assignmentsByMesh) {
    const node = nodeByName.get(meshName);
    const mesh = node && Number.isInteger(node.mesh) ? meshes[node.mesh] : undefined;
    if (!mesh || !Array.isArray(mesh.primitives) || mesh.primitives.length === 0) throw new Error(`base GLB is missing mesh node ${meshName}`);
    const grouped = assignments.some((assignment) => assignment.groupIndex !== undefined);
    if (!grouped) {
      if (assignments.length !== 1) throw new Error(`${meshName} has duplicate whole-mesh material assignments`);
      for (const primitive of mesh.primitives) {
        if (!primitive.attributes || !Number.isInteger(primitive.attributes.TEXCOORD_0)) throw new Error(`${meshName} GLB primitive is missing TEXCOORD_0`);
        primitive.material = materialBase + assignments[0]!.bakedMaterial;
      }
      continue;
    }
    const ordered = [...assignments].sort((left, right) => left.groupIndex! - right.groupIndex!);
    if (ordered.length !== mesh.primitives.length || ordered.some((assignment, index) =>
      assignment.groupIndex !== index || assignment.primitiveIndex !== index || !Number.isInteger(assignment.count))) {
      throw new Error(`${meshName} grouped assignments must cover every exported primitive exactly once`);
    }
    let declaredCursor = 0;
    const declaredMaterialIndexes = new Set<number>();
    for (const assignment of ordered) {
      if (assignment.start !== declaredCursor || assignment.count! <= 0 || assignment.start % 3 !== 0 || assignment.count! % 3 !== 0 ||
        !Number.isInteger(assignment.materialIndex) || assignment.materialIndex! < 0) {
        throw new Error(`${meshName} grouped assignments contain invalid or overlapping ranges`);
      }
      declaredCursor += assignment.count!;
      declaredMaterialIndexes.add(assignment.materialIndex!);
    }
    const denseIndexes = [...declaredMaterialIndexes].sort((left, right) => left - right);
    if (denseIndexes.some((value, index) => value !== index)) throw new Error(`${meshName} grouped assignment material indexes must be dense`);
    for (let primitiveIndex = 0; primitiveIndex < mesh.primitives.length; primitiveIndex++) {
      const primitive = mesh.primitives[primitiveIndex]!;
      const assignment = ordered[primitiveIndex]!;
      if (!primitive.attributes || !Number.isInteger(primitive.attributes.TEXCOORD_0)) {
        throw new Error(`${meshName} GLB primitive ${primitiveIndex} is missing TEXCOORD_0`);
      }
      if (!Number.isInteger(primitive.indices) || json.accessors?.[primitive.indices]?.count !== assignment.count) {
        throw new Error(`${meshName} GLB primitive ${primitiveIndex} does not match its declared geometry group`);
      }
      primitive.material = materialBase + assignment.bakedMaterial;
    }
  }
  json.buffers[0].byteLength = binaryLength;
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    procplantsMaterialBinding: {
      contract: prepared.contract,
      version: prepared.version,
      sourceId: prepared.sourceId,
      sourceContentHash: prepared.sourceContentHash,
      assignments: prepared.assignments,
      textureEncoding: textureEncoding ? {
        contract: textureEncoding.contract,
        version: textureEncoding.version,
        contentHash: textureEncoding.contentHash,
        encoder: textureEncoding.encoder,
        determinismExpectation: textureEncoding.determinismExpectation,
      } : { mimeType: "image/png" },
    },
  };
  const jsonRaw = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(align4(jsonRaw.byteLength)).fill(0x20);
  jsonPadded.set(jsonRaw);
  const binaryPaddedLength = align4(binaryLength);
  const total = 12 + 8 + jsonPadded.byteLength + 8 + binaryPaddedLength;
  if (total > prepared.maxGlbBytes) throw new Error(`material-bound GLB exceeds maxGlbBytes (${total} > ${prepared.maxGlbBytes})`);
  const combined = new Uint8Array(binaryLength);
  let binaryOffset = 0;
  for (const part of binaryParts) { combined.set(part, binaryOffset); binaryOffset += part.byteLength; }
  const binaryPadded = new Uint8Array(binaryPaddedLength);
  binaryPadded.set(combined);
  const output = new Uint8Array(total);
  uint32(output, 0, 0x46546c67); uint32(output, 4, 2); uint32(output, 8, total);
  uint32(output, 12, jsonPadded.byteLength); uint32(output, 16, 0x4e4f534a); output.set(jsonPadded, 20);
  const binHeader = 20 + jsonPadded.byteLength;
  uint32(output, binHeader, binaryPadded.byteLength); uint32(output, binHeader + 4, 0x004e4942); output.set(binaryPadded, binHeader + 8);
  return {
    contract: PROCPLANT_GLB_MATERIAL_BINDING_CONTRACT,
    version: PROCPLANT_GLB_MATERIAL_BINDING_VERSION,
    assignments: prepared.assignments.map((assignment) => ({ ...assignment })),
    bytes: output.buffer,
    contentHash: hashBytes(output),
  };
};

/** Validate UV0 first, serialize geometry, then embed baked materials without canvas/image decoding. */
export const exportProcPlantGlbWithBakedMaterials = async (
  input: ProcPlantGlbMaterialBindingInput,
  baked: ProcPlantBakedMaterialBundle,
  options: ProcPlantGlbMaterialBindingOptions = {},
) => {
  const prepared = prepareProcPlantGlbMaterialBinding(input, baked, options);
  const groupedNames = new Set(prepared.assignments.filter((assignment) => assignment.groupIndex !== undefined).map((assignment) => assignment.meshName));
  if (groupedNames.size === 0) {
    const base = await exportProcPlantScenesGlb(input.scene, options.exporter);
    return bindProcPlantBakedMaterialsIntoGlb(base, baked, prepared, options.textureEncoding);
  }
  const exportScene = input.scene.clone(true);
  const ownedGeometries: THREE.BufferGeometry[] = [];
  try {
    for (const meshName of groupedNames) {
      const sourceMesh = input.meshes.find((mesh) => mesh.name === meshName)!;
      const exportMesh = exportScene.getObjectByName(meshName) as THREE.Mesh | undefined;
      if (!exportMesh?.isMesh) throw new Error(`cloned export scene is missing grouped mesh ${meshName}`);
      const geometry = sourceMesh.geometry.clone();
      ownedGeometries.push(geometry);
      exportMesh.geometry = geometry;
      const assignments = prepared.assignments.filter((assignment) => assignment.meshName === meshName);
      const materialCount = Math.max(...assignments.map((assignment) => assignment.materialIndex!)) + 1;
      const placeholder = Array.isArray(sourceMesh.material) ? sourceMesh.material[0] : sourceMesh.material;
      if (!placeholder) throw new Error(`${meshName} has no placeholder export material`);
      exportMesh.material = Array.from({ length: materialCount }, () => placeholder);
    }
    const base = await exportProcPlantScenesGlb(exportScene, options.exporter);
    return bindProcPlantBakedMaterialsIntoGlb(base, baked, prepared, options.textureEncoding);
  } finally {
    for (const geometry of ownedGeometries) geometry.dispose();
  }
};
