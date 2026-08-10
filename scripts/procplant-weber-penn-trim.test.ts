import assert from "node:assert/strict";
import {
  buildProcPlantTemplate,
  defaultPlantEnvironment,
  procPlantPresets,
} from "../src/procplants";
import {
  applyProcPlantWeberPennBakedTrimOverrides,
  applyProcPlantWeberPennTrimOverrides,
  bindProcPlantWeberPennTrimTarget,
  createProcPlantWeberPennTrimOperation,
  createProcPlantWeberPennTrimOverrideSet,
  deserializeProcPlantWeberPennTrimOverrides,
  serializeProcPlantWeberPennTrimOverrides,
} from "../src/procplant-weber-penn-trim";
import { bakeTree, generateTreeData } from "../src/vendor/proc-tree/index";

const seed = 730_031;
const genome = procPlantPresets.blueSpruce!;
const built = buildProcPlantTemplate(genome, seed, defaultPlantEnvironment());
assert.ok(genome.weberPenn);
assert.equal(built.graph.segmentRecords.length, 0);
assert.ok(built.graph.attachments.length > 4);
assert.ok(built.graph.attachments.every((attachment) => attachment.id.startsWith("weber-penn:")));
const target = { backend: "weber-penn" as const, genomeId: genome.id, seed };
const source = { target, graph: built.graph };
const attachmentSnapshot = built.graph.attachments.map((attachment) => ({
  id: attachment.id,
  position: attachment.position.toArray(),
}));
const templateSnapshot = Array.from(built.template.idx);

const empty = createProcPlantWeberPennTrimOverrideSet(target);
const legacy = applyProcPlantWeberPennTrimOverrides(source, empty);
assert.equal(legacy.audit.status, "no-op");
assert.strictEqual(legacy.graph, built.graph, "no overrides must return the exact legacy graph reference");
assert.deepEqual(Array.from(built.template.idx), templateSnapshot, "the adapter must not touch baked geometry");

const firstId = built.graph.attachments[0]!.id;
const removeFirst = createProcPlantWeberPennTrimOperation("remove", {
  kind: "attachment-ids",
  attachmentIds: [firstId],
});
const unsupportedDepth = createProcPlantWeberPennTrimOperation("remove", {
  kind: "branch-depth",
  minDepth: 2,
});
const overrides = createProcPlantWeberPennTrimOverrideSet(target, [removeFirst, unsupportedDepth]);
const serialized = serializeProcPlantWeberPennTrimOverrides(overrides);
assert.deepEqual(deserializeProcPlantWeberPennTrimOverrides(serialized), overrides);
assert.equal(serializeProcPlantWeberPennTrimOverrides(deserializeProcPlantWeberPennTrimOverrides(serialized)), serialized);

const first = applyProcPlantWeberPennTrimOverrides(source, overrides);
const second = applyProcPlantWeberPennTrimOverrides(source, overrides);
assert.equal(first.audit.status, "partial");
assert.deepEqual(first.audit, second.audit);
assert.deepEqual(first.graph.attachments.map((attachment) => attachment.id), second.graph.attachments.map((attachment) => attachment.id));
assert.equal(first.graph.attachments.length, built.graph.attachments.length - 1);
assert.ok(!first.graph.attachments.some((attachment) => attachment.id === firstId));
assert.deepEqual(first.audit.removedAttachmentIds, [firstId]);
assert.equal(first.audit.operations[0]!.status, "applied");
assert.equal(first.audit.operations[1]!.status, "unsupported");
assert.match(first.audit.operations[1]!.reason!, /no lossless branch depth/);
assert.equal(first.audit.geometryChanged, false);
assert.equal(first.audit.bakedBranchTopologySupported, false);
assert.equal(first.audit.nativeLeafGeometrySupported, false);
assert.deepEqual(built.graph.attachments.map((attachment) => ({
  id: attachment.id,
  position: attachment.position.toArray(),
})), attachmentSnapshot, "applying overrides must not mutate the source graph");

