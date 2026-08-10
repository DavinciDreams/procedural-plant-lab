import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildProcPlantInstancedParts,
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";
import { createProcPlantAuthoringGraph } from "../src/procplant-authoring-graph";
import { applyProcPlantGeneratorGraphOperations } from "../src/procplant-generator-graph";
import {
  compileProcPlantProductionDag,
  ProcPlantProductionDagError,
  type ProcPlantDaylilyCrownStageArtifact,
  type ProcPlantDaylilyFoliageStageArtifact,
  type ProcPlantDaylilyReproductiveStageArtifact,
} from "../src/procplant-production-dag";

const templateHash = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.uv0, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const crownSignature = (artifact: ProcPlantDaylilyCrownStageArtifact) => artifact.plan.crowns.map((crown) => ({
  ordinal: crown.ordinal,
  ringT: crown.ringT,
  angle: crown.angle,
  position: crown.position.toArray(),
}));

const foliageIntrinsicSignature = (artifact: ProcPlantDaylilyFoliageStageArtifact) =>
  artifact.plan.organs.map((organ) => [organ.scale, organ.t]);

const roundedVector = (values: readonly number[]) => values.map((value) => Number(value.toFixed(12)));

const reproductiveIntrinsicSignature = (artifact: ProcPlantDaylilyReproductiveStageArtifact) => ({
  segmentVectors: artifact.plan.segments.map(([start, end]) =>
    roundedVector(artifact.plan.stems[end]!.position.clone().sub(artifact.plan.stems[start]!.position).toArray())),
  flowerFrames: artifact.plan.organs.map((organ) => [
    roundedVector(organ.direction.toArray()), roundedVector(organ.right.toArray()), organ.scale,
  ]),
});

const seed = 612_072;
const environment = defaultPlantEnvironment();
const genome = procPlantPresets.daylilyFlower!;
const sourceSnapshot = structuredClone(genome);
const canonicalGraph = createProcPlantAuthoringGraph(genome, seed);
const nodes = new Map(canonicalGraph.nodes.map((node) => [node.stage, node]));
const seedStages = (architecture: number, foliage: number, reproductive: number) =>
  applyProcPlantGeneratorGraphOperations(canonicalGraph, [
    { op: "set-seed", nodeId: nodes.get("architecture")!.id, value: architecture },
    { op: "set-seed", nodeId: nodes.get("foliage")!.id, value: foliage },
    { op: "set-seed", nodeId: nodes.get("reproductive")!.id, value: reproductive },
  ]);

const canonicalLods = compileProcPlantLods(genome, seed, environment);
const expectedHashes = [
  "4a116ff16666a3e547650f31fb99b417ec244b0f621ef2e20bfb5f549eb9aa86",
  "afed07977b6ac000870a1fdb38600662404243a647b9ee4f08a89724b1dd8f66",
  "a2c91a3104ddcd93194cec92be62898d663c8e8dc6f02f68660f12719c8f4287",
  "020db3f9b0a1d2b51f76fe355744d943ae821e4eec514f5691b231c95961c769",
];
assert.deepEqual(canonicalLods.map((lod) => templateHash(lod.template)), expectedHashes);
assert.deepEqual(canonicalLods.map((lod) => lod.triangles), [1060, 650, 4, 2]);
assert.deepEqual(canonicalLods.map((lod) => lod.vertices), [2988, 1862, 8, 4]);
assert.ok(canonicalLods.every((lod, index) => index === 0 || lod.triangles < canonicalLods[index - 1]!.triangles),
  "Daylily triangle counts must decrease strictly across LODs");
assert.ok(canonicalLods.every((lod, index) => index === 0 || lod.vertices < canonicalLods[index - 1]!.vertices),
  "Daylily vertex counts must decrease strictly across LODs");

const legacy = compileProcPlantProductionDag(genome, canonicalGraph, environment, { canonicalSeed: seed });
assert.equal(legacy.path, "legacy-canonical");
assert.deepEqual(legacy.lods.map((lod) => templateHash(lod.template)), expectedHashes);

