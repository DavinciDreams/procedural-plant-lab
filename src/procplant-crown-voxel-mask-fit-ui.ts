import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION,
  PROCPLANT_CROWN_VOXEL_MASK_MAX_LOBES,
  fitProcPlantCrownVoxelMask,
  type ProcPlantCrownVoxelMaskFitResult,
} from "./procplant-crown-voxel-mask-fit";
import {
  PROCPLANT_CROWN_VOXEL_MASK_UI_MAX_FILE_BYTES,
  materializeProcPlantCrownVoxelMaskUiInput,
} from "./procplant-crown-voxel-mask-ui-input";
import "./procplant-crown-voxel-mask-fit-ui.css";

const PREVIEW_POINT_CAP = 65_536;
const VIEWPORT_WIDTH = 640;
const VIEWPORT_HEIGHT = 400;

export interface ProcPlantCrownVoxelMaskFitUiOptions {
  container: HTMLElement;
  initialCenter: readonly [number, number, number];
  initialWorldDimensions: readonly [number, number, number];
  onApply: (result: ProcPlantCrownVoxelMaskFitResult) => void;
  onClose: () => void;
}

export interface ProcPlantCrownVoxelMaskFitUi {
  dispose: () => void;
}

const makeNumberInput = (
  labelText: string,
  value: number,
  minimum: number,
  maximum: number,
  step: number,
) => {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
  input.required = true;
  label.append(input);
  return { label, input };
};

const finiteInput = (input: HTMLInputElement, label: string) => {
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};

const integerInput = (input: HTMLInputElement, label: string) => {
  const value = finiteInput(input, label);
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value;
};

const auditRow = (list: HTMLDListElement, label: string) => {
  const term = document.createElement("dt");
  term.textContent = label;
  const value = document.createElement("dd");
  value.textContent = "—";
  list.append(term, value);
  return value;
};

/**
 * Mounts a lazy browser-only viewport for explicit raw 3D occupancy. It shows
 * voxel samples and constructive controls only; it does not reconstruct a
 * surface or infer capture scale.
 */
