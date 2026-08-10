import type { ProcPlantVisibilityView } from "./procplant-visibility-clusters";
import {
  PROCPLANT_WEBGPU_VISIBILITY_CLASSIFY_WGSL,
  PROCPLANT_WEBGPU_VISIBILITY_CONTRACT,
  PROCPLANT_WEBGPU_VISIBILITY_FINALIZE_WGSL,
  PROCPLANT_WEBGPU_VISIBILITY_RESET_WGSL,
  PROCPLANT_WEBGPU_VISIBILITY_VERSION,
  encodeProcPlantWebGpuVisibility,
  updateProcPlantWebGpuVisibilityView,
  type ProcPlantWebGpuLimits,
  type ProcPlantWebGpuVisibilityPlan,
  type ProcPlantWebGpuVisibilityReference,
} from "./procplant-webgpu-visibility";

const GPU_BUFFER_USAGE = Object.freeze({
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
});
const GPU_MAP_MODE_READ = 0x0001;
const DEFAULT_MAX_ALLOCATED_BYTES = 512 * 1024 * 1024;
const BUFFER_NAMES = ["parameters", "view", "input", "visibilityMask", "lodCounts", "output", "indirect"] as const;
type BufferName = typeof BUFFER_NAMES[number];

export interface ProcPlantGpuBufferLike {
  readonly size?: number;
  destroy(): void;
  mapAsync?(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange?(offset?: number, size?: number): ArrayBuffer;
  unmap?(): void;
}

export interface ProcPlantGpuComputePipelineLike {
  getBindGroupLayout(index: number): unknown;
}

export interface ProcPlantGpuComputePassLike {
  setPipeline(pipeline: any): void;
  setBindGroup(index: number, bindGroup: any): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface ProcPlantGpuCommandEncoderLike {
  beginComputePass(descriptor?: { label?: string }): ProcPlantGpuComputePassLike;
  copyBufferToBuffer?(
    source: ProcPlantGpuBufferLike,
    sourceOffset: number,
    destination: ProcPlantGpuBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): unknown;
}

export interface ProcPlantGpuRenderPassLike {
  drawIndexedIndirect(indirectBuffer: ProcPlantGpuBufferLike, indirectOffset: number): void;
}

export interface ProcPlantGpuQueueLike {
  writeBuffer(buffer: ProcPlantGpuBufferLike, bufferOffset: number, data: ArrayBufferView): void;
  submit(commandBuffers: readonly unknown[]): void;
}

export interface ProcPlantGpuDeviceLike {
  readonly limits: ProcPlantWebGpuLimits;
  readonly features?: { has(feature: string): boolean };
  readonly queue: ProcPlantGpuQueueLike;
  readonly lost?: Promise<{ reason?: string; message?: string }>;
  createBuffer(descriptor: any): ProcPlantGpuBufferLike;
  createShaderModule(descriptor: any): any;
  createComputePipeline?(descriptor: any): ProcPlantGpuComputePipelineLike;
  createComputePipelineAsync?(descriptor: any): Promise<ProcPlantGpuComputePipelineLike>;
  createBindGroup(descriptor: any): any;
  createCommandEncoder(descriptor?: any): ProcPlantGpuCommandEncoderLike;
}

export interface ProcPlantWebGpuVisibilityRuntimeOptions {
  label?: string;
  maxAllocatedBytes?: number;
  requiredFeatures?: readonly string[];
  signal?: AbortSignal;
  onDeviceLost?: (info: { reason?: string; message?: string }) => void;
}

export interface ProcPlantWebGpuVisibilityRuntimeBuffers {
  readonly parameters: ProcPlantGpuBufferLike;
  readonly view: ProcPlantGpuBufferLike;
  readonly input: ProcPlantGpuBufferLike;
  readonly visibilityMask: ProcPlantGpuBufferLike;
  readonly lodCounts: ProcPlantGpuBufferLike;
  readonly output: ProcPlantGpuBufferLike;
  readonly indirect: ProcPlantGpuBufferLike;
}

export interface ProcPlantWebGpuVisibilityReadback {
  readonly visibilityFlags: Uint32Array;
  readonly instanceLods: Int32Array;
  readonly lodCounts: Uint32Array;
  readonly lodInstanceIndices: Uint32Array;
  readonly indirectCommands: Uint32Array;
}

export interface ProcPlantWebGpuVisibilityComparison {
  readonly matches: boolean;
  readonly mismatchCount: number;
  readonly firstMismatch?: string;
}

export interface ProcPlantWebGpuVisibilityRuntimeDiagnostics {
  readonly state: "ready" | "lost" | "disposed";
  readonly planHash: string;
  readonly logicalBytes: number;
  readonly allocatedBytes: number;
  readonly dispatchCount: number;
  readonly submissionCount: number;
  readonly uploadBytes: number;
  readonly bufferRebuildCount: number;
  readonly readbackCount: number;
  readonly lostReason?: string;
}

export interface ProcPlantWebGpuVisibilityRuntime {
  readonly plan: ProcPlantWebGpuVisibilityPlan;
  readonly buffers: ProcPlantWebGpuVisibilityRuntimeBuffers;
  readonly diagnostics: ProcPlantWebGpuVisibilityRuntimeDiagnostics;
  setPlan(plan: ProcPlantWebGpuVisibilityPlan): void;
  /** Encode compute work into a caller-owned command encoder without submitting it. */
  encode(encoder: ProcPlantGpuCommandEncoderLike, view: ProcPlantVisibilityView, visibilityMask?: ArrayLike<number>): void;
  dispatch(view: ProcPlantVisibilityView, visibilityMask?: ArrayLike<number>): void;
  readback(target?: ProcPlantWebGpuVisibilityReadback): Promise<ProcPlantWebGpuVisibilityReadback>;
  dispose(): void;
}

interface BufferSlot {
  readonly buffer: ProcPlantGpuBufferLike;
  readonly capacity: number;
  readonly usage: number;
}

type BufferSlots = Record<BufferName, BufferSlot>;

const integer = (value: number, label: string, minimum: number, maximum: number) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
};

const usageFor = (name: BufferName) => {
  if (name === "parameters" || name === "view") return GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;
  if (name === "input" || name === "visibilityMask") return GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST;
  if (name === "lodCounts" || name === "output") {
    return GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;
  }
  return GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.INDIRECT | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;
};

const bufferRoleFor = (name: BufferName) => {
  if (name === "parameters" || name === "view") return "uniform";
  if (name === "input" || name === "visibilityMask") return "storage-read";
  if (name === "indirect") return "storage-indirect";
  return "storage-read-write";
};

const validatePlan = (plan: ProcPlantWebGpuVisibilityPlan) => {
  if (plan.contract !== PROCPLANT_WEBGPU_VISIBILITY_CONTRACT || plan.version !== PROCPLANT_WEBGPU_VISIBILITY_VERSION) {
    throw new Error("WebGPU visibility runtime requires procplants.webgpu-visibility v2");
  }
  if (plan.resetWgsl !== PROCPLANT_WEBGPU_VISIBILITY_RESET_WGSL ||
    plan.classifyWgsl !== PROCPLANT_WEBGPU_VISIBILITY_CLASSIFY_WGSL ||
    plan.finalizeWgsl !== PROCPLANT_WEBGPU_VISIBILITY_FINALIZE_WGSL) {
    throw new Error("WebGPU visibility runtime only accepts the audited built-in kernels");
  }
  integer(plan.instanceCount, "WebGPU runtime instanceCount", 0, 10_000_000);
  integer(plan.clusterCount, "WebGPU runtime clusterCount", 0, 1_000_000);
  integer(plan.lodCount, "WebGPU runtime lodCount", 1, 32);
  if (typeof plan.indirectFirstInstance !== "boolean") {
    throw new Error("WebGPU visibility runtime plan has a malformed indirectFirstInstance mode");
  }
  for (const name of BUFFER_NAMES) {
    const buffer = plan.buffers[name];
    if (buffer.role !== bufferRoleFor(name) || buffer.byteLength !== buffer.initialData.byteLength || buffer.byteLength < 4 || buffer.byteLength % 4 !== 0) {
      throw new Error(`WebGPU visibility runtime plan has a malformed ${name} buffer`);
    }
  }
};

const validateDevice = (
  device: ProcPlantGpuDeviceLike,
  plan: ProcPlantWebGpuVisibilityPlan,
  requiredFeatures: readonly string[],
) => {
  if (!device || !device.queue || typeof device.queue.writeBuffer !== "function" || typeof device.queue.submit !== "function" ||
    typeof device.createBuffer !== "function" || typeof device.createShaderModule !== "function" ||
    (!device.createComputePipeline && !device.createComputePipelineAsync) || typeof device.createBindGroup !== "function" ||
    typeof device.createCommandEncoder !== "function") {
    throw new Error("WebGPU visibility runtime requires a complete injected GPUDevice contract");
  }
  const featureSet = new Set<string>();
  for (const feature of requiredFeatures) {
    if (typeof feature !== "string" || feature.length === 0 || featureSet.has(feature)) {
      throw new Error("WebGPU visibility requiredFeatures must contain unique non-empty strings");
    }
    featureSet.add(feature);
    if (!device.features?.has(feature)) throw new Error(`WebGPU device is missing required feature ${feature}`);
  }
  if (plan.indirectFirstInstance && !device.features?.has("indirect-first-instance")) {
    throw new Error("WebGPU visibility plan requires the indirect-first-instance feature");
  }
  const limits = device.limits ?? {};
  const maxBufferSize = integer(limits.maxBufferSize ?? 0, "WebGPU device maxBufferSize", 4, 0xffffffff);
  const maxStorage = integer(limits.maxStorageBufferBindingSize ?? 0, "WebGPU device maxStorageBufferBindingSize", 4, 0xffffffff);
  const maxUniform = integer(limits.maxUniformBufferBindingSize ?? 0, "WebGPU device maxUniformBufferBindingSize", 4, 0xffffffff);
  const maxWorkgroups = integer(limits.maxComputeWorkgroupsPerDimension ?? 0, "WebGPU device maxComputeWorkgroupsPerDimension", 1, 65_535);
  const maxWorkgroupSizeX = integer(limits.maxComputeWorkgroupSizeX ?? 0, "WebGPU device maxComputeWorkgroupSizeX", 1, 0xffffffff);
  const maxInvocations = integer(limits.maxComputeInvocationsPerWorkgroup ?? 0, "WebGPU device maxComputeInvocationsPerWorkgroup", 1, 0xffffffff);
  const maxStorageBuffers = integer(limits.maxStorageBuffersPerShaderStage ?? 0, "WebGPU device maxStorageBuffersPerShaderStage", 0, 0xffffffff);
  const maxUniformBuffers = integer(limits.maxUniformBuffersPerShaderStage ?? 0, "WebGPU device maxUniformBuffersPerShaderStage", 0, 0xffffffff);
  const maxBindings = integer(limits.maxBindingsPerBindGroup ?? 0, "WebGPU device maxBindingsPerBindGroup", 0, 0xffffffff);
  if (plan.workgroupSize > maxWorkgroupSizeX || plan.workgroupSize > maxInvocations || maxStorageBuffers < 4 || maxUniformBuffers < 2 || maxBindings < 6) {
    throw new Error("WebGPU device limits cannot support the procplants visibility runtime");
  }
  for (const dispatch of Object.values(plan.dispatch)) {
    if (dispatch.x > maxWorkgroups || dispatch.y > maxWorkgroups || dispatch.z > maxWorkgroups) {
      throw new Error("WebGPU visibility dispatch exceeds the injected device limit");
    }
  }
  for (const name of BUFFER_NAMES) {
    const bytes = plan.buffers[name].byteLength;
    const bindingLimit = bufferRoleFor(name) === "uniform" ? maxUniform : maxStorage;
    if (bytes > maxBufferSize || bytes > bindingLimit) {
      throw new Error(`WebGPU ${name} buffer exceeds the injected device limit`);
    }
  }
};

const createPipeline = async (
  device: ProcPlantGpuDeviceLike,
  label: string,
  code: string,
  entryPoint: string,
) => {
  const module = device.createShaderModule({ label: `${label} ${entryPoint} module`, code });
  if (typeof module?.getCompilationInfo === "function") {
    const info = await module.getCompilationInfo();
    const errors = Array.from(info?.messages ?? []).filter((message: any) => message.type === "error");
    if (errors.length > 0) {
      const details = errors.slice(0, 8).map((message: any) => {
        const location = message.lineNum ? `:${message.lineNum}:${message.linePos ?? 0}` : "";
        return `${location} ${String(message.message ?? "WGSL compilation error")}`.trim();
      }).join("; ");
      throw new Error(`WebGPU ${entryPoint} shader compilation failed: ${details}`);
    }
  }
  const descriptor = {
    label: `${label} ${entryPoint} pipeline`,
    layout: "auto",
    compute: { module, entryPoint },
  };
  return device.createComputePipelineAsync
    ? device.createComputePipelineAsync(descriptor)
    : device.createComputePipeline!(descriptor);
};

const createReadbackTarget = (plan: ProcPlantWebGpuVisibilityPlan): ProcPlantWebGpuVisibilityReadback => Object.freeze({
  visibilityFlags: new Uint32Array(plan.instanceCount),
  instanceLods: new Int32Array(plan.instanceCount),
  lodCounts: new Uint32Array(plan.lodCount),
  lodInstanceIndices: new Uint32Array(plan.instanceCount * plan.lodCount),
  indirectCommands: new Uint32Array(plan.lodCount * 5),
});

const validateReadbackTarget = (plan: ProcPlantWebGpuVisibilityPlan, target: ProcPlantWebGpuVisibilityReadback) => {
  if (target.visibilityFlags.length !== plan.instanceCount || target.instanceLods.length !== plan.instanceCount ||
    target.lodCounts.length !== plan.lodCount || target.lodInstanceIndices.length !== plan.instanceCount * plan.lodCount ||
    target.indirectCommands.length !== plan.lodCount * 5) {
    throw new Error("WebGPU visibility readback target does not match the active plan");
  }
};

export const compareProcPlantWebGpuVisibilityReadback = (
  actual: ProcPlantWebGpuVisibilityReadback,
  expected: ProcPlantWebGpuVisibilityReference,
): ProcPlantWebGpuVisibilityComparison => {
  let mismatchCount = 0;
  let firstMismatch: string | undefined;
  const compare = (label: string, a: ArrayLike<number>, b: ArrayLike<number>) => {
    if (a.length !== b.length) {
      mismatchCount++;
      firstMismatch ??= `${label} length ${a.length} != ${b.length}`;
      return;
    }
    for (let index = 0; index < a.length; index++) {
      if (a[index] !== b[index]) {
        mismatchCount++;
        firstMismatch ??= `${label}[${index}] ${a[index]} != ${b[index]}`;
      }
    }
  };
  compare("visibilityFlags", actual.visibilityFlags, expected.visibilityFlags);
  compare("instanceLods", actual.instanceLods, expected.instanceLods);
  compare("lodCounts", actual.lodCounts, expected.lodCounts);
  compare("indirectCommands", actual.indirectCommands, expected.indirectCommands);
  if (actual.lodCounts.length === expected.lodCounts.length && actual.lodInstanceIndices.length === expected.lodInstanceIndices.length) {
    const instanceCount = expected.visibilityFlags.length;
    for (let lod = 0; lod < expected.lodCounts.length; lod++) {
      const count = expected.lodCounts[lod]!;
      const base = lod * instanceCount;
      const actualLane = Array.from(actual.lodInstanceIndices.subarray(base, base + count)).sort((a, b) => a - b);
      const expectedLane = Array.from(expected.lodInstanceIndices.subarray(base, base + count)).sort((a, b) => a - b);
      compare(`lodInstanceIndices[${lod}]`, actualLane, expectedLane);
    }
  } else {
    mismatchCount++;
    firstMismatch ??= "lodInstanceIndices layout does not match";
  }
  return Object.freeze({ matches: mismatchCount === 0, mismatchCount, ...(firstMismatch ? { firstMismatch } : {}) });
};

class VisibilityRuntime implements ProcPlantWebGpuVisibilityRuntime {
  private currentPlan: ProcPlantWebGpuVisibilityPlan;
  private slots!: BufferSlots;
  private readonly pipelines: {
    resetPipeline: ProcPlantGpuComputePipelineLike;
    classifyPipeline: ProcPlantGpuComputePipelineLike;
    finalizePipeline: ProcPlantGpuComputePipelineLike;
  };
  private bindGroups!: { resetBindGroup: unknown; classifyBindGroup: unknown; finalizeBindGroup: unknown };
  private viewScratch = new Float32Array(28);
  private maskScratch: Uint32Array;
  private readbackSlot: BufferSlot | null = null;
  private readbackInFlight = false;
  private state: "ready" | "lost" | "disposed" = "ready";
  private lostReason: string | undefined;
  private dispatchCount = 0;
  private submissionCount = 0;
  private uploadBytes = 0;
  private bufferRebuildCount = 0;
  private readbackCount = 0;
  private readonly abortHandler: () => void;

