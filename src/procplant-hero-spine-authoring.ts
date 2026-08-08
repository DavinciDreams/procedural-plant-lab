import * as THREE from "three";
import { declareProcPlantGeometryUv0 } from "./procplant-uv0";
import {
  PROCPLANT_HERO_GLB_IMPORT_CONTRACT,
  PROCPLANT_HERO_GLB_IMPORT_VERSION,
  type ProcPlantHeroGlbImportPackage,
  type ProcPlantHeroGlbMeshPrimitive,
} from "./procplant-hero-glb-import";
import {
  applyProcPlantMeshSpineBinding,
  bindProcPlantMeshToSpine,
  createProcPlantManualMeshSpine,
  createProcPlantMeshAttachments,
  createProcPlantMeshSpineAnchors,
  fitProcPlantMeshSpine,
  type ProcPlantMeshAnchor,
  type ProcPlantMeshAttachmentOptions,
  type ProcPlantMeshAttachmentPackage,
  type ProcPlantMeshAttachmentSpec,
  type ProcPlantMeshSpine,
  type ProcPlantMeshSpineBinding,
  type ProcPlantMeshSpineFitOptions,
} from "./procplant-mesh-helper";
import {
  buildProcPlantJunctionCollars,
  type ProcPlantJunctionCollarAnchor,
  type ProcPlantJunctionCollarAudit,
  type ProcPlantJunctionCollarOptions,
} from "./procplant-junction-collar";

export const PROCPLANT_HERO_SPINE_AUTHORING_CONTRACT = "procplants.hero-spine-authoring" as const;
export const PROCPLANT_HERO_SPINE_AUTHORING_VERSION = 1 as const;
export const PROCPLANT_COLLAR_DISPLACEMENT_ATTRIBUTE = "procplantCollarDisplacement" as const;
export const PROCPLANT_COLLAR_WEIGHT_ATTRIBUTE = "procplantCollarWeight" as const;

export const PROCPLANT_HERO_SPINE_HARD_CAPS = Object.freeze({
  meshes: 100_000,
  vertices: 2_000_000,
  indices: 6_000_000,
  spineSamples: 128,
  bindingWorkItems: 64_000_000,
  attachments: 4096,
  attachmentSpecs: 64,
  outputBytes: 1024 * 1024 * 1024,
});

export type ProcPlantHeroSpineMeshSelector =
  | { instanceId: string }
  | { nodePath: string | null; meshIndex: number; primitiveIndex: number };

export interface ProcPlantHeroSpineLimits {
  maxMeshes?: number;
  maxVertices?: number;
  maxIndices?: number;
  maxSpineSamples?: number;
  maxBindingWorkItems?: number;
  maxAttachments?: number;
  maxAttachmentSpecs?: number;
  maxOutputBytes?: number;
}

export interface ProcPlantHeroSpineCollarOptions {
  enabled?: boolean;
  includeBranchAttachments?: boolean;
  branchRadiusScale?: number;
  strength?: number;
  anchors?: readonly ProcPlantJunctionCollarAnchor[];
  deformation?: Omit<ProcPlantJunctionCollarOptions, "enabled">;
}

export interface ProcPlantHeroSpineAuthoringOptions extends ProcPlantHeroSpineLimits {
  selector: ProcPlantHeroSpineMeshSelector;
  autoFit?: ProcPlantMeshSpineFitOptions;
  manualSpine?: ProcPlantMeshSpine;
  barkRepeatLength?: number;
  swayPower?: number;
  emitSpineAnchorsEvery?: number;
  attachmentSpecs?: readonly ProcPlantMeshAttachmentSpec[];
  attachmentOptions?: ProcPlantMeshAttachmentOptions;
  collars?: ProcPlantHeroSpineCollarOptions;
}

export interface ProcPlantHeroSpineProvenance {
  sourceContentHash: string;
  instanceId: string;
  nodeIndex: number | null;
  nodePath: string | null;
  meshIndex: number;
  primitiveIndex: number;
  materialIndex: number | null;
  transformsBaked: boolean;
  worldMatrix: Float64Array;
}

export interface ProcPlantHeroSpineCollarPackage {
  displacement: Float32Array | null;
  weight: Float32Array | null;
  audit: ProcPlantJunctionCollarAudit;
}

