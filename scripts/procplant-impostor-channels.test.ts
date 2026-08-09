import assert from "node:assert/strict";
import {
  buildProcPlantImpostorAtlas,
  createProcPlantImpostorCapturePlan,
  type ProcPlantImpostorRaster,
} from "../src/procplant-impostor";
import {
  PROCPLANT_IMPOSTOR_CHANNELS,
  PROCPLANT_IMPOSTOR_CHANNEL_CONTRACT,
  PROCPLANT_IMPOSTOR_CHANNEL_SET_CONTRACT,
  buildProcPlantImpostorChannelSet,
  decodeProcPlantImpostorLinearDepth,
  decodeProcPlantImpostorNormal,
  denormalizeProcPlantImpostorViewDepth,
  encodeProcPlantImpostorLinearDepth,
  encodeProcPlantImpostorNormal,
  normalizeProcPlantImpostorViewDepth,
  selectProcPlantImpostorChannelView,
  type ProcPlantImpostorChannelCaptureRequest,
} from "../src/procplant-impostor-channels";
import { PROCPLANT_THREE_IMPOSTOR_CHANNEL_CAPTURE_STATUS } from "../src/procplant-impostor-three";

const bounds = { min: { x: -1, y: 0, z: -0.5 }, max: { x: 1, y: 4, z: 0.5 } };
const plan = createProcPlantImpostorCapturePlan(bounds, {
  width: 3,
  height: 2,
  azimuthCount: 2,
  elevations: [0],
  pivot: { x: 0, y: 1, z: 0 },
});
const planSnapshot = JSON.stringify(plan);
const seasons = [{ id: "winter", label: "Winter" }, { id: "summer", label: "Summer" }];
const seasonSnapshot = JSON.stringify(seasons);
const normalValue = { x: 0.3, y: -0.4, z: Math.sqrt(0.75) };
const normalBytes = encodeProcPlantImpostorNormal(normalValue);
const depthBytes = encodeProcPlantImpostorLinearDepth(0.25);

const texel = (rgba: ArrayLike<number>, width: number, x: number, y: number) =>
  Array.from({ length: 4 }, (_, channel) => rgba[(y * width + x) * 4 + channel]!);

const makeRaster = (request: ProcPlantImpostorChannelCaptureRequest): ProcPlantImpostorRaster => {
  const rgba = new Uint8ClampedArray(request.width * request.height * 4);
  if (request.channel.id === "color") {
    const seasonOffset = request.season.id === "summer" ? 10 : 20;
    for (let index = 0; index < rgba.length; index += 4) {
      rgba.set([seasonOffset + request.view.index, 40 + index / 4, 90, 255], index);
    }
  } else {
    const valid = request.channel.id === "normal" ? normalBytes : depthBytes;
    rgba.set(valid, 4);
  }
  return { id: request.view.id, width: request.width, height: request.height, rgba };
};

const captureOrder: string[] = [];
const returnedRasters: Array<{ raster: ProcPlantImpostorRaster; snapshot: number[] }> = [];
const channelSet = await buildProcPlantImpostorChannelSet(plan, async (request) => {
  await Promise.resolve();
  captureOrder.push(`${request.season.id}:${request.channel.id}:${request.view.id}`);
  const raster = makeRaster(request);
  returnedRasters.push({ raster, snapshot: Array.from(raster.rgba) });
  return raster;
}, {
  seasons,
  padding: 2,
  width: 14,
  powerOfTwo: false,
  maxSize: 64,
});

assert.equal(channelSet.contract, PROCPLANT_IMPOSTOR_CHANNEL_SET_CONTRACT);
assert.deepEqual(channelSet.seasons.map((season) => season.id), ["summer", "winter"]);
assert.deepEqual(channelSet.channels.map((channel) => channel.id), ["color", "normal", "depth"]);
assert.deepEqual(channelSet.layers.map((layer) => layer.id), [
  "summer:color", "summer:normal", "summer:depth",
  "winter:color", "winter:normal", "winter:depth",
]);
assert.deepEqual(captureOrder, channelSet.layers.flatMap((layer) =>
  plan.views.map((view) => `${layer.seasonId}:${layer.channelId}:${view.id}`)));
