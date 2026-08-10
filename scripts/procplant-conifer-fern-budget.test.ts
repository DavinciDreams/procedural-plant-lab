import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  buildProcPlantInstancedParts,
  buildProcPlantInstancePrototype,
  buildProcPlantTemplate,
  compileProcPlantLods,
  createProcPlantConiferSprayGeometry,
  createProcPlantFernFrondGeometry,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";

const SEED = 612072;
const EXPECTED = {
  phiFern: {
    triangles: [352, 264, 4, 2],
    vertices: [704, 528, 8, 4],
    beforeVertices: [1056, 792, 8, 4],
    expandedPositionHash: "afc72b92ffd52e8d54bf1d214465a8e1e9ef227faa3f8f868fafa22bb85a431a",
    frondCount: 8,
  },
  blueSpruce: {
    triangles: [3934, 2494, 4, 2],
    vertices: [4420, 2436, 8, 4],
    beforeVertices: [7324, 3942, 8, 4],
    expandedPositionHash: "3d787dda0d9f8d6e0722112a68faf8baa579872f4da903357490419c6658cb67",
    sprayCount: 122,
    stemTriangles: 2470,
  },
  alpineFir: {
    triangles: [5190, 3174, 4, 2],
    vertices: [5208, 2856, 8, 4],
    beforeVertices: [8388, 4509, 8, 4],
    expandedPositionHash: "681b7b8243fd4ecac9669f2fab8521b791ed53d6c43a83d68057a8278feab3ce",
    sprayCount: 130,
    stemTriangles: 3630,
  },
  redwoodSpire: {
    triangles: [3896, 2540, 4, 2],
    vertices: [4023, 2279, 8, 4],
    beforeVertices: [6765, 3710, 8, 4],
    expandedPositionHash: "7c68d19c0d389a17356e15a1a0a6bcb8484cae39f89dd479829ad84646fdc3a1",
    sprayCount: 101,
    stemTriangles: 2684,
  },
  tundraSmallPine: {
    triangles: [3678, 2354, 4, 2],
    vertices: [4352, 2392, 8, 4],
    beforeVertices: [7148, 3826, 8, 4],
    expandedPositionHash: "a2ef4cbb1f9972c0054904de3beaa3a7f9073f409e6da31afa6a1963af24dfef",
    sprayCount: 128,
    stemTriangles: 2142,
  },
  shorePineCones: {
    triangles: [1596, 1080, 4, 2],
    vertices: [3372, 2328, 8, 4],
    beforeVertices: [4692, 3168, 8, 4],
    expandedPositionHash: "3c627967f2554748c3b85edb7f24846d1a83f606efbb8eaea5f764cab80c2d28",
    sprayCount: 33,
    stemTriangles: 96,
    accessoryTriangles: 180,
  },
} as const;

const hashTemplate = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

/** Hash rendered triangle positions after index expansion, independent of vertex packing. */
const hashExpandedPositions = (template: ProcPlantTemplate) => {
  const expanded = new Float32Array(template.idx.length * 3);
  for (let corner = 0; corner < template.idx.length; corner++) {
    const source = template.idx[corner]! * 3;
    expanded[corner * 3] = template.pos[source]!;
    expanded[corner * 3 + 1] = template.pos[source + 1]!;
    expanded[corner * 3 + 2] = template.pos[source + 2]!;
  }
  return createHash("sha256").update(Buffer.from(expanded.buffer)).digest("hex");
};

const environment = defaultPlantEnvironment();

for (const [detail, expectedVertices, expectedTriangles] of [
  ["full", 80, 40],
  ["light", 24, 12],
] as const) {
  const geometry = createProcPlantConiferSprayGeometry(detail);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv0 = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  assert.equal(position.count, expectedVertices, `${detail} spray must retain indexed folded-ribbon vertices`);
  assert.equal(normal.count, position.count, `${detail} spray must retain one normal per vertex`);
  assert.equal(uv0.count, position.count, `${detail} spray must retain one UV0 pair per vertex`);
  assert.equal(index?.count, expectedTriangles * 3, `${detail} spray triangle topology drifted`);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const face = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();
  let minimumNormalAlignment = 1;
  for (let offset = 0; offset < index!.count; offset += 3) {
    const ia = index!.getX(offset);
    const ib = index!.getX(offset + 1);
    const ic = index!.getX(offset + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    face.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const vertex of [ia, ib, ic]) {
      vertexNormal.fromBufferAttribute(normal, vertex);
      assert.ok(Math.abs(vertexNormal.length() - 1) < 1e-5, `${detail} spray normals must remain unit length`);
      vertexNormal.normalize();
      minimumNormalAlignment = Math.min(minimumNormalAlignment, face.dot(vertexNormal));
    }
  }
  // The authored ribbon intentionally keeps one flat normal across each mildly
  // warped quad. Guard against an inverted/invalid fold without replacing that
  // established faceted shading with per-triangle seams.
  assert.ok(minimumNormalAlignment > 0.8,
    `${detail} spray normals must remain aligned with the authored folded surface; received ${minimumNormalAlignment}`);
  geometry.dispose();
}

