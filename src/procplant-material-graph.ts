export const PROCPLANT_MATERIAL_GRAPH_CONTRACT = "procplants.material-graph" as const;
export const PROCPLANT_MATERIAL_GRAPH_VERSION = 1 as const;
export const PROCPLANT_COMPILED_MATERIAL_CONTRACT = "procplants.compiled-material-graph" as const;
export const PROCPLANT_COMPILED_MATERIAL_VERSION = 1 as const;

export type ProcPlantMaterialValueType = "scalar" | "color" | "normal";
export type ProcPlantMaterialChannel =
  | "baseColor"
  | "normal"
  | "roughness"
  | "metalness"
  | "opacity"
  | "height"
  | "ambientOcclusion"
  | "emissive"
  | "mossMask"
  | "lichenMask"
  | "wetnessMask"
  | "snowMask";

export interface ProcPlantMaterialTexture {
  id: string;
  uri: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/avif" | "image/ktx2";
  role: "color" | "data" | "normal" | "height";
  colorSpace: "srgb" | "linear";
  width?: number;
  height?: number;
  byteLength?: number;
  uvSet?: 0 | 1;
  wrapS?: "repeat" | "clamp" | "mirror";
  wrapT?: "repeat" | "clamp" | "mirror";
  offset?: readonly [number, number];
  scale?: readonly [number, number];
  rotation?: number;
}

interface ProcPlantMaterialNodeBase {
  id: string;
}

export interface ProcPlantMaterialScalarNode extends ProcPlantMaterialNodeBase {
  kind: "scalar";
  value: number;
}

export interface ProcPlantMaterialColorNode extends ProcPlantMaterialNodeBase {
  kind: "color";
  value: readonly [number, number, number] | readonly [number, number, number, number];
}

export interface ProcPlantMaterialTextureSampleNode extends ProcPlantMaterialNodeBase {
  kind: "texture-sample";
  texture: string;
  channel: "r" | "g" | "b" | "a" | "rgb" | "normal";
}

export interface ProcPlantMaterialNoiseNode extends ProcPlantMaterialNodeBase {
  kind: "noise";
  noise: "fbm" | "ridge" | "cellular";
  seed: number;
  scale: number;
  octaves: number;
  lacunarity?: number;
  gain?: number;
}

export interface ProcPlantMaterialMultiplyNode extends ProcPlantMaterialNodeBase {
  kind: "multiply";
  a: string;
  b: string;
}

export interface ProcPlantMaterialMixNode extends ProcPlantMaterialNodeBase {
  kind: "mix";
  a: string;
  b: string;
  factor: string;
}

export interface ProcPlantMaterialOneMinusNode extends ProcPlantMaterialNodeBase {
  kind: "one-minus";
  input: string;
}

export interface ProcPlantMaterialClampNode extends ProcPlantMaterialNodeBase {
  kind: "clamp";
  input: string;
  min?: number;
  max?: number;
}

export interface ProcPlantMaterialRemapNode extends ProcPlantMaterialNodeBase {
  kind: "remap";
  input: string;
  inMin: number;
  inMax: number;
  outMin: number;
  outMax: number;
}

export type ProcPlantMaterialNode =
  | ProcPlantMaterialScalarNode
  | ProcPlantMaterialColorNode
  | ProcPlantMaterialTextureSampleNode
  | ProcPlantMaterialNoiseNode
  | ProcPlantMaterialMultiplyNode
  | ProcPlantMaterialMixNode
  | ProcPlantMaterialOneMinusNode
  | ProcPlantMaterialClampNode
  | ProcPlantMaterialRemapNode;

export interface ProcPlantMaterialSurface {
  slot: string;
  channels: Partial<Record<ProcPlantMaterialChannel, string>>;
  doubleSided?: boolean;
  alphaMode?: "opaque" | "mask" | "blend";
  alphaCutoff?: number;
}

