import type * as THREE from "three";
import {
  captureProcPlantFiveTierAtlasAsset,
  compileProcPlantFiveTierLodsFromAtlasAsset,
  createProcPlantFiveTierAtlasBuildManifest,
  parseProcPlantFiveTierAtlasAsset,
  serializeProcPlantFiveTierAtlasAsset,
  validateProcPlantFiveTierAtlasBuildManifest,
  type ProcPlantFiveTierAtlasAsset,
  type ProcPlantFiveTierAtlasBuildManifest,
  type ProcPlantFiveTierAtlasBuildOptions,
} from "./procplant-five-tier-atlas-build";
import type { ProcPlantFiveTierLodPackage } from "./procplant-five-tier-lod";
import {
  defaultPlantEnvironment,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
} from "./procplants";

export const PROCPLANT_FIVE_TIER_ATLAS_CATALOG_CONTRACT = "procplants.five-tier-atlas-catalog" as const;
export const PROCPLANT_FIVE_TIER_ATLAS_CATALOG_VERSION = 1 as const;

const MAX_CATALOG_ENTRIES = 128;
const MAX_CATALOG_CONCURRENCY = 8;
const MAX_CATALOG_ATLAS_BYTES = 1024 * 1024 * 1024;
const MAX_INFLIGHT_ATLAS_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_DOCUMENT_BYTES = 512 * 1024 * 1024;

export interface ProcPlantFiveTierAtlasCatalogSource {
  presetId: string;
  genome: ProcPlantGenome;
  seed: number;
  environment?: ProcPlantEnvironment;
  buildOptions?: ProcPlantFiveTierAtlasBuildOptions;
}

export interface ProcPlantFiveTierAtlasCatalogPlanEntry {
  slotKey: string;
  presetId: string;
  seed: number;
  cacheKey: string;
  expectedAtlasBytes: number;
  manifest: ProcPlantFiveTierAtlasBuildManifest;
}

export interface ProcPlantFiveTierAtlasCatalogPlan {
  contract: typeof PROCPLANT_FIVE_TIER_ATLAS_CATALOG_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_ATLAS_CATALOG_VERSION;
  cacheKey: string;
  limits: {
    maxEntries: number;
    maxTotalAtlasBytes: number;
  };
  totalExpectedAtlasBytes: number;
  entries: ProcPlantFiveTierAtlasCatalogPlanEntry[];
}

export interface ProcPlantFiveTierAtlasCatalogCacheRecord {
  cacheKey: string;
  document: string;
}

export interface ProcPlantFiveTierAtlasCatalogCache {
  get(slotKey: string): ProcPlantFiveTierAtlasCatalogCacheRecord | undefined
    | Promise<ProcPlantFiveTierAtlasCatalogCacheRecord | undefined>;
  set(slotKey: string, record: ProcPlantFiveTierAtlasCatalogCacheRecord): void | Promise<void>;
  delete(slotKey: string): void | Promise<void>;
}

export interface ProcPlantFiveTierAtlasMemoryCache extends ProcPlantFiveTierAtlasCatalogCache {
  clear(): void;
  dispose(): void;
  stats(): {
    entries: number;
    documentBytes: number;
    maxEntries: number;
    maxDocumentBytes: number;
    disposed: boolean;
  };
}

export type ProcPlantFiveTierAtlasCatalogCacheState = "hit" | "miss" | "stale";
export type ProcPlantFiveTierAtlasCatalogResultStatus = "adopted" | "failed" | "cancelled";
export type ProcPlantFiveTierAtlasCatalogProgressPhase =
  | "started"
  | "cache-hit"
  | "cache-miss"
  | "cache-stale"
  | "capture-started"
  | "captured"
  | "adopted"
  | "failed"
  | "cancelled"
  | "complete";

export interface ProcPlantFiveTierAtlasCatalogProgress {
  phase: ProcPlantFiveTierAtlasCatalogProgressPhase;
  catalogCacheKey: string;
  slotKey?: string;
  cache?: ProcPlantFiveTierAtlasCatalogCacheState;
  completed: number;
  total: number;
  active: number;
  inFlightAtlasBytes: number;
}

export interface ProcPlantFiveTierAtlasCatalogCaptureContext {
  entry: ProcPlantFiveTierAtlasCatalogPlanEntry;
  source: ProcPlantFiveTierAtlasCatalogSource;
  signal: AbortSignal;
}