const typedGraph = seedStages(seed, seed, seed);
const typed = compileProcPlantProductionDag(genome, typedGraph, environment, { canonicalSeed: seed });
assert.equal(typed.path, "typed-artifacts");
assert.deepEqual(typed.lods.map((lod) => templateHash(lod.template)), expectedHashes,
  "legacy-equivalent Daylily stage seeds must preserve every canonical LOD byte");
assert.deepEqual(typed.lods.map((lod) => lod.triangles), [1060, 650, 4, 2]);

const crownArtifact = typed.artifacts[nodes.get("architecture")!.id];
const foliageArtifact = typed.artifacts[nodes.get("foliage")!.id];
const reproductiveArtifact = typed.artifacts[nodes.get("reproductive")!.id];
assert.equal(crownArtifact?.kind, "daylily-crowns");
assert.equal(foliageArtifact?.kind, "daylily-foliage");
assert.equal(reproductiveArtifact?.kind, "daylily-reproductive");
if (crownArtifact?.kind !== "daylily-crowns" || foliageArtifact?.kind !== "daylily-foliage" ||
  reproductiveArtifact?.kind !== "daylily-reproductive") {
  throw new Error("typed Daylily stage artifacts were not materialized");
}
assert.equal(crownArtifact.plan.crowns.length, 10);
assert.equal(foliageArtifact.plan.organs.length, 149);
assert.equal(reproductiveArtifact.plan.organs.length, 3);
assert.ok(typed.build.graph.stems.length > 0 && typed.build.graph.segments.length > 0,
  "typed Daylily must emit real scape graph IR");
assert.equal(typed.build.graph.segmentRecords.length, typed.build.graph.segments.length);
assert.equal(typed.build.graph.attachments.length, typed.build.graph.organs.length);
assert.ok(typed.build.graph.attachments.every((attachment) => attachment.parentSegmentId !== null),
  "every Daylily leaf and bloom must resolve to a real scape attachment frame");

const architectureChanged = compileProcPlantProductionDag(genome, seedStages(seed + 1, seed, seed), environment, { canonicalSeed: seed });
const changedCrowns = architectureChanged.artifacts[nodes.get("architecture")!.id];
const architectureFoliage = architectureChanged.artifacts[nodes.get("foliage")!.id];
const architectureReproductive = architectureChanged.artifacts[nodes.get("reproductive")!.id];
assert.equal(changedCrowns?.kind, "daylily-crowns");
assert.equal(architectureFoliage?.kind, "daylily-foliage");
assert.equal(architectureReproductive?.kind, "daylily-reproductive");
if (changedCrowns?.kind !== "daylily-crowns" || architectureFoliage?.kind !== "daylily-foliage" ||
  architectureReproductive?.kind !== "daylily-reproductive") throw new Error("missing architecture-seeded Daylily artifacts");
assert.notDeepEqual(crownSignature(changedCrowns), crownSignature(crownArtifact));
assert.deepEqual(foliageIntrinsicSignature(architectureFoliage), foliageIntrinsicSignature(foliageArtifact),
  "crown seed must not perturb independently seeded leaf scale/count variation");
assert.deepEqual(reproductiveIntrinsicSignature(architectureReproductive), reproductiveIntrinsicSignature(reproductiveArtifact),
  "crown seed must not perturb independently seeded scape shape and bloom variation");

const foliageChanged = compileProcPlantProductionDag(genome, seedStages(seed, seed + 1, seed), environment, { canonicalSeed: seed });
const foliageCrowns = foliageChanged.artifacts[nodes.get("architecture")!.id];
const changedFoliage = foliageChanged.artifacts[nodes.get("foliage")!.id];
const foliageReproductive = foliageChanged.artifacts[nodes.get("reproductive")!.id];
assert.equal(foliageCrowns?.kind, "daylily-crowns");
assert.equal(changedFoliage?.kind, "daylily-foliage");
assert.equal(foliageReproductive?.kind, "daylily-reproductive");
if (foliageCrowns?.kind !== "daylily-crowns" || changedFoliage?.kind !== "daylily-foliage" ||
  foliageReproductive?.kind !== "daylily-reproductive") throw new Error("missing foliage-seeded Daylily artifacts");
