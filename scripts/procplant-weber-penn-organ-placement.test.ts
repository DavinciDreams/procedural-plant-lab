import assert from "node:assert/strict";
import {
  buildProcPlantTemplate,
  defaultPlantEnvironment,
  procPlantPresets,
} from "../src/procplants";
import {
  PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_MAX_OVERRIDES,
  appendProcPlantWeberPennOrganPlacement,
  applyProcPlantWeberPennOrganPlacementOverrides,
  createProcPlantWeberPennOrganPlacementPackage,
  deserializeProcPlantWeberPennOrganPlacementPackage,
  serializeProcPlantWeberPennOrganPlacementPackage,
  undoLastProcPlantWeberPennOrganPlacement,
} from "../src/procplant-weber-penn-organ-placement";
import {
  createProcPlantWeberPennTrimOperation,
  createProcPlantWeberPennTrimOverrideSet,
} from "../src/procplant-weber-penn-trim";

const seed = 730_031;
const genome = procPlantPresets.oakCanopy!;
const baseline = buildProcPlantTemplate(genome, seed, defaultPlantEnvironment());
assert.ok(baseline.weberPennTrim?.target.topologySignature);
assert.ok(baseline.graph.attachments.length > 0);
const metadata = baseline.weberPennTrim;
const target = { ...metadata.target, topologySignature: metadata.target.topologySignature };
const firstLeafSite = baseline.graph.attachments.find((attachment) => attachment.kind === "leaf-site")!;
assert.ok(firstLeafSite);
assert.match(metadata.attachmentStemIds[firstLeafSite.id]!, /^weber-penn:stem:\d+$/);

const sourceAttachmentSnapshot = baseline.graph.attachments.map((attachment) => ({
  id: attachment.id,
  position: attachment.position.toArray(),
  tangent: attachment.tangent.toArray(),
  right: attachment.right.toArray(),
}));
const sourceTemplateSnapshot = Array.from(baseline.template.idx);

let placementPackage = createProcPlantWeberPennOrganPlacementPackage(target);
const emptyApplied = applyProcPlantWeberPennOrganPlacementOverrides({
  target,
  graph: baseline.graph,
  attachmentStemIds: metadata.attachmentStemIds,
  flowerAvailable: Boolean(genome.flower),
}, placementPackage);
assert.equal(emptyApplied.audit.status, "no-op");
assert.strictEqual(emptyApplied.graph, baseline.graph, "empty Weber placement packages must preserve the exact source graph reference");

const appended = appendProcPlantWeberPennOrganPlacement(placementPackage, {
  kind: "leaf",
  attachmentId: firstLeafSite.id,
  roll: Math.PI / 3,
  scale: 0.42,
});
assert.equal(appended.reason, null);
assert.ok(appended.operation);
assert.equal(placementPackage.operations.length, 0, "append must not mutate the source package");
placementPackage = appended.package;
const serialized = serializeProcPlantWeberPennOrganPlacementPackage(placementPackage);
assert.deepEqual(deserializeProcPlantWeberPennOrganPlacementPackage(serialized), placementPackage);
assert.equal(serializeProcPlantWeberPennOrganPlacementPackage(deserializeProcPlantWeberPennOrganPlacementPackage(serialized)), serialized);

const applied = applyProcPlantWeberPennOrganPlacementOverrides({
  target,
  graph: baseline.graph,
  attachmentStemIds: metadata.attachmentStemIds,
  flowerAvailable: Boolean(genome.flower),
}, placementPackage);
assert.equal(applied.audit.status, "applied");
assert.equal(applied.changed, true);
assert.notStrictEqual(applied.graph, baseline.graph);
assert.equal(applied.graph.organs.length, baseline.graph.organs.length + 1);
assert.equal(applied.graph.attachments.length, baseline.graph.attachments.length + 1);
assert.deepEqual(applied.graph.organs.at(-1)!.position.toArray(), firstLeafSite.position.toArray(),
  "placed organs must use the exact native attachment position without a guessed mid-stem offset");
assert.equal(applied.audit.operations[0]!.ownerStemId, metadata.attachmentStemIds[firstLeafSite.id]);
assert.equal(applied.graph.attachments.at(-1)!.organIndex, applied.graph.organs.length - 1);
assert.deepEqual(baseline.graph.attachments.map((attachment) => ({
  id: attachment.id,
  position: attachment.position.toArray(),
  tangent: attachment.tangent.toArray(),
  right: attachment.right.toArray(),
})), sourceAttachmentSnapshot, "placement must not mutate native attachment frames");

