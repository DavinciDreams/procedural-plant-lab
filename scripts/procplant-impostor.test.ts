import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildProcPlantImpostorAtlas,
  buildProcPlantImpostorGeometry,
  createProcPlantImpostorAtlasTexture,
  createProcPlantImpostorCapturePlan,
  dilateProcPlantImpostorRaster,
  flipProcPlantImpostorRgbaRows,
  selectProcPlantImpostorView,
  updateProcPlantImpostorGeometryView,
  type ProcPlantImpostorCapture,
  type ProcPlantImpostorRaster,
} from "../src/procplant-impostor";

const bounds = {
  min: { x: -2, y: 0, z: -1 },
  max: { x: 2, y: 6, z: 1 },
};
const planOptions = {
  width: 4,
  height: 3,
  azimuthCount: 4,
  azimuthOffset: 0,
  elevations: [0.4, -0.2],
  pivot: { x: 0, y: 1, z: 0 },
};
const firstPlan = createProcPlantImpostorCapturePlan(bounds, planOptions);
const secondPlan = createProcPlantImpostorCapturePlan(bounds, planOptions);
assert.deepEqual(firstPlan, secondPlan, "capture plans must be byte-stable for the same inputs");
assert.deepEqual(firstPlan.views.map((view) => view.id), [
  "e00-a00", "e00-a01", "e00-a02", "e00-a03",
  "e01-a00", "e01-a01", "e01-a02", "e01-a03",
]);
assert.ok(firstPlan.views.slice(0, 4).every((view) => view.elevation === -0.2));
assert.ok(firstPlan.views.slice(4).every((view) => view.elevation === 0.4));
for (const view of firstPlan.views) {
  const length = (value: { x: number; y: number; z: number }) => Math.hypot(value.x, value.y, value.z);
  const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    a.x * b.x + a.y * b.y + a.z * b.z;
  assert.ok(Math.abs(length(view.outward) - 1) < 1e-12);
  assert.ok(Math.abs(length(view.camera.right) - 1) < 1e-12);
  assert.ok(Math.abs(length(view.camera.up) - 1) < 1e-12);
  assert.ok(Math.abs(dot(view.camera.right, view.camera.up)) < 1e-12);
  assert.ok(Math.abs(dot(view.camera.right, view.camera.forward)) < 1e-12);
  assert.ok(view.projectedWidth > 0 && view.projectedHeight > 0);
  assert.ok(view.projectedPivot.u >= 0 && view.projectedPivot.u <= 1);
  assert.ok(view.projectedPivot.v >= 0 && view.projectedPivot.v <= 1);
  assert.ok(view.projection.far > view.projection.near);
}

const makeRaster = (id: string, index: number, offset = 0): ProcPlantImpostorRaster => {
  const rgba = new Uint8ClampedArray(firstPlan.width * firstPlan.height * 4);
  for (let y = 0; y < firstPlan.height; y++) {
    for (let x = 0; x < firstPlan.width; x++) {
      const pixel = (y * firstPlan.width + x) * 4;
      rgba.set([
        20 + index * 20 + offset,
        30 + x * 7,
        40 + y * 11,
        100 + index + x + y,
      ], pixel);
    }
  }
  return { id, width: firstPlan.width, height: firstPlan.height, rgba };
};

const captureOrder: string[] = [];
const capture: ProcPlantImpostorCapture = async ({ view }) => {
  captureOrder.push(view.id);
  return makeRaster(view.id, view.index);
};
const atlasOptions = { padding: 1, width: 12, powerOfTwo: false, maxSize: 64 };
const firstAtlas = await buildProcPlantImpostorAtlas(firstPlan, capture, atlasOptions);
const secondCaptureOrder: string[] = [];
const secondAtlas = await buildProcPlantImpostorAtlas(secondPlan, async ({ view }) => {
  secondCaptureOrder.push(view.id);
  return makeRaster(view.id, view.index);
}, atlasOptions);
assert.deepEqual(captureOrder, firstPlan.views.map((view) => view.id), "capture callback order must follow the plan");
assert.deepEqual(secondCaptureOrder, captureOrder);
assert.deepEqual(firstAtlas.entries.map((entry) => entry.id), captureOrder);
assert.deepEqual(firstAtlas.rgba, secondAtlas.rgba, "atlas pixels must be deterministic");
assert.equal(firstAtlas.contentHash, secondAtlas.contentHash, "atlas hashes must be deterministic");
assert.match(firstAtlas.contentHash, /^fnv1a32-[0-9a-f]{8}$/);

