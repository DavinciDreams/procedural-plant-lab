import * as THREE from "three";
import type {
  ProcPlantAttachmentAnchor,
  ProcPlantGraph,
  ProcPlantOrgan,
  ProcPlantSegmentRecord,
  ProcPlantTemplate,
} from "./procplants";

export const PROCPLANT_ORGAN_PLACEMENT_CONTRACT = "procplants.organ-placement-overrides" as const;
export const PROCPLANT_ORGAN_PLACEMENT_VERSION = 2 as const;
export const PROCPLANT_ORGAN_PLACEMENT_LEGACY_VERSION = 1 as const;
export const PROCPLANT_ORGAN_PLACEMENT_GRAPH_SIGNATURE_VERSION = 1 as const;
export const PROCPLANT_ORGAN_PLACEMENT_MAX_OVERRIDES = 96;
export const PROCPLANT_ORGAN_PLACEMENT_MIN_AXIAL_SPACING = 0.035;
export const PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT = "procplants.placement-decal-binding" as const;
export const PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION = 1 as const;

export const PROCPLANT_PLACEABLE_PART_KINDS = Object.freeze([
  "leaf",
  "flower",
  "fruit",
  "berry",
  "cone",
  "thorn",
  "aerialRoot",
  "coniferSpray",
  "fernFrond",
  "palmFrond",
  "mossTuft",
  "branch",
  "knot",
  "decal",
] as const);
export type ProcPlantPlaceableOrganKind = typeof PROCPLANT_PLACEABLE_PART_KINDS[number];

/**
 * Exact external material/texture identity for one UV0 patch. Pixels stay
 * renderer/exporter-owned and must be supplied through the apply options.
 */
export interface ProcPlantPlacementDecalBinding {
  contract: typeof PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT;
  version: typeof PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION;
  materialId: string;
  textureId: string;
  uvSet: 0;
  uvRect: readonly [number, number, number, number];
}

export interface ProcPlantMaterializedPlacementDecal {
  operationId: string;
  materialId: string;
  textureId: string;
  uvSet: 0;
  template: ProcPlantTemplate;
}

export interface ProcPlantOrganPlacementTarget {
  genomeId: string;
  seed: number;
  graphSignature: string;
  graphSignatureVersion: typeof PROCPLANT_ORGAN_PLACEMENT_GRAPH_SIGNATURE_VERSION;
}

export interface ProcPlantOrganPlacementOperation {
  id: string;
  ordinal: number;
  kind: ProcPlantPlaceableOrganKind;
  segmentId: string;
  axialT: number;
  azimuth: number;
  scale: number;
  color?: number;
  secondaryColor?: number;
  decal?: ProcPlantPlacementDecalBinding;
}

export interface ProcPlantOrganPlacementPackage {
  contract: typeof PROCPLANT_ORGAN_PLACEMENT_CONTRACT;
  version: typeof PROCPLANT_ORGAN_PLACEMENT_VERSION | typeof PROCPLANT_ORGAN_PLACEMENT_LEGACY_VERSION;
  target: ProcPlantOrganPlacementTarget;
  operations: ProcPlantOrganPlacementOperation[];
}

export interface ProcPlantOrganPlacementInput {
  kind: ProcPlantPlaceableOrganKind;
  segmentId: string;
  axialT: number;
  azimuth: number;
  scale: number;
  color?: number;
  secondaryColor?: number;
  decal?: ProcPlantPlacementDecalBinding;
}

export interface ProcPlantOrganPlacementAppendResult {
  package: ProcPlantOrganPlacementPackage;
  operation: ProcPlantOrganPlacementOperation | null;
  reason: "cap" | "spacing" | "invalid" | null;
}

export interface ProcPlantOrganPlacementUnsupportedAudit {
  operationId: string | null;
  reason: "target-mismatch" | "unsupported-contract" | "unsupported-version" | "unsupported-kind" | "missing-segment" | "degenerate-segment" | "spacing" | "cap" | "invalid" | "missing-decal-binding";
}

