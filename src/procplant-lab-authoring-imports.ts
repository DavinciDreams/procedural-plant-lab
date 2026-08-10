import * as THREE from "three";
import { PROCPLANT_GENERATOR_CONTRACT_REVISION } from "./procplant-contract";
import {
  createProcPlantAerialRootGeometry,
  createProcPlantBerryGeometry,
  createProcPlantConeGeometry,
  createProcPlantFruitGeometry,
  createProcPlantLeafGeometry,
  createProcPlantThornGeometry,
  type ProcPlantAccessoryKind,
  type ProcPlantGenome,
} from "./procplants";
import {
  materializeProcPlantAttachments,
  type ProcPlantAttachmentMaterialization,
  type ProcPlantAttachmentPrototype,
} from "./procplant-attachment-materializer";
import { importProcPlantHeroGlb } from "./procplant-hero-glb-import";
import {
  prepareProcPlantHeroSourceMaterial,
  type ProcPlantPreparedHeroSourceMaterial,
  type ProcPlantHeroSourceMaterialAudit,
} from "./procplant-hero-source-material";
import {
  authorProcPlantHeroSpine,
  createProcPlantHeroSpineGeometry,
  type ProcPlantHeroSpineAuthoringAudit,
} from "./procplant-hero-spine-authoring";
import {
  compileProcPlantMaterialGraph,
  type ProcPlantMaterialGraph,
} from "./procplant-material-graph";
import {
  bakeProcPlantMaterials,
  type ProcPlantBakedMaterialBundle,
  type ProcPlantMaterialPixelSource,
} from "./procplant-material-bake";
import { exportProcPlantScenesGlb } from "./procplant-export";
import type { ProcPlantMeshAttachmentSpec, ProcPlantMeshSpine } from "./procplant-mesh-helper";

export interface ProcPlantLabHeroPreview {
  group: THREE.Group;
  contentHash: string;
  sourceContentHash: string;
  audit: ProcPlantHeroSpineAuthoringAudit;
  trunk: THREE.Mesh;
  leaves: THREE.InstancedMesh | null;
  leafMatrices: THREE.Matrix4[];
  leafSways: number[];
  attachmentMaterialization: ProcPlantAttachmentMaterialization;
  sourceMaterialAudit: ProcPlantHeroSourceMaterialAudit;
  spine: ProcPlantMeshSpine;
}

