import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  buildProcPlantTemplate,
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantGraph,
  type ProcPlantTemplate,
} from "../src/procplants";
import { createProcPlantAuthoringGraph } from "../src/procplant-authoring-graph";
import { applyProcPlantGeneratorGraphOperations } from "../src/procplant-generator-graph";
import { compileProcPlantProductionDag, ProcPlantProductionDagError } from "../src/procplant-production-dag";

const IDS = [
  "maidenhairFernPatch",
  "woodlandVioletCarpet",
  "trilliumPatch",
  "horsetailColony",
] as const;
const EXPECTED_TRIANGLES = {
  maidenhairFernPatch: [1312, 656, 4, 2],
  woodlandVioletCarpet: [1256, 658, 4, 2],
  trilliumPatch: [628, 314, 4, 2],
  horsetailColony: [1908, 1060, 4, 2],
} as const;
const seed = 0x6a09e667;
const environment = { ...defaultPlantEnvironment(), light: 0.58, moisture: 0.78, crowding: 0.34 };

const hashTemplate = (template: ProcPlantTemplate) => {
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
    index: stem.index,
  })),
  segments: graph.segments,
});

const organRows = (graph: ProcPlantGraph, kind: "leaf" | "flower") => graph.organs
  .filter((organ) => organ.kind === kind)
  .map((organ) => ({
    position: organ.position.toArray(),
    direction: organ.direction.toArray(),
    right: organ.right.toArray(),
    scale: organ.scale,
  }));

const bounds = (template: ProcPlantTemplate) => {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let offset = 0; offset < template.pos.length; offset += 3) {
    box.expandByPoint(point.set(template.pos[offset]!, template.pos[offset + 1]!, template.pos[offset + 2]!));
  }
  const size = box.getSize(new THREE.Vector3());
  return size.toArray();
};

