import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  PROCPLANT_BIOME_OPTIONS,
  entryFromProcPlantLabExport,
  genomeForMixEntry,
  isAssetMixEntry,
  labelForProcPlantId,
  makeEcologyBiomeMix,
  normalizeBiomeMixDefinition,
  type ProcPlantBiomeMixDefinition,
  type ProcPlantBiomeMixEntry,
} from "./biome-mix";
import {
  buildProcPlantObject,
  procPlantPresets,
  type ProcPlantBiomeId,
  type ProcPlantGenome,
} from "./procplants";
import {
  allProcPlantPresetIds,
  installSavedProcPlantPresets,
  saveProcPlantPreset,
  savedPresetLabelMap,
} from "./saved-presets";
import { SPECIES, type SpeciesId } from "./vendor/proc-tree/index";

const biomeSwatchColors: Record<ProcPlantBiomeId, [number, number]> = {
  "tropical-rain-forest": [0x1f5b35, 0x61a044],
  "temperate-rain-forest": [0x315f38, 0x8bb56b],
  desert: [0xd6a15e, 0xf0c578],
  tundra: [0x9aa889, 0xd8e2dc],
  taiga: [0x244d42, 0x5d7f63],
  grassland: [0x5f9638, 0x9fcf58],
  savanna: [0xa88742, 0xd0b65c],
  estuary: [0x477b6b, 0x8ba880],
  coastal: [0x6f9db2, 0xe6d09a],
  "arctic-alpine": [0xa9b8bf, 0xf4fbff],
};

const root = document.getElementById("biome-mixer-root");
if (!root) throw new Error("Missing #biome-mixer-root");

installSavedProcPlantPresets();

let currentMix = makeEcologyBiomeMix("taiga");
let selectedEntryId = currentMix.entries[0]?.id ?? "";
let selectedPresetId = "blueSpruce";
let selectedWeberPennSpecies = "balsamFir";
let selectedImportedAssetId = "";
let jsonVisible = false;
let statusText = "Ready.";
const weberPennSpeciesIds = Object.keys(SPECIES).sort() as SpeciesId[];
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
const ktx2Loader = new KTX2Loader();
const importedAssets = new Map<string, THREE.Object3D>();
const importedAssetOptions: Array<{ id: string; label: string; name: string }> = [];

root.innerHTML = `
  <main class="biome-page">
    <header class="biome-header">
      <div>
        <h1>Biome Mixer</h1>
        <p>Compose multi-plant communities from Procplants ecology profiles, genome presets, and exported mutation JSON.</p>
      </div>
      <nav>
        <a href="/">Plant Lab</a>
      </nav>
    </header>
    <section class="biome-toolbar" aria-label="Biome mixer controls">
      <select id="ecology-select" class="state-select" aria-hidden="true"></select>
      <label>
        Density
        <input id="density-slider" type="range" min="0.05" max="1.8" value="0.72" step="0.01" />
        <output id="density-output">0.72</output>
      </label>
      <label>
        Diversity
        <input id="diversity-slider" type="range" min="0.1" max="1" value="0.82" step="0.01" />
        <output id="diversity-output">0.82</output>
      </label>
      <label>
        Target verts/chunk
        <input id="vertex-target-input" type="number" min="10000" max="5000000" value="250000" step="10000" />
      </label>
      <dl class="budget-stats" aria-label="Biome render budget">
        <div><dt>Rendered</dt><dd id="rendered-output">-</dd></div>
        <div><dt>Target</dt><dd id="vertex-target-output">-</dd></div>
        <div><dt>Current</dt><dd id="vertex-current-output">-</dd></div>
      </dl>
      <div class="button-row">
        <button type="button" id="import-button">Import JSON</button>
        <button type="button" id="import-glb-button">Import GLB</button>
        <button type="button" id="export-button">Export Mix</button>
        <button type="button" id="json-toggle-button" aria-pressed="false">Show JSON</button>
        <input id="file-input" type="file" accept="application/json,.json" multiple hidden />
        <input id="glb-input" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" multiple hidden />
      </div>
    </section>
    <section class="swatch-board" aria-label="Biome presets">
      <h2>Biome</h2>
      <div class="swatch-grid" id="ecology-swatch-grid"></div>
    </section>
    <section class="workspace json-hidden" id="workspace">
      <aside class="entry-panel">
        <div class="panel-title">
          <h2 id="mix-title">Taiga</h2>
          <span id="mix-count">0 plants</span>
        </div>
        <div class="entry-list" id="entry-list"></div>
        <div class="entry-editor" id="entry-editor"></div>
      </aside>
      <section class="stage-panel">
        <canvas id="biome-canvas" aria-label="Biome mix preview"></canvas>
      </section>
      <aside class="json-panel">
        <div class="panel-title">
          <h2>Loader JSON</h2>
          <span id="status-output">Ready.</span>
        </div>
        <textarea id="json-output" spellcheck="false"></textarea>
      </aside>
    </section>
  </main>
`;

