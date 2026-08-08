import * as THREE from "three";
import {
  buildProcPlantInstancedParts,
  createProcPlantAerialRootGeometry,
  createProcPlantBerryGeometry,
  createProcPlantConeGeometry,
  createProcPlantConiferSprayGeometry,
  createProcPlantDaylilyBloomGeometry,
  createProcPlantFlobotCupBloomGeometry,
  createProcPlantFlobotPetal2BloomGeometry,
  createProcPlantFlobotPinkBloomGeometry,
  createProcPlantFlowerCenterGeometry,
  createProcPlantFlowerDiscGeometry,
  createProcPlantFoxgloveBloomGeometry,
  createProcPlantGrassBladeGeometry,
  createProcPlantHibiscusBloomGeometry,
  createProcPlantLeafGeometry,
  createProcPlantMossTuftGeometry,
  createProcPlantPalmFrondGeometry,
  createProcPlantPetalGeometry,
  createProcPlantFruitGeometry,
  createProcPlantThornGeometry,
  defaultPlantEnvironment,
  estimateProcPlantLods,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantInstanceKind,
  type ProcPlantFoliageClusterKind,
  type ProcPlantLodPackage,
} from "./procplants";

export type ProcPlantExportProfileId = "tellus-realtime" | "web-preview" | "hero-asset";

export interface ProcPlantExportProfile {
  id: ProcPlantExportProfileId;
  maxTriangles: number;
  maxVertices: number;
  maxDrawCalls: number;
  maxMaterialSlots: number;
  maxInstances: number;
  requireCompleteLods: boolean;
}

export const PROCPLANT_EXPORT_PROFILES: Readonly<Record<ProcPlantExportProfileId, ProcPlantExportProfile>> = {
  "tellus-realtime": {
    id: "tellus-realtime",
    maxTriangles: 90_000,
    maxVertices: 140_000,
    maxDrawCalls: 12,
    maxMaterialSlots: 3,
    maxInstances: 6_000,
    requireCompleteLods: true,
  },
  "web-preview": {
    id: "web-preview",
    maxTriangles: 180_000,
    maxVertices: 280_000,
    maxDrawCalls: 20,
    maxMaterialSlots: 4,
    maxInstances: 12_000,
    requireCompleteLods: true,
  },
  "hero-asset": {
    id: "hero-asset",
    maxTriangles: 450_000,
    maxVertices: 700_000,
    maxDrawCalls: 28,
    maxMaterialSlots: 6,
    maxInstances: 30_000,
    requireCompleteLods: false,
  },
};

export interface ProcPlantGeometryReadiness {
  stems: number;
  leaves: number;
  flowers: number;
  instances: number;
  vertices: number;
  triangles: number;
  stemTriangles: number;
  organTriangles: number;
  drawCalls: number;
  materialSlots: number;
  estimatedGpuBytes: number;
}

export interface ProcPlantReadinessReport {
  version: 1;
  presetId: string;
  seed: number;
  profile: ProcPlantExportProfileId;
  score: number;
  ready: boolean;
  geometry: ProcPlantGeometryReadiness;
  lods: ProcPlantLodPackage[];
  warnings: string[];
}

type InstanceKind = ProcPlantInstanceKind | ProcPlantFoliageClusterKind;

const geometryForKind = (kind: InstanceKind, genome: ProcPlantGenome): THREE.BufferGeometry => {
  if (kind === "leaf") {
    return createProcPlantLeafGeometry(
      genome.leaf.shape,
      genome.leaf.widthRatio,
      genome.leaf.serration,
      genome.leaf.curl,
      genome.leaf.venation,
    );
  }
  if (kind === "grassBlade") return createProcPlantGrassBladeGeometry(genome.leaf.widthRatio, genome.leaf.curl);
  if (kind === "coniferSpray") return createProcPlantConiferSprayGeometry();
  if (kind === "palmFrond") return createProcPlantPalmFrondGeometry();
  if (kind === "mossTuft") return createProcPlantMossTuftGeometry();
  if (kind === "fruit") return createProcPlantFruitGeometry();
  if (kind === "berry") return createProcPlantBerryGeometry();
  if (kind === "cone") return createProcPlantConeGeometry();
  if (kind === "thorn") return createProcPlantThornGeometry();
  if (kind === "aerialRoot") return createProcPlantAerialRootGeometry();
  if (kind === "petal") return createProcPlantPetalGeometry();
  if (kind === "flowerDisc") return createProcPlantFlowerDiscGeometry();
  if (kind === "daylilyBloom") return createProcPlantDaylilyBloomGeometry();
  if (kind === "hibiscusBloom") return createProcPlantHibiscusBloomGeometry();
  if (kind === "flobotCupBloom") return createProcPlantFlobotCupBloomGeometry();
  if (kind === "flobotPetal2Bloom") return createProcPlantFlobotPetal2BloomGeometry();
  if (kind === "flobotPinkBloom") return createProcPlantFlobotPinkBloomGeometry();
  if (kind === "foxgloveBloom") return createProcPlantFoxgloveBloomGeometry();
  return createProcPlantFlowerCenterGeometry();
};

