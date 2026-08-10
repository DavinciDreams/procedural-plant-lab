import { PROCPLANT_GENERATOR_CONTRACT_REVISION } from "./procplant-contract";
import {
  validateProcPlantLodsForGlb,
  validateProcPlantTemplateForGlb,
} from "./procplant-export";
import type { ProcPlantCompiledLod, ProcPlantTemplate } from "./procplants";
import type { ProcPlantBakedMaterialBundle, ProcPlantBakedMaterialImage } from "./procplant-material-bake";

export const PROCPLANT_USDA_EXPORT_CONTRACT = "procplants.usda-export" as const;
export const PROCPLANT_USDA_EXPORT_VERSION = 1 as const;
export const PROCPLANT_USDA_MATERIAL_CONTRACT = "procplants.usda-preview-material" as const;
export const PROCPLANT_USDA_MATERIAL_VERSION = 1 as const;

export type ProcPlantUsdSource = ProcPlantTemplate | readonly ProcPlantCompiledLod[];

export interface ProcPlantUsdaExportOptions {
  /** Stable default prim/file stem. Unsupported USD identifier characters become underscores. */
  name?: string;
  genomeId?: string;
  seed?: number;
  /** Selected variant when exporting multiple LODs. Defaults to the first compiled LOD. */
  defaultLod?: ProcPlantCompiledLod["level"];
  metadata?: Record<string, string | number | boolean | null>;
  collision?: {
    type: "bounds-box" | "trunk-capsule";
    /** Expand or contract the generated proxy about its center. */
    scale?: number;
  };
  /** Hard UTF-8 output guard. Defaults to 256 MiB and cannot exceed 1 GiB. */
  maxBytes?: number;
  /**
   * Bind one ready baked material slot through UsdPreviewSurface. The current
   * geometry contract has no face-to-slot partition, so multi-slot bundles must
   * select exactly one slot explicitly.
   */
  material?: ProcPlantUsdaMaterialOptions;
}

export interface ProcPlantUsdaMaterialOptions {
  baked: ProcPlantBakedMaterialBundle;
  slot?: string;
  /** Package-relative texture directory. Safe relative paths only. */
  assetDirectory?: string;
  maxAssets?: number;
  maxAssetBytes?: number;
  maxTotalAssetBytes?: number;
}

export interface ProcPlantUsdaAsset {
  path: string;
  mimeType: "image/png";
  colorSpace: "srgb" | "linear";
  contentHash: string;
  bytes: Uint8Array;
}

export interface ProcPlantUsdaLodManifestEntry {
  level: ProcPlantCompiledLod["level"] | null;
  label: ProcPlantCompiledLod["label"] | "template";
  distance: number | null;
  triangles: number;
  vertices: number;
  variant: string | null;
}

export interface ProcPlantUsdaExport {
  contract: typeof PROCPLANT_USDA_EXPORT_CONTRACT;
  version: typeof PROCPLANT_USDA_EXPORT_VERSION;
  fileName: string;
  defaultPrim: string;
  text: string;
  bytes: number;
  lods: ProcPlantUsdaLodManifestEntry[];
  /** Files that must be written beside the USDA at their package-relative paths. */
  assets: ProcPlantUsdaAsset[];
}

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
}

interface UsdaEntry {
  template: ProcPlantTemplate;
  lod?: ProcPlantCompiledLod;
  variant: string | null;
}

interface PreparedUsdMaterial {
  path: string;
  block: string;
  assets: ProcPlantUsdaAsset[];
  hasTextures: boolean;
}

const stableIdentifier = (value: string) => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "Plant";
  const prefixed = /^[a-zA-Z_]/.test(normalized) ? normalized : `Plant_${normalized}`;
  return prefixed;
};

const fileStem = (value: string) => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return normalized || "plant";
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) throw new Error("USDA numeric values must be finite");
  if (Object.is(value, -0)) return "0";
  return String(value);
};

const quote = (value: string) => JSON.stringify(value);

