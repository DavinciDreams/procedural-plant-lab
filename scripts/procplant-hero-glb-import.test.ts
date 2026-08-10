import assert from "node:assert/strict";
import {
  extractProcPlantHeroGlbMeshes,
  extractProcPlantHeroGlbTextures,
  importProcPlantHeroGlb,
  inspectProcPlantHeroGlb,
  PROCPLANT_HERO_GLB_IMPORT_CONTRACT,
  PROCPLANT_HERO_GLB_IMPORT_VERSION,
} from "../src/procplant-hero-glb-import";

const png = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7JkAAAAASUVORK5CYII=",
  "base64",
));

const pad4 = (value: number) => (value + 3) & ~3;
const concat = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
};
const uint32 = (value: number) => Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24);
const floats = (...values: number[]) => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
};
const uint16s = (...values: number[]) => {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
};

const positions = floats(0, 0, 0, 1, 0, 0, 0, 1, 0);
const normals = floats(0, 0, 1, 0, 0, 1, 0, 0, 1);
const uv = uint16s(0, 0, 65535, 0, 0, 65535);
const indices = uint16s(0, 1, 2);

const makeGlb = (
  mutate?: (json: Record<string, any>, binary: Uint8Array) => void,
) => {
  const parts = [positions, normals, uv, indices, png];
  const offsets: number[] = [];
  let binaryLength = 0;
  for (const part of parts) {
    binaryLength = pad4(binaryLength);
    offsets.push(binaryLength);
    binaryLength += part.length;
  }
  const binary = new Uint8Array(binaryLength);
  parts.forEach((part, index) => binary.set(part, offsets[index]));
  const json: Record<string, any> = {
    asset: { version: "2.0", generator: "Procplants hero fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Hero trunk", mesh: 0 }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: positions.length },
      { buffer: 0, byteOffset: offsets[1], byteLength: normals.length },
      { buffer: 0, byteOffset: offsets[2], byteLength: uv.length },
      { buffer: 0, byteOffset: offsets[3], byteLength: indices.length },
      { buffer: 0, byteOffset: offsets[4], byteLength: png.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, normalized: true, count: 3, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    images: [{ name: "Bark albedo", bufferView: 4, mimeType: "image/png" }],
    samplers: [{ magFilter: 9728, minFilter: 9985, wrapS: 33071, wrapT: 33648 }],
    textures: [{ source: 0, sampler: 0 }],
    materials: [{
      name: "Bark",
      pbrMetallicRoughness: {
        baseColorFactor: [0.4, 0.3, 0.2, 0.75], metallicFactor: 0.15, roughnessFactor: 0.82,
        baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { offset: [0.125, 0.25], rotation: 0.5, scale: [2, 3] } } },
      },
      normalTexture: { index: 0, scale: 0.7 },
      occlusionTexture: { index: 0, strength: 0.6 },
      emissiveFactor: [0.01, 0.02, 0.03], emissiveTexture: { index: 0 },
      alphaMode: "MASK", alphaCutoff: 0.35, doubleSided: true,
    }],
    meshes: [{ name: "Scanned trunk", primitives: [{
      attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
      indices: 3,
      material: 0,
      mode: 4,
    }] }],
  };
  mutate?.(json, binary);
  const jsonSource = new TextEncoder().encode(JSON.stringify(json));
  const jsonBytes = new Uint8Array(pad4(jsonSource.length));
  jsonBytes.fill(0x20);
  jsonBytes.set(jsonSource);
  const binBytes = new Uint8Array(pad4(binary.length));
  binBytes.set(binary);
  const length = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  return concat(
    uint32(0x46546c67), uint32(2), uint32(length),
    uint32(jsonBytes.length), uint32(0x4e4f534a), jsonBytes,
    uint32(binBytes.length), uint32(0x004e4942), binBytes,
  );
};

const source = makeGlb();
const snapshot = source.slice();
const first = inspectProcPlantHeroGlb(source);
const second = inspectProcPlantHeroGlb(source);
assert.deepEqual(first, second);
assert.equal(first.contract, PROCPLANT_HERO_GLB_IMPORT_CONTRACT);
assert.equal(first.version, PROCPLANT_HERO_GLB_IMPORT_VERSION);
assert.equal(first.meshes, 1);
assert.equal(first.meshInstances, 1);
assert.equal(first.primitives, 1);
assert.equal(first.primitivesDetail[0]!.vertexCount, 3);
assert.equal(first.primitivesDetail[0]!.triangleCount, 1);
assert.equal(first.primitivesDetail[0]!.hasNormals, true);
assert.equal(first.primitivesDetail[0]!.hasUv0, true);
assert.equal(first.images[0]!.contentHash.length, 8);
assert.deepEqual(source, snapshot, "inspection must not mutate source bytes");

