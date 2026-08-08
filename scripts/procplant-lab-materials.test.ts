import assert from "node:assert/strict";
import { bakeProcPlantLabMaterials } from "../src/procplant-lab-authoring-imports";
import { procPlantPresets } from "../src/procplants";

const first = bakeProcPlantLabMaterials(procPlantPresets.cloverGroundcover, 0x51face);
const second = bakeProcPlantLabMaterials(procPlantPresets.cloverGroundcover, 0x51face);

assert.equal(first.ready, true);
assert.equal(first.images.length, 6, "bark and leaf must each bake base color, ORM, and normal PNGs");
assert.equal(first.contentHash, second.contentHash);
assert.deepEqual(
  first.images.map((image) => [image.slot, image.usage, image.contentHash]),
  second.images.map((image) => [image.slot, image.usage, image.contentHash]),
  "lab material resources must be byte deterministic",
);

const normals = first.images.filter((image) => image.usage === "normal");
assert.deepEqual(normals.map((image) => image.slot), ["bark", "leaf"]);
for (const image of normals) {
  assert.equal(image.colorSpace, "linear");
  const directions = new Set<string>();
  for (let offset = 0; offset < image.rgba.length; offset += 4 * 257) {
    const nx = image.rgba[offset]! / 255 * 2 - 1;
    const ny = image.rgba[offset + 1]! / 255 * 2 - 1;
    const nz = image.rgba[offset + 2]! / 255 * 2 - 1;
    const length = Math.hypot(nx, ny, nz);
    assert.ok(length > 0.985 && length < 1.015, `${image.slot} normal samples must remain normalized after RGBA8 quantization`);
    directions.add(`${image.rgba[offset]},${image.rgba[offset + 1]},${image.rgba[offset + 2]}`);
  }
  assert.ok(directions.size > 8, `${image.slot} normal map must contain real directional variation`);
}

assert.ok(normals[0]!.contentHash !== normals[1]!.contentHash, "bark and leaf normal maps must remain distinct");
console.log(`procplant lab PBR material tests passed (${first.images.length} images; ${first.contentHash})`);
