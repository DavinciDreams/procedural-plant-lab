import {
  defaultPlantEnvironment,
  procPlantPresets,
  resolveProcPlantCommunity,
  type ProcPlantBiomeId,
  type ProcPlantEcologySample,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantSubstrateKind,
} from "./procplants";

export type ProcPlantBiomeMixSource = "ecology" | "custom";

export interface ProcPlantBiomeMixEntry {
  id: string;
  label: string;
  source: "preset" | "mutation" | "asset" | "ez-tree";
  presetId?: string;
  genome?: ProcPlantGenome;
  ezTree?: {
    preset: string;
    kind: "pine" | "oak" | "aspen" | "ash" | "willow" | "bush";
    barkColor?: number;
    leafColor?: number;
    foliage?: number;
    spread?: number;
    droop?: number;
    gnarliness?: number;
    textures?: boolean;
  };
  asset?: {
    kind: "glb";
    name: string;
    libraryId?: string;
    color?: number;
    runtimeOnly?: boolean;
  };
  weight: number;
  density: number;
  scale: number;
  environment: ProcPlantEnvironment;
  seed: number;
  enabled: boolean;
}

export interface ProcPlantBiomeMixDefinition {
  version: 1;
  id: string;
  label: string;
  source: ProcPlantBiomeMixSource;
  ecologyBiome?: ProcPlantBiomeId;
  substrate?: ProcPlantSubstrateKind;
  seed: number;
  density: number;
  diversity: number;
  targetVerticesPerChunk: number;
  sample: ProcPlantEcologySample;
  entries: ProcPlantBiomeMixEntry[];
}

export interface ProcPlantLabExport {
  version?: number;
  savedAt?: string;
  state?: {
    primary?: string;
    secondary?: string;
    hybrid?: number;
    seed?: number;
    density?: number;
    light?: number;
    moisture?: number;
    crowding?: number;
    warmth?: number;
  };
  genome?: ProcPlantGenome;
}

export const PROCPLANT_BIOME_OPTIONS: ProcPlantBiomeId[] = [
  "tropical-rain-forest",
  "temperate-rain-forest",
  "desert",
  "tundra",
  "taiga",
  "grassland",
  "savanna",
  "estuary",
  "coastal",
  "arctic-alpine",
];

export const PROCPLANT_SUBSTRATE_BY_BIOME: Record<ProcPlantBiomeId, ProcPlantSubstrateKind> = {
  "tropical-rain-forest": "loam",
  "temperate-rain-forest": "peat",
  desert: "sand",
  tundra: "silt",
  taiga: "granite",
  grassland: "loam",
  savanna: "clay",
  estuary: "silt",
  coastal: "sand",
  "arctic-alpine": "granite",
};