  constructor(
    private readonly device: ProcPlantGpuDeviceLike,
    plan: ProcPlantWebGpuVisibilityPlan,
    pipelines: VisibilityRuntime["pipelines"],
    private readonly label: string,
    private readonly maxAllocatedBytes: number,
    private readonly signal?: AbortSignal,
    onDeviceLost?: (info: { reason?: string; message?: string }) => void,
  ) {
    this.currentPlan = plan;
    this.pipelines = pipelines;
    this.maskScratch = new Uint32Array(plan.instanceCount);
    this.abortHandler = () => this.dispose();
    this.installPlan(plan, true);
    signal?.addEventListener("abort", this.abortHandler, { once: true });
    if (device.lost) {
      void device.lost.then((info) => {
        if (this.state !== "ready") return;
        this.state = "lost";
        this.lostReason = info.message || info.reason || "unknown";
        onDeviceLost?.(info);
      }).catch((error: unknown) => {
        if (this.state === "ready") {
          this.state = "lost";
          this.lostReason = error instanceof Error ? error.message : String(error);
        }
      });
    }
  }

  get plan() { return this.currentPlan; }

  get buffers(): ProcPlantWebGpuVisibilityRuntimeBuffers {
    return Object.freeze(Object.fromEntries(BUFFER_NAMES.map((name) => [name, this.slots[name].buffer]))) as unknown as ProcPlantWebGpuVisibilityRuntimeBuffers;
  }