export interface ProcPlantMaterialGraph {
  contract: typeof PROCPLANT_MATERIAL_GRAPH_CONTRACT;
  version: typeof PROCPLANT_MATERIAL_GRAPH_VERSION;
  id: string;
  textures: readonly ProcPlantMaterialTexture[];
  nodes: readonly ProcPlantMaterialNode[];
  surfaces: readonly ProcPlantMaterialSurface[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ProcPlantMaterialCompileOptions {
  maxNodes?: number;
  maxEdges?: number;
  maxTextures?: number;
  maxSurfaces?: number;
  maxTextureBytes?: number;
  rejectUnused?: boolean;
}

export interface ProcPlantCompiledMaterialNode {
  index: number;
  id: string;
  kind: ProcPlantMaterialNode["kind"];
  valueType: ProcPlantMaterialValueType;
  dependencies: number[];
  parameters: Record<string, string | number | readonly number[]>;
}

export type ProcPlantMaterialBindingPlan =
  | { kind: "constant"; valueType: ProcPlantMaterialValueType; value: number | readonly number[] }
  | { kind: "texture"; valueType: ProcPlantMaterialValueType; texture: number; channel: ProcPlantMaterialTextureSampleNode["channel"] }
  | {
      kind: "factor-texture";
      valueType: "scalar" | "color";
      factor: number | readonly number[];
      texture: number;
      channel: ProcPlantMaterialTextureSampleNode["channel"];
    }
  | { kind: "expression"; valueType: ProcPlantMaterialValueType; node: number; requiresBake: true };

export interface ProcPlantCompiledMaterialSurface {
  slot: string;
  doubleSided: boolean;
  alphaMode: "opaque" | "mask" | "blend";
  alphaCutoff: number;
  channels: Partial<Record<ProcPlantMaterialChannel, number>>;
  bindings: Partial<Record<ProcPlantMaterialChannel, ProcPlantMaterialBindingPlan>>;
}

export interface ProcPlantCompiledMaterialGraph {
  contract: typeof PROCPLANT_COMPILED_MATERIAL_CONTRACT;
  version: typeof PROCPLANT_COMPILED_MATERIAL_VERSION;
  sourceContract: typeof PROCPLANT_MATERIAL_GRAPH_CONTRACT;
  sourceVersion: typeof PROCPLANT_MATERIAL_GRAPH_VERSION;
  id: string;
  contentHash: string;
  textures: ProcPlantMaterialTexture[];
  nodes: ProcPlantCompiledMaterialNode[];
  surfaces: ProcPlantCompiledMaterialSurface[];
  metadata: Record<string, string | number | boolean | null>;
  diagnostics: string[];
  requirements: {
    textureCount: number;
    estimatedTextureBytes: number;
    expressionBakeCount: number;
    usesProceduralNoise: boolean;
    usesUv1: boolean;
  };
}

const CHANNEL_TYPES: Record<ProcPlantMaterialChannel, ProcPlantMaterialValueType> = {
  baseColor: "color",
  normal: "normal",
  roughness: "scalar",
  metalness: "scalar",
  opacity: "scalar",
  height: "scalar",
  ambientOcclusion: "scalar",
  emissive: "color",
  mossMask: "scalar",
  lichenMask: "scalar",
  wetnessMask: "scalar",
  snowMask: "scalar",
};

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const TEXTURE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/ktx2"]);
const TEXTURE_ROLES = new Set(["color", "data", "normal", "height"]);
const COLOR_SPACES = new Set(["srgb", "linear"]);
const WRAP_MODES = new Set(["repeat", "clamp", "mirror"]);
const NODE_KINDS = new Set(["scalar", "color", "texture-sample", "noise", "multiply", "mix", "one-minus", "clamp", "remap"]);
const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};
const bounded = (value: number, min: number, max: number, label: string) => {
  finite(value, label);
  if (value < min || value > max) throw new Error(`${label} must be in [${min}, ${max}]`);
  return value;
};
const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  return value;
};
const identifier = (value: string, label: string) => {
  if (!IDENTIFIER.test(value)) throw new Error(`${label} must match ${IDENTIFIER}`);
  return value;
};
const canonicalRecord = <T>(record: Record<string, T>) => Object.fromEntries(
  Object.entries(record).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
) as Record<string, T>;

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
};

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};

const dependenciesFor = (node: ProcPlantMaterialNode) => {
  if (node.kind === "multiply") return [node.a, node.b];
  if (node.kind === "mix") return [node.a, node.b, node.factor];
  if (node.kind === "one-minus" || node.kind === "clamp" || node.kind === "remap") return [node.input];
  return [];
};

