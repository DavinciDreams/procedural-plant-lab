import assert from "node:assert/strict";
import { procPlantPresets } from "../src/procplants";
import {
  PROCPLANT_CLI_EXIT,
  runProcPlantCli,
  type ProcPlantCliIo,
} from "../src/procplant-cli";

const textFiles = new Map<string, string>();
const binaryFiles = new Map<string, Uint8Array>();
let stdout = "";
let stderr = "";
const io: ProcPlantCliIo = {
  readText: async (path) => {
    const value = textFiles.get(path);
    if (value === undefined) throw new Error(`missing fixture: ${path}`);
    return value;
  },
  writeText: async (path, contents) => { textFiles.set(path, contents); },
  readBinary: async (path) => {
    const value = binaryFiles.get(path);
    if (!value) throw new Error(`missing binary fixture: ${path}`);
    return value.slice();
  },
  writeBinary: async (path, contents) => { binaryFiles.set(path, contents.slice()); },
  expandPaths: async (pattern) => pattern === "plants-*.glb"
    ? ["plants-b.glb", "plants-a.glb"]
    : [],
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
  assert.equal(view.getUint32(0, true), 0x46546c67, "GLB magic must be glTF");
  assert.equal(view.getUint32(4, true), 2, "GLB version must be 2");
  assert.equal(view.getUint32(8, true), bytes.byteLength, "GLB header length must match file length");
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, "first GLB chunk must be JSON");
  const json = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd();
  return JSON.parse(json) as {
    asset: { version: string };
    nodes?: Array<{ name?: string; extras?: Record<string, unknown> }>;
    scenes?: Array<{ name?: string; extras?: Record<string, unknown> }>;
    extensionsUsed?: string[];
    extensionsRequired?: string[];
  };
};

textFiles.set("genome.json", JSON.stringify(procPlantPresets.cloverGroundcover));
const baseArgs = [
  "glb", "genome.json", "--profile", "tellus-realtime", "--seed", "4242", "--out", "plant-a.glb",
];
assert.equal(await runProcPlantCli(baseArgs, io), PROCPLANT_CLI_EXIT.success, stderr);
const first = binaryFiles.get("plant-a.glb")!;
const firstJson = inspectGlb(first);
assert.equal(firstJson.asset.version, "2.0");
assert.ok(!firstJson.extensionsUsed?.includes("EXT_meshopt_compression"), "meshopt must remain opt-in");
assert.ok(firstJson.nodes?.some((node) => node.name === "procplant-clovergroundcover-mesh"));
const sceneContract = firstJson.scenes?.[0]?.extras?.procplant as {
  genomeId?: string;
  seed?: number;
  metadata?: Record<string, unknown>;
};
assert.equal(sceneContract.genomeId, "cloverGroundcover");
assert.equal(sceneContract.seed, 4242);
assert.equal(sceneContract.metadata?.profile, "tellus-realtime");
assert.equal(sceneContract.metadata?.lodSelection, "0");
assert.equal(typeof sceneContract.metadata?.readinessScore, "number");
assert.match(stdout, /GLB \(LOD 0, \d+ bytes\)/);
stdout = "";
assert.equal(await runProcPlantCli(["validate", "plant-a.glb"], io), PROCPLANT_CLI_EXIT.success, stderr);
const validated = JSON.parse(stdout) as {
  valid: boolean;
  assetType: string;
  meshes: number;
  procplantMetadataRecords: number;
  decodedMeshoptViews: number;
};
assert.equal(validated.valid, true);
assert.equal(validated.assetType, "glb");
assert.ok(validated.meshes > 0 && validated.procplantMetadataRecords > 0);
assert.equal(validated.decodedMeshoptViews, 0);

reset();
assert.equal(
  await runProcPlantCli(baseArgs.map((value) => value === "plant-a.glb" ? "plant-b.glb" : value), io),
  PROCPLANT_CLI_EXIT.success,
);
const second = binaryFiles.get("plant-b.glb")!;
assert.deepEqual(second, first, "native GLB bytes must be deterministic for identical inputs");
console.log("ok 1 - native CLI writes deterministic GLB v2 bytes for one selected LOD");

reset();
assert.equal(await runProcPlantCli([
  "glb", "genome.json", "--profile", "web-preview", "--seed", "4242", "--out", "all.glb",
  "--lod", "all", "--collision", "bounds-box",
], io), PROCPLANT_CLI_EXIT.success);
const all = binaryFiles.get("all.glb")!;
const allJson = inspectGlb(all);
const names = allJson.nodes?.map((node) => node.name).filter(Boolean) ?? [];
assert.deepEqual(names.filter((name) => /-lod[0-3]-/.test(name!)), [
  "procplant-clovergroundcover-lod0-full",
  "procplant-clovergroundcover-lod1-clustered",
  "procplant-clovergroundcover-lod2-billboard-cross",
  "procplant-clovergroundcover-lod3-impostor",
]);
assert.ok(names.some((name) => name === "procplant-clovergroundcover-collision-bounds-box"));
assert.match(stdout, /all LODs/);
console.log("ok 2 - native CLI exports all real LOD nodes plus an optional collision proxy");

