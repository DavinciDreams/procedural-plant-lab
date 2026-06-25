import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildProcPlantTemplate,
  defaultPlantEnvironment,
  GOLDEN_ANGLE_RADIANS,
  hybridizePlantGenomes,
  procPlantPresetIds,
  procPlantPresets,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
  type ProcPlantTemplate,
} from "./procplants";

type SpeciesId = keyof typeof procPlantPresets;

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
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

app.innerHTML = `
  <div class="stage"></div>
  <section class="panel" aria-label="Procedural plant controls">
    <h1>Procplants Lab</h1>
    <p>Deterministic phi-phyllotaxis plants with light-shaped growth, procedural leaf silhouettes, fur grass, ferns, flowers, and hybrid genomes.</p>
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
      <div class="button-row">
        <button id="randomSeed" type="button">Random Seed</button>
        <button id="regenerate" type="button">Regenerate</button>
      </div>
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

const plantMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
});

let biomeMesh: THREE.Mesh | null = null;
let heroMesh: THREE.Mesh | null = null;
let currentStats = { triangles: 0, plants: 0, leaves: 0 };

const speciesLabel = (id: string) =>
  id
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());

const primarySelect = document.querySelector<HTMLSelectElement>("#primary")!;
const secondarySelect = document.querySelector<HTMLSelectElement>("#secondary")!;
for (const id of procPlantPresetIds) {
  for (const select of [primarySelect, secondarySelect]) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = speciesLabel(id);
    select.appendChild(option);
  }
}
primarySelect.value = state.primary;
secondarySelect.value = state.secondary;

const setText = (id: string, text: string) => {
  document.querySelector<HTMLElement>(`#${id}`)!.textContent = text;
};

const envFromState = (): ProcPlantEnvironment => ({
  ...defaultPlantEnvironment(),
  light: state.light,
  moisture: state.moisture,
  crowding: state.crowding,
  biomeWarmth: state.warmth,
});

const selectedGenome = (): ProcPlantGenome => {
  const a = procPlantPresets[state.primary];
  const b = procPlantPresets[state.secondary];
  return state.hybrid <= 0.001
    ? a
    : hybridizePlantGenomes(a, b, state.hybrid, state.seed ^ 0x9e3779b9);
};

const pushTemplate = (
  out: {
    positions: number[];
    normals: number[];
    colors: number[];
    indices: number[];
  },
  template: ProcPlantTemplate,
  matrix: THREE.Matrix4,
  normalMatrix: THREE.Matrix3,
) => {
  const base = out.positions.length / 3;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < template.pos.length / 3; i++) {
    p.fromArray(template.pos, i * 3).applyMatrix4(matrix);
    n.fromArray(template.nrm, i * 3).applyMatrix3(normalMatrix).normalize();
    out.positions.push(p.x, p.y, p.z);
    out.normals.push(n.x, n.y, n.z);
    out.colors.push(template.col[i * 3], template.col[i * 3 + 1], template.col[i * 3 + 2]);
  }
  for (let i = 0; i < template.idx.length; i++) out.indices.push(base + template.idx[i]);
};

const geometryFromBuffers = (buffers: {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingSphere();
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

const scatterBiome = (genome: ProcPlantGenome, env: ProcPlantEnvironment) => {
  const rng = rand(state.seed ^ 0x5151);
  const buffers = { positions: [] as number[], normals: [] as number[], colors: [] as number[], indices: [] as number[] };
  const plantCount = Math.round(25 + state.density * 130);
  let leaves = 0;
  let plants = 0;
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
    const species =
      genome.habit === "grass" || i % 5 !== 0
        ? genome
        : hybridizePlantGenomes(genome, procPlantPresets.furGrass, 0.12, state.seed + i);
    const built = buildProcPlantTemplate(species, state.seed + i * 101, localEnv);
    const scale =
      species.habit === "grass"
        ? 0.72 + rng() * 0.42
        : species.habit === "tropical"
          ? 0.9 + rng() * 0.5
          : 0.8 + rng() * 0.55;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0)),
      new THREE.Vector3(scale, scale, scale),
    );
    pushTemplate(buffers, built.template, matrix, new THREE.Matrix3().getNormalMatrix(matrix));
    leaves += built.stats.leaves + built.stats.flowers;
    plants++;
  }
  currentStats.plants = plants;
  currentStats.leaves = leaves;
  return geometryFromBuffers(buffers);
};

const buildHero = (genome: ProcPlantGenome, env: ProcPlantEnvironment) => {
  const built = buildProcPlantTemplate(genome, state.seed, env);
  currentStats.triangles = built.stats.triangles;
  const buffers = { positions: [] as number[], normals: [] as number[], colors: [] as number[], indices: [] as number[] };
  const scale =
    genome.habit === "grass" ? 2.4 : genome.habit === "flower" ? 2.2 : genome.habit === "fern" ? 2.0 : 1.7;
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(scale, scale, scale),
  );
  pushTemplate(buffers, built.template, matrix, new THREE.Matrix3().getNormalMatrix(matrix));
  return geometryFromBuffers(buffers);
};

const disposeMesh = (mesh: THREE.Mesh | null) => {
  if (!mesh) return;
  mesh.geometry.dispose();
  scene.remove(mesh);
};

const regenerate = () => {
  const genome = selectedGenome();
  const env = envFromState();
  sun.intensity = 1.4 + state.light * 3.4;
  scene.background = new THREE.Color(0xb9d7ee).lerp(new THREE.Color(0x6f7d8d), 1 - state.light);
  scene.fog = new THREE.Fog(scene.background as THREE.Color, 18, 64);

  disposeMesh(biomeMesh);
  disposeMesh(heroMesh);

  biomeMesh = new THREE.Mesh(scatterBiome(genome, env), plantMaterial);
  biomeMesh.castShadow = true;
  biomeMesh.receiveShadow = true;
  scene.add(biomeMesh);

  heroMesh = new THREE.Mesh(buildHero(genome, env), plantMaterial);
  heroMesh.castShadow = true;
  heroMesh.receiveShadow = true;
  scene.add(heroMesh);

  currentStats.triangles += Math.round((biomeMesh.geometry.index?.count ?? 0) / 3);
  setText("triangles", currentStats.triangles.toLocaleString());
  setText("plants", currentStats.plants.toLocaleString());
  setText("leaves", currentStats.leaves.toLocaleString());
};

const bindRange = (id: keyof LabState, labelId: string) => {
  const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
  const sync = () => {
    state[id] = Number(input.value) as never;
    setText(labelId, Number(input.value).toFixed(2));
    regenerate();
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

document.querySelector<HTMLButtonElement>("#randomSeed")!.addEventListener("click", () => {
  state.seed = Math.floor(Math.random() * 1_000_000);
  regenerate();
});

document.querySelector<HTMLButtonElement>("#regenerate")!.addEventListener("click", regenerate);

const resize = () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};

window.addEventListener("resize", resize);
resize();
regenerate();

const clock = new THREE.Clock();
const animate = () => {
  const elapsed = clock.getElapsedTime();
  if (heroMesh) heroMesh.rotation.y = Math.sin(elapsed * 0.18) * 0.08;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

animate();