  get diagnostics(): ProcPlantWebGpuVisibilityRuntimeDiagnostics {
    const allocatedBytes = BUFFER_NAMES.reduce((sum, name) => sum + this.slots[name].capacity, 0) + (this.readbackSlot?.capacity ?? 0);
    return Object.freeze({
      state: this.state,
      planHash: this.currentPlan.contentHash,
      logicalBytes: this.currentPlan.totalBytes,
      allocatedBytes,
      dispatchCount: this.dispatchCount,
      submissionCount: this.submissionCount,
      uploadBytes: this.uploadBytes,
      bufferRebuildCount: this.bufferRebuildCount,
      readbackCount: this.readbackCount,
      ...(this.lostReason ? { lostReason: this.lostReason } : {}),
    });
  }

  private assertReady() {
    if (this.state === "disposed") throw new Error("WebGPU visibility runtime is disposed");
    if (this.state === "lost") throw new Error(`WebGPU visibility runtime device is lost${this.lostReason ? `: ${this.lostReason}` : ""}`);
    if (this.signal?.aborted) {
      this.dispose();
      throw new Error("WebGPU visibility runtime was aborted");
    }
  }

  private createBindGroups(slots: BufferSlots) {
    const resource = (name: BufferName) => ({ buffer: slots[name].buffer });
    return {
      resetBindGroup: this.device.createBindGroup({
        label: `${this.label} reset bind group`,
        layout: this.pipelines.resetPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resource("parameters") },
          { binding: 1, resource: resource("lodCounts") },
          { binding: 2, resource: resource("output") },
        ],
      }),
      classifyBindGroup: this.device.createBindGroup({
        label: `${this.label} classify bind group`,
        layout: this.pipelines.classifyPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resource("parameters") },
          { binding: 1, resource: resource("view") },
          { binding: 2, resource: resource("input") },
          { binding: 3, resource: resource("visibilityMask") },
          { binding: 4, resource: resource("lodCounts") },
          { binding: 5, resource: resource("output") },
        ],
      }),
      finalizeBindGroup: this.device.createBindGroup({
        label: `${this.label} finalize bind group`,
        layout: this.pipelines.finalizePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resource("parameters") },
          { binding: 1, resource: resource("input") },
          { binding: 2, resource: resource("lodCounts") },
          { binding: 3, resource: resource("indirect") },
        ],
      }),
    };
  }

  private installPlan(plan: ProcPlantWebGpuVisibilityPlan, initial: boolean) {
    validatePlan(plan);
    validateDevice(this.device, plan, []);
    if (plan.totalBytes > this.maxAllocatedBytes) {
      throw new Error(`WebGPU visibility runtime exceeds maxAllocatedBytes (${plan.totalBytes} > ${this.maxAllocatedBytes})`);
    }
    const nextMaskScratch = new Uint32Array(plan.instanceCount);
    new Uint8Array(nextMaskScratch.buffer).set(plan.buffers.visibilityMask.initialData.subarray(0, nextMaskScratch.byteLength));
    const previous = initial ? undefined : this.slots;
    const replacements: Partial<BufferSlots> = {};
    const candidate = {} as BufferSlots;
    try {
      for (const name of BUFFER_NAMES) {
        const required = plan.buffers[name].byteLength;
        const usage = usageFor(name);
        const prior = previous?.[name];
        if (prior && prior.capacity >= required && prior.usage === usage) {
          candidate[name] = prior;
        } else {
          const slot = {
            buffer: this.device.createBuffer({ label: `${this.label} ${name}`, size: required, usage }),
            capacity: required,
            usage,
          };
          candidate[name] = slot;
          replacements[name] = slot;
        }
      }
      const coreAllocatedBytes = BUFFER_NAMES.reduce((sum, name) => sum + candidate[name].capacity, 0);
      if (coreAllocatedBytes > this.maxAllocatedBytes) {
        throw new Error(`WebGPU visibility runtime capacity exceeds maxAllocatedBytes (${coreAllocatedBytes} > ${this.maxAllocatedBytes})`);
      }
      const bindGroups = this.createBindGroups(candidate);
      for (const name of BUFFER_NAMES) {
        const data = plan.buffers[name].initialData;
        this.device.queue.writeBuffer(candidate[name].buffer, 0, data);
        this.uploadBytes += data.byteLength;
      }
      if (previous) {
        for (const name of BUFFER_NAMES) {
          if (candidate[name] !== previous[name]) previous[name].buffer.destroy();
        }
      }
      this.slots = candidate;
      this.bindGroups = bindGroups;
      this.currentPlan = plan;
      this.maskScratch = nextMaskScratch;
      if (this.readbackSlot && (this.readbackByteLength(plan) > this.readbackSlot.capacity ||
        coreAllocatedBytes + this.readbackSlot.capacity > this.maxAllocatedBytes)) {
        this.readbackSlot.buffer.destroy();
        this.readbackSlot = null;
      }
      if (!initial && Object.keys(replacements).length > 0) this.bufferRebuildCount++;
    } catch (error) {
      for (const slot of Object.values(replacements)) slot?.buffer.destroy();
      throw error;
    }
  }

  setPlan(plan: ProcPlantWebGpuVisibilityPlan) {
    this.assertReady();
    if (this.readbackInFlight) throw new Error("WebGPU visibility plan cannot change during readback");
    this.installPlan(plan, false);
  }

  encode(encoder: ProcPlantGpuCommandEncoderLike, view: ProcPlantVisibilityView, visibilityMask?: ArrayLike<number>) {
    this.assertReady();
    updateProcPlantWebGpuVisibilityView(this.viewScratch, view);
    if (visibilityMask) {
      if (visibilityMask.length !== this.currentPlan.instanceCount) throw new Error("WebGPU visibility mask must match instance count");
      for (let instance = 0; instance < this.maskScratch.length; instance++) {
        const value = Number(visibilityMask[instance]);
        if (!Number.isFinite(value)) throw new Error(`WebGPU visibility mask ${instance} must be finite`);
        this.maskScratch[instance] = value === 0 ? 0 : 1;
      }
    }
    this.assertReady();
    this.device.queue.writeBuffer(this.slots.view.buffer, 0, this.viewScratch);
    this.uploadBytes += this.viewScratch.byteLength;
    if (visibilityMask) {
      this.device.queue.writeBuffer(this.slots.visibilityMask.buffer, 0, this.maskScratch);
      this.uploadBytes += this.maskScratch.byteLength;
    }
    const pass = encoder.beginComputePass({ label: `${this.label} visibility compute` });
    encodeProcPlantWebGpuVisibility(pass, this.currentPlan, {
      ...this.pipelines,
      ...this.bindGroups,
    });
    pass.end();
    this.dispatchCount++;
  }

  dispatch(view: ProcPlantVisibilityView, visibilityMask?: ArrayLike<number>) {
    const encoder = this.device.createCommandEncoder({ label: `${this.label} dispatch ${this.dispatchCount + 1}` });
    this.encode(encoder, view, visibilityMask);
    this.device.queue.submit([encoder.finish()]);
    this.submissionCount++;
  }

  private readbackByteLength(plan: ProcPlantWebGpuVisibilityPlan) {
    return plan.buffers.output.byteLength + plan.buffers.lodCounts.byteLength + plan.buffers.indirect.byteLength;
  }

  private ensureReadbackSlot() {
    const required = this.readbackByteLength(this.currentPlan);
    if (this.readbackSlot && this.readbackSlot.capacity >= required) return this.readbackSlot;
    const currentBytes = BUFFER_NAMES.reduce((sum, name) => sum + this.slots[name].capacity, 0);
    if (currentBytes + required > this.maxAllocatedBytes) {
      throw new Error(`WebGPU visibility readback exceeds maxAllocatedBytes (${currentBytes + required} > ${this.maxAllocatedBytes})`);
    }
    const next = {
      buffer: this.device.createBuffer({
        label: `${this.label} readback`,
        size: required,
        usage: GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
      }),
      capacity: required,
      usage: GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
    };
    this.readbackSlot?.buffer.destroy();
    this.readbackSlot = next;
    return next;
  }

  async readback(target = createReadbackTarget(this.currentPlan)) {
    this.assertReady();
    if (this.readbackInFlight) throw new Error("WebGPU visibility readback is already in flight");
    validateReadbackTarget(this.currentPlan, target);
    const plan = this.currentPlan;
    const slot = this.ensureReadbackSlot();
    if (!slot.buffer.mapAsync || !slot.buffer.getMappedRange || !slot.buffer.unmap) {
      throw new Error("Injected WebGPU buffer does not support visibility readback mapping");
    }
    const outputOffset = 0;
    const countsOffset = plan.buffers.output.byteLength;
    const indirectOffset = countsOffset + plan.buffers.lodCounts.byteLength;
    const byteLength = this.readbackByteLength(plan);
    const encoder = this.device.createCommandEncoder({ label: `${this.label} readback ${this.readbackCount + 1}` });
    if (!encoder.copyBufferToBuffer) throw new Error("Injected GPUCommandEncoder does not support visibility readback copies");
    encoder.copyBufferToBuffer(this.slots.output.buffer, 0, slot.buffer, outputOffset, plan.buffers.output.byteLength);
    encoder.copyBufferToBuffer(this.slots.lodCounts.buffer, 0, slot.buffer, countsOffset, plan.buffers.lodCounts.byteLength);
    encoder.copyBufferToBuffer(this.slots.indirect.buffer, 0, slot.buffer, indirectOffset, plan.buffers.indirect.byteLength);
    this.device.queue.submit([encoder.finish()]);
    this.submissionCount++;
    this.readbackInFlight = true;
    try {
      await slot.buffer.mapAsync(GPU_MAP_MODE_READ, 0, byteLength);
      this.assertReady();
      if (this.currentPlan !== plan) throw new Error("WebGPU visibility plan changed during readback");
      const mapped = slot.buffer.getMappedRange(0, byteLength);
      const output = new Uint32Array(mapped, outputOffset, plan.buffers.output.byteLength / 4);
      const counts = new Uint32Array(mapped, countsOffset, plan.lodCount);
      const indirect = new Uint32Array(mapped, indirectOffset, plan.lodCount * 5);
      target.visibilityFlags.set(output.subarray(plan.offsets.output.visibilityFlags, plan.offsets.output.instanceLods));
      target.instanceLods.set(new Int32Array(mapped, outputOffset + plan.offsets.output.instanceLods * 4, plan.instanceCount));
      target.lodInstanceIndices.set(output.subarray(plan.offsets.output.lodInstanceIndices));
      target.lodCounts.set(counts);
      target.indirectCommands.set(indirect);
      this.readbackCount++;
      return target;
    } finally {
      slot.buffer.unmap();
      this.readbackInFlight = false;
    }
  }

  dispose() {
    if (this.state === "disposed") return;
    this.state = "disposed";
    this.signal?.removeEventListener("abort", this.abortHandler);
    if (this.slots) for (const name of BUFFER_NAMES) this.slots[name].buffer.destroy();
    this.readbackSlot?.buffer.destroy();
    this.readbackSlot = null;
  }
}