reset();
assert.equal(await runProcPlantCli([
  "glb", "genome.json", "--profile", "tellus-realtime", "--seed", "1", "--out", "bad.bin",
], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /must end in \.glb/);
reset();
assert.equal(await runProcPlantCli([
  "glb", "genome.json", "--profile", "tellus-realtime", "--seed", "1", "--out", "bad.glb", "--lod", "9",
], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /--lod must be/);
reset();
assert.equal(await runProcPlantCli([
  "glb", "genome.json", "--profile", "tellus-realtime", "--seed", "1", "--out", "bad.glb", "--collision", "mesh",
], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /--collision must be/);
console.log("ok 3 - native GLB flags reject unsafe extensions and unsupported LOD/collision modes");

reset();
const unsupportedIo: ProcPlantCliIo = {
  readText: io.readText,
  writeText: io.writeText,
  stdout: io.stdout,
  stderr: io.stderr,
};
assert.equal(await runProcPlantCli(baseArgs, unsupportedIo), PROCPLANT_CLI_EXIT.failure);
assert.match(stderr, /does not support binary writes/);
console.log("ok 4 - native GLB reports missing binary adapter capability as a runtime failure");

reset();
assert.equal(await runProcPlantCli([
  ...baseArgs.map((value) => value === "plant-a.glb" ? "meshopt.glb" : value),
  "--meshopt", "required",
], io), PROCPLANT_CLI_EXIT.success, stderr);
const meshopt = binaryFiles.get("meshopt.glb")!;
const meshoptJson = inspectGlb(meshopt);
assert.ok(meshoptJson.extensionsUsed?.includes("EXT_meshopt_compression"));
assert.ok(meshoptJson.extensionsRequired?.includes("EXT_meshopt_compression"));
assert.ok(meshopt.byteLength < first.byteLength);
stdout = "";
assert.equal(await runProcPlantCli(["validate", "meshopt.glb"], io), PROCPLANT_CLI_EXIT.success, stderr);
assert.ok(JSON.parse(stdout).decodedMeshoptViews > 0, "GLB validation must really decode required meshopt views");
reset();
assert.equal(await runProcPlantCli([
  ...baseArgs.map((value) => value === "plant-a.glb" ? "fallback.glb" : value),
  "--meshopt", "fallback",
], io), PROCPLANT_CLI_EXIT.success, stderr);
stdout = "";
assert.equal(await runProcPlantCli(["validate", "fallback.glb"], io), PROCPLANT_CLI_EXIT.success, stderr);
const fallbackValidation = JSON.parse(stdout);
assert.ok(fallbackValidation.decodedMeshoptViews > 0);
assert.equal(fallbackValidation.verifiedMeshoptFallbackViews, fallbackValidation.decodedMeshoptViews);
reset();
assert.equal(await runProcPlantCli([
  ...baseArgs.map((value) => value === "plant-a.glb" ? "bad.glb" : value),
  "--meshopt", "draco",
], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /--meshopt must be none, required, or fallback/);
console.log("ok 5 - native GLB meshopt is opt-in, smaller, and rejects unsupported modes");

binaryFiles.set("corrupt.glb", first.slice());
binaryFiles.get("corrupt.glb")![0] ^= 1;
stdout = "";
stderr = "";
assert.equal(await runProcPlantCli(["validate", "corrupt.glb"], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /invalid Procplants GLB \(GLB magic is invalid\)/);
console.log("ok 6 - validate inspects plain, required/fallback meshopt, and corrupt GLB assets");

binaryFiles.set("plants-a.glb", first.slice());
binaryFiles.set("plants-b.glb", first.slice());
stdout = "";
stderr = "";
assert.equal(await runProcPlantCli(["validate", "plants-*.glb"], io), PROCPLANT_CLI_EXIT.success, stderr);
const batch = JSON.parse(stdout) as {
  valid?: boolean;
  assetType?: string;
  count?: number;
  entries?: Array<{ path?: string; assetType?: string }>;
};
assert.equal(batch.valid, true);
assert.equal(batch.assetType, "batch");
assert.equal(batch.count, 2);
assert.deepEqual(batch.entries?.map((entry) => entry.path), ["plants-a.glb", "plants-b.glb"]);
assert.ok(batch.entries?.every((entry) => entry.assetType === "glb"));
stdout = "";
stderr = "";
assert.equal(await runProcPlantCli(["validate", "missing-*.glb"], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /matched no files/);
assert.equal(stdout, "");
console.log("ok 7 - validate expands bounded wildcards, sorts results, and rejects empty matches");
console.log("1..7");
