import type {
  ProcPlantFiveTierAtlasCatalogCache,
  ProcPlantFiveTierAtlasCatalogCacheRecord,
} from "./procplant-five-tier-atlas-catalog";

export const PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_CONTRACT =
  "procplants.five-tier-atlas-indexeddb-cache" as const;
export const PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_VERSION = 1 as const;
export const PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE = "assets" as const;
export const PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE = "meta" as const;

const DATABASE_VERSION = 1;
const META_KEY = "cache";
const MAX_ENTRIES = 128;
const MAX_DOCUMENT_BYTES = 512 * 1024 * 1024;
const DEFAULT_DATABASE_NAME = "procplants-five-tier-atlas-cache-v1";
const textEncoder = new TextEncoder();

export type ProcPlantFiveTierAtlasIndexedDbCacheErrorCode =
  | "closed"
  | "corrupt"
  | "limit"
  | "quota"
  | "unavailable"
  | "transaction";

export class ProcPlantFiveTierAtlasIndexedDbCacheError extends Error {
  readonly code: ProcPlantFiveTierAtlasIndexedDbCacheErrorCode;

  constructor(code: ProcPlantFiveTierAtlasIndexedDbCacheErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProcPlantFiveTierAtlasIndexedDbCacheError";
    this.code = code;
  }
}

export interface ProcPlantFiveTierAtlasIndexedDbCacheOptions {
  databaseName?: string;
  maxEntries?: number;
  maxDocumentBytes?: number;
  indexedDB?: IDBFactory;
}

export interface ProcPlantFiveTierAtlasIndexedDbCacheStats {
  contract: typeof PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_VERSION;
  entries: number;
  documentBytes: number;
  evictions: number;
  maxEntries: number;
  maxDocumentBytes: number;
  databaseName: string;
  closed: boolean;
}

export interface ProcPlantFiveTierAtlasIndexedDbCache extends ProcPlantFiveTierAtlasCatalogCache {
  clear(): Promise<void>;
  stats(): Promise<ProcPlantFiveTierAtlasIndexedDbCacheStats>;
  close(): void;
  dispose(): void;
}

interface StoredAsset {
  contract: typeof PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_VERSION;
  slotKey: string;
  cacheKey: string;
  document: string;
  documentBytes: number;
  sequence: number;
}

interface StoredMeta {
  key: typeof META_KEY;
  contract: typeof PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_CONTRACT;
  version: typeof PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_VERSION;
  entries: number;
  documentBytes: number;
  evictions: number;
  nextSequence: number;
}

const integer = (value: unknown, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ProcPlantFiveTierAtlasIndexedDbCacheError("limit", `${label} must be an integer in [${min}, ${max}]`);
  }
  return value as number;
};

const validSlotKey = (value: unknown): value is string => typeof value === "string"
  && value.length >= 1 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);

const validCacheKey = (value: unknown): value is string => typeof value === "string"
  && /^procplants-lod5-atlas-v1-[0-9a-f]{8}$/.test(value);

const initialMeta = (): StoredMeta => ({
  key: META_KEY,
  contract: PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_CONTRACT,
  version: PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_VERSION,
  entries: 0,
  documentBytes: 0,
  evictions: 0,
  nextSequence: 1,
});

const validateMeta = (value: unknown): StoredMeta => {
  const meta = value as Partial<StoredMeta> | undefined;
  if (!meta || meta.key !== META_KEY || meta.contract !== PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_CONTRACT
    || meta.version !== PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_VERSION
    || !Number.isSafeInteger(meta.entries) || meta.entries! < 0 || meta.entries! > MAX_ENTRIES
    || !Number.isSafeInteger(meta.documentBytes) || meta.documentBytes! < 0 || meta.documentBytes! > MAX_DOCUMENT_BYTES
    || !Number.isSafeInteger(meta.evictions) || meta.evictions! < 0
    || !Number.isSafeInteger(meta.nextSequence) || meta.nextSequence! < 1) {
    throw new ProcPlantFiveTierAtlasIndexedDbCacheError("corrupt", "five-tier atlas IndexedDB cache metadata is corrupt");
  }
  return meta as StoredMeta;
};

const validateStoredAsset = (value: unknown, expectedSlotKey?: string): StoredAsset => {
  const asset = value as Partial<StoredAsset> | undefined;
  if (!asset || asset.contract !== PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_CONTRACT
    || asset.version !== PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_VERSION
    || !validSlotKey(asset.slotKey) || (expectedSlotKey !== undefined && asset.slotKey !== expectedSlotKey)
    || !validCacheKey(asset.cacheKey) || typeof asset.document !== "string"
    || !Number.isSafeInteger(asset.documentBytes) || asset.documentBytes! < 1
    || textEncoder.encode(asset.document).byteLength !== asset.documentBytes
    || !Number.isSafeInteger(asset.sequence) || asset.sequence! < 1) {
    throw new ProcPlantFiveTierAtlasIndexedDbCacheError("corrupt", "five-tier atlas IndexedDB cache record is corrupt");
  }
  return asset as StoredAsset;
};

