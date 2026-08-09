export const PROCPLANT_HERO_GLB_IMPORT_CONTRACT = "procplants.hero-glb-import" as const;
export const PROCPLANT_HERO_GLB_IMPORT_VERSION = 1 as const;

export interface ProcPlantHeroGlbImportLimits {
  maxBytes?: number;
  maxJsonBytes?: number;
  maxBinaryBytes?: number;
  maxScenes?: number;
  maxNodes?: number;
  maxMeshes?: number;
  maxPrimitives?: number;
  maxAccessors?: number;
  maxBufferViews?: number;
  maxImages?: number;
  maxMaterials?: number;
  maxTextures?: number;
  maxSamplers?: number;
  maxImageBytes?: number;
  maxTotalImageBytes?: number;
  maxVertices?: number;
  maxIndices?: number;
  maxDecodedAttributeBytes?: number;
}

export interface ProcPlantHeroGlbMeshExtractionOptions extends ProcPlantHeroGlbImportLimits {
  /** Bake each static node instance's world transform into positions and normals. */
  bakeNodeTransforms?: boolean;
  maxMeshInstances?: number;
}

export interface ProcPlantHeroGlbPrimitiveInspection {
  meshIndex: number;
  primitiveIndex: number;
  name: string;
  mode: number;
  materialIndex: number | null;
  attributes: string[];
  vertexCount: number;
  indexCount: number;
  triangleCount: number;
  hasNormals: boolean;
  hasUv0: boolean;
}

export interface ProcPlantHeroGlbImageInspection {
  imageIndex: number;
  id: string;
  name: string;
  mimeType: ProcPlantHeroGlbTexture["mimeType"];
  byteLength: number;
  contentHash: string;
  source: "bufferView" | "data-uri";
  textureIndices: number[];
}

export interface ProcPlantHeroGlbInspection {
  contract: typeof PROCPLANT_HERO_GLB_IMPORT_CONTRACT;
  version: typeof PROCPLANT_HERO_GLB_IMPORT_VERSION;
  contentHash: string;
  byteLength: number;
  generator: string | null;
  scenes: number;
  nodes: number;
  meshes: number;
  meshInstances: number;
  primitives: number;
  materials: number;
  textures: number;
  images: ProcPlantHeroGlbImageInspection[];
  primitivesDetail: ProcPlantHeroGlbPrimitiveInspection[];
  extensionsUsed: string[];
  extensionsRequired: string[];
}

export interface ProcPlantHeroGlbTexture extends ProcPlantHeroGlbImageInspection {
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/ktx2";
  bytes: Uint8Array;
}

export interface ProcPlantHeroGlbMeshPrimitive {
  instanceId: string;
  nodeIndex: number | null;
  nodePath: string | null;
  meshIndex: number;
  primitiveIndex: number;
  name: string;
  materialIndex: number | null;
  transformsBaked: boolean;
  /** Column-major glTF world matrix, retained even when it is not baked. */
  worldMatrix: readonly number[];
  positions: Float32Array;
  normals?: Float32Array;
  uv0?: Float32Array;
  indices?: Uint32Array;
}

export interface ProcPlantHeroGlbImportPackage {
  contract: typeof PROCPLANT_HERO_GLB_IMPORT_CONTRACT;
  version: typeof PROCPLANT_HERO_GLB_IMPORT_VERSION;
  inspection: ProcPlantHeroGlbInspection;
  meshes: ProcPlantHeroGlbMeshPrimitive[];
  textures: ProcPlantHeroGlbTexture[];
}

type JsonRecord = Record<string, unknown>;

interface ResolvedLimits {
  maxBytes: number;
  maxJsonBytes: number;
  maxBinaryBytes: number;
  maxScenes: number;
  maxNodes: number;
  maxMeshes: number;
  maxPrimitives: number;
  maxAccessors: number;
  maxBufferViews: number;
  maxImages: number;
  maxMaterials: number;
  maxTextures: number;
  maxSamplers: number;
  maxImageBytes: number;
  maxTotalImageBytes: number;
  maxVertices: number;
  maxIndices: number;
  maxDecodedAttributeBytes: number;
  maxMeshInstances: number;
}

interface ParsedHeroGlb {
  bytes: Uint8Array;
  json: JsonRecord;
  binary: Uint8Array;
  declaredBinaryLength: number;
  limits: ResolvedLimits;
  accessors: unknown[];
  bufferViews: unknown[];
  meshes: unknown[];
  images: unknown[];
  textures: unknown[];
  samplers: unknown[];
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_SAFE_ARRAY_LENGTH = 0x7fffffff;
const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/ktx2"]);

const record = (value: unknown, label: string): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonRecord;
};

const array = (value: unknown, label: string): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
};

const integer = (value: unknown, minimum: number, maximum: number, label: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value as number;
};

const option = (value: number | undefined, fallback: number, label: string, maximum: number) =>
  integer(value ?? fallback, 1, maximum, label);

const resolveLimits = (limits: ProcPlantHeroGlbMeshExtractionOptions): ResolvedLimits => ({
  maxBytes: option(limits.maxBytes, 256 * 1024 * 1024, "maxBytes", 1024 * 1024 * 1024),
  maxJsonBytes: option(limits.maxJsonBytes, 32 * 1024 * 1024, "maxJsonBytes", 256 * 1024 * 1024),
  maxBinaryBytes: option(limits.maxBinaryBytes, 256 * 1024 * 1024, "maxBinaryBytes", 1024 * 1024 * 1024),
  maxScenes: option(limits.maxScenes, 256, "maxScenes", 65_536),
  maxNodes: option(limits.maxNodes, 100_000, "maxNodes", 1_000_000),
  maxMeshes: option(limits.maxMeshes, 4096, "maxMeshes", 100_000),
  maxPrimitives: option(limits.maxPrimitives, 16_384, "maxPrimitives", 500_000),
  maxAccessors: option(limits.maxAccessors, 65_536, "maxAccessors", 1_000_000),
  maxBufferViews: option(limits.maxBufferViews, 65_536, "maxBufferViews", 1_000_000),
  maxImages: option(limits.maxImages, 256, "maxImages", 65_536),
  maxMaterials: option(limits.maxMaterials, 4096, "maxMaterials", 100_000),
  maxTextures: option(limits.maxTextures, 4096, "maxTextures", 100_000),
  maxSamplers: option(limits.maxSamplers, 4096, "maxSamplers", 100_000),
  maxImageBytes: option(limits.maxImageBytes, 64 * 1024 * 1024, "maxImageBytes", 512 * 1024 * 1024),
  maxTotalImageBytes: option(limits.maxTotalImageBytes, 128 * 1024 * 1024, "maxTotalImageBytes", 1024 * 1024 * 1024),
  maxVertices: option(limits.maxVertices, 10_000_000, "maxVertices", 100_000_000),
  maxIndices: option(limits.maxIndices, 30_000_000, "maxIndices", 300_000_000),
  maxDecodedAttributeBytes: option(
    limits.maxDecodedAttributeBytes,
    256 * 1024 * 1024,
    "maxDecodedAttributeBytes",
    1024 * 1024 * 1024,
  ),
  maxMeshInstances: option(limits.maxMeshInstances, 100_000, "maxMeshInstances", 1_000_000),
});

