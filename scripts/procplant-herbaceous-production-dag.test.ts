import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildProcPlantTemplate,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantGenome,
  type ProcPlantGraph,
  type ProcPlantTemplate,
} from "../src/procplants";
import { createProcPlantAuthoringGraph } from "../src/procplant-authoring-graph";
import { applyProcPlantGeneratorGraphOperations } from "../src/procplant-generator-graph";
import { compileProcPlantProductionDag, ProcPlantProductionDagError } from "../src/procplant-production-dag";

const seed = 0x48e2ba;
const environment = defaultPlantEnvironment();

const templateHash = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.uv0, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const structure = (graph: ProcPlantGraph) => ({
  stems: graph.stems.map((stem) => ({
    position: stem.position.toArray(),
    direction: stem.direction.toArray(),
    radius: stem.radius,
    depth: stem.depth,
    t: stem.t,
  })),
  segments: graph.segments,
});

const organSignature = (graph: ProcPlantGraph, kind?: string) => graph.organs
  .filter((organ) => kind === undefined || organ.kind === kind)
  .map((organ) => ({
    kind: organ.kind,
    position: organ.position.toArray(),
    direction: organ.direction.toArray(),
    right: organ.right.toArray(),
    scale: organ.scale,
    t: organ.t,
  }));

const standaloneFern: ProcPlantGenome = {
  ...structuredClone(procPlantPresets.phiFern!),
  id: "typedStandaloneFern",
  clump: undefined,
};

const supported = [
  procPlantPresets.reedSedge!,
  procPlantPresets.cloverGroundcover!,
  procPlantPresets.cushionMoss!,
  standaloneFern,
] as const;

for (const genome of [...supported, procPlantPresets.phiFern!] as const) {
  const graph = createProcPlantAuthoringGraph(genome, seed);
  const result = compileProcPlantProductionDag(genome, graph, environment, { canonicalSeed: seed });
  const legacy = buildProcPlantTemplate(genome, seed, environment);
  assert.equal(result.path, "legacy-canonical", `${genome.id} canonical graph must retain the legacy path`);
  assert.equal(templateHash(result.build.template), templateHash(legacy.template), `${genome.id} canonical bytes changed`);
}

const compileWithSeed = (genome: ProcPlantGenome, stage: "architecture" | "foliage" | "reproductive", value: number) => {
  const graph = createProcPlantAuthoringGraph(genome, seed);
  const node = graph.nodes.find((entry) => entry.stage === stage)!;
  return compileProcPlantProductionDag(
    genome,
    applyProcPlantGeneratorGraphOperations(graph, [{ op: "set-seed", nodeId: node.id, value }]),
    environment,
    { canonicalSeed: seed },
  );
};

for (const genome of supported) {
  const first = compileWithSeed(genome, "foliage", 1001);
  const second = compileWithSeed(genome, "foliage", 1002);
  assert.equal(first.path, "typed-artifacts");
  assert.deepEqual(structure(first.build.graph), structure(second.build.graph), `${genome.id} foliage seed perturbed structure`);
  assert.notDeepEqual(organSignature(first.build.graph), organSignature(second.build.graph), `${genome.id} foliage seed did not drive organs`);
  assert.ok(first.records.every((record) => record.status === "executed" || record.status === "disabled"));
  assert.equal(first.records.at(-1)?.stage, "output");
}

for (const genome of [procPlantPresets.cloverGroundcover!, procPlantPresets.cushionMoss!] as const) {
  const first = compileWithSeed(genome, "architecture", 2001);
  const second = compileWithSeed(genome, "architecture", 2002);
  assert.notDeepEqual(structure(first.build.graph), structure(second.build.graph), `${genome.id} architecture seed did not drive supports`);
}

const flowerA = compileWithSeed(procPlantPresets.cloverGroundcover!, "reproductive", 3001);
const flowerB = compileWithSeed(procPlantPresets.cloverGroundcover!, "reproductive", 3002);
assert.deepEqual(structure(flowerA.build.graph), structure(flowerB.build.graph));
assert.deepEqual(organSignature(flowerA.build.graph, "leaf"), organSignature(flowerB.build.graph, "leaf"),
  "reproductive seed must preserve independently seeded groundcover foliage");
assert.notDeepEqual(organSignature(flowerA.build.graph, "flower"), organSignature(flowerB.build.graph, "flower"),
  "reproductive seed must drive flower placement");

