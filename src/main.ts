import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildProcPlantInstancedParts,
  buildProcPlantRuntimePackage,
  buildProcPlantTemplate,
  buildProcPlantTemplateFromGraph,
  createProcPlantDaylilyBloomGeometry,
  createProcPlantAerialRootGeometry,
  createProcPlantBerryGeometry,
  createProcPlantConeGeometry,
  createProcPlantFlowerCenterGeometry,
  createProcPlantFlowerDiscGeometry,
  createProcPlantFlobotCupBloomGeometry,
  createProcPlantFlobotPetal2BloomGeometry,
  createProcPlantFlobotPinkBloomGeometry,
  createProcPlantFernFrondGeometry,
  createProcPlantFoxgloveBloomGeometry,
  createProcPlantHibiscusBloomGeometry,
  createProcPlantConiferSprayGeometry,
  createProcPlantGrassBladeGeometry,
  createProcPlantLeafGeometry,
  createProcPlantMossTuftGeometry,
  createProcPlantPalmFrondGeometry,
  createProcPlantPetalGeometry,
  createProcPlantFruitGeometry,
  createProcPlantThornGeometry,
  defaultPlantEnvironment,
  GOLDEN_ANGLE_RADIANS,
  hybridizePlantGenomes,
  procPlantPresets,
  type ProcPlantInstance,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantGraph,
  type ProcPlantInstancedParts,
  type ProcPlantTemplate,
} from "./procplants";
import {
  allProcPlantPresetIds,
  installSavedProcPlantPresets,
  labelForPresetId,
  saveProcPlantPreset,
  savedPresetLabelMap,
} from "./saved-presets";
import {
  addProcPlantInstanceWindAttributes,
  addProcPlantSwayAttribute,
  createProcPlantWindShadowMaterials,
  createProcPlantWindUniforms,
  installProcPlantWindShader,
  PROCPLANT_WIND_PHASE_ATTRIBUTE,
} from "./procplant-wind";
import {
  ProcPlantLodCompiler,
  ProcPlantLodController,
  type ProcPlantCompiledLod,
} from "./procplant-lod";
import type { ProcPlantInstanceLodPool } from "./procplant-instance-lod-pool";
import type { ProcPlantThreeVisibilityLodAdapter } from "./procplant-three-visibility-lod-adapter";
import type { ProcPlantDebugOverlay } from "./procplant-debug";
import type { ProcPlantPruneTool } from "./procplant-prune-tool";
import {
  applyProcPlantVariant,
  procPlantHealthState,
  type ProcPlantSeason,
} from "./plant-variants";
import type { ProcPlantCutout } from "./procplant-cutout";
import type {
  ProcPlantThreeImpostorChannelRenderPackage,
  ProcPlantThreeImpostorPackage,
} from "./procplant-impostor-three";
import type { ProcPlantDenseImpostorPool } from "./procplant-dense-impostor-pool";
import type {
  ProcPlantCrownVolumeTool,
  ProcPlantCrownVolumeValues,
} from "./procplant-crown-volume-tool";
import {
  cloneProcPlantFreeformCrown,
  deserializeProcPlantFreeformCrown,
  serializeProcPlantFreeformCrown,
  type ProcPlantFreeformCrown,
} from "./procplant-space-colonization";
import type {
  ProcPlantOrganPlacementPackage,
  ProcPlantPlaceableOrganKind,
} from "./procplant-organ-placement-overrides";
import type { ProcPlantBakedMaterialBundle } from "./procplant-material-bake";
import type { ProcPlantThreeBakedMaterialSet } from "./procplant-three-material-adapter";
import type {
  ProcPlantHeroSpineEditor,
  ProcPlantHeroSpineEditorState,
} from "./procplant-hero-spine-editor";
import type { ProcPlantMeshSpine } from "./procplant-mesh-helper";
import type { ProcPlantLabHeroPreview } from "./procplant-lab-authoring-imports";

type SpeciesId = string;

interface LabState {
  primary: SpeciesId;
  secondary: SpeciesId;
  hybrid: number;
  seed: number;
  light: number;
  moisture: number;
  crowding: number;
  warmth: number;
  density: number;
  foliage: number;
  leafSize: number;
  bloomSize: number;
  flowerDensity: number;
  clumpCount: number;
  clumpSpread: number;
  clumpLean: number;
  habitSpread: number;
  habitUpright: number;
  season: ProcPlantSeason;
  health: number;
  maturity: number;
  windExposure: number;
  wetness: number;
  snow: number;
  pruning: number;
  stylization: number;
  biomeAdaptation: number;
  crownWidth: number;
  crownHeight: number;
  crownDepth: number;
  crownDensity: number;
  crownField: ProcPlantFreeformCrown | null;
  tubeResolution: number;
  collarStrength: number;
  barkRoughness: number;
}

const state: LabState = {
  primary: "tropicalAroid",
  secondary: "phiFern",
  hybrid: 0,
  seed: 1842,
  light: 0.78,
  moisture: 0.68,
  crowding: 0.24,
  warmth: 0.72,
  density: 0.78,
  // 1.0 = "use the preset as authored". These multiply the genome's own values
  // so a slider at 1 is a no-op and moving it scales foliage/leaf/clump live.
  foliage: 1,
  leafSize: 1,
  bloomSize: 1,
  flowerDensity: 1,
  clumpCount: 1,
  clumpSpread: 1,
  clumpLean: 1,
  habitSpread: 1,
  habitUpright: 1,
  season: "summer",
  health: 1,
  maturity: 1,
  windExposure: 0,
  wetness: 0,
  snow: 0,
  pruning: 0,
  stylization: 0,
  biomeAdaptation: 0,
  crownWidth: 1,
  crownHeight: 1,
  crownDepth: 1,
  crownDensity: 1,
  crownField: null,
  tubeResolution: 1,
  collarStrength: 1,
  barkRoughness: 1,
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

app.innerHTML = `
  <div class="stage"></div>
  <section class="panel" aria-label="Procedural plant controls">
    <h1>Procplants Lab</h1>
    <p>Deterministic phi-phyllotaxis plants with light-shaped growth, procedural leaf silhouettes, grass carpets, ferns, flowers, and hybrid genomes.</p>
    <a class="source-link" href="https://github.com/DavinciDreams/procedural-plant-lab" target="_blank" rel="noreferrer">GitHub</a>
    <a class="source-link" href="/biome-mixer.html">Biome Mixer</a>
    <div class="control-grid">
      <div class="field">
        <label for="primary"><span>Primary</span></label>
        <select id="primary"></select>
      </div>
      <div class="field">
        <label for="secondary"><span>Hybrid Mate</span></label>
        <select id="secondary"></select>
      </div>
      <div class="field">
        <label for="hybrid"><span>Hybrid Mix</span><span id="hybridValue"></span></label>
        <input id="hybrid" type="range" min="0" max="1" value="0" step="0.01" />
      </div>
      <div class="field">
        <label for="light"><span>Light</span><span id="lightValue"></span></label>
        <input id="light" type="range" min="0.08" max="1" value="0.78" step="0.01" />
      </div>
      <div class="field">
        <label for="moisture"><span>Moisture</span><span id="moistureValue"></span></label>
        <input id="moisture" type="range" min="0" max="1" value="0.68" step="0.01" />
      </div>
      <div class="field">
        <label for="crowding"><span>Crowding</span><span id="crowdingValue"></span></label>
        <input id="crowding" type="range" min="0" max="1" value="0.24" step="0.01" />
      </div>
      <div class="field">
        <label for="density"><span>Biome Density</span><span id="densityValue"></span></label>
        <input id="density" type="range" min="0.15" max="1" value="0.78" step="0.01" />
      </div>
      <div class="field">
        <label for="foliage"><span>Foliage Mass</span><span id="foliageValue"></span></label>
        <input id="foliage" type="range" min="0" max="2.5" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="leafSize"><span>Leaf Size</span><span id="leafSizeValue"></span></label>
        <input id="leafSize" type="range" min="0.4" max="2.5" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="bloomSize"><span>Bloom Size</span><span id="bloomSizeValue"></span></label>
        <input id="bloomSize" type="range" min="0.35" max="2.8" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="flowerDensity"><span>Flower Density</span><span id="flowerDensityValue"></span></label>
        <input id="flowerDensity" type="range" min="0" max="2.5" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="clumpCount"><span>Clump Count</span><span id="clumpCountValue"></span></label>
        <input id="clumpCount" type="range" min="0" max="3" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="clumpSpread"><span>Clump Spread</span><span id="clumpSpreadValue"></span></label>
        <input id="clumpSpread" type="range" min="0.3" max="3" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="clumpLean"><span>Clump Lean</span><span id="clumpLeanValue"></span></label>
        <input id="clumpLean" type="range" min="0" max="2.5" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="habitSpread"><span>Habit Spread</span><span id="habitSpreadValue"></span></label>
        <input id="habitSpread" type="range" min="0.35" max="2.4" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="habitUpright"><span>Habit Upright</span><span id="habitUprightValue"></span></label>
        <input id="habitUpright" type="range" min="0.35" max="2.2" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="season"><span>Season</span></label>
        <select id="season">
          <option value="spring">Spring</option>
          <option value="summer">Summer</option>
          <option value="autumn">Autumn</option>
          <option value="winter">Winter</option>
        </select>
      </div>
      <div class="field">
        <label for="health"><span>Health</span><span id="healthValue"></span></label>
        <input id="health" type="range" min="0" max="1" value="1" step="0.05" />
      </div>
      <div class="field">
        <label for="maturity"><span>Maturity</span><span id="maturityValue"></span></label>
        <input id="maturity" type="range" min="0.08" max="1" value="1" step="0.04" />
      </div>
      <div class="button-row variant-strip" role="group" aria-label="Season variants">
        <button type="button" data-season="spring">Spring</button>
        <button type="button" data-season="summer">Summer</button>
        <button type="button" data-season="autumn">Autumn</button>
        <button type="button" data-season="winter">Winter</button>
      </div>
      <details class="advanced-controls">
        <summary>Growth macros</summary>
        <p>Safe, deterministic authoring rules. Zero preserves the authored preset.</p>
        <div class="advanced-grid">
          <div class="field">
            <label for="windExposure"><span>Wind exposure</span><span id="windExposureValue"></span></label>
            <input id="windExposure" type="range" min="0" max="1" value="0" step="0.05" />
          </div>
          <div class="field">
            <label for="wetness"><span>Wetness</span><span id="wetnessValue"></span></label>
            <input id="wetness" type="range" min="0" max="1" value="0" step="0.05" />
          </div>
          <div class="field">
            <label for="snow"><span>Snow load</span><span id="snowValue"></span></label>
            <input id="snow" type="range" min="0" max="1" value="0" step="0.05" />
          </div>
          <div class="field">
            <label for="pruning"><span>Pruning pressure</span><span id="pruningValue"></span></label>
            <input id="pruning" type="range" min="0" max="1" value="0" step="0.05" />
          </div>
          <div class="field">
            <label for="stylization"><span>Stylization</span><span id="stylizationValue"></span></label>
            <input id="stylization" type="range" min="0" max="1" value="0" step="0.05" />
          </div>
          <div class="field">
            <label for="biomeAdaptation"><span>Biome adaptation</span><span id="biomeAdaptationValue"></span></label>
            <input id="biomeAdaptation" type="range" min="0" max="1" value="0" step="0.05" />
          </div>
        </div>
      </details>
      <details class="advanced-controls">
        <summary>Crown and swept tubes</summary>
        <p>Live controls for space-colonized presets such as Colonized Hazel Shrub.</p>
        <div class="advanced-grid">
          <div class="field"><label for="crownWidth"><span>Crown width</span><span id="crownWidthValue"></span></label><input id="crownWidth" type="range" min="0.5" max="1.8" value="1" step="0.05" /></div>
          <div class="field"><label for="crownHeight"><span>Crown height</span><span id="crownHeightValue"></span></label><input id="crownHeight" type="range" min="0.5" max="1.8" value="1" step="0.05" /></div>
          <div class="field"><label for="crownDepth"><span>Crown depth</span><span id="crownDepthValue"></span></label><input id="crownDepth" type="range" min="0.5" max="1.8" value="1" step="0.05" /></div>
          <div class="field"><label for="crownDensity"><span>Attractor density</span><span id="crownDensityValue"></span></label><input id="crownDensity" type="range" min="0.4" max="1.6" value="1" step="0.05" /></div>
          <div class="field"><label for="tubeResolution"><span>Tube resolution</span><span id="tubeResolutionValue"></span></label><input id="tubeResolution" type="range" min="0.6" max="1.6" value="1" step="0.1" /></div>
          <div class="field"><label for="collarStrength"><span>Junction collars</span><span id="collarStrengthValue"></span></label><input id="collarStrength" type="range" min="0" max="2" value="1" step="0.05" /></div>
          <div class="field"><label for="barkRoughness"><span>Bark roughness</span><span id="barkRoughnessValue"></span></label><input id="barkRoughness" type="range" min="0" max="2" value="1" step="0.05" /></div>
        </div>
        <div id="crownVolumeActions" class="crown-volume-actions" hidden>
          <button id="crownVolumeMode" type="button" aria-pressed="false" aria-controls="crownWidth crownHeight crownDepth" disabled>Crown Handles</button>
          <button id="crownVolumeAdd" type="button" disabled>Add Crown Lobe</button>
          <button id="crownVolumeSubtract" type="button" disabled>Add Cutout Lobe</button>
          <button id="crownVolumeRemove" type="button" disabled>Remove Selected Lobe</button>
          <small>Axis handles scale the field. Gold points move individual bounded crown lobes.</small>
          <div id="crownLobeControls" class="advanced-grid crown-lobe-controls" hidden>
            <div class="field"><label for="crownLobeWidth"><span>Lobe width</span><span id="crownLobeWidthValue"></span></label><input id="crownLobeWidth" type="range" min="0.05" max="10" value="1" step="0.05" /></div>
            <div class="field"><label for="crownLobeHeight"><span>Lobe height</span><span id="crownLobeHeightValue"></span></label><input id="crownLobeHeight" type="range" min="0.05" max="10" value="1" step="0.05" /></div>
            <div class="field"><label for="crownLobeDepth"><span>Lobe depth</span><span id="crownLobeDepthValue"></span></label><input id="crownLobeDepth" type="range" min="0.05" max="10" value="1" step="0.05" /></div>
            <div class="field"><label for="crownLobeRotation"><span>Lobe yaw</span><span id="crownLobeRotationValue"></span></label><input id="crownLobeRotation" type="range" min="-180" max="180" value="0" step="1" /></div>
            <div class="field"><label for="crownLobeWeight"><span>Lobe density</span><span id="crownLobeWeightValue"></span></label><input id="crownLobeWeight" type="range" min="0.1" max="5" value="1" step="0.1" /></div>
          </div>
        </div>
      </details>
      <div class="button-row">
        <button id="randomSeed" type="button">Random Seed</button>
        <button id="regenerate" type="button">Regenerate</button>
      </div>
      <div class="button-row">
        <button id="rollDice" type="button">Roll Dice</button>
        <button id="autoDemo" type="button" aria-pressed="false">Auto Demo</button>
      </div>
      <div class="button-row">
        <button id="saveLink" type="button">Save Link</button>
        <button id="exportJson" type="button">Export JSON</button>
        <button id="exportGlb" type="button">Export GLB</button>
        <button id="savePreset" type="button">Save Preset</button>
      </div>
      <div class="button-row">
        <button id="debugIr" type="button" aria-pressed="false">Debug IR</button>
        <button id="debugFrames" type="button" aria-pressed="false">Frames</button>
        <button id="debugWind" type="button" aria-pressed="false">Wind Colors</button>
      </div>
      <div class="button-row">
        <button id="pruneMode" type="button" aria-pressed="false">Trim Mode</button>
        <button id="pruneSelected" type="button" disabled>Prune Selected</button>
        <button id="undoPrune" type="button" disabled>Undo Trim</button>
      </div>
      <div class="button-row">
        <button id="placementMode" type="button" aria-pressed="false" disabled>Place Organ</button>
        <select id="placementKind" aria-label="Organ type" disabled>
          <option value="leaf">Leaf</option>
          <option value="flower">Flower</option>
          <option value="fruit">Fruit</option>
        </select>
        <button id="undoPlacement" type="button" disabled>Undo Placement</button>
      </div>
      <div class="button-row">
        <button id="inspectReadiness" type="button">Asset QA</button>
        <button id="importCutout" type="button">Import Cutout</button>
        <button id="editCutoutContour" type="button" disabled>Edit Contour</button>
        <button id="inspectGraph" type="button" aria-expanded="false">Graph Preview</button>
        <input id="cutoutFile" type="file" accept="image/png,image/webp,image/jpeg" hidden />
      </div>
      <div class="button-row">
        <button id="bakeImpostor" type="button" disabled>Bake Far Impostor</button>
        <button id="exportImpostor" type="button" disabled>Export Impostor GLB</button>
      </div>
      <div class="button-row">
        <button id="importHeroGlb" type="button">Import Hero GLB</button>
        <button id="clearHeroGlb" type="button" disabled>Clear Hero Import</button>
        <button id="bakeMaterial" type="button">Bake PBR Material</button>
        <input id="heroGlbFile" type="file" accept=".glb,model/gltf-binary" hidden />
      </div>
      <div class="button-row">
        <button id="editHeroSpine" type="button" aria-pressed="false" disabled>Edit Hero Spine</button>
        <button id="addHeroSpinePoint" type="button" disabled>Add Point</button>
        <button id="deleteHeroSpinePoint" type="button" disabled>Delete Point</button>
        <button id="resetHeroSpine" type="button" disabled>Auto-fit Reset</button>
      </div>
      <output id="heroImportStatus" class="save-status" aria-live="polite"></output>
      <output id="materialBakeStatus" class="save-status" aria-live="polite"></output>
      <details class="advanced-controls cutout-controls">
        <summary>Leaf cutout metadata</summary>
        <p>Trace and rebuild the active image without re-importing it.</p>
        <div class="cutout-grid">
          <label>Alpha threshold<input id="cutoutThreshold" type="number" min="0" max="1" value="0.42" step="0.01" /></label>
          <label>Simplify (px)<input id="cutoutSimplify" type="number" min="0" max="32" value="0.8" step="0.1" /></label>
          <label>Atlas padding<input id="cutoutPadding" type="number" min="1" max="64" value="4" step="1" /></label>
          <label>Pivot X<input id="cutoutPivotX" type="number" min="-2" max="2" value="0.5" step="0.01" /></label>
          <label>Pivot Y<input id="cutoutPivotY" type="number" min="-2" max="2" value="0" step="0.01" /></label>
          <label>Attach X<input id="cutoutAttachX" type="number" min="-2" max="2" value="0.5" step="0.01" /></label>
          <label>Attach Y<input id="cutoutAttachY" type="number" min="-2" max="2" value="0" step="0.01" /></label>
          <label>Bend origin X<input id="cutoutBendX" type="number" min="-2" max="2" value="0.5" step="0.01" /></label>
          <label>Bend origin Y<input id="cutoutBendY" type="number" min="-2" max="2" value="0" step="0.01" /></label>
          <label>Bend angle (deg)<input id="cutoutBendAngle" type="number" min="-180" max="180" value="90" step="1" /></label>
        </div>
        <button id="applyCutoutMetadata" type="button" disabled>Rebuild Active Cutout</button>
      </details>
      <section id="graphPreview" class="graph-preview" aria-live="polite" hidden></section>
      <output id="impostorStatus" class="save-status" aria-live="polite"></output>
      <output id="readinessStatus" class="save-status" aria-live="polite"></output>
      <output id="growthStatus" class="growth-status" aria-live="polite" hidden>
        <span class="growth-spinner" aria-hidden="true"></span>
        <span>Growing biome…</span>
      </output>
      <output id="saveStatus" class="save-status" aria-live="polite"></output>
    </div>
    <div class="stats" aria-live="polite">
      <div class="stat"><strong id="triangles">0</strong><span>triangles</span></div>
      <div class="stat"><strong id="plants">0</strong><span>plants</span></div>
      <div class="stat"><strong id="leaves">0</strong><span>organs</span></div>
    </div>
  </section>
`;

const stage = app.querySelector<HTMLDivElement>(".stage")!;
const canvas = document.createElement("canvas");
stage.appendChild(canvas);
const pruneGestureOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
pruneGestureOverlay.classList.add("prune-gesture-overlay");
pruneGestureOverlay.setAttribute("aria-hidden", "true");
const pruneGestureLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
pruneGestureOverlay.appendChild(pruneGestureLine);
stage.appendChild(pruneGestureOverlay);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9d7ee);
scene.fog = new THREE.Fog(0xb9d7ee, 18, 64);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
camera.position.set(5.5, 4.2, 8.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 1.1, 0);

const restoreCameraFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const raw = ["cx", "cy", "cz", "tx", "ty", "tz"].map((key) => params.get(key));
  if (raw.some((value) => value === null || value.trim() === "")) return;
  const [cx, cy, cz, tx, ty, tz] = raw.map(Number);
  if ([cx, cy, cz, tx, ty, tz].every(Number.isFinite)) {
    camera.position.set(cx, cy, cz);
    controls.target.set(tx, ty, tz);
    controls.update();
  }
};

restoreCameraFromUrl();

const sun = new THREE.DirectionalLight(0xfff0c7, 4);
sun.position.set(7, 9, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xc9d9ff, 0x51633d, 1.9));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(7.5, 96),
  new THREE.MeshStandardMaterial({
    color: 0x52683d,
    roughness: 0.92,
    metalness: 0,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(15, 30, 0xffffff, 0xffffff);
grid.material.transparent = true;
grid.material.opacity = 0.12;
grid.position.y = 0.01;
scene.add(grid);

const windUniforms = createProcPlantWindUniforms();
const plantMaterial = installProcPlantWindShader(new THREE.MeshLambertMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
}), windUniforms);

const organMaterial = installProcPlantWindShader(new THREE.MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  side: THREE.DoubleSide,
}), windUniforms);
let liveBakedMaterials: ProcPlantThreeBakedMaterialSet | null = null;
let liveBakedMaterialSourceKey: string | null = null;
const retiredBakedMaterials: ProcPlantThreeBakedMaterialSet[] = [];
let disposeLiveBakedMaterials: ((prepared: ProcPlantThreeBakedMaterialSet) => void) | null = null;
let createLiveProcPlantThreeGeometry: typeof import("./procplant-three-geometry").createProcPlantThreeGeometry | null = null;
const activeBarkMaterial = () => liveBakedMaterials?.bark ?? plantMaterial;
const activeOrganMaterial = () => liveBakedMaterials?.organ ?? organMaterial;
const activeSurfaceMaterials = (): THREE.Material | THREE.Material[] => liveBakedMaterials
  ? [liveBakedMaterials.bark, liveBakedMaterials.organ]
  : plantMaterial;
const bakedMaterialSourceKey = (genome: ProcPlantGenome, seed: number) => [
  genome.id,
  seed >>> 0,
  genome.weberPenn?.barkColor ?? 0x6b4b32,
  genome.leaf.colorA,
  genome.leaf.colorB,
].join(":");
const windShadowMaterials = createProcPlantWindShadowMaterials(windUniforms);
let cutoutLeafId: string | null = null;
let cutoutLeafGeometry: THREE.BufferGeometry | null = null;
let cutoutLeafMaterial: THREE.MeshLambertMaterial | null = null;
let cutoutLeafDepthMaterial: THREE.MeshDepthMaterial | null = null;
let cutoutLeafDistanceMaterial: THREE.MeshDistanceMaterial | null = null;