const hashBytes = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const sourceBytes = (source: ArrayBuffer | Uint8Array) => source instanceof Uint8Array
  ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
  : new Uint8Array(source);

const stringArray = (value: unknown, label: string) => {
  const entries = array(value, label);
  if (entries.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 128)) {
    throw new Error(`${label} must contain strings with 1..128 characters`);
  }
  if (new Set(entries).size !== entries.length) throw new Error(`${label} must not contain duplicates`);
  return entries as string[];
};

const parseHeroGlb = (source: ArrayBuffer | Uint8Array, inputLimits: ProcPlantHeroGlbMeshExtractionOptions): ParsedHeroGlb => {
  const limits = resolveLimits(inputLimits);
  const bytes = sourceBytes(source);
  if (bytes.byteLength > limits.maxBytes) throw new Error(`hero GLB exceeds maxBytes (${bytes.byteLength} > ${limits.maxBytes})`);
  if (bytes.byteLength < 20 || bytes.byteLength % 4 !== 0) throw new Error("hero GLB is truncated or not 4-byte aligned");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("hero GLB magic is invalid");
  if (view.getUint32(4, true) !== 2) throw new Error("hero GLB version must be 2");
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error("hero GLB header length does not match source bytes");
  const jsonLength = view.getUint32(12, true);
  if (jsonLength < 2 || jsonLength > limits.maxJsonBytes || jsonLength % 4 !== 0 || view.getUint32(16, true) !== JSON_CHUNK) {
    throw new Error("hero GLB first chunk must be bounded JSON");
  }
  const jsonEnd = 20 + jsonLength;
  if (jsonEnd > bytes.byteLength) throw new Error("hero GLB JSON chunk is truncated");
  let json: JsonRecord;
  try {
    json = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, jsonEnd)).trimEnd()), "glTF root");
  } catch (error) {
    throw new Error(`hero GLB JSON is invalid (${error instanceof Error ? error.message : String(error)})`);
  }
  let binary: Uint8Array<ArrayBufferLike> = new Uint8Array();
  if (jsonEnd < bytes.byteLength) {
    if (jsonEnd + 8 > bytes.byteLength || view.getUint32(jsonEnd + 4, true) !== BIN_CHUNK) {
      throw new Error("hero GLB second chunk must be BIN");
    }
    const binaryLength = view.getUint32(jsonEnd, true);
    if (binaryLength > limits.maxBinaryBytes || binaryLength % 4 !== 0 || jsonEnd + 8 + binaryLength !== bytes.byteLength) {
      throw new Error("hero GLB BIN chunk length is invalid");
    }
    binary = bytes.subarray(jsonEnd + 8);
  }
  const asset = record(json.asset, "glTF asset");
  if (asset.version !== "2.0") throw new Error("glTF asset.version must be 2.0");
  const buffers = array(json.buffers, "glTF buffers");
  if (buffers.length > 1) throw new Error("hero GLB must contain at most one embedded buffer");
  let declaredBinaryLength = 0;
  if (buffers.length === 1) {
    const buffer = record(buffers[0], "glTF buffers[0]");
    if (buffer.uri !== undefined) throw new Error("hero GLB external buffer URIs are unsupported");
    declaredBinaryLength = integer(buffer.byteLength, 0, limits.maxBinaryBytes, "glTF buffers[0].byteLength");
    if (declaredBinaryLength > binary.byteLength || binary.byteLength - declaredBinaryLength > 3) {
      throw new Error("hero GLB embedded buffer length does not match BIN padding");
    }
  } else if (binary.byteLength !== 0) throw new Error("hero GLB BIN chunk has no declared buffer");

  const accessors = array(json.accessors, "glTF accessors");
  const bufferViews = array(json.bufferViews, "glTF bufferViews");
  const meshes = array(json.meshes, "glTF meshes");
  const images = array(json.images, "glTF images");
  const textures = array(json.textures, "glTF textures");
  const samplers = array(json.samplers, "glTF samplers");
  const scenes = array(json.scenes, "glTF scenes");
  const nodes = array(json.nodes, "glTF nodes");
  const materials = array(json.materials, "glTF materials");
  if (accessors.length > limits.maxAccessors) throw new Error(`hero GLB exceeds maxAccessors (${accessors.length} > ${limits.maxAccessors})`);
  if (bufferViews.length > limits.maxBufferViews) throw new Error(`hero GLB exceeds maxBufferViews (${bufferViews.length} > ${limits.maxBufferViews})`);
  if (meshes.length > limits.maxMeshes) throw new Error(`hero GLB exceeds maxMeshes (${meshes.length} > ${limits.maxMeshes})`);
  if (images.length > limits.maxImages) throw new Error(`hero GLB exceeds maxImages (${images.length} > ${limits.maxImages})`);
  if (scenes.length > limits.maxScenes) throw new Error(`hero GLB exceeds maxScenes (${scenes.length} > ${limits.maxScenes})`);
  if (nodes.length > limits.maxNodes) throw new Error(`hero GLB exceeds maxNodes (${nodes.length} > ${limits.maxNodes})`);
  if (materials.length > limits.maxMaterials) throw new Error(`hero GLB exceeds maxMaterials (${materials.length} > ${limits.maxMaterials})`);
  if (textures.length > limits.maxTextures) throw new Error(`hero GLB exceeds maxTextures (${textures.length} > ${limits.maxTextures})`);
  if (samplers.length > limits.maxSamplers) throw new Error(`hero GLB exceeds maxSamplers (${samplers.length} > ${limits.maxSamplers})`);
  for (let index = 0; index < bufferViews.length; index++) {
    const bufferView = record(bufferViews[index], `glTF bufferViews[${index}]`);
    if (integer(bufferView.buffer, 0, 0, `glTF bufferViews[${index}].buffer`) !== 0) throw new Error("unreachable");
    const offset = integer(bufferView.byteOffset ?? 0, 0, declaredBinaryLength, `glTF bufferViews[${index}].byteOffset`);
    const length = integer(bufferView.byteLength, 1, declaredBinaryLength, `glTF bufferViews[${index}].byteLength`);
    if (offset + length > declaredBinaryLength) throw new Error(`glTF bufferViews[${index}] exceeds the embedded buffer`);
    if (bufferView.byteStride !== undefined) {
      const stride = integer(bufferView.byteStride, 4, 252, `glTF bufferViews[${index}].byteStride`);
      if (stride % 4 !== 0) throw new Error(`glTF bufferViews[${index}].byteStride must be a multiple of 4`);
    }
  }
  const parsed = { bytes, json, binary, declaredBinaryLength, limits, accessors, bufferViews, meshes, images, textures, samplers };
  validateStructuralReferences(parsed);
  return parsed;
};