const texel = (rgba: ArrayLike<number>, width: number, x: number, y: number) =>
  Array.from({ length: 4 }, (_, channel) => rgba[(y * width + x) * 4 + channel]);
for (const entry of firstAtlas.entries) {
  const source = makeRaster(entry.id, entry.index);
  const samples = [
    [entry.x - entry.padding, entry.y - entry.padding, 0, 0],
    [entry.x + entry.width + entry.padding - 1, entry.y - entry.padding, source.width - 1, 0],
    [entry.x - entry.padding, entry.y + entry.height + entry.padding - 1, 0, source.height - 1],
    [entry.x + entry.width + entry.padding - 1, entry.y + entry.height + entry.padding - 1, source.width - 1, source.height - 1],
    [entry.x + 2, entry.y + 1, 2, 1],
  ] as const;
  for (const [atlasX, atlasY, sourceX, sourceY] of samples) {
    assert.deepEqual(
      texel(firstAtlas.rgba, firstAtlas.width, atlasX, atlasY),
      texel(source.rgba, source.width, sourceX, sourceY),
      `${entry.id} must contain its own captured RGBA at ${atlasX},${atlasY}`,
    );
  }
  assert.ok(entry.uv.u0 < entry.uv.u1 && entry.uv.v0 < entry.uv.v1);
  assert.ok(entry.paddedUv.u0 <= entry.uv.u0 && entry.paddedUv.u1 >= entry.uv.u1);
  assert.ok(entry.paddedUv.v0 <= entry.uv.v0 && entry.paddedUv.v1 >= entry.uv.v1);
}
const changedAtlas = await buildProcPlantImpostorAtlas(firstPlan, async ({ view }) =>
  makeRaster(view.id, view.index, view.index === 3 ? 1 : 0), atlasOptions);
assert.notEqual(changedAtlas.contentHash, firstAtlas.contentHash, "captured pixels must contribute to the content hash");
assert.notDeepEqual(changedAtlas.rgba, firstAtlas.rgba, "atlas output must contain captured view rasters");

