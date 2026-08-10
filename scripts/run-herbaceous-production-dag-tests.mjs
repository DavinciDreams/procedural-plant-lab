import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "procplants-herbaceous-production-dag-"));
const output = join(directory, "test.mjs");
try {
  await build({
    entryPoints: [join(projectRoot, "scripts", "procplant-herbaceous-production-dag.test.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: "inline",
  });
  await import(pathToFileURL(output).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}
