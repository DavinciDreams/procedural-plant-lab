import {
  PROCPLANT_COMPILED_MATERIAL_CONTRACT,
  PROCPLANT_COMPILED_MATERIAL_VERSION,
  type ProcPlantCompiledMaterialGraph,
  type ProcPlantCompiledMaterialNode,
  type ProcPlantMaterialChannel,
  type ProcPlantMaterialTexture,
} from "./procplant-material-graph";
import { encodeProcPlantImpostorPng } from "./procplant-impostor-image";

export const PROCPLANT_MATERIAL_BAKE_CONTRACT = "procplants.material-bake" as const;
export const PROCPLANT_MATERIAL_BAKE_VERSION = 1 as const;

export interface ProcPlantMaterialPixelSource {
  textureId: string;
  width: number;
  height: number;
  /** Row-major, top-left-origin RGBA8 pixels. Input is never mutated. */
  rgba: Uint8Array | Uint8ClampedArray;
}

export interface ProcPlantMaterialBakeOptions {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxSourceBytes?: number;
  maxOutputBytes?: number;
  maxEvaluations?: number;
}

export interface ProcPlantMaterialBakeDiagnostic {
  code: "unsupported-core-channel" | "out-of-range-clamped" | "opaque-alpha-discarded";
  blocking: true;
  slot: string;
  channel: ProcPlantMaterialChannel;
  message: string;
}

export type ProcPlantBakedImageUsage = "baseColor" | "metallicRoughnessOcclusion" | "normal" | "emissive";

export interface ProcPlantBakedMaterialImage {
  name: string;
  slot: string;
  usage: ProcPlantBakedImageUsage;
  width: number;
  height: number;
  mimeType: "image/png";
  colorSpace: "srgb" | "linear";
  contentHash: string;
  rgba: Uint8Array;
  bytes: Uint8Array;
  textureIndex: number;
}

export interface ProcPlantBakedMaterialBundle {
  contract: typeof PROCPLANT_MATERIAL_BAKE_CONTRACT;
  version: typeof PROCPLANT_MATERIAL_BAKE_VERSION;
  sourceContract: typeof PROCPLANT_COMPILED_MATERIAL_CONTRACT;
  sourceVersion: typeof PROCPLANT_COMPILED_MATERIAL_VERSION;
  sourceId: string;
  sourceContentHash: string;
  width: number;
  height: number;
  ready: boolean;
  diagnostics: ProcPlantMaterialBakeDiagnostic[];
  images: ProcPlantBakedMaterialImage[];
  /** Valid glTF 2.0 JSON containing embedded PNG data URIs and materials. */
  gltf: ProcPlantBakedMaterialGltf;
  gltfBytes: Uint8Array;
  contentHash: string;
}

export interface ProcPlantBakedMaterialGltf {
  asset: { version: "2.0"; generator: "procplants.material-bake/1" };
  images: Array<{ name: string; mimeType: "image/png"; uri: string }>;
  textures: Array<{ name: string; source: number }>;
  materials: Array<Record<string, unknown>>;
  extras: {
    contract: typeof PROCPLANT_MATERIAL_BAKE_CONTRACT;
    version: typeof PROCPLANT_MATERIAL_BAKE_VERSION;
    sourceId: string;
    sourceContentHash: string;
    ready: boolean;
    diagnostics: ProcPlantMaterialBakeDiagnostic[];
  };
}

type Value = number | number[];

const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  return value;
};

const hashBytes = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const byte = (value: number) => Math.round(clamp01(value) * 255);
const srgbToLinear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

const base64 = (bytes: Uint8Array) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const a = bytes[offset]!;
    const b = bytes[offset + 1];
    const c = bytes[offset + 2];
    const combined = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    result += alphabet[(combined >>> 18) & 63]!;
    result += alphabet[(combined >>> 12) & 63]!;
    result += b === undefined ? "=" : alphabet[(combined >>> 6) & 63]!;
    result += c === undefined ? "=" : alphabet[combined & 63]!;
  }
  return result;
};

