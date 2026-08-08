import * as THREE from "three";
import type { GLTFExporterOptions } from "three/addons/exporters/GLTFExporter.js";
import {
  PROCPLANT_GENERATOR_CONTRACT_REVISION,
  createProcPlantRuntimeLodSelectionContract,
  type ProcPlantRuntimeLodSelectionContract,
} from "./procplant-contract";
import {
  compressProcPlantGlbMeshopt,
  type ProcPlantMeshoptCompressionOptions,
} from "./procplant-meshopt-compression";
import type { ProcPlantCompiledLod, ProcPlantTemplate } from "./procplants";
import { declareProcPlantGeometryUv0 } from "./procplant-uv0";
import { createProcPlantThreeGeometry } from "./procplant-three-geometry";

export const PROCPLANT_GLB_EXPORT_CONTRACT = "procplants.glb-export" as const;
export const PROCPLANT_GLB_EXPORT_VERSION = 1 as const;
export const PROCPLANT_TINTABLE_ATTRIBUTE = "procplantTintable" as const;
export const PROCPLANT_GLB_SWAY_ATTRIBUTE = "procplantSway" as const;

export type ProcPlantGlbSource = ProcPlantTemplate | readonly ProcPlantCompiledLod[];

export interface ProcPlantGlbExportOptions {
  /** Stable scene/file stem. Invalid filename characters are replaced with hyphens. */
  name?: string;
  genomeId?: string;
  seed?: number;
  metadata?: Record<string, string | number | boolean | null>;
  material?: {
    roughness?: number;
    metalness?: number;
    alphaTest?: number;
    /** Emit explicit glTF tangents for tangent-space normal maps. */
    tangents?: boolean;
  };
  collision?: {
    type: "bounds-box" | "trunk-capsule";
    /** Expand or contract the generated proxy about its center. */
    scale?: number;
  };
  /** Lossless geometry-only EXT_meshopt_compression. Disabled unless explicitly provided. */
  meshopt?: ProcPlantMeshoptCompressionOptions;
  exporter?: Omit<GLTFExporterOptions, "binary">;
}

export interface ProcPlantGlbNodeMetadata {
  contract: typeof PROCPLANT_GLB_EXPORT_CONTRACT;
  contractVersion: typeof PROCPLANT_GLB_EXPORT_VERSION;
  generatorContractRevision: typeof PROCPLANT_GENERATOR_CONTRACT_REVISION;
  sourceKind: "template" | "compiled-lod-set";
  genomeId?: string;
  seed?: number;
  lod?: {
    tierId: string;
    level: ProcPlantCompiledLod["level"];
    label: ProcPlantCompiledLod["label"];
    distance: number;
    triangles: number;
    vertices: number;
  };
  /** Standard glTF extras metadata; this is not advertised as a Khronos extension. */
  lodSelection?: ProcPlantRuntimeLodSelectionContract;
  attributes: {
    uv0: "TEXCOORD_0";
    color: "COLOR_0";
    sway: "_PROCPLANTSWAY";
    tintable: "_PROCPLANTTINTABLE";
  };
  metadata?: Record<string, string | number | boolean | null>;
}

export interface PreparedProcPlantGlbExport {
  scene: THREE.Scene;
  meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]>[];
  collisionMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  sceneName: string;
  fileName: string;
  metadata: ProcPlantGlbNodeMetadata;
}

const isCompiledLodSet = (source: ProcPlantGlbSource): source is readonly ProcPlantCompiledLod[] =>
  Array.isArray(source);

const stableNamePart = (value: string) => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return normalized || "plant";
};

export const procPlantGlbSceneName = (options: Pick<ProcPlantGlbExportOptions, "name" | "genomeId"> = {}) =>
  `procplant-${stableNamePart(options.name ?? options.genomeId ?? "plant")}`;

const assertFiniteArray = (values: ArrayLike<number>, label: string) => {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) throw new Error(`${label}[${index}] must be finite`);
  }
};

