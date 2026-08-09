import * as THREE from "three";
import {
  buildProcPlantImpostorAtlas,
  buildProcPlantImpostorGeometry,
  createProcPlantImpostorAtlasTexture,
  createProcPlantImpostorCapturePlan,
  flipProcPlantImpostorRgbaRows,
  updateProcPlantImpostorGeometryView,
  type ProcPlantImpostorAtlas,
  type ProcPlantImpostorCaptureView,
  type ProcPlantImpostorCapturePlanOptions,
  type ProcPlantImpostorVec3,
} from "./procplant-impostor";
import {
  buildProcPlantImpostorChannelSet,
  type ProcPlantImpostorChannelId,
  type ProcPlantImpostorChannelSet,
  type ProcPlantImpostorSeason,
} from "./procplant-impostor-channels";
import { exportProcPlantImpostorChannelSetGlb } from "./procplant-impostor-image";

/**
 * Live normal/depth capture is implemented with alpha-aware Three override
 * materials. Automated tests cover shader contracts and renderer restoration;
 * browser/GPU validation is still required for each deployment target.
 */
export const PROCPLANT_THREE_IMPOSTOR_CHANNEL_CAPTURE_STATUS = Object.freeze({
  contract: "procplants.three-impostor-channel-status" as const,
  version: 1 as const,
  status: "implemented-browser-verification-required" as const,
  color: "implemented" as const,
  normal: "implemented-alpha-aware-view-space" as const,
  depth: "implemented-alpha-aware-linear-rgb24" as const,
  rendererStateRestoration: "implemented-and-unit-tested" as const,
  runtimeVerification: "not-yet-browser-gpu-verified" as const,
});

export interface ProcPlantThreeImpostorBakeOptions extends ProcPlantImpostorCapturePlanOptions {
  padding?: number;
  samples?: number;
  alphaTest?: number;
  signal?: AbortSignal;
}

export interface ProcPlantThreeImpostorPackage {
  atlas: ProcPlantImpostorAtlas;
  texture: THREE.DataTexture;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
  setView(viewId: string): void;
  dispose(): void;
}

export interface ProcPlantThreeImpostorChannelBakeOptions extends ProcPlantImpostorCapturePlanOptions {
  padding?: number;
  samples?: number;
  alphaTest?: number;
  signal?: AbortSignal;
  seasons?: readonly ProcPlantImpostorSeason[];
  channels?: readonly ProcPlantImpostorChannelId[];
  atlasWidth?: number;
  powerOfTwo?: boolean;
  atlasMaxSize?: number;
  maxViews?: number;
  maxSeasons?: number;
  maxBytes?: number;
  maxCaptureDimension?: number;
  applySeason?: (captureRoot: THREE.Object3D, season: Readonly<ProcPlantImpostorSeason>) => void | Promise<void>;
}

export interface ProcPlantThreeImpostorChannelTexture {
  layerId: string;
  layerIndex: number;
  seasonId: string;
  channelId: ProcPlantImpostorChannelId;
  texture: THREE.DataTexture;
}

export interface ProcPlantThreeImpostorChannelPackage {
  channelSet: ProcPlantImpostorChannelSet;
  textures: ProcPlantThreeImpostorChannelTexture[];
  texture(seasonId: string, channelId: ProcPlantImpostorChannelId): THREE.DataTexture;
  dispose(): void;
}

export interface ProcPlantThreeImpostorChannelRenderPackage {
  readonly channelPackage: ProcPlantThreeImpostorChannelPackage;
  readonly atlas: ProcPlantImpostorAtlas;
  readonly texture: THREE.DataTexture;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshBasicMaterial | THREE.ShaderMaterial;
  readonly seasonId: string;
  readonly channelMode: "color" | "color-normal-depth";
  setView(viewId: string): void;
  setSeason(seasonId: string): void;
  dispose(): void;
}

type ProcPlantTextureMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  bumpScale?: number;
  normalMap?: THREE.Texture | null;
  normalMapType?: THREE.NormalMapTypes;
  normalScale?: THREE.Vector2;
  displacementMap?: THREE.Texture | null;
  displacementScale?: number;
  displacementBias?: number;
};