const style = document.createElement("style");
style.textContent = `
  :root {
    color: #07111f;
    background: #eef2f4;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 980px; background: #eef2f4; }
  .biome-page { min-height: 100vh; padding: 22px 28px 28px; }
  .biome-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
  h1, h2 { margin: 0; line-height: 1.08; }
  h1 { font-size: 32px; }
  h2 { font-size: 18px; }
  p { margin: 8px 0 0; color: #4b5563; font-size: 17px; }
  nav, .button-row, .add-row { display: flex; gap: 8px; align-items: end; }
  a, button, select {
    border: 1px solid #c6d0dc;
    border-radius: 8px;
    background: #fff;
    color: #07111f;
    font: inherit;
    font-weight: 800;
  }
  a { padding: 10px 12px; text-decoration: none; }
  button { padding: 10px 12px; cursor: pointer; }
  button.active { background: #17341f; color: #f6edbd; border-color: #8b9657; }
  select { height: 42px; padding: 0 10px; min-width: 150px; }
  label {
    display: grid;
    gap: 7px;
    color: #334155;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0;
  }
  input[type="range"] { width: 100%; accent-color: #335f31; }
  input[type="color"] { min-height: 38px; border: 1px solid #c6d0dc; border-radius: 8px; background: #fff; }
  output { color: #07111f; font-size: 15px; text-transform: none; }
  .state-select { display: none; }
  .biome-toolbar {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr) 170px minmax(330px, 1.4fr) auto;
    gap: 12px;
    align-items: end;
    margin-bottom: 12px;
    padding: 12px;
    border: 1px solid #d4dbe4;
    border-radius: 8px;
    background: rgba(255,255,255,0.78);
  }
  .swatch-board {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    border: 1px solid #d4dbe4;
    border-radius: 8px;
    background: rgba(255,255,255,0.78);
    padding: 8px 10px;
    margin-bottom: 10px;
  }
  .swatch-board h2 {
    margin: 0;
    font-size: 14px;
    text-transform: uppercase;
    color: #334155;
  }
  .swatch-grid {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 6px;
  }
  .swatch-button {
    min-height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 6px;
    text-align: center;
  }
  .swatch-button.active { color: #f6edbd; border-color: #8b9657; }
  .swatch-label {
    font-size: 11px;
    line-height: 1.15;
    font-weight: 900;
    white-space: normal;
    text-shadow: 0 1px 2px rgba(255,255,255,0.5);
  }
  .swatch-button.active .swatch-label { text-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  .workspace {
    display: grid;
    grid-template-columns: 330px minmax(520px, 1fr) 360px;
    gap: 16px;
    height: calc(100vh - 288px);
    min-height: 360px;
  }
  .workspace.json-hidden { grid-template-columns: 330px minmax(680px, 1fr); }
  .workspace.json-hidden .json-panel { display: none; }
  .entry-panel, .stage-panel, .json-panel {
    border: 1px solid #d4dbe4;
    border-radius: 8px;
    background: #fff;
    overflow: hidden;
  }
  .entry-panel {
    display: grid;
    grid-template-rows: auto 94px minmax(0, 1fr);
    min-height: 0;
  }
  .panel-title {
    min-height: 58px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid #e6ebf0;
  }
  .panel-title span { color: #64748b; font-size: 13px; font-weight: 800; }
  .entry-list {
    height: 94px;
    overflow: auto;
    border-bottom: 1px solid #e6ebf0;
  }
  .entry-card {
    width: 100%;
    display: grid;
    grid-template-columns: 24px 1fr 58px;
    gap: 10px;
    align-items: center;
    padding: 8px 12px;
    border: 0;
    border-bottom: 1px solid #edf1f5;
    border-radius: 0;
    text-align: left;
  }
  .entry-card.active { background: #eef7ed; }
  .entry-card.disabled { opacity: 0.48; }
  .plant-dot { width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.22); }
  .entry-name { display: block; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .entry-meta { display: block; margin-top: 2px; color: #64748b; font-size: 12px; font-weight: 700; }
  .entry-score { color: #334155; font-size: 12px; font-weight: 900; text-align: right; }
  .add-row { padding: 0; border-bottom: 0; display: grid; grid-template-columns: minmax(0, 1fr) 58px; gap: 8px; align-items: end; }
  .add-row label { flex: 1; }
  .add-row select { width: 100%; }
  .entry-editor { min-height: 0; max-height: 100%; padding: 10px; display: grid; gap: 8px; overflow-y: auto; overflow-x: hidden; align-content: start; }
  .entry-editor .inline { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .entry-editor .danger { border-color: #e2b4aa; color: #7f1d1d; }
  .entry-editor label { gap: 5px; }
  .entry-editor select,
  .entry-editor input:not([type="range"]),
  .entry-editor button {
    min-height: 34px;
    min-width: 0;
    width: 100%;
  }
  .entry-editor input:not([type="range"]) {
    border: 1px solid #c6d0dc;
    border-radius: 8px;
    padding: 0 10px;
    font: inherit;
    font-weight: 800;
  }
  .weber-editor {
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid #d7e1d2;
    border-radius: 8px;
    background: #f7fbf3;
  }
  .weber-editor h3 {
    margin: 0;
    font-size: 14px;
    line-height: 1.2;
  }
  .weber-editor details {
    border-top: 1px solid #dce8d7;
    padding-top: 6px;
  }
  .weber-editor summary {
    cursor: pointer;
    color: #334155;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }
  .weber-editor details .inline,
  .weber-editor details label {
    margin-top: 8px;
  }
  .editor-actions {
    position: sticky;
    bottom: -10px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 8px 0 0;
    background: linear-gradient(to bottom, rgba(255,255,255,0), #fff 18%);
  }
  .stage-panel { position: relative; min-height: 0; }
  #biome-canvas { width: 100%; height: 100%; display: block; background: #dfe9ee; }
  .budget-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 0;
    padding: 0;
  }
  .budget-stats div {
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid rgba(21, 38, 25, 0.28);
    border-radius: 8px;
    background: rgba(246, 250, 244, 0.88);
  }
  dl div { min-width: 0; }
  dt { color: #64748b; font-size: 11px; font-weight: 900; text-transform: uppercase; }
  dd { margin: 2px 0 0; color: #07111f; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  dd.over-budget { color: #9f1239; }
  .json-panel { display: grid; grid-template-rows: auto 1fr; }
  textarea {
    width: 100%;
    min-height: 100%;
    resize: none;
    border: 0;
    padding: 14px;
    background: #0c1218;
    color: #d9f0dc;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  }
`;
document.head.appendChild(style);

const ecologySelect = document.querySelector<HTMLSelectElement>("#ecology-select")!;
const densitySlider = document.querySelector<HTMLInputElement>("#density-slider")!;
const diversitySlider = document.querySelector<HTMLInputElement>("#diversity-slider")!;
const vertexTargetInput = document.querySelector<HTMLInputElement>("#vertex-target-input")!;
const densityOutput = document.querySelector<HTMLOutputElement>("#density-output")!;
const diversityOutput = document.querySelector<HTMLOutputElement>("#diversity-output")!;
const entryList = document.querySelector<HTMLDivElement>("#entry-list")!;
const entryEditor = document.querySelector<HTMLDivElement>("#entry-editor")!;
const mixTitle = document.querySelector<HTMLHeadingElement>("#mix-title")!;
const mixCount = document.querySelector<HTMLSpanElement>("#mix-count")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const glbInput = document.querySelector<HTMLInputElement>("#glb-input")!;
const jsonOutput = document.querySelector<HTMLTextAreaElement>("#json-output")!;
const statusOutput = document.querySelector<HTMLSpanElement>("#status-output")!;
const renderedOutput = document.querySelector<HTMLElement>("#rendered-output")!;
const vertexTargetOutput = document.querySelector<HTMLElement>("#vertex-target-output")!;
const vertexCurrentOutput = document.querySelector<HTMLElement>("#vertex-current-output")!;
const canvas = document.querySelector<HTMLCanvasElement>("#biome-canvas")!;
const workspace = document.querySelector<HTMLElement>("#workspace")!;
const ecologySwatchGrid = document.querySelector<HTMLDivElement>("#ecology-swatch-grid")!;
const jsonToggleButton = document.querySelector<HTMLButtonElement>("#json-toggle-button")!;

ecologySelect.innerHTML = PROCPLANT_BIOME_OPTIONS.map(
  (id) => `<option value="${id}">${labelForProcPlantId(id)}</option>`,
).join("");
const presetLabel = (id: string): string =>
  savedPresetLabelMap()[id] ?? labelForProcPlantId(id);
