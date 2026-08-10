import assert from "node:assert/strict";
import * as THREE from "three";
import {
  fitProcPlantCrownVoxelMask,
  PROCPLANT_CROWN_VOXEL_MASK_FIT_CONTRACT,
  PROCPLANT_CROWN_VOXEL_MASK_FIT_VERSION,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_COMPONENTS,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_CONTOURS,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_LOBES,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_VOXELS,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_WORK_UNITS,
  type ProcPlantCrownVoxelMask,
} from "../src/procplant-crown-voxel-mask-fit";
import { fitProcPlantCrownMask } from "../src/procplant-crown-mask-fit";
import {
  growProcPlantSpaceColonization,
  PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
  PROCPLANT_FREEFORM_CROWN_VERSION,
  validateProcPlantFreeformCrown,
} from "../src/procplant-space-colonization";

const voxelMask = (
  dimensions: readonly [number, number, number],
  occupied: (x: number, y: number, z: number) => boolean,
): ProcPlantCrownVoxelMask => {
  const [width, height, depth] = dimensions;
  const occupancy = new Uint8Array(width * height * depth);
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        occupancy[x + width * (z + depth * y)] = occupied(x, y, z) ? 255 : 0;
      }
    }
  }
  return { dimensions, occupancy };
};

const filled = voxelMask([4, 8, 4], () => true);
const filledBefore = Uint8Array.from(filled.occupancy as Uint8Array);
const options = {
  center: [1, 4, -2] as const,
  voxelSize: [0.5, 1, 0.25] as const,
  threshold: 0.5,
  lobes: 4,
};
const first = fitProcPlantCrownVoxelMask(filled, options);
const second = fitProcPlantCrownVoxelMask(filled, options);
assert.deepEqual(first, second, "voxel-mask fitting must be byte-stable for identical inputs");
assert.deepEqual(filled.occupancy, filledBefore, "voxel-mask fitting must not mutate source occupancy");
assert.equal(first.contract, PROCPLANT_CROWN_VOXEL_MASK_FIT_CONTRACT);
assert.equal(first.version, PROCPLANT_CROWN_VOXEL_MASK_FIT_VERSION);
assert.equal(first.crown.version, PROCPLANT_FREEFORM_CROWN_VERSION);
assert.equal(first.audit.connectedComponents, 1);
assert.equal(first.audit.cavityComponents, 0);
assert.equal(first.audit.sliceContours, 8);
assert.equal(first.audit.maximumSliceContours, 1);
assert.equal(first.audit.lobeCount, 4);
assert.equal(first.audit.constraint, "lobes");
assert.equal(first.audit.ordering, "x-fastest-then-z-then-y");
assert.equal(first.source.foregroundVoxels, 128);
assert.deepEqual(first.source.occupiedBounds, { minimum: [0, 0, 0], maximum: [3, 7, 3] });
assert.match(first.source.hash, /^[0-9a-f]{8}$/);
assert.ok(first.audit.workUnits <= PROCPLANT_CROWN_VOXEL_MASK_MAX_WORK_UNITS);
assert.equal(first.lobes.length, 4);
assert.deepEqual(first.lobes[0]!.center, [1, 1, -2]);
assert.deepEqual(first.lobes[0]!.radii, [1, 1.12, 0.5]);
assert.equal(first.lobes[0]!.fillRatio, 1);
validateProcPlantFreeformCrown(first.crown);

const spline = fitProcPlantCrownVoxelMask(filled, { ...options, constraint: "spline" });
assert.equal(spline.crown.version, PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION);
if (spline.crown.version !== PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION) throw new Error("expected spline crown");
assert.equal(spline.crown.volumes.length, 0);
assert.equal(spline.crown.splines.length, 1);
assert.equal(spline.crown.splines[0]!.points.length, 4);
validateProcPlantFreeformCrown(spline.crown);

const growthOptions = {
  seed: 405,
  attractorCount: 96,
  root: new THREE.Vector3(1, 0, -2),
  segmentLength: 0.25,
  influenceRadius: 1.1,
  killRadius: 0.2,
  maxSteps: 64,
  maxNodes: 300,
};
const growth = growProcPlantSpaceColonization({ ...growthOptions, volume: first.crown });
const growthAgain = growProcPlantSpaceColonization({ ...growthOptions, volume: second.crown });
assert.deepEqual(
  growth.nodes.map((node) => [node.id, node.parentId, ...node.position.toArray(), node.radius]),
  growthAgain.nodes.map((node) => [node.id, node.parentId, ...node.position.toArray(), node.radius]),
  "voxel-fitted constructive constraints must drive deterministic growth",
);
assert.ok(growth.nodes.length > 1);

