import * as THREE from "three";
import type { ProcPlantHeroSpineAuthoringPackage } from "./procplant-hero-spine-authoring";
import {
  PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT,
  PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION,
  type ProcPlantMaterializedPlacementDecal,
  type ProcPlantPlacementDecalBinding,
} from "./procplant-organ-placement-overrides";

export const PROCPLANT_IMPORTED_HERO_DECAL_CONTRACT = "procplants.imported-hero-decals" as const;
export const PROCPLANT_IMPORTED_HERO_DECAL_VERSION = 1 as const;
export const PROCPLANT_IMPORTED_HERO_DECAL_MAX_OPERATIONS = 32;
export const PROCPLANT_IMPORTED_HERO_DECAL_MAX_TRIANGLES = 2_000_000;
export const PROCPLANT_IMPORTED_HERO_DECAL_MAX_VERTICES = 2_000_000;
export const PROCPLANT_IMPORTED_HERO_DECAL_MAX_JSON_CHARS = 1024 * 1024;

export interface ProcPlantImportedHeroDecalTarget {
  sourceContentHash: string;
  authoringContentHash: string;
  instanceId: string;
  nodePath: string | null;
  meshIndex: number;
  primitiveIndex: number;
  materialIndex: number;
  transformsBaked: true;
  vertexCount: number;
  triangleCount: number;
  geometrySignature: string;
}

export interface ProcPlantImportedHeroDecalOperation {
  id: string;
  ordinal: number;
  triangleIndex: number;
  vertexIndices: readonly [number, number, number];
  barycentric: readonly [number, number, number];
  size: number;
  rotation: number;
  normalOffset: number;
  binding: ProcPlantPlacementDecalBinding;
}

export interface ProcPlantImportedHeroDecalPackage {
  contract: typeof PROCPLANT_IMPORTED_HERO_DECAL_CONTRACT;
  version: typeof PROCPLANT_IMPORTED_HERO_DECAL_VERSION;
  target: ProcPlantImportedHeroDecalTarget;
  operations: ProcPlantImportedHeroDecalOperation[];
}

export type ProcPlantImportedHeroDecalUnsupportedReason =
  | "target-mismatch" | "missing-binding" | "stale-triangle" | "degenerate-triangle" | "invalid-operation";

export interface ProcPlantImportedHeroDecalApplyResult {
  targetMatched: boolean;
  decals: ProcPlantMaterializedPlacementDecal[];
  unsupported: Array<{ operationId: string | null; reason: ProcPlantImportedHeroDecalUnsupportedReason }>;
}

export interface ProcPlantImportedHeroDecalTargetInspection {
  target: ProcPlantImportedHeroDecalTarget | null;
  reason: "static" | "unbaked-transform" | "ambiguous-material" | "geometry-cap" | "invalid-geometry";
}