const renderPresetOptions = (presetSelect: HTMLSelectElement) => {
  presetSelect.innerHTML = allProcPlantPresetIds().map(
    (id) => `<option value="${id}">${presetLabel(id)}</option>`,
  ).join("");
  if (!procPlantPresets[selectedPresetId]) selectedPresetId = "blueSpruce";
  presetSelect.value = selectedPresetId;
};
ecologySelect.value = currentMix.ecologyBiome ?? "taiga";

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
dracoLoader.setDecoderPath("/node_modules/three/examples/jsm/libs/draco/gltf/");
ktx2Loader.setTranscoderPath("/node_modules/three/examples/jsm/libs/basis/");
ktx2Loader.detectSupport(renderer);
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setKTX2Loader(ktx2Loader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe9ee);
scene.fog = new THREE.Fog(0xdfe9ee, 65, 190);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
camera.position.set(30, 20, 34);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.maxDistance = 140;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a876f, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(28, 48, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120, 24, 24),
  new THREE.MeshLambertMaterial({ color: 0x8ab36a }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const groundMaterial = ground.material as THREE.MeshLambertMaterial;
const previewGroup = new THREE.Group();
scene.add(previewGroup);

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose?.();
  });
};

const disposeImportedAssetInstance = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    if (Array.isArray(material)) {
      material.forEach((item) => {
        if (item.userData.importedAssetMaterial) item.dispose();
      });
    } else if (material?.userData.importedAssetMaterial) {
      material.dispose();
    }
  });
};

const prepareImportedAsset = (object: THREE.Object3D): THREE.Object3D => {
  const model = object.clone(true);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxSide = Math.max(size.x, size.y, size.z, 1e-4);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const rootObject = new THREE.Group();
  rootObject.name = object.name || "Imported GLB";
  model.position.set(-center.x, -box.min.y, -center.z);
  rootObject.add(model);
  rootObject.scale.setScalar(1 / maxSide);
  rootObject.updateMatrixWorld(true);
  const groundedBox = new THREE.Box3().setFromObject(rootObject);
  rootObject.position.y -= groundedBox.min.y;
  rootObject.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return rootObject;
};

const tintMaterial = (material: THREE.Material, color: number | undefined): THREE.Material => {
  const cloned = material.clone();
  cloned.userData.importedAssetMaterial = true;
  if (color !== undefined && "color" in cloned) {
    (cloned as THREE.Material & { color: THREE.Color }).color.set(color);
  }
  return cloned;
};

const cloneImportedAssetInstance = (prototype: THREE.Object3D, color: number | undefined): THREE.Object3D => {
  const instance = prototype.clone(true);
  instance.userData.importedAssetClone = true;
  instance.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => tintMaterial(material, color))
      : tintMaterial(mesh.material, color);
  });
  return instance;
};

const loadGlbFile = async (file: File): Promise<THREE.Object3D> => {
  const url = URL.createObjectURL(file);
  try {
    const gltf = await gltfLoader.loadAsync(url);
    return prepareImportedAsset(gltf.scene);
  } finally {
    URL.revokeObjectURL(url);
  }
};

const updateStatus = (message: string) => {
  statusText = message;
  statusOutput.textContent = message;
};

const importErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/No DRACOLoader|draco/i.test(message)) return "Draco-compressed GLB could not be decoded.";
  if (/Meshopt|meshopt/i.test(message)) return "Meshopt-compressed GLB could not be decoded.";
  if (/KTX2|ktx2|Basis/i.test(message)) return "KTX2 texture-compressed GLB could not be decoded.";
  if (/Failed to load buffer|Failed to load texture|missing URI/i.test(message)) return "GLTF has external files; try a self-contained .glb.";
  return message.slice(0, 140);
};

const askPresetName = (fallback: string): string | null => {
  const name = window.prompt("Save preset as", fallback);
  if (name === null) return null;
  return name.trim() || null;
};

const flashButtonText = (button: HTMLButtonElement, text: string) => {
  const original = button.textContent ?? "";
  button.textContent = text;
  window.setTimeout(() => {
    if (button.textContent === text) button.textContent = original;
  }, 1800);
};

const formatCount = (value: number): string =>
  value >= 1000000
    ? `${(value / 1000000).toFixed(2)}m`
    : value >= 1000
      ? `${Math.round(value / 1000)}k`
      : String(Math.round(value));

const colorCss = (value: number): string => `#${value.toString(16).padStart(6, "0").slice(-6)}`;

const toHexColor = (value: number | undefined, fallback: number): string =>
  `#${(value ?? fallback).toString(16).padStart(6, "0").slice(-6)}`;

const fromHexColor = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const slug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";

const swatchStyle = (biome: ProcPlantBiomeId): string => {
  const [a, b] = biomeSwatchColors[biome];
  return `background: linear-gradient(135deg, ${colorCss(a)}, ${colorCss(b)});`;
};

const updatePreviewTerrain = () => {
  const biome = currentMix.ecologyBiome ?? currentMix.sample.biome ?? "grassland";
  const [a, b] = biomeSwatchColors[biome];
  groundMaterial.color.set(a).lerp(new THREE.Color(b), 0.36);
  groundMaterial.needsUpdate = true;
};

const geometryVertexCount = (object: THREE.Object3D): number => {
  let total = 0;
  object.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry;
    const position = geometry?.getAttribute("position");
    if (position) total += position.count;
  });
  return total;
};

const selectedEntry = () => currentMix.entries.find((entry) => entry.id === selectedEntryId) ?? currentMix.entries[0];

const colorForEntry = (entry: ProcPlantBiomeMixEntry): number => {
  if (isAssetMixEntry(entry)) return 0x6b7f4c;
  const genome = genomeForMixEntry(entry);
  return genome.flower?.color ?? genome.leaf.colorA ?? 0x4f7a39;
};

const metaForEntry = (entry: ProcPlantBiomeMixEntry): string => {
  if (isAssetMixEntry(entry)) {
    return importedAssets.has(entry.asset.libraryId ?? entry.id) ? "GLB asset" : "GLB asset missing";
  }
  return entry.source === "preset" ? presetLabel(entry.presetId ?? "") : "custom genome";
};

const renderSwatches = () => {
  ecologySwatchGrid.innerHTML = PROCPLANT_BIOME_OPTIONS.map((id) => `
    <button type="button" class="swatch-button ${currentMix.ecologyBiome === id ? "active" : ""}" data-ecology="${id}" style="${swatchStyle(id)}">
      <span class="swatch-label">${labelForProcPlantId(id)}</span>
    </button>
  `).join("");
  ecologySwatchGrid.querySelectorAll<HTMLButtonElement>("[data-ecology]").forEach((button) => {
    button.addEventListener("click", () => loadEcologyBiome(button.dataset.ecology as ProcPlantBiomeId));
  });
};

const cloneGenome = (genome: ProcPlantGenome): ProcPlantGenome =>
  typeof structuredClone === "function"
    ? structuredClone(genome)
    : JSON.parse(JSON.stringify(genome)) as ProcPlantGenome;

const templatePresetForSpecies = (species: SpeciesId): string => {
  const id = species.toLowerCase();
  if (id.includes("fir") || id.includes("pine")) return "blueSpruce";
  if (id.includes("douglas") || id.includes("larch")) return "redwoodSpire";
  if (id.includes("birch") || id.includes("aspen") || id.includes("poplar")) return "birchGrove";
  if (id.includes("palm")) return "foldedPalm";
  if (id.includes("bamboo")) return "bambooClump";
  if (id.includes("tupelo")) return "mangroveRoots";
  if (id.includes("sassafras")) return "acaciaUmbrella";
  return "oakCanopy";
};

