/** Download-only JSON serialization kept outside the interactive startup closure. */
import type { ProcPlantAttachmentAnchor } from "./procplants";
import type { ProcPlantEnvironment, ProcPlantGenome } from "./procplants";
import type { ProcPlantGeneratorGraphOperation } from "./procplant-generator-graph";
import type { ProcPlantOrganVariantSpec } from "./procplant-organ-variants";
import {
  createProcPlantWeberPennTrimOperation,
  createProcPlantWeberPennTrimOverrideSet,
  type ProcPlantWeberPennTrimTarget,
} from "./procplant-weber-penn-trim";

export const downloadProcPlantLabJson = (
  payload: unknown,
  identity: { primary: string; secondary: string; seed: number },
) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const slug = `${identity.primary}-${identity.secondary}-${identity.seed}`.replace(/[^a-z0-9-]+/gi, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `procplant-${slug}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  return "JSON exported.";
};

interface ProcPlantLabJsonImpostor {
  atlas: {
    contract: unknown;
    version: unknown;
    contentHash: unknown;
    width: unknown;
    height: unknown;
    padding: unknown;
    entries: readonly {
      id: unknown;
      uv: unknown;
      paddedUv: unknown;
      view: { outward: unknown };
    }[];
  };
}

export const summarizeProcPlantLabJsonImpostor = (impostor: ProcPlantLabJsonImpostor | null | undefined) =>
  impostor
    ? {
        contract: impostor.atlas.contract,
        version: impostor.atlas.version,
        contentHash: impostor.atlas.contentHash,
        width: impostor.atlas.width,
        height: impostor.atlas.height,
        padding: impostor.atlas.padding,
        entries: impostor.atlas.entries.map((entry) => ({
          id: entry.id,
          uv: entry.uv,
          paddedUv: entry.paddedUv,
          outward: entry.view.outward,
        })),
      }
    : null;

interface ProcPlantLabJsonProduction {
  version: unknown;
  path: unknown;
  work: unknown;
  previewHash: unknown;
  records: unknown;
}

export const summarizeProcPlantLabJsonProduction = (production: ProcPlantLabJsonProduction | null | undefined) =>
  production
    ? {
        version: production.version,
        path: production.path,
        work: production.work,
        previewHash: production.previewHash,
        records: production.records,
      }
    : null;

export const summarizeProcPlantLabJsonApplyAudit = (audit: {
  changed: unknown;
  applied: unknown;
  unsupported: unknown;
}) => ({ changed: audit.changed, applied: audit.applied, unsupported: audit.unsupported });

export const summarizeProcPlantLabJsonPruning = (
  segmentIds: readonly string[],
  groups: readonly (readonly string[])[],
) => ({
  operations: segmentIds.map((segmentId) => ({ operation: "remove", segmentId })),
  groups: groups.map((group) => ({ operation: "remove", segmentIds: [...group] })),
});

export const summarizeProcPlantLabJsonSpatialForces = (
  state: unknown,
  status: string,
  diagnostic: unknown,
  audit: unknown,
) => state ? { state, status, diagnostic, audit } : null;

export const summarizeProcPlantLabJsonDecalBinding = <T extends object>(options: {
  metadata: T;
  sourceFile: string;
  width: number;
  height: number;
  pixelSource: {
    sourceMimeType?: unknown;
    sourceSha256?: unknown;
    rgbaSha256?: unknown;
    pngSha256?: unknown;
  } | null;
  liveDraws: number;
  liveTriangles: number;
}) => ({
  ...options.metadata,
  sourceFile: options.sourceFile,
  width: options.width,
  height: options.height,
  pixelExportReady: Boolean(options.pixelSource),
  sourceMimeType: options.pixelSource?.sourceMimeType,
  sourceSha256: options.pixelSource?.sourceSha256,
  rgbaSha256: options.pixelSource?.rgbaSha256,
  pngSha256: options.pixelSource?.pngSha256,
  liveDraws: options.liveDraws,
  liveTriangles: options.liveTriangles,
});

export const summarizeProcPlantLabJsonLiveDecalBinding = <T extends object>(
  binding: { disposed: boolean; metadata: T } | null,
  sourceFile: string,
  dataset: DOMStringMap,
  pixelSource: Parameters<typeof summarizeProcPlantLabJsonDecalBinding>[0]["pixelSource"],
  liveDraws: number,
  liveTriangles: number,
) => binding && !binding.disposed ? summarizeProcPlantLabJsonDecalBinding({
  metadata: binding.metadata,
  sourceFile,
  width: Number(dataset.placementDecalBindingWidth ?? 0),
  height: Number(dataset.placementDecalBindingHeight ?? 0),
  pixelSource,
  liveDraws,
  liveTriangles,
}) : null;

/** Large JSON-only authoring projection stays behind Export JSON. */
export const createProcPlantLabJsonAuthoring = async (
  variant: ProcPlantOrganVariantSpec,
  attachments: readonly ProcPlantAttachmentAnchor[] | null,
  cutouts: unknown,
  activeLeafCutout: unknown,
  heroImport: unknown,
  materialBake: unknown,
  spatialForces: unknown,
  freeformCrown: unknown,
  impostor: ProcPlantLabJsonImpostor | null | undefined,
  pruning: { operations: unknown; groups: unknown },
  organPlacements: unknown,
  importedHeroDecals: unknown,
  importedHeroDecalStatus: unknown,
  placementDecalBinding: unknown,
  vineGuide: unknown,
  vineLiveSupport: unknown,
  weberPennTrim: unknown,
  generator: { graph: unknown; overrides: unknown; applyAudit: { changed: unknown; applied: unknown; unsupported: unknown }; preview: unknown; production: ProcPlantLabJsonProduction | null | undefined },
) => ({
  variant: { season: variant.season, health: variant.health, maturity: variant.maturity },
  organVariants: attachments
    ? (await import("./procplant-organ-variants")).buildProcPlantOrganVariants(attachments, variant)
    : null,
  cutouts,
  activeLeafCutout,
  heroImport,
  materialBake,
  spatialForces,
  freeformCrown,
  impostor: summarizeProcPlantLabJsonImpostor(impostor),
  graphOperations: pruning.operations,
  graphOperationGroups: pruning.groups,
  organPlacements,
  importedHeroDecals,
  importedHeroDecalStatus,
  placementDecalBinding,
  vineGuide,
  vineLiveSupport,
  weberPennTrim,
  generatorGraph: generator.graph,
  generatorOverrides: generator.overrides,
  generatorApplyAudit: summarizeProcPlantLabJsonApplyAudit(generator.applyAudit),
  generatorPreview: generator.preview,
  productionDag: summarizeProcPlantLabJsonProduction(generator.production),
});

export const summarizeProcPlantLabJsonWeberPennTrim = (
  value: { target: ProcPlantWeberPennTrimTarget; trimAudit: unknown } | null | undefined,
  segmentIds: readonly string[],
) => value ? {
  target: value.target,
  operations: segmentIds.length > 0
    ? createProcPlantWeberPennTrimOverrideSet(value.target, [createProcPlantWeberPennTrimOperation("remove", { kind: "segment-ids", segmentIds })])
    : null,
  audit: value.trimAudit,
} : null;

export const createProcPlantLabJsonPayload = (
  state: unknown,
  cameraPosition: unknown,
  cameraTarget: unknown,
  stats: unknown,
  genome: unknown,
  runtime: unknown,
  authoring: unknown,
  url: string,
) => ({
  version: 1,
  savedAt: new Date().toISOString(),
  state,
  camera: { position: cameraPosition, target: cameraTarget },
  stats,
  genome,
  runtime,
  authoring,
  url,
});

export const compileProcPlantLabJsonGraph = async (
  genome: ProcPlantGenome,
  seed: number,
  operations: readonly ProcPlantGeneratorGraphOperation[],
  environment: ProcPlantEnvironment,
) => (await import("./procplant-graph-editor-ui")).compileProcPlantGraphEditorState(genome, seed, operations, environment);
