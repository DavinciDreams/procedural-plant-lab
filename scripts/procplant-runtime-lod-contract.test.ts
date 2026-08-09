import assert from "node:assert/strict";
import {
  PROCPLANT_RUNTIME_LOD_CONTRACT,
  createProcPlantRuntimeLodSelectionContract,
  selectProcPlantRuntimeLod,
  validateProcPlantRuntimeLodSelectionContract,
} from "../src/procplant-contract";
import {
  buildProcPlantRuntimePackage,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantCompiledLod,
  type ProcPlantTemplate,
} from "../src/procplants";
import { disposePreparedProcPlantGlbExport, exportProcPlantGlb, prepareProcPlantGlbExport } from "../src/procplant-export";

const tierSources = ([
  { level: 0, label: "full", distance: 0, triangleBudget: 1000, organBudget: 100 },
  { level: 1, label: "clustered", distance: 12, triangleBudget: 480, organBudget: 50 },
  { level: 2, label: "billboard-cross", distance: 28, triangleBudget: 32, organBudget: 4 },
  { level: 3, label: "impostor", distance: 60, triangleBudget: 2, organBudget: 1 },
] as const);

const contract = createProcPlantRuntimeLodSelectionContract(tierSources);
assert.equal(contract.contract, PROCPLANT_RUNTIME_LOD_CONTRACT);
assert.deepEqual(contract.tiers.map((tier) => tier.id), [
  "lod0-full", "lod1-clustered", "lod2-billboard-cross", "lod3-impostor",
]);
assert.deepEqual(
  createProcPlantRuntimeLodSelectionContract([...tierSources].reverse()),
  contract,
  "tier serialization must be stable regardless of source order",
);
assert.strictEqual(validateProcPlantRuntimeLodSelectionContract(contract), contract);

assert.equal(selectProcPlantRuntimeLod(contract, { distance: 20 }).tierId, "lod1-clustered");
assert.equal(selectProcPlantRuntimeLod(contract, { distance: 2, projectedScreenHeight: 0.05 }).tierId, "lod2-billboard-cross");
assert.equal(selectProcPlantRuntimeLod(contract, { distance: 20, instanceMaxWorldScale: 2 }).tierId, "lod0-full");

assert.equal(selectProcPlantRuntimeLod(contract, {
  distance: 12.5,
  previousTierId: "lod0-full",
}).tierId, "lod0-full", "coarsening must respect the upper hysteresis gate");
assert.equal(selectProcPlantRuntimeLod(contract, {
  distance: 14,
  previousTierId: "lod0-full",
}).tierId, "lod1-clustered");
assert.equal(selectProcPlantRuntimeLod(contract, {
  distance: 11,
  previousTierId: "lod1-clustered",
}).tierId, "lod1-clustered", "refinement must respect the lower hysteresis gate");
assert.equal(selectProcPlantRuntimeLod(contract, {
  distance: 10,
  previousTierId: "lod1-clustered",
}).tierId, "lod0-full");

const culled = selectProcPlantRuntimeLod(contract, { distance: contract.policy.culling.minDistance + 1 });
assert.equal(culled.culled, true);
assert.equal(culled.reason, "culled");
assert.equal(selectProcPlantRuntimeLod(contract, {
  distance: contract.policy.culling.minDistance * 0.95,
  previousTierId: "lod3-impostor",
  previousCulled: true,
}).culled, true, "culling must retain hysteresis state near the threshold");
assert.equal(selectProcPlantRuntimeLod(contract, {
  distance: contract.policy.culling.minDistance * 0.8,
  previousTierId: "lod3-impostor",
  previousCulled: true,
}).culled, false);

assert.throws(() => validateProcPlantRuntimeLodSelectionContract({
  ...contract,
  tiers: contract.tiers.map((tier, index) => index === 1 ? { ...tier, minDistance: -1 } : tier),
}), /increase|invalid/);
assert.throws(() => selectProcPlantRuntimeLod(contract, { distance: -1 }), /distance/);
assert.throws(() => selectProcPlantRuntimeLod(contract, { distance: 1, previousTierId: "missing" }), /unknown/);

const runtime = buildProcPlantRuntimePackage(procPlantPresets.phiFern!, 42, defaultPlantEnvironment());
assert.equal(runtime.lodSelection.contract, PROCPLANT_RUNTIME_LOD_CONTRACT);
assert.deepEqual(runtime.lodSelection.tiers.map((tier) => tier.level), runtime.lods.map((tier) => tier.level));

const triangleTemplate = (triangleCount: number): ProcPlantTemplate => {
  const vertices = triangleCount * 3;
  const pos = new Float32Array(vertices * 3);
  const nrm = new Float32Array(vertices * 3);
  const uv0 = new Float32Array(vertices * 2);
  const col = new Float32Array(vertices * 3);
  const tintable = new Uint8Array(vertices);
  const sway = new Float32Array(vertices);
  const idx = new Uint32Array(vertices);
  for (let index = 0; index < vertices; index++) {
    pos[index * 3] = index * 0.01;
    nrm[index * 3 + 1] = 1;
    uv0.set(index % 3 === 0 ? [0, 0] : index % 3 === 1 ? [1, 0] : [0.5, 1], index * 2);
    col.set([0.2, 0.6, 0.3], index * 3);
    idx[index] = index;
  }
  return { pos, nrm, uv0, col, tintable, sway, idx };
};

const compiled = tierSources.map((tier): ProcPlantCompiledLod => {
  const triangles = Math.max(1, Math.min(8, tier.triangleBudget));
  const template = triangleTemplate(triangles);
  return {
    level: tier.level,
    label: tier.label,
    distance: tier.distance,
    triangles,
    vertices: template.pos.length / 3,
    template,
  };
});
const prepared = prepareProcPlantGlbExport(compiled, { genomeId: "fixture", seed: 42 });
try {
  assert.equal(prepared.metadata.lodSelection?.contract, PROCPLANT_RUNTIME_LOD_CONTRACT);
  assert.equal(prepared.scene.userData.procplant.lodSelection.version, 1);
  assert.equal(prepared.meshes[2]!.userData.procplant.lod.tierId, "lod2-billboard-cross");
  assert.equal("extensions" in prepared.scene.userData, false, "LOD metadata must remain ordinary glTF extras");
} finally {
  disposePreparedProcPlantGlbExport(prepared);
}

const glb = await exportProcPlantGlb(compiled, { genomeId: "fixture", seed: 42 });
const view = new DataView(glb);
const jsonLength = view.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)).trim()) as {
  scenes: Array<{ extras?: { procplant?: { lodSelection?: { contract?: string } } } }>;
  extensionsUsed?: string[];
};
assert.equal(json.scenes[0]?.extras?.procplant?.lodSelection?.contract, PROCPLANT_RUNTIME_LOD_CONTRACT);
assert.equal(json.extensionsUsed?.some((extension) => /lod/i.test(extension)) ?? false, false,
  "runtime LOD extras must not advertise a nonexistent glTF extension");

console.log("procplant runtime LOD contract tests passed");
