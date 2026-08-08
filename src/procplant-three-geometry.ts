import * as THREE from "three";
import type { ProcPlantTemplate } from "./procplants";
import {
  partitionProcPlantTemplateSurfaces,
  type ProcPlantSurfacePartition,
} from "./procplant-surface-partition";

export const PROCPLANT_THREE_GEOMETRY_CONTRACT = "procplants.three-geometry" as const;
export const PROCPLANT_THREE_GEOMETRY_VERSION = 1 as const;
export const PROCPLANT_THREE_UV0_ATTRIBUTE = "uv" as const;
export const PROCPLANT_THREE_AO_UV_ATTRIBUTE = "uv1" as const;
export const PROCPLANT_THREE_SWAY_ATTRIBUTE = "procplantSway" as const;
export const PROCPLANT_THREE_TINTABLE_ATTRIBUTE = "procplantTintable" as const;

export interface ProcPlantThreeGeometryOptions {
  /**
   * Borrow every template typed array instead of copying it. The caller retains
   * ownership and must not mutate or transfer those arrays during geometry use.
   * BufferGeometry.dispose() never detaches or disposes the borrowed CPU arrays.
   * Defaults to false so the geometry owns independent safe copies.
   */
  zeroCopy?: boolean;
  /** Generate an explicit vec4 tangent attribute for tangent-space normal maps. */
  tangents?: boolean;
}

export interface ProcPlantThreeGeometryAudit {
  readonly contract: typeof PROCPLANT_THREE_GEOMETRY_CONTRACT;
  readonly version: typeof PROCPLANT_THREE_GEOMETRY_VERSION;
  readonly attributeOwnership: "copied" | "borrowed";
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly triangleCount: number;
  readonly groupCount: number;
  readonly barkStemTriangles: number;
  readonly organTriangles: number;
  readonly tangents: boolean;
  readonly uv0Attribute: typeof PROCPLANT_THREE_UV0_ATTRIBUTE;
  readonly aoUvAttribute: typeof PROCPLANT_THREE_AO_UV_ATTRIBUTE;
  readonly aoTextureChannel: 1;
  readonly partitionHash: string;
  readonly sourceIndexHash: string;
}

export interface ProcPlantThreeGeometryResult {
  readonly geometry: THREE.BufferGeometry;
  readonly partition: ProcPlantSurfacePartition;
  readonly audit: ProcPlantThreeGeometryAudit;
}

const assertFinite = (values: ArrayLike<number>, label: string) => {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) throw new Error(`${label}[${index}] must be finite`);
  }
};

const copyOrBorrow = <T extends Float32Array | Uint8Array | Uint32Array>(values: T, zeroCopy: boolean): T =>
  (zeroCopy ? values : values.slice()) as T;

const normalizeTangents = (geometry: THREE.BufferGeometry) => {
  const normal = geometry.getAttribute("normal");
  const tangent = geometry.getAttribute("tangent");
  if (!normal || !tangent) throw new Error("Three geometry tangent generation did not produce required attributes");
  for (let vertex = 0; vertex < normal.count; vertex++) {
    let nx = normal.getX(vertex);
    let ny = normal.getY(vertex);
    let nz = normal.getZ(vertex);
    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength > 1e-20 && Number.isFinite(normalLength)) {
      nx /= normalLength;
      ny /= normalLength;
      nz /= normalLength;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }
    let tx = tangent.getX(vertex);
    let ty = tangent.getY(vertex);
    let tz = tangent.getZ(vertex);
    const projection = tx * nx + ty * ny + tz * nz;
    tx -= projection * nx;
    ty -= projection * ny;
    tz -= projection * nz;
    let tangentLength = Math.hypot(tx, ty, tz);
    if (!(tangentLength > 1e-20) || !Number.isFinite(tangentLength)) {
      if (Math.abs(nx) <= Math.abs(ny) && Math.abs(nx) <= Math.abs(nz)) {
        tx = 1 - nx * nx;
        ty = -nx * ny;
        tz = -nx * nz;
      } else if (Math.abs(ny) <= Math.abs(nz)) {
        tx = -ny * nx;
        ty = 1 - ny * ny;
        tz = -ny * nz;
      } else {
        tx = -nz * nx;
        ty = -nz * ny;
        tz = 1 - nz * nz;
      }
      tangentLength = Math.hypot(tx, ty, tz);
    }
    tx /= tangentLength;
    ty /= tangentLength;
    tz /= tangentLength;
    tangent.setXYZW(vertex, tx, ty, tz, tangent.getW(vertex) < 0 ? -1 : 1);
  }
  tangent.needsUpdate = true;
};

