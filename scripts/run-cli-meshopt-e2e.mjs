import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer/decoder";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-cli-meshopt-e2e-"));
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

const inspectGlb = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd());
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
  const genomePath = join(inputDirectory, "phi-fern.json");
  await writeFile(genomePath, `${JSON.stringify(procPlantPresets.phiFern, null, 2)}\n`, "utf8");

  const outputA = join(outputDirectory, "phi-fern-a.glb");
  const outputB = join(outputDirectory, "phi-fern-b.glb");
  const invoke = (output) => runCli([
    "glb", genomePath,
    "--profile", "tellus-realtime",
    "--seed", "4242",
    "--out", output,
    "--lod", "0",
    "--meshopt", "required",
  ]);
  const first = await invoke(outputA);
  assert.equal(first.code, 0, first.stderr);
  const second = await invoke(outputB);
  assert.equal(second.code, 0, second.stderr);
  const bytesA = await readFile(outputA);
  const bytesB = await readFile(outputB);
  assert.deepEqual(bytesB, bytesA);
  const json = inspectGlb(bytesA);
  assert.ok(json.extensionsUsed.includes("EXT_meshopt_compression"));
  assert.ok(json.extensionsRequired.includes("EXT_meshopt_compression"));
  const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    bytesA.buffer.slice(bytesA.byteOffset, bytesA.byteOffset + bytesA.byteLength),
    "",
  );
  assert.ok(loaded.scene.children.length > 0);
  const validation = await runCli(["validate", outputA]);
  assert.equal(validation.code, 0, validation.stderr);
  const report = JSON.parse(validation.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.assetType, "glb");
  assert.ok(report.decodedMeshoptViews > 0);
  assert.ok(report.procplantMetadataRecords > 0);

  const overwrite = await invoke(outputA);
  assert.equal(overwrite.code, 0, overwrite.stderr);
  assert.deepEqual(await readFile(outputA), bytesA);
  assert.deepEqual((await readdir(outputDirectory)).sort(), ["phi-fern-a.glb", "phi-fern-b.glb"]);

  console.log(`ok 1 - actual wrapper emits deterministic decoder-loadable EXT_meshopt GLB (${bytesA.byteLength} bytes)`);
  console.log("ok 2 - meshopt overwrite leaves no temporary sibling");
  console.log("ok 3 - actual validate command decodes compressed views and verifies Procplants metadata");
  console.log("1..3");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
