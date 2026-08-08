export const PROCPLANT_MESHOPT_CONTRACT = "procplants.meshopt-glb" as const;
export const PROCPLANT_MESHOPT_VERSION = 1 as const;
export const PROCPLANT_MESHOPT_EXTENSION = "EXT_meshopt_compression" as const;

export type ProcPlantMeshoptCompatibility = "required" | "fallback";

export interface ProcPlantMeshoptCompressionOptions {
  /** Required mode omits fallback bytes; fallback mode retains uncompressed core glTF data. */
  compatibility?: ProcPlantMeshoptCompatibility;
  /** Maximum accepted source GLB size. Defaults to 256 MiB. */
  maxInputBytes?: number;
  /** Maximum generated GLB size. Defaults to 512 MiB. */
  maxOutputBytes?: number;
  /** Maximum number of source buffer views inspected. Defaults to 4096. */
  maxBufferViews?: number;
}

export interface ProcPlantMeshoptStats {
  compatibility: ProcPlantMeshoptCompatibility;
  inputBytes: number;
  outputBytes: number;
  inputPayloadBytes: number;
  outputPayloadBytes: number;
  compressedBufferViews: number;
  passthroughBufferViews: number;
  attributeBufferViews: number;
  triangleBufferViews: number;
  exactGeometry: true;
  texturesCompressed: false;
}

export interface ProcPlantMeshoptGlb {
  contract: typeof PROCPLANT_MESHOPT_CONTRACT;
  version: typeof PROCPLANT_MESHOPT_VERSION;
  bytes: ArrayBuffer;
  stats: ProcPlantMeshoptStats;
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  sparse?: unknown;
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
  extensions?: Record<string, unknown>;
}

interface GltfPrimitive {
  attributes?: Record<string, number>;
  indices?: number;
  mode?: number;
  targets?: Array<Record<string, number>>;
}

interface GltfRoot {
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: Array<{ byteLength: number; uri?: string; extensions?: Record<string, unknown> }>;
  meshes?: Array<{ primitives?: GltfPrimitive[] }>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [key: string]: unknown;
}

interface ParsedGlb {
  json: GltfRoot;
  binary: Uint8Array;
}

interface CompressionCandidate {
  viewIndex: number;
  count: number;
  byteStride: number;
  mode: "ATTRIBUTES" | "TRIANGLES";
}

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

const assertIntegerRange = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
};

const parseGlb = (source: ArrayBuffer): ParsedGlb => {
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  if (bytes.length < 28 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new Error("meshopt compression requires a valid GLB 2.0 source");
  }
  if (view.getUint32(8, true) !== bytes.length) throw new Error("GLB header length does not match source bytes");
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== GLB_JSON_CHUNK || 20 + jsonLength + 8 > bytes.length) {
    throw new Error("GLB source is missing a valid JSON chunk");
  }
  const binaryHeader = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryHeader, true);
  if (view.getUint32(binaryHeader + 4, true) !== GLB_BIN_CHUNK || binaryHeader + 8 + binaryLength !== bytes.length) {
    throw new Error("GLB source must contain exactly one trailing BIN chunk");
  }
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd()) as GltfRoot;
  return {
    json,
    binary: bytes.slice(binaryHeader + 8, binaryHeader + 8 + binaryLength),
  };
};

const componentBytes = (componentType: number) => {
  if (componentType === 5120 || componentType === 5121) return 1;
  if (componentType === 5122 || componentType === 5123) return 2;
  if (componentType === 5125 || componentType === 5126) return 4;
  return 0;
};

const componentCount = (type: string) => {
  if (type === "SCALAR") return 1;
  if (type === "VEC2") return 2;
  if (type === "VEC3") return 3;
  if (type === "VEC4" || type === "MAT2") return 4;
  if (type === "MAT3") return 9;
  if (type === "MAT4") return 16;
  return 0;
};

const geometryAccessorUsage = (json: GltfRoot) => {
  const attributes = new Set<number>();
  const triangleIndices = new Set<number>();
  const nonTriangleIndices = new Set<number>();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const accessor of Object.values(primitive.attributes ?? {})) attributes.add(accessor);
      for (const target of primitive.targets ?? []) {
        for (const accessor of Object.values(target)) attributes.add(accessor);
      }
      if (primitive.indices !== undefined) {
        (primitive.mode === undefined || primitive.mode === 4 ? triangleIndices : nonTriangleIndices).add(primitive.indices);
      }
    }
  }
  return { attributes, triangleIndices, nonTriangleIndices };
};

