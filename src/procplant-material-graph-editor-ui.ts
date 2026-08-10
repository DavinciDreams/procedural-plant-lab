import {
  addProcPlantMaterialEditorNode,
  commitProcPlantMaterialGraphEditor,
  createProcPlantMaterialGraphEditorState,
  importProcPlantMaterialGraphEditorJson,
  redoProcPlantMaterialGraphEditor,
  removeProcPlantMaterialEditorNode,
  replaceProcPlantMaterialEditorNode,
  resetProcPlantMaterialGraphEditor,
  serializeProcPlantMaterialGraph,
  setProcPlantMaterialEditorNodeInput,
  setProcPlantMaterialEditorSurfaceChannel,
  undoProcPlantMaterialGraphEditor,
  type ProcPlantMaterialEditorNodeInput,
  type ProcPlantMaterialGraphEditorResult,
  type ProcPlantMaterialGraphEditorState,
} from "./procplant-material-graph-editor";
import type {
  ProcPlantMaterialChannel,
  ProcPlantMaterialNode,
  ProcPlantMaterialValueType,
} from "./procplant-material-graph";

export const PROCPLANT_MATERIAL_GRAPH_EDITOR_UI_CONTRACT = "procplants.material-graph-editor-ui" as const;
export const PROCPLANT_MATERIAL_GRAPH_EDITOR_UI_VERSION = 1 as const;
export { createProcPlantMaterialGraphEditorState };

export interface ProcPlantMaterialGraphEditorRenderOptions {
  container: HTMLElement;
  state: ProcPlantMaterialGraphEditorState;
  onStateChanged: (state: ProcPlantMaterialGraphEditorState) => void;
}

const CHANNEL_TYPES: Record<ProcPlantMaterialChannel, ProcPlantMaterialValueType> = {
  baseColor: "color",
  normal: "normal",
  roughness: "scalar",
  metalness: "scalar",
  opacity: "scalar",
  height: "scalar",
  ambientOcclusion: "scalar",
  emissive: "color",
  mossMask: "scalar",
  lichenMask: "scalar",
  wetnessMask: "scalar",
  snowMask: "scalar",
};

const NODE_KINDS: ProcPlantMaterialNode["kind"][] = [
  "scalar", "color", "noise", "texture-sample", "multiply", "mix", "one-minus", "clamp", "remap",
];

const clone = <T>(value: T): T => structuredClone(value);
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const linearToSrgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
const srgbToLinear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const byteHex = (value: number) => Math.round(clamp(linearToSrgb(value)) * 255).toString(16).padStart(2, "0");
const colorHex = (value: readonly number[]) => `#${byteHex(value[0] ?? 0)}${byteHex(value[1] ?? 0)}${byteHex(value[2] ?? 0)}`;
const hexColor = (value: string, alpha: number | undefined) => {
  const rgb = [1, 3, 5].map((offset) => srgbToLinear(Number.parseInt(value.slice(offset, offset + 2), 16) / 255));
  return alpha === undefined ? rgb as [number, number, number] : [...rgb, alpha] as [number, number, number, number];
};

const inputKeys = (node: ProcPlantMaterialNode): ProcPlantMaterialEditorNodeInput[] => node.kind === "multiply"
  ? ["a", "b"]
  : node.kind === "mix"
    ? ["a", "b", "factor"]
    : node.kind === "one-minus" || node.kind === "clamp" || node.kind === "remap"
      ? ["input"]
      : [];

const materialValueTypes = (state: ProcPlantMaterialGraphEditorState) => {
  const nodes = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const types = new Map<string, ProcPlantMaterialValueType>();
  const resolve = (nodeId: string): ProcPlantMaterialValueType => {
    const known = types.get(nodeId);
    if (known) return known;
    const node = nodes.get(nodeId)!;
    let type: ProcPlantMaterialValueType;
    if (node.kind === "scalar" || node.kind === "noise") type = "scalar";
    else if (node.kind === "color") type = "color";
    else if (node.kind === "texture-sample") type = node.channel === "rgb" ? "color" : node.channel === "normal" ? "normal" : "scalar";
    else if (node.kind === "remap") type = "scalar";
    else if (node.kind === "one-minus" || node.kind === "clamp") type = resolve(node.input);
    else if (node.kind === "mix") type = resolve(node.a);
    else {
      const left = resolve(node.a);
      const right = resolve(node.b);
      type = left === right ? left : "color";
    }
    types.set(nodeId, type);
    return type;
  };
  for (const nodeId of nodes.keys()) resolve(nodeId);
  return types;
};

