import assert from "node:assert/strict";
import { procPlantPresets } from "../src/procplants";
import {
  PROCPLANT_CLI_EXIT,
  runProcPlantCli,
  type ProcPlantCliIo,
} from "../src/procplant-cli";

const textFiles = new Map([["genome.json", JSON.stringify(procPlantPresets.cloverGroundcover)]]);
let stdout = "";
let stderr = "";
const io: ProcPlantCliIo = {
  readText: async (path) => {
    const value = textFiles.get(path);
    if (value === undefined) throw new Error(`missing fixture: ${path}`);
    return value;
  },
  writeText: async (path, contents) => { textFiles.set(path, contents); },
  stdout: (message) => { stdout += message; },
  stderr: (message) => { stderr += message; },
};
const reset = () => {
  textFiles.delete("plant-a.usda");
  textFiles.delete("plant-b.usda");
  textFiles.delete("single.usda");
  textFiles.delete("bad.usda");
  stdout = "";
  stderr = "";
};

const allArgs = (output: string) => [
  "usda", "genome.json",
  "--profile", "tellus-realtime",
  "--seed", "4242",
  "--out", output,
  "--lod", "all",
  "--collision", "trunk-capsule",
];

assert.equal(await runProcPlantCli(allArgs("plant-a.usda"), io), PROCPLANT_CLI_EXIT.success, stderr);
const first = textFiles.get("plant-a.usda")!;
assert.ok(first.startsWith("#usda 1.0\n"));
assert.match(first, /prepend variantSets = "LOD"/);
assert.equal((first.match(/def Mesh "Geometry"/g) ?? []).length, 4);
assert.equal((first.match(/def Capsule "Collision"/g) ?? []).length, 4);
assert.match(first, /custom string procplant:genomeId = "cloverGroundcover"/);
assert.match(first, /custom string procplant:metadataJson = .*tellus-realtime/);
assert.match(stdout, /USDA \(4 LOD variants, \d+ bytes\)/);

reset();
assert.equal(await runProcPlantCli(allArgs("plant-b.usda"), io), PROCPLANT_CLI_EXIT.success, stderr);
assert.equal(textFiles.get("plant-b.usda"), first, "identical CLI inputs must emit byte-identical USDA text");
console.log("ok 1 - headless CLI writes deterministic ASCII USDA with all real LOD variants");

reset();
assert.equal(await runProcPlantCli([
  "usda", "genome.json", "--profile", "web-preview", "--seed", "99", "--out", "single.usda",
  "--lod", "2", "--collision", "bounds-box",
], io), PROCPLANT_CLI_EXIT.success, stderr);
const single = textFiles.get("single.usda")!;
assert.doesNotMatch(single, /variantSet "LOD"/);
assert.match(single, /custom int procplant:lodLevel = 2/);
assert.match(single, /def Cube "Collision"/);
assert.match(stdout, /USDA \(LOD 2, \d+ bytes\)/);
console.log("ok 2 - headless CLI exports one selected real LOD and requested collision primitive");

for (const [extra, pattern] of [
  [["--lod", "9"], /--lod must be/],
  [["--collision", "mesh"], /--collision must be/],
] as const) {
  reset();
  assert.equal(await runProcPlantCli([
    "usda", "genome.json", "--profile", "tellus-realtime", "--seed", "1", "--out", "bad.usda",
    ...extra,
  ], io), PROCPLANT_CLI_EXIT.usage);
  assert.match(stderr, pattern);
  assert.equal(textFiles.has("bad.usda"), false);
}
reset();
assert.equal(await runProcPlantCli([
  "usda", "genome.json", "--profile", "tellus-realtime", "--seed", "1", "--out", "bad.usd",
], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /must end in \.usda/);
console.log("ok 3 - USDA CLI rejects invalid LOD, collision, and ambiguous binary-or-text .usd outputs");
console.log("1..3");
