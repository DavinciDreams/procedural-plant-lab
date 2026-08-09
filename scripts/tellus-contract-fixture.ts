import { createHash } from "node:crypto";
import {
  buildProcPlantInstancedParts,
  buildProcPlantRuntimePackage,
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantAttachmentAnchor,
  type ProcPlantTemplate,
} from "../src/procplants";
import { normalizeBiomeMixDefinition } from "../src/biome-mix";
import { PROCPLANT_GENERATOR_CONTRACT_REVISION } from "../src/procplant-contract";
import {
  partitionProcPlantTemplateSurfaces,
  PROCPLANT_SURFACE_BARK_STEM,
  PROCPLANT_SURFACE_ORGAN,
} from "../src/procplant-surface-partition";

export const TELLUS_GOLDEN_FIXTURE_SCHEMA = "procplants-tellus-golden-contract" as const;
export const TELLUS_GOLDEN_FIXTURE_VERSION = 2 as const;
export const TELLUS_GOLDEN_FIXTURE_SEED = 612_072;
export const TELLUS_GOLDEN_FIXTURE_PRESETS = [
  "phiFern",
  "blueSpruce",
  "cloverGroundcover",
  "weepingWillow",
] as const;

const FLOAT_PRECISION = 6;

const finiteNumber = (value: number) => {
  if (!Number.isFinite(value)) throw new Error(`Golden fixture cannot encode non-finite number: ${value}`);
  const rounded = Number(value.toFixed(FLOAT_PRECISION));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const canonicalValue = (value: unknown): unknown => {
  if (typeof value === "number") return finiteNumber(value);
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
};

export const canonicalFixtureJson = (value: unknown): string => JSON.stringify(canonicalValue(value));

export const hashFixtureValue = (value: unknown): string =>
  createHash("sha256").update(canonicalFixtureJson(value)).digest("hex");

const hashTemplate = (template: ProcPlantTemplate): string => {
  const hash = createHash("sha256");
  const updateFloatArray = (label: string, values: Float32Array) => {
    hash.update(`${label}:${values.length}:`);
    for (const value of values) hash.update(`${finiteNumber(value).toFixed(FLOAT_PRECISION)},`);
  };
  const updateIntegerArray = (label: string, values: Uint8Array | Uint32Array) => {
    hash.update(`${label}:${values.length}:`);
    for (const value of values) hash.update(`${value},`);
  };
  updateFloatArray("pos", template.pos);
  updateFloatArray("nrm", template.nrm);
  updateFloatArray("uv0", template.uv0);
  updateFloatArray("col", template.col);
  updateIntegerArray("tintable", template.tintable);
  updateFloatArray("sway", template.sway);
  updateIntegerArray("idx", template.idx);
  return hash.digest("hex");
};

const templateAttributeLengths = (template: ProcPlantTemplate) => ({
  pos: template.pos.length,
  nrm: template.nrm.length,
  uv0: template.uv0.length,
  col: template.col.length,
  tintable: template.tintable.length,
  sway: template.sway.length,
  idx: template.idx.length,
});

const summarizeSurfacePartition = (template: ProcPlantTemplate) => {
  const partition = partitionProcPlantTemplateSurfaces(template);
  const coveredIndices = Array.from(partition.rangeIndexCounts).reduce((sum, count) => sum + count, 0);
  const barkStemGroups = Array.from(partition.rangeSurfaceIds)
    .filter((surface) => surface === PROCPLANT_SURFACE_BARK_STEM).length;
  const organGroups = Array.from(partition.rangeSurfaceIds)
    .filter((surface) => surface === PROCPLANT_SURFACE_ORGAN).length;
  return {
    contract: partition.contract,
    version: partition.version,
    contentHash: partition.contentHash,
    sourceIndexHash: partition.sourceIndexHash,
    triangleCount: partition.triangleCount,
    indexCount: partition.indexCount,
    groups: {
      total: partition.rangeCount,
      barkStem: barkStemGroups,
      organ: organGroups,
    },
    triangles: {
      barkStem: partition.barkStemTriangles,
      organ: partition.organTriangles,
    },
    coverage: {
      indices: coveredIndices,
      triangles: partition.barkStemTriangles + partition.organTriangles,
      complete: coveredIndices === partition.indexCount &&
        partition.barkStemTriangles + partition.organTriangles === partition.triangleCount,
    },
  };
};

const vector = (value: { x: number; y: number; z: number }) =>
  [finiteNumber(value.x), finiteNumber(value.y), finiteNumber(value.z)] as [number, number, number];

const range = (values: ArrayLike<number>) => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (!Number.isFinite(value)) throw new Error(`Golden fixture encountered non-finite range value at ${index}`);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return values.length === 0
    ? { min: 0, max: 0 }
    : { min: finiteNumber(min), max: finiteNumber(max) };
};