const createProcPlantHeroBranchPrototype = () => {
  const geometry = new THREE.CylinderGeometry(0.035, 0.095, 1, 5, 1, false);
  // Mesh-attachment transforms use local +Z as the emitted attachment tangent.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, 0.5);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const createProcPlantHeroAccessoryPrototype = (kind: ProcPlantAccessoryKind) => {
  const geometry = kind === "fruit"
    ? createProcPlantFruitGeometry()
    : kind === "berry"
      ? createProcPlantBerryGeometry()
      : kind === "cone"
        ? createProcPlantConeGeometry()
        : kind === "thorn"
          ? createProcPlantThornGeometry()
          : createProcPlantAerialRootGeometry();
  // Procplant accessory primitives grow along +Y; attachment records grow along +Z.
  geometry.rotateX(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

export const createProcPlantLabHeroPreview = async (
  source: ArrayBuffer,
  fileName: string,
  genome: ProcPlantGenome,
  seed: number,
  organMaterial: THREE.Material,
  manualSpine?: ProcPlantMeshSpine,
  renderer?: THREE.WebGLRenderer,
): Promise<ProcPlantLabHeroPreview> => {
  if (source.byteLength > 64 * 1024 * 1024) throw new Error("Hero GLB exceeds the 64 MiB browser authoring limit.");
  const accessoryGroups = (genome.accessoryOrgans ?? []).map((gene, index) => ({
    gene,
    groupId: `hero-organs-${index.toString().padStart(2, "0")}-${gene.kind}`,
  }));
  const attachmentSpecs: ProcPlantMeshAttachmentSpec[] = [
    { id: "hero-branches", kind: "branch", count: 8, startT: 0.22, endT: 0.88, minimumSpacing: 0.055, clearance: 0.01, scale: 0.4 },
    { id: "hero-leaves", kind: "leaf", count: 56, startT: 0.28, endT: 0.98, minimumSpacing: 0.018, clearance: 0.035, scale: 0.32 },
    ...accessoryGroups.map(({ gene, groupId }): ProcPlantMeshAttachmentSpec => {
      const startT = THREE.MathUtils.clamp(gene.startT ?? 0.2, 0, 1);
      return {
        id: groupId,
        kind: "accessory",
        count: Math.max(0, Math.min(32, Math.round(gene.count))),
        startT,
        endT: THREE.MathUtils.clamp(gene.endT ?? 1, startT, 1),
        minimumSpacing: Math.max(0.008, gene.size * 0.6),
        clearance: Math.max(0.002, gene.size * 0.08),
        scale: Math.max(0.003, gene.size),
      };
    }),
  ];
  const imported = importProcPlantHeroGlb(source, {
    bakeNodeTransforms: true,
    maxBytes: 64 * 1024 * 1024,
    maxVertices: 1_000_000,
    maxIndices: 3_000_000,
    maxMeshInstances: 1024,
  });
  const selected = imported.meshes[0];
  if (!selected) throw new Error("GLB contains no supported triangle mesh primitive.");
  const authored = authorProcPlantHeroSpine(imported, {
    selector: { instanceId: selected.instanceId },
    ...(manualSpine ? { manualSpine } : { autoFit: { samples: 16, axis: "y" as const } }),
    barkRepeatLength: 0.8,
    swayPower: 1.7,
    emitSpineAnchorsEvery: 2,
    attachmentSpecs,
    attachmentOptions: { seed, maxCandidatesPerAttachment: 48 },
    collars: { enabled: true, includeBranchAttachments: true, strength: 0.32 },
  });
  const sourceRecord = selected.materialIndex === null ? null : imported.materials[selected.materialIndex] ?? null;
  const sourceBindings = sourceRecord ? [
    sourceRecord.baseColorTexture,
    sourceRecord.metallicRoughnessTexture,
    sourceRecord.normalTexture,
    sourceRecord.occlusionTexture,
    sourceRecord.emissiveTexture,
  ].filter((binding) => binding !== null) : [];
  const usesKtx2 = sourceBindings.some((binding) => imported.textures[binding!.imageIndex]?.mimeType === "image/ktx2");
  if (usesKtx2 && !renderer) {
    throw new Error("Imported hero material uses KTX2; lazy live preview requires the active Three WebGL renderer.");
  }
  const ktx2Handle = usesKtx2
    ? (await import("./procplant-hero-ktx2-decoder")).createProcPlantHeroKtx2Decoder(renderer!)
    : null;
  let sourceMaterial: ProcPlantPreparedHeroSourceMaterial;
  try {
    sourceMaterial = await prepareProcPlantHeroSourceMaterial(
      imported,
      selected.materialIndex,
      undefined,
      ktx2Handle?.decode,
      ktx2Handle?.id,
    );
  } finally {
    ktx2Handle?.dispose();
  }
  try {
  const group = new THREE.Group();
  group.name = `procplant-imported-hero-${authored.contentHash}`;
  group.userData.procplantHeroSpine = {
    contract: authored.contract,
    version: authored.version,
    contentHash: authored.contentHash,
    sourceFile: fileName,
    audit: authored.audit,
  };
  const trunkGeometry = createProcPlantHeroSpineGeometry(authored);
  const trunkMaterial = sourceMaterial.material;
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.name = "procplant-imported-hero-trunk";
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.userData.procplantOwnsMaterial = true;
  group.add(trunk);

  const attachmentPrototypes: ProcPlantAttachmentPrototype[] = [{
    id: "hero-branch",
    groupIds: ["hero-branches"],
    geometry: createProcPlantHeroBranchPrototype(),
    material: trunkMaterial,
    castShadow: true,
    receiveShadow: true,
    ownsGeometry: true,
    ownsMaterial: false,
  }];
  for (const { gene, groupId } of accessoryGroups) {
    const material = new THREE.MeshStandardMaterial({
      name: `procplant-imported-hero-${gene.kind}`,
      color: gene.color,
      roughness: gene.kind === "berry" || gene.kind === "fruit" ? 0.58 : 0.78,
      metalness: 0,
    });
    attachmentPrototypes.push({
      id: groupId,
      groupIds: [groupId],
      geometry: createProcPlantHeroAccessoryPrototype(gene.kind),
      material,
      castShadow: true,
      receiveShadow: true,
      ownsGeometry: true,
      ownsMaterial: true,
    });
  }
  const attachmentMaterialization = materializeProcPlantAttachments(
    authored.attachments ?? {
      contract: "procplants.mesh-attachments",
      version: 1,
      seed,
      requested: 0,
      emitted: 0,
      groups: [],
      attachments: [],
    },
    attachmentPrototypes,
    { includeKinds: ["branch", "accessory"], name: "procplant-imported-hero-attachments" },
  );
  if (attachmentMaterialization.audit.materializedAttachments > 0) {
    group.add(attachmentMaterialization.group);
  }

  const leafAttachments = authored.attachments?.attachments.filter((attachment) => attachment.kind === "leaf") ?? [];
  const leafMatrices = leafAttachments.map((attachment) => new THREE.Matrix4().fromArray(attachment.transform));
  const leafSways = leafAttachments.map((attachment) => attachment.sway);
  let leaves: THREE.InstancedMesh | null = null;
  if (leafAttachments.length > 0) {
    const leafGeometry = createProcPlantLeafGeometry(
      genome.leaf.shape,
      genome.leaf.widthRatio,
      genome.leaf.serration,
      genome.leaf.curl,
      genome.leaf.venation,
    );
    leaves = new THREE.InstancedMesh(leafGeometry, organMaterial, leafAttachments.length);
    leaves.name = "procplant-imported-hero-leaves";
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    const colorA = new THREE.Color(genome.leaf.colorA);
    const colorB = new THREE.Color(genome.leaf.colorB);
    const color = new THREE.Color();
    for (let index = 0; index < leafAttachments.length; index++) {
      leaves.setMatrixAt(index, leafMatrices[index]!);
      color.copy(colorA).lerp(colorB, (index * 0.61803398875) % 1);
      leaves.setColorAt(index, color);
    }
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    group.add(leaves);
  }

  const bounds = trunkGeometry.boundingBox!;
  const center = bounds.getCenter(new THREE.Vector3());
  const height = Math.max(1e-4, bounds.max.y - bounds.min.y);
  const previewScale = THREE.MathUtils.clamp(4.5 / height, 0.02, 20);
  group.scale.setScalar(previewScale);
  group.position.set(-center.x * previewScale, 0.02 - bounds.min.y * previewScale, -center.z * previewScale);
  return {
    group,
    contentHash: authored.contentHash,
    sourceContentHash: authored.provenance.sourceContentHash,
    audit: authored.audit,
    trunk,
    leaves,
    leafMatrices,
    leafSways,
    attachmentMaterialization,
    sourceMaterialAudit: sourceMaterial.audit,
    spine: authored.spine,
  };
  } catch (error) {
    sourceMaterial.dispose();
    throw error;
  }
};

export interface ProcPlantLabMaterialAuthoringSource {
  graph: ProcPlantMaterialGraph;
  pixelSources: ProcPlantMaterialPixelSource[];
}

export const createProcPlantLabMaterialAuthoringSource = (
  genome: ProcPlantGenome,
  seed: number,
): ProcPlantLabMaterialAuthoringSource => {
  const bark = new THREE.Color(genome.weberPenn?.barkColor ?? 0x6b4b32);
  const leafA = new THREE.Color(genome.leaf.colorA);
  const leafB = new THREE.Color(genome.leaf.colorB);
  const normalSource = (
    textureId: string,
    surfaceSeed: number,
    kind: "bark" | "leaf",
    size = 64,
  ): ProcPlantMaterialPixelSource => {
    const height = new Float32Array(size * size);
    const noise = (x: number, y: number) => {
      let value = Math.imul((x + 1) ^ surfaceSeed, 0x45d9f3b) ^ Math.imul((y + 1) ^ (surfaceSeed >>> 8), 0x27d4eb2d);
      value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
      return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const grain = noise(x, y) - 0.5;
      height[y * size + x] = kind === "bark"
        ? Math.sin((u * 7 + grain * 0.16) * Math.PI * 2) * 0.56
          + Math.sin((u * 17 + v * 1.25) * Math.PI * 2) * 0.18
          + grain * 0.2
        : Math.sin((u - 0.5) * Math.PI * 2) * 0.08
          + Math.sin((u * 10 + v * 2) * Math.PI * 2) * 0.035
          + grain * 0.025;
    }
    const rgba = new Uint8Array(size * size * 4);
    const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]!;
    const strength = kind === "bark" ? 2.8 : 0.85;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inverseLength = 1 / Math.hypot(dx, dy, 2);
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round((-dx * inverseLength * 0.5 + 0.5) * 255);
      rgba[offset + 1] = Math.round((-dy * inverseLength * 0.5 + 0.5) * 255);
      rgba[offset + 2] = Math.round((2 * inverseLength * 0.5 + 0.5) * 255);
      rgba[offset + 3] = 255;
    }
    return { textureId, width: size, height: size, rgba };
  };
  const barkNormal = normalSource("barkNormalSource", seed ^ 0x6b61726b, "bark");
  const leafNormal = normalSource("leafNormalSource", seed ^ 0x6c656166, "leaf");
  const graph = {
    contract: "procplants.material-graph",
    version: 1,
    id: `procplant-${genome.id}-${seed}-pbr`,
    textures: [
      { id: barkNormal.textureId, uri: `generated://procplant/${genome.id}/bark-normal`, mimeType: "image/png", role: "normal", colorSpace: "linear", width: barkNormal.width, height: barkNormal.height, byteLength: barkNormal.rgba.byteLength, wrapS: "repeat", wrapT: "repeat" },
      { id: leafNormal.textureId, uri: `generated://procplant/${genome.id}/leaf-normal`, mimeType: "image/png", role: "normal", colorSpace: "linear", width: leafNormal.width, height: leafNormal.height, byteLength: leafNormal.rgba.byteLength, wrapS: "repeat", wrapT: "repeat" },
    ],
    nodes: [
      { id: "barkBase", kind: "color", value: [bark.r, bark.g, bark.b] },
      { id: "leafA", kind: "color", value: [leafA.r, leafA.g, leafA.b] },
      { id: "leafB", kind: "color", value: [leafB.r, leafB.g, leafB.b] },
      { id: "surfaceNoise", kind: "noise", noise: "ridge", seed, scale: 5.25, octaves: 5, lacunarity: 2.05, gain: 0.52 },
      { id: "leafBase", kind: "mix", a: "leafA", b: "leafB", factor: "surfaceNoise" },
      { id: "barkRoughLow", kind: "scalar", value: 0.58 },
      { id: "barkRoughHigh", kind: "scalar", value: 0.96 },
      { id: "barkRough", kind: "mix", a: "barkRoughLow", b: "barkRoughHigh", factor: "surfaceNoise" },
      { id: "leafRoughLow", kind: "scalar", value: 0.42 },
      { id: "leafRoughHigh", kind: "scalar", value: 0.78 },
      { id: "leafRough", kind: "mix", a: "leafRoughLow", b: "leafRoughHigh", factor: "surfaceNoise" },
      { id: "nonMetal", kind: "scalar", value: 0 },
      { id: "barkNormal", kind: "texture-sample", texture: barkNormal.textureId, channel: "normal" },
      { id: "leafNormal", kind: "texture-sample", texture: leafNormal.textureId, channel: "normal" },
    ],
    surfaces: [
      { slot: "bark", channels: { baseColor: "barkBase", normal: "barkNormal", roughness: "barkRough", metalness: "nonMetal" } },
      { slot: "leaf", channels: { baseColor: "leafBase", normal: "leafNormal", roughness: "leafRough", metalness: "nonMetal" }, doubleSided: true },
    ],
    metadata: { genomeId: genome.id, seed, source: "procplants-lab" },
  } as const;
  return { graph, pixelSources: [barkNormal, leafNormal] };
};

