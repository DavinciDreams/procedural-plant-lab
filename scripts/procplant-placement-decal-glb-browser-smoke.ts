import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { encodeProcPlantImpostorPng } from "../src/procplant-impostor-image";
import {
  PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT,
  PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION,
  appendProcPlantOrganPlacement,
  applyProcPlantOrganPlacementOverrides,
  createProcPlantOrganPlacementPackage,
  createProcPlantOrganPlacementTarget,
} from "../src/procplant-organ-placement-overrides";
import {
  createProcPlantPlacementDecalPixelSource,
  exportProcPlantSceneGlbWithPlacementDecals,
} from "../src/procplant-placement-decal-glb";
import type { ProcPlantGraph } from "../src/procplants";

declare global {
  interface Window { __PROCPLANT_DECAL_GLB_BROWSER_SMOKE__?: Record<string, unknown>; }
}

const output = document.querySelector<HTMLElement>("#result")!;
try {
  const graph: ProcPlantGraph = {
    stems: [
      { position: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.15, depth: 0, t: 0, index: 0 },
      { position: new THREE.Vector3(0, 1, 0), direction: new THREE.Vector3(0, 1, 0), radius: 0.12, depth: 0, t: 1, index: 1 },
    ],
    segments: [[0, 1]],
    segmentRecords: [{ id: "trunk:0", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 1 }],
    organs: [],
    attachments: [],
  };
  const target = createProcPlantOrganPlacementTarget("browser-decal", 19, graph);
  const binding = {
    contract: PROCPLANT_PLACEMENT_DECAL_BINDING_CONTRACT,
    version: PROCPLANT_PLACEMENT_DECAL_BINDING_VERSION,
    materialId: "browser-decal-material",
    textureId: "browser-decal-texture",
    uvSet: 0,
    uvRect: [0, 0, 1, 1],
  } as const;
  const appended = appendProcPlantOrganPlacement(createProcPlantOrganPlacementPackage(target), {
    kind: "decal", segmentId: "trunk:0", axialT: 0.5, azimuth: 0, scale: 0.75, decal: binding,
  });
  const applied = applyProcPlantOrganPlacementOverrides(graph, target, appended.package, { decalBindings: [binding] });
  const rgba = Uint8Array.of(
    240, 55, 20, 255, 220, 35, 15, 255,
    250, 160, 30, 255, 235, 70, 20, 255,
  );
  const source = await createProcPlantPlacementDecalPixelSource({
    binding,
    sourceMimeType: "image/png",
    sourceName: "browser-real-pixels.png",
    sourceBytes: encodeProcPlantImpostorPng(rgba, 2, 2),
    width: 2,
    height: 2,
    rgba,
  });
  const scene = new THREE.Scene();
  const baseGeometry = new THREE.BoxGeometry(0.22, 1, 0.22);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x72513b, roughness: 0.9 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.5;
  base.name = "browser-trunk";
  scene.add(base);
  const glb = await exportProcPlantSceneGlbWithPlacementDecals(scene, applied.decals, source);
  const imported = await new GLTFLoader().parseAsync(glb.bytes, "");
  let decalMesh: THREE.Mesh | null = null;
  imported.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => material.name === binding.materialId)) decalMesh = object;
  });
  if (!decalMesh) throw new Error("GLTFLoader did not import the bound decal primitive");
  const typedDecalMesh = decalMesh as THREE.Mesh;
  const loadedMaterial = typedDecalMesh.material as THREE.MeshStandardMaterial;
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(256, 256, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x101010, 1);
  imported.scene.add(new THREE.AmbientLight(0xffffff, 2.5));
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10);
  camera.position.set(0, 0.5, 2.2);
  camera.lookAt(0, 0.5, 0);
  renderer.render(imported.scene, camera);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(256 * 256 * 4);
  gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let changedPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 16 || pixels[offset + 1] !== 16 || pixels[offset + 2] !== 16) changedPixels++;
  }
  const smoke = {
    status: changedPixels > 100 && typedDecalMesh.geometry.getAttribute("uv").count === 4
      && typedDecalMesh.geometry.index?.count === 6 && Boolean(loadedMaterial.map) ? "pass" : "fail",
    glbBytes: glb.bytes.byteLength,
    contentHash: glb.contentHash,
    draws: glb.draws,
    vertices: glb.vertices,
    triangles: glb.triangles,
    embeddedBytes: glb.embeddedBytes,
    loadedMaterial: loadedMaterial.name,
    loadedTexture: Boolean(loadedMaterial.map?.isTexture),
    loadedUvPairs: typedDecalMesh.geometry.getAttribute("uv").count,
    loadedIndices: typedDecalMesh.geometry.index?.count ?? 0,
    changedPixels,
    glError: gl.getError(),
    gpu: { version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER) },
  };
  window.__PROCPLANT_DECAL_GLB_BROWSER_SMOKE__ = smoke;
  output.textContent = JSON.stringify(smoke, null, 2);
  renderer.dispose();
  imported.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    }
  });
  baseGeometry.dispose();
  baseMaterial.dispose();
} catch (error) {
  const smoke = { status: "fail", error: error instanceof Error ? error.stack ?? error.message : String(error) };
  window.__PROCPLANT_DECAL_GLB_BROWSER_SMOKE__ = smoke;
  output.textContent = JSON.stringify(smoke, null, 2);
  console.error(error);
}