const attributeBytes = (geometry: THREE.BufferGeometry): number => {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attribute.array.byteLength;
  }
  return bytes;
};

const completeLods = (lods: ProcPlantLodPackage[]): boolean =>
  lods.length === 4 && lods.every((lod, index) =>
    lod.level === index &&
    (index === 0 || lod.distance > lods[index - 1].distance) &&
    (index === 0 || lod.triangleBudget <= lods[index - 1].triangleBudget),
  );

const overBudgetPenalty = (value: number, budget: number, weight: number): number =>
  value <= budget ? 0 : Math.min(weight, ((value / Math.max(1, budget)) - 1) * weight);

/** Exact structural asset QA. Timing is deliberately excluded because it is hardware-dependent. */
export const inspectProcPlantReadiness = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
  profileId: ProcPlantExportProfileId = "tellus-realtime",
): ProcPlantReadinessReport => {
  const profile = PROCPLANT_EXPORT_PROFILES[profileId];
  const built = buildProcPlantInstancedParts(genome, seed, env);
  const counts = new Map<InstanceKind, number>();
  for (const instance of built.instances) counts.set(instance.kind, (counts.get(instance.kind) ?? 0) + 1);

  let vertices = built.stems.pos.length / 3;
  let organTriangles = 0;
  let prototypeBytes = 0;
  for (const [kind, count] of counts) {
    const geometry = geometryForKind(kind, genome);
    const prototypeVertices = geometry.getAttribute("position")?.count ?? 0;
    const prototypeTriangles = (geometry.index?.count ?? prototypeVertices) / 3;
    vertices += prototypeVertices * count;
    organTriangles += prototypeTriangles * count;
    prototypeBytes += attributeBytes(geometry);
    geometry.dispose();
  }

  const stemTriangles = built.stems.idx.length / 3;
  const triangles = stemTriangles + organTriangles;
  const drawCalls = (built.stems.idx.length > 0 ? 1 : 0) + counts.size;
  const materialSlots = (built.stems.idx.length > 0 ? 1 : 0) + (counts.size > 0 ? 1 : 0);
  const estimatedGpuBytes =
    built.stems.pos.byteLength +
    built.stems.nrm.byteLength +
    built.stems.col.byteLength +
    built.stems.tintable.byteLength +
    built.stems.sway.byteLength +
    built.stems.idx.byteLength +
    built.instances.length * 80 +
    prototypeBytes;
  const lods = estimateProcPlantLods({ ...built.stats, triangles }, genome);
  const warnings: string[] = [];
  if (triangles > profile.maxTriangles) warnings.push(`Triangles ${Math.round(triangles)} exceed ${profile.maxTriangles}.`);
  if (vertices > profile.maxVertices) warnings.push(`Vertices ${Math.round(vertices)} exceed ${profile.maxVertices}.`);
  if (drawCalls > profile.maxDrawCalls) warnings.push(`Draw calls ${drawCalls} exceed ${profile.maxDrawCalls}.`);
  if (materialSlots > profile.maxMaterialSlots) warnings.push(`Material slots ${materialSlots} exceed ${profile.maxMaterialSlots}.`);
  if (built.instances.length > profile.maxInstances) warnings.push(`Instances ${built.instances.length} exceed ${profile.maxInstances}.`);
  if (profile.requireCompleteLods && !completeLods(lods)) warnings.push("LOD package is incomplete or non-monotonic.");
  if (triangles > 0 && built.stats.leaves + built.stats.flowers > 0) {
    const visibleOrgansPerKTriangle = ((built.stats.leaves + built.stats.flowers) * 1_000) / triangles;
    if (visibleOrgansPerKTriangle < 4) warnings.push("Low foliage coverage per triangle; simplify stems or organ prototypes.");
  }

  let score = 100;
  score -= overBudgetPenalty(triangles, profile.maxTriangles, 30);
  score -= overBudgetPenalty(vertices, profile.maxVertices, 20);
  score -= overBudgetPenalty(drawCalls, profile.maxDrawCalls, 15);
  score -= overBudgetPenalty(materialSlots, profile.maxMaterialSlots, 10);
  score -= overBudgetPenalty(built.instances.length, profile.maxInstances, 15);
  if (profile.requireCompleteLods && !completeLods(lods)) score -= 20;
  score = Math.max(0, Math.round(score));

  return {
    version: 1,
    presetId: genome.id,
    seed,
    profile: profileId,
    score,
    ready: warnings.length === 0 && score >= 80,
    geometry: {
      stems: built.stats.stems,
      leaves: built.stats.leaves,
      flowers: built.stats.flowers,
      instances: built.instances.length,
      vertices: Math.round(vertices),
      triangles: Math.round(triangles),
      stemTriangles: Math.round(stemTriangles),
      organTriangles: Math.round(organTriangles),
      drawCalls,
      materialSlots,
      estimatedGpuBytes,
    },
    lods,
    warnings,
  };
};
