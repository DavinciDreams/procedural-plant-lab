import assert from "node:assert/strict";
import {
  PROCPLANT_CROWN_VOXEL_MASK_UI_MAX_FILE_BYTES,
  materializeProcPlantCrownVoxelMaskUiInput,
} from "../src/procplant-crown-voxel-mask-ui-input";

const source = Uint8Array.of(0, 17, 255, 3, 5, 8, 13, 21);
const materialized = materializeProcPlantCrownVoxelMaskUiInput([2, 2, 2], source.subarray(0));
assert.deepEqual(materialized.dimensions, [2, 2, 2]);
assert.deepEqual(Array.from(materialized.occupancy), Array.from(source));
source[0] = 255;
assert.equal(materialized.occupancy[0], 0, "materialized UI occupancy must not alias the source bytes");

assert.throws(() => materializeProcPlantCrownVoxelMaskUiInput([2, 2, 2], Uint8Array.of(1)), /exactly 8 bytes/);
assert.throws(() => materializeProcPlantCrownVoxelMaskUiInput([0, 2, 2], new Uint8Array()), /width/);
assert.throws(() => materializeProcPlantCrownVoxelMaskUiInput([65, 1, 1], new Uint8Array(65)), /width/);
assert.throws(
  () => materializeProcPlantCrownVoxelMaskUiInput([64, 64, 64], new Uint8Array(PROCPLANT_CROWN_VOXEL_MASK_UI_MAX_FILE_BYTES + 1)),
  /file exceeds/,
);

console.log("procplant crown voxel-mask UI input tests passed");