const stableName = (value: string) => value.normalize("NFKD")
  .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").toLowerCase() || "material";

const wrap = (value: number, mode: ProcPlantMaterialTexture["wrapS"]) => {
  if (mode === "clamp") return clamp01(value);
  if (mode === "mirror") {
    const repeated = ((value % 2) + 2) % 2;
    return repeated <= 1 ? repeated : 2 - repeated;
  }
  return value - Math.floor(value);
};

const vector = (value: Value, length: number) => typeof value === "number"
  ? Array.from({ length }, () => value)
  : value.length === length ? [...value]
    : value.length === 3 && length === 4 ? [...value, 1]
      : value.slice(0, length);

const binary = (left: Value, right: Value, operation: (a: number, b: number) => number): Value => {
  if (typeof left === "number" && typeof right === "number") return operation(left, right);
  const length = Math.max(typeof left === "number" ? 1 : left.length, typeof right === "number" ? 1 : right.length);
  const actualLength = length === 1 ? 4 : length;
  const a = vector(left, actualLength);
  const b = vector(right, actualLength);
  return a.map((entry, index) => operation(entry, b[index] ?? 1));
};

const mix32 = (value: number) => {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b);
  return (result ^ (result >>> 16)) >>> 0;
};

const random2 = (x: number, y: number, seed: number) => mix32(seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495)) / 0xffffffff;
const smooth = (value: number) => value * value * (3 - 2 * value);
const valueNoise = (x: number, y: number, seed: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const top = random2(ix, iy, seed) * (1 - fx) + random2(ix + 1, iy, seed) * fx;
  const bottom = random2(ix, iy + 1, seed) * (1 - fx) + random2(ix + 1, iy + 1, seed) * fx;
  return top * (1 - fy) + bottom * fy;
};

const cellularNoise = (x: number, y: number, seed: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let distance = Number.POSITIVE_INFINITY;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cellX = ix + ox;
    const cellY = iy + oy;
    const px = cellX + random2(cellX, cellY, seed);
    const py = cellY + random2(cellX, cellY, seed ^ 0x9e3779b9);
    distance = Math.min(distance, Math.hypot(x - px, y - py));
  }
  return clamp01(distance / Math.SQRT2);
};

const proceduralNoise = (node: ProcPlantCompiledMaterialNode, u: number, v: number) => {
  const seed = node.parameters.seed as number;
  const scale = node.parameters.scale as number;
  const octaves = node.parameters.octaves as number;
  const lacunarity = node.parameters.lacunarity as number;
  const gain = node.parameters.gain as number;
  const kind = node.parameters.noise as string;
  let frequency = scale;
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave++) {
    let sample = kind === "cellular"
      ? cellularNoise(u * frequency, v * frequency, seed + octave)
      : valueNoise(u * frequency, v * frequency, seed + octave);
    if (kind === "ridge") sample = 1 - Math.abs(sample * 2 - 1);
    total += sample * amplitude;
    weight += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return weight === 0 ? 0 : total / weight;
};

/**
 * Deterministically evaluates every supported material DAG node on the CPU,
 * packs AO/roughness/metalness as glTF R/G/B, and emits embedded PNG-backed
 * glTF material resources. It does not claim height or ecological mask support.
 */
