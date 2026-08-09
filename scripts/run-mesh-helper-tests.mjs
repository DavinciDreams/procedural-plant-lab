import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-mesh-helper-tests-"));
const outputFile = join(tempDirectory, "procplant-mesh-helper.test.mjs");

try {
  await build({
    entryPoints: [join(projectRoot, "scripts", "procplant-mesh-helper.test.ts")],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  await import(`${pathToFileURL(outputFile).href}?run=${Date.now()}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
