import assert from "node:assert/strict";
import * as THREE from "three";
import {
  applyProcPlantVineGuidePackage,
  appendProcPlantVineGuidePoint,
  createProcPlantVineGuidePackage,
  createProcPlantVineGuideTarget,
  serializeProcPlantVineGuidePackage,
} from "../src/procplant-vine-guide-authoring";
import {
  attachProcPlantVineGuidePointToLiveSupport,
  createProcPlantVineLiveSupportPackage,
  createProcPlantVineLiveSupportPoseFromObject3D,
  deserializeProcPlantVineLiveSupportPackage,
  rebindProcPlantVineGuidePointToLiveSupport,
  rebuildProcPlantVineGuideFromLiveSupports,
  serializeProcPlantVineLiveSupportPackage,
} from "../src/procplant-vine-live-support";
import { buildProcPlantTemplate, defaultPlantEnvironment, procPlantPresets } from "../src/procplants";

const close = (actual: number, expected: number, epsilon = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

const genome = structuredClone(procPlantPresets.floweringWallCreeper!);
const seed = 0x1a77ac4;
let guide = createProcPlantVineGuidePackage(createProcPlantVineGuideTarget(genome, seed));
guide = appendProcPlantVineGuidePoint(guide, [-0.5, 0.25, 0.04]);
guide = appendProcPlantVineGuidePoint(guide, [0.45, 1.4, 0.04]);
const exactV1 = serializeProcPlantVineGuidePackage(guide);
const guideSnapshot = structuredClone(guide);

const guideRoot = new THREE.Group();
guideRoot.position.set(2, 0, -1);
guideRoot.rotation.y = 0.2;
guideRoot.updateMatrixWorld(true);
const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.08));
wall.position.set(0, 0.8, 0);
guideRoot.add(wall);
guideRoot.updateMatrixWorld(true);

let attachment = createProcPlantVineLiveSupportPackage(guide);
const wallMatrixSnapshot = wall.matrixWorld.toArray();
const rootMatrixSnapshot = guideRoot.matrixWorld.toArray();
const initialPose = createProcPlantVineLiveSupportPoseFromObject3D(wall, {
  id: "trellis:west", kind: "triangle-mesh", supportSignature: "trellis-geometry-v1", guideRoot,
});
assert.deepEqual(wall.matrixWorld.toArray(), wallMatrixSnapshot, "pose capture must not mutate or update the support");
assert.deepEqual(guideRoot.matrixWorld.toArray(), rootMatrixSnapshot, "pose capture must not mutate or update the guide root");
for (const point of guide.points) {
  attachment = attachProcPlantVineGuidePointToLiveSupport(guide, attachment, point.id, initialPose);
}
assert.deepEqual(guide, guideSnapshot, "attachment capture must not mutate the V1 guide");
assert.equal(serializeProcPlantVineGuidePackage(guide), exactV1, "V1 canonical bytes must remain exact");
const serializedAttachment = serializeProcPlantVineLiveSupportPackage(attachment);
assert.equal(serializedAttachment.includes("matrixWorld"), false);
assert.equal(serializedAttachment.includes('"geometry"'), false);
assert.equal(serializedAttachment.includes("vertices"), false);
assert.deepEqual(deserializeProcPlantVineLiveSupportPackage(serializedAttachment), attachment);

