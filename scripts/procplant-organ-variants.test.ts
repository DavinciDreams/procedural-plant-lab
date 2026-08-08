import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildProcPlantOrganVariants,
  PROCPLANT_ORGAN_VARIANT_MAX_ATTACHMENTS,
  type ProcPlantOrganVariantSpec,
} from "../src/procplant-organ-variants";
import type { ProcPlantAttachmentAnchor, ProcPlantAttachmentKind } from "../src/procplants";

const anchor = (
  id: string,
  kind: ProcPlantAttachmentKind,
  axialT: number,
  upY: number,
  depth = 1,
): ProcPlantAttachmentAnchor => ({
  id,
  kind,
  parentSegmentId: "stem:0",
  axialT,
  position: new THREE.Vector3(axialT, depth, 0),
  tangent: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, upY, Math.sqrt(Math.max(0, 1 - upY * upY))),
  depth,
  sway: 0.5,
  organIndex: 0,
});

const attachments = [
  anchor("leaf:b", "leaf", 0.8, 1),
  anchor("flower:a", "flower", 0.6, 0.8),
  anchor("fruit:a", "fruit", 0.5, 0.4),
  anchor("thorn:a", "thorn", 0.2, -0.8),
  anchor("leaf:a", "leaf", 0.3, 0.1),
];
const spec: ProcPlantOrganVariantSpec = {
  season: "autumn",
  health: 0.72,
  maturity: 0.86,
  wetness: 0.6,
  snowLoad: 0.5,
  seed: 8072026,
};
const sourceSnapshot = attachments.map((entry) => ({ id: entry.id, up: entry.up.toArray(), axialT: entry.axialT }));
const first = buildProcPlantOrganVariants(attachments, spec);
const second = buildProcPlantOrganVariants([...attachments].reverse(), { ...spec });
assert.deepEqual(first, second, "organ masks must be deterministic and independent of attachment order");
assert.deepEqual(
  attachments.map((entry) => ({ id: entry.id, up: entry.up.toArray(), axialT: entry.axialT })),
  sourceSnapshot,
  "organ variant derivation must not mutate PlantIR attachments",
);
assert.deepEqual(first.states.map((state) => state.attachmentId), [...attachments.map((entry) => entry.id)].sort());
for (const state of first.states) {
  for (const value of [state.age, state.health, state.maturity, state.leafDropMask, state.blossomMask,
    state.reproductiveMaturityMask, state.wetnessMask, state.snowMask, state.seasonColorMix]) {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
}

const summer = buildProcPlantOrganVariants(attachments, { ...spec, season: "summer", health: 1, snowLoad: 0 });
const winter = buildProcPlantOrganVariants(attachments, { ...spec, season: "winter", health: 1, snowLoad: 1 });
const summerLeaves = summer.states.filter((state) => state.kind === "leaf");
const winterLeaves = winter.states.filter((state) => state.kind === "leaf");
assert.ok(winterLeaves.every((state, index) => state.leafDropMask > summerLeaves[index]!.leafDropMask));
assert.equal(summer.states.find((state) => state.attachmentId === "thorn:a")!.visible, true,
  "persistent defensive organs must not be seasonally dropped");
assert.equal(winter.states.find((state) => state.attachmentId === "leaf:b")!.snowMask >
  winter.states.find((state) => state.attachmentId === "leaf:a")!.snowMask, true,
"up-facing organs must accumulate more snow than side-facing organs");

const spring = buildProcPlantOrganVariants(attachments, { ...spec, season: "spring", health: 1, maturity: 1 });
assert.ok(spring.states.find((state) => state.kind === "flower")!.blossomMask >
  winter.states.find((state) => state.kind === "flower")!.blossomMask);
assert.notEqual(buildProcPlantOrganVariants(attachments, { ...spec, seed: spec.seed + 1 }).fingerprint, first.fingerprint);

assert.throws(() => buildProcPlantOrganVariants([attachments[0]!, attachments[0]!], spec), /duplicate/);
assert.throws(() => buildProcPlantOrganVariants(attachments, { ...spec, health: 2 }), /health/);
const tooMany = new Array(PROCPLANT_ORGAN_VARIANT_MAX_ATTACHMENTS + 1).fill(attachments[0]!);
assert.throws(() => buildProcPlantOrganVariants(tooMany, spec), /cap exceeded/);

console.log("ok 1 - deterministic order-independent per-organ age, health, and material masks");
console.log("ok 2 - seasonal leaf drop, blossom, maturity, wetness, and upward snow behavior");
console.log("ok 3 - nonmutation, stable fingerprints, validation, and resource caps");
console.log("1..3");
