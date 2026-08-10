import * as THREE from "three";
import type {
  ProcPlantAttachmentAnchor,
  ProcPlantOrgan,
} from "./procplants";
import type {
  ProcPlantWeberPennOrganPlacementAudit,
  ProcPlantWeberPennOrganPlacementOperationAudit,
  ProcPlantWeberPennOrganPlacementPackage,
  ProcPlantWeberPennOrganPlacementResult,
  ProcPlantWeberPennOrganPlacementSource,
  ProcPlantWeberPennPlaceableOrganKind,
} from "./procplant-weber-penn-organ-placement";

const CONTRACT = "procplants.weber-penn-organ-placement-overrides";
const VERSION = 1;
const MAX_OVERRIDES = 96;
const KINDS: ReadonlySet<string> = new Set(["leaf", "flower", "fruit", "berry", "cone"]);
const isKind = (value: unknown): value is ProcPlantWeberPennPlaceableOrganKind => typeof value === "string" && KINDS.has(value);
const compatible = (attachment: ProcPlantAttachmentAnchor, kind: ProcPlantWeberPennPlaceableOrganKind) =>
  attachment.kind === "branch-tip" || (attachment.kind === "leaf-site" && kind !== "cone");
const targetsMatch = (
  left: ProcPlantWeberPennOrganPlacementPackage["target"],
  right: ProcPlantWeberPennOrganPlacementPackage["target"],
) => left.backend === right.backend && left.genomeId === right.genomeId && left.seed === right.seed &&
  left.topologySignature === right.topologySignature;
const unchanged = (
  source: ProcPlantWeberPennOrganPlacementSource,
  status: ProcPlantWeberPennOrganPlacementAudit["status"],
  operations: ProcPlantWeberPennOrganPlacementOperationAudit[] = [],
): ProcPlantWeberPennOrganPlacementResult => ({
  graph: source.graph,
  changed: false,
  audit: {
    status,
    sourceTopologySignature: source.target.topologySignature,
    beforeOrgans: source.graph.organs.length,
    afterOrgans: source.graph.organs.length,
    beforeAttachments: source.graph.attachments.length,
    afterAttachments: source.graph.attachments.length,
    appliedOperationIds: [],
    operations,
  },
});

/** Compiler-time exact-frame materialization; authoring/JSON helpers stay lazy. */
export const applyProcPlantWeberPennOrganPlacementOverrides = (
  source: ProcPlantWeberPennOrganPlacementSource,
  placementPackage: ProcPlantWeberPennOrganPlacementPackage,
): ProcPlantWeberPennOrganPlacementResult => {
  if (placementPackage.contract !== CONTRACT || placementPackage.version !== VERSION ||
    !targetsMatch(placementPackage.target, source.target)) return unchanged(source, "target-mismatch");
  const operations = [...placementPackage.operations].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
  if (operations.length === 0) return unchanged(source, "no-op");
  const attachmentById = new Map(source.graph.attachments.map((attachment) => [attachment.id, attachment]));
  const usedAttachments = new Set<string>();
  const organs: ProcPlantOrgan[] = [...source.graph.organs];
  const attachments: ProcPlantAttachmentAnchor[] = [...source.graph.attachments];
  const audits: ProcPlantWeberPennOrganPlacementOperationAudit[] = [];
  const appliedOperationIds: string[] = [];
  for (const operation of operations.slice(MAX_OVERRIDES)) {
    audits.push({ operationId: operation.id, status: "unsupported", attachmentId: operation.attachmentId, ownerStemId: null, outputAttachmentId: null, reason: "invalid" });
  }
  for (const operation of operations.slice(0, MAX_OVERRIDES)) {
    const baseAudit = { operationId: operation.id, attachmentId: operation.attachmentId, outputAttachmentId: null };
    if (!isKind(operation.kind) || !Number.isFinite(operation.roll) ||
      !Number.isFinite(operation.scale) || operation.scale <= 0) {
      audits.push({ ...baseAudit, status: "unsupported", ownerStemId: null, reason: "invalid" });
      continue;
    }
    const anchor = attachmentById.get(operation.attachmentId);
    if (!anchor || (anchor.kind !== "leaf-site" && anchor.kind !== "branch-tip")) {
      audits.push({ ...baseAudit, status: "unsupported", ownerStemId: null, reason: "missing-attachment" });
      continue;
    }
    const ownerStemId = source.attachmentStemIds[anchor.id] ?? null;
    if (!ownerStemId) {
      audits.push({ ...baseAudit, status: "unsupported", ownerStemId, reason: "missing-owner" });
      continue;
    }
    if (!compatible(anchor, operation.kind)) {
      audits.push({ ...baseAudit, status: "unsupported", ownerStemId, reason: "incompatible-kind" });
      continue;
    }
    if (operation.kind === "flower" && !source.flowerAvailable) {
      audits.push({ ...baseAudit, status: "unsupported", ownerStemId, reason: "flower-unavailable" });
      continue;
    }
    if (usedAttachments.has(anchor.id)) {
      audits.push({ ...baseAudit, status: "unsupported", ownerStemId, reason: "occupied" });
      continue;
    }
    const direction = anchor.tangent.clone().normalize();
    const right = anchor.right.clone().projectOnPlane(direction);
    if (right.lengthSq() < 1e-8) {
      audits.push({ ...baseAudit, status: "unsupported", ownerStemId, reason: "invalid" });
      continue;
    }
    right.normalize().applyAxisAngle(direction, operation.roll).normalize();
    const organIndex = organs.length;
    organs.push({
      kind: operation.kind,
      position: anchor.position.clone(),
      direction,
      right,
      scale: THREE.MathUtils.clamp(operation.scale, 0.01, 5),
      t: anchor.axialT,
      ...(operation.color === undefined ? {} : { color: operation.color >>> 0 }),
      ...(operation.secondaryColor === undefined ? {} : { secondaryColor: operation.secondaryColor >>> 0 }),
    });
    const outputAttachmentId = `weber-placement:${operation.id}`;
    attachments.push({
      id: outputAttachmentId,
      parentSegmentId: null,
      axialT: anchor.axialT,
      position: anchor.position.clone(),
      tangent: direction.clone(),
      right: right.clone(),
      up: new THREE.Vector3().crossVectors(direction, right).normalize(),
      kind: operation.kind,
      depth: anchor.depth,
      sway: anchor.sway,
      organIndex,
    });
    usedAttachments.add(anchor.id);
    appliedOperationIds.push(operation.id);
    audits.push({ ...baseAudit, status: "applied", ownerStemId, outputAttachmentId, reason: null });
  }
  if (appliedOperationIds.length === 0) return unchanged(source, "unsupported", audits);
  return {
    graph: { ...source.graph, organs, attachments },
    changed: true,
    audit: {
      status: audits.some((audit) => audit.status === "unsupported") ? "partial" : "applied",
      sourceTopologySignature: source.target.topologySignature,
      beforeOrgans: source.graph.organs.length,
      afterOrgans: organs.length,
      beforeAttachments: source.graph.attachments.length,
      afterAttachments: attachments.length,
      appliedOperationIds,
      operations: audits,
    },
  };
};