const kind = built.graph.attachments[0]!.kind as "leaf-site" | "branch-tip";
const retainKind = createProcPlantWeberPennTrimOverrideSet(target, [
  createProcPlantWeberPennTrimOperation("retain", { kind: "attachment-kind", attachmentKinds: [kind] }),
]);
const retained = applyProcPlantWeberPennTrimOverrides(source, retainKind);
assert.ok(retained.graph.attachments.every((attachment) => attachment.kind === kind));

const missing = createProcPlantWeberPennTrimOverrideSet(target, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "attachment-ids", attachmentIds: ["weber-penn:leaf-site:missing"] }),
]);
const unmatched = applyProcPlantWeberPennTrimOverrides(source, missing);
assert.equal(unmatched.audit.status, "no-op");
assert.strictEqual(unmatched.graph, built.graph);
assert.deepEqual(unmatched.audit.operations[0]!.unknownAttachmentIds, ["weber-penn:leaf-site:missing"]);

const mismatch = applyProcPlantWeberPennTrimOverrides(source, createProcPlantWeberPennTrimOverrideSet({
  ...target,
  seed: seed + 1,
}, [removeFirst]));
assert.equal(mismatch.audit.status, "target-mismatch");
assert.strictEqual(mismatch.graph, built.graph);

assert.throws(() => createProcPlantWeberPennTrimOperation("remove", {
  kind: "axial-range",
  min: 0.8,
  max: 0.2,
}), /axial range/);
assert.throws(() => deserializeProcPlantWeberPennTrimOverrides("{broken"), /valid JSON/);

const rawTree = generateTreeData("smallPine", 447_031, true);
assert.deepEqual(rawTree.stems.map((stem) => stem.index), rawTree.stems.map((_, index) => index));
for (const stem of rawTree.stems) {
  if (stem.parentIndex !== null) {
    assert.ok(rawTree.stems[stem.parentIndex]!.childIndices.includes(stem.index), `stem ${stem.index} must be registered with its parent`);
  }
  for (const childIndex of stem.childIndices) {
    assert.equal(rawTree.stems[childIndex]!.parentIndex, stem.index, `stem ${stem.index} child ancestry must be reciprocal`);
  }
}
assert.ok(rawTree.leaves.length > 0);
assert.ok(rawTree.leaves.every((leaf, index) =>
  leaf.index === index &&
  rawTree.stems[leaf.parentStemIndex] !== undefined &&
  leaf.parentAxialT >= 0 && leaf.parentAxialT <= 1
), "native leaves must retain stable source indices and parent ownership");

const bakedOptions = {
  radialSegments: 5,
  branchSamples: 2,
  maxBranchDepth: 2,
  maxStems: 96,
  maxLeaves: 120,
};
const baked = bakeTree(rawTree, bakedOptions);
const bakedAgain = bakeTree(generateTreeData("smallPine", 447_031, true), bakedOptions);
assert.deepEqual({
  signature: baked.topology.signature,
  branchVertices: baked.branches.positions.length / 3,
  branchTriangles: baked.branches.indices.length / 3,
  nativeLeafVertices: baked.leaves.positions.length / 3,
  nativeLeafTriangles: baked.leaves.indices.length / 3,
}, {
  signature: "fnv1a32:118119ea",
  branchVertices: 3799,
  branchTriangles: 6828,
  nativeLeafVertices: 1080,
  nativeLeafTriangles: 840,
}, "stable Weber-Penn ownership/range bake golden must not drift silently");
assert.equal(baked.topology.signature, bakedAgain.topology.signature);
assert.deepEqual(Array.from(baked.branches.positions), Array.from(bakedAgain.branches.positions));
assert.deepEqual(Array.from(baked.leaves.indices), Array.from(bakedAgain.leaves.indices));

const bakedStemRanges = baked.topology.stems.filter((stem) => stem.baked).sort((left, right) => left.indexStart - right.indexStart);
assert.equal(bakedStemRanges.reduce((sum, range) => sum + range.vertexCount, 0), baked.branches.positions.length / 3);
assert.equal(bakedStemRanges.reduce((sum, range) => sum + range.indexCount, 0), baked.branches.indices.length);
assert.equal(baked.topology.leaves.reduce((sum, range) => sum + range.vertexCount, 0), baked.leaves.positions.length / 3);
assert.equal(baked.topology.leaves.reduce((sum, range) => sum + range.indexCount, 0), baked.leaves.indices.length);
assert.ok(baked.topology.leaves.every((leaf) => rawTree.stems[leaf.parentStemIndex] !== undefined));