const finite = (value: unknown, fallback: number, min: number, max: number, label: string) => {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} must be finite in [${min}, ${max}]`);
  }
  return resolved;
};

const vector = (value: unknown, fallback: readonly number[], label: string) => {
  const resolved = value === undefined ? [...fallback] : value;
  if (!Array.isArray(resolved) || resolved.length !== fallback.length) throw new Error(`${label} must have ${fallback.length} components`);
  return resolved.map((entry, index) => finite(entry, fallback[index]!, 0, 1, `${label}[${index}]`));
};

const safeAssetDirectory = (value: string | undefined) => {
  const resolved = value ?? "textures";
  if (!resolved || resolved.length > 128 || resolved.includes("\\") || resolved.startsWith("/") || /^[A-Za-z]:/.test(resolved)) {
    throw new Error("material assetDirectory must be a safe package-relative POSIX path");
  }
  const segments = resolved.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error("material assetDirectory must be a safe package-relative POSIX path");
  }
  return segments.join("/");
};

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const assertPng = (image: ProcPlantBakedMaterialImage) => {
  if (image.mimeType !== "image/png" || image.bytes.length < pngSignature.length
    || pngSignature.some((byte, index) => image.bytes[index] !== byte)) {
    throw new Error(`material image ${image.name} must be a valid PNG asset; KTX2 and external resources are unsupported`);
  }
};

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
};

const textureIndex = (value: unknown, label: string) => {
  if (value === undefined) return null;
  const index = record(value, label).index;
  if (!Number.isInteger(index) || (index as number) < 0) throw new Error(`${label}.index must be a non-negative integer`);
  return index as number;
};

const prepareMaterial = (rootPath: string, options: ProcPlantUsdaMaterialOptions | undefined): PreparedUsdMaterial | null => {
  if (!options) return null;
  const { baked } = options;
  if (!baked || baked.contract !== "procplants.material-bake" || baked.version !== 1 || !baked.ready || baked.diagnostics.length > 0) {
    throw new Error("USDA material export requires one ready procplants material bake with no blocking diagnostics");
  }
  const maxAssets = options.maxAssets ?? 16;
  const maxAssetBytes = options.maxAssetBytes ?? 64 * 1024 * 1024;
  const maxTotalAssetBytes = options.maxTotalAssetBytes ?? 128 * 1024 * 1024;
  if (!Number.isInteger(maxAssets) || maxAssets < 0 || maxAssets > 64) throw new Error("material maxAssets must be an integer in [0, 64]");
  if (!Number.isInteger(maxAssetBytes) || maxAssetBytes < 1 || maxAssetBytes > 256 * 1024 * 1024) throw new Error("material maxAssetBytes must be an integer in [1, 268435456]");
  if (!Number.isInteger(maxTotalAssetBytes) || maxTotalAssetBytes < 1 || maxTotalAssetBytes > 512 * 1024 * 1024) throw new Error("material maxTotalAssetBytes must be an integer in [1, 536870912]");
  const materials = baked.gltf.materials;
  let materialIndex = -1;
  if (options.slot !== undefined) materialIndex = materials.findIndex((entry) => entry.name === options.slot);
  else if (materials.length === 1) materialIndex = 0;
  else throw new Error("multi-slot material bake requires an explicit slot because USDA geometry has no face-to-slot partition");
  if (materialIndex < 0) throw new Error(`material slot ${options.slot} is not present in the baked bundle`);
  const source = record(materials[materialIndex], `material[${materialIndex}]`);
  const slot = typeof source.name === "string" && source.name ? source.name : `material-${materialIndex}`;
  const pbr = record(source.pbrMetallicRoughness, `${slot}.pbrMetallicRoughness`);
  const baseIndex = textureIndex(pbr.baseColorTexture, `${slot}.baseColorTexture`);
  const ormIndex = textureIndex(pbr.metallicRoughnessTexture, `${slot}.metallicRoughnessTexture`);
  const occlusion = source.occlusionTexture === undefined ? null : record(source.occlusionTexture, `${slot}.occlusionTexture`);
  const occlusionIndex = occlusion ? textureIndex(occlusion, `${slot}.occlusionTexture`) : null;
  if (ormIndex !== occlusionIndex) throw new Error("USDA material requires the baked ORM texture to share metallic-roughness and occlusion channels");
  const normal = source.normalTexture === undefined ? null : record(source.normalTexture, `${slot}.normalTexture`);
  const normalIndex = normal ? textureIndex(normal, `${slot}.normalTexture`) : null;
  const emissiveIndex = textureIndex(source.emissiveTexture, `${slot}.emissiveTexture`);
  const expectedByIndex = new Map<number, { usage: ProcPlantBakedMaterialImage["usage"]; colorSpace: ProcPlantBakedMaterialImage["colorSpace"] }>();
  const expectImage = (index: number | null, usage: ProcPlantBakedMaterialImage["usage"], colorSpace: ProcPlantBakedMaterialImage["colorSpace"]) => {
    if (index === null) return;
    const prior = expectedByIndex.get(index);
    if (prior && (prior.usage !== usage || prior.colorSpace !== colorSpace)) {
      throw new Error(`material texture ${index} is reused across incompatible USD PBR semantics`);
    }
    expectedByIndex.set(index, { usage, colorSpace });
  };
  expectImage(baseIndex, "baseColor", "srgb");
  expectImage(ormIndex, "metallicRoughnessOcclusion", "linear");
  expectImage(normalIndex, "normal", "linear");
  expectImage(emissiveIndex, "emissive", "srgb");
  const used = [...new Set([baseIndex, ormIndex, normalIndex, emissiveIndex].filter((index): index is number => index !== null))].sort((a, b) => a - b);
  if (used.length > maxAssets) throw new Error(`USDA material exceeds maxAssets (${used.length} > ${maxAssets})`);
  const directory = safeAssetDirectory(options.assetDirectory);
  const assets: ProcPlantUsdaAsset[] = [];
  const imageFor = (index: number) => {
    const image = baked.images.find((entry) => entry.textureIndex === index);
    if (!image) throw new Error(`material texture ${index} has no baked image`);
    assertPng(image);
    if (image.bytes.byteLength > maxAssetBytes) throw new Error(`material image ${image.name} exceeds maxAssetBytes`);
    return image;
  };
  const pathByIndex = new Map<number, string>();
  for (const index of used) {
    const image = imageFor(index);
    const expected = expectedByIndex.get(index)!;
    if (image.usage !== expected.usage || image.colorSpace !== expected.colorSpace) {
      throw new Error(`material image ${image.name} does not match ${expected.usage}/${expected.colorSpace} USD semantics`);
    }
    const stem = fileStem(`${image.name}-${image.contentHash.replace(/[^A-Za-z0-9]+/g, "-")}`);
    const path = `${directory}/${stem}.png`;
    if (path.length > 255) throw new Error(`material asset path exceeds 255 portable characters: ${path}`);
    if (assets.some((asset) => asset.path === path)) throw new Error(`material asset path collision: ${path}`);
    pathByIndex.set(index, path);
    assets.push({ path, mimeType: "image/png", colorSpace: image.colorSpace, contentHash: image.contentHash, bytes: image.bytes.slice() });
  }
  const totalAssetBytes = assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
  if (!Number.isSafeInteger(totalAssetBytes) || totalAssetBytes > maxTotalAssetBytes) {
    throw new Error(`USDA material exceeds maxTotalAssetBytes (${totalAssetBytes} > ${maxTotalAssetBytes})`);
  }
  const materialName = stableIdentifier(slot);
  const materialPath = `${rootPath}/Looks/${materialName}`;
  const previewPath = `${materialPath}/PreviewSurface`;
  const stPath = `${materialPath}/PrimvarSt`;
  const baseFactor = vector(pbr.baseColorFactor, [1, 1, 1, 1], `${slot}.baseColorFactor`);
  const metallicFactor = finite(pbr.metallicFactor, 1, 0, 1, `${slot}.metallicFactor`);
  const roughnessFactor = finite(pbr.roughnessFactor, 1, 0, 1, `${slot}.roughnessFactor`);
  const emissiveFactor = vector(source.emissiveFactor, [0, 0, 0], `${slot}.emissiveFactor`);
  const normalScale = normal ? finite(normal.scale, 1, 0, 16, `${slot}.normalTexture.scale`) : 1;
  const aoStrength = occlusion ? finite(occlusion.strength, 1, 0, 1, `${slot}.occlusionTexture.strength`) : 1;
  const alphaMode = source.alphaMode === undefined ? "OPAQUE" : source.alphaMode;
  if (alphaMode !== "OPAQUE" && alphaMode !== "MASK" && alphaMode !== "BLEND") throw new Error(`${slot}.alphaMode is unsupported`);
  const alphaCutoff = finite(source.alphaCutoff, 0.5, 0, 1, `${slot}.alphaCutoff`);
  const textureNode = (name: string, index: number, colorSpace: "sRGB" | "raw", outputs: readonly string[], scale?: readonly number[], bias?: readonly number[]) => [
    `            def Shader ${quote(name)}`,
    `            {`,
    `                uniform token info:id = "UsdUVTexture"`,
    `                asset inputs:file = @${pathByIndex.get(index)}@`,
    `                token inputs:sourceColorSpace = ${quote(colorSpace)}`,
    `                float2 inputs:st.connect = <${stPath}.outputs:result>`,
    `                token inputs:wrapS = "repeat"`,
    `                token inputs:wrapT = "repeat"`,
    ...(scale ? [`                float4 inputs:scale = (${scale.map(formatNumber).join(", ")})`] : []),
    ...(bias ? [`                float4 inputs:bias = (${bias.map(formatNumber).join(", ")})`] : []),
    ...outputs.map((output) => `                ${output}`),
    `            }`,
  ];
  const previewInputs = [
    `                int inputs:useSpecularWorkflow = 0`,
    baseIndex === null
      ? `                color3f inputs:diffuseColor = (${baseFactor.slice(0, 3).map(formatNumber).join(", ")})`
      : `                color3f inputs:diffuseColor.connect = <${materialPath}/BaseColor.outputs:rgb>`,
    ormIndex === null
      ? `                float inputs:metallic = ${formatNumber(metallicFactor)}`
      : `                float inputs:metallic.connect = <${materialPath}/Orm.outputs:b>`,
    ormIndex === null
      ? `                float inputs:roughness = ${formatNumber(roughnessFactor)}`
      : `                float inputs:roughness.connect = <${materialPath}/Orm.outputs:g>`,
    ormIndex === null
      ? `                float inputs:occlusion = 1`
      : `                float inputs:occlusion.connect = <${materialPath}/Orm.outputs:r>`,
    normalIndex === null
      ? `                normal3f inputs:normal = (0, 0, 1)`
      : `                normal3f inputs:normal.connect = <${materialPath}/Normal.outputs:rgb>`,
    emissiveIndex === null
      ? `                color3f inputs:emissiveColor = (${emissiveFactor.map(formatNumber).join(", ")})`
      : `                color3f inputs:emissiveColor.connect = <${materialPath}/Emissive.outputs:rgb>`,
    baseIndex !== null && alphaMode !== "OPAQUE"
      ? `                float inputs:opacity.connect = <${materialPath}/BaseColor.outputs:a>`
      : `                float inputs:opacity = ${formatNumber(alphaMode === "OPAQUE" ? 1 : baseFactor[3]!)}`,
    `                float inputs:opacityThreshold = ${formatNumber(alphaMode === "MASK" ? alphaCutoff : 0)}`,
    `                token outputs:surface`,
  ];
  const block = [
    `    def Scope "Looks"`,
    `    {`,
    `        def Material ${quote(materialName)}`,
    `        {`,
    `            custom string procplant:contract = ${quote(PROCPLANT_USDA_MATERIAL_CONTRACT)}`,
    `            custom int procplant:contractVersion = ${PROCPLANT_USDA_MATERIAL_VERSION}`,
    `            token outputs:surface.connect = <${previewPath}.outputs:surface>`,
    ``,
    `            def Shader "PreviewSurface"`,
    `            {`,
    `                uniform token info:id = "UsdPreviewSurface"`,
    ...previewInputs,
    `            }`,
    ...(used.length ? [
      ``,
      `            def Shader "PrimvarSt"`,
      `            {`,
      `                uniform token info:id = "UsdPrimvarReader_float2"`,
      `                string inputs:varname = "st"`,
      `                float2 outputs:result`,
      `            }`,
    ] : []),
    ...(baseIndex === null ? [] : [``, ...textureNode("BaseColor", baseIndex, "sRGB", ["float3 outputs:rgb", "float outputs:a"], baseFactor)]),
    ...(ormIndex === null ? [] : [``, ...textureNode("Orm", ormIndex, "raw", ["float outputs:r", "float outputs:g", "float outputs:b"], [aoStrength, roughnessFactor, metallicFactor, 1])]),
    ...(normalIndex === null ? [] : [``, ...textureNode("Normal", normalIndex, "raw", ["float3 outputs:rgb"], [2 * normalScale, 2 * normalScale, 2, 1], [-normalScale, -normalScale, -1, 0])]),
    ...(emissiveIndex === null ? [] : [``, ...textureNode("Emissive", emissiveIndex, "sRGB", ["float3 outputs:rgb"], [...emissiveFactor, 1])]),
    `        }`,
    `    }`,
  ].join("\n");
  return { path: materialPath, block, assets, hasTextures: used.length > 0 };
};

const metadataJson = (metadata: ProcPlantUsdaExportOptions["metadata"]) => JSON.stringify(
  Object.fromEntries(Object.entries(metadata ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
);

const formatScalarArray = (values: ArrayLike<number>, indent: string, perLine = 16) => {
  if (values.length === 0) return "[]";
  const lines: string[] = [];
  for (let offset = 0; offset < values.length; offset += perLine) {
    const end = Math.min(values.length, offset + perLine);
    const chunk: string[] = [];
    for (let index = offset; index < end; index++) chunk.push(formatNumber(values[index]!));
    lines.push(`${indent}${chunk.join(", ")}`);
  }
  return `[\n${lines.join(",\n")}\n${indent.slice(0, -4)}]`;
};

const formatTupleArray = (values: ArrayLike<number>, size: number, indent: string, perLine = 4) => {
  if (values.length === 0) return "[]";
  const tuples: string[] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    const components: string[] = [];
    for (let component = 0; component < size; component++) {
      components.push(formatNumber(values[offset + component]!));
    }
    tuples.push(`(${components.join(", ")})`);
  }
  const lines: string[] = [];
  for (let offset = 0; offset < tuples.length; offset += perLine) {
    lines.push(`${indent}${tuples.slice(offset, offset + perLine).join(", ")}`);
  }
  return `[\n${lines.join(",\n")}\n${indent.slice(0, -4)}]`;
};

const triangleCounts = (triangles: number, indent: string) => {
  if (triangles === 0) return "[]";
  const lines: string[] = [];
  for (let offset = 0; offset < triangles; offset += 16) {
    lines.push(`${indent}${Array.from({ length: Math.min(16, triangles - offset) }, () => "3").join(", ")}`);
  }
  return `[\n${lines.join(",\n")}\n${indent.slice(0, -4)}]`;
};

const boundsFor = (template: ProcPlantTemplate): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let offset = 0; offset < template.pos.length; offset += 3) {
    const x = template.pos[offset]!;
    const y = template.pos[offset + 1]!;
    const z = template.pos[offset + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const min: Bounds["min"] = [minX, minY, minZ];
  const max: Bounds["max"] = [maxX, maxY, maxZ];
  return {
    min,
    max,
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
};

const collisionBlock = (
  bounds: Bounds,
  options: NonNullable<ProcPlantUsdaExportOptions["collision"]>,
  indent: string,
) => {
  const scale = Number.isFinite(options.scale) ? Math.min(8, Math.max(0.05, options.scale!)) : 1;
  const size = bounds.size.map((component) => component * scale) as Bounds["size"];
  const child = `${indent}    `;
  const metadata = [
    `${indent}    prepend apiSchemas = ["PhysicsCollisionAPI"]`,
    `${indent}    customData = {`,
    `${indent}        string procplantCollisionType = ${quote(options.type)}`,
    `${indent}        double procplantCollisionScale = ${formatNumber(scale)}`,
    `${indent}    }`,
  ].join("\n");
  const common = [
    `${child}bool physics:collisionEnabled = true`,
    `${child}uniform token purpose = "guide"`,
    `${child}double3 xformOp:translate = (${bounds.center.map(formatNumber).join(", ")})`,
    `${child}uniform token[] xformOpOrder = ["xformOp:translate"]`,
  ];
  if (options.type === "trunk-capsule") {
    const radius = Math.max(0.005, Math.min(size[1] * 0.5, Math.max(size[0], size[2]) * 0.28));
    const height = Math.max(0, size[1] - radius * 2);
    const halfY = height * 0.5 + radius;
    return [
      `${indent}def Capsule "Collision" (`,
      metadata,
      `${indent})`,
      `${indent}{`,
      ...common,
      `${child}uniform token axis = "Y"`,
      `${child}double height = ${formatNumber(height)}`,
      `${child}double radius = ${formatNumber(radius)}`,
      `${child}float3[] extent = [(-${formatNumber(radius)}, -${formatNumber(halfY)}, -${formatNumber(radius)}), (${formatNumber(radius)}, ${formatNumber(halfY)}, ${formatNumber(radius)})]`,
      `${indent}}`,
    ].join("\n");
  }
  const safeSize = size.map((component) => Math.max(0.001, component));
  return [
    `${indent}def Cube "Collision" (`,
    metadata,
    `${indent})`,
    `${indent}{`,
    ...common.slice(0, -1),
    `${child}double3 xformOp:scale = (${safeSize.map(formatNumber).join(", ")})`,
    `${child}uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]`,
    `${child}double size = 1`,
    `${child}float3[] extent = [(-0.5, -0.5, -0.5), (0.5, 0.5, 0.5)]`,
    `${indent}}`,
  ].join("\n");
};

const meshBlock = (
  entry: UsdaEntry,
  options: ProcPlantUsdaExportOptions,
  indent: string,
  material: PreparedUsdMaterial | null,
) => {
  const { template, lod } = entry;
  const bounds = boundsFor(template);
  const vertices = template.pos.length / 3;
  const triangles = template.idx.length / 3;
  const child = `${indent}    `;
  const lines = [
    ...(material ? [
      `${indent}def Mesh "Geometry" (`,
      `${indent}    prepend apiSchemas = ["MaterialBindingAPI"]`,
      `${indent})`,
    ] : [`${indent}def Mesh "Geometry"`]),
    `${indent}{`,
    ...(material ? [
      `${child}rel material:binding = <${material.path}>`,
    ] : []),
    `${child}custom string procplant:contract = ${quote(PROCPLANT_USDA_EXPORT_CONTRACT)}`,
    `${child}custom int procplant:contractVersion = ${PROCPLANT_USDA_EXPORT_VERSION}`,
    `${child}custom int procplant:generatorContractRevision = ${PROCPLANT_GENERATOR_CONTRACT_REVISION}`,
    `${child}custom int procplant:vertices = ${vertices}`,
    `${child}custom int procplant:triangles = ${triangles}`,
    ...(lod ? [
      `${child}custom int procplant:lodLevel = ${lod.level}`,
      `${child}custom string procplant:lodLabel = ${quote(lod.label)}`,
      `${child}custom double procplant:lodDistance = ${formatNumber(lod.distance)}`,
    ] : []),
    `${child}uniform bool doubleSided = true`,
    `${child}uniform token orientation = "rightHanded"`,
    `${child}uniform token subdivisionScheme = "none"`,
    `${child}float3[] extent = [(${bounds.min.map(formatNumber).join(", ")}), (${bounds.max.map(formatNumber).join(", ")})]`,
    `${child}int[] faceVertexCounts = ${triangleCounts(triangles, `${child}    `)}`,
    `${child}int[] faceVertexIndices = ${formatScalarArray(template.idx, `${child}    `)}`,
    `${child}point3f[] points = ${formatTupleArray(template.pos, 3, `${child}    `)}`,
    `${child}normal3f[] normals = ${formatTupleArray(template.nrm, 3, `${child}    `)} (`,
    `${child}    interpolation = "vertex"`,
    `${child})`,
    ...(material?.hasTextures ? [
      `${child}texCoord2f[] primvars:st = ${formatTupleArray(
        Array.from({ length: template.uv0.length }, (_, index) => index % 2 === 0 ? template.uv0[index]! : 1 - template.uv0[index]!),
        2,
        `${child}    `,
      )} (`,
      `${child}    interpolation = "vertex"`,
      `${child})`,
    ] : []),
    `${child}color3f[] primvars:displayColor = ${formatTupleArray(template.col, 3, `${child}    `)} (`,
    `${child}    interpolation = "vertex"`,
    `${child})`,
    `${child}float[] primvars:procplantSway = ${formatScalarArray(template.sway, `${child}    `)} (`,
    `${child}    interpolation = "vertex"`,
    `${child})`,
    `${child}float[] primvars:procplantTintable = ${formatScalarArray(template.tintable, `${child}    `)} (`,
    `${child}    interpolation = "vertex"`,
    `${child})`,
    `${indent}}`,
  ];
  if (options.collision) lines.push("", collisionBlock(bounds, options.collision, indent));
  return lines.join("\n");
};

const isLodSet = (source: ProcPlantUsdSource): source is readonly ProcPlantCompiledLod[] => Array.isArray(source);

const entriesFor = (source: ProcPlantUsdSource): UsdaEntry[] => {
  if (!isLodSet(source)) {
    validateProcPlantTemplateForGlb(source, "template");
    return [{ template: source, variant: null }];
  }
  validateProcPlantLodsForGlb(source);
  return source.map((lod) => ({
    template: lod.template,
    lod,
    variant: `LOD${lod.level}_${stableIdentifier(lod.label)}`,
  }));
};

/** Serialize real procplant geometry as deterministic, human-readable OpenUSD USDA. */
export const exportProcPlantUsda = (
  source: ProcPlantUsdSource,
  options: ProcPlantUsdaExportOptions = {},
): ProcPlantUsdaExport => {
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1024 * 1024 * 1024) {
    throw new Error("maxBytes must be an integer in [1024, 1073741824]");
  }
  const entries = entriesFor(source);
  const selected = options.defaultLod === undefined
    ? entries[0]!
    : entries.find((entry) => entry.lod?.level === options.defaultLod);
  if (!selected) throw new Error(`default LOD ${options.defaultLod} is not present in the USDA source`);
  const rawName = options.name ?? options.genomeId ?? "plant";
  const defaultPrim = `ProcPlant_${stableIdentifier(rawName)}`;
  const fileName = `procplant-${fileStem(rawName)}.usda`;
  const material = prepareMaterial(`/${defaultPrim}`, options.material);
  if (material?.hasTextures) {
    for (const entry of entries) {
      if (entry.template.uv0.length !== entry.template.pos.length / 3 * 2) {
        throw new Error(`USDA textured material requires one UV0 pair per position vertex for ${entry.lod?.label ?? "template"}`);
      }
    }
  }
  const serializedMetadata = metadataJson(options.metadata);
  const rootSpec = entries.length > 1
    ? [
        `def Xform ${quote(defaultPrim)} (`,
        `    kind = "component"`,
        `    prepend variantSets = "LOD"`,
        `    variants = {`,
        `        string LOD = ${quote(selected.variant!)}`,
        `    }`,
        `)`,
      ]
    : [
        `def Xform ${quote(defaultPrim)} (`,
        `    kind = "component"`,
        `)`,
      ];
  const body = [
    ...rootSpec,
    `{`,
    `    custom string procplant:contract = ${quote(PROCPLANT_USDA_EXPORT_CONTRACT)}`,
    `    custom int procplant:contractVersion = ${PROCPLANT_USDA_EXPORT_VERSION}`,
    `    custom int procplant:generatorContractRevision = ${PROCPLANT_GENERATOR_CONTRACT_REVISION}`,
    ...(options.genomeId ? [`    custom string procplant:genomeId = ${quote(options.genomeId)}`] : []),
    ...(options.seed !== undefined ? [`    custom int64 procplant:seed = ${options.seed >>> 0}`] : []),
    `    custom string procplant:lodSelection = ${quote(entries.length > 1 ? "variant-set" : String(selected.lod?.level ?? "template"))}`,
    `    custom string procplant:metadataJson = ${quote(serializedMetadata)}`,
    ...(material ? [
      `    custom string procplant:materialContract = ${quote(PROCPLANT_USDA_MATERIAL_CONTRACT)}`,
      `    custom int procplant:materialContractVersion = ${PROCPLANT_USDA_MATERIAL_VERSION}`,
      ``,
      material.block,
    ] : []),
    ...(entries.length > 1
      ? [
          ``,
          `    variantSet "LOD" = {`,
          ...entries.flatMap((entry) => [
            `        ${quote(entry.variant!)} {`,
            meshBlock(entry, options, "            ", material),
            `        }`,
          ]),
          `    }`,
        ]
      : ["", meshBlock(selected, options, "    ", material)]),
    `}`,
    ``,
  ];
  const text = [
    `#usda 1.0`,
    `(`,
    `    defaultPrim = ${quote(defaultPrim)}`,
    `    metersPerUnit = 1`,
    `    upAxis = "Y"`,
    `)`,
    ``,
    ...body,
  ].join("\n");
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) throw new Error(`USDA export exceeds maxBytes (${bytes} > ${maxBytes})`);
  return {
    contract: PROCPLANT_USDA_EXPORT_CONTRACT,
    version: PROCPLANT_USDA_EXPORT_VERSION,
    fileName,
    defaultPrim,
    text,
    bytes,
    assets: material?.assets.map((asset) => ({ ...asset, bytes: asset.bytes.slice() })) ?? [],
    lods: entries.map((entry) => ({
      level: entry.lod?.level ?? null,
      label: entry.lod?.label ?? "template",
      distance: entry.lod?.distance ?? null,
      triangles: entry.template.idx.length / 3,
      vertices: entry.template.pos.length / 3,
      variant: entries.length > 1 ? entry.variant : null,
    })),
  };
};
