import {
  PROCPLANT_COMPILED_MATERIAL_CONTRACT,
  PROCPLANT_COMPILED_MATERIAL_VERSION,
  type ProcPlantCompiledMaterialGraph,
  type ProcPlantCompiledMaterialNode,
  type ProcPlantMaterialChannel,
  type ProcPlantMaterialValueType,
} from "./procplant-material-graph";

export const PROCPLANT_MATERIAL_SHADER_CONTRACT = "procplants.material-shader" as const;
export const PROCPLANT_MATERIAL_SHADER_VERSION = 1 as const;

export interface ProcPlantMaterialShaderCompileOptions {
  maxNodes?: number;
  maxSurfaces?: number;
  maxTextures?: number;
  maxOperations?: number;
  maxNoiseOctaves?: number;
  maxGlslBytes?: number;
}

export interface ProcPlantMaterialShaderDiagnostic {
  code: "delegated-normal" | "unsupported-channel" | "unsupported-uv-set" | "resource-cap";
  blocking: boolean;
  surface?: string;
  channel?: ProcPlantMaterialChannel;
  node?: string;
  message: string;
}

export interface ProcPlantMaterialShaderSurfacePlan {
  slot: string;
  index: number;
  functionName: string;
  fragmentPrelude: string;
  textureIds: string[];
  channels: Partial<Record<ProcPlantMaterialChannel, number>>;
  operationCount: number;
  glslBytes: number;
}

export interface ProcPlantMaterialShaderPlan {
  contract: typeof PROCPLANT_MATERIAL_SHADER_CONTRACT;
  version: typeof PROCPLANT_MATERIAL_SHADER_VERSION;
  sourceContract: typeof PROCPLANT_COMPILED_MATERIAL_CONTRACT;
  sourceVersion: typeof PROCPLANT_COMPILED_MATERIAL_VERSION;
  sourceId: string;
  sourceContentHash: string;
  ready: boolean;
  diagnostics: ProcPlantMaterialShaderDiagnostic[];
  textures: Array<{ index: number; id: string; colorSpace: "srgb" | "linear" }>;
  surfaces: ProcPlantMaterialShaderSurfacePlan[];
  contentHash: string;
}

const SUPPORTED_CHANNELS = new Set<ProcPlantMaterialChannel>([
  "baseColor", "roughness", "metalness", "opacity", "ambientOcclusion", "emissive", "normal",
]);
const integer = (value: number, fallback: number, min: number, max: number, label: string) => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  return resolved;
};
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
};
const hashText = (value: string) => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};
const float = (value: number) => {
  if (!Number.isFinite(value)) throw new Error("shader numeric literal must be finite");
  const text = Number(value.toPrecision(10)).toString();
  return /[.eE]/.test(text) ? text : `${text}.0`;
};
const vector = (value: readonly number[], length = 3) => `vec${length}(${Array.from({ length }, (_, index) => float(value[index] ?? (index === 3 ? 1 : 0))).join(", ")})`;
const glslType = (valueType: ProcPlantMaterialValueType) => valueType === "scalar" ? "float" : valueType === "color" ? "vec3" : "vec3";
const nodeVariable = (index: number) => `ppNode_${index}`;
const textureUniform = (index: number) => `procplantTexture_${index}`;

const NOISE_GLSL = `
float ppHash(vec2 p, float seed) {
  return fract(sin(dot(p + vec2(seed * 0.001, seed * 0.0037), vec2(127.1, 311.7))) * 43758.5453123);
}
float ppValueNoise(vec2 p, float seed) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = ppHash(i, seed); float b = ppHash(i + vec2(1.0, 0.0), seed);
  float c = ppHash(i + vec2(0.0, 1.0), seed); float d = ppHash(i + vec2(1.0), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float ppCellularNoise(vec2 p, float seed) {
  vec2 base = floor(p); float nearest = 2.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 cell = base + vec2(float(x), float(y));
    vec2 point = cell + vec2(ppHash(cell, seed), ppHash(cell, seed + 19.19));
    nearest = min(nearest, length(p - point));
  }
  return clamp(nearest * 0.7071067812, 0.0, 1.0);
}
vec3 ppSrgbToLinear(vec3 value) {
  return mix(pow(value * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), value * 0.0773993808, lessThanEqual(value, vec3(0.04045)));
}`.trim();

const wrapComponent = (expression: string, mode: "repeat" | "clamp" | "mirror") => mode === "clamp"
  ? `clamp(${expression}, 0.0, 1.0)`
  : mode === "mirror"
    ? `(1.0 - abs(mod(${expression}, 2.0) - 1.0))`
    : `fract(${expression})`;

