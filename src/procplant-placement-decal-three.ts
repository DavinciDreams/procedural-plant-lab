import * as THREE from "three";
import {
  PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT,
  PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION,
  type ProcPlantMaterializedPlacementDecal,
  type ProcPlantPlacementDecalBinding,
} from "./procplant-organ-placement-overrides";

export const PROCPLANT_THREE_PLACEMENT_DECAL_CONTRACT = "procplants.three-placement-decal" as const;
export const PROCPLANT_THREE_PLACEMENT_DECAL_VERSION = 1 as const;
export const PROCPLANT_THREE_PLACEMENT_DECAL_MAX_DRAWS = 96;

export type ProcPlantThreePlacementDecalOwnership = "borrowed" | "owned";

export interface ProcPlantThreePlacementDecalBindingInput {
  binding: ProcPlantPlacementDecalBinding;
  material: THREE.Material;
  texture: THREE.Texture;
  materialOwnership?: ProcPlantThreePlacementDecalOwnership;
  textureOwnership?: ProcPlantThreePlacementDecalOwnership;
}

export interface ProcPlantThreePlacementDecalBindingMetadata {
  contract: typeof PROCPLANT_THREE_PLACEMENT_DECAL_CONTRACT;
  version: typeof PROCPLANT_THREE_PLACEMENT_DECAL_VERSION;
  ready: true;
  materialId: string;
  textureId: string;
  uvSet: 0;
  uvRect: readonly [number, number, number, number];
  materialOwnership: ProcPlantThreePlacementDecalOwnership;
  textureOwnership: ProcPlantThreePlacementDecalOwnership;
  exportSupport: "metadata-only";
}

export interface ProcPlantThreePlacementDecalBindingHandle {
  readonly binding: ProcPlantPlacementDecalBinding;
  readonly material: THREE.Material;
  readonly texture: THREE.Texture;
  readonly metadata: ProcPlantThreePlacementDecalBindingMetadata;
  readonly disposed: boolean;
  dispose(): void;
}

export interface ProcPlantThreePlacementDecalDrawAudit {
  contract: typeof PROCPLANT_THREE_PLACEMENT_DECAL_CONTRACT;
  version: typeof PROCPLANT_THREE_PLACEMENT_DECAL_VERSION;
  ready: true;
  materialId: string;
  textureId: string;
  draws: number;
  vertices: number;
  triangles: number;
  uvSet: 0;
  uv0Pairs: number;
  ownedGeometries: number;
  borrowedMaterials: 1;
  borrowedTextures: 1;
}

export interface ProcPlantThreePlacementDecalDrawPackage {
  readonly root: THREE.Group;
  readonly audit: ProcPlantThreePlacementDecalDrawAudit;
  readonly disposed: boolean;
  dispose(): void;
}

const finiteArray = (values: ArrayLike<number>, label: string) => {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) throw new Error(`${label}[${index}] must be finite`);
  }
};

const assertBinding = (binding: ProcPlantPlacementDecalBinding) => {
  const rect = binding?.uvRect;
  if (
    binding?.contract !== PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT
    || binding.version !== PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION
    || binding.uvSet !== 0
    || typeof binding.materialId !== "string"
    || binding.materialId.length < 1
    || binding.materialId.length > 128
    || typeof binding.textureId !== "string"
    || binding.textureId.length < 1
    || binding.textureId.length > 128
    || !Array.isArray(rect)
    || rect.length !== 4
    || rect.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || rect[2]! <= rect[0]!
    || rect[3]! <= rect[1]!
  ) {
    throw new Error("placement decal binding must be an exact UV0 material/texture binding");
  }
};

const mappedTexture = (material: THREE.Material): THREE.Texture | null | undefined =>
  (material as THREE.Material & { map?: THREE.Texture | null }).map;

export const createProcPlantThreePlacementDecalBinding = (
  input: ProcPlantThreePlacementDecalBindingInput,
): ProcPlantThreePlacementDecalBindingHandle => {
  assertBinding(input.binding);
  if (!input.material?.isMaterial) throw new Error("placement decal binding requires a live Three material");
  if (!input.texture?.isTexture) throw new Error("placement decal binding requires a live Three texture");
  if (mappedTexture(input.material) !== input.texture) {
    throw new Error("placement decal material map must reference the exact bound texture");
  }
  const materialOwnership = input.materialOwnership ?? "borrowed";
  const textureOwnership = input.textureOwnership ?? "borrowed";
  if (!(["borrowed", "owned"] as const).includes(materialOwnership)) throw new Error("invalid placement decal material ownership");
  if (!(["borrowed", "owned"] as const).includes(textureOwnership)) throw new Error("invalid placement decal texture ownership");
  const binding = Object.freeze({
    ...input.binding,
    uvRect: Object.freeze([...input.binding.uvRect]) as unknown as readonly [number, number, number, number],
  }) satisfies ProcPlantPlacementDecalBinding;
  const metadata: ProcPlantThreePlacementDecalBindingMetadata = Object.freeze({
    contract: PROCPLANT_THREE_PLACEMENT_DECAL_CONTRACT,
    version: PROCPLANT_THREE_PLACEMENT_DECAL_VERSION,
    ready: true,
    materialId: binding.materialId,
    textureId: binding.textureId,
    uvSet: 0,
    uvRect: Object.freeze([...binding.uvRect]) as unknown as readonly [number, number, number, number],
    materialOwnership,
    textureOwnership,
    exportSupport: "metadata-only",
  });
  let disposed = false;
  const handle: ProcPlantThreePlacementDecalBindingHandle = {
    binding,
    material: input.material,
    texture: input.texture,
    metadata,
    get disposed() { return disposed; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (materialOwnership === "owned") input.material.dispose();
      if (textureOwnership === "owned") input.texture.dispose();
    },
  };
  return handle;
};