const legacyMask = {
  width: 2,
  height: 2,
  alpha: Uint8Array.of(255, 255, 255, 255),
};
const legacyOptions = { bounds: { center: [0, 1, 0], dimensions: [2, 2, 1] } as const, bands: 2 };
const legacyBefore = JSON.stringify(fitProcPlantCrownMask(legacyMask, legacyOptions));
fitProcPlantCrownVoxelMask(filled, options);
const legacyAfter = JSON.stringify(fitProcPlantCrownMask(legacyMask, legacyOptions));
assert.equal(legacyAfter, legacyBefore, "unused voxel fitting must not alter exact legacy crown-mask output bytes");

const disconnected = voxelMask([3, 1, 1], (x) => x !== 1);
assert.throws(() => fitProcPlantCrownVoxelMask(disconnected, options), /disconnected/);

const tooManyComponents = voxelMask([PROCPLANT_CROWN_VOXEL_MASK_MAX_COMPONENTS * 2 + 1, 1, 1], (x) => x % 2 === 0);
assert.throws(() => fitProcPlantCrownVoxelMask(tooManyComponents, options), /connected-component cap/);

const shell = voxelMask([3, 3, 3], (x, y, z) => x !== 1 || y !== 1 || z !== 1);
assert.throws(() => fitProcPlantCrownVoxelMask(shell, options), /filled volume required/);

const branching = voxelMask([3, 2, 1], (x, y) => y === 0 || x !== 1);
const branchingLobes = fitProcPlantCrownVoxelMask(branching, { ...options, lobes: 2 });
assert.equal(branchingLobes.audit.maximumSliceContours, 2);
assert.throws(
  () => fitProcPlantCrownVoxelMask(branching, { ...options, lobes: 2, constraint: "spline" }),
  /ambiguous for a single spline/,
);

const tooManyContours = voxelMask([32, 2, 32], (x, y, z) => y === 0 || (x % 2 === 0 && z % 2 === 0));
assert.throws(() => fitProcPlantCrownVoxelMask(tooManyContours, options), /slice-contour cap/);
assert.ok(PROCPLANT_CROWN_VOXEL_MASK_MAX_CONTOURS < 256);

assert.throws(() => fitProcPlantCrownVoxelMask(voxelMask([1, 1, 1], () => false), options), /no occupied voxels/);
assert.throws(() => fitProcPlantCrownVoxelMask({ dimensions: [2, 2, 2], occupancy: Uint8Array.of(255) }, options), /occupancy length/);
assert.throws(() => fitProcPlantCrownVoxelMask({ dimensions: [1, 1, 1], occupancy: [NaN] }, options), /integer byte/);
assert.throws(() => fitProcPlantCrownVoxelMask(filled, { ...options, threshold: 1.1 }), /threshold/);
assert.throws(() => fitProcPlantCrownVoxelMask(filled, { ...options, lobes: PROCPLANT_CROWN_VOXEL_MASK_MAX_LOBES + 1 }), /lobes/);
assert.throws(() => fitProcPlantCrownVoxelMask(filled, { ...options, voxelSize: [0.5, 0, 0.25] }), /voxelSize/);
assert.throws(() => fitProcPlantCrownVoxelMask(filled, { ...options, center: [Infinity, 0, 0] }), /center/);
assert.throws(() => fitProcPlantCrownVoxelMask(filled, { ...options, center: [999_999.5, 0, 0] }), /transformed world bounds/);
assert.throws(() => fitProcPlantCrownVoxelMask(
  { dimensions: [PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION + 1, 1, 1], occupancy: new Uint8Array(PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION + 1) },
  options,
), /width/);

assert.equal(PROCPLANT_CROWN_VOXEL_MASK_MAX_VOXELS, PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION ** 3);
const maximumMask = voxelMask([
  PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION,
], () => true);
const maximumFit = fitProcPlantCrownVoxelMask(maximumMask, {
  center: [0, 32, 0],
  voxelSize: [0.25, 0.25, 0.25],
  lobes: PROCPLANT_CROWN_VOXEL_MASK_MAX_LOBES,
});
assert.equal(maximumFit.source.foregroundVoxels, PROCPLANT_CROWN_VOXEL_MASK_MAX_VOXELS);
assert.equal(maximumFit.lobes.length, PROCPLANT_CROWN_VOXEL_MASK_MAX_LOBES);
assert.ok(maximumFit.audit.workUnits <= PROCPLANT_CROWN_VOXEL_MASK_MAX_WORK_UNITS);

console.log("procplant crown voxel-mask fit tests passed");
