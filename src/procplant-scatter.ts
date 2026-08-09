import {
  genomeForMixEntry,
  type ProcPlantBiomeMixDefinition,
  type ProcPlantBiomeMixEntry,
} from "./biome-mix";
import type { ProcPlantHabit } from "./procplants";

export const PROCPLANT_SCATTER_CONTRACT = "procplants.ecosystem-scatter" as const;
export const PROCPLANT_SCATTER_VERSION = 1 as const;

export interface ProcPlantScatterBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ProcPlantScatterContext {
  x: number;
  z: number;
  normalizedX: number;
  normalizedZ: number;
}

export interface ProcPlantScatterOptions {
  bounds: ProcPlantScatterBounds;
  maxPlacements?: number;
  maxCandidates?: number;
  densityScale?: number;
  densityAt?: (context: ProcPlantScatterContext) => number;
  heightAt?: (context: ProcPlantScatterContext) => number;
  entryDensityAt?: (entry: ProcPlantBiomeMixEntry, context: ProcPlantScatterContext) => number;
  spacingScale?: number;
  scaleVariation?: number;
}

export interface ProcPlantScatterPlacement {
  id: string;
  index: number;
  entryId: string;
  presetId?: string;
  seed: number;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  spacing: number;
  densitySample: number;
}

export interface ProcPlantScatterPlan {
  contract: typeof PROCPLANT_SCATTER_CONTRACT;
  version: typeof PROCPLANT_SCATTER_VERSION;
  mixId: string;
  seed: number;
  bounds: ProcPlantScatterBounds;
  candidates: number;
  rejectedByDensity: number;
  rejectedBySpacing: number;
  placements: ProcPlantScatterPlacement[];
  countsByEntry: Record<string, number>;
}

const SPACING_BY_HABIT: Readonly<Record<ProcPlantHabit, number>> = {
  grass: 0.12,
  fern: 0.26,
  flower: 0.22,
  tropical: 0.65,
  shrub: 0.72,
  vine: 0.28,
  moss: 0.12,
  tree: 2.2,
  conifer: 1.9,
  palm: 1.65,
};

const rngFromSeed = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, finite(value, "density sample")));

const stableEntries = (mix: ProcPlantBiomeMixDefinition) => mix.entries
  .filter((entry) => entry.enabled && entry.weight > 0 && entry.density > 0 && entry.source !== "asset")
  .slice()
  .sort((a, b) => a.id.localeCompare(b.id));