assert.deepEqual(crownSignature(foliageCrowns), crownSignature(crownArtifact));
assert.notDeepEqual(foliageIntrinsicSignature(changedFoliage), foliageIntrinsicSignature(foliageArtifact));
assert.deepEqual(reproductiveIntrinsicSignature(foliageReproductive), reproductiveIntrinsicSignature(reproductiveArtifact),
  "foliage seed must not perturb independently seeded scapes and blooms");

const reproductiveChanged = compileProcPlantProductionDag(genome, seedStages(seed, seed, seed + 1), environment, { canonicalSeed: seed });
const reproductiveCrowns = reproductiveChanged.artifacts[nodes.get("architecture")!.id];
const reproductiveFoliage = reproductiveChanged.artifacts[nodes.get("foliage")!.id];
const changedReproductive = reproductiveChanged.artifacts[nodes.get("reproductive")!.id];
assert.equal(reproductiveCrowns?.kind, "daylily-crowns");
assert.equal(reproductiveFoliage?.kind, "daylily-foliage");
assert.equal(changedReproductive?.kind, "daylily-reproductive");
if (reproductiveCrowns?.kind !== "daylily-crowns" || reproductiveFoliage?.kind !== "daylily-foliage" ||
  changedReproductive?.kind !== "daylily-reproductive") throw new Error("missing reproductive-seeded Daylily artifacts");
assert.deepEqual(crownSignature(reproductiveCrowns), crownSignature(crownArtifact));
assert.deepEqual(foliageIntrinsicSignature(reproductiveFoliage), foliageIntrinsicSignature(foliageArtifact));
assert.notDeepEqual(reproductiveIntrinsicSignature(changedReproductive), reproductiveIntrinsicSignature(reproductiveArtifact));

const resetGraph = applyProcPlantGeneratorGraphOperations(seedStages(seed + 7, seed + 11, seed + 13), [
  { op: "set-seed", nodeId: nodes.get("architecture")!.id, value: undefined },
  { op: "set-seed", nodeId: nodes.get("foliage")!.id, value: undefined },
  { op: "set-seed", nodeId: nodes.get("reproductive")!.id, value: undefined },
]);
const reset = compileProcPlantProductionDag(genome, resetGraph, environment, { canonicalSeed: seed });
assert.equal(reset.path, "legacy-canonical");
assert.deepEqual(reset.lods.map((lod) => templateHash(lod.template)), expectedHashes,
  "clearing all Daylily stage overrides must restore the exact canonical compiler");
assert.throws(
  () => compileProcPlantProductionDag(genome, typedGraph, environment, { canonicalSeed: seed, maxWork: typed.work - 1 }),
  (error) => error instanceof ProcPlantProductionDagError && /work cap/.test(error.message),
);

const canonicalParts = buildProcPlantInstancedParts(genome, seed, environment);
assert.ok(canonicalParts.graph.stems.length > 0 && canonicalParts.graph.attachments.length > 0,
  "canonical Daylily parts must expose graph and attachment IR without changing geometry bytes");
assert.deepEqual(genome, sourceSnapshot, "Daylily stage compilation must not mutate its source genome");

console.log(JSON.stringify({
  legacyHashes: expectedHashes,
  triangles: typed.lods.map((lod) => lod.triangles),
  vertices: typed.lods.map((lod) => lod.vertices),
  crowns: crownArtifact.plan.crowns.length,
  strapLeaves: foliageArtifact.plan.organs.length,
  scapes: reproductiveArtifact.plan.organs.length,
  graph: {
    stems: typed.build.graph.stems.length,
    segments: typed.build.graph.segments.length,
    organs: typed.build.graph.organs.length,
    attachments: typed.build.graph.attachments.length,
  },
  typedWork: typed.work,
}));
console.log("procplant Daylily production DAG tests passed");
