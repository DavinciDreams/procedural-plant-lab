import {
  compileProcPlantMaterialGraph,
  type ProcPlantCompiledMaterialGraph,
  type ProcPlantMaterialChannel,
  type ProcPlantMaterialGraph,
  type ProcPlantMaterialNode,
  type ProcPlantMaterialTexture,
} from "./procplant-material-graph";

export const PROCPLANT_MATERIAL_GRAPH_EDITOR_CONTRACT = "procplants.material-graph-editor" as const;
export const PROCPLANT_MATERIAL_GRAPH_EDITOR_VERSION = 1 as const;
export const PROCPLANT_MATERIAL_GRAPH_EDITOR_MAX_HISTORY = 32;
export const PROCPLANT_MATERIAL_GRAPH_EDITOR_MAX_JSON_CHARS = 512 * 1024;

export interface ProcPlantMaterialGraphEditorState {
  readonly contract: typeof PROCPLANT_MATERIAL_GRAPH_EDITOR_CONTRACT;
  readonly version: typeof PROCPLANT_MATERIAL_GRAPH_EDITOR_VERSION;
  readonly baseline: ProcPlantMaterialGraph;
  readonly graph: ProcPlantMaterialGraph;
  readonly compiled: ProcPlantCompiledMaterialGraph;
  readonly undoStack: readonly ProcPlantMaterialGraph[];
  readonly redoStack: readonly ProcPlantMaterialGraph[];
  readonly revision: number;
  readonly changed: boolean;
}

export interface ProcPlantMaterialGraphEditorOptions {
  current?: ProcPlantMaterialGraph;
  maxHistory?: number;
}

export type ProcPlantMaterialGraphEditorResult =
  | { ok: true; state: ProcPlantMaterialGraphEditorState }
  | { ok: false; state: ProcPlantMaterialGraphEditorState; error: string };

const clone = <T>(value: T): T => structuredClone(value);

const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  return value;
};

const canonicalRecord = <T>(record: Readonly<Record<string, T>>) => Object.fromEntries(
  Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
) as Record<string, T>;

const dependenciesForEditorNode = (node: ProcPlantMaterialNode): string[] => node.kind === "multiply"
  ? [node.a, node.b]
  : node.kind === "mix"
    ? [node.a, node.b, node.factor]
    : node.kind === "one-minus" || node.kind === "clamp" || node.kind === "remap"
      ? [node.input]
      : [];

const validateEditorGraph = (graph: ProcPlantMaterialGraph) => {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const states = new Map<string, 0 | 1 | 2>();
  const visit = (nodeId: string, path: string[]) => {
    if (states.get(nodeId) === 1) throw new Error(`material graph cycle: ${[...path, nodeId].join(" -> ")}`);
    if (states.get(nodeId) === 2) return;
    const node = nodes.get(nodeId);
    if (!node) return;
    states.set(nodeId, 1);
    for (const dependency of dependenciesForEditorNode(node)) visit(dependency, [...path, nodeId]);
    states.set(nodeId, 2);
  };
  for (const nodeId of [...nodes.keys()].sort()) visit(nodeId, []);
  const types = new Map<string, "scalar" | "color" | "normal">();
  const resolveType = (nodeId: string): "scalar" | "color" | "normal" => {
    const known = types.get(nodeId);
    if (known) return known;
    const node = nodes.get(nodeId);
    if (!node) throw new Error(`material node references missing node ${nodeId}`);
    let type: "scalar" | "color" | "normal";
    if (node.kind === "scalar" || node.kind === "noise") type = "scalar";
    else if (node.kind === "color") type = "color";
    else if (node.kind === "texture-sample") type = node.channel === "rgb" ? "color" : node.channel === "normal" ? "normal" : "scalar";
    else if (node.kind === "multiply") {
      const left = resolveType(node.a);
      const right = resolveType(node.b);
      if (left === "normal" || right === "normal" || left !== right && left !== "scalar" && right !== "scalar") {
        throw new Error(`${node.id} has incompatible multiply inputs ${left} and ${right}`);
      }
      type = left === "color" || right === "color" ? "color" : "scalar";
    } else if (node.kind === "mix") {
      const left = resolveType(node.a);
      const right = resolveType(node.b);
      const factor = resolveType(node.factor);
      if (left !== right || left === "normal") throw new Error(`${node.id} mix inputs must have the same scalar or color type`);
      if (factor !== "scalar") throw new Error(`${node.id} mix factor must be scalar`);
      type = left;
    } else {
      const input = resolveType(node.input);
      if (node.kind === "remap" && input !== "scalar") throw new Error(`${node.id} remap input must be scalar`);
      if (input === "normal") throw new Error(`${node.id} cannot process normal values`);
      type = input;
    }
    types.set(nodeId, type);
    return type;
  };
  for (const nodeId of [...nodes.keys()].sort()) resolveType(nodeId);
};