const canonicalTexture = (texture: ProcPlantMaterialTexture, index: number): ProcPlantMaterialTexture => {
  identifier(texture.id, `textures[${index}].id`);
  if (typeof texture.uri !== "string" || texture.uri.length === 0 || texture.uri.length > 2048 || /[\u0000-\u001f]/.test(texture.uri)) {
    throw new Error(`textures[${index}].uri must be a non-empty safe URI of at most 2048 characters`);
  }
  if (/^(?:javascript|data|blob):/i.test(texture.uri)) throw new Error(`textures[${index}].uri uses a disallowed scheme`);
  if (!TEXTURE_MIME_TYPES.has(texture.mimeType)) throw new Error(`textures[${index}].mimeType is unsupported`);
  if (!TEXTURE_ROLES.has(texture.role)) throw new Error(`textures[${index}].role is unsupported`);
  if (!COLOR_SPACES.has(texture.colorSpace)) throw new Error(`textures[${index}].colorSpace is unsupported`);
  if (texture.role === "normal" && texture.colorSpace !== "linear") throw new Error(`${texture.id} normal textures must use linear color space`);
  if (texture.role === "data" || texture.role === "height") {
    if (texture.colorSpace !== "linear") throw new Error(`${texture.id} data textures must use linear color space`);
  }
  const tuple = (value: readonly [number, number] | undefined, label: string, positive: boolean) => {
    if (!value) return undefined;
    if (value.length !== 2) throw new Error(`${label} must have exactly 2 components`);
    return value.map((entry, component) => positive
      ? bounded(entry, 1e-6, 1e6, `${label}[${component}]`)
      : bounded(entry, -1e6, 1e6, `${label}[${component}]`)) as [number, number];
  };
  if (texture.uvSet !== undefined && texture.uvSet !== 0 && texture.uvSet !== 1) throw new Error(`${texture.id}.uvSet must be 0 or 1`);
  if (texture.wrapS !== undefined && !WRAP_MODES.has(texture.wrapS)) throw new Error(`${texture.id}.wrapS is unsupported`);
  if (texture.wrapT !== undefined && !WRAP_MODES.has(texture.wrapT)) throw new Error(`${texture.id}.wrapT is unsupported`);
  return {
    id: texture.id,
    uri: texture.uri,
    mimeType: texture.mimeType,
    role: texture.role,
    colorSpace: texture.colorSpace,
    ...(texture.width === undefined ? {} : { width: integer(texture.width, 1, 16384, `${texture.id}.width`) }),
    ...(texture.height === undefined ? {} : { height: integer(texture.height, 1, 16384, `${texture.id}.height`) }),
    ...(texture.byteLength === undefined ? {} : { byteLength: integer(texture.byteLength, 0, 512 * 1024 * 1024, `${texture.id}.byteLength`) }),
    uvSet: texture.uvSet ?? 0,
    wrapS: texture.wrapS ?? "repeat",
    wrapT: texture.wrapT ?? "repeat",
    ...(texture.offset ? { offset: tuple(texture.offset, `${texture.id}.offset`, false)! } : {}),
    ...(texture.scale ? { scale: tuple(texture.scale, `${texture.id}.scale`, true)! } : {}),
    ...(texture.rotation === undefined ? {} : { rotation: bounded(texture.rotation, -Math.PI * 2, Math.PI * 2, `${texture.id}.rotation`) }),
  };
};

