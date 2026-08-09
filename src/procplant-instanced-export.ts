import * as THREE from "three";
import type { GLTFExporterOptions } from "three/addons/exporters/GLTFExporter.js";
import {
  disposePreparedProcPlantGlbExport,
  exportProcPlantScenesGlb,
  prepareProcPlantGlbExport,
  type PreparedProcPlantGlbExport,
  type ProcPlantGlbExportOptions,
  type ProcPlantGlbNodeMetadata,
} from "./procplant-export";
import {
  PROCPLANT_SCATTER_CONTRACT,
  PROCPLANT_SCATTER_VERSION,
  type ProcPlantScatterPlan,
} from "./procplant-scatter";
import type { ProcPlantTemplate } from "./procplants";

export const PROCPLANT_INSTANCED_GLB_EXPORT_CONTRACT = "procplants.instanced-glb-export" as const;
export const PROCPLANT_INSTANCED_GLB_EXPORT_VERSION = 1 as const;
export const PROCPLANT_INSTANCED_GLB_MAX_INSTANCES = 100_000 as const;

/** Renderer-neutral transform accepted by EXT_mesh_gpu_instancing. */
export interface ProcPlantGlbInstanceTransform {
  translation: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
  scale: readonly [number, number, number];
}

export type ProcPlantInstancedGlbExportOptions = Omit<
  ProcPlantGlbExportOptions,
  "collision" | "meshopt" | "exporter"
> & {
  /** Per-export cap, itself bounded by PROCPLANT_INSTANCED_GLB_MAX_INSTANCES. */
  maxInstances?: number;
  exporter?: Omit<GLTFExporterOptions, "binary">;
  /** Collision proxies are not meaningful until they are transformed per instance. */
  collision?: never;
  /** Composition with EXT_meshopt_compression is intentionally unproven and rejected. */
  meshopt?: never;
};

export interface ProcPlantInstancedGlbMetadata {
  contract: typeof PROCPLANT_INSTANCED_GLB_EXPORT_CONTRACT;
  version: typeof PROCPLANT_INSTANCED_GLB_EXPORT_VERSION;
  extension: "EXT_mesh_gpu_instancing";
  instanceCount: number;
  transformEncoding: "translation-rotation-scale";
  sourceBoundary: "one-template-one-lod";
}

export interface PreparedProcPlantInstancedGlbExport {
  scene: THREE.Scene;
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]>;
  sceneName: string;
  fileName: string;
  metadata: ProcPlantGlbNodeMetadata;
  instancing: ProcPlantInstancedGlbMetadata;
  /** Owned base preparation retained solely for symmetric disposal. */
  readonly base: PreparedProcPlantGlbExport;
}

const finiteTuple = (value: unknown, length: number, label: string): readonly number[] => {
  if (!value || typeof value !== "object" || !("length" in value) || value.length !== length) {
    throw new Error(`${label} must contain exactly ${length} values`);
  }
  const tuple = value as ArrayLike<unknown>;
  for (let index = 0; index < length; index++) {
    if (typeof tuple[index] !== "number" || !Number.isFinite(tuple[index])) {
      throw new Error(`${label}[${index}] must be finite`);
    }
    if (!Number.isFinite(Math.fround(tuple[index] as number))) {
      throw new Error(`${label}[${index}] must be representable as float32`);
    }
  }
  return Array.from({ length }, (_, index) => tuple[index] as number);
};

const validateInstanceCap = (value: unknown) => {
  const cap = value ?? PROCPLANT_INSTANCED_GLB_MAX_INSTANCES;
  if (!Number.isInteger(cap) || (cap as number) < 1 || (cap as number) > PROCPLANT_INSTANCED_GLB_MAX_INSTANCES) {
    throw new Error(`maxInstances must be an integer from 1 to ${PROCPLANT_INSTANCED_GLB_MAX_INSTANCES}`);
  }
  return cap as number;
};

export const validateProcPlantGlbInstanceTransforms = (
  transforms: readonly ProcPlantGlbInstanceTransform[],
  maxInstances: number = PROCPLANT_INSTANCED_GLB_MAX_INSTANCES,
) => {
  const cap = validateInstanceCap(maxInstances);
  if (!Array.isArray(transforms) || transforms.length === 0) {
    throw new Error("instanced GLB export requires at least one transform");
  }
  if (transforms.length > cap) {
    throw new Error(`instanced GLB export exceeds maxInstances (${transforms.length} > ${cap})`);
  }
  for (let index = 0; index < transforms.length; index++) {
    const transform = transforms[index] as ProcPlantGlbInstanceTransform | null | undefined;
    if (!transform || typeof transform !== "object") throw new Error(`instances[${index}] must be a TRS object`);
    finiteTuple(transform.translation, 3, `instances[${index}].translation`);
    const rotation = finiteTuple(transform.rotation, 4, `instances[${index}].rotation`);
    const lengthSquared = rotation.reduce((sum, component) => sum + component * component, 0);
    if (Math.abs(lengthSquared - 1) > 1e-5) {
      throw new Error(`instances[${index}].rotation must be a normalized quaternion`);
    }
    const scale = finiteTuple(transform.scale, 3, `instances[${index}].scale`);
    if (scale.some((component) => component <= 0)) {
      throw new Error(`instances[${index}].scale must be positive; InstancedMesh does not support negative scales`);
    }
  }
  return { instances: transforms.length, maxInstances: cap };
};

