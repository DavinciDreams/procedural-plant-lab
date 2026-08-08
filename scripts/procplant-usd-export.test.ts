import assert from "node:assert/strict";
import {
  exportProcPlantUsda,
  PROCPLANT_USDA_EXPORT_CONTRACT,
} from "../src/procplant-usd-export";
import {
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";

const balancedBracesOutsideStrings = (text: string) => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !quoted;
};

const triangle: ProcPlantTemplate = {
  pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]),
  nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uv0: new Float32Array([0, 0, 1, 0, 0.5, 1]),
  col: new Float32Array([0.2, 0.4, 0.6, 0.3, 0.5, 0.7, 0.4, 0.6, 0.8]),
  tintable: new Uint8Array([0, 1, 1]),
  sway: new Float32Array([0, 0.5, 1]),
  idx: new Uint32Array([0, 1, 2]),
};

const options = {
  name: "Test Plant / North",
  genomeId: "fixture",
  seed: 0xffffffff,
  metadata: { profile: "test", ready: true, score: 0.5 },
  collision: { type: "bounds-box" as const, scale: 1.25 },
};
const directA = exportProcPlantUsda(triangle, options);
const directB = exportProcPlantUsda(triangle, options);
const directC = exportProcPlantUsda(triangle, {
  ...options,
  metadata: { score: 0.5, ready: true, profile: "test" },
});
assert.equal(directA.contract, PROCPLANT_USDA_EXPORT_CONTRACT);
assert.equal(directA.text, directB.text);
assert.equal(directA.text, directC.text, "metadata key insertion order must not alter USDA bytes");
assert.equal(directA.fileName, "procplant-test-plant-north.usda");
assert.equal(directA.defaultPrim, "ProcPlant_Test_Plant_North");
assert.equal(directA.bytes, new TextEncoder().encode(directA.text).byteLength);
assert.ok(directA.text.startsWith("#usda 1.0\n(\n"));
assert.match(directA.text, /defaultPrim = "ProcPlant_Test_Plant_North"/);
assert.match(directA.text, /metersPerUnit = 1/);
assert.match(directA.text, /upAxis = "Y"/);
assert.match(directA.text, /uniform token subdivisionScheme = "none"/);
assert.match(directA.text, /int\[\] faceVertexCounts = \[\s*3\s*\]/);
assert.match(directA.text, /int\[\] faceVertexIndices = \[\s*0, 1, 2\s*\]/);
assert.match(directA.text, /normal3f\[\] normals = [\s\S]+interpolation = "vertex"/);
assert.match(directA.text, /color3f\[\] primvars:displayColor/);
assert.match(directA.text, /float\[\] primvars:procplantSway/);
assert.match(directA.text, /float\[\] primvars:procplantTintable/);
assert.match(directA.text, /prepend apiSchemas = \["PhysicsCollisionAPI"\]/);
assert.match(directA.text, /def Cube "Collision"/);
assert.match(directA.text, /bool physics:collisionEnabled = true/);
assert.match(directA.text, /uniform token purpose = "guide"/);
assert.match(directA.text, /double3 xformOp:scale = \(1\.25, 2\.5, 0\.001\)/);
assert.match(directA.text, /custom int64 procplant:seed = 4294967295/);
assert.ok(balancedBracesOutsideStrings(directA.text));
assert.deepEqual(directA.lods, [{
  level: null,
  label: "template",
  distance: null,
  triangles: 1,
  vertices: 3,
  variant: null,
}]);
console.log("ok 1 - direct USDA export preserves geometry, display data, metadata, and physics collision semantics");

const lods = compileProcPlantLods(procPlantPresets.cloverGroundcover, 77, defaultPlantEnvironment());
const allA = exportProcPlantUsda(lods, {
  name: procPlantPresets.cloverGroundcover.id,
  genomeId: procPlantPresets.cloverGroundcover.id,
  seed: 77,
  defaultLod: 2,
  collision: { type: "trunk-capsule" },
});
const allB = exportProcPlantUsda(lods, {
  name: procPlantPresets.cloverGroundcover.id,
  genomeId: procPlantPresets.cloverGroundcover.id,
  seed: 77,
  defaultLod: 2,
  collision: { type: "trunk-capsule" },
});
assert.equal(allA.text, allB.text);
assert.equal(allA.lods.length, 4);
assert.deepEqual(allA.lods.map((lod) => lod.level), [0, 1, 2, 3]);
assert.deepEqual(allA.lods.map((lod) => lod.variant), [
  "LOD0_full", "LOD1_clustered", "LOD2_billboard_cross", "LOD3_impostor",
]);
assert.match(allA.text, /prepend variantSets = "LOD"/);
assert.match(allA.text, /string LOD = "LOD2_billboard_cross"/);
for (const variant of allA.lods.map((lod) => lod.variant)) {
  assert.match(allA.text, new RegExp(`"${variant}" \\{`));
}
assert.equal((allA.text.match(/def Mesh "Geometry"/g) ?? []).length, 4);
assert.equal((allA.text.match(/def Capsule "Collision"/g) ?? []).length, 4);
assert.equal((allA.text.match(/prepend apiSchemas = \["PhysicsCollisionAPI"\]/g) ?? []).length, 4);
assert.ok(balancedBracesOutsideStrings(allA.text));
console.log(`ok 2 - all real LODs export as deterministic selectable USD variants (${allA.bytes} bytes)`);

assert.throws(() => exportProcPlantUsda(lods, { defaultLod: 9 as never }), /not present/);
assert.throws(() => exportProcPlantUsda(triangle, { maxBytes: 1024 }), /exceeds maxBytes/);
assert.throws(() => exportProcPlantUsda({ ...triangle, idx: new Uint32Array([0, 1, 99]) }), /missing vertex/);
console.log("ok 3 - USDA export rejects missing LODs, oversized output, and invalid geometry");
console.log("1..3");