const configureWindMesh = (
  mesh: THREE.Mesh | THREE.InstancedMesh,
  matrices?: ArrayLike<THREE.Matrix4>,
  swayValues?: ArrayLike<number>,
) => {
  addProcPlantSwayAttribute(mesh.geometry);
  if (mesh instanceof THREE.InstancedMesh) {
    addProcPlantInstanceWindAttributes(mesh, matrices, swayValues);
  }
  if (mesh.castShadow) {
    mesh.customDepthMaterial = windShadowMaterials.depth;
    mesh.customDistanceMaterial = windShadowMaterials.distance;
  }
};

let biomeGroup: THREE.Group | null = null;
let heroMesh: THREE.Mesh | null = null;
interface HeroLodState {
  mesh: THREE.Mesh;
  graph: ProcPlantGraph | null;
  lods: ProcPlantCompiledLod[];
  geometries: THREE.BufferGeometry[];
  controller: ProcPlantLodController;
  biomeTriangles: number;
  biomeDraws: number;
  scale: number;
  impostor: ProcPlantThreeImpostorPackage | ProcPlantThreeImpostorChannelRenderPackage | null;
  impostorBaseQuaternion: THREE.Quaternion;
  impostorFacing: boolean;
}
let heroLodState: HeroLodState | null = null;
type BiomePlacementLodCohort = "tree" | "groundcover-herb";
interface BiomePlacementLodSource {
  placements: THREE.Matrix4[];
  fallbackMeshes: THREE.InstancedMesh[];
  baseTriangles: number;
  baseDraws: number;
  fullTriangles: number;
  poolLabel: string;
  cohort: BiomePlacementLodCohort;
  presetId: string;
  distanceScale: number;
  castShadow: boolean;
}
interface BiomePlacementLodState {
  pool: ProcPlantInstanceLodPool;
  visibilityAdapter: ProcPlantThreeVisibilityLodAdapter;
  lods: readonly ProcPlantCompiledLod[];
  placements: readonly THREE.Matrix4[];
  baseTriangles: number;
  baseDraws: number;
  fullTriangles: number;
  cohort: BiomePlacementLodCohort;
  presetId: string;
  seed: number;
  farLodIndex: number;
  denseImpostorPool: ProcPlantDenseImpostorPool | null;
  lastCameraPosition: THREE.Vector3;
  lastCameraQuaternion: THREE.Quaternion;
  updates: number;
}
let biomePlacementLodState: BiomePlacementLodState | null = null;
let heroDebugOverlay: ProcPlantDebugOverlay | null = null;
let heroPruneTool: ProcPlantPruneTool | null = null;
let heroPruneToolRequest = 0;
let heroPlacementTool: ProcPlantPruneTool | null = null;
let heroPlacementToolRequest = 0;
let crownVolumeTool: ProcPlantCrownVolumeTool | null = null;
let cutoutPreview: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> | null = null;
let heroImportPreview: THREE.Group | null = null;
let heroImportAudit: Record<string, unknown> | null = null;
let heroImportSource: ArrayBuffer | null = null;
let heroImportFileName = "";
let heroImportSpine: ProcPlantMeshSpine | null = null;
let heroSpineEditor: ProcPlantHeroSpineEditor | null = null;
let heroSpineEditorState: ProcPlantHeroSpineEditorState | null = null;
let heroSpineRebuildRequest = 0;
let materialBakeAudit: Record<string, unknown> | null = null;
let materialBakeBundle: ProcPlantBakedMaterialBundle | null = null;
const authoredCutouts: Array<Record<string, unknown>> = [];
interface ActiveCutoutSource {
  id: string;
  fileName: string;
  width: number;
  height: number;
  alpha: Uint8Array;
  rgba: Uint8ClampedArray;
}
let activeCutoutSource: ActiveCutoutSource | null = null;
let activeCutout: ProcPlantCutout | null = null;
const pruneOperations = new Map<string, string[][]>();
const organPlacementPackages = new Map<string, ProcPlantOrganPlacementPackage>();
let pruneModeVisible = false;
let placementModeVisible = false;
let crownVolumeModeVisible = false;
let debugIrVisible = false;
let debugFramesVisible = false;
let debugWindColors = false;
const heroLodCompiler = new ProcPlantLodCompiler();
let currentStats = { triangles: 0, plants: 0, leaves: 0, draws: 0 };
let autoDemoTimer: number | null = null;
let regenerationBusy = false;
let impostorBakeRequest = 0;
let impostorBakeAbort: AbortController | null = null;

interface TreePreviewResponse {
  id: number;
  template?: ProcPlantTemplate;
  stats?: ProcPlantInstancedParts["stats"];
  error?: string;
}

type PreviewPlantParts = Pick<ProcPlantInstancedParts, "stems" | "stats" | "instances">;

let treePreviewWorker: Worker | null = null;
let treePreviewRequest = 0;
let pendingTreePreview: {
  id: number;
  resolve: (value: PreviewPlantParts) => void;
  reject: (reason: Error) => void;
} | null = null;

const ensureTreePreviewWorker = () => {
  if (treePreviewWorker) return treePreviewWorker;
  const worker = new Worker(new URL("./tree-preview-worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<TreePreviewResponse>) => {
    if (!pendingTreePreview || event.data.id !== pendingTreePreview.id) return;
    const pending = pendingTreePreview;
    pendingTreePreview = null;
    if (event.data.error || !event.data.template || !event.data.stats) {
      pending.reject(new Error(event.data.error ?? "Tree preview worker returned incomplete data."));
      return;
    }
    pending.resolve({ stems: event.data.template, stats: event.data.stats, instances: [] });
  });
  worker.addEventListener("error", (event) => {
    if (!pendingTreePreview) return;
    const pending = pendingTreePreview;
    pendingTreePreview = null;
    worker.terminate();
    if (treePreviewWorker === worker) treePreviewWorker = null;
    pending.reject(new Error(event.message || "Tree preview worker failed."));
  });
  treePreviewWorker = worker;
  return worker;
};

const buildTreePreview = (
  genome: ProcPlantGenome,
  seed: number,
  env: ProcPlantEnvironment,
) => new Promise<PreviewPlantParts>((resolve, reject) => {
  if (pendingTreePreview) {
    pendingTreePreview.reject(new DOMException("Tree preview superseded.", "AbortError"));
    pendingTreePreview = null;
    treePreviewWorker?.terminate();
    treePreviewWorker = null;
  }
  const worker = ensureTreePreviewWorker();
  const id = ++treePreviewRequest;
  pendingTreePreview = { id, resolve, reject };
  // The lab preview replaces raw Weber-Penn leaves with its authored crown
  // foliage anyway. Branch-tip anchors avoid generating thousands of hidden
  // leaf sites, while the exported/runtime genome remains unchanged.
  const previewGenome: ProcPlantGenome = genome.weberPenn
    ? {
        ...genome,
        weberPenn: {
          ...genome.weberPenn,
          nativeLeaves: false,
          fillAnchor: "branch-tips",
          maxLeaves: 0,
        },
      }
    : genome;
  worker.postMessage({ id, genome: previewGenome, seed, env });
});

// Warm the worker module after the initial biome is visible so a later dice
// roll does not also pay the worker download/parse cost.
window.setTimeout(() => ensureTreePreviewWorker(), 1_500);

const speciesLabel = (id: string) =>
  savedPresetLabelMap()[id] ?? labelForPresetId(id);

const primarySelect = document.querySelector<HTMLSelectElement>("#primary")!;
const secondarySelect = document.querySelector<HTMLSelectElement>("#secondary")!;
const rangeInputs = {
  hybrid: document.querySelector<HTMLInputElement>("#hybrid")!,
  light: document.querySelector<HTMLInputElement>("#light")!,
  moisture: document.querySelector<HTMLInputElement>("#moisture")!,
  crowding: document.querySelector<HTMLInputElement>("#crowding")!,
  density: document.querySelector<HTMLInputElement>("#density")!,
  foliage: document.querySelector<HTMLInputElement>("#foliage")!,
  leafSize: document.querySelector<HTMLInputElement>("#leafSize")!,
  bloomSize: document.querySelector<HTMLInputElement>("#bloomSize")!,
  flowerDensity: document.querySelector<HTMLInputElement>("#flowerDensity")!,
  clumpCount: document.querySelector<HTMLInputElement>("#clumpCount")!,
  clumpSpread: document.querySelector<HTMLInputElement>("#clumpSpread")!,
  clumpLean: document.querySelector<HTMLInputElement>("#clumpLean")!,
  habitSpread: document.querySelector<HTMLInputElement>("#habitSpread")!,
  habitUpright: document.querySelector<HTMLInputElement>("#habitUpright")!,
  health: document.querySelector<HTMLInputElement>("#health")!,
  maturity: document.querySelector<HTMLInputElement>("#maturity")!,
  windExposure: document.querySelector<HTMLInputElement>("#windExposure")!,
  wetness: document.querySelector<HTMLInputElement>("#wetness")!,
  snow: document.querySelector<HTMLInputElement>("#snow")!,
  pruning: document.querySelector<HTMLInputElement>("#pruning")!,
  stylization: document.querySelector<HTMLInputElement>("#stylization")!,
  biomeAdaptation: document.querySelector<HTMLInputElement>("#biomeAdaptation")!,
  crownWidth: document.querySelector<HTMLInputElement>("#crownWidth")!,
  crownHeight: document.querySelector<HTMLInputElement>("#crownHeight")!,
  crownDepth: document.querySelector<HTMLInputElement>("#crownDepth")!,
  crownDensity: document.querySelector<HTMLInputElement>("#crownDensity")!,
  tubeResolution: document.querySelector<HTMLInputElement>("#tubeResolution")!,
  collarStrength: document.querySelector<HTMLInputElement>("#collarStrength")!,
  barkRoughness: document.querySelector<HTMLInputElement>("#barkRoughness")!,
};
const rangeLabels = {
  hybrid: "hybridValue",
  light: "lightValue",
  moisture: "moistureValue",
  crowding: "crowdingValue",
  density: "densityValue",
  foliage: "foliageValue",
  leafSize: "leafSizeValue",
  bloomSize: "bloomSizeValue",
  flowerDensity: "flowerDensityValue",
  clumpCount: "clumpCountValue",
  clumpSpread: "clumpSpreadValue",
  clumpLean: "clumpLeanValue",
  habitSpread: "habitSpreadValue",
  habitUpright: "habitUprightValue",
  health: "healthValue",
  maturity: "maturityValue",
  windExposure: "windExposureValue",
  wetness: "wetnessValue",
  snow: "snowValue",
  pruning: "pruningValue",
  stylization: "stylizationValue",
  biomeAdaptation: "biomeAdaptationValue",
  crownWidth: "crownWidthValue",
  crownHeight: "crownHeightValue",
  crownDepth: "crownDepthValue",
  crownDensity: "crownDensityValue",
  tubeResolution: "tubeResolutionValue",
  collarStrength: "collarStrengthValue",
  barkRoughness: "barkRoughnessValue",
};
const growthStatus = document.querySelector<HTMLOutputElement>("#growthStatus")!;
const growthStatusText = growthStatus.querySelector<HTMLSpanElement>("span:last-child")!;
const rollDiceButton = document.querySelector<HTMLButtonElement>("#rollDice")!;
const randomSeedButton = document.querySelector<HTMLButtonElement>("#randomSeed")!;
const regenerateButton = document.querySelector<HTMLButtonElement>("#regenerate")!;
const exportGlbButton = document.querySelector<HTMLButtonElement>("#exportGlb")!;
const bakeImpostorButton = document.querySelector<HTMLButtonElement>("#bakeImpostor")!;
const exportImpostorButton = document.querySelector<HTMLButtonElement>("#exportImpostor")!;
const impostorStatus = document.querySelector<HTMLOutputElement>("#impostorStatus")!;
const debugIrButton = document.querySelector<HTMLButtonElement>("#debugIr")!;
const debugFramesButton = document.querySelector<HTMLButtonElement>("#debugFrames")!;
const debugWindButton = document.querySelector<HTMLButtonElement>("#debugWind")!;
const seasonSelect = document.querySelector<HTMLSelectElement>("#season")!;
const seasonButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-season]")];
const inspectReadinessButton = document.querySelector<HTMLButtonElement>("#inspectReadiness")!;
const readinessStatus = document.querySelector<HTMLOutputElement>("#readinessStatus")!;
const importCutoutButton = document.querySelector<HTMLButtonElement>("#importCutout")!;
const importHeroGlbButton = document.querySelector<HTMLButtonElement>("#importHeroGlb")!;
const clearHeroGlbButton = document.querySelector<HTMLButtonElement>("#clearHeroGlb")!;
const heroGlbFileInput = document.querySelector<HTMLInputElement>("#heroGlbFile")!;
const heroImportStatus = document.querySelector<HTMLOutputElement>("#heroImportStatus")!;
const editHeroSpineButton = document.querySelector<HTMLButtonElement>("#editHeroSpine")!;
const addHeroSpinePointButton = document.querySelector<HTMLButtonElement>("#addHeroSpinePoint")!;
const deleteHeroSpinePointButton = document.querySelector<HTMLButtonElement>("#deleteHeroSpinePoint")!;
const resetHeroSpineButton = document.querySelector<HTMLButtonElement>("#resetHeroSpine")!;
const bakeMaterialButton = document.querySelector<HTMLButtonElement>("#bakeMaterial")!;
const materialBakeStatus = document.querySelector<HTMLOutputElement>("#materialBakeStatus")!;
const editCutoutContourButton = document.querySelector<HTMLButtonElement>("#editCutoutContour")!;
const cutoutFileInput = document.querySelector<HTMLInputElement>("#cutoutFile")!;
const applyCutoutMetadataButton = document.querySelector<HTMLButtonElement>("#applyCutoutMetadata")!;
const inspectGraphButton = document.querySelector<HTMLButtonElement>("#inspectGraph")!;
const graphPreview = document.querySelector<HTMLElement>("#graphPreview")!;
const pruneModeButton = document.querySelector<HTMLButtonElement>("#pruneMode")!;
const pruneSelectedButton = document.querySelector<HTMLButtonElement>("#pruneSelected")!;
const undoPruneButton = document.querySelector<HTMLButtonElement>("#undoPrune")!;
const placementModeButton = document.querySelector<HTMLButtonElement>("#placementMode")!;
const placementKindSelect = document.querySelector<HTMLSelectElement>("#placementKind")!;
const undoPlacementButton = document.querySelector<HTMLButtonElement>("#undoPlacement")!;
const crownVolumeModeButton = document.querySelector<HTMLButtonElement>("#crownVolumeMode")!;
const crownVolumeAddButton = document.querySelector<HTMLButtonElement>("#crownVolumeAdd")!;
const crownVolumeSubtractButton = document.querySelector<HTMLButtonElement>("#crownVolumeSubtract")!;
const crownVolumeRemoveButton = document.querySelector<HTMLButtonElement>("#crownVolumeRemove")!;
const crownVolumeActions = document.querySelector<HTMLElement>("#crownVolumeActions")!;
const crownLobeControls = document.querySelector<HTMLElement>("#crownLobeControls")!;
const crownLobeInputs = {
  width: document.querySelector<HTMLInputElement>("#crownLobeWidth")!,
  height: document.querySelector<HTMLInputElement>("#crownLobeHeight")!,
  depth: document.querySelector<HTMLInputElement>("#crownLobeDepth")!,
  rotation: document.querySelector<HTMLInputElement>("#crownLobeRotation")!,
  weight: document.querySelector<HTMLInputElement>("#crownLobeWeight")!,
};
const crownLobeOutputs = {
  width: document.querySelector<HTMLElement>("#crownLobeWidthValue")!,
  height: document.querySelector<HTMLElement>("#crownLobeHeightValue")!,
  depth: document.querySelector<HTMLElement>("#crownLobeDepthValue")!,
  rotation: document.querySelector<HTMLElement>("#crownLobeRotationValue")!,
  weight: document.querySelector<HTMLElement>("#crownLobeWeightValue")!,
};

const isSpeciesId = (value: string | null): value is SpeciesId =>
  !!value && Object.prototype.hasOwnProperty.call(procPlantPresets, value);

const readNumberParam = (params: URLSearchParams, key: string, fallback: number, min = -Infinity, max = Infinity) => {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, min, max) : fallback;
};

const restoreStateFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const primary = params.get("p");
  const secondary = params.get("s");
  if (isSpeciesId(primary)) state.primary = primary;
  if (isSpeciesId(secondary)) state.secondary = secondary;
  state.hybrid = readNumberParam(params, "h", state.hybrid, 0, 1);
  state.seed = Math.round(readNumberParam(params, "seed", state.seed, 0, 1_000_000_000));
  state.light = readNumberParam(params, "l", state.light, 0.08, 1);
  state.moisture = readNumberParam(params, "m", state.moisture, 0, 1);
  state.crowding = readNumberParam(params, "c", state.crowding, 0, 1);
  state.warmth = readNumberParam(params, "w", state.warmth, 0, 1);
  state.density = readNumberParam(params, "d", state.density, 0.15, 1);
  state.foliage = readNumberParam(params, "f", state.foliage, 0, 2.5);
  state.leafSize = readNumberParam(params, "ls", state.leafSize, 0.4, 2.5);
  state.bloomSize = readNumberParam(params, "bs", state.bloomSize, 0.35, 2.8);
  state.flowerDensity = readNumberParam(params, "fd", state.flowerDensity, 0, 2.5);
  state.clumpCount = readNumberParam(params, "cc", state.clumpCount, 0, 3);
  state.clumpSpread = readNumberParam(params, "cs", state.clumpSpread, 0.3, 3);
  state.clumpLean = readNumberParam(params, "cl", state.clumpLean, 0, 2.5);
  state.habitSpread = readNumberParam(params, "hs", state.habitSpread, 0.35, 2.4);
  state.habitUpright = readNumberParam(params, "hu", state.habitUpright, 0.35, 2.2);
  const season = params.get("season");
  if (season === "spring" || season === "summer" || season === "autumn" || season === "winter") state.season = season;
  state.health = readNumberParam(params, "health", state.health, 0, 1);
  state.maturity = readNumberParam(params, "maturity", state.maturity, 0.08, 1);
  state.windExposure = readNumberParam(params, "wind", state.windExposure, 0, 1);
  state.wetness = readNumberParam(params, "wet", state.wetness, 0, 1);
  state.snow = readNumberParam(params, "snow", state.snow, 0, 1);
  state.pruning = readNumberParam(params, "pruning", state.pruning, 0, 1);
  state.stylization = readNumberParam(params, "style", state.stylization, 0, 1);
  state.biomeAdaptation = readNumberParam(params, "adapt", state.biomeAdaptation, 0, 1);
  state.crownWidth = readNumberParam(params, "cw", state.crownWidth, 0.5, 1.8);
  state.crownHeight = readNumberParam(params, "ch", state.crownHeight, 0.5, 1.8);
  state.crownDepth = readNumberParam(params, "cd", state.crownDepth, 0.5, 1.8);
  state.crownDensity = readNumberParam(params, "ca", state.crownDensity, 0.4, 1.6);
  state.tubeResolution = readNumberParam(params, "tr", state.tubeResolution, 0.6, 1.6);
  state.collarStrength = readNumberParam(params, "jc", state.collarStrength, 0, 2);
  state.barkRoughness = readNumberParam(params, "br", state.barkRoughness, 0, 2);
  const crownField = params.get("cf");
  if (crownField) {
    try {
      state.crownField = deserializeProcPlantFreeformCrown(crownField);
      app.dataset.crownFieldRestored = "true";
    } catch (error) {
      state.crownField = null;
      app.dataset.crownFieldRestoreError = error instanceof Error ? error.message : String(error);
    }
  }
};

installSavedProcPlantPresets();
restoreStateFromUrl();

const renderPresetSelectOptions = () => {
  for (const select of [primarySelect, secondarySelect]) {
    select.innerHTML = "";
  }
  for (const id of allProcPlantPresetIds()) {
    for (const select of [primarySelect, secondarySelect]) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = speciesLabel(id);
      select.appendChild(option);
    }
  }
};

renderPresetSelectOptions();
if (!isSpeciesId(state.primary)) state.primary = "tropicalAroid";
if (!isSpeciesId(state.secondary)) state.secondary = "phiFern";
primarySelect.value = state.primary;
secondarySelect.value = state.secondary;


const setText = (id: string, text: string) => {
  document.querySelector<HTMLElement>(`#${id}`)!.textContent = text;
};

const syncControlsFromState = () => {
  primarySelect.value = state.primary;
  secondarySelect.value = state.secondary;
  seasonSelect.value = state.season;
  for (const key of Object.keys(rangeInputs) as Array<keyof typeof rangeInputs>) {
    rangeInputs[key].value = String(state[key]);
    setText(rangeLabels[key], state[key].toFixed(2));
  }
  for (const button of seasonButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.season === state.season));
  }
};

syncControlsFromState();

