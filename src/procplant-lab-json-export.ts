/** Download-only JSON serialization kept outside the interactive startup closure. */
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