export interface ProcPlantHeroSpineAuthoringAudit {
  selectedBy: "instanceId" | "node-mesh-primitive";
  inputMeshCount: number;
  vertexCount: number;
  indexCount: number;
  triangleCount: number;
  spineSource: "auto-fit" | "manual";
  spineSamples: number;
  bindingWorkItems: number;
  sourceNormalsPreserved: boolean;
  normalsRecomputed: boolean;
  sourceUvReplaced: boolean;
  sourceArraysCloned: true;
  attachmentSpecs: number;
  attachmentsRequested: number;
  attachmentsEmitted: number;
  spineAnchorsEmitted: number;
  collarAnchors: number;
  outputBytes: number;
  warnings: string[];
  unsupportedBoundaries: string[];
}

export interface ProcPlantHeroSpineAuthoringPackage {
  contract: typeof PROCPLANT_HERO_SPINE_AUTHORING_CONTRACT;
  version: typeof PROCPLANT_HERO_SPINE_AUTHORING_VERSION;
  contentHash: string;
  provenance: ProcPlantHeroSpineProvenance;
  spine: ProcPlantMeshSpine;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array | null;
  binding: ProcPlantMeshSpineBinding;
  spineAnchors: ProcPlantMeshAnchor[];
  attachments: ProcPlantMeshAttachmentPackage | null;
  collars: ProcPlantHeroSpineCollarPackage | null;
  audit: ProcPlantHeroSpineAuthoringAudit;
}

interface ResolvedLimits {
  maxMeshes: number;
  maxVertices: number;
  maxIndices: number;
  maxSpineSamples: number;
  maxBindingWorkItems: number;
  maxAttachments: number;
  maxAttachmentSpecs: number;
  maxOutputBytes: number;
}

const cappedInteger = (value: number | undefined, fallback: number, label: string, hardCap: number) => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > hardCap) {
    throw new Error(`${label} must be an integer in [1, ${hardCap}]`);
  }
  return resolved;
};

const resolveLimits = (options: ProcPlantHeroSpineLimits): ResolvedLimits => ({
  maxMeshes: cappedInteger(options.maxMeshes, 16_384, "hero spine maxMeshes", PROCPLANT_HERO_SPINE_HARD_CAPS.meshes),
  maxVertices: cappedInteger(options.maxVertices, 1_000_000, "hero spine maxVertices", PROCPLANT_HERO_SPINE_HARD_CAPS.vertices),
  maxIndices: cappedInteger(options.maxIndices, 3_000_000, "hero spine maxIndices", PROCPLANT_HERO_SPINE_HARD_CAPS.indices),
  maxSpineSamples: cappedInteger(options.maxSpineSamples, 128, "hero spine maxSpineSamples", PROCPLANT_HERO_SPINE_HARD_CAPS.spineSamples),
  maxBindingWorkItems: cappedInteger(options.maxBindingWorkItems, 16_000_000, "hero spine maxBindingWorkItems", PROCPLANT_HERO_SPINE_HARD_CAPS.bindingWorkItems),
  maxAttachments: cappedInteger(options.maxAttachments, 4096, "hero spine maxAttachments", PROCPLANT_HERO_SPINE_HARD_CAPS.attachments),
  maxAttachmentSpecs: cappedInteger(options.maxAttachmentSpecs, 64, "hero spine maxAttachmentSpecs", PROCPLANT_HERO_SPINE_HARD_CAPS.attachmentSpecs),
  maxOutputBytes: cappedInteger(options.maxOutputBytes, 512 * 1024 * 1024, "hero spine maxOutputBytes", PROCPLANT_HERO_SPINE_HARD_CAPS.outputBytes),
});

const selectorKind = (selector: ProcPlantHeroSpineMeshSelector) => "instanceId" in selector
  ? "instanceId" as const
  : "node-mesh-primitive" as const;