const setSaveStatus = (text: string) => {
  const status = document.querySelector<HTMLOutputElement>("#saveStatus")!;
  status.textContent = text;
  window.setTimeout(() => {
    if (status.textContent === text) status.textContent = "";
  }, 3200);
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

const stateParams = (includeCamera = false) => {
  const params = new URLSearchParams();
  params.set("p", state.primary);
  params.set("s", state.secondary);
  params.set("h", state.hybrid.toFixed(2));
  params.set("seed", String(state.seed));
  params.set("l", state.light.toFixed(2));
  params.set("m", state.moisture.toFixed(2));
  params.set("c", state.crowding.toFixed(2));
  params.set("w", state.warmth.toFixed(2));
  params.set("d", state.density.toFixed(2));
  params.set("f", state.foliage.toFixed(2));
  params.set("ls", state.leafSize.toFixed(2));
  params.set("bs", state.bloomSize.toFixed(2));
  params.set("fd", state.flowerDensity.toFixed(2));
  params.set("cc", state.clumpCount.toFixed(2));
  params.set("cs", state.clumpSpread.toFixed(2));
  params.set("cl", state.clumpLean.toFixed(2));
  params.set("hs", state.habitSpread.toFixed(2));
  params.set("hu", state.habitUpright.toFixed(2));
  params.set("season", state.season);
  params.set("health", state.health.toFixed(2));
  params.set("maturity", state.maturity.toFixed(2));
  params.set("wind", state.windExposure.toFixed(2));
  params.set("wet", state.wetness.toFixed(2));
  params.set("snow", state.snow.toFixed(2));
  params.set("pruning", state.pruning.toFixed(2));
  params.set("style", state.stylization.toFixed(2));
  params.set("adapt", state.biomeAdaptation.toFixed(2));
  params.set("cw", state.crownWidth.toFixed(2));
  params.set("ch", state.crownHeight.toFixed(2));
  params.set("cd", state.crownDepth.toFixed(2));
  params.set("ca", state.crownDensity.toFixed(2));
  params.set("tr", state.tubeResolution.toFixed(2));
  params.set("jc", state.collarStrength.toFixed(2));
  params.set("br", state.barkRoughness.toFixed(2));
  if (state.crownField) params.set("cf", serializeProcPlantFreeformCrown(state.crownField));
  if (includeCamera) {
    params.set("cx", camera.position.x.toFixed(3));
    params.set("cy", camera.position.y.toFixed(3));
    params.set("cz", camera.position.z.toFixed(3));
    params.set("tx", controls.target.x.toFixed(3));
    params.set("ty", controls.target.y.toFixed(3));
    params.set("tz", controls.target.z.toFixed(3));
  }
  return params;
};

const currentShareUrl = (includeCamera = false) => {
  const url = new URL(window.location.href);
  url.search = stateParams(includeCamera).toString();
  return url.toString();
};

const updateAddressState = () => {
  window.history.replaceState(null, "", currentShareUrl(false));
};

const envFromState = (): ProcPlantEnvironment => ({
  ...defaultPlantEnvironment(),
  light: state.light,
  moisture: state.moisture,
  crowding: state.crowding,
  biomeWarmth: state.warmth,
});

// Live customization: scale the selected genome's foliage/leaf/clump by the
// override sliders. A slider at 1.0 leaves the preset untouched. We deep-clone
// the branches we mutate so the shared preset objects are never corrupted.
const overridesActive = () =>
  Math.abs(state.foliage - 1) > 0.001 ||
  Math.abs(state.leafSize - 1) > 0.001 ||
  Math.abs(state.bloomSize - 1) > 0.001 ||
  Math.abs(state.flowerDensity - 1) > 0.001 ||
  Math.abs(state.clumpCount - 1) > 0.001 ||
  Math.abs(state.clumpSpread - 1) > 0.001 ||
  Math.abs(state.clumpLean - 1) > 0.001 ||
  Math.abs(state.habitSpread - 1) > 0.001 ||
  Math.abs(state.habitUpright - 1) > 0.001 ||
  Math.abs(state.crownWidth - 1) > 0.001 ||
  Math.abs(state.crownHeight - 1) > 0.001 ||
  Math.abs(state.crownDepth - 1) > 0.001 ||
  state.crownField !== null ||
  Math.abs(state.crownDensity - 1) > 0.001 ||
  Math.abs(state.tubeResolution - 1) > 0.001 ||
  Math.abs(state.collarStrength - 1) > 0.001 ||
  Math.abs(state.barkRoughness - 1) > 0.001;

const macroRulesActive = () => state.windExposure > 0.001 || state.wetness > 0.001 || state.snow > 0.001 ||
  state.pruning > 0.001 || state.stylization > 0.001 || state.biomeAdaptation > 0.001;
type ProcPlantRulesModule = typeof import("./procplant-rules");
type ProcPlantGraphEditorUiModule = typeof import("./procplant-graph-editor-ui");
type ProcPlantAuthoringToolsModule = typeof import("./procplant-authoring-tools");
type ProcPlantCrownVolumeToolModule = typeof import("./procplant-crown-volume-tool");
type ProcPlantOrganPlacementModule = typeof import("./procplant-organ-placement-overrides");
type ProcPlantGeneratorGraphOperation = import("./procplant-generator-graph").ProcPlantGeneratorGraphOperation;
let procPlantRulesModule: ProcPlantRulesModule | null = null;
let procPlantRulesPromise: Promise<ProcPlantRulesModule> | null = null;
let procPlantRulesFailed = false;
let procPlantGraphEditorUiModule: ProcPlantGraphEditorUiModule | null = null;
let procPlantGraphEditorUiPromise: Promise<ProcPlantGraphEditorUiModule> | null = null;
let procPlantAuthoringToolsModule: ProcPlantAuthoringToolsModule | null = null;
let procPlantAuthoringToolsPromise: Promise<ProcPlantAuthoringToolsModule> | null = null;
let procPlantCrownVolumeToolModule: ProcPlantCrownVolumeToolModule | null = null;
let procPlantCrownVolumeToolPromise: Promise<ProcPlantCrownVolumeToolModule> | null = null;
let procPlantOrganPlacementModule: ProcPlantOrganPlacementModule | null = null;
let procPlantOrganPlacementPromise: Promise<ProcPlantOrganPlacementModule> | null = null;
const graphOverrideOperations = new Map<string, ProcPlantGeneratorGraphOperation[]>();
const loadProcPlantGraphEditorUi = () => {
  if (procPlantGraphEditorUiModule) return Promise.resolve(procPlantGraphEditorUiModule);
  if (procPlantGraphEditorUiPromise) return procPlantGraphEditorUiPromise;
  procPlantGraphEditorUiPromise = import("./procplant-graph-editor-ui").then((module) => {
    procPlantGraphEditorUiModule = module;
    app.dataset.graphEditorLoaded = "true";
    return module;
  }).finally(() => {
    procPlantGraphEditorUiPromise = null;
  });
  return procPlantGraphEditorUiPromise;
};
const loadProcPlantAuthoringTools = () => {
  if (procPlantAuthoringToolsModule) return Promise.resolve(procPlantAuthoringToolsModule);
  if (procPlantAuthoringToolsPromise) return procPlantAuthoringToolsPromise;
  procPlantAuthoringToolsPromise = import("./procplant-authoring-tools").then((module) => {
    procPlantAuthoringToolsModule = module;
    app.dataset.authoringToolsLoaded = "true";
    return module;
  }).finally(() => {
    procPlantAuthoringToolsPromise = null;
  });
  return procPlantAuthoringToolsPromise;
};
const loadProcPlantCrownVolumeTool = () => {
  if (procPlantCrownVolumeToolModule) return Promise.resolve(procPlantCrownVolumeToolModule);
  if (procPlantCrownVolumeToolPromise) return procPlantCrownVolumeToolPromise;
  procPlantCrownVolumeToolPromise = import("./procplant-crown-volume-tool").then((module) => {
    procPlantCrownVolumeToolModule = module;
    app.dataset.crownVolumeToolLoaded = "true";
    return module;
  }).finally(() => {
    procPlantCrownVolumeToolPromise = null;
  });
  return procPlantCrownVolumeToolPromise;
};
const loadProcPlantOrganPlacement = () => {
  if (procPlantOrganPlacementModule) return Promise.resolve(procPlantOrganPlacementModule);
  if (procPlantOrganPlacementPromise) return procPlantOrganPlacementPromise;
  procPlantOrganPlacementPromise = import("./procplant-organ-placement-overrides").then((module) => {
    procPlantOrganPlacementModule = module;
    app.dataset.organPlacementLoaded = "true";
    return module;
  }).finally(() => {
    procPlantOrganPlacementPromise = null;
  });
  return procPlantOrganPlacementPromise;
};
const loadProcPlantRules = () => {
  if (procPlantRulesModule) return Promise.resolve(procPlantRulesModule);
  if (procPlantRulesPromise) return procPlantRulesPromise;
  procPlantRulesPromise = import("./procplant-rules").then((module) => {
    procPlantRulesModule = module;
    app.dataset.macroRulesLoaded = "true";
    if (macroRulesActive()) regenerate();
    return module;
  }).finally(() => {
    procPlantRulesPromise = null;
  });
  return procPlantRulesPromise;
};

const applyOverrides = (genome: ProcPlantGenome): ProcPlantGenome => {
  if (!overridesActive()) return genome;
  const next: ProcPlantGenome = {
    ...genome,
    leaf: { ...genome.leaf, length: { ...genome.leaf.length } },
    flower: genome.flower ? { ...genome.flower } : undefined,
    internode: { ...genome.internode },
    branchAngle: { ...genome.branchAngle },
    lightResponse: { ...genome.lightResponse },
  };
  const treeLike = genome.habit === "tree" || genome.habit === "conifer" || genome.habit === "palm";
  const clamped = THREE.MathUtils.clamp;

  if (Math.abs(state.leafSize - 1) > 0.001) {
    next.leaf.length = {
      ...genome.leaf.length,
      base: genome.leaf.length.base * state.leafSize,
      tip: genome.leaf.length.tip * state.leafSize,
    };
  }

  if (genome.foliage && (Math.abs(state.foliage - 1) > 0.001 || Math.abs(state.leafSize - 1) > 0.001)) {
    next.foliage = {
      ...genome.foliage,
      mass: genome.foliage.mass * state.foliage,
      size: (genome.foliage.size ?? (genome.habit === "conifer" ? 0.34 : 0.56)) * state.leafSize,
    };
  }

  if (genome.flower && Math.abs(state.bloomSize - 1) > 0.001) {
    next.flower = {
      ...genome.flower,
      radius: clamped(genome.flower.radius * state.bloomSize, 0.03, 2.2),
    };
  }

  if (treeLike && (Math.abs(state.habitSpread - 1) > 0.001 || Math.abs(state.habitUpright - 1) > 0.001)) {
    const conifer = genome.habit === "conifer";
    const realism = genome.treeRealism ?? {
      crownSpread: conifer ? 0.36 : 0.62,
      crownTaper: conifer ? 0.82 : 0.36,
      trunkFlare: 0.34,
      trunkBend: conifer ? 0.1 : 0.16,
      branchGnarl: conifer ? 0.16 : 0.26,
      windFlex: conifer ? 0.52 : 0.48,
      colorVariance: 0.14,
    };
    next.treeRealism = {
      ...realism,
      crownSpread: clamped(realism.crownSpread * state.habitSpread, 0.04, 1.85),
      crownTaper: clamped(realism.crownTaper * (2 - state.habitSpread * 0.35) + (state.habitUpright - 1) * 0.28, 0.02, 1.45),
      trunkBend: clamped(realism.trunkBend * (2 - state.habitUpright * 0.55), 0, 0.8),
    };
    if (genome.foliage) {
      next.foliage = {
        ...next.foliage!,
        whorlDensity: clamped((next.foliage?.whorlDensity ?? genome.foliage.whorlDensity) * state.habitSpread, 0, 1.8),
        tipBias: clamped((next.foliage?.tipBias ?? genome.foliage.tipBias) + (state.habitUpright - 1) * 0.16, 0, 1),
      };
    }
  }

  if (!treeLike && (Math.abs(state.habitSpread - 1) > 0.001 || Math.abs(state.habitUpright - 1) > 0.001)) {
    next.branchAngle = {
      ...next.branchAngle,
      mean: clamped(genome.branchAngle.mean * state.habitSpread, 0.08, 1.55),
      spread: clamped(genome.branchAngle.spread * (0.65 + state.habitSpread * 0.45), 0, 1.2),
    };
    next.apicalDominance = clamped(genome.apicalDominance * state.habitUpright + (state.habitUpright - 1) * 0.12, 0, 1.35);
    const heightScale = clamped(0.82 + (state.habitUpright - 1) * 0.34, 0.58, 1.42);
    next.internode = {
      ...next.internode,
      base: genome.internode.base * heightScale,
      tip: genome.internode.tip * heightScale,
    };
    next.leaf.curl = clamped(genome.leaf.curl + (1 - state.habitUpright) * 0.12, -0.4, 0.8);
  }

  // Clump: scale count/spread/lean, or synthesize a clump if the user dials
  // count up on a preset that has none (herbaceous plants only).
  if (!treeLike && (
    Math.abs(state.clumpCount - 1) > 0.001 ||
    Math.abs(state.clumpSpread - 1) > 0.001 ||
    Math.abs(state.clumpLean - 1) > 0.001 ||
    Math.abs(state.flowerDensity - 1) > 0.001 ||
    Math.abs(state.habitSpread - 1) > 0.001
  )) {
    const baseClump = genome.clump ?? { count: 1, radius: 0.28, jitter: 0.5, scaleVar: 0.28, lean: 0.35, flowerDensity: 0.45 };
    const count = Math.max(1, Math.round(baseClump.count * state.clumpCount));
    if (count > 1) {
      next.clump = {
        ...baseClump,
        count,
        radius: baseClump.radius * state.clumpSpread * (0.8 + state.habitSpread * 0.2),
        lean: (baseClump.lean ?? 0.18) * state.clumpLean * (2 - state.habitUpright * 0.35),
        flowerDensity: clamped((baseClump.flowerDensity ?? 0.45) * state.flowerDensity, 0, 1.5),
      };
    } else {
      next.clump = undefined;
    }
  }

  const crownControlsActive = Math.abs(state.crownWidth - 1) > 0.001 ||
    Math.abs(state.crownHeight - 1) > 0.001 || Math.abs(state.crownDepth - 1) > 0.001 ||
    Math.abs(state.crownDensity - 1) > 0.001 || Math.abs(state.tubeResolution - 1) > 0.001 ||
    Math.abs(state.collarStrength - 1) > 0.001 || Math.abs(state.barkRoughness - 1) > 0.001 ||
    state.crownField !== null;
  if (genome.spaceColonization && crownControlsActive) {
    const gene = genome.spaceColonization;
    const [width, height, depth] = gene.volume.dimensions;
    const [centerX, centerY, centerZ] = gene.volume.center;
    const sourceField = state.crownField ?? gene.freeform;
    const freeform = sourceField ? {
      ...cloneProcPlantFreeformCrown(sourceField),
      volumes: sourceField.volumes.map((control) => ({
        ...control,
        center: [
          centerX + (control.center[0] - centerX) * state.crownWidth,
          centerY + (control.center[1] - centerY) * state.crownHeight,
          centerZ + (control.center[2] - centerZ) * state.crownDepth,
        ] as const,
        dimensions: [
          control.dimensions[0] * state.crownWidth,
          control.dimensions[1] * state.crownHeight,
          control.dimensions[2] * state.crownDepth,
        ] as const,
      })),
    } : undefined;
    next.spaceColonization = {
      ...gene,
      volume: {
        ...gene.volume,
        dimensions: [width * state.crownWidth, height * state.crownHeight, depth * state.crownDepth],
      },
      freeform,
      attractorCount: Math.round(clamped(gene.attractorCount * state.crownDensity, 24, 4096)),
      maxNodes: Math.round(clamped(gene.maxNodes * state.crownDensity, 32, 2048)),
      radialSegments: Math.round(clamped((gene.radialSegments ?? 5) * state.tubeResolution, 3, 8)),
      barkIrregularity: clamped((gene.barkIrregularity ?? 0.05) * state.barkRoughness, 0, 0.45),
      collarStrength: 0.24 * state.collarStrength,
      collarLength: gene.collarLength ?? 0.22,
      junctionAo: gene.junctionAo ?? 0.2,
    };
  }

  return next;
};

const applyGraphGenomeOverrides = (genome: ProcPlantGenome): ProcPlantGenome => {
  const operations = graphOverrideOperations.get(genome.id);
  if (!operations?.length || !procPlantGraphEditorUiModule) return genome;
  return procPlantGraphEditorUiModule.compileProcPlantGraphEditorState(genome, state.seed, operations).applyAudit.genome;
};

const graphExecutionSeedForGenome = (genome: ProcPlantGenome): number => {
  const operations = graphOverrideOperations.get(genome.id);
  if (!operations?.length || !procPlantGraphEditorUiModule) return state.seed;
  return procPlantGraphEditorUiModule.compileProcPlantGraphEditorState(genome, state.seed, operations).applyAudit.executionSeed;
};

const selectedSourceGenome = (): ProcPlantGenome => {
  const a = procPlantPresets[state.primary];
  const b = procPlantPresets[state.secondary];
  return state.hybrid <= 0.001
    ? a
    : hybridizePlantGenomes(a, b, state.hybrid, state.seed ^ 0x9e3779b9);
};

const selectedBaseGenome = (applyGraph = true): ProcPlantGenome => {
  const base = selectedSourceGenome();
  const overridden = applyOverrides(base);
  let authored = overridden;
  if (macroRulesActive()) {
    if (!procPlantRulesModule && !procPlantRulesFailed) {
      void loadProcPlantRules().catch((error) => {
        procPlantRulesFailed = true;
        console.error("[procplants] Macro rules failed to load.", error);
        setSaveStatus("Advanced macro rules could not be loaded; base authoring controls remain available.");
      });
    } else if (procPlantRulesModule) {
      const activeRuleNames = new Set([
        "wind-exposure", "wetness-response", "snow-load", "pruning-response", "stylization", "biome-adaptation",
      ]);
      authored = procPlantRulesModule.applyProcPlantMacroRules(overridden, {
        windExposure: state.windExposure,
        wetness: state.wetness,
        snow: state.snow,
        pruning: state.pruning,
        stylization: state.stylization,
        biomeAdaptation: state.biomeAdaptation,
      }, procPlantRulesModule.PROCPLANT_DEFAULT_MACRO_RULES.filter((rule) => activeRuleNames.has(rule.name))).genome;
    }
  }
  return applyGraph ? applyGraphGenomeOverrides(authored) : authored;
};

const currentPruneKey = () => stateParams(false).toString();

const currentPruneHistory = () => pruneOperations.get(currentPruneKey()) ?? [];

const currentPruneOperations = () => [...new Set(currentPruneHistory().flat())].sort();

const currentPlacementPackage = () => organPlacementPackages.get(currentPruneKey()) ?? null;

const selectedGenome = (): ProcPlantGenome => {
  const base = selectedBaseGenome();
  const variantActive = state.season !== "summer" || Math.abs(state.health - 1) > 0.001 || Math.abs(state.maturity - 1) > 0.001;
  return variantActive
    ? applyProcPlantVariant(base, { season: state.season, health: state.health, maturity: state.maturity })
    : base;
};

const selectedGeneratorSeed = () => graphExecutionSeedForGenome(selectedBaseGenome(false));

const crownVolumeValues = (): ProcPlantCrownVolumeValues => ({
  width: state.crownWidth,
  height: state.crownHeight,
  depth: state.crownDepth,
});

const syncCrownDimensionControls = () => {
  for (const [key, label] of [
    ["crownWidth", "crownWidthValue"],
    ["crownHeight", "crownHeightValue"],
    ["crownDepth", "crownDepthValue"],
  ] as const) {
    rangeInputs[key].value = String(state[key]);
    setText(label, state[key].toFixed(2));
  }
};

const applyCrownVolumeValues = (values: ProcPlantCrownVolumeValues) => {
  state.crownWidth = THREE.MathUtils.clamp(values.width, 0.5, 1.8);
  state.crownHeight = THREE.MathUtils.clamp(values.height, 0.5, 1.8);
  state.crownDepth = THREE.MathUtils.clamp(values.depth, 0.5, 1.8);
  syncCrownDimensionControls();
  updateAddressState();
  app.dataset.crownVolumeWidth = state.crownWidth.toFixed(2);
  app.dataset.crownVolumeHeight = state.crownHeight.toFixed(2);
  app.dataset.crownVolumeDepth = state.crownDepth.toFixed(2);
};

const applyCrownField = (field: ProcPlantFreeformCrown | null) => {
  state.crownField = field ? cloneProcPlantFreeformCrown(field) : null;
  updateAddressState();
  app.dataset.crownFieldVolumeCount = String(state.crownField?.volumes.length ?? 0);
  app.dataset.crownFieldContract = state.crownField?.contract ?? "legacy";
};

let crownVolumeToolRequest = 0;
const syncCrownLobeControls = () => {
  const control = crownVolumeTool?.getSelectedControlVolume() ?? null;
  crownLobeControls.hidden = !control;
  for (const input of Object.values(crownLobeInputs)) input.disabled = regenerationBusy || !control;
  if (!control) {
    delete app.dataset.crownLobeDimensions;
    delete app.dataset.crownLobeRotation;
    delete app.dataset.crownLobeWeight;
    delete app.dataset.crownLobeOperation;
    return;
  }
  const rotation = control.rotation
    ? THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...control.rotation), "YXZ").y)
    : 0;
  const values = {
    width: control.dimensions[0],
    height: control.dimensions[1],
    depth: control.dimensions[2],
    rotation: Math.round(rotation),
    weight: control.weight ?? 1,
  };
  crownLobeInputs.weight.disabled = regenerationBusy || control.operation === "subtract";
  for (const key of Object.keys(values) as Array<keyof typeof values>) {
    crownLobeInputs[key].value = String(values[key]);
    crownLobeOutputs[key].textContent = key === "rotation" ? `${values[key]}°` : Number(values[key]).toFixed(2);
  }
  app.dataset.crownLobeDimensions = control.dimensions.map((value) => value.toFixed(2)).join(",");
  app.dataset.crownLobeRotation = String(values.rotation);
  app.dataset.crownLobeWeight = Number(values.weight).toFixed(2);
  app.dataset.crownLobeOperation = control.operation ?? "add";
};

const disposeCrownVolumeTool = () => {
  crownVolumeToolRequest++;
  crownVolumeTool?.dispose();
  crownVolumeTool = null;
  delete app.dataset.crownVolumeActive;
  delete app.dataset.crownVolumeDragging;
  delete app.dataset.crownVolumeAxis;
  delete app.dataset.crownVolumeSelected;
  crownVolumeAddButton.disabled = true;
  crownVolumeSubtractButton.disabled = true;
  crownVolumeRemoveButton.disabled = true;
  syncCrownLobeControls();
  controls.enabled = !pruneModeVisible && !placementModeVisible;
};

const syncCrownVolumeButton = () => {
  const available = Boolean(selectedSourceGenome().spaceColonization);
  if (!available && crownVolumeModeVisible) {
    crownVolumeModeVisible = false;
    disposeCrownVolumeTool();
  }
  crownVolumeActions.hidden = !available;
  crownVolumeModeButton.disabled = regenerationBusy || !available;
  crownVolumeModeButton.setAttribute("aria-pressed", String(crownVolumeModeVisible));
  crownVolumeModeButton.textContent = crownVolumeModeVisible ? "Hide Crown Handles" : "Crown Handles";
  crownVolumeAddButton.disabled = regenerationBusy || !available || !crownVolumeModeVisible || !crownVolumeTool;
  crownVolumeSubtractButton.disabled = crownVolumeAddButton.disabled;
  crownVolumeRemoveButton.disabled = crownVolumeAddButton.disabled || !crownVolumeTool?.getSelectedVolumeId();
  syncCrownLobeControls();
  app.dataset.crownVolumeAvailable = String(available);
  if (!crownVolumeModeVisible) delete app.dataset.crownVolumeActive;
};

const refreshCrownVolumeTool = async () => {
  const request = ++crownVolumeToolRequest;
  crownVolumeTool?.dispose();
  crownVolumeTool = null;
  syncCrownVolumeButton();
  const target = heroLodState;
  const gene = selectedSourceGenome().spaceColonization;
  if (!crownVolumeModeVisible || !target || !gene) return;
  const module = await loadProcPlantCrownVolumeTool();
  if (
    request !== crownVolumeToolRequest
    || !crownVolumeModeVisible
    || heroLodState !== target
    || !selectedSourceGenome().spaceColonization
  ) return;
  const tool = module.createProcPlantCrownVolumeTool({
    canvas,
    camera,
    shape: gene.volume.shape,
    center: gene.volume.center,
    dimensions: gene.volume.dimensions,
    values: crownVolumeValues(),
    freeform: state.crownField ?? gene.freeform ?? null,
    min: 0.5,
    max: 1.8,
    step: 0.05,
    onPreview: (values, axis) => {
      applyCrownVolumeValues(values);
      app.dataset.crownVolumeAxis = axis;
    },
    onCommit: (values, axis) => {
      applyCrownVolumeValues(values);
      setSaveStatus(`Crown ${axis} set to ${values[axis].toFixed(2)}; rebuilding the supported volume dimension.`);
      regenerate();
    },
    onCancel: (values, axis) => {
      applyCrownVolumeValues(values);
      setSaveStatus(`Crown ${axis} drag canceled; restored ${values[axis].toFixed(2)}.`);
    },
    onDraggingChange: (dragging, axis) => {
      controls.enabled = !dragging && !pruneModeVisible && !placementModeVisible;
      app.dataset.crownVolumeDragging = String(dragging);
      if (axis) app.dataset.crownVolumeAxis = axis;
      else delete app.dataset.crownVolumeAxis;
    },
    onFreeformPreview: (field, volumeId) => {
      applyCrownField(field);
      app.dataset.crownVolumeSelected = volumeId;
    },
    onFreeformCommit: (field, volumeId) => {
      applyCrownField(field);
      if (volumeId) app.dataset.crownVolumeSelected = volumeId;
      else delete app.dataset.crownVolumeSelected;
      crownVolumeRemoveButton.disabled = !volumeId;
      setSaveStatus(field
        ? `Sculpted crown saved with ${field.volumes.length} control volume${field.volumes.length === 1 ? "" : "s"}.`
        : "Freeform crown removed; restored the exact legacy crown volume.");
      regenerate();
    },
    onFreeformCancel: (field, volumeId) => {
      applyCrownField(field);
      app.dataset.crownVolumeSelected = volumeId;
      setSaveStatus(`Crown lobe ${volumeId} drag canceled.`);
    },
    onFreeformDraggingChange: (dragging, volumeId) => {
      controls.enabled = !dragging && !pruneModeVisible && !placementModeVisible;
      app.dataset.crownVolumeDragging = String(dragging);
      if (volumeId) app.dataset.crownVolumeSelected = volumeId;
    },
    onSelectionChange: (volumeId) => {
      crownVolumeRemoveButton.disabled = !volumeId;
      if (volumeId) app.dataset.crownVolumeSelected = volumeId;
      else delete app.dataset.crownVolumeSelected;
      syncCrownLobeControls();
    },
  });
  tool.root.position.copy(target.mesh.position);
  tool.root.quaternion.copy(target.impostorFacing ? target.impostorBaseQuaternion : target.mesh.quaternion);
  tool.root.scale.copy(target.mesh.scale);
  crownVolumeTool = tool;
  scene.add(tool.root);
  app.dataset.crownVolumeActive = "true";
  applyCrownVolumeValues(crownVolumeValues());
  applyCrownField(state.crownField ?? gene.freeform ?? null);
  syncCrownVolumeButton();
};