const textureUvExpression = (texture: ProcPlantCompiledMaterialGraph["textures"][number]) => {
  const scale = texture.scale ?? [1, 1];
  const offset = texture.offset ?? [0, 0];
  const rotation = texture.rotation ?? 0;
  const x = `(cos(${float(rotation)}) * (ppUv.x * ${float(scale[0])}) - sin(${float(rotation)}) * (ppUv.y * ${float(scale[1])}) + ${float(offset[0])})`;
  const y = `(sin(${float(rotation)}) * (ppUv.x * ${float(scale[0])}) + cos(${float(rotation)}) * (ppUv.y * ${float(scale[1])}) + ${float(offset[1])})`;
  return `vec2(${wrapComponent(x, texture.wrapS ?? "repeat")}, ${wrapComponent(y, texture.wrapT ?? "repeat")})`;
};

const noiseExpression = (node: ProcPlantCompiledMaterialNode) => {
  const kind = node.parameters.noise as "fbm" | "ridge" | "cellular";
  const octaves = node.parameters.octaves as number;
  const scale = node.parameters.scale as number;
  const lacunarity = node.parameters.lacunarity as number;
  const gain = node.parameters.gain as number;
  const seed = (node.parameters.seed as number) % 65_521;
  let frequency = scale;
  let amplitude = 1;
  let weight = 0;
  const terms: string[] = [];
  for (let octave = 0; octave < octaves; octave++) {
    const sample = kind === "cellular"
      ? `ppCellularNoise(ppUv * ${float(frequency)}, ${float(seed + octave)})`
      : `ppValueNoise(ppUv * ${float(frequency)}, ${float(seed + octave)})`;
    terms.push(`${kind === "ridge" ? `(1.0 - abs(${sample} * 2.0 - 1.0))` : sample} * ${float(amplitude)}`);
    weight += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return `((${terms.join(" + ")}) / ${float(weight || 1)})`;
};

const collectDependencies = (compiled: ProcPlantCompiledMaterialGraph, roots: readonly number[]) => {
  const required = new Set<number>();
  const visit = (index: number) => {
    if (required.has(index)) return;
    const node = compiled.nodes[index];
    if (!node) throw new Error(`shader surface references missing compiled node ${index}`);
    required.add(index);
    for (const dependency of node.dependencies) visit(dependency);
  };
  for (const root of roots) visit(root);
  return [...required].sort((a, b) => a - b);
};

const nodeStatement = (compiled: ProcPlantCompiledMaterialGraph, node: ProcPlantCompiledMaterialNode) => {
  const name = nodeVariable(node.index);
  const dependency = (index: number) => nodeVariable(node.dependencies[index]!);
  if (node.kind === "scalar") return `float ${name} = ${float(node.parameters.value as number)};`;
  if (node.kind === "color") return `vec3 ${name} = ${vector(node.parameters.value as readonly number[])};`;
  if (node.kind === "noise") return `float ${name} = ${noiseExpression(node)};`;
  if (node.kind === "texture-sample") {
    const textureIndex = node.parameters.texture as number;
    const texture = compiled.textures[textureIndex]!;
    const sample = `texture2D(${textureUniform(textureIndex)}, ${textureUvExpression(texture)})`;
    const channel = node.parameters.channel as string;
    if (channel === "rgb") return `vec3 ${name} = ${texture.colorSpace === "srgb" ? `ppSrgbToLinear(${sample}.rgb)` : `${sample}.rgb`};`;
    if (channel === "normal") return `vec3 ${name} = normalize(${sample}.xyz * 2.0 - 1.0);`;
    return `float ${name} = ${sample}.${channel};`;
  }
  if (node.kind === "multiply") return `${glslType(node.valueType)} ${name} = ${dependency(0)} * ${dependency(1)};`;
  if (node.kind === "mix") return `${glslType(node.valueType)} ${name} = mix(${dependency(0)}, ${dependency(1)}, ${dependency(2)});`;
  if (node.kind === "one-minus") return `${glslType(node.valueType)} ${name} = ${glslType(node.valueType)}(1.0) - ${dependency(0)};`;
  if (node.kind === "clamp") return `${glslType(node.valueType)} ${name} = clamp(${dependency(0)}, ${float(node.parameters.min as number)}, ${float(node.parameters.max as number)});`;
  if (node.kind === "remap") {
    const { inMin, inMax, outMin, outMax } = node.parameters as Record<string, number>;
    return `float ${name} = ${float(outMin)} + ((${dependency(0)} - ${float(inMin)}) / ${float(inMax - inMin)}) * ${float(outMax - outMin)};`;
  }
  throw new Error(`${node.id} has no safe shader representation`);
};

export const compileProcPlantMaterialShaderPlan = (
  compiled: ProcPlantCompiledMaterialGraph,
  options: ProcPlantMaterialShaderCompileOptions = {},
): ProcPlantMaterialShaderPlan => {
  if (compiled.contract !== PROCPLANT_COMPILED_MATERIAL_CONTRACT || compiled.version !== PROCPLANT_COMPILED_MATERIAL_VERSION) {
    throw new Error("unsupported compiled procplant material graph contract/version");
  }
  const maxNodes = integer(options.maxNodes!, 256, 1, 1024, "maxNodes");
  const maxSurfaces = integer(options.maxSurfaces!, 16, 1, 128, "maxSurfaces");
  const maxTextures = integer(options.maxTextures!, 16, 0, 64, "maxTextures");
  const maxOperations = integer(options.maxOperations!, 512, 1, 4096, "maxOperations");
  const maxNoiseOctaves = integer(options.maxNoiseOctaves!, 48, 1, 256, "maxNoiseOctaves");
  const maxGlslBytes = integer(options.maxGlslBytes!, 96 * 1024, 1024, 1024 * 1024, "maxGlslBytes");
  const diagnostics: ProcPlantMaterialShaderDiagnostic[] = [];
  if (compiled.nodes.length > maxNodes) diagnostics.push({ code: "resource-cap", blocking: true, message: `shader graph exceeds maxNodes (${compiled.nodes.length} > ${maxNodes})` });
  if (compiled.surfaces.length > maxSurfaces) diagnostics.push({ code: "resource-cap", blocking: true, message: `shader graph exceeds maxSurfaces (${compiled.surfaces.length} > ${maxSurfaces})` });
  const surfaces: ProcPlantMaterialShaderSurfacePlan[] = [];
  const allTextureIndexes = new Set<number>();
  let totalOperations = 0;
  let totalOctaves = 0;
  let totalGlslBytes = 0;
  for (let surfaceIndex = 0; surfaceIndex < compiled.surfaces.length; surfaceIndex++) {
    const surface = compiled.surfaces[surfaceIndex]!;
    const shaderChannels: Partial<Record<ProcPlantMaterialChannel, number>> = {};
    for (const [channel, root] of Object.entries(surface.channels) as Array<[ProcPlantMaterialChannel, number]>) {
      if (!SUPPORTED_CHANNELS.has(channel)) {
        diagnostics.push({ code: "unsupported-channel", blocking: true, surface: surface.slot, channel, node: compiled.nodes[root]?.id, message: `${surface.slot}.${channel} has no live MeshStandard shader semantic` });
      } else if (channel === "normal") {
        diagnostics.push({ code: "delegated-normal", blocking: false, surface: surface.slot, channel, node: compiled.nodes[root]?.id, message: `${surface.slot}.normal remains on the validated baked MeshStandard normal-map path` });
      } else shaderChannels[channel] = root;
    }
    const required = collectDependencies(compiled, Object.values(shaderChannels));
    if (shaderChannels.baseColor !== undefined && shaderChannels.opacity === undefined && required.some((index) => {
      const node = compiled.nodes[index]!;
      const value = node.kind === "color" ? node.parameters.value as readonly number[] : [];
      return value.length === 4 && value[3] !== 1;
    })) diagnostics.push({
      code: "unsupported-channel",
      blocking: true,
      surface: surface.slot,
      channel: "baseColor",
      message: `${surface.slot}.baseColor contains non-opaque color alpha without an explicit opacity channel`,
    });
    const textureIndexes = new Set<number>();
    for (const index of required) {
      const node = compiled.nodes[index]!;
      if (node.kind === "noise") totalOctaves += node.parameters.octaves as number;
      if (node.kind === "texture-sample") {
        const textureIndex = node.parameters.texture as number;
        const texture = compiled.textures[textureIndex]!;
        if ((texture.uvSet ?? 0) !== 0) diagnostics.push({ code: "unsupported-uv-set", blocking: true, surface: surface.slot, node: node.id, message: `${node.id} requires UV${texture.uvSet}; generated preview supports UV0 only` });
        textureIndexes.add(textureIndex);
        allTextureIndexes.add(textureIndex);
      }
    }
    totalOperations += required.length;
    const functionName = `procplantEvaluateSurface_${surfaceIndex}`;
    const samplerDeclarations = [...textureIndexes].sort((a, b) => a - b).map((index) => `uniform sampler2D ${textureUniform(index)};`).join("\n");
    const usesShaderHelpers = required.some((index) => compiled.nodes[index]!.kind === "noise" || compiled.nodes[index]!.kind === "texture-sample");
    const body = required.map((index) => `  ${nodeStatement(compiled, compiled.nodes[index]!)}`).join("\n");
    const output = (channel: ProcPlantMaterialChannel, fallback: string) => shaderChannels[channel] === undefined ? fallback : nodeVariable(shaderChannels[channel]!);
    const prelude = `${samplerDeclarations}${samplerDeclarations ? "\n" : ""}${usesShaderHelpers ? `${NOISE_GLSL}\n` : ""}
struct ProcplantMaterialValues {
  vec3 baseColor; float roughness; float metalness; float opacity; float ambientOcclusion; vec3 emissive;
};
ProcplantMaterialValues ${functionName}(vec2 ppUv) {
${body}${body ? "\n" : ""}  ProcplantMaterialValues value;
  value.baseColor = ${output("baseColor", "vec3(1.0)")};
  value.roughness = clamp(${output("roughness", "1.0")}, 0.0, 1.0);
  value.metalness = clamp(${output("metalness", "0.0")}, 0.0, 1.0);
  value.opacity = clamp(${output("opacity", "1.0")}, 0.0, 1.0);
  value.ambientOcclusion = clamp(${output("ambientOcclusion", "1.0")}, 0.0, 1.0);
  value.emissive = ${output("emissive", "vec3(0.0)")};
  return value;
}`.trim();
    const glslBytes = new TextEncoder().encode(prelude).byteLength;
    totalGlslBytes += glslBytes;
    surfaces.push({
      slot: surface.slot,
      index: surfaceIndex,
      functionName,
      fragmentPrelude: prelude,
      textureIds: [...textureIndexes].sort((a, b) => a - b).map((index) => compiled.textures[index]!.id),
      channels: shaderChannels,
      operationCount: required.length,
      glslBytes,
    });
  }
  if (allTextureIndexes.size > maxTextures) diagnostics.push({ code: "resource-cap", blocking: true, message: `shader graph exceeds maxTextures (${allTextureIndexes.size} > ${maxTextures})` });
  if (totalOperations > maxOperations) diagnostics.push({ code: "resource-cap", blocking: true, message: `shader graph exceeds maxOperations (${totalOperations} > ${maxOperations})` });
  if (totalOctaves > maxNoiseOctaves) diagnostics.push({ code: "resource-cap", blocking: true, message: `shader graph exceeds maxNoiseOctaves (${totalOctaves} > ${maxNoiseOctaves})` });
  if (totalGlslBytes > maxGlslBytes) diagnostics.push({ code: "resource-cap", blocking: true, message: `shader graph exceeds maxGlslBytes (${totalGlslBytes} > ${maxGlslBytes})` });
  const textures = [...allTextureIndexes].sort((a, b) => a - b).map((index) => ({ index, id: compiled.textures[index]!.id, colorSpace: compiled.textures[index]!.colorSpace }));
  const base = {
    contract: PROCPLANT_MATERIAL_SHADER_CONTRACT,
    version: PROCPLANT_MATERIAL_SHADER_VERSION,
    sourceContract: compiled.contract,
    sourceVersion: compiled.version,
    sourceId: compiled.id,
    sourceContentHash: compiled.contentHash,
    ready: diagnostics.every((diagnostic) => !diagnostic.blocking),
    diagnostics,
    textures,
    surfaces,
  };
  return { ...base, contentHash: hashText(canonicalJson(base)) };
};

export const validateProcPlantMaterialShaderPlan = (plan: ProcPlantMaterialShaderPlan) => {
  if (plan.contract !== PROCPLANT_MATERIAL_SHADER_CONTRACT || plan.version !== PROCPLANT_MATERIAL_SHADER_VERSION ||
    plan.sourceContract !== PROCPLANT_COMPILED_MATERIAL_CONTRACT || plan.sourceVersion !== PROCPLANT_COMPILED_MATERIAL_VERSION) {
    throw new Error("unsupported procplant material shader plan contract/version");
  }
  const { contentHash, ...base } = plan;
  if (contentHash !== hashText(canonicalJson(base))) throw new Error("procplant material shader plan contentHash mismatch");
  if (plan.ready !== plan.diagnostics.every((diagnostic) => !diagnostic.blocking)) throw new Error("procplant material shader readiness does not match diagnostics");
  return plan;
};
