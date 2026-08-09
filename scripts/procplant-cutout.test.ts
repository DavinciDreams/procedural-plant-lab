import assert from "node:assert/strict";
import {
  buildProcPlantCutoutGeometry,
  createProcPlantCutout,
  createProcPlantCutoutAtlasCanvas,
  createProcPlantCutoutAtlasTexture,
  dilateProcPlantCutoutRaster,
  packProcPlantCutoutAtlas,
  PROCPLANT_CUTOUT_SWAY_ATTRIBUTE,
  simplifyProcPlantCutoutContour,
  traceProcPlantAlphaMask,
  validateProcPlantCutoutContours,
  type ProcPlantAlphaMask,
  type ProcPlantAtlasCanvas,
  type ProcPlantCutoutMetadata,
} from "../src/procplant-cutout";

const maskFromRows = (rows: readonly string[]): ProcPlantAlphaMask => ({
  width: rows[0]!.length,
  height: rows.length,
  alpha: Uint8Array.from(rows.flatMap((row) => [...row].map((value) => value === "#" ? 255 : 0))),
});

const leafMask = maskFromRows([
  "...#....",
  "..###...",
  ".#####..",
  "#######.",
  ".#####..",
  "..###...",
  "...#....",
  "...#....",
]);

const squareMask = maskFromRows([
  "....",
  ".##.",
  ".##.",
  "....",
]);

const metadata: ProcPlantCutoutMetadata = {
  pivot: { x: 0.5, y: 0.125 },
  attachment: { x: 0.5, y: 0.125 },
  bendAxis: { origin: { x: 0.5, y: 0.125 }, direction: { x: 0, y: 1 } },
};

const firstTrace = traceProcPlantAlphaMask(leafMask, { threshold: 0.5, simplifyTolerance: 0.35 });
const secondTrace = traceProcPlantAlphaMask(leafMask, { threshold: 0.5, simplifyTolerance: 0.35 });
assert.deepEqual(firstTrace, secondTrace, "mask tracing must be deterministic");
assert.equal(firstTrace.length, 1);
assert.ok(firstTrace[0]!.length >= 4);
assert.deepEqual(
  traceProcPlantAlphaMask({ width: 1, height: 1, alpha: Uint8Array.of(100) }, { threshold: 0.5 }),
  [],
  "high threshold must reject a translucent pixel",
);
assert.equal(
  traceProcPlantAlphaMask({ width: 1, height: 1, alpha: Uint8Array.of(100) }, { threshold: 0.3 }).length,
  1,
  "lower threshold must include the same pixel",
);

const diagonalTouchMask = maskFromRows([
  "##..",
  ".##.",
]);
const diagonalTouchTrace = traceProcPlantAlphaMask(diagonalTouchMask, { simplifyTolerance: 100 });
assert.equal(diagonalTouchTrace.length, 1, "edge-connected pixels must remain one recovered silhouette");
assert.ok(diagonalTouchTrace[0]!.length >= 3, "aggressive simplification must retain a usable tiny contour");
assert.deepEqual(
  validateProcPlantCutoutContours(diagonalTouchTrace),
  [],
  "aggressively simplified tiny boundaries must remain valid simple contours",
);

const pointTouchMask = maskFromRows([
  "#.",
  ".#",
]);
const pointTouchTrace = traceProcPlantAlphaMask(pointTouchMask, { simplifyTolerance: 100 });
assert.equal(pointTouchTrace.length, 2, "point-touching pixels must recover as two simple islands");
assert.deepEqual(
  validateProcPlantCutoutContours(pointTouchTrace).filter((issue) => issue.code === "self-intersection"),
  [],
  "point-touch recovery must not emit self-intersecting figure-eight contours",
);
const pointTouchCutout = createProcPlantCutout("point-touch", pointTouchMask, undefined, { simplifyTolerance: 100 });
assert.deepEqual(pointTouchCutout.topology.map((entry) => entry.role), ["island", "island"]);
const pointTouchGeometry = buildProcPlantCutoutGeometry(pointTouchCutout);
try {
  assert.ok((pointTouchGeometry.index?.count ?? 0) >= 6, "both recovered islands must triangulate");
} finally {
  pointTouchGeometry.dispose();
}

