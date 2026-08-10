import {
  queryProcPlantClearance,
  queryProcPlantSceneObject,
  type ProcPlantObjectQuery,
  type ProcPlantSceneGuideObject,
  type ProcPlantVec3,
} from "./procplant-guide-query";
import {
  createProcPlantTriangleMeshIndex,
  queryProcPlantMeshClearance,
  queryProcPlantTriangleMesh,
  type ProcPlantTriangleMeshBuildOptions,
  type ProcPlantTriangleMeshIndex,
  type ProcPlantTriangleMeshSource,
  type ProcPlantTriangleMeshQuery,
  type ProcPlantTriangleMeshQueryOptions,
} from "./procplant-mesh-query";
import {
  appendProcPlantVineGuidePoint,
  type ProcPlantVineGuidePackage,
} from "./procplant-vine-guide-authoring";

export const PROCPLANT_VINE_STATIC_SUPPORT_CONTRACT = "procplants.vine-static-support" as const;
export const PROCPLANT_VINE_STATIC_SUPPORT_VERSION = 1 as const;
export const PROCPLANT_VINE_STATIC_SUPPORT_MAX_OBJECTS = 128;

export interface ProcPlantVineStaticSupports {
  /** Immutable primitive snapshots. Only enabled obstacle-role objects are supports. */
  primitives?: readonly ProcPlantSceneGuideObject[];
  /** Immutable BVH snapshots. Rebuild an index after any source-mesh deformation. */
  meshes?: readonly ProcPlantTriangleMeshIndex[];
}

export interface ProcPlantVineStaticSupportSnapOptions {
  /** Restrict nearest-surface candidates while retaining every object for collision verification. */
  supportIds?: readonly string[];
  clearance?: number;
  maxSnapDistance?: number;
  collisionEpsilon?: number;
  meshQuery?: ProcPlantTriangleMeshQueryOptions;
}

export type ProcPlantVineStaticSupportSnapReason =
  | "no-static-support"
  | "beyond-snap-distance"
  | "clearance-collision";

export interface ProcPlantVineStaticSupportAudit {
  primitiveSupports: number;
  meshSupports: number;
  nodeVisits: number;
  triangleTests: number;
}

export interface ProcPlantVineStaticSupportSnapResult {
  contract: typeof PROCPLANT_VINE_STATIC_SUPPORT_CONTRACT;
  version: typeof PROCPLANT_VINE_STATIC_SUPPORT_VERSION;
  status: "snapped" | "unsupported";
  reason: ProcPlantVineStaticSupportSnapReason | null;
  sourcePosition: ProcPlantVec3;
  position: ProcPlantVec3 | null;
  supportId: string | null;
  supportKind: "primitive" | "triangle-mesh" | null;
  supportPoint: ProcPlantVec3 | null;
  supportNormal: ProcPlantVec3 | null;
  surfaceDistance: number | null;
  clearance: number;
  verifiedClearance: number | null;
  collidingObjectId: string | null;
  audit: ProcPlantVineStaticSupportAudit;
}

export interface ProcPlantVineStaticSupportAppendResult {
  authored: ProcPlantVineGuidePackage;
  snap: ProcPlantVineStaticSupportSnapResult;
  changed: boolean;
}

/** Build one immutable mesh snapshot for static vine support authoring. */
export const createProcPlantVineStaticMeshSupportIndex = (
  source: ProcPlantTriangleMeshSource,
  options: ProcPlantTriangleMeshBuildOptions = {},
) => createProcPlantTriangleMeshIndex(source, options);

type SupportCandidate = {
  id: string;
  kind: "primitive" | "triangle-mesh";
  query: ProcPlantObjectQuery | ProcPlantTriangleMeshQuery;
  surfaceDistance: number;
};

