import assert from "node:assert/strict";
import {
  compileProcPlantFiveTierLodsFromAtlasAsset,
  createProcPlantFiveTierAtlasBuildManifest,
  parseProcPlantFiveTierAtlasAsset,
  PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT,
  PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION,
  serializeProcPlantFiveTierAtlasAsset,
  validateProcPlantFiveTierAtlasAsset,
  validateProcPlantFiveTierAtlasBuildManifest,
  type ProcPlantFiveTierAtlasAsset,
} from "../src/procplant-five-tier-atlas-build";
import { exportProcPlantFiveTierLodGlb } from "../src/procplant-five-tier-lod";
import { validateProcPlantFiveTierLodPackage } from "../src/procplant-five-tier-lod";
import { buildProcPlantImpostorAtlas } from "../src/procplant-impostor";
import { validateProcPlantGlb } from "../src/procplant-glb-validation";
import { PROCPLANT_CLI_EXIT, runProcPlantCli, type ProcPlantCliIo } from "../src/procplant-cli";
import { defaultPlantEnvironment, procPlantPresets } from "../src/procplants";

const genome = procPlantPresets.phiFern!;
const seed = 612072;
const environment = defaultPlantEnvironment();
const manifest = createProcPlantFiveTierAtlasBuildManifest(genome, seed, environment, {
  width: 16,
  height: 16,
  azimuthCount: 4,
  elevations: [0, Math.PI / 6],
  padding: 2,
  samples: 0,
  maxAtlasSize: 256,
  maxAtlasBytes: 256 * 1024,
});
const manifestAgain = createProcPlantFiveTierAtlasBuildManifest(genome, seed, environment, {
  width: 16,
  height: 16,
  azimuthCount: 4,
  elevations: [Math.PI / 6, 0],
  padding: 2,
  samples: 0,
  maxAtlasSize: 256,
  maxAtlasBytes: 256 * 1024,
});
assert.deepEqual(manifestAgain, manifest, "equivalent elevation input must canonicalize to one build/cache manifest");
assert.equal(validateProcPlantFiveTierAtlasBuildManifest(manifest), manifest);
assert.match(manifest.cacheKey, /^procplants-lod5-atlas-v1-[0-9a-f]{8}$/);
assert.equal(manifest.capture.plan.views.length, 8);
assert.equal(manifest.source.lod0ContentHash, "fnv1a32-eea44b90");

const atlas = await buildProcPlantImpostorAtlas(manifest.capture.plan, async ({ view, width, height }) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const inside = Math.abs(x - width / 2) + Math.abs(y - height / 2) < width * 0.7;
    rgba.set([32 + view.azimuthIndex * 16, 120 + view.elevationIndex * 36, 58, inside ? 255 : 0], offset);
  }
  return { id: view.id, width, height, rgba };
}, { padding: manifest.atlas.padding, powerOfTwo: true, maxSize: manifest.atlas.maxSize });

const asset: ProcPlantFiveTierAtlasAsset = {
  contract: PROCPLANT_FIVE_TIER_ATLAS_ASSET_CONTRACT,
  version: PROCPLANT_FIVE_TIER_ATLAS_ASSET_VERSION,
  cacheKey: manifest.cacheKey,
  build: manifest,
  atlas,
  capture: {
    api: "three-webgl-render-target-readback",
    threeRevision: "test-fixture-not-runtime-proof",
    samplesRequested: manifest.capture.samples,
    samplesUsed: 0,
    rendererMaxTextureSize: manifest.atlas.maxSize,
  },
};
assert.equal(validateProcPlantFiveTierAtlasAsset(asset), asset);
const serialized = serializeProcPlantFiveTierAtlasAsset(asset);
const parsed = parseProcPlantFiveTierAtlasAsset(serialized);
assert.equal(serializeProcPlantFiveTierAtlasAsset(parsed), serialized, "asset document bytes must round-trip deterministically");
assert.equal(parsed.atlas.contentHash, atlas.contentHash);
assert.deepEqual(parsed.atlas.rgba, atlas.rgba);
const compiled = compileProcPlantFiveTierLodsFromAtlasAsset(genome, parsed, environment);
assert.equal(compiled.atlasAsset?.cacheKey, manifest.cacheKey);
assert.equal(compiled.atlasAsset?.atlasContentHash, atlas.contentHash);
assert.deepEqual(compiled.lods.map((lod) => lod.triangles), [352, 264, 4, 4, 2]);
assert.throws(() => validateProcPlantFiveTierLodPackage({
  ...compiled,
  atlasAsset: { ...compiled.atlasAsset!, atlasContentHash: "fnv1a32-deadbeef" },
}), /provenance/);
const glb = await exportProcPlantFiveTierLodGlb(compiled, { name: "phi-fern-lod5-asset" });
assert.equal((await validateProcPlantGlb(glb)).valid, true);
const view = new DataView(glb);
const jsonLength = view.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)).trim());
assert.equal(json.extras.procplantFiveTierLod.atlasAsset.cacheKey, manifest.cacheKey);
assert.equal(json.extensionsUsed?.some((extension: string) => /lod/i.test(extension)) ?? false, false);