const makeWeberPennGenome = (species: SpeciesId, seed: number): ProcPlantGenome => {
  const base = cloneGenome(procPlantPresets[templatePresetForSpecies(species)] ?? procPlantPresets.oakCanopy);
  const conifer = /fir|pine|douglas|larch/i.test(species);
  const palm = /palm/i.test(species);
  const bamboo = /bamboo/i.test(species);
  base.id = `weberPenn-${species}`;
  base.habit = conifer ? "conifer" : palm ? "palm" : bamboo ? "grass" : "tree";
  base.weberPenn = {
    species,
    nativeLeaves: true,
    crownFill: false,
    foliageSource: "species",
    fillAnchor: "leaf-sites",
    maxBranchDepth: base.weberPenn?.maxBranchDepth ?? 3,
    maxStems: base.weberPenn?.maxStems ?? (conifer ? 96 : 80),
    maxLeaves: base.weberPenn?.maxLeaves ?? (conifer ? 220 : 190),
    leafScaleMultiplier: base.weberPenn?.leafScaleMultiplier ?? (conifer ? 4.2 : 3.2),
    radialSegments: base.weberPenn?.radialSegments ?? 4,
    branchSamples: base.weberPenn?.branchSamples ?? 2,
    barkColor: base.weberPenn?.barkColor ?? (palm ? 0x7a5630 : 0x5d4327),
    leafColor: base.weberPenn?.leafColor ?? base.leaf.colorA,
  };
  base.foliage = {
    mass: 0,
    clusterDensity: base.foliage?.clusterDensity ?? (conifer ? 1.08 : 1.12),
    whorlDensity: base.foliage?.whorlDensity ?? (conifer ? 0.58 : 0.48),
    tipBias: base.foliage?.tipBias ?? (conifer ? 0.34 : 0.62),
    size: base.foliage?.size ?? (conifer ? 0.32 : 0.54),
  };
  base.treeRealism = {
    crownSpread: base.treeRealism?.crownSpread ?? (conifer ? 0.36 : 0.72),
    crownTaper: base.treeRealism?.crownTaper ?? (conifer ? 0.9 : 0.34),
    trunkFlare: base.treeRealism?.trunkFlare ?? 0.34,
    trunkBend: base.treeRealism?.trunkBend ?? 0.14,
    branchGnarl: base.treeRealism?.branchGnarl ?? 0.22,
    windFlex: base.treeRealism?.windFlex ?? 0.48,
    colorVariance: base.treeRealism?.colorVariance ?? 0.14,
  };
  base.phyllotaxisAngle += (seed % 17) * 0.0003;
  return base;
};

const makeWeberPennEntry = (species: SpeciesId): ProcPlantBiomeMixEntry => {
  const seed = currentMix.seed ^ ((currentMix.entries.length + 1) * 0x45d9f3b);
  const genome = makeWeberPennGenome(species, seed);
  return {
    id: `weber-penn-${species}-${Date.now().toString(36)}`,
    label: labelForProcPlantId(species),
    source: "mutation",
    genome,
    weight: 1,
    density: 0.34,
    scale: 8,
    environment: currentMix.entries[0]?.environment ?? { light: 0.8, moisture: 0.55, crowding: 0.32, biomeWarmth: 0.62 },
    seed,
    enabled: true,
  };
};

const normalizedEnabledEntries = () =>
  currentMix.entries.filter((entry) => entry.enabled && Math.max(0, entry.weight) > 0);

const editableGenomeForEntry = (entry: ProcPlantBiomeMixEntry): ProcPlantGenome => {
  if (!entry.genome) {
    entry.genome = cloneGenome(genomeForMixEntry(entry));
    entry.source = "mutation";
    entry.presetId = undefined;
  }
  return entry.genome;
};

const weberFoliageMode = (genome: ProcPlantGenome): "plain" | "procplants" | "conifer" | "mixed" => {
  const nativeLeaves = genome.weberPenn?.nativeLeaves !== false;
  const crownFill = genome.weberPenn?.crownFill === true ||
    (genome.weberPenn?.crownFill === undefined && Boolean(genome.weberPenn?.foliageSource && genome.weberPenn.foliageSource !== "species"));
  const mass = crownFill ? genome.foliage?.mass ?? 0 : 0;
  const source = genome.weberPenn?.foliageSource ?? "species";
  if (nativeLeaves && mass <= 0.001) return "plain";
  if (!nativeLeaves && mass > 0.001 && source === "procplants") return "procplants";
  if (!nativeLeaves && mass > 0.001 && source === "conifer-spray") return "conifer";
  return "mixed";
};

const applyWeberFoliageMode = (
  genome: ProcPlantGenome,
  mode: "plain" | "procplants" | "conifer" | "mixed",
) => {
  genome.weberPenn = genome.weberPenn ?? { species: "balsamFir" as SpeciesId };
  genome.foliage = genome.foliage ?? { mass: 0, clusterDensity: 1.1, whorlDensity: 0.55, tipBias: 0.5, size: 0.4 };
  if (mode === "plain") {
    genome.weberPenn.nativeLeaves = true;
    genome.weberPenn.crownFill = false;
    genome.weberPenn.foliageSource = "species";
    genome.foliage.mass = 0;
    return;
  }
  if (mode === "procplants") {
    genome.weberPenn.nativeLeaves = false;
    genome.weberPenn.crownFill = true;
    genome.weberPenn.foliageSource = "procplants";
    genome.weberPenn.fillAnchor = genome.weberPenn.fillAnchor ?? "leaf-sites";
    genome.foliage.mass = Math.max(0.45, genome.foliage.mass);
    genome.foliage.clusterDensity = Math.min(genome.foliage.clusterDensity, 1.35);
    genome.foliage.size = Math.min(genome.foliage.size ?? 0.5, 0.58);
    return;
  }
  if (mode === "conifer") {
    genome.weberPenn.nativeLeaves = false;
    genome.weberPenn.crownFill = true;
    genome.weberPenn.foliageSource = "conifer-spray";
    genome.weberPenn.fillAnchor = genome.weberPenn.fillAnchor ?? "leaf-sites";
    genome.foliage.mass = Math.max(0.42, genome.foliage.mass);
    genome.foliage.clusterDensity = Math.min(genome.foliage.clusterDensity, 1.25);
    genome.foliage.whorlDensity = Math.min(genome.foliage.whorlDensity, 0.72);
    genome.foliage.size = Math.min(genome.foliage.size ?? 0.34, 0.38);
  }
};