const textureSourceIndex = (parsed: ParsedHeroGlb, textureIndex: number) => {
  const texture = record(parsed.textures[textureIndex], `glTF textures[${textureIndex}]`);
  const candidates: unknown[] = [];
  if (texture.source !== undefined) candidates.push(texture.source);
  if (texture.extensions !== undefined) {
    const extensions = record(texture.extensions, `glTF textures[${textureIndex}].extensions`);
    for (const extensionName of ["KHR_texture_basisu", "EXT_texture_webp"]) {
      if (extensions[extensionName] !== undefined) candidates.push(record(extensions[extensionName], extensionName).source);
    }
  }
  if (candidates.length !== 1) throw new Error(`glTF textures[${textureIndex}] must resolve exactly one image source`);
  return integer(candidates[0], 0, parsed.images.length - 1, `glTF textures[${textureIndex}].source`);
};

const validateStructuralReferences = (parsed: ParsedHeroGlb) => {
  const scenes = array(parsed.json.scenes, "glTF scenes");
  const nodes = array(parsed.json.nodes, "glTF nodes");
  if (parsed.json.scene !== undefined) integer(parsed.json.scene, 0, scenes.length - 1, "glTF scene");
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const roots = array(record(scenes[sceneIndex], `glTF scenes[${sceneIndex}]`).nodes, `glTF scenes[${sceneIndex}].nodes`);
    if (new Set(roots).size !== roots.length) throw new Error(`glTF scenes[${sceneIndex}].nodes must not contain duplicates`);
    roots.forEach((node, rootIndex) => integer(node, 0, nodes.length - 1, `glTF scenes[${sceneIndex}].nodes[${rootIndex}]`));
  }
  const childrenByNode: number[][] = [];
  const parentByNode = new Int32Array(nodes.length);
  parentByNode.fill(-1);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = record(nodes[nodeIndex], `glTF nodes[${nodeIndex}]`);
    if (node.mesh !== undefined) integer(node.mesh, 0, parsed.meshes.length - 1, `glTF nodes[${nodeIndex}].mesh`);
    const children = array(node.children, `glTF nodes[${nodeIndex}].children`).map((child, childIndex) =>
      integer(child, 0, nodes.length - 1, `glTF nodes[${nodeIndex}].children[${childIndex}]`));
    if (new Set(children).size !== children.length || children.includes(nodeIndex)) {
      throw new Error(`glTF nodes[${nodeIndex}].children contains duplicates or itself`);
    }
    childrenByNode.push(children);
    for (const child of children) {
      if (parentByNode[child] !== -1) throw new Error(`glTF node ${child} has multiple parents`);
      parentByNode[child] = nodeIndex;
    }
    if (node.matrix !== undefined) {
      if (!Array.isArray(node.matrix) || node.matrix.length !== 16 || node.matrix.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error(`glTF nodes[${nodeIndex}].matrix must contain 16 finite numbers`);
      }
      if (Math.abs(node.matrix[3] as number) > 1e-8 || Math.abs(node.matrix[7] as number) > 1e-8
        || Math.abs(node.matrix[11] as number) > 1e-8 || Math.abs((node.matrix[15] as number) - 1) > 1e-8) {
        throw new Error(`glTF nodes[${nodeIndex}].matrix must be affine`);
      }
      if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) {
        throw new Error(`glTF nodes[${nodeIndex}] must not combine matrix with TRS`);
      }
    }
    for (const [key, length] of [["translation", 3], ["rotation", 4], ["scale", 3]] as const) {
      const value = node[key];
      if (value !== undefined && (!Array.isArray(value) || value.length !== length || value.some((entry: unknown) => typeof entry !== "number" || !Number.isFinite(entry)))) {
        throw new Error(`glTF nodes[${nodeIndex}].${key} must contain ${length} finite numbers`);
      }
    }
    if (Array.isArray(node.rotation)) {
      const length = Math.hypot(...node.rotation as number[]);
      if (Math.abs(length - 1) > 1e-5) throw new Error(`glTF nodes[${nodeIndex}].rotation must be a unit quaternion`);
    }
  }
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const roots = array(record(scenes[sceneIndex], `glTF scenes[${sceneIndex}]`).nodes, `glTF scenes[${sceneIndex}].nodes`);
    for (const root of roots as number[]) {
      if (parentByNode[root] !== -1) throw new Error(`glTF scene root node ${root} has a parent`);
    }
  }
  const state = new Uint8Array(nodes.length);
  const visit = (nodeIndex: number) => {
    if (state[nodeIndex] === 1) throw new Error("glTF node hierarchy contains a cycle");
    if (state[nodeIndex] === 2) return;
    state[nodeIndex] = 1;
    childrenByNode[nodeIndex]!.forEach(visit);
    state[nodeIndex] = 2;
  };
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) visit(nodeIndex);

  parsed.textures.forEach((_texture, textureIndex) => textureSourceIndex(parsed, textureIndex));
  const materials = array(parsed.json.materials, "glTF materials");
  const textureInfo = (value: unknown, label: string) => {
    if (value === undefined) return;
    const info = record(value, label);
    integer(info.index, 0, parsed.textures.length - 1, `${label}.index`);
    if (info.texCoord !== undefined) integer(info.texCoord, 0, 7, `${label}.texCoord`);
  };
  for (let materialIndex = 0; materialIndex < materials.length; materialIndex++) {
    const material = record(materials[materialIndex], `glTF materials[${materialIndex}]`);
    const pbr = material.pbrMetallicRoughness === undefined ? {} : record(material.pbrMetallicRoughness, `materials[${materialIndex}].pbrMetallicRoughness`);
    textureInfo(pbr.baseColorTexture, `materials[${materialIndex}].baseColorTexture`);
    textureInfo(pbr.metallicRoughnessTexture, `materials[${materialIndex}].metallicRoughnessTexture`);
    textureInfo(material.normalTexture, `materials[${materialIndex}].normalTexture`);
    textureInfo(material.occlusionTexture, `materials[${materialIndex}].occlusionTexture`);
    textureInfo(material.emissiveTexture, `materials[${materialIndex}].emissiveTexture`);
  }
};