export const bakeProcPlantMaterials = (
  source: ProcPlantCompiledMaterialGraph,
  pixelSources: readonly ProcPlantMaterialPixelSource[],
  options: ProcPlantMaterialBakeOptions = {},
): ProcPlantBakedMaterialBundle => {
  if (source.contract !== PROCPLANT_COMPILED_MATERIAL_CONTRACT || source.version !== PROCPLANT_COMPILED_MATERIAL_VERSION) {
    throw new Error("unsupported compiled procplant material graph contract/version");
  }
  if (!Array.isArray(source.nodes) || !Array.isArray(source.textures) || !Array.isArray(source.surfaces)) {
    throw new Error("compiled material graph nodes, textures, and surfaces must be arrays");
  }
  const maxWidth = integer(options.maxWidth ?? 2048, 1, 8192, "maxWidth");
  const maxHeight = integer(options.maxHeight ?? 2048, 1, 8192, "maxHeight");
  const maxPixels = integer(options.maxPixels ?? 4_194_304, 1, 67_108_864, "maxPixels");
  const maxSourceBytes = integer(options.maxSourceBytes ?? 128 * 1024 * 1024, 1, 1024 * 1024 * 1024, "maxSourceBytes");
  const maxOutputBytes = integer(options.maxOutputBytes ?? 256 * 1024 * 1024, 1, 1024 * 1024 * 1024, "maxOutputBytes");
  const maxEvaluations = integer(options.maxEvaluations ?? 64_000_000, 1, 1_000_000_000, "maxEvaluations");
  if (source.nodes.length > 4096 || source.textures.length > 512 || source.surfaces.length === 0 || source.surfaces.length > 128) {
    throw new Error("compiled material graph exceeds baker structural limits");
  }

  const sourceById = new Map<string, ProcPlantMaterialPixelSource>();
  let sourceBytes = 0;
  for (let index = 0; index < pixelSources.length; index++) {
    const image = pixelSources[index]!;
    if (sourceById.has(image.textureId)) throw new Error(`duplicate pixel source ${image.textureId}`);
    const texture = source.textures.find((entry) => entry.id === image.textureId);
    if (!texture) throw new Error(`pixel source ${image.textureId} is not declared by the compiled graph`);
    integer(image.width, 1, maxWidth, `${image.textureId}.width`);
    integer(image.height, 1, maxHeight, `${image.textureId}.height`);
    const expected = image.width * image.height * 4;
    if (!Number.isSafeInteger(expected) || image.rgba.byteLength !== expected) throw new Error(`${image.textureId}.rgba must contain exactly width * height * 4 bytes`);
    sourceBytes += image.rgba.byteLength;
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes > maxSourceBytes) throw new Error(`material bake exceeds maxSourceBytes (${sourceBytes} > ${maxSourceBytes})`);
    sourceById.set(image.textureId, image);
  }
  const inferredWidth = pixelSources.reduce((maximum, image) => Math.max(maximum, image.width), 0) || 256;
  const inferredHeight = pixelSources.reduce((maximum, image) => Math.max(maximum, image.height), 0) || 256;
  const width = integer(options.width ?? inferredWidth, 1, maxWidth, "width");
  const height = integer(options.height ?? inferredHeight, 1, maxHeight, "height");
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) throw new Error(`material bake exceeds maxPixels (${pixels} > ${maxPixels})`);
  for (let index = 0; index < source.nodes.length; index++) {
    const node = source.nodes[index]!;
    if (node.index !== index) throw new Error(`compiled node ${node.id} has non-canonical index ${node.index}`);
    for (const dependency of node.dependencies) {
      if (!Number.isInteger(dependency) || dependency < 0 || dependency >= index) throw new Error(`${node.id} has invalid dependency ${dependency}`);
    }
  }

  const supportedChannels = ["baseColor", "opacity", "normal", "ambientOcclusion", "roughness", "metalness", "emissive"] as const;
  const requiredNodes = new Set<number>();
  const requireNode = (index: number) => {
    if (requiredNodes.has(index)) return;
    const node = source.nodes[index];
    if (!node) throw new Error(`surface references missing compiled node ${index}`);
    requiredNodes.add(index);
    for (const dependency of node.dependencies) requireNode(dependency);
  };
  for (const surface of source.surfaces) for (const channel of supportedChannels) {
    const root = surface.channels[channel];
    if (root !== undefined) requireNode(root);
  }
  const evaluations = pixels * requiredNodes.size;
  if (!Number.isSafeInteger(evaluations) || evaluations > maxEvaluations) throw new Error(`material bake exceeds maxEvaluations (${evaluations} > ${maxEvaluations})`);

  const sampleTexture = (textureIndex: number, channel: string, u: number, v: number): Value => {
    const texture = source.textures[textureIndex];
    if (!texture) throw new Error(`material node references missing texture ${textureIndex}`);
    const image = sourceById.get(texture.id);
    if (!image) throw new Error(`material bake requires RGBA pixels for texture ${texture.id}`);
    const scale = texture.scale ?? [1, 1];
    const offset = texture.offset ?? [0, 0];
    const rotation = texture.rotation ?? 0;
    const scaledX = u * scale[0];
    const scaledY = v * scale[1];
    const transformedU = wrap(Math.cos(rotation) * scaledX - Math.sin(rotation) * scaledY + offset[0], texture.wrapS ?? "repeat");
    const transformedV = wrap(Math.sin(rotation) * scaledX + Math.cos(rotation) * scaledY + offset[1], texture.wrapT ?? "repeat");
    const x = transformedU * image.width - 0.5;
    const y = transformedV * image.height - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const fx = x - x0;
    const fy = y - y0;
    const pixelIndex = (coordinate: number, size: number, mode: ProcPlantMaterialTexture["wrapS"]) => {
      if (mode === "clamp") return Math.min(size - 1, Math.max(0, coordinate));
      if (mode === "mirror") {
        const period = size * 2;
        const repeated = ((coordinate % period) + period) % period;
        return repeated < size ? repeated : period - repeated - 1;
      }
      return ((coordinate % size) + size) % size;
    };
    const component = (componentIndex: number) => {
      const at = (px: number, py: number) => image.rgba[(
        pixelIndex(py, image.height, texture.wrapT ?? "repeat") * image.width +
        pixelIndex(px, image.width, texture.wrapS ?? "repeat")
      ) * 4 + componentIndex]! / 255;
      const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
      const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
      const sampled = top * (1 - fy) + bottom * fy;
      return componentIndex < 3 && texture.colorSpace === "srgb" ? srgbToLinear(sampled) : sampled;
    };
    if (channel === "rgb") return [component(0), component(1), component(2), 1];
    if (channel === "normal") return [component(0), component(1), component(2)];
    return component(channel === "r" ? 0 : channel === "g" ? 1 : channel === "b" ? 2 : 3);
  };

  const evaluate = (u: number, v: number) => {
    const values: Array<Value | undefined> = [];
    for (const node of source.nodes) {
      if (!requiredNodes.has(node.index)) continue;
      let result: Value;
      if (node.kind === "scalar") result = node.parameters.value as number;
      else if (node.kind === "color") {
        const value = [...node.parameters.value as readonly number[]];
        result = value.length === 3 ? [...value, 1] : value;
      } else if (node.kind === "texture-sample") result = sampleTexture(node.parameters.texture as number, node.parameters.channel as string, u, v);
      else if (node.kind === "noise") result = proceduralNoise(node, u, v);
      else if (node.kind === "multiply") result = binary(values[node.dependencies[0]!]!, values[node.dependencies[1]!]!, (a, b) => a * b);
      else if (node.kind === "mix") {
        const factor = values[node.dependencies[2]!]!;
        if (typeof factor !== "number") throw new Error(`${node.id} has non-scalar mix factor`);
        result = binary(values[node.dependencies[0]!]!, values[node.dependencies[1]!]!, (a, b) => a + (b - a) * factor);
      } else if (node.kind === "one-minus") {
        const value = values[node.dependencies[0]!]!;
        result = typeof value === "number" ? 1 - value : value.map((entry) => 1 - entry);
      } else if (node.kind === "clamp") {
        const value = values[node.dependencies[0]!]!;
        const minimum = node.parameters.min as number;
        const maximum = node.parameters.max as number;
        result = typeof value === "number" ? Math.min(maximum, Math.max(minimum, value)) : value.map((entry) => Math.min(maximum, Math.max(minimum, entry)));
      } else if (node.kind === "remap") {
        const value = values[node.dependencies[0]!]!;
        if (typeof value !== "number") throw new Error(`${node.id} has non-scalar remap input`);
        const inMin = node.parameters.inMin as number;
        const inMax = node.parameters.inMax as number;
        const outMin = node.parameters.outMin as number;
        const outMax = node.parameters.outMax as number;
        result = outMin + (value - inMin) / (inMax - inMin) * (outMax - outMin);
      } else throw new Error(`${node.id} has unsupported compiled kind ${String(node.kind)}`);
      values[node.index] = result;
    }
    return values as Value[];
  };

  const diagnostics: ProcPlantMaterialBakeDiagnostic[] = [];
  const unsupported = ["height", "mossMask", "lichenMask", "wetnessMask", "snowMask"] as const;
  for (const surface of source.surfaces) for (const channel of unsupported) {
    if (surface.channels[channel] === undefined) continue;
    diagnostics.push({
      code: "unsupported-core-channel",
      blocking: true,
      slot: surface.slot,
      channel,
      message: `${surface.slot}.${channel} cannot be encoded in a core glTF PBR material; composite it into supported channels or use an explicit extension`,
    });
  }
  const diagnosticKeys = new Set(diagnostics.map((diagnostic) => `${diagnostic.slot}:${diagnostic.channel}:${diagnostic.code}`));
  const diagnoseOnce = (diagnostic: ProcPlantMaterialBakeDiagnostic) => {
    const key = `${diagnostic.slot}:${diagnostic.channel}:${diagnostic.code}`;
    if (diagnosticKeys.has(key)) return;
    diagnosticKeys.add(key);
    diagnostics.push(diagnostic);
  };
  const outputValue = (value: number, slot: string, channel: ProcPlantMaterialChannel) => {
    if (value < 0 || value > 1) {
      diagnoseOnce({
        code: "out-of-range-clamped",
        blocking: true,
        slot,
        channel,
        message: `${slot}.${channel} evaluated outside [0, 1]; RGBA8/core glTF output was clamped and is not marked lossless`,
      });
    }
    return clamp01(value);
  };

  const plannedImageCount = source.surfaces.reduce((count, surface) => count
    + (surface.channels.baseColor !== undefined || surface.channels.opacity !== undefined ? 1 : 0)
    + (surface.channels.ambientOcclusion !== undefined || surface.channels.roughness !== undefined || surface.channels.metalness !== undefined ? 1 : 0)
    + (surface.channels.normal !== undefined ? 1 : 0)
    + (surface.channels.emissive !== undefined ? 1 : 0), 0);
  const rawImageBytes = pixels * 4;
  const scanlineBytes = rawImageBytes + height;
  const estimatedPngBytes = scanlineBytes + 2 + Math.ceil(scanlineBytes / 0xffff) * 5 + 4 + 57;
  const estimatedPreallocationBytes = plannedImageCount * (
    rawImageBytes + estimatedPngBytes + 22 + Math.ceil(estimatedPngBytes / 3) * 4 + 4096
  ) + source.surfaces.length * 4096;
  if (!Number.isSafeInteger(estimatedPreallocationBytes) || estimatedPreallocationBytes > maxOutputBytes) {
    throw new Error(`material bake exceeds maxOutputBytes before allocation (${estimatedPreallocationBytes} > ${maxOutputBytes})`);
  }

  type SurfaceBuffers = {
    surface: ProcPlantCompiledMaterialGraph["surfaces"][number];
    base?: Uint8Array;
    orm?: Uint8Array;
    normal?: Uint8Array;
    emissive?: Uint8Array;
  };
  const buffers: SurfaceBuffers[] = source.surfaces.map((surface) => ({
    surface,
    ...(surface.channels.baseColor !== undefined || surface.channels.opacity !== undefined ? { base: new Uint8Array(pixels * 4) } : {}),
    ...(surface.channels.ambientOcclusion !== undefined || surface.channels.roughness !== undefined || surface.channels.metalness !== undefined ? { orm: new Uint8Array(pixels * 4) } : {}),
    ...(surface.channels.normal !== undefined ? { normal: new Uint8Array(pixels * 4) } : {}),
    ...(surface.channels.emissive !== undefined ? { emissive: new Uint8Array(pixels * 4) } : {}),
  }));
  const at = (values: Value[], index: number | undefined, fallback: Value) => index === undefined ? fallback : values[index]!;
  const scalarAt = (values: Value[], index: number | undefined, fallback: number, label: string) => {
    const value = at(values, index, fallback);
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} did not evaluate to a finite scalar`);
    return value;
  };
  const colorAt = (values: Value[], index: number | undefined, fallback: number[], label: string) => {
    const value = at(values, index, fallback);
    if (!Array.isArray(value) || value.length < 3 || value.some((entry) => !Number.isFinite(entry))) throw new Error(`${label} did not evaluate to a finite color`);
    return value.length === 3 ? [...value, 1] : value;
  };

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + 0.5) / width;
    const v = (y + 0.5) / height;
    const values = evaluate(u, v);
    const offset = (y * width + x) * 4;
    for (const entry of buffers) {
      const channels = entry.surface.channels;
      if (entry.base) {
        const base = colorAt(values, channels.baseColor, [1, 1, 1, 1], `${entry.surface.slot}.baseColor`);
        const opacity = scalarAt(values, channels.opacity, 1, `${entry.surface.slot}.opacity`);
        const alpha = outputValue(base[3]! * opacity, entry.surface.slot, "opacity");
        if (entry.surface.alphaMode === "opaque" && alpha !== 1) {
          diagnoseOnce({
            code: "opaque-alpha-discarded",
            blocking: true,
            slot: entry.surface.slot,
            channel: "opacity",
            message: `${entry.surface.slot} evaluates alpha below 1 but OPAQUE core glTF ignores alpha; choose MASK or BLEND`,
          });
        }
        entry.base.set([
          byte(linearToSrgb(outputValue(base[0]!, entry.surface.slot, "baseColor"))),
          byte(linearToSrgb(outputValue(base[1]!, entry.surface.slot, "baseColor"))),
          byte(linearToSrgb(outputValue(base[2]!, entry.surface.slot, "baseColor"))),
          byte(alpha),
        ], offset);
      }
      if (entry.orm) entry.orm.set([
        byte(outputValue(scalarAt(values, channels.ambientOcclusion, 1, `${entry.surface.slot}.ambientOcclusion`), entry.surface.slot, "ambientOcclusion")),
        byte(outputValue(scalarAt(values, channels.roughness, 1, `${entry.surface.slot}.roughness`), entry.surface.slot, "roughness")),
        byte(outputValue(scalarAt(values, channels.metalness, 0, `${entry.surface.slot}.metalness`), entry.surface.slot, "metalness")),
        255,
      ], offset);
      if (entry.normal) {
        const sampled = colorAt(values, channels.normal, [0.5, 0.5, 1], `${entry.surface.slot}.normal`);
        let nx = outputValue(sampled[0]!, entry.surface.slot, "normal") * 2 - 1;
        let ny = outputValue(sampled[1]!, entry.surface.slot, "normal") * 2 - 1;
        let nz = outputValue(sampled[2]!, entry.surface.slot, "normal") * 2 - 1;
        const length = Math.hypot(nx, ny, nz);
        if (length > 1e-12) { nx /= length; ny /= length; nz /= length; }
        else { nx = 0; ny = 0; nz = 1; }
        entry.normal.set([byte(nx * 0.5 + 0.5), byte(ny * 0.5 + 0.5), byte(nz * 0.5 + 0.5), 255], offset);
      }
      if (entry.emissive) {
        const emissive = colorAt(values, channels.emissive, [0, 0, 0, 1], `${entry.surface.slot}.emissive`);
        entry.emissive.set([
          byte(linearToSrgb(outputValue(emissive[0]!, entry.surface.slot, "emissive"))),
          byte(linearToSrgb(outputValue(emissive[1]!, entry.surface.slot, "emissive"))),
          byte(linearToSrgb(outputValue(emissive[2]!, entry.surface.slot, "emissive"))),
          255,
        ], offset);
      }
    }
  }

  const images: ProcPlantBakedMaterialImage[] = [];
  const materials: Array<Record<string, unknown>> = [];
  const addImage = (slot: string, usage: ProcPlantBakedImageUsage, colorSpace: "srgb" | "linear", rgba: Uint8Array) => {
    const bytes = encodeProcPlantImpostorPng(rgba, width, height);
    const textureIndex = images.length;
    images.push({
      name: `${stableName(source.id)}-${stableName(slot)}-${usage}`,
      slot,
      usage,
      width,
      height,
      mimeType: "image/png",
      colorSpace,
      contentHash: hashBytes(bytes),
      rgba,
      bytes,
      textureIndex,
    });
    return textureIndex;
  };
  for (const entry of buffers) {
    const surface = entry.surface;
    const baseIndex = entry.base ? addImage(surface.slot, "baseColor", "srgb", entry.base) : undefined;
    const ormIndex = entry.orm ? addImage(surface.slot, "metallicRoughnessOcclusion", "linear", entry.orm) : undefined;
    const normalIndex = entry.normal ? addImage(surface.slot, "normal", "linear", entry.normal) : undefined;
    const emissiveIndex = entry.emissive ? addImage(surface.slot, "emissive", "srgb", entry.emissive) : undefined;
    materials.push({
      name: surface.slot,
      doubleSided: surface.doubleSided,
      alphaMode: surface.alphaMode.toUpperCase(),
      ...(surface.alphaMode === "mask" ? { alphaCutoff: surface.alphaCutoff } : {}),
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        ...(baseIndex === undefined ? {} : { baseColorTexture: { index: baseIndex } }),
        metallicFactor: ormIndex === undefined ? 0 : 1,
        roughnessFactor: 1,
        ...(ormIndex === undefined ? {} : { metallicRoughnessTexture: { index: ormIndex } }),
      },
      ...(ormIndex === undefined ? {} : { occlusionTexture: { index: ormIndex, strength: 1 } }),
      ...(normalIndex === undefined ? {} : { normalTexture: { index: normalIndex } }),
      emissiveFactor: emissiveIndex === undefined ? [0, 0, 0] : [1, 1, 1],
      ...(emissiveIndex === undefined ? {} : { emissiveTexture: { index: emissiveIndex } }),
      extras: { procplantsBakeReady: !diagnostics.some((diagnostic) => diagnostic.slot === surface.slot) },
    });
  }

  const ready = diagnostics.length === 0;
  const gltf: ProcPlantBakedMaterialGltf = {
    asset: { version: "2.0", generator: "procplants.material-bake/1" },
    images: images.map((image) => ({ name: image.name, mimeType: image.mimeType, uri: `data:image/png;base64,${base64(image.bytes)}` })),
    textures: images.map((image) => ({ name: image.name, source: image.textureIndex })),
    materials,
    extras: {
      contract: PROCPLANT_MATERIAL_BAKE_CONTRACT,
      version: PROCPLANT_MATERIAL_BAKE_VERSION,
      sourceId: source.id,
      sourceContentHash: source.contentHash,
      ready,
      diagnostics,
    },
  };
  const gltfBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const outputBytes = images.reduce((sum, image) => sum + image.rgba.byteLength + image.bytes.byteLength, gltfBytes.byteLength);
  if (!Number.isSafeInteger(outputBytes) || outputBytes > maxOutputBytes) throw new Error(`material bake exceeds maxOutputBytes (${outputBytes} > ${maxOutputBytes})`);
  return {
    contract: PROCPLANT_MATERIAL_BAKE_CONTRACT,
    version: PROCPLANT_MATERIAL_BAKE_VERSION,
    sourceContract: source.contract,
    sourceVersion: source.version,
    sourceId: source.id,
    sourceContentHash: source.contentHash,
    width,
    height,
    ready,
    diagnostics,
    images,
    gltf,
    gltfBytes,
    contentHash: hashBytes(gltfBytes),
  };
};
