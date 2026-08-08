export const PROCPLANT_GLB_VALIDATION_CONTRACT = "procplants.glb-validation" as const;
export const PROCPLANT_GLB_VALIDATION_VERSION = 1 as const;

export interface ProcPlantGlbValidationOptions {
  maxBytes?: number;
  maxJsonBytes?: number;
  maxScenes?: number;
  maxNodes?: number;
  maxMeshes?: number;
  maxPrimitives?: number;
  maxAccessors?: number;
  maxBufferViews?: number;
}

export interface ProcPlantGlbValidationReport {
  contract: typeof PROCPLANT_GLB_VALIDATION_CONTRACT;
  version: typeof PROCPLANT_GLB_VALIDATION_VERSION;
  valid: true;
  byteLength: number;
  contentHash: string;
  scenes: number;
  nodes: number;
  meshes: number;
  primitives: number;
  accessors: number;
  bufferViews: number;
  decodedMeshoptViews: number;
  verifiedMeshoptFallbackViews: number;
  procplantMetadataRecords: number;
  variantBundle: boolean;
  extensionsUsed: string[];
  extensionsRequired: string[];
}

type JsonRecord = Record<string, unknown>;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const MESHOPT_EXTENSION = "EXT_meshopt_compression";

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

const boundedOption = (value: number | undefined, fallback: number, label: string, maximum: number) =>
  integer(value ?? fallback, 1, maximum, label);

const componentBytes = (componentType: number) => {
  if (componentType === 5120 || componentType === 5121) return 1;
  if (componentType === 5122 || componentType === 5123) return 2;
  if (componentType === 5125 || componentType === 5126) return 4;
  return 0;
};

const componentCount = (type: unknown) => {
  if (type === "SCALAR") return 1;
  if (type === "VEC2") return 2;
  if (type === "VEC3") return 3;
  if (type === "VEC4" || type === "MAT2") return 4;
  if (type === "MAT3") return 9;
  if (type === "MAT4") return 16;
  return 0;
};

