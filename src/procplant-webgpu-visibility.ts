import {
  ProcPlantVisibilitySelector,
  type ProcPlantVisibilityClusterSet,
  type ProcPlantVisibilityView,
} from "./procplant-visibility-clusters";

export const PROCPLANT_WEBGPU_VISIBILITY_CONTRACT = "procplants.webgpu-visibility" as const;
export const PROCPLANT_WEBGPU_VISIBILITY_VERSION = 1 as const;
export const PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE = 64 as const;

export interface ProcPlantWebGpuLodDraw {
  indexCount: number;
  firstIndex?: number;
  baseVertex?: number;
}

export interface ProcPlantWebGpuLimits {
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
  maxUniformBufferBindingSize?: number;
  maxComputeWorkgroupsPerDimension?: number;
  maxComputeWorkgroupSizeX?: number;
  maxComputeInvocationsPerWorkgroup?: number;
  maxStorageBuffersPerShaderStage?: number;
  maxUniformBuffersPerShaderStage?: number;
  maxBindingsPerBindGroup?: number;
}

export interface ProcPlantWebGpuVisibilityOptions {
  maxInstances?: number;
  maxClusters?: number;
  maxTotalBytes?: number;
  visibilityMask?: ArrayLike<number>;
  limits?: ProcPlantWebGpuLimits;
}

export interface ProcPlantWebGpuDispatch {
  readonly x: number;
  readonly y: number;
  readonly z: 1;
}

export interface ProcPlantWebGpuBufferPlan {
  readonly role: "uniform" | "storage-read" | "storage-read-write" | "storage-indirect";
  readonly byteLength: number;
  readonly initialData: Uint8Array;
}

export interface ProcPlantWebGpuVisibilityPlan {
  readonly contract: typeof PROCPLANT_WEBGPU_VISIBILITY_CONTRACT;
  readonly version: typeof PROCPLANT_WEBGPU_VISIBILITY_VERSION;
  readonly contentHash: string;
  readonly instanceCount: number;
  readonly clusterCount: number;
  readonly lodCount: number;
  readonly workgroupSize: typeof PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE;
  readonly dispatch: {
    readonly reset: ProcPlantWebGpuDispatch;
    readonly classify: ProcPlantWebGpuDispatch;
    readonly finalize: ProcPlantWebGpuDispatch;
  };
  readonly offsets: {
    readonly input: {
      readonly clusterBounds: number;
      readonly clusterOffsets: number;
      readonly clusterInstanceIndices: number;
      readonly instanceBounds: number;
      readonly lodDistances: number;
      readonly drawTemplates: number;
    };
    readonly output: {
      readonly visibilityFlags: number;
      readonly instanceLods: number;
      readonly lodInstanceIndices: number;
    };
  };
  readonly buffers: {
    readonly parameters: ProcPlantWebGpuBufferPlan;
    readonly view: ProcPlantWebGpuBufferPlan;
    readonly input: ProcPlantWebGpuBufferPlan;
    readonly visibilityMask: ProcPlantWebGpuBufferPlan;
    readonly lodCounts: ProcPlantWebGpuBufferPlan;
    readonly output: ProcPlantWebGpuBufferPlan;
    readonly indirect: ProcPlantWebGpuBufferPlan;
  };
  readonly totalBytes: number;
  readonly resetWgsl: string;
  readonly classifyWgsl: string;
  readonly finalizeWgsl: string;
}

export interface ProcPlantWebGpuVisibilityReference {
  readonly visibilityFlags: Uint32Array;
  readonly instanceLods: Int32Array;
  readonly lodCounts: Uint32Array;
  /** Fixed LOD-major lanes; only each lodCounts prefix is valid. */
  readonly lodInstanceIndices: Uint32Array;
  /** Five uint32 words per drawIndexedIndirect command. */
  readonly indirectCommands: Uint32Array;
}

const DEFAULT_MAX_INSTANCES = 1_000_000;
const HARD_MAX_INSTANCES = 10_000_000;
const DEFAULT_MAX_CLUSTERS = 1_000_000;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const U32_MAX = 0xffffffff;

