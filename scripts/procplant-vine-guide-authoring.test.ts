import assert from "node:assert/strict";
import {
  applyProcPlantVineGuidePackage,
  appendProcPlantVineGuidePoint,
  createProcPlantVineGuidePackage,
  createProcPlantVineGuideTarget,
  deserializeProcPlantVineGuidePackage,
  PROCPLANT_VINE_GUIDE_MAX_POINTS,
  serializeProcPlantVineGuidePackage,
  undoLastProcPlantVineGuidePoint,
  updateProcPlantVineGuidePoint,
} from "../src/procplant-vine-guide-authoring";
import {
  buildProcPlantTemplate,
  defaultPlantEnvironment,
  procPlantPresets,
  resolveProcPlantVinePath,
} from "../src/procplants";
import { compileProcPlantProductionDag } from "../src/procplant-production-dag";
import { createProcPlantAuthoringGraph } from "../src/procplant-authoring-graph";
import { applyProcPlantGeneratorGraphOperations } from "../src/procplant-generator-graph";

const genome = structuredClone(procPlantPresets.floweringWallCreeper!);
const seed = 0x710e2026;
const env = defaultPlantEnvironment();
const canonical = buildProcPlantTemplate(genome, seed, env);
const target = createProcPlantVineGuideTarget(genome, seed);
let authored = createProcPlantVineGuidePackage(target);

const absent = applyProcPlantVineGuidePackage(genome, seed, null);
assert.strictEqual(absent.genome, genome, "no package must preserve the exact canonical source reference");
assert.equal(absent.status, "canonical");

authored = appendProcPlantVineGuidePoint(authored, [-0.6, 0.1, 0]);
const draft = applyProcPlantVineGuidePackage(genome, seed, authored);
assert.strictEqual(draft.genome, genome, "one click is a draft and must not rebuild the plant");
assert.equal(draft.status, "draft");

authored = appendProcPlantVineGuidePoint(authored, [-0.2, 0.8, 0.15]);
authored = appendProcPlantVineGuidePoint(authored, [0.4, 1.45, -0.1]);
assert.deepEqual(authored.points.map((point) => point.id), [
  "vine-guide-point:0000",
  "vine-guide-point:0001",
  "vine-guide-point:0002",
]);
const moved = updateProcPlantVineGuidePoint(authored, "vine-guide-point:0001", [-0.1, 0.9, 0.2]);
assert.equal(moved.points[1]!.id, authored.points[1]!.id, "moving a point must preserve its stable identity");
assert.deepEqual(authored.points[1]!.position, [-0.2, 0.8, 0.15], "editing must not mutate the source package");
authored = moved;

const serialized = serializeProcPlantVineGuidePackage(authored);
const restored = deserializeProcPlantVineGuidePackage(serialized);
assert.deepEqual(restored, authored);
assert.equal(serializeProcPlantVineGuidePackage(restored), serialized, "serialization must be exact and deterministic");

const applied = applyProcPlantVineGuidePackage(genome, seed, restored);
assert.equal(applied.status, "applied");
assert.equal(applied.changed, true);
assert.notStrictEqual(applied.genome, genome);
assert.strictEqual(genome.vine?.mode, "follow", "the source genome remains unchanged");
assert.deepEqual(applied.genome.vine?.guide, restored.points.map((point) => point.position));
assert.equal(applied.genome.vine?.adhesion, 1);
assert.equal(applied.genome.vine?.avoidanceRadius, 0);
assert.equal(applied.genome.vine?.sag, 0);

const resolved = resolveProcPlantVinePath(applied.genome.vine!, applied.genome.nodeCount);
assert.deepEqual(resolved[0]!.toArray(), restored.points[0]!.position);
const resolvedEnd = resolved.at(-1)!.toArray();
const authoredEnd = restored.points.at(-1)!.position;
assert.ok(Math.hypot(
  resolvedEnd[0] - authoredEnd[0],
  resolvedEnd[1] - authoredEnd[1],
  resolvedEnd[2] - authoredEnd[2],
) < 1e-12);
const rebuilt = buildProcPlantTemplate(applied.genome, seed, env);
assert.notDeepEqual(
  rebuilt.graph.stems.map((stem) => stem.position.toArray()),
  canonical.graph.stems.map((stem) => stem.position.toArray()),
  "an applied static guide must change real generated architecture",
);

const authoredGraph = createProcPlantAuthoringGraph(applied.genome, seed);
const foliage = authoredGraph.nodes.find((node) => node.stage === "foliage")!;
const editedGraph = applyProcPlantGeneratorGraphOperations(authoredGraph, [
  { op: "set-seed", nodeId: foliage.id, value: 0x1234 },
]);
const production = compileProcPlantProductionDag(applied.genome, editedGraph, env, { canonicalSeed: seed });
assert.equal(production.path, "typed-artifacts");
assert.deepEqual(
  production.build.graph.stems.map((stem) => stem.position.toArray()),
  rebuilt.graph.stems.map((stem) => stem.position.toArray()),
  "guided-vine typed DAG edits must preserve the authored static centerline",
);

const stale = applyProcPlantVineGuidePackage(genome, seed + 1, restored);
assert.strictEqual(stale.genome, genome, "stale target packages must fail closed by source reference");
assert.equal(stale.status, "unsupported");
assert.equal(stale.reason, "target-mismatch");
const unsupported = applyProcPlantVineGuidePackage(procPlantPresets.phiFern!, seed, restored);
assert.strictEqual(unsupported.genome, procPlantPresets.phiFern!);
assert.equal(unsupported.reason, "unsupported-genome");

const undone = undoLastProcPlantVineGuidePoint(restored);
assert.equal(undone.points.length, 2);
assert.equal(undone.nextOrdinal, 3, "undo must not recycle stable point ids");
const appendedAfterUndo = appendProcPlantVineGuidePoint(undone, [0.55, 1.7, 0]);
assert.equal(appendedAfterUndo.points.at(-1)!.id, "vine-guide-point:0003");

assert.throws(() => appendProcPlantVineGuidePoint(restored, restored.points.at(-1)!.position), /too close/);
assert.throws(() => appendProcPlantVineGuidePoint(restored, [Number.NaN, 0, 0]), /finite and bounded/);
let capped = createProcPlantVineGuidePackage(target);
for (let index = 0; index < PROCPLANT_VINE_GUIDE_MAX_POINTS; index++) {
  capped = appendProcPlantVineGuidePoint(capped, [index * 0.01, 0, 0]);
}
assert.throws(() => appendProcPlantVineGuidePoint(capped, [99, 0, 0]), /at most/);
assert.throws(
  () => deserializeProcPlantVineGuidePackage(serialized.replace("vine-guide-point:0001", "vine-guide-point:0000")),
  /invalid vine guide point record/,
);

console.log(JSON.stringify({
  points: restored.points.length,
  stableIds: restored.points.map((point) => point.id),
  sourceSignature: restored.target.sourceSignature,
  architectureNodes: rebuilt.graph.stems.length,
  typedDagPath: production.path,
}));