const nodeParameters = (
  node: ProcPlantMaterialNode,
  textureIndex: Map<string, number>,
): Record<string, string | number | readonly number[]> => {
  if (node.kind === "scalar") return { value: bounded(node.value, -1e6, 1e6, `${node.id}.value`) };
  if (node.kind === "color") {
    if (node.value.length !== 3 && node.value.length !== 4) throw new Error(`${node.id}.value must have 3 or 4 components`);
    return { value: node.value.map((value, index) => bounded(value, 0, 16, `${node.id}.value[${index}]`)) };
  }
  if (node.kind === "texture-sample") {
    const texture = textureIndex.get(node.texture);
    if (texture === undefined) throw new Error(`${node.id} references missing texture ${node.texture}`);
    if (!["r", "g", "b", "a", "rgb", "normal"].includes(node.channel)) throw new Error(`${node.id}.channel is unsupported`);
    return { texture, channel: node.channel };
  }
  if (node.kind === "noise") {
    if (node.noise !== "fbm" && node.noise !== "ridge" && node.noise !== "cellular") {
      throw new Error(`${node.id}.noise is unsupported`);
    }
    return {
      noise: node.noise,
      seed: integer(node.seed, 0, 0xffffffff, `${node.id}.seed`),
      scale: bounded(node.scale, 1e-4, 1e6, `${node.id}.scale`),
      octaves: integer(node.octaves, 1, 12, `${node.id}.octaves`),
      lacunarity: bounded(node.lacunarity ?? 2, 1, 8, `${node.id}.lacunarity`),
      gain: bounded(node.gain ?? 0.5, 0, 1, `${node.id}.gain`),
    };
  }
  if (node.kind === "clamp") {
    const min = bounded(node.min ?? 0, -1e6, 1e6, `${node.id}.min`);
    const max = bounded(node.max ?? 1, -1e6, 1e6, `${node.id}.max`);
    if (min > max) throw new Error(`${node.id}.min must not exceed max`);
    return { min, max };
  }
  if (node.kind === "remap") {
    const inMin = bounded(node.inMin, -1e6, 1e6, `${node.id}.inMin`);
    const inMax = bounded(node.inMax, -1e6, 1e6, `${node.id}.inMax`);
    if (inMin === inMax) throw new Error(`${node.id} remap input range must be non-zero`);
    return {
      inMin,
      inMax,
      outMin: bounded(node.outMin, -1e6, 1e6, `${node.id}.outMin`),
      outMax: bounded(node.outMax, -1e6, 1e6, `${node.id}.outMax`),
    };
  }
  return {};
};

const multiplyType = (left: ProcPlantMaterialValueType, right: ProcPlantMaterialValueType, id: string) => {
  if (left === "normal" || right === "normal") throw new Error(`${id} cannot multiply normal values`);
  if (left === right) return left;
  if (left === "scalar" && right === "color" || left === "color" && right === "scalar") return "color";
  throw new Error(`${id} has incompatible multiply inputs ${left} and ${right}`);
};

const evaluateConstant = (
  node: ProcPlantCompiledMaterialNode,
  constants: Map<number, number | readonly number[]>,
) => {
  const values = node.dependencies.map((dependency) => constants.get(dependency));
  if (node.kind === "scalar" || node.kind === "color") return node.parameters.value as number | readonly number[];
  if (values.some((value) => value === undefined)) return undefined;
  const vectorize = (value: number | readonly number[], length: number) => typeof value === "number"
    ? Array.from({ length }, () => value)
    : value.length === length ? [...value]
      : value.length === 3 && length === 4 ? [...value, 1]
        : value.slice(0, length);
  const binary = (left: number | readonly number[], right: number | readonly number[], operation: (a: number, b: number) => number) => {
    if (typeof left === "number" && typeof right === "number") return operation(left, right);
    const length = Math.max(typeof left === "number" ? 1 : left.length, typeof right === "number" ? 1 : right.length);
    const actualLength = length === 1 ? 4 : length;
    const a = vectorize(left, actualLength);
    const b = vectorize(right, actualLength);
    return a.map((value, index) => operation(value, b[index]!));
  };
  if (node.kind === "multiply") return binary(values[0]!, values[1]!, (a, b) => a * b);
  if (node.kind === "mix") {
    const factor = values[2];
    if (typeof factor !== "number") return undefined;
    return binary(values[0]!, values[1]!, (a, b) => a + (b - a) * factor);
  }
  if (node.kind === "one-minus") {
    const value = values[0]!;
    return typeof value === "number" ? 1 - value : value.map((entry) => 1 - entry);
  }
  if (node.kind === "clamp") {
    const value = values[0]!;
    const min = node.parameters.min as number;
    const max = node.parameters.max as number;
    return typeof value === "number" ? Math.min(max, Math.max(min, value)) : value.map((entry) => Math.min(max, Math.max(min, entry)));
  }
  if (node.kind === "remap") {
    const value = values[0]!;
    const { inMin, inMax, outMin, outMax } = node.parameters as Record<string, number>;
    const remap = (entry: number) => outMin + ((entry - inMin) / (inMax - inMin)) * (outMax - outMin);
    return typeof value === "number" ? remap(value) : value.map(remap);
  }
  return undefined;
};