export const validateProcPlantTemplateForGlb = (template: ProcPlantTemplate, label = "template") => {
  if (template.pos.length === 0 || template.pos.length % 3 !== 0) {
    throw new Error(`${label}.pos must contain xyz vertex tuples`);
  }
  const vertices = template.pos.length / 3;
  if (template.nrm.length !== template.pos.length) throw new Error(`${label}.nrm must align with positions`);
  if (template.uv0.length !== vertices * 2) throw new Error(`${label}.uv0 must contain one uv tuple per vertex`);
  if (template.col.length !== template.pos.length) throw new Error(`${label}.col must align with positions`);
  if (template.tintable.length !== vertices) throw new Error(`${label}.tintable must contain one value per vertex`);
  if (template.sway.length !== vertices) throw new Error(`${label}.sway must contain one value per vertex`);
  if (template.idx.length === 0 || template.idx.length % 3 !== 0) {
    throw new Error(`${label}.idx must contain triangle tuples`);
  }
  assertFiniteArray(template.pos, `${label}.pos`);
  assertFiniteArray(template.nrm, `${label}.nrm`);
  assertFiniteArray(template.uv0, `${label}.uv0`);
  assertFiniteArray(template.col, `${label}.col`);
  assertFiniteArray(template.sway, `${label}.sway`);
  for (let index = 0; index < template.idx.length; index++) {
    if (template.idx[index]! >= vertices) throw new Error(`${label}.idx[${index}] references a missing vertex`);
  }
  return { vertices, triangles: template.idx.length / 3 };
};

export const validateProcPlantLodsForGlb = (lods: readonly ProcPlantCompiledLod[]) => {
  if (lods.length === 0) throw new Error("compiled LOD export requires at least one level");
  const levels = new Set<number>();
  let priorLevel = -1;
  let priorDistance = -1;
  for (const lod of lods) {
    if (levels.has(lod.level)) throw new Error(`compiled LOD level ${lod.level} is duplicated`);
    if (lod.level <= priorLevel) throw new Error("compiled LOD levels must be strictly increasing");
    if (!Number.isFinite(lod.distance) || lod.distance < 0 || lod.distance < priorDistance) {
      throw new Error("compiled LOD distances must be finite, non-negative, and increasing");
    }
    const actual = validateProcPlantTemplateForGlb(lod.template, `lod${lod.level}.template`);
    if (lod.vertices !== actual.vertices) throw new Error(`lod${lod.level}.vertices does not match its template`);
    if (lod.triangles !== actual.triangles) throw new Error(`lod${lod.level}.triangles does not match its template`);
    levels.add(lod.level);
    priorLevel = lod.level;
    priorDistance = lod.distance;
  }
};

const geometryFromTemplate = (template: ProcPlantTemplate, tangents = false) => {
  const built = createProcPlantThreeGeometry(template, { tangents });
  const { geometry } = built;
  declareProcPlantGeometryUv0(geometry);
  geometry.userData.procplantThreeGeometry = built.audit;
  geometry.userData.procplantSurfacePartition = built.partition;
  return geometry;
};

