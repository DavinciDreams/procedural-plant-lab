import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-cli-variant-bundle-e2e-"));
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
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd());
  assert.equal(json.scene, 0);
  assert.equal(json.scenes.length, 2);
  assert.equal(json.extras.procplantVariantBundle.contract, "procplants.variant-bundle");
  assert.deepEqual(json.extras.procplantVariantBundle.variants.map((variant) => variant.name), ["spring", "winter"]);
  assert.deepEqual(json.extras.procplantVariantBundle.variants.map((variant) => variant.lods[0].level), [2, 2]);
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

  const outputA = join(outputDirectory, "clover-variants-a.glb");
  const outputB = join(outputDirectory, "clover-variants-b.glb");
  const invoke = (output, variants) => runCli([
    "variant-glb", genomePath,
    "--profile", "tellus-realtime",
    "--seed", "909",
    "--out", output,
    "--variants", variants,
    "--lod", "2",
    "--collision", "bounds-box",
  ]);
  const first = await invoke(outputA, "winter,spring");
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /variant GLB \(2 variants, 2 scenes, \d+ bytes\)/);
  const second = await invoke(outputB, "spring,winter");
  assert.equal(second.code, 0, second.stderr);
  const bytesA = await readFile(outputA);
  const bytesB = await readFile(outputB);
  inspectGlb(bytesA);
  assert.deepEqual(bytesB, bytesA);
  const validation = await runCli(["validate", outputA]);
  assert.equal(validation.code, 0, validation.stderr);
  const report = JSON.parse(validation.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.assetType, "glb");
  assert.equal(report.variantBundle, true);
  assert.ok(report.procplantMetadataRecords >= 2);

  const overwrite = await invoke(outputA, "spring,winter");
  assert.equal(overwrite.code, 0, overwrite.stderr);
  assert.deepEqual(await readFile(outputA), bytesA);
  assert.deepEqual((await readdir(outputDirectory)).sort(), ["clover-variants-a.glb", "clover-variants-b.glb"]);

  console.log(`ok 1 - actual wrapper writes deterministic variant bundle GLB bytes (${tempDirectory})`);
  console.log("ok 2 - variant bundle replacement leaves no temporary sibling");
  console.log("ok 3 - actual validate command verifies the bundle manifest and Procplants metadata");
  console.log("1..3");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
