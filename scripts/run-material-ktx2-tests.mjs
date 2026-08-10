import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(projectRoot, "node_modules", ".procplants-material-ktx2-tests-"));
const outputFile = join(tempDirectory, "procplant-material-ktx2.test.mjs");
try {
  await build({
    entryPoints: [join(projectRoot, "scripts", "procplant-material-ktx2.test.ts")],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["ktx2-encoder"],
    logLevel: "silent",
  });
  await import(`${pathToFileURL(outputFile).href}?run=${Date.now()}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
