import * as THREE from "three";
import {
  createProcPlantFiveTierAtlasCatalogPlan,
  createProcPlantFiveTierAtlasMemoryCache,
  createProcPlantFiveTierAtlasWebGlCapturePool,
  runProcPlantFiveTierAtlasCatalog,
} from "../src/procplant-five-tier-atlas-catalog";
import { exportProcPlantFiveTierLodGlb } from "../src/procplant-five-tier-lod";
import { createProcPlantImpostorAtlasTexture } from "../src/procplant-impostor";
import { createProcPlantThreeGeometry } from "../src/procplant-three-geometry";
import { defaultPlantEnvironment, procPlantPresets, type ProcPlantGenome } from "../src/procplants";

declare global {
  interface Window { __PROCPLANT_LOD5_CATALOG_BROWSER_SMOKE__?: Record<string, unknown>; }
}

const resultElement = document.querySelector<HTMLElement>("#result")!;
try {
  const environment = defaultPlantEnvironment();
  const buildOptions = {
    width: 32,
    height: 32,
    azimuthCount: 4,
    elevations: [0],
    padding: 2,
    samples: 0,
    maxAtlasSize: 256,
    maxAtlasBytes: 256 * 1024,
  } as const;
  const sources = [
    { presetId: "phiFern", genome: procPlantPresets.phiFern!, seed: 612072, environment, buildOptions },
    { presetId: "cloverGroundcover", genome: procPlantPresets.cloverGroundcover!, seed: 99173, environment, buildOptions },
  ] as const;
  const plan = createProcPlantFiveTierAtlasCatalogPlan(sources, {
    maxEntries: 4,
    maxTotalAtlasBytes: 2 * 1024 * 1024,
  });
  const captureCanvas = document.querySelector<HTMLCanvasElement>("#capture")!;
  const outputCanvas = document.querySelector<HTMLCanvasElement>("#render")!;
  const captureRenderer = new THREE.WebGLRenderer({ canvas: captureCanvas, antialias: false });
  const outputRenderer = new THREE.WebGLRenderer({ canvas: outputCanvas, antialias: false, preserveDrawingBuffer: true });
  captureRenderer.setPixelRatio(1);
  captureRenderer.setSize(captureCanvas.width, captureCanvas.height, false);
  captureRenderer.outputColorSpace = THREE.SRGBColorSpace;
  outputRenderer.setPixelRatio(1);
  outputRenderer.setSize(outputCanvas.width, outputCanvas.height, false);
  outputRenderer.outputColorSpace = THREE.SRGBColorSpace;
  outputRenderer.setClearColor(0x102018, 1);
  const pool = createProcPlantFiveTierAtlasWebGlCapturePool([captureRenderer]);
  const cache = createProcPlantFiveTierAtlasMemoryCache({ maxEntries: 4, maxDocumentBytes: 4 * 1024 * 1024 });
  const progressPhases: string[] = [];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, outputCanvas.width / outputCanvas.height, 0.1, 20);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const ownedTextures: THREE.Texture[] = [];
  const importedScenes: THREE.Scene[] = [];
  const exportEvidence: Array<{ presetId: string; bytes: number; loadedMeshes: number; defaultSceneMeshes: number }> = [];
  let visualIndex = 0;

  const first = await runProcPlantFiveTierAtlasCatalog(plan, sources, {
    cache,
    capture: pool.capture,
    concurrency: 2,
    maxInFlightAtlasBytes: plan.totalExpectedAtlasBytes,
    onProgress: (event) => progressPhases.push(event.phase),
    adopt: async ({ entry, asset, package: compiled }) => {
      if (compiled.lodSelection.version !== 2 || compiled.atlasAsset?.cacheKey !== entry.cacheKey) {
        throw new Error(`catalog failed to adopt source-bound v2 LODs for ${entry.presetId}`);
      }
      const glb = await exportProcPlantFiveTierLodGlb(compiled, { name: `${entry.presetId}-catalog-lod5` });
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const imported = await new GLTFLoader().parseAsync(glb, "");
      importedScenes.push(...imported.scenes);
      const loadedMeshes = imported.scenes.reduce((count, loadedScene) => {
        loadedScene.traverse((object) => { if (object instanceof THREE.Mesh) count++; });
        return count;
      }, 0);
      let defaultSceneMeshes = 0;
      imported.scene.traverse((object) => { if (object instanceof THREE.Mesh) defaultSceneMeshes++; });
      exportEvidence.push({ presetId: entry.presetId, bytes: glb.byteLength, loadedMeshes, defaultSceneMeshes });

      const texture = createProcPlantImpostorAtlasTexture(asset.atlas);
      ownedTextures.push(texture);
      for (const lod of compiled.lods.slice(3)) {
        const geometry = createProcPlantThreeGeometry(lod.template).geometry;
        geometry.computeBoundingBox();
        geometry.center();
        geometry.computeBoundingSphere();
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          alphaTest: 0.08,
          transparent: true,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        material.forceSinglePass = true;
        const mesh = new THREE.Mesh(geometry, material);
        const radius = Math.max(geometry.boundingSphere?.radius ?? 1, 1e-4);
        mesh.scale.setScalar(0.7 / radius);
        mesh.position.x = -2.25 + visualIndex * 1.5;
        visualIndex++;
        scene.add(mesh);
        ownedGeometries.push(geometry);
        ownedMaterials.push(material);
      }
    },
  });

  outputRenderer.render(scene, camera);
  const pixels = new Uint8Array(outputCanvas.width * outputCanvas.height * 4);
  const outputContext = outputRenderer.getContext();
  outputContext.readPixels(0, 0, outputCanvas.width, outputCanvas.height, outputContext.RGBA, outputContext.UNSIGNED_BYTE, pixels);
  let changedPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 16 || pixels[offset + 1] !== 32 || pixels[offset + 2] !== 24) changedPixels++;
  }

  const second = await runProcPlantFiveTierAtlasCatalog(plan, sources, {
    cache,
    capture: async () => { throw new Error("real WebGL cache-hit run unexpectedly recaptured"); },
    concurrency: 2,
    maxInFlightAtlasBytes: plan.totalExpectedAtlasBytes,
    adopt: ({ package: compiled }) => {
      if (compiled.lodSelection.version !== 2 || !compiled.atlasAsset) throw new Error("cache hit did not adopt v2 LOD asset");
    },
  });

  const changedFern = structuredClone(procPlantPresets.phiFern!) as ProcPlantGenome;
  changedFern.fern!.arch += 0.03125;
  const changedSources = [{ presetId: "phiFern", genome: changedFern, seed: 612072, environment, buildOptions }] as const;
  const changedPlan = createProcPlantFiveTierAtlasCatalogPlan(changedSources, {
    maxEntries: 4,
    maxTotalAtlasBytes: 2 * 1024 * 1024,
  });
  const stale = await runProcPlantFiveTierAtlasCatalog(changedPlan, changedSources, {
    cache,
    capture: pool.capture,
    concurrency: 1,
    maxInFlightAtlasBytes: changedPlan.totalExpectedAtlasBytes,
    adopt: ({ entry, package: compiled }) => {
      if (compiled.atlasAsset?.cacheKey !== entry.cacheKey) throw new Error("stale regeneration adopted the wrong manifest key");
    },
  });

  captureRenderer.renderLists.dispose();
  const captureMemory = { ...captureRenderer.info.memory };
  const poolBeforeDispose = pool.stats();
  const cacheBeforeDispose = cache.stats();
  const gpu = {
    version: outputContext.getParameter(outputContext.VERSION),
    renderer: outputContext.getParameter(outputContext.RENDERER),
  };

  for (const geometry of ownedGeometries) geometry.dispose();
  for (const material of ownedMaterials) material.dispose();
  for (const texture of ownedTextures) texture.dispose();
  for (const loadedScene of importedScenes) loadedScene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    }
  });
  scene.clear();
  pool.dispose();
  const poolAfterDispose = pool.stats();
  cache.dispose();
  const cacheAfterDispose = cache.stats();
  captureRenderer.dispose();
  outputRenderer.dispose();

  const smoke = {
    status: first.counts.adopted === 2 && second.counts.cacheHits === 2
      && stale.counts.staleInvalidated === 1 && changedPixels > 500
      && exportEvidence.every((entry) => entry.loadedMeshes === 5 && entry.defaultSceneMeshes === 1)
      && captureMemory.geometries === 0 && captureMemory.textures === 0 ? "pass" : "fail",
    gpu,
    catalog: {
      cacheKey: plan.cacheKey,
      manifestKeys: plan.entries.map((entry) => ({ presetId: entry.presetId, cacheKey: entry.cacheKey })),
      first: first.counts,
      second: second.counts,
      stale: stale.counts,
      peakActive: first.peakActive,
      peakInFlightAtlasBytes: first.peakInFlightAtlasBytes,
      progressPhases,
    },
    render: { changedPixels, meshes: visualIndex, lodLevels: [3, 4] },
    export: exportEvidence,
    resources: { captureMemory, poolBeforeDispose, poolAfterDispose, cacheBeforeDispose, cacheAfterDispose },
  };
  window.__PROCPLANT_LOD5_CATALOG_BROWSER_SMOKE__ = smoke;
  resultElement.textContent = JSON.stringify(smoke, null, 2);
} catch (error) {
  const smoke = { status: "fail", error: error instanceof Error ? error.stack ?? error.message : String(error) };
  window.__PROCPLANT_LOD5_CATALOG_BROWSER_SMOKE__ = smoke;
  resultElement.textContent = JSON.stringify(smoke, null, 2);
  console.error(error);
}
