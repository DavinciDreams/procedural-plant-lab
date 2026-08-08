import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import * as THREE from "three";
import { createProcPlantImpostorCapturePlan } from "../src/procplant-impostor";
import {
  PROCPLANT_IMPOSTOR_CHANNELS,
  buildProcPlantImpostorChannelSet,
} from "../src/procplant-impostor-channels";
import {
  encodeProcPlantImpostorChannelImages,
  encodeProcPlantImpostorPng,
  exportProcPlantImpostorChannelSetGlb,
} from "../src/procplant-impostor-image";
import {
  bakeProcPlantThreeImpostor,
  bakeProcPlantThreeImpostorChannels,
  createProcPlantThreeImpostorChannelRenderPackage,
  createProcPlantThreeImpostorOverrideMaterial,
  exportProcPlantThreeImpostorChannelGlb,
} from "../src/procplant-impostor-three";

const alphaMap = new THREE.DataTexture(new Uint8Array([255, 96, 255, 255]), 1, 1, THREE.RGBAFormat);
const colorMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 128]), 1, 1, THREE.RGBAFormat);
const normalMap = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
const sourceMaterial = new THREE.MeshStandardMaterial({
  map: colorMap,
  alphaMap,
  alphaTest: 0.42,
  opacity: 0.75,
  transparent: true,
  side: THREE.DoubleSide,
  normalMap,
});
const sourceSnapshot = {
  map: sourceMaterial.map,
  alphaMap: sourceMaterial.alphaMap,
  normalMap: sourceMaterial.normalMap,
  alphaTest: sourceMaterial.alphaTest,
  opacity: sourceMaterial.opacity,
  transparent: sourceMaterial.transparent,
  side: sourceMaterial.side,
};
const normalPass = createProcPlantThreeImpostorOverrideMaterial(sourceMaterial, "normal", 0.1);
const normalMaterial = normalPass.material as THREE.MeshNormalMaterial & {
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
};
assert.equal(normalMaterial.map, colorMap);
assert.equal(normalMaterial.alphaMap, alphaMap);
assert.equal(normalMaterial.normalMap, normalMap);
assert.equal(normalMaterial.alphaTest, 0.42);
assert.equal(normalMaterial.opacity, 0.75);
assert.equal(normalMaterial.side, THREE.DoubleSide);
assert.equal(normalMaterial.transparent, false);
assert.equal(normalMaterial.blending, THREE.NoBlending);
const normalShader = {
  uniforms: {},
  vertexShader: "",
  fragmentShader: "#include <uv_pars_fragment>\nvec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );",
} as Parameters<NonNullable<typeof normalMaterial.onBeforeCompile>>[0];
normalMaterial.onBeforeCompile(normalShader, {} as THREE.WebGLRenderer);
assert.match(normalShader.fragmentShader, /map_pars_fragment/);
assert.match(normalShader.fragmentShader, /alphamap_fragment/);
assert.match(normalShader.fragmentShader, /alphatest_fragment/);
assert.deepEqual(sourceSnapshot, {
  map: sourceMaterial.map,
  alphaMap: sourceMaterial.alphaMap,
  normalMap: sourceMaterial.normalMap,
  alphaTest: sourceMaterial.alphaTest,
  opacity: sourceMaterial.opacity,
  transparent: sourceMaterial.transparent,
  side: sourceMaterial.side,
});
normalPass.dispose();
console.log("ok 1 - alpha-aware normal override preserves source maps and material state");

