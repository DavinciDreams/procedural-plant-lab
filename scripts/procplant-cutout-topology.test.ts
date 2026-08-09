import assert from "node:assert/strict";
import {
  buildProcPlantCutoutGeometry,
  createProcPlantCutout,
  createProcPlantCutoutAtlasCanvas,
  createProcPlantCutoutAtlasTexture,
  dilateProcPlantCutoutRaster,
  packProcPlantCutoutAtlas,
  PROCPLANT_CUTOUT_SWAY_ATTRIBUTE,
  traceProcPlantAlphaMask,
  type ProcPlantAlphaMask,
  type ProcPlantAtlasCanvas,
  type ProcPlantCutoutMetadata,
} from "../src/procplant-cutout";

const maskFromRows = (rows: readonly string[]): ProcPlantAlphaMask => ({
  width: rows[0]!.length,
  height: rows.length,
  alpha: Uint8Array.from(rows.flatMap((row) => [...row].map((value) => value === "#" ? 255 : 0))),
});

const disjointMask = maskFromRows([
  "##....##",
  "##....##",
  "........",
]);
const ringMask = maskFromRows([
  "#######",
  "#.....#",
  "#.....#",
  "#.....#",
  "#######",
]);
const metadata: ProcPlantCutoutMetadata = {
  pivot: { x: 0.25, y: 0.2 },
  attachment: { x: 0.25, y: 0.2 },
  bendAxis: { origin: { x: 0.25, y: 0.2 }, direction: { x: 0, y: 1 } },
};

const disjointTrace = traceProcPlantAlphaMask(disjointMask, { simplifyTolerance: 0.01 });
assert.equal(disjointTrace.length, 2, "both disjoint alpha islands must be traced");
assert.deepEqual(
  disjointTrace,
  traceProcPlantAlphaMask(disjointMask, { simplifyTolerance: 0.01 }),
  "equal-area islands must have deterministic ordering",
);
const disjoint = createProcPlantCutout("disjoint", disjointMask, metadata, { simplifyTolerance: 0.01 });
assert.deepEqual(disjoint.topology?.map(({ parentIndex, depth, role }) => ({ parentIndex, depth, role })), [
  { parentIndex: null, depth: 0, role: "island" },
  { parentIndex: null, depth: 0, role: "island" },
]);

const ring = createProcPlantCutout("ring", ringMask, metadata, { simplifyTolerance: 0.01 });
assert.equal(ring.contours.length, 2, "the transparent center must be retained as a boundary");
assert.deepEqual(ring.topology?.map(({ parentIndex, depth, role }) => ({ parentIndex, depth, role })), [
  { parentIndex: null, depth: 0, role: "island" },
  { parentIndex: 0, depth: 1, role: "hole" },
]);

const triangleArea = (geometry: ReturnType<typeof buildProcPlantCutoutGeometry>) => {
  const positions = geometry.getAttribute("position");
  const index = geometry.index!;
  let area = 0;
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    area += Math.abs(
      (positions.getX(b) - positions.getX(a)) * (positions.getY(c) - positions.getY(a)) -
      (positions.getY(b) - positions.getY(a)) * (positions.getX(c) - positions.getX(a)),
    ) * 0.5;
  }
  return area;
};

const disjointGeometry = buildProcPlantCutoutGeometry(disjoint, { width: 1, height: 1 });
try {
  assert.ok(Math.abs(triangleArea(disjointGeometry) - 8 / 24) < 1e-6, "both islands must contribute geometry");
  assert.equal(disjointGeometry.userData.procplantCutout.geometryContours.length, 2);
} finally {
  disjointGeometry.dispose();
}

const atlas = packProcPlantCutoutAtlas([ring, disjoint], { padding: 2, powerOfTwo: true });
assert.deepEqual(
  atlas,
  packProcPlantCutoutAtlas([disjoint, ring], { padding: 2, powerOfTwo: true }),
  "topology-bearing atlas metadata must be deterministic regardless of input order",
);
const ringEntry = atlas.entries.find((entry) => entry.id === ring.id)!;
assert.equal(ringEntry.contours!.length, 2);
assert.equal(ringEntry.atlasContours!.length, 2);
assert.equal(ringEntry.topology![1]!.role, "hole");
for (let contourIndex = 0; contourIndex < ringEntry.contours!.length; contourIndex++) {
  for (let pointIndex = 0; pointIndex < ringEntry.contours![contourIndex]!.length; pointIndex++) {
    const local = ringEntry.contours![contourIndex]![pointIndex]!;
    const atlasPoint = ringEntry.atlasContours![contourIndex]![pointIndex]!;
    assert.ok(Math.abs(atlasPoint.x - (ringEntry.uv.u0 + local.x * (ringEntry.uv.u1 - ringEntry.uv.u0))) < 1e-12);
    assert.ok(Math.abs(atlasPoint.y - (ringEntry.uv.v0 + local.y * (ringEntry.uv.v1 - ringEntry.uv.v0))) < 1e-12);
  }
}

