import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const tempRoot = await mkdtemp(join(tmpdir(), "procplants-package-consumer-"));
const packRoot = join(tempRoot, "pack");
const consumerRoot = join(tempRoot, "consumer");
const outputRoot = resolve(projectRoot, "dist-lib");
const commandTimeoutMs = 180_000;
const npmCli = process.env.npm_execpath;
const bunExecutable = process.platform === "win32"
  ? process.env.BUN_INSTALL
    ? join(process.env.BUN_INSTALL, "bin", "bun.exe")
    : "bun.exe"
  : "bun";

assert.ok(npmCli, "npm_execpath is required to run the package consumer smoke");
assert.equal(dirname(outputRoot), projectRoot, "package cleanup must remain inside the project root");
assert.equal(basename(outputRoot), "dist-lib", "package cleanup must target only dist-lib");

const run = (phase, command, args, cwd) => new Promise((resolveRun, rejectRun) => {
  console.log(`[package-consumer] ${phase}`);
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
    rejectRun(new Error(`${phase} timed out after ${commandTimeoutMs}ms`));
  }, commandTimeoutMs);
  child.once("error", (error) => {
    clearTimeout(timeout);
    rejectRun(error);
  });
  child.once("exit", (code, signal) => {
    clearTimeout(timeout);
    if (code === 0) resolveRun();
    else rejectRun(new Error(`${phase} failed with ${signal ?? `exit ${code}`}`));
  });
});

try {
  await rm(outputRoot, { recursive: true, force: true });
  await run("library build", process.execPath, [npmCli, "run", "build:lib"], projectRoot);
  await mkdir(packRoot, { recursive: true });
  await mkdir(join(consumerRoot, "src"), { recursive: true });
  await run("npm pack", process.execPath, [npmCli, "pack", "--ignore-scripts", "--pack-destination", packRoot], projectRoot);
  const archives = (await readdir(packRoot)).filter((name) => name.endsWith(".tgz"));
  assert.equal(archives.length, 1, "package smoke expects exactly one npm archive");
  const archivePath = join(packRoot, archives[0]);

  await writeFile(join(consumerRoot, "package.json"), JSON.stringify({
    name: "procplants-package-consumer-smoke",
    private: true,
    type: "module",
    dependencies: {
      procplants: `file:${archivePath}`,
      three: "0.183.2",
    },
    devDependencies: {
      "@types/three": "0.183.1",
      typescript: "5.9.3",
    },
  }, null, 2));
  await writeFile(join(consumerRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ["src"],
  }, null, 2));
  await writeFile(join(consumerRoot, "src", "index.ts"), `
import {
  PROCPLANT_GENERATOR_CONTRACT_REVISION,
  PROCPLANT_SUPPORTED_INSTANCE_KINDS,
  buildProcPlantGraph,
  buildProcPlantInstancePrototype,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantGenome,
  type ProcPlantSupportedInstanceKind,
  type ProcPlantTemplate,
} from "procplants/core";
import {
  buildProcPlantGraph as buildProcPlantGraphFromFullEntry,
  type ProcPlantGraph,
} from "procplants";

const genome: ProcPlantGenome = procPlantPresets.phiFern!;
const kind: ProcPlantSupportedInstanceKind = "fernFrond";
const graph: ProcPlantGraph = buildProcPlantGraph(genome, 612072, defaultPlantEnvironment());
const fullGraph: ProcPlantGraph = buildProcPlantGraphFromFullEntry(genome, 612072, defaultPlantEnvironment());
const prototype: ProcPlantTemplate = buildProcPlantInstancePrototype(kind, genome);

if (PROCPLANT_GENERATOR_CONTRACT_REVISION !== 3) throw new Error("unexpected contract revision");
if (PROCPLANT_SUPPORTED_INSTANCE_KINDS.length !== 20) throw new Error("unexpected kind registry");
if (graph.organs.length !== fullGraph.organs.length) throw new Error("entrypoint graph drift");
if (prototype.uv0.length !== prototype.pos.length / 3 * 2) throw new Error("UV0 contract drift");
console.log(JSON.stringify({ revision: PROCPLANT_GENERATOR_CONTRACT_REVISION, kind, triangles: prototype.idx.length / 3 }));
`);
  await writeFile(join(consumerRoot, "src", "runtime.mjs"), `
import {
  PROCPLANT_GENERATOR_CONTRACT_REVISION,
  buildProcPlantInstancePrototype,
  procPlantPresets,
} from "procplants/core";

const prototype = buildProcPlantInstancePrototype("fernFrond", procPlantPresets.phiFern);
if (PROCPLANT_GENERATOR_CONTRACT_REVISION !== 3) throw new Error("unexpected runtime contract revision");
if (prototype.idx.length / 3 !== 44) throw new Error("unexpected runtime fern prototype");
if (prototype.uv0.length !== prototype.pos.length / 3 * 2) throw new Error("runtime UV0 contract drift");
console.log(JSON.stringify({ revision: PROCPLANT_GENERATOR_CONTRACT_REVISION, triangles: prototype.idx.length / 3 }));
`);

  await run("Bun install", bunExecutable, ["install", "--ignore-scripts"], consumerRoot);
  await run("TypeScript consumer check", bunExecutable, ["run", "tsc", "--noEmit"], consumerRoot);
  await run("installed runtime check", bunExecutable, ["run", "src/runtime.mjs"], consumerRoot);

  const installedCoreTypes = join(consumerRoot, "node_modules", "procplants", "dist-lib", "types", "core.d.ts");
  const installedProcplantsTypes = join(consumerRoot, "node_modules", "procplants", "dist-lib", "types", "procplants.d.ts");
  assert.match(await readFile(installedCoreTypes, "utf8"), /buildProcPlantInstancePrototype/);
  assert.match(await readFile(installedProcplantsTypes, "utf8"), /interface ProcPlantTemplate/);
  console.log("procplants packed Bun/TypeScript consumer smoke passed");
} finally {
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
