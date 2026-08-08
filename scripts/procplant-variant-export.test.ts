import assert from "node:assert/strict";
import { procPlantPresets } from "../src/procplants";
import {
  compileProcPlantVariantGlbSources,
  disposePreparedProcPlantVariantGlbSet,
  exportProcPlantVariantGlbBundle,
  exportProcPlantVariantGlbs,
  prepareProcPlantVariantGlbSet,
  PROCPLANT_VARIANT_BUNDLE_CONTRACT,
  PROCPLANT_STANDARD_VARIANTS,
} from "../src/procplant-variant-export";

interface GlbJson {
  scene?: number;
  scenes?: Array<{ name?: string; nodes?: number[]; extras?: Record<string, unknown> }>;
  nodes?: Array<{ name?: string; children?: number[]; mesh?: number; extras?: Record<string, unknown> }>;
  materials?: Array<{ alphaMode?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }>;
  extensionsUsed?: string[];
  extras?: { procplantVariantBundle?: Record<string, unknown> };
}

const inspectGlb = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd()) as GlbJson;
};

const sourceBefore = JSON.stringify(procPlantPresets.cloverGroundcover);
const options = {
  variants: PROCPLANT_STANDARD_VARIANTS.slice(0, 2),
  glb: { collision: { type: "bounds-box" as const } },
};
const first = compileProcPlantVariantGlbSources(procPlantPresets.cloverGroundcover, 42, undefined, options);
const second = compileProcPlantVariantGlbSources(procPlantPresets.cloverGroundcover, 42, undefined, options);
assert.equal(first.contract, "procplants.variant-glb-set");
assert.equal(first.entries.length, 2);
assert.deepEqual(
  first.entries.map((entry) => ({ name: entry.name, genomeId: entry.genomeId, options: entry.options })),
  second.entries.map((entry) => ({ name: entry.name, genomeId: entry.genomeId, options: entry.options })),
);
assert.ok(first.entries.every((entry) => Array.isArray(entry.source) && entry.source.length === 4));
assert.equal(JSON.stringify(procPlantPresets.cloverGroundcover), sourceBefore, "variant export must not mutate its preset");

const prepared = prepareProcPlantVariantGlbSet(procPlantPresets.cloverGroundcover, 42, undefined, options);
try {
  assert.deepEqual(prepared.entries.map((entry) => entry.prepared.fileName), [
    "procplant-clovergroundcover-spring.glb",
    "procplant-clovergroundcover-summer.glb",
  ]);
  assert.ok(prepared.entries.every((entry) => entry.prepared.meshes.length === 4));
  assert.ok(prepared.entries.every((entry) => entry.prepared.collisionMeshes.length === 1));
} finally {
  disposePreparedProcPlantVariantGlbSet(prepared);
}

assert.throws(
  () => compileProcPlantVariantGlbSources(procPlantPresets.phiFern, 1, undefined, {
    variants: [
      { name: "same", season: "summer", health: 1, maturity: 1 },
      { name: "Same", season: "winter", health: 1, maturity: 1 },
    ],
  }),
  /duplicate variant/,
);

const bundleOptions = {
  variants: PROCPLANT_STANDARD_VARIANTS.slice(0, 2),
  lod: "all" as const,
  glb: { collision: { type: "bounds-box" as const } },
};
const bundleA = await exportProcPlantVariantGlbBundle(procPlantPresets.cloverGroundcover, 42, undefined, bundleOptions);
const bundleB = await exportProcPlantVariantGlbBundle(procPlantPresets.cloverGroundcover, 42, undefined, bundleOptions);
assert.deepEqual(new Uint8Array(bundleB.bytes), new Uint8Array(bundleA.bytes), "bundle bytes must be deterministic");
assert.equal(bundleA.contract, PROCPLANT_VARIANT_BUNDLE_CONTRACT);
assert.equal(bundleA.fileName, "procplant-clovergroundcover-variants.glb");
assert.equal(bundleA.manifest.selection, "select-gltf-scene");
assert.equal(bundleA.manifest.defaultScene, 0);
assert.equal(bundleA.manifest.lodSelection, "all");
assert.equal(bundleA.manifest.collision?.type, "bounds-box");
assert.deepEqual(bundleA.manifest.variants.map((variant) => variant.name), ["spring", "summer"]);
assert.deepEqual(bundleA.manifest.variants.flatMap((variant) => variant.lods.map((lod) => lod.scene)), [0, 1, 2, 3, 4, 5, 6, 7]);
assert.ok(bundleA.manifest.variants.every((variant) => variant.lods.every((lod) =>
  lod.triangles > 0 && lod.vertices > 0 && Number.isFinite(lod.distance))));
