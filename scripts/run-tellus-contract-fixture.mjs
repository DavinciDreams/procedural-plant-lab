import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = resolve(import.meta.dirname, "..");
const fixturePath = join(projectRoot, "fixtures", "tellus-procplant-contract-v3.golden.json");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-contract-fixture-"));
const outputFile = join(tempDirectory, "tellus-contract-fixture.mjs");
const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--print") ? "print" : "check";

try {
  await build({
    entryPoints: [join(projectRoot, "scripts", "tellus-contract-fixture.ts")],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  const fixtureModule = await import(`${pathToFileURL(outputFile).href}?run=${Date.now()}`);
  const generated = fixtureModule.buildTellusGoldenContractFixture();
  const serialized = fixtureModule.serializeTellusGoldenContractFixture(generated);

  if (mode === "write") {
    await writeFile(fixturePath, serialized, "utf8");
    console.log(`wrote ${fixturePath} (${Buffer.byteLength(serialized)} bytes)`);
  } else if (mode === "print") {
    process.stdout.write(serialized);
  } else {
    const committedText = await readFile(fixturePath, "utf8");
    const committed = JSON.parse(committedText);
    const drift = fixtureModule.firstTellusFixtureDrift(committed, generated);
    if (drift || committedText !== serialized) {
      throw new Error(`Tellus golden contract fixture drifted at ${drift ?? "serialized JSON"}. Run this script with --write after reviewing the contract change.`);
    }
    console.log(`ok - Tellus contract revision ${generated.generatorContractRevision} fixture matches (${Buffer.byteLength(serialized)} bytes)`);
  }
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
