import { build } from "esbuild";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-damage-topology-tests-"));
const outputFile = join(tempDirectory, "procplant-damage-topology.test.mjs");

try {
  await build({
    entryPoints: [join(projectRoot, "scripts", "procplant-damage-topology.test.ts")],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: "inline",
  });
  await import(`${pathToFileURL(outputFile).href}?run=${Date.now()}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