const integer = (value: number, label: string, minimum: number, maximum: number) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
};

const checkedWords = (count: number, multiplier: number, label: string) => {
  const words = count * multiplier;
  if (!Number.isSafeInteger(words) || words > U32_MAX) throw new Error(`${label} exceeds uint32 word addressing`);
  return words;
};

const bytesOf = (view: ArrayBufferView) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

const copyBytes = (target: Uint32Array, wordOffset: number, source: ArrayBufferView) => {
  new Uint8Array(target.buffer, wordOffset * 4, source.byteLength).set(bytesOf(source));
};

const fnv1a = (views: readonly ArrayBufferView[]) => {
  let hash = 0x811c9dc5;
  for (const character of `${PROCPLANT_WEBGPU_VISIBILITY_CONTRACT}:v${PROCPLANT_WEBGPU_VISIBILITY_VERSION}`) {
    hash ^= character.charCodeAt(0) & 255;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  for (const view of views) {
    for (const byte of bytesOf(view)) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};

const dispatch2d = (workgroups: number, limit: number): ProcPlantWebGpuDispatch => {
  const count = Math.max(1, workgroups);
  const x = Math.min(count, limit);
  const y = Math.ceil(count / x);
  if (y > limit) throw new Error(`WebGPU dispatch requires ${workgroups} workgroups, exceeding ${limit}x${limit}`);
  return Object.freeze({ x, y, z: 1 as const });
};

const bufferPlan = (
  role: ProcPlantWebGpuBufferPlan["role"],
  view: ArrayBufferView,
  maxBufferSize: number,
  maxStorageBufferBindingSize: number,
  maxUniformBufferBindingSize: number,
): ProcPlantWebGpuBufferPlan => {
  if (view.byteLength % 4 !== 0) throw new Error("WebGPU buffer byte length must be 4-byte aligned");
  const storage = role !== "uniform";
  const limit = storage
    ? Math.min(maxBufferSize, maxStorageBufferBindingSize)
    : Math.min(maxBufferSize, maxUniformBufferBindingSize);
  if (view.byteLength > limit) throw new Error(`WebGPU ${role} buffer exceeds the configured binding limit (${view.byteLength} > ${limit})`);
  const initialData = bytesOf(view).slice();
  return Object.freeze({ role, byteLength: initialData.byteLength, initialData });
};

const validateClusters = (clusters: ProcPlantVisibilityClusterSet, maxInstances: number, maxClusters: number) => {
  if (clusters.contract !== "procplant.visibility-clusters" || clusters.version !== 1) {
    throw new Error("WebGPU visibility requires procplant.visibility-clusters v1");
  }
  if (clusters.instanceCount > maxInstances) throw new Error(`WebGPU visibility instances exceed maxInstances (${clusters.instanceCount} > ${maxInstances})`);
  if (clusters.clusterCount > maxClusters) throw new Error(`WebGPU visibility clusters exceed maxClusters (${clusters.clusterCount} > ${maxClusters})`);
  if (clusters.instanceBounds.length !== clusters.instanceCount * 4 || clusters.clusterBounds.length !== clusters.clusterCount * 4 ||
    clusters.clusterOffsets.length !== clusters.clusterCount + 1 || clusters.clusterInstanceIndices.length !== clusters.instanceCount) {
    throw new Error("WebGPU visibility cluster arrays do not match their declared counts");
  }
  let previous = 0;
  const seen = new Uint8Array(clusters.instanceCount);
  for (let cluster = 0; cluster <= clusters.clusterCount; cluster++) {
    const offset = clusters.clusterOffsets[cluster]!;
    if (offset < previous || offset > clusters.instanceCount) throw new Error("WebGPU visibility cluster offsets must be monotonic and bounded");
    previous = offset;
  }
  if (previous !== clusters.instanceCount) throw new Error("WebGPU visibility cluster offsets must cover every instance");
  for (const instance of clusters.clusterInstanceIndices) {
    if (instance >= clusters.instanceCount || seen[instance]) throw new Error("WebGPU visibility cluster indices must be a permutation of instances");
    seen[instance] = 1;
  }
};

const createViewUniform = (view?: ProcPlantVisibilityView) => {
  const uniform = new Float32Array(28);
  if (view) updateProcPlantWebGpuVisibilityView(uniform, view);
  return uniform;
};

export const updateProcPlantWebGpuVisibilityView = (target: Float32Array, view: ProcPlantVisibilityView) => {
  if (target.length !== 28) throw new Error("WebGPU visibility view uniform must contain 28 float32 values");
  if (view.planes.length !== 24 || view.cameraPosition.length !== 3) throw new Error("WebGPU visibility view has malformed planes or camera position");
  for (let index = 0; index < 24; index++) {
    const value = Number(view.planes[index]);
    if (!Number.isFinite(value)) throw new Error(`WebGPU visibility plane ${index} must be finite`);
    target[index] = value;
  }
  for (let index = 0; index < 3; index++) {
    const value = Number(view.cameraPosition[index]);
    if (!Number.isFinite(value)) throw new Error(`WebGPU visibility camera ${index} must be finite`);
    target[24 + index] = value;
  }
  if (Number.isNaN(view.maxDistance) || view.maxDistance < 0) throw new Error("WebGPU visibility maxDistance must be non-negative");
  target[27] = view.maxDistance === Infinity ? Number.MAX_VALUE : Math.min(view.maxDistance, Number.MAX_VALUE);
  return target;
}

const COMMON_WGSL = `
struct Params {
  counts: vec4<u32>,
  dispatch: vec4<u32>,
  input0: vec4<u32>,
  input1: vec4<u32>,
  output0: vec4<u32>,
  reserved: vec4<u32>,
};
@group(0) @binding(0) var<uniform> params: Params;
`;

export const PROCPLANT_WEBGPU_VISIBILITY_RESET_WGSL = `${COMMON_WGSL}
@group(0) @binding(1) var<storage, read_write> lodCounts: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> outputData: array<u32>;
@compute @workgroup_size(${PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE})
fn reset(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>) {
  let index = (group.x + group.y * params.dispatch.y) * ${PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE}u + local.x;
  if (index < params.counts.x) {
    outputData[params.output0.x + index] = 0u;
    outputData[params.output0.y + index] = 0xffffffffu;
  }
  if (index < params.counts.z) { atomicStore(&lodCounts[index], 0u); }
}`;

export const PROCPLANT_WEBGPU_VISIBILITY_CLASSIFY_WGSL = `${COMMON_WGSL}
struct View { planes: array<vec4<f32>, 6>, cameraMaxDistance: vec4<f32> }
@group(0) @binding(1) var<uniform> view: View;
@group(0) @binding(2) var<storage, read> inputData: array<u32>;
@group(0) @binding(3) var<storage, read> visibilityMask: array<u32>;
@group(0) @binding(4) var<storage, read_write> lodCounts: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> outputData: array<u32>;
var<workgroup> clusterVisible: u32;
fn f32at(word: u32) -> f32 { return bitcast<f32>(inputData[word]); }
fn sphereVisible(center: vec3<f32>, radius: f32) -> bool {
  for (var plane = 0u; plane < 6u; plane++) {
    let p = view.planes[plane];
    if (dot(p.xyz, center) + p.w < -radius) { return false; }
  }
  return true;
}
@compute @workgroup_size(${PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE})
fn classify(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>) {
  let cluster = group.x + group.y * params.dispatch.x;
  if (cluster >= params.counts.y) { return; }
  if (local.x == 0u) {
    let b = params.input0.x + cluster * 4u;
    let center = vec3<f32>(f32at(b), f32at(b + 1u), f32at(b + 2u));
    let radius = f32at(b + 3u);
    let nearest = max(0.0, distance(center, view.cameraMaxDistance.xyz) - radius);
    clusterVisible = select(0u, 1u, sphereVisible(center, radius) && nearest <= view.cameraMaxDistance.w);
  }
  workgroupBarrier();
  if (clusterVisible == 0u) { return; }
  let start = inputData[params.input0.y + cluster];
  let end = inputData[params.input0.y + cluster + 1u];
  for (var cursor = start + local.x; cursor < end; cursor += ${PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE}u) {
    let instance = inputData[params.input0.z + cursor];
    if (visibilityMask[instance] == 0u) { continue; }
    let b = params.input0.w + instance * 4u;
    let center = vec3<f32>(f32at(b), f32at(b + 1u), f32at(b + 2u));
    let radius = f32at(b + 3u);
    let nearest = max(0.0, distance(center, view.cameraMaxDistance.xyz) - radius);
    if (!sphereVisible(center, radius) || nearest > view.cameraMaxDistance.w) { continue; }
    var lod = 0u;
    for (var level = 1u; level < params.counts.z; level++) {
      if (nearest >= f32at(params.input1.x + level)) { lod = level; }
    }
    outputData[params.output0.x + instance] = 1u;
    outputData[params.output0.y + instance] = lod;
    let slot = atomicAdd(&lodCounts[lod], 1u);
    outputData[params.output0.z + lod * params.counts.w + slot] = instance;
  }
}`;

export const PROCPLANT_WEBGPU_VISIBILITY_FINALIZE_WGSL = `${COMMON_WGSL}
@group(0) @binding(1) var<storage, read> inputData: array<u32>;
@group(0) @binding(2) var<storage, read_write> lodCounts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> indirect: array<u32>;
@compute @workgroup_size(${PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE})
fn finalize(@builtin(local_invocation_id) local: vec3<u32>) {
  let lod = local.x;
  if (lod >= params.counts.z) { return; }
  let source = params.input1.y + lod * 4u;
  let target = lod * 5u;
  indirect[target] = inputData[source];
  indirect[target + 1u] = atomicLoad(&lodCounts[lod]);
  indirect[target + 2u] = inputData[source + 1u];
  indirect[target + 3u] = inputData[source + 2u];
  indirect[target + 4u] = lod * params.counts.w;
}`;

export const createProcPlantWebGpuVisibilityPlan = (
  clusters: ProcPlantVisibilityClusterSet,
  lodDistancesSource: ArrayLike<number>,
  draws: readonly ProcPlantWebGpuLodDraw[],
  options: ProcPlantWebGpuVisibilityOptions = {},
): ProcPlantWebGpuVisibilityPlan => {
  const maxInstances = integer(options.maxInstances ?? DEFAULT_MAX_INSTANCES, "WebGPU maxInstances", 1, HARD_MAX_INSTANCES);
  const maxClusters = integer(options.maxClusters ?? DEFAULT_MAX_CLUSTERS, "WebGPU maxClusters", 1, DEFAULT_MAX_CLUSTERS);
  validateClusters(clusters, maxInstances, maxClusters);
  const lodCount = integer(lodDistancesSource.length, "WebGPU LOD count", 1, 32);
  if (draws.length !== lodCount) throw new Error("WebGPU draw templates must match the LOD count");
  const lodDistances = new Float32Array(lodCount);
  for (let lod = 0; lod < lodCount; lod++) {
    const distance = Number(lodDistancesSource[lod]);
    if (!Number.isFinite(distance) || distance < 0 || (lod === 0 && distance !== 0) || (lod > 0 && distance <= lodDistances[lod - 1]!)) {
      throw new Error("WebGPU LOD distances must start at zero and strictly increase");
    }
    const rounded = Math.fround(distance);
    if (!Number.isFinite(rounded) || (lod > 0 && rounded <= lodDistances[lod - 1]!)) {
      throw new Error("WebGPU LOD distances must remain strictly increasing in float32");
    }
    lodDistances[lod] = rounded;
  }
  const limitSource = options.limits ?? {};
  const maxBufferSize = integer(limitSource.maxBufferSize ?? DEFAULT_MAX_BUFFER_BYTES, "WebGPU maxBufferSize", 4, U32_MAX);
  const maxStorage = integer(limitSource.maxStorageBufferBindingSize ?? maxBufferSize, "WebGPU maxStorageBufferBindingSize", 4, U32_MAX);
  const maxUniform = integer(limitSource.maxUniformBufferBindingSize ?? 64 * 1024, "WebGPU maxUniformBufferBindingSize", 4, U32_MAX);
  const maxWorkgroups = integer(limitSource.maxComputeWorkgroupsPerDimension ?? 65_535, "WebGPU maxComputeWorkgroupsPerDimension", 1, 65_535);
  const maxWorkgroupSizeX = integer(limitSource.maxComputeWorkgroupSizeX ?? 256, "WebGPU maxComputeWorkgroupSizeX", 1, U32_MAX);
  const maxInvocations = integer(limitSource.maxComputeInvocationsPerWorkgroup ?? 256, "WebGPU maxComputeInvocationsPerWorkgroup", 1, U32_MAX);
  const maxStorageBuffers = integer(limitSource.maxStorageBuffersPerShaderStage ?? 8, "WebGPU maxStorageBuffersPerShaderStage", 0, U32_MAX);
  const maxUniformBuffers = integer(limitSource.maxUniformBuffersPerShaderStage ?? 12, "WebGPU maxUniformBuffersPerShaderStage", 0, U32_MAX);
  const maxBindings = integer(limitSource.maxBindingsPerBindGroup ?? 8, "WebGPU maxBindingsPerBindGroup", 0, U32_MAX);
  if (maxWorkgroupSizeX < PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE ||
    maxInvocations < PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE || maxStorageBuffers < 4 ||
    maxUniformBuffers < 2 || maxBindings < 6) {
    throw new Error("WebGPU device limits cannot support the procplants visibility kernels");
  }
  const mask = new Uint32Array(Math.max(1, clusters.instanceCount));
  if (options.visibilityMask && options.visibilityMask.length !== clusters.instanceCount) throw new Error("WebGPU visibility mask must match instance count");
  for (let instance = 0; instance < mask.length; instance++) {
    const value = options.visibilityMask ? Number(options.visibilityMask[instance]) : 1;
    if (!Number.isFinite(value)) throw new Error(`WebGPU visibility mask ${instance} must be finite`);
    mask[instance] = value === 0 ? 0 : 1;
  }

  const inputOffsets = {
    clusterBounds: 0,
    clusterOffsets: clusters.clusterBounds.length,
    clusterInstanceIndices: clusters.clusterBounds.length + clusters.clusterOffsets.length,
    instanceBounds: clusters.clusterBounds.length + clusters.clusterOffsets.length + clusters.clusterInstanceIndices.length,
    lodDistances: clusters.clusterBounds.length + clusters.clusterOffsets.length + clusters.clusterInstanceIndices.length + clusters.instanceBounds.length,
    drawTemplates: clusters.clusterBounds.length + clusters.clusterOffsets.length + clusters.clusterInstanceIndices.length + clusters.instanceBounds.length + lodCount,
  };
  const inputWords = inputOffsets.drawTemplates + lodCount * 4;
  const input = new Uint32Array(inputWords);
  copyBytes(input, inputOffsets.clusterBounds, clusters.clusterBounds);
  copyBytes(input, inputOffsets.clusterOffsets, clusters.clusterOffsets);
  copyBytes(input, inputOffsets.clusterInstanceIndices, clusters.clusterInstanceIndices);
  copyBytes(input, inputOffsets.instanceBounds, clusters.instanceBounds);
  copyBytes(input, inputOffsets.lodDistances, lodDistances);
  for (let lod = 0; lod < lodCount; lod++) {
    const draw = draws[lod]!;
    const base = inputOffsets.drawTemplates + lod * 4;
    input[base] = integer(draw.indexCount, `WebGPU draw ${lod} indexCount`, 0, U32_MAX);
    input[base + 1] = integer(draw.firstIndex ?? 0, `WebGPU draw ${lod} firstIndex`, 0, U32_MAX);
    const baseVertex = integer(draw.baseVertex ?? 0, `WebGPU draw ${lod} baseVertex`, -0x80000000, 0x7fffffff);
    input[base + 2] = baseVertex >>> 0;
  }
  const outputOffsets = {
    visibilityFlags: 0,
    instanceLods: clusters.instanceCount,
    lodInstanceIndices: checkedWords(clusters.instanceCount, 2, "WebGPU output prefix"),
  };
  const outputWords = outputOffsets.lodInstanceIndices + checkedWords(clusters.instanceCount, lodCount, "WebGPU LOD compaction");
  const output = new Uint32Array(Math.max(1, outputWords));
  output.fill(U32_MAX, outputOffsets.instanceLods, outputOffsets.lodInstanceIndices);
  const parameters = new Uint32Array(24);
  parameters.set([clusters.instanceCount, clusters.clusterCount, lodCount, clusters.instanceCount], 0);
  const classifyDispatch = dispatch2d(clusters.clusterCount, maxWorkgroups);
  const resetGroups = Math.ceil(Math.max(clusters.instanceCount, lodCount) / PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE);
  const resetDispatch = dispatch2d(resetGroups, maxWorkgroups);
  parameters.set([classifyDispatch.x, resetDispatch.x, 0, 0], 4);
  parameters.set([inputOffsets.clusterBounds, inputOffsets.clusterOffsets, inputOffsets.clusterInstanceIndices, inputOffsets.instanceBounds], 8);
  parameters.set([inputOffsets.lodDistances, inputOffsets.drawTemplates, 0, 0], 12);
  parameters.set([outputOffsets.visibilityFlags, outputOffsets.instanceLods, outputOffsets.lodInstanceIndices, 0], 16);
  const indirect = new Uint32Array(lodCount * 5);
  const view = createViewUniform();
  const buffers = Object.freeze({
    parameters: bufferPlan("uniform", parameters, maxBufferSize, maxStorage, maxUniform),
    view: bufferPlan("uniform", view, maxBufferSize, maxStorage, maxUniform),
    input: bufferPlan("storage-read", input, maxBufferSize, maxStorage, maxUniform),
    visibilityMask: bufferPlan("storage-read", mask, maxBufferSize, maxStorage, maxUniform),
    lodCounts: bufferPlan("storage-read-write", new Uint32Array(lodCount), maxBufferSize, maxStorage, maxUniform),
    output: bufferPlan("storage-read-write", output, maxBufferSize, maxStorage, maxUniform),
    indirect: bufferPlan("storage-indirect", indirect, maxBufferSize, maxStorage, maxUniform),
  });
  const totalBytes = Object.values(buffers).reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const maxTotalBytes = integer(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES, "WebGPU maxTotalBytes", 4, U32_MAX);
  if (totalBytes > maxTotalBytes) throw new Error(`WebGPU visibility buffers exceed maxTotalBytes (${totalBytes} > ${maxTotalBytes})`);
  const hashViews = Object.values(buffers).map((buffer) => buffer.initialData);
  return Object.freeze({
    contract: PROCPLANT_WEBGPU_VISIBILITY_CONTRACT,
    version: PROCPLANT_WEBGPU_VISIBILITY_VERSION,
    contentHash: fnv1a(hashViews),
    instanceCount: clusters.instanceCount,
    clusterCount: clusters.clusterCount,
    lodCount,
    workgroupSize: PROCPLANT_WEBGPU_VISIBILITY_WORKGROUP_SIZE,
    dispatch: Object.freeze({ reset: resetDispatch, classify: classifyDispatch, finalize: Object.freeze({ x: 1, y: 1, z: 1 as const }) }),
    offsets: Object.freeze({ input: Object.freeze(inputOffsets), output: Object.freeze(outputOffsets) }),
    buffers,
    totalBytes,
    resetWgsl: PROCPLANT_WEBGPU_VISIBILITY_RESET_WGSL,
    classifyWgsl: PROCPLANT_WEBGPU_VISIBILITY_CLASSIFY_WGSL,
    finalizeWgsl: PROCPLANT_WEBGPU_VISIBILITY_FINALIZE_WGSL,
  });
};

export const referenceProcPlantWebGpuVisibility = (
  clusters: ProcPlantVisibilityClusterSet,
  lodDistances: ArrayLike<number>,
  draws: readonly ProcPlantWebGpuLodDraw[],
  view: ProcPlantVisibilityView,
  visibilityMask?: ArrayLike<number> | null,
): ProcPlantWebGpuVisibilityReference => {
  if (draws.length !== lodDistances.length) throw new Error("WebGPU reference draws must match LOD count");
  const selected = new ProcPlantVisibilitySelector(clusters, lodDistances).select(view, visibilityMask);
  const visibilityFlags = new Uint32Array(clusters.instanceCount);
  const instanceLods = new Int32Array(clusters.instanceCount).fill(-1);
  const lodCounts = selected.lodCounts.slice();
  const lodInstanceIndices = new Uint32Array(clusters.instanceCount * lodDistances.length).fill(U32_MAX);
  for (let visible = 0; visible < selected.visibleInstanceCount; visible++) {
    const instance = selected.visibleInstanceIndices[visible]!;
    visibilityFlags[instance] = 1;
    instanceLods[instance] = selected.instanceLods[instance]!;
  }
  for (let lod = 0; lod < lodDistances.length; lod++) {
    const count = selected.lodCounts[lod]!;
    const source = selected.lodOffsets[lod]!;
    lodInstanceIndices.set(selected.lodInstanceIndices.subarray(source, source + count), lod * clusters.instanceCount);
  }
  const indirectCommands = new Uint32Array(lodDistances.length * 5);
  for (let lod = 0; lod < lodDistances.length; lod++) {
    const target = lod * 5;
    const draw = draws[lod]!;
    indirectCommands[target] = integer(draw.indexCount, `WebGPU reference draw ${lod} indexCount`, 0, U32_MAX);
    indirectCommands[target + 1] = lodCounts[lod]!;
    indirectCommands[target + 2] = integer(draw.firstIndex ?? 0, `WebGPU reference draw ${lod} firstIndex`, 0, U32_MAX);
    indirectCommands[target + 3] = integer(draw.baseVertex ?? 0, `WebGPU reference draw ${lod} baseVertex`, -0x80000000, 0x7fffffff) >>> 0;
    indirectCommands[target + 4] = lod * clusters.instanceCount;
  }
  return Object.freeze({ visibilityFlags, instanceLods, lodCounts, lodInstanceIndices, indirectCommands });
};

export interface ProcPlantWebGpuComputePassLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
}

export interface ProcPlantWebGpuVisibilityPipelines {
  readonly resetPipeline: unknown;
  readonly resetBindGroup: unknown;
  readonly classifyPipeline: unknown;
  readonly classifyBindGroup: unknown;
  readonly finalizePipeline: unknown;
  readonly finalizeBindGroup: unknown;
}

/** Opt-in command-encoding seam. Resource creation and submission remain renderer-owned. */
export const encodeProcPlantWebGpuVisibility = (
  pass: ProcPlantWebGpuComputePassLike,
  plan: ProcPlantWebGpuVisibilityPlan,
  pipelines: ProcPlantWebGpuVisibilityPipelines,
) => {
  const encode = (pipeline: unknown, bindGroup: unknown, dispatch: ProcPlantWebGpuDispatch) => {
    if (pipeline === null || pipeline === undefined || bindGroup === null || bindGroup === undefined) {
      throw new Error("WebGPU visibility encoding requires every pipeline and bind group");
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(dispatch.x, dispatch.y, dispatch.z);
  };
  encode(pipelines.resetPipeline, pipelines.resetBindGroup, plan.dispatch.reset);
  encode(pipelines.classifyPipeline, pipelines.classifyBindGroup, plan.dispatch.classify);
  encode(pipelines.finalizePipeline, pipelines.finalizeBindGroup, plan.dispatch.finalize);
};