const positionBounds = (positions: Float32Array | readonly ProcPlantAttachmentAnchor[]) => {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const include = (x: number, y: number, z: number) => {
    min[0] = Math.min(min[0]!, x);
    min[1] = Math.min(min[1]!, y);
    min[2] = Math.min(min[2]!, z);
    max[0] = Math.max(max[0]!, x);
    max[1] = Math.max(max[1]!, y);
    max[2] = Math.max(max[2]!, z);
  };
  if (positions instanceof Float32Array) {
    for (let index = 0; index < positions.length; index += 3) {
      include(positions[index]!, positions[index + 1]!, positions[index + 2]!);
    }
  } else {
    for (const attachment of positions) include(attachment.position.x, attachment.position.y, attachment.position.z);
  }
  if (min[0] === Number.POSITIVE_INFINITY) return { min: [0, 0, 0], max: [0, 0, 0] };
  return {
    min: min.map(finiteNumber) as [number, number, number],
    max: max.map(finiteNumber) as [number, number, number],
  };
};

const attachmentHashInput = (
  segmentRecords: ReturnType<typeof buildProcPlantInstancedParts>["graph"]["segmentRecords"],
  attachments: readonly ProcPlantAttachmentAnchor[],
) => ({
  segments: segmentRecords.map((segment) => ({
    id: segment.id,
    parentSegmentId: segment.parentSegmentId,
    startNodeIndex: segment.startNodeIndex,
    endNodeIndex: segment.endNodeIndex,
    depth: segment.depth,
    axialStart: finiteNumber(segment.axialStart),
    axialEnd: finiteNumber(segment.axialEnd),
  })),
  attachments: attachments.map((attachment) => ({
    id: attachment.id,
    parentSegmentId: attachment.parentSegmentId,
    axialT: finiteNumber(attachment.axialT),
    position: vector(attachment.position),
    tangent: vector(attachment.tangent),
    right: vector(attachment.right),
    up: vector(attachment.up),
    kind: attachment.kind,
    depth: attachment.depth,
    sway: finiteNumber(attachment.sway),
    organIndex: attachment.organIndex,
  })),
});

const summarizePreset = (presetId: typeof TELLUS_GOLDEN_FIXTURE_PRESETS[number]) => {
  const genome = procPlantPresets[presetId];
  if (!genome) throw new Error(`Missing golden fixture preset: ${presetId}`);
  const environment = defaultPlantEnvironment();
  const parts = buildProcPlantInstancedParts(genome, TELLUS_GOLDEN_FIXTURE_SEED, environment);
  const attachmentKinds = Object.fromEntries(
    [...new Set(parts.graph.attachments.map((attachment) => attachment.kind))]
      .sort()
      .map((kind) => [kind, parts.graph.attachments.filter((attachment) => attachment.kind === kind).length]),
  );
  const attachmentInput = attachmentHashInput(parts.graph.segmentRecords, parts.graph.attachments);
  const instanceCounts = Object.fromEntries(
    [...new Set(parts.instances.map((instance) => instance.kind))]
      .sort()
      .map((kind) => [kind, parts.instances.filter((instance) => instance.kind === kind).length]),
  );
  const lods = compileProcPlantLods(genome, TELLUS_GOLDEN_FIXTURE_SEED, environment).map((lod) => ({
    level: lod.level,
    label: lod.label,
    distance: finiteNumber(lod.distance),
    triangles: lod.template.idx.length / 3,
    vertices: lod.template.pos.length / 3,
    bounds: positionBounds(lod.template.pos),
    sway: range(lod.template.sway),
    attributeLengths: templateAttributeLengths(lod.template),
    surfacePartition: summarizeSurfacePartition(lod.template),
    geometryHash: hashTemplate(lod.template),
  }));
  const runtime = buildProcPlantRuntimePackage(genome, TELLUS_GOLDEN_FIXTURE_SEED, environment);
  const summary = {
    presetId,
    genome: {
      id: genome.id,
      habit: genome.habit,
      backend: genome.branchModules ? "branch-module-graph" : genome.weberPenn ? "weber-penn" : "procplant-graph",
      phyllotaxy: genome.phyllotaxy
        ? { ...genome.phyllotaxy }
        : { mode: "legacy-spiral", angle: finiteNumber(genome.phyllotaxisAngle) },
      hash: hashFixtureValue(genome),
    },
    attachmentIr: {
      segments: parts.graph.segmentRecords.length,
      attachments: parts.graph.attachments.length,
      parentedAttachments: parts.graph.attachments.filter((attachment) => attachment.parentSegmentId !== null).length,
      kinds: attachmentKinds,
      bounds: positionBounds(parts.graph.attachments),
      axialT: range(parts.graph.attachments.map((attachment) => attachment.axialT)),
      sway: range(parts.graph.attachments.map((attachment) => attachment.sway)),
      hash: hashFixtureValue(attachmentInput),
    },
    instances: {
      total: parts.instances.length,
      supportedKinds: Object.keys(instanceCounts),
      countsByKind: instanceCounts,
    },
    lodSelection: runtime.lodSelection,
    lods,
  };
  return { ...summary, hash: hashFixtureValue(summary) };
};