const bakedTarget = bindProcPlantWeberPennTrimTarget({ backend: "weber-penn", genomeId: "small-pine-test", seed: 447_031 }, baked);
const bakedSource = { target: bakedTarget, baked };
const emptyBaked = applyProcPlantWeberPennBakedTrimOverrides(
  bakedSource,
  createProcPlantWeberPennTrimOverrideSet(bakedTarget),
);
assert.equal(emptyBaked.audit.status, "no-op");
assert.strictEqual(emptyBaked.baked, baked, "empty baked overrides must preserve the exact source reference");

const sourceBranchSnapshot = Array.from(baked.branches.indices);
const sourceLeafSnapshot = Array.from(baked.leaves.indices);
const removeBranches = createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "branch-depth", minDepth: 1, maxDepth: 1 }),
]);
const trimmed = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, removeBranches);
const trimmedAgain = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, removeBranches);
assert.equal(trimmed.audit.status, "applied");
assert.ok(trimmed.audit.afterBranchTriangles < trimmed.audit.beforeBranchTriangles, "baked trim must remove actual stem triangles");
assert.ok(trimmed.audit.afterNativeLeafTriangles < trimmed.audit.beforeNativeLeafTriangles, "descendant repair must remove owned native leaf triangles");
assert.deepEqual(trimmed.audit, trimmedAgain.audit);
assert.deepEqual(Array.from(trimmed.baked.branches.indices), Array.from(trimmedAgain.baked.branches.indices));
const retainedStemIds = new Set(trimmed.baked.topology.stems.map((stem) => stem.stemIndex));
for (const stem of trimmed.baked.topology.stems) {
  assert.ok(stem.parentStemIndex === null || retainedStemIds.has(stem.parentStemIndex), "trimmed stems cannot have missing parents");
  assert.ok(stem.childStemIndices.every((child) => retainedStemIds.has(child)), "trimmed stems cannot retain missing children");
}
assert.ok(trimmed.baked.topology.leaves.every((leaf) => retainedStemIds.has(leaf.parentStemIndex)), "trimmed native leaves must retain live owners");
assert.deepEqual(Array.from(baked.branches.indices), sourceBranchSnapshot, "baked trim must not mutate source branch geometry");
assert.deepEqual(Array.from(baked.leaves.indices), sourceLeafSnapshot, "baked trim must not mutate source native leaf geometry");

const firstLeafId = baked.topology.leaves[0]!.attachmentId;
const leafOnly = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "attachment-ids", attachmentIds: [firstLeafId] }),
]));
assert.equal(leafOnly.audit.afterNativeLeafTriangles, leafOnly.audit.beforeNativeLeafTriangles - baked.topology.leaves[0]!.indexCount / 3);
assert.equal(leafOnly.audit.afterBranchTriangles, leafOnly.audit.beforeBranchTriangles);

const unmatchedBaked = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "segment-ids", segmentIds: ["weber-penn:stem:999999"] }),
]));
assert.equal(unmatchedBaked.audit.status, "no-op");
assert.strictEqual(unmatchedBaked.baked, baked, "unmatched baked identities must fail closed");

const staleTarget = { ...bakedTarget, topologySignature: "fnv1a32:00000000" };
const stale = applyProcPlantWeberPennBakedTrimOverrides(
  { target: staleTarget, baked },
  createProcPlantWeberPennTrimOverrideSet(staleTarget, [
    createProcPlantWeberPennTrimOperation("remove", { kind: "branch-depth", minDepth: 1 }),
  ]),
);
assert.equal(stale.audit.status, "target-mismatch");
assert.strictEqual(stale.baked, baked, "stale topology bindings must preserve the exact source reference");

console.log("procplant Weber-Penn trim override tests passed");