const firstView = firstAtlas.entries[0]!;
assert.equal(selectProcPlantImpostorView(firstAtlas, firstView.view.outward).entry.id, firstView.id);
assert.ok(Math.abs(selectProcPlantImpostorView(firstAtlas, firstView.view.outward).score - 1) < 1e-12);
const billboard = buildProcPlantImpostorGeometry(firstAtlas, { viewId: firstView.id });
try {
  assert.equal(billboard.getAttribute("position").count, 4);
  assert.equal(billboard.index?.count, 6);
  assert.equal(billboard.getAttribute("uv").count, 4);
  assert.equal(billboard.getAttribute("impostorUv").count, 4);
  assert.deepEqual(billboard.userData.procplantImpostor.pivotPosition, [0, 0, 0]);
  assert.deepEqual(billboard.userData.procplantImpostor.selection.orderedViewIds, captureOrder);
  const uv = billboard.getAttribute("uv");
  for (let index = 0; index < uv.count; index++) {
    assert.ok(uv.getX(index) >= firstView.uv.u0 - 1e-7 && uv.getX(index) <= firstView.uv.u1 + 1e-7);
    assert.ok(uv.getY(index) >= firstView.uv.v0 - 1e-7 && uv.getY(index) <= firstView.uv.v1 + 1e-7);
  }
  const position = billboard.getAttribute("position");
  const xs = Array.from({ length: position.count }, (_, index) => position.getX(index));
  const ys = Array.from({ length: position.count }, (_, index) => position.getY(index));
  assert.ok(Math.min(...xs) <= 0 && Math.max(...xs) >= 0, "pivot must lie inside billboard X bounds");
  assert.ok(Math.min(...ys) <= 0 && Math.max(...ys) >= 0, "pivot must lie inside billboard Y bounds");
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - firstView.view.projectedWidth) < 1e-6);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - firstView.view.projectedHeight) < 1e-6);
  const alternateView = firstAtlas.entries[3]!;
  const positionBefore = Array.from(position.array);
  assert.equal(updateProcPlantImpostorGeometryView(billboard, firstAtlas, alternateView.id).id, alternateView.id);
  assert.deepEqual(Array.from(position.array), positionBefore, "view changes must preserve billboard topology");
  assert.equal(billboard.userData.procplantImpostor.viewId, alternateView.id);
  for (let index = 0; index < uv.count; index++) {
    assert.ok(uv.getX(index) >= alternateView.uv.u0 - 1e-7 && uv.getX(index) <= alternateView.uv.u1 + 1e-7);
    assert.ok(uv.getY(index) >= alternateView.uv.v0 - 1e-7 && uv.getY(index) <= alternateView.uv.v1 + 1e-7);
  }
} finally {
  billboard.dispose();
}
const crossed = buildProcPlantImpostorGeometry(firstAtlas, { mode: "cross", scale: 0.5 });
try {
  assert.equal(crossed.getAttribute("position").count, 8);
  assert.equal(crossed.index?.count, 12);
  assert.deepEqual(Array.from(crossed.getAttribute("impostorCard").array), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.ok(crossed.boundingBox !== null && crossed.boundingSphere !== null);
} finally {
  crossed.dispose();
}
const texture = createProcPlantImpostorAtlasTexture(firstAtlas);
assert.equal(texture.image.width, firstAtlas.width);
assert.equal(texture.image.height, firstAtlas.height);
assert.equal(texture.flipY, true);
assert.equal(texture.userData.procplantImpostor.contentHash, firstAtlas.contentHash);
texture.dispose();

const tiny = dilateProcPlantImpostorRaster({
  id: "tiny",
  width: 1,
  height: 1,
  rgba: Uint8ClampedArray.of(1, 2, 3, 4),
}, 2);
assert.equal(tiny.width, 5);
assert.equal(tiny.height, 5);
for (let y = 0; y < tiny.height; y++) {
  for (let x = 0; x < tiny.width; x++) assert.deepEqual(texel(tiny.rgba, tiny.width, x, y), [1, 2, 3, 4]);
}
const bottomLeftReadback = Uint8Array.of(
  1, 2, 3, 4, 5, 6, 7, 8,
  9, 10, 11, 12, 13, 14, 15, 16,
);
assert.deepEqual(Array.from(flipProcPlantImpostorRgbaRows(bottomLeftReadback, 2, 2)), [
  9, 10, 11, 12, 13, 14, 15, 16,
  1, 2, 3, 4, 5, 6, 7, 8,
]);
assert.deepEqual(Array.from(bottomLeftReadback), [
  1, 2, 3, 4, 5, 6, 7, 8,
  9, 10, 11, 12, 13, 14, 15, 16,
], "row flipping must not mutate WebGL readback bytes");

assert.throws(() => createProcPlantImpostorCapturePlan({
  min: { x: 0, y: 0, z: 0 },
  max: { x: 0, y: 1, z: 1 },
}), /positive size/);
assert.throws(() => createProcPlantImpostorCapturePlan(bounds, { elevations: [0, 0] }), /unique/);
assert.throws(() => dilateProcPlantImpostorRaster({ width: 2, height: 2, rgba: new Uint8Array(2) }, 1), /RGBA/);
await assert.rejects(
  buildProcPlantImpostorAtlas(firstPlan, async ({ view }) => ({ ...makeRaster(view.id, view.index), width: 2 }), atlasOptions),
  /dimensions do not match/,
);
await assert.rejects(
  buildProcPlantImpostorAtlas(firstPlan, async ({ view }) => {
    if (view.index === 2) throw new Error("renderer lost");
    return makeRaster(view.id, view.index);
  }, atlasOptions),
  /failed for e00-a02: renderer lost/,
);
const controller = new AbortController();
controller.abort();
await assert.rejects(
  buildProcPlantImpostorAtlas(firstPlan, capture, { ...atlasOptions, signal: controller.signal }),
  (error: unknown) => error instanceof DOMException && error.name === "AbortError",
);
assert.throws(() => selectProcPlantImpostorView(firstAtlas, { x: 0, y: 0, z: 0 }), /non-zero/);
assert.throws(() => buildProcPlantImpostorGeometry(firstAtlas, { viewId: "missing" }), /not found/);
assert.throws(() => flipProcPlantImpostorRgbaRows(new Uint8Array(3), 1, 1), /RGBA/);
assert.throws(() => updateProcPlantImpostorGeometryView(new THREE.BufferGeometry(), firstAtlas, firstView.id), /attributes/);

console.log("ok 1 - deterministic multi-azimuth and elevation capture plan");
console.log("ok 2 - injected async capture composes stable hashed RGBA output");
console.log("ok 3 - isolated mip-safe dilation prevents neighboring-view bleed");
console.log("ok 4 - atlas UV, pivot, bounds, billboard, and cross-card metadata");
console.log("ok 5 - deterministic view selection, texture upload contract, and errors");
console.log("ok 6 - WebGL readback row flip and allocation-stable live UV switching");
console.log("1..6");