const plan = createProcPlantImpostorCapturePlan(
  { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 3, z: 1 } },
  { width: 2, height: 2, azimuthCount: 1, elevations: [0] },
);
const depthPass = createProcPlantThreeImpostorOverrideMaterial(sourceMaterial, "depth", 0.5);
const depthMaterial = depthPass.material as THREE.MeshDepthMaterial & {
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
};
assert.equal(depthMaterial.depthPacking, THREE.RGBDepthPacking);
assert.equal(depthMaterial.map, colorMap);
assert.equal(depthMaterial.alphaMap, alphaMap);
assert.equal(depthMaterial.alphaTest, 0.5);
const view = plan.views[0]!;
depthPass.updateView(view);
const depthShader = {
  uniforms: {},
  vertexShader: "",
  fragmentShader: "gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );",
} as Parameters<NonNullable<typeof depthMaterial.onBeforeCompile>>[0];
depthMaterial.onBeforeCompile(depthShader, {} as THREE.WebGLRenderer);
assert.match(depthShader.fragmentShader, /procplantLinearDepth/);
assert.match(depthShader.fragmentShader, /diffuseColor\.a/);
const scale = (depthShader.uniforms.procplantDepthScale as { value: number }).value;
const offset = (depthShader.uniforms.procplantDepthOffset as { value: number }).value;
const distance = Math.hypot(
  view.camera.position.x - view.camera.target.x,
  view.camera.position.y - view.camera.target.y,
  view.camera.position.z - view.camera.target.z,
);
const cameraRange = view.projection.far - view.projection.near;
const frontFragDepth = (distance - view.projection.maxDepth - view.projection.near) / cameraRange;
const rearFragDepth = (distance - view.projection.minDepth - view.projection.near) / cameraRange;
assert.ok(Math.abs(frontFragDepth * scale + offset) < 1e-12);
assert.ok(Math.abs(rearFragDepth * scale + offset - 1) < 1e-12);
depthPass.dispose();
console.log("ok 2 - RGB24 depth shader remaps exact view bounds and retains alpha cutoff");

const parsePng = (bytes: Uint8Array) => {
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset, false);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part))));
};
const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 64, 1, 2, 3, 4]);
const pngA = encodeProcPlantImpostorPng(rgba, 2, 2);
const pngB = encodeProcPlantImpostorPng(new Uint8Array(rgba), 2, 2);
assert.deepEqual(pngA, pngB);
assert.deepEqual(Array.from(parsePng(pngA)), [0, ...rgba.slice(0, 8), 0, ...rgba.slice(8)]);
assert.throws(() => encodeProcPlantImpostorPng(rgba, 4, 4), /exactly/);
console.log("ok 3 - pure PNG encoding is deterministic and scanline-lossless");