export const bakeProcPlantLabMaterials = (
  genome: ProcPlantGenome,
  seed: number,
  graph?: ProcPlantMaterialGraph,
): ProcPlantBakedMaterialBundle => {
  const source = createProcPlantLabMaterialAuthoringSource(genome, seed);
  const selectedGraph = graph ?? source.graph;
  const textureIds = new Set(selectedGraph.textures.map((texture) => texture.id));
  const pixelSources = source.pixelSources.filter((image) => textureIds.has(image.textureId));
  return bakeProcPlantMaterials(compileProcPlantMaterialGraph(selectedGraph), pixelSources, { width: 256, height: 256 });
};

export interface ProcPlantLabMaterialDownload {
  bundle: ProcPlantBakedMaterialBundle;
  audit: Record<string, unknown>;
  contentHash: string;
  ready: boolean;
  imageCount: number;
  fileName: string;
}

/**
 * Build an export scene from authored hero content without carrying the lab's
 * display-only centering and fit-to-view transform into the asset.
 */
export const createProcPlantLabHeroExportScene = (
  preview: THREE.Group,
  audit: Record<string, unknown> | null,
) => {
  const exportScene = new THREE.Scene();
  exportScene.name = "procplant-imported-hero";
  exportScene.userData.procplant = {
    contract: "procplants.hero-spine-authoring",
    version: 1,
    generatorContractRevision: PROCPLANT_GENERATOR_CONTRACT_REVISION,
    audit,
  };
  const authoredRoot = preview.clone(true);
  authoredRoot.position.set(0, 0, 0);
  authoredRoot.quaternion.identity();
  authoredRoot.scale.set(1, 1, 1);
  authoredRoot.updateMatrix();
  exportScene.add(authoredRoot);
  return exportScene;
};