export const selectProcPlantHeroSpineMesh = (
  source: ProcPlantHeroGlbImportPackage,
  selector: ProcPlantHeroSpineMeshSelector,
  maxMeshes = 16_384,
): ProcPlantHeroGlbMeshPrimitive => {
  if (source.contract !== PROCPLANT_HERO_GLB_IMPORT_CONTRACT || source.version !== PROCPLANT_HERO_GLB_IMPORT_VERSION) {
    throw new Error("unsupported hero GLB import package contract");
  }
  if (source.inspection.contract !== PROCPLANT_HERO_GLB_IMPORT_CONTRACT
    || source.inspection.version !== PROCPLANT_HERO_GLB_IMPORT_VERSION
    || !source.inspection.contentHash
    || source.inspection.contentHash.length > 128) {
    throw new Error("unsupported hero GLB inspection provenance");
  }
  if (source.meshes.length > maxMeshes) throw new Error(`hero spine source exceeds maxMeshes (${maxMeshes})`);
  let matches: ProcPlantHeroGlbMeshPrimitive[];
  if ("instanceId" in selector) {
    if (!selector.instanceId.trim() || selector.instanceId.length > 1024) {
      throw new Error("hero spine instanceId selector must contain 1..1024 characters");
    }
    matches = source.meshes.filter((mesh) => mesh.instanceId === selector.instanceId);
  } else {
    if (!Number.isInteger(selector.meshIndex) || selector.meshIndex < 0 || !Number.isInteger(selector.primitiveIndex) || selector.primitiveIndex < 0) {
      throw new Error("hero spine mesh and primitive selectors must be non-negative integers");
    }
    matches = source.meshes.filter((mesh) => mesh.nodePath === selector.nodePath
      && mesh.meshIndex === selector.meshIndex
      && mesh.primitiveIndex === selector.primitiveIndex);
  }
  if (matches.length === 0) throw new Error("hero spine selector did not match an imported primitive");
  if (matches.length > 1) throw new Error("hero spine selector is ambiguous; provenance must identify exactly one primitive");
  return matches[0]!;
};

const validatePrimitive = (primitive: ProcPlantHeroGlbMeshPrimitive, limits: ResolvedLimits) => {
  if (primitive.positions.length < 9 || primitive.positions.length % 3 !== 0) {
    throw new Error("hero spine positions must contain complete triangle-capable xyz vertices");
  }
  const vertexCount = primitive.positions.length / 3;
  if (vertexCount > limits.maxVertices) throw new Error(`hero spine vertex count exceeds maxVertices (${limits.maxVertices})`);
  for (let index = 0; index < primitive.positions.length; index++) {
    if (!Number.isFinite(primitive.positions[index])) throw new Error(`hero spine position ${index} must be finite`);
  }
  if (primitive.normals && primitive.normals.length !== primitive.positions.length) {
    throw new Error("hero spine normal count must match positions");
  }
  if (primitive.uv0 && primitive.uv0.length !== vertexCount * 2) throw new Error("hero spine UV0 count must match positions");
  for (const [label, values] of [["normal", primitive.normals], ["UV0", primitive.uv0]] as const) {
    if (!values) continue;
    for (let index = 0; index < values.length; index++) {
      if (!Number.isFinite(values[index])) throw new Error(`hero spine ${label} ${index} must be finite`);
    }
  }
  if (!primitive.indices && vertexCount % 3 !== 0) throw new Error("non-indexed hero spine vertex count must form triangles");
  if (primitive.indices) {
    if (primitive.indices.length > limits.maxIndices) throw new Error(`hero spine index count exceeds maxIndices (${limits.maxIndices})`);
    if (primitive.indices.length % 3 !== 0) throw new Error("hero spine indices must form triangles");
    for (let index = 0; index < primitive.indices.length; index++) {
      if (primitive.indices[index]! >= vertexCount) throw new Error(`hero spine index ${index} exceeds the vertex count`);
    }
  }
  if (primitive.worldMatrix.length !== 16 || primitive.worldMatrix.some((value) => !Number.isFinite(value))) {
    throw new Error("hero spine provenance worldMatrix must contain 16 finite values");
  }
  return vertexCount;
};

const computeNormals = (positions: Float32Array, indices: Uint32Array | null) => {
  const vertexCount = positions.length / 3;
  const accumulated = new Float64Array(positions.length);
  const triangleCount = indices ? indices.length / 3 : vertexCount / 3;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = indices ? indices[triangle * 3]! : triangle * 3;
    const b = indices ? indices[triangle * 3 + 1]! : triangle * 3 + 1;
    const c = indices ? indices[triangle * 3 + 2]! : triangle * 3 + 2;
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const abx = positions[b * 3]! - ax;
    const aby = positions[b * 3 + 1]! - ay;
    const abz = positions[b * 3 + 2]! - az;
    const acx = positions[c * 3]! - ax;
    const acy = positions[c * 3 + 1]! - ay;
    const acz = positions[c * 3 + 2]! - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const vertex of [a, b, c]) {
      accumulated[vertex * 3] += nx;
      accumulated[vertex * 3 + 1] += ny;
      accumulated[vertex * 3 + 2] += nz;
    }
  }
  const normals = new Float32Array(positions.length);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const offset = vertex * 3;
    const length = Math.hypot(accumulated[offset]!, accumulated[offset + 1]!, accumulated[offset + 2]!);
    if (length > 1e-20) {
      normals[offset] = accumulated[offset]! / length;
      normals[offset + 1] = accumulated[offset + 1]! / length;
      normals[offset + 2] = accumulated[offset + 2]! / length;
    } else {
      normals[offset + 1] = 1;
    }
  }
  return normals;
};

