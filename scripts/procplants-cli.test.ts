import assert from "node:assert/strict";
import { procPlantPresets } from "../src/procplants";
import {
  PROCPLANT_CLI_CONTRACT,
  PROCPLANT_CLI_EXIT,
  runProcPlantCli,
  type ProcPlantCliIo,
} from "../src/procplant-cli";

const files = new Map<string, string>();
let stdout = "";
let stderr = "";
const io: ProcPlantCliIo = {
  readText: async (path) => {
    const value = files.get(path);
    if (value === undefined) throw new Error(`missing fixture: ${path}`);
    return value;
  },
  writeText: async (path, contents) => {
    files.set(path, contents);
  },
  stdout: (message) => { stdout += message; },
  stderr: (message) => { stderr += message; },
};
const resetOutput = () => {
  stdout = "";
  stderr = "";
};

files.set("genome.json", JSON.stringify(procPlantPresets.cloverGroundcover));
assert.equal(await runProcPlantCli(["validate", "genome.json"], io), PROCPLANT_CLI_EXIT.success);
assert.equal(JSON.parse(stdout).valid, true);
assert.equal(JSON.parse(stdout).genomeId, "cloverGroundcover");

resetOutput();
files.set("bad.json", JSON.stringify({ id: "broken" }));
assert.equal(await runProcPlantCli(["validate", "bad.json"], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /genome\.habit/);

resetOutput();
const compileArgs = [
  "compile", "genome.json",
  "--profile", "tellus-realtime",
  "--seed", "424242",
  "--out", "compiled-a.json",
];
assert.equal(await runProcPlantCli(compileArgs, io), PROCPLANT_CLI_EXIT.success);
const firstCompile = files.get("compiled-a.json")!;
resetOutput();
assert.equal(
  await runProcPlantCli([...compileArgs.slice(0, -1), "compiled-b.json"], io),
  PROCPLANT_CLI_EXIT.success,
);
const secondCompile = files.get("compiled-b.json")!;
assert.equal(firstCompile, secondCompile, "compile output must be byte-stable for the same genome, profile, and seed");
const compiled = JSON.parse(firstCompile);
assert.equal(compiled.contract, PROCPLANT_CLI_CONTRACT);
assert.equal(compiled.profile, "tellus-realtime");
assert.equal(compiled.seed, 424242);
assert.equal(compiled.runtime.genomeId, "cloverGroundcover");
assert.equal(compiled.readiness.profile, "tellus-realtime");

const cutout = (id: string, size: number) => ({
  id,
  mask: {
    width: size,
    height: size,
    alpha: Array.from({ length: size * size }, (_, index) => {
      const x = index % size;
      const y = Math.floor(index / size);
      return x > 0 && y > 0 && x < size - 1 && y < size - 1 ? 255 : 0;
    }),
  },
  threshold: 0.5,
  simplifyTolerance: 0.1,
  metadata: {
    pivot: { x: 0.5, y: 0 },
    attachment: { x: 0.5, y: 0 },
    bendAxis: { origin: { x: 0.5, y: 0 }, direction: { x: 0, y: 1 } },
  },
});
const atlasManifest = (cutouts: unknown[]) => JSON.stringify({
  atlas: { padding: 3, powerOfTwo: true, maxWidth: 128 },
  cutouts,
});
files.set("atlas-a.json", atlasManifest([cutout("fern", 7), cutout("clover", 5)]));
files.set("atlas-b.json", atlasManifest([cutout("clover", 5), cutout("fern", 7)]));
resetOutput();
assert.equal(
  await runProcPlantCli(["atlas", "atlas-a.json", "--out", "atlas-out-a.json"], io),
  PROCPLANT_CLI_EXIT.success,
);
resetOutput();
assert.equal(
  await runProcPlantCli(["atlas", "atlas-b.json", "--out", "atlas-out-b.json"], io),
  PROCPLANT_CLI_EXIT.success,
);
assert.equal(
  files.get("atlas-out-a.json"),
  files.get("atlas-out-b.json"),
  "atlas metadata must be byte-stable regardless of manifest cutout order",
);
const atlasOutput = JSON.parse(files.get("atlas-out-a.json")!);
assert.equal(atlasOutput.contract, PROCPLANT_CLI_CONTRACT);
assert.deepEqual(atlasOutput.cutouts.map((entry: { id: string }) => entry.id), ["clover", "fern"]);
assert.equal(atlasOutput.atlas.padding, 3);
assert.equal(atlasOutput.atlas.entries.length, 2);

resetOutput();
assert.equal(await runProcPlantCli(["unknown"], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /unknown command/);

console.log("ok 1 - validate returns deterministic structured success and clear input errors");
console.log("ok 2 - compile emits byte-stable runtime/readiness JSON for profile and seed");
console.log("ok 3 - atlas emits order-independent cutout contract metadata");
console.log("ok 4 - CLI returns documented usage exit codes");

{
  resetOutput();
  const args = [
    "compile", "genome.json", "--profile", "tellus-realtime", "--seed", "42",
    "--out", "variants-a.json", "--variants", "3",
  ];
  assert.equal(await runProcPlantCli(args, io), 0);
  resetOutput();
  assert.equal(await runProcPlantCli(args.map((value) => value === "variants-a.json" ? "variants-b.json" : value), io), 0);
  assert.equal(files.get("variants-a.json"), files.get("variants-b.json"));
  const output = JSON.parse(files.get("variants-a.json")!);
  assert.deepEqual(output.variants.map((entry: { index: number; seed: number }) => ({ index: entry.index, seed: entry.seed })), [
    { index: 0, seed: 42 },
    { index: 1, seed: 2654435811 },
    { index: 2, seed: 1013904284 },
  ]);
}
console.log("ok 5 - compile emits deterministic numbered seed variants");

resetOutput();
files.set("fern.json", JSON.stringify(procPlantPresets.phiFern));
const planArgs = [
  "lod5-atlas-plan", "fern.json", "--seed", "612072", "--out", "lod5-plan-a.json",
  "--width", "16", "--height", "16", "--azimuths", "4", "--elevations", "0,0.5235987755982988",
  "--padding", "2", "--samples", "0", "--max-atlas-size", "256", "--max-atlas-bytes", "262144",
];
assert.equal(await runProcPlantCli(planArgs, io), PROCPLANT_CLI_EXIT.success);
resetOutput();
assert.equal(await runProcPlantCli(planArgs.map((value) => value === "lod5-plan-a.json" ? "lod5-plan-b.json" : value), io), PROCPLANT_CLI_EXIT.success);
assert.equal(files.get("lod5-plan-a.json"), files.get("lod5-plan-b.json"));
const lod5Plan = JSON.parse(files.get("lod5-plan-a.json")!);
assert.equal(lod5Plan.contract, "procplants.five-tier-atlas-build");
assert.equal(lod5Plan.source.lod0ContentHash, "fnv1a32-eea44b90");
assert.equal(lod5Plan.capture.plan.views.length, 8);
assert.match(lod5Plan.cacheKey, /^procplants-lod5-atlas-v1-[0-9a-f]{8}$/);
console.log("ok 6 - CLI emits deterministic bounded five-tier WebGL atlas build manifests without pretending to capture in Node");
console.log("1..6");
