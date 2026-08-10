import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  buildProcPlantInstancedParts,
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantEcologyProfiles,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";
import { labelForPresetId, procPlantBuiltinPresetLabels } from "../src/saved-presets";

const IDS = [
  "maidenhairFernPatch",
  "woodlandVioletCarpet",
  "trilliumPatch",
  "horsetailColony",
] as const;
const GROUND_COVER_LOD_IDS = [
  "phiFern",
  "brackenFernMat",
  "cloverGroundcover",
  "woodSorrelCarpet",
  "woodlandAnemoneCarpet",
  "creepingPhloxCarpet",
  "wildStrawberryGroundcover",
  "maidenhairFernPatch",
  "woodlandVioletCarpet",
  "trilliumPatch",
  "horsetailColony",
] as const;
const SEED = 0x6a09e667;
const environment = { ...defaultPlantEnvironment(), light: 0.58, moisture: 0.78, crowding: 0.34 };

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
    box.expandByPoint(point.set(template.pos[offset]!, template.pos[offset + 1]!, template.pos[offset + 2]!));
  }
  const size = box.getSize(new THREE.Vector3());
  return { x: size.x, y: size.y, z: size.z, coverage: Math.max(size.x, size.z) };
};

const axisRange = (template: ProcPlantTemplate, axis: 0 | 1 | 2) => {
  let min = Infinity;
  let max = -Infinity;
  for (let offset = axis; offset < template.pos.length; offset += 3) {
    min = Math.min(min, template.pos[offset]!);
    max = Math.max(max, template.pos[offset]!);
  }
  return max - min;
};

const pointSegmentDistance = (point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3) => {
  const span = end.clone().sub(start);
  const lengthSq = span.lengthSq();
  const t = lengthSq > 1e-12 ? THREE.MathUtils.clamp(point.clone().sub(start).dot(span) / lengthSq, 0, 1) : 0;
  return point.distanceTo(start.clone().addScaledVector(span, t));
};

const summaries = IDS.map((id) => {
  const genome = procPlantPresets[id];
  assert.ok(genome, `${id} must be registered`);
  assert.notEqual(genome.habit, "grass", `${id} must remain non-grass groundcover`);
  assert.equal(procPlantEcologyProfiles[id]?.presetId, id, `${id} needs canonical ecology data`);
  assert.equal(labelForPresetId(id), procPlantBuiltinPresetLabels[id], `${id} needs a canonical label`);

  const first = compileProcPlantLods(genome, SEED, environment);
  const second = compileProcPlantLods(genome, SEED, environment);
  assert.deepEqual(first.map((lod) => hashTemplate(lod.template)), second.map((lod) => hashTemplate(lod.template)));
  assert.deepEqual(first.map((lod) => lod.triangles), second.map((lod) => lod.triangles));
  assert.ok(first[0]!.triangles > first[1]!.triangles, `${id} LOD1 must strictly reduce LOD0`);
  assert.ok(first[1]!.triangles > first[2]!.triangles, `${id} LOD2 must strictly reduce LOD1`);
  assert.equal(first[2]!.triangles, 4, `${id} LOD2 must be a crossed four-triangle card`);
  assert.equal(first[3]!.triangles, 2, `${id} LOD3 must be a two-triangle impostor`);
  assert.ok(first[0]!.triangles <= 2_500, `${id} close LOD exceeds the 2,500 triangle target`);

  const bounds = templateBounds(first[0]!.template);
  const radius = genome.groundcover!.radius;
  assert.ok(bounds.coverage >= radius * 1.2, `${id} does not cover enough of its authored patch radius`);
  assert.ok(Math.min(bounds.x, bounds.z) >= radius * 1.1, `${id} patch must cover broad area in both ground-plane axes`);
  assert.ok(bounds.coverage <= radius * 2.8, `${id} exceeds its authored patch placement bounds`);
  assert.ok(bounds.y >= 0.1 && bounds.y <= 1.2, `${id} height must remain suitable for groundcover placement`);

  const parts = buildProcPlantInstancedParts(genome, SEED, environment);
  assert.equal(parts.instances.some((instance) => instance.kind === "grassBlade"), false, `${id} cannot use grass blades`);
  const segments = new Map(parts.graph.segmentRecords.map((segment) => [segment.id, segment]));
  assert.ok(parts.graph.attachments.length >= 12, `${id} needs inspectable organ attachments`);
  for (const attachment of parts.graph.attachments) {
    assert.ok(attachment.parentSegmentId, `${id} organ ${attachment.id} must retain support ancestry`);
    const segment = segments.get(attachment.parentSegmentId!);
    assert.ok(segment, `${id} attachment parent must resolve`);
    const start = parts.graph.stems[segment!.startNodeIndex]!.position;
    const end = parts.graph.stems[segment!.endNodeIndex]!.position;
    assert.ok(pointSegmentDistance(attachment.position, start, end) <= 0.035, `${id} organ drifted away from its support stem`);
    assert.ok(Math.abs(attachment.tangent.length() - 1) < 1e-5);
    assert.ok(Math.abs(attachment.right.length() - 1) < 1e-5);
    assert.ok(Math.abs(attachment.up.length() - 1) < 1e-5);
    assert.ok(Math.abs(attachment.tangent.dot(attachment.right)) < 1e-5);
    assert.ok(new THREE.Vector3().crossVectors(attachment.tangent, attachment.right).dot(attachment.up) > 0.999);
  }

  return {
    id,
    label: labelForPresetId(id),
    triangles: first.map((lod) => lod.triangles),
    vertices: first.map((lod) => lod.vertices),
    bounds,
    attachments: parts.graph.attachments.length,
    leaves: parts.stats.leaves,
    flowers: parts.stats.flowers,
    hash: hashTemplate(first[0]!.template),
  };
});

