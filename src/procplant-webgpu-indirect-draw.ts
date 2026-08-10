import {
  PROCPLANT_WEBGPU_VISIBILITY_CONTRACT,
  PROCPLANT_WEBGPU_VISIBILITY_VERSION,
  type ProcPlantWebGpuVisibilityPlan,
} from "./procplant-webgpu-visibility";
import type {
  ProcPlantGpuBufferLike,
  ProcPlantGpuRenderPassLike,
  ProcPlantWebGpuVisibilityRuntime,
} from "./procplant-webgpu-visibility-runtime";

export const PROCPLANT_WEBGPU_INDIRECT_DRAW_CONTRACT = "procplants.webgpu-indexed-indirect-draw" as const;
export const PROCPLANT_WEBGPU_INDIRECT_DRAW_VERSION = 1 as const;
export const PROCPLANT_WEBGPU_INDEXED_INDIRECT_STRIDE_BYTES = 20 as const;

export interface ProcPlantWebGpuIndexedIndirectLodBinding {
  readonly lod: number;
  /** Borrowed runtime output buffer. The draw encoder never destroys it. */
  readonly compactedInstanceIndexBuffer: ProcPlantGpuBufferLike;
  /** Absolute u32 offset to add to @builtin(instance_index) in a storage-buffer lookup. */
  readonly compactedInstanceIndexWordOffset: number;
  readonly compactedInstanceIndexByteOffset: number;
  readonly instanceCapacity: number;
  /** Borrowed runtime indirect buffer. The draw encoder never destroys it. */
  readonly indirectBuffer: ProcPlantGpuBufferLike;
  readonly indirectByteOffset: number;
  readonly indirectByteLength: typeof PROCPLANT_WEBGPU_INDEXED_INDIRECT_STRIDE_BYTES;
  readonly firstInstance: number;
}

export interface ProcPlantWebGpuIndexedIndirectDrawDiagnostics {
  readonly state: "ready" | "disposed";
  readonly planHash: string;
  readonly lodCount: number;
  readonly encodedPassCount: number;
  readonly encodedDrawCount: number;
  readonly ownsGpuResources: false;
  readonly indirectFirstInstance: boolean;
}

export interface ProcPlantWebGpuIndexedIndirectDrawEncoder {
  readonly contract: typeof PROCPLANT_WEBGPU_INDIRECT_DRAW_CONTRACT;
  readonly version: typeof PROCPLANT_WEBGPU_INDIRECT_DRAW_VERSION;
  readonly diagnostics: ProcPlantWebGpuIndexedIndirectDrawDiagnostics;
  /**
   * Encode one drawIndexedIndirect call per LOD. `prepareLod` must bind that
   * LOD's render pipeline, index/vertex buffers, and compacted-index storage
   * view before returning.
   */
  encode(
    pass: ProcPlantGpuRenderPassLike,
    prepareLod: (binding: ProcPlantWebGpuIndexedIndirectLodBinding) => void,
  ): void;
  /** Invalidates this borrowed-resource view; it does not destroy runtime buffers. */
  dispose(): void;
}

const validatePlan = (plan: ProcPlantWebGpuVisibilityPlan) => {
  if (plan.contract !== PROCPLANT_WEBGPU_VISIBILITY_CONTRACT || plan.version !== PROCPLANT_WEBGPU_VISIBILITY_VERSION) {
    throw new Error("WebGPU indirect draw encoder requires procplants.webgpu-visibility v2");
  }
  if (!Number.isInteger(plan.lodCount) || plan.lodCount < 1 || plan.lodCount > 32) {
    throw new Error("WebGPU indirect draw encoder requires 1-32 LODs");
  }
  if (!Number.isInteger(plan.instanceCount) || plan.instanceCount < 0 || plan.instanceCount > 10_000_000) {
    throw new Error("WebGPU indirect draw encoder has an invalid instance count");
  }
  if (typeof plan.indirectFirstInstance !== "boolean") {
    throw new Error("WebGPU indirect draw encoder has an invalid first-instance mode");
  }
  const expectedIndirectBytes = plan.lodCount * PROCPLANT_WEBGPU_INDEXED_INDIRECT_STRIDE_BYTES;
  if (plan.buffers.indirect.role !== "storage-indirect" || plan.buffers.indirect.byteLength !== expectedIndirectBytes) {
    throw new Error("WebGPU indirect draw encoder requires tightly packed 20-byte indexed commands");
  }
  const compactedWords = plan.instanceCount * plan.lodCount;
  if (plan.offsets.output.lodInstanceIndices + compactedWords > plan.buffers.output.byteLength / 4) {
    throw new Error("WebGPU indirect draw encoder compacted-index lanes exceed the output buffer");
  }
};