export interface ProcPlantOrganPlacementApplyResult {
  graph: ProcPlantGraph;
  changed: boolean;
  targetMatched: boolean;
  appliedOperationIds: string[];
  unsupported: ProcPlantOrganPlacementUnsupportedAudit[];
  /** Separate material draws; never merged into the bark/organ color template. */
  decals: ProcPlantMaterializedPlacementDecal[];
}

export interface ProcPlantOrganPlacementApplyOptions {
  /** Exact bindings currently owned by the renderer/exporter. Missing bindings fail closed. */
  decalBindings?: readonly ProcPlantPlacementDecalBinding[];
}

const stableSegments = (records: readonly ProcPlantSegmentRecord[]) =>
  [...records].sort((a, b) => a.id.localeCompare(b.id));

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/**
 * Stable topology signature. Positions are deliberately excluded so an
 * override remains segment-relative when growth moves an otherwise identical
 * graph. Genome id and seed provide the exact authored-source binding.
 */
export const procPlantOrganPlacementGraphSignature = (graph: ProcPlantGraph): string => {
  const topology = stableSegments(graph.segmentRecords).filter((segment) => !isPlacedOutputSegment(segment.id)).map((segment) => [
    segment.id,
    segment.parentSegmentId,
    segment.startNodeIndex,
    segment.endNodeIndex,
    segment.depth,
  ]);
  return `topology-v${PROCPLANT_ORGAN_PLACEMENT_GRAPH_SIGNATURE_VERSION}-${fnv1a(JSON.stringify(topology))}`;
};

export const createProcPlantOrganPlacementTarget = (
  genomeId: string,
  seed: number,
  graph: ProcPlantGraph,
): ProcPlantOrganPlacementTarget => ({
  genomeId,
  seed,
  graphSignature: procPlantOrganPlacementGraphSignature(graph),
  graphSignatureVersion: PROCPLANT_ORGAN_PLACEMENT_GRAPH_SIGNATURE_VERSION,
});

export const createProcPlantOrganPlacementPackage = (
  target: ProcPlantOrganPlacementTarget,
): ProcPlantOrganPlacementPackage => ({
  contract: PROCPLANT_ORGAN_PLACEMENT_CONTRACT,
  version: PROCPLANT_ORGAN_PLACEMENT_VERSION,
  target: { ...target },
  operations: [],
});

const normalizeAngle = (angle: number) => {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
};

const sortedOperations = (operations: readonly ProcPlantOrganPlacementOperation[]) =>
  [...operations].sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));

const PLACEABLE_PART_KIND_SET: ReadonlySet<string> = new Set(PROCPLANT_PLACEABLE_PART_KINDS);
const isSupportedKind = (kind: unknown): kind is ProcPlantPlaceableOrganKind =>
  typeof kind === "string" && PLACEABLE_PART_KIND_SET.has(kind);
const isLegacyKind = (kind: ProcPlantPlaceableOrganKind) =>
  kind === "leaf" || kind === "flower" || kind === "fruit";
const isPlacedOutputSegment = (segmentId: string) =>
  segmentId.startsWith("placed-branch:") || segmentId.startsWith("placed-knot:");

const validIdentifier = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 128;
const validDecalBinding = (value: unknown): value is ProcPlantPlacementDecalBinding => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProcPlantPlacementDecalBinding>;
  const rect = candidate.uvRect;
  return candidate.contract === PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT
    && candidate.version === PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION
    && candidate.uvSet === 0
    && validIdentifier(candidate.materialId)
    && validIdentifier(candidate.textureId)
    && Array.isArray(rect)
    && rect.length === 4
    && rect.every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && rect[2]! > rect[0]!
    && rect[3]! > rect[1]!;
};

const copyDecalBinding = (binding: ProcPlantPlacementDecalBinding): ProcPlantPlacementDecalBinding => ({
  ...binding,
  uvRect: [...binding.uvRect] as [number, number, number, number],
});

