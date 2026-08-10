import * as THREE from "three";
import type { ProcPlantMaterialPixelSource } from "./procplant-material-bake";
import {
  type ProcPlantMaterialShaderPlan,
  type ProcPlantMaterialShaderSurfacePlan,
  validateProcPlantMaterialShaderPlan,
} from "./procplant-material-shader";

export interface ProcPlantThreeMaterialShaderResourceOptions {
  maxTextures?: number;
  maxTextureWidth?: number;
  maxTextureHeight?: number;
  maxTexturePixels?: number;
  maxTextureBytes?: number;
}

export interface ProcPlantThreeMaterialShaderResources {
  readonly texturesById: ReadonlyMap<string, THREE.DataTexture>;
  readonly textures: readonly THREE.DataTexture[];
  readonly ownedBytes: number;
  dispose(): void;
}

export interface ProcPlantThreeMaterialShaderInstallation {
  readonly material: THREE.MeshStandardMaterial;
  readonly slot: string;
  readonly planHash: string;
  readonly cacheKey: string;
  readonly disposed: boolean;
  dispose(): void;
}

export interface ProcPlantThreeMaterialShaderSetInstallation {
  readonly installations: readonly ProcPlantThreeMaterialShaderInstallation[];
  readonly resources: ProcPlantThreeMaterialShaderResources;
  dispose(): void;
}

const integer = (value: number | undefined, fallback: number, min: number, max: number, label: string) => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  return resolved;
};

export const createProcPlantThreeMaterialShaderResources = (
  plan: ProcPlantMaterialShaderPlan,
  sources: readonly ProcPlantMaterialPixelSource[],
  options: ProcPlantThreeMaterialShaderResourceOptions = {},
): ProcPlantThreeMaterialShaderResources => {
  validateProcPlantMaterialShaderPlan(plan);
  if (!plan.ready) throw new Error("cannot allocate resources for a blocked procplant material shader plan");
  const maxTextures = integer(options.maxTextures, 16, 0, 64, "maxTextures");
  const maxWidth = integer(options.maxTextureWidth, 4096, 1, 8192, "maxTextureWidth");
  const maxHeight = integer(options.maxTextureHeight, 4096, 1, 8192, "maxTextureHeight");
  const maxPixels = integer(options.maxTexturePixels, 16_777_216, 1, 67_108_864, "maxTexturePixels");
  const maxBytes = integer(options.maxTextureBytes, 64 * 1024 * 1024, 1, 1024 * 1024 * 1024, "maxTextureBytes");
  if (plan.textures.length > maxTextures) throw new Error(`shader resources exceed maxTextures (${plan.textures.length} > ${maxTextures})`);
  const bySourceId = new Map<string, ProcPlantMaterialPixelSource>();
  for (const source of sources) {
    if (bySourceId.has(source.textureId)) throw new Error(`duplicate shader pixel source ${source.textureId}`);
    bySourceId.set(source.textureId, source);
  }
  const textures = new Map<string, THREE.DataTexture>();
  let totalPixels = 0;
  let ownedBytes = 0;
  try {
    for (const requirement of plan.textures) {
      const source = bySourceId.get(requirement.id);
      if (!source) throw new Error(`live shader requires explicit RGBA pixels for texture ${requirement.id}`);
      if (!Number.isInteger(source.width) || source.width < 1 || source.width > maxWidth ||
        !Number.isInteger(source.height) || source.height < 1 || source.height > maxHeight) {
        throw new Error(`${requirement.id} dimensions exceed live shader limits`);
      }
      const pixels = source.width * source.height;
      if (!Number.isSafeInteger(pixels) || source.rgba.byteLength !== pixels * 4) throw new Error(`${requirement.id}.rgba must contain width * height * 4 bytes`);
      totalPixels += pixels;
      ownedBytes += source.rgba.byteLength;
      if (!Number.isSafeInteger(totalPixels) || totalPixels > maxPixels) throw new Error("shader resources exceed maxTexturePixels");
      if (!Number.isSafeInteger(ownedBytes) || ownedBytes > maxBytes) throw new Error("shader resources exceed maxTextureBytes");
      const texture = new THREE.DataTexture(source.rgba.slice(), source.width, source.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.name = `procplant-shader-${requirement.id}`;
      // The generated GLSL performs the declared color-space conversion itself.
      // Keeping the sampler untagged avoids a second hardware sRGB decode.
      texture.colorSpace = THREE.NoColorSpace;
      texture.flipY = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      texture.userData.procplantGeneratedShader = {
        planHash: plan.contentHash,
        textureId: requirement.id,
        sourceColorSpace: requirement.colorSpace,
      };
      textures.set(requirement.id, texture);
    }
  } catch (error) {
    for (const texture of textures.values()) texture.dispose();
    throw error;
  }
  let disposed = false;
  return {
    texturesById: textures,
    textures: [...textures.values()],
    ownedBytes,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of textures.values()) texture.dispose();
      textures.clear();
    },
  };
};