export interface ProcPlantFiveTierAtlasCatalogAdoptionContext extends ProcPlantFiveTierAtlasCatalogCaptureContext {
  cache: ProcPlantFiveTierAtlasCatalogCacheState;
  asset: ProcPlantFiveTierAtlasAsset;
  package: ProcPlantFiveTierLodPackage;
}

export interface ProcPlantFiveTierAtlasCatalogRunOptions {
  cache: ProcPlantFiveTierAtlasCatalogCache;
  capture(context: ProcPlantFiveTierAtlasCatalogCaptureContext): Promise<ProcPlantFiveTierAtlasAsset>;
  adopt(context: ProcPlantFiveTierAtlasCatalogAdoptionContext): void | Promise<void>;
  concurrency?: number;
  maxInFlightAtlasBytes?: number;
  maxCacheDocumentBytes?: number;
  failFast?: boolean;
  signal?: AbortSignal;
  onProgress?(progress: Readonly<ProcPlantFiveTierAtlasCatalogProgress>): void;
}

export interface ProcPlantFiveTierAtlasCatalogEntryResult {
  slotKey: string;
  presetId: string;
  seed: number;
  cacheKey: string;
  cache: ProcPlantFiveTierAtlasCatalogCacheState;
  status: ProcPlantFiveTierAtlasCatalogResultStatus;
  atlasContentHash?: string;
  atlasBytes?: number;
  lodTriangles?: number[];
  error?: string;
}

export interface ProcPlantFiveTierAtlasCatalogRunResult {
  contract: typeof PROCPLANT_FIVE_TIER_ATLAS_CATALOG_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_ATLAS_CATALOG_VERSION;
  cacheKey: string;
  cancelled: boolean;
  counts: {
    total: number;
    adopted: number;
    cacheHits: number;
    captured: number;
    staleInvalidated: number;
    failed: number;
    cancelled: number;
  };
  peakActive: number;
  peakInFlightAtlasBytes: number;
  entries: ProcPlantFiveTierAtlasCatalogEntryResult[];
}

export interface ProcPlantFiveTierAtlasWebGlCapturePool {
  readonly capacity: number;
  capture(context: ProcPlantFiveTierAtlasCatalogCaptureContext): Promise<ProcPlantFiveTierAtlasAsset>;
  stats(): { active: number; available: number; waiting: number; peakActive: number; disposed: boolean };
  /** Release pool references only. Caller-owned WebGLRenderer instances are never disposed. */
  dispose(): void;
}

const textEncoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const integer = (value: unknown, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value as number;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]));
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("catalog values must be finite");
  return value;
};

const fnv1a32 = (value: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of value) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
};

const catalogCacheKey = (plan: Omit<ProcPlantFiveTierAtlasCatalogPlan, "cacheKey">) =>
  `procplants-lod5-atlas-catalog-v1-${fnv1a32(textEncoder.encode(JSON.stringify(canonicalize(plan))))}`;

const normalizePresetId = (value: unknown) => {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("catalog presetId must contain 1-128 trimmed printable characters");
  }
  return value;
};

const sourceSlotKey = (presetId: string, seed: number) => `${encodeURIComponent(presetId)}@${seed >>> 0}`;

