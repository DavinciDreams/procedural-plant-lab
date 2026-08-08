import assert from "node:assert/strict";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  createProcPlantScatterEntryGlbInstances,
  disposePreparedProcPlantInstancedGlbExport,
  exportProcPlantInstancedGlb,
  prepareProcPlantInstancedGlbExport,
  PROCPLANT_INSTANCED_GLB_EXPORT_CONTRACT,
  validateProcPlantGlbInstanceTransforms,
  type ProcPlantGlbInstanceTransform,
} from "../src/procplant-instanced-export";
import {
  PROCPLANT_SCATTER_CONTRACT,
  PROCPLANT_SCATTER_VERSION,
  type ProcPlantScatterPlan,
} from "../src/procplant-scatter";
import type { ProcPlantTemplate } from "../src/procplants";

interface GlbAccessor { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }
interface GlbBufferView { byteOffset?: number; byteLength: number; byteStride?: number }
interface GlbJson {
  accessors: GlbAccessor[];
  bufferViews: GlbBufferView[];
  nodes: Array<{ extensions?: { EXT_mesh_gpu_instancing?: { attributes: Record<string, number> } } }>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

const triangle: ProcPlantTemplate = {
  pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uv0: new Float32Array([0, 0, 1, 0, 0, 1]),
  col: new Float32Array([0.2, 0.4, 0.6, 0.3, 0.5, 0.7, 0.4, 0.6, 0.8]),
  tintable: new Uint8Array([1, 1, 1]),
  sway: new Float32Array([0, 0.5, 1]),
  idx: new Uint32Array([0, 1, 2]),
};

const transforms: ProcPlantGlbInstanceTransform[] = [
  { translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  { translation: [-4, 0.5, 8], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], scale: [0.5, 2, 1.5] },
  { translation: [9, -1, 2], rotation: [0.5, 0.5, 0.5, 0.5], scale: [3, 2, 1] },
];

const templateBefore = Array.from(triangle.pos);
const transformsBefore = JSON.stringify(transforms);
const prepared = prepareProcPlantInstancedGlbExport(triangle, transforms, {
  name: "Forest Entry",
  genomeId: "fixture",
  maxInstances: 3,
});
assert.equal(prepared.instancing.contract, PROCPLANT_INSTANCED_GLB_EXPORT_CONTRACT);
assert.equal(prepared.instancing.sourceBoundary, "one-template-one-lod");
assert.equal(prepared.mesh.count, 3);
assert.equal(prepared.scene.children.length, 1);
assert.strictEqual(prepared.scene.children[0], prepared.mesh);
const actualMatrix = new THREE.Matrix4();
const expectedMatrix = new THREE.Matrix4();
for (let index = 0; index < transforms.length; index++) {
  const transform = transforms[index]!;
  prepared.mesh.getMatrixAt(index, actualMatrix);
  expectedMatrix.compose(
    new THREE.Vector3().fromArray(transform.translation),
    new THREE.Quaternion().fromArray(transform.rotation),
    new THREE.Vector3().fromArray(transform.scale),
  );
  for (let component = 0; component < 16; component++) {
    assert.ok(Math.abs(actualMatrix.elements[component]! - expectedMatrix.elements[component]!) < 1e-6);
  }
}
assert.deepEqual(Array.from(triangle.pos), templateBefore);
assert.equal(JSON.stringify(transforms), transformsBefore);
let meshDisposed = 0;
let geometryDisposed = 0;
let materialDisposed = 0;
prepared.mesh.addEventListener("dispose", () => meshDisposed++);
prepared.mesh.geometry.addEventListener("dispose", () => geometryDisposed++);
prepared.mesh.material.addEventListener("dispose", () => materialDisposed++);
disposePreparedProcPlantInstancedGlbExport(prepared);
assert.deepEqual([meshDisposed, geometryDisposed, materialDisposed], [1, 1, 1]);

assert.throws(() => validateProcPlantGlbInstanceTransforms([], 1), /at least one transform/);
assert.throws(() => validateProcPlantGlbInstanceTransforms(transforms, 2), /exceeds maxInstances/);
assert.throws(() => validateProcPlantGlbInstanceTransforms([
  { ...transforms[0]!, rotation: [0, 0, 0, 2] },
]), /normalized quaternion/);
assert.throws(() => validateProcPlantGlbInstanceTransforms([
  { ...transforms[0]!, scale: [-1, 1, 1] },
]), /scale must be positive/);
assert.throws(() => validateProcPlantGlbInstanceTransforms([
  { ...transforms[0]!, translation: [Number.MAX_VALUE, 0, 0] },
]), /representable as float32/);
assert.throws(() => prepareProcPlantInstancedGlbExport(triangle, transforms, { maxInstances: 0 }), /maxInstances/);
assert.throws(() => prepareProcPlantInstancedGlbExport(triangle, transforms, {
  meshopt: { compatibility: "required" },
} as never), /does not support meshopt composition/);
assert.throws(() => prepareProcPlantInstancedGlbExport(triangle, transforms, {
  collision: { type: "bounds-box" },
} as never), /does not support untransformed collision/);
assert.throws(() => prepareProcPlantInstancedGlbExport([triangle] as never, transforms), /one template\/LOD/);

const parseGlb = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), buffer.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd()) as GlbJson;
  return { json, binaryOffset: 20 + jsonLength + 8, view };
};