assert.equal(new Set(summaries.map((summary) => summary.hash)).size, IDS.length, "all four groundcovers need distinct deterministic geometry");
assert.equal(new Set(IDS.map((id) => procPlantPresets[id]!.leaf.shape)).size, IDS.length, "all four groundcovers need distinct leaf silhouettes");
assert.equal(new Set(IDS.map((id) => procPlantPresets[id]!.leaf.colorA)).size, IDS.length, "all four groundcovers need distinct foliage palettes");

for (const id of GROUND_COVER_LOD_IDS) {
  const genome = procPlantPresets[id]!;
  const lods = compileProcPlantLods(genome, SEED, environment);
  const fullBounds = templateBounds(lods[0]!.template);
  const groundParallel = fullBounds.coverage / Math.max(0.08, fullBounds.y) >= 3;
  for (const lod of [lods[2]!, lods[3]!]) {
    const yRange = axisRange(lod.template, 1);
    const horizontalNormal = Array.from(lod.template.nrm).every((value, index) => (
      index % 3 === 1 ? Math.abs(value - 1) < 1e-6 : Math.abs(value) < 1e-6
    ));
    if (groundParallel) {
      assert.ok(yRange < 1e-6, `${id} LOD${lod.level} flat-patch card must stay ground parallel`);
      assert.equal(horizontalNormal, true, `${id} LOD${lod.level} flat-patch card normals must point up`);
      assert.ok(axisRange(lod.template, 0) >= fullBounds.x - 1e-5, `${id} LOD${lod.level} must preserve X coverage`);
      assert.ok(axisRange(lod.template, 2) >= fullBounds.z - 1e-5, `${id} LOD${lod.level} must preserve Z coverage`);
    } else {
      assert.ok(yRange >= Math.max(0.08, fullBounds.y) - 1e-5, `${id} LOD${lod.level} upright habit must preserve height`);
      assert.equal(horizontalNormal, false, `${id} LOD${lod.level} upright habit cannot use a ground card`);
    }
  }
}

console.log(JSON.stringify(summaries, null, 2));
console.log("procplant groundcover-variety tests passed");