let graphPreviewRequest = 0;
const renderGraphPreview = async () => {
  if (graphPreview.hidden) return;
  const request = ++graphPreviewRequest;
  graphPreview.replaceChildren();
  graphPreview.textContent = "Building dependency preview...";
  const editorModule = await loadProcPlantGraphEditorUi();
  if (request !== graphPreviewRequest || graphPreview.hidden) return;

  const sourceGenome = selectedBaseGenome(false);
  const graphKey = sourceGenome.id;
  const operations = graphOverrideOperations.get(graphKey) ?? [];
  editorModule.renderProcPlantGraphEditor({
    container: graphPreview,
    sourceGenome,
    seed: state.seed,
    operations,
    onOperationsChanged: (nextOperations) => {
      graphOverrideOperations.set(graphKey, nextOperations);
      regenerate(80);
      void renderGraphPreview();
    },
    onReset: () => {
      graphOverrideOperations.delete(graphKey);
      regenerate(80);
      void renderGraphPreview();
    },
  });
};

const templateToGeometry = (template: ProcPlantTemplate) => {
  // Worker transfers give this thread exclusive ownership of these arrays, so
  // the geometry may borrow them without another full tree-buffer copy.
  const built = createLiveProcPlantThreeGeometry?.(template, {
    zeroCopy: true,
    tangents: liveBakedMaterials !== null,
  });
  const geometry = built?.geometry ?? new THREE.BufferGeometry();
  if (!built) {
    geometry.setAttribute("position", new THREE.BufferAttribute(template.pos, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(template.nrm, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(template.col, 3));
    addProcPlantSwayAttribute(geometry, template.sway);
    geometry.setIndex(new THREE.BufferAttribute(template.idx, 1));
    geometry.computeBoundingSphere();
  }
  for (const attribute of Object.values(geometry.attributes)) {
    if (attribute instanceof THREE.BufferAttribute) attribute.setUsage(THREE.StaticDrawUsage);
  }
  geometry.index?.setUsage(THREE.StaticDrawUsage);
  if (built) geometry.userData.procplantThreeGeometry = built.audit;
  if (built) geometry.userData.procplantSurfacePartition = built.partition;
  return geometry;
};

const rand = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type InstanceBucket = {
  key: string;
  kind: ProcPlantInstance["kind"];
  genome: ProcPlantGenome;
  instances: ProcPlantInstance[];
  lodFallback: boolean;
};

const instanceKey = (kind: ProcPlantInstance["kind"], genome: ProcPlantGenome) => {
  if (kind === "leaf") {
    return [
      kind,
      cutoutLeafId ?? "procedural",
      genome.leaf.shape,
      genome.leaf.widthRatio.toFixed(3),
      genome.leaf.serration.toFixed(3),
      genome.leaf.curl.toFixed(3),
      genome.leaf.venation.toFixed(3),
    ].join(":");
  }
  if (kind === "grassBlade") {
    return [kind, genome.leaf.widthRatio.toFixed(3), genome.leaf.curl.toFixed(3)].join(":");
  }
  if (kind === "coniferSpray" || kind === "fernFrond" || kind === "palmFrond" || kind === "mossTuft") {
    return [kind, genome.id, genome.leaf.widthRatio.toFixed(3), genome.leaf.curl.toFixed(3)].join(":");
  }
  return kind;
};

const geometryForBucket = (bucket: InstanceBucket): THREE.BufferGeometry => {
  if (bucket.kind === "leaf") {
    if (cutoutLeafGeometry) return cutoutLeafGeometry.clone();
    return createProcPlantLeafGeometry(
      bucket.genome.leaf.shape,
      bucket.genome.leaf.widthRatio,
      bucket.genome.leaf.serration,
      bucket.genome.leaf.curl,
      bucket.genome.leaf.venation,
    );
  }
  if (bucket.kind === "grassBlade") {
    return createProcPlantGrassBladeGeometry(bucket.genome.leaf.widthRatio, bucket.genome.leaf.curl);
  }
  if (bucket.kind === "coniferSpray") return createProcPlantConiferSprayGeometry();
  if (bucket.kind === "fernFrond") return createProcPlantFernFrondGeometry();
  if (bucket.kind === "palmFrond") return createProcPlantPalmFrondGeometry();
  if (bucket.kind === "mossTuft") return createProcPlantMossTuftGeometry();
  if (bucket.kind === "fruit") return createProcPlantFruitGeometry();
  if (bucket.kind === "berry") return createProcPlantBerryGeometry();
  if (bucket.kind === "cone") return createProcPlantConeGeometry();
  if (bucket.kind === "thorn") return createProcPlantThornGeometry();
  if (bucket.kind === "aerialRoot") return createProcPlantAerialRootGeometry();
  if (bucket.kind === "petal") return createProcPlantPetalGeometry();
  if (bucket.kind === "flowerDisc") return createProcPlantFlowerDiscGeometry();
  if (bucket.kind === "daylilyBloom") return createProcPlantDaylilyBloomGeometry();
  if (bucket.kind === "hibiscusBloom") return createProcPlantHibiscusBloomGeometry();
  if (bucket.kind === "flobotCupBloom") return createProcPlantFlobotCupBloomGeometry();
  if (bucket.kind === "flobotPetal2Bloom") return createProcPlantFlobotPetal2BloomGeometry();
  if (bucket.kind === "flobotPinkBloom") return createProcPlantFlobotPinkBloomGeometry();
  if (bucket.kind === "foxgloveBloom") return createProcPlantFoxgloveBloomGeometry();
  return createProcPlantFlowerCenterGeometry();
};

type StemInstanceBucket = {
  template: ProcPlantTemplate;
  matrices: THREE.Matrix4[];
  lodFallback: boolean;
};

const grassWorldInfluence = (genome: ProcPlantGenome) => {
  const primaryGrass = procPlantPresets[state.primary]?.habit === "grass" ? 1 - state.hybrid : 0;
  const secondaryGrass = procPlantPresets[state.secondary]?.habit === "grass" ? state.hybrid : 0;
  return Math.max(genome.habit === "grass" ? 1 : 0, primaryGrass + secondaryGrass);
};

const createGrassTuftGeometry = (seed: number, bladeCount = 12): THREE.BufferGeometry => {
  const rng = rand(seed);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < bladeCount; i++) {
    const yaw = i * GOLDEN_ANGLE_RADIANS + (rng() - 0.5) * 0.7;
    const radial = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-radial.z, 0, radial.x);
    const height = 0.34 + rng() * 0.52;
    const width = 0.012 + rng() * 0.014;
    const baseSpread = Math.sqrt(rng()) * 0.075;
    const base = radial.clone().multiplyScalar(baseSpread);
    const bend = radial.clone().multiplyScalar((0.06 + rng() * 0.18) * height);
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

const addGrassCarpet = (
  group: THREE.Group,
  genome: ProcPlantGenome,
  env: ProcPlantEnvironment,
  generatorSeed: number,
) => {
  const influence = grassWorldInfluence(genome);
  if (influence < 0.18) return { tufts: 0, blades: 0, triangles: 0 };
  const rng = rand(generatorSeed ^ 0xb17ade);
  const tuftCount = Math.round(THREE.MathUtils.lerp(180, 1350, state.density) * influence);
  const bladeCount = Math.round(THREE.MathUtils.lerp(8, 15, state.foliage / 2.5));
  const geometry = createGrassTuftGeometry(generatorSeed ^ 0x61a55, bladeCount);
  const mesh = new THREE.InstancedMesh(geometry, activeOrganMaterial(), tuftCount);
  mesh.name = "procedural-grass-carpet";
  // Dense ground cover contributes very little to the silhouette but can
  // multiply directional-shadow work dramatically.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const baseColor = new THREE.Color(genome.leaf.colorA);
  const tipColor = new THREE.Color(genome.leaf.colorB);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < tuftCount; i++) {
    const radius = Math.sqrt(rng()) * 7.2;
    const angle = i * GOLDEN_ANGLE_RADIANS + rng() * 0.38;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const moistureLift = THREE.MathUtils.lerp(0.78, 1.18, env.moisture);
    const shadeStretch = THREE.MathUtils.lerp(0.82, 1.24, 1 - env.light);
    const tuftScale = (0.48 + rng() * 0.62) * moistureLift * shadeStretch * state.leafSize;
    const lean = (rng() - 0.5) * 0.18 + env.crowding * 0.08;
    quat.setFromEuler(new THREE.Euler(lean, rng() * Math.PI * 2, (rng() - 0.5) * 0.08));
    scale.set(tuftScale, tuftScale * (0.78 + state.foliage * 0.18), tuftScale);
    matrix.compose(new THREE.Vector3(x, 0.018, z), quat, scale);
    mesh.setMatrixAt(i, matrix);
    color.copy(baseColor).lerp(tipColor, 0.28 + rng() * 0.62);
    if (rng() < 0.22) color.lerp(new THREE.Color(0xd7c86f), 0.16 + rng() * 0.18);
    mesh.setColorAt(i, color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  configureWindMesh(mesh);
  group.add(mesh);
  currentStats.draws += 1;
  const triangles = ((geometry.index?.count ?? geometry.getAttribute("position").count) / 3) * tuftCount;
  return { tufts: tuftCount, blades: tuftCount * bladeCount, triangles };
};

const addInstanceToBucket = (
  buckets: Map<string, InstanceBucket>,
  kindGenome: ProcPlantGenome,
  instance: ProcPlantInstance,
  worldMatrix: THREE.Matrix4,
  lodFallback = false,
) => {
  // Keep the asynchronously replaceable cohort isolated from companion and
  // locally-adapted meshes so the pool can be installed as one atomic swap.
  const key = `${lodFallback ? "lod-fallback" : "static"}:${instanceKey(instance.kind, kindGenome)}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { key, kind: instance.kind, genome: kindGenome, instances: [], lodFallback };
    buckets.set(key, bucket);
  }
  bucket.instances.push({
    ...instance,
    matrix: worldMatrix.clone().multiply(instance.matrix),
    color: instance.color.clone(),
  });
};

// These presets describe one low, self-contained patch per generated plant.
// Keeping the allowlist explicit prevents vines, tall flowers, branch modules,
// saved hybrids, or future procedural backends from entering this replacement
// path before their placement contract has been checked.
const GROUND_COVER_LOD_PRESETS = new Set([
  "phiFern",
  "brackenFernMat",
  "cloverGroundcover",
  "woodSorrelCarpet",
  "woodlandAnemoneCarpet",
  "creepingPhloxCarpet",
  "wildStrawberryGroundcover",
  "maidenhairFernPatch",
  "woodlandVioletCarpet",
  "trilliumPatch",
  "horsetailColony",
]);
const GROUND_COVER_LOD_DISTANCE_SCALE = 0.22;

const scatterBiome = async (genome: ProcPlantGenome, env: ProcPlantEnvironment, generatorSeed: number) => {
  const rng = rand(generatorSeed ^ 0x5151);
  const buckets = new Map<string, InstanceBucket>();
  const prototypeCache = new Map<string, PreviewPlantParts>();
  const stemBuckets = new Map<string, StemInstanceBucket>();
  // Weber-Penn trees are orders of magnitude more expensive than the graph
  // plants. Build one seeded template and vary it with scale/rotation instead
  // of regenerating the full recursive tree for every biome placement.
  let reusableTree: PreviewPlantParts | null = null;
  if (genome.weberPenn) {
    try {
      reusableTree = await buildTreePreview(genome, generatorSeed, env);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      console.warn("[procplants] Tree worker unavailable; using main-thread fallback.", error);
      reusableTree = buildProcPlantInstancedParts(genome, generatorSeed, env);
    }
  }
  const reusableTreeMatrices: THREE.Matrix4[] = [];
  let reusableTreeMesh: THREE.InstancedMesh | null = null;
  const graphPrimaryMatrices: THREE.Matrix4[] = [];
  const graphPrimaryFallbackMeshes: THREE.InstancedMesh[] = [];
  let graphPrimaryFallbackTriangles = 0;
  // Graph-backed shrubs and woody plants use the same background LOD compiler
  // as the hero. Pool only a canonical local-light cohort: the other light
  // bands and the companion cohort retain the authored environmental variety.
  const graphWoodyLodCandidate =
    !genome.weberPenn
    && !genome.branchModules
    && cutoutLeafGeometry === null
    && (genome.habit === "shrub" || genome.habit === "tree" || genome.habit === "conifer");
  const graphGroundCoverLodCandidate =
    state.hybrid <= 0.001
    && GROUND_COVER_LOD_PRESETS.has(state.primary)
    && !genome.weberPenn
    && !genome.branchModules
    && !genome.spaceColonization
    && cutoutLeafGeometry === null;
  const graphPrimaryLodCandidate = graphWoodyLodCandidate || graphGroundCoverLodCandidate;
  const canonicalLightBand = Math.round(THREE.MathUtils.clamp(env.light, 0, 1) * 3);
  const plantCount =
    genome.habit === "tree" || genome.habit === "conifer" || genome.habit === "palm"
      ? Math.round(8 + state.density * 26)
      : Math.round(25 + state.density * 130);
  let leaves = 0;
  let plants = 0;
  let triangles = 0;
  const castsCanopyShadows = genome.habit === "tree" || genome.habit === "conifer" || genome.habit === "palm";
  for (let i = 0; i < plantCount; i++) {
    const ring = Math.sqrt(rng()) * 6.8;
    const angle = i * GOLDEN_ANGLE_RADIANS + rng() * 0.18;
    const x = Math.cos(angle) * ring;
    const z = Math.sin(angle) * ring;
    if (Math.hypot(x, z) < 1.35 && genome.habit !== "grass") continue;
    const localLight = THREE.MathUtils.clamp(
      env.light + (x / 7) * 0.12 - Math.max(0, 1.4 - Math.hypot(x, z)) * 0.18,
      0.08,
      1,
    );
    const localEnv = {
      ...env,
      light: localLight,
      crowding: THREE.MathUtils.clamp(env.crowding + state.density * 0.18, 0, 1),
    };
    const prototypeVariant = i % 4;
    const companion = genome.habit !== "grass" && i % 5 === 0;
    const species = companion
      ? hybridizePlantGenomes(genome, procPlantPresets.furGrass, 0.12, generatorSeed + prototypeVariant * 101)
      : genome;
    const lightBand = Math.round(localLight * 3);
    const graphPrimaryLodFallback = graphPrimaryLodCandidate && !companion && lightBand === canonicalLightBand;
    const prototypeKey = graphPrimaryLodFallback
      ? `lod-primary:canonical:${lightBand}`
      : `${companion ? "companion" : "primary"}:${prototypeVariant}:${lightBand}`;
    let built: PreviewPlantParts;
    if (reusableTree && species.weberPenn) {
      built = reusableTree;
    } else {
      const cached = prototypeCache.get(prototypeKey);
      if (cached) {
        built = cached;
      } else {
        const prototypeEnv = graphPrimaryLodFallback ? env : { ...localEnv, light: lightBand / 3 };
        built = buildProcPlantInstancedParts(
          species,
          graphPrimaryLodFallback
            ? generatorSeed
            : generatorSeed
              ^ (prototypeVariant * 0x9e3779b9)
              ^ (lightBand * 0x51ed2705)
              ^ (companion ? 0x7f4a7c15 : 0),
          prototypeEnv,
        );
        prototypeCache.set(prototypeKey, built);
      }
    }
    const scale =
      species.habit === "grass"
        ? 0.72 + rng() * 0.42
        : species.habit === "tree"
          ? 1.55 + rng() * 0.8
          : species.habit === "conifer"
            ? 1.3 + rng() * 0.62
            : species.habit === "palm"
              ? 1.3 + rng() * 0.62
              : species.habit === "tropical"
                ? 0.9 + rng() * 0.5
                : 0.8 + rng() * 0.55;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0)),
      new THREE.Vector3(scale, scale, scale),
    );
    if (built === reusableTree) {
      reusableTreeMatrices.push(matrix);
    } else {
      let stemBucket = stemBuckets.get(prototypeKey);
      if (!stemBucket) {
        stemBucket = { template: built.stems, matrices: [], lodFallback: graphPrimaryLodFallback };
        stemBuckets.set(prototypeKey, stemBucket);
      }
      stemBucket.matrices.push(matrix);
      if (graphPrimaryLodFallback) graphPrimaryMatrices.push(matrix);
    }
    for (const instance of built.instances) {
      addInstanceToBucket(buckets, species, instance, matrix, graphPrimaryLodFallback);
    }
    leaves += built.stats.leaves + built.stats.flowers;
    triangles += built.stems.idx.length / 3;
    plants++;
  }
  currentStats.plants = plants;
  currentStats.leaves = leaves;
  const group = new THREE.Group();
  group.name = "procplants-instanced-biome";
  for (const stemBucket of stemBuckets.values()) {
    if (stemBucket.template.idx.length === 0) continue;
    const stemGeometry = templateToGeometry(stemBucket.template);
    const stems = new THREE.InstancedMesh(stemGeometry, activeBarkMaterial(), stemBucket.matrices.length);
    stems.castShadow = castsCanopyShadows;
    stems.receiveShadow = true;
    stems.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < stemBucket.matrices.length; i++) stems.setMatrixAt(i, stemBucket.matrices[i]);
    stems.instanceMatrix.needsUpdate = true;
    configureWindMesh(stems, stemBucket.matrices);
    group.add(stems);
    if (stemBucket.lodFallback) {
      graphPrimaryFallbackMeshes.push(stems);
      graphPrimaryFallbackTriangles += (stemBucket.template.idx.length / 3) * stemBucket.matrices.length;
    }
    currentStats.draws += 1;
  }

  if (reusableTree && reusableTreeMatrices.length > 0) {
    const geometry = templateToGeometry(reusableTree.stems);
    const trees = new THREE.InstancedMesh(geometry, activeBarkMaterial(), reusableTreeMatrices.length);
    trees.name = "procedural-tree-instances";
    trees.castShadow = true;
    trees.receiveShadow = true;
    trees.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < reusableTreeMatrices.length; i++) {
      trees.setMatrixAt(i, reusableTreeMatrices[i]);
    }
    trees.instanceMatrix.needsUpdate = true;
    configureWindMesh(trees, reusableTreeMatrices);
    group.add(trees);
    reusableTreeMesh = trees;
    currentStats.draws += 1;
  }

  for (const bucket of buckets.values()) {
    const geometry = geometryForBucket(bucket);
    const usesCutout = bucket.kind === "leaf" && cutoutLeafMaterial !== null;
    const mesh = new THREE.InstancedMesh(geometry, usesCutout ? cutoutLeafMaterial! : activeOrganMaterial(), bucket.instances.length);
    mesh.castShadow = castsCanopyShadows;
    mesh.receiveShadow =
      bucket.kind !== "flowerDisc" &&
      bucket.kind !== "daylilyBloom" &&
      bucket.kind !== "hibiscusBloom" &&
      bucket.kind !== "flobotCupBloom" &&
      bucket.kind !== "flobotPetal2Bloom" &&
      bucket.kind !== "flobotPinkBloom" &&
      bucket.kind !== "foxgloveBloom";
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < bucket.instances.length; i++) {
      mesh.setMatrixAt(i, bucket.instances[i].matrix);
      mesh.setColorAt(i, bucket.instances[i].color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    configureWindMesh(
      mesh,
      bucket.instances.map((instance) => instance.matrix),
      bucket.instances.map((instance) => instance.sway),
    );
    if (usesCutout && mesh.castShadow && cutoutLeafDepthMaterial && cutoutLeafDistanceMaterial) {
      mesh.customDepthMaterial = cutoutLeafDepthMaterial;
      mesh.customDistanceMaterial = cutoutLeafDistanceMaterial;
    }
    group.add(mesh);
    const bucketTriangles = ((geometry.index?.count ?? geometry.getAttribute("position").count) / 3) * bucket.instances.length;
    triangles += bucketTriangles;
    if (bucket.lodFallback) {
      graphPrimaryFallbackMeshes.push(mesh);
      graphPrimaryFallbackTriangles += bucketTriangles;
    }
    currentStats.draws += 1;
  }

  const carpet = addGrassCarpet(group, genome, env, generatorSeed);
  leaves += carpet.blades;
  triangles += carpet.triangles;
  plants += carpet.tufts;
  currentStats.plants = plants;
  currentStats.leaves = leaves;
  currentStats.triangles = Math.round(triangles);
  const reusableTreeTriangles = reusableTree
    ? (reusableTree.stems.idx.length / 3) * reusableTreeMatrices.length
    : 0;
  const lodPlacements = reusableTreeMesh ? reusableTreeMatrices : graphPrimaryMatrices;
  const lodFallbackMeshes = reusableTreeMesh ? [reusableTreeMesh] : graphPrimaryFallbackMeshes;
  const lodFallbackTriangles = reusableTreeMesh ? reusableTreeTriangles : graphPrimaryFallbackTriangles;
  const lodCohort: BiomePlacementLodCohort = graphGroundCoverLodCandidate ? "groundcover-herb" : "tree";
  return {
    group,
    heroTemplate: reusableTree?.stems,
    generatorBuilds: reusableTree ? 1 : prototypeCache.size,
    treeLodSource: lodPlacements.length > 1 && lodFallbackMeshes.length > 0
      ? {
          placements: lodPlacements,
          fallbackMeshes: lodFallbackMeshes,
          baseTriangles: triangles - lodFallbackTriangles,
          baseDraws: currentStats.draws - lodFallbackMeshes.length,
          fullTriangles: triangles,
          poolLabel: reusableTreeMesh
            ? "procedural-tree"
            : graphGroundCoverLodCandidate
              ? `graph-groundcover-${state.primary}`
              : "graph-woody",
          cohort: lodCohort,
          presetId: state.primary,
          distanceScale: graphGroundCoverLodCandidate
            ? GROUND_COVER_LOD_DISTANCE_SCALE
            : DENSE_TREE_LOD_DISTANCE_SCALE,
          castShadow: graphGroundCoverLodCandidate ? false : true,
        } satisfies BiomePlacementLodSource
      : null,
  };
};

const heroScaleForGenome = (genome: ProcPlantGenome) =>
  genome.habit === "grass"
    ? 2.4
    : genome.habit === "flower"
      ? 2.2
      : genome.habit === "fern"
        ? 2.0
        : genome.habit === "tree" || genome.habit === "conifer" || genome.habit === "palm"
          ? 1.35
          : 1.7;

const disposeHeroLodState = (hero: HeroLodState | null) => {
  if (!hero) return;
  for (const geometry of hero.geometries) {
    if (geometry !== hero.impostor?.geometry) geometry.dispose();
  }
  hero.impostor?.dispose();
  scene.remove(hero.mesh);
};

const syncImpostorButtons = () => {
  const compiled = Boolean(heroLodState?.lods.some((lod) => lod.level === 3));
  bakeImpostorButton.disabled = regenerationBusy || !compiled;
  exportImpostorButton.disabled = regenerationBusy || heroLodState?.impostor === null || !heroLodState;
};

const heroImpostorDirection = new THREE.Vector3();
const syncHeroImpostorView = () => {
  const target = heroLodState;
  if (!target?.impostor || target.controller.active.level !== 3) {
    if (target?.impostorFacing) {
      target.mesh.quaternion.copy(target.impostorBaseQuaternion);
      target.mesh.material = activeSurfaceMaterials();
      target.mesh.castShadow = true;
      target.impostorFacing = false;
    }
    delete app.dataset.heroImpostorActive;
    return;
  }
  heroImpostorDirection.copy(camera.position).sub(target.mesh.position);
  const lengthSq = heroImpostorDirection.lengthSq();
  if (lengthSq <= 1e-10) return;
  heroImpostorDirection.multiplyScalar(1 / Math.sqrt(lengthSq));
  let best = target.impostor.atlas.entries[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of target.impostor.atlas.entries) {
    const outward = candidate.view.outward;
    const score = heroImpostorDirection.x * outward.x
      + heroImpostorDirection.y * outward.y
      + heroImpostorDirection.z * outward.z;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (target.mesh.geometry.userData.procplantImpostor?.viewId !== best.id) {
    target.impostor.setView(best.id);
  }
  target.mesh.material = target.impostor.material;
  target.mesh.castShadow = false;
  target.mesh.lookAt(camera.position);
  target.impostorFacing = true;
  app.dataset.heroImpostorActive = "true";
  app.dataset.heroImpostorView = best.id;
};

const disposeHeroDebugOverlay = () => {
  if (!heroDebugOverlay) return;
  scene.remove(heroDebugOverlay.root);
  heroDebugOverlay.dispose();
  heroDebugOverlay = null;
};

let heroDebugOverlayRequest = 0;
const refreshHeroDebugOverlay = async () => {
  const request = ++heroDebugOverlayRequest;
  disposeHeroDebugOverlay();
  const target = heroLodState;
  if (!debugIrVisible || !target?.graph) {
    app.dataset.heroDebugAvailable = String(Boolean(target?.graph));
    return;
  }
  const { createProcPlantDebugOverlay } = await loadProcPlantAuthoringTools();
  if (request !== heroDebugOverlayRequest || !debugIrVisible || heroLodState !== target || !target.graph) return;
  const overlay = createProcPlantDebugOverlay(target.graph, target.lods, {
    attachments: true,
    branches: true,
    frames: debugFramesVisible,
    lod: true,
    attachmentColorMode: debugWindColors ? "wind" : "kind",
  });
  overlay.root.position.copy(target.mesh.position);
  overlay.root.scale.copy(target.mesh.scale);
  overlay.setActiveLod(target.controller.active.level);
  heroDebugOverlay = overlay;
  scene.add(overlay.root);
  app.dataset.heroDebugAvailable = "true";
};

const disposeHeroPruneTool = () => {
  if (!heroPruneTool) return;
  heroPruneTool.dispose();
  heroPruneTool = null;
};

const syncPruneButtons = () => {
  pruneModeButton.setAttribute("aria-pressed", String(pruneModeVisible));
  pruneModeButton.textContent = pruneModeVisible ? "Exit Trim" : "Trim Mode";
  pruneSelectedButton.disabled = regenerationBusy || !heroPruneTool?.getSelectedSegment();
  undoPruneButton.disabled = regenerationBusy || currentPruneOperations().length === 0;
};

const refreshHeroPruneTool = async () => {
  disposeHeroPruneTool();
  const request = ++heroPruneToolRequest;
  const target = heroLodState;
  if (!pruneModeVisible || !target?.graph) {
    app.dataset.heroPruneAvailable = String(Boolean(target?.graph));
    syncPruneButtons();
    return;
  }
  const { createProcPlantPruneTool } = await loadProcPlantAuthoringTools();
  // The request guard is what catches a mode toggled off and back on across the
  // import; heroLodState alone is unchanged in that case.
  if (request !== heroPruneToolRequest || !pruneModeVisible || heroLodState !== target || !target.graph) return;
  const tool = createProcPlantPruneTool(target.graph, { visible: true, opacity: 0.3, radiusScale: 2.2 });
  tool.object.position.copy(target.mesh.position);
  tool.object.quaternion.copy(target.mesh.quaternion);
  tool.object.scale.copy(target.mesh.scale);
  heroPruneTool = tool;
  scene.add(tool.object);
  app.dataset.heroPruneAvailable = "true";
  syncPruneButtons();
};

const disposeHeroPlacementTool = () => {
  if (!heroPlacementTool) return;
  heroPlacementTool.dispose();
  heroPlacementTool = null;
};

const placementKind = (): ProcPlantPlaceableOrganKind => {
  const value = placementKindSelect.value;
  return value === "flower" || value === "fruit" ? value : "leaf";
};

const syncPlacementButtons = () => {
  const graphAvailable = Boolean(heroLodState?.graph);
  if (!graphAvailable && placementModeVisible) {
    placementModeVisible = false;
    disposeHeroPlacementTool();
    controls.enabled = !pruneModeVisible;
  }
  const genome = selectedGenome();
  const flowerOption = placementKindSelect.querySelector<HTMLOptionElement>('option[value="flower"]');
  if (flowerOption) flowerOption.disabled = !genome.flower;
  if (!genome.flower && placementKindSelect.value === "flower") placementKindSelect.value = "leaf";
  placementModeButton.disabled = regenerationBusy || !graphAvailable;
  placementModeButton.setAttribute("aria-pressed", String(placementModeVisible));
  placementModeButton.textContent = placementModeVisible ? "Exit Place" : "Place Organ";
  placementKindSelect.disabled = regenerationBusy || !graphAvailable;
  undoPlacementButton.disabled = regenerationBusy || (currentPlacementPackage()?.operations.length ?? 0) === 0;
  app.dataset.organPlacementAvailable = String(graphAvailable);
  app.dataset.organPlacementActive = String(placementModeVisible && graphAvailable);
  app.dataset.organPlacementCount = String(currentPlacementPackage()?.operations.length ?? 0);
};

const refreshHeroPlacementTool = async () => {
  disposeHeroPlacementTool();
  const request = ++heroPlacementToolRequest;
  const target = heroLodState;
  if (!placementModeVisible || !target?.graph) {
    syncPlacementButtons();
    return;
  }
  const { createProcPlantPruneTool } = await loadProcPlantAuthoringTools();
  if (request !== heroPlacementToolRequest || !placementModeVisible || heroLodState !== target || !target.graph) return;
  const tool = createProcPlantPruneTool(target.graph, { visible: true, opacity: 0.2, radiusScale: 2.4 });
  tool.object.position.copy(target.mesh.position);
  tool.object.quaternion.copy(target.mesh.quaternion);
  tool.object.scale.copy(target.mesh.scale);
  heroPlacementTool = tool;
  scene.add(tool.object);
  syncPlacementButtons();
};

const disposeGroup = (group: THREE.Group | null) => {
  if (!group) return;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
  scene.remove(group);
};

const disposeHeroImportGroup = (preview: THREE.Group | null) => {
  if (!preview) return;
  preview.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    if (object.userData.procplantOwnsMaterial) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
  });
  scene.remove(preview);
};

const syncHeroSpineButtons = () => {
  const hasImport = heroImportPreview !== null && heroImportSpine !== null && heroImportSource !== null;
  const editing = heroSpineEditor !== null;
  editHeroSpineButton.disabled = regenerationBusy || !hasImport;
  editHeroSpineButton.setAttribute("aria-pressed", String(editing));
  editHeroSpineButton.textContent = editing ? "Finish Hero Spine" : "Edit Hero Spine";
  addHeroSpinePointButton.disabled = regenerationBusy || !editing;
  deleteHeroSpinePointButton.disabled = regenerationBusy || !editing || (heroSpineEditorState?.points.length ?? 0) <= 2;
  resetHeroSpineButton.disabled = regenerationBusy || !editing;
};

const disposeHeroSpineEditor = () => {
  heroSpineEditor?.dispose();
  heroSpineEditor = null;
  syncHeroSpineButtons();
};

const installHeroImportPreview = (authored: ProcPlantLabHeroPreview, fileName: string) => {
  const previous = heroImportPreview;
  heroImportPreview = authored.group;
  heroImportSpine = authored.spine;
  heroImportAudit = {
    ...authored.audit,
    sourceFile: fileName,
    sourceContentHash: authored.sourceContentHash,
    contentHash: authored.contentHash,
  };
  scene.add(authored.group);
  if (heroMesh) heroMesh.visible = false;
  app.dataset.heroImportActive = "true";
  app.dataset.heroImportHash = authored.contentHash;
  app.dataset.heroImportVertices = String(authored.audit.vertexCount);
  app.dataset.heroImportAttachments = String(authored.audit.attachmentsEmitted);
  if (heroSpineEditor) {
    heroSpineEditor.setTarget(authored.trunk);
    heroSpineEditor.copyDisplayTransform(authored.group);
  }
  disposeHeroImportGroup(previous);
  clearHeroGlbButton.disabled = regenerationBusy;
  syncHeroSpineButtons();
};

const disposeHeroImportPreview = () => {
  heroSpineRebuildRequest++;
  disposeHeroSpineEditor();
  disposeHeroImportGroup(heroImportPreview);
  heroImportPreview = null;
  heroImportAudit = null;
  heroImportSource = null;
  heroImportFileName = "";
  heroImportSpine = null;
  heroSpineEditorState = null;
  if (heroMesh) heroMesh.visible = true;
  clearHeroGlbButton.disabled = true;
  delete app.dataset.heroImportActive;
  delete app.dataset.heroImportHash;
  delete app.dataset.heroImportVertices;
  delete app.dataset.heroImportAttachments;
  syncHeroSpineButtons();
};

const DENSE_TREE_LOD_DISTANCE_SCALE = 0.4;
const DENSE_TREE_LOD_CAMERA_STEP_SQ = 0.75 * 0.75;

const clearBiomeDenseImpostorDatasets = () => {
  delete app.dataset.biomeDenseImpostorActive;
  delete app.dataset.biomeDenseImpostorHash;
  delete app.dataset.biomeDenseImpostorPlacements;
  delete app.dataset.biomeDenseImpostorEligible;
  delete app.dataset.biomeDenseImpostorMasked;
  delete app.dataset.biomeDenseImpostorCulled;
  delete app.dataset.biomeDenseImpostorDraws;
  delete app.dataset.biomeDenseImpostorTriangles;
  delete app.dataset.biomeDenseImpostorMigrations;
};

const disposeBiomeDenseImpostorPool = (stateToDispose: BiomePlacementLodState) => {
  stateToDispose.denseImpostorPool?.dispose();
  stateToDispose.denseImpostorPool = null;
  const farMesh = stateToDispose.pool.meshes[stateToDispose.farLodIndex];
  if (farMesh) farMesh.visible = true;
  clearBiomeDenseImpostorDatasets();
};

const disposeBiomePlacementLodState = (stateToDispose: BiomePlacementLodState | null) => {
  if (!stateToDispose) return;
  disposeBiomeDenseImpostorPool(stateToDispose);
  stateToDispose.visibilityAdapter.dispose();
  stateToDispose.pool.dispose();
  if (biomePlacementLodState === stateToDispose) biomePlacementLodState = null;
};

const refreshPreviewGeometryStats = () => {
  if (!heroLodState) return;
  currentStats.triangles = Math.round(heroLodState.biomeTriangles + heroLodState.controller.active.triangles);
  currentStats.draws = heroLodState.biomeDraws + 1;
  setText("triangles", currentStats.triangles.toLocaleString());
  app.dataset.previewDraws = String(currentStats.draws);
};

const refreshPoolWindPhases = (pool: ProcPlantInstanceLodPool) => {
  for (const mesh of pool.meshes) {
    if (!mesh.visible) continue;
    const phase = mesh.geometry.getAttribute(PROCPLANT_WIND_PHASE_ATTRIBUTE) as THREE.InstancedBufferAttribute | undefined;
    if (!phase) continue;
    const matrices = mesh.instanceMatrix.array;
    for (let i = 0; i < mesh.count; i++) {
      const offset = i * 16;
      const value = Math.sin(matrices[offset + 12] * 12.9898 + matrices[offset + 14] * 78.233) * 43758.5453;
      phase.setX(i, (value - Math.floor(value)) * Math.PI * 2);
    }
    phase.clearUpdateRanges();
    if (mesh.count > 0) phase.addUpdateRange(0, mesh.count);
    phase.needsUpdate = true;
  }
};

const syncBiomePlacementLodStats = (stateToSync: BiomePlacementLodState, target: HeroLodState) => {
  let triangles = stateToSync.baseTriangles;
  let draws = stateToSync.baseDraws;
  let lodCounts = "";
  const denseImpostor = stateToSync.denseImpostorPool;
  for (let i = 0; i < stateToSync.lods.length; i++) {
    const count = stateToSync.pool.stats.lodCounts[i];
    if (!denseImpostor || i !== stateToSync.farLodIndex) {
      triangles += count * stateToSync.lods[i].triangles;
      if (count > 0) draws++;
    }
    lodCounts += `${i === 0 ? "" : ","}${count}`;
  }
  if (denseImpostor) {
    triangles += denseImpostor.stats.triangles;
    draws += denseImpostor.stats.draws;
    app.dataset.biomeDenseImpostorActive = "true";
    app.dataset.biomeDenseImpostorHash = denseImpostor.atlas.contentHash;
    app.dataset.biomeDenseImpostorPlacements = String(denseImpostor.stats.placements);
    app.dataset.biomeDenseImpostorEligible = String(denseImpostor.stats.visible + denseImpostor.stats.culled);
    app.dataset.biomeDenseImpostorMasked = String(denseImpostor.stats.masked);
    app.dataset.biomeDenseImpostorCulled = String(denseImpostor.stats.culled);
    app.dataset.biomeDenseImpostorDraws = String(denseImpostor.stats.draws);
    app.dataset.biomeDenseImpostorTriangles = String(denseImpostor.stats.triangles);
    app.dataset.biomeDenseImpostorMigrations = String(denseImpostor.stats.lastMigrations);
  } else {
    clearBiomeDenseImpostorDatasets();
  }
  target.biomeTriangles = Math.round(triangles);
  target.biomeDraws = draws;
  app.dataset.biomeLodCounts = lodCounts;
  app.dataset.biomeLodCohort = stateToSync.cohort;
  app.dataset.biomeLodPreset = stateToSync.presetId;
  app.dataset.biomeLodPlacements = String(stateToSync.pool.stats.placements);
  app.dataset.biomeLodTriangles = String(target.biomeTriangles);
  app.dataset.biomeLodFullTriangles = String(Math.round(stateToSync.fullTriangles));
  app.dataset.biomeLodTriangleSavings = String(Math.max(0, Math.round(stateToSync.fullTriangles - target.biomeTriangles)));
  if (stateToSync.cohort === "groundcover-herb") {
    app.dataset.biomeVisibleGroundcovers = String(stateToSync.pool.stats.visible);
    app.dataset.biomeCulledGroundcovers = String(stateToSync.pool.stats.culled);
    delete app.dataset.biomeVisibleTrees;
    delete app.dataset.biomeCulledTrees;
  } else {
    app.dataset.biomeVisibleTrees = String(stateToSync.pool.stats.visible);
    app.dataset.biomeCulledTrees = String(stateToSync.pool.stats.culled);
    delete app.dataset.biomeVisibleGroundcovers;
    delete app.dataset.biomeCulledGroundcovers;
  }
  app.dataset.biomeLodMigrations = String(stateToSync.pool.stats.lastMigrations);
  app.dataset.biomeLodUpdates = String(stateToSync.updates);
  const visibility = stateToSync.visibilityAdapter.stats;
  app.dataset.biomeVisibilityClusters = String(visibility.clusterCount);
  app.dataset.biomeVisibilityCandidateInstances = String(visibility.candidateInstances);
  app.dataset.biomeVisibilityVisibleClusters = String(visibility.visibleClusters);
  app.dataset.biomeVisibilityRejectedClusters = String(visibility.rejectedClusters);
  app.dataset.biomeVisibilityFrustumRejected = String(visibility.frustumRejectedInstances);
  app.dataset.biomeVisibilityScratchBytes = String(visibility.stableScratchBytes);
  if (heroLodState === target) refreshPreviewGeometryStats();
};

const updateBiomePlacementLodPool = (force = false) => {
  const stateToUpdate = biomePlacementLodState;
  const target = heroLodState;
  if (!stateToUpdate || !target) return false;
  const orientationDelta = 1 - Math.min(1, Math.abs(stateToUpdate.lastCameraQuaternion.dot(camera.quaternion)));
  if (!force
    && orientationDelta < 1e-8
    && stateToUpdate.lastCameraPosition.distanceToSquared(camera.position) < DENSE_TREE_LOD_CAMERA_STEP_SQ) {
    return false;
  }
  stateToUpdate.lastCameraPosition.copy(camera.position);
  stateToUpdate.lastCameraQuaternion.copy(camera.quaternion);
  stateToUpdate.visibilityAdapter.update(camera);
  stateToUpdate.denseImpostorPool?.updateFromCamera(camera);
  stateToUpdate.updates++;
  refreshPoolWindPhases(stateToUpdate.pool);
  syncBiomePlacementLodStats(stateToUpdate, target);
  return true;
};

const installCompiledHeroLods = async (
  request: number,
  target: HeroLodState,
  targetGroup: THREE.Group,
  treeLodSource: BiomePlacementLodSource | null,
  resultPromise: Promise<{ lods: ProcPlantCompiledLod[] | null; error: unknown }>,
) => {
  const result = await resultPromise;
  if (request !== regenerationRequest || heroLodState !== target || biomeGroup !== targetGroup) return;
  if (!result.lods) {
    if (!(result.error instanceof DOMException && result.error.name === "AbortError")) {
      console.warn("[procplants] Hero LOD worker unavailable; keeping full geometry.", result.error);
    }
    app.dataset.heroLodPending = "false";
    syncImpostorButtons();
    return;
  }
  const geometries = result.lods.map((lod) => templateToGeometry(lod.template));
  const controller = new ProcPlantLodController(
    result.lods,
    camera.position.distanceTo(target.mesh.position) / target.scale,
  );
  let nextBiomePlacementLodState: BiomePlacementLodState | null = null;
  // Hoisted so the catch below can dispose whatever was built before the throw.
  let pool: ProcPlantInstanceLodPool | null = null;
  let visibilityAdapter: ProcPlantThreeVisibilityLodAdapter | null = null;
  if (treeLodSource) {
    try {
      const [{ createProcPlantInstanceLodPool }, { createProcPlantThreeVisibilityLodAdapter }] = await Promise.all([
        import("./procplant-instance-lod-pool"),
        import("./procplant-three-visibility-lod-adapter"),
      ]);
      const farLodIndex = result.lods.findIndex((lod) => lod.level === 3);
      pool = createProcPlantInstanceLodPool(
        treeLodSource.placements,
        result.lods.map((lod) => ({
          distance: lod.distance * treeLodSource.distanceScale,
          geometry: geometries[lod.level],
          material: activeSurfaceMaterials(),
          castShadow: treeLodSource.castShadow,
          receiveShadow: true,
          name: `${treeLodSource.poolLabel}-${lod.label}`,
        })),
        {
          hysteresis: 0.12,
          maxDistance: camera.far,
          clusteredCulling: {
            cellSize: treeLodSource.cohort === "groundcover-herb" ? 1.5 : 4,
            maxInstancesPerCluster: 64,
            maxInstances: Math.max(1, treeLodSource.placements.length),
          },
          castShadow: treeLodSource.castShadow,
          receiveShadow: true,
          configureMesh: (mesh) => {
            const activeCount = mesh.count;
            mesh.count = treeLodSource.placements.length;
            configureWindMesh(mesh, treeLodSource.placements);
            const phase = mesh.geometry.getAttribute(PROCPLANT_WIND_PHASE_ATTRIBUTE) as THREE.InstancedBufferAttribute | undefined;
            phase?.setUsage(THREE.DynamicDrawUsage);
            mesh.count = activeCount;
          },
          onPlacementLodChanged: (placementIndex, _previousLevel, nextLevel) => {
            nextBiomePlacementLodState?.denseImpostorPool?.setPlacementVisible(
              placementIndex,
              nextLevel === farLodIndex,
            );
          },
        },
      );
      visibilityAdapter = createProcPlantThreeVisibilityLodAdapter(pool, {
        maxDistance: camera.far,
        frustumPadding: 0.025,
      });
      nextBiomePlacementLodState = {
        pool,
        visibilityAdapter,
        lods: result.lods,
        placements: treeLodSource.placements,
        baseTriangles: treeLodSource.baseTriangles,
        baseDraws: treeLodSource.baseDraws,
        fullTriangles: treeLodSource.fullTriangles,
        cohort: treeLodSource.cohort,
        presetId: treeLodSource.presetId,
        seed: state.seed,
        farLodIndex,
        denseImpostorPool: null,
        lastCameraPosition: camera.position.clone(),
        lastCameraQuaternion: camera.quaternion.clone(),
        updates: 0,
      };
      visibilityAdapter.update(camera);
      nextBiomePlacementLodState.updates++;
      refreshPoolWindPhases(pool);
    } catch (error) {
      // Dispose the local handles: on an early throw nextBiomePlacementLodState is
      // still null, so going through it would leak the pool and the adapter.
      visibilityAdapter?.dispose();
      pool?.dispose();
      console.warn("[procplants] Dense placement LOD pool unavailable; keeping full instances.", error);
      nextBiomePlacementLodState = null;
    }
  }
  // The dynamic imports above yield, so a newer regeneration may have taken over
  // while this run was suspended. Re-check before mutating any shared scene state:
  // proceeding here would dispose the live pool and blank the pooled cohort.
  if (request !== regenerationRequest || heroLodState !== target || biomeGroup !== targetGroup) {
    disposeBiomePlacementLodState(nextBiomePlacementLodState);
    for (const geometry of geometries) geometry.dispose();
    return;
  }
  target.mesh.geometry = geometries[controller.index];
  for (const geometry of target.geometries) geometry.dispose();
  target.lods = result.lods;
  target.geometries = geometries;
  target.controller = controller;
  if (nextBiomePlacementLodState && treeLodSource) {
    targetGroup.add(nextBiomePlacementLodState.pool.root);
    for (const fallbackMesh of treeLodSource.fallbackMeshes) {
      targetGroup.remove(fallbackMesh);
      fallbackMesh.geometry.dispose();
    }
    disposeBiomePlacementLodState(biomePlacementLodState);
    biomePlacementLodState = nextBiomePlacementLodState;
    syncBiomePlacementLodStats(nextBiomePlacementLodState, target);
  } else {
    refreshPreviewGeometryStats();
  }
  app.dataset.heroLod = controller.active.label;
  app.dataset.heroLodLevel = String(controller.active.level);
  app.dataset.heroLodPending = "false";
  syncImpostorButtons();
  void refreshHeroDebugOverlay();
};

const performRegeneration = async (request: number) => {
  const startedAt = performance.now();
  if (readinessStatus.dataset.kind === "qa") {
    readinessStatus.textContent = "Asset QA needs refresh for this authored state.";
    delete readinessStatus.dataset.kind;
    delete app.dataset.readinessScore;
    delete app.dataset.readinessReady;
  }
  const genome = selectedGenome();
  const generatorSeed = selectedGeneratorSeed();
  const materialSourceKey = bakedMaterialSourceKey(genome, generatorSeed);
  if (liveBakedMaterials && liveBakedMaterialSourceKey !== materialSourceKey) {
    retiredBakedMaterials.push(liveBakedMaterials);
    liveBakedMaterials = null;
    liveBakedMaterialSourceKey = null;
    materialBakeBundle = null;
    app.dataset.materialLivePbr = "false";
    delete app.dataset.materialLiveGroups;
    delete app.dataset.materialLiveTangents;
    materialBakeStatus.textContent = "The baked material was detached because the plant genome or generator seed changed. Bake again for this plant.";
  }
  const env = envFromState();
  updateAddressState();
  sun.intensity = 1.4 + state.light * 3.4;
  scene.background = new THREE.Color(0xb9d7ee).lerp(new THREE.Color(0x6f7d8d), 1 - state.light);
  scene.fog = new THREE.Fog(scene.background as THREE.Color, 18, 64);

  currentStats = { triangles: 0, plants: 0, leaves: 0, draws: 0 };
  const authoredPrunes = currentPruneOperations();
  const authoredPlacements = currentPlacementPackage();
  const authoringToolsPromise = authoredPrunes.length > 0 ? loadProcPlantAuthoringTools() : null;
  const placementModulePromise = authoredPlacements?.operations.length ? loadProcPlantOrganPlacement() : null;
  const shouldCompileHeroLods = authoredPrunes.length === 0 && !authoredPlacements?.operations.length;
  const lodResultPromise = shouldCompileHeroLods
    ? heroLodCompiler.compile(genome, generatorSeed, env).then(
        (lods) => ({ lods, error: null }),
        (error: unknown) => ({ lods: null, error }),
      )
    : null;
  const biome = await scatterBiome(genome, env, generatorSeed);
  if (request !== regenerationRequest) {
    disposeGroup(biome.group);
    return;
  }

  // Finish both replacements before removing the visible scene. This keeps a
  // failed or superseded build from leaving a partially-empty preview.
  let heroBuild = biome.heroTemplate ? null : buildProcPlantTemplate(genome, generatorSeed, env);
  if (heroBuild && authoredPrunes.length > 0 && !genome.weberPenn && !genome.branchModules) {
    const { pruneProcPlantGraph } = await authoringToolsPromise!;
    if (request !== regenerationRequest) {
      disposeGroup(biome.group);
      return;
    }
    const pruned = pruneProcPlantGraph(heroBuild.graph, {
      operation: "remove",
      selection: { kind: "segmentIds", segmentIds: authoredPrunes },
    });
    heroBuild = buildProcPlantTemplateFromGraph(genome, pruned.graph, env);
  }
  if (heroBuild && authoredPlacements?.operations.length && !genome.weberPenn && !genome.branchModules && !genome.spaceColonization) {
    const placementModule = await placementModulePromise!;
    if (request !== regenerationRequest) {
      disposeGroup(biome.group);
      return;
    }
    const source = placementModule.createProcPlantOrganPlacementTarget(genome.id, state.seed, heroBuild.graph);
    const applied = placementModule.applyProcPlantOrganPlacementOverrides(heroBuild.graph, source, authoredPlacements);
    app.dataset.organPlacementTargetMatched = String(applied.targetMatched);
    app.dataset.organPlacementApplied = String(applied.appliedOperationIds.length);
    app.dataset.organPlacementUnsupported = String(applied.unsupported.length);
    if (applied.changed) heroBuild = buildProcPlantTemplateFromGraph(genome, applied.graph, env);
  } else {
    delete app.dataset.organPlacementTargetMatched;
    delete app.dataset.organPlacementApplied;
    delete app.dataset.organPlacementUnsupported;
  }
  const template = biome.heroTemplate ?? heroBuild!.template;
  const heroLods: ProcPlantCompiledLod[] = [{
    level: 0,
    label: "full",
    distance: 0,
    template,
    triangles: template.idx.length / 3,
    vertices: template.pos.length / 3,
  }];
  const heroScale = heroScaleForGenome(genome);
  const heroGeometries = [templateToGeometry(template)];
  let nextHero: THREE.Mesh;
  let nextController: ProcPlantLodController;
  try {
    nextController = new ProcPlantLodController(
      heroLods,
      camera.position.length() / heroScale,
    );
    nextHero = new THREE.Mesh(heroGeometries[nextController.index], activeSurfaceMaterials());
  } catch (error) {
    for (const geometry of heroGeometries) geometry.dispose();
    disposeGroup(biome.group);
    throw error;
  }
  nextHero.castShadow = true;
  nextHero.receiveShadow = true;
  nextHero.position.y = 0.02;
  nextHero.scale.setScalar(heroScale);
  nextHero.visible = heroImportPreview === null;
  configureWindMesh(nextHero);
  const nextHeroLodState: HeroLodState = {
    mesh: nextHero,
    graph: heroBuild?.graph ?? null,
    lods: heroLods,
    geometries: heroGeometries,
    controller: nextController,
    biomeTriangles: currentStats.triangles,
    biomeDraws: currentStats.draws,
    scale: heroScale,
    impostor: null,
    impostorBaseQuaternion: nextHero.quaternion.clone(),
    impostorFacing: false,
  };

  const previousBiome = biomeGroup;
  const previousHeroLodState = heroLodState;
  const previousBiomePlacementLodState = biomePlacementLodState;
  biomeGroup = biome.group;
  heroMesh = nextHero;
  heroLodState = nextHeroLodState;
  biomePlacementLodState = null;
  scene.add(biomeGroup, heroMesh);
  disposeBiomePlacementLodState(previousBiomePlacementLodState);
  disposeGroup(previousBiome);
  disposeHeroLodState(previousHeroLodState);
  while (retiredBakedMaterials.length > 0) {
    const retired = retiredBakedMaterials.shift()!;
    disposeLiveBakedMaterials?.(retired);
  }
  if (liveBakedMaterials) {
    app.dataset.materialLivePbr = "true";
    app.dataset.materialLiveGroups = String(nextHero.geometry.groups.length);
    app.dataset.materialLiveTangents = String(nextHero.geometry.hasAttribute("tangent"));
    materialBakeStatus.textContent = `${materialBakeBundle?.images.length ?? 0} deterministic PBR PNG resources installed on live bark/organ surfaces with normal maps and explicit tangents.`;
  }
  void refreshHeroDebugOverlay();
  void refreshHeroPruneTool();
  void refreshHeroPlacementTool();

  delete app.dataset.biomeLodCounts;
  delete app.dataset.biomeLodCohort;
  delete app.dataset.biomeLodPreset;
  delete app.dataset.biomeLodPlacements;
  delete app.dataset.biomeLodTriangles;
  delete app.dataset.biomeLodFullTriangles;
  delete app.dataset.biomeLodTriangleSavings;
  delete app.dataset.biomeVisibleTrees;
  delete app.dataset.biomeCulledTrees;
  delete app.dataset.biomeVisibleGroundcovers;
  delete app.dataset.biomeCulledGroundcovers;
  delete app.dataset.biomeLodMigrations;
  delete app.dataset.biomeLodUpdates;
  delete app.dataset.biomeVisibilityClusters;
  delete app.dataset.biomeVisibilityCandidateInstances;
  delete app.dataset.biomeVisibilityVisibleClusters;
  delete app.dataset.biomeVisibilityRejectedClusters;
  delete app.dataset.biomeVisibilityFrustumRejected;
  delete app.dataset.biomeVisibilityScratchBytes;
  clearBiomeDenseImpostorDatasets();
  delete app.dataset.heroImpostorActive;
  delete app.dataset.heroImpostorView;
  delete app.dataset.heroImpostorHash;
  delete app.dataset.heroImpostorAtlas;
  delete app.dataset.heroImpostorViews;
  delete app.dataset.heroImpostorDistance;
  impostorStatus.textContent = "";
  bakeImpostorButton.textContent = "Bake Far Impostor";
  refreshPreviewGeometryStats();
  setText("plants", currentStats.plants.toLocaleString());
  setText("leaves", currentStats.leaves.toLocaleString());
  growthStatus.dataset.generatorBuilds = String(biome.generatorBuilds);
  growthStatus.dataset.buildMs = (performance.now() - startedAt).toFixed(1);
  app.dataset.heroLod = nextController.active.label;
  app.dataset.heroLodLevel = String(nextController.active.level);
  app.dataset.heroLodPending = String(shouldCompileHeroLods);
  syncImpostorButtons();
  syncCrownVolumeButton();
  syncPlacementButtons();
  if (crownVolumeModeVisible) void refreshCrownVolumeTool();
  if (lodResultPromise) {
    void installCompiledHeroLods(request, nextHeroLodState, biome.group, biome.treeLodSource, lodResultPromise);
  }
  if (!graphPreview.hidden) void renderGraphPreview();
};

let regenerationTimer: number | null = null;
let regenerationRequest = 0;

const setRegenerationBusy = (busy: boolean) => {
  regenerationBusy = busy;
  growthStatus.hidden = !busy;
  growthStatusText.textContent = `Growing ${speciesLabel(state.primary)} biome…`;
  rollDiceButton.disabled = busy;
  randomSeedButton.disabled = busy;
  regenerateButton.disabled = busy;
  exportGlbButton.disabled = busy;
  debugIrButton.disabled = busy;
  debugFramesButton.disabled = busy;
  debugWindButton.disabled = busy;
  seasonSelect.disabled = busy;
  inspectReadinessButton.disabled = busy;
  importCutoutButton.disabled = busy;
  importHeroGlbButton.disabled = busy;
  clearHeroGlbButton.disabled = busy || heroImportPreview === null;
  bakeMaterialButton.disabled = busy;
  editCutoutContourButton.disabled = busy || activeCutout === null || activeCutoutSource === null;
  applyCutoutMetadataButton.disabled = busy || activeCutoutSource === null;
  inspectGraphButton.disabled = busy;
  for (const button of seasonButtons) button.disabled = busy;
  pruneModeButton.disabled = busy;
  syncPlacementButtons();
  syncCrownVolumeButton();
  if (busy) {
    pruneSelectedButton.disabled = true;
    undoPruneButton.disabled = true;
  } else {
    syncPruneButtons();
  }
  syncHeroSpineButtons();
  primarySelect.disabled = busy;
  secondarySelect.disabled = busy;
  for (const input of Object.values(rangeInputs)) input.disabled = busy;
  syncImpostorButtons();
};

const regenerate = (delay = 0) => {
  const request = ++regenerationRequest;
  disposeCrownVolumeTool();
  impostorBakeRequest++;
  impostorBakeAbort?.abort();
  impostorBakeAbort = null;
  if (regenerationTimer !== null) window.clearTimeout(regenerationTimer);
  setRegenerationBusy(true);
  regenerationTimer = window.setTimeout(() => {
    regenerationTimer = null;
    // Two frames ensure the loading state is painted before procedural growth
    // starts its remaining synchronous work.
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        if (request !== regenerationRequest) return;
        try {
          await performRegeneration(request);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            console.error("[procplants] Biome regeneration failed.", error);
          }
        } finally {
          if (request === regenerationRequest) setRegenerationBusy(false);
        }
      });
    });
  }, delay);
};

const bindRange = (id: keyof LabState, labelId: string) => {
  const input = rangeInputs[id as keyof typeof rangeInputs];
  if (!input) return;
  input.value = String(state[id]);
  const sync = () => {
    state[id] = Number(input.value) as never;
    setText(labelId, Number(input.value).toFixed(2));
    regenerate(120);
  };
  input.addEventListener("input", sync);
  setText(labelId, Number(input.value).toFixed(2));
};

primarySelect.addEventListener("change", () => {
  state.primary = primarySelect.value as SpeciesId;
  regenerate();
});
secondarySelect.addEventListener("change", () => {
  state.secondary = secondarySelect.value as SpeciesId;
  regenerate();
});

bindRange("hybrid", "hybridValue");
bindRange("light", "lightValue");
bindRange("moisture", "moistureValue");
bindRange("crowding", "crowdingValue");
bindRange("density", "densityValue");
bindRange("foliage", "foliageValue");
bindRange("leafSize", "leafSizeValue");
bindRange("bloomSize", "bloomSizeValue");
bindRange("flowerDensity", "flowerDensityValue");
bindRange("clumpCount", "clumpCountValue");
bindRange("clumpSpread", "clumpSpreadValue");
bindRange("clumpLean", "clumpLeanValue");
bindRange("habitSpread", "habitSpreadValue");
bindRange("habitUpright", "habitUprightValue");
bindRange("health", "healthValue");
bindRange("maturity", "maturityValue");
bindRange("windExposure", "windExposureValue");
bindRange("wetness", "wetnessValue");
bindRange("snow", "snowValue");
bindRange("pruning", "pruningValue");
bindRange("stylization", "stylizationValue");
bindRange("biomeAdaptation", "biomeAdaptationValue");
bindRange("crownWidth", "crownWidthValue");
bindRange("crownHeight", "crownHeightValue");
bindRange("crownDepth", "crownDepthValue");
bindRange("crownDensity", "crownDensityValue");
bindRange("tubeResolution", "tubeResolutionValue");
bindRange("collarStrength", "collarStrengthValue");
bindRange("barkRoughness", "barkRoughnessValue");

inspectGraphButton.addEventListener("click", () => {
  graphPreview.hidden = !graphPreview.hidden;
  inspectGraphButton.setAttribute("aria-expanded", String(!graphPreview.hidden));
  inspectGraphButton.textContent = graphPreview.hidden ? "Graph Preview" : "Hide Graph";
  if (!graphPreview.hidden) void renderGraphPreview();
});

seasonSelect.addEventListener("change", () => {
  state.season = seasonSelect.value as ProcPlantSeason;
  syncControlsFromState();
  regenerate();
});

for (const button of seasonButtons) {
  button.addEventListener("click", () => {
    state.season = button.dataset.season as ProcPlantSeason;
    syncControlsFromState();
    regenerate();
  });
}

randomSeedButton.addEventListener("click", () => {
  state.seed = Math.floor(Math.random() * 1_000_000);
  regenerate();
});

regenerateButton.addEventListener("click", () => regenerate());

const weightedRandomSpecies = (rng: () => number): SpeciesId => {
  const ids = allProcPlantPresetIds();
  const id = ids[Math.floor(rng() * ids.length)] as SpeciesId;
  return id;
};

const rollBiomeDice = () => {
  if (regenerationBusy) return;
  const dice = Math.floor(Math.random() * 1_000_000_000);
  const rng = rand(dice);
  state.seed = Math.floor(rng() * 1_000_000);
  state.primary = weightedRandomSpecies(rng);
  state.secondary = weightedRandomSpecies(rng);
  state.hybrid = rng() < 0.22 ? 0 : THREE.MathUtils.clamp(0.18 + rng() * 0.72, 0, 1);
  state.light = THREE.MathUtils.clamp(0.22 + rng() * 0.78, 0.08, 1);
  state.moisture = THREE.MathUtils.clamp(rng() ** 0.72, 0, 1);
  state.crowding = THREE.MathUtils.clamp(rng() ** 1.35, 0, 1);
  state.warmth = THREE.MathUtils.clamp(0.18 + rng() * 0.82, 0, 1);
  state.density = THREE.MathUtils.clamp(0.42 + rng() * 0.58, 0.15, 1);
  syncControlsFromState();
  regenerate();
  setSaveStatus(`${speciesLabel(state.primary)} x ${speciesLabel(state.secondary)} rolled.`);
};

rollDiceButton.addEventListener("click", rollBiomeDice);

document.querySelector<HTMLButtonElement>("#autoDemo")!.addEventListener("click", () => {
  const button = document.querySelector<HTMLButtonElement>("#autoDemo")!;
  if (autoDemoTimer !== null) {
    window.clearInterval(autoDemoTimer);
    autoDemoTimer = null;
    button.textContent = "Auto Demo";
    button.setAttribute("aria-pressed", "false");
    setSaveStatus("Auto demo paused.");
    return;
  }
  rollBiomeDice();
  autoDemoTimer = window.setInterval(rollBiomeDice, 5200);
  button.textContent = "Pause Demo";
  button.setAttribute("aria-pressed", "true");
});

document.querySelector<HTMLButtonElement>("#saveLink")!.addEventListener("click", async () => {
  const url = currentShareUrl(true);
  window.history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
    setSaveStatus("Link copied with seed, sliders, species, and camera.");
  } catch {
    setSaveStatus("Link saved in the address bar.");
  }
});

const syncDebugButtons = () => {
  debugIrButton.setAttribute("aria-pressed", String(debugIrVisible));
  debugFramesButton.setAttribute("aria-pressed", String(debugFramesVisible));
  debugWindButton.setAttribute("aria-pressed", String(debugWindColors));
};

debugIrButton.addEventListener("click", () => {
  debugIrVisible = !debugIrVisible;
  if (!debugIrVisible) debugFramesVisible = false;
  syncDebugButtons();
  void refreshHeroDebugOverlay();
  setSaveStatus(
    debugIrVisible
      ? heroLodState?.graph
        ? "Showing attachment, branch-order, and LOD diagnostics."
        : "This worker-backed tree preview has no local graph overlay; its exported contract still carries anchors."
      : "Plant IR diagnostics hidden.",
  );
});

debugFramesButton.addEventListener("click", () => {
  debugFramesVisible = !debugFramesVisible;
  if (debugFramesVisible) debugIrVisible = true;
  syncDebugButtons();
  void refreshHeroDebugOverlay();
  setSaveStatus(debugFramesVisible ? "Showing sampled right/up/tangent attachment frames." : "Attachment frames hidden.");
});

debugWindButton.addEventListener("click", () => {
  debugWindColors = !debugWindColors;
  if (debugWindColors) debugIrVisible = true;
  syncDebugButtons();
  if (heroDebugOverlay) heroDebugOverlay.setAttachmentColorMode(debugWindColors ? "wind" : "kind");
  else void refreshHeroDebugOverlay();
  setSaveStatus(debugWindColors ? "Attachment markers show low-to-high wind weight." : "Attachment markers show organ kind.");
});

crownVolumeModeButton.addEventListener("click", () => {
  if (!selectedSourceGenome().spaceColonization || regenerationBusy) return;
  crownVolumeModeVisible = !crownVolumeModeVisible;
  if (crownVolumeModeVisible && pruneModeVisible) {
    pruneModeVisible = false;
    disposeHeroPruneTool();
    syncPruneButtons();
  }
  if (crownVolumeModeVisible && placementModeVisible) {
    placementModeVisible = false;
    disposeHeroPlacementTool();
    syncPlacementButtons();
  }
  syncCrownVolumeButton();
  if (crownVolumeModeVisible) {
    void refreshCrownVolumeTool();
    setSaveStatus("Crown handles scale the field; add lobes to sculpt branch attraction directly.");
  } else {
    disposeCrownVolumeTool();
    setSaveStatus("Crown handles hidden.");
  }
});

crownVolumeAddButton.addEventListener("click", () => {
  if (!crownVolumeTool || regenerationBusy) return;
  try {
    crownVolumeTool.addControlVolume("ellipsoid");
  } catch (error) {
    setSaveStatus(error instanceof Error ? error.message : String(error));
  }
});

crownVolumeSubtractButton.addEventListener("click", () => {
  if (!crownVolumeTool || regenerationBusy) return;
  try {
    crownVolumeTool.addControlVolume("ellipsoid", "subtract");
  } catch (error) {
    setSaveStatus(error instanceof Error ? error.message : String(error));
  }
});

crownVolumeRemoveButton.addEventListener("click", () => {
  if (!crownVolumeTool || regenerationBusy) return;
  crownVolumeTool.removeSelectedControlVolume();
});

const commitSelectedCrownLobeControls = () => {
  if (!crownVolumeTool || regenerationBusy || !crownVolumeTool.getSelectedControlVolume()) return;
  const dimensions = [
    Number(crownLobeInputs.width.value),
    Number(crownLobeInputs.height.value),
    Number(crownLobeInputs.depth.value),
  ] as const;
  const yawDegrees = Number(crownLobeInputs.rotation.value);
  const weight = Number(crownLobeInputs.weight.value);
  const selected = crownVolumeTool.getSelectedControlVolume()!;
  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(yawDegrees),
  );
  try {
    crownVolumeTool.updateSelectedControlVolume({
      dimensions,
      ...(selected.operation === "subtract" ? {} : { weight }),
      rotation: Math.abs(yawDegrees) < 0.5
        ? null
        : [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    });
  } catch (error) {
    setSaveStatus(error instanceof Error ? error.message : String(error));
    syncCrownLobeControls();
  }
};

for (const input of Object.values(crownLobeInputs)) {
  input.addEventListener("input", () => {
    crownLobeOutputs.width.textContent = Number(crownLobeInputs.width.value).toFixed(2);
    crownLobeOutputs.height.textContent = Number(crownLobeInputs.height.value).toFixed(2);
    crownLobeOutputs.depth.textContent = Number(crownLobeInputs.depth.value).toFixed(2);
    crownLobeOutputs.rotation.textContent = `${Math.round(Number(crownLobeInputs.rotation.value))}°`;
    crownLobeOutputs.weight.textContent = Number(crownLobeInputs.weight.value).toFixed(2);
  });
  input.addEventListener("change", commitSelectedCrownLobeControls);
}

pruneModeButton.addEventListener("click", () => {
  pruneModeVisible = !pruneModeVisible;
  if (pruneModeVisible && crownVolumeModeVisible) {
    crownVolumeModeVisible = false;
    disposeCrownVolumeTool();
    syncCrownVolumeButton();
  }
  if (pruneModeVisible && placementModeVisible) {
    placementModeVisible = false;
    disposeHeroPlacementTool();
    syncPlacementButtons();
  }
  controls.enabled = !pruneModeVisible && !placementModeVisible;
  void refreshHeroPruneTool();
  setSaveStatus(
    pruneModeVisible
      ? heroLodState?.graph
        ? "Trim mode: click, drag a pruning stroke, or Shift-drag a lasso; Ctrl/Command adds to selection."
        : "Trim mode is unavailable for this baked worker-backed tree; choose a graph-backed plant."
      : "Trim mode closed.",
  );
});

placementModeButton.addEventListener("click", () => {
  if (regenerationBusy || !heroLodState?.graph) return;
  placementModeVisible = !placementModeVisible;
  if (placementModeVisible && pruneModeVisible) {
    pruneModeVisible = false;
    disposeHeroPruneTool();
    syncPruneButtons();
  }
  if (placementModeVisible && crownVolumeModeVisible) {
    crownVolumeModeVisible = false;
    disposeCrownVolumeTool();
    syncCrownVolumeButton();
  }
  controls.enabled = !placementModeVisible && !pruneModeVisible;
  syncPlacementButtons();
  void refreshHeroPlacementTool();
  setSaveStatus(
    placementModeVisible
      ? "Place mode: choose an organ type, then click a highlighted branch segment. Placements regenerate from the segment frame."
      : "Place mode closed.",
  );
});

type PruneGesturePoint = { x: number; y: number; clientX: number; clientY: number };
let pruneGesturePointer: number | null = null;
let pruneGesturePoints: PruneGesturePoint[] = [];
let pruneGestureLasso = false;
let suppressPruneClick = false;

const prunePointFromEvent = (event: PointerEvent, rect: DOMRect): PruneGesturePoint => ({
  x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
  y: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
  clientX: event.clientX - rect.left,
  clientY: event.clientY - rect.top,
});

const updatePruneGestureOverlay = (rect: DOMRect) => {
  pruneGestureOverlay.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  const points = pruneGesturePoints.map((point) => `${point.clientX},${point.clientY}`);
  if (pruneGestureLasso && pruneGesturePoints.length > 2) points.push(points[0]!);
  pruneGestureLine.setAttribute("points", points.join(" "));
  pruneGestureOverlay.classList.toggle("active", points.length > 1);
  pruneGestureOverlay.classList.toggle("lasso", pruneGestureLasso);
};

const clearPruneGesture = () => {
  pruneGesturePointer = null;
  pruneGesturePoints = [];
  pruneGestureLine.removeAttribute("points");
  pruneGestureOverlay.classList.remove("active", "lasso");
};

canvas.addEventListener("pointerdown", (event) => {
  if (!pruneModeVisible || !heroPruneTool || event.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  pruneGesturePointer = event.pointerId;
  pruneGestureLasso = event.shiftKey;
  pruneGesturePoints = [prunePointFromEvent(event, rect)];
  canvas.setPointerCapture(event.pointerId);
  updatePruneGestureOverlay(rect);
});

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  if (pruneModeVisible && heroPruneTool && event.pointerId === pruneGesturePointer && event.buttons !== 0) {
    const point = prunePointFromEvent(event, rect);
    const previous = pruneGesturePoints.at(-1)!;
    if (Math.hypot(point.clientX - previous.clientX, point.clientY - previous.clientY) >= 3) {
      pruneGesturePoints.push(point);
      updatePruneGestureOverlay(rect);
    }
    return;
  }
  if (!pruneModeVisible || !heroPruneTool || event.buttons !== 0) return;
  const hit = heroPruneTool.pickFromScreen(event.clientX, event.clientY, rect, camera);
  heroPruneTool.setHighlightedSegment(hit?.segmentId ?? null);
});

const finishPruneGesture = (event: PointerEvent) => {
  if (!heroPruneTool || event.pointerId !== pruneGesturePointer) return;
  const points = pruneGesturePoints.map(({ x, y }) => ({ x, y }));
  const dragged = pruneGesturePoints.length > 2;
  if (dragged) {
    const mode = event.ctrlKey || event.metaKey ? "additive" : "replace";
    const rect = canvas.getBoundingClientRect();
    const tolerance = 20 / Math.max(1, Math.min(rect.width, rect.height));
    const result = pruneGestureLasso
      ? heroPruneTool.selectSegmentsFromNdcLasso(points, camera, { mode, edgeToleranceNdc: tolerance * 0.35 })
      : heroPruneTool.selectSegmentsFromNdcStroke(points, camera, { mode, radiusNdc: tolerance });
    suppressPruneClick = true;
    syncPruneButtons();
    setSaveStatus(
      result.matchedSegmentIds.length > 0
        ? `${pruneGestureLasso ? "Lasso" : "Stroke"} selected ${result.matchedSegmentIds.length} segments (${result.selectedSegmentIds.length} total).`
        : `${pruneGestureLasso ? "Lasso" : "Stroke"} did not intersect a branch segment.`,
    );
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  clearPruneGesture();
};

canvas.addEventListener("pointerup", finishPruneGesture);
canvas.addEventListener("pointercancel", (event) => {
  if (event.pointerId === pruneGesturePointer) clearPruneGesture();
});

canvas.addEventListener("click", (event) => {
  if (!pruneModeVisible || !heroPruneTool) return;
  if (suppressPruneClick) {
    suppressPruneClick = false;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const hit = heroPruneTool.pickFromScreen(event.clientX, event.clientY, rect, camera);
  heroPruneTool.setSelectedSegment(hit?.segmentId ?? null);
  syncPruneButtons();
  setSaveStatus(hit ? `Selected ${hit.segmentId}.` : "No branch segment selected.");
});

canvas.addEventListener("pointermove", (event) => {
  if (!placementModeVisible || !heroPlacementTool || event.buttons !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const hit = heroPlacementTool.pickFromScreen(event.clientX, event.clientY, rect, camera);
  heroPlacementTool.setHighlightedSegment(hit?.segmentId ?? null);
});

canvas.addEventListener("click", async (event) => {
  const target = heroLodState;
  const tool = heroPlacementTool;
  if (!placementModeVisible || !tool || !target?.graph || regenerationBusy) return;
  const rect = canvas.getBoundingClientRect();
  const hit = tool.pickFromScreen(event.clientX, event.clientY, rect, camera);
  tool.setSelectedSegment(hit?.segmentId ?? null);
  if (!hit) {
    setSaveStatus("No branch segment selected for placement.");
    return;
  }
  const segment = target.graph.segmentRecords.find((candidate) => candidate.id === hit.segmentId);
  const start = segment ? target.graph.stems[segment.startNodeIndex] : null;
  const end = segment ? target.graph.stems[segment.endNodeIndex] : null;
  if (!segment || !start || !end) {
    setSaveStatus("That segment no longer has a stable graph frame.");
    return;
  }
  tool.object.updateMatrixWorld(true);
  const localPoint = tool.object.worldToLocal(hit.point.clone());
  const axis = end.position.clone().sub(start.position);
  const axisLengthSq = axis.lengthSq();
  if (axisLengthSq < 1e-10) {
    setSaveStatus("That segment is too short for a stable placement.");
    return;
  }
  const axialT = THREE.MathUtils.clamp(localPoint.clone().sub(start.position).dot(axis) / axisLengthSq, 0.02, 0.98);
  const placementModule = await loadProcPlantOrganPlacement();
  if (!placementModeVisible || heroLodState !== target || target.graph !== heroLodState.graph) return;
  const azimuth = placementModule.deriveProcPlantOrganPlacementAzimuth(target.graph, segment.id, axialT, localPoint);
  if (azimuth === null) {
    setSaveStatus("A stable radial frame could not be derived for that segment.");
    return;
  }
  const genome = selectedGenome();
  const source = placementModule.createProcPlantOrganPlacementTarget(genome.id, state.seed, target.graph);
  const key = currentPruneKey();
  let placementPackage = organPlacementPackages.get(key);
  if (placementPackage && (
    placementPackage.target.genomeId !== source.genomeId
    || placementPackage.target.seed !== source.seed
    || placementPackage.target.graphSignatureVersion !== source.graphSignatureVersion
    || placementPackage.target.graphSignature !== source.graphSignature
  )) {
    setSaveStatus("Existing placements target a different graph topology. Undo them before placing on this regenerated plant.");
    return;
  }
  placementPackage ??= placementModule.createProcPlantOrganPlacementPackage(source);
  const kind = placementKind();
  if (kind === "flower" && !genome.flower) {
    setSaveStatus("This plant has no flower geometry; choose Leaf or Fruit.");
    return;
  }
  const appended = placementModule.appendProcPlantOrganPlacement(placementPackage, {
    kind,
    segmentId: segment.id,
    axialT,
    azimuth,
    scale: kind === "fruit" ? 0.16 : 1,
    ...(kind === "fruit" ? { color: 0xc7472f, secondaryColor: 0x6e281c } : {}),
  });
  if (!appended.operation) {
    setSaveStatus(
      appended.reason === "spacing"
        ? "That placement is too close to another authored organ on this segment."
        : appended.reason === "cap"
          ? "The 96-organ authored placement cap has been reached."
          : "That placement could not be represented safely.",
    );
    return;
  }
  organPlacementPackages.set(key, appended.package);
  syncPlacementButtons();
  setSaveStatus(`Placing ${kind} on ${segment.id} at ${(appended.operation.axialT * 100).toFixed(0)}%…`);
  regenerate();
});

pruneSelectedButton.addEventListener("click", () => {
  const segmentIds = heroPruneTool?.getSelectedSegments() ?? [];
  if (segmentIds.length === 0) return;
  const key = currentPruneKey();
  const history = pruneOperations.get(key) ?? [];
  const alreadyPruned = new Set(history.flat());
  const group = segmentIds.filter((segmentId) => !alreadyPruned.has(segmentId));
  if (group.length === 0) return;
  history.push(group);
  pruneOperations.set(key, history);
  setSaveStatus(`Pruning ${group.length} selected segment${group.length === 1 ? "" : "s"} and descendants…`);
  regenerate();
});

undoPruneButton.addEventListener("click", () => {
  const key = currentPruneKey();
  const history = pruneOperations.get(key);
  if (!history?.length) return;
  history.pop();
  if (history.length === 0) pruneOperations.delete(key);
  else pruneOperations.set(key, history);
  setSaveStatus("Restoring the last procedural trim…");
  regenerate();
});

undoPlacementButton.addEventListener("click", async () => {
  const key = currentPruneKey();
  const placementPackage = organPlacementPackages.get(key);
  if (!placementPackage?.operations.length || regenerationBusy) return;
  const { undoLastProcPlantOrganPlacement } = await loadProcPlantOrganPlacement();
  const next = undoLastProcPlantOrganPlacement(placementPackage);
  if (next.operations.length === 0) organPlacementPackages.delete(key);
  else organPlacementPackages.set(key, next);
  syncPlacementButtons();
  setSaveStatus("Removing the last authored organ placement…");
  regenerate();
});

inspectReadinessButton.addEventListener("click", async () => {
  inspectReadinessButton.disabled = true;
  readinessStatus.textContent = "Inspecting exact geometry and LOD budgets…";
  try {
    const { inspectProcPlantAssetQa } = await import("./procplant-asset-qa");
    const activeCutout = cutoutLeafId
      ? authoredCutouts.find((entry) => entry.id === cutoutLeafId)
      : undefined;
    const report = inspectProcPlantAssetQa(selectedGenome(), selectedGeneratorSeed(), envFromState(), "tellus-realtime", {
      cutoutCoverage: typeof activeCutout?.coverage === "number" ? activeCutout.coverage : undefined,
      textures: activeCutout && typeof activeCutout.width === "number" && typeof activeCutout.height === "number"
        ? [{ id: String(activeCutout.id), width: activeCutout.width, height: activeCutout.height }]
        : undefined,
      providesUvs: Boolean(activeCutout),
    });
    const structural = report.structural;
    const memoryMb = structural.geometry.estimatedGpuBytes / (1024 * 1024);
    const textureMb = report.textures.estimatedBytes / (1024 * 1024);
    readinessStatus.textContent = [
      `${report.ready ? "Ready" : "Review"} ${report.score}/100`,
      `${structural.geometry.triangles.toLocaleString()} tris`,
      `${structural.geometry.vertices.toLocaleString()} verts`,
      `${structural.geometry.drawCalls} draws`,
      `${memoryMb.toFixed(2)} MB GPU`,
      `${report.overdraw.estimatedRatio.toFixed(2)}× alpha`,
      `${textureMb.toFixed(2)} MB textures`,
      `${state.season}, ${procPlantHealthState(state.health)}`,
      cutoutLeafId
        ? `Genome budgets pass; imported cutout '${cutoutLeafId}' is reflected in live scene counts, not this compiler report.`
        : report.warnings[0] ?? "Tellus realtime budgets pass.",
    ].join(" · ");
    app.dataset.readinessScore = String(report.score);
    app.dataset.readinessReady = String(report.ready);
    readinessStatus.dataset.kind = "qa";
  } catch (error) {
    console.error("[procplants] Asset QA failed.", error);
    readinessStatus.textContent = `Asset QA failed: ${error instanceof Error ? error.message : String(error)}`;
    readinessStatus.dataset.kind = "qa";
  } finally {
    inspectReadinessButton.disabled = false;
  }
});

importCutoutButton.addEventListener("click", () => cutoutFileInput.click());
importHeroGlbButton.addEventListener("click", () => heroGlbFileInput.click());
clearHeroGlbButton.addEventListener("click", () => {
  disposeHeroImportPreview();
  heroImportStatus.textContent = "Imported hero cleared; generated hero restored.";
});

const rebuildHeroImportFromEditor = async (nextState: ProcPlantHeroSpineEditorState) => {
  const source = heroImportSource;
  const fileName = heroImportFileName;
  if (!source || !fileName) return;
  const request = ++heroSpineRebuildRequest;
  heroImportStatus.textContent = `Applying ${nextState.points.length} authored spine points...`;
  try {
    const [{ createProcPlantLabHeroPreview }, { procPlantHeroSpineEditorStateToSpine }] = await Promise.all([
      import("./procplant-lab-authoring-imports"),
      import("./procplant-hero-spine-editor"),
    ]);
    const authored = createProcPlantLabHeroPreview(
      source,
      fileName,
      selectedGenome(),
      state.seed,
      activeOrganMaterial(),
      procPlantHeroSpineEditorStateToSpine(nextState),
    );
    configureWindMesh(authored.trunk);
    if (authored.leaves) configureWindMesh(authored.leaves, authored.leafMatrices, authored.leafSways);
    if (request !== heroSpineRebuildRequest || source !== heroImportSource) {
      disposeHeroImportGroup(authored.group);
      return;
    }
    heroSpineEditorState = nextState;
    installHeroImportPreview(authored, fileName);
    heroImportStatus.textContent = `${fileName}: manual ${nextState.points.length}-point spine applied; ${authored.audit.attachmentsEmitted} anchors rebuilt.`;
  } catch (error) {
    console.error("[procplants] Hero spine rebuild failed.", error);
    heroImportStatus.textContent = `Hero spine edit failed: ${error instanceof Error ? error.message : String(error)}`;
  }
};

editHeroSpineButton.addEventListener("click", async () => {
  if (heroSpineEditor) {
    disposeHeroSpineEditor();
    heroImportStatus.textContent = "Manual hero spine edit finished.";
    return;
  }
  const preview = heroImportPreview;
  const spine = heroImportSpine;
  const sourceHash = String(heroImportAudit?.sourceContentHash ?? app.dataset.heroImportHash ?? "");
  const target = preview?.getObjectByName("procplant-imported-hero-trunk");
  if (!preview || !spine || !(target instanceof THREE.Mesh) || !sourceHash) return;
  try {
    const { createProcPlantHeroSpineEditor, createProcPlantHeroSpineEditorState } = await import("./procplant-hero-spine-editor");
    // A second click while the import was in flight would otherwise build a rival
    // editor whose capture-phase listeners swallow all canvas input for good.
    // A re-import in that window would leave the editor bound to a stale mesh.
    if (heroSpineEditor || heroImportPreview !== preview || heroImportSpine !== spine) return;
    heroSpineEditorState ??= createProcPlantHeroSpineEditorState(spine, sourceHash);
    const editor = createProcPlantHeroSpineEditor({
      canvas: renderer.domElement,
      camera,
      target,
      state: heroSpineEditorState,
      onPreview: (nextState) => {
        heroSpineEditorState = nextState;
        syncHeroSpineButtons();
        heroImportStatus.textContent = `Previewing spine point ${nextState.selectedPointId ?? "selection"}; release to rebuild.`;
      },
      onSelectionChange: (nextState) => {
        heroSpineEditorState = nextState;
        syncHeroSpineButtons();
      },
      onCommit: (nextState) => void rebuildHeroImportFromEditor(nextState),
    });
    heroSpineEditor = editor;
    editor.copyDisplayTransform(preview);
    scene.add(editor.root);
    syncHeroSpineButtons();
    heroImportStatus.textContent = "Drag spine handles; Shift-click the trunk to add a point. Delete removes the selected point.";
  } catch (error) {
    console.error("[procplants] Hero spine editor failed.", error);
    heroImportStatus.textContent = `Hero spine editor failed: ${error instanceof Error ? error.message : String(error)}`;
  }
});

addHeroSpinePointButton.addEventListener("click", () => heroSpineEditor?.addAfterSelected());
deleteHeroSpinePointButton.addEventListener("click", () => heroSpineEditor?.deleteSelected());
resetHeroSpineButton.addEventListener("click", () => heroSpineEditor?.resetAutoFit());

heroGlbFileInput.addEventListener("change", async () => {
  const file = heroGlbFileInput.files?.[0];
  heroGlbFileInput.value = "";
  if (!file) return;
  importHeroGlbButton.disabled = true;
  clearHeroGlbButton.disabled = true;
  heroImportStatus.textContent = `Importing and fitting ${file.name}...`;
  try {
    if (file.size > 64 * 1024 * 1024) throw new Error("Hero GLB exceeds the 64 MiB browser authoring limit.");
    const source = await file.arrayBuffer();
    const { createProcPlantLabHeroPreview } = await import("./procplant-lab-authoring-imports");
    const authored = createProcPlantLabHeroPreview(
      source,
      file.name,
      selectedGenome(),
      state.seed,
      activeOrganMaterial(),
    );
    configureWindMesh(authored.trunk);
    if (authored.leaves) configureWindMesh(authored.leaves, authored.leafMatrices, authored.leafSways);
    disposeHeroImportPreview();
    heroImportSource = source;
    heroImportFileName = file.name;
    heroSpineEditorState = null;
    installHeroImportPreview(authored, file.name);
    heroImportStatus.textContent = `${file.name}: ${authored.audit.vertexCount.toLocaleString()} vertices, ${authored.audit.spineSamples} spine samples, ${authored.audit.attachmentsEmitted} procedural anchors; bark UV, wind, and collars applied.`;
  } catch (error) {
    console.error("[procplants] Hero GLB import failed.", error);
    heroImportStatus.textContent = `Hero import failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    importHeroGlbButton.disabled = regenerationBusy;
    clearHeroGlbButton.disabled = regenerationBusy || heroImportPreview === null;
  }
});

bakeMaterialButton.addEventListener("click", async () => {
  bakeMaterialButton.disabled = true;
  materialBakeStatus.textContent = "Evaluating the material DAG, packing deterministic PNG channels, and installing live PBR surfaces...";
  try {
    const { downloadProcPlantLabMaterials } = await import("./procplant-lab-authoring-imports");
    const [materialAdapter, geometryAdapter] = await Promise.all([
      import("./procplant-three-material-adapter"),
      import("./procplant-three-geometry"),
    ]);
    const {
      createProcPlantThreeBakedMaterials,
      disposeProcPlantThreeBakedMaterials,
    } = materialAdapter;
    const genome = selectedGenome();
    const generatorSeed = selectedGeneratorSeed();
    const baked = downloadProcPlantLabMaterials(genome, generatorSeed);
    const nextLiveMaterials = createProcPlantThreeBakedMaterials(baked.bundle, { ormUvChannel: 1 });
    nextLiveMaterials.bark.vertexColors = true;
    nextLiveMaterials.organ.vertexColors = true;
    installProcPlantWindShader(nextLiveMaterials.bark, windUniforms);
    installProcPlantWindShader(nextLiveMaterials.organ, windUniforms);
    disposeLiveBakedMaterials = disposeProcPlantThreeBakedMaterials;
    if (liveBakedMaterials) retiredBakedMaterials.push(liveBakedMaterials);
    liveBakedMaterials = nextLiveMaterials;
    liveBakedMaterialSourceKey = bakedMaterialSourceKey(genome, generatorSeed);
    createLiveProcPlantThreeGeometry = geometryAdapter.createProcPlantThreeGeometry;
    materialBakeBundle = baked.bundle;
    materialBakeAudit = baked.audit;
    app.dataset.materialBakeHash = baked.contentHash;
    app.dataset.materialBakeReady = String(baked.ready);
    app.dataset.materialBakeImages = String(baked.imageCount);
    app.dataset.materialLivePbr = "pending";
    app.dataset.materialLiveAudit = nextLiveMaterials.audit.auditHash;
    app.dataset.materialLiveTextureBytes = String(nextLiveMaterials.audit.ownedTextureBytes);
    app.dataset.materialLiveNormalMaps = String(nextLiveMaterials.audit.materials.filter((material) => material.textureIndexes.normal !== null).length);
    materialBakeStatus.textContent = `${baked.imageCount} deterministic 256x256 PBR PNG resources baked into ${baked.fileName}; rebuilding the live plant with grouped bark/organ materials, normal maps, and explicit tangents.`;
    regenerate(0);
  } catch (error) {
    console.error("[procplants] Material bake failed.", error);
    materialBakeStatus.textContent = `Material bake failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    bakeMaterialButton.disabled = regenerationBusy;
  }
});

const cutoutNumber = (id: string, minimum: number, maximum: number) => {
  const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${input.closest("label")?.firstChild?.textContent?.trim() ?? id} must be between ${minimum} and ${maximum}.`);
  }
  return value;
};

const installActiveCutout = async (contourOverride?: ProcPlantCutout) => {
  const source = activeCutoutSource;
  if (!source) throw new Error("Import a leaf image before rebuilding cutout metadata.");
  const threshold = cutoutNumber("cutoutThreshold", 0, 1);
  const simplifyTolerance = cutoutNumber("cutoutSimplify", 0, 32);
  const padding = Math.round(cutoutNumber("cutoutPadding", 1, 64));
  const pivot = { x: cutoutNumber("cutoutPivotX", -2, 2), y: cutoutNumber("cutoutPivotY", -2, 2) };
  const attachment = { x: cutoutNumber("cutoutAttachX", -2, 2), y: cutoutNumber("cutoutAttachY", -2, 2) };
  const bendOrigin = { x: cutoutNumber("cutoutBendX", -2, 2), y: cutoutNumber("cutoutBendY", -2, 2) };
  const bendRadians = THREE.MathUtils.degToRad(cutoutNumber("cutoutBendAngle", -180, 180));
  const metadata = {
    pivot,
    attachment,
    bendAxis: { origin: bendOrigin, direction: { x: Math.cos(bendRadians), y: Math.sin(bendRadians) } },
  };
  const module = await import("./procplant-cutout");
  const cutout: ProcPlantCutout = contourOverride
    ? { ...contourOverride, threshold, metadata }
    : module.createProcPlantCutout(source.id, source, metadata, { threshold, simplifyTolerance });
  const atlas = module.packProcPlantCutoutAtlas([cutout], { padding, powerOfTwo: true });
  const texture = module.createProcPlantCutoutAtlasTexture(atlas, [source]);
  const geometry = module.buildProcPlantCutoutGeometry(cutout, { height: 1.35, atlasEntry: atlas.entries[0] });
  const leafGeometry = module.buildProcPlantCutoutGeometry(cutout, { height: 1, atlasEntry: atlas.entries[0] });
  const priorCutoutResources = {
    geometry: cutoutLeafGeometry,
    material: cutoutLeafMaterial,
    depth: cutoutLeafDepthMaterial,
    distance: cutoutLeafDistanceMaterial,
  };
  const nextLeafMaterial = installProcPlantWindShader(new THREE.MeshLambertMaterial({
    map: texture,
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    transparent: false,
  }), windUniforms);
  const nextDepthMaterial = installProcPlantWindShader(new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: texture,
    alphaTest: 0.38,
  }), windUniforms);
  const nextDistanceMaterial = installProcPlantWindShader(new THREE.MeshDistanceMaterial({
    map: texture,
    alphaTest: 0.38,
  }), windUniforms);
  const previewTexture = texture.clone();
  previewTexture.needsUpdate = true;
  const material = new THREE.MeshLambertMaterial({
    map: previewTexture,
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    transparent: false,
  });
  const preview = new THREE.Mesh(geometry, material);
  preview.name = `procplant-cutout-preview-${source.id}`;
  preview.position.set(-2.6, 0.04, 1.25);
  preview.rotation.y = 0.28;
  preview.castShadow = false;

  cutoutLeafId = source.id;
  activeCutout = cutout;
  cutoutLeafGeometry = leafGeometry;
  cutoutLeafMaterial = nextLeafMaterial;
  cutoutLeafDepthMaterial = nextDepthMaterial;
  cutoutLeafDistanceMaterial = nextDistanceMaterial;
  if (cutoutPreview) {
    scene.remove(cutoutPreview);
    cutoutPreview.geometry.dispose();
    cutoutPreview.material.map?.dispose();
    cutoutPreview.material.dispose();
  }
  cutoutPreview = preview;
  scene.add(preview);
  let coveredPixels = 0;
  for (const value of source.alpha) if (value / 255 > threshold) coveredPixels++;
  const coverage = coveredPixels / Math.max(1, source.alpha.length);
  const existing = authoredCutouts.findIndex((entry) => entry.id === source.id);
  const record: Record<string, unknown> = {
    id: source.id,
    cutout,
    atlas,
    trace: { threshold, simplifyTolerance },
    atlasPadding: padding,
    coverage,
    width: source.width,
    height: source.height,
  };
  if (existing >= 0) authoredCutouts[existing] = record;
  else authoredCutouts.push(record);
  readinessStatus.textContent = `${source.fileName}: ${cutout.contour.length} silhouette vertices, ${geometry.index?.count ?? 0} indices, ${atlas.width}×${atlas.height} atlas; pivot/attachment/bend metadata applied.`;
  app.dataset.cutoutCount = String(authoredCutouts.length);
  app.dataset.activeLeafCutout = source.id;
  app.dataset.cutoutTraceThreshold = threshold.toFixed(2);
  app.dataset.cutoutAtlasPadding = String(padding);
  app.dataset.cutoutContourCount = String(cutout.contours.length);
  app.dataset.cutoutContourPoints = String(cutout.contours.reduce((sum, contour) => sum + contour.length, 0));
  editCutoutContourButton.disabled = regenerationBusy;
  regenerate();
  window.setTimeout(() => {
    priorCutoutResources.geometry?.dispose();
    priorCutoutResources.material?.map?.dispose();
    priorCutoutResources.material?.dispose();
    priorCutoutResources.depth?.dispose();
    priorCutoutResources.distance?.dispose();
  }, 5_000);
};

