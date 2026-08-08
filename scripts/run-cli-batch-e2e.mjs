import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-cli-batch-e2e-"));
const inputDirectory = join(tempDirectory, "input");
const nestedDirectory = join(inputDirectory, "nested");
const externalDirectory = join(tempDirectory, "external");
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
  await mkdir(nestedDirectory, { recursive: true });
  await mkdir(externalDirectory, { recursive: true });

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
  await writeFile(
    join(nestedDirectory, "clover.json"),
    `${JSON.stringify(procPlantPresets.cloverGroundcover, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(inputDirectory, "ignored.txt"), "not a genome\n", "utf8");
  await writeFile(join(externalDirectory, "invalid.json"), "{ definitely not JSON\n", "utf8");
  await symlink(
    externalDirectory,
    join(inputDirectory, "linked-external"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const result = await runCli([
    "compile-dir",
    inputDirectory,
    "--profile",
    "tellus-realtime",
    "--seed",
    "77",
    "--out",
    outputDirectory,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /compiled 1 genomes/);
  const manifest = JSON.parse(await readFile(join(outputDirectory, "manifest.json"), "utf8"));
  assert.equal(manifest.count, 1, "non-JSON files and linked directories must be ignored");
  assert.equal(manifest.entries[0].source, "nested/clover.json");
  assert.equal(manifest.entries[0].output, "clover-groundcover.procplant.json");
  await access(join(outputDirectory, "clover-groundcover.procplant.json"));

  const nestedOutput = join(inputDirectory, "generated");
  const rejected = await runCli([
    "compile-dir",
    inputDirectory,
    "--profile",
    "tellus-realtime",
    "--seed",
    "77",
    "--out",
    nestedOutput,
  ]);
  assert.equal(rejected.code, 2);
  assert.match(rejected.stderr, /must not be the input directory or a directory inside it/);
  await assert.rejects(access(nestedOutput));

  console.log(`ok 1 - actual CLI recursively compiles JSON and skips symlinks (${tempDirectory})`);
  console.log("ok 2 - actual CLI rejects an output directory nested under its input");
  console.log("1..2");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
