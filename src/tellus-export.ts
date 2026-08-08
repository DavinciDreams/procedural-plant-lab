import {
  buildProcPlantRuntimePackage,
  procPlantPresets,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantRuntimePackage,
} from "./procplants";
import {
  genomeForMixEntry,
  type ProcPlantBiomeMixDefinition,
  type ProcPlantBiomeMixEntry,
} from "./biome-mix";
import { inspectProcPlantReadiness, type ProcPlantReadinessReport } from "./plant-readiness";
import { applyProcPlantVariant, type ProcPlantVariantSpec } from "./plant-variants";
import type { SavedProcPlantPreset } from "./saved-presets";
import { PROCPLANT_GENERATOR_CONTRACT_REVISION } from "./procplant-contract";

export const TELLUS_PROCPLANT_PACKAGE_CONTRACT = "tellus.procplants.package.v1" as const;

export interface TellusProcPlantExportEntry {
  id: string;
  label: string;
  source: ProcPlantBiomeMixEntry["source"];
  presetId?: string;
  genome?: ProcPlantGenome;
  asset?: ProcPlantBiomeMixEntry["asset"];
  ezTree?: ProcPlantBiomeMixEntry["ezTree"];
  weight: number;
  density: number;
  scale: number;
  grassHeight?: number;
  grassSpread?: number;
  grassLean?: number;
  environment: ProcPlantEnvironment;
  seed: number;
  enabled: boolean;
}

/** Shape accepted by Tellus's current version-1 biome mix normalizer. */
export interface TellusProcPlantBiomeMix {
  version: 1;
  id: string;
  label: string;
  source: "ecology" | "terrain-paint" | "custom";
  ecologyBiome?: ProcPlantBiomeMixDefinition["ecologyBiome"];
  terrainPaint?: string;
  targetTerrainPaint?: string;
  seed: number;
  density: number;
  diversity: number;
  targetVerticesPerChunk: number;
  entries: TellusProcPlantExportEntry[];
}

export interface TellusProcPlantCatalogEntry {
  id: string;
  label: string;
  seed: number;
  environment: ProcPlantEnvironment;
  genome: ProcPlantGenome;
  runtime: ProcPlantRuntimePackage;
  readiness: ProcPlantReadinessReport;
  variant?: ProcPlantVariantSpec;
}

export interface TellusProcPlantPackage {
  contract: typeof TELLUS_PROCPLANT_PACKAGE_CONTRACT;
  version: 1;
  generatorContractRevision: typeof PROCPLANT_GENERATOR_CONTRACT_REVISION;
  deterministic: true;
  mix: TellusProcPlantBiomeMix;
  catalog: TellusProcPlantCatalogEntry[];
}

export interface PersistedTellusProcPlantRegistryV2 {
  version: 2;
  worldId: string;
  updatedAt: string;
  mixes: TellusProcPlantBiomeMix[];
  terrainPaintMixIndexes: Record<string, number>;
  ecologyBiomeMixIndexes: Partial<Record<NonNullable<ProcPlantBiomeMixDefinition["ecologyBiome"]>, number>>;
}

const clone = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;

const proceduralEntry = (entry: ProcPlantBiomeMixEntry): boolean =>
  entry.source !== "asset" && entry.source !== "ez-tree";

const exportEntry = (entry: ProcPlantBiomeMixEntry): TellusProcPlantExportEntry => {
  const genome = proceduralEntry(entry) ? clone(genomeForMixEntry(entry)) : undefined;
  return {
    id: entry.id,
    label: entry.label,
    source: entry.source,
    presetId: entry.presetId,
    genome,
    asset: entry.asset ? clone(entry.asset) : undefined,
    ezTree: entry.ezTree ? clone(entry.ezTree) : undefined,
    weight: entry.weight,
    density: entry.density,
    scale: entry.scale,
    grassHeight: entry.grassHeight,
    grassSpread: entry.grassSpread,
    grassLean: entry.grassLean,
    environment: clone(entry.environment),
    seed: entry.seed >>> 0,
    enabled: entry.enabled,
  };
};

