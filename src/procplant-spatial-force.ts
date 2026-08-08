import * as THREE from "three";
import type {
  ProcPlantGraph,
  ProcPlantSegmentRecord,
} from "./procplants";

export type ProcPlantSpatialForceType = "direction" | "attract" | "magnet" | "repel" | "avoid" | "curl";
export type ProcPlantSpatialForcePoint = readonly [number, number, number];

export interface ProcPlantSpatialForceField {
  contract: "procplants.spatial-force-field";
  version: 1;
  id: string;
  type: ProcPlantSpatialForceType;
  position: ProcPlantSpatialForcePoint;
  direction?: ProcPlantSpatialForcePoint;
  radius: number;
  /** Signed normalized amplitude in [-1, 1]. */
  strength: number;
  /** Compact-support exponent in [0.25, 8]. */
  falloff: number;
}

export interface ProcPlantSpatialForceOptions {
  enabled?: boolean;
  iterations?: number;
  maximumDisplacement?: number;
  minimumSegmentLength?: number;
  anchoredNodeIndices?: readonly number[];
  maxNodes?: number;
  maxSegments?: number;
  maxFields?: number;
  maxWorkItems?: number;
}

export interface ProcPlantSpatialForceAudit {
  enabled: boolean;
  targetSignature: string;
  iterations: number;
  nodeCount: number;
  segmentCount: number;
  fieldCount: number;
  workItems: number;
  anchoredNodes: number;
  affectedNodes: number;
  affectedSegments: number;
  maxDisplacement: number;
  preventedDegenerateSegments: number;
  unmatchedFieldIds: string[];
  sourceGraphReused: boolean;
}

export interface ProcPlantSpatialForceResult {
  contract: "procplants.spatial-force-result";
  version: 1;
  graph: ProcPlantGraph;
  audit: ProcPlantSpatialForceAudit;
}

export const PROCPLANT_SPATIAL_FORCE_HARD_CAPS = Object.freeze({
  nodes: 1_000_000,
  segments: 1_000_000,
  fields: 64,
  iterations: 8,
  workItems: 32_000_000,
  fieldRadius: 10_000,
  displacement: 10_000,
});

interface NormalizedField {
  id: string;
  type: "direction" | "attract" | "repel" | "curl";
  position: THREE.Vector3;
  direction: THREE.Vector3 | null;
  radius: number;
  strength: number;
  falloff: number;
}

interface AttachmentBinding {
  attachmentIndex: number;
  segmentId: string;
  axialT: number;
  oldTangent: THREE.Vector3;
  oldRight: THREE.Vector3;
  oldUp: THREE.Vector3;
  attachmentOffset: THREE.Vector3;
  organIndex: number | null;
  organOffset?: THREE.Vector3;
  organDirection?: THREE.Vector3;
  organRight?: THREE.Vector3;
}