/** Stable authoring JSON: declaration order cannot perturb exported bytes. */
export const canonicalizeProcPlantMaterialGraph = (source: ProcPlantMaterialGraph): ProcPlantMaterialGraph => ({
  contract: source.contract,
  version: source.version,
  id: source.id,
  textures: [...source.textures].map(clone).sort((left, right) => left.id.localeCompare(right.id)),
  nodes: [...source.nodes].map(clone).sort((left, right) => left.id.localeCompare(right.id)),
  surfaces: [...source.surfaces].map((surface) => ({
    slot: surface.slot,
    channels: canonicalRecord(surface.channels),
    ...(surface.doubleSided === undefined ? {} : { doubleSided: surface.doubleSided }),
    ...(surface.alphaMode === undefined ? {} : { alphaMode: surface.alphaMode }),
    ...(surface.alphaCutoff === undefined ? {} : { alphaCutoff: surface.alphaCutoff }),
  })).sort((left, right) => left.slot.localeCompare(right.slot)),
  ...(source.metadata === undefined ? {} : { metadata: canonicalRecord(source.metadata) }),
});

export const serializeProcPlantMaterialGraph = (source: ProcPlantMaterialGraph) => {
  compileProcPlantMaterialGraph(source);
  return `${JSON.stringify(canonicalizeProcPlantMaterialGraph(source), null, 2)}\n`;
};

const createState = (
  baseline: ProcPlantMaterialGraph,
  graph: ProcPlantMaterialGraph,
  undoStack: readonly ProcPlantMaterialGraph[],
  redoStack: readonly ProcPlantMaterialGraph[],
  revision: number,
): ProcPlantMaterialGraphEditorState => {
  const baselineCopy = clone(baseline);
  const graphCopy = clone(graph);
  validateEditorGraph(baselineCopy);
  validateEditorGraph(graphCopy);
  compileProcPlantMaterialGraph(baselineCopy);
  const compiled = compileProcPlantMaterialGraph(graphCopy);
  return {
    contract: PROCPLANT_MATERIAL_GRAPH_EDITOR_CONTRACT,
    version: PROCPLANT_MATERIAL_GRAPH_EDITOR_VERSION,
    baseline: baselineCopy,
    graph: graphCopy,
    compiled,
    undoStack: undoStack.map(clone),
    redoStack: redoStack.map(clone),
    revision,
    changed: JSON.stringify(canonicalizeProcPlantMaterialGraph(baselineCopy)) !== JSON.stringify(canonicalizeProcPlantMaterialGraph(graphCopy)),
  };
};

export const createProcPlantMaterialGraphEditorState = (
  baseline: ProcPlantMaterialGraph,
  options: ProcPlantMaterialGraphEditorOptions = {},
) => createState(baseline, options.current ?? baseline, [], [], 0);