export interface ProcPlantThreeImpostorOverrideMaterial {
  channelId: "normal" | "depth";
  material: THREE.MeshNormalMaterial | THREE.MeshDepthMaterial;
  updateView(view: ProcPlantImpostorCaptureView): void;
  dispose(): void;
}

const finiteBounds = (box: THREE.Box3) => {
  if (box.isEmpty()) throw new Error("cannot bake an impostor for empty geometry");
  const size = box.getSize(new THREE.Vector3());
  const epsilon = Math.max(size.length() * 1e-5, 1e-4);
  if (size.x <= 0) box.expandByVector(new THREE.Vector3(epsilon, 0, 0));
  if (size.y <= 0) box.expandByVector(new THREE.Vector3(0, epsilon, 0));
  if (size.z <= 0) box.expandByVector(new THREE.Vector3(0, 0, epsilon));
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  };
};

const vector = (value: ProcPlantImpostorVec3) => new THREE.Vector3(value.x, value.y, value.z);

const configureCaptureLighting = (scene: THREE.Scene, bounds: THREE.Box3) => {
  const center = bounds.getCenter(new THREE.Vector3());
  const diagonal = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1);
  scene.add(new THREE.HemisphereLight(0xddeeff, 0x4b533d, 1.8));
  const key = new THREE.DirectionalLight(0xfff2d8, 3.2);
  key.position.copy(center).add(new THREE.Vector3(0.8, 1.2, 0.65).multiplyScalar(diagonal));
  key.target.position.copy(center);
  scene.add(key, key.target);
};

const copyCaptureMaterialState = (
  target: THREE.Material,
  source: ProcPlantTextureMaterial,
  alphaTest: number,
) => {
  target.name = `procplant-impostor-${target.type}-${source.name || source.uuid}`;
  target.side = source.side;
  target.opacity = source.opacity;
  target.alphaTest = Math.max(source.alphaTest, THREE.MathUtils.clamp(alphaTest, 0, 1));
  target.depthTest = source.depthTest;
  target.depthWrite = source.depthWrite;
  target.colorWrite = source.colorWrite;
  target.clippingPlanes = source.clippingPlanes;
  target.clipIntersection = source.clipIntersection;
  target.clipShadows = source.clipShadows;
  target.polygonOffset = source.polygonOffset;
  target.polygonOffsetFactor = source.polygonOffsetFactor;
  target.polygonOffsetUnits = source.polygonOffsetUnits;
  target.visible = source.visible;
  target.blending = THREE.NoBlending;
  target.transparent = false;
  target.alphaHash = false;
  target.alphaToCoverage = false;
  target.premultipliedAlpha = false;
  target.toneMapped = false;
};

const copyTextureSurface = (
  target: ProcPlantTextureMaterial,
  source: ProcPlantTextureMaterial,
) => {
  target.map = source.map ?? null;
  target.alphaMap = source.alphaMap ?? null;
  target.displacementMap = source.displacementMap ?? null;
  target.displacementScale = source.displacementScale ?? 1;
  target.displacementBias = source.displacementBias ?? 0;
  source.map?.updateMatrix();
  source.alphaMap?.updateMatrix();
  source.displacementMap?.updateMatrix();
};

