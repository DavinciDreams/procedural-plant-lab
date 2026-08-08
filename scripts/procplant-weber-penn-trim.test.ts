import assert from "node:assert/strict";
import {
  buildProcPlantTemplate,
  defaultPlantEnvironment,
  procPlantPresets,
} from "../src/procplants";
import {
  applyProcPlantWeberPennTrimOverrides,
  createProcPlantWeberPennTrimOperation,
  createProcPlantWeberPennTrimOverrideSet,
  deserializeProcPlantWeberPennTrimOverrides,
  serializeProcPlantWeberPennTrimOverrides,
} from "../src/procplant-weber-penn-trim";

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

console.log("procplant Weber-Penn trim override tests passed");