const normalizeAssetLodPreference = (input: unknown) => {
  const normalized = normalizeBiomeMixDefinition({
    version: 1,
    id: "tellus-golden-asset-lod",
    label: "Tellus Golden Asset LOD",
    source: "custom",
    seed: TELLUS_GOLDEN_FIXTURE_SEED,
    density: 1,
    diversity: 0,
    targetVerticesPerChunk: 1_000,
    entries: [{
      id: "asset-lod",
      label: "Asset LOD",
      source: "asset",
      asset: {
        kind: "glb",
        name: "tellus-golden.glb",
        lodPreference: input,
      },
      weight: 1,
      density: 1,
      scale: 1,
      environment: defaultPlantEnvironment(),
      seed: TELLUS_GOLDEN_FIXTURE_SEED,
      enabled: true,
    }],
  });
  if (!normalized?.entries[0]?.asset) throw new Error("Golden fixture asset LOD vector did not normalize");
  return normalized.entries[0].asset.lodPreference ?? null;
};

const assetLodNormalizationVectors = () => ({
  valid: {
    input: "game-optimized",
    normalized: normalizeAssetLodPreference("game-optimized"),
  },
  invalid: {
    input: "unsupported-lod",
    normalized: normalizeAssetLodPreference("unsupported-lod"),
  },
});

export const buildTellusGoldenContractFixture = () => {
  const body = {
    schema: TELLUS_GOLDEN_FIXTURE_SCHEMA,
    fixtureVersion: TELLUS_GOLDEN_FIXTURE_VERSION,
    generatorContractRevision: PROCPLANT_GENERATOR_CONTRACT_REVISION,
    floatPrecision: FLOAT_PRECISION,
    hashAlgorithms: {
      summary: "sha256-canonical-json-sorted-keys-floats-6dp",
      geometry: "sha256-template-pos-nrm-uv0-col-tintable-sway-idx-ordered-floats-6dp",
    },
    seed: TELLUS_GOLDEN_FIXTURE_SEED,
    environment: defaultPlantEnvironment(),
    biomeNormalization: {
      assetLodPreference: assetLodNormalizationVectors(),
    },
    presets: TELLUS_GOLDEN_FIXTURE_PRESETS.map(summarizePreset),
  };
  return { ...body, hash: hashFixtureValue(body) };
};

export const serializeTellusGoldenContractFixture = (fixture = buildTellusGoldenContractFixture()): string =>
  `${JSON.stringify(fixture, null, 2)}\n`;

export const firstTellusFixtureDrift = (expected: unknown, actual: unknown, path = "$"): string | null => {
  if (Object.is(expected, actual)) return null;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return `${path}.length`;
    for (let index = 0; index < expected.length; index++) {
      const drift = firstTellusFixtureDrift(expected[index], actual[index], `${path}[${index}]`);
      if (drift) return drift;
    }
    return null;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)])].sort();
    for (const key of keys) {
      if (!(key in expectedRecord) || !(key in actualRecord)) return `${path}.${key}`;
      const drift = firstTellusFixtureDrift(expectedRecord[key], actualRecord[key], `${path}.${key}`);
      if (drift) return drift;
    }
    return null;
  }
  return path;
};
