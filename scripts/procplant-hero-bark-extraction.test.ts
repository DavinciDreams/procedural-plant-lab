import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createProcPlantHeroBarkMaterialPixelSources,
  extractProcPlantHeroBark,
  PROCPLANT_HERO_BARK_EXTRACTION_CONTRACT,
  PROCPLANT_HERO_BARK_EXTRACTION_VERSION,
} from "../src/procplant-hero-bark-extraction";
import type {
  ProcPlantHeroGlbImportPackage,
  ProcPlantHeroGlbMeshPrimitive,
} from "../src/procplant-hero-glb-import";
import { authorProcPlantHeroSpine } from "../src/procplant-hero-spine-authoring";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const primitive: ProcPlantHeroGlbMeshPrimitive = {
  instanceId: "node:000000:mesh:000000:primitive:000000",
  nodeIndex: 0,
  nodePath: "node:000000",
  meshIndex: 0,
  primitiveIndex: 0,
  name: "scanned-trunk-patch",
  materialIndex: 0,
  transformsBaked: true,
  worldMatrix: identity,
  positions: new Float32Array([-1, 0, 0, 1, 0, 0, 1, 2, 0, -1, 2, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uv0: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
};

const imageBytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const packageSource: ProcPlantHeroGlbImportPackage = {
  contract: "procplants.hero-glb-import",
  version: 1,
  inspection: {
    contract: "procplants.hero-glb-import",
    version: 1,
    contentHash: "fixture-scanned-trunk",
    byteLength: 2048,
    generator: "focused-bark-test",
    scenes: 1,
    nodes: 1,
    meshes: 1,
    meshInstances: 1,
    primitives: 1,
    materials: 1,
    textures: 1,
    images: [{
      imageIndex: 0,
      id: "hero-image:000000",
      name: "source bark",
      mimeType: "image/png",
      byteLength: imageBytes.length,
      contentHash: "bark-png-hash",
      source: "bufferView",
      textureIndices: [0],
    }],
    primitivesDetail: [],
    extensionsUsed: [],
    extensionsRequired: [],
  },
  meshes: [primitive],
  textures: [{
    imageIndex: 0,
    id: "hero-image:000000",
    name: "source bark",
    mimeType: "image/png",
    byteLength: imageBytes.length,
    contentHash: "bark-png-hash",
    source: "bufferView",
    textureIndices: [0],
    bytes: imageBytes,
  }],
  materials: [{
    materialIndex: 0,
    name: "bark",
    baseColorFactor: [0.42, 0.28, 0.14, 1],
    metallicFactor: 0,
    roughnessFactor: 0.85,
    baseColorTexture: {
      textureIndex: 0,
      imageIndex: 0,
      texCoord: 0,
      sampler: { samplerIndex: 0, magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 },
      transform: { offset: [0, 0], rotation: 0, scale: [1, 1], texCoord: 0 },
    },
    metallicRoughnessTexture: null,
    normalTexture: null,
    occlusionTexture: null,
    emissiveFactor: [0, 0, 0],
    emissiveTexture: null,
    alphaMode: "OPAQUE",
    alphaCutoff: 0.5,
    doubleSided: false,
  }],
};

const rasterRgba = new Uint8Array(8 * 8 * 4);
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  const offset = (y * 8 + x) * 4;
  rasterRgba.set([40 + x * 19, 22 + y * 17, 12 + (x + y) * 7, 255], offset);
}
const raster = { imageId: "hero-image:000000", contentHash: "bark-png-hash", width: 8, height: 8, rgba: rasterRgba };
const sourceSnapshots = {
  positions: primitive.positions.slice(),
  normals: primitive.normals!.slice(),
  uv0: primitive.uv0!.slice(),
  indices: primitive.indices!.slice(),
  raster: rasterRgba.slice(),
  bytes: imageBytes.slice(),
};
const options = {
  selector: { instanceId: primitive.instanceId } as const,
  selection: { kind: "uv-region", minU: 0, minV: 0, maxU: 1, maxV: 1 } as const,
  raster,
  width: 32,
  height: 32,
  seamBlendPixels: 3,
  normalStrength: 4,
};
const first = extractProcPlantHeroBark(packageSource, options);
const repeated = extractProcPlantHeroBark(packageSource, options);
assert.equal(first.contract, PROCPLANT_HERO_BARK_EXTRACTION_CONTRACT);
assert.equal(first.version, PROCPLANT_HERO_BARK_EXTRACTION_VERSION);
assert.equal(first.contentHash, repeated.contentHash);
assert.deepEqual(first.resources, repeated.resources);
assert.equal(first.audit.sourceQuality, "derived-texture");
assert.equal(first.audit.sourceImageContentHash, "bark-png-hash");
assert.equal(first.audit.selectedTriangles, 2);
assert.equal(first.audit.coverage, 1);
assert.ok(first.audit.baseColorSeamDeltaBefore > 0);
assert.equal(first.audit.baseColorSeamDeltaAfter, 0);
assert.equal(first.audit.heightSeamDeltaAfter, 0);
assert.equal(first.audit.normalSeamDeltaAfter, 0);
assert.match(first.audit.warnings.join(" "), /not measured geometry/);
assert.deepEqual(first.resources.map((entry) => entry.usage), ["baseColor", "height", "normal"]);
for (const entry of first.resources) {
  assert.equal(entry.rgba.length, 32 * 32 * 4);
  assert.deepEqual([...entry.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
assert.deepEqual(primitive.positions, sourceSnapshots.positions);
assert.deepEqual(primitive.normals, sourceSnapshots.normals);
assert.deepEqual(primitive.uv0, sourceSnapshots.uv0);
assert.deepEqual(primitive.indices, sourceSnapshots.indices);
assert.deepEqual(rasterRgba, sourceSnapshots.raster);
assert.deepEqual(imageBytes, sourceSnapshots.bytes);
console.log("ok 1 - imported PNG-derived UV extraction is deterministic, tileable, audited, and non-mutating");

const materialSources = createProcPlantHeroBarkMaterialPixelSources(first);
assert.deepEqual(materialSources.map((entry) => entry.textureId), [first.resources[0].id, first.resources[2].id]);
assert.match(materialSources[0].textureId, /^hero-bark-fnv1a32-[0-9a-f]{8}-base-color$/);
assert.notEqual(materialSources[0].rgba, first.resources[0].rgba);
materialSources[0].rgba[0] = 0;
assert.notEqual(first.resources[0].rgba[0], 0, "material pixel adapters must own their arrays");
console.log("ok 2 - extracted base and normal resources bridge to material-graph pixel sources with owned bytes");

const surrogate = extractProcPlantHeroBark(packageSource, { ...options, raster: undefined, seed: 73 });
assert.equal(surrogate.audit.sourceQuality, "procedural-surrogate");
assert.equal(surrogate.audit.sourceImageContentHash, null);
assert.match(surrogate.audit.warnings.join(" "), /not a scan extraction/);
assert.notEqual(surrogate.contentHash, first.contentHash);
assert.equal(surrogate.audit.baseColorSeamDeltaAfter, 0);
console.log("ok 3 - missing decoded pixels produce an explicitly labeled deterministic procedural surrogate");

const cylinder = new THREE.CylinderGeometry(1, 1.2, 4, 12, 4, false);
const cylinderPrimitive: ProcPlantHeroGlbMeshPrimitive = {
  ...primitive,
  instanceId: "node:000001:mesh:000001:primitive:000000",
  nodeIndex: 1,
  nodePath: "node:000001",
  meshIndex: 1,
  name: "fitted-scanned-trunk",
  positions: new Float32Array(cylinder.getAttribute("position").array),
  normals: new Float32Array(cylinder.getAttribute("normal").array),
  uv0: new Float32Array(cylinder.getAttribute("uv").array),
  indices: new Uint32Array(cylinder.getIndex()!.array),
};
cylinder.dispose();
const cylinderSource: ProcPlantHeroGlbImportPackage = {
  ...packageSource,
  meshes: [cylinderPrimitive],
  inspection: { ...packageSource.inspection, contentHash: "fixture-fitted-trunk", meshes: 1, meshInstances: 1, primitives: 1 },
};
const authored = authorProcPlantHeroSpine(cylinderSource, {
  selector: { instanceId: cylinderPrimitive.instanceId },
  autoFit: { axis: "y", samples: 7 },
  barkRepeatLength: 0.75,
});
const band = extractProcPlantHeroBark(cylinderSource, {
  selector: { instanceId: cylinderPrimitive.instanceId },
  selection: { kind: "spine-band", authored, minT: 0.2, maxT: 0.8 },
  width: 48,
  height: 32,
  minimumCoverage: 0.05,
});
assert.equal(band.audit.selectionKind, "spine-band");
assert.ok(band.audit.selectedTriangles > 0 && band.audit.selectedTriangles < band.audit.candidateTriangles);
assert.ok(band.audit.coverage >= 0.05);
assert.equal(band.audit.sourceQuality, "procedural-surrogate");
console.log("ok 4 - fitted-spine bands select bounded authored trunk regions without renderer dependencies");

assert.throws(() => extractProcPlantHeroBark(packageSource, {
  ...options,
  raster: { ...raster, contentHash: "wrong" },
}), /content hash does not match/);
assert.throws(() => extractProcPlantHeroBark({
  ...packageSource,
  meshes: [{ ...primitive, uv0: undefined }],
}, options), /requires complete UV0/);
assert.throws(() => extractProcPlantHeroBark(packageSource, {
  ...options,
  maxRasterWorkItems: 4,
}), /maxRasterWorkItems/);
assert.throws(() => extractProcPlantHeroBark(packageSource, {
  ...options,
  selection: { kind: "uv-region", minU: 4, minV: 4, maxU: 5, maxV: 5 },
}), /contains no supported triangles/);
assert.throws(() => extractProcPlantHeroBark(cylinderSource, {
  selector: { instanceId: cylinderPrimitive.instanceId },
  selection: {
    kind: "spine-band",
    authored: { ...authored, provenance: { ...authored.provenance, instanceId: "other" } },
    minT: 0.2,
    maxT: 0.8,
  },
}), /provenance does not match/);
assert.throws(() => extractProcPlantHeroBark(cylinderSource, {
  selector: { instanceId: cylinderPrimitive.instanceId },
  selection: {
    kind: "spine-band",
    authored: { ...authored, provenance: { ...authored.provenance, sourceContentHash: "other-source" } },
    minT: 0.2,
    maxT: 0.8,
  },
}), /provenance does not match/);
const jpegSource: ProcPlantHeroGlbImportPackage = {
  ...packageSource,
  textures: [{ ...packageSource.textures[0]!, mimeType: "image/jpeg" }],
};
assert.throws(() => extractProcPlantHeroBark(jpegSource, options), /only accepts decoded imported PNG/);
assert.throws(() => extractProcPlantHeroBark({
  ...packageSource,
  textures: [{ ...packageSource.textures[0]!, bytes: Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7) }],
}, options), /invalid signature/);
console.log("ok 5 - unsupported codecs, provenance, topology, selection, and work budgets fail closed");
