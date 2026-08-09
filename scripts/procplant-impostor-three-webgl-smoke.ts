import * as THREE from "three";
import {
  bakeProcPlantThreeImpostorChannels,
  createProcPlantThreeImpostorChannelRenderPackage,
} from "../src/procplant-impostor-three";
import { createProcPlantDenseImpostorPoolFromChannelRender } from "../src/procplant-dense-impostor-pool";

declare global {
  interface Window {
    __PROCPLANT_IMPOSTOR_WEBGL_SMOKE__?: Record<string, unknown>;
  }
}

const resultElement = document.querySelector<HTMLPreElement>("#result")!;

const equalArray = (left: readonly number[], right: readonly number[], epsilon = 0) =>
  left.length === right.length && left.every((value, index) => Math.abs(value - right[index]!) <= epsilon);

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

const atlasStats = (rgba: Uint8ClampedArray) => {
  let opaque = 0;
  let transparent = 0;
  let colored = 0;
  let byteHash = 0x811c9dc5;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3]! > 0) opaque++;
    else transparent++;
    if (rgba[offset]! || rgba[offset + 1]! || rgba[offset + 2]!) colored++;
    for (let channel = 0; channel < 4; channel++) {
      byteHash ^= rgba[offset + channel]!;
      byteHash = Math.imul(byteHash, 0x01000193) >>> 0;
    }
  }
  return { opaque, transparent, colored, byteHash: byteHash.toString(16).padStart(8, "0") };
};

const renderStats = (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
) => {
  renderer.setRenderTarget(target);
  renderer.setViewport(0, 0, target.width, target.height);
  renderer.setScissor(0, 0, target.width, target.height);
  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  renderer.xr.enabled = false;
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  const rgba = new Uint8Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, rgba);
  return atlasStats(new Uint8ClampedArray(rgba));
};