const sameDecalBinding = (left: ProcPlantPlacementDecalBinding, right: ProcPlantPlacementDecalBinding) =>
  left.contract === right.contract
  && left.version === right.version
  && left.materialId === right.materialId
  && left.textureId === right.textureId
  && left.uvSet === right.uvSet
  && left.uvRect.every((value, index) => value === right.uvRect[index]);

const quantized = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export const appendProcPlantOrganPlacement = (
  placementPackage: ProcPlantOrganPlacementPackage,
  input: ProcPlantOrganPlacementInput,
  options: { maxOverrides?: number; minAxialSpacing?: number } = {},
): ProcPlantOrganPlacementAppendResult => {
  const maxOverrides = Math.max(1, Math.floor(options.maxOverrides ?? PROCPLANT_ORGAN_PLACEMENT_MAX_OVERRIDES));
  const minSpacing = Math.max(0, options.minAxialSpacing ?? PROCPLANT_ORGAN_PLACEMENT_MIN_AXIAL_SPACING);
  if (placementPackage.operations.length >= maxOverrides) {
    return { package: placementPackage, operation: null, reason: "cap" };
  }
  if (
    !isSupportedKind(input.kind)
    || (placementPackage.version === PROCPLANT_ORGAN_PLACEMENT_LEGACY_VERSION && !isLegacyKind(input.kind))
    || isPlacedOutputSegment(input.segmentId)
    || !input.segmentId
    || !Number.isFinite(input.axialT)
    || !Number.isFinite(input.azimuth)
    || !Number.isFinite(input.scale)
    || input.scale <= 0
    || (input.kind === "decal" ? !validDecalBinding(input.decal) : input.decal !== undefined)
  ) {
    return { package: placementPackage, operation: null, reason: "invalid" };
  }
  const axialT = quantized(THREE.MathUtils.clamp(input.axialT, 0.02, 0.98));
  if (placementPackage.operations.some((operation) =>
    operation.segmentId === input.segmentId && Math.abs(operation.axialT - axialT) < minSpacing
  )) {
    return { package: placementPackage, operation: null, reason: "spacing" };
  }
  const ordinal = placementPackage.operations.reduce((maximum, operation) => Math.max(maximum, operation.ordinal), -1) + 1;
  const identity = `${placementPackage.target.graphSignature}|${input.segmentId}|${input.kind}|${axialT}|${quantized(input.azimuth)}|${ordinal}${input.kind === "decal" ? `|${JSON.stringify(input.decal)}` : ""}`;
  const baseId = `placed-${fnv1a(identity)}`;
  const existingIds = new Set(placementPackage.operations.map((operation) => operation.id));
  let id = baseId;
  let collision = 1;
  while (existingIds.has(id)) id = `${baseId}-${collision++}`;
  const operation: ProcPlantOrganPlacementOperation = {
    id,
    ordinal,
    kind: input.kind,
    segmentId: input.segmentId,
    axialT,
    azimuth: quantized(normalizeAngle(input.azimuth)),
    scale: quantized(THREE.MathUtils.clamp(input.scale, 0.01, 5)),
    ...(input.color === undefined ? {} : { color: input.color >>> 0 }),
    ...(input.secondaryColor === undefined ? {} : { secondaryColor: input.secondaryColor >>> 0 }),
    ...(input.decal === undefined ? {} : { decal: copyDecalBinding(input.decal) }),
  };
  return {
    package: { ...placementPackage, target: { ...placementPackage.target }, operations: sortedOperations([...placementPackage.operations, operation]) },
    operation,
    reason: null,
  };
};

export const undoLastProcPlantOrganPlacement = (
  placementPackage: ProcPlantOrganPlacementPackage,
): ProcPlantOrganPlacementPackage => {
  if (placementPackage.operations.length === 0) return placementPackage;
  const operations = sortedOperations(placementPackage.operations);
  operations.pop();
  return { ...placementPackage, target: { ...placementPackage.target }, operations };
};