const simplifiedRectangle = simplifyProcPlantCutoutContour([
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
  { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 1 },
], 0.01);
assert.deepEqual(simplifiedRectangle, [
  { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
]);

const leaf = createProcPlantCutout("leaf", leafMask, metadata, { simplifyTolerance: 0.35 });
const square = createProcPlantCutout("square", squareMask, undefined, { simplifyTolerance: 0.1 });
assert.deepEqual(leaf.metadata, metadata, "cutout creation must preserve authored attachment metadata");
assert.notStrictEqual(leaf.metadata, metadata, "cutout metadata must be copied");

const firstAtlas = packProcPlantCutoutAtlas([leaf, square], { padding: 2, powerOfTwo: true });
const secondAtlas = packProcPlantCutoutAtlas([square, leaf], { padding: 2, powerOfTwo: true });
assert.deepEqual(firstAtlas, secondAtlas, "atlas placement must not depend on input order");
assert.ok((firstAtlas.width & (firstAtlas.width - 1)) === 0, "atlas width must be power-of-two");
assert.ok((firstAtlas.height & (firstAtlas.height - 1)) === 0, "atlas height must be power-of-two");
for (const entry of firstAtlas.entries) {
  assert.ok(entry.x >= entry.padding && entry.y >= entry.padding);
  assert.ok(entry.uv.u0 >= 0 && entry.uv.v0 >= 0 && entry.uv.u1 <= 1 && entry.uv.v1 <= 1);
  assert.ok(entry.uv.u0 < entry.uv.u1 && entry.uv.v0 < entry.uv.v1);
  assert.ok(entry.atlasMetadata.attachment.x >= entry.uv.u0 && entry.atlasMetadata.attachment.x <= entry.uv.u1);
  assert.ok(entry.atlasMetadata.attachment.y >= entry.uv.v0 && entry.atlasMetadata.attachment.y <= entry.uv.v1);
}

const leafEntry = firstAtlas.entries.find((entry) => entry.id === leaf.id)!;
const geometry = buildProcPlantCutoutGeometry(leaf, { height: 2, atlasEntry: leafEntry });
try {
  assert.ok((geometry.index?.count ?? 0) >= 3, "cutout geometry must contain triangles");
  assert.equal(geometry.getAttribute("position").count, leaf.contour.length);
  assert.equal(geometry.getAttribute("uv").count, leaf.contour.length);
  assert.equal(geometry.getAttribute(PROCPLANT_CUTOUT_SWAY_ATTRIBUTE).count, leaf.contour.length);
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index++) {
    assert.ok(uv.getX(index) >= leafEntry.uv.u0 - 1e-7 && uv.getX(index) <= leafEntry.uv.u1 + 1e-7);
    assert.ok(uv.getY(index) >= leafEntry.uv.v0 - 1e-7 && uv.getY(index) <= leafEntry.uv.v1 + 1e-7);
  }
  assert.deepEqual(geometry.userData.procplantCutout.metadata, metadata);
  assert.deepEqual(geometry.userData.procplantCutout.attachmentPosition, [0, 0, 0]);
} finally {
  geometry.dispose();
}

