import * as THREE from "three";
import type {
  ProcPlantAttachmentAnchor,
  ProcPlantGraph,
  ProcPlantOrgan,
  ProcPlantSegmentRecord,
  ProcPlantStemNode,
} from "./procplants";

export type ProcPlantPruningSelection =
  | { kind: "segmentIds"; segmentIds: readonly string[] }
  | { kind: "branchDepth"; minDepth?: number; maxDepth?: number }
  | { kind: "heightPlane"; height: number; side: "above" | "below" }
  | { kind: "radius"; center: THREE.Vector3; radius: number; side: "inside" | "outside" };

export interface ProcPlantPruningRequest {
  /** `remove` trims the selection and descendants; `retain` keeps it and all ancestors. */
  operation?: "remove" | "retain";
  selection: ProcPlantPruningSelection;
}

export interface ProcPlantPruningAudit {
  operation: "remove" | "retain";
  matchedSegmentIds: string[];
  cascadedDescendantIds: string[];
  preservedAncestorIds: string[];
  before: { stems: number; segments: number; organs: number; attachments: number };
  after: { stems: number; segments: number; organs: number; attachments: number };
  removed: { stems: number; segments: number; organs: number; attachments: number };
  warnings: string[];
}

export interface ProcPlantPruningResult {
  graph: ProcPlantGraph;
  audit: ProcPlantPruningAudit;
}

const cloneStem = (stem: ProcPlantStemNode, index: number): ProcPlantStemNode => ({
  ...stem,
  index,
  position: stem.position.clone(),
  direction: stem.direction.clone(),
});

const cloneOrgan = (organ: ProcPlantOrgan): ProcPlantOrgan => ({
  ...organ,
  position: organ.position.clone(),
  direction: organ.direction.clone(),
  right: organ.right.clone(),
});

const cloneAttachment = (
  attachment: ProcPlantAttachmentAnchor,
  organIndex: number | null,
): ProcPlantAttachmentAnchor => ({
  ...attachment,
  organIndex,
  position: attachment.position.clone(),
  tangent: attachment.tangent.clone(),
  right: attachment.right.clone(),
  up: attachment.up.clone(),
});

const segmentEndPosition = (
  graph: ProcPlantGraph,
  record: ProcPlantSegmentRecord,
): THREE.Vector3 | undefined => graph.stems[record.endNodeIndex]?.position;

const depthMatches = (depth: number, selection: Extract<ProcPlantPruningSelection, { kind: "branchDepth" }>) => {
  const min = selection.minDepth ?? Number.NEGATIVE_INFINITY;
  const max = selection.maxDepth ?? Number.POSITIVE_INFINITY;
  return depth >= min && depth <= max;
};

const pointMatches = (
  point: THREE.Vector3,
  selection: Extract<ProcPlantPruningSelection, { kind: "heightPlane" | "radius" }>,
) => {
  if (selection.kind === "heightPlane") {
    return selection.side === "above" ? point.y > selection.height : point.y < selection.height;
  }
  const inside = point.distanceToSquared(selection.center) <= Math.max(0, selection.radius) ** 2;
  return selection.side === "inside" ? inside : !inside;
};

const segmentMatches = (
  graph: ProcPlantGraph,
  record: ProcPlantSegmentRecord,
  selection: ProcPlantPruningSelection,
  selectedIds: ReadonlySet<string>,
) => {
  if (selection.kind === "segmentIds") return selectedIds.has(record.id);
  if (selection.kind === "branchDepth") return depthMatches(record.depth, selection);
  const point = segmentEndPosition(graph, record);
  return point ? pointMatches(point, selection) : false;
};

const attachmentMatches = (
  attachment: ProcPlantAttachmentAnchor,
  selection: ProcPlantPruningSelection,
  matchedSegments: ReadonlySet<string>,
) => {
  if (selection.kind === "segmentIds") {
    return attachment.parentSegmentId !== null && matchedSegments.has(attachment.parentSegmentId);
  }
  if (selection.kind === "branchDepth") return depthMatches(attachment.depth, selection);
  return pointMatches(attachment.position, selection);
};

/**
 * Deterministically prune the public graph IR without changing source graph or geometry.
 * Segment records and attachment IDs remain stable; array/node/organ indices are compacted.
 */
