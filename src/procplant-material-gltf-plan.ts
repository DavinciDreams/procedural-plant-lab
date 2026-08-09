import {
  PROCPLANT_COMPILED_MATERIAL_CONTRACT,
  PROCPLANT_COMPILED_MATERIAL_VERSION,
  type ProcPlantCompiledMaterialGraph,
  type ProcPlantMaterialBindingPlan,
  type ProcPlantMaterialChannel,
  type ProcPlantMaterialTexture,
} from "./procplant-material-graph";

export const PROCPLANT_GLTF_MATERIAL_PLAN_CONTRACT = "procplants.gltf-material-plan" as const;
export const PROCPLANT_GLTF_MATERIAL_PLAN_VERSION = 1 as const;

export type ProcPlantGltfDiagnosticCode =
  | "requires-bake"
  | "requires-channel-pack"
  | "unsupported-core-channel"
  | "opacity-texture-mismatch"
  | "invalid-direct-binding"
  | "opaque-alpha-discarded"
  | "texture-transform-extension";

export interface ProcPlantGltfMaterialDiagnostic {
  code: ProcPlantGltfDiagnosticCode;
  blocking: boolean;
  channel?: ProcPlantMaterialChannel;
  message: string;
}

export interface ProcPlantGltfTextureInfoPlan {
  texture: number;
  textureId: string;
  uri: string;
  texCoord: 0 | 1;
  channels: readonly ("r" | "g" | "b" | "a" | "rgb" | "normal")[];
  sampler: {
    wrapS: "repeat" | "clamp" | "mirror";
    wrapT: "repeat" | "clamp" | "mirror";
  };
  transform?: {
    extension: "KHR_texture_transform";
    offset?: readonly [number, number];
    scale?: readonly [number, number];
    rotation?: number;
  };
}

export interface ProcPlantGltfMaterialPlan {
  slot: string;
  ready: boolean;
  doubleSided: boolean;
  alphaMode: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff?: number;
  pbrMetallicRoughness: {
    baseColorFactor: readonly [number, number, number, number];
    baseColorTexture?: ProcPlantGltfTextureInfoPlan;
    metallicFactor: number;
    roughnessFactor: number;
    metallicRoughnessTexture?: ProcPlantGltfTextureInfoPlan;
  };
  normalTexture?: ProcPlantGltfTextureInfoPlan;
  occlusionTexture?: ProcPlantGltfTextureInfoPlan & { strength: number };
  emissiveFactor: readonly [number, number, number];
  emissiveTexture?: ProcPlantGltfTextureInfoPlan;
  diagnostics: ProcPlantGltfMaterialDiagnostic[];
}

export interface ProcPlantGltfMaterialPlanDocument {
  contract: typeof PROCPLANT_GLTF_MATERIAL_PLAN_CONTRACT;
  version: typeof PROCPLANT_GLTF_MATERIAL_PLAN_VERSION;
  sourceContract: typeof PROCPLANT_COMPILED_MATERIAL_CONTRACT;
  sourceVersion: typeof PROCPLANT_COMPILED_MATERIAL_VERSION;
  sourceId: string;
  sourceContentHash: string;
  ready: boolean;
  extensionsUsed: readonly "KHR_texture_transform"[];
  materials: ProcPlantGltfMaterialPlan[];
}

export interface ProcPlantGltfMaterialPlanOptions {
  maxMaterials?: number;
  maxDiagnostics?: number;
}

type TextureBinding = Extract<ProcPlantMaterialBindingPlan, { kind: "texture" | "factor-texture" }>;

const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  return value;
};

const isTextureBinding = (binding: ProcPlantMaterialBindingPlan | undefined): binding is TextureBinding =>
  binding?.kind === "texture" || binding?.kind === "factor-texture";

const hasTransform = (texture: ProcPlantMaterialTexture) =>
  texture.offset !== undefined || texture.scale !== undefined || texture.rotation !== undefined;

/**
 * Convert a validated compiled material graph into a renderer-independent core
 * glTF 2.0 PBR material plan. This plans references only: it does not load,
 * decode, pack, bake, or emit textures.
 */