const summaries = [];
for (const id of IDS) {
  const genome = procPlantPresets[id]!;
  const sourceSnapshot = structuredClone(genome);
  const canonical = createProcPlantAuthoringGraph(genome, seed);
  const stage = new Map(canonical.nodes.map((node) => [node.stage, node]));
  assert.equal(stage.get("source")!.parameters?.backend, "procplant-graph");
  assert.equal(stage.get("branching")!.enabled, true, "legacy graph metadata must remain byte-compatible for Tellus fixtures");

  const legacyBuild = buildProcPlantTemplate(genome, seed, environment);
  const legacyLods = compileProcPlantLods(genome, seed, environment);
  const canonicalResult = compileProcPlantProductionDag(genome, canonical, environment, { canonicalSeed: seed });
  assert.equal(canonicalResult.path, "legacy-canonical");
  assert.equal(hashTemplate(canonicalResult.build.template), hashTemplate(legacyBuild.template), `${id} canonical build bytes changed`);
  assert.deepEqual(canonicalResult.lods.map((lod) => hashTemplate(lod.template)), legacyLods.map((lod) => hashTemplate(lod.template)));
  assert.deepEqual(canonicalResult.lods.map((lod) => lod.triangles), [...EXPECTED_TRIANGLES[id]]);
  assert.deepEqual(bounds(canonicalResult.lods[0]!.template), bounds(legacyLods[0]!.template), `${id} canonical coverage changed`);
  const canonicalBounds = bounds(canonicalResult.lods[0]!.template);
  assert.ok(canonicalBounds[0]! >= genome.groundcover!.radius * 1.1 && canonicalBounds[2]! >= genome.groundcover!.radius * 1.1);

  const foliage = stage.get("foliage")!;
  const architecture = stage.get("architecture")!;
  const reproductive = stage.get("reproductive")!;
  const typedGraph = applyProcPlantGeneratorGraphOperations(canonical, [
    { op: "set-seed", nodeId: foliage.id, value: 0xf011a6e },
  ]);
  const typed = compileProcPlantProductionDag(genome, typedGraph, environment, { canonicalSeed: seed });
  const typedAgain = compileProcPlantProductionDag(genome, typedGraph, environment, { canonicalSeed: seed });
  assert.equal(typed.path, "typed-artifacts");
  assert.equal(hashTemplate(typed.build.template), hashTemplate(typedAgain.build.template));
  assert.deepEqual(typed.records, typedAgain.records);
  assert.deepEqual(genome, sourceSnapshot);
  assert.ok(typed.build.graph.organs.some((organ) => organ.kind === "leaf"));
  assert.deepEqual(typed.lods.map((lod) => lod.level), [0, 1, 2, 3]);
  const output = stage.get("output")!;
  assert.equal(typed.artifacts[output.id]?.kind, "output");
  assert.equal(hashTemplate(typed.build.template), hashTemplate(typed.lods[0]!.template));
  assert.ok(typed.lods[0]!.triangles > typed.lods[1]!.triangles && typed.lods[1]!.triangles > typed.lods[2]!.triangles);
  assert.deepEqual(typed.lods.slice(2).map((lod) => lod.triangles), [4, 2]);

  const foliageChangedGraph = applyProcPlantGeneratorGraphOperations(typedGraph, [
    { op: "set-seed", nodeId: foliage.id, value: 0xf011a6f },
  ]);
  const foliageChanged = compileProcPlantProductionDag(genome, foliageChangedGraph, environment, { canonicalSeed: seed });
  assert.equal(foliageChanged.artifacts[architecture.id]?.hash, typed.artifacts[architecture.id]?.hash);
  assert.deepEqual(structure(foliageChanged.build.graph), structure(typed.build.graph), `${id} foliage seed changed support topology`);
  assert.notDeepEqual(organRows(foliageChanged.build.graph, "leaf"), organRows(typed.build.graph, "leaf"));
  if (genome.flower) {
    assert.equal(foliageChanged.artifacts[reproductive.id]?.hash, typed.artifacts[reproductive.id]?.hash,
      `${id} foliage seed leaked into the reproductive stage`);
  }

  const architectureChangedGraph = applyProcPlantGeneratorGraphOperations(typedGraph, [
    { op: "set-seed", nodeId: architecture.id, value: 0xa2c417ec },
  ]);
  const architectureChanged = compileProcPlantProductionDag(genome, architectureChangedGraph, environment, { canonicalSeed: seed });
  assert.notDeepEqual(structure(architectureChanged.build.graph), structure(typed.build.graph));

  const countEditedGraph = applyProcPlantGeneratorGraphOperations(typedGraph, [
    { op: "set-count", nodeId: architecture.id, value: architecture.count! + 1 },
    { op: "set-count", nodeId: foliage.id, value: foliage.count! + 1 },
  ]);
  const countEdited = compileProcPlantProductionDag(genome, countEditedGraph, environment, { canonicalSeed: seed });
  assert.ok(countEdited.build.graph.stems.length > typed.build.graph.stems.length, `${id} architecture count must add support topology`);
  assert.ok(organRows(countEdited.build.graph, "leaf").length > organRows(typed.build.graph, "leaf").length,
    `${id} foliage count must add independently placed leaves`);

  if (genome.flower) {
    const reproductiveChangedGraph = applyProcPlantGeneratorGraphOperations(typedGraph, [
      { op: "set-seed", nodeId: reproductive.id, value: 0xb1000001 },
    ]);
    const reproductiveChanged = compileProcPlantProductionDag(genome, reproductiveChangedGraph, environment, { canonicalSeed: seed });
    assert.equal(reproductiveChanged.artifacts[architecture.id]?.hash, typed.artifacts[architecture.id]?.hash);
    assert.equal(reproductiveChanged.artifacts[foliage.id]?.hash, typed.artifacts[foliage.id]?.hash);
    assert.deepEqual(organRows(reproductiveChanged.build.graph, "leaf"), organRows(typed.build.graph, "leaf"));
    assert.notDeepEqual(organRows(reproductiveChanged.build.graph, "flower"), organRows(typed.build.graph, "flower"));
  }

  const material = stage.get("material")!;
  const materialGraph = applyProcPlantGeneratorGraphOperations(typedGraph, [{
    op: "set-parameters",
    nodeId: material.id,
    value: { leafColorA: 0x183d25, leafColorB: 0x8abb62 },
  }]);
  const materialResult = compileProcPlantProductionDag(genome, materialGraph, environment, { canonicalSeed: seed });
  assert.deepEqual(structure(materialResult.build.graph), structure(typed.build.graph));
  assert.deepEqual(materialResult.build.graph.organs, typed.build.graph.organs);
  assert.notEqual(hashTemplate(materialResult.build.template), hashTemplate(typed.build.template));

  const lod = stage.get("lod")!;
  const selectedLods = applyProcPlantGeneratorGraphOperations(typedGraph, [{
    op: "set-parameters", nodeId: lod.id, value: { levels: [0, 2, 3] },
  }]);
  assert.deepEqual(
    compileProcPlantProductionDag(genome, selectedLods, environment, { canonicalSeed: seed }).lods.map((entry) => entry.level),
    [0, 2, 3],
  );

  const badDependency = applyProcPlantGeneratorGraphOperations(typedGraph, [{
    op: "remove-dependency", nodeId: foliage.id, dependencyId: architecture.id,
  }]);
  assert.throws(
    () => compileProcPlantProductionDag(genome, badDependency, environment, { canonicalSeed: seed }),
    (error) => error instanceof ProcPlantProductionDagError && /dependency\/placement\/parent-scope/.test(error.message),
  );
  const badPhyllotaxy = applyProcPlantGeneratorGraphOperations(typedGraph, [{
    op: "set-parameters",
    nodeId: foliage.id,
    value: { ...foliage.parameters, phyllotaxy: foliage.parameters?.phyllotaxy === "whorled" ? "spiral" : "whorled" },
  }]);
  assert.throws(
    () => compileProcPlantProductionDag(genome, badPhyllotaxy, environment, { canonicalSeed: seed }),
    /foliage kind\/phyllotaxy/,
  );
  const branching = stage.get("branching")!;
  const badBranchSeed = applyProcPlantGeneratorGraphOperations(typedGraph, [{
    op: "set-seed", nodeId: branching.id, value: 44,
  }]);
  assert.throws(
    () => compileProcPlantProductionDag(genome, badBranchSeed, environment, { canonicalSeed: seed }),
    /edited branching is unsupported/,
  );

  for (const attachment of typed.build.graph.attachments) {
    assert.ok(attachment.parentSegmentId, `${id} typed organ must retain a supporting segment`);
    assert.ok(Math.abs(attachment.tangent.dot(attachment.right)) < 1e-5);
    assert.ok(new THREE.Vector3().crossVectors(attachment.tangent, attachment.right).dot(attachment.up) > 0.999);
  }
  summaries.push({ id, canonicalTriangles: canonicalResult.lods.map((entry) => entry.triangles), typedTriangles: typed.lods.map((entry) => entry.triangles) });
}

const phiFern = procPlantPresets.phiFern!;
const phiCanonical = createProcPlantAuthoringGraph(phiFern, seed);
const phiEdited = applyProcPlantGeneratorGraphOperations(phiCanonical, [{
  op: "set-seed", nodeId: phiCanonical.nodes.find((node) => node.stage === "foliage")!.id, value: 7,
}]);
assert.throws(
  () => compileProcPlantProductionDag(phiFern, phiEdited, environment, { canonicalSeed: seed }),
  /does not support backend features/,
  "other specialized groundcovers must remain fail-closed",
);

console.log(JSON.stringify(summaries, null, 2));
console.log("procplant bespoke broad-patch production DAG tests passed");
