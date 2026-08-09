import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "procplants-hero-glb-import-"));
const output = join(temp, "test.mjs");
try {
  await build({
    entryPoints: [join(root, "scripts", "procplant-hero-glb-import.test.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  await import(`${pathToFileURL(output).href}?run=${Date.now()}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