const drawOrder: string[] = [];
const atlasPixels = new Uint8ClampedArray(firstAtlas.width * firstAtlas.height * 4);
const fakeCanvasFactory = (width: number, height: number) => ({
  width,
  height,
  getContext: () => ({
    clearRect: () => undefined,
    createImageData: (imageWidth: number, imageHeight: number) => ({
      width: imageWidth,
      height: imageHeight,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(imageWidth * imageHeight * 4),
    }),
    putImageData: (image: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number) => {
      drawOrder.push(`${x},${y}`);
      for (let row = 0; row < image.height; row++) {
        for (let column = 0; column < image.width; column++) {
          const sourceOffset = (row * image.width + column) * 4;
          const targetOffset = ((y + row) * width + x + column) * 4;
          atlasPixels.set(image.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
        }
      }
    },
  }),
}) as unknown as ProcPlantAtlasCanvas;
const rasters = firstAtlas.entries.map((entry, entryIndex) => {
  const rgba = new Uint8ClampedArray(entry.width * entry.height * 4);
  for (let y = 0; y < entry.height; y++) {
    for (let x = 0; x < entry.width; x++) {
      const offset = (y * entry.width + x) * 4;
      rgba.set([40 + entryIndex * 150, 20 + x * 7, 30 + y * 9, 96 + x + y], offset);
    }
  }
  return { id: entry.id, width: entry.width, height: entry.height, rgba };
});
const texel = (rgba: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
const firstDilated = dilateProcPlantCutoutRaster(rasters[0]!, firstAtlas.padding);
assert.deepEqual(texel(firstDilated.rgba, firstDilated.width, 0, 0), texel(rasters[0]!.rgba, rasters[0]!.width, 0, 0));
assert.deepEqual(
  texel(firstDilated.rgba, firstDilated.width, firstDilated.width - 1, firstDilated.height - 1),
  texel(rasters[0]!.rgba, rasters[0]!.width, rasters[0]!.width - 1, rasters[0]!.height - 1),
);
const canvas = createProcPlantCutoutAtlasCanvas(firstAtlas, rasters, fakeCanvasFactory);
assert.equal(canvas.width, firstAtlas.width);
assert.deepEqual(
  drawOrder,
  firstAtlas.entries.map((entry) => `${entry.x - entry.padding},${entry.y - entry.padding}`),
  "atlas drawing must follow deterministic placement order",
);
for (const entry of firstAtlas.entries) {
  const raster = rasters.find((candidate) => candidate.id === entry.id)!;
  const centerX = Math.floor(entry.width / 2);
  const centerY = Math.floor(entry.height / 2);
  const samples = [
    [entry.x - entry.padding, entry.y - entry.padding, 0, 0],
    [entry.x + centerX, entry.y - entry.padding, centerX, 0],
    [entry.x + entry.width + entry.padding - 1, entry.y - entry.padding, entry.width - 1, 0],
    [entry.x - entry.padding, entry.y + centerY, 0, centerY],
    [entry.x + entry.width + entry.padding - 1, entry.y + centerY, entry.width - 1, centerY],
    [entry.x - entry.padding, entry.y + entry.height + entry.padding - 1, 0, entry.height - 1],
    [entry.x + centerX, entry.y + entry.height + entry.padding - 1, centerX, entry.height - 1],
    [entry.x + entry.width + entry.padding - 1, entry.y + entry.height + entry.padding - 1, entry.width - 1, entry.height - 1],
    [entry.x + centerX, entry.y + centerY, centerX, centerY],
  ];
  for (const [atlasX, atlasY, sourceX, sourceY] of samples) {
    assert.deepEqual(
      texel(atlasPixels, firstAtlas.width, atlasX!, atlasY!),
      texel(raster.rgba, raster.width, sourceX!, sourceY!),
      `${entry.id} padding must clamp its own edge RGBA at ${atlasX},${atlasY}`,
    );
  }
}
const texture = createProcPlantCutoutAtlasTexture(firstAtlas, rasters, fakeCanvasFactory);
assert.equal(texture.userData.procplantCutoutAtlas.entries.length, firstAtlas.entries.length);
texture.dispose();

console.log("ok 1 - deterministic alpha tracing and thresholding");
console.log("ok 2 - deterministic contour simplification and metadata preservation");
console.log("ok 3 - deterministic padded atlas packing and UV metadata");
console.log("ok 4 - mip-safe edge-dilated atlas RGBA without neighbor bleed");
console.log("ok 5 - cutout geometry, sway, and atlas texture helpers");
console.log("ok 6 - aggressive tiny and point-touching boundaries recover as simple contours");
console.log("1..6");