const cloneManualSpine = (spine: ProcPlantMeshSpine, maxSamples: number) => {
  if (spine.contract !== "procplants.mesh-spine" || spine.version !== 1 || spine.samples.length < 2 || spine.samples.length > maxSamples) {
    throw new Error(`manual hero spine must contain 2..${maxSamples} supported samples`);
  }
  for (let index = 0; index < spine.samples.length; index++) {
    const sample = spine.samples[index]!;
    if (![sample.position.x, sample.position.y, sample.position.z, sample.radius].every(Number.isFinite) || sample.radius <= 0) {
      throw new Error(`manual hero spine sample ${index} must have finite position and positive radius`);
    }
    if ((sample.age !== undefined && !Number.isFinite(sample.age))
      || (sample.branchOrder !== undefined && (!Number.isInteger(sample.branchOrder) || sample.branchOrder < 0))) {
      throw new Error(`manual hero spine sample ${index} age/branchOrder metadata is invalid`);
    }
  }
  return createProcPlantManualMeshSpine(spine.samples);
};

const toCollarAnchor = (
  attachment: ProcPlantMeshAttachmentPackage["attachments"][number],
  branchRadiusScale: number,
  strength: number,
): ProcPlantJunctionCollarAnchor => ({
  id: `hero-spine:${attachment.id}`,
  surfacePosition: attachment.surfacePosition,
  supportTangent: attachment.supportTangent,
  outward: attachment.outward,
  surfaceRadius: attachment.surfaceRadius,
  branchRadius: attachment.surfaceRadius * branchRadiusScale,
  strength,
});

const hashPackage = (arrays: readonly ArrayBufferView[], text: string) => {
  let hash = 0x811c9dc5;
  const update = (byte: number) => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const byte of new TextEncoder().encode(text)) update(byte);
  for (const array of arrays) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const byte of bytes) update(byte);
  }
  return hash.toString(16).padStart(8, "0");
};

const unsupportedBoundaries = Object.freeze([
  "animated node transforms are static snapshots and cannot be baked by this workflow",
  "skinned meshes are rejected by the dependency-free hero importer",
  "morph targets are rejected by the dependency-free hero importer",
  "compressed bufferViews require preprocessing before dependency-free import",
  "external buffer and non-data image URIs require preprocessing into GLB",
  "junction collars are bounded surface swell, not watertight boolean unions",
]);