const mesh = extractProcPlantHeroGlbMeshes(source)[0]!;
assert.equal(mesh.nodeIndex, 0);
assert.equal(mesh.nodePath, "node:000000");
assert.equal(mesh.transformsBaked, false);
assert.equal(mesh.instanceId, "node:000000:mesh:000000:primitive:000000");
assert.deepEqual(mesh.worldMatrix, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
assert.deepEqual([...mesh.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
assert.deepEqual([...mesh.normals!], [0, 0, 1, 0, 0, 1, 0, 0, 1]);
assert.deepEqual([...mesh.uv0!], [0, 0, 1, 0, 0, 1]);
assert.deepEqual([...mesh.indices!], [0, 1, 2]);

const approximate = (actual: ArrayLike<number>, expected: readonly number[], epsilon = 1e-5) => {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index++) {
    assert.ok(Math.abs(actual[index]! - expected[index]!) <= epsilon,
      `component ${index}: ${actual[index]} must approximate ${expected[index]}`);
  }
};

const hierarchy = makeGlb((json, binary) => {
  const half = Math.SQRT1_2;
  json.nodes = [
    { name: "Translated root", translation: [10, 0, 0], children: [1] },
    { name: "Rotated trunk", mesh: 0, rotation: [0, 0, half, half], scale: [2, 1, 0.5] },
  ];
  json.scenes = [{ nodes: [0] }];
  const normalOffset = positions.length;
  const view = new DataView(binary.buffer);
  for (let vertex = 0; vertex < 3; vertex++) {
    view.setFloat32(normalOffset + vertex * 12, half, true);
    view.setFloat32(normalOffset + vertex * 12 + 4, half, true);
    view.setFloat32(normalOffset + vertex * 12 + 8, 0, true);
  }
});
const hierarchySourceSnapshot = hierarchy.slice();
const hierarchyLocal = extractProcPlantHeroGlbMeshes(hierarchy)[0]!;
assert.equal(hierarchyLocal.nodeIndex, 1);
assert.equal(hierarchyLocal.nodePath, "node:000000/node:000001");
assert.equal(hierarchyLocal.transformsBaked, false);
assert.deepEqual([...hierarchyLocal.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
approximate(hierarchyLocal.worldMatrix, [0, 2, 0, 0, -1, 0, 0, 0, 0, 0, 0.5, 0, 10, 0, 0, 1]);
const hierarchyBaked = extractProcPlantHeroGlbMeshes(hierarchy, { bakeNodeTransforms: true })[0]!;
assert.equal(hierarchyBaked.transformsBaked, true);
approximate(hierarchyBaked.positions, [10, 0, 0, 10, 2, 0, 9, 0, 0]);
approximate(hierarchyBaked.normals!, [-0.894427, 0.447214, 0, -0.894427, 0.447214, 0, -0.894427, 0.447214, 0]);
assert.deepEqual(hierarchy, hierarchySourceSnapshot, "transform baking must not mutate source bytes");

const matrixHierarchy = makeGlb((json) => {
  json.nodes = [
    { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1], children: [1] },
    { mesh: 0, translation: [2, 0, 0] },
  ];
  json.scenes = [{ nodes: [0] }];
});
const matrixBaked = extractProcPlantHeroGlbMeshes(matrixHierarchy, { bakeNodeTransforms: true })[0]!;
approximate(matrixBaked.positions, [3, 2, 3, 4, 2, 3, 3, 3, 3]);
assert.deepEqual(matrixBaked.worldMatrix.slice(12, 15), [3, 2, 3]);

const instanced = makeGlb((json) => {
  json.nodes = [
    { name: "Left trunk", mesh: 0, translation: [-2, 0, 0] },
    { name: "Right trunk", mesh: 0, translation: [2, 0, 0] },
  ];
  json.scenes = [{ nodes: [0, 1] }];
});
const instances = extractProcPlantHeroGlbMeshes(instanced, { bakeNodeTransforms: true });
assert.equal(instances.length, 2);
assert.deepEqual(instances.map((entry) => entry.nodeIndex), [0, 1]);
assert.deepEqual(instances.map((entry) => entry.instanceId), [
  "node:000000:mesh:000000:primitive:000000",
  "node:000001:mesh:000000:primitive:000000",
]);
assert.deepEqual(instances.map((entry) => entry.positions[0]), [-2, 2]);
instances[0]!.positions[0] = 99;
assert.equal(instances[1]!.positions[0], 2, "node instances must own independent decoded arrays");
assert.equal(inspectProcPlantHeroGlb(instanced).meshInstances, 2);
assert.throws(() => extractProcPlantHeroGlbMeshes(instanced, { maxMeshInstances: 1 }), /exceeds maxMeshInstances/);
assert.throws(() => extractProcPlantHeroGlbMeshes(source, {
  bakeNodeTransforms: true,
  maxDecodedAttributeBytes: 150,
}), /transformed meshes exceed maxDecodedAttributeBytes/);
assert.throws(() => inspectProcPlantHeroGlb(makeGlb((json) => {
  json.nodes[0].matrix = [1, 0, 0, 0.1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  delete json.nodes[0].mesh;
})), /matrix must be affine/);
assert.throws(() => extractProcPlantHeroGlbMeshes(makeGlb((json) => {
  json.nodes[0].translation = [Number.MAX_VALUE, 0, 0];
}), { bakeNodeTransforms: true }), /outside float32 capacity/);

const texture = extractProcPlantHeroGlbTextures(source)[0]!;
assert.equal(texture.mimeType, "image/png");
assert.equal(texture.source, "bufferView");
assert.deepEqual(texture.textureIndices, [0]);
assert.deepEqual(texture.bytes, png);
texture.bytes.fill(0);
assert.deepEqual(extractProcPlantHeroGlbTextures(source)[0]!.bytes, png,
  "extracted image bytes must not alias the GLB or another extraction");
assert.deepEqual(source, snapshot, "mesh and texture extraction must not mutate source bytes");

const imported = importProcPlantHeroGlb(source);
assert.equal(imported.contract, PROCPLANT_HERO_GLB_IMPORT_CONTRACT);
assert.equal(imported.meshes.length, 1);
assert.equal(imported.textures.length, 1);
assert.equal(imported.materials.length, 1);
assert.deepEqual(imported.materials[0]!.baseColorFactor, [0.4, 0.3, 0.2, 0.75]);
assert.equal(imported.materials[0]!.metallicFactor, 0.15);
assert.equal(imported.materials[0]!.roughnessFactor, 0.82);
assert.deepEqual(imported.materials[0]!.baseColorTexture, {
  textureIndex: 0, imageIndex: 0, texCoord: 0,
  sampler: { samplerIndex: 0, magFilter: 9728, minFilter: 9985, wrapS: 33071, wrapT: 33648 },
  transform: { offset: [0.125, 0.25], rotation: 0.5, scale: [2, 3], texCoord: 0 },
});
assert.equal(imported.materials[0]!.normalTexture?.scale, 0.7);
assert.equal(imported.materials[0]!.occlusionTexture?.strength, 0.6);
assert.deepEqual(imported.materials[0]!.emissiveFactor, [0.01, 0.02, 0.03]);
assert.equal(imported.materials[0]!.alphaMode, "MASK");
assert.equal(imported.materials[0]!.alphaCutoff, 0.35);
assert.equal(imported.materials[0]!.doubleSided, true);
assert.deepEqual(imported.inspection, first);
assert.deepEqual(importProcPlantHeroGlb(source).materials, imported.materials, "resolved material records must be deterministic");

const dataUri = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
const dataUriGlb = makeGlb((json) => {
  json.images = [{ name: "Inline bark", uri: dataUri }];
});
const inlineTexture = extractProcPlantHeroGlbTextures(dataUriGlb)[0]!;
assert.equal(inlineTexture.source, "data-uri");
assert.deepEqual(inlineTexture.bytes, png);

const ktx2 = Uint8Array.of(0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a);
const ktxGlb = makeGlb((json) => {
  json.extensionsUsed = ["KHR_texture_basisu"];
  json.extensionsRequired = ["KHR_texture_basisu"];
  json.images = [{ name: "Compressed bark", uri: `data:image/ktx2;base64,${Buffer.from(ktx2).toString("base64")}` }];
  json.textures = [{ source: 0, sampler: 0, extensions: { KHR_texture_basisu: { source: 0 } } }];
});
const ktxImported = importProcPlantHeroGlb(ktxGlb);
assert.equal(ktxImported.textures[0]!.mimeType, "image/ktx2", "KTX2 bytes remain supported by deterministic ingestion");
assert.equal(ktxImported.materials[0]!.baseColorTexture?.imageIndex, 0, "basisu extension source may retain a fallback source");

assert.throws(() => inspectProcPlantHeroGlb(source, { maxBytes: source.length - 1 }), /exceeds maxBytes/);
assert.throws(() => inspectProcPlantHeroGlb(source, { maxImageBytes: png.length - 1 }), /byteLength/);
assert.throws(() => extractProcPlantHeroGlbMeshes(source, { maxVertices: 2 }), /count|vertices/i);
assert.throws(() => extractProcPlantHeroGlbMeshes(source, { maxDecodedAttributeBytes: 35 }), /maxDecodedAttributeBytes/);
assert.throws(() => extractProcPlantHeroGlbMeshes(makeGlb((_json, binary) => {
  new DataView(binary.buffer).setFloat32(0, Number.NaN, true);
})), /non-finite decoded component/);
assert.throws(() => inspectProcPlantHeroGlb(makeGlb((json) => {
  json.meshes[0].primitives.push(structuredClone(json.meshes[0].primitives[0]));
}), { maxPrimitives: 1 }), /exceeds maxPrimitives/);
assert.throws(() => inspectProcPlantHeroGlb(makeGlb((json) => {
  json.images[0] = { uri: "https://example.invalid/bark.png" };
})), /external or non-base64 URI/);
assert.throws(() => inspectProcPlantHeroGlb(makeGlb((json) => {
  json.images[0].mimeType = "image/jpeg";
})), /do not match image\/jpeg/);
assert.throws(() => inspectProcPlantHeroGlb(makeGlb((json) => {
  json.extensionsUsed = ["KHR_draco_mesh_compression"];
  json.extensionsRequired = ["KHR_draco_mesh_compression"];
})), /unsupported required hero GLB extension/);
assert.throws(() => extractProcPlantHeroGlbMeshes(makeGlb((json) => {
  json.bufferViews[0].extensions = { EXT_meshopt_compression: {} };
})), /compressed bufferViews are unsupported/);
assert.throws(() => extractProcPlantHeroGlbMeshes(makeGlb((json) => {
  json.accessors[0].sparse = {};
})), /sparse accessors are unsupported/);
assert.throws(() => extractProcPlantHeroGlbMeshes(makeGlb((json) => {
  json.meshes[0].primitives[0].mode = 5;
})), /TRIANGLES mode/);
assert.throws(() => extractProcPlantHeroGlbMeshes(makeGlb((json) => {
  json.nodes[0].scale = [1, 0, 1];
}), { bakeNodeTransforms: true }), /singular/);
assert.throws(() => extractProcPlantHeroGlbMeshes(makeGlb((json) => {
  json.animations = [{}];
}), { bakeNodeTransforms: true }), /animated node transforms/);
assert.throws(() => inspectProcPlantHeroGlb(makeGlb((json) => {
  json.nodes[0].matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  json.nodes[0].translation = [1, 0, 0];
})), /must not combine matrix with TRS/);
assert.throws(() => inspectProcPlantHeroGlb(makeGlb((json) => {
  json.nodes = [{ children: [2] }, { children: [2] }, { mesh: 0 }];
  json.scenes = [{ nodes: [0, 1] }];
})), /multiple parents/);
assert.throws(() => extractProcPlantHeroGlbMeshes(makeGlb((json) => {
  json.nodes[0].skin = 0;
  json.skins = [{}];
})), /skinning is unsupported/);
assert.throws(() => extractProcPlantHeroGlbMeshes(makeGlb((_json, binary) => {
  const indexOffset = pad4(positions.length) + pad4(normals.length) + pad4(uv.length);
  new DataView(binary.buffer).setUint16(indexOffset + 4, 9, true);
})), /references missing vertex 9/);
assert.throws(() => inspectProcPlantHeroGlb(makeGlb((json) => {
  json.images[0] = { uri: "data:image/png;base64,%%%=" };
})), /non-base64 URI|invalid base64/);
assert.throws(() => importProcPlantHeroGlb(makeGlb((json) => {
  json.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord = 1;
})), /supports UV0 only/);
assert.throws(() => importProcPlantHeroGlb(makeGlb((json) => {
  json.samplers[0].wrapS = 12345;
})), /wrapS is unsupported/);

console.log("ok 1 - bounded GLB inspection is deterministic and nonmutating");
console.log("ok 2 - hero mesh positions, normals, normalized UVs, and indices decode renderer-independently");
console.log("ok 3 - embedded and data-URI bark textures and deterministic PBR records extract as isolated data");
console.log("ok 4 - byte/count/output caps and unsupported compressed, sparse, external, or non-triangle inputs fail closed");
console.log("ok 5 - static hierarchy TRS/matrices, inverse-transpose normals, and stable mesh instancing provenance bake exactly");
console.log("1..5");
