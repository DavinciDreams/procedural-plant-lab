import {
  PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_VOXELS,
  type ProcPlantCrownVoxelMask,
} from "./procplant-crown-voxel-mask-fit";

export const PROCPLANT_CROWN_VOXEL_MASK_UI_MAX_FILE_BYTES = PROCPLANT_CROWN_VOXEL_MASK_MAX_VOXELS;

const boundedDimension = (value: number, axis: string) => {
  if (!Number.isInteger(value) || value < 1 || value > PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION) {
    throw new Error(`crown voxel-mask ${axis} must be an integer in [1, ${PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION}]`);
  }
  return value;
};

/**
 * Materializes the browser editor's raw x-fastest occupancy input. The copy
 * keeps later File/ArrayBuffer changes from altering an audited preview.
 */
export const materializeProcPlantCrownVoxelMaskUiInput = (
  dimensions: readonly [number, number, number],
  source: ArrayBuffer | ArrayBufferView,
): ProcPlantCrownVoxelMask => {
  const normalized: [number, number, number] = [
    boundedDimension(dimensions[0], "width"),
    boundedDimension(dimensions[1], "height"),
    boundedDimension(dimensions[2], "depth"),
  ];
  const voxelCount = normalized[0] * normalized[1] * normalized[2];
  if (voxelCount > PROCPLANT_CROWN_VOXEL_MASK_MAX_VOXELS) {
    throw new Error(`crown voxel-mask dimensions exceed the ${PROCPLANT_CROWN_VOXEL_MASK_MAX_VOXELS.toLocaleString()} voxel cap`);
  }
  const bytes = source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (bytes.byteLength > PROCPLANT_CROWN_VOXEL_MASK_UI_MAX_FILE_BYTES) {
    throw new Error(`crown voxel-mask file exceeds the ${PROCPLANT_CROWN_VOXEL_MASK_UI_MAX_FILE_BYTES.toLocaleString()} byte authoring cap`);
  }
  if (bytes.byteLength !== voxelCount) {
    throw new Error(`crown voxel-mask file must contain exactly ${voxelCount.toLocaleString()} bytes for the explicit dimensions`);
  }
  return { dimensions: normalized, occupancy: Uint8Array.from(bytes) };
};
