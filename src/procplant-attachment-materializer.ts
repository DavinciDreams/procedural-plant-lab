import * as THREE from "three";
import type {
  ProcPlantMeshAttachmentClass,
  ProcPlantMeshAttachmentPackage,
  ProcPlantMeshAttachmentRecord,
} from "./procplant-mesh-helper";

export const PROCPLANT_ATTACHMENT_MATERIALIZATION_CONTRACT =
  "procplants.attachment-materialization" as const;
export const PROCPLANT_ATTACHMENT_MATERIALIZATION_VERSION = 1 as const;

export interface ProcPlantAttachmentPrototype {
  /** Stable prototype identifier used in diagnostics and mesh names. */
  id: string;
  /** Attachment groups that share this geometry and material. */
  groupIds: readonly string[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Dispose the supplied geometry when the materialization is disposed. */
  ownsGeometry?: boolean;
  /** Dispose the supplied material when the materialization is disposed. */
  ownsMaterial?: boolean;
}

export interface ProcPlantAttachmentMaterializationOptions {
  /** Only these attachment classes are candidates. Defaults to branch/accessory. */
  includeKinds?: readonly ProcPlantMeshAttachmentClass[];
  /** Fail closed if any candidate attachment lacks a prototype mapping. */
  failOnUnmatched?: boolean;
  name?: string;
}

export interface ProcPlantAttachmentPrototypeAudit {
  id: string;
  groupIds: string[];
  instances: number;
  prototypeVertices: number;
  prototypeTriangles: number;
  materializedVertices: number;
  materializedTriangles: number;
}

export interface ProcPlantAttachmentMaterializationAudit {
  contract: typeof PROCPLANT_ATTACHMENT_MATERIALIZATION_CONTRACT;
  version: typeof PROCPLANT_ATTACHMENT_MATERIALIZATION_VERSION;
  contentHash: string;
  sourceAttachments: number;
  candidateAttachments: number;
  skippedAttachments: number;
  materializedAttachments: number;
  unmatchedAttachmentIds: string[];
  instanceDraws: number;
  materializedVertices: number;
  materializedTriangles: number;
  branchInstances: number;
  accessoryInstances: number;
  prototypes: ProcPlantAttachmentPrototypeAudit[];
}

export interface ProcPlantAttachmentMaterialization {
  contract: typeof PROCPLANT_ATTACHMENT_MATERIALIZATION_CONTRACT;
  version: typeof PROCPLANT_ATTACHMENT_MATERIALIZATION_VERSION;
  group: THREE.Group;
  meshes: THREE.InstancedMesh[];
  audit: ProcPlantAttachmentMaterializationAudit;
  dispose: () => void;
  isDisposed: () => boolean;
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    );
  }
  return value;
};

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const geometryCounts = (geometry: THREE.BufferGeometry, label: string) => {
  const positions = geometry.getAttribute("position");
  if (!positions || positions.itemSize !== 3 || positions.count < 3) {
    throw new Error(`${label} geometry requires a non-empty vec3 position attribute`);
  }
  const elements = geometry.getIndex()?.count ?? positions.count;
  if (elements % 3 !== 0) throw new Error(`${label} geometry must contain complete triangles`);
  return { vertices: positions.count, triangles: elements / 3 };
};

const validateAttachmentPackage = (source: ProcPlantMeshAttachmentPackage) => {
  if (source.contract !== "procplants.mesh-attachments" || source.version !== 1) {
    throw new Error("unsupported mesh attachment package");
  }
  if (source.emitted !== source.attachments.length) {
    throw new Error("mesh attachment package emitted count does not match its records");
  }
};

const validateRecordTransform = (record: ProcPlantMeshAttachmentRecord) => {
  if (record.transform.length !== 16 || record.transform.some((value) => !Number.isFinite(value))) {
    throw new Error(`${record.id} requires a finite 4x4 transform`);
  }
};

/**
 * Materialize deterministic mesh-attachment records as one InstancedMesh per
 * shared prototype. Source records and prototype attribute/material values are
 * not mutated; ownership is explicit and disposal is idempotent. Three may
 * lazily populate geometry bounds while deriving the instanced bounds.
 */