const biomeClimate: Record<ProcPlantBiomeId, Pick<ProcPlantEcologySample, "warmth" | "moisture" | "seasonality" | "salinity" | "wind" | "light" | "elevation" | "slope">> = {
  "tropical-rain-forest": { warmth: 0.92, moisture: 0.9, seasonality: 0.22, salinity: 0.04, wind: 0.22, light: 0.58, elevation: 0.18, slope: 0.18 },
  "temperate-rain-forest": { warmth: 0.58, moisture: 0.86, seasonality: 0.62, salinity: 0.05, wind: 0.28, light: 0.62, elevation: 0.22, slope: 0.22 },
  desert: { warmth: 0.86, moisture: 0.12, seasonality: 0.74, salinity: 0.12, wind: 0.58, light: 0.95, elevation: 0.36, slope: 0.2 },
  tundra: { warmth: 0.16, moisture: 0.42, seasonality: 0.9, salinity: 0.06, wind: 0.72, light: 0.72, elevation: 0.48, slope: 0.24 },
  taiga: { warmth: 0.28, moisture: 0.58, seasonality: 0.82, salinity: 0.03, wind: 0.42, light: 0.68, elevation: 0.42, slope: 0.26 },
  grassland: { warmth: 0.6, moisture: 0.46, seasonality: 0.7, salinity: 0.02, wind: 0.66, light: 0.88, elevation: 0.26, slope: 0.12 },
  savanna: { warmth: 0.82, moisture: 0.32, seasonality: 0.86, salinity: 0.03, wind: 0.54, light: 0.92, elevation: 0.3, slope: 0.12 },
  estuary: { warmth: 0.58, moisture: 0.94, seasonality: 0.44, salinity: 0.58, wind: 0.48, light: 0.76, elevation: 0.04, slope: 0.04 },
  coastal: { warmth: 0.68, moisture: 0.62, seasonality: 0.45, salinity: 0.42, wind: 0.76, light: 0.86, elevation: 0.06, slope: 0.08 },
  "arctic-alpine": { warmth: 0.08, moisture: 0.34, seasonality: 0.92, salinity: 0.02, wind: 0.86, light: 0.82, elevation: 0.84, slope: 0.56 },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const labelForProcPlantId = (id: string): string =>
  id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const slug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "biome";

export const ecologySampleForBiome = (biome: ProcPlantBiomeId): ProcPlantEcologySample => ({
  biome,
  substrate: PROCPLANT_SUBSTRATE_BY_BIOME[biome],
  ...biomeClimate[biome],
});

const environmentForSample = (sample: ProcPlantEcologySample): ProcPlantEnvironment => ({
  ...defaultPlantEnvironment(),
  light: sample.light,
  moisture: sample.moisture,
  crowding: Math.max(0.1, Math.min(0.9, 1 - sample.wind * 0.35 + sample.moisture * 0.18)),
  biomeWarmth: sample.warmth,
});

const scaleForGenome = (genome: ProcPlantGenome): number =>
  genome.habit === "tree" || genome.habit === "conifer" || genome.habit === "palm" ? 8 : 1;

export const genomeForMixEntry = (entry: ProcPlantBiomeMixEntry): ProcPlantGenome => {
  if (entry.genome) return entry.genome;
  if (entry.presetId && procPlantPresets[entry.presetId]) return procPlantPresets[entry.presetId];
  return procPlantPresets.furGrass;
};

export const isAssetMixEntry = (
  entry: ProcPlantBiomeMixEntry,
): entry is ProcPlantBiomeMixEntry & { asset: NonNullable<ProcPlantBiomeMixEntry["asset"]> } =>
  entry.source === "asset" && entry.asset?.kind === "glb";

export const makeEcologyBiomeMix = (
  biome: ProcPlantBiomeId,
  seed = 612072,
): ProcPlantBiomeMixDefinition => {
  const sample = ecologySampleForBiome(biome);
  const entries = resolveProcPlantCommunity(sample, 8).map((community, index): ProcPlantBiomeMixEntry => {
    const normalizedScore = Math.max(0.05, community.score);
    return {
      id: `${community.presetId}-${index + 1}`,
      label: labelForProcPlantId(community.presetId),
      source: "preset",
      presetId: community.presetId,
      weight: normalizedScore,
      density: Math.max(0.08, Math.min(1.2, normalizedScore * 4)),
      scale: scaleForGenome(community.genome),
      environment: environmentForSample(sample),
      seed: seed ^ ((index + 1) * 0x9e37),
      enabled: true,
    };
  });
  return {
    version: 1,
    id: `ecology-${slug(biome)}`,
    label: labelForProcPlantId(biome),
    source: "ecology",
    ecologyBiome: biome,
    substrate: sample.substrate,
    seed,
    density: 0.72,
    diversity: 0.82,
    targetVerticesPerChunk: 250000,
    sample,
    entries,
  };
};

const environmentFromExport = (payload: ProcPlantLabExport): ProcPlantEnvironment => ({
  ...defaultPlantEnvironment(),
  light: payload.state?.light ?? defaultPlantEnvironment().light,
  moisture: payload.state?.moisture ?? defaultPlantEnvironment().moisture,
  crowding: payload.state?.crowding ?? defaultPlantEnvironment().crowding,
  biomeWarmth: payload.state?.warmth ?? defaultPlantEnvironment().biomeWarmth,
});

export const entryFromProcPlantLabExport = (
  raw: unknown,
  filename = "procplant-mutation.json",
): ProcPlantBiomeMixEntry | null => {
  if (!isRecord(raw) || !isRecord(raw.genome)) return null;
  const payload = raw as ProcPlantLabExport;
  const genome = payload.genome as ProcPlantGenome;
  const seed = Math.max(1, Math.floor(payload.state?.seed ?? Date.now() % 0xffffffff));
  const id = slug(`${genome.id || filename}-${seed}`);
  return {
    id,
    label: labelForProcPlantId(genome.id || filename.replace(/\.json$/i, "")),
    source: "mutation",
    genome,
    weight: 1,
    density: Math.max(0.05, Math.min(1, payload.state?.density ?? 0.45)),
    scale: scaleForGenome(genome),
    environment: environmentFromExport(payload),
    seed,
    enabled: true,
  };
};

export const normalizeBiomeMixDefinition = (raw: unknown): ProcPlantBiomeMixDefinition | null => {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) return null;
  const fallbackSample = ecologySampleForBiome("grassland");
  const sample = isRecord(raw.sample)
    ? { ...fallbackSample, ...(raw.sample as Partial<ProcPlantEcologySample>) }
    : typeof raw.ecologyBiome === "string" && PROCPLANT_BIOME_OPTIONS.includes(raw.ecologyBiome as ProcPlantBiomeId)
      ? ecologySampleForBiome(raw.ecologyBiome as ProcPlantBiomeId)
      : fallbackSample;
  const entries = raw.entries
    .map((entry): ProcPlantBiomeMixEntry | null => {
      if (!isRecord(entry)) return null;
      const source = entry.source === "asset"
        ? "asset"
        : entry.source === "ez-tree"
          ? "ez-tree"
          : entry.source === "mutation"
            ? "mutation"
            : "preset";
      const presetId = typeof entry.presetId === "string" ? entry.presetId : undefined;
      const genome = isRecord(entry.genome) ? (entry.genome as unknown as ProcPlantGenome) : undefined;
      const ezTree = isRecord(entry.ezTree) && typeof entry.ezTree.preset === "string"
        ? {
          preset: entry.ezTree.preset,
          kind: (
            entry.ezTree.kind === "oak" ||
            entry.ezTree.kind === "aspen" ||
            entry.ezTree.kind === "ash" ||
            entry.ezTree.kind === "willow" ||
            entry.ezTree.kind === "bush"
              ? entry.ezTree.kind
              : "pine"
          ) as "pine" | "oak" | "aspen" | "ash" | "willow" | "bush",
          barkColor: typeof entry.ezTree.barkColor === "number" ? entry.ezTree.barkColor : undefined,
          leafColor: typeof entry.ezTree.leafColor === "number" ? entry.ezTree.leafColor : undefined,
          foliage: typeof entry.ezTree.foliage === "number" ? entry.ezTree.foliage : undefined,
          spread: typeof entry.ezTree.spread === "number" ? entry.ezTree.spread : undefined,
          droop: typeof entry.ezTree.droop === "number" ? entry.ezTree.droop : undefined,
          gnarliness: typeof entry.ezTree.gnarliness === "number" ? entry.ezTree.gnarliness : undefined,
          textures: entry.ezTree.textures !== false,
        }
        : undefined;
      const asset = isRecord(entry.asset) && entry.asset.kind === "glb" && typeof entry.asset.name === "string"
        ? {
          kind: "glb" as const,
          name: entry.asset.name,
          libraryId: typeof entry.asset.libraryId === "string" ? entry.asset.libraryId : undefined,
          color: typeof entry.asset.color === "number" ? entry.asset.color : undefined,
          runtimeOnly: entry.asset.runtimeOnly !== false,
        }
        : undefined;
      if (source === "asset" && !asset) return null;
      if (source === "ez-tree" && !ezTree) return null;
      if (source !== "asset" && source !== "ez-tree" && !genome && (!presetId || !procPlantPresets[presetId])) return null;
      return {
        id: typeof entry.id === "string" ? entry.id : slug(presetId ?? genome?.id ?? ezTree?.preset ?? "entry"),
        label: typeof entry.label === "string" ? entry.label : labelForProcPlantId(presetId ?? genome?.id ?? ezTree?.preset ?? "Plant"),
        source,
        presetId,
        genome,
        ezTree,
        asset,
        weight: typeof entry.weight === "number" ? entry.weight : 1,
        density: typeof entry.density === "number" ? entry.density : 0.45,
        scale: typeof entry.scale === "number" ? entry.scale : source === "ez-tree" ? 8 : genome ? scaleForGenome(genome) : 1,
        environment: isRecord(entry.environment)
          ? { ...defaultPlantEnvironment(), ...(entry.environment as Partial<ProcPlantEnvironment>) }
          : environmentForSample(sample),
        seed: typeof entry.seed === "number" ? entry.seed : 1,
        enabled: entry.enabled !== false,
      };
    })
    .filter((entry): entry is ProcPlantBiomeMixEntry => Boolean(entry));
  if (entries.length === 0) return null;
  const ecologyBiome = typeof raw.ecologyBiome === "string" && PROCPLANT_BIOME_OPTIONS.includes(raw.ecologyBiome as ProcPlantBiomeId)
    ? raw.ecologyBiome as ProcPlantBiomeId
    : sample.biome;
  return {
    version: 1,
    id: typeof raw.id === "string" ? raw.id : "custom-biome",
    label: typeof raw.label === "string" ? raw.label : "Custom Biome",
    source: raw.source === "ecology" ? "ecology" : "custom",
    ecologyBiome,
    substrate: sample.substrate,
    seed: typeof raw.seed === "number" ? raw.seed : 1,
    density: typeof raw.density === "number" ? raw.density : 0.65,
    diversity: typeof raw.diversity === "number" ? raw.diversity : 0.75,
    targetVerticesPerChunk: typeof raw.targetVerticesPerChunk === "number" ? raw.targetVerticesPerChunk : 250000,
    sample,
    entries,
  };
};