export const planProcPlantGltfMaterials = (
  source: ProcPlantCompiledMaterialGraph,
  options: ProcPlantGltfMaterialPlanOptions = {},
): ProcPlantGltfMaterialPlanDocument => {
  if (source.contract !== PROCPLANT_COMPILED_MATERIAL_CONTRACT || source.version !== PROCPLANT_COMPILED_MATERIAL_VERSION) {
    throw new Error("unsupported compiled procplant material graph contract/version");
  }
  if (!Array.isArray(source.surfaces) || !Array.isArray(source.textures) || !Array.isArray(source.nodes)) {
    throw new Error("compiled material graph nodes, textures, and surfaces must be arrays");
  }
  if (typeof source.id !== "string" || !source.id || typeof source.contentHash !== "string" || !source.contentHash) {
    throw new Error("compiled material graph id and contentHash must be non-empty strings");
  }
  const maxMaterials = integer(options.maxMaterials ?? 128, 1, 1024, "maxMaterials");
  const maxDiagnostics = integer(options.maxDiagnostics ?? 1024, 1, 16384, "maxDiagnostics");
  if (source.surfaces.length > maxMaterials) throw new Error(`glTF material plan exceeds maxMaterials (${source.surfaces.length} > ${maxMaterials})`);
  let diagnosticCount = 0;
  let usesTextureTransform = false;

  const slots = new Set<string>();
  const materials = source.surfaces.map((surface): ProcPlantGltfMaterialPlan => {
    if (!surface || typeof surface !== "object" || typeof surface.slot !== "string" || !surface.slot) {
      throw new Error("compiled material surfaces must have non-empty slots");
    }
    if (slots.has(surface.slot)) throw new Error(`duplicate compiled material slot ${surface.slot}`);
    slots.add(surface.slot);
    if (!surface.bindings || typeof surface.bindings !== "object" || Array.isArray(surface.bindings)) {
      throw new Error(`${surface.slot}.bindings must be an object`);
    }
    if (typeof surface.doubleSided !== "boolean"
      || !["opaque", "mask", "blend"].includes(surface.alphaMode)
      || !Number.isFinite(surface.alphaCutoff) || surface.alphaCutoff < 0 || surface.alphaCutoff > 1) {
      throw new Error(`${surface.slot} has invalid compiled surface settings`);
    }
    const diagnostics: ProcPlantGltfMaterialDiagnostic[] = [];
    const diagnose = (code: ProcPlantGltfDiagnosticCode, blocking: boolean, message: string, channel?: ProcPlantMaterialChannel) => {
      diagnosticCount++;
      if (diagnosticCount > maxDiagnostics) throw new Error(`glTF material plan exceeds maxDiagnostics (${diagnosticCount} > ${maxDiagnostics})`);
      diagnostics.push({ code, blocking, ...(channel ? { channel } : {}), message });
    };
    const textureInfo = (binding: TextureBinding, channels: ProcPlantGltfTextureInfoPlan["channels"], channel: ProcPlantMaterialChannel) => {
      const texture = source.textures[binding.texture];
      if (!texture) {
        diagnose("invalid-direct-binding", true, `${surface.slot}.${channel} references missing compiled texture ${binding.texture}`, channel);
        return undefined;
      }
      const transformed = hasTransform(texture);
      if (transformed) {
        usesTextureTransform = true;
        diagnose("texture-transform-extension", false, `${surface.slot}.${channel} uses KHR_texture_transform`, channel);
      }
      return {
        texture: binding.texture,
        textureId: texture.id,
        uri: texture.uri,
        texCoord: texture.uvSet ?? 0,
        channels,
        sampler: { wrapS: texture.wrapS ?? "repeat", wrapT: texture.wrapT ?? "repeat" },
        ...(transformed ? {
          transform: {
            extension: "KHR_texture_transform" as const,
            ...(texture.offset ? { offset: texture.offset } : {}),
            ...(texture.scale ? { scale: texture.scale } : {}),
            ...(texture.rotation === undefined ? {} : { rotation: texture.rotation }),
          },
        } : {}),
      };
    };
    const requireBake = (channel: ProcPlantMaterialChannel, reason: string) =>
      diagnose("requires-bake", true, `${surface.slot}.${channel} ${reason}`, channel);
    const coreScalar = (value: number | readonly number[], channel: ProcPlantMaterialChannel, label: string) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        requireBake(channel, `${label} must be a finite value in [0, 1] for core glTF; normalize or bake it`);
        return undefined;
      }
      return value;
    };
    const coreColor = (value: number | readonly number[], channel: ProcPlantMaterialChannel, label: string, components: 3 | 4) => {
      if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4) || value.some((entry) => !Number.isFinite(entry) || entry < 0 || entry > 1)) {
        requireBake(channel, `${label} must be an RGB or RGBA value in [0, 1] for core glTF; normalize or bake it`);
        return undefined;
      }
      const result = [...value];
      while (result.length < components) result.push(1);
      return result.slice(0, components);
    };
    const coreTextureFactor = (value: TextureBinding, channel: ProcPlantMaterialChannel, label: string, colorComponents: 3 | 4 = 3) => {
      if (value.kind === "texture") return value.valueType === "color" ? Array.from({ length: colorComponents }, () => 1) : 1;
      return value.valueType === "color"
        ? coreColor(value.factor, channel, label, colorComponents)
        : coreScalar(value.factor, channel, label);
    };
    const binding = (channel: ProcPlantMaterialChannel) => surface.bindings[channel];
    const expressionBindings = Object.entries(surface.bindings) as Array<[ProcPlantMaterialChannel, ProcPlantMaterialBindingPlan]>;
    for (const [channel, value] of expressionBindings) {
      if (value.kind === "expression") requireBake(channel, `is an expression and must be baked before core glTF export`);
    }

    let baseColorFactor: [number, number, number, number] = [1, 1, 1, 1];
    let baseColorTexture: ProcPlantGltfTextureInfoPlan | undefined;
    const base = binding("baseColor");
    if (base?.kind === "constant") {
      const factor = coreColor(base.value, "baseColor", "constant", 4);
      if (factor) baseColorFactor = factor as [number, number, number, number];
    }
    else if (isTextureBinding(base)) {
      const texture = source.textures[base.texture];
      if (base.channel !== "rgb" || texture?.role !== "color" || texture.colorSpace !== "srgb") {
        requireBake("baseColor", "must be an sRGB color texture sampled through rgb");
      } else {
        baseColorTexture = textureInfo(base, ["rgb", "a"], "baseColor");
        const factor = coreTextureFactor(base, "baseColor", "factor", 4);
        if (!Array.isArray(factor)) requireBake("baseColor", "has a non-color factor");
        else baseColorFactor = factor as [number, number, number, number];
      }
    }

    const opacity = binding("opacity");
    if (opacity?.kind === "constant") {
      const factor = coreScalar(opacity.value, "opacity", "constant");
      if (factor !== undefined) baseColorFactor[3] *= factor;
      if (baseColorTexture && surface.alphaMode !== "opaque") {
        diagnose("opacity-texture-mismatch", true, `${surface.slot}.opacity is constant but core glTF also consumes the base-color texture alpha; bake or repack alpha to preserve intent`, "opacity");
      }
    } else if (isTextureBinding(opacity)) {
      const sameAlpha = baseColorTexture && opacity.texture === baseColorTexture.texture && opacity.channel === "a";
      if (!sameAlpha || surface.alphaMode === "opaque") {
        diagnose("opacity-texture-mismatch", true, `${surface.slot}.opacity requires the alpha channel of the same base-color texture and MASK or BLEND alpha mode`, "opacity");
      } else {
        const factor = coreTextureFactor(opacity, "opacity", "factor");
        if (typeof factor !== "number") requireBake("opacity", "has a non-scalar factor");
        else baseColorFactor[3] *= factor;
      }
    } else if (!opacity && baseColorTexture && surface.alphaMode !== "opaque") {
      diagnose("opacity-texture-mismatch", true, `${surface.slot} uses textured base color with ${surface.alphaMode.toUpperCase()} but has no explicit opacity binding`, "opacity");
    }
    if (surface.alphaMode === "opaque" && baseColorFactor[3] !== 1 && !diagnostics.some((entry) => entry.code === "opaque-alpha-discarded")) {
      diagnose("opaque-alpha-discarded", true, `${surface.slot} has authored alpha ${baseColorFactor[3]} but OPAQUE core glTF ignores alpha; choose MASK or BLEND`, "opacity");
    }

    let normalTexture: ProcPlantGltfTextureInfoPlan | undefined;
    const normal = binding("normal");
    if (isTextureBinding(normal)) {
      const texture = source.textures[normal.texture];
      if (normal.kind !== "texture" || normal.channel !== "normal" || texture?.role !== "normal" || texture.colorSpace !== "linear") {
        requireBake("normal", "must be an unmodified linear normal texture sampled through normal");
      } else normalTexture = textureInfo(normal, ["normal"], "normal");
    } else if (normal?.kind === "constant") requireBake("normal", "cannot be represented as a core glTF normal constant");

    let roughnessFactor = 1;
    let metallicFactor = 0;
    let metallicRoughnessTexture: ProcPlantGltfTextureInfoPlan | undefined;
    const roughness = binding("roughness");
    const metalness = binding("metalness");
    if (roughness?.kind === "constant") roughnessFactor = coreScalar(roughness.value, "roughness", "constant") ?? roughnessFactor;
    if (metalness?.kind === "constant") metallicFactor = coreScalar(metalness.value, "metalness", "constant") ?? metallicFactor;
    const roughTexture = isTextureBinding(roughness) ? roughness : undefined;
    const metalTexture = isTextureBinding(metalness) ? metalness : undefined;
    if (roughTexture) {
      const factor = coreTextureFactor(roughTexture, "roughness", "factor");
      if (typeof factor === "number") roughnessFactor = factor;
    }
    if (metalTexture) {
      const factor = coreTextureFactor(metalTexture, "metalness", "factor");
      if (typeof factor === "number") metallicFactor = factor;
    }
    if (roughTexture || metalTexture) {
      const roughOkay = !roughTexture || roughTexture.channel === "g";
      const metalOkay = !metalTexture || metalTexture.channel === "b";
      const sameTexture = !roughTexture || !metalTexture || roughTexture.texture === metalTexture.texture;
      const otherChannelCancelled = roughTexture && !metalTexture ? metallicFactor === 0 : metalTexture && !roughTexture ? roughnessFactor === 0 : true;
      const selected = roughTexture ?? metalTexture!;
      const texture = source.textures[selected.texture];
      if (roughOkay && metalOkay && sameTexture && otherChannelCancelled && texture?.colorSpace === "linear" && texture.role === "data") {
        metallicRoughnessTexture = textureInfo(selected, ["g", "b"], roughTexture ? "roughness" : "metalness");
      } else {
        diagnose("requires-channel-pack", true, `${surface.slot} metallic-roughness requires one linear data texture with roughness in green and metalness in blue; unbound sampled channels must be cancelled by a zero factor`, roughTexture ? "roughness" : "metalness");
      }
    }

    let occlusionTexture: ProcPlantGltfMaterialPlan["occlusionTexture"];
    const occlusion = binding("ambientOcclusion");
    if (occlusion?.kind === "constant") {
      const value = coreScalar(occlusion.value, "ambientOcclusion", "constant");
      if (value !== undefined && value !== 1) requireBake("ambientOcclusion", "cannot be represented as a constant (only neutral 1 is lossless)");
    } else if (isTextureBinding(occlusion)) {
      const factor = coreTextureFactor(occlusion, "ambientOcclusion", "factor");
      const texture = source.textures[occlusion.texture];
      if (occlusion.channel !== "r" || factor !== 1 || texture?.colorSpace !== "linear" || texture.role !== "data") {
        requireBake("ambientOcclusion", "must be an unfactored linear data texture sampled through red");
      } else {
        const info = textureInfo(occlusion, ["r"], "ambientOcclusion");
        if (info) occlusionTexture = { ...info, strength: 1 };
      }
    }

    let emissiveFactor: [number, number, number] = [0, 0, 0];
    let emissiveTexture: ProcPlantGltfTextureInfoPlan | undefined;
    const emissive = binding("emissive");
    if (emissive?.kind === "constant") {
      const factor = coreColor(emissive.value, "emissive", "constant", 3);
      if (factor) emissiveFactor = factor as [number, number, number];
    }
    else if (isTextureBinding(emissive)) {
      const texture = source.textures[emissive.texture];
      if (emissive.channel !== "rgb" || texture?.role !== "color" || texture.colorSpace !== "srgb") {
        requireBake("emissive", "must be an sRGB color texture sampled through rgb");
      } else {
        emissiveTexture = textureInfo(emissive, ["rgb"], "emissive");
        const factor = coreTextureFactor(emissive, "emissive", "factor");
        if (!Array.isArray(factor)) requireBake("emissive", "has a non-color factor");
        else emissiveFactor = factor as [number, number, number];
      }
    }

    const unsupported: readonly ProcPlantMaterialChannel[] = ["height", "mossMask", "lichenMask", "wetnessMask", "snowMask"];
    for (const channel of unsupported) {
      if (binding(channel) && binding(channel)?.kind !== "expression") {
        diagnose("unsupported-core-channel", true, `${surface.slot}.${channel} has no core glTF 2.0 material property; bake it into standard PBR textures or use a custom extension`, channel);
      }
    }

    return {
      slot: surface.slot,
      ready: !diagnostics.some((diagnostic) => diagnostic.blocking),
      doubleSided: surface.doubleSided,
      alphaMode: surface.alphaMode.toUpperCase() as "OPAQUE" | "MASK" | "BLEND",
      ...(surface.alphaMode === "mask" ? { alphaCutoff: surface.alphaCutoff } : {}),
      pbrMetallicRoughness: {
        baseColorFactor,
        ...(baseColorTexture ? { baseColorTexture } : {}),
        metallicFactor,
        roughnessFactor,
        ...(metallicRoughnessTexture ? { metallicRoughnessTexture } : {}),
      },
      ...(normalTexture ? { normalTexture } : {}),
      ...(occlusionTexture ? { occlusionTexture } : {}),
      emissiveFactor,
      ...(emissiveTexture ? { emissiveTexture } : {}),
      diagnostics,
    };
  });

  return {
    contract: PROCPLANT_GLTF_MATERIAL_PLAN_CONTRACT,
    version: PROCPLANT_GLTF_MATERIAL_PLAN_VERSION,
    sourceContract: source.contract,
    sourceVersion: source.version,
    sourceId: source.id,
    sourceContentHash: source.contentHash,
    ready: materials.every((material) => material.ready),
    extensionsUsed: usesTextureTransform ? ["KHR_texture_transform"] : [],
    materials,
  };
};
