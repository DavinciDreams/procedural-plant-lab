import * as THREE from "three";
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
  GOLDEN_ANGLE_RADIANS,
  procPlantPresets,
  type ProcPlantBiomeId,
  type ProcPlantGenome,
  type LeafShapeKind,
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
let selectedEzTreePreset = "Pine Large";
let selectedBranchModulePalette = "decurrent-broadleaf";
let selectedImportedAssetId = "";
let jsonVisible = false;
let statusText = "Ready.";
const weberPennSpeciesIds = Object.keys(SPECIES).sort() as SpeciesId[];
const ezTreePresetIds = [
  "Ash Small", "Ash Medium", "Ash Large",
  "Aspen Small", "Aspen Medium", "Aspen Large",
  "Bush 1", "Bush 2", "Bush 3",
  "Oak Small", "Oak Medium", "Oak Large",
  "Pine Small", "Pine Medium", "Pine Large",
];
const branchModulePalettes = [
  "excurrent-conifer",
  "decurrent-broadleaf",
  "weeping",
  "shrub",
  "palm-ish",
  "vine-ish",
] as const;
type BranchModulePalette = typeof branchModulePalettes[number];
type EzTreeModule = typeof import("@dgreenheck/ez-tree");
let ezTreeModulePromise: Promise<EzTreeModule> | null = null;
const getEzTreeModule = () => ezTreeModulePromise ??= import("@dgreenheck/ez-tree");
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

type GlbLoader = import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader;
let glbLoaderPromise: Promise<GlbLoader> | null = null;

const getGlbLoader = (): Promise<GlbLoader> => {
  if (glbLoaderPromise) return glbLoaderPromise;
  // The Meshopt decoder alone is several megabytes. Keep the complete asset
  // import stack out of the initial biome-editor route until a user actually
  // selects a GLB/GLTF file.
  glbLoaderPromise = Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/loaders/DRACOLoader.js"),
    import("three/examples/jsm/loaders/KTX2Loader.js"),
    import("three/examples/jsm/libs/meshopt_decoder.module.js"),
  ]).then(([{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }, { MeshoptDecoder }]) => {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    const ktx2Loader = new KTX2Loader();
    dracoLoader.setDecoderPath("/node_modules/three/examples/jsm/libs/draco/gltf/");
    ktx2Loader.setTranscoderPath("/node_modules/three/examples/jsm/libs/basis/");
    ktx2Loader.detectSupport(renderer);
    loader.setDRACOLoader(dracoLoader);
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader;
  }).catch((error) => {
    glbLoaderPromise = null;
    throw error;
  });
  return glbLoaderPromise;
};

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

const ezTreeBaseOptions = (preset: string, ezTreeModule: EzTreeModule): EzTreeOptions =>
  cloneJson(((ezTreeModule.TreePreset as unknown as Record<string, EzTreeOptions>)[preset]
    ?? (ezTreeModule.TreePreset as unknown as Record<string, EzTreeOptions>)["Pine Large"])!);

const configureEzTreeOptions = (entry: ProcPlantBiomeMixEntry, ezTreeModule: EzTreeModule): EzTreeOptions => {
  const ezTree = entry.ezTree;
  const kind = ezTree?.kind ?? "pine";
  const options = ezTreeBaseOptions(ezTree?.preset ?? ezTreePresetForKind(kind), ezTreeModule);
  const foliage = ezTree?.foliage ?? 1;
  const spread = ezTree?.spread ?? 1;
  const droop = ezTree?.droop ?? 0;
  const gnarliness = ezTree?.gnarliness ?? 1;
  options.seed = entry.seed;
  options.bark.textured = ezTree?.textures !== false;
  options.bark.tint = ezTree?.barkColor ?? (kind === "pine" ? 0x6a5132 : kind === "willow" ? 0x67523b : 0x6b4a2c);
  options.leaves.tint = ezTree?.leafColor ?? (kind === "pine" ? 0x5f8461 : kind === "willow" ? 0x7fa05c : 0x6f9a45);
  options.leaves.count = Math.max(0, Math.round(options.leaves.count * foliage));
  options.branch.angle[1] = Math.max(4, options.branch.angle[1] * spread);
  options.branch.angle[2] = Math.max(4, options.branch.angle[2] * spread);
  options.branch.gnarliness[0] *= gnarliness;
  options.branch.gnarliness[1] *= gnarliness;
  options.branch.gnarliness[2] *= gnarliness;
  options.branch.gnarliness[3] *= gnarliness;
  if (kind === "pine") {
    options.type = ezTreeModule.TreeType.Evergreen;
    options.bark.type = ezTreeModule.BarkType.Pine;
    options.leaves.type = "pine";
    options.leaves.billboard = ezTreeModule.Billboard.Double;
    options.leaves.alphaTest = 0.25;
  }
  if (kind === "willow") {
    options.type = ezTreeModule.TreeType.Deciduous;
    options.bark.type = ezTreeModule.BarkType.Willow;
    options.leaves.type = ezTreeModule.LeafType.Aspen;
    options.leaves.billboard = ezTreeModule.Billboard.Double;
    options.leaves.count = Math.max(options.leaves.count, Math.round(12 * foliage));
    options.leaves.size *= 0.76;
    options.leaves.start = Math.min(options.leaves.start, 0.08);
    options.branch.force.direction = { x: 0, y: -1, z: 0 };
    options.branch.force.strength = -0.02 - droop * 0.045;
    options.branch.angle[1] = 42 * spread;
    options.branch.angle[2] = 34 * spread;
    options.branch.children[0] = Math.max(options.branch.children[0], 11);
    options.branch.children[1] = Math.max(options.branch.children[1], 5);
    options.branch.length[1] *= 1.15;
    options.branch.length[2] *= 1.2;
  }
  if (kind === "bush") {
    options.leaves.count = Math.max(options.leaves.count, Math.round(18 * foliage));
    options.branch.force.strength *= 0.5;
  }
  return options;
};

const buildEzTreeObject = (entry: ProcPlantBiomeMixEntry, ezTreeModule: EzTreeModule): THREE.Object3D => {
  const tree = new ezTreeModule.Tree();
  tree.loadFromJson(configureEzTreeOptions(entry, ezTreeModule) as any);
  tree.name = entry.label;
  const leafTint = new THREE.Color(
    entry.ezTree?.leafColor ?? (entry.ezTree?.kind === "pine" ? 0x5f8461 : entry.ezTree?.kind === "willow" ? 0x7fa05c : 0x6f9a45),
  );
  const useTextures = entry.ezTree?.textures !== false;
  tree.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(tree);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const maxSide = Math.max(size.x, size.y, size.z, 1e-4);
  const rootObject = new THREE.Group();
  rootObject.name = `ez-tree-${entry.ezTree?.kind ?? "tree"}`;
  tree.position.set(-center.x, -box.min.y, -center.z);
  rootObject.add(tree);
  rootObject.scale.setScalar(1 / maxSide);
  rootObject.userData.ezTree = true;
  rootObject.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material?.name !== "leaves" || !(material instanceof THREE.MeshPhongMaterial)) continue;
      const lifted = leafTint.clone().lerp(new THREE.Color(0xffffff), 0.28);
      material.color.copy(lifted);
      material.emissive.copy(lifted).multiplyScalar(0.22);
      material.shininess = 4;
      material.alphaTest = Math.min(material.alphaTest || 0.3, 0.28);
      if (!useTextures) material.map = null;
      material.needsUpdate = true;
    }
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
    const gltfLoader = await getGlbLoader();
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