const exactDecalMatch = (
  decal: ProcPlantMaterializedPlacementDecal,
  binding: ProcPlantPlacementDecalBinding,
) => decal.materialId === binding.materialId
  && decal.textureId === binding.textureId
  && decal.uvSet === binding.uvSet
  && decal.template.uv0.length === 8
  && decal.template.uv0.every((value, index) => value === [
    binding.uvRect[0], binding.uvRect[3],
    binding.uvRect[2], binding.uvRect[3],
    binding.uvRect[2], binding.uvRect[1],
    binding.uvRect[0], binding.uvRect[1],
  ][index]);

const geometryFromDecal = (decal: ProcPlantMaterializedPlacementDecal) => {
  const { template } = decal;
  const vertexCount = template.pos.length / 3;
  if (
    !Number.isInteger(vertexCount)
    || vertexCount !== 4
    || template.nrm.length !== 12
    || template.uv0.length !== 8
    || template.col.length !== 12
    || template.tintable.length !== 4
    || template.sway.length !== 4
    || template.idx.length !== 6
  ) {
    throw new Error(`placement decal ${decal.operationId} must be one four-vertex UV0 quad`);
  }
  finiteArray(template.pos, `${decal.operationId}.pos`);
  finiteArray(template.nrm, `${decal.operationId}.nrm`);
  finiteArray(template.uv0, `${decal.operationId}.uv0`);
  finiteArray(template.col, `${decal.operationId}.col`);
  finiteArray(template.sway, `${decal.operationId}.sway`);
  if (![...template.idx].every((index, offset) => index === [0, 1, 2, 0, 2, 3][offset])) {
    throw new Error(`${decal.operationId}.idx must preserve the bounded UV0 quad topology`);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(template.pos.slice(), 3).setUsage(THREE.StaticDrawUsage));
  geometry.setAttribute("normal", new THREE.BufferAttribute(template.nrm.slice(), 3).setUsage(THREE.StaticDrawUsage));
  geometry.setAttribute("uv", new THREE.BufferAttribute(template.uv0.slice(), 2).setUsage(THREE.StaticDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(template.col.slice(), 3).setUsage(THREE.StaticDrawUsage));
  geometry.setAttribute("procplantTintable", new THREE.BufferAttribute(template.tintable.slice(), 1).setUsage(THREE.StaticDrawUsage));
  geometry.setAttribute("procplantSway", new THREE.BufferAttribute(template.sway.slice(), 1).setUsage(THREE.StaticDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(template.idx.slice(), 1).setUsage(THREE.StaticDrawUsage));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.procplantPlacementDecal = {
    operationId: decal.operationId,
    materialId: decal.materialId,
    textureId: decal.textureId,
    uvSet: 0,
  };
  return geometry;
};

export const createProcPlantThreePlacementDecalDraws = (
  decals: readonly ProcPlantMaterializedPlacementDecal[],
  bindingHandle: ProcPlantThreePlacementDecalBindingHandle,
): ProcPlantThreePlacementDecalDrawPackage => {
  if (bindingHandle.disposed) throw new Error("placement decal binding has been disposed");
  assertBinding(bindingHandle.binding);
  if (!bindingHandle.material.isMaterial || !bindingHandle.texture.isTexture || mappedTexture(bindingHandle.material) !== bindingHandle.texture) {
    throw new Error("placement decal binding is no longer renderer-ready");
  }
  if (decals.length < 1 || decals.length > PROCPLANT_THREE_PLACEMENT_DECAL_MAX_DRAWS) {
    throw new Error(`placement decal draws must contain 1..${PROCPLANT_THREE_PLACEMENT_DECAL_MAX_DRAWS} entries`);
  }
  if (!decals.every((decal) => exactDecalMatch(decal, bindingHandle.binding))) {
    throw new Error("placement decal draws must exactly match the active material/texture binding");
  }
  const root = new THREE.Group();
  root.name = `procplant-placement-decals:${bindingHandle.binding.textureId}`;
  const geometries: THREE.BufferGeometry[] = [];
  try {
    for (const decal of [...decals].sort((left, right) => left.operationId.localeCompare(right.operationId))) {
      const geometry = geometryFromDecal(decal);
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, bindingHandle.material);
      mesh.name = `procplant-placement-decal:${decal.operationId}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 2;
      mesh.userData.procplantPlacementDecal = geometry.userData.procplantPlacementDecal;
      root.add(mesh);
    }
  } catch (error) {
    for (const geometry of geometries) geometry.dispose();
    throw error;
  }
  const audit: ProcPlantThreePlacementDecalDrawAudit = Object.freeze({
    contract: PROCPLANT_THREE_PLACEMENT_DECAL_CONTRACT,
    version: PROCPLANT_THREE_PLACEMENT_DECAL_VERSION,
    ready: true,
    materialId: bindingHandle.binding.materialId,
    textureId: bindingHandle.binding.textureId,
    draws: decals.length,
    vertices: decals.length * 4,
    triangles: decals.length * 2,
    uvSet: 0,
    uv0Pairs: decals.length * 4,
    ownedGeometries: geometries.length,
    borrowedMaterials: 1,
    borrowedTextures: 1,
  });
  root.userData.procplantPlacementDecalAudit = audit;
  let disposed = false;
  return {
    root,
    audit,
    get disposed() { return disposed; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      root.clear();
    },
  };
};