const dependencyIds = (node: ProcPlantMaterialNode) => inputKeys(node).map((key) => String(node[key as keyof typeof node]));

const acceptsInputType = (
  node: ProcPlantMaterialNode,
  input: ProcPlantMaterialEditorNodeInput,
  candidate: ProcPlantMaterialValueType,
  valueTypes: ReadonlyMap<string, ProcPlantMaterialValueType>,
) => {
  if (node.kind === "mix") {
    if (input === "factor") return candidate === "scalar";
    const peerId = input === "a" ? node.b : node.a;
    return candidate !== "normal" && candidate === valueTypes.get(peerId);
  }
  if (node.kind === "multiply") {
    const peerId = input === "a" ? node.b : node.a;
    const peer = valueTypes.get(peerId);
    return candidate !== "normal" && peer !== "normal" && (candidate === peer || candidate === "scalar" || peer === "scalar");
  }
  if (node.kind === "remap") return candidate === "scalar";
  return candidate !== "normal";
};

const nextNodeId = (state: ProcPlantMaterialGraphEditorState, kind: ProcPlantMaterialNode["kind"]) => {
  const stem = kind.replace(/[^a-z]+/g, "-");
  for (let index = 1; index <= 4096; index++) {
    const id = `${stem}-${index}`;
    if (!state.graph.nodes.some((node) => node.id === id)) return id;
  }
  throw new Error(`cannot allocate another ${kind} node id`);
};

const defaultNode = (
  state: ProcPlantMaterialGraphEditorState,
  kind: ProcPlantMaterialNode["kind"],
): ProcPlantMaterialNode => {
  const id = nextNodeId(state, kind);
  const valueTypes = materialValueTypes(state);
  const typed = state.graph.nodes.map((node) => ({ id: node.id, valueType: valueTypes.get(node.id)! })).filter((node) => node.valueType !== "normal");
  const scalar = typed.find((node) => node.valueType === "scalar")?.id;
  const sameTypePair = (["color", "scalar"] as const).map((type) => typed.filter((node) => node.valueType === type)).find((nodes) => nodes.length >= 2);
  if (kind === "scalar") return { id, kind, value: 0.5 };
  if (kind === "color") return { id, kind, value: [0.5, 0.5, 0.5, 1] };
  if (kind === "noise") return { id, kind, noise: "fbm", seed: 1, scale: 4, octaves: 4, lacunarity: 2, gain: 0.5 };
  if (kind === "texture-sample") {
    const texture = state.graph.textures[0];
    if (!texture) throw new Error("add a declared texture before creating a texture-sample node");
    return { id, kind, texture: texture.id, channel: texture.role === "normal" ? "normal" : texture.role === "color" ? "rgb" : "r" };
  }
  if (kind === "multiply") {
    const inputs = sameTypePair ?? (typed.length >= 2 ? typed : undefined);
    if (!inputs) throw new Error("multiply requires two existing scalar or color nodes");
    return { id, kind, a: inputs[0]!.id, b: inputs[1]!.id };
  }
  if (kind === "mix") {
    if (!sameTypePair || !scalar) throw new Error("mix requires two same-type scalar/color nodes and a scalar factor");
    return { id, kind, a: sameTypePair[0]!.id, b: sameTypePair[1]!.id, factor: scalar };
  }
  if (!scalar) throw new Error(`${kind} requires an existing scalar node`);
  if (kind === "one-minus") return { id, kind, input: scalar };
  if (kind === "clamp") return { id, kind, input: scalar, min: 0, max: 1 };
  return { id, kind: "remap", input: scalar, inMin: 0, inMax: 1, outMin: 0, outMax: 1 };
};

