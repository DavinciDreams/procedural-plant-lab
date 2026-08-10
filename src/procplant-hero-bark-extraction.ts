import type {
  ProcPlantHeroGlbImportPackage,
  ProcPlantHeroGlbMaterial,
  ProcPlantHeroGlbMeshPrimitive,
  ProcPlantHeroGlbTextureBinding,
} from "./procplant-hero-glb-import";
import type {
  ProcPlantHeroSpineAuthoringPackage,
  ProcPlantHeroSpineMeshSelector,
} from "./procplant-hero-spine-authoring";
import type { ProcPlantMaterialPixelSource } from "./procplant-material-bake";
import { encodeProcPlantImpostorPng } from "./procplant-impostor-image";

export const PROCPLANT_HERO_BARK_EXTRACTION_CONTRACT = "procplants.hero-bark-extraction" as const;
export const PROCPLANT_HERO_BARK_EXTRACTION_VERSION = 1 as const;

export const PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS = Object.freeze({
  textureSize: 2048,
  pixels: 4_194_304,
  sourceBytes: 64 * 1024 * 1024,
  triangles: 1_000_000,
  rasterWorkItems: 32_000_000,
  outputBytes: 128 * 1024 * 1024,
});

export interface ProcPlantHeroBarkDecodedRaster {
  /** Must identify an image from source.textures. */
  imageId: string;
  /** Must equal the imported image content hash. */
  contentHash: string;
  width: number;
  height: number;
  /** Row-major, top-left-origin RGBA8 pixels. Never mutated. */
  rgba: Uint8Array | Uint8ClampedArray;
}

export type ProcPlantHeroBarkSelection =
  | {
      kind: "uv-region";
      minU: number;
      minV: number;
      maxU: number;
      maxV: number;
    }
  | {
      kind: "spine-band";
      authored: ProcPlantHeroSpineAuthoringPackage;
      minT: number;
      maxT: number;
    };

export interface ProcPlantHeroBarkExtractionOptions {
  selector: ProcPlantHeroSpineMeshSelector;
  selection: ProcPlantHeroBarkSelection;
  /** Decoded imported base-color image. Omit to build a labeled procedural surrogate. */
  raster?: ProcPlantHeroBarkDecodedRaster;
  width?: number;
  height?: number;
  seamBlendPixels?: number;
  normalStrength?: number;
  minimumCoverage?: number;
  seed?: number;
  maxSourceBytes?: number;
  maxTriangles?: number;
  maxRasterWorkItems?: number;
  maxOutputBytes?: number;
}

export type ProcPlantHeroBarkResourceUsage = "baseColor" | "height" | "normal";

export interface ProcPlantHeroBarkResource {
  id: string;
  usage: ProcPlantHeroBarkResourceUsage;
  width: number;
  height: number;
  mimeType: "image/png";
  colorSpace: "srgb" | "linear";
  contentHash: string;
  rgba: Uint8Array;
  bytes: Uint8Array;
}

export interface ProcPlantHeroBarkExtractionAudit {
  sourceQuality: "derived-texture" | "procedural-surrogate";
  sourceContentHash: string;
  sourceImageContentHash: string | null;
  instanceId: string;
  materialIndex: number | null;
  selectionKind: ProcPlantHeroBarkSelection["kind"];
  candidateTriangles: number;
  selectedTriangles: number;
  rasterWorkItems: number;
  coveredPixels: number;
  coverage: number;
  seamBlendPixels: number;
  baseColorSeamDeltaBefore: number;
  baseColorSeamDeltaAfter: number;
  heightSeamDeltaAfter: number;
  normalSeamDeltaAfter: number;
  sourceArraysPreserved: true;
  outputArraysOwned: true;
  outputBytes: number;
  warnings: string[];
  unsupportedBoundaries: string[];
}