const componentsForType = (type: unknown) => type === "SCALAR" ? 1
  : type === "VEC2" ? 2 : type === "VEC3" ? 3 : type === "VEC4" ? 4 : 0;

const bytesForComponent = (componentType: number) => componentType === 5120 || componentType === 5121 ? 1
  : componentType === 5122 || componentType === 5123 ? 2
    : componentType === 5125 || componentType === 5126 ? 4 : 0;

interface AccessorLayout {
  accessor: JsonRecord;
  view: JsonRecord;
  count: number;
  components: number;
  componentType: number;
  componentBytes: number;
  byteOffset: number;
  byteStride: number;
  normalized: boolean;
}

const accessorLayout = (
  parsed: ParsedHeroGlb,
  accessorIndex: number,
  label: string,
  maxCount = parsed.limits.maxVertices,
): AccessorLayout => {
  const accessor = record(parsed.accessors[accessorIndex], `${label} accessor`);
  if (accessor.sparse !== undefined) throw new Error(`${label} sparse accessors are unsupported`);
  const viewIndex = integer(accessor.bufferView, 0, parsed.bufferViews.length - 1, `${label}.bufferView`);
  const view = record(parsed.bufferViews[viewIndex], `${label} bufferView`);
  if (view.extensions !== undefined) throw new Error(`${label} compressed bufferViews are unsupported by the dependency-free importer`);
  const count = integer(accessor.count, 1, maxCount, `${label}.count`);
  const componentType = integer(accessor.componentType, 5120, 5126, `${label}.componentType`);
  const componentBytes = bytesForComponent(componentType);
  const components = componentsForType(accessor.type);
  if (!componentBytes || !components) throw new Error(`${label} accessor componentType or type is unsupported`);
  const viewOffset = integer(view.byteOffset ?? 0, 0, parsed.declaredBinaryLength, `${label} bufferView.byteOffset`);
  const accessorOffset = integer(accessor.byteOffset ?? 0, 0, parsed.declaredBinaryLength, `${label}.byteOffset`);
  const elementBytes = componentBytes * components;
  const byteStride = view.byteStride === undefined ? elementBytes : integer(view.byteStride, elementBytes, 252, `${label}.byteStride`);
  const viewLength = integer(view.byteLength, 1, parsed.declaredBinaryLength, `${label} bufferView.byteLength`);
  if ((viewOffset + accessorOffset) % componentBytes !== 0 || byteStride % componentBytes !== 0) {
    throw new Error(`${label} accessor is not component-aligned`);
  }
  if (componentType === 5126 && accessor.normalized === true) throw new Error(`${label} float accessor must not be normalized`);
  if (accessorOffset + (count - 1) * byteStride + elementBytes > viewLength) throw new Error(`${label} accessor exceeds its bufferView`);
  return {
    accessor,
    view,
    count,
    components,
    componentType,
    componentBytes,
    byteOffset: viewOffset + accessorOffset,
    byteStride,
    normalized: accessor.normalized === true,
  };
};

const readComponent = (view: DataView, offset: number, componentType: number, normalized: boolean) => {
  if (componentType === 5126) return view.getFloat32(offset, true);
  if (componentType === 5125) return view.getUint32(offset, true);
  if (componentType === 5123) {
    const value = view.getUint16(offset, true);
    return normalized ? value / 65535 : value;
  }
  if (componentType === 5122) {
    const value = view.getInt16(offset, true);
    return normalized ? Math.max(-1, value / 32767) : value;
  }
  if (componentType === 5121) {
    const value = view.getUint8(offset);
    return normalized ? value / 255 : value;
  }
  const value = view.getInt8(offset);
  return normalized ? Math.max(-1, value / 127) : value;
};

const readFloatAccessor = (
  parsed: ParsedHeroGlb,
  accessorIndex: number,
  label: string,
  expectedComponents: number,
  acceptedComponentTypes: readonly number[],
  maximumOutputBytes = parsed.limits.maxDecodedAttributeBytes,
) => {
  const layout = accessorLayout(parsed, accessorIndex, label);
  if (layout.components !== expectedComponents || !acceptedComponentTypes.includes(layout.componentType)) {
    throw new Error(`${label} accessor format is unsupported`);
  }
  const outputLength = layout.count * layout.components;
  if (!Number.isSafeInteger(outputLength) || outputLength * 4 > maximumOutputBytes) {
    throw new Error(`${label} exceeds maxDecodedAttributeBytes`);
  }
  const output = new Float32Array(outputLength);
  const source = new DataView(parsed.binary.buffer, parsed.binary.byteOffset, parsed.binary.byteLength);
  for (let element = 0; element < layout.count; element++) {
    for (let component = 0; component < layout.components; component++) {
      output[element * layout.components + component] = readComponent(
        source,
        layout.byteOffset + element * layout.byteStride + component * layout.componentBytes,
        layout.componentType,
        layout.normalized,
      );
      if (!Number.isFinite(output[element * layout.components + component])) {
        throw new Error(`${label} contains a non-finite decoded component`);
      }
    }
  }
  return { output, count: layout.count };
};