export const createProcPlantThreeGeometry = (
  template: ProcPlantTemplate,
  options: ProcPlantThreeGeometryOptions = {},
): ProcPlantThreeGeometryResult => {
  if (options.zeroCopy !== undefined && typeof options.zeroCopy !== "boolean") {
    throw new Error("Three geometry zeroCopy must be boolean");
  }
  if (options.tangents !== undefined && typeof options.tangents !== "boolean") {
    throw new Error("Three geometry tangents must be boolean");
  }
  const zeroCopy = options.zeroCopy ?? false;
  const includeTangents = options.tangents ?? false;
  const partition = partitionProcPlantTemplateSurfaces(template);
  const vertexCount = template.pos.length / 3;
  if (template.nrm.length !== template.pos.length) throw new Error("Three geometry normals must align with positions");
  if (template.uv0.length !== vertexCount * 2) throw new Error("Three geometry UV0 must contain one tuple per vertex");
  if (template.col.length !== template.pos.length) throw new Error("Three geometry colors must align with positions");
  if (template.sway.length !== vertexCount) throw new Error("Three geometry sway must contain one value per vertex");
  assertFinite(template.pos, "Three geometry position");
  assertFinite(template.nrm, "Three geometry normal");
  assertFinite(template.uv0, "Three geometry UV0");
  assertFinite(template.col, "Three geometry color");
  assertFinite(template.sway, "Three geometry sway");

  const position = copyOrBorrow(template.pos, zeroCopy);
  const normal = copyOrBorrow(template.nrm, zeroCopy);
  const uv0 = copyOrBorrow(template.uv0, zeroCopy);
  const color = copyOrBorrow(template.col, zeroCopy);
  const sway = copyOrBorrow(template.sway, zeroCopy);
  const tintable = copyOrBorrow(template.tintable, zeroCopy);
  const index = copyOrBorrow(template.idx, zeroCopy);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  const uvAttribute = new THREE.BufferAttribute(uv0, 2);
  geometry.setAttribute(PROCPLANT_THREE_UV0_ATTRIBUTE, uvAttribute);
  // Three r181 maps Texture.channel=1 to `uv1`. Reusing the BufferAttribute
  // itself avoids duplicate CPU storage and a duplicate WebGL attribute buffer.
  geometry.setAttribute(PROCPLANT_THREE_AO_UV_ATTRIBUTE, uvAttribute);
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.setAttribute(PROCPLANT_THREE_SWAY_ATTRIBUTE, new THREE.BufferAttribute(sway, 1));
  geometry.setAttribute(PROCPLANT_THREE_TINTABLE_ATTRIBUTE, new THREE.BufferAttribute(tintable, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  for (let range = 0; range < partition.rangeCount; range++) {
    geometry.addGroup(
      partition.rangeIndexStarts[range]!,
      partition.rangeIndexCounts[range]!,
      partition.rangeSurfaceIds[range]!,
    );
  }
  if (includeTangents) {
    geometry.computeTangents();
    normalizeTangents(geometry);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const audit: ProcPlantThreeGeometryAudit = Object.freeze({
    contract: PROCPLANT_THREE_GEOMETRY_CONTRACT,
    version: PROCPLANT_THREE_GEOMETRY_VERSION,
    attributeOwnership: zeroCopy ? "borrowed" : "copied",
    vertexCount,
    indexCount: template.idx.length,
    triangleCount: partition.triangleCount,
    groupCount: partition.rangeCount,
    barkStemTriangles: partition.barkStemTriangles,
    organTriangles: partition.organTriangles,
    tangents: includeTangents,
    uv0Attribute: PROCPLANT_THREE_UV0_ATTRIBUTE,
    aoUvAttribute: PROCPLANT_THREE_AO_UV_ATTRIBUTE,
    aoTextureChannel: 1,
    partitionHash: partition.contentHash,
    sourceIndexHash: partition.sourceIndexHash,
  });
  return Object.freeze({ geometry, partition, audit });
};