const duplicate = appendProcPlantWeberPennOrganPlacement(placementPackage, {
  kind: "fruit",
  attachmentId: firstLeafSite.id,
  scale: 0.18,
});
assert.equal(duplicate.reason, "occupied");
assert.strictEqual(duplicate.package, placementPackage);
const arbitrarySpan = appendProcPlantWeberPennOrganPlacement(placementPackage, {
  kind: "leaf",
  attachmentId: "weber-penn:pick:stem:1:span:0",
  scale: 0.2,
});
assert.equal(arbitrarySpan.reason, "invalid", "arbitrary picker spans must fail closed instead of pretending to own an attachment frame");

const missingPackage = createProcPlantWeberPennOrganPlacementPackage(target);
missingPackage.operations.push({
  ...appended.operation,
  id: "missing-native-site",
  ordinal: 0,
  attachmentId: "weber-penn:leaf-site:999999",
});
const missing = applyProcPlantWeberPennOrganPlacementOverrides({
  target,
  graph: baseline.graph,
  attachmentStemIds: metadata.attachmentStemIds,
  flowerAvailable: Boolean(genome.flower),
}, missingPackage);
assert.equal(missing.audit.status, "unsupported");
assert.strictEqual(missing.graph, baseline.graph, "unmatched exact-frame placement must preserve the source reference");
assert.equal(missing.audit.operations[0]!.reason, "missing-attachment");

const staleTarget = { ...target, topologySignature: "fnv1a32:00000000" };
const stale = applyProcPlantWeberPennOrganPlacementOverrides({
  target,
  graph: baseline.graph,
  attachmentStemIds: metadata.attachmentStemIds,
  flowerAvailable: Boolean(genome.flower),
}, { ...placementPackage, target: staleTarget });
assert.equal(stale.audit.status, "target-mismatch");
assert.strictEqual(stale.graph, baseline.graph);

const integratedEmpty = buildProcPlantTemplate(genome, seed, defaultPlantEnvironment(), {
  placementOverrides: createProcPlantWeberPennOrganPlacementPackage(target),
});
assert.deepEqual(Array.from(integratedEmpty.template.idx), sourceTemplateSnapshot,
  "unused Weber placement support must preserve canonical template bytes");
assert.equal(integratedEmpty.weberPennTrim?.placementAudit?.status, "no-op");
const integrated = buildProcPlantTemplate(genome, seed, defaultPlantEnvironment(), { placementOverrides: placementPackage });
assert.equal(integrated.weberPennTrim?.placementAudit?.status, "applied");
assert.ok(integrated.template.idx.length > baseline.template.idx.length, "exact-frame placement must add real preview/export triangles");
assert.equal(integrated.graph.organs.at(-1)?.kind, "leaf");
assert.deepEqual(Array.from(baseline.template.idx), sourceTemplateSnapshot, "integrated placement must not mutate source geometry");

const ownerTrim = createProcPlantWeberPennTrimOverrideSet(target, [
  createProcPlantWeberPennTrimOperation("remove", {
    kind: "segment-ids",
    segmentIds: [metadata.attachmentStemIds[firstLeafSite.id]!],
  }),
]);
const ownerTrimmed = buildProcPlantTemplate(genome, seed, defaultPlantEnvironment(), { trimOverrides: ownerTrim });
const ownerTrimmedWithPlacement = buildProcPlantTemplate(genome, seed, defaultPlantEnvironment(), {
  trimOverrides: ownerTrim,
  placementOverrides: placementPackage,
});
assert.equal(ownerTrimmedWithPlacement.weberPennTrim?.trimAudit?.status, "applied");
assert.equal(ownerTrimmedWithPlacement.weberPennTrim?.placementAudit?.status, "unsupported");
assert.equal(ownerTrimmedWithPlacement.weberPennTrim?.placementAudit?.operations[0]!.reason, "missing-attachment");
assert.deepEqual(Array.from(ownerTrimmedWithPlacement.template.idx), Array.from(ownerTrimmed.template.idx),
  "trimming an attachment owner must remove the site and fail its placement closed without adding geometry");

