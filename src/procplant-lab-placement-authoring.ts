import type { Vector3 } from "three";
import {
  appendProcPlantOrganPlacement,
  createProcPlantOrganPlacementPackage,
  createProcPlantOrganPlacementTarget,
  deriveProcPlantOrganPlacementAzimuth,
  PROCPLANT_PLACEABLE_PART_KINDS,
  type ProcPlantOrganPlacementPackage,
  type ProcPlantPlaceableOrganKind,
  type ProcPlantPlacementDecalBinding,
} from "./procplant-organ-placement-overrides";
import {
  appendProcPlantWeberPennOrganPlacementFromPicker,
  type ProcPlantWeberPennOrganPlacementPackage,
} from "./procplant-weber-penn-organ-placement";
import type {
  ProcPlantGraph,
  ProcPlantWeberPennBuildMetadata,
} from "./procplants";

export type ProcPlantLabOrganPlacementPackage =
  | ProcPlantOrganPlacementPackage
  | ProcPlantWeberPennOrganPlacementPackage;

export interface ProcPlantLabPlacementInput {
  placementPackage: ProcPlantLabOrganPlacementPackage | null;
  graph: ProcPlantGraph;
  weberPenn: ProcPlantWeberPennBuildMetadata | null;
  pickerSegmentId: string;
  localPoint: Vector3;
  kind: unknown;
  genomeId: string;
  seed: number;
  flowerAvailable: boolean;
  decalBinding: ProcPlantPlacementDecalBinding | null;
}

export interface ProcPlantLabPlacementResult {
  status: "applied" | "rejected";
  message: string;
  placementPackage: ProcPlantLabOrganPlacementPackage | null;
  attachmentId: string | null;
  ownerStemId: string | null;
}

const placementScale: Record<ProcPlantPlaceableOrganKind, number> = {
  leaf: 1,
  flower: 1,
  fruit: 0.16,
  berry: 0.14,
  cone: 0.22,
  thorn: 0.18,
  aerialRoot: 0.38,
  coniferSpray: 0.72,
  fernFrond: 0.86,
  palmFrond: 1,
  mossTuft: 0.28,
  branch: 0.48,
  knot: 0.18,
  decal: 0.18,
};

const placementColors: Partial<Record<ProcPlantPlaceableOrganKind, { color: number; secondaryColor?: number }>> = {
  fruit: { color: 0xc7472f, secondaryColor: 0x6e281c },
  berry: { color: 0x92324d, secondaryColor: 0x4b1728 },
  cone: { color: 0x76502d, secondaryColor: 0x3f2a19 },
  thorn: { color: 0x6f5a3c, secondaryColor: 0x3d2f20 },
  aerialRoot: { color: 0x6a5438, secondaryColor: 0x3b3024 },
};

const rejected = (message: string): ProcPlantLabPlacementResult => ({
  status: "rejected",
  message,
  placementPackage: null,
  attachmentId: null,
  ownerStemId: null,
});

/** Click-time placement resolution kept out of the interactive startup closure. */
export const resolveProcPlantLabPlacement = (
  input: ProcPlantLabPlacementInput,
): ProcPlantLabPlacementResult => {
  const kind: ProcPlantPlaceableOrganKind = typeof input.kind === "string" &&
    (PROCPLANT_PLACEABLE_PART_KINDS as readonly string[]).includes(input.kind)
    ? input.kind as ProcPlantPlaceableOrganKind
    : "leaf";
  if (input.weberPenn) {
    if (input.placementPackage?.contract === "procplants.organ-placement-overrides") {
      return rejected("Undo placements for the prior plant first.");
    }
    const appended = appendProcPlantWeberPennOrganPlacementFromPicker({
      placementPackage: input.placementPackage,
      target: input.weberPenn.target,
      attachments: input.graph.attachments,
      pickerStemIds: input.weberPenn.pickerStemIds,
      attachmentStemIds: input.weberPenn.attachmentStemIds,
      pickerSegmentId: input.pickerSegmentId,
      localPoint: input.localPoint,
      kind,
      flowerAvailable: input.flowerAvailable,
      scale: placementScale[kind],
      ...placementColors[kind],
    });
    if (!appended.operation) return rejected("Placement rejected.");
    return {
      status: "applied",
      message: "Placement added.",
      placementPackage: appended.package,
      attachmentId: appended.attachmentId,
      ownerStemId: appended.ownerStemId,
    };
  }

  const segment = input.graph.segmentRecords.find((candidate) => candidate.id === input.pickerSegmentId);
  const start = segment ? input.graph.stems[segment.startNodeIndex] : null;
  const end = segment ? input.graph.stems[segment.endNodeIndex] : null;
  if (!segment || !start || !end) return rejected("That segment no longer has a stable graph frame.");
  if (segment.id.startsWith("placed-branch:") || segment.id.startsWith("placed-knot:")) {
    return rejected("Place additional parts on a source branch; authored outputs are regenerated rather than stable placement targets.");
  }
  const axis = end.position.clone().sub(start.position);
  const axisLengthSq = axis.lengthSq();
  if (axisLengthSq < 1e-10) return rejected("That segment is too short for a stable placement.");
  const axialT = Math.min(0.98, Math.max(0.02,
    input.localPoint.clone().sub(start.position).dot(axis) / axisLengthSq));
  const azimuth = deriveProcPlantOrganPlacementAzimuth(input.graph, segment.id, axialT, input.localPoint);
  if (azimuth === null) return rejected("A stable radial frame could not be derived for that segment.");
  const source = createProcPlantOrganPlacementTarget(input.genomeId, input.seed, input.graph);
  if (input.placementPackage?.contract === "procplants.weber-penn-organ-placement-overrides") {
    return rejected("Undo placements for the prior plant first.");
  }
  let placementPackage = input.placementPackage;
  if (placementPackage && (
    placementPackage.target.genomeId !== source.genomeId
    || placementPackage.target.seed !== source.seed
    || placementPackage.target.graphSignatureVersion !== source.graphSignatureVersion
    || placementPackage.target.graphSignature !== source.graphSignature
  )) {
    return rejected("Existing placements target a different graph topology. Undo them before placing on this regenerated plant.");
  }
  placementPackage ??= createProcPlantOrganPlacementPackage(source);
  if (kind === "flower" && !input.flowerAvailable) {
    return rejected("This plant has no flower geometry; choose another supported part.");
  }
  if (kind === "decal" && !input.decalBinding) {
    return rejected("Bind a decal image before placing an exact renderer-owned UV0 patch.");
  }
  const appended = appendProcPlantOrganPlacement(placementPackage, {
    kind,
    segmentId: segment.id,
    axialT,
    azimuth,
    scale: placementScale[kind],
    ...placementColors[kind],
    ...(kind === "decal" && input.decalBinding ? { decal: input.decalBinding } : {}),
  });
  if (!appended.operation) {
    return rejected(appended.reason === "spacing"
      ? "That placement is too close to another authored organ on this segment."
      : appended.reason === "cap"
        ? "The 96-part authored placement cap has been reached."
        : "That placement could not be represented safely.");
  }
  return {
    status: "applied",
    message: `Placing ${kind} on ${segment.id} at ${(appended.operation.axialT * 100).toFixed(0)}%…`,
    placementPackage: appended.package,
    attachmentId: null,
    ownerStemId: null,
  };
};
