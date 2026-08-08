export type ProcPlantCollarVec3 = readonly [number, number, number];

/** Stable trunk-side attachment frame accepted from spine attachment records. */
export interface ProcPlantJunctionCollarAnchor {
  id: string;
  surfacePosition: ProcPlantCollarVec3;
  supportTangent: ProcPlantCollarVec3;
  outward: ProcPlantCollarVec3;
  /** Radius of the imported trunk at the attachment. */
  surfaceRadius: number;
  /** Radius of the joining branch at its base. */
  branchRadius: number;
  /** Peak collar strength in [0, 1]. Defaults to 0.35. */
  strength?: number;
  /** Half-length of the compact support along the trunk tangent. */
  axialLength?: number;
  /** Compact-support arc length around the trunk circumference. */
  radialReach?: number;
  /** Tolerance around the expected trunk-radius shell. */
  shellThickness?: number;
}

export interface ProcPlantJunctionCollarOptions {
  enabled?: boolean;
  maxVertices?: number;
  maxAnchors?: number;
  maxWorkItems?: number;
  /** Absolute cap for the combined displacement of any vertex. */
  maximumDisplacement?: number;
  /** Maximum branch radius as a multiple of the local trunk radius. */
  maximumBranchRadiusScale?: number;
  /** Maximum axial support as a multiple of the local trunk radius. */
  maximumAxialLengthScale?: number;
  /** Maximum shell thickness as a multiple of the local trunk radius. */
  maximumShellThicknessScale?: number;
}

export interface ProcPlantJunctionCollarAudit {
  enabled: boolean;
  vertexCount: number;
  anchorCount: number;
  workItems: number;
  affectedVertices: number;
  matchedAnchors: number;
  unmatchedAnchorIds: string[];
  maxDisplacement: number;
  maximumDisplacement: number;
  sourcePositionsReused: boolean;
}

export interface ProcPlantJunctionCollarResult {
  contract: "procplants.junction-collar";
  version: 1;
  /** Exact input reference when audit.sourcePositionsReused is true. */
  positions: ArrayLike<number>;
  /** XYZ displacement attribute, absent for a zero-copy no-op. */
  collarDisplacement: Float32Array | null;
  /** Scalar combined collar influence, absent for a zero-copy no-op. */
  collarWeight: Float32Array | null;
  audit: ProcPlantJunctionCollarAudit;
}

export const PROCPLANT_JUNCTION_COLLAR_HARD_CAPS = Object.freeze({
  vertices: 2_000_000,
  anchors: 256,
  workItems: 32_000_000,
  branchRadiusScale: 8,
  axialLengthScale: 16,
  shellThicknessScale: 8,
});

interface NormalizedAnchor {
  id: string;
  surfacePosition: [number, number, number];
  tangent: [number, number, number];
  outward: [number, number, number];
  surfaceRadius: number;
  branchRadius: number;
  strength: number;
  axialLength: number;
  radialReach: number;
  shellThickness: number;
}