const abortError = (message = "five-tier atlas catalog build aborted") => new DOMException(message, "AbortError");

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw abortError();
};

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export const createProcPlantFiveTierAtlasCatalogPlan = (
  sources: readonly ProcPlantFiveTierAtlasCatalogSource[],
  options: { maxEntries?: number; maxTotalAtlasBytes?: number } = {},
): ProcPlantFiveTierAtlasCatalogPlan => {
  const maxEntries = integer(options.maxEntries ?? 64, 1, MAX_CATALOG_ENTRIES, "catalog maxEntries");
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > maxEntries) {
    throw new Error(`five-tier atlas catalog requires 1-${maxEntries} sources`);
  }
  const maxTotalAtlasBytes = integer(
    options.maxTotalAtlasBytes ?? 256 * 1024 * 1024,
    1,
    MAX_CATALOG_ATLAS_BYTES,
    "catalog maxTotalAtlasBytes",
  );
  const entries = sources.map((source): ProcPlantFiveTierAtlasCatalogPlanEntry => {
    const presetId = normalizePresetId(source.presetId);
    if (!source.genome || source.genome.id !== presetId) {
      throw new Error(`catalog source ${presetId} must use a genome with the same id`);
    }
    const seed = integer(source.seed, 0, 0xffffffff, `catalog source ${presetId} seed`) >>> 0;
    const manifest = createProcPlantFiveTierAtlasBuildManifest(
      source.genome,
      seed,
      source.environment ?? defaultPlantEnvironment(),
      source.buildOptions,
    );
    return {
      slotKey: sourceSlotKey(presetId, seed),
      presetId,
      seed,
      cacheKey: manifest.cacheKey,
      expectedAtlasBytes: manifest.atlas.expectedRgbaBytes,
      manifest,
    };
  }).sort((left, right) => left.slotKey.localeCompare(right.slotKey));
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1]!.slotKey === entries[index]!.slotKey) {
      throw new Error(`duplicate five-tier atlas catalog source: ${entries[index]!.slotKey}`);
    }
  }
  const totalExpectedAtlasBytes = entries.reduce((sum, entry) => sum + entry.expectedAtlasBytes, 0);
  if (totalExpectedAtlasBytes > maxTotalAtlasBytes) {
    throw new Error(`five-tier atlas catalog exceeds maxTotalAtlasBytes (${totalExpectedAtlasBytes} > ${maxTotalAtlasBytes})`);
  }
  const body: Omit<ProcPlantFiveTierAtlasCatalogPlan, "cacheKey"> = {
    contract: PROCPLANT_FIVE_TIER_ATLAS_CATALOG_CONTRACT,
    version: PROCPLANT_FIVE_TIER_ATLAS_CATALOG_VERSION,
    limits: { maxEntries, maxTotalAtlasBytes },
    totalExpectedAtlasBytes,
    entries,
  };
  return validateProcPlantFiveTierAtlasCatalogPlan({ ...body, cacheKey: catalogCacheKey(body) });
};

export const validateProcPlantFiveTierAtlasCatalogPlan = (
  value: unknown,
): ProcPlantFiveTierAtlasCatalogPlan => {
  if (!isRecord(value)) throw new Error("five-tier atlas catalog plan must be an object");
  const plan = value as unknown as ProcPlantFiveTierAtlasCatalogPlan;
  if (plan.contract !== PROCPLANT_FIVE_TIER_ATLAS_CATALOG_CONTRACT
    || plan.version !== PROCPLANT_FIVE_TIER_ATLAS_CATALOG_VERSION) {
    throw new Error("unsupported five-tier atlas catalog contract/version");
  }
  if (!/^procplants-lod5-atlas-catalog-v1-[0-9a-f]{8}$/.test(plan.cacheKey)) {
    throw new Error("five-tier atlas catalog cacheKey is invalid");
  }
  if (!isRecord(plan.limits)) throw new Error("five-tier atlas catalog limits must be an object");
  const maxEntries = integer(plan.limits.maxEntries, 1, MAX_CATALOG_ENTRIES, "catalog maxEntries");
  const maxTotalAtlasBytes = integer(
    plan.limits.maxTotalAtlasBytes,
    1,
    MAX_CATALOG_ATLAS_BYTES,
    "catalog maxTotalAtlasBytes",
  );
  if (!Array.isArray(plan.entries) || plan.entries.length < 1 || plan.entries.length > maxEntries) {
    throw new Error(`five-tier atlas catalog requires 1-${maxEntries} entries`);
  }
  let totalExpectedAtlasBytes = 0;
  let priorSlotKey = "";
  for (const entry of plan.entries) {
    if (!isRecord(entry)) throw new Error("five-tier atlas catalog entry must be an object");
    const presetId = normalizePresetId(entry.presetId);
    const seed = integer(entry.seed, 0, 0xffffffff, `catalog source ${presetId} seed`) >>> 0;
    if (entry.slotKey !== sourceSlotKey(presetId, seed) || (priorSlotKey && entry.slotKey <= priorSlotKey)) {
      throw new Error("five-tier atlas catalog entries must have canonical unique sorted slot keys");
    }
    priorSlotKey = entry.slotKey;
    const manifest = validateProcPlantFiveTierAtlasBuildManifest(entry.manifest);
    if (manifest.source.genomeId !== presetId || manifest.source.seed !== seed || entry.cacheKey !== manifest.cacheKey
      || entry.expectedAtlasBytes !== manifest.atlas.expectedRgbaBytes) {
      throw new Error(`five-tier atlas catalog entry ${entry.slotKey} is inconsistent with its manifest`);
    }
    totalExpectedAtlasBytes += entry.expectedAtlasBytes;
  }
  if (plan.totalExpectedAtlasBytes !== totalExpectedAtlasBytes || totalExpectedAtlasBytes > maxTotalAtlasBytes) {
    throw new Error("five-tier atlas catalog byte budget is inconsistent");
  }
  const { cacheKey: _cacheKey, ...body } = plan;
  if (plan.cacheKey !== catalogCacheKey(body)) throw new Error("five-tier atlas catalog cacheKey is stale");
  return plan;
};