const readIndices = (
  parsed: ParsedHeroGlb,
  accessorIndex: number,
  vertexCount: number,
  label: string,
  maximumOutputBytes = parsed.limits.maxDecodedAttributeBytes,
) => {
  const layout = accessorLayout(parsed, accessorIndex, label, parsed.limits.maxIndices);
  if (layout.components !== 1 || ![5121, 5123, 5125].includes(layout.componentType) || layout.normalized) {
    throw new Error(`${label} indices must be unnormalized unsigned scalar values`);
  }
  if (layout.count * 4 > maximumOutputBytes) {
    throw new Error(`${label} exceeds index or decoded-byte limits`);
  }
  const output = new Uint32Array(layout.count);
  const source = new DataView(parsed.binary.buffer, parsed.binary.byteOffset, parsed.binary.byteLength);
  for (let index = 0; index < layout.count; index++) {
    const value = readComponent(source, layout.byteOffset + index * layout.byteStride, layout.componentType, false);
    if (value >= vertexCount) throw new Error(`${label} index ${index} references missing vertex ${value}`);
    output[index] = value;
  }
  return output;
};

const primitiveInspections = (parsed: ParsedHeroGlb) => {
  const details: ProcPlantHeroGlbPrimitiveInspection[] = [];
  for (let meshIndex = 0; meshIndex < parsed.meshes.length; meshIndex++) {
    const mesh = record(parsed.meshes[meshIndex], `glTF meshes[${meshIndex}]`);
    const primitives = array(mesh.primitives, `glTF meshes[${meshIndex}].primitives`);
    if (details.length + primitives.length > parsed.limits.maxPrimitives) {
      throw new Error(`hero GLB exceeds maxPrimitives (${details.length + primitives.length} > ${parsed.limits.maxPrimitives})`);
    }
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex++) {
      const primitive = record(primitives[primitiveIndex], `glTF mesh primitive ${meshIndex}:${primitiveIndex}`);
      const attributes = record(primitive.attributes, `glTF mesh primitive ${meshIndex}:${primitiveIndex}.attributes`);
      const positionAccessor = integer(attributes.POSITION, 0, parsed.accessors.length - 1, `mesh ${meshIndex}:${primitiveIndex} POSITION`);
      const positionLayout = accessorLayout(parsed, positionAccessor, `mesh ${meshIndex}:${primitiveIndex} POSITION`);
      if (positionLayout.components !== 3 || positionLayout.componentType !== 5126 || positionLayout.normalized) {
        throw new Error(`mesh ${meshIndex}:${primitiveIndex} POSITION must be an unnormalized float VEC3 accessor`);
      }
      for (const [semantic, accessorValue] of Object.entries(attributes)) {
        integer(accessorValue, 0, parsed.accessors.length - 1, `mesh ${meshIndex}:${primitiveIndex} attribute ${semantic}`);
      }
      if (attributes.NORMAL !== undefined) {
        const normalLayout = accessorLayout(parsed, attributes.NORMAL as number, `mesh ${meshIndex}:${primitiveIndex} NORMAL`);
        if (normalLayout.count !== positionLayout.count || normalLayout.components !== 3 || normalLayout.componentType !== 5126 || normalLayout.normalized) {
          throw new Error(`mesh ${meshIndex}:${primitiveIndex} NORMAL must match POSITION as an unnormalized float VEC3 accessor`);
        }
      }
      if (attributes.TEXCOORD_0 !== undefined) {
        const uvLayout = accessorLayout(parsed, attributes.TEXCOORD_0 as number, `mesh ${meshIndex}:${primitiveIndex} TEXCOORD_0`);
        if (uvLayout.count !== positionLayout.count || uvLayout.components !== 2 || ![5121, 5123, 5126].includes(uvLayout.componentType) ||
          (uvLayout.componentType !== 5126 && !uvLayout.normalized)) {
          throw new Error(`mesh ${meshIndex}:${primitiveIndex} TEXCOORD_0 has an unsupported or mismatched accessor`);
        }
      }
      const mode = integer(primitive.mode ?? 4, 0, 6, `mesh ${meshIndex}:${primitiveIndex}.mode`);
      const indexCount = primitive.indices === undefined
        ? positionLayout.count
        : accessorLayout(
          parsed,
          integer(primitive.indices, 0, parsed.accessors.length - 1, `mesh ${meshIndex}:${primitiveIndex}.indices`),
          `mesh ${meshIndex}:${primitiveIndex} indices`,
          parsed.limits.maxIndices,
        ).count;
      details.push({
        meshIndex,
        primitiveIndex,
        name: typeof mesh.name === "string" && mesh.name.length <= 128 ? mesh.name : `mesh-${meshIndex}`,
        mode,
        materialIndex: primitive.material === undefined ? null : integer(
          primitive.material,
          0,
          array(parsed.json.materials, "glTF materials").length - 1,
          `mesh ${meshIndex}:${primitiveIndex}.material`,
        ),
        attributes: Object.keys(attributes).sort(),
        vertexCount: positionLayout.count,
        indexCount,
        triangleCount: mode === 4 ? Math.floor(indexCount / 3) : mode === 5 || mode === 6 ? Math.max(0, indexCount - 2) : 0,
        hasNormals: attributes.NORMAL !== undefined,
        hasUv0: attributes.TEXCOORD_0 !== undefined,
      });
    }
  }
  return details;
};

const decodeBase64 = (encoded: string, maximumBytes: number, label: string) => {
  if (encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`${label} contains invalid base64`);
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const length = encoded.length / 4 * 3 - padding;
  if (length < 1 || length > maximumBytes || length > MAX_SAFE_ARRAY_LENGTH) throw new Error(`${label} exceeds bounded decoded length`);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const output = new Uint8Array(length);
  let write = 0;
  for (let offset = 0; offset < encoded.length; offset += 4) {
    const a = alphabet.indexOf(encoded[offset]!);
    const b = alphabet.indexOf(encoded[offset + 1]!);
    const c = encoded[offset + 2] === "=" ? 0 : alphabet.indexOf(encoded[offset + 2]!);
    const d = encoded[offset + 3] === "=" ? 0 : alphabet.indexOf(encoded[offset + 3]!);
    const value = (a << 18) | (b << 12) | (c << 6) | d;
    if (write < length) output[write++] = value >>> 16;
    if (write < length) output[write++] = value >>> 8;
    if (write < length) output[write++] = value;
  }
  return output;
};