const createBiomeGrassTuftGeometry = (seed: number, bladeCount = 12): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < bladeCount; i++) {
    const yaw = i * GOLDEN_ANGLE_RADIANS + (hash01(seed + i * 17) - 0.5) * 0.7;
    const radial = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-radial.z, 0, radial.x);
    const height = 0.34 + hash01(seed + i * 31) * 0.5;
    const width = 0.012 + hash01(seed + i * 43) * 0.014;
    const baseSpread = Math.sqrt(hash01(seed + i * 59)) * 0.075;
    const base = radial.clone().multiplyScalar(baseSpread);
    const bend = radial.clone().multiplyScalar((0.06 + hash01(seed + i * 71) * 0.18) * height);
    const mid = base.clone().add(up.clone().multiplyScalar(height * 0.55)).add(bend.clone().multiplyScalar(0.42));
    const tip = base.clone().add(up.clone().multiplyScalar(height)).add(bend);
    const normal = new THREE.Vector3().crossVectors(side, tip.clone().sub(base)).normalize();
    const start = positions.length / 3;
    const points = [
      base.clone().add(side.clone().multiplyScalar(-width)),
      base.clone().add(side.clone().multiplyScalar(width)),
      mid.clone().add(side.clone().multiplyScalar(width * 0.58)),
      mid.clone().add(side.clone().multiplyScalar(-width * 0.58)),
      tip,
    ];
    for (const point of points) {
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3, start + 3, start + 2, start + 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
};