const glbOptions = (
  options: ProcPlantInstancedGlbExportOptions,
  instancing: ProcPlantInstancedGlbMetadata,
): ProcPlantGlbExportOptions => ({
  ...(options.name !== undefined ? { name: options.name } : {}),
  ...(options.genomeId !== undefined ? { genomeId: options.genomeId } : {}),
  ...(options.seed !== undefined ? { seed: options.seed } : {}),
  ...(options.material !== undefined ? { material: { ...options.material } } : {}),
  ...(options.exporter !== undefined ? { exporter: { ...options.exporter } } : {}),
  metadata: {
    ...(options.metadata ?? {}),
    instancingContract: instancing.contract,
    instancingVersion: instancing.version,
    instanceCount: instancing.instanceCount,
    instanceTransform: instancing.transformEncoding,
  },
});

/**
 * Prepare exactly one plant template at exactly one authored LOD as one InstancedMesh.
 * The source template and TRS records are copied and never mutated.
 */
export const prepareProcPlantInstancedGlbExport = (
  template: ProcPlantTemplate,
  transforms: readonly ProcPlantGlbInstanceTransform[],
  options: ProcPlantInstancedGlbExportOptions = {},
): PreparedProcPlantInstancedGlbExport => {
  const runtimeOptions = options as ProcPlantInstancedGlbExportOptions & Record<string, unknown>;
  if (runtimeOptions.meshopt !== undefined) {
    throw new Error("instanced GLB export does not support meshopt composition until it is explicitly proven");
  }
  if (runtimeOptions.collision !== undefined) {
    throw new Error("instanced GLB export does not support untransformed collision proxies");
  }
  if (Array.isArray(template)) throw new Error("instanced GLB export accepts one template/LOD, not a compiled LOD set");
  validateProcPlantGlbInstanceTransforms(transforms, validateInstanceCap(options.maxInstances));

  const instancing: ProcPlantInstancedGlbMetadata = {
    contract: PROCPLANT_INSTANCED_GLB_EXPORT_CONTRACT,
    version: PROCPLANT_INSTANCED_GLB_EXPORT_VERSION,
    extension: "EXT_mesh_gpu_instancing",
    instanceCount: transforms.length,
    transformEncoding: "translation-rotation-scale",
    sourceBoundary: "one-template-one-lod",
  };
  const base = prepareProcPlantGlbExport(template, glbOptions(options, instancing));
  const sourceMesh = base.meshes[0]!;
  base.scene.remove(sourceMesh);
  const mesh = new THREE.InstancedMesh(sourceMesh.geometry, sourceMesh.material, transforms.length);
  mesh.name = `${base.sceneName}-instances`;
  mesh.userData = {
    ...sourceMesh.userData,
    procplantInstancing: { ...instancing },
  };
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < transforms.length; index++) {
    const transform = transforms[index]!;
    position.fromArray(transform.translation);
    rotation.fromArray(transform.rotation);
    scale.fromArray(transform.scale);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  base.scene.userData.procplantInstancing = { ...instancing };
  base.scene.add(mesh);
  return {
    scene: base.scene,
    mesh,
    sceneName: base.sceneName,
    fileName: base.fileName,
    metadata: base.metadata,
    instancing,
    base,
  };
};

export const disposePreparedProcPlantInstancedGlbExport = (prepared: PreparedProcPlantInstancedGlbExport) => {
  prepared.mesh.dispose();
  disposePreparedProcPlantGlbExport(prepared.base);
};

export const exportProcPlantInstancedGlb = async (
  template: ProcPlantTemplate,
  transforms: readonly ProcPlantGlbInstanceTransform[],
  options: ProcPlantInstancedGlbExportOptions = {},
): Promise<ArrayBuffer> => {
  const prepared = prepareProcPlantInstancedGlbExport(template, transforms, options);
  try {
    return await exportProcPlantScenesGlb(prepared.scene, options.exporter);
  } finally {
    disposePreparedProcPlantInstancedGlbExport(prepared);
  }
};

/** Copy one scatter entry into extension-ready TRS records, preserving plan order. */
export const createProcPlantScatterEntryGlbInstances = (
  plan: ProcPlantScatterPlan,
  entryId: string,
): ProcPlantGlbInstanceTransform[] => {
  if (plan.contract !== PROCPLANT_SCATTER_CONTRACT || plan.version !== PROCPLANT_SCATTER_VERSION) {
    throw new Error("scatter entry export requires a supported ProcPlant scatter plan");
  }
  if (typeof entryId !== "string" || entryId.trim().length === 0) throw new Error("scatter entryId must be non-empty");
  const instances = plan.placements
    .filter((placement) => placement.entryId === entryId)
    .map((placement, index): ProcPlantGlbInstanceTransform => {
      const translation = finiteTuple(placement.position, 3, `scatter placement ${index}.position`);
      if (!Number.isFinite(placement.rotationY)) throw new Error(`scatter placement ${index}.rotationY must be finite`);
      if (!Number.isFinite(placement.scale) || placement.scale <= 0) {
        throw new Error(`scatter placement ${index}.scale must be positive and finite`);
      }
      const halfYaw = placement.rotationY * 0.5;
      return {
        translation: [translation[0]!, translation[1]!, translation[2]!],
        rotation: [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)],
        scale: [placement.scale, placement.scale, placement.scale],
      };
    });
  if (instances.length === 0) throw new Error(`scatter entry ${entryId} has no placements`);
  validateProcPlantGlbInstanceTransforms(instances);
  return instances;
};