const cloverGraph = createProcPlantAuthoringGraph(procPlantPresets.cloverGroundcover!, seed);
const cloverStage = new Map(cloverGraph.nodes.map((node) => [node.stage, node]));
const materialEdit = applyProcPlantGeneratorGraphOperations(cloverGraph, [
  { op: "set-seed", nodeId: cloverStage.get("foliage")!.id, value: 4001 },
  {
    op: "set-parameters",
    nodeId: cloverStage.get("material")!.id,
    value: { leafColorA: 0x174f2d, leafColorB: 0x8ad96b },
  },
  { op: "set-parameters", nodeId: cloverStage.get("lod")!.id, value: { levels: [0, 2, 3] } },
]);
const materialResult = compileProcPlantProductionDag(procPlantPresets.cloverGroundcover!, materialEdit, environment, { canonicalSeed: seed });
const uncoloredResult = compileWithSeed(procPlantPresets.cloverGroundcover!, "foliage", 4001);
assert.deepEqual(materialResult.lods.map((lod) => lod.level), [0, 2, 3]);
assert.equal(materialResult.artifacts[cloverStage.get("material")!.id]?.kind, "material");
assert.equal(materialResult.artifacts[cloverStage.get("lod")!.id]?.kind, "lod");
assert.equal(materialResult.artifacts[cloverStage.get("output")!.id]?.kind, "output");
assert.notEqual(templateHash(materialResult.build.template), templateHash(uncoloredResult.build.template),
  "material stage colors must change emitted template bytes");
assert.ok(materialResult.build.stats.triangles < 2_500, "edited Clover must retain its low-poly field budget");
const xs = Array.from(materialResult.build.template.pos).filter((_value, index) => index % 3 === 0);
const zs = Array.from(materialResult.build.template.pos).filter((_value, index) => index % 3 === 2);
assert.ok(Math.max(...xs) - Math.min(...xs) > 1, "edited Clover must retain broad X coverage");
assert.ok(Math.max(...zs) - Math.min(...zs) > 1, "edited Clover must retain broad Z coverage");

const reedGraph = createProcPlantAuthoringGraph(procPlantPresets.reedSedge!, seed);
const reedFoliage = reedGraph.nodes.find((node) => node.stage === "foliage")!;
const denserReed = compileProcPlantProductionDag(
  procPlantPresets.reedSedge!,
  applyProcPlantGeneratorGraphOperations(reedGraph, [
    { op: "set-seed", nodeId: reedFoliage.id, value: 5001 },
    { op: "set-count", nodeId: reedFoliage.id, value: reedFoliage.count! * 2 },
  ]),
  environment,
  { canonicalSeed: seed },
);
assert.ok(organSignature(denserReed.build.graph, "grassBlade").length > procPlantPresets.reedSedge!.grass!.blades,
  "foliage-stage count must scale real grass blade output");

const typedFern = compileWithSeed(standaloneFern, "foliage", 6001);
assert.ok(typedFern.build.graph.organs.every((organ) => organ.kind === "palmFrond"));
assert.ok(typedFern.build.stats.triangles < 512, "standalone fern adapter must retain the approved low-poly frond contract");

const invalidGrassKind = applyProcPlantGeneratorGraphOperations(reedGraph, [
  {
    op: "set-parameters",
    nodeId: reedFoliage.id,
    value: { ...reedFoliage.parameters, foliageKind: "leaf" },
  },
]);
assert.throws(
  () => compileProcPlantProductionDag(procPlantPresets.reedSedge!, invalidGrassKind, environment, { canonicalSeed: seed }),
  /foliageKind must remain grassBlade/,
  "specialized instance-kind edits must fail closed instead of silently changing semantics",
);

for (const genome of [
  procPlantPresets.phiFern!,
  procPlantPresets.furGrass!,
  procPlantPresets.maidenhairFernPatch!,
] as const) {
  const graph = createProcPlantAuthoringGraph(genome, seed);
  const foliage = graph.nodes.find((node) => node.stage === "foliage")!;
  const edited = applyProcPlantGeneratorGraphOperations(graph, [{ op: "set-seed", nodeId: foliage.id, value: 9001 }]);
  assert.throws(
    () => compileProcPlantProductionDag(genome, edited, environment, { canonicalSeed: seed }),
    (error) => error instanceof ProcPlantProductionDagError && /does not support backend features/.test(error.message),
    `${genome.id} must remain fail-closed until its specialized staging contract is represented`,
  );
}

console.log(JSON.stringify({
  supported: supported.map((genome) => genome.id),
  cloverTriangles: materialResult.build.stats.triangles,
  cloverCoverage: [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)],
  lods: materialResult.lods.map((lod) => [lod.level, lod.triangles]),
}));
console.log("procplant herbaceous production DAG tests passed");
