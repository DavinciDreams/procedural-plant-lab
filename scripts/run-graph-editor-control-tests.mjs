import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "procplant-graph-editor-controls-"));
const output = join(temp, "procplant-graph-editor-controls.test.mjs");
try {
  await build({
    entryPoints: [join(root, "scripts", "procplant-graph-editor-controls.test.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: "inline",
    logLevel: "silent",
  });
  await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
