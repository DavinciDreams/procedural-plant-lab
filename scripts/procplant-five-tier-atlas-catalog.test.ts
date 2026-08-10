import assert from "node:assert/strict";
import {
  createProcPlantFiveTierAtlasCatalogPlan,
  createProcPlantFiveTierAtlasMemoryCache,
  runProcPlantFiveTierAtlasCatalog,
  validateProcPlantFiveTierAtlasCatalogPlan,
  type ProcPlantFiveTierAtlasCatalogCaptureContext,
} from "../src/procplant-five-tier-atlas-catalog";
import {
  PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT,
  PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION,
  type ProcPlantFiveTierAtlasAsset,
} from "../src/procplant-five-tier-atlas-build";
import { buildProcPlantImpostorAtlas } from "../src/procplant-impostor";
import { defaultPlantEnvironment, procPlantPresets, type ProcPlantGenome } from "../src/procplants";

const environment = defaultPlantEnvironment();
const buildOptions = {
  width: 16,
  height: 16,
  azimuthCount: 2,
  elevations: [0],
  padding: 1,
  samples: 0,
  maxAtlasSize: 128,
  maxAtlasBytes: 64 * 1024,
} as const;
const sources = [
  { presetId: "phiFern", genome: procPlantPresets.phiFern!, seed: 101, environment, buildOptions },
  { presetId: "cloverGroundcover", genome: procPlantPresets.cloverGroundcover!, seed: 202, environment, buildOptions },
] as const;

const plan = createProcPlantFiveTierAtlasCatalogPlan(sources, {
  maxEntries: 4,
  maxTotalAtlasBytes: 256 * 1024,
});
const reversePlan = createProcPlantFiveTierAtlasCatalogPlan([...sources].reverse(), {
  maxEntries: 4,
  maxTotalAtlasBytes: 256 * 1024,
});
assert.deepEqual(reversePlan, plan, "catalog planning must be independent of caller source order");
assert.equal(validateProcPlantFiveTierAtlasCatalogPlan(plan), plan);
assert.match(plan.cacheKey, /^procplants-lod5-atlas-catalog-v1-[0-9a-f]{8}$/);
assert.equal(new Set(plan.entries.map((entry) => entry.cacheKey)).size, 2);
assert.deepEqual(plan.entries.map((entry) => [entry.presetId, entry.seed]), [["cloverGroundcover", 202], ["phiFern", 101]]);

const makeAsset = async (context: ProcPlantFiveTierAtlasCatalogCaptureContext): Promise<ProcPlantFiveTierAtlasAsset> => {
  if (context.signal.aborted) throw new DOMException("fixture capture aborted", "AbortError");
  const { manifest } = context.entry;
  const color = context.entry.presetId === "phiFern" ? 67 : 131;
  const atlas = await buildProcPlantImpostorAtlas(manifest.capture.plan, async ({ view, width, height }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (context.signal.aborted) throw new DOMException("fixture capture aborted", "AbortError");
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([color, 160, 72 + view.azimuthIndex, 255], offset);
    return { id: view.id, width, height, rgba };
  }, { padding: manifest.atlas.padding, powerOfTwo: true, maxSize: manifest.atlas.maxSize, signal: context.signal });
  return {
    contract: PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT,
    version: PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION,
    cacheKey: manifest.cacheKey,
    build: manifest,
    atlas,
    capture: {
      api: "three-webgl-render-target-readback",
      threeRevision: "catalog-test-fixture",
      samplesRequested: manifest.capture.samples,
      samplesUsed: 0,
      rendererMaxTextureSize: manifest.atlas.maxSize,
    },
  };
};

const cache = createProcPlantFiveTierAtlasMemoryCache({ maxEntries: 4, maxDocumentBytes: 1024 * 1024 });
let captureActive = 0;
let capturePeak = 0;
let captureCount = 0;
const progress: string[] = [];
const adopted: string[] = [];
const capture = async (context: ProcPlantFiveTierAtlasCatalogCaptureContext) => {
  captureCount++;
  captureActive++;
  capturePeak = Math.max(capturePeak, captureActive);
  try { return await makeAsset(context); } finally { captureActive--; }
};
const first = await runProcPlantFiveTierAtlasCatalog(plan, sources, {
  cache,
  capture,
  concurrency: 2,
  maxInFlightAtlasBytes: plan.totalExpectedAtlasBytes,
  onProgress: (event) => progress.push(`${event.phase}:${event.slotKey ?? "catalog"}`),
  adopt: ({ entry, package: compiled }) => {
    assert.equal(compiled.lodSelection.version, 2);
    assert.equal(compiled.atlasAsset?.cacheKey, entry.cacheKey);
    assert.equal(compiled.lods[3]!.representation, "baked-atlas-cross");
    assert.equal(compiled.lods[4]!.representation, "baked-atlas-billboard");
    adopted.push(entry.slotKey);
  },
});
assert.deepEqual(first.counts, {
  total: 2, adopted: 2, cacheHits: 0, captured: 2, staleInvalidated: 0, failed: 0, cancelled: 0,
});
assert.equal(first.peakActive, 2);
assert.equal(capturePeak, 2);
assert.ok(first.peakInFlightAtlasBytes <= plan.totalExpectedAtlasBytes);
assert.equal(cache.stats().entries, 2);
assert.equal(captureCount, 2);
assert.ok(progress.some((event) => event.startsWith("capture-started:")));
assert.equal(progress.at(-1), "complete:catalog");