const addPresetEntry = () => {
  const id = selectedPresetId;
  const genome = genomeForMixEntry({
    id,
    label: id,
    source: "preset",
    presetId: id,
    weight: 1,
    density: 0.45,
    scale: 1,
    environment: currentMix.entries[0]?.environment ?? { light: 0.8, moisture: 0.55, crowding: 0.32, biomeWarmth: 0.62 },
    seed: currentMix.seed ^ currentMix.entries.length,
    enabled: true,
  });
  const entry: ProcPlantBiomeMixEntry = {
    id: `${id}-${Date.now().toString(36)}`,
    label: presetLabel(id),
    source: "preset",
    presetId: id,
    weight: 1,
    density: 0.45,
    scale: genome.habit === "tree" || genome.habit === "conifer" || genome.habit === "palm" ? 8 : 1,
    environment: currentMix.entries[0]?.environment ?? { light: 0.8, moisture: 0.55, crowding: 0.32, biomeWarmth: 0.62 },
    seed: currentMix.seed ^ ((currentMix.entries.length + 1) * 0x9e37),
    enabled: true,
  };
  currentMix.entries.push(entry);
  selectedEntryId = entry.id;
  updateStatus(`Added ${entry.label}.`);
  renderUi();
  rebuildPreview();
};

const addWeberPennEntry = () => {
  const entry = makeWeberPennEntry(selectedWeberPennSpecies as SpeciesId);
  currentMix.entries.push(entry);
  selectedEntryId = entry.id;
  updateStatus(`Added Weber/Penn ${entry.label}.`);
  renderUi();
  rebuildPreview();
};

const makeImportedAssetEntry = (assetId: string): ProcPlantBiomeMixEntry | null => {
  const option = importedAssetOptions.find((item) => item.id === assetId);
  if (!option || !importedAssets.has(assetId)) return null;
  return {
    id: `${assetId}-entry-${Date.now().toString(36)}-${currentMix.entries.length}`,
    label: option.label,
    source: "asset",
    asset: { kind: "glb", name: option.name, libraryId: assetId, color: 0x6b7f4c, runtimeOnly: true },
    weight: 1,
    density: 0.22,
    scale: 10,
    environment: currentMix.entries[0]?.environment ?? { light: 0.8, moisture: 0.55, crowding: 0.32, biomeWarmth: 0.62 },
    seed: currentMix.seed ^ ((currentMix.entries.length + 1) * 0x51ed),
    enabled: true,
  };
};

const addImportedAssetEntry = () => {
  const entry = makeImportedAssetEntry(selectedImportedAssetId);
  if (!entry) {
    updateStatus("Import a GLB before adding one from the picker.");
    return;
  }
  currentMix.entries.push(entry);
  selectedEntryId = entry.id;
  updateStatus(`Added GLB ${entry.label}.`);
  renderUi();
  rebuildPreview();
};

const bindAddControls = () => {
  const presetSelect = entryEditor.querySelector<HTMLSelectElement>("#preset-select")!;
  const weberPennSelect = entryEditor.querySelector<HTMLSelectElement>("#weber-penn-select")!;
  const importedAssetSelect = entryEditor.querySelector<HTMLSelectElement>("#imported-asset-select");
  renderPresetOptions(presetSelect);
  weberPennSelect.innerHTML = weberPennSpeciesIds.map(
    (id) => `<option value="${id}">${labelForProcPlantId(id)}</option>`,
  ).join("");
  weberPennSelect.value = selectedWeberPennSpecies;
  if (importedAssetSelect) {
    importedAssetSelect.innerHTML = importedAssetOptions.length
      ? importedAssetOptions.map((asset) => `<option value="${asset.id}">${asset.label}</option>`).join("")
      : `<option value="">Import GLB first</option>`;
    if (!importedAssetOptions.some((asset) => asset.id === selectedImportedAssetId)) {
      selectedImportedAssetId = importedAssetOptions[0]?.id ?? "";
    }
    importedAssetSelect.value = selectedImportedAssetId;
    importedAssetSelect.disabled = importedAssetOptions.length === 0;
  }
  presetSelect.addEventListener("change", () => {
    selectedPresetId = presetSelect.value;
  });
  weberPennSelect.addEventListener("change", () => {
    selectedWeberPennSpecies = weberPennSelect.value;
  });
  importedAssetSelect?.addEventListener("change", () => {
    selectedImportedAssetId = importedAssetSelect.value;
  });
  entryEditor.querySelector<HTMLButtonElement>("#add-preset-button")!.addEventListener("click", addPresetEntry);
  entryEditor.querySelector<HTMLButtonElement>("#add-weber-penn-button")!.addEventListener("click", addWeberPennEntry);
  const importedAssetButton = entryEditor.querySelector<HTMLButtonElement>("#add-imported-asset-button");
  if (importedAssetButton) {
    importedAssetButton.textContent = importedAssetOptions.length ? "Add" : "Import";
    importedAssetButton.addEventListener("click", () => {
      if (importedAssetOptions.length === 0) {
        glbInput.click();
        return;
      }
      addImportedAssetEntry();
    });
  }
};

const renderEntryList = () => {
  mixTitle.textContent = currentMix.label;
  mixCount.textContent = `${currentMix.entries.length} plants`;
  entryList.innerHTML = currentMix.entries.map((entry) => `
    <button type="button" class="entry-card ${entry.id === selectedEntryId ? "active" : ""} ${entry.enabled ? "" : "disabled"}" data-entry-id="${entry.id}">
      <span class="plant-dot" style="background:${colorCss(colorForEntry(entry))}"></span>
      <span>
        <span class="entry-name">${entry.label}</span>
        <span class="entry-meta">${metaForEntry(entry)}</span>
      </span>
      <span class="entry-score">${entry.weight.toFixed(2)}</span>
    </button>
  `).join("");
  entryList.querySelectorAll<HTMLButtonElement>(".entry-card").forEach((button) => {
    button.addEventListener("click", () => {
      selectedEntryId = button.dataset.entryId ?? selectedEntryId;
      renderUi();
      rebuildPreview();
    });
  });
};