const createCollisionProxy = (
  bounds: THREE.Box3,
  sceneName: string,
  options: NonNullable<ProcPlantGlbExportOptions["collision"]>,
) => {
  const scale = Number.isFinite(options.scale) ? THREE.MathUtils.clamp(options.scale!, 0.05, 8) : 1;
  const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(scale);
  const center = bounds.getCenter(new THREE.Vector3());
  let geometry: THREE.BufferGeometry;
  if (options.type === "trunk-capsule") {
    const radius = Math.max(0.005, Math.min(size.y * 0.5, Math.max(size.x, size.z) * 0.28));
    geometry = new THREE.CapsuleGeometry(radius, Math.max(0, size.y - radius * 2), 4, 8);
  } else {
    geometry = new THREE.BoxGeometry(
      Math.max(0.001, size.x),
      Math.max(0.001, size.y),
      Math.max(0.001, size.z),
    );
  }
  const material = new THREE.MeshBasicMaterial({
    name: `${sceneName}-collision-material`,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${sceneName}-collision-${options.type}`;
  mesh.position.copy(center);
  mesh.visible = false;
  mesh.userData.procplantCollision = {
    type: options.type,
    scale,
    bounds: {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
    },
  };
  return mesh;
};

const nodeMetadata = (
  sourceKind: ProcPlantGlbNodeMetadata["sourceKind"],
  options: ProcPlantGlbExportOptions,
  lod?: ProcPlantCompiledLod,
  lodSelection?: ProcPlantRuntimeLodSelectionContract,
): ProcPlantGlbNodeMetadata => ({
  contract: PROCPLANT_GLB_EXPORT_CONTRACT,
  contractVersion: PROCPLANT_GLB_EXPORT_VERSION,
  generatorContractRevision: PROCPLANT_GENERATOR_CONTRACT_REVISION,
  sourceKind,
  ...(options.genomeId ? { genomeId: options.genomeId } : {}),
  ...(options.seed !== undefined ? { seed: options.seed >>> 0 } : {}),
  ...(lod
    ? {
        lod: {
          tierId: `lod${lod.level}-${lod.label}`,
          level: lod.level,
          label: lod.label,
          distance: lod.distance,
          triangles: lod.triangles,
          vertices: lod.vertices,
        },
      }
    : {}),
  ...(lodSelection ? { lodSelection } : {}),
  attributes: {
    uv0: "TEXCOORD_0",
    color: "COLOR_0",
    sway: "_PROCPLANTSWAY",
    tintable: "_PROCPLANTTINTABLE",
  },
  ...(options.metadata ? { metadata: { ...options.metadata } } : {}),
});

export const prepareProcPlantGlbExport = (
  source: ProcPlantGlbSource,
  options: ProcPlantGlbExportOptions = {},
): PreparedProcPlantGlbExport => {
  const lodSet = isCompiledLodSet(source);
  if (lodSet) validateProcPlantLodsForGlb(source);
  else validateProcPlantTemplateForGlb(source);

  const sceneName = procPlantGlbSceneName(options);
  const scene = new THREE.Scene();
  scene.name = sceneName;
  const lodSelection = lodSet
    ? createProcPlantRuntimeLodSelectionContract(source.map((lod) => ({
        level: lod.level,
        label: lod.label,
        distance: lod.distance,
        triangles: lod.triangles,
      })))
    : undefined;
  const metadata = nodeMetadata(lodSet ? "compiled-lod-set" : "template", options, undefined, lodSelection);
  scene.userData.procplant = metadata;
  const materialOptions = options.material ?? {};
  const meshes: PreparedProcPlantGlbExport["meshes"] = [];
  const collisionMeshes: PreparedProcPlantGlbExport["collisionMeshes"] = [];
  const entries = lodSet
    ? source.map((lod) => ({ template: lod.template, lod }))
    : [{ template: source, lod: undefined }];

  for (const { template, lod } of entries) {
    const barkMaterial = new THREE.MeshStandardMaterial({
      name: `${sceneName}-bark-material`,
      vertexColors: true,
      side: THREE.FrontSide,
      roughness: THREE.MathUtils.clamp(materialOptions.roughness ?? 0.82, 0, 1),
      metalness: THREE.MathUtils.clamp(materialOptions.metalness ?? 0, 0, 1),
      alphaTest: THREE.MathUtils.clamp(materialOptions.alphaTest ?? 0, 0, 1),
    });
    const organMaterial = new THREE.MeshStandardMaterial({
      name: `${sceneName}-organ-material`,
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: THREE.MathUtils.clamp(materialOptions.roughness ?? 0.82, 0, 1),
      metalness: THREE.MathUtils.clamp(materialOptions.metalness ?? 0, 0, 1),
      alphaTest: THREE.MathUtils.clamp(materialOptions.alphaTest ?? 0, 0, 1),
    });
    const geometry = geometryFromTemplate(template, materialOptions.tangents ?? false);
    const partition = geometry.userData.procplantSurfacePartition as {
      barkStemTriangles: number;
      organTriangles: number;
      contentHash: string;
      rangeCount: number;
    };
    const material = partition.barkStemTriangles === 0
      ? organMaterial
      : partition.organTriangles === 0
        ? barkMaterial
        : [barkMaterial, organMaterial];
    if (material === barkMaterial) organMaterial.dispose();
    else if (material === organMaterial) barkMaterial.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = lod ? `${sceneName}-lod${lod.level}-${lod.label}` : `${sceneName}-mesh`;
    mesh.userData.procplant = nodeMetadata(lodSet ? "compiled-lod-set" : "template", options, lod);
    mesh.userData.procplantSurfaces = {
      contract: "procplants.surface-partition",
      version: 1,
      slots: partition.barkStemTriangles === 0 ? ["organ"] : partition.organTriangles === 0 ? ["bark"] : ["bark", "organ"],
      contentHash: partition.contentHash,
      groups: partition.rangeCount,
      barkStemTriangles: partition.barkStemTriangles,
      organTriangles: partition.organTriangles,
      tangents: geometry.hasAttribute("tangent"),
    };
    scene.add(mesh);
    meshes.push(mesh);
  }

  if (options.collision) {
    const bounds = new THREE.Box3();
    for (const mesh of meshes) {
      if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox);
    }
    if (!bounds.isEmpty()) {
      const collision = createCollisionProxy(bounds, sceneName, options.collision);
      scene.add(collision);
      collisionMeshes.push(collision);
    }
  }

  return { scene, meshes, collisionMeshes, sceneName, fileName: `${sceneName}.glb`, metadata };
};

export const disposePreparedProcPlantGlbExport = (prepared: PreparedProcPlantGlbExport) => {
  for (const mesh of prepared.meshes) {
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of new Set(materials)) material.dispose();
  }
  for (const mesh of prepared.collisionMeshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
};

const ensureProcPlantFileReader = () => {
  if (typeof globalThis.FileReader !== "undefined") return;
  class ProcPlantBlobFileReader {
    result: string | ArrayBuffer | null = null;
    onloadend: ((event: unknown) => void) | null = null;

    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onloadend?.({ target: this });
      });
    }

    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        this.result = `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
        this.onloadend?.({ target: this });
      });
    }
  }
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    writable: true,
    value: ProcPlantBlobFileReader,
  });
};