const imageSet = await buildProcPlantImpostorChannelSet(plan, async ({ view, season, channel, width, height }) => {
  const bytes = new Uint8ClampedArray(width * height * 4);
  const channelValue = channel.id === "color" ? 20 : channel.id === "normal" ? 128 : 64;
  const seasonValue = season.id === "summer" ? 10 : 30;
  for (let offset = 0; offset < bytes.length; offset += 4) bytes.set([channelValue, seasonValue, 255, 255], offset);
  return { id: view.id, width, height, rgba: bytes };
}, {
  seasons: [{ id: "winter" }, { id: "summer" }],
  padding: 1,
  powerOfTwo: false,
  maxSize: 16,
});
const encodedImages = encodeProcPlantImpostorChannelImages(imageSet);
assert.deepEqual(encodedImages.map((image) => image.layerId), imageSet.layers.map((layer) => layer.id));
const glbA = exportProcPlantImpostorChannelSetGlb(imageSet, "seasonal-atlas");
const glbB = exportProcPlantImpostorChannelSetGlb(imageSet, "seasonal-atlas");
assert.deepEqual(new Uint8Array(glbA), new Uint8Array(glbB));
const glbView = new DataView(glbA);
assert.equal(glbView.getUint32(0, true), 0x46546c67);
assert.equal(glbView.getUint32(4, true), 2);
assert.equal(glbView.getUint32(8, true), glbA.byteLength);
const jsonLength = glbView.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glbA, 20, jsonLength)).trim());
assert.deepEqual(json.images.map((image: { name: string }) => image.name), imageSet.layers.map((layer) => layer.id));
assert.deepEqual(json.scenes[0].extras.procplantImpostorChannels.layers.map((layer: { image: number }) => layer.image), [0, 1, 2, 3, 4, 5]);
assert.ok(json.bufferViews.every((bufferView: { byteOffset: number }) => bufferView.byteOffset % 4 === 0));
const binaryStart = 20 + jsonLength + 8;
for (const bufferView of json.bufferViews as Array<{ byteOffset: number; byteLength: number }>) {
  const image = new Uint8Array(glbA, binaryStart + bufferView.byteOffset, bufferView.byteLength);
  assert.deepEqual(Array.from(image.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
}
console.log("ok 4 - seasonal channel GLB embeds aligned deterministic PNG bufferViews");

class FakeRenderer {
  capabilities = { maxSamples: 0, maxTextureSize: 64 };
  xr = { enabled: true };
  autoClear = false;
  private target: THREE.WebGLRenderTarget | null = null;
  private cubeFace = 3;
  private mipmapLevel = 2;
  private viewport = new THREE.Vector4(5, 6, 7, 8);
  private scissor = new THREE.Vector4(9, 10, 11, 12);
  private scissorTest = true;
  private clearColor = new THREE.Color(0.1, 0.2, 0.3);
  private clearAlpha = 0.4;
  private readback = [10, 20, 30, 255];
  throwOnDepth = false;

  getRenderTarget() { return this.target; }
  getActiveCubeFace() { return this.cubeFace; }
  getActiveMipmapLevel() { return this.mipmapLevel; }
  getViewport(target: THREE.Vector4) { return target.copy(this.viewport); }
  getScissor(target: THREE.Vector4) { return target.copy(this.scissor); }
  getScissorTest() { return this.scissorTest; }
  getClearColor(target: THREE.Color) { return target.copy(this.clearColor); }
  getClearAlpha() { return this.clearAlpha; }
  setRenderTarget(target: THREE.WebGLRenderTarget | null, face = 0, level = 0) {
    this.target = target;
    this.cubeFace = face;
    this.mipmapLevel = level;
  }
  setViewport(value: THREE.Vector4) { this.viewport.copy(value); }
  setScissor(value: THREE.Vector4) { this.scissor.copy(value); }
  setScissorTest(value: boolean) { this.scissorTest = value; }
  setClearColor(value: THREE.ColorRepresentation, alpha = 1) {
    this.clearColor.set(value);
    this.clearAlpha = alpha;
  }
  clear() {}
  render(scene: THREE.Scene) {
    let material: THREE.Material | undefined;
    scene.traverseVisible((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    });
    if ((material as THREE.MeshNormalMaterial | undefined)?.isMeshNormalMaterial) this.readback = [128, 128, 255, 255];
    else if ((material as THREE.MeshDepthMaterial | undefined)?.isMeshDepthMaterial) {
      if (this.throwOnDepth) throw new Error("injected depth render failure");
      this.readback = [64, 0, 0, 255];
    } else this.readback = [10, 20, 30, 255];
  }
  readRenderTargetPixels(_target: THREE.WebGLRenderTarget, _x: number, _y: number, width: number, height: number, bytes: Uint8Array) {
    for (let offset = 0; offset < width * height * 4; offset += 4) bytes.set(this.readback, offset);
  }
  snapshot() {
    return {
      target: this.target,
      cubeFace: this.cubeFace,
      mipmapLevel: this.mipmapLevel,
      viewport: this.viewport.toArray(),
      scissor: this.scissor.toArray(),
      scissorTest: this.scissorTest,
      clearColor: this.clearColor.toArray(),
      clearAlpha: this.clearAlpha,
      autoClear: this.autoClear,
      xrEnabled: this.xr.enabled,
    };
  }
}

const source = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), sourceMaterial);
source.position.set(1, 0, -2);
const renderer = new FakeRenderer();
const rendererBefore = renderer.snapshot();
const originalMaterial = source.material;
const multi = await bakeProcPlantThreeImpostorChannels(renderer as unknown as THREE.WebGLRenderer, source, {
  width: 2,
  height: 2,
  azimuthCount: 1,
  elevations: [0],
  padding: 1,
  samples: 0,
  seasons: [{ id: "winter" }, { id: "summer" }],
});
assert.deepEqual(renderer.snapshot(), rendererBefore);
assert.equal(source.material, originalMaterial);
assert.deepEqual(multi.channelSet.layers.map((layer) => layer.id), [
  "summer:color", "summer:normal", "summer:depth",
  "winter:color", "winter:normal", "winter:depth",
]);
assert.equal(multi.texture("summer", "normal").colorSpace, THREE.NoColorSpace);
assert.equal(multi.texture("summer", "color").colorSpace, THREE.SRGBColorSpace);
assert.deepEqual(new Uint8Array(exportProcPlantThreeImpostorChannelGlb(multi)), new Uint8Array(exportProcPlantImpostorChannelSetGlb(multi.channelSet)));
const channelRender = createProcPlantThreeImpostorChannelRenderPackage(multi, "summer", { ownChannelPackage: false });
assert.equal(channelRender.channelMode, "color-normal-depth");
assert.ok(channelRender.material instanceof THREE.ShaderMaterial);
const positionBuffer = channelRender.geometry.getAttribute("position").array;
const uvBuffer = channelRender.geometry.getAttribute("uv").array;
const uniforms = channelRender.material.uniforms;
assert.equal(uniforms.colorAtlas!.value, multi.texture("summer", "color"));
assert.equal(uniforms.normalAtlas!.value, multi.texture("summer", "normal"));
assert.equal(uniforms.depthAtlas!.value, multi.texture("summer", "depth"));
assert.match(channelRender.material.fragmentShader, /normalLight/);
assert.match(channelRender.material.fragmentShader, /depthShade/);
channelRender.setSeason("winter");
assert.equal(channelRender.seasonId, "winter");
assert.equal(channelRender.atlas, multi.channelSet.layers.find((layer) => layer.id === "winter:color")!.atlas);
assert.equal(uniforms.colorAtlas!.value, multi.texture("winter", "color"));
assert.equal(uniforms.normalAtlas!.value, multi.texture("winter", "normal"));
assert.equal(uniforms.depthAtlas!.value, multi.texture("winter", "depth"));
assert.equal(channelRender.geometry.getAttribute("position").array, positionBuffer);
assert.equal(channelRender.geometry.getAttribute("uv").array, uvBuffer);
assert.equal(channelRender.geometry.userData.procplantImpostorChannels.seasonId, "winter");
channelRender.dispose();
multi.dispose();
assert.throws(() => multi.texture("summer", "color"), /disposed/);
console.log("ok 5 - live capture orchestration restores renderer/source and exposes aligned textures");

