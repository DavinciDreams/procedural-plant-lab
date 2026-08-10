import assert from "node:assert/strict";
import {
  buildProcPlantVisibilityClusters,
  createProcPlantVisibilityView,
} from "../src/procplant-visibility-clusters";
import {
  createProcPlantWebGpuVisibilityPlan,
  encodeProcPlantWebGpuVisibility,
  referenceProcPlantWebGpuVisibility,
  updateProcPlantWebGpuVisibilityView,
} from "../src/procplant-webgpu-visibility";
import {
  compareProcPlantWebGpuVisibilityReadback,
  createProcPlantWebGpuVisibilityRuntime,
  type ProcPlantGpuBufferLike,
  type ProcPlantGpuCommandEncoderLike,
  type ProcPlantGpuComputePassLike,
  type ProcPlantGpuComputePipelineLike,
  type ProcPlantGpuDeviceLike,
} from "../src/procplant-webgpu-visibility-runtime";

const centers = new Float32Array([0, 0, 0, 5, 0, 0, 20, 0, 0]);
const radii = new Float32Array([0.1, 0.1, 0.1]);
const centersSnapshot = centers.slice();
const clusters = buildProcPlantVisibilityClusters({ centers, radii }, { cellSize: 4, maxInstancesPerCluster: 2 });
const lodDistances = [0, 3, 8];
const draws = [
  { indexCount: 120, firstIndex: 0, baseVertex: 0 },
  { indexCount: 48, firstIndex: 120, baseVertex: 4 },
  { indexCount: 12, firstIndex: 168, baseVertex: -2 },
];
const planes = [
  1, 0, 0, 10, -1, 0, 0, 10,
  0, 1, 0, 10, 0, -1, 0, 10,
  0, 0, 1, 10, 0, 0, -1, 10,
];
const view = createProcPlantVisibilityView(planes, [0, 0, 0], 12);

const first = createProcPlantWebGpuVisibilityPlan(clusters, lodDistances, draws);
const second = createProcPlantWebGpuVisibilityPlan(clusters, lodDistances, draws);
assert.equal(first.contentHash, second.contentHash);
assert.equal(first.instanceCount, 3);
assert.equal(first.lodCount, 3);
assert.equal(first.buffers.parameters.byteLength, 96);
assert.equal(first.buffers.view.byteLength, 112);
assert.ok(first.totalBytes > 0);
assert.match(first.classifyWgsl, /atomicAdd/);
assert.match(first.finalizeWgsl, /indirect/);
assert.deepEqual(centers, centersSnapshot, "plan creation must not mutate placement data");

const uniform = new Float32Array(28);
assert.strictEqual(updateProcPlantWebGpuVisibilityView(uniform, view), uniform);
assert.deepEqual(Array.from(uniform.slice(24, 27)), [0, 0, 0]);
assert.equal(uniform[27], 12);

const reference = referenceProcPlantWebGpuVisibility(clusters, lodDistances, draws, view);
assert.deepEqual(Array.from(reference.visibilityFlags), [1, 1, 0]);
assert.deepEqual(Array.from(reference.instanceLods), [0, 1, -1]);
assert.deepEqual(Array.from(reference.lodCounts), [1, 1, 0]);
assert.deepEqual(Array.from(reference.indirectCommands), [
  120, 1, 0, 0, 0,
  48, 1, 120, 4, 3,
  12, 0, 168, 0xfffffffe, 6,
]);
const masked = referenceProcPlantWebGpuVisibility(clusters, lodDistances, draws, view, [1, 0, 1]);
assert.deepEqual(Array.from(masked.visibilityFlags), [1, 0, 0]);

