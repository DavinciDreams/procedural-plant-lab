import * as THREE from "three";
import {
  createProcPlantFiveTierAtlasCatalogPlan,
  createProcPlantFiveTierAtlasWebGlCapturePool,
  runProcPlantFiveTierAtlasCatalog,
  type ProcPlantFiveTierAtlasCatalogRunResult,
  type ProcPlantFiveTierAtlasCatalogSource,
} from "./procplant-five-tier-atlas-catalog";
import {
  createProcPlantFiveTierAtlasIndexedDbCache,
  type ProcPlantFiveTierAtlasIndexedDbCache,
  type ProcPlantFiveTierAtlasIndexedDbCacheOptions,
  type ProcPlantFiveTierAtlasIndexedDbCacheStats,
} from "./procplant-five-tier-atlas-indexeddb-cache";
import { exportProcPlantFiveTierLodGlb } from "./procplant-five-tier-lod";
import { defaultPlantEnvironment, procPlantPresets } from "./procplants";
import { labelForPresetId } from "./saved-presets";

const MAX_SELECTIONS = 8;
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const BUILD_OPTIONS = Object.freeze({
  width: 64,
  height: 64,
  azimuthCount: 4,
  elevations: [0] as readonly number[],
  padding: 2,
  samples: 0,
  maxAtlasSize: 512,
  maxAtlasBytes: 1024 * 1024,
});

export interface ProcPlantFiveTierAtlasCatalogUiOptions {
  host: HTMLElement;
  cache?: ProcPlantFiveTierAtlasIndexedDbCache;
  cacheOptions?: ProcPlantFiveTierAtlasIndexedDbCacheOptions;
  initialSelections?: ReadonlyArray<{ presetId: string; seed: number }>;
}

export interface ProcPlantFiveTierAtlasCatalogUi {
  readonly root: HTMLElement;
  run(): Promise<ProcPlantFiveTierAtlasCatalogRunResult>;
  cancel(): void;
  clearCache(): Promise<void>;
  stats(): Promise<ProcPlantFiveTierAtlasIndexedDbCacheStats>;
  getPreparedExports(): ReadonlyArray<{ name: string; glb: ArrayBuffer }>;
  resourceStats(): {
    rendererCreated: boolean;
    contextLost: boolean;
    memory?: { geometries: number; textures: number };
    pool?: ReturnType<ReturnType<typeof createProcPlantFiveTierAtlasWebGlCapturePool>["stats"]>;
  };
  dispose(): void;
}

interface PreparedExport {
  name: string;
  glb: ArrayBuffer;
}