const textFiles = new Map<string, string>([
  ["phi.json", JSON.stringify(genome)],
  ["phi-lod5-atlas.json", serialized],
]);
const binaryFiles = new Map<string, Uint8Array>();
let cliOutput = "";
const cliIo: ProcPlantCliIo = {
  readText: async (path) => {
    const value = textFiles.get(path);
    if (value === undefined) throw new Error(`missing test file ${path}`);
    return value;
  },
  writeText: async (path, contents) => { textFiles.set(path, contents); },
  writeBinary: async (path, contents) => { binaryFiles.set(path, contents.slice()); },
  stdout: (message) => { cliOutput += message; },
  stderr: (message) => { throw new Error(message); },
};
assert.equal(await runProcPlantCli([
  "lod5-glb", "phi.json", "--seed", String(seed), "--atlas", "phi-lod5-atlas.json", "--out", "phi-lod5.glb",
], cliIo), PROCPLANT_CLI_EXIT.success);
assert.match(cliOutput, /compiled phiFern five-tier GLB/);
assert.equal((await validateProcPlantGlb(binaryFiles.get("phi-lod5.glb")!)).valid, true);

const parsedDocument = JSON.parse(serialized);
parsedDocument.cacheKey = "procplants-lod5-atlas-v1-deadbeef";
assert.throws(() => parseProcPlantFiveTierAtlasAsset(JSON.stringify(parsedDocument)), /cacheKey/);
const stalePixels = JSON.parse(serialized);
stalePixels.atlas.rgbaBase64 = `${stalePixels.atlas.rgbaBase64[0] === "A" ? "B" : "A"}${stalePixels.atlas.rgbaBase64.slice(1)}`;
assert.throws(() => parseProcPlantFiveTierAtlasAsset(JSON.stringify(stalePixels)), /content hash is stale/);
const staleManifest = structuredClone(manifest);
staleManifest.source.lod0ContentHash = "fnv1a32-deadbeef";
assert.throws(() => validateProcPlantFiveTierAtlasBuildManifest(staleManifest), /cacheKey is stale/);
assert.throws(() => parseProcPlantFiveTierAtlasAsset(serialized, { maxAtlasBytes: 16 }), /resource limits/);
assert.throws(() => createProcPlantFiveTierAtlasBuildManifest(genome, seed, environment, {
  width: 512,
  height: 512,
  azimuthCount: 8,
  elevations: [0],
  maxAtlasSize: 8192,
  maxAtlasBytes: 1024,
}), /maxAtlasBytes|exceeds/);

console.log(JSON.stringify({
  cacheKey: manifest.cacheKey,
  sourceHash: manifest.source.lod0ContentHash,
  atlasHash: atlas.contentHash,
  atlasBytes: atlas.rgba.byteLength,
  documentBytes: new TextEncoder().encode(serialized).byteLength,
  glbBytes: glb.byteLength,
}));
console.log("procplant five-tier atlas asset build tests passed");
