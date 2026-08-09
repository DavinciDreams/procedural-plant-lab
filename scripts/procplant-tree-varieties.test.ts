import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  buildProcPlantTemplate,
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantEcologyProfiles,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";

const IDS = [
  "sugarMaple",
  "weepingWillow",
  "windsweptBonsai",
  "deadwoodSnag",
  "twilightFantasyTree",
] as const;
const SEED = 424242;
const environment = defaultPlantEnvironment();

const hashTemplate = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const templateBounds = (template: ProcPlantTemplate) => {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let offset = 0; offset < template.pos.length; offset += 3) {
    point.set(template.pos[offset]!, template.pos[offset + 1]!, template.pos[offset + 2]!);
    box.expandByPoint(point);
  }
  const size = box.getSize(new THREE.Vector3());
  return { width: Math.max(size.x, size.z), depth: Math.min(size.x, size.z), height: size.y };
};

const summaries = IDS.map((id) => {
  const genome = procPlantPresets[id];
  assert.ok(genome, `${id} must be registered`);
  const ecology = procPlantEcologyProfiles[id];
  assert.equal(ecology?.presetId, id, `${id} must have an ecology profile`);

  const first = compileProcPlantLods(genome, SEED, environment);
  const second = compileProcPlantLods(genome, SEED, environment);
  assert.equal(first.length, 4, `${id} must compile four real LODs`);
  assert.deepEqual(first.map((lod) => lod.level), [0, 1, 2, 3]);
  assert.deepEqual(first.map((lod) => lod.label), ["full", "clustered", "billboard-cross", "impostor"]);
  assert.deepEqual(first.map((lod) => lod.triangles), second.map((lod) => lod.triangles));
  assert.deepEqual(first.map((lod) => hashTemplate(lod.template)), second.map((lod) => hashTemplate(lod.template)));
  for (let level = 1; level < first.length; level++) {
    assert.ok(first[level]!.triangles < first[level - 1]!.triangles, `${id} LOD${level} must reduce triangles`);
  }
  assert.ok(first[0]!.triangles < 25_000, `${id} exceeds its close LOD triangle budget`);
  assert.equal(first[2]!.triangles, 4, `${id} billboard-cross must stay four triangles`);
  assert.equal(first[3]!.triangles, 2, `${id} impostor must stay two triangles`);

  const built = buildProcPlantTemplate(genome, SEED, environment);
  assert.equal(hashTemplate(built.template), hashTemplate(first[0]!.template));
  const bounds = templateBounds(built.template);
  assert.ok(bounds.width > 0.08 && bounds.height > 0.35, `${id} must have a meaningful 3D silhouette`);
  return {
    id,
    triangles: first.map((lod) => lod.triangles),
    vertices: first.map((lod) => lod.vertices),
    bounds,
    leaves: built.stats.leaves,
    attachments: built.graph.attachments.length,
    hash: hashTemplate(first[0]!.template),
  };
});

const byId = new Map(summaries.map((summary) => [summary.id, summary]));
const maple = byId.get("sugarMaple")!;
const willow = byId.get("weepingWillow")!;
const bonsai = byId.get("windsweptBonsai")!;
const snag = byId.get("deadwoodSnag")!;
const fantasy = byId.get("twilightFantasyTree")!;
assert.equal(new Set(summaries.map((summary) => summary.hash)).size, IDS.length, "each variety needs a distinct close-LOD hash");
for (const summary of [willow, bonsai, fantasy]) {
  assert.ok(summary.attachments > 0, `${summary.id} must expose stable branch-tip attachment frames`);
}

// The volumetric maple exposes real branch-relative organ anchors. Validate
// orthonormal, right-handed frames instead of merely checking that fields exist.
const mapleGraph = buildProcPlantTemplate(procPlantPresets.sugarMaple!, SEED, environment).graph;
assert.ok(mapleGraph.attachments.length >= 12, "maple needs enough inspectable foliage attachments");
for (const attachment of mapleGraph.attachments) {
  assert.ok(Math.abs(attachment.tangent.length() - 1) < 1e-5);
  assert.ok(Math.abs(attachment.right.length() - 1) < 1e-5);
  assert.ok(Math.abs(attachment.up.length() - 1) < 1e-5);
  assert.ok(Math.abs(attachment.tangent.dot(attachment.right)) < 1e-5);
  assert.ok(Math.abs(attachment.tangent.dot(attachment.up)) < 1e-5);
  assert.ok(Math.abs(attachment.right.dot(attachment.up)) < 1e-5);
  const handedness = new THREE.Vector3().crossVectors(attachment.tangent, attachment.right).dot(attachment.up);
  assert.ok(handedness > 0.999, "attachment frame must remain right-handed");
}

for (const id of ["weepingWillow", "windsweptBonsai", "deadwoodSnag", "twilightFantasyTree"] as const) {
  const graph = buildProcPlantTemplate(procPlantPresets[id]!, SEED, environment).graph;
  const segmentIds = new Set(graph.segmentRecords.map((segment) => segment.id));
  assert.ok(graph.attachments.length > 0, `${id} must expose branch-module tip anchors`);
  for (const attachment of graph.attachments) {
    assert.equal(attachment.kind, "branch-tip");
    assert.ok(attachment.parentSegmentId && segmentIds.has(attachment.parentSegmentId), `${id} anchor parent must be stable`);
    assert.equal(attachment.axialT, 1);
    assert.ok(Math.abs(attachment.tangent.dot(attachment.right)) < 1e-5);
    assert.ok(new THREE.Vector3().crossVectors(attachment.tangent, attachment.right).dot(attachment.up) > 0.999);
  }
}

assert.ok(maple.leaves > 20, "maple must retain a broad leafy crown");
assert.ok(maple.bounds.width > willow.bounds.width * 3, "maple crown must read broader than the willow silhouette");
assert.ok(willow.leaves > 10, "willow must retain hanging foliage");
assert.ok(willow.bounds.height > willow.bounds.width * 2, "willow must retain its vertically draped silhouette");
assert.ok(bonsai.bounds.height < maple.bounds.height * 0.72, "bonsai silhouette must be materially shorter than maple");
assert.equal(snag.leaves, 0, "deadwood snag must remain leafless");
assert.ok(snag.triangles[0]! < maple.triangles[0]! * 0.45, "leafless snag should be substantially cheaper than maple");
assert.notEqual(procPlantPresets.sugarMaple!.leaf.shape, procPlantPresets.weepingWillow!.leaf.shape);
assert.notEqual(procPlantPresets.windsweptBonsai!.leaf.shape, procPlantPresets.twilightFantasyTree!.leaf.shape);
assert.notEqual(fantasy.hash, maple.hash, "restrained fantasy tree must not collapse to the maple silhouette");
assert.equal(procPlantPresets.twilightFantasyTree!.phyllotaxy?.mode, "whorled");

console.log(JSON.stringify(summaries, null, 2));
console.log("procplant tree-variety tests passed");