export const materializeProcPlantAttachments = (
  source: ProcPlantMeshAttachmentPackage,
  prototypes: readonly ProcPlantAttachmentPrototype[],
  options: ProcPlantAttachmentMaterializationOptions = {},
): ProcPlantAttachmentMaterialization => {
  validateAttachmentPackage(source);
  const includeKinds = new Set<ProcPlantMeshAttachmentClass>(
    options.includeKinds ?? ["branch", "accessory"],
  );
  for (const kind of includeKinds) {
    if (!(["leaf", "branch", "accessory"] as const).includes(kind)) {
      throw new Error(`invalid included mesh attachment kind: ${String(kind)}`);
    }
  }

  const prototypeIds = new Set<string>();
  const prototypeByGroup = new Map<string, ProcPlantAttachmentPrototype>();
  const countsByPrototype = new Map<string, { vertices: number; triangles: number }>();
  for (const prototype of prototypes) {
    if (!ID_PATTERN.test(prototype.id)) throw new Error(`invalid attachment prototype id: ${prototype.id}`);
    if (prototypeIds.has(prototype.id)) throw new Error(`duplicate attachment prototype id: ${prototype.id}`);
    prototypeIds.add(prototype.id);
    if (prototype.groupIds.length === 0) throw new Error(`${prototype.id} must map at least one attachment group`);
    countsByPrototype.set(prototype.id, geometryCounts(prototype.geometry, prototype.id));
    for (const groupId of [...new Set(prototype.groupIds)].sort()) {
      if (!ID_PATTERN.test(groupId)) throw new Error(`${prototype.id} has an invalid attachment group id: ${groupId}`);
      const occupied = prototypeByGroup.get(groupId);
      if (occupied) throw new Error(`attachment group ${groupId} maps to both ${occupied.id} and ${prototype.id}`);
      prototypeByGroup.set(groupId, prototype);
    }
  }

  const candidates = source.attachments.filter((record) => includeKinds.has(record.kind));
  const recordsByPrototype = new Map<string, ProcPlantMeshAttachmentRecord[]>();
  const unmatchedAttachmentIds: string[] = [];
  for (const record of candidates) {
    validateRecordTransform(record);
    const prototype = prototypeByGroup.get(record.groupId);
    if (!prototype) {
      unmatchedAttachmentIds.push(record.id);
      continue;
    }
    const records = recordsByPrototype.get(prototype.id) ?? [];
    records.push(record);
    recordsByPrototype.set(prototype.id, records);
  }
  unmatchedAttachmentIds.sort();
  if ((options.failOnUnmatched ?? true) && unmatchedAttachmentIds.length > 0) {
    throw new Error(`mesh attachments lack prototype mappings: ${unmatchedAttachmentIds.join(", ")}`);
  }

  const group = new THREE.Group();
  group.name = options.name ?? "procplant-materialized-attachments";
  const meshes: THREE.InstancedMesh[] = [];
  const prototypeAudits: ProcPlantAttachmentPrototypeAudit[] = [];
  const matrix = new THREE.Matrix4();
  let materializedVertices = 0;
  let materializedTriangles = 0;
  let branchInstances = 0;
  let accessoryInstances = 0;

  for (const prototype of [...prototypes].sort((left, right) => left.id.localeCompare(right.id))) {
    const records = recordsByPrototype.get(prototype.id) ?? [];
    if (records.length === 0) continue;
    const mesh = new THREE.InstancedMesh(prototype.geometry, prototype.material, records.length);
    mesh.name = `procplant-attachment-${prototype.id}`;
    mesh.castShadow = prototype.castShadow ?? true;
    mesh.receiveShadow = prototype.receiveShadow ?? true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let index = 0; index < records.length; index++) {
      mesh.setMatrixAt(index, matrix.fromArray(records[index]!.transform));
      if (records[index]!.kind === "branch") branchInstances++;
      else if (records[index]!.kind === "accessory") accessoryInstances++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.userData.procplantAttachmentPrototype = {
      contract: PROCPLANT_ATTACHMENT_MATERIALIZATION_CONTRACT,
      version: PROCPLANT_ATTACHMENT_MATERIALIZATION_VERSION,
      id: prototype.id,
      groupIds: [...prototype.groupIds].sort(),
      instances: records.length,
    };
    mesh.userData.procplantOwnsMaterial = prototype.ownsMaterial ?? false;
    const counts = countsByPrototype.get(prototype.id)!;
    const audit: ProcPlantAttachmentPrototypeAudit = {
      id: prototype.id,
      groupIds: [...prototype.groupIds].sort(),
      instances: records.length,
      prototypeVertices: counts.vertices,
      prototypeTriangles: counts.triangles,
      materializedVertices: counts.vertices * records.length,
      materializedTriangles: counts.triangles * records.length,
    };
    materializedVertices += audit.materializedVertices;
    materializedTriangles += audit.materializedTriangles;
    prototypeAudits.push(audit);
    meshes.push(mesh);
    group.add(mesh);
  }

  const hashInput = {
    sourceSeed: source.seed,
    includedKinds: [...includeKinds].sort(),
    records: candidates
      .filter((record) => prototypeByGroup.has(record.groupId))
      .map((record) => ({
        id: record.id,
        groupId: record.groupId,
        kind: record.kind,
        transform: record.transform,
      })),
    prototypes: prototypeAudits,
  };
  const audit: ProcPlantAttachmentMaterializationAudit = {
    contract: PROCPLANT_ATTACHMENT_MATERIALIZATION_CONTRACT,
    version: PROCPLANT_ATTACHMENT_MATERIALIZATION_VERSION,
    contentHash: `fnv1a32:${fnv1a(JSON.stringify(stableJsonValue(hashInput)))}`,
    sourceAttachments: source.attachments.length,
    candidateAttachments: candidates.length,
    skippedAttachments: source.attachments.length - candidates.length,
    materializedAttachments: prototypeAudits.reduce((sum, entry) => sum + entry.instances, 0),
    unmatchedAttachmentIds,
    instanceDraws: meshes.length,
    materializedVertices,
    materializedTriangles,
    branchInstances,
    accessoryInstances,
    prototypes: prototypeAudits,
  };
  group.userData.procplantAttachmentMaterialization = audit;

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    group.clear();
    for (const mesh of meshes) mesh.dispose();
    for (const prototype of prototypes) {
      if (prototype.ownsGeometry) prototype.geometry.dispose();
      if (prototype.ownsMaterial) prototype.material.dispose();
    }
  };
  return {
    contract: PROCPLANT_ATTACHMENT_MATERIALIZATION_CONTRACT,
    version: PROCPLANT_ATTACHMENT_MATERIALIZATION_VERSION,
    group,
    meshes,
    audit,
    dispose,
    isDisposed: () => disposed,
  };
};
