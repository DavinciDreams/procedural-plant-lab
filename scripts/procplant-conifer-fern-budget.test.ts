import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";

const SEED = 612072;
const EXPECTED = {
  phiFern: {
    triangles: [352, 264, 4, 2],
    vertices: [1056, 792, 8, 4],
  },
  blueSpruce: {
    triangles: [3934, 2494, 4, 2],
    vertices: [7324, 3942, 8, 4],
  },
  alpineFir: {
    triangles: [5190, 3174, 4, 2],
    vertices: [8388, 4509, 8, 4],
  },
  redwoodSpire: {
    triangles: [3896, 2540, 4, 2],
    vertices: [6765, 3710, 8, 4],
  },
  tundraSmallPine: {
    triangles: [3678, 2354, 4, 2],
    vertices: [7148, 3826, 8, 4],
  },
  shorePineCones: {
    triangles: [1596, 1080, 4, 2],
    vertices: [4692, 3168, 8, 4],
  },
} as const;

const hashTemplate = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const environment = defaultPlantEnvironment();
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
  assert.deepEqual(vertices, expected.vertices, `${id} vertex budget drifted`);
  assert.deepEqual(first.map((lod) => hashTemplate(lod.template)), second.map((lod) => hashTemplate(lod.template)),
    `${id} geometry must remain deterministic`);
  assert.ok(triangles[1]! < triangles[0]!, `${id} clustered LOD must reduce triangles`);
  assert.ok(vertices[1]! < vertices[0]!, `${id} clustered LOD must reduce vertices`);
  assert.equal(triangles[2], 4, `${id} far cross must stay four triangles`);
  assert.equal(triangles[3], 2, `${id} far impostor must stay two triangles`);
  if (id !== "phiFern") {
    assert.ok(triangles[0]! <= 5_200, `${id} exceeds the audited close conifer budget`);
    assert.ok(vertices[0]! <= 8_400, `${id} exceeds the audited close conifer vertex budget`);
  }
  summaries.push({ id, triangles, vertices, lod0Hash: hashTemplate(first[0]!.template) });
}

console.log(JSON.stringify({ seed: SEED, summaries }, null, 2));
console.log("procplant conifer/fern geometry budgets passed");
