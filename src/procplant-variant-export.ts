import {
  compileProcPlantLods,
  buildProcPlantTemplate,
  defaultPlantEnvironment,
  type ProcPlantCompiledLod,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantTemplate,
} from "./procplants";
import {
  applyProcPlantVariant,
  type ProcPlantVariantSpec,
} from "./plant-variants";
import {
  disposePreparedProcPlantGlbExport,
  exportProcPlantGlb,
  exportProcPlantScenesGlb,
  prepareProcPlantGlbExport,
  procPlantGlbSceneName,
  type PreparedProcPlantGlbExport,
  type ProcPlantGlbExportOptions,
  type ProcPlantGlbSource,
} from "./procplant-export";
import { compressProcPlantGlbMeshopt } from "./procplant-meshopt-compression";

export const PROCPLANT_VARIANT_EXPORT_CONTRACT = "procplants.variant-glb-set" as const;
export const PROCPLANT_VARIANT_EXPORT_VERSION = 1 as const;
export const PROCPLANT_VARIANT_BUNDLE_CONTRACT = "procplants.variant-bundle" as const;
export const PROCPLANT_VARIANT_BUNDLE_VERSION = 1 as const;

export interface ProcPlantNamedVariantSpec extends ProcPlantVariantSpec {
  name: string;
}

export const PROCPLANT_STANDARD_VARIANTS: readonly ProcPlantNamedVariantSpec[] = [
  { name: "spring", season: "spring", health: 1, maturity: 0.82 },
  { name: "summer", season: "summer", health: 1, maturity: 1 },
  { name: "autumn", season: "autumn", health: 0.88, maturity: 1 },
  { name: "winter", season: "winter", health: 0.72, maturity: 1 },
  { name: "damaged", season: "summer", health: 0.32, maturity: 0.94 },
] as const;

export interface ProcPlantVariantSourceEntry {
  name: string;
  variant: ProcPlantVariantSpec;
  genomeId: string;
  source: ProcPlantGlbSource;
  options: ProcPlantGlbExportOptions;
}

export interface ProcPlantVariantSourceSet {
  contract: typeof PROCPLANT_VARIANT_EXPORT_CONTRACT;
  version: typeof PROCPLANT_VARIANT_EXPORT_VERSION;
  baseGenomeId: string;
  seed: number;
  entries: ProcPlantVariantSourceEntry[];
}

export interface PreparedProcPlantVariantExportEntry extends Omit<ProcPlantVariantSourceEntry, "source"> {
  prepared: PreparedProcPlantGlbExport;
}

export interface PreparedProcPlantVariantExportSet {
  contract: typeof PROCPLANT_VARIANT_EXPORT_CONTRACT;
  version: typeof PROCPLANT_VARIANT_EXPORT_VERSION;
  baseGenomeId: string;
  seed: number;
  entries: PreparedProcPlantVariantExportEntry[];
}

export interface ProcPlantVariantGlbFile {
  name: string;
  variant: ProcPlantVariantSpec;
  genomeId: string;
  fileName: string;
  bytes: ArrayBuffer;
}

export interface ProcPlantVariantExportOptions {
  variants?: readonly ProcPlantNamedVariantSpec[];
  includeLods?: boolean;
  glb?: Omit<ProcPlantGlbExportOptions, "name" | "genomeId" | "seed" | "metadata">;
  metadata?: Record<string, string | number | boolean | null>;
}

export type ProcPlantVariantBundleLod = ProcPlantCompiledLod["level"] | "all";

export interface ProcPlantVariantBundleOptions extends Omit<ProcPlantVariantExportOptions, "includeLods"> {
  /** Every selected LOD is a separate standard glTF scene. */
  lod?: ProcPlantVariantBundleLod;
  /** Hard output guard. Defaults to 256 MiB and cannot exceed 1 GiB. */
  maxBundleBytes?: number;
}

export interface ProcPlantVariantBundleLodEntry {
  level: ProcPlantCompiledLod["level"];
  label: ProcPlantCompiledLod["label"];
  distance: number;
  triangles: number;
  vertices: number;
  scene: number;
  sceneName: string;
  rootNodeName: string;
  meshNodeName: string;
  collisionNodeName?: string;
}

