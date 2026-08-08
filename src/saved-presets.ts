import {
  procPlantPresetIds,
  procPlantPresets,
  type ProcPlantGenome,
} from "./procplants";
import type { ProcPlantVariantSpec } from "./plant-variants";

const STORAGE_KEY = "procplants.savedPresets.v1";

export interface SavedProcPlantPreset {
  id: string;
  label: string;
  genome: ProcPlantGenome;
  variants?: ProcPlantVariantSpec[];
  createdAt: string;
  updatedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const cloneGenome = (genome: ProcPlantGenome): ProcPlantGenome =>
  typeof structuredClone === "function"
    ? structuredClone(genome)
    : JSON.parse(JSON.stringify(genome)) as ProcPlantGenome;

const slug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "preset";

export const procPlantBuiltinPresetLabels: Readonly<Record<string, string>> = Object.freeze({
  maidenhairFernPatch: "Maidenhair Fern Patch",
  woodlandVioletCarpet: "Woodland Violet Carpet",
  trilliumPatch: "Trillium Patch",
  horsetailColony: "Horsetail Colony",
});

export const labelForPresetId = (id: string): string =>
  procPlantBuiltinPresetLabels[id] ?? id
    .replace(/^custom-/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const loadSavedProcPlantPresets = (): SavedProcPlantPreset[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedProcPlantPreset =>
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.label === "string" &&
      isRecord(item.genome) &&
      typeof item.createdAt === "string" &&
      typeof item.updatedAt === "string",
    );
  } catch {
    return [];
  }
};

const writeSavedProcPlantPresets = (items: SavedProcPlantPreset[]) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items, null, 2));
};

export const installSavedProcPlantPresets = (): SavedProcPlantPreset[] => {
  const saved = loadSavedProcPlantPresets();
  for (const preset of saved) {
    procPlantPresets[preset.id] = cloneGenome({ ...preset.genome, id: preset.id });
  }
  return saved;
};

export const allProcPlantPresetIds = (): string[] => {
  const savedIds = loadSavedProcPlantPresets().map((preset) => preset.id);
  return [...procPlantPresetIds, ...savedIds.filter((id) => !procPlantPresetIds.includes(id))];
};

export const saveProcPlantPreset = (
  label: string,
  genome: ProcPlantGenome,
  preferredId?: string,
  variants?: ProcPlantVariantSpec[],
): SavedProcPlantPreset => {
  const saved = loadSavedProcPlantPresets();
  const existingIds = new Set([...procPlantPresetIds, ...saved.map((preset) => preset.id)]);
  const base = slug(preferredId ?? label);
  let id = base.startsWith("custom-") ? base : `custom-${base}`;
  if (!preferredId || existingIds.has(id)) {
    const root = id;
    let suffix = 2;
    while (existingIds.has(id)) {
      id = `${root}-${suffix}`;
      suffix += 1;
    }
  }
  const now = new Date().toISOString();
  const preset: SavedProcPlantPreset = {
    id,
    label: label.trim() || labelForPresetId(id),
    genome: cloneGenome({ ...genome, id }),
    variants: variants?.map((variant) => ({ ...variant })),
    createdAt: now,
    updatedAt: now,
  };
  const next = [...saved, preset];
  writeSavedProcPlantPresets(next);
  procPlantPresets[id] = cloneGenome(preset.genome);
  return preset;
};

export const savedPresetLabelMap = (): Record<string, string> =>
  Object.fromEntries(loadSavedProcPlantPresets().map((preset) => [preset.id, preset.label]));