const calls: string[] = [];
encodeProcPlantWebGpuVisibility({
  setPipeline: (pipeline) => calls.push(`pipeline:${String(pipeline)}`),
  setBindGroup: (index, bindGroup) => calls.push(`bind:${index}:${String(bindGroup)}`),
  dispatchWorkgroups: (x, y = 1, z = 1) => calls.push(`dispatch:${x},${y},${z}`),
}, first, {
  resetPipeline: "reset", resetBindGroup: "reset-group",
  classifyPipeline: "classify", classifyBindGroup: "classify-group",
  finalizePipeline: "finalize", finalizeBindGroup: "finalize-group",
});
assert.deepEqual(calls.filter((call) => call.startsWith("pipeline:")), [
  "pipeline:reset", "pipeline:classify", "pipeline:finalize",
]);
assert.equal(calls.filter((call) => call.startsWith("dispatch:")).length, 3);

assert.throws(
  () => createProcPlantWebGpuVisibilityPlan(clusters, lodDistances, draws, { visibilityMask: [1, Number.NaN, 1] }),
  /must be finite/,
);
assert.throws(
  () => createProcPlantWebGpuVisibilityPlan(clusters, lodDistances, draws, { limits: { maxUniformBufferBindingSize: 64 } }),
  /uniform buffer exceeds/,
);
assert.throws(
  () => createProcPlantWebGpuVisibilityPlan(clusters, [0, 0], draws.slice(0, 2)),
  /strictly increase/,
);

class FakeBuffer implements ProcPlantGpuBufferLike {
  readonly bytes: Uint8Array;
  destroyed = 0;
  mapped = false;

  constructor(readonly size: number, readonly usage: number, readonly label = "") {
    this.bytes = new Uint8Array(size);
  }

  destroy() { this.destroyed++; }
  async mapAsync() { this.mapped = true; }
  getMappedRange(offset = 0, size = this.size - offset) {
    assert.equal(this.mapped, true, "readback buffers must be mapped before access");
    assert.equal(offset, 0);
    assert.equal(size, this.size);
    return this.bytes.buffer;
  }
  unmap() { this.mapped = false; }
}

interface FakeCommandBuffer { readonly operations: readonly (() => void)[] }

class FakeComputePass implements ProcPlantGpuComputePassLike {
  constructor(private readonly calls: string[]) {}
  setPipeline(pipeline: unknown) { this.calls.push(`pipeline:${String((pipeline as { label?: string }).label)}`); }
  setBindGroup(index: number, bindGroup: unknown) { this.calls.push(`bind:${index}:${String((bindGroup as { label?: string }).label)}`); }
  dispatchWorkgroups(x: number, y = 1, z = 1) { this.calls.push(`dispatch:${x},${y},${z}`); }
  end() { this.calls.push("end"); }
}

class FakeCommandEncoder implements ProcPlantGpuCommandEncoderLike {
  readonly operations: (() => void)[] = [];
  constructor(private readonly calls: string[]) {}
  beginComputePass() { this.calls.push("begin"); return new FakeComputePass(this.calls); }
  copyBufferToBuffer(source: ProcPlantGpuBufferLike, sourceOffset: number, destination: ProcPlantGpuBufferLike, destinationOffset: number, size: number) {
    const sourceBuffer = source as FakeBuffer;
    const destinationBuffer = destination as FakeBuffer;
    this.calls.push(`copy:${sourceOffset}:${destinationOffset}:${size}`);
    this.operations.push(() => destinationBuffer.bytes.set(sourceBuffer.bytes.subarray(sourceOffset, sourceOffset + size), destinationOffset));
  }
  finish(): FakeCommandBuffer { this.calls.push("finish"); return { operations: this.operations }; }
}

class FakePipeline implements ProcPlantGpuComputePipelineLike {
  constructor(readonly label: string) {}
  getBindGroupLayout(index: number) { assert.equal(index, 0); return `${this.label}:layout`; }
}

const fullLimits = {
  maxBufferSize: 128 * 1024 * 1024,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxUniformBufferBindingSize: 64 * 1024,
  maxComputeWorkgroupsPerDimension: 65_535,
  maxComputeWorkgroupSizeX: 256,
  maxComputeInvocationsPerWorkgroup: 256,
  maxStorageBuffersPerShaderStage: 8,
  maxUniformBuffersPerShaderStage: 12,
  maxBindingsPerBindGroup: 8,
};

