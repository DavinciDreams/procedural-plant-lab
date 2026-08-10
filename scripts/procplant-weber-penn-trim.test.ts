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
  signature: "fnv1a32:27384fc4",
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
assert.ok(baked.topology.stems.every((stem) => stem.tipHeightYUp === null || Number.isFinite(stem.tipHeightYUp)));
assert.ok(baked.topology.leaves.every((leaf) => Number.isFinite(leaf.attachmentHeightYUp)));

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

const bakedStemIndices = new Set(baked.topology.stems.filter((stem) => stem.baked).map((stem) => stem.stemIndex));
const sourceTips = baked.topology.stems.filter((stem) =>
  stem.baked && stem.depth > 0 && !stem.childStemIndices.some((child) => bakedStemIndices.has(child))
);
assert.ok(sourceTips.length > 0);
const firstTip = sourceTips[0]!;
const selectorOverrideSet = createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", {
    kind: "attachment-ids",
    attachmentIds: [`weber-penn:branch-tip:${firstTip.stemIndex}`],
  }),
  createProcPlantWeberPennTrimOperation("remove", { kind: "axial-range", min: 0, max: 0.28 }),
  createProcPlantWeberPennTrimOperation("remove", { kind: "height-plane", height: 0.28, side: "below" }),
]);
const serializedSelectors = serializeProcPlantWeberPennTrimOverrides(selectorOverrideSet);
assert.deepEqual(deserializeProcPlantWeberPennTrimOverrides(serializedSelectors), selectorOverrideSet);
assert.equal(
  serializeProcPlantWeberPennTrimOverrides(deserializeProcPlantWeberPennTrimOverrides(serializedSelectors)),
  serializedSelectors,
  "stable branch-tip/range/plane selector bindings must round-trip deterministically",
);
const branchTipOnly = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", {
    kind: "attachment-ids",
    attachmentIds: [`weber-penn:branch-tip:${firstTip.stemIndex}`],
  }),
]));
assert.equal(branchTipOnly.audit.status, "applied");
assert.ok(branchTipOnly.audit.removedStemIds.includes(`weber-penn:stem:${firstTip.stemIndex}`));
assert.ok(branchTipOnly.audit.afterBranchTriangles < branchTipOnly.audit.beforeBranchTriangles,
  "a stable branch-tip identity must remove its exact native owner range");
assert.ok(branchTipOnly.baked.topology.leaves.every((leaf) =>
  branchTipOnly.baked.topology.stems.some((stem) => stem.stemIndex === leaf.parentStemIndex)
), "branch-tip removal must repair native leaf ownership");

const retainedTipOnly = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("retain", {
    kind: "attachment-ids",
    attachmentIds: [`weber-penn:branch-tip:${firstTip.stemIndex}`],
  }),
]));
assert.equal(retainedTipOnly.audit.status, "applied");
assert.ok(retainedTipOnly.audit.afterBranchTriangles < retainedTipOnly.audit.beforeBranchTriangles);
const retainedTipStemIds = new Set(retainedTipOnly.baked.topology.stems.map((stem) => stem.stemIndex));
assert.ok(retainedTipStemIds.has(firstTip.stemIndex), "retain must preserve the exact selected native tip owner");
for (const stem of retainedTipOnly.baked.topology.stems) {
  assert.ok(stem.parentStemIndex === null || retainedTipStemIds.has(stem.parentStemIndex),
    "retaining a tip must preserve its complete native ancestor chain");
}
assert.ok(retainedTipOnly.baked.topology.leaves.every((leaf) => retainedTipStemIds.has(leaf.parentStemIndex)),
  "retaining a tip must remove native leaves whose owner was pruned");

const allSourceTips = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "attachment-kind", attachmentKinds: ["branch-tip"] }),
]));
assert.equal(allSourceTips.audit.status, "applied");
assert.ok(allSourceTips.audit.removedStemIds.length >= sourceTips.length);

const unknownTip = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", {
    kind: "attachment-ids",
    attachmentIds: ["weber-penn:branch-tip:999999"],
  }),
]));
assert.equal(unknownTip.audit.status, "no-op");
assert.strictEqual(unknownTip.baked, baked, "unknown branch-tip identities must preserve the exact source reference");