const branchTipGenome = structuredClone(genome);
branchTipGenome.id = "oak-canopy-weber-placement-branch-tip-test";
branchTipGenome.weberPenn = {
  ...branchTipGenome.weberPenn!,
  nativeLeaves: false,
  crownFill: true,
  foliageSource: "procplants",
  fillAnchor: "branch-tips",
};
const branchTipBaseline = buildProcPlantTemplate(branchTipGenome, seed, defaultPlantEnvironment());
assert.ok(branchTipBaseline.weberPennTrim?.target.topologySignature);
const branchTipTarget = {
  ...branchTipBaseline.weberPennTrim.target,
  topologySignature: branchTipBaseline.weberPennTrim.target.topologySignature,
};
const branchTip = branchTipBaseline.graph.attachments[0]!;
assert.equal(branchTip.kind, "branch-tip");
const coneAppend = appendProcPlantWeberPennOrganPlacement(createProcPlantWeberPennOrganPlacementPackage(branchTipTarget), {
  kind: "cone",
  attachmentId: branchTip.id,
  scale: 0.2,
});
assert.ok(coneAppend.operation);
const coneIntegrated = buildProcPlantTemplate(branchTipGenome, seed, defaultPlantEnvironment(), { placementOverrides: coneAppend.package });
assert.equal(coneIntegrated.weberPennTrim?.placementAudit?.status, "applied");
assert.equal(coneIntegrated.graph.organs.at(-1)?.kind, "cone");
assert.ok(coneIntegrated.template.idx.length > branchTipBaseline.template.idx.length);

const incompatibleConePackage = createProcPlantWeberPennOrganPlacementPackage(target);
incompatibleConePackage.operations.push({ ...coneAppend.operation!, attachmentId: firstLeafSite.id });
const incompatibleCone = applyProcPlantWeberPennOrganPlacementOverrides({
  target,
  graph: baseline.graph,
  attachmentStemIds: metadata.attachmentStemIds,
  flowerAvailable: false,
}, incompatibleConePackage);
assert.equal(incompatibleCone.audit.operations[0]!.reason, "incompatible-kind");
assert.strictEqual(incompatibleCone.graph, baseline.graph);

const floweringGenome = structuredClone(genome);
floweringGenome.id = "oak-canopy-weber-placement-flower-test";
floweringGenome.flower = structuredClone(Object.values(procPlantPresets).find((candidate) => candidate.flower)!.flower!);
const floweringBaseline = buildProcPlantTemplate(floweringGenome, seed, defaultPlantEnvironment());
assert.ok(floweringBaseline.weberPennTrim?.target.topologySignature);
const floweringTarget = {
  ...floweringBaseline.weberPennTrim.target,
  topologySignature: floweringBaseline.weberPennTrim.target.topologySignature,
};
const floweringAnchor = floweringBaseline.graph.attachments.find((attachment) => attachment.kind === "leaf-site")!;
const flowerAppend = appendProcPlantWeberPennOrganPlacement(createProcPlantWeberPennOrganPlacementPackage(floweringTarget), {
  kind: "flower",
  attachmentId: floweringAnchor.id,
  scale: 0.8,
});
const floweringIntegrated = buildProcPlantTemplate(floweringGenome, seed, defaultPlantEnvironment(), { placementOverrides: flowerAppend.package });
assert.equal(floweringIntegrated.weberPennTrim?.placementAudit?.status, "applied");
assert.equal(floweringIntegrated.stats.flowers, 1);
assert.ok(floweringIntegrated.template.idx.length > floweringBaseline.template.idx.length);

let capped = createProcPlantWeberPennOrganPlacementPackage(target);
capped.operations = Array.from({ length: PROCPLANT_WEBER_PENN_ORGAN_PLACEMENT_MAX_OVERRIDES }, (_, ordinal) => ({
  ...appended.operation!,
  id: `cap-${ordinal}`,
  ordinal,
  attachmentId: `weber-penn:leaf-site:${ordinal}`,
}));
assert.equal(appendProcPlantWeberPennOrganPlacement(capped, {
  kind: "leaf",
  attachmentId: "weber-penn:leaf-site:500",
  scale: 0.2,
}).reason, "cap");
assert.equal(undoLastProcPlantWeberPennOrganPlacement(placementPackage).operations.length, 0);
assert.equal(undoLastProcPlantWeberPennOrganPlacement(createProcPlantWeberPennOrganPlacementPackage(target)).operations.length, 0);
assert.throws(() => deserializeProcPlantWeberPennOrganPlacementPackage("{broken"), /valid JSON/);

console.log("procplant Weber-Penn organ placement tests passed");
