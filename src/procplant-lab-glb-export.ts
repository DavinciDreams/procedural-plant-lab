import type { ProcPlantCompiledLod } from "./procplant-lod";
import type {
  ProcPlantMaterializedPlacementDecal,
} from "./procplant-organ-placement-overrides";
import type { ProcPlantPlacementDecalPixelSource } from "./procplant-placement-decal-glb";
import type { ProcPlantBakedMaterialBundle } from "./procplant-material-bake";
import type { ProcPlantWeberPennBuildMetadata } from "./procplants";
import type { Group } from "three";

export const PROCPLANT_LAB_GLB_PREPARING_MESSAGE = "Preparing GLB with vertex color, sway, tintability, and contract metadata…";
export const reportProcPlantLabGlbExportFailure = (error: unknown) => {
  console.error("[procplants] GLB export failed.", error);
  return `GLB export failed: ${error instanceof Error ? error.message : String(error)}`;
};

export const preflightProcPlantLabGlbExport = (options: {
  heroReady: boolean;
  authoredDecals: number;
  activeBinding: boolean;
  retainedPixels: boolean;
  materializedDecals: number;
  importedHero: boolean;
  dataset: DOMStringMap;
}): { allowed: boolean; exportableDecals: boolean; message?: string } => {
  if (!options.heroReady) return { allowed: false, exportableDecals: false, message: "Generate a plant before exporting GLB." };
  const exportableDecals = options.authoredDecals > 0
    && options.activeBinding
    && options.retainedPixels
    && options.materializedDecals === options.authoredDecals;
  if (options.authoredDecals > 0 && !exportableDecals) {
    options.dataset.lastGlbPlacementDecalsRejected = String(options.authoredDecals);
    return {
      allowed: false,
      exportableDecals,
      message: "GLB export stopped: every decal needs the exact active binding plus retained source bytes and decoded pixels. Rebind the matching image or remove the unresolved decals.",
    };
  }
  if (options.authoredDecals > 0 && options.importedHero) {
    options.dataset.lastGlbPlacementDecalsRejected = String(options.authoredDecals);
    return {
      allowed: false,
      exportableDecals,
      message: "GLB export stopped: placement decals are not adopted onto imported-hero exports. Remove them or export the generated hero; no material target is guessed.",
    };
  }
  delete options.dataset.lastGlbPlacementDecalsRejected;
  return { allowed: true, exportableDecals };
};

export const exportProcPlantLabImportedGlb = async (options: {
  preview: Group;
  audit: Record<string, unknown> | null;
  contentHash: string;
  dataset: DOMStringMap;
}) => {
  const { downloadProcPlantLabHeroPreview } = await import("./procplant-lab-authoring-imports");
  const exported = await downloadProcPlantLabHeroPreview(options.preview, options.audit, options.contentHash);
  options.dataset.heroImportLastExportBytes = String(exported.byteLength);
  options.dataset.heroImportLastExportMaterials = String(exported.materials);
  options.dataset.heroImportLastExportTextures = String(exported.textures);
  options.dataset.heroImportLastExportImages = String(exported.images);
  return "Imported hero GLB exported with fitted spine, bark UV, wind, collars, and instanced branch, leaf, and accessory anchors.";
};

type ProcPlantAuthoringToolsModule = typeof import("./procplant-authoring-tools");

export interface ProcPlantLabGeneratedGlbInput {
  authoring: ProcPlantAuthoringToolsModule;
  activeLod: ProcPlantCompiledLod;
  name: string;
  genomeId: string;
  habit: string;
  seed: number;
  previewScale: number;
  materialBakeBundle: ProcPlantBakedMaterialBundle | null;
  placementDecals: readonly ProcPlantMaterializedPlacementDecal[];
  placementDecalPixelSource: ProcPlantPlacementDecalPixelSource | null;
  weberPenn: ProcPlantWeberPennBuildMetadata | null;
  authoredDecals: number;
  downloadName: string;
  dataset: DOMStringMap;
}

export interface ProcPlantLabGeneratedGlbResult {
  bytes: ArrayBuffer;
  surfaceGroups: number | null;
  materialHash: string | null;
  materialAssignments: number | null;
  decalDraws: number | null;
  decalTriangles: number | null;
  decalHash: string | null;
  decalEmbeddedBytes: number | null;
  message: string;
}