type MutableBinding = {
  -readonly [Key in keyof ProcPlantWebGpuIndexedIndirectLodBinding]: ProcPlantWebGpuIndexedIndirectLodBinding[Key];
};

class IndexedIndirectDrawEncoder implements ProcPlantWebGpuIndexedIndirectDrawEncoder {
  readonly contract = PROCPLANT_WEBGPU_INDIRECT_DRAW_CONTRACT;
  readonly version = PROCPLANT_WEBGPU_INDIRECT_DRAW_VERSION;
  private readonly plan: ProcPlantWebGpuVisibilityPlan;
  private readonly bindings: MutableBinding[];
  private state: "ready" | "disposed" = "ready";
  private encodedPassCount = 0;
  private encodedDrawCount = 0;

  constructor(private readonly runtime: ProcPlantWebGpuVisibilityRuntime) {
    this.plan = runtime.plan;
    validatePlan(this.plan);
    const buffers = runtime.buffers;
    this.bindings = Array.from({ length: this.plan.lodCount }, (_, lod) => {
      const firstInstance = this.plan.indirectFirstInstance ? lod * this.plan.instanceCount : 0;
      const laneOffset = this.plan.indirectFirstInstance ? 0 : lod * this.plan.instanceCount;
      return Object.seal({
        lod,
        compactedInstanceIndexBuffer: buffers.output,
        compactedInstanceIndexWordOffset: this.plan.offsets.output.lodInstanceIndices + laneOffset,
        compactedInstanceIndexByteOffset: (this.plan.offsets.output.lodInstanceIndices + laneOffset) * 4,
        instanceCapacity: this.plan.instanceCount,
        indirectBuffer: buffers.indirect,
        indirectByteOffset: lod * PROCPLANT_WEBGPU_INDEXED_INDIRECT_STRIDE_BYTES,
        indirectByteLength: PROCPLANT_WEBGPU_INDEXED_INDIRECT_STRIDE_BYTES,
        firstInstance,
      });
    });
  }

  get diagnostics(): ProcPlantWebGpuIndexedIndirectDrawDiagnostics {
    return Object.freeze({
      state: this.state,
      planHash: this.plan.contentHash,
      lodCount: this.plan.lodCount,
      encodedPassCount: this.encodedPassCount,
      encodedDrawCount: this.encodedDrawCount,
      ownsGpuResources: false,
      indirectFirstInstance: this.plan.indirectFirstInstance,
    });
  }

  encode(
    pass: ProcPlantGpuRenderPassLike,
    prepareLod: (binding: ProcPlantWebGpuIndexedIndirectLodBinding) => void,
  ) {
    if (this.state === "disposed") throw new Error("WebGPU indirect draw encoder is disposed");
    if (!pass || typeof pass.drawIndexedIndirect !== "function") {
      throw new Error("WebGPU indirect draw encoder requires a render pass with drawIndexedIndirect");
    }
    if (typeof prepareLod !== "function") throw new Error("WebGPU indirect draw encoder requires a prepareLod callback");
    const runtimeDiagnostics = this.runtime.diagnostics;
    if (runtimeDiagnostics.state !== "ready") {
      throw new Error(`WebGPU indirect draw encoder runtime is ${runtimeDiagnostics.state}`);
    }
    if (this.runtime.plan.contentHash !== this.plan.contentHash ||
      this.runtime.plan.indirectFirstInstance !== this.plan.indirectFirstInstance) {
      throw new Error("WebGPU indirect draw encoder plan changed; create a new encoder");
    }

    // Re-read borrowed buffers on every pass. A same-hash plan reinstall may
    // legally replace capacity while preserving command semantics.
    const buffers = this.runtime.buffers;
    for (const binding of this.bindings) {
      binding.compactedInstanceIndexBuffer = buffers.output;
      binding.indirectBuffer = buffers.indirect;
      prepareLod(binding);
      pass.drawIndexedIndirect(binding.indirectBuffer, binding.indirectByteOffset);
      this.encodedDrawCount++;
    }
    this.encodedPassCount++;
  }

  dispose() {
    this.state = "disposed";
  }
}

export const createProcPlantWebGpuIndexedIndirectDrawEncoder = (
  runtime: ProcPlantWebGpuVisibilityRuntime,
): ProcPlantWebGpuIndexedIndirectDrawEncoder => {
  if (!runtime || !runtime.plan || !runtime.buffers || !runtime.diagnostics) {
    throw new Error("WebGPU indirect draw encoder requires a visibility runtime");
  }
  if (runtime.diagnostics.state !== "ready") {
    throw new Error(`WebGPU indirect draw encoder runtime is ${runtime.diagnostics.state}`);
  }
  return new IndexedIndirectDrawEncoder(runtime);
};