export interface ProcPlantVariantBundleEntry {
  index: number;
  name: string;
  season: ProcPlantVariantSpec["season"];
  health: number;
  maturity: number;
  genomeId: string;
  lods: ProcPlantVariantBundleLodEntry[];
}

export interface ProcPlantVariantBundleManifest {
  contract: typeof PROCPLANT_VARIANT_BUNDLE_CONTRACT;
  version: typeof PROCPLANT_VARIANT_BUNDLE_VERSION;
  baseGenomeId: string;
  seed: number;
  defaultScene: number;
  lodSelection: ProcPlantVariantBundleLod;
  selection: "select-gltf-scene";
  variants: ProcPlantVariantBundleEntry[];
  collision: null | {
    type: NonNullable<ProcPlantGlbExportOptions["collision"]>["type"];
    policy: "per-variant-lod-scene";
  };
  deduplication: {
    meshInstances: number;
    uniqueGeometries: number;
    uniqueMaterials: number;
  };
}

export interface PreparedProcPlantVariantGlbBundle {
  contract: typeof PROCPLANT_VARIANT_BUNDLE_CONTRACT;
  version: typeof PROCPLANT_VARIANT_BUNDLE_VERSION;
  baseGenomeId: string;
  seed: number;
  fileName: string;
  scenes: THREE.Scene[];
  prepared: PreparedProcPlantGlbExport[];
  manifest: ProcPlantVariantBundleManifest;
}

export interface ProcPlantVariantGlbBundle {
  contract: typeof PROCPLANT_VARIANT_BUNDLE_CONTRACT;
  version: typeof PROCPLANT_VARIANT_BUNDLE_VERSION;
  fileName: string;
  manifest: ProcPlantVariantBundleManifest;
  bytes: ArrayBuffer;
}

const stableVariantName = (name: string) => {
  const value = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!value) throw new Error("variant export names must contain a stable filename character");
  return value;
};

const validateVariants = (variants: readonly ProcPlantNamedVariantSpec[]) => {
  if (variants.length === 0) throw new Error("variant export requires at least one variant");
  const names = new Set<string>();
  for (const variant of variants) {
    const name = stableVariantName(variant.name);
    if (names.has(name)) throw new Error(`duplicate variant export name: ${name}`);
    names.add(name);
    if (!Number.isFinite(variant.health) || !Number.isFinite(variant.maturity)) {
      throw new Error(`${name} health and maturity must be finite`);
    }
  }
};

const validateBundleLod = (lod: ProcPlantVariantBundleLod): ProcPlantVariantBundleLod => {
  if (lod !== "all" && lod !== 0 && lod !== 1 && lod !== 2 && lod !== 3) {
    throw new Error("variant bundle lod must be 0, 1, 2, 3, or all");
  }
  return lod;
};

const materialSignature = (material: THREE.Material) => {
  if (material instanceof THREE.MeshStandardMaterial) {
    return JSON.stringify(["standard", material.vertexColors, material.side, material.roughness, material.metalness, material.alphaTest]);
  }
  if (material instanceof THREE.MeshBasicMaterial) {
    return JSON.stringify(["basic", material.transparent, material.opacity, material.depthWrite]);
  }
  return material.type;
};

const byteHash = (value: ArrayBufferView) => {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
};

const geometrySignature = (geometry: THREE.BufferGeometry) => {
  const attributes = Object.keys(geometry.attributes).sort().map((name) => {
    const attribute = geometry.getAttribute(name);
    return [name, attribute.itemSize, attribute.count, attribute.normalized, byteHash(attribute.array)];
  });
  const index = geometry.index;
  return JSON.stringify([attributes, index ? [index.itemSize, index.count, byteHash(index.array)] : null]);
};

const arraysEqual = (left: ArrayLike<number>, right: ArrayLike<number>) => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
};

const geometriesEqual = (left: THREE.BufferGeometry, right: THREE.BufferGeometry) => {
  const leftNames = Object.keys(left.attributes).sort();
  const rightNames = Object.keys(right.attributes).sort();
  if (leftNames.join("\0") !== rightNames.join("\0")) return false;
  for (const name of leftNames) {
    const a = left.getAttribute(name);
    const b = right.getAttribute(name);
    if (a.itemSize !== b.itemSize || a.normalized !== b.normalized || !arraysEqual(a.array, b.array)) return false;
  }
  if (Boolean(left.index) !== Boolean(right.index)) return false;
  return !left.index || arraysEqual(left.index.array, right.index!.array);
};