wall.position.x += 0.3;
wall.position.y += 0.1;
wall.scale.y = 1.2;
guideRoot.updateMatrixWorld(true);
const movedPose = createProcPlantVineLiveSupportPoseFromObject3D(wall, {
  id: "trellis:west", kind: "triangle-mesh", supportSignature: "trellis-geometry-v1", guideRoot,
});
const rebuilt = rebuildProcPlantVineGuideFromLiveSupports(guide, attachment, [movedPose], { maxPointMotion: 1 });
assert.equal(rebuilt.status, "rebuilt");
assert.equal(rebuilt.changed, true);
assert.equal(rebuilt.audit.transformedPoints, 2);
assert.deepEqual(guide, guideSnapshot, "transform rebuild must not mutate source guide");
close(rebuilt.authored.points[0]!.position[0], -0.2);
close(rebuilt.authored.points[0]!.position[1], 0.24);
close(rebuilt.authored.points[1]!.position[0], 0.75);
close(rebuilt.authored.points[1]!.position[1], 1.62);
const applied = applyProcPlantVineGuidePackage(genome, seed, rebuilt.authored);
assert.equal(applied.status, "applied");
assert.ok(buildProcPlantTemplate(applied.genome, seed, defaultPlantEnvironment()).graph.stems.length > 1);
const limited = rebuildProcPlantVineGuideFromLiveSupports(guide, attachment, [movedPose], { maxPointMotion: 0.01 });
assert.equal(limited.status, "stale");
assert.equal(limited.reason, "motion-limit");
assert.strictEqual(limited.authored, guide);
assert.throws(() => rebuildProcPlantVineGuideFromLiveSupports(guide, attachment, [movedPose, movedPose]), /duplicate live support id/);
assert.throws(() => rebuildProcPlantVineGuideFromLiveSupports(guide, attachment, Array.from({ length: 129 }, () => movedPose)), /pose cap/);
assert.throws(() => deserializeProcPlantVineLiveSupportPackage(" ".repeat(16_385)), /16 KiB/);

const repeated = rebuildProcPlantVineGuideFromLiveSupports(rebuilt.authored, rebuilt.attachment, [movedPose]);
assert.equal(repeated.status, "rebuilt");
assert.deepEqual(repeated.authored.points, rebuilt.authored.points, "same pose rebuild must be deterministic");

const missing = rebuildProcPlantVineGuideFromLiveSupports(rebuilt.authored, rebuilt.attachment, []);
assert.equal(missing.status, "stale");
assert.equal(missing.reason, "missing-support");
assert.strictEqual(missing.authored, rebuilt.authored);
assert.strictEqual(missing.attachment, rebuilt.attachment);
const deformedPose = createProcPlantVineLiveSupportPoseFromObject3D(wall, {
  id: "trellis:west", kind: "triangle-mesh", supportSignature: "trellis-geometry-v2", guideRoot,
});
const deformed = rebuildProcPlantVineGuideFromLiveSupports(rebuilt.authored, rebuilt.attachment, [deformedPose]);
assert.equal(deformed.status, "stale");
assert.equal(deformed.reason, "support-signature-mismatch");
assert.strictEqual(deformed.authored, rebuilt.authored, "geometry drift must fail closed");

const beforeRebind = structuredClone(rebuilt.authored);
const rebound = rebindProcPlantVineGuidePointToLiveSupport(
  rebuilt.authored, rebuilt.attachment, rebuilt.authored.points[0]!.id, [-0.18, 0.3, 0.05], deformedPose,
);
assert.equal(rebound.attachment.bindings[0]!.supportSignature, "trellis-geometry-v2");
assert.deepEqual(rebuilt.authored, beforeRebind, "explicit rebind must not mutate its source");
const partiallyRebound = rebuildProcPlantVineGuideFromLiveSupports(rebound.authored, rebound.attachment, [deformedPose]);
assert.equal(partiallyRebound.status, "stale", "every binding must be rebound after geometry deformation");
assert.equal(partiallyRebound.reason, "support-signature-mismatch");
const reboundSecond = rebindProcPlantVineGuidePointToLiveSupport(
  rebound.authored, rebound.attachment, rebound.authored.points[1]!.id, [0.72, 1.62, 0.05], deformedPose,
);
const recovered = rebuildProcPlantVineGuideFromLiveSupports(reboundSecond.authored, reboundSecond.attachment, [deformedPose]);
assert.equal(recovered.status, "rebuilt");

wall.geometry.dispose();
const singularRoot = new THREE.Group();
singularRoot.scale.set(0, 1, 1);
singularRoot.updateMatrixWorld(true);
assert.throws(() => createProcPlantVineLiveSupportPoseFromObject3D(wall, {
  id: "bad", supportSignature: "v1", guideRoot: singularRoot,
}), /invertible/);

console.log(JSON.stringify({
  v1Bytes: new TextEncoder().encode(exactV1).byteLength,
  attachmentBytes: new TextEncoder().encode(serializedAttachment).byteLength,
  bindings: attachment.bindings.length,
  movedPoints: rebuilt.audit.transformedPoints,
  staleReason: deformed.reason,
  recovery: recovered.status,
}));
