import * as THREE from "three";
import type { CurveGene, ProcPlantGenome } from "./procplants";

export type ProcPlantSeason = "spring" | "summer" | "autumn" | "winter";
export type ProcPlantHealthState = "thriving" | "healthy" | "stressed" | "dormant";

export interface ProcPlantVariantSpec {
  season: ProcPlantSeason;
  /** Normalized plant vigor. Zero is dormant/dead-looking; one is vigorous. */
  health: number;
  /** Normalized development from a young plant to the authored adult form. */
  maturity: number;
}

export const DEFAULT_PROCPLANT_VARIANT: Readonly<ProcPlantVariantSpec> = {
  season: "summer",
  health: 1,
  maturity: 1,
};

const cloneGenome = (genome: ProcPlantGenome): ProcPlantGenome =>
  typeof structuredClone === "function"
    ? structuredClone(genome)
    : JSON.parse(JSON.stringify(genome)) as ProcPlantGenome;

const scaleCurve = (curve: CurveGene, multiplier: number): CurveGene => ({
  ...curve,
  base: curve.base * multiplier,
  tip: curve.tip * multiplier,
});

const mixColor = (source: number, target: number, amount: number): number =>
  new THREE.Color(source).lerp(new THREE.Color(target), THREE.MathUtils.clamp(amount, 0, 1)).getHex();

const seasonTraits = (season: ProcPlantSeason, evergreen: boolean) => {
  switch (season) {
    case "spring":
      return { leafMass: 0.78, flowerMass: 1.15, color: 0x9fcb5b, colorMix: 0.25 };
    case "autumn":
      return evergreen
        ? { leafMass: 0.9, flowerMass: 0.18, color: 0x546b35, colorMix: 0.18 }
        : { leafMass: 0.64, flowerMass: 0.12, color: 0xc46b2f, colorMix: 0.72 };
    case "winter":
      return evergreen
        ? { leafMass: 0.78, flowerMass: 0.03, color: 0x355743, colorMix: 0.3 }
        : { leafMass: 0.07, flowerMass: 0, color: 0x6f5a3d, colorMix: 0.82 };
    default:
      return { leafMass: 1, flowerMass: 1, color: 0x5d913c, colorMix: 0 };
  }
};

const reproductiveMassForSeason = (season: ProcPlantSeason) => {
  if (season === "spring") return 0.12;
  if (season === "summer") return 0.72;
  if (season === "autumn") return 1;
  return 0.08;
};

export const procPlantHealthState = (health: number): ProcPlantHealthState => {
  const normalized = THREE.MathUtils.clamp(health, 0, 1);
  if (normalized >= 0.82) return "thriving";
  if (normalized >= 0.5) return "healthy";
  if (normalized >= 0.18) return "stressed";
  return "dormant";
};

export const procPlantVariantId = (
  genomeId: string,
  spec: Partial<ProcPlantVariantSpec> = {},
): string => {
  const resolved = { ...DEFAULT_PROCPLANT_VARIANT, ...spec };
  const health = Math.round(THREE.MathUtils.clamp(resolved.health, 0, 1) * 100);
  const maturity = Math.round(THREE.MathUtils.clamp(resolved.maturity, 0, 1) * 100);
  return `${genomeId}@${resolved.season}-h${health}-m${maturity}`;
};

/**
 * Derive a deterministic seasonal/developmental form without mutating the
 * authored preset. The result remains a normal ProcPlantGenome and therefore
 * works with the standalone preview and Tellus runtime compiler unchanged.
 */
