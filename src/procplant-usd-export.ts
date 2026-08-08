import { PROCPLANT_GENERATOR_CONTRACT_REVISION } from "./procplant-contract";
import {
  validateProcPlantLodsForGlb,
  validateProcPlantTemplateForGlb,
} from "./procplant-export";
import type { ProcPlantCompiledLod, ProcPlantTemplate } from "./procplants";

export const PROCPLANT_USDA_EXPORT_CONTRACT = "procplants.usda-export" as const;
export const PROCPLANT_USDA_EXPORT_VERSION = 1 as const;

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

const meshBlock = (entry: UsdaEntry, options: ProcPlantUsdaExportOptions, indent: string) => {
  const { template, lod } = entry;
  const bounds = boundsFor(template);
  const vertices = template.pos.length / 3;
  const triangles = template.idx.length / 3;
  const child = `${indent}    `;
  const lines = [
    `${indent}def Mesh "Geometry"`,
    `${indent}{`,
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
    ...(entries.length > 1
      ? [
          ``,
          `    variantSet "LOD" = {`,
          ...entries.flatMap((entry) => [
            `        ${quote(entry.variant!)} {`,
            meshBlock(entry, options, "            "),
            `        }`,
          ]),
          `    }`,
        ]
      : ["", meshBlock(selected, options, "    ")]),
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