assert.equal(channelSet.viewArray.order, "season-channel-view");
assert.deepEqual(channelSet.viewArray.orderedViewIds, plan.views.map((view) => view.id));
assert.deepEqual(channelSet.viewArray.entries.map((entry) => `${entry.arrayIndex}:${entry.seasonId}:${entry.channelId}:${entry.viewId}`),
  captureOrder.map((capture, arrayIndex) => `${arrayIndex}:${capture}`));
assert.equal(channelSet.audit.captureCalls, 12);
assert.equal(channelSet.audit.perChannelViewBytes, 3 * 2 * 4);
assert.equal(channelSet.audit.perViewBytes, 3 * 2 * 4 * 3);
assert.equal(channelSet.audit.totalAtlasBytes, 14 * 6 * 4 * 6);
assert.equal(JSON.stringify(plan), planSnapshot, "building must not mutate the capture plan");
assert.equal(JSON.stringify(seasons), seasonSnapshot, "season canonicalization must not mutate caller input");
for (const returned of returnedRasters) assert.deepEqual(Array.from(returned.raster.rgba), returned.snapshot);
console.log("ok 1 - deterministic season/channel/view ordering and nonmutation");

const reference = channelSet.layers[0]!.atlas;
for (const layer of channelSet.layers.slice(1)) {
  assert.equal(layer.atlas.width, reference.width);
  assert.equal(layer.atlas.height, reference.height);
  assert.equal(layer.atlas.padding, reference.padding);
  assert.deepEqual(layer.atlas.entries.map((entry) => ({ id: entry.id, uv: entry.uv, paddedUv: entry.paddedUv })),
    reference.entries.map((entry) => ({ id: entry.id, uv: entry.uv, paddedUv: entry.paddedUv })));
}
const summerSelection = selectProcPlantImpostorChannelView(channelSet, "summer", { x: 1, y: 0, z: 0 });
const winterSelection = selectProcPlantImpostorChannelView(channelSet, "winter", { x: 1, y: 0, z: 0 });
assert.equal(summerSelection.viewId, winterSelection.viewId);
assert.ok(summerSelection.samples.every((sample) =>
  JSON.stringify(sample.uv) === JSON.stringify(summerSelection.samples[0]!.uv) &&
  JSON.stringify(sample.paddedUv) === JSON.stringify(summerSelection.samples[0]!.paddedUv)));
assert.deepEqual(summerSelection.samples.map((sample) => sample.channelId), ["color", "normal", "depth"]);
assert.deepEqual(summerSelection.samples.map((sample) => sample.arrayIndex),
  summerSelection.samples.map((sample) => sample.layerIndex * plan.views.length + summerSelection.viewIndex));
assert.throws(() => selectProcPlantImpostorChannelView(channelSet, "spring", { x: 1, y: 0, z: 0 }), /not found or incomplete/);
console.log("ok 2 - aligned layouts and seasonal selection UVs");

const normalLayer = channelSet.layers.find((layer) => layer.id === "summer:normal")!;
const depthLayer = channelSet.layers.find((layer) => layer.id === "summer:depth")!;
const normalEntry = normalLayer.atlas.entries[0]!;
const depthEntry = depthLayer.atlas.entries[0]!;
const normalGutter = texel(normalLayer.atlas.rgba, normalLayer.atlas.width, normalEntry.x - 2, normalEntry.y - 2);
const depthGutter = texel(depthLayer.atlas.rgba, depthLayer.atlas.width, depthEntry.x - 2, depthEntry.y - 2);
assert.equal(normalGutter[3], 255, "normal mip gutter must copy the nearest valid texel");
assert.equal(depthGutter[3], 255, "depth mip gutter must copy the nearest valid texel");
const decodedGutterNormal = decodeProcPlantImpostorNormal(normalGutter);
assert.ok(Math.abs(Math.hypot(decodedGutterNormal.x, decodedGutterNormal.y, decodedGutterNormal.z) - 1) < 1e-12);
assert.ok(decodedGutterNormal.x * normalValue.x + decodedGutterNormal.y * normalValue.y + decodedGutterNormal.z * normalValue.z > 0.9999);
assert.ok(Math.abs(decodeProcPlantImpostorLinearDepth(depthGutter) - 0.25) <= 1 / 0xffffff);
assert.equal(texel(normalLayer.atlas.rgba, normalLayer.atlas.width, normalEntry.x, normalEntry.y)[3], 0,
  "dilation must preserve transparent interior texels");