class FakeDevice implements ProcPlantGpuDeviceLike {
  readonly buffers: FakeBuffer[] = [];
  readonly calls: string[] = [];
  readonly features = { has: (feature: string) => feature === "timestamp-query" };
  readonly queue = {
    writeBuffer: (buffer: ProcPlantGpuBufferLike, bufferOffset: number, data: ArrayBufferView) => {
      const target = buffer as FakeBuffer;
      target.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), bufferOffset);
      this.calls.push(`write:${target.label}:${data.byteLength}`);
    },
    submit: (commandBuffers: readonly unknown[]) => {
      for (const command of commandBuffers as readonly FakeCommandBuffer[]) {
        for (const operation of command.operations) operation();
      }
      this.calls.push(`submit:${commandBuffers.length}`);
    },
  };

  constructor(readonly limits = fullLimits) {}
  createBuffer(descriptor: { label?: string; size: number; usage: number }) {
    const buffer = new FakeBuffer(descriptor.size, descriptor.usage, descriptor.label);
    this.buffers.push(buffer);
    this.calls.push(`buffer:${descriptor.label}:${descriptor.size}:${descriptor.usage}`);
    return buffer;
  }
  createShaderModule(descriptor: { label?: string; code: string }) {
    assert.match(descriptor.code, /@compute/);
    return { label: descriptor.label, code: descriptor.code };
  }
  async createComputePipelineAsync(descriptor: { label?: string }) {
    this.calls.push(`compile:${descriptor.label}`);
    return new FakePipeline(descriptor.label ?? "pipeline");
  }
  createBindGroup(descriptor: { label?: string; entries: readonly unknown[] }) {
    this.calls.push(`group:${descriptor.label}:${descriptor.entries.length}`);
    return { label: descriptor.label };
  }
  createCommandEncoder() { return new FakeCommandEncoder(this.calls); }
}

const device = new FakeDevice();
const inputSnapshot = first.buffers.input.initialData.slice();
const runtime = await createProcPlantWebGpuVisibilityRuntime(device, first, {
  label: "visibility test",
  requiredFeatures: ["timestamp-query"],
});
assert.deepEqual(first.buffers.input.initialData, inputSnapshot, "runtime creation must not mutate plan inputs");
assert.equal(device.buffers.length, 7, "runtime should own exactly the seven planned buffers before readback");
assert.equal(runtime.diagnostics.state, "ready");
assert.equal(runtime.diagnostics.allocatedBytes, first.totalBytes);
assert.equal((runtime.buffers.indirect as FakeBuffer).usage & 0x100, 0x100, "indirect result must have INDIRECT usage");
assert.equal((runtime.buffers.output as FakeBuffer).usage & 0x4, 0x4, "output must support readback copies");

runtime.dispatch(view, [1, 1, 1]);
assert.equal(runtime.diagnostics.dispatchCount, 1);
assert.equal(device.buffers.length, 7, "steady-state dispatch must not allocate GPU buffers");
assert.equal(device.calls.filter((call) => call.startsWith("dispatch:")).length, 3);
assert.deepEqual(device.calls.filter((call) => call.startsWith("pipeline:")).slice(-3), [
  "pipeline:visibility test reset pipeline",
  "pipeline:visibility test classify pipeline",
  "pipeline:visibility test finalize pipeline",
]);
const writesBeforeInvalidDispatch = device.calls.filter((call) => call.startsWith("write:")).length;
assert.throws(() => runtime.dispatch(view, [1, Number.NaN, 1]), /must be finite/);
assert.equal(device.calls.filter((call) => call.startsWith("write:")).length, writesBeforeInvalidDispatch,
  "invalid dispatch input must fail before mutating GPU buffers");