export const createProcPlantFiveTierAtlasMemoryCache = (
  options: { maxEntries?: number; maxDocumentBytes?: number } = {},
): ProcPlantFiveTierAtlasMemoryCache => {
  const maxEntries = integer(options.maxEntries ?? 64, 1, MAX_CATALOG_ENTRIES, "memory cache maxEntries");
  const maxDocumentBytes = integer(
    options.maxDocumentBytes ?? 128 * 1024 * 1024,
    1,
    MAX_CACHE_DOCUMENT_BYTES,
    "memory cache maxDocumentBytes",
  );
  const records = new Map<string, { record: ProcPlantFiveTierAtlasCatalogCacheRecord; bytes: number }>();
  let documentBytes = 0;
  let disposed = false;
  const assertOpen = () => { if (disposed) throw new Error("five-tier atlas memory cache has been disposed"); };
  return {
    get(slotKey) {
      assertOpen();
      const existing = records.get(slotKey);
      if (!existing) return undefined;
      records.delete(slotKey);
      records.set(slotKey, existing);
      return { ...existing.record };
    },
    set(slotKey, record) {
      assertOpen();
      if (!/^procplants-lod5-atlas-v1-[0-9a-f]{8}$/.test(record.cacheKey) || typeof record.document !== "string") {
        throw new Error("five-tier atlas memory cache record is invalid");
      }
      const bytes = textEncoder.encode(record.document).byteLength;
      if (bytes > maxDocumentBytes) throw new Error("five-tier atlas memory cache record exceeds maxDocumentBytes");
      const prior = records.get(slotKey);
      if (prior) { records.delete(slotKey); documentBytes -= prior.bytes; }
      while (records.size >= maxEntries || (records.size > 0 && documentBytes + bytes > maxDocumentBytes)) {
        const oldestKey = records.keys().next().value as string;
        const oldest = records.get(oldestKey)!;
        records.delete(oldestKey);
        documentBytes -= oldest.bytes;
      }
      records.set(slotKey, { record: { ...record }, bytes });
      documentBytes += bytes;
    },
    delete(slotKey) {
      assertOpen();
      const existing = records.get(slotKey);
      if (!existing) return;
      records.delete(slotKey);
      documentBytes -= existing.bytes;
    },
    clear() { assertOpen(); records.clear(); documentBytes = 0; },
    dispose() { if (disposed) return; records.clear(); documentBytes = 0; disposed = true; },
    stats: () => ({ entries: records.size, documentBytes, maxEntries, maxDocumentBytes, disposed }),
  };
};

const validateCacheRecord = (value: unknown) => {
  if (!isRecord(value) || typeof value.document !== "string"
    || typeof value.cacheKey !== "string" || !/^procplants-lod5-atlas-v1-[0-9a-f]{8}$/.test(value.cacheKey)) {
    throw new Error("five-tier atlas catalog cache record is invalid");
  }
  return value as unknown as ProcPlantFiveTierAtlasCatalogCacheRecord;
};