try {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu")!;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setSize(64, 64, false);
  const context = renderer.getContext();
  const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
  const gpu = {
    version: String(context.getParameter(context.VERSION)),
    shadingLanguage: String(context.getParameter(context.SHADING_LANGUAGE_VERSION)),
    vendor: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : "masked",
    renderer: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : "masked",
  };

  const textureBytes = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const offset = (y * 4 + x) * 4;
      const visible = (x + y) % 2 === 0;
      textureBytes.set([visible ? 235 : 20, visible ? 90 : 220, 35, visible ? 255 : 0], offset);
    }
  }
  const cutout = new THREE.DataTexture(textureBytes, 4, 4, THREE.RGBAFormat, THREE.UnsignedByteType);
  cutout.name = "impostor-webgl-alpha-cutout";
  cutout.colorSpace = THREE.SRGBColorSpace;
  cutout.minFilter = THREE.NearestFilter;
  cutout.magFilter = THREE.NearestFilter;
  cutout.generateMipmaps = false;
  cutout.needsUpdate = true;
  const sourceMaterial = new THREE.MeshBasicMaterial({
    name: "impostor-webgl-alpha-tested-source",
    map: cutout,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    transparent: false,
  });
  const source = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sourceMaterial);
  source.name = "impostor-webgl-alpha-tested-mesh";

  const priorTarget = new THREE.WebGLRenderTarget(8, 8, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
  });
  renderer.setRenderTarget(priorTarget);
  renderer.setViewport(2, 3, 5, 4);
  renderer.setScissor(1, 2, 4, 3);
  renderer.setScissorTest(true);
  renderer.setClearColor(new THREE.Color().setRGB(0.17, 0.29, 0.41), 0.37);
  renderer.autoClear = false;
  renderer.xr.enabled = true;
  const before = {
    target: renderer.getRenderTarget(),
    cubeFace: renderer.getActiveCubeFace(),
    mipmapLevel: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()).toArray(),
    scissor: renderer.getScissor(new THREE.Vector4()).toArray(),
    scissorTest: renderer.getScissorTest(),
    clearColor: renderer.getClearColor(new THREE.Color()).toArray(),
    clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
    xrEnabled: renderer.xr.enabled,
    material: source.material,
  };

  const baked = await bakeProcPlantThreeImpostorChannels(renderer, source, {
    width: 32,
    height: 32,
    azimuthCount: 2,
    elevations: [0],
    padding: 2,
    samples: 0,
    channels: ["color", "normal", "depth"],
    seasons: [{ id: "winter" }, { id: "summer" }],
    powerOfTwo: false,
    atlasMaxSize: 128,
    maxBytes: 4 * 1024 * 1024,
  });
  const after = {
    target: renderer.getRenderTarget(),
    cubeFace: renderer.getActiveCubeFace(),
    mipmapLevel: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()).toArray(),
    scissor: renderer.getScissor(new THREE.Vector4()).toArray(),
    scissorTest: renderer.getScissorTest(),
    clearColor: renderer.getClearColor(new THREE.Color()).toArray(),
    clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
    xrEnabled: renderer.xr.enabled,
    material: source.material,
  };
  assert(after.target === before.target, "renderer target was not restored");
  assert(after.cubeFace === before.cubeFace && after.mipmapLevel === before.mipmapLevel, "renderer target face/mip was not restored");
  assert(equalArray(after.viewport, before.viewport), "renderer viewport was not restored");
  assert(equalArray(after.scissor, before.scissor), "renderer scissor was not restored");
  assert(after.scissorTest === before.scissorTest, "renderer scissor test was not restored");
  assert(equalArray(after.clearColor, before.clearColor, 1e-12) && after.clearAlpha === before.clearAlpha, "renderer clear state was not restored");
  assert(after.autoClear === before.autoClear && after.xrEnabled === before.xrEnabled, "renderer autoClear/XR state was not restored");
  assert(after.material === before.material, "source material was not restored");

  const layers = baked.channelSet.layers;
  assert(layers.length === 6, "expected two aligned color, normal, and depth season sets");
  const color = layers.find((layer) => layer.id === "summer:color")!;
  const normal = layers.find((layer) => layer.id === "summer:normal")!;
  const depth = layers.find((layer) => layer.id === "summer:depth")!;
  const referenceLayout = JSON.stringify(color.atlas.entries.map((entry) => ({ id: entry.id, uv: entry.uv, paddedUv: entry.paddedUv })));
  for (const layer of layers) {
    assert(layer.atlas.width === color.atlas.width && layer.atlas.height === color.atlas.height, `atlas dimensions drifted for ${layer.id}`);
    assert(JSON.stringify(layer.atlas.entries.map((entry) => ({ id: entry.id, uv: entry.uv, paddedUv: entry.paddedUv }))) === referenceLayout,
      `atlas UV layout drifted for ${layer.id}`);
  }
  const stats = {
    color: atlasStats(color.atlas.rgba),
    normal: atlasStats(normal.atlas.rgba),
    depth: atlasStats(depth.atlas.rgba),
  };
  assert(stats.color.opaque > 0 && stats.color.colored > 0, "color atlas is empty");
  assert(stats.normal.opaque > 0 && stats.normal.colored > 0, "normal atlas is empty");
  assert(stats.depth.opaque > 0 && stats.depth.colored > 0, "depth atlas is empty");
  assert(stats.color.transparent > 0 && stats.normal.transparent > 0 && stats.depth.transparent > 0,
    "alpha-tested capture must retain transparent texels");
  assert(stats.normal.byteHash !== stats.depth.byteHash, "normal and depth GPU captures must differ");
  const entry = color.atlas.entries[0]!;
  let interiorOpaque = 0;
  let interiorTransparent = 0;
  for (let y = entry.y; y < entry.y + entry.height; y++) {
    for (let x = entry.x; x < entry.x + entry.width; x++) {
      const alpha = color.atlas.rgba[(y * color.atlas.width + x) * 4 + 3]!;
      if (alpha > 0) interiorOpaque++;
      else interiorTransparent++;
    }
  }
  assert(interiorOpaque > 0 && interiorTransparent > 0, "real color capture did not preserve the alpha-test cutout");

  const renderBinding = createProcPlantThreeImpostorChannelRenderPackage(baked, "summer");
  const positionBuffer = renderBinding.geometry.getAttribute("position").array;
  const uvBuffer = renderBinding.geometry.getAttribute("uv").array;
  const secondViewId = renderBinding.atlas.entries[1]!.id;
  renderBinding.setView(secondViewId);
  assert(renderBinding.geometry.userData.procplantImpostor.viewId === secondViewId, "hero view selection did not update billboard UVs");
  renderBinding.setSeason("winter");
  assert(renderBinding.seasonId === "winter", "hero season selection did not update the binding");
  assert(renderBinding.geometry.getAttribute("position").array === positionBuffer, "hero season selection replaced the position buffer");
  assert(renderBinding.geometry.getAttribute("uv").array === uvBuffer, "hero view/season selection replaced the UV buffer");
  assert(renderBinding.material instanceof THREE.ShaderMaterial, "enhanced hero must adopt the channel shader");
  assert(renderBinding.material.uniforms.colorAtlas!.value === baked.texture("winter", "color"), "winter color texture was not selected");
  assert(renderBinding.material.uniforms.normalAtlas!.value === baked.texture("winter", "normal"), "winter normal texture was not selected");
  assert(renderBinding.material.uniforms.depthAtlas!.value === baked.texture("winter", "depth"), "winter depth texture was not selected");

  const adoptionTarget = new THREE.WebGLRenderTarget(64, 64, { depthBuffer: true });
  const adoptionCamera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
  adoptionCamera.position.set(0, 0, 5);
  adoptionCamera.lookAt(0, 0, 0);
  const heroScene = new THREE.Scene();
  const hero = new THREE.Mesh(renderBinding.geometry, renderBinding.material);
  heroScene.add(hero);
  const enhancedHero = renderStats(renderer, heroScene, adoptionCamera, adoptionTarget);
  const colorOnlyMaterial = new THREE.MeshBasicMaterial({
    map: baked.texture("winter", "color"),
    alphaTest: 0.08,
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  hero.material = colorOnlyMaterial;
  const colorOnlyHero = renderStats(renderer, heroScene, adoptionCamera, adoptionTarget);
  assert(enhancedHero.opaque > 0, "enhanced hero channel material rendered no pixels");
  assert(colorOnlyHero.opaque > 0, "color-only compatibility material rendered no pixels");
  assert(enhancedHero.byteHash !== colorOnlyHero.byteHash, "normal/depth channel use did not materially affect hero pixels");
  hero.material = renderBinding.material;

  const densePool = createProcPlantDenseImpostorPoolFromChannelRender(renderBinding, [
    new THREE.Matrix4().makeTranslation(-0.45, 0, 0),
    new THREE.Matrix4().makeTranslation(0.45, 0, 0),
  ], { frustumCulled: false, viewHysteresis: 0 });
  densePool.update(new THREE.Vector3(0, 0, 5));
  assert(densePool.meshes.every((mesh) => mesh.material === renderBinding.material), "dense buckets did not borrow the hero channel material");
  const denseBuffers = densePool.meshes.map((mesh) => mesh.instanceMatrix.array);
  densePool.update(new THREE.Vector3(0.25, 0, 5));
  assert(densePool.meshes.every((mesh, index) => mesh.instanceMatrix.array === denseBuffers[index]), "dense camera update replaced an instance buffer");
  const denseScene = new THREE.Scene();
  denseScene.add(densePool.root);
  const denseRender = renderStats(renderer, denseScene, adoptionCamera, adoptionTarget);
  assert(denseRender.opaque > 0, "dense channel pool rendered no pixels");

  const result = {
    status: "pass",
    gpu,
    atlas: { width: color.atlas.width, height: color.atlas.height, layers: layers.map((layer) => layer.id) },
    stats,
    alphaCutout: { interiorOpaque, interiorTransparent },
    adoption: {
      mode: renderBinding.channelMode,
      season: renderBinding.seasonId,
      view: secondViewId,
      heroEnhanced: enhancedHero,
      heroColorOnly: colorOnlyHero,
      dense: denseRender,
      denseVisible: densePool.stats.visible,
      denseDraws: densePool.stats.draws,
      sharedMaterial: true,
      stableBuffers: true,
    },
    rendererRestored: true,
  };
  window.__PROCPLANT_IMPOSTOR_WEBGL_SMOKE__ = result;
  resultElement.textContent = JSON.stringify(result, null, 2);

  densePool.dispose();
  colorOnlyMaterial.dispose();
  adoptionTarget.dispose();
  renderBinding.dispose();
  priorTarget.dispose();
  source.geometry.dispose();
  sourceMaterial.dispose();
  cutout.dispose();
  renderer.dispose();
} catch (error) {
  const failure = {
    status: "fail",
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  window.__PROCPLANT_IMPOSTOR_WEBGL_SMOKE__ = failure;
  resultElement.textContent = JSON.stringify(failure, null, 2);
  console.error(error);
}