export const classifyProcPlantFiveTierAtlasIndexedDbError = (
  error: unknown,
): ProcPlantFiveTierAtlasIndexedDbCacheErrorCode => {
  if (error instanceof ProcPlantFiveTierAtlasIndexedDbCacheError) return error.code;
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "QuotaExceededError") return "quota";
  if (typeof DOMException !== "undefined" && error instanceof DOMException
    && ["InvalidStateError", "NotSupportedError", "SecurityError"].includes(error.name)) {
    return "unavailable";
  }
  return "transaction";
};

const normalizeError = (error: unknown, action: string) => {
  if (error instanceof ProcPlantFiveTierAtlasIndexedDbCacheError) return error;
  const code = classifyProcPlantFiveTierAtlasIndexedDbError(error);
  return new ProcPlantFiveTierAtlasIndexedDbCacheError(
    code,
    code === "quota"
      ? `five-tier atlas IndexedDB cache quota was exceeded during ${action}`
      : `five-tier atlas IndexedDB cache failed during ${action}`,
    { cause: error },
  );
};

const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error), { once: true });
});

const transactionComplete = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.addEventListener("complete", () => resolve(), { once: true });
  transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
  transaction.addEventListener("error", () => reject(transaction.error), { once: true });
});

const oldestAsset = (index: IDBIndex) => new Promise<StoredAsset | undefined>((resolve, reject) => {
  const request = index.openCursor();
  request.addEventListener("success", () => resolve(request.result?.value as StoredAsset | undefined), { once: true });
  request.addEventListener("error", () => reject(request.error), { once: true });
});