const chooseEntry = (
  entries: readonly ProcPlantBiomeMixEntry[],
  context: ProcPlantScatterContext,
  entryDensityAt: ProcPlantScatterOptions["entryDensityAt"],
  random: number,
) => {
  const weights = entries.map((entry) => Math.max(0, entry.weight * entry.density * clamp01(entryDensityAt?.(entry, context) ?? 1)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  let cursor = random * total;
  for (let index = 0; index < entries.length; index++) {
    cursor -= weights[index]!;
    if (cursor <= 0) return entries[index]!;
  }
  return entries.at(-1)!;
};

const placementSeed = (mixSeed: number, index: number, entryId: string) => {
  let hash = (mixSeed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  for (let i = 0; i < entryId.length; i++) hash = Math.imul(hash ^ entryId.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
};

/** Build a deterministic, JSON-safe biome placement plan without allocating render objects. */
export const createProcPlantScatterPlan = (
  mix: ProcPlantBiomeMixDefinition,
  options: ProcPlantScatterOptions,
): ProcPlantScatterPlan => {
  const bounds = { ...options.bounds };
  finite(bounds.minX, "bounds.minX");
  finite(bounds.maxX, "bounds.maxX");
  finite(bounds.minZ, "bounds.minZ");
  finite(bounds.maxZ, "bounds.maxZ");
  if (bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ) throw new Error("scatter bounds must have positive area");
  const entries = stableEntries(mix);
  if (entries.length === 0) throw new Error("scatter mix has no enabled procedural entries");
  const maxPlacements = Math.max(1, Math.min(100_000, Math.round(options.maxPlacements ?? 2_000)));
  const maxCandidates = Math.max(maxPlacements, Math.min(2_000_000, Math.round(options.maxCandidates ?? maxPlacements * 20)));
  const densityScale = Math.max(0, finite(options.densityScale ?? 1, "densityScale"));
  const spacingScale = Math.max(0.01, finite(options.spacingScale ?? 1, "spacingScale"));
  const scaleVariation = Math.max(0, Math.min(0.95, finite(options.scaleVariation ?? mix.diversity * 0.28, "scaleVariation")));
  const random = rngFromSeed(mix.seed);
  const maximumSpacing = Math.max(...entries.map((entry) =>
    SPACING_BY_HABIT[genomeForMixEntry(entry).habit] * spacingScale / Math.sqrt(Math.max(0.05, entry.density)),
  ));
  const cellSize = Math.max(0.05, maximumSpacing);
  const grid = new Map<string, number[]>();
  const placements: ProcPlantScatterPlacement[] = [];
  const countsByEntry: Record<string, number> = {};
  let rejectedByDensity = 0;
  let rejectedBySpacing = 0;
  let candidates = 0;

  while (candidates < maxCandidates && placements.length < maxPlacements) {
    candidates++;
    const normalizedX = random();
    const normalizedZ = random();
    const x = bounds.minX + (bounds.maxX - bounds.minX) * normalizedX;
    const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * normalizedZ;
    const context = { x, z, normalizedX, normalizedZ };
    const densitySample = clamp01(options.densityAt?.(context) ?? 1);
    if (random() > Math.min(1, densitySample * mix.density * densityScale)) {
      rejectedByDensity++;
      continue;
    }
    const entry = chooseEntry(entries, context, options.entryDensityAt, random());
    if (!entry) {
      rejectedByDensity++;
      continue;
    }
    const genome = genomeForMixEntry(entry);
    const spacing = SPACING_BY_HABIT[genome.habit] * spacingScale / Math.sqrt(Math.max(0.05, entry.density));
    const cellX = Math.floor((x - bounds.minX) / cellSize);
    const cellZ = Math.floor((z - bounds.minZ) / cellSize);
    let blocked = false;
    for (let dz = -1; dz <= 1 && !blocked; dz++) {
      for (let dx = -1; dx <= 1 && !blocked; dx++) {
        const neighbors = grid.get(`${cellX + dx}:${cellZ + dz}`) ?? [];
        for (const placementIndex of neighbors) {
          const other = placements[placementIndex]!;
          const required = Math.sqrt(spacing * other.spacing);
          if (Math.hypot(x - other.position[0], z - other.position[2]) < required) {
            blocked = true;
            break;
          }
        }
      }
    }
    if (blocked) {
      rejectedBySpacing++;
      continue;
    }
    const index = placements.length;
    const variation = 1 + (random() * 2 - 1) * scaleVariation;
    const seed = placementSeed(mix.seed, index, entry.id);
    const placement: ProcPlantScatterPlacement = {
      id: `${entry.id}:${index.toString().padStart(6, "0")}`,
      index,
      entryId: entry.id,
      ...(entry.presetId ? { presetId: entry.presetId } : {}),
      seed,
      position: [x, finite(options.heightAt?.(context) ?? 0, "height sample"), z],
      rotationY: random() * Math.PI * 2,
      scale: entry.scale * variation,
      spacing,
      densitySample,
    };
    placements.push(placement);
    const cellKey = `${cellX}:${cellZ}`;
    const cell = grid.get(cellKey) ?? [];
    cell.push(index);
    grid.set(cellKey, cell);
    countsByEntry[entry.id] = (countsByEntry[entry.id] ?? 0) + 1;
  }

  return {
    contract: PROCPLANT_SCATTER_CONTRACT,
    version: PROCPLANT_SCATTER_VERSION,
    mixId: mix.id,
    seed: mix.seed >>> 0,
    bounds,
    candidates,
    rejectedByDensity,
    rejectedBySpacing,
    placements,
    countsByEntry: Object.fromEntries(Object.entries(countsByEntry).sort(([a], [b]) => a.localeCompare(b))),
  };
};