const ringGeometry = buildProcPlantCutoutGeometry(ring, { width: 2, height: 3, atlasEntry: ringEntry });
try {
  assert.ok(Math.abs(triangleArea(ringGeometry) - 6 * 20 / 35) < 1e-6, "the hole must subtract from triangulated area");
  assert.deepEqual(ringGeometry.userData.procplantCutout.attachmentPosition, [0, 0, 0]);
  assert.equal(ringGeometry.userData.procplantCutout.topology[1].role, "hole");
  const uv = ringGeometry.getAttribute("uv");
  const sway = ringGeometry.getAttribute(PROCPLANT_CUTOUT_SWAY_ATTRIBUTE);
  let maximumSway = 0;
  for (let index = 0; index < uv.count; index++) {
    assert.ok(uv.getX(index) >= ringEntry.uv.u0 - 1e-7 && uv.getX(index) <= ringEntry.uv.u1 + 1e-7);
    assert.ok(uv.getY(index) >= ringEntry.uv.v0 - 1e-7 && uv.getY(index) <= ringEntry.uv.v1 + 1e-7);
    assert.ok(sway.getX(index) >= 0 && sway.getX(index) <= 1);
    maximumSway = Math.max(maximumSway, sway.getX(index));
  }
  assert.ok(Math.abs(maximumSway - 1) < 1e-7, "sway must span to the farthest island/hole vertex");
} finally {
  ringGeometry.dispose();
}

const ringRgba = new Uint8ClampedArray(ring.width * ring.height * 4);
for (let y = 0; y < ring.height; y++) {
  for (let x = 0; x < ring.width; x++) {
    const solid = ringMask.alpha[y * ring.width + x] === 255;
    ringRgba.set([20 + x, 40 + y, 80, solid ? 255 : 0], (y * ring.width + x) * 4);
  }
}
const raster = { id: ring.id, width: ring.width, height: ring.height, rgba: ringRgba };
const dilated = dilateProcPlantCutoutRaster(raster, 2);
const alphaAt = (rgba: Uint8ClampedArray, width: number, x: number, y: number) => rgba[(y * width + x) * 4 + 3];
assert.equal(alphaAt(dilated.rgba, dilated.width, 0, 0), 255, "the solid edge must fill the mip gutter");
assert.equal(alphaAt(dilated.rgba, dilated.width, 2 + 3, 2 + 2), 0, "dilation must not fill an internal hole");

const pixels = new Uint8ClampedArray(atlas.width * atlas.height * 4);
const fakeCanvasFactory = (width: number, height: number) => ({
  width,
  height,
  getContext: () => ({
    clearRect: () => pixels.fill(0),
    createImageData: (imageWidth: number, imageHeight: number) => ({
      width: imageWidth,
      height: imageHeight,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(imageWidth * imageHeight * 4),
    }),
    putImageData: (image: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number) => {
      for (let row = 0; row < image.height; row++) {
        for (let column = 0; column < image.width; column++) {
          const source = (row * image.width + column) * 4;
          const target = ((y + row) * width + x + column) * 4;
          pixels.set(image.data.subarray(source, source + 4), target);
        }
      }
    },
  }),
}) as unknown as ProcPlantAtlasCanvas;
const transparentDisjoint = {
  id: disjoint.id,
  width: disjoint.width,
  height: disjoint.height,
  rgba: new Uint8ClampedArray(disjoint.width * disjoint.height * 4),
};
createProcPlantCutoutAtlasCanvas(atlas, [raster, transparentDisjoint], fakeCanvasFactory);
assert.equal(alphaAt(pixels, atlas.width, ringEntry.x + 3, ringEntry.y + 2), 0, "atlas upload must preserve the hole");
assert.equal(alphaAt(pixels, atlas.width, ringEntry.x - ringEntry.padding, ringEntry.y - ringEntry.padding), 255);
const texture = createProcPlantCutoutAtlasTexture(atlas, [raster, transparentDisjoint], fakeCanvasFactory);
assert.equal(texture.userData.procplantCutoutAtlas.entries.find((entry: { id: string }) => entry.id === ring.id).topology[1].role, "hole");
texture.dispose();

console.log("ok 1 - deterministic disjoint-island tracing and topology");
console.log("ok 2 - hole topology and multi-contour triangulation");
console.log("ok 3 - atlas-space contours and UVs");
console.log("ok 4 - pivot, attachment, and sway metadata across every contour");
console.log("ok 5 - mip gutter dilation preserves internal holes");
console.log("1..5");
