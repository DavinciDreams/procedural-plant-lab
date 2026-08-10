import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(projectRoot, "dist-lib");
const corePath = join(outputRoot, "core.js");
const fullPath = join(outputRoot, "procplants.js");
const webgpuPath = join(outputRoot, "webgpu.js");

const staticImportPattern = /(?:\bfrom\s*|\bimport\s*)["'](\.\.?\/[^"']+)["']/g;
const transitiveFiles = async (entryPath) => {
  const pending = [entryPath];
  const visited = new Set();
  while (pending.length > 0) {
    const path = pending.shift();
    if (visited.has(path)) continue;
    visited.add(path);
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(staticImportPattern)) {
      const imported = resolve(dirname(path), match[1]);
      if (imported.startsWith(outputRoot)) pending.push(imported);
    }
  }
  return [...visited].sort();
};

const footprint = async (entryPath) => {
  const files = await transitiveFiles(entryPath);
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const path of files) {
    const contents = await readFile(path);
    rawBytes += contents.length;
    gzipBytes += gzipSync(contents, { level: 9 }).length;
  }
  return {
    files: files.map((path) => relative(outputRoot, path).replaceAll("\\", "/")),
    rawBytes,
    gzipBytes,
  };
};

const core = await import(`${pathToFileURL(corePath).href}?smoke=${Date.now()}`);
const full = await import(`${pathToFileURL(fullPath).href}?smoke=${Date.now()}`);
const webgpu = await import(`${pathToFileURL(webgpuPath).href}?smoke=${Date.now()}`);
for (const symbol of [
  "PROCPLANT_GENERATOR_CONTRACT_REVISION",
  "TELLUS_PROCPLANT_PACKAGE_CONTRACT",
  "buildProcPlantGraph",
  "compileProcPlantLods",
  "buildProcPlantRuntimePackage",
  "PROCPLANT_EXPORT_PROFILES",
  "applyProcPlantVariant",
  "makeEcologyBiomeMix",
  "toTellusProcPlantBiomeMix",
  "buildTellusProcPlantPackage",
]) {
  assert.ok(symbol in core, `core entry must export ${symbol}`);
}
for (const excluded of [
  "runProcPlantCli",
  "exportProcPlantGlb",
  "prepareProcPlantGlbExport",
  "createProcPlantCutout",
  "createProcPlantDebugOverlay",
  "createProcPlantGraphEditor",
]) {
  assert.equal(excluded in core, false, `core entry must not export ${excluded}`);
}
for (const symbol of Object.keys(core)) {
  assert.ok(symbol in full, `the preserved full entry must include core export ${symbol}`);
}
assert.equal(typeof full.runProcPlantCli, "function");
assert.equal(typeof full.exportProcPlantGlb, "function");
assert.equal(typeof full.createProcPlantCutout, "function");
assert.equal(typeof webgpu.createProcPlantWebGpuVisibilityPlan, "function");
assert.equal(typeof webgpu.createProcPlantWebGpuVisibilityRuntime, "function");
assert.equal(typeof webgpu.createProcPlantWebGpuIndexedIndirectDrawEncoder, "function");
assert.equal("createProcPlantWebGpuVisibilityRuntime" in core, false,
  "the injected-device runtime must remain outside the core/Tellus entry");
assert.equal("createProcPlantWebGpuVisibilityRuntime" in full, false,
  "the injected-device runtime must remain outside the default full entry");
assert.equal("createProcPlantWebGpuIndexedIndirectDrawEncoder" in core, false,
  "the indexed-indirect draw encoder must remain outside the core/Tellus entry");
assert.equal("createProcPlantWebGpuIndexedIndirectDrawEncoder" in full, false,
  "the indexed-indirect draw encoder must remain outside the default full entry");
assert.equal(core.TELLUS_PROCPLANT_PACKAGE_CONTRACT, "tellus.procplants.package.v1");
assert.equal(core.PROCPLANT_GENERATOR_CONTRACT_REVISION, 2);
const mix = core.makeEcologyBiomeMix("grassland", 612072);
const tellusMix = core.toTellusProcPlantBiomeMix(mix);
assert.equal(tellusMix.version, 1);
assert.equal(tellusMix.source, "ecology");
assert.ok(tellusMix.entries.length > 0);
const tellusPackage = core.buildTellusProcPlantPackage({ ...mix, entries: [] });
assert.equal(tellusPackage.contract, "tellus.procplants.package.v1");
assert.equal(tellusPackage.generatorContractRevision, 2);
assert.equal(tellusPackage.deterministic, true);
assert.deepEqual(tellusPackage.catalog, []);

const coreFootprint = await footprint(corePath);
const fullFootprint = await footprint(fullPath);
const webgpuFootprint = await footprint(webgpuPath);
assert.ok(coreFootprint.rawBytes < fullFootprint.rawBytes, "core transitive footprint must be smaller than the full entry");
assert.ok(coreFootprint.rawBytes / fullFootprint.rawBytes < 0.65, "core must retain a material raw-size advantage");
assert.ok(coreFootprint.gzipBytes / fullFootprint.gzipBytes < 0.65, "core must retain a material gzip-size advantage");
const coreSource = (await Promise.all(coreFootprint.files.map((file) => readFile(join(outputRoot, file), "utf8")))).join("\n");
assert.doesNotMatch(coreSource, /GLTFExporter|procplants\.headless-cli|procplants\.png-alpha/);

console.log(JSON.stringify({
  message: "procplants core library smoke passed",
  core: coreFootprint,
  full: fullFootprint,
  webgpu: webgpuFootprint,
  entry: basename(corePath),
}));