const buildGrassWorldObject = (
  entry: ProcPlantBiomeMixEntry,
  genome: ProcPlantGenome,
  count: number,
): THREE.Object3D => {
  const bladeCount = Math.round(THREE.MathUtils.clamp(8 + (genome.foliage?.mass ?? 0.8) * 5, 7, 16));
  const geometry = createBiomeGrassTuftGeometry(entry.seed ^ 0x61a55, bladeCount);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = `grass-world-${entry.id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const baseColor = new THREE.Color(genome.leaf.colorA);
  const tipColor = new THREE.Color(genome.leaf.colorB);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const n = entry.seed + i * 97;
    const radius = 2 + Math.sqrt(hash01(n)) * 39;
    const angle = i * GOLDEN_ANGLE_RADIANS + hash01(n + 31) * 0.45;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const y = Math.max(0, z + 40) * 0.035 + 0.012;
    const moistureLift = THREE.MathUtils.lerp(0.74, 1.18, entry.environment.moisture);
    const shadeStretch = THREE.MathUtils.lerp(0.86, 1.22, 1 - entry.environment.light);
    const tuftScale = entry.scale * (0.17 + hash01(n + 71) * 0.19) * moistureLift * shadeStretch;
    // grassHeight/grassSpread/grassLean are authored per entry and shipped to Tellus,
    // so the preview has to honour them or it stops matching the export. Defaults are
    // neutral (1/1/0) to leave unset entries rendering exactly as before.
    const grassHeight = entry.grassHeight ?? 1;
    const grassSpread = entry.grassSpread ?? 1;
    const grassLean = entry.grassLean ?? 0;
    quat.setFromEuler(new THREE.Euler(
      (hash01(n + 101) - 0.5) * 0.2 + grassLean * (hash01(n + 241) * 0.5 + 0.5),
      hash01(n + 131) * Math.PI * 2,
      (hash01(n + 151) - 0.5) * 0.12,
    ));
    scale.set(
      tuftScale * grassSpread,
      tuftScale * (0.9 + (genome.foliage?.mass ?? 0.8) * 0.16) * grassHeight,
      tuftScale * grassSpread,
    );
    matrix.compose(new THREE.Vector3(x, y, z), quat, scale);
    mesh.setMatrixAt(i, matrix);
    color.copy(baseColor).lerp(tipColor, 0.25 + hash01(n + 191) * 0.62);
    if (hash01(n + 211) < 0.2) color.lerp(new THREE.Color(0xd8cc76), 0.12 + hash01(n + 223) * 0.2);
    mesh.setColorAt(i, color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  const group = new THREE.Group();
  group.name = `grass-world-${entry.label}`;
  group.userData.grassWorld = { count, bladeCount };
  group.add(mesh);
  return group;
};

const selectedEntry = () => currentMix.entries.find((entry) => entry.id === selectedEntryId) ?? currentMix.entries[0];

const colorForEntry = (entry: ProcPlantBiomeMixEntry): number => {
  if (entry.source === "ez-tree") return entry.ezTree?.leafColor ?? (entry.ezTree?.kind === "pine" ? 0x5f8461 : 0x6f9a45);
  if (isAssetMixEntry(entry)) return 0x6b7f4c;
  const genome = genomeForMixEntry(entry);
  return genome.flower?.color ?? genome.leaf.colorA ?? 0x4f7a39;
};

const metaForEntry = (entry: ProcPlantBiomeMixEntry): string => {
  if (entry.source === "ez-tree") return `EZ-Tree ${entry.ezTree?.kind ?? "tree"}`;
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

const mutationRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const branchModuleLeafShapes: LeafShapeKind[] = [
  "lanceolate",
  "ovate",
  "cordate",
  "palmate",
  "spatulate",
  "fan",
  "linear",
  "round",
];

const jitterValue = (value: number, rng: () => number, amount: number, min: number, max: number) =>
  THREE.MathUtils.clamp(value * (1 + (rng() - 0.5) * amount), min, max);

const jitterAdd = (value: number, rng: () => number, amount: number, min: number, max: number) =>
  THREE.MathUtils.clamp(value + (rng() - 0.5) * amount, min, max);

const jitterColor = (color: number, rng: () => number, amount = 0.22) => {
  const out = new THREE.Color(color);
  const hueShift = (rng() - 0.5) * amount;
  const satShift = (rng() - 0.5) * amount * 0.45;
  const lightShift = (rng() - 0.5) * amount * 0.35;
  const hsl = { h: 0, s: 0, l: 0 };
  out.getHSL(hsl);
  out.setHSL(
    (hsl.h + hueShift + 1) % 1,
    THREE.MathUtils.clamp(hsl.s + satShift, 0.12, 0.92),
    THREE.MathUtils.clamp(hsl.l + lightShift, 0.14, 0.78),
  );
  return out.getHex();
};

const mutateBranchModuleGenome = (genome: ProcPlantGenome, seed: number): ProcPlantGenome => {
  const rng = mutationRng(seed);
  const next = cloneGenome(genome);
  next.branchModules = next.branchModules ?? { palette: "decurrent-broadleaf" };
  next.foliage = next.foliage ?? { mass: 0.88, clusterDensity: 1.18, whorlDensity: 0.58, tipBias: 0.58, size: 0.62 };
  next.treeRealism = next.treeRealism ?? {
    crownSpread: next.habit === "conifer" ? 0.42 : 0.82,
    crownTaper: next.habit === "conifer" ? 0.84 : 0.38,
    trunkFlare: 0.36,
    trunkBend: 0.14,
    branchGnarl: 0.24,
    windFlex: 0.52,
    colorVariance: 0.14,
  };
  const modules = next.branchModules;
  const foliage = next.foliage;
  const realism = next.treeRealism;
  modules.moduleBudget = Math.round(jitterValue(modules.moduleBudget ?? 110, rng, 0.42, 24, 220));
  modules.levels = Math.round(jitterAdd(modules.levels ?? 3, rng, 1.8, 1, 6));
  modules.vigor = jitterValue(modules.vigor ?? 1, rng, 0.55, 0.18, 2.2);
  modules.branchDensity = jitterValue(modules.branchDensity ?? 1.1, rng, 0.75, 0.15, 3);
  modules.branchAngle = jitterValue(modules.branchAngle ?? 1, rng, 0.55, 0.25, 1.75);
  modules.spread = jitterValue(modules.spread ?? 1, rng, 0.62, 0.25, 2);
  modules.droop = jitterAdd(modules.droop ?? 0.2, rng, 0.72, 0, 2);
  modules.tropism = jitterAdd(modules.tropism ?? 0.48, rng, 0.52, 0, 1.5);
  modules.gnarliness = jitterAdd(modules.gnarliness ?? 0.24, rng, 0.64, 0, 1.6);
  modules.collisionBias = jitterAdd(modules.collisionBias ?? 0.45, rng, 0.5, 0, 1.4);
  if (rng() < 0.18) {
    modules.foliageSource = modules.palette === "excurrent-conifer" && rng() < 0.7
      ? "conifer-spray"
      : "procplants";
  }
  if (rng() < 0.42) {
    next.leaf.shape = branchModuleLeafShapes[Math.floor(rng() * branchModuleLeafShapes.length)]!;
  }
  next.leaf.length = {
    base: jitterValue(next.leaf.length.base, rng, 0.45, 0.035, 0.85),
    tip: jitterValue(next.leaf.length.tip, rng, 0.45, 0.025, 0.72),
    curve: jitterValue(next.leaf.length.curve, rng, 0.34, 0.45, 2.4),
  };
  next.leaf.widthRatio = jitterValue(next.leaf.widthRatio, rng, 0.55, 0.08, 1.45);
  next.leaf.density = {
    base: jitterValue(next.leaf.density.base, rng, 0.42, 0.03, 1.4),
    tip: jitterValue(next.leaf.density.tip, rng, 0.42, 0.03, 1.6),
    curve: jitterValue(next.leaf.density.curve, rng, 0.32, 0.4, 2.6),
  };
  next.leaf.curl = jitterAdd(next.leaf.curl, rng, 0.42, -0.45, 0.85);
  next.leaf.serration = jitterAdd(next.leaf.serration, rng, 0.38, 0, 1);
  next.leaf.venation = jitterAdd(next.leaf.venation, rng, 0.36, 0, 1);
  next.leaf.colorA = jitterColor(next.leaf.colorA, rng, 0.12);
  next.leaf.colorB = jitterColor(next.leaf.colorB, rng, 0.16);
  modules.leafColor = jitterColor(modules.leafColor ?? next.leaf.colorA, rng, 0.14);
  modules.barkColor = jitterColor(modules.barkColor ?? 0x5d4327, rng, 0.08);
  foliage.mass = jitterValue(foliage.mass, rng, 0.5, 0.05, 2.2);
  foliage.clusterDensity = jitterValue(foliage.clusterDensity, rng, 0.55, 0.2, 2.6);
  foliage.whorlDensity = jitterValue(foliage.whorlDensity, rng, 0.5, 0.05, 1.8);
  foliage.tipBias = jitterAdd(foliage.tipBias, rng, 0.36, 0, 1);
  foliage.size = jitterValue(foliage.size ?? 0.62, rng, 0.5, 0.08, 1.6);
  realism.crownSpread = jitterValue(realism.crownSpread, rng, 0.32, 0.05, 1.8);
  realism.crownTaper = jitterValue(realism.crownTaper, rng, 0.32, 0.02, 1.45);
  realism.trunkBend = jitterAdd(realism.trunkBend, rng, 0.18, 0, 0.8);
  realism.branchGnarl = jitterAdd(realism.branchGnarl, rng, 0.22, 0, 0.9);
  realism.windFlex = jitterAdd(realism.windFlex, rng, 0.22, 0, 1);
  realism.colorVariance = jitterAdd(realism.colorVariance, rng, 0.12, 0, 0.45);
  next.lightResponse = {
    ...next.lightResponse,
    shadeAvoidance: jitterAdd(next.lightResponse.shadeAvoidance, rng, 0.28, 0, 1.6),
    leafBoostInShade: jitterAdd(next.lightResponse.leafBoostInShade, rng, 0.16, 0, 0.8),
    branchSuppressionInShade: jitterAdd(next.lightResponse.branchSuppressionInShade, rng, 0.18, 0, 0.8),
    phototropism: jitterAdd(next.lightResponse.phototropism, rng, 0.22, 0, 1.2),
  };
  return next;
};

type EzTreeOptions = {
  seed: number;
  type: string;
  bark: {
    type: string;
    tint: number;
    flatShading: boolean;
    textured: boolean;
    textureScale: { x: number; y: number };
  };
  branch: {
    levels: number;
    angle: Record<number, number>;
    children: Record<number, number>;
    force: { direction: { x: number; y: number; z: number }; strength: number };
    gnarliness: Record<number, number>;
    length: Record<number, number>;
    radius: Record<number, number>;
    sections: Record<number, number>;
    segments: Record<number, number>;
    start: Record<number, number>;
    taper: Record<number, number>;
    twist: Record<number, number>;
  };
  leaves: {
    type: string;
    billboard: string;
    angle: number;
    count: number;
    start: number;
    size: number;
    sizeVariance: number;
    tint: number;
    alphaTest: number;
  };
  trellis: { enabled: boolean };
};
type EzTreeKind = NonNullable<ProcPlantBiomeMixEntry["ezTree"]>["kind"];

const cloneJson = <T,>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;

const ezTreeKindForPreset = (preset: string): EzTreeKind => {
  const id = preset.toLowerCase();
  if (id.includes("oak")) return "oak";
  if (id.includes("aspen")) return "aspen";
  if (id.includes("ash")) return "ash";
  if (id.includes("bush")) return "bush";
  if (id.includes("willow")) return "willow";
  return "pine";
};

const ezTreePresetForKind = (kind: EzTreeKind): string => {
  if (kind === "oak" || kind === "willow") return "Oak Large";
  if (kind === "aspen") return "Aspen Large";
  if (kind === "ash") return "Ash Large";
  if (kind === "bush") return "Bush 1";
  return "Pine Large";
};

const makeEzTreeEntry = (preset: string): ProcPlantBiomeMixEntry => {
  const kind = ezTreeKindForPreset(preset);
  const seed = currentMix.seed ^ ((currentMix.entries.length + 1) * 0x7f4a7c15);
  const basePreset = kind === "willow" ? ezTreePresetForKind(kind) : preset;
  return {
    id: `ez-tree-${slug(preset)}-${Date.now().toString(36)}`,
    label: kind === "willow" ? "EZ Willow" : `EZ ${labelForProcPlantId(preset)}`,
    source: "ez-tree",
    ezTree: {
      preset: basePreset,
      kind,
      foliage: kind === "pine" ? 1.15 : 1,
      spread: kind === "pine" ? 0.86 : 1,
      droop: kind === "willow" ? 1 : 0,
      gnarliness: kind === "willow" ? 0.7 : 1,
      textures: true,
    },
    weight: 1,
    density: 0.34,
    scale: kind === "bush" ? 4.2 : 8,
    environment: currentMix.entries[0]?.environment ?? { light: 0.8, moisture: 0.55, crowding: 0.32, biomeWarmth: 0.62 },
    seed,
    enabled: true,
  };
};

const branchModuleTemplateForPalette = (palette: BranchModulePalette): ProcPlantGenome => {
  if (palette === "excurrent-conifer") return procPlantPresets.blueSpruce;
  if (palette === "weeping") return procPlantPresets.birchGrove;
  if (palette === "shrub") return procPlantPresets.understoryShrub;
  if (palette === "palm-ish") return procPlantPresets.foldedPalm;
  if (palette === "vine-ish") return procPlantPresets.vincaVine;
  return procPlantPresets.oakCanopy;
};

const makeBranchModuleGenome = (palette: BranchModulePalette, seed: number): ProcPlantGenome => {
  const base = cloneGenome(branchModuleTemplateForPalette(palette));
  base.id = `branchModules-${palette}`;
  base.habit = palette === "excurrent-conifer" ? "conifer" : palette === "shrub" ? "shrub" : palette === "palm-ish" ? "palm" : palette === "vine-ish" ? "vine" : "tree";
  base.weberPenn = undefined;
  base.clump = undefined;
  base.branchModules = {
    palette,
    moduleBudget: palette === "excurrent-conifer" ? 120 : palette === "shrub" ? 96 : palette === "palm-ish" ? 36 : palette === "decurrent-broadleaf" ? 150 : 112,
    levels: palette === "palm-ish" ? 1 : palette === "vine-ish" ? 4 : palette === "decurrent-broadleaf" ? 4 : 3,
    vigor: 1,
    branchDensity: palette === "excurrent-conifer" ? 1.05 : palette === "shrub" ? 1.25 : palette === "palm-ish" ? 0.4 : palette === "vine-ish" ? 0.72 : 1.35,
    branchAngle: palette === "excurrent-conifer" ? 0.82 : palette === "vine-ish" ? 0.55 : palette === "shrub" ? 1.08 : 1.18,
    spread: palette === "excurrent-conifer" ? 0.58 : palette === "shrub" ? 1.12 : palette === "palm-ish" ? 1.35 : 1.08,
    droop: palette === "weeping" ? 1.15 : palette === "excurrent-conifer" ? 0.34 : palette === "vine-ish" ? 0.7 : 0.18,
    tropism: palette === "excurrent-conifer" ? 0.72 : 0.48,
    gnarliness: palette === "decurrent-broadleaf" ? 0.38 : palette === "weeping" ? 0.32 : palette === "excurrent-conifer" ? 0.16 : 0.24,
    collisionBias: 0.45,
    foliageSource: palette === "excurrent-conifer" ? "conifer-spray" : "procplants",
  };
  base.foliage = {
    mass: palette === "palm-ish" ? 0.62 : palette === "excurrent-conifer" ? 1.05 : 0.88,
    clusterDensity: palette === "shrub" ? 1.45 : 1.18,
    whorlDensity: palette === "excurrent-conifer" ? 0.85 : 0.58,
    tipBias: palette === "weeping" ? 0.72 : 0.58,
    size: palette === "excurrent-conifer" ? 0.54 : 0.62,
  };
  base.treeRealism = {
    crownSpread: palette === "excurrent-conifer" ? 0.42 : palette === "shrub" ? 1.05 : 0.82,
    crownTaper: palette === "excurrent-conifer" ? 0.84 : palette === "weeping" ? 0.24 : 0.38,
    trunkFlare: palette === "shrub" ? 0.22 : 0.38,
    trunkBend: palette === "weeping" ? 0.24 : 0.14,
    branchGnarl: palette === "decurrent-broadleaf" ? 0.34 : 0.22,
    windFlex: palette === "weeping" ? 0.72 : 0.52,
    colorVariance: 0.14,
  };
  void seed;
  return base;
};

const makeBranchModuleEntry = (palette: BranchModulePalette): ProcPlantBiomeMixEntry => {
  const seed = currentMix.seed ^ ((currentMix.entries.length + 1) * 0x38b5);
  const genome = makeBranchModuleGenome(palette, seed);
  return {
    id: `branch-module-${slug(palette)}-${Date.now().toString(36)}`,
    label: `Modules ${labelForProcPlantId(palette)}`,
    source: "mutation",
    genome,
    weight: 1,
    density: palette === "shrub" ? 0.42 : 0.28,
    scale: palette === "shrub" ? 5.2 : 8.4,
    environment: currentMix.entries[0]?.environment ?? { light: 0.8, moisture: 0.55, crowding: 0.32, biomeWarmth: 0.62 },
    seed,
    enabled: true,
  };
};

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
    nativeLeaves: !conifer,
    crownFill: conifer,
    foliageSource: conifer ? "conifer-spray" : "species",
    fillAnchor: "leaf-sites",
    maxBranchDepth: base.weberPenn?.maxBranchDepth ?? 3,
    maxStems: base.weberPenn?.maxStems ?? (conifer ? 112 : 80),
    maxLeaves: base.weberPenn?.maxLeaves ?? (conifer ? 300 : 190),
    leafScaleMultiplier: base.weberPenn?.leafScaleMultiplier ?? (conifer ? 2.8 : 3.2),
    radialSegments: base.weberPenn?.radialSegments ?? 4,
    branchSamples: base.weberPenn?.branchSamples ?? 2,
    barkColor: base.weberPenn?.barkColor ?? (palm ? 0x7a5630 : 0x5d4327),
    leafColor: base.weberPenn?.leafColor ?? base.leaf.colorA,
  };
  base.foliage = {
    mass: conifer ? base.foliage?.mass ?? 1.12 : 0,
    clusterDensity: base.foliage?.clusterDensity ?? (conifer ? 1.32 : 1.12),
    whorlDensity: base.foliage?.whorlDensity ?? (conifer ? 0.84 : 0.48),
    tipBias: base.foliage?.tipBias ?? (conifer ? 0.34 : 0.62),
    size: base.foliage?.size ?? (conifer ? 0.58 : 0.54),
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

type WeberFoliageMode = "plain" | "procplants" | "conifer" | "ez-leaf-card" | "mixed";

const weberFoliageMode = (genome: ProcPlantGenome): WeberFoliageMode => {
  const nativeLeaves = genome.weberPenn?.nativeLeaves !== false;
  const crownFill = genome.weberPenn?.crownFill === true ||
    (genome.weberPenn?.crownFill === undefined && Boolean(genome.weberPenn?.foliageSource && genome.weberPenn.foliageSource !== "species"));
  const mass = crownFill ? genome.foliage?.mass ?? 0 : 0;
  const source = genome.weberPenn?.foliageSource ?? "species";
  if (nativeLeaves && mass <= 0.001) return "plain";
  if (!nativeLeaves && mass > 0.001 && source === "procplants") return "procplants";
  if (!nativeLeaves && mass > 0.001 && source === "conifer-spray") return "conifer";
  if (!nativeLeaves && mass > 0.001 && source === "ez-leaf-card") return "ez-leaf-card";
  return "mixed";
};

const applyWeberFoliageMode = (
  genome: ProcPlantGenome,
  mode: WeberFoliageMode,
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
    return;
  }
  if (mode === "ez-leaf-card") {
    genome.weberPenn.nativeLeaves = false;
    genome.weberPenn.crownFill = true;
    genome.weberPenn.foliageSource = "ez-leaf-card";
    genome.weberPenn.fillAnchor = "branch-tips";
    genome.foliage.mass = Math.max(0.62, genome.foliage.mass);
    genome.foliage.clusterDensity = Math.max(1.05, genome.foliage.clusterDensity);
    genome.foliage.size = Math.max(genome.foliage.size ?? 0.48, 0.52);
    genome.foliage.whorlDensity = Math.max(genome.foliage.whorlDensity, 0.46);
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

const addEzTreeEntry = () => {
  const entry = makeEzTreeEntry(selectedEzTreePreset);
  currentMix.entries.push(entry);
  selectedEntryId = entry.id;
  updateStatus(`Added ${entry.label}.`);
  renderUi();
  rebuildPreview();
};

const addBranchModuleEntry = () => {
  const entry = makeBranchModuleEntry(selectedBranchModulePalette as BranchModulePalette);
  currentMix.entries.push(entry);
  selectedEntryId = entry.id;
  updateStatus(`Added ${entry.label}.`);
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
  const ezTreeSelect = entryEditor.querySelector<HTMLSelectElement>("#ez-tree-select")!;
  const branchModuleSelect = entryEditor.querySelector<HTMLSelectElement>("#branch-module-select")!;
  const importedAssetSelect = entryEditor.querySelector<HTMLSelectElement>("#imported-asset-select");
  renderPresetOptions(presetSelect);
  weberPennSelect.innerHTML = weberPennSpeciesIds.map(
    (id) => `<option value="${id}">${labelForProcPlantId(id)}</option>`,
  ).join("");
  weberPennSelect.value = selectedWeberPennSpecies;
  ezTreeSelect.innerHTML = [
    ...ezTreePresetIds.map((id) => `<option value="${id}">${labelForProcPlantId(id)}</option>`),
    `<option value="Willow Synthetic">Willow Synthetic</option>`,
  ].join("");
  ezTreeSelect.value = selectedEzTreePreset;
  branchModuleSelect.innerHTML = branchModulePalettes.map(
    (id) => `<option value="${id}">${labelForProcPlantId(id)}</option>`,
  ).join("");
  branchModuleSelect.value = selectedBranchModulePalette;
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
  ezTreeSelect.addEventListener("change", () => {
    selectedEzTreePreset = ezTreeSelect.value;
  });
  branchModuleSelect.addEventListener("change", () => {
    selectedBranchModulePalette = branchModuleSelect.value;
  });
  importedAssetSelect?.addEventListener("change", () => {
    selectedImportedAssetId = importedAssetSelect.value;
  });
  entryEditor.querySelector<HTMLButtonElement>("#add-preset-button")!.addEventListener("click", addPresetEntry);
  entryEditor.querySelector<HTMLButtonElement>("#add-weber-penn-button")!.addEventListener("click", addWeberPennEntry);
  entryEditor.querySelector<HTMLButtonElement>("#add-ez-tree-button")!.addEventListener("click", addEzTreeEntry);
  entryEditor.querySelector<HTMLButtonElement>("#add-branch-module-button")!.addEventListener("click", addBranchModuleEntry);
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
  const isAssetEntry = isAssetMixEntry(entry);
  const isEzTreeEntry = entry.source === "ez-tree";
  const previewGenome = isAssetEntry || isEzTreeEntry ? null : genomeForMixEntry(entry);
  const weberPenn = previewGenome?.weberPenn;
  const branchModules = previewGenome?.branchModules;
  const foliage = previewGenome?.foliage;
  const realism = previewGenome?.treeRealism;
  const foliageMode = previewGenome ? weberFoliageMode(previewGenome) : "plain";
  const fillMass = foliageMode === "plain" ? 0 : foliage?.mass ?? 0;
  const fillSize = foliage?.size ?? (previewGenome?.habit === "conifer" ? 0.34 : 0.54);
  const clump = previewGenome?.clump;
  const groundPlant = Boolean(previewGenome && !weberPenn && !branchModules);
  const ezTree = entry.ezTree;
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
        Add EZ-Tree
        <select id="ez-tree-select"></select>
      </label>
      <button type="button" id="add-ez-tree-button">Add</button>
    </div>
    <div class="add-row">
      <label>
        Add Branch Modules
        <select id="branch-module-select"></select>
      </label>
      <button type="button" id="add-branch-module-button">Add</button>
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
          <div class="inline">
            <label>
              Crown spread
              <input id="tree-crown-spread" type="range" min="0.05" max="1.8" value="${realism?.crownSpread ?? 0.62}" step="0.01" />
              <output>${(realism?.crownSpread ?? 0.62).toFixed(2)}</output>
            </label>
            <label>
              Crown taper
              <input id="tree-crown-taper" type="range" min="0" max="1.45" value="${realism?.crownTaper ?? 0.36}" step="0.01" />
              <output>${(realism?.crownTaper ?? 0.36).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Trunk bend
              <input id="tree-trunk-bend" type="range" min="0" max="0.8" value="${realism?.trunkBend ?? 0.14}" step="0.01" />
              <output>${(realism?.trunkBend ?? 0.14).toFixed(2)}</output>
            </label>
            <label>
              Branch gnarl
              <input id="tree-branch-gnarl" type="range" min="0" max="0.9" value="${realism?.branchGnarl ?? 0.22}" step="0.01" />
              <output>${(realism?.branchGnarl ?? 0.22).toFixed(2)}</output>
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
              <option value="ez-leaf-card" ${foliageMode === "ez-leaf-card" ? "selected" : ""}>EZ leaf cards</option>
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
                <option value="ez-leaf-card" ${weberPenn.foliageSource === "ez-leaf-card" ? "selected" : ""}>EZ leaf card</option>
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
    ${isEzTreeEntry && ezTree ? `
      <section class="weber-editor">
        <h3>EZ-Tree Traits</h3>
        <label>
          Preset
          <select id="ez-entry-preset">
            ${[
              ...ezTreePresetIds.map((id) => `<option value="${id}" ${id === ezTree.preset ? "selected" : ""}>${labelForProcPlantId(id)}</option>`),
              `<option value="Willow Synthetic" ${ezTree.kind === "willow" ? "selected" : ""}>Willow Synthetic</option>`,
            ].join("")}
          </select>
        </label>
        <details open>
          <summary>Structure & Leaves</summary>
          <div class="inline">
            <label>
              Foliage
              <input id="ez-foliage" type="range" min="0" max="3" value="${ezTree.foliage ?? 1}" step="0.01" />
              <output>${(ezTree.foliage ?? 1).toFixed(2)}</output>
            </label>
            <label>
              Branch spread
              <input id="ez-spread" type="range" min="0.35" max="2" value="${ezTree.spread ?? 1}" step="0.01" />
              <output>${(ezTree.spread ?? 1).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Droop
              <input id="ez-droop" type="range" min="0" max="2" value="${ezTree.droop ?? 0}" step="0.01" />
              <output>${(ezTree.droop ?? 0).toFixed(2)}</output>
            </label>
            <label>
              Gnarliness
              <input id="ez-gnarliness" type="range" min="0" max="2.4" value="${ezTree.gnarliness ?? 1}" step="0.01" />
              <output>${(ezTree.gnarliness ?? 1).toFixed(2)}</output>
            </label>
          </div>
        </details>
        <details>
          <summary>Colors</summary>
          <div class="inline">
            <label>
              Bark color
              <input id="ez-bark-color" type="color" value="${toHexColor(ezTree.barkColor, ezTree.kind === "pine" ? 0x6a5132 : 0x6b4a2c)}" />
            </label>
            <label>
              Leaf color
              <input id="ez-leaf-color" type="color" value="${toHexColor(ezTree.leafColor, ezTree.kind === "pine" ? 0x5f8461 : 0x6f9a45)}" />
            </label>
          </div>
          <label>
            Textures
            <select id="ez-textures">
              <option value="true" ${ezTree.textures === false ? "" : "selected"}>On</option>
              <option value="false" ${ezTree.textures === false ? "selected" : ""}>Off</option>
            </select>
          </label>
        </details>
      </section>
    ` : ""}
    ${branchModules ? `
      <section class="weber-editor">
        <h3>Branch Module Architecture</h3>
        <label>
          Palette
          <select id="branch-module-palette">
            ${branchModulePalettes.map((id) => `<option value="${id}" ${id === branchModules.palette ? "selected" : ""}>${labelForProcPlantId(id)}</option>`).join("")}
          </select>
        </label>
        <button type="button" id="branch-module-randomize">Randomize</button>
        <details open>
          <summary>Architecture</summary>
          <div class="inline">
            <label>
              Module budget
              <input id="branch-module-budget" type="range" min="18" max="220" value="${branchModules.moduleBudget ?? 96}" step="1" />
              <output>${branchModules.moduleBudget ?? 96}</output>
            </label>
            <label>
              Levels
              <input id="branch-module-levels" type="range" min="1" max="6" value="${branchModules.levels ?? 3}" step="1" />
              <output>${branchModules.levels ?? 3}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Vigor
              <input id="branch-module-vigor" type="range" min="0.15" max="2.2" value="${branchModules.vigor ?? 1}" step="0.01" />
              <output>${(branchModules.vigor ?? 1).toFixed(2)}</output>
            </label>
            <label>
              Branch density
              <input id="branch-module-density" type="range" min="0.15" max="3" value="${branchModules.branchDensity ?? 1.2}" step="0.01" />
              <output>${(branchModules.branchDensity ?? 1.2).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Branch angle
              <input id="branch-module-angle" type="range" min="0.25" max="1.75" value="${branchModules.branchAngle ?? 1}" step="0.01" />
              <output>${(branchModules.branchAngle ?? 1).toFixed(2)}</output>
            </label>
            <label>
              Spread
              <input id="branch-module-spread" type="range" min="0.25" max="2" value="${branchModules.spread ?? 0.9}" step="0.01" />
              <output>${(branchModules.spread ?? 0.9).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Droop
              <input id="branch-module-droop" type="range" min="0" max="2" value="${branchModules.droop ?? 0.18}" step="0.01" />
              <output>${(branchModules.droop ?? 0.18).toFixed(2)}</output>
            </label>
            <label>
              Phototropism
              <input id="branch-module-tropism" type="range" min="0" max="1.5" value="${branchModules.tropism ?? 0.48}" step="0.01" />
              <output>${(branchModules.tropism ?? 0.48).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Gnarliness
              <input id="branch-module-gnarliness" type="range" min="0" max="1.6" value="${branchModules.gnarliness ?? 0.24}" step="0.01" />
              <output>${(branchModules.gnarliness ?? 0.24).toFixed(2)}</output>
            </label>
            <label>
              Collision bias
              <input id="branch-module-collision" type="range" min="0" max="1.4" value="${branchModules.collisionBias ?? 0.45}" step="0.01" />
              <output>${(branchModules.collisionBias ?? 0.45).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Foliage source
              <select id="branch-module-foliage">
                <option value="procplants" ${(branchModules.foliageSource ?? "procplants") === "procplants" ? "selected" : ""}>Procplants leaf</option>
                <option value="conifer-spray" ${branchModules.foliageSource === "conifer-spray" ? "selected" : ""}>Conifer spray</option>
              </select>
            </label>
          </div>
        </details>
        <details open>
          <summary>Foliage</summary>
          <div class="inline">
            <label>
              Mass
              <input id="branch-module-foliage-mass" type="range" min="0" max="2.2" value="${foliage?.mass ?? 0.88}" step="0.01" />
              <output>${(foliage?.mass ?? 0.88).toFixed(2)}</output>
            </label>
            <label>
              Density
              <input id="branch-module-foliage-density" type="range" min="0.2" max="2.6" value="${foliage?.clusterDensity ?? 1.18}" step="0.01" />
              <output>${(foliage?.clusterDensity ?? 1.18).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Size
              <input id="branch-module-foliage-size" type="range" min="0.08" max="1.6" value="${foliage?.size ?? 0.62}" step="0.01" />
              <output>${(foliage?.size ?? 0.62).toFixed(2)}</output>
            </label>
            <label>
              Tip bias
              <input id="branch-module-foliage-tip" type="range" min="0" max="1" value="${foliage?.tipBias ?? 0.58}" step="0.01" />
              <output>${(foliage?.tipBias ?? 0.58).toFixed(2)}</output>
            </label>
          </div>
        </details>
      </section>
    ` : ""}
    ${groundPlant ? `
      <section class="weber-editor">
        <h3>Ground Plant Habit & Clumps</h3>
        <details open>
          <summary>Habit</summary>
          <div class="inline">
            <label>
              Branch spread
              <input id="plant-branch-angle" type="range" min="0.05" max="1.55" value="${previewGenome!.branchAngle.mean}" step="0.01" />
              <output>${previewGenome!.branchAngle.mean.toFixed(2)}</output>
            </label>
            <label>
              Upright habit
              <input id="plant-apical" type="range" min="0" max="1.35" value="${previewGenome!.apicalDominance}" step="0.01" />
              <output>${previewGenome!.apicalDominance.toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Stem height
              <input id="plant-height" type="range" min="0.02" max="0.8" value="${previewGenome!.internode.base}" step="0.01" />
              <output>${previewGenome!.internode.base.toFixed(2)}</output>
            </label>
            <label>
              Branch variance
              <input id="plant-branch-spread" type="range" min="0" max="1.2" value="${previewGenome!.branchAngle.spread}" step="0.01" />
              <output>${previewGenome!.branchAngle.spread.toFixed(2)}</output>
            </label>
          </div>
        </details>
        ${previewGenome!.flower ? `
        <details open>
          <summary>Flowers</summary>
          <div class="inline">
            <label>
              Bloom size
              <input id="plant-bloom-size" type="range" min="0.04" max="1.2" value="${previewGenome!.flower.radius}" step="0.01" />
              <output>${previewGenome!.flower.radius.toFixed(2)}</output>
            </label>
            <label>
              Flower density
              <input id="clump-flower-density" type="range" min="0" max="1.5" value="${clump?.flowerDensity ?? 0.45}" step="0.01" />
              <output>${(clump?.flowerDensity ?? 0.45).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Petal color
              <input id="plant-flower-color" type="color" value="${toHexColor(previewGenome!.flower.color, 0xff7d68)}" />
            </label>
            <label>
              Center color
              <input id="plant-center-color" type="color" value="${toHexColor(previewGenome!.flower.centerColor, 0xffd35c)}" />
            </label>
          </div>
        </details>
        ` : ""}
        <details open>
          <summary>Clumps</summary>
          <div class="inline">
            <label>
              Shoot count
              <input id="clump-count" type="range" min="1" max="24" value="${clump?.count ?? 1}" step="1" />
              <output>${clump?.count ?? 1}</output>
            </label>
            <label>
              Radius
              <input id="clump-radius" type="range" min="0.02" max="1.5" value="${clump?.radius ?? 0.28}" step="0.01" />
              <output>${(clump?.radius ?? 0.28).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Jitter
              <input id="clump-jitter" type="range" min="0" max="1" value="${clump?.jitter ?? 0.5}" step="0.01" />
              <output>${(clump?.jitter ?? 0.5).toFixed(2)}</output>
            </label>
            <label>
              Lean
              <input id="clump-lean" type="range" min="0" max="1.4" value="${clump?.lean ?? 0.35}" step="0.01" />
              <output>${(clump?.lean ?? 0.35).toFixed(2)}</output>
            </label>
          </div>
          <div class="inline">
            <label>
              Scale variance
              <input id="clump-scale-var" type="range" min="0" max="1" value="${clump?.scaleVar ?? 0.28}" step="0.01" />
              <output>${(clump?.scaleVar ?? 0.28).toFixed(2)}</output>
            </label>
          </div>
        </details>
      </section>
    ` : ""}
    <div class="editor-actions">
      ${isAssetEntry || isEzTreeEntry ? "" : `<button type="button" id="save-entry-preset">Save as Preset</button>`}
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
  const updateGenome = (fn: (genome: ProcPlantGenome) => void, options: { renderList?: boolean; renderEditor?: boolean } = {}) => {
    const genome = editableGenomeForEntry(entry);
    fn(genome);
    renderJson();
    if (options.renderList) renderEntryList();
    if (options.renderEditor) renderEntryEditor();
    rebuildPreview();
  };
  const bindGenomeNumber = (
    selector: string,
    format: (value: number) => string,
    update: (genome: ProcPlantGenome, value: number) => void,
  ) => {
    const input = entryEditor.querySelector<HTMLInputElement>(selector);
    if (!input) return;
    const output = input.nextElementSibling as HTMLOutputElement;
    input.addEventListener("input", () => {
      const value = Number(input.value);
      output.textContent = format(value);
      updateGenome((genome) => update(genome, value));
    });
  };
  const updateEzTree = (fn: (entry: ProcPlantBiomeMixEntry) => void, options: { renderList?: boolean; renderEditor?: boolean } = {}) => {
    fn(entry);
    renderJson();
    if (options.renderList) renderEntryList();
    if (options.renderEditor) renderEntryEditor();
    rebuildPreview();
  };
  const bindEzTreeNumber = (
    selector: string,
    format: (value: number) => string,
    update: (ezTree: NonNullable<ProcPlantBiomeMixEntry["ezTree"]>, value: number) => void,
  ) => {
    const input = entryEditor.querySelector<HTMLInputElement>(selector);
    if (!input || !entry.ezTree) return;
    const output = input.nextElementSibling as HTMLOutputElement;
    input.addEventListener("input", () => {
      const value = Number(input.value);
      output.textContent = format(value);
      updateEzTree((item) => {
        if (item.ezTree) update(item.ezTree, value);
      });
    });
  };
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
  if (groundPlant) {
    const ensureClump = (genome: ProcPlantGenome) => {
      genome.clump = genome.clump ?? { count: 1, radius: 0.28, jitter: 0.5, scaleVar: 0.28, lean: 0.35, flowerDensity: 0.45 };
      return genome.clump;
    };
    bindGenomeNumber("#plant-branch-angle", (v) => v.toFixed(2), (genome, value) => { genome.branchAngle.mean = value; });
    bindGenomeNumber("#plant-apical", (v) => v.toFixed(2), (genome, value) => { genome.apicalDominance = value; });
    bindGenomeNumber("#plant-height", (v) => v.toFixed(2), (genome, value) => {
      const ratio = genome.internode.tip / Math.max(0.001, genome.internode.base);
      genome.internode.base = value;
      genome.internode.tip = Math.max(0.01, value * ratio);
    });
    bindGenomeNumber("#plant-branch-spread", (v) => v.toFixed(2), (genome, value) => { genome.branchAngle.spread = value; });
    bindGenomeNumber("#plant-bloom-size", (v) => v.toFixed(2), (genome, value) => {
      if (genome.flower) genome.flower.radius = value;
    });
    bindGenomeNumber("#clump-flower-density", (v) => v.toFixed(2), (genome, value) => { ensureClump(genome).flowerDensity = value; });
    bindGenomeNumber("#clump-count", (v) => String(Math.round(v)), (genome, value) => { ensureClump(genome).count = Math.round(value); });
    bindGenomeNumber("#clump-radius", (v) => v.toFixed(2), (genome, value) => { ensureClump(genome).radius = value; });
    bindGenomeNumber("#clump-jitter", (v) => v.toFixed(2), (genome, value) => { ensureClump(genome).jitter = value; });
    bindGenomeNumber("#clump-lean", (v) => v.toFixed(2), (genome, value) => { ensureClump(genome).lean = value; });
    bindGenomeNumber("#clump-scale-var", (v) => v.toFixed(2), (genome, value) => { ensureClump(genome).scaleVar = value; });
    entryEditor.querySelector<HTMLInputElement>("#plant-flower-color")?.addEventListener("input", (event) => {
      updateGenome((genome) => {
        if (genome.flower) genome.flower.color = fromHexColor((event.currentTarget as HTMLInputElement).value, genome.flower.color);
      }, { renderList: true });
    });
    entryEditor.querySelector<HTMLInputElement>("#plant-center-color")?.addEventListener("input", (event) => {
      updateGenome((genome) => {
        if (genome.flower) genome.flower.centerColor = fromHexColor((event.currentTarget as HTMLInputElement).value, genome.flower.centerColor);
      });
    });
  }
  if (isEzTreeEntry && entry.ezTree) {
    entryEditor.querySelector<HTMLSelectElement>("#ez-entry-preset")?.addEventListener("change", (event) => {
      const preset = (event.currentTarget as HTMLSelectElement).value;
      updateEzTree((item) => {
        const kind = ezTreeKindForPreset(preset);
        item.ezTree = {
          ...item.ezTree!,
          preset: kind === "willow" ? ezTreePresetForKind(kind) : preset,
          kind,
          droop: kind === "willow" ? Math.max(item.ezTree?.droop ?? 0, 1) : item.ezTree?.droop ?? 0,
        };
        item.label = kind === "willow" ? "EZ Willow" : `EZ ${labelForProcPlantId(preset)}`;
      }, { renderList: true, renderEditor: true });
    });
    bindEzTreeNumber("#ez-foliage", (v) => v.toFixed(2), (ez, value) => { ez.foliage = value; });
    bindEzTreeNumber("#ez-spread", (v) => v.toFixed(2), (ez, value) => { ez.spread = value; });
    bindEzTreeNumber("#ez-droop", (v) => v.toFixed(2), (ez, value) => { ez.droop = value; });
    bindEzTreeNumber("#ez-gnarliness", (v) => v.toFixed(2), (ez, value) => { ez.gnarliness = value; });
    entryEditor.querySelector<HTMLInputElement>("#ez-bark-color")?.addEventListener("input", (event) => {
      updateEzTree((item) => {
        if (item.ezTree) item.ezTree.barkColor = fromHexColor((event.currentTarget as HTMLInputElement).value, 0x6b4a2c);
      }, { renderList: true });
    });
    entryEditor.querySelector<HTMLInputElement>("#ez-leaf-color")?.addEventListener("input", (event) => {
      updateEzTree((item) => {
        if (item.ezTree) item.ezTree.leafColor = fromHexColor((event.currentTarget as HTMLInputElement).value, 0x6f9a45);
      }, { renderList: true });
    });
    entryEditor.querySelector<HTMLSelectElement>("#ez-textures")?.addEventListener("change", (event) => {
      updateEzTree((item) => {
        if (item.ezTree) item.ezTree.textures = (event.currentTarget as HTMLSelectElement).value === "true";
      }, { renderEditor: true });
    });
  }
  if (branchModules) {
    const ensureBranchModules = (genome: ProcPlantGenome) => {
      genome.branchModules = genome.branchModules ?? { palette: "decurrent-broadleaf" };
      return genome.branchModules;
    };
    const ensureFoliage = (genome: ProcPlantGenome) => {
      genome.foliage = genome.foliage ?? { mass: 0.88, clusterDensity: 1.18, whorlDensity: 0.58, tipBias: 0.58, size: 0.62 };
      return genome.foliage;
    };
    entryEditor.querySelector<HTMLSelectElement>("#branch-module-palette")?.addEventListener("change", (event) => {
      const palette = (event.currentTarget as HTMLSelectElement).value as BranchModulePalette;
      updateGenome((genome) => {
        const next = makeBranchModuleGenome(palette, entry.seed);
        genome.id = next.id;
        genome.habit = next.habit;
        genome.branchModules = next.branchModules;
        genome.treeRealism = next.treeRealism;
        genome.foliage = next.foliage;
        genome.leaf = next.leaf;
        genome.lightResponse = next.lightResponse;
        entry.label = `Modules ${labelForProcPlantId(palette)}`;
      }, { renderList: true, renderEditor: true });
    });
    entryEditor.querySelector<HTMLButtonElement>("#branch-module-randomize")?.addEventListener("click", (event) => {
      const dice = Math.floor(Math.random() * 1_000_000_000);
      updateGenome((genome) => {
        const mutated = mutateBranchModuleGenome(genome, entry.seed ^ dice);
        entry.seed = (entry.seed ^ dice) >>> 0;
        entry.source = "mutation";
        entry.genome = mutated;
        entry.label = `Modules ${labelForProcPlantId(mutated.branchModules?.palette ?? "branch")} Mutation`;
      }, { renderList: true, renderEditor: true });
      flashButtonText(event.currentTarget as HTMLButtonElement, "Mutated");
    });
    bindGenomeNumber("#branch-module-budget", (v) => String(Math.round(v)), (genome, value) => { ensureBranchModules(genome).moduleBudget = Math.round(value); });
    bindGenomeNumber("#branch-module-levels", (v) => String(Math.round(v)), (genome, value) => { ensureBranchModules(genome).levels = Math.round(value); });
    bindGenomeNumber("#branch-module-vigor", (v) => v.toFixed(2), (genome, value) => { ensureBranchModules(genome).vigor = value; });
    bindGenomeNumber("#branch-module-density", (v) => v.toFixed(2), (genome, value) => { ensureBranchModules(genome).branchDensity = value; });
    bindGenomeNumber("#branch-module-angle", (v) => v.toFixed(2), (genome, value) => { ensureBranchModules(genome).branchAngle = value; });
    bindGenomeNumber("#branch-module-spread", (v) => v.toFixed(2), (genome, value) => { ensureBranchModules(genome).spread = value; });
    bindGenomeNumber("#branch-module-droop", (v) => v.toFixed(2), (genome, value) => { ensureBranchModules(genome).droop = value; });
    bindGenomeNumber("#branch-module-tropism", (v) => v.toFixed(2), (genome, value) => { ensureBranchModules(genome).tropism = value; });
    bindGenomeNumber("#branch-module-gnarliness", (v) => v.toFixed(2), (genome, value) => { ensureBranchModules(genome).gnarliness = value; });
    bindGenomeNumber("#branch-module-collision", (v) => v.toFixed(2), (genome, value) => { ensureBranchModules(genome).collisionBias = value; });
    bindGenomeNumber("#branch-module-foliage-mass", (v) => v.toFixed(2), (genome, value) => { ensureFoliage(genome).mass = value; });
    bindGenomeNumber("#branch-module-foliage-density", (v) => v.toFixed(2), (genome, value) => { ensureFoliage(genome).clusterDensity = value; });
    bindGenomeNumber("#branch-module-foliage-size", (v) => v.toFixed(2), (genome, value) => { ensureFoliage(genome).size = value; });
    bindGenomeNumber("#branch-module-foliage-tip", (v) => v.toFixed(2), (genome, value) => { ensureFoliage(genome).tipBias = value; });
    entryEditor.querySelector<HTMLSelectElement>("#branch-module-foliage")?.addEventListener("change", (event) => {
      updateGenome((genome) => {
        ensureBranchModules(genome).foliageSource = (event.currentTarget as HTMLSelectElement).value as NonNullable<ProcPlantGenome["branchModules"]>["foliageSource"];
      }, { renderEditor: true });
    });
  }
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
    const ensureRealism = (genome: ProcPlantGenome) => {
      genome.treeRealism = genome.treeRealism ?? {
        crownSpread: previewGenome!.habit === "conifer" ? 0.36 : 0.62,
        crownTaper: previewGenome!.habit === "conifer" ? 0.82 : 0.36,
        trunkFlare: 0.34,
        trunkBend: previewGenome!.habit === "conifer" ? 0.1 : 0.16,
        branchGnarl: previewGenome!.habit === "conifer" ? 0.16 : 0.26,
        windFlex: 0.48,
        colorVariance: 0.14,
      };
      return genome.treeRealism;
    };
    bindTreeNumber("#tree-crown-spread", (v) => v.toFixed(2), (genome, value) => { ensureRealism(genome).crownSpread = value; });
    bindTreeNumber("#tree-crown-taper", (v) => v.toFixed(2), (genome, value) => { ensureRealism(genome).crownTaper = value; });
    bindTreeNumber("#tree-trunk-bend", (v) => v.toFixed(2), (genome, value) => { ensureRealism(genome).trunkBend = value; });
    bindTreeNumber("#tree-branch-gnarl", (v) => v.toFixed(2), (genome, value) => { ensureRealism(genome).branchGnarl = value; });
    entryEditor.querySelector<HTMLSelectElement>("#weber-foliage-mode")!.addEventListener("change", (event) => {
      const mode = (event.currentTarget as HTMLSelectElement).value as WeberFoliageMode;
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
        genome.weberPenn!.foliageSource = (event.currentTarget as HTMLSelectElement).value as "species" | "procplants" | "conifer-spray" | "ez-leaf-card";
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

let previewBuildRequest = 0;
const rebuildPreview = async () => {
  const request = ++previewBuildRequest;
  const enabled = normalizedEnabledEntries();
  const needsEzTree = enabled.some((entry) => entry.source === "ez-tree");
  const ezTreeModule = needsEzTree ? await getEzTreeModule() : null;
  if (request !== previewBuildRequest) return;
  while (previewGroup.children.length) {
    const child = previewGroup.children.pop();
    if (child) {
      previewGroup.remove(child);
      if (child.userData.importedAssetClone) disposeImportedAssetInstance(child);
      else disposeObject(child);
    }
  }
  const weightTotal = enabled.reduce((sum, entry) => sum + Math.max(0.01, entry.weight), 0) || 1;
  let rendered = 0;
  let currentVertices = 0;
  enabled.forEach((entry, entryIndex) => {
    const assetKey = isAssetMixEntry(entry) ? entry.asset.libraryId ?? entry.id : "";
    const assetPrototype = isAssetMixEntry(entry) ? importedAssets.get(assetKey) : undefined;
    if (isAssetMixEntry(entry) && !assetPrototype) return;
    const genome = isAssetMixEntry(entry) || entry.source === "ez-tree" ? null : genomeForMixEntry(entry);
    const share = Math.max(0.01, entry.weight) / weightTotal;
    if (genome?.habit === "grass") {
      const grassCount = Math.max(
        80,
        Math.min(2400, Math.round(720 * currentMix.density * entry.density * (0.6 + share * 1.6))),
      );
      const grassWorld = buildGrassWorldObject(entry, genome, grassCount);
      const verticesPerTuft = geometryVertexCount(grassWorld);
      currentVertices += verticesPerTuft * grassCount;
      previewGroup.add(grassWorld);
      rendered += grassCount;
      return;
    }
    const prototype = entry.source === "ez-tree"
      ? buildEzTreeObject(entry, ezTreeModule!)
      : assetPrototype ?? buildProcPlantObject(genome!, entry.seed, entry.environment);
    const verticesPerPlant = geometryVertexCount(prototype);
    const habitCap = isAssetMixEntry(entry) || entry.source === "ez-tree" || genome?.habit === "tree" || genome?.habit === "conifer" || genome?.habit === "palm" ? 12 : 36;
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