assert.deepEqual(texel(normalLayer.atlas.rgba, normalLayer.atlas.width, normalEntry.x, normalEntry.y).slice(0, 3), [128, 128, 255]);
assert.deepEqual(texel(depthLayer.atlas.rgba, depthLayer.atlas.width, depthEntry.x, depthEntry.y).slice(0, 3), [255, 255, 255]);
console.log("ok 3 - channel-aware mip gutters preserve normalized normals and nearest depth");

const decodedNormal = decodeProcPlantImpostorNormal(encodeProcPlantImpostorNormal(normalValue));
assert.ok(decodedNormal.x * normalValue.x + decodedNormal.y * normalValue.y + decodedNormal.z * normalValue.z > 0.9999);
const firstView = plan.views[0]!;
assert.equal(normalizeProcPlantImpostorViewDepth(firstView, firstView.projection.maxDepth), 0);
assert.equal(normalizeProcPlantImpostorViewDepth(firstView, firstView.projection.minDepth), 1);
const midpoint = (firstView.projection.maxDepth + firstView.projection.minDepth) / 2;
assert.ok(Math.abs(normalizeProcPlantImpostorViewDepth(firstView, midpoint) - 0.5) < 1e-12);
assert.ok(Math.abs(denormalizeProcPlantImpostorViewDepth(firstView, 0.5) - midpoint) < 1e-12);
for (const depth of [0, 0.125, 0.5, 0.875, 1]) {
  assert.ok(Math.abs(decodeProcPlantImpostorLinearDepth(encodeProcPlantImpostorLinearDepth(depth)) - depth) <= 1 / 0xffffff);
}
assert.equal(PROCPLANT_IMPOSTOR_CHANNELS.normal.convention.z, "+plant-to-camera view.outward");
assert.match(String(PROCPLANT_IMPOSTOR_CHANNELS.depth.convention.formula), /maxDepth/);
console.log("ok 4 - normal convention and bounded linear-depth encoding are accurate");

const legacyOptions = { padding: 2, width: 14, powerOfTwo: false, maxSize: 64 };
const legacyAtlas = await buildProcPlantImpostorAtlas(plan, async ({ view, width, height }) =>
  makeRaster({
    plan,
    view,
    season: { id: "summer" },
    channel: PROCPLANT_IMPOSTOR_CHANNELS.color,
    width,
    height,
  }), legacyOptions);
const colorOnly = await buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), {
  seasons: [{ id: "summer" }],
  channels: ["color"],
  ...legacyOptions,
});
const colorLayer = colorOnly.layers[0]!;
assert.deepEqual(colorLayer.atlas.rgba, legacyAtlas.rgba);
assert.equal(colorLayer.atlas.contentHash, legacyAtlas.contentHash);
assert.equal(colorLayer.legacyAtlasHash, legacyAtlas.contentHash);
assert.notEqual(colorLayer.contentHash, colorLayer.legacyAtlasHash, "wrapper hash must include channel metadata");
console.log("ok 5 - color-only bytes and legacy hash are exact");