/** Validate and compile the material graph without mutating the authoring document. */
export const compileProcPlantMaterialGraph = (
  source: ProcPlantMaterialGraph,
  options: ProcPlantMaterialCompileOptions = {},
): ProcPlantCompiledMaterialGraph => {
  if (source.contract !== PROCPLANT_MATERIAL_GRAPH_CONTRACT || source.version !== PROCPLANT_MATERIAL_GRAPH_VERSION) {
    throw new Error("unsupported procplant material graph contract/version");
  }
  if (!Array.isArray(source.nodes) || !Array.isArray(source.textures) || !Array.isArray(source.surfaces)) {
    throw new Error("material graph textures, nodes, and surfaces must be arrays");
  }
  identifier(source.id, "graph.id");
  const maxNodes = integer(options.maxNodes ?? 256, 1, 4096, "maxNodes");
  const maxEdges = integer(options.maxEdges ?? 1024, 1, 16384, "maxEdges");
  const maxTextures = integer(options.maxTextures ?? 64, 0, 512, "maxTextures");
  const maxSurfaces = integer(options.maxSurfaces ?? 16, 1, 128, "maxSurfaces");
  const maxTextureBytes = integer(options.maxTextureBytes ?? 512 * 1024 * 1024, 0, 1024 * 1024 * 1024, "maxTextureBytes");
  if (source.nodes.length > maxNodes) throw new Error(`material graph exceeds maxNodes (${source.nodes.length} > ${maxNodes})`);
  if (source.textures.length > maxTextures) throw new Error(`material graph exceeds maxTextures (${source.textures.length} > ${maxTextures})`);
  if (source.surfaces.length === 0 || source.surfaces.length > maxSurfaces) throw new Error(`material graph surfaces must contain 1-${maxSurfaces} entries`);

  const textures = source.textures.map(canonicalTexture).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const textureIndex = new Map<string, number>();
  for (let index = 0; index < textures.length; index++) {
    if (textureIndex.has(textures[index]!.id)) throw new Error(`duplicate texture id ${textures[index]!.id}`);
    textureIndex.set(textures[index]!.id, index);
  }
  const estimatedTextureBytes = textures.reduce((sum, texture) => sum + (
    texture.byteLength ?? (texture.width && texture.height ? texture.width * texture.height * 4 : 0)
  ), 0);
  if (estimatedTextureBytes > maxTextureBytes) throw new Error(`material graph exceeds maxTextureBytes (${estimatedTextureBytes} > ${maxTextureBytes})`);

  const nodesById = new Map<string, ProcPlantMaterialNode>();
  let edgeCount = 0;
  for (const node of source.nodes) {
    identifier(node.id, "node.id");
    if (!NODE_KINDS.has(node.kind)) throw new Error(`${node.id}.kind is unsupported`);
    if (nodesById.has(node.id)) throw new Error(`duplicate material node id ${node.id}`);
    nodesById.set(node.id, node);
    edgeCount += dependenciesFor(node).length;
  }
  if (edgeCount > maxEdges) throw new Error(`material graph exceeds maxEdges (${edgeCount} > ${maxEdges})`);
  for (const node of source.nodes) {
    for (const dependency of dependenciesFor(node)) {
      if (!nodesById.has(dependency)) throw new Error(`${node.id} references missing node ${dependency}`);
    }
    const parameters = nodeParameters(node, textureIndex);
    if (node.kind === "texture-sample") {
      const texture = textures[parameters.texture as number]!;
      if (node.channel === "normal" && texture.role !== "normal") throw new Error(`${node.id} normal samples require a normal texture`);
      if (texture.role === "normal" && node.channel !== "normal") throw new Error(`${node.id} must sample normal textures through the normal channel`);
      if (node.channel === "rgb" && texture.role !== "color") throw new Error(`${node.id} rgb samples require a color texture`);
    }
  }

  const surfaceSlots = new Set<string>();
  const roots = new Set<string>();
  for (const surface of source.surfaces) {
    identifier(surface.slot, "surface.slot");
    if (surfaceSlots.has(surface.slot)) throw new Error(`duplicate material surface slot ${surface.slot}`);
    surfaceSlots.add(surface.slot);
    if (!surface.channels || typeof surface.channels !== "object" || Array.isArray(surface.channels)) throw new Error(`${surface.slot}.channels must be an object`);
    if (Object.keys(surface.channels).length === 0) throw new Error(`${surface.slot} must bind at least one material channel`);
    for (const [channel, nodeId] of Object.entries(surface.channels) as Array<[string, string]>) {
      if (!(channel in CHANNEL_TYPES)) throw new Error(`${surface.slot} has unsupported channel ${channel}`);
      if (!nodesById.has(nodeId)) throw new Error(`${surface.slot}.${channel} references missing node ${nodeId}`);
      roots.add(nodeId);
    }
    if (surface.alphaMode !== undefined && surface.alphaMode !== "opaque" && surface.alphaMode !== "mask" && surface.alphaMode !== "blend") {
      throw new Error(`${surface.slot}.alphaMode is unsupported`);
    }
    if (surface.doubleSided !== undefined && typeof surface.doubleSided !== "boolean") {
      throw new Error(`${surface.slot}.doubleSided must be boolean`);
    }
    if (surface.alphaCutoff !== undefined) bounded(surface.alphaCutoff, 0, 1, `${surface.slot}.alphaCutoff`);
  }

  const state = new Map<string, 0 | 1 | 2>();
  const reachable = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 1) throw new Error(`material graph cycle: ${[...path, id].join(" -> ")}`);
    if (state.get(id) === 2) return;
    state.set(id, 1);
    const node = nodesById.get(id)!;
    for (const dependency of dependenciesFor(node).slice().sort()) visit(dependency, [...path, id]);
    state.set(id, 2);
    reachable.add(id);
  };
  for (const root of [...roots].sort()) visit(root, []);
  const unused = [...nodesById.keys()].filter((id) => !reachable.has(id)).sort();
  if (options.rejectUnused && unused.length) throw new Error(`unused material nodes: ${unused.join(", ")}`);

  const remaining = new Set(reachable);
  const ordered: ProcPlantMaterialNode[] = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((id) => dependenciesFor(nodesById.get(id)!).every((dependency) => !remaining.has(dependency)))
      .sort();
    if (!ready.length) throw new Error("material graph topological ordering failed");
    for (const id of ready) {
      ordered.push(nodesById.get(id)!);
      remaining.delete(id);
    }
  }
  const compiledIndex = new Map<string, number>();
  const valueTypes = new Map<string, ProcPlantMaterialValueType>();
  const nodes: ProcPlantCompiledMaterialNode[] = [];
  for (const node of ordered) {
    const dependencies = dependenciesFor(node).map((id) => compiledIndex.get(id)!);
    let valueType: ProcPlantMaterialValueType;
    if (node.kind === "scalar" || node.kind === "noise") valueType = "scalar";
    else if (node.kind === "color") valueType = "color";
    else if (node.kind === "texture-sample") valueType = node.channel === "rgb" ? "color" : node.channel === "normal" ? "normal" : "scalar";
    else if (node.kind === "multiply") valueType = multiplyType(valueTypes.get(node.a)!, valueTypes.get(node.b)!, node.id);
    else if (node.kind === "mix") {
      const a = valueTypes.get(node.a)!;
      const b = valueTypes.get(node.b)!;
      if (a !== b || a === "normal") throw new Error(`${node.id} mix inputs must have the same scalar or color type`);
      if (valueTypes.get(node.factor) !== "scalar") throw new Error(`${node.id} mix factor must be scalar`);
      valueType = a;
    } else if (node.kind === "remap") {
      if (valueTypes.get(node.input) !== "scalar") throw new Error(`${node.id} remap input must be scalar`);
      valueType = "scalar";
    } else {
      valueType = valueTypes.get(node.input)!;
      if (valueType === "normal") throw new Error(`${node.id} cannot process normal values`);
    }
    const index = nodes.length;
    compiledIndex.set(node.id, index);
    valueTypes.set(node.id, valueType);
    nodes.push({ index, id: node.id, kind: node.kind, valueType, dependencies, parameters: nodeParameters(node, textureIndex) });
  }

  const constants = new Map<number, number | readonly number[]>();
  for (const node of nodes) {
    const value = evaluateConstant(node, constants);
    if (value !== undefined) constants.set(node.index, value);
  }
  const bindingFor = (nodeIndex: number): ProcPlantMaterialBindingPlan => {
    const node = nodes[nodeIndex]!;
    const constant = constants.get(nodeIndex);
    if (constant !== undefined) return { kind: "constant", valueType: node.valueType, value: constant };
    if (node.kind === "texture-sample") return {
      kind: "texture",
      valueType: node.valueType,
      texture: node.parameters.texture as number,
      channel: node.parameters.channel as ProcPlantMaterialTextureSampleNode["channel"],
    };
    if (node.kind === "multiply") {
      const [left, right] = node.dependencies;
      const constantIndex = constants.has(left!) ? left! : constants.has(right!) ? right! : -1;
      const textureNode = nodes[constantIndex === left ? right! : left!];
      if (constantIndex >= 0 && textureNode?.kind === "texture-sample" && node.valueType !== "normal") {
        return {
          kind: "factor-texture",
          valueType: node.valueType,
          factor: constants.get(constantIndex)!,
          texture: textureNode.parameters.texture as number,
          channel: textureNode.parameters.channel as ProcPlantMaterialTextureSampleNode["channel"],
        };
      }
    }
    return { kind: "expression", valueType: node.valueType, node: nodeIndex, requiresBake: true };
  };

  const surfaces = source.surfaces
    .map((surface): ProcPlantCompiledMaterialSurface => {
      const channels: Partial<Record<ProcPlantMaterialChannel, number>> = {};
      const bindings: Partial<Record<ProcPlantMaterialChannel, ProcPlantMaterialBindingPlan>> = {};
      for (const [channel, nodeId] of (Object.entries(surface.channels) as Array<[string, string]>).sort(([left], [right]) => left < right ? -1 : 1)) {
        const typedChannel = channel as ProcPlantMaterialChannel;
        const nodeIndex = compiledIndex.get(nodeId)!;
        const actual = nodes[nodeIndex]!.valueType;
        if (actual !== CHANNEL_TYPES[typedChannel]) {
          throw new Error(`${surface.slot}.${channel} requires ${CHANNEL_TYPES[typedChannel]} but ${nodeId} produces ${actual}`);
        }
        channels[typedChannel] = nodeIndex;
        bindings[typedChannel] = bindingFor(nodeIndex);
      }
      return {
        slot: surface.slot,
        doubleSided: surface.doubleSided ?? false,
        alphaMode: surface.alphaMode ?? "opaque",
        alphaCutoff: surface.alphaMode === "mask" ? surface.alphaCutoff ?? 0.5 : 0,
        channels,
        bindings,
      };
    })
    .sort((left, right) => left.slot < right.slot ? -1 : left.slot > right.slot ? 1 : 0);
  if (source.metadata && (typeof source.metadata !== "object" || Array.isArray(source.metadata))) throw new Error("graph.metadata must be an object");
  const metadataEntries = Object.entries(source.metadata ?? {});
  if (metadataEntries.length > 64) throw new Error("graph.metadata supports at most 64 entries");
  for (const [key, value] of metadataEntries) {
    if (key.length === 0 || key.length > 64 || /[\u0000-\u001f]/.test(key)) throw new Error("graph.metadata keys must be safe and at most 64 characters");
    if (typeof value === "string" && value.length > 1024) throw new Error(`graph.metadata.${key} exceeds 1024 characters`);
    if (typeof value === "number") finite(value, `graph.metadata.${key}`);
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`graph.metadata.${key} must be string, number, boolean, or null`);
    }
  }
  const metadata = canonicalRecord(source.metadata ?? {});
  const diagnostics = unused.map((id) => `unused node omitted: ${id}`);
  const resultWithoutHash = {
    contract: PROCPLANT_COMPILED_MATERIAL_CONTRACT,
    version: PROCPLANT_COMPILED_MATERIAL_VERSION,
    sourceContract: source.contract,
    sourceVersion: source.version,
    id: source.id,
    textures,
    nodes,
    surfaces,
    metadata,
    diagnostics,
    requirements: {
      textureCount: textures.length,
      estimatedTextureBytes,
      expressionBakeCount: surfaces.reduce((sum, surface) => sum + Object.values(surface.bindings).filter((binding) => binding?.kind === "expression").length, 0),
      usesProceduralNoise: nodes.some((node) => node.kind === "noise"),
      usesUv1: textures.some((texture) => texture.uvSet === 1),
    },
  };
  return {
    ...resultWithoutHash,
    contentHash: fnv1a(canonicalJson(resultWithoutHash)),
  };
};
