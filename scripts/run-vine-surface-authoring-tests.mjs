import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "procplants-vine-surface-authoring-"));
const outfile = join(temporary, "test.mjs");

try {
  await build({
    entryPoints: [join(root, "scripts", "procplant-vine-surface-authoring.test.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