type StandardShader = Parameters<THREE.MeshStandardMaterial["onBeforeCompile"]>[0];
const replaceRequired = (source: string, anchor: string, replacement: string, label: string) => {
  if (!source.includes(anchor)) throw new Error(`Three MeshStandard shader is missing required ${label} injection anchor`);
  return source.replace(anchor, replacement);
};

const installSurface = (
  material: THREE.MeshStandardMaterial,
  plan: ProcPlantMaterialShaderPlan,
  surface: ProcPlantMaterialShaderSurfacePlan,
  resources: ProcPlantThreeMaterialShaderResources,
): ProcPlantThreeMaterialShaderInstallation => {
  if (!material?.isMeshStandardMaterial) throw new Error(`${surface.slot} requires THREE.MeshStandardMaterial`);
  for (const textureId of surface.textureIds) {
    if (!resources.texturesById.get(textureId)?.isTexture) throw new Error(`${surface.slot} requires live shader texture ${textureId}`);
  }
  const priorOnBeforeCompile = material.onBeforeCompile;
  const priorCacheKeyFunction = material.customProgramCacheKey;
  const priorCacheKey = priorCacheKeyFunction.call(material);
  const priorDefines = material.defines ? { ...material.defines } : undefined;
  const priorMetadata = material.userData.procplantGeneratedShader;
  const textureIndexById = new Map(plan.textures.map((texture) => [texture.id, texture.index]));
  const channels = surface.channels;
  let compiledShader: StandardShader | null = null;
  material.defines = { ...(material.defines ?? {}), USE_UV: "", PROCPLANT_GENERATED_MATERIAL: 1 };
  material.onBeforeCompile = ((shader: StandardShader, renderer: THREE.WebGLRenderer) => {
    priorOnBeforeCompile.call(material, shader, renderer);
    for (const textureId of surface.textureIds) {
      shader.uniforms[`procplantTexture_${textureIndexById.get(textureId)!}`] = { value: resources.texturesById.get(textureId)! };
    }
    shader.fragmentShader = replaceRequired(shader.fragmentShader, "void main() {", `${surface.fragmentPrelude}\nvoid main() {`, "main");
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>\n\tProcplantMaterialValues procplantMaterial = ${surface.functionName}(vUv);`,
      "clipping_planes_fragment",
    );
    if (channels.baseColor !== undefined || channels.opacity !== undefined) shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      "#include <map_fragment>",
      `#include <map_fragment>${channels.baseColor === undefined ? "" : "\n\tdiffuseColor.rgb = procplantMaterial.baseColor;"}${channels.opacity === undefined ? "" : "\n\tdiffuseColor.a = procplantMaterial.opacity;"}`,
      "map_fragment",
    );
    if (channels.roughness !== undefined) shader.fragmentShader = replaceRequired(shader.fragmentShader, "#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n\troughnessFactor = procplantMaterial.roughness;", "roughnessmap_fragment");
    if (channels.metalness !== undefined) shader.fragmentShader = replaceRequired(shader.fragmentShader, "#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n\tmetalnessFactor = procplantMaterial.metalness;", "metalnessmap_fragment");
    if (channels.emissive !== undefined) shader.fragmentShader = replaceRequired(shader.fragmentShader, "#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance = procplantMaterial.emissive;", "emissivemap_fragment");
    if (channels.ambientOcclusion !== undefined) shader.fragmentShader = replaceRequired(shader.fragmentShader, "#include <aomap_fragment>", `
\tfloat procplantAmbientOcclusion = procplantMaterial.ambientOcclusion;
\treflectedLight.indirectDiffuse *= procplantAmbientOcclusion;
\t#if defined( USE_CLEARCOAT )
\t\tclearcoatSpecularIndirect *= procplantAmbientOcclusion;
\t#endif
\t#if defined( USE_SHEEN )
\t\tsheenSpecularIndirect *= procplantAmbientOcclusion;
\t#endif
\t#if defined( USE_ENVMAP ) && defined( STANDARD )
\t\tfloat procplantDotNV = saturate( dot( geometryNormal, geometryViewDir ) );
\t\treflectedLight.indirectSpecular *= computeSpecularOcclusion( procplantDotNV, procplantAmbientOcclusion, material.roughness );
\t#endif`, "aomap_fragment");
    compiledShader = shader;
  }) as THREE.MeshStandardMaterial["onBeforeCompile"];
  const cacheKey = `${priorCacheKey}|procplant-material-shader-v1|${plan.contentHash}|${surface.slot}`;
  material.customProgramCacheKey = () => cacheKey;
  material.userData.procplantGeneratedShader = {
    contract: plan.contract,
    version: plan.version,
    planHash: plan.contentHash,
    sourceContentHash: plan.sourceContentHash,
    slot: surface.slot,
    delegatedNormal: plan.diagnostics.some((diagnostic) => diagnostic.code === "delegated-normal" && diagnostic.surface === surface.slot),
  };
  material.needsUpdate = true;
  let disposed = false;
  return {
    material,
    slot: surface.slot,
    planHash: plan.contentHash,
    cacheKey,
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      material.onBeforeCompile = priorOnBeforeCompile;
      material.customProgramCacheKey = priorCacheKeyFunction;
      material.defines = priorDefines;
      if (priorMetadata === undefined) delete material.userData.procplantGeneratedShader;
      else material.userData.procplantGeneratedShader = priorMetadata;
      compiledShader = null;
      material.needsUpdate = true;
    },
  };
};