export const downloadProcPlantLabMaterials = (
  genome: ProcPlantGenome,
  seed: number,
  graph?: ProcPlantMaterialGraph,
): ProcPlantLabMaterialDownload => {
  const baked = bakeProcPlantLabMaterials(genome, seed, graph);
  const fileName = `procplant-${genome.id}-${seed}-materials.gltf`;
  const blobBytes = baked.gltfBytes.slice().buffer as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([blobBytes], { type: "model/gltf+json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return {
    bundle: baked,
    audit: {
      contract: baked.contract,
      version: baked.version,
      sourceId: baked.sourceId,
      sourceContentHash: baked.sourceContentHash,
      contentHash: baked.contentHash,
      width: baked.width,
      height: baked.height,
      ready: baked.ready,
      images: baked.images.map((image) => ({ usage: image.usage, contentHash: image.contentHash, byteLength: image.bytes.byteLength })),
      diagnostics: baked.diagnostics,
    },
    contentHash: baked.contentHash,
    ready: baked.ready,
    imageCount: baked.images.length,
    fileName,
  };
};

export const downloadProcPlantLabHeroPreview = async (
  preview: THREE.Group,
  audit: Record<string, unknown> | null,
  contentHash: string,
) => {
  const glb = await exportProcPlantLabHeroPreview(preview, audit);
  const url = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `procplant-imported-hero-${contentHash}.glb`;
  link.click();
  URL.revokeObjectURL(url);
  const view = new DataView(glb);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)).trimEnd()) as {
    materials?: unknown[];
    textures?: unknown[];
    images?: unknown[];
  };
  return {
    byteLength: glb.byteLength,
    materials: json.materials?.length ?? 0,
    textures: json.textures?.length ?? 0,
    images: json.images?.length ?? 0,
  };
};

export const exportProcPlantLabHeroPreview = async (
  preview: THREE.Group,
  audit: Record<string, unknown> | null,
) => exportProcPlantScenesGlb(createProcPlantLabHeroExportScene(preview, audit));