const hashBytes = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const stringArray = (value: unknown, label: string) => {
  const values = array(value, label);
  if (values.some((entry) => typeof entry !== "string" || !entry)) throw new Error(`${label} must contain non-empty strings`);
  if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates`);
  return [...values] as string[];
};

/** Strictly validates the self-contained GLB shape emitted by Procplants exporters. */
export const validateProcPlantGlb = async (
  source: ArrayBuffer | Uint8Array,
  options: ProcPlantGlbValidationOptions = {},
): Promise<ProcPlantGlbValidationReport> => {
  const maxBytes = boundedOption(options.maxBytes, 512 * 1024 * 1024, "maxBytes", 1024 * 1024 * 1024);
  const maxJsonBytes = boundedOption(options.maxJsonBytes, 64 * 1024 * 1024, "maxJsonBytes", 256 * 1024 * 1024);
  const maxScenes = boundedOption(options.maxScenes, 4096, "maxScenes", 65_536);
  const maxNodes = boundedOption(options.maxNodes, 100_000, "maxNodes", 1_000_000);
  const maxMeshes = boundedOption(options.maxMeshes, 100_000, "maxMeshes", 1_000_000);
  const maxPrimitives = boundedOption(options.maxPrimitives, 250_000, "maxPrimitives", 2_000_000);
  const maxAccessors = boundedOption(options.maxAccessors, 500_000, "maxAccessors", 2_000_000);
  const maxBufferViews = boundedOption(options.maxBufferViews, 500_000, "maxBufferViews", 2_000_000);
  const bytes = source instanceof Uint8Array
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  if (bytes.byteLength > maxBytes) throw new Error(`GLB exceeds maxBytes (${bytes.byteLength} > ${maxBytes})`);
  if (bytes.byteLength < 20 || bytes.byteLength % 4 !== 0) throw new Error("GLB is truncated or not 4-byte aligned");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("GLB magic is invalid");
  if (view.getUint32(4, true) !== 2) throw new Error("GLB version must be 2");
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error("GLB header length does not match the file");
  const jsonLength = view.getUint32(12, true);
  if (jsonLength === 0 || jsonLength > maxJsonBytes || jsonLength % 4 !== 0) throw new Error("GLB JSON chunk length is invalid");
  if (view.getUint32(16, true) !== GLB_JSON_CHUNK || 20 + jsonLength > bytes.byteLength) {
    throw new Error("GLB first chunk must be bounded JSON");
  }
  let json: JsonRecord;
  try {
    json = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)).trimEnd()), "glTF root");
  } catch (error) {
    throw new Error(`GLB JSON is invalid (${error instanceof Error ? error.message : String(error)})`);
  }
  let binary: Uint8Array<ArrayBufferLike> = new Uint8Array();
  const binaryHeader = 20 + jsonLength;
  if (binaryHeader < bytes.byteLength) {
    if (binaryHeader + 8 > bytes.byteLength || view.getUint32(binaryHeader + 4, true) !== GLB_BIN_CHUNK) {
      throw new Error("GLB second chunk must be BIN");
    }
    const binaryLength = view.getUint32(binaryHeader, true);
    if (binaryHeader + 8 + binaryLength !== bytes.byteLength || binaryLength % 4 !== 0) {
      throw new Error("GLB BIN chunk length does not match the file");
    }
    binary = bytes.subarray(binaryHeader + 8);
  }
  const asset = record(json.asset, "glTF asset");
  if (asset.version !== "2.0") throw new Error("glTF asset.version must be 2.0");

  const extensionsUsed = stringArray(json.extensionsUsed, "glTF extensionsUsed");
  const extensionsRequired = stringArray(json.extensionsRequired, "glTF extensionsRequired");
  if (extensionsRequired.some((extension) => !extensionsUsed.includes(extension))) {
    throw new Error("glTF extensionsRequired must be a subset of extensionsUsed");
  }
  const unsupportedRequired = extensionsRequired.find((extension) => extension !== MESHOPT_EXTENSION);
  if (unsupportedRequired) throw new Error(`unsupported required glTF extension ${unsupportedRequired}`);

  const scenes = array(json.scenes, "glTF scenes");
  const nodes = array(json.nodes, "glTF nodes");
  const meshes = array(json.meshes, "glTF meshes");
  const accessors = array(json.accessors, "glTF accessors");
  const bufferViews = array(json.bufferViews, "glTF bufferViews");
  const buffers = array(json.buffers, "glTF buffers");
  if (scenes.length > maxScenes) throw new Error(`GLB exceeds maxScenes (${scenes.length} > ${maxScenes})`);
  if (nodes.length > maxNodes) throw new Error(`GLB exceeds maxNodes (${nodes.length} > ${maxNodes})`);
  if (meshes.length > maxMeshes) throw new Error(`GLB exceeds maxMeshes (${meshes.length} > ${maxMeshes})`);
  if (accessors.length > maxAccessors) throw new Error(`GLB exceeds maxAccessors (${accessors.length} > ${maxAccessors})`);
  if (bufferViews.length > maxBufferViews) throw new Error(`GLB exceeds maxBufferViews (${bufferViews.length} > ${maxBufferViews})`);
  if (buffers.length < 1 || buffers.length > 2) throw new Error("Procplants GLB must declare one embedded buffer, plus at most one meshopt virtual buffer");
  const bufferLengths = buffers.map((entry, index) => {
    const buffer = record(entry, `glTF buffers[${index}]`);
    if (buffer.uri !== undefined) throw new Error(`glTF buffers[${index}] must be embedded`);
    return integer(buffer.byteLength, 0, maxBytes, `glTF buffers[${index}].byteLength`);
  });
  if (bufferLengths[0]! > binary.byteLength) throw new Error("glTF embedded buffer exceeds the BIN chunk");

  const decodedViewLengths = new Array<number>(bufferViews.length);
  let decodedMeshoptViews = 0;
  let verifiedMeshoptFallbackViews = 0;
  let decoder: typeof import("meshoptimizer/decoder").MeshoptDecoder | null = null;
  for (let index = 0; index < bufferViews.length; index++) {
    const bufferView = record(bufferViews[index], `glTF bufferViews[${index}]`);
    const bufferIndex = integer(bufferView.buffer, 0, buffers.length - 1, `glTF bufferViews[${index}].buffer`);
    const byteOffset = integer(bufferView.byteOffset ?? 0, 0, maxBytes, `glTF bufferViews[${index}].byteOffset`);
    const byteLength = integer(bufferView.byteLength, 1, maxBytes, `glTF bufferViews[${index}].byteLength`);
    if (byteOffset + byteLength > bufferLengths[bufferIndex]!) {
      throw new Error(`glTF bufferViews[${index}] exceeds its declared buffer`);
    }
    const extensions = bufferView.extensions === undefined ? {} : record(bufferView.extensions, `glTF bufferViews[${index}].extensions`);
    const meshoptValue = extensions[MESHOPT_EXTENSION];
    if (meshoptValue === undefined) {
      if (bufferIndex !== 0 || byteOffset + byteLength > bufferLengths[bufferIndex]!) {
        throw new Error(`glTF bufferViews[${index}] exceeds its embedded buffer`);
      }
      decodedViewLengths[index] = byteLength;
      continue;
    }
    if (!extensionsUsed.includes(MESHOPT_EXTENSION)) throw new Error(`glTF bufferViews[${index}] uses undeclared ${MESHOPT_EXTENSION}`);
    const extension = record(meshoptValue, `glTF bufferViews[${index}].extensions.${MESHOPT_EXTENSION}`);
    const compressedBuffer = integer(extension.buffer, 0, buffers.length - 1, `meshopt view ${index}.buffer`);
    const compressedOffset = integer(extension.byteOffset ?? 0, 0, maxBytes, `meshopt view ${index}.byteOffset`);
    const compressedLength = integer(extension.byteLength, 1, maxBytes, `meshopt view ${index}.byteLength`);
    const stride = integer(extension.byteStride, 1, 256, `meshopt view ${index}.byteStride`);
    const count = integer(extension.count, 1, maxAccessors, `meshopt view ${index}.count`);
    const mode = extension.mode;
    if (mode !== "ATTRIBUTES" && mode !== "TRIANGLES" && mode !== "INDICES") throw new Error(`meshopt view ${index}.mode is invalid`);
    if (extension.filter !== undefined && !["NONE", "OCTAHEDRAL", "QUATERNION", "EXPONENTIAL"].includes(String(extension.filter))) {
      throw new Error(`meshopt view ${index}.filter is invalid`);
    }
    if (compressedBuffer !== 0 || compressedOffset + compressedLength > bufferLengths[0]!) {
      throw new Error(`meshopt view ${index} compressed bytes exceed the embedded buffer`);
    }
    const decodedLength = count * stride;
    if (!Number.isSafeInteger(decodedLength) || decodedLength !== byteLength) {
      throw new Error(`meshopt view ${index} decoded length does not match bufferView.byteLength`);
    }
    if (!decoder) {
      const module = await import("meshoptimizer/decoder");
      decoder = module.MeshoptDecoder;
      await decoder.ready;
    }
    const decoded = new Uint8Array(decodedLength);
    decoder.decodeGltfBuffer(decoded, count, stride, binary.subarray(compressedOffset, compressedOffset + compressedLength), mode, extension.filter as never);
    if (bufferIndex === 0) {
      if (byteOffset + byteLength > bufferLengths[0]!) throw new Error(`meshopt fallback view ${index} exceeds the embedded buffer`);
      const fallback = binary.subarray(byteOffset, byteOffset + byteLength);
      if (fallback.some((byte, offset) => byte !== decoded[offset])) throw new Error(`meshopt fallback view ${index} does not match decoded bytes`);
      verifiedMeshoptFallbackViews++;
    } else if (!extensionsRequired.includes(MESHOPT_EXTENSION)) {
      throw new Error(`meshopt view ${index} requires the extension but it is not declared required`);
    }
    decodedViewLengths[index] = decodedLength;
    decodedMeshoptViews++;
  }

  for (let index = 0; index < accessors.length; index++) {
    const accessor = record(accessors[index], `glTF accessors[${index}]`);
    if (accessor.sparse !== undefined) throw new Error(`glTF accessors[${index}] sparse data is not supported by Procplants validation`);
    const viewIndex = integer(accessor.bufferView, 0, bufferViews.length - 1, `glTF accessors[${index}].bufferView`);
    const count = integer(accessor.count, 1, maxAccessors, `glTF accessors[${index}].count`);
    const bytesPerComponent = componentBytes(integer(accessor.componentType, 5120, 5126, `glTF accessors[${index}].componentType`));
    const components = componentCount(accessor.type);
    if (!bytesPerComponent || !components) throw new Error(`glTF accessors[${index}] has an unsupported componentType or type`);
    const offset = integer(accessor.byteOffset ?? 0, 0, maxBytes, `glTF accessors[${index}].byteOffset`);
    const sourceView = record(bufferViews[viewIndex], `glTF bufferViews[${viewIndex}]`);
    const stride = sourceView.byteStride === undefined
      ? bytesPerComponent * components
      : integer(sourceView.byteStride, bytesPerComponent * components, 252, `glTF bufferViews[${viewIndex}].byteStride`);
    if (offset + (count - 1) * stride + bytesPerComponent * components > decodedViewLengths[viewIndex]!) {
      throw new Error(`glTF accessors[${index}] exceeds its bufferView`);
    }
  }

  let primitives = 0;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
    const mesh = record(meshes[meshIndex], `glTF meshes[${meshIndex}]`);
    const meshPrimitives = array(mesh.primitives, `glTF meshes[${meshIndex}].primitives`);
    primitives += meshPrimitives.length;
    if (primitives > maxPrimitives) throw new Error(`GLB exceeds maxPrimitives (${primitives} > ${maxPrimitives})`);
    for (let primitiveIndex = 0; primitiveIndex < meshPrimitives.length; primitiveIndex++) {
      const primitive = record(meshPrimitives[primitiveIndex], `glTF meshes[${meshIndex}].primitives[${primitiveIndex}]`);
      const attributes = record(primitive.attributes, `glTF meshes[${meshIndex}].primitives[${primitiveIndex}].attributes`);
      if (Object.keys(attributes).length === 0) throw new Error(`glTF mesh primitive ${meshIndex}:${primitiveIndex} has no attributes`);
      for (const [semantic, accessor] of Object.entries(attributes)) {
        integer(accessor, 0, accessors.length - 1, `glTF mesh primitive ${meshIndex}:${primitiveIndex} attribute ${semantic}`);
      }
      if (primitive.indices !== undefined) integer(primitive.indices, 0, accessors.length - 1, `glTF mesh primitive ${meshIndex}:${primitiveIndex} indices`);
    }
  }

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = record(nodes[nodeIndex], `glTF nodes[${nodeIndex}]`);
    if (node.mesh !== undefined) integer(node.mesh, 0, meshes.length - 1, `glTF nodes[${nodeIndex}].mesh`);
    for (const [childIndex, child] of array(node.children, `glTF nodes[${nodeIndex}].children`).entries()) {
      integer(child, 0, nodes.length - 1, `glTF nodes[${nodeIndex}].children[${childIndex}]`);
    }
  }
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = record(scenes[sceneIndex], `glTF scenes[${sceneIndex}]`);
    for (const [rootIndex, root] of array(scene.nodes, `glTF scenes[${sceneIndex}].nodes`).entries()) {
      integer(root, 0, nodes.length - 1, `glTF scenes[${sceneIndex}].nodes[${rootIndex}]`);
    }
  }
  if (json.scene !== undefined) integer(json.scene, 0, scenes.length - 1, "glTF scene");

  let procplantMetadataRecords = 0;
  const inspectExtras = (entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const extras = (entry as JsonRecord).extras;
    if (!extras || typeof extras !== "object" || Array.isArray(extras)) return;
    const procplant = (extras as JsonRecord).procplant;
    if (procplant && typeof procplant === "object" && !Array.isArray(procplant)) {
      const metadata = procplant as JsonRecord;
      if (metadata.contract !== "procplants.glb-export" || metadata.contractVersion !== 1) {
        throw new Error("Procplants GLB metadata has an unsupported contract or version");
      }
      procplantMetadataRecords++;
    }
  };
  scenes.forEach(inspectExtras);
  nodes.forEach(inspectExtras);
  if (procplantMetadataRecords === 0) throw new Error("GLB contains no Procplants export metadata");
  const rootExtras = json.extras === undefined ? {} : record(json.extras, "glTF extras");
  const variantBundle = rootExtras.procplantVariantBundle !== undefined;
  if (variantBundle) {
    const manifest = record(rootExtras.procplantVariantBundle, "glTF extras.procplantVariantBundle");
    if (manifest.contract !== "procplants.variant-bundle" || manifest.version !== 1) {
      throw new Error("Procplants variant bundle metadata has an unsupported contract or version");
    }
    if (manifest.selection !== "select-gltf-scene") throw new Error("Procplants variant bundle selection policy is invalid");
    const defaultScene = integer(manifest.defaultScene, 0, scenes.length - 1, "Procplants variant bundle defaultScene");
    if (json.scene !== defaultScene) throw new Error("Procplants variant bundle defaultScene does not match glTF scene");
    const lodSelection = manifest.lodSelection === "all"
      ? "all"
      : integer(manifest.lodSelection, 0, 3, "Procplants variant bundle lodSelection");
    const variants = array(manifest.variants, "Procplants variant bundle variants");
    if (variants.length === 0 || variants.length > scenes.length) throw new Error("Procplants variant bundle variants count is invalid");
    const names = new Set<string>();
    const mappedScenes = new Set<number>();
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
      const variant = record(variants[variantIndex], `Procplants variant bundle variants[${variantIndex}]`);
      const name = typeof variant.name === "string" ? variant.name : "";
      if (!name || names.has(name)) throw new Error("Procplants variant bundle variant names must be unique and non-empty");
      names.add(name);
      const lods = array(variant.lods, `Procplants variant bundle variant ${name} lods`);
      if (lods.length === 0 || lods.length > 4) throw new Error(`Procplants variant bundle variant ${name} lod count is invalid`);
      const levels = new Set<number>();
      for (let lodIndex = 0; lodIndex < lods.length; lodIndex++) {
        const lod = record(lods[lodIndex], `Procplants variant bundle variant ${name} lods[${lodIndex}]`);
        const level = integer(lod.level, 0, 3, `Procplants variant bundle variant ${name} LOD level`);
        const scene = integer(lod.scene, 0, scenes.length - 1, `Procplants variant bundle variant ${name} scene`);
        if (levels.has(level) || mappedScenes.has(scene)) throw new Error("Procplants variant bundle LOD/scene mappings must be unique");
        if (lodSelection !== "all" && level !== lodSelection) throw new Error("Procplants variant bundle LOD mapping conflicts with lodSelection");
        levels.add(level);
        mappedScenes.add(scene);
      }
    }
    if (mappedScenes.size !== scenes.length) throw new Error("Procplants variant bundle must map every glTF scene exactly once");
  }
  return {
    contract: PROCPLANT_GLB_VALIDATION_CONTRACT,
    version: PROCPLANT_GLB_VALIDATION_VERSION,
    valid: true,
    byteLength: bytes.byteLength,
    contentHash: hashBytes(bytes),
    scenes: scenes.length,
    nodes: nodes.length,
    meshes: meshes.length,
    primitives,
    accessors: accessors.length,
    bufferViews: bufferViews.length,
    decodedMeshoptViews,
    verifiedMeshoptFallbackViews,
    procplantMetadataRecords,
    variantBundle,
    extensionsUsed,
    extensionsRequired,
  };
};
