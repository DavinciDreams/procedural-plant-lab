import * as THREE from "three";
import {
  applyProcPlantSpatialForceFields,
  PROCPLANT_SPATIAL_FORCE_HARD_CAPS,
  type ProcPlantSpatialForceAudit,
  type ProcPlantSpatialForceField,
  type ProcPlantSpatialForceType,
} from "./procplant-spatial-force";

export { applyProcPlantSpatialForceFields };

export interface ProcPlantSpatialForceEditorState {
  contract: "procplants.spatial-force-editor-state";
  version: 1;
  fields: ProcPlantSpatialForceField[];
  iterations: number;
  maximumDisplacement: number;
}

export interface ProcPlantSpatialForceEditorContext {
  supported: boolean;
  reason: string;
  nodeCount: number;
  segmentCount: number;
  audit: ProcPlantSpatialForceAudit | null;
}

export interface ProcPlantSpatialForceEditorRenderOptions {
  container: HTMLElement;
  state: ProcPlantSpatialForceEditorState | null;
  context: ProcPlantSpatialForceEditorContext;
  onStateChanged: (state: ProcPlantSpatialForceEditorState | null) => void;
}

const FORCE_TYPES = ["direction", "attract", "magnet", "repel", "avoid", "curl"] as const;
const typeLabels: Record<ProcPlantSpatialForceType, string> = {
  direction: "Direction",
  attract: "Attract",
  magnet: "Magnet (attract alias)",
  repel: "Repel",
  avoid: "Avoid (repel alias)",
  curl: "Axis curl",
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const finite = (value: unknown, label: string, minimum = -Infinity, maximum = Infinity) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be finite and in [${minimum}, ${maximum}].`);
  }
  return value;
};
const integer = (value: unknown, label: string, minimum: number, maximum: number) => {
  const number = finite(value, label, minimum, maximum);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer in [${minimum}, ${maximum}].`);
  return number;
};
const point = (value: unknown, label: string): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain three finite components.`);
  return value.map((component, index) => finite(component, `${label}[${index}]`)) as [number, number, number];
};

export const createProcPlantSpatialForceEditorState = (): ProcPlantSpatialForceEditorState => ({
  contract: "procplants.spatial-force-editor-state",
  version: 1,
  fields: [],
  iterations: 2,
  maximumDisplacement: 1,
});

export const parseProcPlantSpatialForceEditorState = (
  value: unknown,
): ProcPlantSpatialForceEditorState => {
  if (!value || typeof value !== "object") throw new Error("spatial force editor state must be an object.");
  const candidate = value as Partial<ProcPlantSpatialForceEditorState>;
  if (candidate.contract !== "procplants.spatial-force-editor-state" || candidate.version !== 1) {
    throw new Error("unsupported spatial force editor state contract.");
  }
  if (!Array.isArray(candidate.fields)) throw new Error("spatial force editor fields must be an array.");
  if (candidate.fields.length > PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fields) {
    throw new Error(`spatial force field count exceeds ${PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fields}.`);
  }
  const ids = new Set<string>();
  const fields = candidate.fields.map((raw, index): ProcPlantSpatialForceField => {
    if (!raw || typeof raw !== "object") throw new Error(`spatial force field ${index} must be an object.`);
    const field = raw as Partial<ProcPlantSpatialForceField>;
    if (field.contract !== "procplants.spatial-force-field" || field.version !== 1) {
      throw new Error(`unsupported spatial force field contract at index ${index}.`);
    }
    const id = typeof field.id === "string" ? field.id.trim() : "";
    if (!id) throw new Error(`spatial force field ${index} id must be non-empty.`);
    if (ids.has(id)) throw new Error(`duplicate spatial force field id: ${id}.`);
    ids.add(id);
    if (!FORCE_TYPES.includes(field.type as ProcPlantSpatialForceType)) {
      throw new Error(`unsupported spatial force field type: ${String(field.type)}.`);
    }
    const type = field.type as ProcPlantSpatialForceType;
    const direction = type === "direction" || type === "curl"
      ? point(field.direction, `${id}.direction`)
      : undefined;
    if (direction && Math.hypot(...direction) <= 1e-8) throw new Error(`${id}.direction must have non-zero length.`);
    return {
      contract: "procplants.spatial-force-field",
      version: 1,
      id,
      type,
      position: point(field.position, `${id}.position`),
      ...(direction ? { direction } : {}),
      radius: finite(field.radius, `${id}.radius`, 1e-8, PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fieldRadius),
      strength: finite(field.strength, `${id}.strength`, -1, 1),
      falloff: finite(field.falloff, `${id}.falloff`, 0.25, 8),
    };
  });
  return {
    contract: "procplants.spatial-force-editor-state",
    version: 1,
    fields,
    iterations: integer(candidate.iterations, "spatial force iterations", 1, PROCPLANT_SPATIAL_FORCE_HARD_CAPS.iterations),
    maximumDisplacement: finite(
      candidate.maximumDisplacement,
      "spatial force maximumDisplacement",
      0,
      PROCPLANT_SPATIAL_FORCE_HARD_CAPS.displacement,
    ),
  };
};

export const serializeProcPlantSpatialForceEditorState = (state: ProcPlantSpatialForceEditorState) =>
  JSON.stringify(parseProcPlantSpatialForceEditorState(state));

export const deserializeProcPlantSpatialForceEditorState = (source: string) => {
  if (source.length > 65_536) throw new Error("spatial force editor state exceeds the 64 KiB URL limit.");
  return parseProcPlantSpatialForceEditorState(JSON.parse(source) as unknown);
};

const nextFieldId = (fields: readonly ProcPlantSpatialForceField[]) => {
  const ids = new Set(fields.map((field) => field.id));
  for (let number = 1; number <= PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fields; number++) {
    const id = `field-${number.toString().padStart(2, "0")}`;
    if (!ids.has(id)) return id;
  }
  throw new Error("spatial force field cap reached.");
};

export const appendProcPlantSpatialForceField = (
  state: ProcPlantSpatialForceEditorState,
  type: ProcPlantSpatialForceType,
) => parseProcPlantSpatialForceEditorState({
  ...clone(state),
  fields: [...state.fields, {
    contract: "procplants.spatial-force-field",
    version: 1,
    id: nextFieldId(state.fields),
    type,
    position: [0, 1.5, 0],
    ...((type === "direction" || type === "curl") ? { direction: [0, 1, 0] as const } : {}),
    radius: 1.5,
    strength: 0.2,
    falloff: 2,
  }],
});

export const updateProcPlantSpatialForceField = (
  state: ProcPlantSpatialForceEditorState,
  id: string,
  update: Partial<ProcPlantSpatialForceField>,
) => parseProcPlantSpatialForceEditorState({
  ...clone(state),
  fields: state.fields.map((field) => field.id === id ? { ...field, ...clone(update), id: field.id } : clone(field)),
});

export const removeProcPlantSpatialForceField = (
  state: ProcPlantSpatialForceEditorState,
  id: string,
) => parseProcPlantSpatialForceEditorState({ ...clone(state), fields: state.fields.filter((field) => field.id !== id) });

export const moveProcPlantSpatialForceField = (
  state: ProcPlantSpatialForceEditorState,
  id: string,
  delta: -1 | 1,
) => {
  const fields = state.fields.map(clone);
  const index = fields.findIndex((field) => field.id === id);
  const destination = index + delta;
  if (index < 0 || destination < 0 || destination >= fields.length) return parseProcPlantSpatialForceEditorState(state);
  [fields[index], fields[destination]] = [fields[destination]!, fields[index]!];
  return parseProcPlantSpatialForceEditorState({ ...clone(state), fields });
};

const history: ProcPlantSpatialForceEditorState[] = [];
let stylesInstalled = false;
const installStyles = () => {
  if (stylesInstalled) return;
  const style = document.createElement("style");
  style.dataset.procplantSpatialForceEditor = "true";
  style.textContent = `
