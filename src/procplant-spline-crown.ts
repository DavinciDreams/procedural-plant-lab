import {
  cloneProcPlantFreeformCrown,
  PROCPLANT_CROWN_MAX_SPLINE_POINTS,
  PROCPLANT_CROWN_MAX_SPLINES,
  PROCPLANT_CROWN_MAX_TOTAL_SPLINE_POINTS,
  PROCPLANT_FREEFORM_CROWN_CONTRACT,
  PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
  PROCPLANT_FREEFORM_CROWN_VERSION,
  validateProcPlantFreeformCrown,
  type ProcPlantCrownSplinePoint,
  type ProcPlantCrownSplineVolume,
  type ProcPlantFreeformCrown,
  type ProcPlantFreeformCrownV2,
} from "./procplant-space-colonization";

export interface ProcPlantAddCrownSplineOptions {
  operation?: "add" | "subtract";
  center: readonly [number, number, number];
  dimensions: readonly [number, number, number];
}

export interface ProcPlantCrownSplinePointUpdate {
  position?: readonly [number, number, number];
  radius?: number;
}

const nextOrdinal = (ids: readonly string[], prefix: string) => {
  let maximum = 0;
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum + 1;
};

const asV2 = (field: ProcPlantFreeformCrown | null): ProcPlantFreeformCrownV2 => {
  if (!field) return {
    contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
    version: PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
    volumes: [],
    splines: [],
  };
  const cloned = cloneProcPlantFreeformCrown(field);
  return cloned.version === PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION
    ? cloned
    : {
        contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
        version: PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
        volumes: cloned.volumes,
        splines: [],
      };
};

const cloneSpline = (spline: ProcPlantCrownSplineVolume): ProcPlantCrownSplineVolume => ({
  id: spline.id,
  ...(spline.operation === undefined ? {} : { operation: spline.operation }),
  points: spline.points.map((point) => ({
    id: point.id,
    position: [...point.position] as [number, number, number],
    radius: point.radius,
  })),
  ...(spline.weight === undefined ? {} : { weight: spline.weight }),
});

const withSplines = (
  field: ProcPlantFreeformCrownV2,
  splines: readonly ProcPlantCrownSplineVolume[],
): ProcPlantFreeformCrownV2 => cloneProcPlantFreeformCrown({
  contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
  version: PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
  volumes: field.volumes,
  splines,
}) as ProcPlantFreeformCrownV2;

export const addProcPlantCrownSpline = (
  source: ProcPlantFreeformCrown | null,
  options: ProcPlantAddCrownSplineOptions,
): ProcPlantFreeformCrownV2 => {
  const field = asV2(source);
  if (field.splines.length >= PROCPLANT_CROWN_MAX_SPLINES) {
    throw new Error(`freeform crown spline cap exceeded (${PROCPLANT_CROWN_MAX_SPLINES})`);
  }
  const totalPoints = field.splines.reduce((sum, spline) => sum + spline.points.length, 0);
  if (totalPoints + 3 > PROCPLANT_CROWN_MAX_TOTAL_SPLINE_POINTS) {
    throw new Error(`freeform crown total spline-point cap exceeded (${PROCPLANT_CROWN_MAX_TOTAL_SPLINE_POINTS})`);
  }
  if (![...options.center, ...options.dimensions].every(Number.isFinite) || options.dimensions.some((value) => value <= 0)) {
    throw new Error("crown spline defaults require finite center and positive dimensions");
  }
  const ordinal = nextOrdinal(field.splines.map((spline) => spline.id), "spline-");
  const id = `spline-${ordinal}`;
  const radius = Math.max(0.02, Math.min(...options.dimensions) * 0.24);
  const points: ProcPlantCrownSplinePoint[] = [
    { id: `${id}-point-1`, position: [options.center[0] - options.dimensions[0] * 0.38, options.center[1], options.center[2]], radius },
    { id: `${id}-point-2`, position: [options.center[0], options.center[1] + options.dimensions[1] * 0.22, options.center[2] + options.dimensions[2] * 0.12], radius: radius * 1.12 },
    { id: `${id}-point-3`, position: [options.center[0] + options.dimensions[0] * 0.38, options.center[1], options.center[2]], radius },
  ];
  const spline: ProcPlantCrownSplineVolume = {
    id,
    ...(options.operation === "subtract" ? { operation: "subtract" as const } : {}),
    points,
  };
  const splines = [...field.splines.map(cloneSpline), spline];
  if (options.operation === "subtract" &&
    field.volumes.every((volume) => volume.operation === "subtract") &&
    field.splines.every((entry) => entry.operation === "subtract")) {
    throw new Error("a subtractive spline requires an existing additive crown source");
  }
  return withSplines(field, splines);
};

