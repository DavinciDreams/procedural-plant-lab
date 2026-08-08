import assert from "node:assert/strict";
import { exportProcPlantGlb } from "../src/procplant-export";
import {
  exportProcPlantVariantGlbBundle,
  PROCPLANT_STANDARD_VARIANTS,
} from "../src/procplant-variant-export";
import { compileProcPlantLods, defaultPlantEnvironment, procPlantPresets } from "../src/procplants";

const metric = (name: string, inputBytes: number, outputBytes: number) => ({
  name,
  inputBytes,
  outputBytes,
  savedBytes: inputBytes - outputBytes,
  savingsPercent: Number((((inputBytes - outputBytes) / inputBytes) * 100).toFixed(2)),
});

const environment = defaultPlantEnvironment();
const measurements = [];
for (const [name, preset] of [
  ["phiFern-lod0", procPlantPresets.phiFern],
  ["shorePineCones-lod0", procPlantPresets.shorePineCones],
] as const) {
  const lod = compileProcPlantLods(preset, 4242, environment)[0]!;
  const uncompressed = await exportProcPlantGlb(lod.template, { name, genomeId: preset.id, seed: 4242 });
  const compressed = await exportProcPlantGlb(lod.template, {
    name,
    genomeId: preset.id,
    seed: 4242,
    meshopt: { compatibility: "required" },
  });
  measurements.push(metric(name, uncompressed.byteLength, compressed.byteLength));
}

const bundleOptions = {
  variants: PROCPLANT_STANDARD_VARIANTS.slice(0, 2),
  lod: "all" as const,
  glb: { collision: { type: "bounds-box" as const } },
};
const bundle = await exportProcPlantVariantGlbBundle(
  procPlantPresets.cloverGroundcover,
  42,
  environment,
  bundleOptions,
);
const compressedBundle = await exportProcPlantVariantGlbBundle(
  procPlantPresets.cloverGroundcover,
  42,
  environment,
  {
    ...bundleOptions,
    glb: {
      ...bundleOptions.glb,
      meshopt: { compatibility: "required" },
    },
  },
);
measurements.push(metric("clover-2-variant-all-lod-bundle", bundle.bytes.byteLength, compressedBundle.bytes.byteLength));

for (const measurement of measurements) {
  assert.ok(measurement.savedBytes > 0, `${measurement.name} should save bytes`);
  assert.ok(measurement.savingsPercent > 20, `${measurement.name} should deliver material geometry savings`);
}
console.log(JSON.stringify({ meshoptBenchmarks: measurements }, null, 2));