applyCutoutMetadataButton.addEventListener("click", async () => {
  delete readinessStatus.dataset.kind;
  applyCutoutMetadataButton.disabled = true;
  readinessStatus.textContent = activeCutoutSource ? `Rebuilding ${activeCutoutSource.fileName}…` : "Import a leaf image first.";
  try {
    await installActiveCutout();
  } catch (error) {
    console.error("[procplants] Cutout rebuild failed.", error);
    readinessStatus.textContent = `Cutout rebuild failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    applyCutoutMetadataButton.disabled = regenerationBusy || activeCutoutSource === null;
  }
});

editCutoutContourButton.addEventListener("click", async () => {
  const cutout = activeCutout;
  const source = activeCutoutSource;
  if (!cutout || !source) {
    readinessStatus.textContent = "Import a leaf image before editing its contour.";
    return;
  }
  editCutoutContourButton.disabled = true;
  try {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = source.width;
    sourceCanvas.height = source.height;
    sourceCanvas.getContext("2d")?.putImageData(
      new ImageData(new Uint8ClampedArray(source.rgba), source.width, source.height),
      0,
      0,
    );
    const { openProcPlantContourEditor } = await import("./procplant-contour-editor-ui");
    const result = await openProcPlantContourEditor(cutout, {
      title: `Edit ${source.fileName} contour`,
      backgroundUrl: sourceCanvas.toDataURL("image/png"),
    });
    if (!result) {
      readinessStatus.textContent = "Contour edit cancelled.";
      return;
    }
    readinessStatus.textContent = `Applying ${result.cutout.contours.length} validated contour boundaries…`;
    await installActiveCutout(result.cutout);
    app.dataset.cutoutContourEdited = "true";
  } catch (error) {
    console.error("[procplants] Cutout contour edit failed.", error);
    readinessStatus.textContent = `Contour edit failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    editCutoutContourButton.disabled = regenerationBusy || activeCutout === null || activeCutoutSource === null;
  }
});