const deduplicatePreparedBundle = (prepared: readonly PreparedProcPlantGlbExport[]) => {
  const materials = new Map<string, THREE.Material>();
  const geometries = new Map<string, THREE.BufferGeometry[]>();
  let meshInstances = 0;
  for (const entry of prepared) {
    for (const mesh of [...entry.meshes, ...entry.collisionMeshes]) {
      meshInstances++;
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const deduplicated = sourceMaterials.map((sourceMaterial) => {
        const materialKey = materialSignature(sourceMaterial);
        const material = materials.get(materialKey);
        if (material) {
          if (sourceMaterial !== material) sourceMaterial.dispose();
          return material;
        }
        materials.set(materialKey, sourceMaterial);
        return sourceMaterial;
      });
      mesh.material = (Array.isArray(mesh.material) ? deduplicated : deduplicated[0]!) as never;

      const geometryKey = geometrySignature(mesh.geometry);
      const candidates = geometries.get(geometryKey) ?? [];
      const geometry = candidates.find((candidate) => geometriesEqual(candidate, mesh.geometry));
      if (geometry) {
        if (mesh.geometry !== geometry) mesh.geometry.dispose();
        mesh.geometry = geometry;
      } else {
        candidates.push(mesh.geometry);
        geometries.set(geometryKey, candidates);
      }
    }
  }
  return {
    meshInstances,
    uniqueGeometries: [...geometries.values()].reduce((sum, entries) => sum + entries.length, 0),
    uniqueMaterials: materials.size,
  };
};

const disposePreparedBundle = (prepared: readonly PreparedProcPlantGlbExport[]) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const entry of prepared) {
    for (const mesh of [...entry.meshes, ...entry.collisionMeshes]) {
      geometries.add(mesh.geometry);
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of meshMaterials) materials.add(material);
    }
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
};

const injectBundleManifest = (source: ArrayBuffer, manifest: ProcPlantVariantBundleManifest) => {
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("variant bundle exporter returned an invalid GLB header");
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > bytes.length) {
    throw new Error("variant bundle exporter returned an invalid GLB JSON chunk");
  }
  const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd();
  const json = JSON.parse(jsonText) as Record<string, unknown>;
  const extras = json.extras && typeof json.extras === "object" && !Array.isArray(json.extras)
    ? json.extras as Record<string, unknown>
    : {};
  json.extras = { ...extras, procplantVariantBundle: manifest };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const remainderOffset = 20 + jsonLength;
  const output = new Uint8Array(20 + paddedLength + (bytes.length - remainderOffset));
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, 0x46546c67, true);
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, output.length, true);
  outputView.setUint32(12, paddedLength, true);
  outputView.setUint32(16, 0x4e4f534a, true);
  output.set(encoded, 20);
  output.fill(0x20, 20 + encoded.length, 20 + paddedLength);
  output.set(bytes.subarray(remainderOffset), 20 + paddedLength);
  return output.buffer;
};

export const compileProcPlantVariantGlbSources = (
  baseGenome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: ProcPlantVariantExportOptions = {},
): ProcPlantVariantSourceSet => {
  const variants = options.variants ?? PROCPLANT_STANDARD_VARIANTS;
  validateVariants(variants);
  const stableSeed = seed >>> 0;
  const entries = variants.map((named): ProcPlantVariantSourceEntry => {
    const name = stableVariantName(named.name);
    const variant = { season: named.season, health: named.health, maturity: named.maturity };
    const genome = applyProcPlantVariant(baseGenome, variant);
    const source: ProcPlantTemplate | ProcPlantCompiledLod[] = options.includeLods === false
      ? buildProcPlantTemplate(genome, stableSeed, env).template
      : compileProcPlantLods(genome, stableSeed, env);
    return {
      name,
      variant,
      genomeId: genome.id,
      source,
      options: {
        ...options.glb,
        name: `${baseGenome.id}-${name}`,
        genomeId: genome.id,
        seed: stableSeed,
        metadata: {
          ...options.metadata,
          variantSet: baseGenome.id,
          variantName: name,
          season: variant.season,
          health: variant.health,
          maturity: variant.maturity,
        },
      },
    };
  });
  return {
    contract: PROCPLANT_VARIANT_EXPORT_CONTRACT,
    version: PROCPLANT_VARIANT_EXPORT_VERSION,
    baseGenomeId: baseGenome.id,
    seed: stableSeed,
    entries,
  };
};