const fnvBytes = (arrays: readonly ArrayLike<number>[], metadata: string) => {
  let hash = 0x811c9dc5;
  const update = (byte: number) => { hash ^= byte; hash = Math.imul(hash, 0x01000193); };
  for (const array of arrays) {
    const bytes = ArrayBuffer.isView(array)
      ? new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      : new Uint8Array(new Float64Array(Array.from(array)).buffer);
    for (const byte of bytes) update(byte);
  }
  for (const byte of new TextEncoder().encode(metadata)) update(byte);
  return `geometry-v1-fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const geometryArrays = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  if (!(position instanceof THREE.BufferAttribute) || position.itemSize !== 3 || position.count < 3
    || !(normal instanceof THREE.BufferAttribute) || normal.itemSize !== 3 || normal.count !== position.count
    || !index || index.itemSize !== 1 || index.count < 3 || index.count % 3 !== 0) return null;
  return { position, normal, index };
};

const geometrySignature = (geometry: THREE.BufferGeometry) => {
  const arrays = geometryArrays(geometry);
  if (!arrays) return null;
  return fnvBytes([arrays.position.array, arrays.normal.array, arrays.index.array], `${arrays.position.count}|${arrays.index.count / 3}`);
};

/** Static extraction is evidence-bearing: the importer rejects animations, skins, and morph targets. */
export const inspectProcPlantImportedHeroDecalTarget = (
  authored: ProcPlantHeroSpineAuthoringPackage,
  geometry: THREE.BufferGeometry,
): ProcPlantImportedHeroDecalTargetInspection => {
  if (authored.provenance.transformsBaked !== true) return { target: null, reason: "unbaked-transform" };
  if (authored.provenance.materialIndex === null) return { target: null, reason: "ambiguous-material" };
  const arrays = geometryArrays(geometry);
  const signature = geometrySignature(geometry);
  if (!arrays || !signature) return { target: null, reason: "invalid-geometry" };
  if (arrays.position.count > PROCPLANT_IMPORTED_HERO_DECAL_MAX_VERTICES || arrays.index.count / 3 > PROCPLANT_IMPORTED_HERO_DECAL_MAX_TRIANGLES) {
    return { target: null, reason: "geometry-cap" };
  }
  return { reason: "static", target: Object.freeze({
    sourceContentHash: authored.provenance.sourceContentHash,
    authoringContentHash: authored.contentHash,
    instanceId: authored.provenance.instanceId,
    nodePath: authored.provenance.nodePath,
    meshIndex: authored.provenance.meshIndex,
    primitiveIndex: authored.provenance.primitiveIndex,
    materialIndex: authored.provenance.materialIndex,
    transformsBaked: true,
    vertexCount: arrays.position.count,
    triangleCount: arrays.index.count / 3,
    geometrySignature: signature,
  }) };
};

export const createProcPlantImportedHeroDecalPackage = (target: ProcPlantImportedHeroDecalTarget): ProcPlantImportedHeroDecalPackage => ({
  contract: PROCPLANT_IMPORTED_HERO_DECAL_CONTRACT, version: PROCPLANT_IMPORTED_HERO_DECAL_VERSION, target: { ...target }, operations: [],
});

const validBinding = (binding: ProcPlantPlacementDecalBinding) => binding?.contract === PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT
  && binding.version === PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION && binding.uvSet === 0
  && typeof binding.materialId === "string" && binding.materialId.length > 0 && binding.materialId.length <= 128
  && typeof binding.textureId === "string" && binding.textureId.length > 0 && binding.textureId.length <= 128
  && Array.isArray(binding.uvRect) && binding.uvRect.length === 4
  && binding.uvRect.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  && binding.uvRect[2]! > binding.uvRect[0]! && binding.uvRect[3]! > binding.uvRect[1]!;
const sameBinding = (left: ProcPlantPlacementDecalBinding, right: ProcPlantPlacementDecalBinding) => left.contract === right.contract
  && left.version === right.version && left.materialId === right.materialId && left.textureId === right.textureId && left.uvSet === right.uvSet
  && left.uvRect.every((value, index) => value === right.uvRect[index]);
const quantize = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const copyBinding = (binding: ProcPlantPlacementDecalBinding): ProcPlantPlacementDecalBinding => ({ ...binding, uvRect: [...binding.uvRect] as [number, number, number, number] });
const triangleIndices = (geometry: THREE.BufferGeometry, triangleIndex: number): [number, number, number] | null => {
  const arrays = geometryArrays(geometry);
  if (!arrays || !Number.isInteger(triangleIndex) || triangleIndex < 0 || triangleIndex >= arrays.index.count / 3) return null;
  const offset = triangleIndex * 3;
  return [arrays.index.getX(offset), arrays.index.getX(offset + 1), arrays.index.getX(offset + 2)];
};

export const appendProcPlantImportedHeroDecal = (
  source: ProcPlantImportedHeroDecalPackage,
  geometry: THREE.BufferGeometry,
  input: { triangleIndex: number; localPoint: THREE.Vector3; size: number; binding: ProcPlantPlacementDecalBinding; rotation?: number; normalOffset?: number },
): { package: ProcPlantImportedHeroDecalPackage; operation: ProcPlantImportedHeroDecalOperation | null; reason: "cap" | "target-mismatch" | "invalid" | null } => {
  if (source.operations.length >= PROCPLANT_IMPORTED_HERO_DECAL_MAX_OPERATIONS) return { package: source, operation: null, reason: "cap" };
  if (geometrySignature(geometry) !== source.target.geometrySignature) return { package: source, operation: null, reason: "target-mismatch" };
  const indices = triangleIndices(geometry, input.triangleIndex);
  const position = geometry.getAttribute("position");
  if (!indices || !(position instanceof THREE.BufferAttribute) || !input.localPoint?.isVector3 || !validBinding(input.binding)
    || !Number.isFinite(input.size) || input.size <= 0 || !Number.isFinite(input.rotation ?? 0) || !Number.isFinite(input.normalOffset ?? 0)) {
    return { package: source, operation: null, reason: "invalid" };
  }
  const a = new THREE.Vector3().fromBufferAttribute(position, indices[0]);
  const b = new THREE.Vector3().fromBufferAttribute(position, indices[1]);
  const c = new THREE.Vector3().fromBufferAttribute(position, indices[2]);
  if (new THREE.Triangle(a, b, c).getArea() < 1e-12) return { package: source, operation: null, reason: "invalid" };
  const barycentric = THREE.Triangle.getBarycoord(input.localPoint, a, b, c, new THREE.Vector3());
  if (!barycentric || ![barycentric.x, barycentric.y, barycentric.z].every(Number.isFinite)) return { package: source, operation: null, reason: "invalid" };
  barycentric.set(THREE.MathUtils.clamp(barycentric.x, 0, 1), THREE.MathUtils.clamp(barycentric.y, 0, 1), THREE.MathUtils.clamp(barycentric.z, 0, 1));
  barycentric.multiplyScalar(1 / Math.max(1e-12, barycentric.x + barycentric.y + barycentric.z));
  const ordinal = source.operations.reduce((maximum, operation) => Math.max(maximum, operation.ordinal), -1) + 1;
  const anchor = [quantize(barycentric.x), quantize(barycentric.y), 0] as [number, number, number];
  anchor[2] = quantize(1 - anchor[0] - anchor[1]);
  const identity = `${source.target.geometrySignature}|${input.triangleIndex}|${anchor.join(",")}|${ordinal}|${JSON.stringify(input.binding)}`;
  const operation: ProcPlantImportedHeroDecalOperation = {
    id: `imported-hero-decal-${fnvBytes([], identity).split(":").at(-1)}`, ordinal, triangleIndex: input.triangleIndex,
    vertexIndices: indices, barycentric: anchor, size: quantize(THREE.MathUtils.clamp(input.size, 0.002, 5)),
    rotation: quantize(((input.rotation ?? 0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)),
    normalOffset: quantize(THREE.MathUtils.clamp(input.normalOffset ?? 0.0004, 0.00001, 0.05)), binding: copyBinding(input.binding),
  };
  return { package: { ...source, target: { ...source.target }, operations: [...source.operations, operation] }, operation, reason: null };
};

export const undoLastProcPlantImportedHeroDecal = (source: ProcPlantImportedHeroDecalPackage): ProcPlantImportedHeroDecalPackage => ({
  ...source, target: { ...source.target }, operations: source.operations.slice(0, -1),
});
const exactTarget = (left: ProcPlantImportedHeroDecalTarget, right: ProcPlantImportedHeroDecalTarget) =>
  left.sourceContentHash === right.sourceContentHash && left.authoringContentHash === right.authoringContentHash
  && left.instanceId === right.instanceId && left.nodePath === right.nodePath && left.meshIndex === right.meshIndex
  && left.primitiveIndex === right.primitiveIndex && left.materialIndex === right.materialIndex
  && left.transformsBaked === right.transformsBaked && left.vertexCount === right.vertexCount
  && left.triangleCount === right.triangleCount && left.geometrySignature === right.geometrySignature;

export const applyProcPlantImportedHeroDecals = (
  currentTarget: ProcPlantImportedHeroDecalTarget,
  geometry: THREE.BufferGeometry,
  source: ProcPlantImportedHeroDecalPackage,
  bindings: readonly ProcPlantPlacementDecalBinding[],
): ProcPlantImportedHeroDecalApplyResult => {
  if (source.contract !== PROCPLANT_IMPORTED_HERO_DECAL_CONTRACT || source.version !== PROCPLANT_IMPORTED_HERO_DECAL_VERSION
    || !exactTarget(source.target, currentTarget) || geometrySignature(geometry) !== currentTarget.geometrySignature) {
    return { targetMatched: false, decals: [], unsupported: [{ operationId: null, reason: "target-mismatch" }] };
  }
  const arrays = geometryArrays(geometry)!;
  const decals: ProcPlantMaterializedPlacementDecal[] = [];
  const unsupported: ProcPlantImportedHeroDecalApplyResult["unsupported"] = [];
  for (const operation of [...source.operations].sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))) {
    const indices = triangleIndices(geometry, operation.triangleIndex);
    if (!indices || !indices.every((value, index) => value === operation.vertexIndices[index])) { unsupported.push({ operationId: operation.id, reason: "stale-triangle" }); continue; }
    const binding = bindings.find((candidate) => sameBinding(candidate, operation.binding));
    if (!binding) { unsupported.push({ operationId: operation.id, reason: "missing-binding" }); continue; }
    if (!Array.isArray(operation.barycentric) || operation.barycentric.length !== 3 || !operation.barycentric.every(Number.isFinite)
      || Math.abs(operation.barycentric.reduce((sum, value) => sum + value, 0) - 1) > 2e-6 || !Number.isFinite(operation.size)
      || operation.size < 0.002 || operation.size > 5 || !Number.isFinite(operation.rotation) || !Number.isFinite(operation.normalOffset)) {
      unsupported.push({ operationId: operation.id, reason: "invalid-operation" }); continue;
    }
    const [ia, ib, ic] = indices;
    const a = new THREE.Vector3().fromBufferAttribute(arrays.position, ia);
    const b = new THREE.Vector3().fromBufferAttribute(arrays.position, ib);
    const c = new THREE.Vector3().fromBufferAttribute(arrays.position, ic);
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (normal.lengthSq() < 1e-12) { unsupported.push({ operationId: operation.id, reason: "degenerate-triangle" }); continue; }
    normal.normalize();
    const center = a.clone().multiplyScalar(operation.barycentric[0]).addScaledVector(b, operation.barycentric[1])
      .addScaledVector(c, operation.barycentric[2]).addScaledVector(normal, operation.normalOffset);
    const edges = [b.clone().sub(a), c.clone().sub(b), a.clone().sub(c)];
    const tangent = edges.reduce((best, edge) => edge.lengthSq() > best.lengthSq() ? edge : best).projectOnPlane(normal).normalize();
    if (tangent.lengthSq() < 1e-12) { unsupported.push({ operationId: operation.id, reason: "degenerate-triangle" }); continue; }
    tangent.applyAxisAngle(normal, operation.rotation);
    const across = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const uvAspect = (binding.uvRect[3] - binding.uvRect[1]) / (binding.uvRect[2] - binding.uvRect[0]);
    const halfWidth = operation.size * 0.5;
    const halfHeight = halfWidth * uvAspect;
    const corners = [center.clone().addScaledVector(across, -halfWidth).addScaledVector(tangent, -halfHeight),
      center.clone().addScaledVector(across, halfWidth).addScaledVector(tangent, -halfHeight),
      center.clone().addScaledVector(across, halfWidth).addScaledVector(tangent, halfHeight),
      center.clone().addScaledVector(across, -halfWidth).addScaledVector(tangent, halfHeight)];
    const pos = new Float32Array(12); const nrm = new Float32Array(12);
    corners.forEach((corner, index) => { pos.set(corner.toArray(), index * 3); nrm.set(normal.toArray(), index * 3); });
    const [u0, v0, u1, v1] = binding.uvRect;
    decals.push({ operationId: operation.id, materialId: binding.materialId, textureId: binding.textureId, uvSet: 0, template: {
      pos, nrm, uv0: new Float32Array([u0, v1, u1, v1, u1, v0, u0, v0]), col: new Float32Array(12).fill(1),
      tintable: new Uint8Array(4), sway: new Float32Array(4), idx: Uint32Array.of(0, 1, 2, 0, 2, 3),
    } });
  }
  return { targetMatched: true, decals, unsupported };
};

export const serializeProcPlantImportedHeroDecals = (source: ProcPlantImportedHeroDecalPackage) => {
  assertSerializedPackage(source);
  const json = JSON.stringify(source);
  if (json.length > PROCPLANT_IMPORTED_HERO_DECAL_MAX_JSON_CHARS) throw new Error("imported-hero decal JSON exceeds the 1 MiB cap");
  return json;
};
export const parseProcPlantImportedHeroDecals = (json: string): ProcPlantImportedHeroDecalPackage => {
  if (typeof json !== "string" || json.length < 2 || json.length > PROCPLANT_IMPORTED_HERO_DECAL_MAX_JSON_CHARS) throw new Error("imported-hero decal JSON must contain 2..1048576 characters");
  const parsed = JSON.parse(json) as ProcPlantImportedHeroDecalPackage;
  assertSerializedPackage(parsed);
  return JSON.parse(JSON.stringify(parsed)) as ProcPlantImportedHeroDecalPackage;
};

const assertSerializedPackage = (source: ProcPlantImportedHeroDecalPackage) => {
  const target = source?.target;
  if (source?.contract !== PROCPLANT_IMPORTED_HERO_DECAL_CONTRACT || source.version !== PROCPLANT_IMPORTED_HERO_DECAL_VERSION
    || !target || typeof target.sourceContentHash !== "string" || target.sourceContentHash.length < 1 || target.sourceContentHash.length > 128
    || typeof target.authoringContentHash !== "string" || target.authoringContentHash.length < 1 || target.authoringContentHash.length > 128
    || typeof target.instanceId !== "string" || target.instanceId.length < 1 || target.instanceId.length > 256
    || (target.nodePath !== null && (typeof target.nodePath !== "string" || target.nodePath.length > 1024))
    || ![target.meshIndex, target.primitiveIndex, target.materialIndex].every((value) => Number.isInteger(value) && value >= 0)
    || target.transformsBaked !== true || !Number.isInteger(target.vertexCount) || target.vertexCount < 3 || target.vertexCount > PROCPLANT_IMPORTED_HERO_DECAL_MAX_VERTICES
    || !Number.isInteger(target.triangleCount) || target.triangleCount < 1 || target.triangleCount > PROCPLANT_IMPORTED_HERO_DECAL_MAX_TRIANGLES
    || typeof target.geometrySignature !== "string" || !/^geometry-v1-fnv1a32:[0-9a-f]{8}$/.test(target.geometrySignature)
    || !Array.isArray(source.operations) || source.operations.length > PROCPLANT_IMPORTED_HERO_DECAL_MAX_OPERATIONS) {
    throw new Error("unsupported or invalid imported-hero decal package");
  }
  const ids = new Set<string>();
  for (const operation of source.operations) {
    if (!operation || typeof operation.id !== "string" || operation.id.length < 1 || operation.id.length > 128 || ids.has(operation.id)
      || !Number.isInteger(operation.ordinal) || operation.ordinal < 0 || !Number.isInteger(operation.triangleIndex)
      || operation.triangleIndex < 0 || operation.triangleIndex >= target.triangleCount
      || !Array.isArray(operation.vertexIndices) || operation.vertexIndices.length !== 3
      || !operation.vertexIndices.every((value) => Number.isInteger(value) && value >= 0 && value < target.vertexCount)
      || !Array.isArray(operation.barycentric) || operation.barycentric.length !== 3 || !operation.barycentric.every(Number.isFinite)
      || Math.abs(operation.barycentric.reduce((sum, value) => sum + value, 0) - 1) > 2e-6
      || operation.barycentric.some((value) => value < 0 || value > 1) || !Number.isFinite(operation.size) || operation.size < 0.002 || operation.size > 5
      || !Number.isFinite(operation.rotation) || operation.rotation < 0 || operation.rotation >= Math.PI * 2 + 1e-6
      || !Number.isFinite(operation.normalOffset) || operation.normalOffset < 0.00001 || operation.normalOffset > 0.05
      || !validBinding(operation.binding)) throw new Error("unsupported or invalid imported-hero decal package");
    ids.add(operation.id);
  }
};