export const applyProcPlantVariant = (
  source: ProcPlantGenome,
  spec: Partial<ProcPlantVariantSpec> = {},
): ProcPlantGenome => {
  const resolved = { ...DEFAULT_PROCPLANT_VARIANT, ...spec };
  const health = THREE.MathUtils.clamp(resolved.health, 0, 1);
  const maturity = THREE.MathUtils.clamp(resolved.maturity, 0.08, 1);
  const evergreen = source.habit === "conifer" || source.habit === "palm" || source.habit === "tropical";
  const seasonal = seasonTraits(resolved.season, evergreen);
  const vigor = 0.18 + health * 0.82;
  const leafMass = seasonal.leafMass * (0.22 + health * 0.78) * (0.34 + maturity * 0.66);
  const flowerMass = seasonal.flowerMass * Math.pow(health, 1.35) * THREE.MathUtils.smoothstep(maturity, 0.35, 0.8);
  const genome = cloneGenome(source);

  genome.id = procPlantVariantId(source.id, resolved);
  genome.nodeCount = Math.max(2, Math.round(source.nodeCount * (0.38 + maturity * 0.62)));
  genome.internode = scaleCurve(source.internode, 0.52 + maturity * 0.48);
  genome.branchChance = scaleCurve(source.branchChance, vigor * (0.58 + maturity * 0.42));
  genome.apicalDominance = THREE.MathUtils.clamp(
    source.apicalDominance + (1 - health) * 0.14 - (1 - maturity) * 0.08,
    0,
    1,
  );
  genome.leaf.length = scaleCurve(source.leaf.length, 0.55 + maturity * 0.45);
  genome.leaf.density = scaleCurve(source.leaf.density, leafMass);
  genome.leaf.colorA = mixColor(
    source.leaf.colorA,
    health < 0.45 ? 0x857044 : seasonal.color,
    seasonal.colorMix + (1 - health) * 0.42,
  );
  genome.leaf.colorB = mixColor(
    source.leaf.colorB,
    health < 0.45 ? 0x695538 : seasonal.color,
    seasonal.colorMix * 0.78 + (1 - health) * 0.5,
  );

  if (genome.flower) {
    genome.flower.petals = flowerMass <= 0.02 ? 0 : Math.max(1, Math.round(genome.flower.petals * (0.72 + flowerMass * 0.28)));
    genome.flower.radius *= 0.62 + maturity * 0.38;
    genome.flower.color = mixColor(genome.flower.color, 0x806f52, (1 - health) * 0.6);
  }
  if (genome.accessoryOrgans) {
    const reproductiveMass = reproductiveMassForSeason(resolved.season) * Math.pow(health, 1.2) *
      THREE.MathUtils.smoothstep(maturity, 0.28, 0.82);
    genome.accessoryOrgans = genome.accessoryOrgans.map((organ) => {
      const persistent = organ.kind === "thorn" || organ.kind === "aerialRoot";
      const coneMass = organ.kind === "cone" ? 0.35 + reproductiveMass * 0.65 : reproductiveMass;
      const mass = persistent ? 0.45 + health * 0.55 : coneMass;
      return {
        ...organ,
        count: Math.max(persistent ? 1 : 0, Math.round(organ.count * mass)),
        size: organ.size * (persistent ? 0.62 + maturity * 0.38 : 0.5 + maturity * 0.5),
        color: mixColor(organ.color, resolved.season === "winter" ? 0x6f5a3d : organ.color, (1 - health) * 0.45),
      };
    });
  }
  if (genome.foliage) {
    genome.foliage.mass *= leafMass;
    genome.foliage.clusterDensity *= 0.38 + maturity * 0.62;
    genome.foliage.size = (genome.foliage.size ?? 1) * (0.64 + maturity * 0.36);
  }
  if (genome.clump) {
    genome.clump.count = Math.max(1, Math.round(genome.clump.count * (0.3 + maturity * 0.7)));
    genome.clump.radius *= 0.44 + maturity * 0.56;
    genome.clump.flowerDensity = (genome.clump.flowerDensity ?? 1) * flowerMass;
  }
  if (genome.treeRealism) {
    genome.treeRealism.crownSpread *= 0.62 + maturity * 0.38;
    genome.treeRealism.windFlex = THREE.MathUtils.clamp(genome.treeRealism.windFlex + (1 - health) * 0.08, 0, 1);
    genome.treeRealism.colorVariance = THREE.MathUtils.clamp(genome.treeRealism.colorVariance + (1 - health) * 0.18, 0, 1);
  }

  return genome;
};