export const addProcPlantCrownSplinePoint = (
  source: ProcPlantFreeformCrown,
  splineId: string,
): ProcPlantFreeformCrownV2 => {
  const field = asV2(source);
  const spline = field.splines.find((entry) => entry.id === splineId);
  if (!spline) throw new Error(`unknown crown spline ${splineId}`);
  if (spline.points.length >= PROCPLANT_CROWN_MAX_SPLINE_POINTS) {
    throw new Error(`crown spline point cap exceeded (${PROCPLANT_CROWN_MAX_SPLINE_POINTS})`);
  }
  const totalPoints = field.splines.reduce((sum, entry) => sum + entry.points.length, 0);
  if (totalPoints >= PROCPLANT_CROWN_MAX_TOTAL_SPLINE_POINTS) {
    throw new Error(`freeform crown total spline-point cap exceeded (${PROCPLANT_CROWN_MAX_TOTAL_SPLINE_POINTS})`);
  }
  const ordinal = nextOrdinal(spline.points.map((point) => point.id), `${spline.id}-point-`);
  const last = spline.points[spline.points.length - 1]!;
  const previous = spline.points[spline.points.length - 2]!;
  const position: [number, number, number] = [
    last.position[0] + (last.position[0] - previous.position[0]),
    last.position[1] + (last.position[1] - previous.position[1]),
    last.position[2] + (last.position[2] - previous.position[2]),
  ];
  const nextSpline = cloneSpline({
    ...spline,
    points: [...spline.points, { id: `${spline.id}-point-${ordinal}`, position, radius: last.radius }],
  });
  return withSplines(field, field.splines.map((entry) => entry.id === splineId ? nextSpline : cloneSpline(entry)));
};

export const updateProcPlantCrownSplinePoint = (
  source: ProcPlantFreeformCrown,
  splineId: string,
  pointId: string,
  update: ProcPlantCrownSplinePointUpdate,
): ProcPlantFreeformCrownV2 => {
  const field = asV2(source);
  let found = false;
  const splines = field.splines.map((spline) => {
    if (spline.id !== splineId) return cloneSpline(spline);
    const points = spline.points.map((point) => {
      if (point.id !== pointId) return { ...point, position: [...point.position] as [number, number, number] };
      found = true;
      return {
        id: point.id,
        position: update.position === undefined ? [...point.position] as [number, number, number] : [...update.position] as [number, number, number],
        radius: update.radius ?? point.radius,
      };
    });
    return cloneSpline({ ...spline, points });
  });
  if (!found) throw new Error(`unknown crown spline point ${splineId}/${pointId}`);
  return withSplines(field, splines);
};

export const removeProcPlantCrownSplinePoint = (
  source: ProcPlantFreeformCrown,
  splineId: string,
  pointId: string,
): ProcPlantFreeformCrownV2 => {
  const field = asV2(source);
  const spline = field.splines.find((entry) => entry.id === splineId);
  if (!spline || !spline.points.some((point) => point.id === pointId)) {
    throw new Error(`unknown crown spline point ${splineId}/${pointId}`);
  }
  if (spline.points.length <= 2) throw new Error("a crown spline requires at least two points");
  const nextSpline = cloneSpline({ ...spline, points: spline.points.filter((point) => point.id !== pointId) });
  return withSplines(field, field.splines.map((entry) => entry.id === splineId ? nextSpline : cloneSpline(entry)));
};

export const removeProcPlantCrownSpline = (
  source: ProcPlantFreeformCrown,
  splineId: string,
): ProcPlantFreeformCrown | null => {
  const field = asV2(source);
  if (!field.splines.some((spline) => spline.id === splineId)) throw new Error(`unknown crown spline ${splineId}`);
  const splines = field.splines.filter((spline) => spline.id !== splineId).map(cloneSpline);
  if (splines.length > 0) return withSplines(field, splines);
  const additiveVolumes = field.volumes.filter((volume) => volume.operation !== "subtract");
  if (additiveVolumes.length === 0) return null;
  const downgraded: ProcPlantFreeformCrown = {
    contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
    version: PROCPLANT_FREEFORM_CROWN_VERSION,
    volumes: field.volumes,
  };
  validateProcPlantFreeformCrown(downgraded);
  return cloneProcPlantFreeformCrown(downgraded);
};