export const commitProcPlantMaterialGraphEditor = (
  state: ProcPlantMaterialGraphEditorState,
  nextGraph: ProcPlantMaterialGraph,
  options: Pick<ProcPlantMaterialGraphEditorOptions, "maxHistory"> = {},
): ProcPlantMaterialGraphEditorResult => {
  try {
    const maxHistory = integer(options.maxHistory ?? PROCPLANT_MATERIAL_GRAPH_EDITOR_MAX_HISTORY, 1, 256, "maxHistory");
    validateEditorGraph(nextGraph);
    compileProcPlantMaterialGraph(nextGraph);
    if (JSON.stringify(canonicalizeProcPlantMaterialGraph(nextGraph)) === JSON.stringify(canonicalizeProcPlantMaterialGraph(state.graph))) {
      return { ok: true, state };
    }
    const undoStack = [...state.undoStack, clone(state.graph)].slice(-maxHistory);
    return { ok: true, state: createState(state.baseline, nextGraph, undoStack, [], state.revision + 1) };
  } catch (error) {
    return { ok: false, state, error: error instanceof Error ? error.message : String(error) };
  }
};

export const importProcPlantMaterialGraphEditorJson = (
  state: ProcPlantMaterialGraphEditorState,
  json: string,
  options: Pick<ProcPlantMaterialGraphEditorOptions, "maxHistory"> & { maxJsonChars?: number } = {},
): ProcPlantMaterialGraphEditorResult => {
  try {
    const maxJsonChars = integer(options.maxJsonChars ?? PROCPLANT_MATERIAL_GRAPH_EDITOR_MAX_JSON_CHARS, 1, 4 * 1024 * 1024, "maxJsonChars");
    if (typeof json !== "string" || json.length === 0 || json.length > maxJsonChars) {
      throw new Error(`material graph JSON must contain 1-${maxJsonChars} characters`);
    }
    const parsed = JSON.parse(json) as ProcPlantMaterialGraph;
    return commitProcPlantMaterialGraphEditor(state, parsed, options);
  } catch (error) {
    return { ok: false, state, error: error instanceof Error ? error.message : String(error) };
  }
};

export const replaceProcPlantMaterialEditorNode = (
  state: ProcPlantMaterialGraphEditorState,
  nodeId: string,
  replacement: ProcPlantMaterialNode,
) => state.graph.nodes.some((node) => node.id === nodeId)
  ? commitProcPlantMaterialGraphEditor(state, {
      ...state.graph,
      nodes: state.graph.nodes.map((node) => node.id === nodeId ? clone(replacement) : clone(node)),
    })
  : { ok: false as const, state, error: `unknown material node: ${nodeId}` };

export const addProcPlantMaterialEditorNode = (
  state: ProcPlantMaterialGraphEditorState,
  node: ProcPlantMaterialNode,
) => state.graph.nodes.some((entry) => entry.id === node.id)
  ? { ok: false as const, state, error: `duplicate material node: ${node.id}` }
  : commitProcPlantMaterialGraphEditor(state, {
      ...state.graph,
      nodes: [...state.graph.nodes.map(clone), clone(node)],
    });

const nodeReferences = (node: ProcPlantMaterialNode, nodeId: string) => node.kind === "multiply"
  ? node.a === nodeId || node.b === nodeId
  : node.kind === "mix"
    ? node.a === nodeId || node.b === nodeId || node.factor === nodeId
    : node.kind === "one-minus" || node.kind === "clamp" || node.kind === "remap"
      ? node.input === nodeId
      : false;

export const removeProcPlantMaterialEditorNode = (
  state: ProcPlantMaterialGraphEditorState,
  nodeId: string,
): ProcPlantMaterialGraphEditorResult => {
  if (!state.graph.nodes.some((node) => node.id === nodeId)) {
    return { ok: false, state, error: `unknown material node: ${nodeId}` };
  }
  const dependent = state.graph.nodes.find((node) => nodeReferences(node, nodeId));
  if (dependent) return { ok: false, state, error: `${nodeId} is still connected to ${dependent.id}` };
  const surface = state.graph.surfaces.find((entry) => Object.values(entry.channels).includes(nodeId));
  if (surface) return { ok: false, state, error: `${nodeId} is still bound to material surface ${surface.slot}` };
  return commitProcPlantMaterialGraphEditor(state, {
    ...state.graph,
    nodes: state.graph.nodes.filter((node) => node.id !== nodeId).map(clone),
  });
};