const finiteBounded = (value: number, label: string, maximum: number) => {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be finite and between 0 and ${maximum}`);
  }
  return value;
};

const point = (value: ProcPlantVec3): ProcPlantVec3 => {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
    throw new Error("sourcePosition must be a finite 3-number tuple");
  }
  return [...value];
};

const distance = (left: ProcPlantVec3, right: ProcPlantVec3) => Math.hypot(
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
);

const offset = (surface: ProcPlantVec3, normal: ProcPlantVec3, clearance: number): ProcPlantVec3 => [
  surface[0] + normal[0] * clearance,
  surface[1] + normal[1] * clearance,
  surface[2] + normal[2] * clearance,
];

const baseResult = (
  sourcePosition: ProcPlantVec3,
  clearance: number,
  primitiveSupports: number,
  meshSupports: number,
): ProcPlantVineStaticSupportSnapResult => ({
  contract: PROCPLANT_VINE_STATIC_SUPPORT_CONTRACT,
  version: PROCPLANT_VINE_STATIC_SUPPORT_VERSION,
  status: "unsupported",
  reason: "no-static-support",
  sourcePosition,
  position: null,
  supportId: null,
  supportKind: null,
  supportPoint: null,
  supportNormal: null,
  surfaceDistance: null,
  clearance,
  verifiedClearance: null,
  collidingObjectId: null,
  audit: { primitiveSupports, meshSupports, nodeVisits: 0, triangleTests: 0 },
});

/**
 * Snaps one local-space guide point to immutable primitive/mesh snapshots.
 * The returned position is materialized data: no support binding or live query
 * is retained, and a deforming support requires a rebuilt index and a new snap.
 */
export const snapProcPlantVineGuidePointToStaticSupport = (
  sourcePoint: ProcPlantVec3,
  supports: ProcPlantVineStaticSupports,
  options: ProcPlantVineStaticSupportSnapOptions = {},
): ProcPlantVineStaticSupportSnapResult => {
  const sourcePosition = point(sourcePoint);
  const clearance = finiteBounded(options.clearance ?? 0, "clearance", 1_000);
  const maxSnapDistance = finiteBounded(options.maxSnapDistance ?? 1, "maxSnapDistance", 1_000_000);
  const collisionEpsilon = finiteBounded(options.collisionEpsilon ?? 1e-8, "collisionEpsilon", 1);
  const primitives = (supports.primitives ?? []).filter((object) => object.enabled !== false && object.role === "obstacle");
  const meshes = [...(supports.meshes ?? [])];
  if (primitives.length + meshes.length > PROCPLANT_VINE_STATIC_SUPPORT_MAX_OBJECTS) {
    throw new Error(`static vine support query supports at most ${PROCPLANT_VINE_STATIC_SUPPORT_MAX_OBJECTS} objects`);
  }
  const ids = new Set<string>();
  for (const support of [...primitives, ...meshes]) {
    if (ids.has(support.id)) throw new Error(`duplicate static vine support id: ${support.id}`);
    ids.add(support.id);
  }
  const supportIds = options.supportIds === undefined ? null : new Set(options.supportIds);
  if (supportIds && supportIds.size !== options.supportIds!.length) throw new Error("static vine supportIds must be unique");
  if (supportIds) {
    for (const id of supportIds) {
      if (!ids.has(id)) throw new Error(`unknown static vine support id: ${id}`);
    }
  }
  const supportPrimitives = supportIds ? primitives.filter((entry) => supportIds.has(entry.id)) : primitives;
  const supportMeshes = supportIds ? meshes.filter((entry) => supportIds.has(entry.id)) : meshes;
  const result = baseResult(sourcePosition, clearance, supportPrimitives.length, supportMeshes.length);
  if (ids.size === 0) return result;

  const candidates: SupportCandidate[] = [];
  for (const primitive of supportPrimitives) {
    const query = queryProcPlantSceneObject(primitive, sourcePosition);
    candidates.push({
      id: primitive.id,
      kind: "primitive",
      query,
      surfaceDistance: distance(sourcePosition, query.closestPoint),
    });
  }
  for (const mesh of supportMeshes) {
    const query = queryProcPlantTriangleMesh(mesh, sourcePosition, options.meshQuery);
    result.audit.nodeVisits += query.audit.nodeVisits;
    result.audit.triangleTests += query.audit.totalTriangleTests;
    candidates.push({
      id: mesh.id,
      kind: "triangle-mesh",
      query,
      surfaceDistance: distance(sourcePosition, query.closestPoint),
    });
  }
  candidates.sort((left, right) =>
    left.surfaceDistance - right.surfaceDistance
    || left.id.localeCompare(right.id)
    || left.kind.localeCompare(right.kind)
  );
  const selected = candidates[0];
  if (!selected) return result;
  result.supportId = selected.id;
  result.supportKind = selected.kind;
  result.supportPoint = [...selected.query.closestPoint];
  result.supportNormal = [...selected.query.normal];
  result.surfaceDistance = selected.surfaceDistance;
  if (selected.surfaceDistance > maxSnapDistance + collisionEpsilon) {
    result.reason = "beyond-snap-distance";
    return result;
  }

  const snapped = offset(selected.query.closestPoint, selected.query.normal, clearance);
  const primitiveClearance = queryProcPlantClearance(primitives, snapped, clearance);
  const meshClearance = queryProcPlantMeshClearance(meshes, snapped, clearance, options.meshQuery);
  result.audit.nodeVisits += meshClearance.audit.nodeVisits;
  result.audit.triangleTests += meshClearance.audit.triangleTests;
  const clearanceCandidates = [
    primitiveClearance.clearance === null ? null : {
      clearance: primitiveClearance.clearance,
      id: primitiveClearance.nearest!.objectId,
    },
    meshClearance.clearance === null ? null : {
      clearance: meshClearance.clearance,
      id: meshClearance.nearest!.objectId,
    },
  ].filter((entry): entry is { clearance: number; id: string } => entry !== null)
    .sort((left, right) => left.clearance - right.clearance || left.id.localeCompare(right.id));
  const nearest = clearanceCandidates[0] ?? null;
  result.verifiedClearance = nearest?.clearance ?? null;
  if (nearest && nearest.clearance < -collisionEpsilon) {
    result.reason = "clearance-collision";
    result.collidingObjectId = nearest.id;
    return result;
  }
  result.status = "snapped";
  result.reason = null;
  result.position = snapped;
  return result;
};

/** Append only when the static snap and full clearance audit succeed. */
export const appendProcPlantVineGuidePointOnStaticSupport = (
  authored: ProcPlantVineGuidePackage,
  sourcePoint: ProcPlantVec3,
  supports: ProcPlantVineStaticSupports,
  options: ProcPlantVineStaticSupportSnapOptions = {},
): ProcPlantVineStaticSupportAppendResult => {
  const snap = snapProcPlantVineGuidePointToStaticSupport(sourcePoint, supports, options);
  if (snap.status !== "snapped" || !snap.position) return { authored, snap, changed: false };
  return {
    authored: appendProcPlantVineGuidePoint(authored, snap.position),
    snap,
    changed: true,
  };
};