const lowerRange = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "axial-range", min: 0, max: 0.28 }),
]));
assert.equal(lowerRange.audit.status, "applied");
assert.ok(lowerRange.audit.afterBranchTriangles < lowerRange.audit.beforeBranchTriangles);
assert.ok(lowerRange.audit.afterNativeLeafTriangles < lowerRange.audit.beforeNativeLeafTriangles);

const belowPlane = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "height-plane", height: 0.28, side: "below" }),
]));
assert.equal(belowPlane.audit.status, "applied");
assert.deepEqual(belowPlane.audit.removedStemIds, lowerRange.audit.removedStemIds,
  "equivalent normalized range/plane selectors must resolve the same whole stem owners");
assert.deepEqual(belowPlane.audit.removedLeafIds, lowerRange.audit.removedLeafIds);

const unsafeUpperPlane = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "height-plane", height: 0.82, side: "above" }),
]));
assert.equal(unsafeUpperPlane.audit.status, "unsupported");
assert.strictEqual(unsafeUpperPlane.baked, baked,
  "a plane that selects the unsplittable trunk owner must fail closed rather than invent a partial baked range");
assert.match(unsafeUpperPlane.audit.operations.at(-1)!.reason!, /complete baked branch skeleton/);

const unmatchedBaked = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "segment-ids", segmentIds: ["weber-penn:stem:999999"] }),
]));
assert.equal(unmatchedBaked.audit.status, "no-op");
assert.strictEqual(unmatchedBaked.baked, baked, "unmatched baked identities must fail closed");

const removeCompleteSkeleton = applyProcPlantWeberPennBakedTrimOverrides(bakedSource, createProcPlantWeberPennTrimOverrideSet(bakedTarget, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "segment-ids", segmentIds: ["weber-penn:stem:0"] }),
]));
assert.equal(removeCompleteSkeleton.audit.status, "unsupported");
assert.strictEqual(removeCompleteSkeleton.baked, baked, "removing the complete skeleton must fail closed to exportable source geometry");
assert.match(removeCompleteSkeleton.audit.operations.at(-1)!.reason!, /complete baked branch skeleton/);

const staleTarget = { ...bakedTarget, topologySignature: "fnv1a32:00000000" };
const stale = applyProcPlantWeberPennBakedTrimOverrides(
  { target: staleTarget, baked },
  createProcPlantWeberPennTrimOverrideSet(staleTarget, [
    createProcPlantWeberPennTrimOperation("remove", { kind: "branch-depth", minDepth: 1 }),
  ]),
);
assert.equal(stale.audit.status, "target-mismatch");
assert.strictEqual(stale.baked, baked, "stale topology bindings must preserve the exact source reference");

const integratedGenome = procPlantPresets.oakCanopy!;
const integratedSource = buildProcPlantTemplate(integratedGenome, seed, defaultPlantEnvironment());
assert.ok(integratedSource.weberPennTrim);
assert.ok(integratedSource.weberPennTrim.pickerGraph.segmentRecords.length > 0);
assert.ok(Object.values(integratedSource.weberPennTrim.pickerStemIds).every((id) => /^weber-penn:stem:\d+$/.test(id)));

const branchTipGenome = structuredClone(integratedGenome);
branchTipGenome.id = "oak-canopy-branch-tip-trim-test";
branchTipGenome.weberPenn = {
  ...branchTipGenome.weberPenn!,
  nativeLeaves: false,
  crownFill: true,
  foliageSource: "procplants",
  fillAnchor: "branch-tips",
};
branchTipGenome.foliage = { ...branchTipGenome.foliage!, mass: 0.65 };
const branchTipSource = buildProcPlantTemplate(branchTipGenome, seed, defaultPlantEnvironment());
assert.ok(branchTipSource.weberPennTrim);
assert.ok(branchTipSource.graph.attachments.length > 0);
assert.ok(branchTipSource.graph.attachments.every((attachment) => /^weber-penn:branch-tip:\d+$/.test(attachment.id)));
const integratedTipId = branchTipSource.graph.attachments[0]!.id;
const integratedTipTrimmed = buildProcPlantTemplate(branchTipGenome, seed, defaultPlantEnvironment(), {
  trimOverrides: createProcPlantWeberPennTrimOverrideSet(branchTipSource.weberPennTrim.target, [
    createProcPlantWeberPennTrimOperation("remove", { kind: "attachment-ids", attachmentIds: [integratedTipId] }),
  ]),
});
assert.equal(integratedTipTrimmed.weberPennTrim?.trimAudit?.status, "applied");
assert.ok(!integratedTipTrimmed.graph.attachments.some((attachment) => attachment.id === integratedTipId),
  "trimmed crown-fill graph must remove the native branch-tip anchor");