const outputWords = new Uint32Array(first.buffers.output.byteLength / 4);
outputWords.set(reference.visibilityFlags, first.offsets.output.visibilityFlags);
new Int32Array(outputWords.buffer, first.offsets.output.instanceLods * 4, first.instanceCount).set(reference.instanceLods);
outputWords.set(reference.lodInstanceIndices, first.offsets.output.lodInstanceIndices);
device.queue.writeBuffer(runtime.buffers.output, 0, outputWords);
device.queue.writeBuffer(runtime.buffers.lodCounts, 0, reference.lodCounts);
device.queue.writeBuffer(runtime.buffers.indirect, 0, reference.indirectCommands);
const gpuResult = await runtime.readback();
assert.deepEqual(compareProcPlantWebGpuVisibilityReadback(gpuResult, reference), { matches: true, mismatchCount: 0 });
const mismatched = { ...gpuResult, visibilityFlags: gpuResult.visibilityFlags.slice() };
mismatched.visibilityFlags[0] = 0;
assert.equal(compareProcPlantWebGpuVisibilityReadback(mismatched, reference).matches, false);
assert.equal(runtime.diagnostics.readbackCount, 1);
assert.equal(device.buffers.length, 8, "readback should lazily allocate one reusable staging buffer");

const bufferCountBeforeReuse = device.buffers.length;
runtime.setPlan(first);
assert.equal(device.buffers.length, bufferCountBeforeReuse, "same-sized plan rebuild must reuse owned GPU buffers");
assert.equal(runtime.diagnostics.bufferRebuildCount, 0);

const growthCenters = new Float32Array(96 * 3);
for (let index = 0; index < 96; index++) growthCenters[index * 3] = index * 0.5;
const growthClusters = buildProcPlantVisibilityClusters(
  { centers: growthCenters, radii: new Float32Array(96).fill(0.1) },
  { cellSize: 4, maxInstancesPerCluster: 8 },
);
const growthPlan = createProcPlantWebGpuVisibilityPlan(growthClusters, lodDistances, draws);
const oldOutput = runtime.buffers.output as FakeBuffer;
runtime.setPlan(growthPlan);
assert.ok(device.buffers.length > bufferCountBeforeReuse, "larger plans must allocate replacement capacity");
assert.equal(oldOutput.destroyed, 1, "replaced buffers must be destroyed exactly once");
assert.equal(runtime.diagnostics.bufferRebuildCount, 1);
runtime.dispose();
runtime.dispose();
assert.equal(runtime.diagnostics.state, "disposed");
assert.equal((runtime.buffers.output as FakeBuffer).destroyed, 1, "dispose must be idempotent");
assert.throws(() => runtime.dispatch(view), /disposed/);

await assert.rejects(
  createProcPlantWebGpuVisibilityRuntime(new FakeDevice({ ...fullLimits, maxStorageBuffersPerShaderStage: 3 }), first),
  /cannot support/,
);
await assert.rejects(
  createProcPlantWebGpuVisibilityRuntime(new FakeDevice(), first, { requiredFeatures: ["shader-f16"] }),
  /missing required feature/,
);
await assert.rejects(
  createProcPlantWebGpuVisibilityRuntime(new FakeDevice(), first, { maxAllocatedBytes: first.totalBytes - 4 }),
  /exceeds maxAllocatedBytes/,
);

const controller = new AbortController();
const abortDevice = new FakeDevice();
const abortRuntime = await createProcPlantWebGpuVisibilityRuntime(abortDevice, first, { signal: controller.signal });
controller.abort();
assert.equal(abortRuntime.diagnostics.state, "disposed");
assert.throws(() => abortRuntime.dispatch(view), /disposed/);

let resolveLost!: (info: { reason?: string; message?: string }) => void;
const lost = new Promise<{ reason?: string; message?: string }>((resolve) => { resolveLost = resolve; });
const lostDevice = new FakeDevice() as FakeDevice & { lost: Promise<{ reason?: string; message?: string }> };
lostDevice.lost = lost;
const lostRuntime = await createProcPlantWebGpuVisibilityRuntime(lostDevice, first);
resolveLost({ reason: "destroyed", message: "test loss" });
await Promise.resolve();
assert.equal(lostRuntime.diagnostics.state, "lost");
assert.match(lostRuntime.diagnostics.lostReason ?? "", /test loss/);
assert.throws(() => lostRuntime.dispatch(view), /device is lost/);
lostRuntime.dispose();

console.log("procplant WebGPU visibility plan and injected runtime tests passed");
