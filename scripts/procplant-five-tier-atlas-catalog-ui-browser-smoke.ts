import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  createProcPlantFiveTierAtlasCatalogPlan,
  createProcPlantFiveTierAtlasWebGlCapturePool,
  runProcPlantFiveTierAtlasCatalog,
} from "../src/procplant-five-tier-atlas-catalog";
import { createProcPlantFiveTierAtlasCatalogUi } from "../src/procplant-five-tier-atlas-catalog-ui";
import {
  PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE,
  classifyProcPlantFiveTierAtlasIndexedDbError,
  createProcPlantFiveTierAtlasIndexedDbCache,
  type ProcPlantFiveTierAtlasIndexedDbCacheError,
} from "../src/procplant-five-tier-atlas-indexeddb-cache";
import { defaultPlantEnvironment, procPlantPresets, type ProcPlantGenome } from "../src/procplants";

declare global {
  interface Window { __PROCPLANT_LOD5_CATALOG_UI_BROWSER_SMOKE__?: Record<string, unknown>; }
}

const resultElement = document.querySelector<HTMLElement>("#result")!;
const databaseName = "procplants-lod5-catalog-ui-browser-smoke-v1";
const evictionDatabaseName = `${databaseName}-eviction`;
const deleteDatabase = (name: string) => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(name);
  request.addEventListener("success", () => resolve(), { once: true });
  request.addEventListener("error", () => reject(request.error), { once: true });
  request.addEventListener("blocked", () => reject(new Error(`deleteDatabase blocked: ${name}`)), { once: true });
});
const rawCorrupt = (name: string, slotKey: string) => new Promise<void>((resolve, reject) => {
  const request = indexedDB.open(name, 1);
  request.addEventListener("success", () => {
    const database = request.result;
    const transaction = database.transaction(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE, "readwrite");
    transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE).put({ slotKey, document: "corrupt" });
    transaction.addEventListener("complete", () => { database.close(); resolve(); }, { once: true });
    transaction.addEventListener("error", () => { database.close(); reject(transaction.error); }, { once: true });
  }, { once: true });
  request.addEventListener("error", () => reject(request.error), { once: true });
});