export const createProcPlantWebGpuVisibilityRuntime = async (
  device: ProcPlantGpuDeviceLike,
  plan: ProcPlantWebGpuVisibilityPlan,
  options: ProcPlantWebGpuVisibilityRuntimeOptions = {},
): Promise<ProcPlantWebGpuVisibilityRuntime> => {
  validatePlan(plan);
  const maxAllocatedBytes = integer(options.maxAllocatedBytes ?? DEFAULT_MAX_ALLOCATED_BYTES, "WebGPU runtime maxAllocatedBytes", 4, 0xffffffff);
  const requiredFeatures = options.requiredFeatures ?? [];
  if (requiredFeatures.length > 32) throw new Error("WebGPU visibility runtime accepts at most 32 required features");
  if (options.signal?.aborted) throw new Error("WebGPU visibility runtime was aborted before creation");
  validateDevice(device, plan, requiredFeatures);
  const label = options.label?.trim() || "procplants WebGPU visibility";
  const [resetPipeline, classifyPipeline, finalizePipeline] = await Promise.all([
    createPipeline(device, label, plan.resetWgsl, "reset"),
    createPipeline(device, label, plan.classifyWgsl, "classify"),
    createPipeline(device, label, plan.finalizeWgsl, "finalize"),
  ]);
  if (options.signal?.aborted) throw new Error("WebGPU visibility runtime was aborted during creation");
  return new VisibilityRuntime(
    device,
    plan,
    { resetPipeline, classifyPipeline, finalizePipeline },
    label,
    maxAllocatedBytes,
    options.signal,
    options.onDeviceLost,
  );
};