export type ProcPlantMaterialEditorNodeInput = "a" | "b" | "factor" | "input";

const canSetNodeInput = (
  node: ProcPlantMaterialNode,
  input: ProcPlantMaterialEditorNodeInput,
) => node.kind === "multiply"
  ? input === "a" || input === "b"
  : node.kind === "mix"
    ? input === "a" || input === "b" || input === "factor"
    : node.kind === "one-minus" || node.kind === "clamp" || node.kind === "remap"
      ? input === "input"
      : false;

export const setProcPlantMaterialEditorNodeInput = (
  state: ProcPlantMaterialGraphEditorState,
  nodeId: string,
  input: ProcPlantMaterialEditorNodeInput,
  dependencyId: string,
): ProcPlantMaterialGraphEditorResult => {
  const node = state.graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) return { ok: false, state, error: `unknown material node: ${nodeId}` };
  if (!state.graph.nodes.some((entry) => entry.id === dependencyId)) {
    return { ok: false, state, error: `unknown material node: ${dependencyId}` };
  }
  if (!canSetNodeInput(node, input)) {
    return { ok: false, state, error: `${nodeId}.${input} is not a connectable material input` };
  }
  return replaceProcPlantMaterialEditorNode(state, nodeId, { ...clone(node), [input]: dependencyId });
};

export const replaceProcPlantMaterialEditorTexture = (
  state: ProcPlantMaterialGraphEditorState,
  textureId: string,
  replacement: ProcPlantMaterialTexture,
) => state.graph.textures.some((texture) => texture.id === textureId)
  ? commitProcPlantMaterialGraphEditor(state, {
      ...state.graph,
      textures: state.graph.textures.map((texture) => texture.id === textureId ? clone(replacement) : clone(texture)),
    })
  : { ok: false as const, state, error: `unknown material texture: ${textureId}` };

export const setProcPlantMaterialEditorSurfaceChannel = (
  state: ProcPlantMaterialGraphEditorState,
  slot: string,
  channel: ProcPlantMaterialChannel,
  nodeId: string | null,
) => !state.graph.surfaces.some((surface) => surface.slot === slot)
  ? { ok: false as const, state, error: `unknown material surface: ${slot}` }
  : nodeId !== null && !state.graph.nodes.some((node) => node.id === nodeId)
    ? { ok: false as const, state, error: `unknown material node: ${nodeId}` }
    : commitProcPlantMaterialGraphEditor(state, {
        ...state.graph,
        surfaces: state.graph.surfaces.map((surface) => {
          if (surface.slot !== slot) return clone(surface);
          const channels = { ...surface.channels };
          if (nodeId === null) delete channels[channel];
          else channels[channel] = nodeId;
          return { ...surface, channels };
        }),
      });

export const resetProcPlantMaterialGraphEditor = (state: ProcPlantMaterialGraphEditorState) =>
  commitProcPlantMaterialGraphEditor(state, state.baseline);

export const undoProcPlantMaterialGraphEditor = (state: ProcPlantMaterialGraphEditorState): ProcPlantMaterialGraphEditorState => {
  const previous = state.undoStack.at(-1);
  if (!previous) return state;
  return createState(
    state.baseline,
    previous,
    state.undoStack.slice(0, -1),
    [clone(state.graph), ...state.redoStack].slice(0, PROCPLANT_MATERIAL_GRAPH_EDITOR_MAX_HISTORY),
    state.revision + 1,
  );
};

export const redoProcPlantMaterialGraphEditor = (state: ProcPlantMaterialGraphEditorState): ProcPlantMaterialGraphEditorState => {
  const next = state.redoStack[0];
  if (!next) return state;
  return createState(
    state.baseline,
    next,
    [...state.undoStack, clone(state.graph)].slice(-PROCPLANT_MATERIAL_GRAPH_EDITOR_MAX_HISTORY),
    state.redoStack.slice(1),
    state.revision + 1,
  );
};