const onePixelPlan = createProcPlantImpostorCapturePlan(bounds, { width: 1, height: 1, azimuthCount: 1, elevations: [0] });
const metadataSet = await buildProcPlantImpostorChannelSet(onePixelPlan, async ({ view }) => ({
  id: view.id,
  width: 1,
  height: 1,
  rgba: new Uint8ClampedArray([128, 128, 255, 255]),
}), { seasons: [{ id: "same" }], channels: ["depth", "normal"], padding: 1, powerOfTwo: false, maxSize: 8 });
assert.deepEqual(metadataSet.layers[0]!.atlas.rgba, metadataSet.layers[1]!.atlas.rgba,
  "test fixture must isolate metadata from pixel differences");
assert.notEqual(metadataSet.layers[0]!.contentHash, metadataSet.layers[1]!.contentHash,
  "channel metadata must participate in the deterministic hash");
const seasonHashSet = await buildProcPlantImpostorChannelSet(onePixelPlan, async ({ view }) => ({
  id: view.id, width: 1, height: 1, rgba: new Uint8ClampedArray([1, 2, 3, 255]),
}), { seasons: [{ id: "b" }, { id: "a" }], channels: ["color"], padding: 0, powerOfTwo: false, maxSize: 8 });
assert.notEqual(seasonHashSet.layers[0]!.contentHash, seasonHashSet.layers[1]!.contentHash,
  "season metadata must participate in the deterministic hash");
for (const layer of channelSet.layers) {
  assert.equal(layer.embeddedImage.sourcePayload, "raw");
  assert.equal(layer.embeddedImage.glb.requiresEncoding, true);
  assert.equal(layer.embeddedImage.glb.recommendedMimeType, "image/png");
  assert.equal(layer.embeddedImage.extras.contentHash, layer.contentHash);
}
console.log("ok 6 - hashes include channel/season metadata and GLB image intent is explicit");

await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), { maxViews: 1 }), /maxViews/);
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), { seasons, maxSeasons: 1 }), /maxSeasons/);
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), { maxCaptureDimension: 2 }), /maxCaptureDimension/);
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), { maxBytes: 1 }), /maxBytes/);
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), { maxSize: 8193 }), /maxSize/);
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), { seasons: [] }), /must not be empty/);
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), { channels: [] }), /must not be empty/);
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), { seasons: [{ id: "same" }, { id: "same" }] }), /duplicate/);
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => makeRaster(request), { channels: ["color", "color"] }), /unique/);
console.log("ok 7 - hard resource and identity caps reject invalid work before capture");

const preAborted = new AbortController();
preAborted.abort();
let preAbortCalls = 0;
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => {
  preAbortCalls++;
  return makeRaster(request);
}, { signal: preAborted.signal }), (error: unknown) => error instanceof DOMException && error.name === "AbortError");
assert.equal(preAbortCalls, 0);
const midAbort = new AbortController();
let midAbortCalls = 0;
await assert.rejects(buildProcPlantImpostorChannelSet(plan, async (request) => {
  midAbortCalls++;
  midAbort.abort();
  return makeRaster(request);
}, { signal: midAbort.signal }), (error: unknown) => error instanceof DOMException && error.name === "AbortError");
assert.equal(midAbortCalls, 1);
console.log("ok 8 - injected async capture preserves abort identity and deterministic stop order");

assert.equal(PROCPLANT_IMPOSTOR_CHANNELS.color.contract, PROCPLANT_IMPOSTOR_CHANNEL_CONTRACT);
assert.equal(PROCPLANT_THREE_IMPOSTOR_CHANNEL_CAPTURE_STATUS.color, "implemented");
assert.equal(PROCPLANT_THREE_IMPOSTOR_CHANNEL_CAPTURE_STATUS.normal, "implemented-alpha-aware-view-space");
assert.equal(PROCPLANT_THREE_IMPOSTOR_CHANNEL_CAPTURE_STATUS.depth, "implemented-alpha-aware-linear-rgb24");
assert.equal(PROCPLANT_THREE_IMPOSTOR_CHANNEL_CAPTURE_STATUS.runtimeVerification, "not-yet-browser-gpu-verified");
console.log("ok 9 - Three live capture status distinguishes implementation from browser/GPU verification");