const deterministicSegmentFrame = (
  graph: ProcPlantGraph,
  segment: ProcPlantSegmentRecord,
  axialT: number,
) => {
  const start = graph.stems[segment.startNodeIndex];
  const end = graph.stems[segment.endNodeIndex];
  if (!start || !end) return null;
  const tangent = end.position.clone().sub(start.position);
  if (tangent.lengthSq() < 1e-10) return null;
  tangent.normalize();
  const nearest = graph.attachments
    .filter((attachment) => attachment.parentSegmentId === segment.id)
    .sort((a, b) => Math.abs(a.axialT - axialT) - Math.abs(b.axialT - axialT) || a.id.localeCompare(b.id))[0];
  let right = nearest?.right.clone().projectOnPlane(tangent);
  if (!right || right.lengthSq() < 1e-8) {
    const reference = Math.abs(tangent.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    right = new THREE.Vector3().crossVectors(reference, tangent);
  }
  right.normalize();
  const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
  return { start, end, tangent, right, up };
};

export const deriveProcPlantOrganPlacementAzimuth = (
  graph: ProcPlantGraph,
  segmentId: string,
  axialT: number,
  localPoint: THREE.Vector3,
): number | null => {
  const segment = graph.segmentRecords.find((candidate) => candidate.id === segmentId);
  if (!segment) return null;
  const frame = deterministicSegmentFrame(graph, segment, axialT);
  if (!frame) return null;
  const center = frame.start.position.clone().lerp(frame.end.position, THREE.MathUtils.clamp(axialT, 0, 1));
  const radial = localPoint.clone().sub(center).projectOnPlane(frame.tangent);
  if (radial.lengthSq() < 1e-10) return 0;
  radial.normalize();
  return normalizeAngle(Math.atan2(radial.dot(frame.up), radial.dot(frame.right)));
};

const materializePlacementDecal = (
  operation: ProcPlantOrganPlacementOperation,
  binding: ProcPlantPlacementDecalBinding,
  center: THREE.Vector3,
  tangent: THREE.Vector3,
  across: THREE.Vector3,
  normal: THREE.Vector3,
  radius: number,
  segmentLength: number,
  sway: number,
): ProcPlantMaterializedPlacementDecal => {
  const halfWidth = Math.max(0.002, Math.min(operation.scale * 0.5, radius * 1.1, segmentLength * 0.22));
  const uvWidth = binding.uvRect[2] - binding.uvRect[0];
  const uvHeight = binding.uvRect[3] - binding.uvRect[1];
  const halfHeight = Math.max(0.002, Math.min(halfWidth * uvHeight / uvWidth, segmentLength * 0.22));
  const origin = center.clone().addScaledVector(normal, radius * 0.015 + 0.0002);
  const positions = [
    origin.clone().addScaledVector(across, -halfWidth).addScaledVector(tangent, -halfHeight),
    origin.clone().addScaledVector(across, halfWidth).addScaledVector(tangent, -halfHeight),
    origin.clone().addScaledVector(across, halfWidth).addScaledVector(tangent, halfHeight),
    origin.clone().addScaledVector(across, -halfWidth).addScaledVector(tangent, halfHeight),
  ];
  const pos = new Float32Array(12);
  const nrm = new Float32Array(12);
  for (let index = 0; index < positions.length; index++) {
    pos.set(positions[index]!.toArray(), index * 3);
    nrm.set(normal.toArray(), index * 3);
  }
  const [u0, v0, u1, v1] = binding.uvRect;
  return {
    operationId: operation.id,
    materialId: binding.materialId,
    textureId: binding.textureId,
    uvSet: 0,
    template: {
      pos,
      nrm,
      uv0: new Float32Array([u0, v1, u1, v1, u1, v0, u0, v0]),
      col: new Float32Array(12).fill(1),
      tintable: new Uint8Array(4),
      sway: new Float32Array(4).fill(sway),
      idx: Uint32Array.of(0, 1, 2, 0, 2, 3),
    },
  };
};

const targetMatches = (
  target: ProcPlantOrganPlacementTarget,
  source: ProcPlantOrganPlacementTarget,
) => target.genomeId === source.genomeId
  && target.seed === source.seed
  && target.graphSignatureVersion === source.graphSignatureVersion
  && target.graphSignature === source.graphSignature;

export const applyProcPlantOrganPlacementOverrides = (
  graph: ProcPlantGraph,
  source: ProcPlantOrganPlacementTarget,
  placementPackage: ProcPlantOrganPlacementPackage,
  options: ProcPlantOrganPlacementApplyOptions = {},
): ProcPlantOrganPlacementApplyResult => {
  if (placementPackage.contract !== PROCPLANT_ORGAN_PLACEMENT_CONTRACT) {
    return { graph, changed: false, targetMatched: false, appliedOperationIds: [], unsupported: [{ operationId: null, reason: "unsupported-contract" }], decals: [] };
  }
  if (
    placementPackage.version !== PROCPLANT_ORGAN_PLACEMENT_VERSION
    && placementPackage.version !== PROCPLANT_ORGAN_PLACEMENT_LEGACY_VERSION
  ) {
    return { graph, changed: false, targetMatched: false, appliedOperationIds: [], unsupported: [{ operationId: null, reason: "unsupported-version" }], decals: [] };
  }
  if (!targetMatches(placementPackage.target, source) || source.graphSignature !== procPlantOrganPlacementGraphSignature(graph)) {
    return { graph, changed: false, targetMatched: false, appliedOperationIds: [], unsupported: [{ operationId: null, reason: "target-mismatch" }], decals: [] };
  }
  const operations = sortedOperations(placementPackage.operations);
  if (operations.length === 0) {
    return { graph, changed: false, targetMatched: true, appliedOperationIds: [], unsupported: [], decals: [] };
  }
  const segmentById = new Map(graph.segmentRecords.map((segment) => [segment.id, segment]));
  const attachmentIds = new Set(graph.attachments.map((attachment) => attachment.id));
  const appliedBySegment = new Map<string, number[]>();
  const stems = [...graph.stems];
  const segments = [...graph.segments];
  const segmentRecords = [...graph.segmentRecords];
  const organs: ProcPlantOrgan[] = [...graph.organs];
  const attachments: ProcPlantAttachmentAnchor[] = [...graph.attachments];
  const appliedOperationIds: string[] = [];
  const unsupported: ProcPlantOrganPlacementUnsupportedAudit[] = [];
  const decals: ProcPlantMaterializedPlacementDecal[] = [];
  for (const operation of operations.slice(PROCPLANT_ORGAN_PLACEMENT_MAX_OVERRIDES)) {
    unsupported.push({ operationId: operation.id, reason: "cap" });
  }
  for (const operation of operations.slice(0, PROCPLANT_ORGAN_PLACEMENT_MAX_OVERRIDES)) {
    if (
      !isSupportedKind(operation.kind)
      || (placementPackage.version === PROCPLANT_ORGAN_PLACEMENT_LEGACY_VERSION && !isLegacyKind(operation.kind))
    ) {
      unsupported.push({ operationId: operation.id, reason: "unsupported-kind" });
      continue;
    }
    if (!Number.isFinite(operation.axialT) || !Number.isFinite(operation.azimuth) || !Number.isFinite(operation.scale) || operation.scale <= 0) {
      unsupported.push({ operationId: operation.id, reason: "invalid" });
      continue;
    }
    if (operation.kind === "decal" ? !validDecalBinding(operation.decal) : operation.decal !== undefined) {
      unsupported.push({ operationId: operation.id, reason: "invalid" });
      continue;
    }
    const segment = segmentById.get(operation.segmentId);
    if (!segment) {
      unsupported.push({ operationId: operation.id, reason: "missing-segment" });
      continue;
    }
    const axialT = THREE.MathUtils.clamp(operation.axialT, 0.02, 0.98);
    const prior = appliedBySegment.get(segment.id) ?? [];
    if (prior.some((other) => Math.abs(other - axialT) < PROCPLANT_ORGAN_PLACEMENT_MIN_AXIAL_SPACING)) {
      unsupported.push({ operationId: operation.id, reason: "spacing" });
      continue;
    }
    const frame = deterministicSegmentFrame(graph, segment, axialT);
    if (!frame) {
      unsupported.push({ operationId: operation.id, reason: "degenerate-segment" });
      continue;
    }
    const radial = frame.right.clone().applyAxisAngle(frame.tangent, normalizeAngle(operation.azimuth)).normalize();
    const frameUp = new THREE.Vector3().crossVectors(frame.tangent, radial).normalize();
    const radius = THREE.MathUtils.lerp(frame.start.radius, frame.end.radius, axialT);
    const position = frame.start.position.clone().lerp(frame.end.position, axialT).addScaledVector(radial, radius * 1.08);
    const direction = radial.clone().multiplyScalar(0.92).addScaledVector(frame.tangent, 0.38).normalize();
    if (operation.kind === "decal") {
      const binding = options.decalBindings?.find((candidate) =>
        validDecalBinding(candidate) && sameDecalBinding(candidate, operation.decal!)
      );
      if (!binding) {
        unsupported.push({ operationId: operation.id, reason: "missing-decal-binding" });
        continue;
      }
      decals.push(materializePlacementDecal(
        operation,
        binding,
        frame.start.position.clone().lerp(frame.end.position, axialT),
        frame.tangent,
        frameUp,
        radial,
        radius,
        frame.start.position.distanceTo(frame.end.position),
        0.08 + axialT * 0.12,
      ));
      prior.push(axialT);
      appliedBySegment.set(segment.id, prior);
      appliedOperationIds.push(operation.id);
      continue;
    }
    if (operation.kind === "branch" || operation.kind === "knot") {
      const knot = operation.kind === "knot";
      const length = knot
        ? THREE.MathUtils.clamp(operation.scale, 0.015, Math.max(0.02, radius * 1.8))
        : THREE.MathUtils.clamp(operation.scale, 0.08, 5);
      const branchDirection = radial.clone()
        .multiplyScalar(knot ? 0.985 : 0.9)
        .addScaledVector(frame.tangent, knot ? 0.17 : 0.32)
        .normalize();
      const startIndex = stems.length;
      const endIndex = startIndex + 1;
      const branchDepth = segment.depth + 1;
      const startT = THREE.MathUtils.lerp(frame.start.t, frame.end.t, axialT);
      const baseRadius = knot
        ? Math.max(0.002, Math.min(radius * 0.62, length * 0.42))
        : Math.max(0.002, Math.min(radius * 0.52, length * 0.14));
      const branchStart = knot
        ? frame.start.position.clone().lerp(frame.end.position, axialT).addScaledVector(radial, radius * 1.02)
        : position.clone();
      const branchEnd = branchStart.clone().addScaledVector(branchDirection, length);
      stems.push({
        position: branchStart,
        direction: branchDirection.clone(),
        radius: baseRadius,
        depth: branchDepth,
        t: startT,
        index: startIndex,
      }, {
        position: branchEnd,
        direction: branchDirection.clone(),
        radius: Math.max(0.0008, baseRadius * (knot ? 0.12 : 0.2)),
        depth: branchDepth,
        t: Math.min(1, startT + 0.12),
        index: endIndex,
      });
      segments.push([startIndex, endIndex]);
      const branchSegmentId = `${knot ? "placed-knot" : "placed-branch"}:${operation.id}`;
      segmentRecords.push({
        id: branchSegmentId,
        parentSegmentId: segment.id,
        startNodeIndex: startIndex,
        endNodeIndex: endIndex,
        depth: branchDepth,
        axialStart: startT,
        axialEnd: Math.min(1, startT + 0.12),
      });
      if (!knot) {
        let tipAttachmentId = `${branchSegmentId}:tip`;
        let tipCollision = 1;
        while (attachmentIds.has(tipAttachmentId)) tipAttachmentId = `${branchSegmentId}:tip:${tipCollision++}`;
        attachmentIds.add(tipAttachmentId);
        attachments.push({
          id: tipAttachmentId,
          parentSegmentId: branchSegmentId,
          axialT: 1,
          position: branchEnd.clone(),
          tangent: branchDirection.clone(),
          right: frameUp.clone(),
          up: new THREE.Vector3().crossVectors(branchDirection, frameUp).normalize(),
          kind: "branch-tip",
          depth: branchDepth,
          sway: 0.3 + Math.min(0.4, branchDepth * 0.08),
          organIndex: null,
        });
      }
      prior.push(axialT);
      appliedBySegment.set(segment.id, prior);
      appliedOperationIds.push(operation.id);
      continue;
    }
    let organRight = frameUp.clone().projectOnPlane(direction);
    if (organRight.lengthSq() < 1e-8) organRight = frame.tangent.clone().projectOnPlane(direction);
    organRight.normalize();
    const organIndex = organs.length;
    organs.push({
      kind: operation.kind,
      position,
      direction,
      right: organRight,
      scale: THREE.MathUtils.clamp(operation.scale, 0.01, 5),
      t: THREE.MathUtils.lerp(frame.start.t, frame.end.t, axialT),
      ...(operation.color === undefined ? {} : { color: operation.color }),
      ...(operation.secondaryColor === undefined ? {} : { secondaryColor: operation.secondaryColor }),
    });
    const baseAttachmentId = `placement:${operation.id}`;
    let attachmentId = baseAttachmentId;
    let collision = 1;
    while (attachmentIds.has(attachmentId)) attachmentId = `${baseAttachmentId}:${collision++}`;
    attachmentIds.add(attachmentId);
    attachments.push({
      id: attachmentId,
      parentSegmentId: segment.id,
      axialT,
      position: position.clone(),
      tangent: frame.tangent.clone(),
      right: radial,
      up: frameUp,
      kind: operation.kind,
      depth: segment.depth,
      sway: 0.24 + THREE.MathUtils.clamp(axialT, 0, 1) * 0.22,
      organIndex,
    });
    prior.push(axialT);
    appliedBySegment.set(segment.id, prior);
    appliedOperationIds.push(operation.id);
  }
  if (appliedOperationIds.length === 0) {
    return { graph, changed: false, targetMatched: true, appliedOperationIds, unsupported, decals };
  }
  return {
    graph: { ...graph, stems, segments, segmentRecords, organs, attachments },
    changed: true,
    targetMatched: true,
    appliedOperationIds,
    unsupported,
    decals,
  };
};

export const serializeProcPlantOrganPlacementPackage = (
  placementPackage: ProcPlantOrganPlacementPackage,
): string => JSON.stringify({
  contract: placementPackage.contract,
  version: placementPackage.version,
  target: {
    genomeId: placementPackage.target.genomeId,
    seed: placementPackage.target.seed,
    graphSignature: placementPackage.target.graphSignature,
    graphSignatureVersion: placementPackage.target.graphSignatureVersion,
  },
  operations: sortedOperations(placementPackage.operations).map((operation) => ({
    id: operation.id,
    ordinal: operation.ordinal,
    kind: operation.kind,
    segmentId: operation.segmentId,
    axialT: operation.axialT,
    azimuth: operation.azimuth,
    scale: operation.scale,
    ...(operation.color === undefined ? {} : { color: operation.color }),
    ...(operation.secondaryColor === undefined ? {} : { secondaryColor: operation.secondaryColor }),
    ...(operation.decal === undefined ? {} : { decal: copyDecalBinding(operation.decal) }),
  })),
});
