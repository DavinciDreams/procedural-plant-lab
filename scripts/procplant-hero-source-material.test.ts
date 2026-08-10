import assert from "node:assert/strict";
import * as THREE from "three";
import type { ProcPlantHeroGlbImportPackage } from "../src/procplant-hero-glb-import";
import { prepareProcPlantHeroSourceMaterial } from "../src/procplant-hero-source-material";

let closed = 0;
let decoded = 0;
const image = { width: 1, height: 1, close: () => { closed++; } } as ImageBitmap;
const imported = {
  contract: "procplants.hero-glb-import",
  version: 1,
  inspection: { contentHash: "deadbeef" },
  meshes: [],
  textures: [{ imageIndex: 0, name: "Bark", mimeType: "image/png", bytes: Uint8Array.of(137, 80, 78, 71) }],
  materials: [{
    materialIndex: 0, name: "Imported bark", baseColorFactor: [0.4, 0.3, 0.2, 0.75],
    metallicFactor: 0.15, roughnessFactor: 0.82,
    baseColorTexture: {
      textureIndex: 0, imageIndex: 0, texCoord: 0,
      sampler: { samplerIndex: 0, magFilter: 9728, minFilter: 9985, wrapS: 33071, wrapT: 33648 },
      transform: { offset: [0.125, 0.25], rotation: 0.5, scale: [2, 3], texCoord: 0 },
    },
    metallicRoughnessTexture: null, normalTexture: null, occlusionTexture: null,
    emissiveFactor: [0.01, 0.02, 0.03], emissiveTexture: null,
    alphaMode: "MASK", alphaCutoff: 0.35, doubleSided: true,
  }],
} as unknown as ProcPlantHeroGlbImportPackage;

const prepared = await prepareProcPlantHeroSourceMaterial(imported, 0, async () => { decoded++; return image; });
assert.equal(decoded, 1);
assert.equal(prepared.audit.sourceMaterialApplied, true);
assert.equal(prepared.audit.textureBindings, 1);
assert.equal(prepared.material.name, "Imported bark");
assert.equal(prepared.material.opacity, 0.75);
assert.equal(prepared.material.metalness, 0.15);
assert.equal(prepared.material.roughness, 0.82);
assert.equal(prepared.material.alphaTest, 0.35);
assert.equal(prepared.material.side, THREE.DoubleSide);
assert.ok(prepared.material.map);
assert.equal(prepared.material.map.colorSpace, THREE.SRGBColorSpace);
assert.equal(prepared.material.map.flipY, false);
assert.equal(prepared.material.map.magFilter, THREE.NearestFilter);
assert.equal(prepared.material.map.minFilter, THREE.LinearMipmapNearestFilter);
assert.equal(prepared.material.map.wrapS, THREE.ClampToEdgeWrapping);
assert.equal(prepared.material.map.wrapT, THREE.MirroredRepeatWrapping);
assert.deepEqual(prepared.material.map.offset.toArray(), [0.125, 0.25]);
assert.deepEqual(prepared.material.map.repeat.toArray(), [2, 3]);
assert.equal(prepared.material.map.rotation, 0.5);
let textureDisposals = 0;
prepared.material.map.addEventListener("dispose", () => textureDisposals++);
prepared.dispose();
prepared.dispose();
assert.equal(textureDisposals, 1, "owned texture must dispose once");
assert.equal(closed, 1, "shared decoded image must close once");

let ktxDecoded = 0;
const ktx = structuredClone(imported) as ProcPlantHeroGlbImportPackage;
ktx.textures[0]!.mimeType = "image/ktx2";
await assert.rejects(
  prepareProcPlantHeroSourceMaterial(ktx, 0, async () => { ktxDecoded++; return image; }),
  /KTX2.*renderer-configured KTX2 decoder/,
);
assert.equal(ktxDecoded, 0, "KTX2 must fail before a generic bitmap decoder is attempted");

const fallback = await prepareProcPlantHeroSourceMaterial(imported, null, async () => image);
assert.equal(fallback.audit.sourceMaterialApplied, false);
assert.equal(fallback.textures.length, 0);
fallback.dispose();

console.log("ok 1 - imported PBR factors, color space, sampler, UV0 transform, and disposal are preserved");
console.log("ok 2 - KTX2 ingestion has an explicit renderer-decoder boundary and does not imply authoring");
console.log("1..2");