assert.ok(integratedTipTrimmed.template.idx.length < branchTipSource.template.idx.length,
  "branch-tip trim must remove native stem and attached crown-fill geometry");
const exactEmpty = buildProcPlantTemplate(integratedGenome, seed, defaultPlantEnvironment(), {
  trimOverrides: createProcPlantWeberPennTrimOverrideSet(integratedSource.weberPennTrim.target),
});
assert.deepEqual(Array.from(exactEmpty.template.pos), Array.from(integratedSource.template.pos));
assert.deepEqual(Array.from(exactEmpty.template.idx), Array.from(integratedSource.template.idx));
assert.deepEqual(
  exactEmpty.graph.attachments.map((attachment) => attachment.id),
  integratedSource.graph.attachments.map((attachment) => attachment.id),
  "an empty integrated trim must preserve public attachment identities and order",
);

const integratedOverrides = createProcPlantWeberPennTrimOverrideSet(integratedSource.weberPennTrim.target, [
  createProcPlantWeberPennTrimOperation("remove", { kind: "branch-depth", minDepth: 2 }),
]);
const integratedTrimmed = buildProcPlantTemplate(integratedGenome, seed, defaultPlantEnvironment(), {
  trimOverrides: integratedOverrides,
});
assert.equal(integratedTrimmed.weberPennTrim?.trimAudit?.status, "applied");
assert.ok(integratedTrimmed.template.idx.length < integratedSource.template.idx.length,
  "build integration must remove real preview/export triangle indices");
assert.ok(integratedTrimmed.graph.attachments.length < integratedSource.graph.attachments.length,
  "native leaf/crown-fill attachment records must be cleaned with their owner stems");
const removedIntegratedLeaves = new Set(integratedTrimmed.weberPennTrim!.trimAudit!.removedLeafIds);
assert.ok(removedIntegratedLeaves.size > 0);
assert.ok(integratedTrimmed.graph.attachments.every((attachment) => !removedIntegratedLeaves.has(attachment.id)));
const removedIntegratedStems = new Set(integratedTrimmed.weberPennTrim!.trimAudit!.removedStemIds);
assert.ok(Object.values(integratedTrimmed.weberPennTrim!.pickerStemIds).every((id) => !removedIntegratedStems.has(id)),
  "trimmed picker graph cannot advertise removed source stems");
assert.deepEqual(Array.from(integratedSource.template.idx), Array.from(exactEmpty.template.idx),
  "integrated trim builds must not mutate the source template");

const heightTrimmedIntegrated = buildProcPlantTemplate(integratedGenome, seed, defaultPlantEnvironment(), {
  trimOverrides: createProcPlantWeberPennTrimOverrideSet(integratedSource.weberPennTrim.target, [
    createProcPlantWeberPennTrimOperation("remove", { kind: "height-plane", height: 0.28, side: "below" }),
  ]),
});
assert.equal(heightTrimmedIntegrated.weberPennTrim?.trimAudit?.status, "applied");
assert.ok(heightTrimmedIntegrated.template.idx.length < integratedSource.template.idx.length,
  "normalized height-plane trim must remove exact integrated owner ranges");

const staleIntegratedTarget = { ...integratedSource.weberPennTrim.target, topologySignature: "fnv1a32:00000000" as const };
const staleIntegrated = buildProcPlantTemplate(integratedGenome, seed, defaultPlantEnvironment(), {
  trimOverrides: createProcPlantWeberPennTrimOverrideSet(staleIntegratedTarget, [
    createProcPlantWeberPennTrimOperation("remove", { kind: "branch-depth", minDepth: 2 }),
  ]),
});
assert.equal(staleIntegrated.weberPennTrim?.trimAudit?.status, "target-mismatch");
assert.deepEqual(Array.from(staleIntegrated.template.idx), Array.from(integratedSource.template.idx),
  "stale integrated targets must preserve exact generated geometry atomically");

console.log("procplant Weber-Penn trim override tests passed");