const readFloatAccessor = (buffer: ArrayBuffer, json: GlbJson, binaryOffset: number, accessorIndex: number) => {
  const accessor = json.accessors[accessorIndex]!;
  const bufferView = json.bufferViews[accessor.bufferView]!;
  assert.equal(accessor.componentType, 5126);
  const components = accessor.type === "VEC3" ? 3 : accessor.type === "VEC4" ? 4 : 1;
  const stride = bufferView.byteStride ?? components * 4;
  const values: number[][] = [];
  for (let row = 0; row < accessor.count; row++) {
    const offset = binaryOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + row * stride;
    values.push(Array.from({ length: components }, (_, component) => new DataView(buffer).getFloat32(offset + component * 4, true)));
  }
  return values;
};

const first = await exportProcPlantInstancedGlb(triangle, transforms, { name: "Forest Entry", genomeId: "fixture" });
const second = await exportProcPlantInstancedGlb(triangle, transforms, { name: "Forest Entry", genomeId: "fixture" });
assert.deepEqual(new Uint8Array(second), new Uint8Array(first), "instanced GLB bytes must be deterministic");
const parsed = parseGlb(first);
assert.deepEqual(parsed.json.extensionsUsed, ["EXT_mesh_gpu_instancing"]);
assert.deepEqual(parsed.json.extensionsRequired, ["EXT_mesh_gpu_instancing"]);
const extensionNode = parsed.json.nodes.find((node) => node.extensions?.EXT_mesh_gpu_instancing);
assert.ok(extensionNode);
const attributes = extensionNode.extensions!.EXT_mesh_gpu_instancing!.attributes;
assert.deepEqual(Object.keys(attributes).sort(), ["ROTATION", "SCALE", "TRANSLATION"]);
for (const accessorIndex of Object.values(attributes)) assert.equal(parsed.json.accessors[accessorIndex]!.count, transforms.length);
assert.deepEqual(readFloatAccessor(first, parsed.json, parsed.binaryOffset, attributes.TRANSLATION), transforms.map((item) => [...item.translation]));

const loaded = await new GLTFLoader().parseAsync(first, "");
let loadedMesh: THREE.InstancedMesh | null = null;
loaded.scene.traverse((object) => {
  if (object instanceof THREE.InstancedMesh) loadedMesh = object;
});
assert.ok(loadedMesh);
assert.equal((loadedMesh as THREE.InstancedMesh).count, transforms.length);
for (let index = 0; index < transforms.length; index++) {
  (loadedMesh as THREE.InstancedMesh).getMatrixAt(index, actualMatrix);
  const transform = transforms[index]!;
  expectedMatrix.compose(
    new THREE.Vector3().fromArray(transform.translation),
    new THREE.Quaternion().fromArray(transform.rotation),
    new THREE.Vector3().fromArray(transform.scale),
  );
  for (let component = 0; component < 16; component++) {
    assert.ok(Math.abs(actualMatrix.elements[component]! - expectedMatrix.elements[component]!) < 1e-5);
  }
}

const scatterPlan: ProcPlantScatterPlan = {
  contract: PROCPLANT_SCATTER_CONTRACT,
  version: PROCPLANT_SCATTER_VERSION,
  mixId: "fixture-mix",
  seed: 7,
  bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
  candidates: 3,
  rejectedByDensity: 0,
  rejectedBySpacing: 0,
  placements: [
    { id: "fern:0", index: 0, entryId: "fern", seed: 1, position: [1, 2, 3], rotationY: Math.PI, scale: 2, spacing: 1, densitySample: 1 },
    { id: "tree:1", index: 1, entryId: "tree", seed: 2, position: [4, 5, 6], rotationY: 0.25, scale: 1, spacing: 1, densitySample: 1 },
    { id: "fern:2", index: 2, entryId: "fern", seed: 3, position: [7, 8, 9], rotationY: Math.PI / 2, scale: 0.5, spacing: 1, densitySample: 1 },
  ],
  countsByEntry: { fern: 2, tree: 1 },
};
const scatterBefore = JSON.stringify(scatterPlan);
const fernInstances = createProcPlantScatterEntryGlbInstances(scatterPlan, "fern");
assert.deepEqual(fernInstances.map((item) => item.translation), [[1, 2, 3], [7, 8, 9]]);
assert.deepEqual(fernInstances.map((item) => item.scale), [[2, 2, 2], [0.5, 0.5, 0.5]]);
assert.equal(JSON.stringify(scatterPlan), scatterBefore);
assert.throws(() => createProcPlantScatterEntryGlbInstances(scatterPlan, "missing"), /has no placements/);

const benchmarkTransforms: ProcPlantGlbInstanceTransform[] = Array.from({ length: 10_000 }, (_, index) => ({
  translation: [index % 100, 0, Math.floor(index / 100)] as const,
  rotation: [0, 0, 0, 1] as const,
  scale: [1, 1, 1] as const,
}));
const benchmarkStarted = performance.now();
const benchmark = await exportProcPlantInstancedGlb(triangle, benchmarkTransforms, { name: "10k-instance-benchmark" });
const benchmarkMs = performance.now() - benchmarkStarted;
const benchmarkJson = parseGlb(benchmark).json;
const benchmarkNode = benchmarkJson.nodes.find((node) => node.extensions?.EXT_mesh_gpu_instancing)!;
for (const accessorIndex of Object.values(benchmarkNode.extensions!.EXT_mesh_gpu_instancing!.attributes)) {
  assert.equal(benchmarkJson.accessors[accessorIndex]!.count, 10_000);
}
assert.ok(benchmark.byteLength < 500_000, `10k triangle instance GLB unexpectedly large: ${benchmark.byteLength}`);
console.log(`procplant instanced export tests passed (10,000 instances: ${benchmark.byteLength} bytes, ${benchmarkMs.toFixed(1)} ms)`);