const assertImageSignature = (bytes: Uint8Array, mimeType: ProcPlantHeroGlbTexture["mimeType"], label: string) => {
  const valid = mimeType === "image/png"
    ? bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : mimeType === "image/jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mimeType === "image/webp"
        ? bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
        : bytes.length >= 12 && [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]
          .every((byte, index) => bytes[index] === byte);
  if (!valid) throw new Error(`${label} bytes do not match ${mimeType}`);
};

const imageTextureIndices = (parsed: ParsedHeroGlb, imageIndex: number) => {
  const indices: number[] = [];
  for (let textureIndex = 0; textureIndex < parsed.textures.length; textureIndex++) {
    if (textureSourceIndex(parsed, textureIndex) === imageIndex) {
      indices.push(textureIndex);
    }
  }
  return indices;
};

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

const multiplyMatrices = (left: readonly number[], right: readonly number[]) => {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let index = 0; index < 4; index++) output[column * 4 + row]! += left[index * 4 + row]! * right[column * 4 + index]!;
    }
  }
  return output;
};

const nodeLocalMatrix = (node: JsonRecord) => {
  if (Array.isArray(node.matrix)) return [...node.matrix] as number[];
  const translation = (node.translation ?? [0, 0, 0]) as number[];
  const rotation = (node.rotation ?? [0, 0, 0, 1]) as number[];
  const scale = (node.scale ?? [1, 1, 1]) as number[];
  const [x, y, z, w] = rotation as [number, number, number, number];
  const [sx, sy, sz] = scale as [number, number, number];
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    translation[0]!, translation[1]!, translation[2]!, 1,
  ];
};

interface HeroMeshInstance {
  nodeIndex: number | null;
  nodePath: string | null;
  meshIndex: number;
  worldMatrix: number[];
}

const heroMeshInstances = (parsed: ParsedHeroGlb): HeroMeshInstance[] => {
  const nodes = array(parsed.json.nodes, "glTF nodes");
  const parents = new Int32Array(nodes.length);
  parents.fill(-1);
  for (let parent = 0; parent < nodes.length; parent++) {
    for (const child of array(record(nodes[parent], `glTF nodes[${parent}]`).children, `glTF nodes[${parent}].children`) as number[]) {
      parents[child] = parent;
    }
  }
  const worlds: Array<number[] | undefined> = new Array(nodes.length);
  const worldFor = (nodeIndex: number): number[] => {
    const cached = worlds[nodeIndex];
    if (cached) return cached;
    const local = nodeLocalMatrix(record(nodes[nodeIndex], `glTF nodes[${nodeIndex}]`));
    const parent = parents[nodeIndex]!;
    const world = parent < 0 ? local : multiplyMatrices(worldFor(parent), local);
    if (world.some((value) => !Number.isFinite(value))) throw new Error(`glTF node ${nodeIndex} world transform exceeds finite capacity`);
    worlds[nodeIndex] = world;
    return world;
  };
  const pathFor = (nodeIndex: number) => {
    const segments: string[] = [];
    for (let current = nodeIndex; current >= 0; current = parents[current]!) {
      segments.push(`node:${current.toString().padStart(6, "0")}`);
    }
    return segments.reverse().join("/");
  };
  const instances: HeroMeshInstance[] = [];
  const referenced = new Set<number>();
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = record(nodes[nodeIndex], `glTF nodes[${nodeIndex}]`);
    if (node.mesh === undefined) continue;
    if (node.skin !== undefined) throw new Error(`glTF nodes[${nodeIndex}] skinning is unsupported by static hero extraction`);
    const extensions = node.extensions === undefined ? {} : record(node.extensions, `glTF nodes[${nodeIndex}].extensions`);
    if (extensions.EXT_mesh_gpu_instancing !== undefined) {
      throw new Error(`glTF nodes[${nodeIndex}] GPU instancing is unsupported by static hero extraction`);
    }
    const meshIndex = node.mesh as number;
    referenced.add(meshIndex);
    instances.push({ nodeIndex, nodePath: pathFor(nodeIndex), meshIndex, worldMatrix: [...worldFor(nodeIndex)] });
  }
  for (let meshIndex = 0; meshIndex < parsed.meshes.length; meshIndex++) {
    if (!referenced.has(meshIndex)) instances.push({ nodeIndex: null, nodePath: null, meshIndex, worldMatrix: [...IDENTITY_MATRIX] });
  }
  return instances;
};

const bakePositions = (positions: Float32Array, matrix: readonly number[]) => {
  const output = new Float32Array(positions.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset]!, y = positions[offset + 1]!, z = positions[offset + 2]!;
    const transformed = [
      matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
      matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
      matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
    ];
    if (transformed.some((value) => !Number.isFinite(Math.fround(value)))) {
      throw new Error("hero node transform produces positions outside float32 capacity");
    }
    output[offset] = transformed[0]!;
    output[offset + 1] = transformed[1]!;
    output[offset + 2] = transformed[2]!;
  }
  return output;
};

const bakeNormals = (normals: Float32Array, matrix: readonly number[]) => {
  const a = matrix[0]!, b = matrix[4]!, c = matrix[8]!;
  const d = matrix[1]!, e = matrix[5]!, f = matrix[9]!;
  const g = matrix[2]!, h = matrix[6]!, i = matrix[10]!;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error("hero node world transform is singular; normals cannot be baked");
  }
  const output = new Float32Array(normals.length);
  for (let offset = 0; offset < normals.length; offset += 3) {
    const x = normals[offset]!, y = normals[offset + 1]!, z = normals[offset + 2]!;
    const nx = ((e * i - f * h) * x + (f * g - d * i) * y + (d * h - e * g) * z) / determinant;
    const ny = ((c * h - b * i) * x + (a * i - c * g) * y + (b * g - a * h) * z) / determinant;
    const nz = ((b * f - c * e) * x + (c * d - a * f) * y + (a * e - b * d) * z) / determinant;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 1e-12) || !Number.isFinite(length)) throw new Error("hero normal transform produced a degenerate normal");
    output[offset] = nx / length;
    output[offset + 1] = ny / length;
    output[offset + 2] = nz / length;
  }
  return output;
};

