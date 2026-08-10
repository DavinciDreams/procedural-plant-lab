import * as THREE from "three";
import type {
  ProcPlantHeroGlbImportPackage,
  ProcPlantHeroGlbMaterial,
  ProcPlantHeroGlbSampler,
  ProcPlantHeroGlbTextureBinding,
} from "./procplant-hero-glb-import";

export interface ProcPlantHeroSourceMaterialAudit {
  materialIndex: number | null;
  materialName: string;
  sourceMaterialApplied: boolean;
  decodedImages: number;
  textureBindings: number;
  mimeTypes: string[];
  colorTextureBindings: number;
  linearTextureBindings: number;
  uvSet: 0;
  warnings: string[];
}

export interface ProcPlantPreparedHeroSourceMaterial {
  material: THREE.MeshStandardMaterial;
  textures: readonly THREE.Texture[];
  audit: ProcPlantHeroSourceMaterialAudit;
  dispose(): void;
}

export type ProcPlantHeroImageDecoder = (bytes: Uint8Array, mimeType: string) => Promise<ImageBitmap>;

const defaultDecode: ProcPlantHeroImageDecoder = async (bytes, mimeType) => {
  if (typeof createImageBitmap !== "function") {
    throw new Error("Imported hero source materials require browser createImageBitmap support.");
  }
  const owned = bytes.slice().buffer as ArrayBuffer;
  return createImageBitmap(new Blob([owned], { type: mimeType }), {
    imageOrientation: "none",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
};

const minFilter = (value: ProcPlantHeroGlbSampler["minFilter"]) => value === 9728 ? THREE.NearestFilter
  : value === 9729 ? THREE.LinearFilter
    : value === 9984 ? THREE.NearestMipmapNearestFilter
      : value === 9985 ? THREE.LinearMipmapNearestFilter
        : value === 9986 ? THREE.NearestMipmapLinearFilter
          : THREE.LinearMipmapLinearFilter;

const magFilter = (value: ProcPlantHeroGlbSampler["magFilter"]) => value === 9728 ? THREE.NearestFilter : THREE.LinearFilter;

const wrapping = (value: ProcPlantHeroGlbSampler["wrapS"]) => value === 33071 ? THREE.ClampToEdgeWrapping
  : value === 33648 ? THREE.MirroredRepeatWrapping
    : THREE.RepeatWrapping;

const countBindings = (material: ProcPlantHeroGlbMaterial) => [
  material.baseColorTexture,
  material.metallicRoughnessTexture,
  material.normalTexture,
  material.occlusionTexture,
  material.emissiveTexture,
].filter(Boolean).length;

/**
 * Decode and own a selected imported material for the lazy browser preview.
 * KTX2 remains a valid ingestion payload, but decoding it requires a renderer-
 * configured KTX2Loader and is intentionally not guessed here.
 */
export const prepareProcPlantHeroSourceMaterial = async (
  imported: ProcPlantHeroGlbImportPackage,
  materialIndex: number | null,
  decoder: ProcPlantHeroImageDecoder = defaultDecode,
): Promise<ProcPlantPreparedHeroSourceMaterial> => {
  const source = materialIndex === null ? null : imported.materials[materialIndex] ?? null;
  if (!source) {
    const material = new THREE.MeshStandardMaterial({ color: 0x72523b, roughness: 0.86, metalness: 0 });
    material.name = "procplant-imported-hero-fallback-bark";
    let disposed = false;
    return {
      material,
      textures: [],
      audit: {
        materialIndex,
        materialName: material.name,
        sourceMaterialApplied: false,
        decodedImages: 0,
        textureBindings: 0,
        mimeTypes: [],
        colorTextureBindings: 0,
        linearTextureBindings: 0,
        uvSet: 0,
        warnings: [materialIndex === null ? "selected primitive has no source material" : "selected source material record is missing"],
      },
      dispose: () => { if (!disposed) { disposed = true; material.dispose(); } },
    };
  }

  const bindingEntries: Array<[ProcPlantHeroGlbTextureBinding | null, "color" | "linear"]> = [
    [source.baseColorTexture, "color"],
    [source.metallicRoughnessTexture, "linear"],
    [source.normalTexture, "linear"],
    [source.occlusionTexture, "linear"],
    [source.emissiveTexture, "color"],
  ];
  for (const [binding] of bindingEntries) {
    if (!binding) continue;
    const image = imported.textures[binding.imageIndex];
    if (!image) throw new Error(`Imported hero material ${materialIndex} references missing image ${binding.imageIndex}.`);
    if (image.mimeType === "image/ktx2") {
      throw new Error(`Imported hero material ${materialIndex} uses KTX2 image ${binding.imageIndex}; live preview requires a renderer-configured KTX2 decoder.`);
    }
  }

  const decoded = new Map<number, ImageBitmap>();
  const decoding = new Map<number, Promise<ImageBitmap>>();
  const ownedTextures: THREE.Texture[] = [];
  const textureFor = async (binding: ProcPlantHeroGlbTextureBinding | null, colorSpace: "color" | "linear") => {
    if (!binding) return null;
    const image = imported.textures[binding.imageIndex]!;
    let decodePromise = decoding.get(binding.imageIndex);
    if (!decodePromise) {
      decodePromise = decoder(image.bytes, image.mimeType).then((bitmap) => {
        decoded.set(binding.imageIndex, bitmap);
        return bitmap;
      });
      decoding.set(binding.imageIndex, decodePromise);
    }
    const bitmap = await decodePromise;
    const texture = new THREE.Texture(bitmap);
    texture.name = `${image.name}:${binding.textureIndex}`;
    texture.flipY = false;
    texture.channel = 0;
    texture.colorSpace = colorSpace === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.magFilter = magFilter(binding.sampler.magFilter);
    texture.minFilter = minFilter(binding.sampler.minFilter);
    texture.wrapS = wrapping(binding.sampler.wrapS);
    texture.wrapT = wrapping(binding.sampler.wrapT);
    texture.offset.fromArray(binding.transform.offset);
    texture.rotation = binding.transform.rotation;
    texture.repeat.fromArray(binding.transform.scale);
    texture.needsUpdate = true;
    ownedTextures.push(texture);
    return texture;
  };

  let material: THREE.MeshStandardMaterial | null = null;
  let resourcesReleased = false;
  let disposeCalled = false;
  const releaseOwned = () => {
    if (resourcesReleased) return;
    resourcesReleased = true;
    for (const texture of ownedTextures) texture.dispose();
    for (const bitmap of new Set(decoded.values())) bitmap.close();
  };
  const dispose = () => {
    if (disposeCalled) return;
    disposeCalled = true;
    if (material) material.dispose();
    else releaseOwned();
  };
  try {
    const map = await textureFor(source.baseColorTexture, "color");
    const metallicRoughnessMap = await textureFor(source.metallicRoughnessTexture, "linear");
    const normalMap = await textureFor(source.normalTexture, "linear");
    const aoMap = await textureFor(source.occlusionTexture, "linear");
    const emissiveMap = await textureFor(source.emissiveTexture, "color");
    const color = new THREE.Color().setRGB(source.baseColorFactor[0], source.baseColorFactor[1], source.baseColorFactor[2], THREE.LinearSRGBColorSpace);
    const emissive = new THREE.Color().setRGB(source.emissiveFactor[0], source.emissiveFactor[1], source.emissiveFactor[2], THREE.LinearSRGBColorSpace);
    material = new THREE.MeshStandardMaterial({
      name: source.name,
      color,
      opacity: source.baseColorFactor[3],
      map,
      metalness: source.metallicFactor,
      metalnessMap: metallicRoughnessMap,
      roughness: source.roughnessFactor,
      roughnessMap: metallicRoughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(source.normalTexture?.scale ?? 1, source.normalTexture?.scale ?? 1),
      aoMap,
      aoMapIntensity: source.occlusionTexture?.strength ?? 1,
      emissive,
      emissiveMap,
      side: source.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: source.alphaMode === "BLEND",
      alphaTest: source.alphaMode === "MASK" ? source.alphaCutoff : 0,
      depthWrite: source.alphaMode !== "BLEND",
    });
    material.userData.procplantImportedSourceMaterial = {
      materialIndex,
      sourceContentHash: imported.inspection.contentHash,
      uvSet: 0,
    };
    // The preview's generic material disposal is the ownership boundary. This
    // listener releases its separately-owned textures and decoded bitmaps once.
    material.addEventListener("dispose", releaseOwned);
    const mimeTypes = [...new Set(bindingEntries.flatMap(([binding]) => binding ? [imported.textures[binding.imageIndex]!.mimeType] : []))].sort();
    return {
      material,
      textures: ownedTextures,
      audit: {
        materialIndex,
        materialName: source.name,
        sourceMaterialApplied: true,
        decodedImages: decoded.size,
        textureBindings: countBindings(source),
        mimeTypes,
        colorTextureBindings: bindingEntries.filter(([binding, role]) => binding && role === "color").length,
        linearTextureBindings: bindingEntries.filter(([binding, role]) => binding && role === "linear").length,
        uvSet: 0,
        warnings: [],
      },
      dispose,
    };
  } catch (error) {
    releaseOwned();
    throw error;
  }
};
