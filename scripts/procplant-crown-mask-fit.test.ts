import assert from "node:assert/strict";
import * as THREE from "three";
import {
  fitProcPlantCrownMask,
  PROCPLANT_CROWN_MASK_FIT_CONTRACT,
  PROCPLANT_CROWN_MASK_FIT_VERSION,
  PROCPLANT_CROWN_MASK_MAX_BANDS,
  PROCPLANT_CROWN_MASK_MAX_DIMENSION,
  PROCPLANT_CROWN_MASK_MAX_PIXELS,
  PROCPLANT_CROWN_MASK_MAX_WORK_UNITS,
} from "../src/procplant-crown-mask-fit";
import {
  growProcPlantSpaceColonization,
  validateProcPlantFreeformCrown,
} from "../src/procplant-space-colonization";
import type { ProcPlantAlphaMask } from "../src/procplant-cutout";

const maskFromRows = (rows: readonly string[]): ProcPlantAlphaMask => ({
  width: rows[0]!.length,
  height: rows.length,
  alpha: Uint8Array.from(rows.flatMap((row) => [...row].map((pixel) => pixel === "#" ? 255 : 0))),
});

const crownMask = maskFromRows([
  "....##....",
  "..######..",
  ".########.",
  "##########",
  ".########.",
  "..######..",
  "...####...",
  "....##....",
]);
const untouched = Uint8Array.from(crownMask.alpha as Uint8Array);
const options = {
  threshold: 0.5,
  bands: 4,
  bounds: { center: [0, 2, 0], dimensions: [4, 3.2, 2.4] } as const,
};
const first = fitProcPlantCrownMask(crownMask, options);
const second = fitProcPlantCrownMask(crownMask, options);
assert.deepEqual(first, second, "crown mask fitting must be byte-stable for identical input");
assert.deepEqual(crownMask.alpha, untouched, "crown mask fitting must not mutate source alpha");
assert.equal(first.contract, PROCPLANT_CROWN_MASK_FIT_CONTRACT);
assert.equal(first.version, PROCPLANT_CROWN_MASK_FIT_VERSION);
assert.equal(first.audit.islandContours, 1);
assert.equal(first.audit.holeContours, 0);
assert.equal(first.audit.bandCount, 4);
assert.equal(first.audit.depthPolicy, "explicit-bounds-scaled-by-band-width");
assert.equal(first.bands.length, 4);
assert.equal(first.crown.volumes.length, 4);
assert.ok(first.audit.workUnits <= 2_000_000);
assert.match(first.source.hash, /^[0-9a-f]{8}$/);
validateProcPlantFreeformCrown(first.crown);
for (const [index, band] of first.bands.entries()) {
  assert.equal(first.crown.volumes[index]!.id, band.id);
  assert.deepEqual(first.crown.volumes[index]!.center, band.center);
  assert.deepEqual(first.crown.volumes[index]!.dimensions, band.radii);
  assert.ok(band.radii.every((radius) => Number.isFinite(radius) && radius > 0));
}
assert.notEqual(
  first.bands[0]!.radii[2],
  first.bands[1]!.radii[2],
  "explicit depth must be scaled by local silhouette width rather than presented as reconstructed depth",
);

const colonizationOptions = {
  seed: 91,
  attractorCount: 120,
  root: new THREE.Vector3(0, 0.1, 0),
  segmentLength: 0.22,
  influenceRadius: 1.1,
  killRadius: 0.25,
  maxSteps: 80,
  maxNodes: 420,
};
const fittedGrowth = growProcPlantSpaceColonization({ ...colonizationOptions, volume: first.crown });
const fittedGrowthAgain = growProcPlantSpaceColonization({ ...colonizationOptions, volume: second.crown });
assert.deepEqual(
  fittedGrowth.nodes.map((node) => node.position.toArray()),
  fittedGrowthAgain.nodes.map((node) => node.position.toArray()),
  "fitted crown constraints must drive deterministic space-colonized geometry",
);
assert.ok(fittedGrowth.nodes.length > 1);

const legacyVolume = {
  shape: "ellipsoid" as const,
  center: new THREE.Vector3(0, 2, 0),
  radii: new THREE.Vector3(2, 1.6, 1.2),
};
const legacyBefore = growProcPlantSpaceColonization({ ...colonizationOptions, volume: legacyVolume });
const legacyAfter = growProcPlantSpaceColonization({ ...colonizationOptions, volume: legacyVolume });
assert.deepEqual(
  legacyBefore.nodes.map((node) => [node.id, node.parentId, ...node.position.toArray(), node.radius]),
  legacyAfter.nodes.map((node) => [node.id, node.parentId, ...node.position.toArray(), node.radius]),
  "an absent mask fit must leave the exact legacy colonization path unchanged",
);

assert.throws(() => fitProcPlantCrownMask(maskFromRows(["#.#"]), options), /expected one connected silhouette/);
assert.throws(() => fitProcPlantCrownMask(maskFromRows(["#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#"]), options), /contour cap/);
assert.throws(() => fitProcPlantCrownMask(maskFromRows([
  "#####",
  "#...#",
  "#####",
]), options), /filled silhouette required/);
assert.throws(() => fitProcPlantCrownMask(maskFromRows(["..."]), options), /no foreground/);
assert.throws(() => fitProcPlantCrownMask({ width: 2, height: 2, alpha: Uint8Array.of(255) }, options), /alpha length/);
assert.throws(() => fitProcPlantCrownMask({ width: 1, height: 1, alpha: [NaN] }, options), /integer byte/);
assert.throws(() => fitProcPlantCrownMask(crownMask, { ...options, threshold: 1.1 }), /threshold/);
assert.throws(() => fitProcPlantCrownMask(crownMask, { ...options, bands: PROCPLANT_CROWN_MASK_MAX_BANDS + 1 }), /bands/);
assert.throws(() => fitProcPlantCrownMask({
  width: PROCPLANT_CROWN_MASK_MAX_DIMENSION + 1,
  height: 1,
  alpha: new Uint8Array(PROCPLANT_CROWN_MASK_MAX_DIMENSION + 1),
}, options), /width/);
assert.equal(PROCPLANT_CROWN_MASK_MAX_PIXELS, PROCPLANT_CROWN_MASK_MAX_DIMENSION ** 2);
const maximumMask = {
  width: PROCPLANT_CROWN_MASK_MAX_DIMENSION,
  height: PROCPLANT_CROWN_MASK_MAX_DIMENSION,
  alpha: new Uint8Array(PROCPLANT_CROWN_MASK_MAX_PIXELS).fill(255),
};
const maximumFit = fitProcPlantCrownMask(maximumMask, { ...options, bands: PROCPLANT_CROWN_MASK_MAX_BANDS });
assert.equal(maximumFit.source.foregroundPixels, PROCPLANT_CROWN_MASK_MAX_PIXELS);
assert.equal(maximumFit.bands.length, PROCPLANT_CROWN_MASK_MAX_BANDS);
assert.ok(maximumFit.audit.workUnits <= PROCPLANT_CROWN_MASK_MAX_WORK_UNITS);
assert.throws(() => fitProcPlantCrownMask(crownMask, {
  ...options,
  bounds: { center: [0, 0, 0], dimensions: [4, 0, 2] },
}), /spatial limits/);

console.log("procplant crown-mask fit tests passed");
