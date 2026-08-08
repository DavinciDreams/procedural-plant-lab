import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-cli-usda-e2e-"));
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

  const outputA = join(outputDirectory, "clover-a.usda");
  const outputB = join(outputDirectory, "clover-b.usda");
  const invoke = (output) => runCli([
    "usda", genomePath,
    "--profile", "tellus-realtime",
    "--seed", "909",
    "--out", output,
    "--lod", "2",
    "--collision", "bounds-box",
  ]);
  const first = await invoke(outputA);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /USDA \(LOD 2, \d+ bytes\)/);
  const second = await invoke(outputB);
  assert.equal(second.code, 0, second.stderr);
  const textA = await readFile(outputA, "utf8");
  const textB = await readFile(outputB, "utf8");
  assert.ok(textA.startsWith("#usda 1.0\n"));
  assert.match(textA, /custom int procplant:lodLevel = 2/);
  assert.match(textA, /prepend apiSchemas = \["PhysicsCollisionAPI"\]/);
  assert.equal(textB, textA);

  await writeFile(outputA, "stale partial output", "utf8");
  const overwrite = await invoke(outputA);
  assert.equal(overwrite.code, 0, overwrite.stderr);
  assert.equal(await readFile(outputA, "utf8"), textA);
  assert.deepEqual((await readdir(outputDirectory)).sort(), ["clover-a.usda", "clover-b.usda"]);

  console.log(`ok 1 - actual wrapper writes deterministic UTF-8 USDA text (${tempDirectory})`);
  console.log("ok 2 - existing-target replacement leaves no temporary or partial sibling");
  console.log("1..2");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