const finite = (value: number, label: string, minimum = -Infinity) => {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be finite${minimum > -Infinity ? ` and at least ${minimum}` : ""}`);
  }
  return value;
};

const cappedInteger = (value: number, label: string, hardCap: number) => {
  if (!Number.isInteger(value) || value < 0 || value > hardCap) {
    throw new Error(`${label} must be an integer in [0, ${hardCap}]`);
  }
  return value;
};

const tuple = (input: ProcPlantCollarVec3, label: string): [number, number, number] => {
  if (input.length !== 3 || input.some((component) => !Number.isFinite(component))) {
    throw new Error(`${label} must contain three finite components`);
  }
  return [input[0], input[1], input[2]];
};

const normalize = (input: ProcPlantCollarVec3, label: string): [number, number, number] => {
  const value = tuple(input, label);
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 1e-10) throw new Error(`${label} must have non-zero length`);
  return [value[0] / length, value[1] / length, value[2] / length];
};

const compactFalloff = (distance: number, support: number) => {
  if (distance >= support) return 0;
  const normalized = distance / support;
  const residual = 1 - normalized * normalized;
  return residual * residual;
};

const noOpResult = (
  positions: ArrayLike<number>,
  enabled: boolean,
  vertexCount: number,
  anchors: readonly { id: string }[],
  workItems: number,
  maximumDisplacement: number,
): ProcPlantJunctionCollarResult => ({
  contract: "procplants.junction-collar",
  version: 1,
  positions,
  collarDisplacement: null,
  collarWeight: null,
  audit: {
    enabled,
    vertexCount,
    anchorCount: anchors.length,
    workItems,
    affectedVertices: 0,
    matchedAnchors: 0,
    unmatchedAnchorIds: anchors.map((anchor) => anchor.id).sort(),
    maxDisplacement: 0,
    maximumDisplacement,
    sourcePositionsReused: true,
  },
});

const normalizeAnchor = (
  anchor: ProcPlantJunctionCollarAnchor,
  maximumBranchRadiusScale: number,
  maximumAxialLengthScale: number,
  maximumShellThicknessScale: number,
): NormalizedAnchor => {
  if (!anchor.id.trim()) throw new Error("junction collar anchor id must be non-empty");
  const surfacePosition = tuple(anchor.surfacePosition, `${anchor.id}.surfacePosition`);
  const tangent = normalize(anchor.supportTangent, `${anchor.id}.supportTangent`);
  const rawOutward = tuple(anchor.outward, `${anchor.id}.outward`);
  const projection = rawOutward[0] * tangent[0] + rawOutward[1] * tangent[1] + rawOutward[2] * tangent[2];
  const outward = normalize([
    rawOutward[0] - tangent[0] * projection,
    rawOutward[1] - tangent[1] * projection,
    rawOutward[2] - tangent[2] * projection,
  ], `${anchor.id}.outward projected perpendicular to supportTangent`);
  const surfaceRadius = finite(anchor.surfaceRadius, `${anchor.id}.surfaceRadius`, 1e-8);
  const branchRadius = finite(anchor.branchRadius, `${anchor.id}.branchRadius`, 0);
  if (branchRadius > surfaceRadius * maximumBranchRadiusScale) {
    throw new Error(`${anchor.id}.branchRadius exceeds the configured local-radius bound`);
  }
  const strength = finite(anchor.strength ?? 0.35, `${anchor.id}.strength`, 0);
  if (strength > 1) throw new Error(`${anchor.id}.strength must be in [0, 1]`);
  const axialLength = finite(
    anchor.axialLength ?? Math.max(branchRadius * 2, surfaceRadius * 0.25),
    `${anchor.id}.axialLength`,
    1e-8,
  );
  if (axialLength > surfaceRadius * maximumAxialLengthScale) {
    throw new Error(`${anchor.id}.axialLength exceeds the configured local-radius bound`);
  }
  const radialReach = finite(
    anchor.radialReach ?? Math.max(branchRadius * 2, surfaceRadius * 0.25),
    `${anchor.id}.radialReach`,
    1e-8,
  );
  if (radialReach > Math.PI * surfaceRadius) {
    throw new Error(`${anchor.id}.radialReach must not exceed half the local circumference`);
  }
  const shellThickness = finite(
    anchor.shellThickness ?? Math.max(branchRadius, surfaceRadius * 0.1),
    `${anchor.id}.shellThickness`,
    1e-8,
  );
  if (shellThickness > surfaceRadius * maximumShellThicknessScale) {
    throw new Error(`${anchor.id}.shellThickness exceeds the configured local-radius bound`);
  }
  return {
    id: anchor.id,
    surfacePosition,
    tangent,
    outward,
    surfaceRadius,
    branchRadius,
    strength,
    axialLength,
    radialReach,
    shellThickness,
  };
};

/**
 * Applies a bounded visual collar swell to an imported trunk position buffer.
 * This is a surface deformation only; it does not boolean-union meshes or
 * claim to produce a watertight branch/trunk junction.
 */
export const buildProcPlantJunctionCollars = (
  positions: ArrayLike<number>,
  anchors: readonly ProcPlantJunctionCollarAnchor[],
  options: ProcPlantJunctionCollarOptions = {},
): ProcPlantJunctionCollarResult => {
  if (positions.length % 3 !== 0) throw new Error("junction collar positions must contain xyz vertices");
  const vertexCount = positions.length / 3;
  const maxVertices = cappedInteger(
    options.maxVertices ?? PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.vertices,
    "junction collar maxVertices",
    PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.vertices,
  );
  const maxAnchors = cappedInteger(
    options.maxAnchors ?? PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.anchors,
    "junction collar maxAnchors",
    PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.anchors,
  );
  const maxWorkItems = cappedInteger(
    options.maxWorkItems ?? PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.workItems,
    "junction collar maxWorkItems",
    PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.workItems,
  );
  if (vertexCount > maxVertices) throw new Error(`junction collar vertex count exceeds maxVertices (${maxVertices})`);
  if (anchors.length > maxAnchors) throw new Error(`junction collar anchor count exceeds maxAnchors (${maxAnchors})`);
  const workItems = vertexCount * anchors.length;
  if (!Number.isSafeInteger(workItems) || workItems > maxWorkItems) {
    throw new Error(`junction collar work exceeds maxWorkItems (${maxWorkItems})`);
  }
  for (let index = 0; index < positions.length; index++) {
    if (!Number.isFinite(positions[index])) throw new Error(`junction collar position ${index} must be finite`);
  }

  const maximumBranchRadiusScale = finite(
    options.maximumBranchRadiusScale ?? 2,
    "junction collar maximumBranchRadiusScale",
    0,
  );
  if (maximumBranchRadiusScale > PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.branchRadiusScale) {
    throw new Error(`junction collar maximumBranchRadiusScale must be at most ${PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.branchRadiusScale}`);
  }
  const maximumAxialLengthScale = finite(
    options.maximumAxialLengthScale ?? 4,
    "junction collar maximumAxialLengthScale",
    0,
  );
  if (maximumAxialLengthScale > PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.axialLengthScale) {
    throw new Error(`junction collar maximumAxialLengthScale must be at most ${PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.axialLengthScale}`);
  }
  const maximumShellThicknessScale = finite(
    options.maximumShellThicknessScale ?? 2,
    "junction collar maximumShellThicknessScale",
    0,
  );
  if (maximumShellThicknessScale > PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.shellThicknessScale) {
    throw new Error(`junction collar maximumShellThicknessScale must be at most ${PROCPLANT_JUNCTION_COLLAR_HARD_CAPS.shellThicknessScale}`);
  }
  if (options.enabled === false || anchors.length === 0) {
    return noOpResult(positions, options.enabled !== false, vertexCount, anchors, workItems, 0);
  }

  const seenIds = new Set<string>();
  const normalized = anchors.map((anchor) => normalizeAnchor(
    anchor,
    maximumBranchRadiusScale,
    maximumAxialLengthScale,
    maximumShellThicknessScale,
  )).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (const anchor of normalized) {
    if (seenIds.has(anchor.id)) throw new Error(`duplicate junction collar anchor id: ${anchor.id}`);
    seenIds.add(anchor.id);
  }
  const defaultMaximumDisplacement = normalized.reduce((maximum, anchor) => Math.max(maximum, anchor.branchRadius), 0);
  const maximumDisplacement = finite(
    options.maximumDisplacement ?? defaultMaximumDisplacement,
    "junction collar maximumDisplacement",
    0,
  );
  const hardMaximumDisplacement = normalized.reduce(
    (maximum, anchor) => Math.max(maximum, anchor.surfaceRadius * maximumBranchRadiusScale),
    0,
  );
  if (maximumDisplacement > hardMaximumDisplacement) {
    throw new Error("junction collar maximumDisplacement exceeds the configured local-radius bound");
  }
  if (maximumDisplacement === 0 || normalized.every((anchor) => anchor.strength === 0 || anchor.branchRadius === 0)) {
    return noOpResult(positions, true, vertexCount, normalized, workItems, maximumDisplacement);
  }

  const displacements = new Float32Array(positions.length);
  const weights = new Float32Array(vertexCount);
  const matched = new Set<string>();
  let affectedVertices = 0;
  let maxDisplacement = 0;

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    const offset = vertexIndex * 3;
    const px = positions[offset]!;
    const py = positions[offset + 1]!;
    const pz = positions[offset + 2]!;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let combinedWeight = 0;
    for (const anchor of normalized) {
      if (anchor.strength === 0 || anchor.branchRadius === 0) continue;
      const centerX = anchor.surfacePosition[0] - anchor.outward[0] * anchor.surfaceRadius;
      const centerY = anchor.surfacePosition[1] - anchor.outward[1] * anchor.surfaceRadius;
      const centerZ = anchor.surfacePosition[2] - anchor.outward[2] * anchor.surfaceRadius;
      const relativeX = px - centerX;
      const relativeY = py - centerY;
      const relativeZ = pz - centerZ;
      const axial = relativeX * anchor.tangent[0] + relativeY * anchor.tangent[1] + relativeZ * anchor.tangent[2];
      const axialWeight = compactFalloff(Math.abs(axial), anchor.axialLength);
      if (axialWeight === 0) continue;
      const radialX = relativeX - anchor.tangent[0] * axial;
      const radialY = relativeY - anchor.tangent[1] * axial;
      const radialZ = relativeZ - anchor.tangent[2] * axial;
      const radialLength = Math.hypot(radialX, radialY, radialZ);
      if (radialLength <= 1e-10) continue;
      const shellWeight = compactFalloff(Math.abs(radialLength - anchor.surfaceRadius), anchor.shellThickness);
      if (shellWeight === 0) continue;
      const inverseRadialLength = 1 / radialLength;
      const radialUnitX = radialX * inverseRadialLength;
      const radialUnitY = radialY * inverseRadialLength;
      const radialUnitZ = radialZ * inverseRadialLength;
      const alignment = Math.max(-1, Math.min(1,
        radialUnitX * anchor.outward[0] + radialUnitY * anchor.outward[1] + radialUnitZ * anchor.outward[2],
      ));
      const circumferentialDistance = Math.acos(alignment) * anchor.surfaceRadius;
      const radialWeight = compactFalloff(circumferentialDistance, anchor.radialReach);
      const weight = anchor.strength * axialWeight * shellWeight * radialWeight;
      if (weight <= 0) continue;
      matched.add(anchor.id);
      combinedWeight = Math.max(combinedWeight, weight);
      const displacement = anchor.branchRadius * weight;
      dx += radialUnitX * displacement;
      dy += radialUnitY * displacement;
      dz += radialUnitZ * displacement;
    }
    let displacementLength = Math.hypot(dx, dy, dz);
    if (displacementLength > maximumDisplacement) {
      const scale = maximumDisplacement / displacementLength;
      dx *= scale;
      dy *= scale;
      dz *= scale;
      displacementLength = maximumDisplacement;
    }
    if (displacementLength <= 1e-12) continue;
    displacements[offset] = dx;
    displacements[offset + 1] = dy;
    displacements[offset + 2] = dz;
    weights[vertexIndex] = combinedWeight;
    affectedVertices++;
    maxDisplacement = Math.max(maxDisplacement, displacementLength);
  }

  if (affectedVertices === 0) {
    return noOpResult(positions, true, vertexCount, normalized, workItems, maximumDisplacement);
  }
  const deformed = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index++) {
    deformed[index] = positions[index]! + displacements[index]!;
    if (!Number.isFinite(deformed[index])) throw new Error(`junction collar output ${index} is not finite`);
  }
  const unmatchedAnchorIds = normalized.filter((anchor) => !matched.has(anchor.id)).map((anchor) => anchor.id);
  return {
    contract: "procplants.junction-collar",
    version: 1,
    positions: deformed,
    collarDisplacement: displacements,
    collarWeight: weights,
    audit: {
      enabled: true,
      vertexCount,
      anchorCount: normalized.length,
      workItems,
      affectedVertices,
      matchedAnchors: matched.size,
      unmatchedAnchorIds,
      maxDisplacement,
      maximumDisplacement,
      sourcePositionsReused: false,
    },
  };
};