cutoutFileInput.addEventListener("change", async () => {
  const file = cutoutFileInput.files?.[0];
  cutoutFileInput.value = "";
  if (!file) return;
  delete readinessStatus.dataset.kind;
  importCutoutButton.disabled = true;
  readinessStatus.textContent = `Tracing ${file.name}…`;
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 16_777_216 || bitmap.width > 4096 || bitmap.height > 4096) {
      bitmap.close();
      throw new Error("Cutout images are limited to 4096×4096 (16 megapixels).");
    }
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = bitmap.width;
    sourceCanvas.height = bitmap.height;
    const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser cannot read the cutout image.");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const imageData = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const alpha = new Uint8Array(sourceCanvas.width * sourceCanvas.height);
    for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = imageData.data[pixel * 4 + 3]!;
    const id = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "cutout";
    activeCutoutSource = {
      id,
      fileName: file.name,
      width: sourceCanvas.width,
      height: sourceCanvas.height,
      alpha,
      rgba: new Uint8ClampedArray(imageData.data),
    };
    await installActiveCutout();
  } catch (error) {
    console.error("[procplants] Cutout import failed.", error);
    readinessStatus.textContent = `Cutout import failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    importCutoutButton.disabled = regenerationBusy;
    editCutoutContourButton.disabled = regenerationBusy || activeCutout === null || activeCutoutSource === null;
    applyCutoutMetadataButton.disabled = regenerationBusy || activeCutoutSource === null;
  }
});

bakeImpostorButton.addEventListener("click", async () => {
  const target = heroLodState;
  const placementTarget = biomePlacementLodState;
  const bakedPresetId = state.primary;
  const bakedSeed = state.seed;
  const bakedSeasonId = state.season;
  const farIndex = target?.lods.findIndex((lod) => lod.level === 3) ?? -1;
  if (!target || farIndex < 0) {
    impostorStatus.textContent = "Wait for the hero LOD worker before baking an impostor.";
    return;
  }
  const request = ++impostorBakeRequest;
  impostorBakeAbort?.abort();
  const abort = new AbortController();
  impostorBakeAbort = abort;
  bakeImpostorButton.disabled = true;
  exportImpostorButton.disabled = true;
  impostorStatus.textContent = "Rendering 16 aligned color, normal, and depth hero views into padded atlases...";
  const captureSource = new THREE.Mesh(target.geometries[0], activeSurfaceMaterials());
  captureSource.name = `procplant-impostor-source-${state.primary}`;
  let pendingDensePool: ProcPlantDenseImpostorPool | null = null;
  try {
    const module = await import("./procplant-impostor-three");
    const channelBaked = await module.bakeProcPlantThreeImpostorChannels(renderer, captureSource, {
      width: 128,
      height: 128,
      azimuthCount: 8,
      elevations: [0, 0.35],
      padding: 4,
      samples: 4,
      channels: ["color", "normal", "depth"],
      seasons: [{ id: bakedSeasonId, label: bakedSeasonId }],
      signal: abort.signal,
    });
    let baked: ProcPlantThreeImpostorChannelRenderPackage;
    try {
      baked = module.createProcPlantThreeImpostorChannelRenderPackage(channelBaked, bakedSeasonId);
    } catch (error) {
      channelBaked.dispose();
      throw error;
    }
    if (abort.signal.aborted || request !== impostorBakeRequest || heroLodState !== target) {
      baked.dispose();
      return;
    }
    const denseSourceMatches = placementTarget !== null
      && placementTarget === biomePlacementLodState
      && placementTarget.presetId === bakedPresetId
      && placementTarget.seed === bakedSeed
      && state.primary === bakedPresetId
      && state.seed === bakedSeed
      && placementTarget.farLodIndex >= 0
      && placementTarget.lods[placementTarget.farLodIndex]?.level === 3
      && placementTarget.placements.length === placementTarget.pool.stats.placements;
    if (denseSourceMatches) {
      try {
        const denseModule = await import("./procplant-dense-impostor-pool");
        if (
          abort.signal.aborted
          || request !== impostorBakeRequest
          || heroLodState !== target
          || biomePlacementLodState !== placementTarget
          || state.primary !== bakedPresetId
          || state.seed !== bakedSeed
        ) {
          baked.dispose();
          return;
        }
        const visibilityMask = new Uint8Array(placementTarget.placements.length);
        for (let placement = 0; placement < visibilityMask.length; placement++) {
          visibilityMask[placement] = placementTarget.pool.getPlacementLod(placement) === placementTarget.farLodIndex ? 1 : 0;
        }
        const candidate = denseModule.createProcPlantDenseImpostorPoolFromChannelRender(
          baked,
          placementTarget.placements,
        );
        try {
          candidate.setVisibilityMask(visibilityMask);
          candidate.updateFromCamera(camera);
          pendingDensePool = candidate;
        } catch (error) {
          candidate.dispose();
          throw error;
        }
      } catch (error) {
        console.warn("[procplants] Dense biome impostor pool unavailable; keeping compiled far placement LOD.", error);
      }
    }
    const previousPackage = target.impostor;
    const previousGeometry = target.geometries[farIndex];
    if (!previousPackage) target.impostorBaseQuaternion.copy(target.mesh.quaternion);
    target.impostor = baked;
    target.geometries[farIndex] = baked.geometry;
    target.impostorFacing = false;
    const priorIndex = Math.max(0, farIndex - 1);
    const lowerLod = target.lods[Math.max(0, priorIndex - 1)]!;
    const priorLod = target.lods[priorIndex]!;
    const originalFarLod = target.lods[farIndex]!;
    const fogFar = scene.fog instanceof THREE.Fog ? scene.fog.far : camera.far;
    const visibleFarDistance = Math.min(camera.far * 0.72, fogFar * 0.65) / target.scale;
    const accessiblePriorDistance = Math.min(
      priorLod.distance,
      Math.max(lowerLod.distance * 1.12, visibleFarDistance * 0.68),
    );
    const accessibleFarDistance = Math.max(
      accessiblePriorDistance * 1.12,
      Math.min(originalFarLod.distance, visibleFarDistance),
    );
    target.lods = target.lods.map((lod, index) => {
      if (index === priorIndex) return { ...lod, distance: accessiblePriorDistance };
      if (index === farIndex) return { ...lod, distance: accessibleFarDistance };
      return lod;
    });
    target.controller = new ProcPlantLodController(
      target.lods,
      camera.position.distanceTo(target.mesh.position) / target.scale,
    );
    target.mesh.geometry = target.geometries[target.controller.index];
    syncHeroImpostorView();
    if (placementTarget && placementTarget === biomePlacementLodState) {
      const previousDensePool = placementTarget.denseImpostorPool;
      if (pendingDensePool) {
        placementTarget.denseImpostorPool = pendingDensePool;
        pendingDensePool = null;
        placementTarget.pool.root.add(placementTarget.denseImpostorPool.root);
        const farMesh = placementTarget.pool.meshes[placementTarget.farLodIndex];
        if (farMesh) farMesh.visible = false;
        previousDensePool?.dispose();
        syncBiomePlacementLodStats(placementTarget, target);
      } else if (previousDensePool) {
        disposeBiomeDenseImpostorPool(placementTarget);
        syncBiomePlacementLodStats(placementTarget, target);
      }
    }
    if (previousPackage) previousPackage.dispose();
    else if (previousGeometry !== baked.geometry) previousGeometry.dispose();
    app.dataset.heroImpostorHash = baked.atlas.contentHash;
    app.dataset.heroImpostorAtlas = `${baked.atlas.width}x${baked.atlas.height}`;
    app.dataset.heroImpostorViews = String(baked.atlas.entries.length);
    app.dataset.heroImpostorDistance = accessibleFarDistance.toFixed(2);
    app.dataset.heroImpostorChannels = baked.channelMode;
    app.dataset.heroImpostorSeason = baked.seasonId;
    app.dataset.heroLod = target.controller.active.label;
    app.dataset.heroLodLevel = String(target.controller.active.level);
    const denseStats = placementTarget?.denseImpostorPool?.stats;
    const denseSummary = denseStats
      ? ` Dense biome LOD3: ${denseStats.visible} placements | ${denseStats.draws} atlas draws | ${denseStats.triangles} triangles.`
      : "";
    impostorStatus.textContent = `Far LOD baked: ${baked.atlas.entries.length} views | aligned color + normal + depth | ${baked.atlas.width}x${baked.atlas.height} per atlas | ${baked.channelPackage.channelSet.contentHash}.${denseSummary} Zoom out to preview it.`;
    bakeImpostorButton.textContent = "Rebake Far Impostor";
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.error("[procplants] Impostor bake failed.", error);
      impostorStatus.textContent = `Impostor bake failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    pendingDensePool?.dispose();
    if (impostorBakeAbort === abort) impostorBakeAbort = null;
    syncImpostorButtons();
  }
});