.spatial-force-editor{max-height:min(66vh,760px);overflow:auto}.spatial-force-diagnostics,.spatial-force-status{display:block;margin:0 0 8px;color:#b9e6a5;line-height:1.4}.spatial-force-diagnostics[data-supported="false"],.spatial-force-status[role="alert"]{color:#ffd0c7}.spatial-force-options,.spatial-force-values{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px;margin:0 0 8px;padding:7px;border:1px solid rgb(238 247 236/10%)}.spatial-force-options legend,.spatial-force-values legend{padding:0 4px;color:#f0d891}.spatial-force-options label,.spatial-force-values label{display:grid;gap:3px;min-height:24px;color:#b6c8b2}.spatial-force-options input,.spatial-force-values input,.spatial-force-values select,.spatial-force-actions select,.spatial-force-actions button,.spatial-force-heading button{min-height:28px;padding:3px 6px;font-size:10px}.spatial-force-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.spatial-force-list>li{border:1px solid rgb(238 247 236/10%);border-radius:5px;background:rgb(23 34 25/85%)}.spatial-force-heading{display:grid;grid-template-columns:minmax(0,1fr) 30px 30px auto;align-items:center;gap:5px;padding:6px}.spatial-force-values{margin:0 6px 6px}`;
  document.head.append(style);
  stylesInstalled = true;
};
const remember = (state: ProcPlantSpatialForceEditorState) => {
  history.push(clone(state));
  if (history.length > 64) history.shift();
};

const numberInput = (
  labelText: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onCommit: (value: number) => void,
) => {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.setAttribute("aria-label", labelText);
  input.addEventListener("change", () => onCommit(Number(input.value)));
  label.append(input);
  return label;
};