export const createProcPlantFiveTierAtlasIndexedDbCache = (
  options: ProcPlantFiveTierAtlasIndexedDbCacheOptions = {},
): ProcPlantFiveTierAtlasIndexedDbCache => {
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  if (typeof databaseName !== "string" || databaseName.length < 1 || databaseName.length > 128
    || /[\u0000-\u001f\u007f]/.test(databaseName)) {
    throw new ProcPlantFiveTierAtlasIndexedDbCacheError("limit", "IndexedDB cache databaseName is invalid");
  }
  const maxEntries = integer(options.maxEntries ?? 32, 1, MAX_ENTRIES, "IndexedDB cache maxEntries");
  const maxDocumentBytes = integer(
    options.maxDocumentBytes ?? 128 * 1024 * 1024,
    1,
    MAX_DOCUMENT_BYTES,
    "IndexedDB cache maxDocumentBytes",
  );
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) throw new ProcPlantFiveTierAtlasIndexedDbCacheError("unavailable", "IndexedDB is unavailable");
  let databasePromise: Promise<IDBDatabase> | null = null;
  let database: IDBDatabase | null = null;
  let closed = false;

  const assertOpen = () => {
    if (closed) throw new ProcPlantFiveTierAtlasIndexedDbCacheError("closed", "five-tier atlas IndexedDB cache is closed");
  };
  const open = () => {
    assertOpen();
    if (databasePromise) return databasePromise;
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let rejected = false;
      try { request = factory.open(databaseName, DATABASE_VERSION); }
      catch (error) { reject(normalizeError(error, "open")); return; }
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        const assetStore = db.objectStoreNames.contains(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE)
          ? request.transaction!.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE)
          : db.createObjectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE, { keyPath: "slotKey" });
        if (!assetStore.indexNames.contains("sequence")) assetStore.createIndex("sequence", "sequence", { unique: true });
        if (!db.objectStoreNames.contains(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE)) {
          db.createObjectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE, { keyPath: "key" }).put(initialMeta());
        }
      });
      request.addEventListener("success", () => {
        if (rejected) { request.result.close(); return; }
        database = request.result;
        database.addEventListener("versionchange", () => {
          database?.close();
          database = null;
          databasePromise = null;
        });
        resolve(request.result);
      }, { once: true });
      request.addEventListener("error", () => reject(normalizeError(request.error, "open")), { once: true });
      request.addEventListener("blocked", () => {
        rejected = true;
        reject(new ProcPlantFiveTierAtlasIndexedDbCacheError(
          "unavailable", "five-tier atlas IndexedDB cache upgrade is blocked",
        ));
      }, { once: true });
    }).catch((error) => { databasePromise = null; throw error; });
    return databasePromise;
  };

  const readMeta = async (store: IDBObjectStore) => {
    const meta = validateMeta(await requestValue(store.get(META_KEY)));
    if (meta.entries > maxEntries || meta.documentBytes > maxDocumentBytes) {
      throw new ProcPlantFiveTierAtlasIndexedDbCacheError(
        "limit", "stored five-tier atlas IndexedDB cache exceeds this adapter's configured bounds",
      );
    }
    return meta;
  };

  return {
    async get(slotKey) {
      assertOpen();
      if (!validSlotKey(slotKey)) throw new ProcPlantFiveTierAtlasIndexedDbCacheError("limit", "IndexedDB cache slotKey is invalid");
      try {
        const db = await open();
        const transaction = db.transaction(
          [PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE, PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE],
          "readonly",
        );
        const metaPromise = readMeta(transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE));
        const assetValue = await requestValue(transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE).get(slotKey));
        await metaPromise;
        await transactionComplete(transaction);
        if (assetValue === undefined) return undefined;
        const asset = validateStoredAsset(assetValue, slotKey);
        return { cacheKey: asset.cacheKey, document: asset.document };
      } catch (error) { throw normalizeError(error, "get"); }
    },
    async set(slotKey, record) {
      assertOpen();
      if (!validSlotKey(slotKey) || !record || !validCacheKey(record.cacheKey) || typeof record.document !== "string") {
        throw new ProcPlantFiveTierAtlasIndexedDbCacheError("corrupt", "five-tier atlas IndexedDB cache input record is invalid");
      }
      const bytes = textEncoder.encode(record.document).byteLength;
      if (bytes < 1 || bytes > maxDocumentBytes) {
        throw new ProcPlantFiveTierAtlasIndexedDbCacheError("limit", "five-tier atlas IndexedDB cache record exceeds maxDocumentBytes");
      }
      try {
        const db = await open();
        const transaction = db.transaction(
          [PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE, PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE],
          "readwrite",
        );
        const assets = transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE);
        const metas = transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE);
        const meta = await readMeta(metas);
        if (meta.nextSequence >= Number.MAX_SAFE_INTEGER) {
          throw new ProcPlantFiveTierAtlasIndexedDbCacheError("limit", "five-tier atlas IndexedDB sequence is exhausted");
        }
        const priorValue = await requestValue(assets.get(slotKey));
        const prior = priorValue === undefined ? undefined : validateStoredAsset(priorValue, slotKey);
        if (prior) {
          meta.entries--;
          meta.documentBytes -= prior.documentBytes;
        }
        const asset: StoredAsset = {
          contract: PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_CONTRACT,
          version: PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_CACHE_VERSION,
          slotKey,
          cacheKey: record.cacheKey,
          document: record.document,
          documentBytes: bytes,
          sequence: meta.nextSequence++,
        };
        await requestValue(assets.put(asset));
        meta.entries++;
        meta.documentBytes += bytes;
        while (meta.entries > maxEntries || meta.documentBytes > maxDocumentBytes) {
          const candidateValue = await oldestAsset(assets.index("sequence"));
          const candidate = validateStoredAsset(candidateValue);
          await requestValue(assets.delete(candidate.slotKey));
          meta.entries--;
          meta.documentBytes -= candidate.documentBytes;
          meta.evictions++;
        }
        await requestValue(metas.put(meta));
        await transactionComplete(transaction);
      } catch (error) { throw normalizeError(error, "set"); }
    },
    async delete(slotKey) {
      assertOpen();
      if (!validSlotKey(slotKey)) throw new ProcPlantFiveTierAtlasIndexedDbCacheError("limit", "IndexedDB cache slotKey is invalid");
      try {
        const db = await open();
        const transaction = db.transaction(
          [PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE, PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE],
          "readwrite",
        );
        const assets = transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE);
        const metas = transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE);
        const meta = await readMeta(metas);
        const priorValue = await requestValue(assets.get(slotKey));
        if (priorValue !== undefined) {
          const prior = validateStoredAsset(priorValue, slotKey);
          await requestValue(assets.delete(slotKey));
          meta.entries--;
          meta.documentBytes -= prior.documentBytes;
          await requestValue(metas.put(meta));
        }
        await transactionComplete(transaction);
      } catch (error) { throw normalizeError(error, "delete"); }
    },
    async clear() {
      assertOpen();
      try {
        const db = await open();
        const transaction = db.transaction(
          [PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE, PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE],
          "readwrite",
        );
        await requestValue(transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_ASSET_STORE).clear());
        await requestValue(transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE).put(initialMeta()));
        await transactionComplete(transaction);
      } catch (error) { throw normalizeError(error, "clear"); }
    },
    async stats() {
      assertOpen();
      try {
        const db = await open();
        const transaction = db.transaction(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE, "readonly");
        const meta = await readMeta(transaction.objectStore(PROCPLANT_FIVE_TIER_ATLAS_INDEXED_DB_META_STORE));
        await transactionComplete(transaction);
        return {
          contract: meta.contract,
          version: meta.version,
          entries: meta.entries,
          documentBytes: meta.documentBytes,
          evictions: meta.evictions,
          maxEntries,
          maxDocumentBytes,
          databaseName,
          closed,
        };
      } catch (error) { throw normalizeError(error, "stats"); }
    },
    close() {
      if (closed) return;
      closed = true;
      database?.close();
      database = null;
      databasePromise = null;
    },
    dispose() {
      if (closed) return;
      closed = true;
      database?.close();
      database = null;
      databasePromise = null;
    },
  };
};
