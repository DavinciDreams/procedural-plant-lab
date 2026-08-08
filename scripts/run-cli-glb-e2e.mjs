import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-cli-glb-e2e-"));
const inputDirectory = join(tempDirectory, "input");
const outputDirectory = join(tempDirectory, "output");

const runCli = (args) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [join(projectRoot, "scripts", "procplants-cli.mjs"), ...args], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", rejectRun);
  child.on("close", (code) => resolveRun({ code, stdout, stderr }));
});

const assertGlb = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.byteLength);
};

try {
  await mkdir(inputDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const presetBundle = join(tempDirectory, "procplants-presets.mjs");
  await build({
    entryPoints: [join(projectRoot, "src", "procplants.ts")],
    outfile: presetBundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  const { procPlantPresets } = await import(`${pathToFileURL(presetBundle).href}?run=${Date.now()}`);
  const genomePath = join(inputDirectory, "clover.json");
  await writeFile(genomePath, `${JSON.stringify(procPlantPresets.cloverGroundcover, null, 2)}\n`, "utf8");

  const outputA = join(outputDirectory, "clover-a.glb");
  const outputB = join(outputDirectory, "clover-b.glb");
  const invoke = (output) => runCli([
    "glb", genomePath,
    "--profile", "tellus-realtime",
    "--seed", "909",
    "--out", output,
    "--lod", "2",
    "--collision", "trunk-capsule",
  ]);
  const first = await invoke(outputA);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /GLB \(LOD 2, \d+ bytes\)/);
  const second = await invoke(outputB);
  assert.equal(second.code, 0, second.stderr);
  const bytesA = await readFile(outputA);
  const bytesB = await readFile(outputB);
  assertGlb(bytesA);
  assert.deepEqual(bytesB, bytesA);
  const validation = await runCli(["validate", outputA]);
  assert.equal(validation.code, 0, validation.stderr);
  const report = JSON.parse(validation.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.decodedMeshoptViews, 0);
  assert.ok(report.meshes > 0 && report.procplantMetadataRecords > 0);
  const batchValidation = await runCli(["validate", join(outputDirectory, "clover-*.glb")]);
  assert.equal(batchValidation.code, 0, batchValidation.stderr);
  const batchReport = JSON.parse(batchValidation.stdout);
  assert.equal(batchReport.valid, true);
  assert.equal(batchReport.assetType, "batch");
  assert.equal(batchReport.count, 2);
  assert.deepEqual(batchReport.entries.map((entry) => entry.path), [outputA, outputB].sort());

  const overwrite = await invoke(outputA);
  assert.equal(overwrite.code, 0, overwrite.stderr);
  assert.deepEqual(await readFile(outputA), bytesA);
  const siblings = await readdir(outputDirectory);
  assert.deepEqual(siblings.sort(), ["clover-a.glb", "clover-b.glb"]);

  console.log(`ok 1 - actual wrapper writes deterministic valid GLB bytes (${tempDirectory})`);
  console.log("ok 2 - existing-target replacement leaves no temporary sibling");
  console.log("ok 3 - actual validate command verifies uncompressed GLB structure and metadata");
  console.log("ok 4 - actual validate command deterministically expands and verifies GLB wildcards");
  console.log("1..4");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