/**
 * Prepare one standard glTF scene for each selected variant/LOD pair. Scene
 * selection is the compatibility mechanism; no visibility or LOD extension is declared.
 */
export const prepareProcPlantVariantGlbBundle = (
  baseGenome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: ProcPlantVariantBundleOptions = {},
): PreparedProcPlantVariantGlbBundle => {
  const variants = options.variants ?? PROCPLANT_STANDARD_VARIANTS;
  validateVariants(variants);
  if (variants.length > 16) throw new Error("variant bundle supports at most 16 variants");
  const lodSelection = validateBundleLod(options.lod ?? "all");
  const compiled = compileProcPlantVariantGlbSources(baseGenome, seed, env, {
    ...options,
    includeLods: true,
  });
  const lodCount = lodSelection === "all" ? 4 : 1;
  if (compiled.entries.length * lodCount > 64) throw new Error("variant bundle supports at most 64 scenes");

  const prepared: PreparedProcPlantGlbExport[] = [];
  const scenes: THREE.Scene[] = [];
  const bundleEntries: ProcPlantVariantBundleEntry[] = [];
  try {
    for (let variantIndex = 0; variantIndex < compiled.entries.length; variantIndex++) {
      const entry = compiled.entries[variantIndex]!;
      if (!Array.isArray(entry.source)) throw new Error(`${entry.name} did not compile a real LOD set`);
      const selectedLods = lodSelection === "all"
        ? entry.source
        : entry.source.filter((lod) => lod.level === lodSelection);
      if (selectedLods.length !== lodCount) throw new Error(`${entry.name} is missing selected LOD ${lodSelection}`);
      const bundleEntry: ProcPlantVariantBundleEntry = {
        index: variantIndex,
        name: entry.name,
        season: entry.variant.season,
        health: entry.variant.health,
        maturity: entry.variant.maturity,
        genomeId: entry.genomeId,
        lods: [],
      };
      for (const lod of selectedLods) {
        const sceneIndex = scenes.length;
        const exportName = `${baseGenome.id}-${entry.name}-lod${lod.level}-${lod.label}`;
        const scenePrepared = prepareProcPlantGlbExport([lod], {
          ...entry.options,
          name: exportName,
          metadata: {
            ...entry.options.metadata,
            variantBundleContract: PROCPLANT_VARIANT_BUNDLE_CONTRACT,
            variantBundleVersion: PROCPLANT_VARIANT_BUNDLE_VERSION,
            variantIndex,
            sceneIndex,
            lodSelection: String(lodSelection),
          },
        });
        const mesh = scenePrepared.meshes[0]!;
        const collision = scenePrepared.collisionMeshes[0];
        const root = new THREE.Group();
        root.name = `${scenePrepared.sceneName}-root`;
        root.userData.procplantVariantBundle = {
          contract: PROCPLANT_VARIANT_BUNDLE_CONTRACT,
          version: PROCPLANT_VARIANT_BUNDLE_VERSION,
          variantIndex,
          variantName: entry.name,
          lodLevel: lod.level,
          lodLabel: lod.label,
          sceneIndex,
        };
        const children = [...scenePrepared.scene.children];
        scenePrepared.scene.clear();
        root.add(...children);
        scenePrepared.scene.add(root);
        scenePrepared.scene.userData.procplantVariantBundle = root.userData.procplantVariantBundle;
        prepared.push(scenePrepared);
        scenes.push(scenePrepared.scene);
        bundleEntry.lods.push({
          level: lod.level,
          label: lod.label,
          distance: lod.distance,
          triangles: lod.triangles,
          vertices: lod.vertices,
          scene: sceneIndex,
          sceneName: scenePrepared.sceneName,
          rootNodeName: root.name,
          meshNodeName: mesh.name,
          ...(collision ? { collisionNodeName: collision.name } : {}),
        });
      }
      bundleEntries.push(bundleEntry);
    }
    const deduplication = deduplicatePreparedBundle(prepared);
    const manifest: ProcPlantVariantBundleManifest = {
      contract: PROCPLANT_VARIANT_BUNDLE_CONTRACT,
      version: PROCPLANT_VARIANT_BUNDLE_VERSION,
      baseGenomeId: baseGenome.id,
      seed: seed >>> 0,
      defaultScene: 0,
      lodSelection,
      selection: "select-gltf-scene",
      variants: bundleEntries,
      collision: options.glb?.collision
        ? { type: options.glb.collision.type, policy: "per-variant-lod-scene" }
        : null,
      deduplication,
    };
    const fileName = `${procPlantGlbSceneName({ name: `${baseGenome.id}-variants` })}.glb`;
    return {
      contract: PROCPLANT_VARIANT_BUNDLE_CONTRACT,
      version: PROCPLANT_VARIANT_BUNDLE_VERSION,
      baseGenomeId: baseGenome.id,
      seed: seed >>> 0,
      fileName,
      scenes,
      prepared,
      manifest,
    };
  } catch (error) {
    disposePreparedBundle(prepared);
    throw error;
  }
};