export const pruneProcPlantGraph = (
  source: ProcPlantGraph,
  request: ProcPlantPruningRequest,
): ProcPlantPruningResult => {
  const operation = request.operation ?? "remove";
  const warnings: string[] = [];
  const recordById = new Map(source.segmentRecords.map((record) => [record.id, record]));
  const requestedIds = request.selection.kind === "segmentIds"
    ? new Set(request.selection.segmentIds)
    : new Set<string>();
  if (request.selection.kind === "segmentIds") {
    const unknown = request.selection.segmentIds.filter((id) => !recordById.has(id));
    if (unknown.length > 0) warnings.push(`Unknown segment IDs ignored: ${unknown.join(", ")}`);
  }

  const matched = new Set(
    source.segmentRecords
      .filter((record) => segmentMatches(source, record, request.selection, requestedIds))
      .map((record) => record.id),
  );
  if (matched.size === 0) warnings.push("Selection matched no segments.");

  const childrenByParent = new Map<string, string[]>();
  for (const record of source.segmentRecords) {
    if (!record.parentSegmentId) continue;
    const children = childrenByParent.get(record.parentSegmentId) ?? [];
    children.push(record.id);
    childrenByParent.set(record.parentSegmentId, children);
  }

  const cascadedDescendants = new Set<string>();
  const preservedAncestors = new Set<string>();
  const keptSegmentIds = new Set<string>();
  if (operation === "remove") {
    const removed = new Set(matched);
    const queue = [...matched];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (removed.has(childId)) continue;
        removed.add(childId);
        cascadedDescendants.add(childId);
        queue.push(childId);
      }
    }
    for (const record of source.segmentRecords) if (!removed.has(record.id)) keptSegmentIds.add(record.id);
  } else {
    for (const id of matched) {
      keptSegmentIds.add(id);
      let parentId = recordById.get(id)?.parentSegmentId ?? null;
      while (parentId) {
        if (!keptSegmentIds.has(parentId)) preservedAncestors.add(parentId);
        keptSegmentIds.add(parentId);
        parentId = recordById.get(parentId)?.parentSegmentId ?? null;
      }
    }
  }

  const keptRecords = source.segmentRecords.filter((record) => keptSegmentIds.has(record.id));
  const requiredNodeIndices = new Set<number>();
  for (const record of keptRecords) {
    requiredNodeIndices.add(record.startNodeIndex);
    requiredNodeIndices.add(record.endNodeIndex);
  }
  const oldToNewNode = new Map<number, number>();
  const stems: ProcPlantStemNode[] = [];
  [...requiredNodeIndices].sort((a, b) => a - b).forEach((oldIndex) => {
    const stem = source.stems[oldIndex];
    if (!stem) return;
    oldToNewNode.set(oldIndex, stems.length);
    stems.push(cloneStem(stem, stems.length));
  });

  const segmentRecords: ProcPlantSegmentRecord[] = [];
  const segments: Array<[number, number]> = [];
  for (const record of keptRecords) {
    const startNodeIndex = oldToNewNode.get(record.startNodeIndex);
    const endNodeIndex = oldToNewNode.get(record.endNodeIndex);
    if (startNodeIndex === undefined || endNodeIndex === undefined) continue;
    const parentSegmentId = record.parentSegmentId && keptSegmentIds.has(record.parentSegmentId)
      ? record.parentSegmentId
      : null;
    segmentRecords.push({ ...record, parentSegmentId, startNodeIndex, endNodeIndex });
    segments.push([startNodeIndex, endNodeIndex]);
  }

  const retainedAttachments = source.attachments.filter((attachment) => {
    const connected = attachment.parentSegmentId === null || keptSegmentIds.has(attachment.parentSegmentId);
    if (!connected) return false;
    const selected = attachmentMatches(attachment, request.selection, matched);
    return operation === "remove" ? !selected : selected;
  });
  const retainedOrganIndices = new Set(
    retainedAttachments
      .map((attachment) => attachment.organIndex)
      .filter((index): index is number => index !== null && source.organs[index] !== undefined),
  );
  const oldToNewOrgan = new Map<number, number>();
  const organs: ProcPlantOrgan[] = [];
  [...retainedOrganIndices].sort((a, b) => a - b).forEach((oldIndex) => {
    oldToNewOrgan.set(oldIndex, organs.length);
    organs.push(cloneOrgan(source.organs[oldIndex]!));
  });
  const attachments = retainedAttachments.map((attachment) => cloneAttachment(
    attachment,
    attachment.organIndex === null ? null : oldToNewOrgan.get(attachment.organIndex) ?? null,
  ));

  const graph: ProcPlantGraph = { stems, segments, organs, segmentRecords, attachments };
  const before = {
    stems: source.stems.length,
    segments: source.segmentRecords.length,
    organs: source.organs.length,
    attachments: source.attachments.length,
  };
  const after = {
    stems: stems.length,
    segments: segmentRecords.length,
    organs: organs.length,
    attachments: attachments.length,
  };
  return {
    graph,
    audit: {
      operation,
      matchedSegmentIds: source.segmentRecords.filter((record) => matched.has(record.id)).map((record) => record.id),
      cascadedDescendantIds: source.segmentRecords.filter((record) => cascadedDescendants.has(record.id)).map((record) => record.id),
      preservedAncestorIds: source.segmentRecords.filter((record) => preservedAncestors.has(record.id)).map((record) => record.id),
      before,
      after,
      removed: {
        stems: before.stems - after.stems,
        segments: before.segments - after.segments,
        organs: before.organs - after.organs,
        attachments: before.attachments - after.attachments,
      },
      warnings,
    },
  };
};