const renderEntryEditor = () => {
  const entry = selectedEntry();
  if (!entry) {
    entryEditor.innerHTML = "<p>No plants in this mix yet.</p>";
    return;
  }
  const previewGenome = genomeForMixEntry(entry);
  const isAssetEntry = isAssetMixEntry(entry);
  const weberPenn = previewGenome.weberPenn;
  const foliage = previewGenome.foliage;
  const realism = previewGenome.treeRealism;
  const foliageMode = weberFoliageMode(previewGenome);
  const fillMass = foliageMode === "plain" ? 0 : foliage?.mass ?? 0;
  const fillSize = foliage?.size ?? (previewGenome.habit === "conifer" ? 0.34 : 0.54);
  entryEditor.innerHTML = `
    <div class="add-row">
      <label>
        Add preset
        <select id="preset-select"></select>
      </label>
      <button type="button" id="add-preset-button">Add</button>
    </div>
    <div class="add-row">
      <label>
        Add Weber/Penn
        <select id="weber-penn-select"></select>
      </label>
      <button type="button" id="add-weber-penn-button">Add</button>
    </div>
    <div class="add-row">
      <label>
        Add imported GLB
        <select id="imported-asset-select"></select>
      </label>
      <button type="button" id="add-imported-asset-button">Add</button>
    </div>
    <label>
      Label
      <input id="entry-label" value="${entry.label.replace(/"/g, "&quot;")}" />
    </label>
    <div class="inline">
      <label>
        Weight
        <input id="entry-weight" type="range" min="0" max="6" value="${entry.weight}" step="0.05" />
        <output>${entry.weight.toFixed(2)}</output>
      </label>
      <label>
        Density
        <input id="entry-density" type="range" min="0.02" max="1.4" value="${entry.density}" step="0.01" />
        <output>${entry.density.toFixed(2)}</output>
      </label>
    </div>
    <div class="inline">
      <label>
        Scale
        <input id="entry-scale" type="range" min="0.2" max="24" value="${entry.scale}" step="0.1" />
        <output>${entry.scale.toFixed(1)}</output>
      </label>
      <label>
        Enabled
        <select id="entry-enabled">
          <option value="true" ${entry.enabled ? "selected" : ""}>Enabled</option>
          <option value="false" ${entry.enabled ? "" : "selected"}>Disabled</option>
        </select>
      </label>
    </div>
    ${isAssetEntry ? `
      <section class="weber-editor">
        <h3>Imported GLB</h3>
        <div class="inline">
          <label>
            Asset color
            <input id="asset-color" type="color" value="${toHexColor(entry.asset.color, 0x6b7f4c)}" />
          </label>
          <label>
            Source
            <input value="${entry.asset.name.replace(/"/g, "&quot;")}" disabled />
          </label>
        </div>
      </section>
    ` : ""}
    ${weberPenn ? `
      <section class="weber-editor">
        <h3>Weber/Penn Tree Traits</h3>
        <label>
          Species
          <select id="weber-species">
            ${weberPennSpeciesIds.map((id) => `<option value="${id}" ${id === weberPenn.species ? "selected" : ""}>${labelForProcPlantId(id)}</option>`).join("")}
          </select>
        </label>
        <details open>
          <summary>Structure</summary>
          <div class="inline">
            <label>
              Branch depth
              <input id="weber-depth" type="range" min="1" max="5" value="${weberPenn.maxBranchDepth ?? 3}" step="1" />
              <output>${weberPenn.maxBranchDepth ?? 3}</output>
            </label>
            <label>
              Max stems
              <input id="weber-stems" type="range" min="12" max="180" value="${weberPenn.maxStems ?? 96}" step="1" />
              <output>${weberPenn.maxStems ?? 96}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              W/P leaf cap
              <input id="weber-leaves" type="range" min="0" max="420" value="${weberPenn.maxLeaves ?? 220}" step="1" />
              <output>${weberPenn.maxLeaves ?? 220}</output>
            </label>
            <label>
              Leaf size
              <input id="weber-leaf-scale" type="range" min="0.5" max="8" value="${weberPenn.leafScaleMultiplier ?? 3.2}" step="0.05" />
              <output>${(weberPenn.leafScaleMultiplier ?? 3.2).toFixed(2)}</output>
            </label>
          </div>
        </details>
        <details open>
          <summary>Leaves & Crown</summary>
          <label>
            Foliage mode
            <select id="weber-foliage-mode">
              <option value="plain" ${foliageMode === "plain" ? "selected" : ""}>Plain W/P leaves</option>
              <option value="procplants" ${foliageMode === "procplants" ? "selected" : ""}>Procplants fill only</option>
              <option value="conifer" ${foliageMode === "conifer" ? "selected" : ""}>Conifer fill only</option>
              <option value="mixed" ${foliageMode === "mixed" ? "selected" : ""}>Custom mixed</option>
            </select>
          </label>
          <div class="inline">
            <label>
              Native leaves
              <select id="weber-native-leaves">
                <option value="true" ${weberPenn.nativeLeaves === false ? "" : "selected"}>On</option>
                <option value="false" ${weberPenn.nativeLeaves === false ? "selected" : ""}>Off</option>
              </select>
            </label>
            <label>
              Crown fill
              <select id="weber-foliage-source">
                <option value="species" ${(weberPenn.foliageSource ?? "species") === "species" ? "selected" : ""}>W/P leaf shape</option>
                <option value="procplants" ${weberPenn.foliageSource === "procplants" ? "selected" : ""}>Procplants leaf</option>
                <option value="conifer-spray" ${weberPenn.foliageSource === "conifer-spray" ? "selected" : ""}>Conifer spray</option>
              </select>
            </label>
          </div>
          <div class="inline">
            <label>
              Fill mass
              <input id="foliage-mass" type="range" min="0" max="2" value="${fillMass}" step="0.01" />
              <output>${fillMass.toFixed(2)}</output>
            </label>
            <label>
              Fill density
              <input id="foliage-clusters" type="range" min="0.2" max="2.4" value="${foliage?.clusterDensity ?? 1.2}" step="0.01" />
              <output>${(foliage?.clusterDensity ?? 1.2).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Fill size
              <input id="foliage-size" type="range" min="0.05" max="1.5" value="${fillSize}" step="0.01" />
              <output>${fillSize.toFixed(2)}</output>
            </label>
            <label>
              Fill anchors
              <select id="weber-fill-anchor">
                <option value="leaf-sites" ${(weberPenn.fillAnchor ?? "leaf-sites") === "leaf-sites" ? "selected" : ""}>W/P leaf sites</option>
                <option value="branch-tips" ${weberPenn.fillAnchor === "branch-tips" ? "selected" : ""}>Branch tips</option>
              </select>
            </label>
          </div>
          <div class="inline">
            <label>
              Fill spread
              <input id="foliage-spread" type="range" min="0" max="1.6" value="${foliage?.whorlDensity ?? 0.6}" step="0.01" />
              <output>${(foliage?.whorlDensity ?? 0.6).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Tip bias
              <input id="foliage-tip" type="range" min="0" max="1" value="${foliage?.tipBias ?? 0.5}" step="0.01" />
              <output>${(foliage?.tipBias ?? 0.5).toFixed(2)}</output>
            </label>
          </div>
        </details>
        <details>
          <summary>Colors</summary>
          <div class="inline">
            <label>
              Bark color
              <input id="weber-bark-color" type="color" value="${toHexColor(weberPenn.barkColor, 0x5d4327)}" />
            </label>
            <label>
              Leaf color
              <input id="weber-leaf-color" type="color" value="${toHexColor(weberPenn.leafColor, previewGenome.leaf.colorA)}" />
            </label>
          </div>
        </details>
      </section>
    ` : ""}
    <div class="editor-actions">
      ${isAssetEntry ? "" : `<button type="button" id="save-entry-preset">Save as Preset</button>`}
      <button type="button" class="danger" id="remove-entry">Remove Plant</button>
    </div>
  `;
  bindAddControls();
  const bindNumber = (selector: string, key: "weight" | "density" | "scale") => {
    const input = entryEditor.querySelector<HTMLInputElement>(selector)!;
    const output = input.nextElementSibling as HTMLOutputElement;
    input.addEventListener("input", () => {
      entry[key] = Number(input.value);
      output.textContent = key === "scale" ? entry[key].toFixed(1) : entry[key].toFixed(2);
      renderJson();
      renderEntryList();
      rebuildPreview();
    });
  };
  bindNumber("#entry-weight", "weight");
  bindNumber("#entry-density", "density");
  bindNumber("#entry-scale", "scale");
  entryEditor.querySelector<HTMLInputElement>("#entry-label")!.addEventListener("input", (event) => {
    entry.label = (event.currentTarget as HTMLInputElement).value || entry.label;
    renderJson();
    renderEntryList();
  });
  entryEditor.querySelector<HTMLSelectElement>("#entry-enabled")!.addEventListener("change", (event) => {
    entry.enabled = (event.currentTarget as HTMLSelectElement).value === "true";
    renderJson();
    renderEntryList();
    rebuildPreview();
  });
  entryEditor.querySelector<HTMLInputElement>("#asset-color")?.addEventListener("input", (event) => {
    if (!isAssetMixEntry(entry)) return;
    entry.asset.color = fromHexColor((event.currentTarget as HTMLInputElement).value, entry.asset.color ?? 0x6b7f4c);
    renderJson();
    renderEntryList();
    rebuildPreview();
  });
  entryEditor.querySelector<HTMLButtonElement>("#save-entry-preset")?.addEventListener("click", (event) => {
    const label = askPresetName(entry.label);
    if (!label) {
      updateStatus("Preset save canceled.");
      return;
    }
    const preset = saveProcPlantPreset(label, genomeForMixEntry(entry));
    selectedPresetId = preset.id;
    renderPresetOptions(entryEditor.querySelector<HTMLSelectElement>("#preset-select")!);
    updateStatus(`${preset.label} saved to preset options.`);
    flashButtonText(event.currentTarget as HTMLButtonElement, "Saved");
  });
  entryEditor.querySelector<HTMLButtonElement>("#remove-entry")!.addEventListener("click", () => {
    currentMix.entries = currentMix.entries.filter((item) => item.id !== entry.id);
    selectedEntryId = currentMix.entries[0]?.id ?? "";
    renderUi();
    rebuildPreview();
  });
  if (weberPenn) {
    const updateTree = (fn: (genome: ProcPlantGenome) => void, options: { renderList?: boolean; renderEditor?: boolean } = {}) => {
      const genome = editableGenomeForEntry(entry);
      genome.weberPenn = genome.weberPenn ?? { species: weberPenn.species };
      genome.foliage = genome.foliage ?? { mass: 0, clusterDensity: 1.1, whorlDensity: 0.55, tipBias: 0.5, size: 0.4 };
      fn(genome);
      renderJson();
      if (options.renderList) renderEntryList();
      if (options.renderEditor) renderEntryEditor();
      rebuildPreview();
    };
    const bindTreeNumber = (
      selector: string,
      format: (value: number) => string,
      update: (genome: ProcPlantGenome, value: number) => void,
    ) => {
      const input = entryEditor.querySelector<HTMLInputElement>(selector)!;
      const output = input.nextElementSibling as HTMLOutputElement;
      input.addEventListener("input", () => {
        const value = Number(input.value);
        output.textContent = format(value);
        updateTree((genome) => update(genome, value));
      });
    };
    entryEditor.querySelector<HTMLSelectElement>("#weber-species")!.addEventListener("change", (event) => {
      const species = (event.currentTarget as HTMLSelectElement).value as SpeciesId;
      updateTree((genome) => {
        const fresh = makeWeberPennGenome(species, entry.seed);
        Object.assign(genome, fresh);
        entry.label = labelForProcPlantId(species);
      }, { renderList: true, renderEditor: true });
    });
    bindTreeNumber("#weber-depth", (v) => String(Math.round(v)), (genome, value) => { genome.weberPenn!.maxBranchDepth = Math.round(value); });
    bindTreeNumber("#weber-stems", (v) => String(Math.round(v)), (genome, value) => { genome.weberPenn!.maxStems = Math.round(value); });
    bindTreeNumber("#weber-leaves", (v) => String(Math.round(v)), (genome, value) => { genome.weberPenn!.maxLeaves = Math.round(value); });
    bindTreeNumber("#weber-leaf-scale", (v) => v.toFixed(2), (genome, value) => { genome.weberPenn!.leafScaleMultiplier = value; });
    entryEditor.querySelector<HTMLSelectElement>("#weber-foliage-mode")!.addEventListener("change", (event) => {
      const mode = (event.currentTarget as HTMLSelectElement).value as "plain" | "procplants" | "conifer" | "mixed";
      if (mode === "mixed") return;
      updateTree((genome) => applyWeberFoliageMode(genome, mode), { renderEditor: true });
    });
    entryEditor.querySelector<HTMLSelectElement>("#weber-native-leaves")!.addEventListener("change", (event) => {
      updateTree((genome) => {
        genome.weberPenn!.nativeLeaves = (event.currentTarget as HTMLSelectElement).value === "true";
      }, { renderEditor: true });
    });
    entryEditor.querySelector<HTMLSelectElement>("#weber-foliage-source")!.addEventListener("change", (event) => {
      updateTree((genome) => {
        genome.weberPenn!.crownFill = true;
        genome.weberPenn!.foliageSource = (event.currentTarget as HTMLSelectElement).value as "species" | "procplants" | "conifer-spray";
      }, { renderEditor: true });
    });
    entryEditor.querySelector<HTMLSelectElement>("#weber-fill-anchor")!.addEventListener("change", (event) => {
      updateTree((genome) => {
        genome.weberPenn!.fillAnchor = (event.currentTarget as HTMLSelectElement).value as "leaf-sites" | "branch-tips";
      }, { renderEditor: true });
    });
    bindTreeNumber("#foliage-mass", (v) => v.toFixed(2), (genome, value) => {
      genome.weberPenn!.crownFill = value > 0.001;
      genome.foliage!.mass = value;
    });
    bindTreeNumber("#foliage-clusters", (v) => v.toFixed(2), (genome, value) => { genome.foliage!.clusterDensity = value; });
    bindTreeNumber("#foliage-size", (v) => v.toFixed(2), (genome, value) => { genome.foliage!.size = value; });
    bindTreeNumber("#foliage-spread", (v) => v.toFixed(2), (genome, value) => { genome.foliage!.whorlDensity = value; });
    bindTreeNumber("#foliage-tip", (v) => v.toFixed(2), (genome, value) => { genome.foliage!.tipBias = value; });
    entryEditor.querySelector<HTMLInputElement>("#weber-bark-color")!.addEventListener("input", (event) => {
      updateTree((genome) => { genome.weberPenn!.barkColor = fromHexColor((event.currentTarget as HTMLInputElement).value, 0x5d4327); }, { renderList: true });
    });
    entryEditor.querySelector<HTMLInputElement>("#weber-leaf-color")!.addEventListener("input", (event) => {
      updateTree((genome) => {
        const color = fromHexColor((event.currentTarget as HTMLInputElement).value, genome.leaf.colorA);
        genome.weberPenn!.leafColor = color;
        genome.leaf.colorA = color;
      }, { renderList: true });
    });
  }
};

const renderJson = () => {
  densityOutput.textContent = currentMix.density.toFixed(2);
  diversityOutput.textContent = currentMix.diversity.toFixed(2);
  densitySlider.value = String(currentMix.density);
  diversitySlider.value = String(currentMix.diversity);
  vertexTargetInput.value = String(currentMix.targetVerticesPerChunk);
  jsonOutput.value = JSON.stringify(currentMix, null, 2);
  statusOutput.textContent = statusText;
  vertexTargetOutput.textContent = formatCount(currentMix.targetVerticesPerChunk);
  workspace.classList.toggle("json-hidden", !jsonVisible);
  jsonToggleButton.textContent = jsonVisible ? "Hide JSON" : "Show JSON";
  jsonToggleButton.setAttribute("aria-pressed", jsonVisible ? "true" : "false");
};

const renderUi = () => {
  updatePreviewTerrain();
  renderSwatches();
  renderEntryList();
  renderEntryEditor();
  renderJson();
};

const hash01 = (value: number) => {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const rebuildPreview = () => {
  while (previewGroup.children.length) {
    const child = previewGroup.children.pop();
    if (child) {
      previewGroup.remove(child);
      if (child.userData.importedAssetClone) disposeImportedAssetInstance(child);
      else disposeObject(child);
    }
  }
  const enabled = normalizedEnabledEntries();
  const weightTotal = enabled.reduce((sum, entry) => sum + Math.max(0.01, entry.weight), 0) || 1;
  let rendered = 0;
  let currentVertices = 0;
  enabled.forEach((entry, entryIndex) => {
    const assetKey = isAssetMixEntry(entry) ? entry.asset.libraryId ?? entry.id : "";
    const assetPrototype = isAssetMixEntry(entry) ? importedAssets.get(assetKey) : undefined;
    if (isAssetMixEntry(entry) && !assetPrototype) return;
    const genome = isAssetMixEntry(entry) ? null : genomeForMixEntry(entry);
    const prototype = assetPrototype ?? buildProcPlantObject(genome!, entry.seed, entry.environment);
    const verticesPerPlant = geometryVertexCount(prototype);
    const share = Math.max(0.01, entry.weight) / weightTotal;
    const habitCap = isAssetMixEntry(entry) || genome?.habit === "tree" || genome?.habit === "conifer" || genome?.habit === "palm" ? 12 : 36;
    const count = Math.max(1, Math.min(habitCap, Math.round(70 * currentMix.density * entry.density * share)));
    currentVertices += verticesPerPlant * count;
    for (let i = 0; i < count; i++) {
      const instance = isAssetMixEntry(entry)
        ? cloneImportedAssetInstance(prototype, entry.asset.color)
        : i === 0 ? prototype : prototype.clone(true);
      const n = rendered + i + entry.seed + entryIndex * 97;
      const radius = 2 + Math.sqrt(hash01(n)) * 38;
      const angle = hash01(n + 31) * Math.PI * 2;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const slopeY = Math.max(0, z + 40) * 0.035;
      const jitter = 0.82 + hash01(n + 71) * 0.42;
      instance.position.set(x, slopeY, z);
      instance.rotation.y = hash01(n + 131) * Math.PI * 2;
      instance.scale.setScalar(entry.scale * jitter);
      previewGroup.add(instance);
    }
    rendered += count;
  });
  renderedOutput.textContent = String(rendered);
  vertexCurrentOutput.textContent = `${formatCount(currentVertices)} (${Math.round((currentVertices / Math.max(1, currentMix.targetVerticesPerChunk)) * 100)}%)`;
  vertexCurrentOutput.classList.toggle("over-budget", currentVertices > currentMix.targetVerticesPerChunk);
};

const loadEcologyBiome = (biome: ProcPlantBiomeId) => {
  currentMix = makeEcologyBiomeMix(biome, currentMix.seed);
  ecologySelect.value = biome;
  selectedEntryId = currentMix.entries[0]?.id ?? "";
  updateStatus(`Loaded ${currentMix.label}.`);
  renderUi();
  rebuildPreview();
};

ecologySelect.addEventListener("change", () => {
  loadEcologyBiome(ecologySelect.value as ProcPlantBiomeId);
});

densitySlider.addEventListener("input", () => {
  currentMix.density = Number(densitySlider.value);
  renderJson();
  rebuildPreview();
});

diversitySlider.addEventListener("input", () => {
  currentMix.diversity = Number(diversitySlider.value);
  renderJson();
  rebuildPreview();
});

vertexTargetInput.addEventListener("input", () => {
  currentMix.targetVerticesPerChunk = Math.max(1, Number(vertexTargetInput.value) || 250000);
  renderJson();
  rebuildPreview();
});

jsonToggleButton.addEventListener("click", () => {
  jsonVisible = !jsonVisible;
  renderJson();
  resize();
});

document.querySelector<HTMLButtonElement>("#import-button")!.addEventListener("click", () => fileInput.click());
document.querySelector<HTMLButtonElement>("#import-glb-button")!.addEventListener("click", () => glbInput.click());

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files ?? []);
  let imported = 0;
  for (const file of files) {
    const raw = JSON.parse(await file.text()) as unknown;
    const mix = normalizeBiomeMixDefinition(raw);
    if (mix) {
      currentMix = mix;
      selectedEntryId = currentMix.entries[0]?.id ?? "";
      imported++;
      continue;
    }
    const entry = entryFromProcPlantLabExport(raw, file.name);
    if (entry) {
      currentMix.entries.push(entry);
      selectedEntryId = entry.id;
      imported++;
    }
  }
  fileInput.value = "";
  updateStatus(imported ? `Imported ${imported} JSON file${imported === 1 ? "" : "s"}.` : "No compatible JSON found.");
  renderUi();
  rebuildPreview();
});