const extractTextures = (parsed: ParsedHeroGlb): ProcPlantHeroGlbTexture[] => {
  const textures: ProcPlantHeroGlbTexture[] = [];
  let totalBytes = 0;
  for (let imageIndex = 0; imageIndex < parsed.images.length; imageIndex++) {
    const image = record(parsed.images[imageIndex], `glTF images[${imageIndex}]`);
    const name = typeof image.name === "string" && image.name.length > 0 && image.name.length <= 128 ? image.name : `image-${imageIndex}`;
    let bytes: Uint8Array;
    let mimeType: string;
    let source: ProcPlantHeroGlbTexture["source"];
    if (image.bufferView !== undefined) {
      const viewIndex = integer(image.bufferView, 0, parsed.bufferViews.length - 1, `glTF images[${imageIndex}].bufferView`);
      const bufferView = record(parsed.bufferViews[viewIndex], `glTF images[${imageIndex}] bufferView`);
      if (bufferView.byteStride !== undefined) throw new Error(`glTF images[${imageIndex}] bufferView must not be strided`);
      const offset = integer(bufferView.byteOffset ?? 0, 0, parsed.declaredBinaryLength, `glTF images[${imageIndex}].byteOffset`);
      const length = integer(bufferView.byteLength, 1, parsed.limits.maxImageBytes, `glTF images[${imageIndex}].byteLength`);
      mimeType = String(image.mimeType ?? "");
      bytes = parsed.binary.slice(offset, offset + length);
      source = "bufferView";
    } else if (typeof image.uri === "string") {
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(image.uri);
      if (!match) throw new Error(`glTF images[${imageIndex}] external or non-base64 URI is unsupported`);
      mimeType = match[1]!;
      bytes = decodeBase64(match[2]!, parsed.limits.maxImageBytes, `glTF images[${imageIndex}]`);
      source = "data-uri";
    } else throw new Error(`glTF images[${imageIndex}] must use bufferView or bounded data URI`);
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) throw new Error(`glTF images[${imageIndex}] has unsupported MIME type ${mimeType || "<empty>"}`);
    totalBytes += bytes.byteLength;
    if (totalBytes > parsed.limits.maxTotalImageBytes) throw new Error("hero GLB images exceed maxTotalImageBytes");
    assertImageSignature(bytes, mimeType as ProcPlantHeroGlbTexture["mimeType"], `glTF images[${imageIndex}]`);
    textures.push({
      imageIndex,
      id: `hero-image:${imageIndex.toString().padStart(4, "0")}`,
      name,
      mimeType: mimeType as ProcPlantHeroGlbTexture["mimeType"],
      byteLength: bytes.byteLength,
      contentHash: hashBytes(bytes),
      source,
      textureIndices: imageTextureIndices(parsed, imageIndex),
      bytes,
    });
  }
  return textures;
};

const inspectParsed = (parsed: ParsedHeroGlb, textures: readonly ProcPlantHeroGlbTexture[]): ProcPlantHeroGlbInspection => {
  const details = primitiveInspections(parsed);
  const extensionsUsed = stringArray(parsed.json.extensionsUsed, "glTF extensionsUsed");
  const extensionsRequired = stringArray(parsed.json.extensionsRequired, "glTF extensionsRequired");
  if (extensionsRequired.some((extension) => !extensionsUsed.includes(extension))) {
    throw new Error("glTF extensionsRequired must be a subset of extensionsUsed");
  }
  const unsupportedRequired = extensionsRequired.find((extension) =>
    extension !== "KHR_texture_basisu" && extension !== "EXT_texture_webp");
  if (unsupportedRequired) throw new Error(`unsupported required hero GLB extension ${unsupportedRequired}`);
  const asset = record(parsed.json.asset, "glTF asset");
  return {
    contract: PROCPLANT_HERO_GLB_IMPORT_CONTRACT,
    version: PROCPLANT_HERO_GLB_IMPORT_VERSION,
    contentHash: hashBytes(parsed.bytes),
    byteLength: parsed.bytes.byteLength,
    generator: typeof asset.generator === "string" && asset.generator.length <= 256 ? asset.generator : null,
    scenes: array(parsed.json.scenes, "glTF scenes").length,
    nodes: array(parsed.json.nodes, "glTF nodes").length,
    meshes: parsed.meshes.length,
    meshInstances: heroMeshInstances(parsed).length,
    primitives: details.length,
    materials: array(parsed.json.materials, "glTF materials").length,
    textures: parsed.textures.length,
    images: textures.map(({ bytes: _bytes, ...image }) => image),
    primitivesDetail: details,
    extensionsUsed,
    extensionsRequired,
  };
};

export const inspectProcPlantHeroGlb = (
  source: ArrayBuffer | Uint8Array,
  limits: ProcPlantHeroGlbImportLimits = {},
): ProcPlantHeroGlbInspection => {
  const parsed = parseHeroGlb(source, limits);
  const textures = extractTextures(parsed);
  return inspectParsed(parsed, textures);
};

export const extractProcPlantHeroGlbTextures = (
  source: ArrayBuffer | Uint8Array,
  limits: ProcPlantHeroGlbImportLimits = {},
): ProcPlantHeroGlbTexture[] => extractTextures(parseHeroGlb(source, limits));

