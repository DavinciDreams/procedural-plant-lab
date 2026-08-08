import {
  compileProcPlantLods,
  type ProcPlantCompiledLod,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
} from "./procplants";

interface LodWorkerRequest {
  id: number;
  genome: ProcPlantGenome;
  seed: number;
  env: ProcPlantEnvironment;
}

interface LodWorkerResponse {
  id: number;
  lods?: ProcPlantCompiledLod[];
  error?: string;
}

const transferBuffersForLods = (lods: ProcPlantCompiledLod[]) => lods.flatMap(({ template }) => [
  template.pos.buffer,
  template.nrm.buffer,
  template.uv0.buffer,
  template.col.buffer,
  template.tintable.buffer,
  template.sway.buffer,
  template.idx.buffer,
]);

type LodWorkerScope = {
  addEventListener: (type: "message", listener: (event: MessageEvent<LodWorkerRequest>) => void) => void;
  postMessage: (message: LodWorkerResponse, options?: { transfer: ArrayBuffer[] }) => void;
};
const possibleWorkerScope = globalThis as unknown as Partial<LodWorkerScope>;
const isDedicatedWorkerScope =
  typeof document === "undefined"
  && typeof possibleWorkerScope.addEventListener === "function"
  && typeof possibleWorkerScope.postMessage === "function";

// Vite builds this module a second time as the dedicated compiler worker. The
// function guard keeps controller imports safe in Node and SSR environments.
if (isDedicatedWorkerScope) {
  const workerScope = possibleWorkerScope as LodWorkerScope;
  workerScope.addEventListener("message", (event) => {
    const { id, genome, seed, env } = event.data;
    try {
      const lods = compileProcPlantLods(genome, seed, env);
      workerScope.postMessage({ id, lods }, { transfer: transferBuffersForLods(lods) as ArrayBuffer[] });
    } catch (error) {
      workerScope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

const cacheKeyFor = (genome: ProcPlantGenome, seed: number, env: ProcPlantEnvironment) =>
  JSON.stringify([seed, env, genome]);

export class ProcPlantLodCompiler {
  private worker: Worker | null = null;
  private nextRequestId = 0;
  private readonly pending = new Map<number, {
    key: string;
    resolve: (lods: ProcPlantCompiledLod[]) => void;
    reject: (error: Error) => void;
  }>();
  private readonly cache = new Map<string, ProcPlantCompiledLod[]>();

  compile(genome: ProcPlantGenome, seed: number, env: ProcPlantEnvironment): Promise<ProcPlantCompiledLod[]> {
    const key = cacheKeyFor(genome, seed, env);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    if (this.pending.size > 0) this.cancelPending(new DOMException("Hero LOD compile superseded.", "AbortError"));
    const worker = this.ensureWorker();
    const id = ++this.nextRequestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { key, resolve, reject });
      worker.postMessage({ id, genome, seed, env } satisfies LodWorkerRequest);
    });
  }

  dispose() {
    this.cancelPending(new Error("ProcPlant LOD compiler disposed."));
    this.cache.clear();
  }

  private cancelPending(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./procplant-lod.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<LodWorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.error || !event.data.lods) {
        pending.reject(new Error(event.data.error ?? "LOD compiler returned incomplete data."));
        return;
      }
      this.cache.set(pending.key, event.data.lods);
      while (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value!);
      pending.resolve(event.data.lods);
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "ProcPlant LOD compiler worker failed.");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    return worker;
  }
}

export class ProcPlantLodController {
  private activeIndex = 0;

  constructor(
    private readonly lods: readonly ProcPlantCompiledLod[],
    initialDistance: number,
    private readonly hysteresis = 0.12,
  ) {
    for (let i = 1; i < lods.length; i++) {
      if (initialDistance >= lods[i].distance) this.activeIndex = i;
    }
  }

  get index() {
    return this.activeIndex;
  }

  get active() {
    return this.lods[this.activeIndex];
  }

  update(distance: number) {
    const previous = this.activeIndex;
    while (
      this.activeIndex < this.lods.length - 1
      && distance >= this.lods[this.activeIndex + 1].distance * (1 + this.hysteresis)
    ) {
      this.activeIndex++;
    }
    while (
      this.activeIndex > 0
      && distance < this.lods[this.activeIndex].distance * (1 - this.hysteresis)
    ) {
      this.activeIndex--;
    }
    return previous !== this.activeIndex;
  }
}

export type { ProcPlantCompiledLod };