export const installProcPlantThreeMaterialShader = (
  material: THREE.MeshStandardMaterial,
  plan: ProcPlantMaterialShaderPlan,
  slot: string,
  resources: ProcPlantThreeMaterialShaderResources,
) => {
  validateProcPlantMaterialShaderPlan(plan);
  if (!plan.ready) throw new Error("cannot install a blocked procplant material shader plan");
  const surface = plan.surfaces.find((entry) => entry.slot === slot);
  if (!surface) throw new Error(`shader plan does not contain surface ${slot}`);
  return installSurface(material, plan, surface, resources);
};

export const installProcPlantThreeMaterialShaderSet = (
  materialsBySlot: ReadonlyMap<string, THREE.MeshStandardMaterial>,
  plan: ProcPlantMaterialShaderPlan,
  resources: ProcPlantThreeMaterialShaderResources,
): ProcPlantThreeMaterialShaderSetInstallation => {
  validateProcPlantMaterialShaderPlan(plan);
  if (!plan.ready) throw new Error("cannot install a blocked procplant material shader plan");
  const installations: ProcPlantThreeMaterialShaderInstallation[] = [];
  try {
    for (const surface of plan.surfaces) {
      const material = materialsBySlot.get(surface.slot);
      if (!material) throw new Error(`live material set is missing shader surface ${surface.slot}`);
      installations.push(installSurface(material, plan, surface, resources));
    }
  } catch (error) {
    for (const installation of installations.reverse()) installation.dispose();
    resources.dispose();
    throw error;
  }
  let disposed = false;
  return {
    installations,
    resources,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const installation of [...installations].reverse()) installation.dispose();
      resources.dispose();
    },
  };
};