export interface ProcPlantHeroBarkExtractionPackage {
  contract: typeof PROCPLANT_HERO_BARK_EXTRACTION_CONTRACT;
  version: typeof PROCPLANT_HERO_BARK_EXTRACTION_VERSION;
  contentHash: string;
  ready: true;
  resources: readonly [ProcPlantHeroBarkResource, ProcPlantHeroBarkResource, ProcPlantHeroBarkResource];
  audit: ProcPlantHeroBarkExtractionAudit;
}

interface TriangleUv {
  id: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  u2: number;
  v2: number;
}

const integer = (value: number | undefined, fallback: number, minimum: number, maximum: number, label: string) => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return resolved;
};

const finite = (value: number | undefined, fallback: number, minimum: number, maximum: number, label: string) => {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be finite and in [${minimum}, ${maximum}]`);
  }
  return resolved;
};

const hashBytes = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const value of bytes) hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};

const hashParts = (parts: readonly Uint8Array[], metadata: unknown) => {
  let hash = 0x811c9dc5;
  const update = (value: number) => { hash = Math.imul(hash ^ value, 0x01000193) >>> 0; };
  for (const byte of new TextEncoder().encode(JSON.stringify(metadata))) update(byte);
  for (const part of parts) for (const byte of part) update(byte);
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};

const selectMesh = (source: ProcPlantHeroGlbImportPackage, selector: ProcPlantHeroSpineMeshSelector) => {
  if (source.contract !== "procplants.hero-glb-import" || source.version !== 1) {
    throw new Error("unsupported hero GLB import package");
  }
  if (source.inspection?.contract !== source.contract || source.inspection.version !== source.version ||
      typeof source.inspection.contentHash !== "string" || source.inspection.contentHash.length < 1 ||
      source.inspection.contentHash.length > 1024) {
    throw new Error("hero bark source inspection provenance is invalid");
  }
  if (!Array.isArray(source.meshes) || !Array.isArray(source.materials) || !Array.isArray(source.textures)) {
    throw new Error("hero bark source mesh, material, and texture collections must be arrays");
  }
  const matches = source.meshes.filter((mesh) => "instanceId" in selector
    ? mesh.instanceId === selector.instanceId
    : mesh.nodePath === selector.nodePath && mesh.meshIndex === selector.meshIndex && mesh.primitiveIndex === selector.primitiveIndex);
  if (matches.length === 0) throw new Error("hero bark selector did not match an imported primitive");
  if (matches.length > 1) throw new Error("hero bark selector is ambiguous");
  return matches[0]!;
};

const materialFor = (source: ProcPlantHeroGlbImportPackage, mesh: ProcPlantHeroGlbMeshPrimitive) => {
  if (mesh.materialIndex === null) return null;
  const material = source.materials.find((entry) => entry.materialIndex === mesh.materialIndex);
  if (!material) throw new Error(`hero bark primitive references missing material ${mesh.materialIndex}`);
  if (material.baseColorFactor.length !== 4 || material.baseColorFactor.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("hero bark material baseColorFactor must contain four finite normalized values");
  }
  return material;
};

const validateMesh = (mesh: ProcPlantHeroGlbMeshPrimitive, maxTriangles: number) => {
  const vertexCount = mesh.positions.length / 3;
  if (!Number.isInteger(vertexCount) || vertexCount < 3) throw new Error("hero bark mesh positions must contain complete xyz vertices");
  const indexCount = mesh.indices?.length ?? vertexCount;
  if (indexCount % 3 !== 0) throw new Error("hero bark mesh topology must contain complete triangles");
  const triangleCount = indexCount / 3;
  if (triangleCount > maxTriangles) throw new Error(`hero bark mesh exceeds maxTriangles (${triangleCount} > ${maxTriangles})`);
  if (!mesh.uv0 || mesh.uv0.length !== vertexCount * 2) throw new Error("hero bark extraction requires complete UV0 coordinates");
  for (let offset = 0; offset < mesh.positions.length; offset++) {
    if (!Number.isFinite(mesh.positions[offset])) throw new Error(`hero bark position ${offset} must be finite`);
  }
  for (let offset = 0; offset < mesh.uv0.length; offset++) {
    if (!Number.isFinite(mesh.uv0[offset])) throw new Error(`hero bark UV0 ${offset} must be finite`);
  }
  if (mesh.indices) for (let offset = 0; offset < mesh.indices.length; offset++) {
    const index = mesh.indices[offset]!;
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error(`hero bark index ${offset} is outside vertex count`);
    }
  }
  return { vertexCount, triangleCount };
};

const triangleIndex = (mesh: ProcPlantHeroGlbMeshPrimitive, index: number) => mesh.indices?.[index] ?? index;

const unwrapNear = (value: number, reference: number) => {
  let result = value;
  while (result - reference > 0.5) result -= 1;
  while (result - reference < -0.5) result += 1;
  return result;
};

const allTriangles = (mesh: ProcPlantHeroGlbMeshPrimitive): TriangleUv[] => {
  const uv = mesh.uv0!;
  const count = (mesh.indices?.length ?? mesh.positions.length / 3) / 3;
  return Array.from({ length: count }, (_, id) => {
    const a = triangleIndex(mesh, id * 3);
    const b = triangleIndex(mesh, id * 3 + 1);
    const c = triangleIndex(mesh, id * 3 + 2);
    return {
      id,
      u0: uv[a * 2]!,
      v0: uv[a * 2 + 1]!,
      u1: uv[b * 2]!,
      v1: uv[b * 2 + 1]!,
      u2: uv[c * 2]!,
      v2: uv[c * 2 + 1]!,
    };
  });
};

const intersects = (triangle: TriangleUv, minU: number, minV: number, maxU: number, maxV: number) =>
  Math.max(triangle.u0, triangle.u1, triangle.u2) > minU && Math.min(triangle.u0, triangle.u1, triangle.u2) < maxU &&
  Math.max(triangle.v0, triangle.v1, triangle.v2) > minV && Math.min(triangle.v0, triangle.v1, triangle.v2) < maxV;

const selectTriangles = (
  mesh: ProcPlantHeroGlbMeshPrimitive,
  selection: ProcPlantHeroBarkSelection,
  sourceContentHash: string,
): { triangles: TriangleUv[]; bounds: readonly [number, number, number, number] } => {
  const triangles = allTriangles(mesh);
  if (selection.kind === "uv-region") {
    const values = [selection.minU, selection.minV, selection.maxU, selection.maxV];
    if (values.some((value) => !Number.isFinite(value))) throw new Error("hero bark UV region must contain finite bounds");
    if (selection.maxU <= selection.minU || selection.maxV <= selection.minV ||
        selection.maxU - selection.minU > 64 || selection.maxV - selection.minV > 64) {
      throw new Error("hero bark UV region must have positive spans no greater than 64");
    }
    const selected = triangles.filter((triangle) => [-1, 0, 1].some((shift) => intersects({
      ...triangle,
      u0: triangle.u0 + shift,
      u1: triangle.u1 + shift,
      u2: triangle.u2 + shift,
    }, selection.minU, selection.minV, selection.maxU, selection.maxV)));
    return { triangles: selected, bounds: [selection.minU, selection.minV, selection.maxU, selection.maxV] };
  }
  const authored = selection.authored;
  if (authored.contract !== "procplants.hero-spine-authoring" || authored.version !== 1) {
    throw new Error("unsupported hero spine authoring package");
  }
  if (authored.provenance.instanceId !== mesh.instanceId ||
      authored.provenance.sourceContentHash !== sourceContentHash) {
    throw new Error("hero bark spine band provenance does not match the selected imported primitive");
  }
  if (!Number.isFinite(selection.minT) || !Number.isFinite(selection.maxT) ||
      selection.minT < 0 || selection.maxT > 1 || selection.maxT <= selection.minT) {
    throw new Error("hero bark spine band must satisfy 0 <= minT < maxT <= 1");
  }
  if (authored.binding.vertexCount !== mesh.positions.length / 3 ||
      authored.binding.spineT.length !== authored.binding.vertexCount || authored.binding.uv.length !== authored.binding.vertexCount * 2) {
    throw new Error("hero bark spine binding does not match selected mesh vertex topology");
  }
  const bandTriangles = triangles.filter((triangle) => {
    const a = triangleIndex(mesh, triangle.id * 3);
    const b = triangleIndex(mesh, triangle.id * 3 + 1);
    const c = triangleIndex(mesh, triangle.id * 3 + 2);
    const t = (authored.binding.spineT[a]! + authored.binding.spineT[b]! + authored.binding.spineT[c]!) / 3;
    return t >= selection.minT && t <= selection.maxT;
  }).map((triangle) => {
    const a = triangleIndex(mesh, triangle.id * 3);
    const b = triangleIndex(mesh, triangle.id * 3 + 1);
    const c = triangleIndex(mesh, triangle.id * 3 + 2);
    const uv = authored.binding.uv;
    const u0 = uv[a * 2]!;
    return {
      id: triangle.id,
      u0,
      v0: uv[a * 2 + 1]!,
      u1: unwrapNear(uv[b * 2]!, u0),
      v1: uv[b * 2 + 1]!,
      u2: unwrapNear(uv[c * 2]!, u0),
      v2: uv[c * 2 + 1]!,
    };
  });
  if (bandTriangles.length === 0) return { triangles: [], bounds: [0, 0, 1, 1] };
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const triangle of bandTriangles) {
    minU = Math.min(minU, triangle.u0, triangle.u1, triangle.u2);
    maxU = Math.max(maxU, triangle.u0, triangle.u1, triangle.u2);
    minV = Math.min(minV, triangle.v0, triangle.v1, triangle.v2);
    maxV = Math.max(maxV, triangle.v0, triangle.v1, triangle.v2);
  }
  if (maxU - minU <= 1e-8 || maxV - minV <= 1e-8 || maxU - minU > 64 || maxV - minV > 64) {
    throw new Error("hero bark spine band produced invalid or excessive UV bounds");
  }
  return { triangles: bandTriangles, bounds: [minU, minV, maxU, maxV] };
};

const validateRaster = (
  source: ProcPlantHeroGlbImportPackage,
  material: ProcPlantHeroGlbMaterial | null,
  raster: ProcPlantHeroBarkDecodedRaster,
  maxSourceBytes: number,
) => {
  if (!material?.baseColorTexture) throw new Error("hero bark texture extraction requires a bound base-color texture");
  const imported = source.textures.find((texture) => texture.id === raster.imageId);
  if (!imported) throw new Error("hero bark decoded raster does not identify an imported image");
  if (imported.mimeType !== "image/png") throw new Error(`hero bark V1 only accepts decoded imported PNG images, not ${imported.mimeType}`);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (imported.bytes.length < signature.length || signature.some((byte, index) => imported.bytes[index] !== byte)) {
    throw new Error("hero bark imported PNG image has an invalid signature");
  }
  if (imported.contentHash !== raster.contentHash) throw new Error("hero bark decoded raster content hash does not match imported image");
  if (material.baseColorTexture.imageIndex !== imported.imageIndex) {
    throw new Error("hero bark decoded raster is not the selected primitive material's base-color image");
  }
  const binding = material.baseColorTexture;
  if (binding.transform.offset.length !== 2 || binding.transform.scale.length !== 2 ||
      [...binding.transform.offset, ...binding.transform.scale, binding.transform.rotation].some((value) => !Number.isFinite(value)) ||
      binding.texCoord !== 0 || binding.transform.texCoord !== 0 ||
      ![33071, 33648, 10497].includes(binding.sampler.wrapS) || ![33071, 33648, 10497].includes(binding.sampler.wrapT)) {
    throw new Error("hero bark base-color texture transform or wrapping contract is invalid");
  }
  const width = integer(raster.width, 0, 1, PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS.textureSize, "hero bark source width");
  const height = integer(raster.height, 0, 1, PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS.textureSize, "hero bark source height");
  const expected = width * height * 4;
  if (!(raster.rgba instanceof Uint8Array || raster.rgba instanceof Uint8ClampedArray) ||
      !Number.isSafeInteger(expected) || raster.rgba.byteLength !== expected) {
    throw new Error("hero bark decoded raster must contain exactly width * height * 4 RGBA8 bytes");
  }
  if (expected > maxSourceBytes) throw new Error(`hero bark decoded raster exceeds maxSourceBytes (${expected} > ${maxSourceBytes})`);
  return { width, height, binding };
};

const wrap = (value: number, mode: ProcPlantHeroGlbTextureBinding["sampler"]["wrapS"]) => {
  if (mode === 33071) return Math.min(1, Math.max(0, value));
  if (mode === 33648) {
    const repeated = ((value % 2) + 2) % 2;
    return repeated <= 1 ? repeated : 2 - repeated;
  }
  return value - Math.floor(value);
};

const transformedUv = (u: number, v: number, binding: ProcPlantHeroGlbTextureBinding) => {
  const scaledU = u * binding.transform.scale[0];
  const scaledV = v * binding.transform.scale[1];
  const cosine = Math.cos(binding.transform.rotation);
  const sine = Math.sin(binding.transform.rotation);
  return [
    wrap(binding.transform.offset[0] + cosine * scaledU - sine * scaledV, binding.sampler.wrapS),
    wrap(binding.transform.offset[1] + sine * scaledU + cosine * scaledV, binding.sampler.wrapT),
  ] as const;
};

const sampleNearest = (
  raster: ProcPlantHeroBarkDecodedRaster,
  binding: ProcPlantHeroGlbTextureBinding,
  u: number,
  v: number,
) => {
  const [wrappedU, wrappedV] = transformedUv(u, v, binding);
  const x = Math.min(raster.width - 1, Math.max(0, Math.round(wrappedU * (raster.width - 1))));
  const y = Math.min(raster.height - 1, Math.max(0, Math.round((1 - wrappedV) * (raster.height - 1))));
  return (y * raster.width + x) * 4;
};

const rasterizeCoverage = (
  triangles: readonly TriangleUv[],
  bounds: readonly [number, number, number, number],
  width: number,
  height: number,
  maxWorkItems: number,
) => {
  const coverage = new Uint8Array(width * height);
  let work = 0;
  const [minU, minV, maxU, maxV] = bounds;
  const scaleU = width / (maxU - minU);
  const scaleV = height / (maxV - minV);
  for (const triangle of triangles) {
    const variants = [-1, 0, 1].map((shift) => ({
      ...triangle,
      u0: triangle.u0 + shift,
      u1: triangle.u1 + shift,
      u2: triangle.u2 + shift,
    })).filter((candidate) => intersects(candidate, minU, minV, maxU, maxV));
    for (const candidate of variants) {
      const ax = (candidate.u0 - minU) * scaleU;
      const ay = (candidate.v0 - minV) * scaleV;
      const bx = (candidate.u1 - minU) * scaleU;
      const by = (candidate.v1 - minV) * scaleV;
      const cx = (candidate.u2 - minU) * scaleU;
      const cy = (candidate.v2 - minV) * scaleV;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
      const boxWork = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
      if (!Number.isSafeInteger(work + boxWork) || work + boxWork > maxWorkItems) {
        throw new Error(`hero bark rasterization exceeds maxRasterWorkItems (${work + boxWork} > ${maxWorkItems})`);
      }
      work += boxWork;
      const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(denominator) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
        const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
        const wc = 1 - wa - wb;
        if (wa >= -1e-8 && wb >= -1e-8 && wc >= -1e-8) coverage[y * width + x] = 1;
      }
    }
  }
  let covered = 0;
  for (const value of coverage) covered += value;
  return { coverage, covered, work };
};

const mix32 = (value: number) => {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b);
  return (result ^ (result >>> 16)) >>> 0;
};

const synthesize = (width: number, height: number, color: readonly number[], seed: number) => {
  const output = new Uint8Array(width * height * 4);
  const phase = mix32(seed) / 0xffffffff * Math.PI * 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / Math.max(1, width - 1);
    const v = y / Math.max(1, height - 1);
    const vertical = Math.sin(Math.PI * 2 * (u * 7 + 0.12 * Math.sin(Math.PI * 2 * v * 3 + phase)) + phase);
    const fissure = Math.abs(Math.sin(Math.PI * 2 * (u * 13 - v * 2) + phase * 0.7));
    const ridge = 0.68 + vertical * 0.12 - (fissure > 0.88 ? 0.28 : 0) + 0.05 * Math.cos(Math.PI * 2 * v * 5);
    const offset = (y * width + x) * 4;
    output[offset] = Math.round(Math.min(255, Math.max(0, color[0]! * 255 * ridge)));
    output[offset + 1] = Math.round(Math.min(255, Math.max(0, color[1]! * 255 * ridge)));
    output[offset + 2] = Math.round(Math.min(255, Math.max(0, color[2]! * 255 * ridge)));
    output[offset + 3] = 255;
  }
  return output;
};

const enforceTileSeam = (rgba: Uint8Array, width: number, height: number, seam: number) => {
  for (let distance = 0; distance < seam; distance++) {
    const left = distance;
    const right = width - 1 - distance;
    for (let y = 0; y < height; y++) for (let channel = 0; channel < 4; channel++) {
      const a = (y * width + left) * 4 + channel;
      const b = (y * width + right) * 4 + channel;
      const average = Math.round((rgba[a]! + rgba[b]!) / 2);
      rgba[a] = average;
      rgba[b] = average;
    }
    const top = distance;
    const bottom = height - 1 - distance;
    for (let x = 0; x < width; x++) for (let channel = 0; channel < 4; channel++) {
      const a = (top * width + x) * 4 + channel;
      const b = (bottom * width + x) * 4 + channel;
      const average = Math.round((rgba[a]! + rgba[b]!) / 2);
      rgba[a] = average;
      rgba[b] = average;
    }
  }
};

const seamDelta = (rgba: Uint8Array, width: number, height: number) => {
  let maximum = 0;
  for (let y = 0; y < height; y++) for (let channel = 0; channel < 4; channel++) {
    maximum = Math.max(maximum, Math.abs(rgba[(y * width) * 4 + channel]! - rgba[(y * width + width - 1) * 4 + channel]!));
  }
  for (let x = 0; x < width; x++) for (let channel = 0; channel < 4; channel++) {
    maximum = Math.max(maximum, Math.abs(rgba[x * 4 + channel]! - rgba[((height - 1) * width + x) * 4 + channel]!));
  }
  return maximum;
};

const heightFromBase = (base: Uint8Array, width: number, height: number) => {
  const output = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    const luminance = Math.round((77 * base[offset]! + 150 * base[offset + 1]! + 29 * base[offset + 2]!) / 256);
    output.set([luminance, luminance, luminance, 255], offset);
  }
  return output;
};

const normalFromHeight = (heightMap: Uint8Array, width: number, height: number, strength: number) => {
  const output = new Uint8Array(width * height * 4);
  const heightAt = (x: number, y: number) => heightMap[(((y + height) % height) * width + ((x + width) % width)) * 4]! / 255;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength;
    const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength;
    const length = Math.hypot(dx, dy, 1);
    const offset = (y * width + x) * 4;
    output.set([
      Math.round((-dx / length * 0.5 + 0.5) * 255),
      Math.round((-dy / length * 0.5 + 0.5) * 255),
      Math.round((1 / length * 0.5 + 0.5) * 255),
      255,
    ], offset);
  }
  return output;
};

const resource = (
  id: string,
  usage: ProcPlantHeroBarkResourceUsage,
  colorSpace: "srgb" | "linear",
  rgba: Uint8Array,
  width: number,
  height: number,
): ProcPlantHeroBarkResource => {
  const bytes = encodeProcPlantImpostorPng(rgba, width, height);
  return { id, usage, width, height, mimeType: "image/png", colorSpace, contentHash: hashBytes(bytes), rgba, bytes };
};

/**
 * Derive a repeatable bark resource set from a bounded imported-mesh UV region or
 * authored spine band. This is texture processing, not scan reconstruction: the
 * caller must explicitly supply decoded bytes for a real imported PNG, otherwise
 * the result is labeled as a procedural surrogate.
 */
export const extractProcPlantHeroBark = (
  source: ProcPlantHeroGlbImportPackage,
  options: ProcPlantHeroBarkExtractionOptions,
): ProcPlantHeroBarkExtractionPackage => {
  const width = integer(options.width, 256, 8, PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS.textureSize, "hero bark width");
  const height = integer(options.height, 256, 8, PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS.textureSize, "hero bark height");
  if (width * height > PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS.pixels) throw new Error("hero bark output exceeds pixel hard cap");
  const seam = integer(options.seamBlendPixels, 4, 1, Math.min(64, Math.floor(Math.min(width, height) / 2)), "hero bark seamBlendPixels");
  const normalStrength = finite(options.normalStrength, 3, 0.01, 64, "hero bark normalStrength");
  const minimumCoverage = finite(options.minimumCoverage, 0.15, 0.001, 1, "hero bark minimumCoverage");
  const maxSourceBytes = integer(options.maxSourceBytes, 32 * 1024 * 1024, 4, PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS.sourceBytes, "hero bark maxSourceBytes");
  const maxTriangles = integer(options.maxTriangles, 250_000, 1, PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS.triangles, "hero bark maxTriangles");
  const maxRasterWorkItems = integer(options.maxRasterWorkItems, 8_000_000, 1, PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS.rasterWorkItems, "hero bark maxRasterWorkItems");
  const maxOutputBytes = integer(options.maxOutputBytes, 64 * 1024 * 1024, 1, PROCPLANT_HERO_BARK_EXTRACTION_HARD_CAPS.outputBytes, "hero bark maxOutputBytes");
  const seed = integer(options.seed, 0x5eedb4a7, 0, 0xffffffff, "hero bark seed");
  const mesh = selectMesh(source, options.selector);
  const topology = validateMesh(mesh, maxTriangles);
  const material = materialFor(source, mesh);
  const { triangles, bounds } = selectTriangles(mesh, options.selection, source.inspection.contentHash);
  if (triangles.length === 0) throw new Error("hero bark selection contains no supported triangles");
  const coverage = rasterizeCoverage(triangles, bounds, width, height, maxRasterWorkItems);
  const coverageRatio = coverage.covered / (width * height);
  if (coverageRatio < minimumCoverage) {
    throw new Error(`hero bark selection coverage ${coverageRatio.toFixed(6)} is below minimumCoverage ${minimumCoverage}`);
  }
  let baseColor: Uint8Array;
  let sourceImageContentHash: string | null = null;
  if (options.raster) {
    const validated = validateRaster(source, material, options.raster, maxSourceBytes);
    sourceImageContentHash = options.raster.contentHash;
    baseColor = new Uint8Array(width * height * 4);
    const [minU, minV, maxU, maxV] = bounds;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = minU + (x / Math.max(1, width - 1)) * (maxU - minU);
      const v = minV + (y / Math.max(1, height - 1)) * (maxV - minV);
      const sourceOffset = sampleNearest(options.raster, validated.binding, u, v);
      const targetOffset = (y * width + x) * 4;
      baseColor.set(options.raster.rgba.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  } else {
    baseColor = synthesize(width, height, material?.baseColorFactor ?? [0.32, 0.2, 0.11, 1], seed ^ topology.vertexCount ^ triangles.length);
  }
  const baseColorSeamDeltaBefore = seamDelta(baseColor, width, height);
  enforceTileSeam(baseColor, width, height, seam);
  const heightMap = heightFromBase(baseColor, width, height);
  enforceTileSeam(heightMap, width, height, seam);
  const normalMap = normalFromHeight(heightMap, width, height, normalStrength);
  enforceTileSeam(normalMap, width, height, seam);
  const resourcePrefix = `hero-bark-${hashParts([], {
    source: source.inspection.contentHash,
    image: sourceImageContentHash,
    instanceId: mesh.instanceId,
    selection: options.selection.kind,
    bounds,
    width,
    height,
    seam,
    normalStrength,
    seed,
  }).replace(":", "-")}`;
  const resources = [
    resource(`${resourcePrefix}-base-color`, "baseColor", "srgb", baseColor, width, height),
    resource(`${resourcePrefix}-height`, "height", "linear", heightMap, width, height),
    resource(`${resourcePrefix}-normal`, "normal", "linear", normalMap, width, height),
  ] as const;
  const outputBytes = resources.reduce((sum, entry) => sum + entry.rgba.byteLength + entry.bytes.byteLength, 0);
  if (!Number.isSafeInteger(outputBytes) || outputBytes > maxOutputBytes) {
    throw new Error(`hero bark output exceeds maxOutputBytes (${outputBytes} > ${maxOutputBytes})`);
  }
  const audit: ProcPlantHeroBarkExtractionAudit = {
    sourceQuality: options.raster ? "derived-texture" : "procedural-surrogate",
    sourceContentHash: source.inspection.contentHash,
    sourceImageContentHash,
    instanceId: mesh.instanceId,
    materialIndex: mesh.materialIndex,
    selectionKind: options.selection.kind,
    candidateTriangles: topology.triangleCount,
    selectedTriangles: triangles.length,
    rasterWorkItems: coverage.work,
    coveredPixels: coverage.covered,
    coverage: Number(coverageRatio.toFixed(8)),
    seamBlendPixels: seam,
    baseColorSeamDeltaBefore,
    baseColorSeamDeltaAfter: seamDelta(baseColor, width, height),
    heightSeamDeltaAfter: seamDelta(heightMap, width, height),
    normalSeamDeltaAfter: seamDelta(normalMap, width, height),
    sourceArraysPreserved: true,
    outputArraysOwned: true,
    outputBytes,
    warnings: options.raster
      ? ["derived from decoded imported color pixels; height and normal are luminance-derived, not measured geometry"]
      : ["no decoded imported color pixels supplied; output is a procedural surrogate, not a scan extraction"],
    unsupportedBoundaries: [
      "V1 does not decode PNG, JPEG, WebP, or KTX2; callers must supply decoded RGBA tied to an imported PNG hash",
      "V1 derives height from color luminance and does not reconstruct metric displacement or photogrammetry detail",
      "V1 treats one primitive and one base-color binding; material-layer blending and cross-junction continuity are unsupported",
    ],
  };
  return {
    contract: PROCPLANT_HERO_BARK_EXTRACTION_CONTRACT,
    version: PROCPLANT_HERO_BARK_EXTRACTION_VERSION,
    contentHash: hashParts(resources.map((entry) => entry.bytes), audit),
    ready: true,
    resources,
    audit,
  };
};

/** Reuse base-color and normal pixels as explicit material-graph texture sources. */
export const createProcPlantHeroBarkMaterialPixelSources = (
  extracted: ProcPlantHeroBarkExtractionPackage,
): readonly [ProcPlantMaterialPixelSource, ProcPlantMaterialPixelSource] => {
  if (extracted.contract !== PROCPLANT_HERO_BARK_EXTRACTION_CONTRACT ||
      extracted.version !== PROCPLANT_HERO_BARK_EXTRACTION_VERSION || !extracted.ready) {
    throw new Error("unsupported hero bark extraction package");
  }
  const base = extracted.resources.find((entry) => entry.usage === "baseColor");
  const normal = extracted.resources.find((entry) => entry.usage === "normal");
  if (!base || !normal) throw new Error("hero bark extraction package lacks base-color or normal resources");
  return [
    { textureId: base.id, width: base.width, height: base.height, rgba: new Uint8Array(base.rgba) },
    { textureId: normal.id, width: normal.width, height: normal.height, rgba: new Uint8Array(normal.rgba) },
  ];
};