export const extractProcPlantHeroGlbMeshes = (
  source: ArrayBuffer | Uint8Array,
  options: ProcPlantHeroGlbMeshExtractionOptions = {},
): ProcPlantHeroGlbMeshPrimitive[] => {
  if (options.bakeNodeTransforms !== undefined && typeof options.bakeNodeTransforms !== "boolean") {
    throw new Error("bakeNodeTransforms must be boolean");
  }
  const parsed = parseHeroGlb(source, options);
  primitiveInspections(parsed);
  if (options.bakeNodeTransforms && array(parsed.json.animations, "glTF animations").length > 0) {
    throw new Error("animated node transforms cannot be baked as static hero geometry");
  }
  const instances = heroMeshInstances(parsed);
  const meshes: ProcPlantHeroGlbMeshPrimitive[] = [];
  let decodedBytes = 0;
  for (const instance of instances) {
    const meshIndex = instance.meshIndex;
    const mesh = record(parsed.meshes[meshIndex], `glTF meshes[${meshIndex}]`);
    const primitives = array(mesh.primitives, `glTF meshes[${meshIndex}].primitives`);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex++) {
      if (meshes.length >= parsed.limits.maxMeshInstances) {
        throw new Error(`hero GLB exceeds maxMeshInstances (${meshes.length + 1} > ${parsed.limits.maxMeshInstances})`);
      }
      const primitive = record(primitives[primitiveIndex], `glTF mesh primitive ${meshIndex}:${primitiveIndex}`);
      if (integer(primitive.mode ?? 4, 0, 6, `mesh ${meshIndex}:${primitiveIndex}.mode`) !== 4) {
        throw new Error(`mesh ${meshIndex}:${primitiveIndex} must use TRIANGLES mode`);
      }
      if (primitive.targets !== undefined) throw new Error(`mesh ${meshIndex}:${primitiveIndex} morph targets are unsupported`);
      const attributes = record(primitive.attributes, `mesh ${meshIndex}:${primitiveIndex}.attributes`);
      const positionIndex = integer(attributes.POSITION, 0, parsed.accessors.length - 1, `mesh ${meshIndex}:${primitiveIndex}.POSITION`);
      const positions = readFloatAccessor(
        parsed,
        positionIndex,
        `mesh ${meshIndex}:${primitiveIndex} POSITION`,
        3,
        [5126],
        parsed.limits.maxDecodedAttributeBytes - decodedBytes,
      );
      if (positions.count > parsed.limits.maxVertices) throw new Error(`mesh ${meshIndex}:${primitiveIndex} exceeds maxVertices`);
      decodedBytes += positions.output.byteLength;
      let normals: Float32Array | undefined;
      if (attributes.NORMAL !== undefined) {
        const result = readFloatAccessor(
          parsed,
          integer(attributes.NORMAL, 0, parsed.accessors.length - 1, "NORMAL"),
          "NORMAL",
          3,
          [5126],
          parsed.limits.maxDecodedAttributeBytes - decodedBytes,
        );
        if (result.count !== positions.count) throw new Error(`mesh ${meshIndex}:${primitiveIndex} NORMAL count mismatch`);
        normals = result.output;
        decodedBytes += normals.byteLength;
      }
      let uv0: Float32Array | undefined;
      if (attributes.TEXCOORD_0 !== undefined) {
        const result = readFloatAccessor(
          parsed,
          integer(attributes.TEXCOORD_0, 0, parsed.accessors.length - 1, "TEXCOORD_0"),
          "TEXCOORD_0",
          2,
          [5121, 5123, 5126],
          parsed.limits.maxDecodedAttributeBytes - decodedBytes,
        );
        if (result.count !== positions.count) throw new Error(`mesh ${meshIndex}:${primitiveIndex} TEXCOORD_0 count mismatch`);
        uv0 = result.output;
        decodedBytes += uv0.byteLength;
      }
      const indices = primitive.indices === undefined ? undefined : readIndices(
        parsed,
        integer(primitive.indices, 0, parsed.accessors.length - 1, `mesh ${meshIndex}:${primitiveIndex}.indices`),
        positions.count,
        `mesh ${meshIndex}:${primitiveIndex}`,
        parsed.limits.maxDecodedAttributeBytes - decodedBytes,
      );
      decodedBytes += indices?.byteLength ?? 0;
      const transformedBytes = options.bakeNodeTransforms
        ? positions.output.byteLength + (normals?.byteLength ?? 0)
        : 0;
      if (decodedBytes + transformedBytes > parsed.limits.maxDecodedAttributeBytes) {
        throw new Error("hero GLB transformed meshes exceed maxDecodedAttributeBytes");
      }
      const outputPositions = options.bakeNodeTransforms ? bakePositions(positions.output, instance.worldMatrix) : positions.output;
      const outputNormals = normals && options.bakeNodeTransforms ? bakeNormals(normals, instance.worldMatrix) : normals;
      meshes.push({
        instanceId: instance.nodeIndex === null
          ? `uninstanced:mesh:${meshIndex.toString().padStart(6, "0")}:primitive:${primitiveIndex.toString().padStart(6, "0")}`
          : `${instance.nodePath}:mesh:${meshIndex.toString().padStart(6, "0")}:primitive:${primitiveIndex.toString().padStart(6, "0")}`,
        nodeIndex: instance.nodeIndex,
        nodePath: instance.nodePath,
        meshIndex,
        primitiveIndex,
        name: typeof mesh.name === "string" && mesh.name.length <= 128 ? mesh.name : `mesh-${meshIndex}`,
        materialIndex: primitive.material === undefined ? null : integer(
          primitive.material,
          0,
          array(parsed.json.materials, "glTF materials").length - 1,
          `mesh ${meshIndex}:${primitiveIndex}.material`,
        ),
        transformsBaked: options.bakeNodeTransforms === true,
        worldMatrix: [...instance.worldMatrix],
        positions: outputPositions,
        ...(outputNormals ? { normals: outputNormals } : {}),
        ...(uv0 ? { uv0 } : {}),
        ...(indices ? { indices } : {}),
      });
    }
  }
  return meshes;
};

export const importProcPlantHeroGlb = (
  source: ArrayBuffer | Uint8Array,
  options: ProcPlantHeroGlbMeshExtractionOptions = {},
): ProcPlantHeroGlbImportPackage => {
  const parsed = parseHeroGlb(source, options);
  const textures = extractTextures(parsed);
  return {
    contract: PROCPLANT_HERO_GLB_IMPORT_CONTRACT,
    version: PROCPLANT_HERO_GLB_IMPORT_VERSION,
    inspection: inspectParsed(parsed, textures),
    meshes: extractProcPlantHeroGlbMeshes(source, options),
    textures,
  };
};