try {
  await deleteDatabase(databaseName);
  await deleteDatabase(evictionDatabaseName);
  const host = document.querySelector<HTMLElement>("#host")!;
  const initialSelections = [
    { presetId: "phiFern", seed: 612072 },
    { presetId: "cloverGroundcover", seed: 99173 },
  ] as const;
  let contextRequests = 0;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args: Parameters<HTMLCanvasElement["getContext"]>) {
    contextRequests++;
    return originalGetContext.apply(this, args as never);
  } as HTMLCanvasElement["getContext"];

  const firstCache = createProcPlantFiveTierAtlasIndexedDbCache({
    databaseName,
    maxEntries: 4,
    maxDocumentBytes: 8 * 1024 * 1024,
  });
  const firstUi = createProcPlantFiveTierAtlasCatalogUi({ host, cache: firstCache, initialSelections });
  const contextsBeforeRun = contextRequests;
  const first = await firstUi.run();
  const contextsAfterFirst = contextRequests;
  const firstResources = firstUi.resourceStats();
  const prepared = firstUi.getPreparedExports();
  const exportEvidence: Array<{ name: string; bytes: number; meshes: number; defaultSceneMeshes: number }> = [];
  for (const entry of prepared) {
    const imported = await new GLTFLoader().parseAsync(entry.glb, "");
    let meshes = 0;
    let defaultSceneMeshes = 0;
    for (const scene of imported.scenes) scene.traverse((object) => { if (object instanceof THREE.Mesh) meshes++; });
    imported.scene.traverse((object) => { if (object instanceof THREE.Mesh) defaultSceneMeshes++; });
    exportEvidence.push({ name: entry.name, bytes: entry.glb.byteLength, meshes, defaultSceneMeshes });
    for (const scene of imported.scenes) scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
  }
  const firstStats = await firstCache.stats();
  const rows = firstUi.root.querySelectorAll("[data-results] li").length;
  const exportEnabled = !firstUi.root.querySelector<HTMLButtonElement>("[data-action=export]")!.disabled;
  firstUi.dispose();
  const firstAfterDispose = firstUi.resourceStats();
  firstCache.close();

  const reloadCache = createProcPlantFiveTierAtlasIndexedDbCache({
    databaseName,
    maxEntries: 4,
    maxDocumentBytes: 8 * 1024 * 1024,
  });
  const reloadUi = createProcPlantFiveTierAtlasCatalogUi({ host, cache: reloadCache, initialSelections });
  const contextsBeforeReload = contextRequests;
  const reload = await reloadUi.run();
  const contextsAfterReload = contextRequests;
  const reloadResources = reloadUi.resourceStats();
  reloadUi.dispose();

  const environment = defaultPlantEnvironment();
  const buildOptions = {
    width: 64, height: 64, azimuthCount: 4, elevations: [0], padding: 2,
    samples: 0, maxAtlasSize: 512, maxAtlasBytes: 1024 * 1024,
  } as const;
  const originalSources = initialSelections.map(({ presetId, seed }) => ({
    presetId, genome: procPlantPresets[presetId]!, seed, environment, buildOptions,
  }));
  const originalPlan = createProcPlantFiveTierAtlasCatalogPlan(originalSources, {
    maxEntries: 8, maxTotalAtlasBytes: 16 * 1024 * 1024,
  });
  const savedRecords = await Promise.all(originalPlan.entries.map((entry) => reloadCache.get(entry.slotKey)));
  const changedFern = structuredClone(procPlantPresets.phiFern!) as ProcPlantGenome;
  changedFern.fern!.arch += 0.03125;
  const changedSources = [{
    presetId: "phiFern", genome: changedFern, seed: 612072, environment, buildOptions,
  }] as const;
  const changedPlan = createProcPlantFiveTierAtlasCatalogPlan(changedSources, {
    maxEntries: 8, maxTotalAtlasBytes: 16 * 1024 * 1024,
  });
  const staleCanvas = document.querySelector<HTMLCanvasElement>("#stale")!;
  const staleRenderer = new THREE.WebGLRenderer({ canvas: staleCanvas, antialias: false });
  staleRenderer.setPixelRatio(1);
  const stalePool = createProcPlantFiveTierAtlasWebGlCapturePool([staleRenderer]);
  const stale = await runProcPlantFiveTierAtlasCatalog(changedPlan, changedSources, {
    cache: reloadCache,
    capture: stalePool.capture,
    adopt: ({ entry, package: compiled }) => {
      if (compiled.lodSelection.version !== 2 || compiled.atlasAsset?.cacheKey !== entry.cacheKey) {
        throw new Error("stale source did not adopt the exact v2 manifest");
      }
    },
    maxInFlightAtlasBytes: changedPlan.totalExpectedAtlasBytes,
  });
  staleRenderer.renderLists.dispose();
  const staleMemory = { ...staleRenderer.info.memory };

  const cancelSources = originalSources.map((source, index) => ({ ...source, seed: source.seed + 1000 + index }));
  const cancelPlan = createProcPlantFiveTierAtlasCatalogPlan(cancelSources, {
    maxEntries: 8, maxTotalAtlasBytes: 16 * 1024 * 1024,
  });
  const cancelController = new AbortController();
  const cancelled = await runProcPlantFiveTierAtlasCatalog(cancelPlan, cancelSources, {
    cache: reloadCache,
    capture: async (context) => stalePool.capture(context),
    adopt: () => { throw new Error("cancelled catalog entry must not be adopted"); },
    concurrency: 1,
    signal: cancelController.signal,
    maxInFlightAtlasBytes: cancelPlan.totalExpectedAtlasBytes,
    onProgress: (event) => { if (event.phase === "capture-started") cancelController.abort(); },
  });

  const evictionCache = createProcPlantFiveTierAtlasIndexedDbCache({
    databaseName: evictionDatabaseName,
    maxEntries: 1,
    maxDocumentBytes: 8 * 1024 * 1024,
  });
  await evictionCache.set(originalPlan.entries[0]!.slotKey, savedRecords[0]!);
  await evictionCache.set(originalPlan.entries[1]!.slotKey, savedRecords[1]!);
  const evictionStats = await evictionCache.stats();
  const evictedFirst = await evictionCache.get(originalPlan.entries[0]!.slotKey);
  const retainedSecond = await evictionCache.get(originalPlan.entries[1]!.slotKey);
  evictionCache.close();

  const undersizedCache = createProcPlantFiveTierAtlasIndexedDbCache({
    databaseName: evictionDatabaseName,
    maxEntries: 1,
    maxDocumentBytes: 1024,
  });
  let sizeLimitCode = "none";
  try { await undersizedCache.stats(); }
  catch (error) { sizeLimitCode = (error as ProcPlantFiveTierAtlasIndexedDbCacheError).code ?? "unknown"; }
  undersizedCache.close();

  await rawCorrupt(databaseName, originalPlan.entries[1]!.slotKey);
  let corruptionCode = "none";
  try { await reloadCache.get(originalPlan.entries[1]!.slotKey); }
  catch (error) { corruptionCode = (error as ProcPlantFiveTierAtlasIndexedDbCacheError).code ?? "unknown"; }
  const quotaCode = classifyProcPlantFiveTierAtlasIndexedDbError(new DOMException("full", "QuotaExceededError"));
  const quotaCache = createProcPlantFiveTierAtlasIndexedDbCache({
    indexedDB: { open: () => { throw new DOMException("full", "QuotaExceededError"); } } as unknown as IDBFactory,
  });
  let adapterQuotaCode = "none";
  try { await quotaCache.stats(); }
  catch (error) { adapterQuotaCode = (error as ProcPlantFiveTierAtlasIndexedDbCacheError).code ?? "unknown"; }
  quotaCache.dispose();
  stalePool.dispose();
  staleRenderer.dispose();
  staleRenderer.forceContextLoss();
  reloadCache.close();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  await deleteDatabase(databaseName);
  await deleteDatabase(evictionDatabaseName);

  const smoke = {
    status: contextsBeforeRun === 0 && contextsAfterFirst > 0
      && first.counts.captured === 2 && first.counts.adopted === 2 && rows === 2 && exportEnabled
      && exportEvidence.length === 2 && exportEvidence.every((entry) => entry.meshes === 5 && entry.defaultSceneMeshes === 1)
      && firstStats.entries === 2 && firstStats.version === 1
      && firstResources.memory?.geometries === 0 && firstResources.memory?.textures === 0
      && firstAfterDispose.contextLost
      && reload.counts.cacheHits === 2 && contextsAfterReload === contextsBeforeReload && !reloadResources.rendererCreated
      && stale.counts.staleInvalidated === 1 && stale.counts.captured === 1
      && cancelled.cancelled && cancelled.counts.adopted === 0
      && evictionStats.entries === 1 && evictionStats.evictions === 1 && !evictedFirst && !!retainedSecond
      && corruptionCode === "corrupt" && sizeLimitCode === "limit"
      && quotaCode === "quota" && adapterQuotaCode === "quota"
      && staleMemory.geometries === 0 && staleMemory.textures === 0
      ? "pass" : "fail",
    lazy: { contextsBeforeRun, contextsAfterFirst, contextsBeforeReload, contextsAfterReload },
    first: first.counts,
    reload: reload.counts,
    stale: stale.counts,
    cancelled: cancelled.counts,
    cache: {
      firstStats, evictionStats, evictedFirst: !evictedFirst, retainedSecond: !!retainedSecond,
      corruptionCode, sizeLimitCode, quotaCode, adapterQuotaCode,
    },
    export: exportEvidence,
    resources: { firstResources, firstAfterDispose, reloadResources, staleMemory },
  };
  window.__PROCPLANT_LOD5_CATALOG_UI_BROWSER_SMOKE__ = smoke;
  resultElement.textContent = JSON.stringify(smoke, null, 2);
} catch (error) {
  const smoke = { status: "fail", error: error instanceof Error ? error.stack ?? error.message : String(error) };
  window.__PROCPLANT_LOD5_CATALOG_UI_BROWSER_SMOKE__ = smoke;
  resultElement.textContent = JSON.stringify(smoke, null, 2);
  console.error(error);
}