{
  const geometry = createProcPlantFernFrondGeometry();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv0 = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  assert.equal(position.count, 88, "fern frond must retain 22 indexed folded quads");
  assert.equal(normal.count, position.count, "fern frond must retain one normal per shared vertex");
  assert.equal(uv0.count, position.count, "fern frond must retain one UV0 pair per shared vertex");
  assert.equal(index?.count, 132, "fern frond must retain 44 triangles");
  assert.equal(new Set(Array.from(index!.array)).size, position.count, "every fern prototype vertex must be referenced");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const face = new THREE.Vector3();
  const edge = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();
  let minimumNormalAlignment = 1;
  for (let vertex = 0; vertex < position.count; vertex++) {
    vertexNormal.fromBufferAttribute(normal, vertex);
    assert.ok(Math.abs(vertexNormal.length() - 1) < 1e-5, "fern frond normals must remain unit length");
    assert.ok(uv0.getX(vertex) >= 0 && uv0.getX(vertex) <= 1, "fern frond U must stay normalized");
    assert.equal(uv0.getY(vertex), position.getY(vertex), "fern frond V must follow axial position");
  }
  for (let offset = 0; offset < index!.count; offset += 3) {
    const ia = index!.getX(offset);
    const ib = index!.getX(offset + 1);
    const ic = index!.getX(offset + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    face.subVectors(b, a).cross(edge.subVectors(c, a));
    if (face.lengthSq() < 1e-12) continue;
    face.normalize();
    for (const vertex of [ia, ib, ic]) {
      vertexNormal.fromBufferAttribute(normal, vertex).normalize();
      minimumNormalAlignment = Math.min(minimumNormalAlignment, face.dot(vertexNormal));
    }
  }
  assert.ok(minimumNormalAlignment > 0.8,
    `fern frond normals must remain aligned with the folded surface; received ${minimumNormalAlignment}`);
  geometry.dispose();
}

const summaries = [];
for (const [id, expected] of Object.entries(EXPECTED)) {
  const genome = procPlantPresets[id];
  assert.ok(genome, `${id} must remain registered`);
  const first = compileProcPlantLods(genome, SEED, environment);
  const second = compileProcPlantLods(genome, SEED, environment);
  const triangles = first.map((lod) => lod.triangles);
  const vertices = first.map((lod) => lod.vertices);

  assert.deepEqual(first.map((lod) => lod.level), [0, 1, 2, 3], `${id} must keep four real LODs`);
  assert.deepEqual(triangles, expected.triangles, `${id} triangle budget drifted`);
  assert.deepEqual(vertices, expected.vertices, `${id} indexed vertex budget drifted`);
  assert.deepEqual(first.map((lod) => hashTemplate(lod.template)), second.map((lod) => hashTemplate(lod.template)),
    `${id} geometry must remain deterministic`);
  const expandedPositionHash = hashExpandedPositions(first[0]!.template);
  assert.equal(expandedPositionHash, expected.expandedPositionHash,
    `${id} rendered triangle positions must stay byte-identical to the revision-3 silhouette`);
  assert.equal(first[0]!.template.pos.length / 3 - new Set(first[0]!.template.idx).size, 0,
    `${id} LOD0 must not upload unreferenced vertices`);
  assert.equal(first[0]!.template.uv0.length, vertices[0]! * 2, `${id} LOD0 must retain exact UV0 cardinality`);
  assert.equal(first[0]!.template.nrm.length, vertices[0]! * 3, `${id} LOD0 must retain exact normal cardinality`);
  assert.equal(first[0]!.template.sway.length, vertices[0], `${id} LOD0 must retain exact sway cardinality`);
  assert.ok(first[0]!.template.uv0.every(Number.isFinite), `${id} LOD0 UV0 values must remain finite`);
  assert.ok(first[0]!.template.nrm.every(Number.isFinite), `${id} LOD0 normals must remain finite`);
  assert.ok(first[0]!.template.sway.every(Number.isFinite), `${id} LOD0 sway values must remain finite`);
  assert.ok(triangles[1]! < triangles[0]!, `${id} clustered LOD must reduce triangles`);
  assert.ok(vertices[1]! < vertices[0]!, `${id} clustered LOD must reduce vertices`);
  assert.equal(triangles[2], 4, `${id} far cross must stay four triangles`);
  assert.equal(triangles[3], 2, `${id} far impostor must stay two triangles`);
  if (id === "phiFern") {
    assert.ok("frondCount" in expected, "Phi Fern budget must declare its canonical frond count");
    assert.ok(vertices[0]! <= expected.beforeVertices[0]! * 0.7,
      "Phi Fern must retain at least a 30% LOD0 vertex reduction from the dedicated-frond baseline");
    const parts = buildProcPlantInstancedParts(genome, SEED, environment);
    assert.equal(parts.stems.idx.length, 0, "Phi Fern must remain an eight-frond crown without baked stems");
    assert.equal(parts.instances.length, expected.frondCount, "Phi Fern frond count drifted");
    assert.ok(parts.instances.every((instance) => instance.kind === "fernFrond"),
      "Phi Fern must retain only dedicated fernFrond instances");
    const prototype = buildProcPlantInstancePrototype("fernFrond", genome);
    assert.equal(prototype.idx.length / 3, 44, "dedicated fern prototype triangle count drifted");
    assert.equal(prototype.pos.length / 3, 88, "dedicated fern prototype indexed vertex count drifted");
  } else {
    assert.ok(triangles[0]! <= 5_200, `${id} exceeds the audited close conifer budget`);
    assert.ok(vertices[0]! <= 8_400, `${id} exceeds the audited close conifer vertex budget`);
    assert.ok(vertices[0]! <= expected.beforeVertices[0]! * 0.85,
      `${id} must retain at least a 15% LOD0 vertex reduction from the revision-3 baseline`);
  }
  let decomposition: Record<string, number> | undefined;
  if ("sprayCount" in expected) {
    const prototype = createProcPlantConiferSprayGeometry(genome.weberPenn ? "light" : "full");
    const prototypeTriangles = prototype.getIndex()!.count / 3;
    const prototypeVertices = prototype.getAttribute("position").count;
    const build = buildProcPlantTemplate(genome, SEED, environment);
    const parts = buildProcPlantInstancedParts(genome, SEED, environment);
    const sprayCount = genome.weberPenn
      ? build.stats.leaves
      : parts.instances.filter((instance) => instance.kind === "coniferSpray").length;
    const sprayTriangles = sprayCount * prototypeTriangles;
    const stemTriangles = genome.weberPenn ? triangles[0]! - sprayTriangles : parts.stems.idx.length / 3;
    const accessoryTriangles = triangles[0]! - stemTriangles - sprayTriangles;
    const sprayVertices = sprayCount * prototypeVertices;
    const stemVertices = genome.weberPenn
      ? vertices[0]! - sprayVertices
      : parts.stems.pos.length / 3;
    const accessoryVertices = vertices[0]! - stemVertices - sprayVertices;
    prototype.dispose();
    assert.equal(sprayCount, expected.sprayCount, `${id} spray count/silhouette density drifted`);
    assert.equal(stemTriangles, expected.stemTriangles, `${id} stem triangle cost drifted`);
    assert.equal(accessoryTriangles, "accessoryTriangles" in expected ? expected.accessoryTriangles : 0,
      `${id} accessory triangle cost drifted`);
    decomposition = {
      stemTriangles,
      stemVertices,
      sprayCount,
      sprayTriangles,
      sprayVertices,
      accessoryTriangles,
      accessoryVertices,
    };
  }
  summaries.push({
    id,
    triangles,
    vertices,
    beforeVertices: expected.beforeVertices,
    lod0VertexReductionPercent: Number(((1 - vertices[0]! / expected.beforeVertices[0]!) * 100).toFixed(2)),
    lod0Hash: hashTemplate(first[0]!.template),
    lod0ExpandedPositionHash: expandedPositionHash,
    lod0UnreferencedVertices: vertices[0]! - new Set(first[0]!.template.idx).size,
    ...(decomposition ? { decomposition } : {}),
  });
}

console.log(JSON.stringify({ seed: SEED, revision: "indexed-organ-revision", summaries }, null, 2));
console.log("procplant conifer/fern geometry budgets passed");
