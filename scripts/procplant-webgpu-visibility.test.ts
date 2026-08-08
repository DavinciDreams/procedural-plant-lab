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

console.log("procplant WebGPU visibility plan tests passed");