/** Build a source-preserving override pass for one mesh material. */
export const createProcPlantThreeImpostorOverrideMaterial = (
  sourceMaterial: THREE.Material,
  channelId: "normal" | "depth",
  alphaTest = 0.08,
): ProcPlantThreeImpostorOverrideMaterial => {
  const source = sourceMaterial as ProcPlantTextureMaterial;
  if (channelId === "normal") {
    const material = new THREE.MeshNormalMaterial({
      flatShading: Boolean((source as ProcPlantTextureMaterial & { flatShading?: boolean }).flatShading),
    });
    const typed = material as ProcPlantTextureMaterial;
    copyCaptureMaterialState(material, source, alphaTest);
    copyTextureSurface(typed, source);
    typed.bumpMap = source.bumpMap ?? null;
    typed.bumpScale = source.bumpScale ?? 1;
    typed.normalMap = source.normalMap ?? null;
    typed.normalMapType = source.normalMapType ?? THREE.TangentSpaceNormalMap;
    typed.normalScale = source.normalScale?.clone() ?? new THREE.Vector2(1, 1);
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <uv_pars_fragment>", [
          "#include <uv_pars_fragment>",
          "#include <map_pars_fragment>",
          "#include <alphamap_pars_fragment>",
          "#include <alphatest_pars_fragment>",
        ].join("\n"))
        .replace("vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );", [
          "vec4 diffuseColor = vec4( 1.0, 1.0, 1.0, opacity );",
          "#include <map_fragment>",
          "#include <alphamap_fragment>",
          "#include <alphatest_fragment>",
        ].join("\n"));
    };
    material.customProgramCacheKey = () => "procplants-impostor-normal-alpha-v1";
    return {
      channelId,
      material,
      updateView() {},
      dispose: () => material.dispose(),
    };
  }

  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBDepthPacking });
  const typed = material as ProcPlantTextureMaterial;
  copyCaptureMaterialState(material, source, alphaTest);
  copyTextureSurface(typed, source);
  const depthScale = { value: 1 };
  const depthOffset = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.procplantDepthScale = depthScale;
    shader.uniforms.procplantDepthOffset = depthOffset;
    shader.fragmentShader = `uniform float procplantDepthScale;\nuniform float procplantDepthOffset;\n${shader.fragmentShader}`
      .replace(
        "gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );",
        [
          "float procplantLinearDepth = clamp( fragCoordZ * procplantDepthScale + procplantDepthOffset, 0.0, 1.0 );",
          "gl_FragColor = vec4( packDepthToRGB( procplantLinearDepth ), diffuseColor.a );",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => "procplants-impostor-linear-depth-alpha-v1";
  return {
    channelId,
    material,
    updateView(view) {
      const range = view.projection.maxDepth - view.projection.minDepth;
      const cameraRange = view.projection.far - view.projection.near;
      const pivotToCamera = {
        x: view.camera.position.x - view.camera.target.x,
        y: view.camera.position.y - view.camera.target.y,
        z: view.camera.position.z - view.camera.target.z,
      };
      const distance = pivotToCamera.x * view.outward.x + pivotToCamera.y * view.outward.y + pivotToCamera.z * view.outward.z;
      const cameraDepthAtMaxBound = distance - view.projection.maxDepth;
      depthScale.value = cameraRange / range;
      depthOffset.value = (view.projection.near - cameraDepthAtMaxBound) / range;
    },
    dispose: () => material.dispose(),
  };
};

/**
 * Lazily bake an Object3D into a deterministic RGBA atlas using the supplied
 * live WebGL renderer. Renderer state and source ownership are preserved.
 */
export const bakeProcPlantThreeImpostor = async (
  renderer: THREE.WebGLRenderer,
  source: THREE.Object3D,
  options: ProcPlantThreeImpostorBakeOptions = {},
): Promise<ProcPlantThreeImpostorPackage> => {
  if (options.signal?.aborted) throw new DOMException("Impostor capture aborted", "AbortError");
  source.updateWorldMatrix(true, true);
  const captureScene = new THREE.Scene();
  const captureRoot = source.clone(true);
  captureRoot.matrixAutoUpdate = false;
  captureRoot.matrix.copy(source.matrixWorld);
  captureScene.add(captureRoot);
  captureScene.updateMatrixWorld(true);
  const worldBounds = new THREE.Box3().setFromObject(captureRoot, true);
  const bounds = finiteBounds(worldBounds.clone());
  configureCaptureLighting(captureScene, worldBounds);
  const plan = createProcPlantImpostorCapturePlan(bounds, {
    width: options.width ?? 128,
    height: options.height ?? 128,
    azimuthCount: options.azimuthCount ?? 8,
    azimuthOffset: options.azimuthOffset,
    elevations: options.elevations ?? [0],
    pivot: options.pivot,
  });
  const maxSamples = Math.max(0, renderer.capabilities.maxSamples ?? 0);
  const renderTarget = new THREE.WebGLRenderTarget(plan.width, plan.height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  renderTarget.samples = Math.min(Math.max(0, Math.round(options.samples ?? 4)), maxSamples);
  const captureCamera = new THREE.OrthographicCamera();
  const priorTarget = renderer.getRenderTarget();
  const priorCubeFace = renderer.getActiveCubeFace();
  const priorMipmapLevel = renderer.getActiveMipmapLevel();
  const priorViewport = renderer.getViewport(new THREE.Vector4());
  const priorScissor = renderer.getScissor(new THREE.Vector4());
  const priorScissorTest = renderer.getScissorTest();
  const priorClearColor = renderer.getClearColor(new THREE.Color());
  const priorClearAlpha = renderer.getClearAlpha();
  const priorAutoClear = renderer.autoClear;
  const priorXrEnabled = renderer.xr.enabled;
  let packageBuilt = false;
  try {
    renderer.autoClear = true;
    renderer.xr.enabled = false;
    renderer.setClearColor(0x000000, 0);
    const atlas = await buildProcPlantImpostorAtlas(plan, async ({ view, width, height }) => {
      if (options.signal?.aborted) throw new DOMException("Impostor capture aborted", "AbortError");
      captureCamera.left = view.projection.left;
      captureCamera.right = view.projection.right;
      captureCamera.bottom = view.projection.bottom;
      captureCamera.top = view.projection.top;
      captureCamera.near = view.projection.near;
      captureCamera.far = view.projection.far;
      captureCamera.position.copy(vector(view.camera.position));
      captureCamera.up.copy(vector(view.camera.up));
      captureCamera.lookAt(vector(view.camera.target));
      captureCamera.updateProjectionMatrix();
      captureCamera.updateMatrixWorld(true);
      renderer.setRenderTarget(renderTarget);
      renderer.clear(true, true, true);
      renderer.render(captureScene, captureCamera);
      const readback = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, readback);
      return {
        id: view.id,
        width,
        height,
        rgba: flipProcPlantImpostorRgbaRows(readback, width, height),
      };
    }, {
      padding: options.padding ?? 4,
      powerOfTwo: true,
      maxSize: renderer.capabilities.maxTextureSize,
      signal: options.signal,
    });
    const texture = createProcPlantImpostorAtlasTexture(atlas);
    const geometry = buildProcPlantImpostorGeometry(atlas, { mode: "billboard" });
    const material = new THREE.MeshBasicMaterial({
      name: "procplant-impostor-material",
      map: texture,
      alphaTest: THREE.MathUtils.clamp(options.alphaTest ?? 0.08, 0, 1),
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    packageBuilt = true;
    let disposed = false;
    return {
      atlas,
      texture,
      geometry,
      material,
      setView(viewId: string) {
        if (disposed) throw new Error("impostor package has been disposed");
        updateProcPlantImpostorGeometryView(geometry, atlas, viewId);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        geometry.dispose();
        material.dispose();
        texture.dispose();
      },
    };
  } finally {
    renderer.setRenderTarget(priorTarget, priorCubeFace, priorMipmapLevel);
    renderer.setViewport(priorViewport);
    renderer.setScissor(priorScissor);
    renderer.setScissorTest(priorScissorTest);
    renderer.setClearColor(priorClearColor, priorClearAlpha);
    renderer.autoClear = priorAutoClear;
    renderer.xr.enabled = priorXrEnabled;
    renderTarget.dispose();
    captureScene.clear();
    if (!packageBuilt && options.signal?.aborted) {
      // Keep aborts distinguishable from capture/render failures.
      throw new DOMException("Impostor capture aborted", "AbortError");
    }
  }
};

const canonicalThreeSeasons = (input: readonly ProcPlantImpostorSeason[] | undefined) => {
  const seasons = (input ?? [{ id: "default", label: "Default" }]).map((season) => ({ ...season }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (seasons.length === 0) throw new Error("impostor seasons must not be empty");
  if (seasons.length > 8) throw new Error("impostor season count exceeds hard cap (8)");
  for (let index = 0; index < seasons.length; index++) {
    const season = seasons[index]!;
    if (!season.id.trim() || season.id.length > 64) throw new Error(`impostor season ${index} id must contain 1-64 characters`);
    if (index > 0 && season.id === seasons[index - 1]!.id) throw new Error(`duplicate impostor season id: ${season.id}`);
  }
  return seasons;
};

const cloneObjectMaterials = (root: THREE.Object3D) => {
  const clones = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const clone = (material: THREE.Material) => {
      let result = clones.get(material);
      if (!result) {
        result = material.clone();
        clones.set(material, result);
      }
      return result;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
  });
  return new Set(clones.values());
};

const configureCaptureCamera = (
  camera: THREE.OrthographicCamera,
  view: ProcPlantImpostorCaptureView,
) => {
  camera.left = view.projection.left;
  camera.right = view.projection.right;
  camera.bottom = view.projection.bottom;
  camera.top = view.projection.top;
  camera.near = view.projection.near;
  camera.far = view.projection.far;
  camera.position.copy(vector(view.camera.position));
  camera.up.copy(vector(view.camera.up));
  camera.lookAt(vector(view.camera.target));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
};

const snapshotRenderer = (renderer: THREE.WebGLRenderer) => ({
  target: renderer.getRenderTarget(),
  cubeFace: renderer.getActiveCubeFace(),
  mipmapLevel: renderer.getActiveMipmapLevel(),
  viewport: renderer.getViewport(new THREE.Vector4()),
  scissor: renderer.getScissor(new THREE.Vector4()),
  scissorTest: renderer.getScissorTest(),
  clearColor: renderer.getClearColor(new THREE.Color()),
  clearAlpha: renderer.getClearAlpha(),
  autoClear: renderer.autoClear,
  xrEnabled: renderer.xr.enabled,
});

const restoreRenderer = (
  renderer: THREE.WebGLRenderer,
  state: ReturnType<typeof snapshotRenderer>,
) => {
  renderer.setRenderTarget(state.target, state.cubeFace, state.mipmapLevel);
  renderer.setViewport(state.viewport);
  renderer.setScissor(state.scissor);
  renderer.setScissorTest(state.scissorTest);
  renderer.setClearColor(state.clearColor, state.clearAlpha);
  renderer.autoClear = state.autoClear;
  renderer.xr.enabled = state.xrEnabled;
};

const swapOverrideMaterials = (
  root: THREE.Object3D,
  channelId: "normal" | "depth",
  view: ProcPlantImpostorCaptureView,
  alphaTest: number,
  cache: Map<THREE.Material, ProcPlantThreeImpostorOverrideMaterial>,
) => {
  const originals: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }> = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material;
    originals.push({ mesh, material: original });
    const override = (material: THREE.Material) => {
      let pass = cache.get(material);
      if (!pass) {
        pass = createProcPlantThreeImpostorOverrideMaterial(material, channelId, alphaTest);
        cache.set(material, pass);
      }
      pass.updateView(view);
      return pass.material;
    };
    mesh.material = Array.isArray(original) ? original.map(override) : override(original);
  });
  return () => {
    for (const { mesh, material } of originals) mesh.material = material;
  };
};

/**
 * Bake aligned seasonal color, view-normal, and linear-depth atlases from a
 * live WebGL renderer. The caller's Object3D, materials, and renderer state are
 * restored even when capture, season preparation, or readback fails.
 */
export const bakeProcPlantThreeImpostorChannels = async (
  renderer: THREE.WebGLRenderer,
  source: THREE.Object3D,
  options: ProcPlantThreeImpostorChannelBakeOptions = {},
): Promise<ProcPlantThreeImpostorChannelPackage> => {
  if (options.signal?.aborted) throw new DOMException("Impostor channel capture aborted", "AbortError");
  source.updateWorldMatrix(true, true);
  const seasons = canonicalThreeSeasons(options.seasons);
  const captureScene = new THREE.Scene();
  const wrappers = new Map<string, THREE.Group>();
  const ownedMaterials = new Set<THREE.Material>();
  const roots = new Map<string, THREE.Object3D>();
  const worldBounds = new THREE.Box3();
  const cleanupPrepared = () => {
    for (const material of ownedMaterials) material.dispose();
    ownedMaterials.clear();
    captureScene.clear();
  };
  for (const season of seasons) {
    if (options.signal?.aborted) throw new DOMException("Impostor channel capture aborted", "AbortError");
    const root = source.clone(true);
    root.matrixAutoUpdate = false;
    root.matrix.copy(source.matrixWorld);
    const firstClones = cloneObjectMaterials(root);
    try {
      await options.applySeason?.(root, Object.freeze({ ...season }));
    } catch (error) {
      for (const material of firstClones) material.dispose();
      cleanupPrepared();
      throw error;
    }
    const finalClones = cloneObjectMaterials(root);
    for (const material of firstClones) material.dispose();
    for (const material of finalClones) ownedMaterials.add(material);
    root.updateMatrixWorld(true);
    worldBounds.expandByObject(root, true);
    const wrapper = new THREE.Group();
    wrapper.name = `procplant-impostor-season-${season.id}`;
    wrapper.add(root);
    wrappers.set(season.id, wrapper);
    roots.set(season.id, root);
    captureScene.add(wrapper);
  }
  let plan;
  try {
    const bounds = finiteBounds(worldBounds.clone());
    configureCaptureLighting(captureScene, worldBounds);
    plan = createProcPlantImpostorCapturePlan(bounds, {
      width: options.width ?? 128,
      height: options.height ?? 128,
      azimuthCount: options.azimuthCount ?? 8,
      azimuthOffset: options.azimuthOffset,
      elevations: options.elevations ?? [0],
      pivot: options.pivot,
    });
    if (options.atlasMaxSize !== undefined && options.atlasMaxSize > renderer.capabilities.maxTextureSize) {
      throw new Error(`impostor atlasMaxSize exceeds renderer maxTextureSize (${renderer.capabilities.maxTextureSize})`);
    }
  } catch (error) {
    cleanupPrepared();
    throw error;
  }
  const maxSamples = Math.max(0, renderer.capabilities.maxSamples ?? 0);
  const targetOptions: THREE.RenderTargetOptions = {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  };
  const colorTarget = new THREE.WebGLRenderTarget(plan.width, plan.height, targetOptions);
  colorTarget.texture.colorSpace = THREE.SRGBColorSpace;
  const dataTarget = new THREE.WebGLRenderTarget(plan.width, plan.height, targetOptions);
  dataTarget.texture.colorSpace = THREE.NoColorSpace;
  const samples = Math.min(Math.max(0, Math.round(options.samples ?? 4)), maxSamples);
  colorTarget.samples = samples;
  dataTarget.samples = samples;
  const camera = new THREE.OrthographicCamera();
  const rendererState = snapshotRenderer(renderer);
  const normalPasses = new Map<THREE.Material, ProcPlantThreeImpostorOverrideMaterial>();
  const depthPasses = new Map<THREE.Material, ProcPlantThreeImpostorOverrideMaterial>();
  try {
    renderer.autoClear = true;
    renderer.xr.enabled = false;
    const channelSet = await buildProcPlantImpostorChannelSet(plan, async ({ season, channel, view, width, height }) => {
      if (options.signal?.aborted) throw new DOMException("Impostor channel capture aborted", "AbortError");
      for (const [id, wrapper] of wrappers) wrapper.visible = id === season.id;
      const root = roots.get(season.id);
      if (!root) throw new Error(`missing prepared impostor season: ${season.id}`);
      configureCaptureCamera(camera, view);
      const target = channel.id === "color" ? colorTarget : dataTarget;
      if (channel.id === "normal") renderer.setClearColor(new THREE.Color().setRGB(128 / 255, 128 / 255, 1), 0);
      else if (channel.id === "depth") renderer.setClearColor(new THREE.Color().setRGB(1, 1, 1), 0);
      else renderer.setClearColor(0x000000, 0);
      let restoreMaterials: (() => void) | undefined;
      try {
        if (channel.id === "normal") {
          restoreMaterials = swapOverrideMaterials(root, "normal", view, options.alphaTest ?? 0.08, normalPasses);
        } else if (channel.id === "depth") {
          restoreMaterials = swapOverrideMaterials(root, "depth", view, options.alphaTest ?? 0.08, depthPasses);
        }
        renderer.setRenderTarget(target);
        renderer.clear(true, true, true);
        renderer.render(captureScene, camera);
        const readback = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, readback);
        return { id: view.id, width, height, rgba: flipProcPlantImpostorRgbaRows(readback, width, height) };
      } finally {
        restoreMaterials?.();
      }
    }, {
      seasons,
      channels: options.channels,
      padding: options.padding ?? 4,
      width: options.atlasWidth,
      powerOfTwo: options.powerOfTwo ?? true,
      maxSize: options.atlasMaxSize ?? Math.min(renderer.capabilities.maxTextureSize, 8192),
      maxViews: options.maxViews,
      maxSeasons: options.maxSeasons,
      maxBytes: options.maxBytes,
      maxCaptureDimension: options.maxCaptureDimension,
      signal: options.signal,
    });
    const textures = channelSet.layers.map((layer): ProcPlantThreeImpostorChannelTexture => {
      const texture = createProcPlantImpostorAtlasTexture(layer.atlas);
      texture.name = `procplant-impostor-${layer.id}`;
      texture.colorSpace = layer.channelId === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.userData.procplantImpostorChannel = {
        layerId: layer.id,
        layerIndex: layer.layerIndex,
        seasonId: layer.seasonId,
        channelId: layer.channelId,
        contentHash: layer.contentHash,
      };
      return {
        layerId: layer.id,
        layerIndex: layer.layerIndex,
        seasonId: layer.seasonId,
        channelId: layer.channelId,
        texture,
      };
    });
    let disposed = false;
    return {
      channelSet,
      textures,
      texture(seasonId, channelId) {
        if (disposed) throw new Error("impostor channel package has been disposed");
        const match = textures.find((entry) => entry.seasonId === seasonId && entry.channelId === channelId);
        if (!match) throw new Error(`impostor channel texture not found: ${seasonId}/${channelId}`);
        return match.texture;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const entry of textures) entry.texture.dispose();
      },
    };
  } finally {
    restoreRenderer(renderer, rendererState);
    colorTarget.dispose();
    dataTarget.dispose();
    for (const pass of normalPasses.values()) pass.dispose();
    for (const pass of depthPasses.values()) pass.dispose();
    cleanupPrepared();
  }
};