const compressionCandidates = (json: GltfRoot) => {
  const accessors = json.accessors ?? [];
  const views = json.bufferViews ?? [];
  const usage = geometryAccessorUsage(json);
  const accessorsByView = new Map<number, number[]>();
  for (let index = 0; index < accessors.length; index++) {
    const viewIndex = accessors[index]?.bufferView;
    if (viewIndex === undefined) continue;
    const entries = accessorsByView.get(viewIndex) ?? [];
    entries.push(index);
    accessorsByView.set(viewIndex, entries);
  }
  const result = new Map<number, CompressionCandidate>();
  for (let viewIndex = 0; viewIndex < views.length; viewIndex++) {
    const view = views[viewIndex]!;
    const accessorIndexes = accessorsByView.get(viewIndex) ?? [];
    if (view.buffer !== 0 || view.byteLength < 64 || accessorIndexes.length === 0) continue;
    if (accessorIndexes.some((index) => accessors[index]?.sparse !== undefined)) continue;
    const allAttributes = accessorIndexes.every((index) => usage.attributes.has(index));
    const allTriangles = accessorIndexes.every((index) => usage.triangleIndices.has(index));
    if (!allAttributes && !allTriangles) continue;
    if (accessorIndexes.some((index) => usage.nonTriangleIndices.has(index))) continue;
    const first = accessors[accessorIndexes[0]!]!;
    if (!Number.isInteger(first.count) || first.count <= 0) continue;
    if (accessorIndexes.some((index) => accessors[index]!.count !== first.count)) continue;
    if (allTriangles) {
      const stride = componentBytes(first.componentType);
      if (accessorIndexes.length !== 1 || first.type !== "SCALAR" || (first.byteOffset ?? 0) !== 0) continue;
      if ((stride !== 2 && stride !== 4) || first.count % 3 !== 0 || view.byteLength !== first.count * stride) continue;
      result.set(viewIndex, { viewIndex, count: first.count, byteStride: stride, mode: "TRIANGLES" });
      continue;
    }
    const naturalStride = componentBytes(first.componentType) * componentCount(first.type);
    const stride = view.byteStride ?? naturalStride;
    if (stride <= 0 || stride > 256 || stride % 4 !== 0 || view.byteLength !== first.count * stride) continue;
    if (!view.byteStride && (accessorIndexes.length !== 1 || (first.byteOffset ?? 0) !== 0)) continue;
    result.set(viewIndex, { viewIndex, count: first.count, byteStride: stride, mode: "ATTRIBUTES" });
  }
  return result;
};

const align4 = (value: number) => (value + 3) & ~3;

const buildGlb = (json: GltfRoot, binary: Uint8Array) => {
  const encodedJson = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = align4(encodedJson.length);
  const binaryLength = align4(binary.length);
  const output = new Uint8Array(20 + jsonLength + 8 + binaryLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK, true);
  output.set(encodedJson, 20);
  output.fill(0x20, 20 + encodedJson.length, 20 + jsonLength);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, GLB_BIN_CHUNK, true);
  output.set(binary, binaryHeader + 8);
  return output.buffer;
};

/**
 * Losslessly compress geometry buffer views using ratified EXT_meshopt_compression.
 * This does not quantize geometry, reorder vertices, or compress textures.
 */
