import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-crown-voxel-mask-ui-input-"));
const outfile = join(tempDirectory, "test.mjs");

try {
  await build({
    entryPoints: [join(projectRoot, "scripts", "procplant-crown-voxel-mask-ui-input.test.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
  await import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?t=${Date.now()}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