/** Deterministically embed every aligned seasonal channel atlas as PNG in GLB. */
export const exportProcPlantThreeImpostorChannelGlb = (
  baked: ProcPlantThreeImpostorChannelPackage | ProcPlantImpostorChannelSet,
  name = "procplant-impostor-channels",
) => exportProcPlantImpostorChannelSetGlb("channelSet" in baked ? baked.channelSet : baked, name);

const channelFragmentShader = `
uniform sampler2D colorAtlas;
uniform sampler2D normalAtlas;
uniform sampler2D depthAtlas;
uniform float alphaTest;
varying vec2 vUv;

float unpackDepth24(vec3 rgb) {
  vec3 bytes = floor(rgb * 255.0 + 0.5);
  return dot(bytes, vec3(65536.0, 256.0, 1.0)) / 16777215.0;
}

void main() {
  vec4 color = texture2D(colorAtlas, vUv);
  if (color.a < alphaTest) discard;
  vec3 normal = normalize(texture2D(normalAtlas, vUv).rgb * 2.0 - 1.0);
  float depth = unpackDepth24(texture2D(depthAtlas, vUv).rgb);
  float normalLight = 0.38 + 0.62 * max(normal.z, 0.0);
  float depthShade = mix(1.0, 0.82, depth);
  gl_FragColor = vec4(color.rgb * normalLight * depthShade, color.a);
}`;

const channelVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * Adopt a baked aligned channel set as a hero/dense-compatible billboard.
 * Textures are borrowed from the channel package; disposal releases the
 * binding and, by default, the package exactly once.
 */
export const createProcPlantThreeImpostorChannelRenderPackage = (
  channelPackage: ProcPlantThreeImpostorChannelPackage,
  initialSeasonId = channelPackage.channelSet.seasons[0]?.id ?? "default",
  options: { alphaTest?: number; ownChannelPackage?: boolean } = {},
): ProcPlantThreeImpostorChannelRenderPackage => {
  const alphaTest = THREE.MathUtils.clamp(options.alphaTest ?? 0.08, 0, 1);
  const channelIds = new Set(channelPackage.channelSet.channels.map((channel) => channel.id));
  if (!channelIds.has("color")) throw new Error("impostor channel rendering requires a color layer");
  const enhanced = channelIds.has("normal") && channelIds.has("depth");
  const partial = channelIds.size > 1 && !enhanced;
  if (partial) throw new Error("impostor channel rendering requires normal and depth together");
  let seasonId = initialSeasonId;
  let atlas = channelPackage.channelSet.layers.find((layer) => layer.seasonId === seasonId && layer.channelId === "color")?.atlas;
  if (!atlas) throw new Error(`impostor render season not found: ${seasonId}`);
  const geometry = buildProcPlantImpostorGeometry(atlas, { mode: "billboard" });
  const colorTexture = channelPackage.texture(seasonId, "color");
  const material = enhanced
    ? new THREE.ShaderMaterial({
        name: "procplant-impostor-channel-material",
        uniforms: {
          colorAtlas: { value: colorTexture },
          normalAtlas: { value: channelPackage.texture(seasonId, "normal") },
          depthAtlas: { value: channelPackage.texture(seasonId, "depth") },
          alphaTest: { value: alphaTest },
        },
        vertexShader: channelVertexShader,
        fragmentShader: channelFragmentShader,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    : new THREE.MeshBasicMaterial({
        name: "procplant-impostor-channel-color-material",
        map: colorTexture,
        alphaTest,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
  let disposed = false;
  const result: ProcPlantThreeImpostorChannelRenderPackage = {
    channelPackage,
    get atlas() { return atlas!; },
    get texture() { return channelPackage.texture(seasonId, "color"); },
    geometry,
    material,
    get seasonId() { return seasonId; },
    channelMode: enhanced ? "color-normal-depth" : "color",
    setView(viewId) {
      if (disposed) throw new Error("impostor channel render package has been disposed");
      updateProcPlantImpostorGeometryView(geometry, atlas!, viewId);
    },
    setSeason(nextSeasonId) {
      if (disposed) throw new Error("impostor channel render package has been disposed");
      const nextAtlas = channelPackage.channelSet.layers.find((layer) => layer.seasonId === nextSeasonId && layer.channelId === "color")?.atlas;
      if (!nextAtlas) throw new Error(`impostor render season not found: ${nextSeasonId}`);
      const viewId = String(geometry.userData.procplantImpostor?.viewId ?? nextAtlas.entries[0]!.id);
      atlas = nextAtlas;
      seasonId = nextSeasonId;
      updateProcPlantImpostorGeometryView(geometry, atlas, atlas.entries.some((entry) => entry.id === viewId) ? viewId : atlas.entries[0]!.id);
      geometry.userData.procplantImpostorChannels.seasonId = seasonId;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.map = channelPackage.texture(seasonId, "color");
        material.needsUpdate = true;
      } else {
        material.uniforms.colorAtlas!.value = channelPackage.texture(seasonId, "color");
        material.uniforms.normalAtlas!.value = channelPackage.texture(seasonId, "normal");
        material.uniforms.depthAtlas!.value = channelPackage.texture(seasonId, "depth");
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      if (options.ownChannelPackage ?? true) channelPackage.dispose();
    },
  };
  geometry.userData.procplantImpostorChannels = {
    contentHash: channelPackage.channelSet.contentHash,
    seasonId,
    mode: result.channelMode,
  };
  return result;
};

const exportManifest = (atlas: ProcPlantImpostorAtlas) => ({
  contract: atlas.contract,
  version: atlas.version,
  contentHash: atlas.contentHash,
  width: atlas.width,
  height: atlas.height,
  padding: atlas.padding,
  selection: atlas.selection,
  entries: atlas.entries.map((entry) => ({
    id: entry.id,
    uv: entry.uv,
    paddedUv: entry.paddedUv,
    outward: entry.view.outward,
    projectedPivot: entry.view.projectedPivot,
    projectedWidth: entry.view.projectedWidth,
    projectedHeight: entry.view.projectedHeight,
  })),
});

/** Serialize the real atlas texture and billboard mesh into a standalone GLB. */
export const exportProcPlantThreeImpostorGlb = async (
  baked: ProcPlantThreeImpostorPackage,
  name = "procplant-impostor",
): Promise<ArrayBuffer> => {
  const scene = new THREE.Scene();
  scene.name = name;
  scene.userData.procplantImpostor = exportManifest(baked.atlas);
  const geometry = baked.geometry.clone();
  geometry.deleteAttribute("impostorUv");
  geometry.deleteAttribute("impostorCard");
  const material = baked.material.clone();
  material.map = baked.texture;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${name}-billboard`;
  mesh.userData.procplantImpostor = exportManifest(baked.atlas);
  scene.add(mesh);
  try {
    const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
    const output = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false });
    if (!(output instanceof ArrayBuffer)) throw new Error("GLTFExporter returned JSON for an impostor GLB request");
    return output;
  } finally {
    geometry.dispose();
    material.dispose();
  }
};