const parseSeed = (input: HTMLInputElement) => {
  const seed = Number(input.value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seeds must be integers from 0 to 4294967295.");
  return seed >>> 0;
};

const formatBytes = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.round(bytes / 1024)} KiB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export const createProcPlantFiveTierAtlasCatalogUi = (
  options: ProcPlantFiveTierAtlasCatalogUiOptions,
): ProcPlantFiveTierAtlasCatalogUi => {
  if (!(options?.host instanceof HTMLElement)) throw new Error("five-tier atlas catalog UI requires a host element");
  const cache = options.cache ?? createProcPlantFiveTierAtlasIndexedDbCache(options.cacheOptions);
  const ownsCache = !options.cache;
  const initial = new Map((options.initialSelections ?? [
    { presetId: "phiFern", seed: 612072 },
    { presetId: "cloverGroundcover", seed: 99173 },
  ]).map((entry) => [entry.presetId, entry.seed >>> 0]));
  const root = document.createElement("section");
  root.className = "lod5-catalog";
  root.setAttribute("aria-label", "Five-tier atlas catalog builder");
  root.innerHTML = `
    <style>
      .lod5-catalog { margin-top:8px; padding:10px; border:1px solid #526451; border-radius:7px; background:#152018; color:#e8f2e5; }
      .lod5-catalog fieldset { max-height:190px; overflow:auto; border:0; padding:0; margin:8px 0; }
      .lod5-catalog .lod5-source { display:grid; grid-template-columns:auto 1fr 112px; align-items:center; gap:7px; padding:3px 0; }
      .lod5-catalog .lod5-actions { display:flex; flex-wrap:wrap; gap:7px; }
      .lod5-catalog progress { width:100%; margin:8px 0 3px; }
      .lod5-catalog output { display:block; min-height:16px; color:#c9ddc5; font-size:11px; white-space:normal; }
      .lod5-catalog ul { max-height:100px; overflow:auto; margin:6px 0 0; padding-left:20px; font-size:11px; }
      .lod5-catalog canvas { display:none; }
    </style>
    <p>Select up to ${MAX_SELECTIONS} exact preset + seed sources. Capture starts only when Build is pressed.</p>
    <fieldset aria-label="Catalog sources"></fieldset>
    <div class="lod5-actions">
      <button type="button" data-action="build">Build selected</button>
      <button type="button" data-action="cancel" disabled>Cancel</button>
      <button type="button" data-action="export" disabled>Download GLBs</button>
      <button type="button" data-action="clear">Clear durable cache</button>
    </div>
    <progress value="0" max="1" aria-label="Catalog build progress"></progress>
    <output data-status aria-live="polite">Idle. No renderer or cache transaction has started.</output>
    <output data-cache aria-live="polite">Durable cache status loads after an explicit action.</output>
    <ul data-results aria-label="Catalog results"></ul>
    <canvas width="64" height="64" aria-hidden="true"></canvas>
  `;
  options.host.replaceChildren(root);

  const fieldset = root.querySelector<HTMLFieldSetElement>("fieldset")!;
  const buildButton = root.querySelector<HTMLButtonElement>("[data-action=build]")!;
  const cancelButton = root.querySelector<HTMLButtonElement>("[data-action=cancel]")!;
  const exportButton = root.querySelector<HTMLButtonElement>("[data-action=export]")!;
  const clearButton = root.querySelector<HTMLButtonElement>("[data-action=clear]")!;
  const progress = root.querySelector<HTMLProgressElement>("progress")!;
  const status = root.querySelector<HTMLOutputElement>("[data-status]")!;
  const cacheStatus = root.querySelector<HTMLOutputElement>("[data-cache]")!;
  const results = root.querySelector<HTMLUListElement>("[data-results]")!;
  const canvas = root.querySelector<HTMLCanvasElement>("canvas")!;

  for (const presetId of Object.keys(procPlantPresets).sort((a, b) => labelForPresetId(a).localeCompare(labelForPresetId(b)))) {
    const row = document.createElement("label");
    row.className = "lod5-source";
    row.dataset.presetId = presetId;
    const checked = initial.has(presetId);
    row.innerHTML = `<input type="checkbox" ${checked ? "checked" : ""} />
      <span></span><input type="number" min="0" max="4294967295" step="1" value="${initial.get(presetId) ?? 1}" aria-label="${labelForPresetId(presetId)} seed" />`;
    row.querySelector("span")!.textContent = labelForPresetId(presetId);
    fieldset.appendChild(row);
  }

  let renderer: THREE.WebGLRenderer | null = null;
  let pool: ReturnType<typeof createProcPlantFiveTierAtlasWebGlCapturePool> | null = null;
  let abortController: AbortController | null = null;
  let disposed = false;
  let contextLost = false;
  let preparedExports: PreparedExport[] = [];

  const assertOpen = () => { if (disposed) throw new Error("five-tier atlas catalog UI is disposed"); };
  const updateCacheStatus = async () => {
    const current = await cache.stats();
    cacheStatus.textContent = `Cache v${current.version}: ${current.entries}/${current.maxEntries} entries, ${formatBytes(current.documentBytes)}/${formatBytes(current.maxDocumentBytes)}, ${current.evictions} evictions.`;
    return current;
  };
  const ensureRenderer = () => {
    if (renderer && pool) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(1);
    renderer.setSize(canvas.width, canvas.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    pool = createProcPlantFiveTierAtlasWebGlCapturePool([renderer]);
  };
  const selectedSources = (): ProcPlantFiveTierAtlasCatalogSource[] => {
    const rows = [...fieldset.querySelectorAll<HTMLElement>(".lod5-source")]
      .filter((row) => row.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked);
    if (rows.length < 1 || rows.length > MAX_SELECTIONS) throw new Error(`Select 1-${MAX_SELECTIONS} preset + seed sources.`);
    const environment = defaultPlantEnvironment();
    return rows.map((row) => {
      const presetId = row.dataset.presetId!;
      return {
        presetId,
        genome: procPlantPresets[presetId]!,
        seed: parseSeed(row.querySelector<HTMLInputElement>("input[type=number]")!),
        environment,
        buildOptions: BUILD_OPTIONS,
      };
    });
  };

  const run = async () => {
    assertOpen();
    if (abortController) throw new Error("a five-tier atlas catalog build is already running");
    const sources = selectedSources();
    const plan = createProcPlantFiveTierAtlasCatalogPlan(sources, {
      maxEntries: MAX_SELECTIONS,
      maxTotalAtlasBytes: 16 * 1024 * 1024,
    });
    abortController = new AbortController();
    preparedExports = [];
    let exportBytes = 0;
    let cacheHits = 0;
    let stale = 0;
    let misses = 0;
    progress.max = plan.entries.length;
    progress.value = 0;
    results.replaceChildren();
    buildButton.disabled = true;
    cancelButton.disabled = false;
    exportButton.disabled = true;
    clearButton.disabled = true;
    status.textContent = `Building 0/${plan.entries.length}; concurrency 1; 0 hits, 0 stale, 0 misses.`;
    try {
      const runResult = await runProcPlantFiveTierAtlasCatalog(plan, sources, {
        cache,
        capture: async (context) => {
          ensureRenderer();
          return pool!.capture(context);
        },
        adopt: async ({ entry, package: compiled }) => {
          const glb = await exportProcPlantFiveTierLodGlb(compiled, { name: `${entry.presetId}-${entry.seed}-lod5` });
          if (exportBytes + glb.byteLength > MAX_EXPORT_BYTES) throw new Error("prepared GLB exports exceed the 64 MiB UI cap");
          exportBytes += glb.byteLength;
          preparedExports.push({ name: `${entry.presetId}-${entry.seed}-lod5.glb`, glb });
        },
        concurrency: 1,
        maxInFlightAtlasBytes: plan.totalExpectedAtlasBytes,
        maxCacheDocumentBytes: 16 * 1024 * 1024,
        signal: abortController.signal,
        onProgress: (event) => {
          if (event.phase === "cache-hit") cacheHits++;
          if (event.phase === "cache-stale") stale++;
          if (event.phase === "cache-miss") misses++;
          progress.value = event.completed;
          status.textContent = `Building ${event.completed}/${event.total}; active ${event.active}/1; ${cacheHits} hits, ${stale} stale, ${misses} misses; ${formatBytes(event.inFlightAtlasBytes)} in flight.`;
        },
      });
      progress.value = runResult.counts.adopted + runResult.counts.failed + runResult.counts.cancelled;
      status.textContent = runResult.cancelled
        ? `Cancelled: ${runResult.counts.adopted} adopted, ${runResult.counts.cancelled} cancelled.`
        : `Complete: ${runResult.counts.adopted} adopted; ${runResult.counts.cacheHits} cache hits, ${runResult.counts.staleInvalidated} stale, ${runResult.counts.captured} captured.`;
      for (const entry of runResult.entries) {
        const item = document.createElement("li");
        item.textContent = `${labelForPresetId(entry.presetId)} seed ${entry.seed}: ${entry.status}, cache ${entry.cache}${entry.error ? ` - ${entry.error}` : ""}`;
        results.appendChild(item);
      }
      exportButton.disabled = preparedExports.length === 0;
      await updateCacheStatus();
      return runResult;
    } finally {
      abortController = null;
      buildButton.disabled = false;
      cancelButton.disabled = true;
      clearButton.disabled = false;
      renderer?.renderLists.dispose();
    }
  };

  const cancel = () => abortController?.abort();
  const clearCache = async () => {
    assertOpen();
    if (abortController) throw new Error("cancel the active build before clearing the cache");
    clearButton.disabled = true;
    try {
      await cache.clear();
      preparedExports = [];
      exportButton.disabled = true;
      status.textContent = "Durable five-tier atlas cache cleared.";
      await updateCacheStatus();
    } finally { clearButton.disabled = false; }
  };
  const download = () => {
    for (const prepared of preparedExports) {
      const url = URL.createObjectURL(new Blob([prepared.glb], { type: "model/gltf-binary" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = prepared.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  };
  const onBuild = () => { void run().catch((error) => { status.textContent = error instanceof Error ? error.message : String(error); }); };
  const onCancel = () => cancel();
  const onClear = () => { void clearCache().catch((error) => { status.textContent = error instanceof Error ? error.message : String(error); }); };
  buildButton.addEventListener("click", onBuild);
  cancelButton.addEventListener("click", onCancel);
  clearButton.addEventListener("click", onClear);
  exportButton.addEventListener("click", download);

  return {
    root,
    run,
    cancel,
    clearCache,
    stats: () => cache.stats(),
    getPreparedExports: () => preparedExports.map((entry) => ({ ...entry, glb: entry.glb.slice(0) })),
    resourceStats: () => ({
      rendererCreated: renderer !== null,
      contextLost,
      ...(renderer ? { memory: { ...renderer.info.memory } } : {}),
      ...(pool ? { pool: pool.stats() } : {}),
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      abortController?.abort();
      abortController = null;
      buildButton.removeEventListener("click", onBuild);
      cancelButton.removeEventListener("click", onCancel);
      clearButton.removeEventListener("click", onClear);
      exportButton.removeEventListener("click", download);
      pool?.dispose();
      pool = null;
      renderer?.renderLists.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      contextLost = renderer !== null;
      renderer = null;
      preparedExports = [];
      if (ownsCache) cache.dispose();
      root.remove();
    },
  };
};
