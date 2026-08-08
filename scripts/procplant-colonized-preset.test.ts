import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  buildProcPlantInstancedParts,
  buildProcPlantRuntimePackage,
  buildProcPlantTemplate,
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantEcologyProfiles,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";

const preset = procPlantPresets.colonizedHazelShrub;
assert.ok(preset?.spaceColonization, "colonized hazel must opt into space colonization");
assert.equal(preset.weberPenn, undefined);
assert.equal(preset.branchModules, undefined);
assert.equal(procPlantEcologyProfiles.colonizedHazelShrub?.presetId, "colonizedHazelShrub");

const environment = defaultPlantEnvironment();
const seed = 807_026;
const hashTemplate = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const first = buildProcPlantInstancedParts(preset, seed, environment);
const second = buildProcPlantInstancedParts(preset, seed, environment);
assert.equal(hashTemplate(first.stems), hashTemplate(second.stems), "swept stem output must be byte-stable");
assert.deepEqual(
  first.instances.map((instance) => [instance.kind, ...instance.matrix.elements, instance.color.getHex(), instance.sway]),
  second.instances.map((instance) => [instance.kind, ...instance.matrix.elements, instance.color.getHex(), instance.sway]),
  "foliage instances must be deterministic",
);
assert.equal(first.graph.segments.length, first.graph.stems.length - 1);
assert.equal(first.stats.stems, first.graph.segments.length);
assert.equal(first.stats.leaves, first.instances.length);
assert.deepEqual(
  [first.graph.stems.length, first.graph.segments.length, first.stats.leaves, first.stats.stemTriangles],
  [212, 211, 158, 2_370],
  "seeded crown topology and swept-tube cost must remain stable",
);
assert.ok(first.graph.stems.length > 32, "crown must contain a developed branch skeleton");
assert.ok(first.graph.stems.length <= preset.spaceColonization.maxNodes);
assert.ok(first.stats.leaves >= 24 && first.stats.leaves <= 220, "foliage count must stay dense but bounded");
assert.ok(first.stats.stemTriangles <= 2_800, "indexed swept branches must stay within the shrub stem budget");
assert.ok(first.stems.pos.length / 3 < first.stems.idx.length, "swept tubes must preserve indexed vertex reuse");

let maximumSway = 0;
for (const value of first.stems.sway) {
  assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  maximumSway = Math.max(maximumSway, value);
}
assert.ok(maximumSway > 0.9, "distal swept branches must carry wind weight");

assert.equal(first.graph.attachments.length, first.graph.organs.length);
for (const attachment of first.graph.attachments) {
  assert.ok(attachment.parentSegmentId, "every crown leaf must retain a supporting branch segment");
  assert.ok(Math.abs(attachment.tangent.length() - 1) < 1e-6);
  assert.ok(Math.abs(attachment.right.length() - 1) < 1e-6);
  assert.ok(Math.abs(attachment.up.length() - 1) < 1e-6);
  assert.ok(Math.abs(attachment.tangent.dot(attachment.right)) < 1e-5);
  assert.ok(attachment.tangent.clone().cross(attachment.right).dot(attachment.up) > 0.999);
  const organ = first.graph.organs[attachment.organIndex!];
  assert.ok(organ);
  assert.ok(Math.abs(organ.direction.dot(organ.right)) < 1e-5, "leaf frame must remain orthogonal");
  assert.ok(
    Math.abs(organ.direction.dot(attachment.tangent)) < 0.92,
    "leaf blade must diverge from its supporting twig",
  );
}

const built = buildProcPlantTemplate(preset, seed, environment);
const repeated = buildProcPlantTemplate(preset, seed, environment);
assert.equal(hashTemplate(built.template), hashTemplate(repeated.template), "materialized asset must be byte-stable");
assert.equal(
  hashTemplate(built.template),
  "1490bd0e59f0bbe49607164c863b28dabcd28cfa64e62045be57356e15b5fe81",
  "production-preset bytes must remain stable",
);
assert.equal(built.stats.triangles, built.template.idx.length / 3);
assert.equal(built.stats.leaves, first.stats.leaves);
assert.ok(built.stats.triangles <= 5_200, "LOD0 must meet the strict realtime shrub budget");
const box = new THREE.Box3();
const point = new THREE.Vector3();
for (let index = 0; index < built.template.pos.length; index += 3) {
  point.set(built.template.pos[index]!, built.template.pos[index + 1]!, built.template.pos[index + 2]!);
  box.expandByPoint(point);
}
assert.ok(box.max.y > 1.5 && box.max.y < 3.0, "crown height must remain shrub scale");
assert.ok(box.max.x - box.min.x > 1.0, "colonized crown must spread laterally");

const explicitTubeDefaults = structuredClone(preset);
explicitTubeDefaults.spaceColonization!.collarStrength = 0.24;
explicitTubeDefaults.spaceColonization!.collarLength = 0.22;
explicitTubeDefaults.spaceColonization!.junctionAo = 0.2;
assert.equal(
  hashTemplate(buildProcPlantTemplate(explicitTubeDefaults, seed, environment).template),
  hashTemplate(built.template),
  "new crown/tube controls must preserve exact legacy geometry at their defaults",
);
const authoredTube = structuredClone(explicitTubeDefaults);
authoredTube.spaceColonization!.volume.dimensions = [1.5, 0.78, 1.22];
authoredTube.spaceColonization!.attractorCount = 120;
authoredTube.spaceColonization!.maxNodes = 180;
authoredTube.spaceColonization!.radialSegments = 3;
authoredTube.spaceColonization!.collarStrength = 0.42;
authoredTube.spaceColonization!.barkIrregularity = 0.02;
const authored = buildProcPlantTemplate(authoredTube, seed, environment);
assert.notEqual(hashTemplate(authored.template), hashTemplate(built.template));
assert.ok(authored.stats.triangles < built.stats.triangles, "lower tube resolution must reduce the authored crown triangle cost");

const lods = compileProcPlantLods(preset, seed, environment);
assert.deepEqual(lods.map((lod) => lod.level), [0, 1, 2, 3]);
assert.deepEqual(lods.map((lod) => lod.triangles), [4_898, 2_457, 4, 2]);
assert.ok(lods[0]!.triangles <= 5_200);
assert.ok(lods[1]!.triangles <= 2_800);
assert.ok(lods[0]!.triangles > lods[1]!.triangles);
assert.ok(lods[1]!.triangles > lods[2]!.triangles);
assert.deepEqual(lods.slice(2).map((lod) => lod.triangles), [4, 2]);

const runtime = buildProcPlantRuntimePackage(preset, seed, environment);
assert.equal(runtime.architecture.backend, "space-colonization");
assert.equal(runtime.ecology?.presetId, "colonizedHazelShrub");
assert.equal(runtime.stats.triangles, built.stats.triangles);

console.log(JSON.stringify({
  seed,
  nodes: first.graph.stems.length,
  segments: first.graph.segments.length,
  leaves: first.stats.leaves,
  stemTriangles: first.stats.stemTriangles,
  lodTriangles: lods.map((lod) => lod.triangles),
  bounds: {
    width: Number((box.max.x - box.min.x).toFixed(3)),
    height: Number((box.max.y - box.min.y).toFixed(3)),
    depth: Number((box.max.z - box.min.z).toFixed(3)),
  },
  sha256: hashTemplate(built.template),
}));
console.log("procplant colonized production-preset tests passed");