export const compressProcPlantGlbMeshopt = async (
  source: ArrayBuffer,
  options: ProcPlantMeshoptCompressionOptions = {},
): Promise<ProcPlantMeshoptGlb> => {
  const compatibility = options.compatibility ?? "required";
  if (compatibility !== "required" && compatibility !== "fallback") {
    throw new Error("meshopt compatibility must be required or fallback");
  }
  const maxInputBytes = assertIntegerRange(options.maxInputBytes ?? 256 * 1024 * 1024, 1024, 1024 * 1024 * 1024, "maxInputBytes");
  const maxOutputBytes = assertIntegerRange(options.maxOutputBytes ?? 512 * 1024 * 1024, 1024, 1024 * 1024 * 1024, "maxOutputBytes");
  const maxBufferViews = assertIntegerRange(options.maxBufferViews ?? 4096, 1, 65536, "maxBufferViews");
  if (source.byteLength > maxInputBytes) throw new Error(`meshopt source exceeds maxInputBytes (${source.byteLength} > ${maxInputBytes})`);
  const { json, binary } = parseGlb(source);
  if ((json.extensionsUsed ?? []).includes(PROCPLANT_MESHOPT_EXTENSION)) {
    throw new Error("GLB already declares EXT_meshopt_compression");
  }
  const buffers = json.buffers ?? [];
  const views = json.bufferViews ?? [];
  if (buffers.length !== 1 || buffers[0]?.uri) throw new Error("meshopt GLB compression requires one embedded source buffer");
  if (views.length > maxBufferViews) throw new Error(`meshopt source exceeds maxBufferViews (${views.length} > ${maxBufferViews})`);
  const sourcePayloadLength = buffers[0]!.byteLength;
  if (sourcePayloadLength > binary.length) throw new Error("GLB buffer byteLength exceeds its BIN chunk");
  const candidates = compressionCandidates(json);
  const { MeshoptEncoder } = await import("meshoptimizer/encoder");
  await MeshoptEncoder.ready;

  const chunks: Uint8Array[] = [];
  let outputLength = 0;
  const append = (bytes: Uint8Array) => {
    const aligned = align4(outputLength);
    if (aligned + bytes.length > maxOutputBytes) {
      throw new Error(`meshopt output exceeds maxOutputBytes (${aligned + bytes.length} > ${maxOutputBytes})`);
    }
    if (aligned > outputLength) chunks.push(new Uint8Array(aligned - outputLength));
    outputLength = aligned;
    const offset = outputLength;
    chunks.push(bytes);
    outputLength += bytes.length;
    return offset;
  };
  if (compatibility === "fallback") append(binary.subarray(0, sourcePayloadLength));

  let compressedBufferViews = 0;
  let attributeBufferViews = 0;
  let triangleBufferViews = 0;
  let compressedPayloadBytes = 0;
  for (let viewIndex = 0; viewIndex < views.length; viewIndex++) {
    const view = views[viewIndex]!;
    if (view.buffer !== 0) throw new Error(`bufferView ${viewIndex} references unsupported source buffer ${view.buffer}`);
    const byteOffset = view.byteOffset ?? 0;
    if (byteOffset < 0 || view.byteLength < 0 || byteOffset + view.byteLength > sourcePayloadLength) {
      throw new Error(`bufferView ${viewIndex} exceeds the source buffer`);
    }
    const original = binary.subarray(byteOffset, byteOffset + view.byteLength);
    const candidate = candidates.get(viewIndex);
    const compressed = candidate
      ? MeshoptEncoder.encodeGltfBuffer(original, candidate.count, candidate.byteStride, candidate.mode)
      : null;
    if (!candidate || !compressed || compressed.length >= original.length) {
      if (compatibility === "required") {
        view.buffer = 0;
        view.byteOffset = append(original);
      }
      continue;
    }
    const compressedOffset = append(compressed);
    view.extensions = {
      ...view.extensions,
      [PROCPLANT_MESHOPT_EXTENSION]: {
        buffer: 0,
        byteOffset: compressedOffset,
        byteLength: compressed.length,
        byteStride: candidate.byteStride,
        count: candidate.count,
        mode: candidate.mode,
      },
    };
    if (compatibility === "required") {
      view.buffer = 1;
      view.byteOffset = byteOffset;
    }
    compressedBufferViews++;
    compressedPayloadBytes += compressed.length;
    if (candidate.mode === "ATTRIBUTES") attributeBufferViews++;
    else triangleBufferViews++;
  }
  if (compressedBufferViews === 0) throw new Error("meshopt found no beneficial eligible geometry buffer views");

  const outputPayload = new Uint8Array(outputLength);
  let writeOffset = 0;
  for (const chunk of chunks) {
    outputPayload.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  json.buffers = compatibility === "required"
    ? [
        { byteLength: outputPayload.length },
        {
          byteLength: sourcePayloadLength,
          extensions: { [PROCPLANT_MESHOPT_EXTENSION]: { fallback: true } },
        },
      ]
    : [{ ...buffers[0]!, byteLength: outputPayload.length }];
  json.extensionsUsed = [...(json.extensionsUsed ?? []), PROCPLANT_MESHOPT_EXTENSION];
  if (compatibility === "required") {
    json.extensionsRequired = [...(json.extensionsRequired ?? []), PROCPLANT_MESHOPT_EXTENSION];
  }
  const bytes = buildGlb(json, outputPayload);
  if (bytes.byteLength > maxOutputBytes) {
    throw new Error(`meshopt output exceeds maxOutputBytes (${bytes.byteLength} > ${maxOutputBytes})`);
  }
  return {
    contract: PROCPLANT_MESHOPT_CONTRACT,
    version: PROCPLANT_MESHOPT_VERSION,
    bytes,
    stats: {
      compatibility,
      inputBytes: source.byteLength,
      outputBytes: bytes.byteLength,
      inputPayloadBytes: sourcePayloadLength,
      outputPayloadBytes: outputPayload.length,
      compressedBufferViews,
      passthroughBufferViews: views.length - compressedBufferViews,
      attributeBufferViews,
      triangleBufferViews,
      exactGeometry: true,
      texturesCompressed: false,
    },
  };
};
