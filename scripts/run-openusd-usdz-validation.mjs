import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-openusd-validation-"));
const generator = join(tempDirectory, "generate.mjs");
const run = (command, args) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit", shell: false });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
});

try {
  await build({
    entryPoints: [join(projectRoot, "scripts", "procplant-openusd-fixtures.ts")],
    outfile: generator,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  await run(process.execPath, [generator, tempDirectory]);
  await run("uv", ["run", "--with", "usd-core==26.8", "python", join(projectRoot, "scripts", "procplant-openusd-validation.py"), tempDirectory]);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