const legacyRenderer = new FakeRenderer();
const legacy = await bakeProcPlantThreeImpostor(legacyRenderer as unknown as THREE.WebGLRenderer, source, {
  width: 2, height: 2, azimuthCount: 1, elevations: [0], padding: 1, samples: 0,
});
const colorRenderer = new FakeRenderer();
const colorOnly = await bakeProcPlantThreeImpostorChannels(colorRenderer as unknown as THREE.WebGLRenderer, source, {
  width: 2, height: 2, azimuthCount: 1, elevations: [0], padding: 1, samples: 0,
  channels: ["color"], seasons: [{ id: "default", label: "Default" }],
});
assert.deepEqual(colorOnly.channelSet.layers[0]!.atlas.rgba, legacy.atlas.rgba);
assert.equal(colorOnly.channelSet.layers[0]!.legacyAtlasHash, legacy.atlas.contentHash);
const colorRender = createProcPlantThreeImpostorChannelRenderPackage(colorOnly, "default", { ownChannelPackage: false });
assert.equal(colorRender.channelMode, "color");
assert.ok(colorRender.material instanceof THREE.MeshBasicMaterial);
assert.equal(colorRender.material.map, colorOnly.texture("default", "color"));
colorRender.dispose();
legacy.dispose();
colorOnly.dispose();
console.log("ok 6 - live color-only capture preserves legacy atlas bytes, hash, and material compatibility");

const failingRenderer = new FakeRenderer();
failingRenderer.throwOnDepth = true;
const failureState = failingRenderer.snapshot();
await assert.rejects(bakeProcPlantThreeImpostorChannels(failingRenderer as unknown as THREE.WebGLRenderer, source, {
  width: 2, height: 2, azimuthCount: 1, elevations: [0], padding: 1, samples: 0,
  channels: ["normal", "depth"],
}), /injected depth render failure/);
assert.deepEqual(failingRenderer.snapshot(), failureState);
assert.equal(source.material, originalMaterial);
console.log("ok 7 - render failures restore target, viewport, scissor, clear, XR, and materials");

source.geometry.dispose();
sourceMaterial.dispose();
alphaMap.dispose();
colorMap.dispose();
normalMap.dispose();
