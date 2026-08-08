import assert from "node:assert/strict";
import { procPlantPresets } from "../src/procplants";
import {
  PROCPLANT_CLI_EXIT,
  runProcPlantCli,
  type ProcPlantCliIo,
} from "../src/procplant-cli";

const textFiles = new Map([["genome.json", JSON.stringify(procPlantPresets.cloverGroundcover)]]);
const binaryFiles = new Map<string, Uint8Array>();
let stdout = "";
let stderr = "";
const io: ProcPlantCliIo = {
  readText: async (path) => {
    const value = textFiles.get(path);
    if (value === undefined) throw new Error(`missing fixture: ${path}`);
    return value;
  },
  readBinary: async (path) => {
    const value = binaryFiles.get(path);
    if (value === undefined) throw new Error(`missing binary fixture: ${path}`);
    return value.slice();
  },
  writeText: async (path, contents) => { textFiles.set(path, contents); },
  writeBinary: async (path, contents) => { binaryFiles.set(path, contents.slice()); },
  stdout: (message) => { stdout += message; },
  stderr: (message) => { stderr += message; },
};
const reset = () => {
  binaryFiles.clear();
  stdout = "";
  stderr = "";
};

const inspectGlb = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd()) as {
    scene?: number;
    scenes?: Array<{ nodes?: number[] }>;
    extensionsUsed?: string[];
    extensionsRequired?: string[];
    extras?: { procplantVariantBundle?: {
      contract?: string;
      lodSelection?: number | "all";
      variants?: Array<{ name?: string; lods?: Array<{ level?: number; scene?: number }> }>;
      collision?: { type?: string } | null;
    } };
  };
};

const args = (output: string, variants: string) => [
  "variant-glb", "genome.json",
  "--profile", "tellus-realtime",
  "--seed", "4242",
  "--out", output,
  "--variants", variants,
  "--lod", "2",
  "--collision", "bounds-box",
];

assert.equal(await runProcPlantCli(args("bundle-a.glb", "winter,spring"), io), PROCPLANT_CLI_EXIT.success, stderr);
const first = binaryFiles.get("bundle-a.glb")!;
const json = inspectGlb(first);
const manifest = json.extras?.procplantVariantBundle;
assert.equal(json.scene, 0);
assert.equal(json.scenes?.length, 2);
assert.equal(manifest?.contract, "procplants.variant-bundle");
assert.equal(manifest?.lodSelection, 2);
assert.equal(manifest?.collision?.type, "bounds-box");
assert.deepEqual(manifest?.variants?.map((variant) => variant.name), ["spring", "winter"]);
assert.deepEqual(manifest?.variants?.flatMap((variant) => variant.lods?.map((lod) => [lod.level, lod.scene]) ?? []), [[2, 0], [2, 1]]);
assert.match(stdout, /variant GLB \(2 variants, 2 scenes, \d+ bytes\)/);

reset();
assert.equal(await runProcPlantCli(args("bundle-b.glb", "spring,winter"), io), PROCPLANT_CLI_EXIT.success, stderr);
assert.deepEqual(binaryFiles.get("bundle-b.glb"), first, "variant order aliases must produce canonical deterministic bytes");
console.log("ok 1 - variant-glb writes a deterministic, canonically ordered multi-scene bundle");

for (const [selection, pattern] of [
  ["spring,spring", /must not contain duplicates/],
  ["spring,monsoon", /unknown standard variant/],
] as const) {
  reset();
  assert.equal(await runProcPlantCli(args("bad.glb", selection), io), PROCPLANT_CLI_EXIT.usage);
  assert.match(stderr, pattern);
  assert.equal(binaryFiles.size, 0);
}
reset();
assert.equal(await runProcPlantCli(args("bad.bin", "spring"), io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /must end in \.glb/);
console.log("ok 2 - variant-glb rejects duplicate, unknown, and unsafe output selections");

reset();
const unsupported: ProcPlantCliIo = {
  readText: io.readText,
  writeText: io.writeText,
  stdout: io.stdout,
  stderr: io.stderr,
};
assert.equal(await runProcPlantCli(args("bundle.glb", "spring"), unsupported), PROCPLANT_CLI_EXIT.failure);
assert.match(stderr, /does not support binary writes/);
console.log("ok 3 - variant-glb reports missing binary adapter support");

reset();
assert.equal(await runProcPlantCli([
  ...args("bundle-meshopt.glb", "spring,winter"),
  "--meshopt", "required",
], io), PROCPLANT_CLI_EXIT.success, stderr);
const compressed = binaryFiles.get("bundle-meshopt.glb")!;
const compressedJson = inspectGlb(compressed);
assert.ok(compressedJson.extensionsUsed?.includes("EXT_meshopt_compression"));
assert.ok(compressedJson.extensionsRequired?.includes("EXT_meshopt_compression"));
assert.ok(compressed.byteLength > 0);
console.log("ok 4 - variant-glb applies required meshopt compression after embedding its bundle manifest");

stdout = "";
stderr = "";
assert.equal(await runProcPlantCli(["validate", "bundle-meshopt.glb"], io), PROCPLANT_CLI_EXIT.success, stderr);
const report = JSON.parse(stdout) as {
  valid?: boolean;
  variantBundle?: boolean;
  decodedMeshoptViews?: number;
  procplantMetadataRecords?: number;
};
assert.equal(report.valid, true);
assert.equal(report.variantBundle, true);
assert.ok((report.decodedMeshoptViews ?? 0) > 0);
assert.ok((report.procplantMetadataRecords ?? 0) >= 2);
console.log("ok 5 - validate decodes and verifies a compressed Procplants variant bundle");

const corruptManifest = compressed.slice();
const corruptView = new DataView(corruptManifest.buffer, corruptManifest.byteOffset, corruptManifest.byteLength);
const corruptJsonLength = corruptView.getUint32(12, true);
const corruptJson = new TextDecoder().decode(corruptManifest.subarray(20, 20 + corruptJsonLength));
const sceneMapping = corruptJson.lastIndexOf('"scene":1');
assert.ok(sceneMapping >= 0, "fixture must contain its second scene mapping");
corruptManifest[20 + sceneMapping + '"scene":'.length] = "9".charCodeAt(0);
binaryFiles.set("bundle-corrupt.glb", corruptManifest);
stdout = "";
stderr = "";
assert.equal(await runProcPlantCli(["validate", "bundle-corrupt.glb"], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /variant spring scene must be an integer|variant winter scene must be an integer/);
console.log("ok 6 - validate rejects out-of-range variant scene mappings");
console.log("1..6");
