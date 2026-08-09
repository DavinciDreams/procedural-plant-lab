import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-tree-varieties-"));
const outputFile = join(tempDirectory, "test.mjs");

try {
  await build({
    entryPoints: [join(projectRoot, "scripts", "procplant-tree-varieties.test.ts")],
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