export const createProcPlantFiveTierAtlasWebGlCapturePool = (
  renderers: readonly THREE.WebGLRenderer[],
): ProcPlantFiveTierAtlasWebGlCapturePool => {
  if (!Array.isArray(renderers) || renderers.length < 1 || renderers.length > MAX_CATALOG_CONCURRENCY) {
    throw new Error(`five-tier atlas WebGL capture pool requires 1-${MAX_CATALOG_CONCURRENCY} renderers`);
  }
  const unique = new Set(renderers);
  if (unique.size !== renderers.length || renderers.some((renderer) => !renderer?.isWebGLRenderer)) {
    throw new Error("five-tier atlas WebGL capture pool requires unique caller-owned Three WebGLRenderer instances");
  }
  const available = [...renderers];
  const waiting: Array<{
    resolve(renderer: THREE.WebGLRenderer): void;
    reject(error: unknown): void;
    signal: AbortSignal;
    abort(): void;
  }> = [];
  let active = 0;
  let peakActive = 0;
  let disposed = false;

  const lease = (signal: AbortSignal): Promise<THREE.WebGLRenderer> => {
    throwIfAborted(signal);
    if (disposed) return Promise.reject(new Error("five-tier atlas WebGL capture pool has been disposed"));
    const renderer = available.pop();
    if (renderer) { active++; peakActive = Math.max(peakActive, active); return Promise.resolve(renderer); }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (leased: THREE.WebGLRenderer) => { active++; peakActive = Math.max(peakActive, active); resolve(leased); },
        reject,
        signal,
        abort: () => reject(abortError()),
      };
      signal.addEventListener("abort", waiter.abort, { once: true });
      waiting.push(waiter);
    });
  };

  const release = (renderer: THREE.WebGLRenderer) => {
    active--;
    while (waiting.length > 0) {
      const waiter = waiting.shift()!;
      waiter.signal.removeEventListener("abort", waiter.abort);
      if (waiter.signal.aborted) continue;
      if (disposed) { waiter.reject(new Error("five-tier atlas WebGL capture pool has been disposed")); continue; }
      waiter.resolve(renderer);
      return;
    }
    if (!disposed) available.push(renderer);
  };

  return {
    capacity: renderers.length,
    async capture(context) {
      const renderer = await lease(context.signal);
      try {
        return await captureProcPlantFiveTierAtlasAsset(
          renderer,
          context.entry.manifest,
          context.source.genome,
          context.source.environment ?? defaultPlantEnvironment(),
          { signal: context.signal },
        );
      } finally {
        release(renderer);
      }
    },
    stats: () => ({ active, available: available.length, waiting: waiting.length, peakActive, disposed }),
    dispose() {
      if (disposed) return;
      disposed = true;
      available.length = 0;
      for (const waiter of waiting.splice(0)) {
        waiter.signal.removeEventListener("abort", waiter.abort);
        waiter.reject(new Error("five-tier atlas WebGL capture pool has been disposed"));
      }
    },
  };
};