/** Serialize one or more standard glTF scenes into a single GLB container. */
export const exportProcPlantScenesGlb = async (
  scenes: THREE.Scene | readonly THREE.Scene[],
  exporter: Omit<GLTFExporterOptions, "binary"> = {},
): Promise<ArrayBuffer> => {
  ensureProcPlantFileReader();
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  const input: THREE.Scene | THREE.Scene[] = Array.isArray(scenes)
    ? [...scenes] as THREE.Scene[]
    : scenes as THREE.Scene;
  const output = await new GLTFExporter().parseAsync(input, {
    ...exporter,
    binary: true,
    onlyVisible: false,
  });
  if (!(output instanceof ArrayBuffer)) throw new Error("GLTFExporter returned JSON for a binary GLB request");
  return output;
};

/** Browser/Node GLB serialization. GLTFExporter remains lazy and outside the initial app bundle. */
export const exportProcPlantGlb = async (
  source: ProcPlantGlbSource,
  options: ProcPlantGlbExportOptions = {},
): Promise<ArrayBuffer> => {
  const prepared = prepareProcPlantGlbExport(source, options);
  try {
    const bytes = await exportProcPlantScenesGlb(prepared.scene, options.exporter);
    return options.meshopt ? (await compressProcPlantGlbMeshopt(bytes, options.meshopt)).bytes : bytes;
  } finally {
    disposePreparedProcPlantGlbExport(prepared);
  }
};