export const toTellusProcPlantBiomeMix = (
  mix: ProcPlantBiomeMixDefinition,
): TellusProcPlantBiomeMix => ({
  version: 1,
  id: mix.id,
  label: mix.label,
  source: mix.source,
  ecologyBiome: mix.ecologyBiome,
  terrainPaint: mix.terrainPaint,
  targetTerrainPaint: mix.targetTerrainPaint,
  seed: mix.seed >>> 0,
  density: mix.density,
  diversity: mix.diversity,
  targetVerticesPerChunk: mix.targetVerticesPerChunk,
  entries: mix.entries.map(exportEntry),
});

/** Build the current Tellus/Hyades registry payload; the caller owns its server timestamp. */
export const toPersistedTellusProcPlantRegistryV2 = (
  worldId: string,
  mixes: readonly ProcPlantBiomeMixDefinition[],
  updatedAt: string,
): PersistedTellusProcPlantRegistryV2 => {
  const exported = mixes.map(toTellusProcPlantBiomeMix);
  const terrainPaintMixIndexes: Record<string, number> = {};
  const ecologyBiomeMixIndexes: PersistedTellusProcPlantRegistryV2["ecologyBiomeMixIndexes"] = {};
  exported.forEach((mix, index) => {
    const paint = mix.targetTerrainPaint ?? mix.terrainPaint;
    if (paint) terrainPaintMixIndexes[paint] = index;
    if (mix.ecologyBiome) ecologyBiomeMixIndexes[mix.ecologyBiome] = index;
  });
  return {
    version: 2,
    worldId,
    updatedAt,
    mixes: exported,
    terrainPaintMixIndexes,
    ecologyBiomeMixIndexes,
  };
};

const compileCatalogEntry = (
  id: string,
  label: string,
  genome: ProcPlantGenome,
  seed: number,
  environment: ProcPlantEnvironment,
  variant?: ProcPlantVariantSpec,
): TellusProcPlantCatalogEntry => ({
  id,
  label,
  seed: seed >>> 0,
  environment: clone(environment),
  genome: clone(genome),
  runtime: buildProcPlantRuntimePackage(genome, seed, environment),
  readiness: inspectProcPlantReadiness(genome, seed, environment, "tellus-realtime"),
  variant,
});

/**
 * Compile the active biome plus saved presets into a deterministic package.
 * No timestamps or local-storage ordering are included, so identical inputs
 * stringify identically and can be content-addressed by Tellus/Hyades.
 */
export const buildTellusProcPlantPackage = (
  mix: ProcPlantBiomeMixDefinition,
  savedPresets: readonly SavedProcPlantPreset[] = [],
): TellusProcPlantPackage => {
  const catalog = new Map<string, TellusProcPlantCatalogEntry>();
  for (const entry of [...mix.entries].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!entry.enabled || !proceduralEntry(entry)) continue;
    const genome = genomeForMixEntry(entry);
    catalog.set(
      `mix:${entry.id}`,
      compileCatalogEntry(`mix:${entry.id}`, entry.label, genome, entry.seed, entry.environment),
    );
  }

  for (const saved of [...savedPresets].sort((a, b) => a.id.localeCompare(b.id))) {
    const fallbackEnvironment = mix.entries.find((entry) => entry.enabled)?.environment;
    if (!fallbackEnvironment) continue;
    const seed = (mix.seed ^ saved.id.length ^ 0x9e3779b9) >>> 0;
    const baseGenome = procPlantPresets[saved.id] ?? saved.genome;
    catalog.set(
      `saved:${saved.id}`,
      compileCatalogEntry(`saved:${saved.id}`, saved.label, baseGenome, seed, fallbackEnvironment),
    );
    for (const variant of saved.variants ?? []) {
      const genome = applyProcPlantVariant(baseGenome, variant);
      const key = `saved:${saved.id}:${genome.id}`;
      catalog.set(key, compileCatalogEntry(key, `${saved.label} (${variant.season})`, genome, seed, fallbackEnvironment, variant));
    }
  }

  return {
    contract: TELLUS_PROCPLANT_PACKAGE_CONTRACT,
    version: 1,
    generatorContractRevision: PROCPLANT_GENERATOR_CONTRACT_REVISION,
    deterministic: true,
    mix: toTellusProcPlantBiomeMix(mix),
    catalog: [...catalog.values()],
  };
};
