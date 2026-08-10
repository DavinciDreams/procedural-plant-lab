import * as THREE from "three";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";
import { compileProcPlantMaterialShaderPlan } from "../src/procplant-material-shader";
import {
  createProcPlantThreeMaterialShaderResources,
  installProcPlantThreeMaterialShader,
} from "../src/procplant-three-material-shader";
import {
  addProcPlantSwayAttribute,
  createProcPlantWindShadowMaterials,
  createProcPlantWindUniforms,
  installProcPlantWindShader,
} from "../src/procplant-wind";

declare global {
  interface Window { __PROCPLANT_MATERIAL_SHADER_WEBGL_SMOKE__?: Record<string, unknown>; }
}

const hash = (bytes: Uint8Array) => {
  let value = 0x811c9dc5;
  for (const byte of bytes) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  return value.toString(16).padStart(8, "0");
};
const changedBytes = (left: Uint8Array, right: Uint8Array) => left.reduce((count, byte, index) => count + (byte === right[index] ? 0 : 1), 0);

try {
  const graph: ProcPlantMaterialGraph = {
    contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
    version: PROCPLANT_MATERIAL_GRAPH_VERSION,
    id: "browser-shader-smoke",
    textures: [],
    nodes: [
      { id: "red", kind: "color", value: [0.9, 0.03, 0.02] },
      { id: "blue", kind: "color", value: [0.03, 0.12, 0.85] },
      { id: "noise", kind: "noise", noise: "fbm", seed: 91, scale: 5, octaves: 3, lacunarity: 2, gain: 0.5 },
      { id: "color", kind: "mix", a: "red", b: "blue", factor: "noise" },
      { id: "rough", kind: "scalar", value: 0.62 },
      { id: "metal", kind: "scalar", value: 0 },
    ],
    surfaces: [{ slot: "leaf", channels: { baseColor: "color", roughness: "rough", metalness: "metal" }, doubleSided: true }],
  };
  const plan = compileProcPlantMaterialShaderPlan(compileProcPlantMaterialGraph(graph));
  if (!plan.ready) throw new Error("browser shader fixture did not compile");
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(192, 192, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const target = new THREE.WebGLRenderTarget(192, 192, { depthBuffer: true });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ab2c5);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  camera.position.set(3.1, 2.4, 4.8);
  camera.lookAt(0, 0.9, 0);
  scene.add(new THREE.HemisphereLight(0xddeeff, 0x25311f, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.set(-2.5, 4.5, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(256, 256);
  sun.shadow.camera.left = -3; sun.shadow.camera.right = 3; sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -1;
  sun.shadow.camera.near = 0.1; sun.shadow.camera.far = 12;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0xb8b09a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const geometry = new THREE.PlaneGeometry(1.4, 2.2, 6, 10);
  geometry.translate(0, 1.15, 0);
  addProcPlantSwayAttribute(geometry);
  const wind = createProcPlantWindUniforms(0.42);
  const material = installProcPlantWindShader(new THREE.MeshStandardMaterial({ color: 0x2f8b36, roughness: 0.9, side: THREE.DoubleSide }), wind);
  const leaf = new THREE.Mesh(geometry, material);
  leaf.position.set(0, 0.02, 0);
  leaf.castShadow = true;
  leaf.receiveShadow = true;
  const shadowMaterials = createProcPlantWindShadowMaterials(wind);
  leaf.customDepthMaterial = shadowMaterials.depth;
  leaf.customDistanceMaterial = shadowMaterials.distance;
  scene.add(leaf);
  const pixels = new Uint8Array(192 * 192 * 4);
  const render = () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 192, 192, pixels);
    return pixels.slice();
  };
  wind.time.value = 0;
  const bakedPixels = render();
  const resources = createProcPlantThreeMaterialShaderResources(plan, []);
  const installation = installProcPlantThreeMaterialShader(material, plan, "leaf", resources);
  const shaderPixels = render();
  leaf.castShadow = false;
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  const noShadowPixels = render();
  leaf.castShadow = true;
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  wind.time.value = 1.7;
  const windPixels = render();
  const result = {
    status: "pass",
    renderer: renderer.capabilities.isWebGL2 ? "WebGL2" : "WebGL1",
    planHash: plan.contentHash,
    cacheKey: installation.cacheKey,
    hashes: { baked: hash(bakedPixels), shader: hash(shaderPixels), noShadow: hash(noShadowPixels), wind: hash(windPixels) },
    changed: {
      shader: changedBytes(bakedPixels, shaderPixels),
      shadow: changedBytes(shaderPixels, noShadowPixels),
      wind: changedBytes(shaderPixels, windPixels),
    },
  };
  if (result.changed.shader < 500) throw new Error(`generated shader changed only ${result.changed.shader} framebuffer bytes`);
  if (result.changed.shadow < 50) throw new Error(`shadow toggle changed only ${result.changed.shadow} framebuffer bytes`);
  if (result.changed.wind < 50) throw new Error(`wind update changed only ${result.changed.wind} framebuffer bytes`);
  installation.dispose();
  resources.dispose();
  shadowMaterials.depth.dispose();
  shadowMaterials.distance.dispose();
  geometry.dispose();
  material.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  target.dispose();
  renderer.dispose();
  window.__PROCPLANT_MATERIAL_SHADER_WEBGL_SMOKE__ = result;
} catch (error) {
  console.error(error);
  window.__PROCPLANT_MATERIAL_SHADER_WEBGL_SMOKE__ = { status: "fail", error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) };
}