/** Export-only GLB assembly kept outside the interactive startup closure. */
export const exportProcPlantLabGeneratedGlb = async (
  input: ProcPlantLabGeneratedGlbInput,
): Promise<ProcPlantLabGeneratedGlbResult> => {
  const trimAudit = input.weberPenn?.trimAudit;
  const placementAudit = input.weberPenn?.placementAudit;
  const exportOptions = {
    name: input.name,
    genomeId: input.genomeId,
    seed: input.seed,
    ...(input.materialBakeBundle ? { material: { tangents: true } } : {}),
    collision: {
      type: ["tree", "conifer", "palm"].includes(input.habit)
        ? "trunk-capsule"
        : "bounds-box",
    },
    metadata: {
      lodLevel: input.activeLod.level,
      lodLabel: input.activeLod.label,
      lodDistance: input.activeLod.distance,
      previewScale: input.previewScale,
      authoredTriangles: input.activeLod.triangles,
      authoredVertices: input.activeLod.vertices,
      ...(trimAudit ? {
        weberPennTrimContract: "procplants.weber-penn-trim-overrides",
        weberPennTrimStatus: trimAudit.status,
        weberPennTrimSourceSignature: trimAudit.sourceTopologySignature,
        weberPennTrimResultSignature: trimAudit.resultTopologySignature,
        weberPennTrimOperations: trimAudit.operations.length,
        weberPennTrimRemovedStems: trimAudit.removedStemIds.length,
        weberPennTrimRemovedLeaves: trimAudit.removedLeafIds.length,
      } : {}),
      ...(placementAudit ? {
        weberPennOrganPlacementContract: "procplants.weber-penn-organ-placement-overrides",
        weberPennOrganPlacementStatus: placementAudit.status,
        weberPennOrganPlacementSignature: placementAudit.sourceTopologySignature,
        weberPennOrganPlacementApplied: placementAudit.appliedOperationIds.length,
      } : {}),
    },
  } as const;
  let bytes: ArrayBuffer;
  let surfaceGroups: number | null = null;
  let materialHash: string | null = null;
  let materialAssignments: number | null = null;
  let decalDraws: number | null = null;
  let decalTriangles: number | null = null;
  let decalHash: string | null = null;
  let decalEmbeddedBytes: number | null = null;
  if (input.materialBakeBundle || input.placementDecalPixelSource) {
    const prepared = input.authoring.prepareProcPlantGlbExport(input.activeLod.template, exportOptions);
    const decalPrepared = input.placementDecalPixelSource
      ? input.authoring.prepareProcPlantPlacementDecalGlbDraws(input.placementDecals, input.placementDecalPixelSource)
      : null;
    if (decalPrepared) prepared.scene.add(decalPrepared.root);
    try {
      if (input.materialBakeBundle) {
        const { exportProcPlantGlbWithBakedMaterials } = await import("./procplant-glb-material-binding");
        const slotByMeshName: Record<string, string> = {};
        const groupSlotsByMeshName: Record<string, readonly string[]> = {};
        for (const mesh of prepared.meshes) {
          const slots = mesh.userData.procplantSurfaces?.slots as string[] | undefined;
          if (Array.isArray(mesh.material)) groupSlotsByMeshName[mesh.name] = ["bark", "leaf"];
          else slotByMeshName[mesh.name] = slots?.[0] === "organ" ? "leaf" : "bark";
        }
        surfaceGroups = prepared.meshes.reduce(
          (sum, mesh) => sum + (Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1),
          0,
        );
        const bound = await exportProcPlantGlbWithBakedMaterials(
          { scene: prepared.scene, meshes: prepared.meshes },
          input.materialBakeBundle,
          { slotByMeshName, groupSlotsByMeshName },
        );
        bytes = bound.bytes;
        materialHash = bound.contentHash;
        materialAssignments = bound.assignments.length;
      } else {
        bytes = await input.authoring.exportProcPlantScenesGlb(prepared.scene);
      }
      if (decalPrepared && input.placementDecalPixelSource) {
        const adopted = await input.authoring.bindProcPlantPlacementDecalsIntoGlb(
          bytes,
          decalPrepared,
          input.placementDecalPixelSource,
        );
        bytes = adopted.bytes;
        decalDraws = adopted.draws;
        decalTriangles = adopted.triangles;
        decalHash = adopted.contentHash;
        decalEmbeddedBytes = adopted.embeddedBytes;
      }
    } finally {
      decalPrepared?.dispose();
      input.authoring.disposePreparedProcPlantGlbExport(prepared);
    }
  } else {
    bytes = await input.authoring.exportProcPlantGlb(input.activeLod.template, exportOptions);
  }
  if (surfaceGroups !== null) input.dataset.lastGlbSurfaceGroups = String(surfaceGroups);
  if (materialHash !== null) input.dataset.lastGlbMaterialHash = materialHash;
  if (materialAssignments !== null) input.dataset.lastGlbMaterialAssignments = String(materialAssignments);
  if (decalDraws !== null) input.dataset.lastGlbPlacementDecals = String(decalDraws);
  if (decalTriangles !== null) input.dataset.lastGlbPlacementDecalTriangles = String(decalTriangles);
  if (decalHash !== null) input.dataset.lastGlbPlacementDecalHash = decalHash;
  if (decalEmbeddedBytes !== null) input.dataset.lastGlbPlacementDecalEmbeddedBytes = String(decalEmbeddedBytes);
  const url = URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = input.downloadName;
  link.click();
  URL.revokeObjectURL(url);
  const message = input.placementDecalPixelSource
    ? `GLB exported from ${input.activeLod.label} geometry with ${input.authoredDecals} exact UV0 decal draw${input.authoredDecals === 1 ? "" : "s"} and a deterministic embedded PNG.`
    : input.materialBakeBundle
      ? `GLB exported from ${input.activeLod.label} geometry with separate embedded bark/leaf PBR primitives and tangents.`
      : `GLB exported from ${input.activeLod.label} geometry with separate bark/organ surfaces.`;
  return {
    bytes,
    surfaceGroups,
    materialHash,
    materialAssignments,
    decalDraws,
    decalTriangles,
    decalHash,
    decalEmbeddedBytes,
    message,
  };
};
