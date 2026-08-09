import assert from "node:assert/strict";
import { resolve } from "node:path";
import { procPlantPresets, type ProcPlantGenome } from "../src/procplants";
import {
  PROCPLANT_CLI_EXIT,
  runProcPlantCli,
  type ProcPlantCliDirectoryFile,
  type ProcPlantCliIo,
} from "../src/procplant-cli";

const sourceFiles = new Map<string, string>();
const writes = new Map<string, string>();
let listed: ProcPlantCliDirectoryFile[] = [];
let stdout = "";
let stderr = "";
const io: ProcPlantCliIo = {
  readText: async (path) => {
    const value = sourceFiles.get(path);
    if (value === undefined) throw new Error(`missing fixture: ${path}`);
    return value;
  },
  writeText: async (path, contents) => {
    writes.set(path.replace(/\\/g, "/"), contents);
  },
  listTextFiles: async () => listed,
  resolvePath: (path) => resolve(path),
  stdout: (message) => { stdout += message; },
  stderr: (message) => { stderr += message; },
};
const reset = () => {
  writes.clear();
  stdout = "";
  stderr = "";
};

const clover = structuredClone(procPlantPresets.cloverGroundcover);
const fern: ProcPlantGenome = {
  ...structuredClone(procPlantPresets.brackenFernMat),
  id: "Fern Mat / Low",
};
sourceFiles.set("fixtures/clover.json", JSON.stringify(clover));
sourceFiles.set("fixtures/nested/fern.json", JSON.stringify(fern));
listed = [
  { path: "fixtures/nested/fern.json", relativePath: "nested\\fern.json" },
  { path: "fixtures/clover.json", relativePath: "clover.json" },
];

const args = [
  "compile-dir", "fixtures", "--profile", "tellus-realtime", "--seed", "19", "--out", "dist/batch",
];
assert.equal(await runProcPlantCli(args, io), PROCPLANT_CLI_EXIT.success);
assert.deepEqual([...writes.keys()], [
  "dist/batch/clover-groundcover.procplant.json",
  "dist/batch/fern-mat-low.procplant.json",
  "dist/batch/manifest.json",
]);
const firstManifest = writes.get("dist/batch/manifest.json")!;
const manifest = JSON.parse(firstManifest);
assert.equal(manifest.command, "compile-dir");
assert.equal(manifest.count, 2);
assert.deepEqual(manifest.entries.map((entry: { source: string; output: string }) => ({
  source: entry.source,
  output: entry.output,
})), [
  { source: "clover.json", output: "clover-groundcover.procplant.json" },
  { source: "nested/fern.json", output: "fern-mat-low.procplant.json" },
]);
assert.ok(manifest.entries.every((entry: { contentHash: string }) => /^fnv1a32:[0-9a-f]{8}$/.test(entry.contentHash)));
assert.match(stdout, /compiled 2 genomes/);

reset();
listed.reverse();
assert.equal(await runProcPlantCli(args, io), PROCPLANT_CLI_EXIT.success);
assert.equal(writes.get("dist/batch/manifest.json"), firstManifest);
assert.deepEqual([...writes.keys()], [
  "dist/batch/clover-groundcover.procplant.json",
  "dist/batch/fern-mat-low.procplant.json",
  "dist/batch/manifest.json",
]);
console.log("ok 1 - compile-dir is byte-stable across directory enumeration order");

reset();
sourceFiles.set("fixtures/bad.json", JSON.stringify({ id: "bad" }));
listed = [
  { path: "fixtures/clover.json", relativePath: "clover.json" },
  { path: "fixtures/bad.json", relativePath: "bad.json" },
];
assert.equal(await runProcPlantCli(args, io), PROCPLANT_CLI_EXIT.usage);
assert.equal(writes.size, 0, "the batch must be fully validated before its first write");
assert.match(stderr, /genome\.habit/);
console.log("ok 2 - compile-dir validates the whole batch before writing outputs");

reset();
listed = [
  { path: "fixtures/clover.json", relativePath: "../clover.json" },
];
assert.equal(await runProcPlantCli(args, io), PROCPLANT_CLI_EXIT.usage);
assert.equal(writes.size, 0);
assert.match(stderr, /safe relative path/);
console.log("ok 3 - compile-dir rejects unsafe discovered relative paths");

reset();
const duplicate = { ...structuredClone(clover), id: "Clover--Groundcover" };
sourceFiles.set("fixtures/duplicate.json", JSON.stringify(duplicate));
listed = [
  { path: "fixtures/clover.json", relativePath: "clover.json" },
  { path: "fixtures/duplicate.json", relativePath: "duplicate.json" },
];
assert.equal(await runProcPlantCli(args, io), PROCPLANT_CLI_EXIT.usage);
assert.equal(writes.size, 0);
assert.match(stderr, /output name collision/);
console.log("ok 4 - compile-dir rejects deterministic output-name collisions");

reset();
listed = [{ path: "fixtures/clover.json", relativePath: "clover.json" }];
assert.equal(await runProcPlantCli([
  "compile-dir", "fixtures", "--profile", "tellus-realtime", "--seed", "19", "--out", "fixtures/dist",
], io), PROCPLANT_CLI_EXIT.usage);
assert.equal(writes.size, 0);
assert.match(stderr, /must not be the input directory/);
console.log("ok 5 - compile-dir rejects output directories nested under inputs");

reset();
const unsupportedIo: ProcPlantCliIo = {
  readText: io.readText,
  writeText: io.writeText,
  stdout: io.stdout,
  stderr: io.stderr,
};
assert.equal(await runProcPlantCli(args, unsupportedIo), PROCPLANT_CLI_EXIT.failure);
assert.match(stderr, /does not support directory listing/);
console.log("ok 6 - compile-dir reports an unsupported adapter as a runtime failure");
console.log("1..6");