export const runProcPlantFiveTierAtlasCatalog = async (
  planValue: ProcPlantFiveTierAtlasCatalogPlan,
  sourceValues: readonly ProcPlantFiveTierAtlasCatalogSource[],
  options: ProcPlantFiveTierAtlasCatalogRunOptions,
): Promise<ProcPlantFiveTierAtlasCatalogRunResult> => {
  const plan = validateProcPlantFiveTierAtlasCatalogPlan(planValue);
  if (!options?.cache || typeof options.cache.get !== "function" || typeof options.cache.set !== "function"
    || typeof options.cache.delete !== "function" || typeof options.capture !== "function" || typeof options.adopt !== "function") {
    throw new Error("five-tier atlas catalog requires cache, capture, and adopt adapters");
  }
  const concurrency = integer(options.concurrency ?? 1, 1, MAX_CATALOG_CONCURRENCY, "catalog concurrency");
  const maxInFlightAtlasBytes = integer(
    options.maxInFlightAtlasBytes ?? 128 * 1024 * 1024,
    1,
    MAX_INFLIGHT_ATLAS_BYTES,
    "catalog maxInFlightAtlasBytes",
  );
  const maxCacheDocumentBytes = integer(
    options.maxCacheDocumentBytes ?? 192 * 1024 * 1024,
    1,
    MAX_CACHE_DOCUMENT_BYTES,
    "catalog maxCacheDocumentBytes",
  );
  for (const entry of plan.entries) if (entry.expectedAtlasBytes > maxInFlightAtlasBytes) {
    throw new Error(`catalog entry ${entry.slotKey} exceeds maxInFlightAtlasBytes`);
  }
  const sources = new Map<string, ProcPlantFiveTierAtlasCatalogSource>();
  for (const source of sourceValues) {
    const presetId = normalizePresetId(source.presetId);
    const seed = integer(source.seed, 0, 0xffffffff, `catalog source ${presetId} seed`) >>> 0;
    const slotKey = sourceSlotKey(presetId, seed);
    if (sources.has(slotKey)) throw new Error(`duplicate five-tier atlas catalog source: ${slotKey}`);
    if (source.genome?.id !== presetId) throw new Error(`catalog source ${presetId} must use a genome with the same id`);
    sources.set(slotKey, source);
  }
  if (sources.size !== plan.entries.length || plan.entries.some((entry) => !sources.has(entry.slotKey))) {
    throw new Error("five-tier atlas catalog sources do not exactly match the plan");
  }

  const controller = new AbortController();
  const externalAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) externalAbort();
  else options.signal?.addEventListener("abort", externalAbort, { once: true });
  const signal = controller.signal;
  const entryResults: Array<ProcPlantFiveTierAtlasCatalogEntryResult | undefined> = new Array(plan.entries.length);
  let cursor = 0;
  let completed = 0;
  let active = 0;
  let peakActive = 0;
  let inFlightAtlasBytes = 0;
  let peakInFlightAtlasBytes = 0;
  const byteWaiters = new Set<() => void>();

  const emit = (
    phase: ProcPlantFiveTierAtlasCatalogProgressPhase,
    entry?: ProcPlantFiveTierAtlasCatalogPlanEntry,
    cache?: ProcPlantFiveTierAtlasCatalogCacheState,
  ) => options.onProgress?.(Object.freeze({
    phase,
    catalogCacheKey: plan.cacheKey,
    slotKey: entry?.slotKey,
    cache,
    completed,
    total: plan.entries.length,
    active,
    inFlightAtlasBytes,
  }));

  const reserve = async (bytes: number) => {
    while (inFlightAtlasBytes + bytes > maxInFlightAtlasBytes) {
      throwIfAborted(signal);
      await new Promise<void>((resolve, reject) => {
        const wake = () => { signal.removeEventListener("abort", abort); resolve(); };
        const abort = () => { byteWaiters.delete(wake); reject(abortError()); };
        byteWaiters.add(wake);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    throwIfAborted(signal);
    inFlightAtlasBytes += bytes;
    active++;
    peakActive = Math.max(peakActive, active);
    peakInFlightAtlasBytes = Math.max(peakInFlightAtlasBytes, inFlightAtlasBytes);
  };

  const release = (bytes: number) => {
    inFlightAtlasBytes -= bytes;
    active--;
    for (const wake of [...byteWaiters]) { byteWaiters.delete(wake); wake(); }
  };

  const processEntry = async (
    entry: ProcPlantFiveTierAtlasCatalogPlanEntry,
    source: ProcPlantFiveTierAtlasCatalogSource,
  ): Promise<ProcPlantFiveTierAtlasCatalogEntryResult> => {
    let cacheState: ProcPlantFiveTierAtlasCatalogCacheState = "miss";
    emit("started", entry, cacheState);
    throwIfAborted(signal);
    const cachedValue = await options.cache.get(entry.slotKey);
    throwIfAborted(signal);
    if (cachedValue !== undefined) {
      let cachedAsset: ProcPlantFiveTierAtlasAsset | undefined;
      let cachedPackage: ProcPlantFiveTierLodPackage | undefined;
      try {
        const cached = validateCacheRecord(cachedValue);
        if (cached.cacheKey !== entry.cacheKey) throw new Error("cached manifest key is stale");
        const maxDocumentBytes = Math.min(
          maxCacheDocumentBytes,
          Math.max(1024 * 1024, entry.expectedAtlasBytes * 2 + 1024 * 1024),
        );
        cachedAsset = parseProcPlantFiveTierAtlasAsset(cached.document, {
          maxDocumentBytes,
          maxAtlasBytes: entry.manifest.atlas.maxBytes,
          maxAtlasSize: entry.manifest.atlas.maxSize,
        });
        if (cachedAsset.cacheKey !== entry.cacheKey) throw new Error("cached atlas asset key is stale");
        cachedPackage = compileProcPlantFiveTierLodsFromAtlasAsset(
          source.genome,
          cachedAsset,
          source.environment ?? defaultPlantEnvironment(),
        );
      } catch (error) {
        if (signal.aborted) throw abortError();
        await options.cache.delete(entry.slotKey);
        cacheState = "stale";
        emit("cache-stale", entry, cacheState);
      }
      if (cachedAsset && cachedPackage) {
        cacheState = "hit";
        emit("cache-hit", entry, cacheState);
        throwIfAborted(signal);
        await options.adopt({ entry, source, signal, cache: cacheState, asset: cachedAsset, package: cachedPackage });
        throwIfAborted(signal);
        return {
          slotKey: entry.slotKey,
          presetId: entry.presetId,
          seed: entry.seed,
          cacheKey: entry.cacheKey,
          cache: cacheState,
          status: "adopted",
          atlasContentHash: cachedAsset.atlas.contentHash,
          atlasBytes: cachedAsset.atlas.rgba.byteLength,
          lodTriangles: cachedPackage.lods.map((lod) => lod.triangles),
        };
      }
    } else {
      emit("cache-miss", entry, cacheState);
    }

    throwIfAborted(signal);
    emit("capture-started", entry, cacheState);
    const asset = await options.capture({ entry, source, signal });
    throwIfAborted(signal);
    const compiled = compileProcPlantFiveTierLodsFromAtlasAsset(
      source.genome,
      asset,
      source.environment ?? defaultPlantEnvironment(),
    );
    if (asset.cacheKey !== entry.cacheKey) throw new Error("captured atlas asset does not match the catalog manifest key");
    const document = serializeProcPlantFiveTierAtlasAsset(asset);
    if (textEncoder.encode(document).byteLength > maxCacheDocumentBytes) {
      throw new Error("captured atlas asset exceeds maxCacheDocumentBytes");
    }
    await options.cache.set(entry.slotKey, { cacheKey: entry.cacheKey, document });
    throwIfAborted(signal);
    emit("captured", entry, cacheState);
    await options.adopt({ entry, source, signal, cache: cacheState, asset, package: compiled });
    throwIfAborted(signal);
    return {
      slotKey: entry.slotKey,
      presetId: entry.presetId,
      seed: entry.seed,
      cacheKey: entry.cacheKey,
      cache: cacheState,
      status: "adopted",
      atlasContentHash: asset.atlas.contentHash,
      atlasBytes: asset.atlas.rgba.byteLength,
      lodTriangles: compiled.lods.map((lod) => lod.triangles),
    };
  };

  const worker = async () => {
    while (!signal.aborted) {
      const index = cursor++;
      if (index >= plan.entries.length) return;
      const entry = plan.entries[index]!;
      const source = sources.get(entry.slotKey)!;
      let reserved = false;
      let result: ProcPlantFiveTierAtlasCatalogEntryResult;
      try {
        await reserve(entry.expectedAtlasBytes);
        reserved = true;
        result = await processEntry(entry, source);
      } catch (error) {
        const cancelled = signal.aborted || (error instanceof DOMException && error.name === "AbortError");
        result = {
          slotKey: entry.slotKey,
          presetId: entry.presetId,
          seed: entry.seed,
          cacheKey: entry.cacheKey,
          cache: "miss",
          status: cancelled ? "cancelled" : "failed",
          error: errorText(error),
        };
        if (!cancelled && options.failFast) controller.abort(error);
      } finally {
        if (reserved) release(entry.expectedAtlasBytes);
      }
      entryResults[index] = result;
      completed++;
      emit(result.status, entry, result.cache);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, plan.entries.length) }, () => worker()));
    for (let index = 0; index < entryResults.length; index++) {
      if (entryResults[index]) continue;
      const entry = plan.entries[index]!;
      entryResults[index] = {
        slotKey: entry.slotKey,
        presetId: entry.presetId,
        seed: entry.seed,
        cacheKey: entry.cacheKey,
        cache: "miss",
        status: "cancelled",
        error: "five-tier atlas catalog build aborted before the entry started",
      };
      completed++;
      emit("cancelled", entry, "miss");
    }
  } finally {
    options.signal?.removeEventListener("abort", externalAbort);
  }

  const entries = entryResults as ProcPlantFiveTierAtlasCatalogEntryResult[];
  const counts = {
    total: entries.length,
    adopted: entries.filter((entry) => entry.status === "adopted").length,
    cacheHits: entries.filter((entry) => entry.status === "adopted" && entry.cache === "hit").length,
    captured: entries.filter((entry) => entry.status === "adopted" && entry.cache !== "hit").length,
    staleInvalidated: entries.filter((entry) => entry.cache === "stale").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
    cancelled: entries.filter((entry) => entry.status === "cancelled").length,
  };
  emit("complete");
  return {
    contract: plan.contract,
    version: plan.version,
    cacheKey: plan.cacheKey,
    cancelled: counts.cancelled > 0,
    counts,
    peakActive,
    peakInFlightAtlasBytes,
    entries,
  };
};