export const createProcPlantCrownVoxelMaskFitUi = (
  options: ProcPlantCrownVoxelMaskFitUiOptions,
): ProcPlantCrownVoxelMaskFitUi => {
  const { container } = options;
  let disposed = false;
  let readRequest = 0;
  let sourceBytes: ArrayBuffer | null = null;
  let result: ProcPlantCrownVoxelMaskFitResult | null = null;

  container.replaceChildren();
  container.classList.add("crown-voxel-mask-fit-editor");
  container.dataset.ready = "false";

  const title = document.createElement("h3");
  title.id = "crownVoxelMaskFitTitle";
  title.textContent = "Fit explicit crown voxel mask";
  container.setAttribute("aria-labelledby", title.id);

  const explanation = document.createElement("p");
  explanation.id = "crownVoxelMaskFitDescription";
  explanation.textContent = "Choose one raw byte per voxel in x-fastest, then z, then y order. Dimensions, voxel world size, and center are explicit authored assumptions. This is a rough occupancy fit, not mesh reconstruction, photogrammetry, metric capture, or species inference.";

  const fileLabel = document.createElement("label");
  fileLabel.className = "crown-voxel-mask-file";
  fileLabel.textContent = "Raw occupancy file (.bin or .voxmask)";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".bin,.voxmask,application/octet-stream";
  fileInput.setAttribute("aria-describedby", explanation.id);
  fileLabel.append(fileInput);

  const controls = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Explicit fit inputs";
  controls.append(legend);
  const defaultGrid: [number, number, number] = [16, 24, 16];
  const dimensions = defaultGrid.map((value, index) => makeNumberInput(
    `${"XYZ"[index]} voxels`, value, 1, PROCPLANT_CROWN_VOXEL_MASK_MAX_DIMENSION, 1,
  ));
  const center = options.initialCenter.map((value, index) => makeNumberInput(
    `Center ${"XYZ"[index]}`, value, -1_000_000, 1_000_000, 0.05,
  ));
  const voxelSize = options.initialWorldDimensions.map((value, index) => makeNumberInput(
    `Voxel size ${"XYZ"[index]}`, Math.max(0.0001, value / defaultGrid[index]!), 0.0001, 10_000, 0.01,
  ));
  const threshold = makeNumberInput("Occupancy threshold", 0.5, 0, 1, 0.01);
  const lobes = makeNumberInput("Vertical fit bands", 8, 1, PROCPLANT_CROWN_VOXEL_MASK_MAX_LOBES, 1);
  const constraintLabel = document.createElement("label");
  constraintLabel.textContent = "Constructive constraint";
  const constraint = document.createElement("select");
  constraint.append(new Option("Ellipsoid lobes", "lobes"), new Option("Single centerline spline", "spline"));
  constraintLabel.append(constraint);
  const grid = document.createElement("div");
  grid.className = "crown-voxel-mask-fit-grid";
  grid.append(
    ...dimensions.map((entry) => entry.label),
    ...voxelSize.map((entry) => entry.label),
    ...center.map((entry) => entry.label),
    threshold.label,
    lobes.label,
    constraintLabel,
  );
  controls.append(grid);

  const viewport = document.createElement("div");
  viewport.className = "crown-voxel-mask-viewport";
  const canvas = document.createElement("canvas");
  canvas.width = VIEWPORT_WIDTH;
  canvas.height = VIEWPORT_HEIGHT;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "No crown voxel-mask preview loaded");
  canvas.setAttribute("aria-describedby", explanation.id);
  canvas.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown Home + -");
  viewport.append(canvas);

  const viewActions = document.createElement("div");
  viewActions.className = "button-row crown-voxel-mask-view-actions";
  const viewButtons = ([
    ["Front view", "front"],
    ["Side view", "side"],
    ["Top view", "top"],
    ["Reset orbit", "reset"],
  ] as const).map(([label, view]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.view = view;
    return button;
  });
  viewActions.append(...viewButtons);

  const audit = document.createElement("dl");
  audit.className = "crown-voxel-mask-audit";
  audit.hidden = true;
  const auditValues = {
    source: auditRow(audit, "Source"),
    foreground: auditRow(audit, "Occupied voxels"),
    topology: auditRow(audit, "Topology audit"),
    contours: auditRow(audit, "Slice contours"),
    fit: auditRow(audit, "Constructive fit"),
    work: auditRow(audit, "Bounded work"),
    hash: auditRow(audit, "Fit hash"),
    preview: auditRow(audit, "Viewport samples"),
  };

  const status = document.createElement("output");
  status.className = "crown-voxel-mask-fit-status";
  status.setAttribute("aria-live", "polite");
  status.textContent = "Choose a capped raw occupancy file to begin.";

  const actions = document.createElement("div");
  actions.className = "button-row crown-voxel-mask-fit-actions";
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview audited fit";
  previewButton.disabled = true;
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.textContent = "Apply Crown";
  applyButton.disabled = true;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  actions.append(previewButton, applyButton, closeButton);
  container.append(title, explanation, fileLabel, controls, viewport, viewActions, audit, status, actions);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT, false);
  renderer.setClearColor(0x101915, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, VIEWPORT_WIDTH / VIEWPORT_HEIGHT, 0.001, 10_000_000);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = false;
  orbit.screenSpacePanning = true;
  orbit.minDistance = 0.001;
  orbit.maxDistance = 10_000_000;
  const previewRoot = new THREE.Group();
  scene.add(previewRoot);
  let previewCenter = new THREE.Vector3();
  let previewRadius = 1;

  const render = () => renderer.render(scene, camera);
  const setView = (view: "front" | "side" | "top" | "reset") => {
    const distance = Math.max(0.01, previewRadius * 2.8);
    camera.up.set(0, 1, 0);
    const direction = view === "side"
      ? new THREE.Vector3(1, 0, 0)
      : view === "top"
        ? new THREE.Vector3(0, 1, 0)
        : view === "front"
          ? new THREE.Vector3(0, 0, 1)
          : new THREE.Vector3(1.25, 0.9, 1.25).normalize();
    if (view === "top") camera.up.set(0, 0, -1);
    camera.position.copy(previewCenter).addScaledVector(direction, distance);
    orbit.target.copy(previewCenter);
    camera.near = Math.max(0.0001, distance / 1_000);
    camera.far = Math.max(10, distance * 20);
    camera.updateProjectionMatrix();
    orbit.update();
    render();
  };

  const disposeObject = (object: THREE.Object3D) => {
    object.traverse((child) => {
      const drawable = child as THREE.Mesh | THREE.Points | THREE.Line;
      if (drawable.geometry) drawable.geometry.dispose();
      const materials = Array.isArray(drawable.material) ? drawable.material : drawable.material ? [drawable.material] : [];
      for (const material of materials) material.dispose();
    });
  };

  const clearPreview = () => {
    for (const child of [...previewRoot.children]) {
      previewRoot.remove(child);
      disposeObject(child);
    }
    audit.hidden = true;
    canvas.setAttribute("aria-label", "No valid crown voxel-mask preview loaded");
    render();
  };

  const clearResult = () => {
    result = null;
    applyButton.disabled = true;
    container.dataset.ready = "false";
    for (const key of ["fitHash", "foregroundVoxels", "lobeCount", "constraint", "workUnits", "ordering", "previewPoints"]) {
      delete container.dataset[key];
    }
  };

  const readDimensions = () => dimensions.map((entry, index) =>
    integerInput(entry.input, `${"XYZ"[index]} voxels`)) as [number, number, number];
  const readCenter = () => center.map((entry, index) =>
    finiteInput(entry.input, `center ${"XYZ"[index]}`)) as [number, number, number];
  const readVoxelSize = () => voxelSize.map((entry, index) =>
    finiteInput(entry.input, `voxel size ${"XYZ"[index]}`)) as [number, number, number];

  const drawPreview = (fit: ProcPlantCrownVoxelMaskFitResult) => {
    clearPreview();
    const [width, height, depth] = fit.source.dimensions;
    const thresholdByte = fit.source.threshold * 255;
    const sampleStep = Math.max(1, Math.ceil(fit.source.foregroundVoxels / PREVIEW_POINT_CAP));
    const positions = new Float32Array(Math.ceil(fit.source.foregroundVoxels / sampleStep) * 3);
    let occupiedIndex = 0;
    let previewPoints = 0;
    const occupancy = sourceBytes ? new Uint8Array(sourceBytes) : new Uint8Array();
    for (let index = 0; index < occupancy.length; index++) {
      if (occupancy[index]! <= thresholdByte) continue;
      if (occupiedIndex++ % sampleStep !== 0) continue;
      const x = index % width;
      const yz = Math.floor(index / width);
      const z = yz % depth;
      const y = Math.floor(yz / depth);
      positions[previewPoints * 3] = fit.source.center[0] + (x + 0.5 - width * 0.5) * fit.source.voxelSize[0];
      positions[previewPoints * 3 + 1] = fit.source.center[1] + (y + 0.5 - height * 0.5) * fit.source.voxelSize[1];
      positions[previewPoints * 3 + 2] = fit.source.center[2] + (z + 0.5 - depth * 0.5) * fit.source.voxelSize[2];
      previewPoints++;
    }
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions.subarray(0, previewPoints * 3), 3));
    pointGeometry.computeBoundingSphere();
    const pointSize = Math.max(0.001, Math.min(...fit.source.voxelSize) * 0.7);
    previewRoot.add(new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: 0x86d996, size: pointSize, sizeAttenuation: true })));

    const boxMinimum = new THREE.Vector3(
      fit.source.center[0] + (fit.source.occupiedBounds.minimum[0] - width * 0.5) * fit.source.voxelSize[0],
      fit.source.center[1] + (fit.source.occupiedBounds.minimum[1] - height * 0.5) * fit.source.voxelSize[1],
      fit.source.center[2] + (fit.source.occupiedBounds.minimum[2] - depth * 0.5) * fit.source.voxelSize[2],
    );
    const boxMaximum = new THREE.Vector3(
      fit.source.center[0] + (fit.source.occupiedBounds.maximum[0] + 1 - width * 0.5) * fit.source.voxelSize[0],
      fit.source.center[1] + (fit.source.occupiedBounds.maximum[1] + 1 - height * 0.5) * fit.source.voxelSize[1],
      fit.source.center[2] + (fit.source.occupiedBounds.maximum[2] + 1 - depth * 0.5) * fit.source.voxelSize[2],
    );
    previewCenter = boxMinimum.clone().add(boxMaximum).multiplyScalar(0.5);
    previewRadius = Math.max(0.001, boxMinimum.distanceTo(boxMaximum) * 0.5);
    const boundsSourceGeometry = new THREE.BoxGeometry(
      boxMaximum.x - boxMinimum.x,
      boxMaximum.y - boxMinimum.y,
      boxMaximum.z - boxMinimum.z,
    );
    const boundsGeometry = new THREE.EdgesGeometry(boundsSourceGeometry);
    boundsSourceGeometry.dispose();
    const bounds = new THREE.LineSegments(boundsGeometry, new THREE.LineBasicMaterial({ color: 0x8aa59a }));
    bounds.position.copy(previewCenter);
    previewRoot.add(bounds);

    const fitMaterial = new THREE.MeshBasicMaterial({ color: 0xffd66b, wireframe: true, transparent: true, opacity: 0.8 });
    const fitGeometry = new THREE.SphereGeometry(1, 12, 8);
    for (const lobe of fit.lobes) {
      const mesh = new THREE.Mesh(fitGeometry.clone(), fitMaterial.clone());
      mesh.position.set(...lobe.center);
      mesh.scale.set(...lobe.radii);
      previewRoot.add(mesh);
    }
    fitGeometry.dispose();
    fitMaterial.dispose();
    if (fit.audit.constraint === "spline") {
      const spline = fit.crown.version === 2 ? fit.crown.splines[0] : undefined;
      if (spline) {
        const geometry = new THREE.BufferGeometry().setFromPoints(spline.points.map((point) => new THREE.Vector3(...point.position)));
        previewRoot.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xff77ba })));
      }
    }

    container.dataset.previewPoints = String(previewPoints);
    auditValues.source.textContent = `${width} × ${height} × ${depth}; x-fastest → z → y`;
    auditValues.foreground.textContent = fit.source.foregroundVoxels.toLocaleString();
    auditValues.topology.textContent = `${fit.audit.connectedComponents} component; ${fit.audit.cavityComponents} cavities`;
    auditValues.contours.textContent = `${fit.audit.sliceContours} total; ${fit.audit.maximumSliceContours} maximum per Y slice`;
    auditValues.fit.textContent = `${fit.audit.lobeCount} ${fit.audit.constraint === "lobes" ? "ellipsoid lobes" : "spline bands"}`;
    auditValues.work.textContent = `${fit.audit.workUnits.toLocaleString()} / 4,000,000 units`;
    auditValues.hash.textContent = fit.source.hash;
    auditValues.preview.textContent = `${previewPoints.toLocaleString()} points${sampleStep > 1 ? ` (every ${sampleStep}th occupied voxel)` : ""}`;
    audit.hidden = false;
    canvas.setAttribute("aria-label", `${previewPoints.toLocaleString()} sampled occupied voxels with ${fit.audit.lobeCount} constructive fit bands; drag to orbit or use the view buttons`);
    setView("reset");
  };

  const preview = () => {
    clearResult();
    clearPreview();
    if (!sourceBytes) {
      status.textContent = "Choose a crown voxel-mask file before previewing.";
      return;
    }
    try {
      const fit = fitProcPlantCrownVoxelMask(
        materializeProcPlantCrownVoxelMaskUiInput(readDimensions(), sourceBytes),
        {
          center: readCenter(),
          voxelSize: readVoxelSize(),
          threshold: finiteInput(threshold.input, "occupancy threshold"),
          lobes: integerInput(lobes.input, "vertical fit bands"),
          constraint: constraint.value as "lobes" | "spline",
        },
      );
      result = fit;
      applyButton.disabled = false;
      container.dataset.ready = "true";
      container.dataset.fitHash = fit.source.hash;
      container.dataset.foregroundVoxels = String(fit.source.foregroundVoxels);
      container.dataset.lobeCount = String(fit.audit.lobeCount);
      container.dataset.constraint = fit.audit.constraint;
      container.dataset.workUnits = String(fit.audit.workUnits);
      container.dataset.ordering = fit.audit.ordering;
      drawPreview(fit);
      status.textContent = `${fit.source.foregroundVoxels.toLocaleString()} occupied voxels fit into ${fit.audit.lobeCount} bounded ${fit.audit.constraint === "lobes" ? "ellipsoid lobes" : "spline bands"}. Review the audit before applying.`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  const onFileChange = async () => {
    const request = ++readRequest;
    clearResult();
    clearPreview();
    sourceBytes = null;
    previewButton.disabled = true;
    delete container.dataset.sourceBytes;
    const file = fileInput.files?.[0];
    if (!file) {
      status.textContent = "Choose a capped raw occupancy file to begin.";
      return;
    }
    if (!/\.(?:bin|voxmask)$/i.test(file.name)) {
      status.textContent = "Crown voxel-mask input must use a .bin or .voxmask filename.";
      return;
    }
    if (file.size < 1 || file.size > PROCPLANT_CROWN_VOXEL_MASK_UI_MAX_FILE_BYTES) {
      status.textContent = `Crown voxel-mask file must contain 1–${PROCPLANT_CROWN_VOXEL_MASK_UI_MAX_FILE_BYTES.toLocaleString()} bytes.`;
      return;
    }
    status.textContent = "Reading bounded raw occupancy…";
    try {
      const bytes = await file.arrayBuffer();
      if (disposed || request !== readRequest) return;
      sourceBytes = bytes;
      container.dataset.sourceBytes = String(bytes.byteLength);
      previewButton.disabled = false;
      preview();
    } catch (error) {
      if (disposed || request !== readRequest) return;
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  const invalidate = () => {
    if (!sourceBytes) return;
    clearResult();
    clearPreview();
    status.textContent = "Fit inputs changed. Preview the bounded fit before applying.";
  };

  const onViewportKeydown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "+", "=", "-"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      setView("reset");
      return;
    }
    const offset = camera.position.clone().sub(orbit.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (event.key === "ArrowLeft") spherical.theta -= Math.PI / 18;
    if (event.key === "ArrowRight") spherical.theta += Math.PI / 18;
    if (event.key === "ArrowUp") spherical.phi = Math.max(0.05, spherical.phi - Math.PI / 18);
    if (event.key === "ArrowDown") spherical.phi = Math.min(Math.PI - 0.05, spherical.phi + Math.PI / 18);
    if (event.key === "+" || event.key === "=") spherical.radius = Math.max(orbit.minDistance, spherical.radius * 0.9);
    if (event.key === "-") spherical.radius = Math.min(orbit.maxDistance, spherical.radius * 1.1);
    camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(spherical));
    camera.lookAt(orbit.target);
    orbit.update();
    render();
  };

  const fitInputs = [...dimensions, ...voxelSize, ...center, threshold, lobes].map((entry) => entry.input);
  fileInput.addEventListener("change", onFileChange);
  for (const input of fitInputs) input.addEventListener("input", invalidate);
  constraint.addEventListener("change", invalidate);
  previewButton.addEventListener("click", preview);
  applyButton.addEventListener("click", () => {
    if (!result) return;
    options.onApply(result);
    status.textContent = `Applied the audited ${result.audit.constraint} crown. The derived constructive crown persists through URL and JSON state; raw voxel bytes are not embedded.`;
  });
  closeButton.addEventListener("click", options.onClose);
  for (const button of viewButtons) button.addEventListener("click", () => setView(button.dataset.view as "front" | "side" | "top" | "reset"));
  canvas.addEventListener("keydown", onViewportKeydown);
  orbit.addEventListener("change", render);
  setView("reset");

  return {
    dispose: () => {
      disposed = true;
      readRequest++;
      sourceBytes = null;
      clearResult();
      clearPreview();
      canvas.removeEventListener("keydown", onViewportKeydown);
      orbit.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      container.replaceChildren();
      container.classList.remove("crown-voxel-mask-fit-editor");
      for (const key of ["ready", "sourceBytes", "fitHash", "foregroundVoxels", "lobeCount", "constraint", "workUnits", "ordering", "previewPoints"]) {
        delete container.dataset[key];
      }
    },
  };
};