export const disposePreparedProcPlantVariantGlbBundle = (bundle: PreparedProcPlantVariantGlbBundle) => {
  disposePreparedBundle(bundle.prepared);
};

/** Export all selected variants and LODs in one multi-scene, standards-compatible GLB. */
export const exportProcPlantVariantGlbBundle = async (
  baseGenome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: ProcPlantVariantBundleOptions = {},
): Promise<ProcPlantVariantGlbBundle> => {
  const maxBundleBytes = options.maxBundleBytes ?? 256 * 1024 * 1024;
  if (!Number.isInteger(maxBundleBytes) || maxBundleBytes < 1024 || maxBundleBytes > 1024 * 1024 * 1024) {
    throw new Error("maxBundleBytes must be an integer in [1024, 1073741824]");
  }
  const prepared = prepareProcPlantVariantGlbBundle(baseGenome, seed, env, options);
  try {
    const serialized = await exportProcPlantScenesGlb(prepared.scenes, options.glb?.exporter);
    const bundled = injectBundleManifest(serialized, prepared.manifest);
    const bytes = options.glb?.meshopt
      ? (await compressProcPlantGlbMeshopt(bundled, options.glb.meshopt)).bytes
      : bundled;
    if (bytes.byteLength > maxBundleBytes) {
      throw new Error(`variant bundle exceeds maxBundleBytes (${bytes.byteLength} > ${maxBundleBytes})`);
    }
    return {
      contract: PROCPLANT_VARIANT_BUNDLE_CONTRACT,
      version: PROCPLANT_VARIANT_BUNDLE_VERSION,
      fileName: prepared.fileName,
      manifest: prepared.manifest,
      bytes,
    };
  } finally {
    disposePreparedProcPlantVariantGlbBundle(prepared);
  }
};

export const prepareProcPlantVariantGlbSet = (
  baseGenome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: ProcPlantVariantExportOptions = {},
): PreparedProcPlantVariantExportSet => {
  const compiled = compileProcPlantVariantGlbSources(baseGenome, seed, env, options);
  return {
    contract: compiled.contract,
    version: compiled.version,
    baseGenomeId: compiled.baseGenomeId,
    seed: compiled.seed,
    entries: compiled.entries.map(({ source, ...entry }) => ({
      ...entry,
      prepared: prepareProcPlantGlbExport(source, entry.options),
    })),
  };
};

export const disposePreparedProcPlantVariantGlbSet = (set: PreparedProcPlantVariantExportSet) => {
  for (const entry of set.entries) disposePreparedProcPlantGlbExport(entry.prepared);
};

/** Browser/Node serialization of one deterministic GLB per requested variant. */
export const exportProcPlantVariantGlbs = async (
  baseGenome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
  options: ProcPlantVariantExportOptions = {},
): Promise<ProcPlantVariantGlbFile[]> => {
  const compiled = compileProcPlantVariantGlbSources(baseGenome, seed, env, options);
  const files: ProcPlantVariantGlbFile[] = [];
  for (const entry of compiled.entries) {
    const bytes = await exportProcPlantGlb(entry.source, entry.options);
    files.push({
      name: entry.name,
      variant: entry.variant,
      genomeId: entry.genomeId,
      fileName: `${procPlantGlbSceneName(entry.options)}.glb`,
      bytes,
    });
  }
  return files;
};
import * as THREE from "three";
