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
  const baselineCompiled = compileProcPlantMaterialGraph(baselineCopy);
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
    changed: baselineCompiled.contentHash !== compiled.contentHash,
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
    const nextCompiled = compileProcPlantMaterialGraph(nextGraph);
    if (nextCompiled.contentHash === state.compiled.contentHash) return { ok: true, state };
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