const numberInput = (
  labelText: string,
  value: number,
  onCommit: (value: number) => void,
  options: { min?: number; max?: number; step?: number } = {},
) => {
  const label = document.createElement("label");
  label.textContent = `${labelText} `;
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  input.step = String(options.step ?? 0.01);
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  input.addEventListener("change", () => onCommit(Number(input.value)));
  label.append(input);
  return label;
};

export const renderProcPlantMaterialGraphEditor = (options: ProcPlantMaterialGraphEditorRenderOptions) => {
  const { container, state } = options;
  const activeNodeId = container.dataset.activeNodeId ?? "";
  const status = document.createElement("output");
  status.className = "graph-editor-status";
  status.setAttribute("aria-live", "polite");
  status.textContent = container.dataset.statusMessage ?? "";
  const commit = (result: ProcPlantMaterialGraphEditorResult, message: string) => {
    if (!result.ok) {
      status.textContent = result.error;
      return;
    }
    container.dataset.statusMessage = message;
    options.onStateChanged(result.state);
  };

  const summary = document.createElement("p");
  summary.className = "graph-summary";
  summary.textContent = `${state.graph.nodes.length} nodes | ${state.graph.surfaces.length} surfaces | ${state.compiled.requirements.expressionBakeCount} baked expressions | ${state.compiled.contentHash}`;
  const note = document.createElement("p");
  note.className = "graph-editor-note";
  note.textContent = "Edit the deterministic material DAG, then use Bake PBR Material to rebuild the live bark and organ surfaces. Invalid types, cycles, and dangling references are rejected without changing the graph.";

  const actions = document.createElement("div");
  actions.className = "graph-editor-actions";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "Undo";
  undo.disabled = state.undoStack.length === 0;
  undo.addEventListener("click", () => {
    container.dataset.statusMessage = "Material graph edit undone.";
    options.onStateChanged(undoProcPlantMaterialGraphEditor(state));
  });
  const redo = document.createElement("button");
  redo.type = "button";
  redo.textContent = "Redo";
  redo.disabled = state.redoStack.length === 0;
  redo.addEventListener("click", () => {
    container.dataset.statusMessage = "Material graph edit restored.";
    options.onStateChanged(redoProcPlantMaterialGraphEditor(state));
  });
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset material graph";
  reset.disabled = !state.changed;
  reset.addEventListener("click", () => commit(resetProcPlantMaterialGraphEditor(state), "Material graph reset to its generated baseline."));
  const kindSelect = document.createElement("select");
  kindSelect.setAttribute("aria-label", "New material node kind");
  for (const kind of NODE_KINDS) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    kindSelect.append(option);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add node";
  add.addEventListener("click", () => {
    try {
      const node = defaultNode(state, kindSelect.value as ProcPlantMaterialNode["kind"]);
      container.dataset.activeNodeId = node.id;
      commit(addProcPlantMaterialEditorNode(state, node), `${node.id} added.`);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  actions.append(undo, redo, reset, kindSelect, add);

  const list = document.createElement("ol");
  list.className = "graph-node-list material-node-list";
  const valueTypes = materialValueTypes(state);
  const nodeById = new Map(state.graph.nodes.map((node) => [node.id, node]));

  const replace = (node: ProcPlantMaterialNode, message: string) => commit(
    replaceProcPlantMaterialEditorNode(state, node.id, node), message,
  );
  const finiteReplace = (node: ProcPlantMaterialNode, label: string, value: number, next: ProcPlantMaterialNode) => {
    if (!Number.isFinite(value)) {
      status.textContent = `${label} must be finite.`;
      return;
    }
    replace(next, `${node.id}.${label} updated.`);
  };

  for (const node of state.graph.nodes) {
    const item = document.createElement("li");
    item.dataset.nodeId = node.id;
    const header = document.createElement("button");
    header.type = "button";
    header.className = "graph-node material-node";
    header.setAttribute("aria-expanded", String(activeNodeId === node.id));
    const name = document.createElement("span");
    name.textContent = node.id;
    const kind = document.createElement("small");
    kind.textContent = `${node.kind} | ${valueTypes.get(node.id)}`;
    header.append(name, kind);
    const editor = document.createElement("div");
    editor.className = "graph-node-editor material-node-editor";
    if (activeNodeId === node.id) item.classList.add("active");
    header.addEventListener("click", () => {
      const open = !item.classList.contains("active");
      container.dataset.activeNodeId = open ? node.id : "";
      for (const other of list.querySelectorAll<HTMLElement>("li")) other.classList.remove("active", "dependency");
      item.classList.toggle("active", open);
      header.setAttribute("aria-expanded", String(open));
      if (open) for (const dependency of dependencyIds(node)) {
        list.querySelector<HTMLElement>(`li[data-node-id="${CSS.escape(dependency)}"]`)?.classList.add("dependency");
      }
    });

    if (node.kind === "scalar") {
      editor.append(numberInput("value", node.value, (value) => finiteReplace(node, "value", value, { ...node, value })));
    } else if (node.kind === "color") {
      const label = document.createElement("label");
      label.textContent = "color ";
      const input = document.createElement("input");
      input.type = "color";
      input.value = colorHex(node.value);
      input.addEventListener("change", () => replace({ ...node, value: hexColor(input.value, node.value[3]) }, `${node.id}.color updated.`));
      label.append(input);
      editor.append(label);
    } else if (node.kind === "noise") {
      const noise = document.createElement("select");
      noise.setAttribute("aria-label", `${node.id} noise kind`);
      for (const value of ["fbm", "ridge", "cellular"] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = value === node.noise;
        noise.append(option);
      }
      noise.addEventListener("change", () => replace({ ...node, noise: noise.value as typeof node.noise }, `${node.id}.noise updated.`));
      editor.append(noise);
      for (const [label, value, minimum] of [
        ["seed", node.seed, 0], ["scale", node.scale, 0.000001], ["octaves", node.octaves, 1],
        ["lacunarity", node.lacunarity ?? 2, 1], ["gain", node.gain ?? 0.5, 0],
      ] as const) editor.append(numberInput(label, value, (next) => finiteReplace(node, label, next, { ...node, [label]: next }), { min: minimum, step: label === "seed" || label === "octaves" ? 1 : 0.01 }));
    } else if (node.kind === "texture-sample") {
      const texture = document.createElement("select");
      texture.setAttribute("aria-label", `${node.id} texture`);
      for (const source of state.graph.textures) {
        const option = document.createElement("option");
        option.value = source.id;
        option.textContent = source.id;
        option.selected = source.id === node.texture;
        texture.append(option);
      }
      texture.addEventListener("change", () => replace({ ...node, texture: texture.value }, `${node.id}.texture updated.`));
      const channel = document.createElement("select");
      channel.setAttribute("aria-label", `${node.id} texture channel`);
      for (const value of ["r", "g", "b", "a", "rgb", "normal"] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = value === node.channel;
        channel.append(option);
      }
      channel.addEventListener("change", () => replace({ ...node, channel: channel.value as typeof node.channel }, `${node.id}.channel updated.`));
      editor.append(texture, channel);
    }

    for (const input of inputKeys(node)) {
      const label = document.createElement("label");
      label.textContent = `${input} `;
      const select = document.createElement("select");
      select.setAttribute("aria-label", `${node.id} ${input} input`);
      const current = String(node[input as keyof typeof node]);
      for (const candidate of state.graph.nodes.filter((entry) => entry.id !== node.id
        && acceptsInputType(node, input, valueTypes.get(entry.id)!, valueTypes))) {
        const option = document.createElement("option");
        option.value = candidate.id;
        option.textContent = `${candidate.id} (${valueTypes.get(candidate.id)})`;
        option.selected = candidate.id === current;
        select.append(option);
      }
      select.addEventListener("change", () => commit(
        setProcPlantMaterialEditorNodeInput(state, node.id, input, select.value),
        `${node.id}.${input} connected to ${select.value}.`,
      ));
      label.append(select);
      editor.append(label);
    }
    if (node.kind === "clamp") for (const key of ["min", "max"] as const) {
      editor.append(numberInput(key, node[key] ?? (key === "min" ? 0 : 1), (value) => finiteReplace(node, key, value, { ...node, [key]: value })));
    }
    if (node.kind === "remap") for (const key of ["inMin", "inMax", "outMin", "outMax"] as const) {
      editor.append(numberInput(key, node[key], (value) => finiteReplace(node, key, value, { ...node, [key]: value })));
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove node";
    remove.addEventListener("click", () => commit(removeProcPlantMaterialEditorNode(state, node.id), `${node.id} removed.`));
    editor.append(remove);
    item.append(header, editor);
    list.append(item);
  }

  if (activeNodeId) for (const dependency of dependencyIds(nodeById.get(activeNodeId) ?? { id: "", kind: "scalar", value: 0 })) {
    list.querySelector<HTMLElement>(`li[data-node-id="${CSS.escape(dependency)}"]`)?.classList.add("dependency");
  }

  const surfaces = document.createElement("section");
  surfaces.className = "material-surface-editor";
  const surfaceTitle = document.createElement("h3");
  surfaceTitle.textContent = "Surface outputs";
  surfaces.append(surfaceTitle);
  for (const surface of state.graph.surfaces) {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = surface.slot;
    fieldset.append(legend);
    for (const channel of Object.keys(CHANNEL_TYPES) as ProcPlantMaterialChannel[]) {
      const label = document.createElement("label");
      label.textContent = `${channel} `;
      const select = document.createElement("select");
      select.setAttribute("aria-label", `${surface.slot} ${channel} output`);
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "unbound";
      select.append(none);
      for (const candidate of state.graph.nodes.filter((node) => valueTypes.get(node.id) === CHANNEL_TYPES[channel])) {
        const option = document.createElement("option");
        option.value = candidate.id;
        option.textContent = candidate.id;
        option.selected = surface.channels[channel] === candidate.id;
        select.append(option);
      }
      select.addEventListener("change", () => commit(
        setProcPlantMaterialEditorSurfaceChannel(state, surface.slot, channel, select.value || null),
        `${surface.slot}.${channel} ${select.value ? `bound to ${select.value}` : "unbound"}.`,
      ));
      label.append(select);
      fieldset.append(label);
    }
    const doubleSided = document.createElement("label");
    const doubleSidedInput = document.createElement("input");
    doubleSidedInput.type = "checkbox";
    doubleSidedInput.checked = surface.doubleSided ?? false;
    doubleSidedInput.addEventListener("change", () => commit(commitProcPlantMaterialGraphEditor(state, {
      ...state.graph,
      surfaces: state.graph.surfaces.map((entry) => entry.slot === surface.slot ? { ...clone(entry), doubleSided: doubleSidedInput.checked } : clone(entry)),
    }), `${surface.slot}.doubleSided updated.`));
    doubleSided.append(doubleSidedInput, " double sided");
    fieldset.append(doubleSided);
    surfaces.append(fieldset);
  }

  const jsonDetails = document.createElement("details");
  jsonDetails.className = "material-graph-json";
  const jsonSummary = document.createElement("summary");
  jsonSummary.textContent = "Material graph JSON";
  const json = document.createElement("textarea");
  json.setAttribute("aria-label", "Material graph JSON");
  json.spellcheck = false;
  json.value = serializeProcPlantMaterialGraph(state.graph);
  const applyJson = document.createElement("button");
  applyJson.type = "button";
  applyJson.textContent = "Apply JSON";
  applyJson.addEventListener("click", () => commit(importProcPlantMaterialGraphEditorJson(state, json.value), "Canonical material graph JSON applied."));
  jsonDetails.append(jsonSummary, json, applyJson);

  container.replaceChildren(summary, note, actions, status, list, surfaces, jsonDetails);
  container.dataset.hash = state.compiled.contentHash;
  container.dataset.changed = String(state.changed);
  return state;
};
