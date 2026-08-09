import type { ProcPlantAttachmentAnchor, ProcPlantAttachmentKind } from "./procplants";

export const PROCPLANT_ORGAN_VARIANT_CONTRACT = "procplants.organ-variants" as const;
export const PROCPLANT_ORGAN_VARIANT_VERSION = 1 as const;
export const PROCPLANT_ORGAN_VARIANT_MAX_ATTACHMENTS = 500_000;

export type ProcPlantOrganVariantSeason = "spring" | "summer" | "autumn" | "winter";

export interface ProcPlantOrganVariantSpec {
  season: ProcPlantOrganVariantSeason;
  health: number;
  maturity: number;
  wetness: number;
  snowLoad: number;
  seed: number;
}

export interface ProcPlantOrganVariantState {
  attachmentId: string;
  kind: ProcPlantAttachmentKind;
  /** Stable normalized age after plant maturity and attachment position are applied. */
  age: number;
  health: number;
  maturity: number;
  visible: boolean;
  leafDropMask: number;
  blossomMask: number;
  reproductiveMaturityMask: number;
  wetnessMask: number;
  snowMask: number;
  seasonColorMix: number;
}

export interface ProcPlantOrganVariantPackage {
  contract: typeof PROCPLANT_ORGAN_VARIANT_CONTRACT;
  version: typeof PROCPLANT_ORGAN_VARIANT_VERSION;
  spec: ProcPlantOrganVariantSpec;
  states: ProcPlantOrganVariantState[];
  sourceAttachmentCount: number;
  visibleCount: number;
  fingerprint: string;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const random01 = (seed: number, id: string, channel: number) => {
  let state = (seed ^ fnv1a(id) ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x1_0000_0000;
};

const finiteUnit = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be in [0, 1]`);
  return value;
};

const normalizedSpec = (spec: ProcPlantOrganVariantSpec): ProcPlantOrganVariantSpec => {
  if (!(["spring", "summer", "autumn", "winter"] as const).includes(spec.season)) {
    throw new Error(`unsupported organ variant season: ${String(spec.season)}`);
  }
  if (!Number.isSafeInteger(spec.seed) || spec.seed < 0 || spec.seed > 0xffff_ffff) {
    throw new Error("organ variant seed must be a uint32");
  }
  return {
    season: spec.season,
    health: finiteUnit(spec.health, "organ variant health"),
    maturity: finiteUnit(spec.maturity, "organ variant maturity"),
    wetness: finiteUnit(spec.wetness, "organ variant wetness"),
    snowLoad: finiteUnit(spec.snowLoad, "organ variant snowLoad"),
    seed: spec.seed >>> 0,
  };
};

const isLeafLike = (kind: ProcPlantAttachmentKind) =>
  kind === "leaf" || kind === "leaf-site" || kind === "fernLeaflet" || kind === "grassBlade" ||
  kind === "coniferSpray" || kind === "palmFrond" || kind === "mossTuft";

const isFlower = (kind: ProcPlantAttachmentKind) => kind === "flower";
const isReproductive = (kind: ProcPlantAttachmentKind) =>
  kind === "flower" || kind === "fruit" || kind === "berry" || kind === "cone";

const seasonalLeafDrop = (season: ProcPlantOrganVariantSeason) => {
  if (season === "autumn") return 0.36;
  if (season === "winter") return 0.9;
  if (season === "spring") return 0.08;
  return 0.015;
};

const seasonalBlossom = (season: ProcPlantOrganVariantSeason) => {
  if (season === "spring") return 1;
  if (season === "summer") return 0.45;
  if (season === "autumn") return 0.08;
  return 0;
};

const seasonalReproductiveMaturity = (season: ProcPlantOrganVariantSeason) => {
  if (season === "spring") return 0.18;
  if (season === "summer") return 0.68;
  if (season === "autumn") return 1;
  return 0.12;
};

const fingerprintStates = (
  spec: ProcPlantOrganVariantSpec,
  states: readonly ProcPlantOrganVariantState[],
) => {
  let hash = fnv1a(`${PROCPLANT_ORGAN_VARIANT_CONTRACT}:${PROCPLANT_ORGAN_VARIANT_VERSION}:${spec.season}:${spec.health}:${spec.maturity}:${spec.wetness}:${spec.snowLoad}:${spec.seed}`);
  for (const state of states) {
    const fields = [
      state.attachmentId,
      state.kind,
      state.age.toFixed(6),
      state.health.toFixed(6),
      state.maturity.toFixed(6),
      state.visible ? "1" : "0",
      state.leafDropMask.toFixed(6),
      state.blossomMask.toFixed(6),
      state.reproductiveMaturityMask.toFixed(6),
      state.wetnessMask.toFixed(6),
      state.snowMask.toFixed(6),
      state.seasonColorMix.toFixed(6),
    ].join(":");
    hash = fnv1a(`${hash.toString(16)}:${fields}`);
  }
  return hash.toString(16).padStart(8, "0");
};

/**
 * Derive stable per-organ masks without mutating PlantIR. These are authoring
 * and shader/export inputs, not a calibrated phenology or physiology model.
 */
export const buildProcPlantOrganVariants = (
  attachments: readonly ProcPlantAttachmentAnchor[],
  inputSpec: ProcPlantOrganVariantSpec,
): ProcPlantOrganVariantPackage => {
  if (attachments.length > PROCPLANT_ORGAN_VARIANT_MAX_ATTACHMENTS) {
    throw new Error(`organ variant attachment cap exceeded (${PROCPLANT_ORGAN_VARIANT_MAX_ATTACHMENTS})`);
  }
  const spec = normalizedSpec(inputSpec);
  const ordered = [...attachments].sort((a, b) => a.id.localeCompare(b.id));
  for (let index = 0; index < ordered.length; index++) {
    const attachment = ordered[index]!;
    if (!attachment.id.trim()) throw new Error("organ variant attachment IDs must not be empty");
    if (index > 0 && attachment.id === ordered[index - 1]!.id) {
      throw new Error(`duplicate organ variant attachment ID: ${attachment.id}`);
    }
  }

  const states = ordered.map((attachment): ProcPlantOrganVariantState => {
    const ageNoise = random01(spec.seed, attachment.id, 0);
    const healthNoise = random01(spec.seed, attachment.id, 1);
    const visibilityNoise = random01(spec.seed, attachment.id, 2);
    const surfaceNoise = random01(spec.seed, attachment.id, 3);
    const axialT = clamp01(attachment.axialT);
    const depthYouth = clamp01(attachment.depth / 8);
    const age = clamp01(spec.maturity * (0.62 + axialT * 0.22 + ageNoise * 0.16) - depthYouth * 0.08);
    const health = clamp01(spec.health * (0.84 + healthNoise * 0.16));
    const maturity = smoothstep(0.12, 0.92, age) * health;
    const leafDropMask = isLeafLike(attachment.kind)
      ? clamp01(seasonalLeafDrop(spec.season) + (1 - health) * 0.48 + (1 - age) * 0.08)
      : 0;
    const blossomMask = isFlower(attachment.kind)
      ? clamp01(seasonalBlossom(spec.season) * smoothstep(0.28, 0.7, age) * health)
      : 0;
    const reproductiveMaturityMask = isReproductive(attachment.kind)
      ? clamp01(seasonalReproductiveMaturity(spec.season) * maturity)
      : 0;
    const visible = isLeafLike(attachment.kind)
      ? visibilityNoise >= leafDropMask
      : isFlower(attachment.kind)
        ? visibilityNoise < blossomMask
        : attachment.kind === "fruit" || attachment.kind === "berry" || attachment.kind === "cone"
          ? visibilityNoise < reproductiveMaturityMask
          : true;
    const wetnessMask = clamp01(spec.wetness * (0.72 + surfaceNoise * 0.28));
    const upwardExposure = clamp01(attachment.up.y * 0.5 + 0.5);
    const snowMask = clamp01(spec.snowLoad * upwardExposure * (0.7 + surfaceNoise * 0.3));
    const seasonColorMix = isLeafLike(attachment.kind)
      ? clamp01((spec.season === "autumn" ? 0.72 : spec.season === "winter" ? 0.45 : spec.season === "spring" ? 0.2 : 0) + (1 - health) * 0.35)
      : 0;
    return {
      attachmentId: attachment.id,
      kind: attachment.kind,
      age,
      health,
      maturity,
      visible,
      leafDropMask,
      blossomMask,
      reproductiveMaturityMask,
      wetnessMask,
      snowMask,
      seasonColorMix,
    };
  });
  return {
    contract: PROCPLANT_ORGAN_VARIANT_CONTRACT,
    version: PROCPLANT_ORGAN_VARIANT_VERSION,
    spec,
    states,
    sourceAttachmentCount: attachments.length,
    visibleCount: states.filter((state) => state.visible).length,
    fingerprint: fingerprintStates(spec, states),
  };
};