exportImpostorButton.addEventListener("click", async () => {
  const baked = heroLodState?.impostor;
  if (!baked) {
    impostorStatus.textContent = "Bake the far impostor before exporting it.";
    return;
  }
  exportImpostorButton.disabled = true;
  impostorStatus.textContent = "Embedding aligned impostor channel atlases and billboard metadata in GLB...";
  try {
    const module = await import("./procplant-impostor-three");
    const name = `procplant-${state.primary}-${state.seed}-impostor`;
    const glb = "channelPackage" in baked
      ? module.exportProcPlantThreeImpostorChannelGlb(baked.channelPackage, name)
      : await module.exportProcPlantThreeImpostorGlb(baked, name);
    const url = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `procplant-${state.primary}-${state.seed}-impostor.glb`;
    link.click();
    URL.revokeObjectURL(url);
    const layerSummary = "channelPackage" in baked
      ? `${baked.channelPackage.channelSet.layers.length} aligned channel atlases`
      : "1 color atlas";
    impostorStatus.textContent = `Impostor GLB exported with ${layerSummary} at ${baked.atlas.width}x${baked.atlas.height}.`;
  } catch (error) {
    console.error("[procplants] Impostor GLB export failed.", error);
    impostorStatus.textContent = `Impostor export failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    syncImpostorButtons();
  }
});

exportGlbButton.addEventListener("click", async () => {
  if (!heroLodState) {
    setSaveStatus("Generate a plant before exporting GLB.");
    return;
  }
  exportGlbButton.disabled = true;
  setSaveStatus("Preparing GLB with vertex color, sway, tintability, and contract metadata…");
  const activeLod = heroLodState.controller.active;
  try {
    if (heroImportPreview) {
      const { downloadProcPlantLabHeroPreview } = await import("./procplant-lab-authoring-imports");
      await downloadProcPlantLabHeroPreview(
        heroImportPreview,
        heroImportAudit,
        app.dataset.heroImportHash ?? String(state.seed),
      );
      setSaveStatus("Imported hero GLB exported with fitted spine, bark UV, wind, collars, and procedural leaf anchors.");
      return;
    }
    const exportOptions = {
      name: `${state.primary}-${state.seed}-lod${activeLod.level}`,
      genomeId: selectedGenome().id,
      seed: selectedGeneratorSeed(),
      ...(materialBakeBundle ? { material: { tangents: true } } : {}),
      collision: {
        type: ["tree", "conifer", "palm"].includes(selectedGenome().habit)
          ? "trunk-capsule"
          : "bounds-box",
      },
      metadata: {
        lodLevel: activeLod.level,
        lodLabel: activeLod.label,
        lodDistance: activeLod.distance,
        previewScale: heroLodState.scale,
      },
    } as const;
    const authoring = await loadProcPlantAuthoringTools();
    let glb: ArrayBuffer;
    if (materialBakeBundle) {
      const prepared = authoring.prepareProcPlantGlbExport(activeLod.template, exportOptions);
      try {
        const { exportProcPlantGlbWithBakedMaterials } = await import("./procplant-glb-material-binding");
        const slotByMeshName: Record<string, string> = {};
        const groupSlotsByMeshName: Record<string, readonly string[]> = {};
        for (const mesh of prepared.meshes) {
          const slots = mesh.userData.procplantSurfaces?.slots as string[] | undefined;
          if (Array.isArray(mesh.material)) groupSlotsByMeshName[mesh.name] = ["bark", "leaf"];
          else slotByMeshName[mesh.name] = slots?.[0] === "organ" ? "leaf" : "bark";
        }
        app.dataset.lastGlbSurfaceGroups = String(prepared.meshes.reduce(
          (sum, mesh) => sum + (Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1),
          0,
        ));
        const bound = await exportProcPlantGlbWithBakedMaterials(
          { scene: prepared.scene, meshes: prepared.meshes },
          materialBakeBundle,
          { slotByMeshName, groupSlotsByMeshName },
        );
        glb = bound.bytes;
        app.dataset.lastGlbMaterialHash = bound.contentHash;
        app.dataset.lastGlbMaterialAssignments = String(bound.assignments.length);
      } finally {
        authoring.disposePreparedProcPlantGlbExport(prepared);
      }
    } else {
      glb = await authoring.exportProcPlantGlb(activeLod.template, exportOptions);
    }
    const url = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `procplant-${state.primary}-${state.seed}-lod${activeLod.level}.glb`;
    link.click();
    URL.revokeObjectURL(url);
    setSaveStatus(materialBakeBundle
      ? `GLB exported from ${activeLod.label} geometry with separate embedded bark/leaf PBR primitives and tangents.`
      : `GLB exported from ${activeLod.label} geometry with separate bark/organ surfaces.`);
  } catch (error) {
    console.error("[procplants] GLB export failed.", error);
    setSaveStatus(`GLB export failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    exportGlbButton.disabled = false;
  }
});