glbInput.addEventListener("change", async () => {
  const files = Array.from(glbInput.files ?? []);
  let imported = 0;
  const failures: string[] = [];
  if (files.length > 0) updateStatus(`Importing ${files.length} GLB file${files.length === 1 ? "" : "s"}...`);
  for (const file of files) {
    try {
      const object = await loadGlbFile(file);
      const label = file.name.replace(/\.(glb|gltf)$/i, "");
      const assetId = `asset-${slug(label)}-${Date.now().toString(36)}-${imported}`;
      importedAssets.set(assetId, object);
      importedAssetOptions.push({ id: assetId, label, name: file.name });
      selectedImportedAssetId = assetId;
      const entry = makeImportedAssetEntry(assetId);
      if (entry) {
        currentMix.entries.push(entry);
        selectedEntryId = entry.id;
        imported++;
      }
    } catch (error) {
      console.error(error);
      failures.push(`${file.name}: ${importErrorMessage(error)}`);
    }
  }
  glbInput.value = "";
  if (imported) {
    updateStatus(`Imported ${imported} GLB asset${imported === 1 ? "" : "s"} for this session${failures.length ? `; ${failures.length} failed.` : "."}`);
  } else if (failures.length) {
    updateStatus(`Could not import ${failures[0]}`);
  } else {
    updateStatus("No GLB file selected.");
  }
  renderUi();
  rebuildPreview();
});

document.querySelector<HTMLButtonElement>("#export-button")!.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(currentMix, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `procplant-biome-mix-${currentMix.id}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  updateStatus("Biome mix exported.");
});

const resize = () => {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};

const animate = () => {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
};

window.addEventListener("resize", resize);
renderUi();
rebuildPreview();
resize();
animate();