export const authorProcPlantHeroSpine = (
  source: ProcPlantHeroGlbImportPackage,
  options: ProcPlantHeroSpineAuthoringOptions,
): ProcPlantHeroSpineAuthoringPackage => {
  const limits = resolveLimits(options);
  const primitive = selectProcPlantHeroSpineMesh(source, options.selector, limits.maxMeshes);
  const vertexCount = validatePrimitive(primitive, limits);
  if (options.manualSpine && options.autoFit) throw new Error("hero spine accepts manualSpine or autoFit, not both");
  const requestedSamples = options.autoFit?.samples ?? 12;
  const plannedSamples = options.manualSpine?.samples.length ?? Math.round(requestedSamples);
  if (!options.manualSpine && (!Number.isFinite(requestedSamples) || plannedSamples < 2 || plannedSamples > limits.maxSpineSamples)) {
    throw new Error(`auto-fit hero spine samples must be in [2, ${limits.maxSpineSamples}]`);
  }
  const bindingWorkItems = vertexCount * Math.max(0, plannedSamples - 1);
  if (!Number.isSafeInteger(bindingWorkItems) || bindingWorkItems > limits.maxBindingWorkItems) {
    throw new Error(`hero spine binding work exceeds maxBindingWorkItems (${limits.maxBindingWorkItems})`);
  }
  // Reject impossible output budgets before fitting, deformation, normal
  // generation, and nearest-spine binding allocate their result arrays.
  // The v1 sample cap keeps spineSegment on a 16-bit representation.
  const minimumOutputBytes = vertexCount * (
    12 // positions
    + 12 // normals
    + 8 // UV0
    + 4 // branchU
    + 4 // branchV
    + 4 // sway
    + 2 // spineSegment
    + 4 // spineT
    + 4 // spineRadius
  ) + (primitive.indices?.byteLength ?? 0);
  if (!Number.isSafeInteger(minimumOutputBytes) || minimumOutputBytes > limits.maxOutputBytes) {
    throw new Error(`hero spine output exceeds maxOutputBytes (${limits.maxOutputBytes})`);
  }
  const spine = options.manualSpine
    ? cloneManualSpine(options.manualSpine, limits.maxSpineSamples)
    : fitProcPlantMeshSpine(primitive.positions, options.autoFit);
  const specs = options.attachmentSpecs ?? [];
  if (specs.length > limits.maxAttachmentSpecs) throw new Error(`hero spine attachment specs exceed maxAttachmentSpecs (${limits.maxAttachmentSpecs})`);
  const attachmentsRequested = specs.reduce((sum, spec) => sum + spec.count, 0);
  if (!Number.isSafeInteger(attachmentsRequested) || attachmentsRequested > limits.maxAttachments) {
    throw new Error(`hero spine attachments exceed maxAttachments (${limits.maxAttachments})`);
  }
  const attachments = specs.length > 0
    ? createProcPlantMeshAttachments(spine, specs, options.attachmentOptions)
    : null;
  const every = options.emitSpineAnchorsEvery;
  if (every !== undefined && (!Number.isInteger(every) || every < 1 || every > limits.maxSpineSamples)) {
    throw new Error(`emitSpineAnchorsEvery must be an integer in [1, ${limits.maxSpineSamples}]`);
  }
  const spineAnchors = every === undefined ? [] : createProcPlantMeshSpineAnchors(spine, every);
  const collarOptions = options.collars;
  const branchRadiusScale = collarOptions?.branchRadiusScale ?? 0.3;
  const collarStrength = collarOptions?.strength ?? 0.35;
  if (!Number.isFinite(branchRadiusScale) || branchRadiusScale < 0 || branchRadiusScale > 2) {
    throw new Error("hero spine collar branchRadiusScale must be in [0, 2]");
  }
  if (!Number.isFinite(collarStrength) || collarStrength < 0 || collarStrength > 1) {
    throw new Error("hero spine collar strength must be in [0, 1]");
  }
  const generatedCollarAnchors = collarOptions?.includeBranchAttachments === false
    ? []
    : attachments?.attachments.filter((attachment) => attachment.kind === "branch")
      .map((attachment) => toCollarAnchor(attachment, branchRadiusScale, collarStrength)) ?? [];
  const collarAnchors = [...(collarOptions?.anchors ?? []), ...generatedCollarAnchors];
  const collarResult = collarOptions
    ? buildProcPlantJunctionCollars(primitive.positions, collarAnchors, {
        ...collarOptions.deformation,
        enabled: collarOptions.enabled ?? true,
      })
    : null;
  const positions = Float32Array.from(collarResult?.positions ?? primitive.positions);
  const indices = primitive.indices ? new Uint32Array(primitive.indices) : null;
  const normalsRecomputed = !primitive.normals || Boolean(collarResult && !collarResult.audit.sourcePositionsReused);
  const normals = normalsRecomputed ? computeNormals(positions, indices) : new Float32Array(primitive.normals!);
  const binding = bindProcPlantMeshToSpine(positions, spine, {
    barkRepeatLength: options.barkRepeatLength,
    swayPower: options.swayPower,
  });
  const collars: ProcPlantHeroSpineCollarPackage | null = collarResult
    ? {
        displacement: collarResult.collarDisplacement ? new Float32Array(collarResult.collarDisplacement) : null,
        weight: collarResult.collarWeight ? new Float32Array(collarResult.collarWeight) : null,
        audit: { ...collarResult.audit, unmatchedAnchorIds: [...collarResult.audit.unmatchedAnchorIds] },
      }
    : null;
  const outputArrays: ArrayBufferView[] = [
    positions, normals, binding.uv, binding.branchU, binding.branchV, binding.sway,
    binding.spineSegment, binding.spineT, binding.spineRadius,
  ];
  if (indices) outputArrays.push(indices);
  if (collars?.displacement) outputArrays.push(collars.displacement);
  if (collars?.weight) outputArrays.push(collars.weight);
  const outputBytes = outputArrays.reduce((sum, array) => sum + array.byteLength, 0);
  if (outputBytes > limits.maxOutputBytes) throw new Error(`hero spine output exceeds maxOutputBytes (${limits.maxOutputBytes})`);
  const warnings = [
    ...(!primitive.transformsBaked ? ["positions remain node-local; apply provenance.worldMatrix when rendering or exporting"] : []),
    ...(normalsRecomputed ? ["normals were deterministically regenerated from authored positions"] : []),
    ...(collarResult && !collarResult.audit.sourcePositionsReused ? ["collars deform the surface without producing a watertight branch union"] : []),
  ];
  const audit: ProcPlantHeroSpineAuthoringAudit = {
    selectedBy: selectorKind(options.selector),
    inputMeshCount: source.meshes.length,
    vertexCount,
    indexCount: indices?.length ?? 0,
    triangleCount: (indices?.length ?? vertexCount) / 3,
    spineSource: spine.source,
    spineSamples: spine.samples.length,
    bindingWorkItems,
    sourceNormalsPreserved: Boolean(primitive.normals) && !normalsRecomputed,
    normalsRecomputed,
    sourceUvReplaced: Boolean(primitive.uv0),
    sourceArraysCloned: true,
    attachmentSpecs: specs.length,
    attachmentsRequested,
    attachmentsEmitted: attachments?.emitted ?? 0,
    spineAnchorsEmitted: spineAnchors.length,
    collarAnchors: collarAnchors.length,
    outputBytes,
    warnings,
    unsupportedBoundaries: [...unsupportedBoundaries],
  };
  const provenance: ProcPlantHeroSpineProvenance = {
    sourceContentHash: source.inspection.contentHash,
    instanceId: primitive.instanceId,
    nodeIndex: primitive.nodeIndex,
    nodePath: primitive.nodePath,
    meshIndex: primitive.meshIndex,
    primitiveIndex: primitive.primitiveIndex,
    materialIndex: primitive.materialIndex,
    transformsBaked: primitive.transformsBaked,
    worldMatrix: new Float64Array(primitive.worldMatrix),
  };
  const spineHash = spine.samples.map((sample) => [
    sample.position.x, sample.position.y, sample.position.z, sample.radius, sample.age, sample.branchOrder,
  ]);
  const attachmentHash = attachments?.attachments.map((attachment) => [attachment.id, ...attachment.transform]) ?? [];
  const contentHash = hashPackage(outputArrays, JSON.stringify({
    contract: PROCPLANT_HERO_SPINE_AUTHORING_CONTRACT,
    version: PROCPLANT_HERO_SPINE_AUTHORING_VERSION,
    provenance: { ...provenance, worldMatrix: Array.from(provenance.worldMatrix) },
    spine: spineHash,
    spineAnchors,
    attachmentHash,
    attachments,
    collarAudit: collars?.audit ?? null,
    audit,
  }));
  return {
    contract: PROCPLANT_HERO_SPINE_AUTHORING_CONTRACT,
    version: PROCPLANT_HERO_SPINE_AUTHORING_VERSION,
    contentHash,
    provenance,
    spine,
    positions,
    normals,
    indices,
    binding,
    spineAnchors,
    attachments,
    collars,
    audit,
  };
};