const second = await runProcPlantFiveTierAtlasCatalog(plan, sources, {
  cache,
  capture: async () => { throw new Error("cache hit unexpectedly captured"); },
  concurrency: 2,
  maxInFlightAtlasBytes: plan.totalExpectedAtlasBytes,
  adopt: ({ package: compiled }) => assert.equal(compiled.lodSelection.version, 2),
});
assert.deepEqual(second.counts, {
  total: 2, adopted: 2, cacheHits: 2, captured: 0, staleInvalidated: 0, failed: 0, cancelled: 0,
});

const changedFern = structuredClone(procPlantPresets.phiFern!) as ProcPlantGenome;
changedFern.fern!.arch += 0.03125;
const changedSources = [{ presetId: "phiFern", genome: changedFern, seed: 101, environment, buildOptions }] as const;
const changedPlan = createProcPlantFiveTierAtlasCatalogPlan(changedSources, {
  maxEntries: 4,
  maxTotalAtlasBytes: 256 * 1024,
});
assert.notEqual(changedPlan.entries[0]!.cacheKey, plan.entries.find((entry) => entry.presetId === "phiFern")!.cacheKey);
const stale = await runProcPlantFiveTierAtlasCatalog(changedPlan, changedSources, {
  cache,
  capture: makeAsset,
  adopt: ({ package: compiled }) => assert.equal(compiled.atlasAsset?.cacheKey, changedPlan.entries[0]!.cacheKey),
  concurrency: 1,
  maxInFlightAtlasBytes: changedPlan.totalExpectedAtlasBytes,
});
assert.deepEqual(stale.counts, {
  total: 1, adopted: 1, cacheHits: 0, captured: 1, staleInvalidated: 1, failed: 0, cancelled: 0,
});
assert.equal(stale.entries[0]!.cache, "stale");

const abort = new AbortController();
let cancelledAdoptions = 0;
const cancellationProgress: string[] = [];
const cancelledCache = createProcPlantFiveTierAtlasMemoryCache({ maxEntries: 4, maxDocumentBytes: 1024 * 1024 });
const cancelled = await runProcPlantFiveTierAtlasCatalog(plan, sources, {
  cache: cancelledCache,
  capture: makeAsset,
  adopt: () => { cancelledAdoptions++; },
  concurrency: 1,
  maxInFlightAtlasBytes: plan.totalExpectedAtlasBytes,
  signal: abort.signal,
  onProgress: (event) => {
    cancellationProgress.push(event.phase);
    if (event.phase === "capture-started") abort.abort();
  },
});
assert.equal(cancelled.cancelled, true);
assert.equal(cancelled.counts.cancelled, 2);
assert.equal(cancelledAdoptions, 0);
assert.ok(cancellationProgress.includes("cancelled"));
cancelledCache.dispose();

const tampered = structuredClone(plan);
tampered.entries[0]!.cacheKey = "procplants-lod5-atlas-v1-deadbeef";
assert.throws(() => validateProcPlantFiveTierAtlasCatalogPlan(tampered), /inconsistent|stale/);
assert.throws(() => createProcPlantFiveTierAtlasCatalogPlan([...sources, sources[0]], { maxEntries: 4 }), /duplicate/);
await assert.rejects(() => runProcPlantFiveTierAtlasCatalog(plan, sources, {
  cache,
  capture,
  adopt: () => {},
  concurrency: 9,
}), /concurrency/);

const boundedCache = createProcPlantFiveTierAtlasMemoryCache({ maxEntries: 1, maxDocumentBytes: 1024 * 1024 });
const cachedClover = await cache.get(plan.entries[0]!.slotKey);
const cachedFern = await cache.get(changedPlan.entries[0]!.slotKey);
assert.ok(cachedClover && cachedFern);
boundedCache.set(plan.entries[0]!.slotKey, cachedClover);
boundedCache.set(changedPlan.entries[0]!.slotKey, cachedFern);
assert.equal(boundedCache.stats().entries, 1);
boundedCache.dispose();
assert.deepEqual(boundedCache.stats(), {
  entries: 0, documentBytes: 0, maxEntries: 1, maxDocumentBytes: 1024 * 1024, disposed: true,
});
cache.dispose();

console.log(JSON.stringify({
  catalogCacheKey: plan.cacheKey,
  manifestKeys: plan.entries.map((entry) => entry.cacheKey),
  peakActive: first.peakActive,
  peakInFlightAtlasBytes: first.peakInFlightAtlasBytes,
  cacheHitCount: second.counts.cacheHits,
  staleInvalidated: stale.counts.staleInvalidated,
  cancelled: cancelled.counts.cancelled,
  adopted: adopted.length,
}));
console.log("procplant five-tier atlas catalog tests passed");
