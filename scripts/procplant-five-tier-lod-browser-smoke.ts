import * as THREE from "three";
import {
  captureProcPlantFiveTierAtlasAsset,
  compileProcPlantFiveTierLodsFromAtlasAsset,
  createProcPlantFiveTierAtlasBuildManifest,
  parseProcPlantFiveTierAtlasAsset,
  serializeProcPlantFiveTierAtlasAsset,
} from "../src/procplant-five-tier-atlas-build";
import {
  exportProcPlantFiveTierLodGlb,
  selectProcPlantFiveTierLod,
} from "../src/procplant-five-tier-lod";
import {
  createProcPlantImpostorAtlasTexture,
} from "../src/procplant-impostor";
import { createProcPlantThreeGeometry } from "../src/procplant-three-geometry";
import { defaultPlantEnvironment, procPlantPresets } from "../src/procplants";

declare global {
  interface Window {
    __PROCPLANT_LOD5_BROWSER_SMOKE__?: Record<string, unknown>;
  }
}

const result = document.querySelector<HTMLElement>("#result")!;
try {
  const genome = procPlantPresets.phiFern!;
  const seed = 612072;
  const environment = defaultPlantEnvironment();
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x102018, 1);
  const manifest = createProcPlantFiveTierAtlasBuildManifest(genome, seed, environment, {
    width: 32,
    height: 32,
    azimuthCount: 8,
    elevations: [0, Math.PI / 6],
    padding: 2,
    samples: 0,
    maxAtlasSize: 512,
    maxAtlasBytes: 1024 * 1024,
  });
  const captured = await captureProcPlantFiveTierAtlasAsset(renderer, manifest, genome, environment);
  const serialized = serializeProcPlantFiveTierAtlasAsset(captured);
  const restored = parseProcPlantFiveTierAtlasAsset(serialized);
  const atlas = restored.atlas;
  const compiled = compileProcPlantFiveTierLodsFromAtlasAsset(genome, restored, environment);
  const glb = await exportProcPlantFiveTierLodGlb(compiled, { name: "phi-fern-lod5-browser" });
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const imported = await new GLTFLoader().parseAsync(glb, "");
  const loadedMeshes = imported.scenes.reduce(
    (count, loadedScene) => count + loadedScene.children.filter((child) => child instanceof THREE.Mesh).length,
    0,
  );
  const defaultSceneMeshes = imported.scene.children.filter((child) => child instanceof THREE.Mesh).length;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, canvas.width / canvas.height, 0.1, 20);
  camera.position.set(0, 0.9, 4.5);
  camera.lookAt(0, 0.9, 0);
  const texture = createProcPlantImpostorAtlasTexture(atlas);
  const geometries = compiled.lods.slice(3).map((lod) => createProcPlantThreeGeometry(lod.template).geometry);
  const materials = geometries.map(() => new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: 0.08,
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  }));
  for (const material of materials) material.forceSinglePass = true;
  const lod3 = new THREE.Mesh(geometries[0]!, materials[0]!);
  const lod4 = new THREE.Mesh(geometries[1]!, materials[1]!);
  lod3.position.x = -0.9;
  lod4.position.x = 0.9;
  scene.add(lod3, lod4);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  const context = renderer.getContext();
  context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
  let changedPixels = 0;
  let hash = 0x811c9dc5;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 16 || pixels[offset + 1] !== 32 || pixels[offset + 2] !== 24) changedPixels++;
    hash ^= pixels[offset]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= pixels[offset + 1]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= pixels[offset + 2]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const selection = selectProcPlantFiveTierLod(compiled.lodSelection, {
    distance: compiled.lods[4]!.distance + 1,
  });
  const smoke = {
    status: changedPixels > 500 && selection.level === 4 && loadedMeshes === 5 && defaultSceneMeshes === 1 ? "pass" : "fail",
    gpu: {
      version: context.getParameter(context.VERSION),
      renderer: context.getParameter(context.RENDERER),
    },
    changedPixels,
    pixelHash: `fnv1a32-${hash.toString(16).padStart(8, "0")}`,
    drawCalls: renderer.info.render.calls,
    atlas: { width: atlas.width, height: atlas.height, views: atlas.entries.length, coverage: compiled.impostor.viewCoverage },
    asset: {
      cacheKey: restored.cacheKey,
      contentHash: restored.atlas.contentHash,
      documentBytes: new TextEncoder().encode(serialized).byteLength,
      captureApi: restored.capture.api,
      packageCacheKey: compiled.atlasAsset?.cacheKey,
    },
    lods: compiled.lods.map(({ level, triangles, vertices, representation }) => ({ level, triangles, vertices, representation })),
    selectedLevel: selection.level,
    export: { bytes: glb.byteLength, loadedMeshes, defaultSceneMeshes },
  };
  window.__PROCPLANT_LOD5_BROWSER_SMOKE__ = smoke;
  result.textContent = JSON.stringify(smoke, null, 2);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  texture.dispose();
  for (const loadedScene of imported.scenes) loadedScene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    }
  });
  renderer.dispose();
} catch (error) {
  const smoke = { status: "fail", error: error instanceof Error ? error.stack ?? error.message : String(error) };
  window.__PROCPLANT_LOD5_BROWSER_SMOKE__ = smoke;
  result.textContent = JSON.stringify(smoke, null, 2);
  console.error(error);
}