/** Minimal Three adapter; caller owns and disposes the returned geometry. */
export const createProcPlantHeroSpineGeometry = (authored: ProcPlantHeroSpineAuthoringPackage) => {
  if (authored.contract !== PROCPLANT_HERO_SPINE_AUTHORING_CONTRACT || authored.version !== PROCPLANT_HERO_SPINE_AUTHORING_VERSION) {
    throw new Error("unsupported hero spine authoring package");
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(authored.positions), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(authored.normals), 3));
  if (authored.indices) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(authored.indices), 1));
  applyProcPlantMeshSpineBinding(geometry, authored.binding);
  declareProcPlantGeometryUv0(geometry);
  if (authored.collars?.displacement) {
    geometry.setAttribute(PROCPLANT_COLLAR_DISPLACEMENT_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(authored.collars.displacement), 3));
  }
  if (authored.collars?.weight) {
    geometry.setAttribute(PROCPLANT_COLLAR_WEIGHT_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(authored.collars.weight), 1));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.procplantHeroSpine = {
    contract: authored.contract,
    version: authored.version,
    contentHash: authored.contentHash,
    provenance: {
      instanceId: authored.provenance.instanceId,
      nodePath: authored.provenance.nodePath,
      meshIndex: authored.provenance.meshIndex,
      primitiveIndex: authored.provenance.primitiveIndex,
      transformsBaked: authored.provenance.transformsBaked,
      worldMatrix: Array.from(authored.provenance.worldMatrix),
    },
  };
  return geometry;
};