document.querySelector<HTMLButtonElement>("#exportJson")!.addEventListener("click", async () => {
  const genome = selectedGenome();
  const env = envFromState();
  const graphEditorModule = await loadProcPlantGraphEditorUi();
  const graphSourceGenome = selectedBaseGenome(false);
  const generatorOverrides = graphOverrideOperations.get(graphSourceGenome.id) ?? [];
  const graphEditorState = graphEditorModule.compileProcPlantGraphEditorState(
    graphSourceGenome,
    state.seed,
    generatorOverrides,
  );
  const generatorGraph = graphEditorState.graph;
  const generatorApplyAudit = graphEditorState.applyAudit;
  const organVariants = heroLodState?.graph
    ? (await import("./procplant-organ-variants")).buildProcPlantOrganVariants(heroLodState.graph.attachments, {
        season: state.season,
        health: state.health,
        maturity: state.maturity,
        wetness: state.wetness,
        snowLoad: state.snow,
        seed: generatorApplyAudit.executionSeed,
      })
    : null;
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    state: { ...state },
    camera: {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    },
    stats: { ...currentStats },
    genome,
    runtime: buildProcPlantRuntimePackage(genome, generatorApplyAudit.executionSeed, env),
    authoring: {
      variant: { season: state.season, health: state.health, maturity: state.maturity },
      organVariants,
      cutouts: authoredCutouts,
      activeLeafCutout: cutoutLeafId,
      heroImport: heroImportAudit,
      materialBake: materialBakeAudit,
      freeformCrown: state.crownField ? cloneProcPlantFreeformCrown(state.crownField) : genome.spaceColonization?.freeform ?? null,
      impostor: heroLodState?.impostor
        ? {
            contract: heroLodState.impostor.atlas.contract,
            version: heroLodState.impostor.atlas.version,
            contentHash: heroLodState.impostor.atlas.contentHash,
            width: heroLodState.impostor.atlas.width,
            height: heroLodState.impostor.atlas.height,
            padding: heroLodState.impostor.atlas.padding,
            entries: heroLodState.impostor.atlas.entries.map((entry) => ({
              id: entry.id,
              uv: entry.uv,
              paddedUv: entry.paddedUv,
              outward: entry.view.outward,
            })),
          }
        : null,
      graphOperations: currentPruneOperations().map((segmentId) => ({ operation: "remove", segmentId })),
      graphOperationGroups: currentPruneHistory().map((segmentIds) => ({ operation: "remove", segmentIds: [...segmentIds] })),
      generatorGraph,
      generatorOverrides,
      generatorApplyAudit: {
        changed: generatorApplyAudit.changed,
        applied: generatorApplyAudit.applied,
        unsupported: generatorApplyAudit.unsupported,
      },
      generatorPreview: graphEditorState.preview,
    },
    url: currentShareUrl(true),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const slug = `${state.primary}-${state.secondary}-${state.seed}`.replace(/[^a-z0-9-]+/gi, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `procplant-${slug}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  setSaveStatus("JSON exported.");
});

document.querySelector<HTMLButtonElement>("#savePreset")!.addEventListener("click", (event) => {
  const genome = selectedBaseGenome();
  const defaultLabel = state.hybrid > 0.001
    ? `${speciesLabel(state.primary)} ${speciesLabel(state.secondary)} Mix`
    : `${speciesLabel(state.primary)} Mutation`;
  const label = askPresetName(defaultLabel);
  if (!label) {
    setSaveStatus("Preset save canceled.");
    return;
  }
  const preset = saveProcPlantPreset(
    label,
    genome,
    undefined,
    [{ season: state.season, health: state.health, maturity: state.maturity }],
  );
  renderPresetSelectOptions();
  state.primary = preset.id;
  state.hybrid = 0;
  syncControlsFromState();
  regenerate();
  setSaveStatus(`${preset.label} saved to preset lists.`);
  flashButtonText(event.currentTarget as HTMLButtonElement, "Saved");
});

const resize = () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateBiomePlacementLodPool(true);
};

window.addEventListener("resize", resize, { passive: true });
resize();
regenerate();

const clock = new THREE.Clock();
let animationFrame: number | null = null;
const updateHeroLod = () => {
  if (!heroLodState) return;
  const distance = camera.position.distanceTo(heroLodState.mesh.position) / heroLodState.scale;
  if (!heroLodState.controller.update(distance)) return;
  const active = heroLodState.controller.active;
  heroLodState.mesh.geometry = heroLodState.geometries[heroLodState.controller.index];
  syncHeroImpostorView();
  refreshPreviewGeometryStats();
  app.dataset.heroLod = active.label;
  app.dataset.heroLodLevel = String(active.level);
  heroDebugOverlay?.setActiveLod(active.level);
};

controls.addEventListener("change", () => {
  updateBiomePlacementLodPool();
  syncHeroImpostorView();
});

const animate = () => {
  if (document.hidden) {
    animationFrame = null;
    return;
  }
  const elapsed = clock.getElapsedTime();
  windUniforms.time.value = elapsed;
  controls.update();
  updateHeroLod();
  renderer.render(scene, camera);
  animationFrame = requestAnimationFrame(animate);
};

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && animationFrame === null) animationFrame = requestAnimationFrame(animate);
});
window.addEventListener("pagehide", () => {
  impostorBakeAbort?.abort();
  heroDebugOverlayRequest++;
  disposeCrownVolumeTool();
  heroLodCompiler.dispose();
  disposeBiomePlacementLodState(biomePlacementLodState);
  disposeHeroImportPreview();
  disposeHeroDebugOverlay();
  if (liveBakedMaterials) disposeLiveBakedMaterials?.(liveBakedMaterials);
  for (const retired of retiredBakedMaterials) disposeLiveBakedMaterials?.(retired);
  retiredBakedMaterials.length = 0;
}, { once: true });

animationFrame = requestAnimationFrame(animate);
