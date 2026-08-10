import assert from "node:assert/strict";
import * as THREE from "three";
import {
  PROCPLANT_SUPPORTED_INSTANCE_KINDS,
  buildProcPlantGraph,
  buildProcPlantInstancePrototype,
  buildProcPlantInstancedParts,
  compileProcPlantLods,
  defaultPlantEnvironment,
  isProcPlantSupportedInstanceKind,
  procPlantPresetIds,
  procPlantPresets,
} from "../src/procplants";
import { inspectProcPlantReadiness } from "../src/plant-readiness";
import tellusContractV2 from "../fixtures/tellus-procplant-contract-v2.golden.json";
import tellusContractV3 from "../fixtures/tellus-procplant-contract-v3.golden.json";

const EXPECTED_KINDS = [
  "leaf",
  "grassBlade",
  "petal",
  "flowerDisc",
  "daylilyBloom",
  "hibiscusBloom",
  "flobotCupBloom",
  "flobotPetal2Bloom",
  "flobotPinkBloom",
  "foxgloveBloom",
  "flowerCenter",
  "fruit",
  "berry",
  "cone",
  "thorn",
  "aerialRoot",
  "coniferSpray",
  "fernFrond",
  "palmFrond",
  "mossTuft",
] as const;
const SEED = 612_072;
const environment = defaultPlantEnvironment();
const phiFern = procPlantPresets.phiFern!;

const previousPhi = tellusContractV2.presets.find((preset) => preset.presetId === "phiFern")!;
const currentPhi = tellusContractV3.presets.find((preset) => preset.presetId === "phiFern")!;
assert.deepEqual(
  {
    fixtureVersion: tellusContractV2.fixtureVersion,
    generatorContractRevision: tellusContractV2.generatorContractRevision,
    kinds: previousPhi.instances.supportedKinds,
    instances: previousPhi.instances.total,
    triangles: previousPhi.lods.map((lod) => lod.triangles),
  },
  {
    fixtureVersion: 2,
    generatorContractRevision: 2,
    kinds: ["palmFrond"],
    instances: 36,
    triangles: [1872, 624, 4, 2],
  },
  "fixture v2 remains a frozen compatibility record rather than silently accepting v3 semantics",
);
assert.deepEqual(
  {
    fixtureVersion: tellusContractV3.fixtureVersion,
    generatorContractRevision: tellusContractV3.generatorContractRevision,
    kinds: currentPhi.instances.supportedKinds,
    instances: currentPhi.instances.total,
    triangles: currentPhi.lods.map((lod) => lod.triangles),
  },
  {
    fixtureVersion: 3,
    generatorContractRevision: 3,
    kinds: ["fernFrond"],
    instances: 8,
    triangles: [352, 264, 4, 2],
  },
);

assert.deepEqual(PROCPLANT_SUPPORTED_INSTANCE_KINDS, EXPECTED_KINDS);
assert.equal(Object.isFrozen(PROCPLANT_SUPPORTED_INSTANCE_KINDS), true);
assert.equal(new Set(PROCPLANT_SUPPORTED_INSTANCE_KINDS).size, EXPECTED_KINDS.length);
for (const kind of EXPECTED_KINDS) assert.equal(isProcPlantSupportedInstanceKind(kind), true);
for (const value of [undefined, null, 1, "", "fern-frond", "unknown"]) {
  assert.equal(isProcPlantSupportedInstanceKind(value), false);
}

for (const kind of PROCPLANT_SUPPORTED_INSTANCE_KINDS) {
  const first = buildProcPlantInstancePrototype(kind, phiFern);
  const second = buildProcPlantInstancePrototype(kind, phiFern);
  const vertices = first.pos.length / 3;
  assert.ok(vertices > 0, `${kind} prototype must contain vertices`);
  assert.ok(first.idx.length > 0 && first.idx.length % 3 === 0, `${kind} prototype must contain triangles`);
  assert.equal(first.nrm.length, first.pos.length, `${kind} normals must align`);
  assert.equal(first.uv0.length, vertices * 2, `${kind} UV0 must align`);
  assert.equal(first.col.length, first.pos.length, `${kind} colors must align`);
  assert.equal(first.tintable.length, vertices, `${kind} tint flags must align`);
  assert.equal(first.sway.length, vertices, `${kind} sway must align`);
  assert.deepEqual(first, second, `${kind} prototype must be byte deterministic`);
}

const graph = buildProcPlantGraph(phiFern, SEED, environment);
assert.equal(graph.organs.length, 8);
assert.equal(graph.organs.every((organ) => organ.kind === "fernFrond"), true);
for (const organ of graph.organs) {
  assert.ok(organ.direction.toArray().every(Number.isFinite));
  assert.ok(organ.right.toArray().every(Number.isFinite));
  assert.ok(Math.abs(organ.direction.length() - 1) < 1e-6);
  assert.ok(Math.abs(organ.right.length() - 1) < 1e-6);
  assert.ok(Math.abs(organ.direction.dot(organ.right)) < 1e-6);
}

const parts = buildProcPlantInstancedParts(phiFern, SEED, environment);
assert.equal(parts.instances.length, 8);
assert.equal(parts.instances.every((instance) => instance.kind === "fernFrond"), true);
const lods = compileProcPlantLods(phiFern, SEED, environment);
assert.deepEqual(lods.map((lod) => lod.triangles), [352, 264, 4, 2]);
const closeBounds = new THREE.Box3();
for (let offset = 0; offset < lods[0]!.template.pos.length; offset += 3) {
  closeBounds.expandByPoint(new THREE.Vector3(
    lods[0]!.template.pos[offset]!,
    lods[0]!.template.pos[offset + 1]!,
    lods[0]!.template.pos[offset + 2]!,
  ));
}
const closeSize = closeBounds.getSize(new THREE.Vector3());
assert.ok(Math.min(closeSize.x, closeSize.z) > 1.2, "Phi Fern must retain broad two-axis crown coverage");
const readiness = inspectProcPlantReadiness(phiFern, SEED, environment);
assert.equal(readiness.geometry.triangles, 352);
assert.equal(readiness.geometry.instances, 8);

const emittedKinds = new Set<string>();
for (const presetId of procPlantPresetIds) {
  const built = buildProcPlantInstancedParts(procPlantPresets[presetId]!, SEED, environment);
  for (const instance of built.instances) {
    emittedKinds.add(instance.kind);
    assert.equal(
      isProcPlantSupportedInstanceKind(instance.kind),
      true,
      `${presetId} emitted unsupported instance kind ${instance.kind}`,
    );
  }
}
assert.ok(emittedKinds.has("fernFrond"));

console.log(JSON.stringify({
  kinds: PROCPLANT_SUPPORTED_INSTANCE_KINDS,
  emittedKinds: [...emittedKinds].sort(),
  phiFern: {
    instances: parts.instances.length,
    triangles: lods.map((lod) => lod.triangles),
    size: closeSize.toArray(),
  },
}, null, 2));
console.log("procplant instance-kind contract tests passed");
