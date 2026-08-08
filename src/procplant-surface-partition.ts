import type { ProcPlantTemplate } from "./procplants";

export const PROCPLANT_SURFACE_PARTITION_CONTRACT = "procplants.surface-partition" as const;
export const PROCPLANT_SURFACE_PARTITION_VERSION = 1 as const;

export const PROCPLANT_SURFACE_BARK_STEM = 0 as const;
export const PROCPLANT_SURFACE_ORGAN = 1 as const;
export type ProcPlantSurfaceId =
  | typeof PROCPLANT_SURFACE_BARK_STEM
  | typeof PROCPLANT_SURFACE_ORGAN;

/**
 * Compact draw ranges over the source template's unchanged index buffer.
 * Treat the packed arrays as immutable. Starts and counts are index-element units.
 */
export interface ProcPlantSurfacePartition {
  readonly contract: typeof PROCPLANT_SURFACE_PARTITION_CONTRACT;
  readonly version: typeof PROCPLANT_SURFACE_PARTITION_VERSION;
  readonly contentHash: string;
  readonly sourceIndexHash: string;
  readonly triangleCount: number;
  readonly indexCount: number;
  readonly rangeCount: number;
  readonly barkStemTriangles: number;
  readonly organTriangles: number;
  readonly rangeIndexStarts: Uint32Array;
  readonly rangeIndexCounts: Uint32Array;
  /** 0 = bark/stem material slot; 1 = organ material slot. */
  readonly rangeSurfaceIds: Uint8Array;
}

const createHash = () => {
  let hash = 0x811c9dc5;
  const byte = (value: number) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const uint32 = (value: number) => {
    byte(value);
    byte(value >>> 8);
    byte(value >>> 16);
    byte(value >>> 24);
  };
  const text = (value: string) => {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      byte(code);
      byte(code >>> 8);
    }
  };
  return {
    byte,
    uint32,
    text,
    digest: () => hash.toString(16).padStart(8, "0"),
  };
};

const hashSourceIndices = (indices: Uint32Array) => {
  const hash = createHash();
  hash.text("procplants.surface-partition.source-indices:v1");
  hash.uint32(indices.length);
  for (const index of indices) hash.uint32(index);
  return hash.digest();
};

export const partitionProcPlantTemplateSurfaces = (
  template: Pick<ProcPlantTemplate, "pos" | "tintable" | "idx">,
): ProcPlantSurfacePartition => {
  if (template.pos.length % 3 !== 0) throw new Error("surface partition positions must contain xyz tuples");
  const vertexCount = template.pos.length / 3;
  if (template.tintable.length !== vertexCount) {
    throw new Error("surface partition tintable flags must contain one value per vertex");
  }
  if (template.idx.length % 3 !== 0) throw new Error("surface partition indices must contain triangle tuples");

  const rangeStarts: number[] = [];
  const rangeCounts: number[] = [];
  const rangeSurfaces: number[] = [];
  let barkStemTriangles = 0;
  let organTriangles = 0;
  let activeSurface: ProcPlantSurfaceId | null = null;
  for (let triangle = 0; triangle < template.idx.length / 3; triangle++) {
    const indexOffset = triangle * 3;
    const a = template.idx[indexOffset]!;
    const b = template.idx[indexOffset + 1]!;
    const c = template.idx[indexOffset + 2]!;
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) {
      throw new Error(`surface partition triangle ${triangle} references a missing vertex`);
    }
    const flagA = template.tintable[a]!;
    const flagB = template.tintable[b]!;
    const flagC = template.tintable[c]!;
    if ((flagA !== 0 && flagA !== 1) || (flagB !== 0 && flagB !== 1) || (flagC !== 0 && flagC !== 1)) {
      throw new Error(`surface partition triangle ${triangle} has a tintable flag outside 0 or 1`);
    }
    if (flagA !== flagB || flagA !== flagC) {
      throw new Error(`surface partition triangle ${triangle} mixes tintable flags ${flagA}, ${flagB}, ${flagC}`);
    }
    const surface = flagA as ProcPlantSurfaceId;
    if (surface === PROCPLANT_SURFACE_BARK_STEM) barkStemTriangles++;
    else organTriangles++;
    if (surface !== activeSurface) {
      rangeStarts.push(indexOffset);
      rangeCounts.push(3);
      rangeSurfaces.push(surface);
      activeSurface = surface;
    } else {
      rangeCounts[rangeCounts.length - 1]! += 3;
    }
  }

  const rangeIndexStarts = new Uint32Array(rangeStarts);
  const rangeIndexCounts = new Uint32Array(rangeCounts);
  const rangeSurfaceIds = new Uint8Array(rangeSurfaces);
  const sourceIndexHash = hashSourceIndices(template.idx);
  const content = createHash();
  content.text(`${PROCPLANT_SURFACE_PARTITION_CONTRACT}:v${PROCPLANT_SURFACE_PARTITION_VERSION}`);
  content.text(sourceIndexHash);
  content.uint32(vertexCount);
  content.uint32(template.idx.length);
  content.uint32(rangeIndexStarts.length);
  content.uint32(barkStemTriangles);
  content.uint32(organTriangles);
  for (let range = 0; range < rangeIndexStarts.length; range++) {
    content.uint32(rangeIndexStarts[range]!);
    content.uint32(rangeIndexCounts[range]!);
    content.byte(rangeSurfaceIds[range]!);
  }

  return Object.freeze({
    contract: PROCPLANT_SURFACE_PARTITION_CONTRACT,
    version: PROCPLANT_SURFACE_PARTITION_VERSION,
    contentHash: content.digest(),
    sourceIndexHash,
    triangleCount: template.idx.length / 3,
    indexCount: template.idx.length,
    rangeCount: rangeIndexStarts.length,
    barkStemTriangles,
    organTriangles,
    rangeIndexStarts,
    rangeIndexCounts,
    rangeSurfaceIds,
  });
};