const finite = (value: number, label: string, minimum = -Infinity) => {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be finite${minimum > -Infinity ? ` and at least ${minimum}` : ""}`);
  }
  return value;
};

const cappedInteger = (value: number, label: string, hardCap: number, minimum = 0) => {
  if (!Number.isInteger(value) || value < minimum || value > hardCap) {
    throw new Error(`${label} must be an integer in [${minimum}, ${hardCap}]`);
  }
  return value;
};

const vector = (value: ProcPlantSpatialForcePoint, label: string) => {
  if (value.length !== 3 || value.some((component) => !Number.isFinite(component))) {
    throw new Error(`${label} must contain three finite components`);
  }
  return new THREE.Vector3(value[0], value[1], value[2]);
};

const normalizedDirection = (value: ProcPlantSpatialForcePoint | undefined, label: string) => {
  if (!value) throw new Error(`${label} is required`);
  const result = vector(value, label);
  if (result.lengthSq() <= 1e-16) throw new Error(`${label} must have non-zero length`);
  return result.normalize();
};

const normalizeFields = (fields: readonly ProcPlantSpatialForceField[]) => {
  const ids = new Set<string>();
  return fields.map((field, index): NormalizedField => {
    if (field.contract !== "procplants.spatial-force-field" || field.version !== 1) {
      throw new Error(`unsupported spatial force field contract at index ${index}`);
    }
    if (!field.id.trim()) throw new Error(`spatial force field ${index} id must be non-empty`);
    if (ids.has(field.id)) throw new Error(`duplicate spatial force field id: ${field.id}`);
    ids.add(field.id);
    if (!(field.type === "direction" || field.type === "attract" || field.type === "magnet" ||
      field.type === "repel" || field.type === "avoid" || field.type === "curl")) {
      throw new Error(`unsupported spatial force field type: ${String(field.type)}`);
    }
    const radius = finite(field.radius, `${field.id}.radius`, 1e-8);
    if (radius > PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fieldRadius) {
      throw new Error(`${field.id}.radius must be at most ${PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fieldRadius}`);
    }
    const strength = finite(field.strength, `${field.id}.strength`);
    if (strength < -1 || strength > 1) throw new Error(`${field.id}.strength must be in [-1, 1]`);
    const falloff = finite(field.falloff, `${field.id}.falloff`, 0.25);
    if (falloff > 8) throw new Error(`${field.id}.falloff must be in [0.25, 8]`);
    const type = field.type === "magnet" ? "attract" : field.type === "avoid" ? "repel" : field.type;
    return {
      id: field.id,
      type,
      position: vector(field.position, `${field.id}.position`),
      direction: type === "direction" || type === "curl"
        ? normalizedDirection(field.direction, `${field.id}.direction`)
        : null,
      radius,
      strength,
      falloff,
    };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
};

const validateGraphVectors = (graph: ProcPlantGraph) => {
  for (let index = 0; index < graph.stems.length; index++) {
    const stem = graph.stems[index]!;
    if (stem.index !== index) throw new Error(`spatial force graph stem ${index} has mismatched index ${stem.index}`);
    for (const [label, value] of [["position", stem.position], ["direction", stem.direction]] as const) {
      if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`spatial force stem ${index} ${label} must be finite`);
    }
    finite(stem.radius, `spatial force stem ${index} radius`, 0);
  }
  for (let index = 0; index < graph.organs.length; index++) {
    const organ = graph.organs[index]!;
    for (const value of [organ.position, organ.direction, organ.right]) {
      if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`spatial force organ ${index} frame must be finite`);
    }
  }
  for (let index = 0; index < graph.attachments.length; index++) {
    const attachment = graph.attachments[index]!;
    for (const value of [attachment.position, attachment.tangent, attachment.right, attachment.up]) {
      if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`spatial force attachment ${index} frame must be finite`);
    }
  }
};

const orderedSegments = (graph: ProcPlantGraph) => {
  if (graph.segmentRecords.length !== graph.segments.length) {
    throw new Error("spatial force graph requires one segment record per segment");
  }
  const segmentPairs = new Set(graph.segments.map(([start, end], index) => {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 ||
      start >= graph.stems.length || end >= graph.stems.length) {
      throw new Error(`spatial force segment ${index} has an invalid node index`);
    }
    return `${start}:${end}`;
  }));
  const byId = new Map<string, ProcPlantSegmentRecord>();
  const children = new Map<string, ProcPlantSegmentRecord[]>();
  const incomingByNode = new Map<number, ProcPlantSegmentRecord>();
  for (const record of graph.segmentRecords) {
    if (!record.id.trim() || byId.has(record.id)) throw new Error(`duplicate or empty spatial force segment id: ${record.id}`);
    if (!segmentPairs.has(`${record.startNodeIndex}:${record.endNodeIndex}`)) {
      throw new Error(`spatial force segment record ${record.id} does not match graph.segments`);
    }
    if (incomingByNode.has(record.endNodeIndex)) {
      throw new Error(`spatial force node ${record.endNodeIndex} has multiple incoming segments`);
    }
    incomingByNode.set(record.endNodeIndex, record);
    byId.set(record.id, record);
  }
  const roots: ProcPlantSegmentRecord[] = [];
  for (const record of graph.segmentRecords) {
    if (record.parentSegmentId === null) roots.push(record);
    else {
      const parent = byId.get(record.parentSegmentId);
      if (!parent) throw new Error(`spatial force segment ${record.id} has unknown parent ${record.parentSegmentId}`);
      if (record.startNodeIndex !== parent.endNodeIndex) {
        throw new Error(`spatial force segment ${record.id} does not start at parent endpoint`);
      }
      const entries = children.get(parent.id) ?? [];
      entries.push(record);
      children.set(parent.id, entries);
    }
  }
  roots.sort((a, b) => a.id.localeCompare(b.id));
  for (const entries of children.values()) entries.sort((a, b) => a.id.localeCompare(b.id));
  const ordered: ProcPlantSegmentRecord[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (record: ProcPlantSegmentRecord) => {
    if (visiting.has(record.id)) throw new Error(`spatial force segment parent cycle at ${record.id}`);
    if (visited.has(record.id)) return;
    visiting.add(record.id);
    ordered.push(record);
    for (const child of children.get(record.id) ?? []) visit(child);
    visiting.delete(record.id);
    visited.add(record.id);
  };
  for (const root of roots) visit(root);
  if (ordered.length !== graph.segmentRecords.length) throw new Error("spatial force graph contains an unreachable segment cycle");
  const rootNodes = new Set<number>(roots.map((record) => record.startNodeIndex));
  for (let node = 0; node < graph.stems.length; node++) if (!incomingByNode.has(node)) rootNodes.add(node);
  return { ordered, byId, incomingByNode, rootNodes };
};

const safeTangent = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  fallback: THREE.Vector3,
) => {
  const tangent = end.clone().sub(start);
  if (tangent.lengthSq() > 1e-16) return tangent.normalize();
  const safe = fallback.clone();
  if (safe.lengthSq() <= 1e-16) safe.set(0, 1, 0);
  return safe.normalize();
};

const safeFrame = (tangent: THREE.Vector3, preferredRight: THREE.Vector3) => {
  let right = preferredRight.clone().projectOnPlane(tangent);
  if (right.lengthSq() <= 1e-16) {
    right = Math.abs(tangent.y) < 0.9
      ? new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0))
      : new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(1, 0, 0));
  }
  right.normalize();
  const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
  return { tangent, right, up };
};

const coordinates = (value: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, tangent: THREE.Vector3) =>
  new THREE.Vector3(value.dot(right), value.dot(up), value.dot(tangent));

const fromCoordinates = (value: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, tangent: THREE.Vector3) =>
  right.clone().multiplyScalar(value.x).addScaledVector(up, value.y).addScaledVector(tangent, value.z);

const captureBindings = (
  graph: ProcPlantGraph,
  records: Map<string, ProcPlantSegmentRecord>,
) => {
  const claimedOrgans = new Set<number>();
  const bindings: AttachmentBinding[] = [];
  const indexed = graph.attachments.map((attachment, attachmentIndex) => ({ attachment, attachmentIndex }))
    .sort((left, right) => left.attachment.id.localeCompare(right.attachment.id));
  for (const { attachment, attachmentIndex } of indexed) {
    if (!attachment.parentSegmentId) continue;
    const record = records.get(attachment.parentSegmentId);
    if (!record) throw new Error(`spatial force attachment ${attachment.id} has unknown parent segment`);
    const start = graph.stems[record.startNodeIndex]!.position;
    const end = graph.stems[record.endNodeIndex]!.position;
    const tangent = safeTangent(start, end, attachment.tangent);
    const frame = safeFrame(tangent, attachment.right);
    const axialT = THREE.MathUtils.clamp(attachment.axialT, 0, 1);
    const reference = start.clone().lerp(end, axialT);
    const binding: AttachmentBinding = {
      attachmentIndex,
      segmentId: record.id,
      axialT,
      oldTangent: frame.tangent,
      oldRight: frame.right,
      oldUp: frame.up,
      attachmentOffset: coordinates(attachment.position.clone().sub(reference), frame.right, frame.up, frame.tangent),
      organIndex: attachment.organIndex,
    };
    const organIndex = attachment.organIndex;
    if (organIndex !== null && !claimedOrgans.has(organIndex)) {
      const organ = graph.organs[organIndex];
      if (!organ) throw new Error(`spatial force attachment ${attachment.id} has invalid organIndex`);
      claimedOrgans.add(organIndex);
      binding.organOffset = coordinates(organ.position.clone().sub(reference), frame.right, frame.up, frame.tangent);
      binding.organDirection = coordinates(organ.direction, frame.right, frame.up, frame.tangent);
      binding.organRight = coordinates(organ.right, frame.right, frame.up, frame.tangent);
    }
    bindings.push(binding);
  }
  return bindings;
};

const cloneGraph = (source: ProcPlantGraph): ProcPlantGraph => ({
  stems: source.stems.map((stem) => ({ ...stem, position: stem.position.clone(), direction: stem.direction.clone() })),
  segments: source.segments.map(([start, end]) => [start, end]),
  organs: source.organs.map((organ) => ({
    ...organ,
    position: organ.position.clone(),
    direction: organ.direction.clone(),
    right: organ.right.clone(),
  })),
  segmentRecords: source.segmentRecords.map((record) => ({ ...record })),
  attachments: source.attachments.map((attachment) => ({
    ...attachment,
    position: attachment.position.clone(),
    tangent: attachment.tangent.clone(),
    right: attachment.right.clone(),
    up: attachment.up.clone(),
  })),
});

const fieldDisplacement = (field: NormalizedField, point: THREE.Vector3) => {
  const relative = point.clone().sub(field.position);
  const distance = relative.length();
  if (distance >= field.radius) return null;
  const compact = Math.pow(Math.max(0, 1 - distance / field.radius), field.falloff);
  if (compact <= 0 || field.strength === 0) return null;
  let direction: THREE.Vector3;
  if (field.type === "direction") direction = field.direction!.clone();
  else if (field.type === "attract") {
    if (distance <= 1e-12) return null;
    direction = relative.multiplyScalar(-1 / distance);
  } else if (field.type === "repel") {
    if (distance <= 1e-12) return null;
    direction = relative.multiplyScalar(1 / distance);
  } else {
    const radial = relative.projectOnPlane(field.direction!);
    if (radial.lengthSq() <= 1e-16) return null;
    direction = new THREE.Vector3().crossVectors(field.direction!, radial).normalize();
  }
  const amplitude = field.radius * field.strength * compact;
  if (!Number.isFinite(amplitude)) throw new Error(`spatial force field ${field.id} produced a non-finite amplitude`);
  return direction.multiplyScalar(amplitude);
};

const fnvSignature = (chunks: readonly string[]) => {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(chunks.join("|"));
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `procplant-spatial-force-v1:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const targetSignature = (
  graph: ProcPlantGraph,
  fields: readonly NormalizedField[],
  iterations: number,
  maximumDisplacement: number,
  minimumSegmentLength: number,
  anchoredNodeIndices: readonly number[],
) => {
  const chunks = [
    `i:${iterations}`,
    `d:${maximumDisplacement.toPrecision(12)}`,
    `l:${minimumSegmentLength.toPrecision(12)}`,
    `a:${anchoredNodeIndices.join(",")}`,
  ];
  for (const stem of graph.stems) {
    chunks.push(`n:${stem.index}:${stem.position.x.toPrecision(12)},${stem.position.y.toPrecision(12)},${stem.position.z.toPrecision(12)}`);
  }
  for (const record of [...graph.segmentRecords].sort((a, b) => a.id.localeCompare(b.id))) {
    chunks.push(`s:${record.id}:${record.parentSegmentId ?? "root"}:${record.startNodeIndex}:${record.endNodeIndex}`);
  }
  graph.organs.forEach((organ, index) => {
    chunks.push(`o:${index}:${organ.kind}:${organ.position.toArray().map((value) => value.toPrecision(12)).join(",")}:${organ.direction.toArray().map((value) => value.toPrecision(12)).join(",")}`);
  });
  for (const attachment of [...graph.attachments].sort((a, b) => a.id.localeCompare(b.id))) {
    chunks.push(`a:${attachment.id}:${attachment.parentSegmentId ?? "root"}:${attachment.axialT.toPrecision(12)}:${attachment.position.toArray().map((value) => value.toPrecision(12)).join(",")}:${attachment.organIndex ?? "none"}`);
  }
  for (const field of fields) {
    chunks.push(`f:${field.id}:${field.type}:${field.position.toArray().map((value) => value.toPrecision(12)).join(",")}:${field.direction?.toArray().map((value) => value.toPrecision(12)).join(",") ?? "-"}:${field.radius.toPrecision(12)}:${field.strength.toPrecision(12)}:${field.falloff.toPrecision(12)}`);
  }
  return fnvSignature(chunks);
};

const noOpResult = (
  graph: ProcPlantGraph,
  enabled: boolean,
  signature: string,
  iterations: number,
  fieldIds: readonly string[],
  segmentCount: number,
  workItems: number,
  anchoredNodes: number,
): ProcPlantSpatialForceResult => ({
  contract: "procplants.spatial-force-result",
  version: 1,
  graph,
  audit: {
    enabled,
    targetSignature: signature,
    iterations,
    nodeCount: graph.stems.length,
    segmentCount,
    fieldCount: fieldIds.length,
    workItems,
    anchoredNodes,
    affectedNodes: 0,
    affectedSegments: 0,
    maxDisplacement: 0,
    preventedDegenerateSegments: 0,
    unmatchedFieldIds: [...fieldIds].sort(),
    sourceGraphReused: true,
  },
});

/**
 * Deterministically bends a public ProcPlantGraph through compact spatial
 * fields. This is authored deformation, not a physical growth simulation.
 */
export const applyProcPlantSpatialForceFields = (
  graph: ProcPlantGraph,
  fields: readonly ProcPlantSpatialForceField[],
  options: ProcPlantSpatialForceOptions = {},
): ProcPlantSpatialForceResult => {
  validateGraphVectors(graph);
  const topology = orderedSegments(graph);
  const maxNodes = cappedInteger(options.maxNodes ?? PROCPLANT_SPATIAL_FORCE_HARD_CAPS.nodes, "spatial force maxNodes", PROCPLANT_SPATIAL_FORCE_HARD_CAPS.nodes);
  const maxSegments = cappedInteger(options.maxSegments ?? PROCPLANT_SPATIAL_FORCE_HARD_CAPS.segments, "spatial force maxSegments", PROCPLANT_SPATIAL_FORCE_HARD_CAPS.segments);
  const maxFields = cappedInteger(options.maxFields ?? PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fields, "spatial force maxFields", PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fields);
  const maxWorkItems = cappedInteger(options.maxWorkItems ?? PROCPLANT_SPATIAL_FORCE_HARD_CAPS.workItems, "spatial force maxWorkItems", PROCPLANT_SPATIAL_FORCE_HARD_CAPS.workItems);
  if (graph.stems.length > maxNodes) throw new Error(`spatial force node count exceeds maxNodes (${maxNodes})`);
  if (graph.segments.length > maxSegments) throw new Error(`spatial force segment count exceeds maxSegments (${maxSegments})`);
  if (fields.length > maxFields) throw new Error(`spatial force field count exceeds maxFields (${maxFields})`);
  const iterations = cappedInteger(options.iterations ?? 2, "spatial force iterations", PROCPLANT_SPATIAL_FORCE_HARD_CAPS.iterations, 1);
  const maximumDisplacement = finite(options.maximumDisplacement ?? 1, "spatial force maximumDisplacement", 0);
  if (maximumDisplacement > PROCPLANT_SPATIAL_FORCE_HARD_CAPS.displacement) {
    throw new Error(`spatial force maximumDisplacement must be at most ${PROCPLANT_SPATIAL_FORCE_HARD_CAPS.displacement}`);
  }
  const minimumSegmentLength = finite(options.minimumSegmentLength ?? 1e-5, "spatial force minimumSegmentLength", 1e-8);
  if (minimumSegmentLength > Math.max(maximumDisplacement, 1)) {
    throw new Error("spatial force minimumSegmentLength exceeds its safe displacement bound");
  }
  const normalizedFields = normalizeFields(fields);
  const workItems = topology.ordered.length * normalizedFields.length * iterations;
  if (!Number.isSafeInteger(workItems) || workItems > maxWorkItems) {
    throw new Error(`spatial force work exceeds maxWorkItems (${maxWorkItems})`);
  }
  const anchored = new Set(topology.rootNodes);
  for (const nodeIndex of options.anchoredNodeIndices ?? []) {
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= graph.stems.length) {
      throw new Error(`spatial force anchored node index is invalid: ${nodeIndex}`);
    }
    anchored.add(nodeIndex);
  }
  const sortedAnchored = [...anchored].sort((a, b) => a - b);
  const signature = targetSignature(
    graph,
    normalizedFields,
    iterations,
    maximumDisplacement,
    minimumSegmentLength,
    sortedAnchored,
  );
  const fieldIds = normalizedFields.map((field) => field.id);
  if (options.enabled === false || normalizedFields.length === 0 || maximumDisplacement === 0 ||
    normalizedFields.every((field) => field.strength === 0) || topology.ordered.length === 0) {
    return noOpResult(graph, options.enabled !== false, signature, iterations, fieldIds, topology.ordered.length, workItems, anchored.size);
  }

  const sourcePositions = graph.stems.map((stem) => stem.position.clone());
  let currentPositions = sourcePositions.map((position) => position.clone());
  const matchedFields = new Set<string>();
  let preventedDegenerateSegments = 0;
  const maximumStep = maximumDisplacement / iterations;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const priorPositions = currentPositions.map((position) => position.clone());
    const nextPositions = priorPositions.map((position) => position.clone());
    for (const record of topology.ordered) {
      const startIndex = record.startNodeIndex;
      const endIndex = record.endNodeIndex;
      const priorStart = priorPositions[startIndex]!;
      const priorEnd = priorPositions[endIndex]!;
      const nextStart = nextPositions[startIndex]!;
      if (anchored.has(endIndex)) {
        nextPositions[endIndex] = sourcePositions[endIndex]!.clone();
        continue;
      }
      const candidate = priorEnd.clone().add(nextStart.clone().sub(priorStart));
      const force = new THREE.Vector3();
      for (const field of normalizedFields) {
        const contribution = fieldDisplacement(field, priorEnd);
        if (!contribution) continue;
        matchedFields.add(field.id);
        if (contribution.length() > maximumStep) contribution.setLength(maximumStep);
        force.add(contribution);
      }
      if (force.length() > maximumStep) force.setLength(maximumStep);
      candidate.add(force);
      const fromSource = candidate.clone().sub(sourcePositions[endIndex]!);
      if (fromSource.length() > maximumDisplacement) {
        candidate.copy(sourcePositions[endIndex]!).add(fromSource.setLength(maximumDisplacement));
      }
      if (candidate.distanceToSquared(nextStart) < minimumSegmentLength * minimumSegmentLength) {
        const fallback = safeTangent(priorStart, priorEnd, graph.stems[endIndex]!.direction);
        candidate.copy(nextStart).addScaledVector(fallback, minimumSegmentLength);
        const repairedFromSource = candidate.clone().sub(sourcePositions[endIndex]!);
        if (repairedFromSource.length() > maximumDisplacement) {
          candidate.copy(sourcePositions[endIndex]!).add(repairedFromSource.setLength(maximumDisplacement));
        }
        preventedDegenerateSegments++;
      }
      if (![candidate.x, candidate.y, candidate.z].every(Number.isFinite)) {
        throw new Error(`spatial force produced a non-finite node ${endIndex}`);
      }
      nextPositions[endIndex] = candidate;
    }
    currentPositions = nextPositions;
  }

  let maxDisplacement = 0;
  const affectedNodes = new Set<number>();
  for (let index = 0; index < currentPositions.length; index++) {
    const displacement = currentPositions[index]!.distanceTo(sourcePositions[index]!);
    if (displacement > 1e-10) affectedNodes.add(index);
    maxDisplacement = Math.max(maxDisplacement, displacement);
  }
  if (affectedNodes.size === 0) {
    return noOpResult(graph, true, signature, iterations, fieldIds, topology.ordered.length, workItems, anchored.size);
  }

  const bindings = captureBindings(graph, topology.byId);
  const result = cloneGraph(graph);
  for (let index = 0; index < result.stems.length; index++) result.stems[index]!.position.copy(currentPositions[index]!);
  const outgoing = new Map<number, ProcPlantSegmentRecord[]>();
  for (const record of topology.ordered) {
    const entries = outgoing.get(record.startNodeIndex) ?? [];
    entries.push(record);
    outgoing.set(record.startNodeIndex, entries);
  }
  for (const entries of outgoing.values()) entries.sort((a, b) => a.id.localeCompare(b.id));
  for (let nodeIndex = 0; nodeIndex < result.stems.length; nodeIndex++) {
    const incoming = topology.incomingByNode.get(nodeIndex);
    const reference = incoming ?? outgoing.get(nodeIndex)?.[0];
    if (!reference) continue;
    result.stems[nodeIndex]!.direction.copy(safeTangent(
      result.stems[reference.startNodeIndex]!.position,
      result.stems[reference.endNodeIndex]!.position,
      graph.stems[nodeIndex]!.direction,
    ));
  }

  for (const binding of bindings) {
    const record = topology.byId.get(binding.segmentId)!;
    const start = result.stems[record.startNodeIndex]!.position;
    const end = result.stems[record.endNodeIndex]!.position;
    const tangent = safeTangent(start, end, binding.oldTangent);
    const rotation = new THREE.Quaternion().setFromUnitVectors(binding.oldTangent, tangent);
    const frame = safeFrame(tangent, binding.oldRight.clone().applyQuaternion(rotation));
    const reference = start.clone().lerp(end, binding.axialT);
    const attachment = result.attachments[binding.attachmentIndex]!;
    attachment.position.copy(reference).add(fromCoordinates(binding.attachmentOffset, frame.right, frame.up, frame.tangent));
    attachment.tangent.copy(frame.tangent);
    attachment.right.copy(frame.right);
    attachment.up.copy(frame.up);
    if (binding.organIndex !== null && binding.organOffset && binding.organDirection && binding.organRight) {
      const organ = result.organs[binding.organIndex]!;
      organ.position.copy(reference).add(fromCoordinates(binding.organOffset, frame.right, frame.up, frame.tangent));
      organ.direction.copy(fromCoordinates(binding.organDirection, frame.right, frame.up, frame.tangent)).normalize();
      let organRight = fromCoordinates(binding.organRight, frame.right, frame.up, frame.tangent).projectOnPlane(organ.direction);
      if (organRight.lengthSq() <= 1e-16) organRight = safeFrame(organ.direction, frame.right).right;
      organ.right.copy(organRight.normalize());
    }
  }

  let affectedSegments = 0;
  for (const record of topology.ordered) {
    if (affectedNodes.has(record.startNodeIndex) || affectedNodes.has(record.endNodeIndex)) affectedSegments++;
    const length = result.stems[record.startNodeIndex]!.position.distanceTo(result.stems[record.endNodeIndex]!.position);
    if (!Number.isFinite(length) || length < minimumSegmentLength * 0.999) {
      throw new Error(`spatial force could not preserve segment length for ${record.id}`);
    }
  }
  return {
    contract: "procplants.spatial-force-result",
    version: 1,
    graph: result,
    audit: {
      enabled: true,
      targetSignature: signature,
      iterations,
      nodeCount: graph.stems.length,
      segmentCount: topology.ordered.length,
      fieldCount: normalizedFields.length,
      workItems,
      anchoredNodes: anchored.size,
      affectedNodes: affectedNodes.size,
      affectedSegments,
      maxDisplacement,
      preventedDegenerateSegments,
      unmatchedFieldIds: normalizedFields.filter((field) => !matchedFields.has(field.id)).map((field) => field.id),
      sourceGraphReused: false,
    },
  };
};