export const renderProcPlantSpatialForceEditor = (options: ProcPlantSpatialForceEditorRenderOptions) => {
  installStyles();
  const state = options.state ? parseProcPlantSpatialForceEditorState(options.state) : createProcPlantSpatialForceEditorState();
  const status = document.createElement("output");
  status.className = "spatial-force-status";
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const setStatus = (message: string) => { status.textContent = message; };
  const commit = (next: ProcPlantSpatialForceEditorState | null, message: string) => {
    try {
      if (next) parseProcPlantSpatialForceEditorState(next);
      remember(state);
      options.onStateChanged(next);
      setStatus(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const workItems = options.context.segmentCount * state.fields.length * state.iterations;
  const summary = document.createElement("p");
  summary.className = "graph-summary spatial-force-summary";
  summary.textContent = `${state.fields.length}/${PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fields} fields · ${state.iterations}/${PROCPLANT_SPATIAL_FORCE_HARD_CAPS.iterations} iterations · ${workItems.toLocaleString()}/${PROCPLANT_SPATIAL_FORCE_HARD_CAPS.workItems.toLocaleString()} work items`;
  const diagnostics = document.createElement("p");
  diagnostics.className = "spatial-force-diagnostics";
  diagnostics.dataset.supported = String(options.context.supported);
  diagnostics.textContent = options.context.supported
    ? options.context.audit
      ? `${options.context.audit.affectedNodes}/${options.context.audit.nodeCount} nodes and ${options.context.audit.affectedSegments}/${options.context.audit.segmentCount} segments changed; maximum displacement ${options.context.audit.maxDisplacement.toFixed(3)}.`
      : `${options.context.nodeCount} nodes and ${options.context.segmentCount} segments available. Fields rebuild the real graph, frames, attachments, and geometry.`
    : `Not applied: ${options.context.reason} Authored fields remain available for export or a supported preset.`;
  const note = document.createElement("p");
  note.className = "graph-editor-note";
  note.textContent = "List order is authored and exported. The solver canonicalizes evaluation by field ID, so reordering an equivalent field set cannot introduce nondeterminism.";

  const actions = document.createElement("div");
  actions.className = "graph-editor-actions spatial-force-actions";
  const typeSelect = document.createElement("select");
  typeSelect.setAttribute("aria-label", "New spatial force type");
  for (const type of FORCE_TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = typeLabels[type];
    typeSelect.append(option);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add field";
  add.disabled = state.fields.length >= PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fields;
  add.addEventListener("click", () => commit(appendProcPlantSpatialForceField(state, typeSelect.value as ProcPlantSpatialForceType), "Field added; rebuilding geometry."));
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "Undo";
  undo.disabled = history.length === 0;
  undo.addEventListener("click", () => {
    const previous = history.pop();
    if (previous) options.onStateChanged(previous.fields.length ? previous : null);
  });
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset all";
  reset.disabled = state.fields.length === 0 && options.state === null;
  reset.addEventListener("click", () => commit(null, "All fields removed; exact canonical geometry restored."));
  actions.append(typeSelect, add, undo, reset);

  const optionsFieldset = document.createElement("fieldset");
  optionsFieldset.className = "spatial-force-options";
  const optionsLegend = document.createElement("legend");
  optionsLegend.textContent = "Bounded solver";
  optionsFieldset.append(
    optionsLegend,
    numberInput("Iterations", state.iterations, 1, PROCPLANT_SPATIAL_FORCE_HARD_CAPS.iterations, 1, (value) => {
      commit(parseProcPlantSpatialForceEditorState({ ...state, iterations: value }), "Iteration cap updated; rebuilding geometry.");
    }),
    numberInput("Maximum displacement", state.maximumDisplacement, 0, PROCPLANT_SPATIAL_FORCE_HARD_CAPS.displacement, 0.05, (value) => {
      commit(parseProcPlantSpatialForceEditorState({ ...state, maximumDisplacement: value }), "Displacement cap updated; rebuilding geometry.");
    }),
  );

  const list = document.createElement("ol");
  list.className = "spatial-force-list";
  state.fields.forEach((field, index) => {
    const item = document.createElement("li");
    item.dataset.fieldId = field.id;
    const heading = document.createElement("div");
    heading.className = "spatial-force-heading";
    const title = document.createElement("strong");
    title.textContent = `${index + 1}. ${field.id}`;
    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.textContent = "↑";
    moveUp.setAttribute("aria-label", `Move ${field.id} earlier`);
    moveUp.disabled = index === 0;
    moveUp.addEventListener("click", () => commit(moveProcPlantSpatialForceField(state, field.id, -1), `${field.id} moved earlier in authored order.`));
    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.textContent = "↓";
    moveDown.setAttribute("aria-label", `Move ${field.id} later`);
    moveDown.disabled = index === state.fields.length - 1;
    moveDown.addEventListener("click", () => commit(moveProcPlantSpatialForceField(state, field.id, 1), `${field.id} moved later in authored order.`));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${field.id}`);
    remove.addEventListener("click", () => commit(removeProcPlantSpatialForceField(state, field.id), `${field.id} removed; rebuilding geometry.`));
    heading.append(title, moveUp, moveDown, remove);
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Type";
    const type = document.createElement("select");
    type.setAttribute("aria-label", `${field.id} type`);
    for (const value of FORCE_TYPES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = typeLabels[value];
      option.selected = field.type === value;
      type.append(option);
    }
    type.addEventListener("change", () => {
      const nextType = type.value as ProcPlantSpatialForceType;
      commit(updateProcPlantSpatialForceField(state, field.id, {
        type: nextType,
        ...((nextType === "direction" || nextType === "curl") ? { direction: field.direction ?? [0, 1, 0] } : { direction: undefined }),
      }), `${field.id} mode updated; rebuilding geometry.`);
    });
    typeLabel.append(type);
    const grid = document.createElement("fieldset");
    grid.className = "spatial-force-values";
    const legend = document.createElement("legend");
    legend.textContent = typeLabels[field.type];
    grid.append(legend, typeLabel);
    const vectorInputs = (name: "position" | "direction", values: readonly [number, number, number]) => {
      (["X", "Y", "Z"] as const).forEach((axis, axisIndex) => {
        grid.append(numberInput(`${field.id} ${name} ${axis}`, values[axisIndex], -1_000_000, 1_000_000, 0.05, (value) => {
          const next = [...values] as [number, number, number];
          next[axisIndex] = value;
          commit(updateProcPlantSpatialForceField(state, field.id, { [name]: next }), `${field.id} ${name} updated; rebuilding geometry.`);
        }));
      });
    };
    vectorInputs("position", field.position);
    if (field.type === "direction" || field.type === "curl") vectorInputs("direction", field.direction!);
    grid.append(
      numberInput(`${field.id} radius`, field.radius, 0.000001, PROCPLANT_SPATIAL_FORCE_HARD_CAPS.fieldRadius, 0.05, (value) => {
        commit(updateProcPlantSpatialForceField(state, field.id, { radius: value }), `${field.id} radius updated; rebuilding geometry.`);
      }),
      numberInput(`${field.id} strength`, field.strength, -1, 1, 0.05, (value) => {
        commit(updateProcPlantSpatialForceField(state, field.id, { strength: value }), `${field.id} strength updated; rebuilding geometry.`);
      }),
      numberInput(`${field.id} falloff`, field.falloff, 0.25, 8, 0.25, (value) => {
        commit(updateProcPlantSpatialForceField(state, field.id, { falloff: value }), `${field.id} falloff updated; rebuilding geometry.`);
      }),
    );
    item.append(heading, grid);
    list.append(item);
  });
  options.container.replaceChildren(summary, diagnostics, note, actions, optionsFieldset, status, list);
  options.container.dataset.fieldCount = String(state.fields.length);
  options.container.dataset.supported = String(options.context.supported);
  options.container.dataset.workItems = String(workItems);
};

const colors: Record<ProcPlantSpatialForceType, number> = {
  direction: 0x7dd3fc,
  attract: 0x86efac,
  magnet: 0x4ade80,
  repel: 0xfca5a5,
  avoid: 0xfb7185,
  curl: 0xc4b5fd,
};

export const createProcPlantSpatialForceVisualization = (state: ProcPlantSpatialForceEditorState) => {
  const validated = parseProcPlantSpatialForceEditorState(state);
  const root = new THREE.Group();
  root.name = "procplant-spatial-force-visualization";
  for (const field of validated.fields) {
    const material = new THREE.MeshBasicMaterial({
      color: colors[field.type],
      wireframe: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const volume = new THREE.Mesh(new THREE.SphereGeometry(field.radius, 12, 8), material);
    volume.name = `procplant-spatial-force-${field.id}`;
    volume.position.fromArray(field.position);
    root.add(volume);
    if (field.direction) {
      const direction = new THREE.Vector3().fromArray(field.direction).normalize();
      const arrow = new THREE.ArrowHelper(direction, new THREE.Vector3().fromArray(field.position), field.radius, colors[field.type], field.radius * 0.22, field.radius * 0.12);
      arrow.name = `procplant-spatial-force-axis-${field.id}`;
      root.add(arrow);
    }
  }
  return root;
};

export const disposeProcPlantSpatialForceVisualization = (root: THREE.Object3D | null) => {
  if (!root) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    if (renderable.geometry) geometries.add(renderable.geometry);
    const source = renderable.material;
    if (Array.isArray(source)) source.forEach((material) => materials.add(material));
    else if (source) materials.add(source);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
};