assert.equal(bundleA.manifest.deduplication.meshInstances, 16);
assert.equal(bundleA.manifest.deduplication.uniqueMaterials, 3, "bark, organ, and collision materials must deduplicate independently");

const bundleJson = inspectGlb(bundleA.bytes);
assert.equal(bundleJson.scene, 0);
assert.equal(bundleJson.scenes?.length, 8);
assert.ok(!bundleJson.extensionsUsed?.includes("KHR_materials_variants"));
assert.ok(!bundleJson.extensionsUsed?.includes("MSFT_lod"));
const embeddedManifest = bundleJson.extras?.procplantVariantBundle as unknown as typeof bundleA.manifest;
assert.deepEqual(embeddedManifest, bundleA.manifest);
for (const variant of bundleA.manifest.variants) {
  for (const lod of variant.lods) {
    const scene = bundleJson.scenes?.[lod.scene];
    assert.equal(scene?.name, lod.sceneName);
    assert.equal(scene?.nodes?.length, 1, "each selectable scene must have exactly one root");
    const root = bundleJson.nodes?.[scene!.nodes![0]!];
    assert.equal(root?.name, lod.rootNodeName);
    const childNames = root?.children?.map((index) => bundleJson.nodes?.[index]?.name) ?? [];
    assert.ok(childNames.includes(lod.meshNodeName));
    assert.ok(childNames.includes(lod.collisionNodeName));
  }
}
assert.ok(bundleJson.materials?.some((material) =>
  material.alphaMode === "BLEND" && material.pbrMetallicRoughness?.baseColorFactor?.[3] === 0),
"collision proxies must be transparent in generic viewers");

const separate = await exportProcPlantVariantGlbs(procPlantPresets.cloverGroundcover, 42, undefined, {
  variants: bundleOptions.variants,
  glb: bundleOptions.glb,
});
const separateBytes = separate.reduce((sum, file) => sum + file.bytes.byteLength, 0);
assert.ok(bundleA.bytes.byteLength > 0 && separateBytes > 0);

const single = await exportProcPlantVariantGlbBundle(procPlantPresets.cloverGroundcover, 42, undefined, {
  variants: [PROCPLANT_STANDARD_VARIANTS[3]!],
  lod: 2,
});
const singleJson = inspectGlb(single.bytes);
assert.equal(singleJson.scenes?.length, 1);
assert.equal(single.manifest.variants[0]?.name, "winter");
assert.equal(single.manifest.variants[0]?.lods[0]?.level, 2);
assert.equal(single.manifest.collision, null);

await assert.rejects(
  exportProcPlantVariantGlbBundle(procPlantPresets.cloverGroundcover, 1, undefined, { lod: 9 as never }),
  /lod must be/,
);
await assert.rejects(
  exportProcPlantVariantGlbBundle(procPlantPresets.cloverGroundcover, 1, undefined, {
    variants: Array.from({ length: 17 }, (_, index) => ({
      name: `variant-${index}`,
      season: "summer" as const,
      health: 1,
      maturity: 1,
    })),
  }),
  /at most 16 variants/,
);
await assert.rejects(
  exportProcPlantVariantGlbBundle(procPlantPresets.cloverGroundcover, 1, undefined, {
    variants: [PROCPLANT_STANDARD_VARIANTS[0]!],
    lod: 3,
    maxBundleBytes: 1024,
  }),
  /exceeds maxBundleBytes/,
);

console.log(`procplant variant export tests passed (bundle ${bundleA.bytes.byteLength} bytes; separate ${separateBytes} bytes)`);
