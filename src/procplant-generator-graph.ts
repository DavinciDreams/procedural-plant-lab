export const PROCPLANT_GENERATOR_GRAPH_CONTRACT = "procplants.generator-graph" as const;
export const PROCPLANT_GENERATOR_GRAPH_VERSION = 1 as const;
export const PROCPLANT_GENERATOR_GRAPH_MAX_NODES = 64 as const;
export const PROCPLANT_GENERATOR_GRAPH_MAX_EDGES = 256 as const;
export const PROCPLANT_GENERATOR_GRAPH_MAX_NODE_OPERATIONS = 100_000 as const;
export const PROCPLANT_GENERATOR_GRAPH_MAX_TOTAL_OPERATIONS = 1_000_000 as const;

export type ProcPlantGeneratorStage =
  | "source"
  | "architecture"
  | "branching"
  | "foliage"
  | "reproductive"
  | "deformation"
  | "material"
  | "lod"
  | "output";

export type ProcPlantPlacementMode = "origin" | "nodes" | "tips" | "surface" | "volume" | "scatter";

export interface ProcPlantPlacementControl {
  mode: ProcPlantPlacementMode;
  density?: number;
  spacing?: number;
  jitter?: number;
  rotation?: number;
}

export type ProcPlantParentScope =
  | { mode: "root" | "all" | "tips"; maxDepth?: number }
  | { mode: "nodes"; nodeIds: string[]; maxDepth?: number }
  | { mode: "stages"; stages: ProcPlantGeneratorStage[]; maxDepth?: number };

export interface ProcPlantGeneratorCurveControl {
  base: number;
  tip: number;
  curve: number;
  /** Optional monotone piecewise scalar profile. Endpoints must be t=0 and t=1. */
  points?: Array<{ t: number; value: number }>;
}

export interface ProcPlantGeneratorGraphTarget {
  kind: "procplant-genome";
  id: string;
  version: 1;
}

export interface ProcPlantGeneratorNode {
  id: string;
  label: string;
  stage: ProcPlantGeneratorStage;
  enabled: boolean;
  dependsOn: string[];
  seedOverride?: number;
  count?: number;
  placement?: ProcPlantPlacementControl;
  parentScope?: ProcPlantParentScope;
  curve?: ProcPlantGeneratorCurveControl;
  /** Serializable, stage-specific settings interpreted only by the caller's handler. */
  parameters?: Record<string, unknown>;
}

export interface ProcPlantGeneratorGraph {
  contract: typeof PROCPLANT_GENERATOR_GRAPH_CONTRACT;
  version: typeof PROCPLANT_GENERATOR_GRAPH_VERSION;
  seed: number;
  target?: ProcPlantGeneratorGraphTarget;
  nodes: ProcPlantGeneratorNode[];
}

export type ProcPlantGeneratorGraphOperation =
  | { op: "set-enabled"; nodeId: string; value: boolean }
  | { op: "set-seed"; nodeId: string; value?: number }
  | { op: "set-count"; nodeId: string; value?: number }
  | { op: "set-placement"; nodeId: string; value?: ProcPlantPlacementControl }
  | { op: "set-parent-scope"; nodeId: string; value?: ProcPlantParentScope }
  | { op: "set-curve"; nodeId: string; value?: ProcPlantGeneratorCurveControl }
  | { op: "set-parameters"; nodeId: string; value?: Record<string, unknown> }
  | { op: "add-dependency"; nodeId: string; dependencyId: string }
  | { op: "remove-dependency"; nodeId: string; dependencyId: string };

export interface ProcPlantGeneratorClipboard {
  contract: "procplants.generator-subgraph";
  version: 1;
  seed: number;
  rootIds: string[];
  nodes: ProcPlantGeneratorNode[];
  externalDependencies: Array<{ nodeId: string; dependencyId: string }>;
}

export interface ProcPlantGeneratorPreviewNode {
  id: string;
  label: string;
  stage: ProcPlantGeneratorStage;
  enabled: boolean;
  seed: number;
  count: number;
  dependencies: string[];
  placement: ProcPlantPlacementMode | null;
  parentScope: ProcPlantParentScope["mode"] | null;
}

export interface ProcPlantGeneratorPreviewSummary {
  contract: typeof PROCPLANT_GENERATOR_GRAPH_CONTRACT;
  version: typeof PROCPLANT_GENERATOR_GRAPH_VERSION;
  seed: number;
  hash: string;
  nodeCount: number;
  enabledNodeCount: number;
  dependencyCount: number;
  estimatedOperationCount: number;
  stageCounts: Partial<Record<ProcPlantGeneratorStage, number>>;
  order: string[];
  nodes: ProcPlantGeneratorPreviewNode[];
}

export interface ProcPlantGeneratorExecutionContext<TOutput = unknown> {
  graph: ProcPlantGeneratorGraph;
  node: ProcPlantGeneratorNode;
  seed: number;
  dependencies: Readonly<Record<string, TOutput>>;
}

export type ProcPlantGeneratorStageHandler<TOutput = unknown> = (
  context: ProcPlantGeneratorExecutionContext<TOutput>,
) => TOutput | Promise<TOutput>;

export type ProcPlantGeneratorHandlers<TOutput = unknown> = Partial<
  Record<ProcPlantGeneratorStage, ProcPlantGeneratorStageHandler<TOutput>>
>;

export interface ProcPlantGeneratorExecutionResult<TOutput = unknown> {
  graph: ProcPlantGeneratorGraph;
  preview: ProcPlantGeneratorPreviewSummary;
  outputs: Record<string, TOutput>;
  records: Array<{
    nodeId: string;
    stage: ProcPlantGeneratorStage;
    seed: number;
    status: "executed" | "disabled";
  }>;
}

const STAGES: readonly ProcPlantGeneratorStage[] = [
  "source", "architecture", "branching", "foliage", "reproductive",
  "deformation", "material", "lod", "output",
];
const STAGE_SET = new Set<string>(STAGES);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

export class ProcPlantGeneratorGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcPlantGeneratorGraphError";
  }
}

const assertFinite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new ProcPlantGeneratorGraphError(`${label} must be finite`);
};

const serializableClone = <T>(value: T): T => {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new ProcPlantGeneratorGraphError("generator graph values must be JSON-serializable");
  }
};

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
};

const stableJson = (value: unknown) => JSON.stringify(canonicalValue(value));

const fnv1a = (value: string, seed = 0x811c9dc5) => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const slug = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || "node";

export const createProcPlantGeneratorNodeId = (
  stage: ProcPlantGeneratorStage,
  label: string,
  namespace = "graph",
) => `${stage}:${slug(label)}:${fnv1a(`${namespace}\0${stage}\0${label}`).toString(16).padStart(8, "0")}`;

export const createProcPlantGeneratorGraph = (
  nodes: readonly ProcPlantGeneratorNode[],
  seed = 1,
  target?: ProcPlantGeneratorGraphTarget,
): ProcPlantGeneratorGraph => {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new ProcPlantGeneratorGraphError("graph.seed must be a uint32");
  }
  const graph: ProcPlantGeneratorGraph = {
    contract: PROCPLANT_GENERATOR_GRAPH_CONTRACT,
    version: PROCPLANT_GENERATOR_GRAPH_VERSION,
    seed,
    ...(target ? { target: serializableClone(target) } : {}),
    nodes: serializableClone([...nodes]),
  };
  validateProcPlantGeneratorGraph(graph);
  return graph;
};

export const evaluateProcPlantGeneratorCurve = (
  curve: ProcPlantGeneratorCurveControl,
  t: number,
): number => {
  const u = Math.max(0, Math.min(1, t));
  if (!curve.points?.length) {
    const shaped = curve.curve === 1 ? u : Math.pow(u, curve.curve);
    return curve.base + (curve.tip - curve.base) * shaped;
  }
  const points = curve.points;
  if (u <= points[0]!.t) return points[0]!.value;
  for (let index = 1; index < points.length; index++) {
    const right = points[index]!;
    if (u > right.t) continue;
    const left = points[index - 1]!;
    const localT = (u - left.t) / Math.max(1e-12, right.t - left.t);
    return left.value + (right.value - left.value) * localT;
  }
  return points.at(-1)!.value;
};

const validatePlacement = (placement: ProcPlantPlacementControl, label: string) => {
  if (!["origin", "nodes", "tips", "surface", "volume", "scatter"].includes(placement.mode)) {
    throw new ProcPlantGeneratorGraphError(`${label}.mode is invalid`);
  }
  for (const key of ["density", "spacing", "jitter", "rotation"] as const) {
    if (placement[key] !== undefined) assertFinite(placement[key]!, `${label}.${key}`);
  }
};

const validateParentScope = (scope: ProcPlantParentScope, label: string) => {
  if (!["root", "all", "tips", "nodes", "stages"].includes(scope.mode)) {
    throw new ProcPlantGeneratorGraphError(`${label}.mode is invalid`);
  }
  if (scope.maxDepth !== undefined && (!Number.isInteger(scope.maxDepth) || scope.maxDepth < 0)) {
    throw new ProcPlantGeneratorGraphError(`${label}.maxDepth must be a non-negative integer`);
  }
  if (scope.mode === "nodes" && (!Array.isArray(scope.nodeIds) || scope.nodeIds.some((id) => !ID_PATTERN.test(id)))) {
    throw new ProcPlantGeneratorGraphError(`${label}.nodeIds must contain stable node IDs`);
  }
  if (scope.mode === "stages" && (!Array.isArray(scope.stages) || scope.stages.some((stage) => !STAGE_SET.has(stage)))) {
    throw new ProcPlantGeneratorGraphError(`${label}.stages contains an invalid stage`);
  }
};

export const validateProcPlantGeneratorGraph = (graph: ProcPlantGeneratorGraph): string[] => {
  if (graph.contract !== PROCPLANT_GENERATOR_GRAPH_CONTRACT || graph.version !== PROCPLANT_GENERATOR_GRAPH_VERSION) {
    throw new ProcPlantGeneratorGraphError("unsupported generator graph contract or version");
  }
  if (!Number.isInteger(graph.seed) || graph.seed < 0 || graph.seed > 0xffffffff) {
    throw new ProcPlantGeneratorGraphError("graph.seed must be a uint32");
  }
  if (graph.target !== undefined && (
    graph.target.kind !== "procplant-genome"
    || graph.target.version !== 1
    || !ID_PATTERN.test(graph.target.id)
  )) throw new ProcPlantGeneratorGraphError("graph.target must be a versioned procplant-genome target");
  if (!Array.isArray(graph.nodes)) throw new ProcPlantGeneratorGraphError("graph.nodes must be an array");
  if (graph.nodes.length < 1 || graph.nodes.length > PROCPLANT_GENERATOR_GRAPH_MAX_NODES) {
    throw new ProcPlantGeneratorGraphError(`graph.nodes must contain 1..${PROCPLANT_GENERATOR_GRAPH_MAX_NODES} nodes`);
  }
  const ids = new Set<string>();
  let edgeCount = 0;
  let operationCount = 0;
  for (const node of graph.nodes) {
    if (!ID_PATTERN.test(node.id)) throw new ProcPlantGeneratorGraphError(`invalid stable node ID: ${node.id}`);
    if (ids.has(node.id)) throw new ProcPlantGeneratorGraphError(`duplicate node ID: ${node.id}`);
    ids.add(node.id);
    if (!node.label.trim()) throw new ProcPlantGeneratorGraphError(`${node.id}.label must not be empty`);
    if (!STAGE_SET.has(node.stage)) throw new ProcPlantGeneratorGraphError(`${node.id}.stage is invalid`);
    if (typeof node.enabled !== "boolean") throw new ProcPlantGeneratorGraphError(`${node.id}.enabled must be boolean`);
    if (!Array.isArray(node.dependsOn)) throw new ProcPlantGeneratorGraphError(`${node.id}.dependsOn must be an array`);
    if (new Set(node.dependsOn).size !== node.dependsOn.length) {
      throw new ProcPlantGeneratorGraphError(`${node.id}.dependsOn contains duplicates`);
    }
    edgeCount += node.dependsOn.length;
    if (node.seedOverride !== undefined &&
      (!Number.isInteger(node.seedOverride) || node.seedOverride < 0 || node.seedOverride > 0xffffffff)) {
      throw new ProcPlantGeneratorGraphError(`${node.id}.seedOverride must be a uint32`);
    }
    if (node.count !== undefined && (!Number.isInteger(node.count) || node.count < 0 || node.count > PROCPLANT_GENERATOR_GRAPH_MAX_NODE_OPERATIONS)) {
      throw new ProcPlantGeneratorGraphError(`${node.id}.count must be an integer in 0..${PROCPLANT_GENERATOR_GRAPH_MAX_NODE_OPERATIONS}`);
    }
    if (node.enabled) operationCount += node.count ?? 1;
    if (node.placement) validatePlacement(node.placement, `${node.id}.placement`);
    if (node.parentScope) validateParentScope(node.parentScope, `${node.id}.parentScope`);
    if (node.curve) {
      assertFinite(node.curve.base, `${node.id}.curve.base`);
      assertFinite(node.curve.tip, `${node.id}.curve.tip`);
      assertFinite(node.curve.curve, `${node.id}.curve.curve`);
      if (node.curve.points !== undefined) {
        const points = node.curve.points;
        if (!Array.isArray(points) || points.length < 2) {
          throw new ProcPlantGeneratorGraphError(`${node.id}.curve.points must contain at least two points`);
        }
        for (let index = 0; index < points.length; index++) {
          const point = points[index]!;
          assertFinite(point.t, `${node.id}.curve.points[${index}].t`);
          assertFinite(point.value, `${node.id}.curve.points[${index}].value`);
          if (point.t < 0 || point.t > 1 || (index > 0 && point.t <= points[index - 1]!.t)) {
            throw new ProcPlantGeneratorGraphError(`${node.id}.curve.points t values must increase strictly from 0 to 1`);
          }
        }
        if (points[0]!.t !== 0 || points.at(-1)!.t !== 1) {
          throw new ProcPlantGeneratorGraphError(`${node.id}.curve.points must start at t=0 and end at t=1`);
        }
        if (points[0]!.value !== node.curve.base || points.at(-1)!.value !== node.curve.tip) {
          throw new ProcPlantGeneratorGraphError(`${node.id}.curve point endpoints must equal curve.base and curve.tip`);
        }
        const direction = Math.sign(points.at(-1)!.value - points[0]!.value);
        if (points.some((point, index) => index > 0 && direction * (point.value - points[index - 1]!.value) < 0)) {
          throw new ProcPlantGeneratorGraphError(`${node.id}.curve.points must be monotone for CurveGene compilation`);
        }
      }
    }
    if (node.parameters !== undefined) serializableClone(node.parameters);
  }
  if (edgeCount > PROCPLANT_GENERATOR_GRAPH_MAX_EDGES) {
    throw new ProcPlantGeneratorGraphError(`generator graph exceeds the ${PROCPLANT_GENERATOR_GRAPH_MAX_EDGES} edge cap`);
  }
  if (operationCount > PROCPLANT_GENERATOR_GRAPH_MAX_TOTAL_OPERATIONS) {
    throw new ProcPlantGeneratorGraphError(`generator graph exceeds the ${PROCPLANT_GENERATOR_GRAPH_MAX_TOTAL_OPERATIONS} operation cap`);
  }
  for (const node of graph.nodes) {
    for (const dependency of node.dependsOn) {
      if (dependency === node.id) throw new ProcPlantGeneratorGraphError(`${node.id} cannot depend on itself`);
      if (!ids.has(dependency)) throw new ProcPlantGeneratorGraphError(`${node.id} depends on missing node ${dependency}`);
    }
  }
  return topologicalProcPlantGeneratorOrder(graph);
};

export const topologicalProcPlantGeneratorOrder = (graph: ProcPlantGeneratorGraph): string[] => {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, node.dependsOn.length]));
  const dependents = new Map<string, string[]>();
  for (const node of graph.nodes) {
    for (const dependency of node.dependsOn) {
      if (!nodeById.has(dependency)) throw new ProcPlantGeneratorGraphError(`${node.id} depends on missing node ${dependency}`);
      const list = dependents.get(dependency) ?? [];
      list.push(node.id);
      dependents.set(dependency, list);
    }
  }
  const ready = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of (dependents.get(id) ?? []).sort()) {
      const next = indegree.get(dependent)! - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (order.length !== graph.nodes.length) {
    const cyclic = graph.nodes.map((node) => node.id).filter((id) => !order.includes(id)).sort();
    throw new ProcPlantGeneratorGraphError(`generator graph contains a dependency cycle: ${cyclic.join(", ")}`);
  }
  return order;
};

export const deriveProcPlantGeneratorNodeSeed = (graphSeed: number, nodeId: string) =>
  fnv1a(nodeId, (graphSeed ^ 0x9e3779b9) >>> 0);

export const applyProcPlantGeneratorGraphOperations = (
  source: ProcPlantGeneratorGraph,
  operations: readonly ProcPlantGeneratorGraphOperation[],
): ProcPlantGeneratorGraph => {
  const graph = serializableClone(source);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const operation of operations) {
    const node = byId.get(operation.nodeId);
    if (!node) throw new ProcPlantGeneratorGraphError(`override targets missing node ${operation.nodeId}`);
    if (operation.op === "set-enabled") node.enabled = operation.value;
    else if (operation.op === "set-seed") node.seedOverride = operation.value;
    else if (operation.op === "set-count") node.count = operation.value;
    else if (operation.op === "set-placement") node.placement = operation.value ? serializableClone(operation.value) : undefined;
    else if (operation.op === "set-parent-scope") node.parentScope = operation.value ? serializableClone(operation.value) : undefined;
    else if (operation.op === "set-curve") node.curve = operation.value ? serializableClone(operation.value) : undefined;
    else if (operation.op === "set-parameters") node.parameters = operation.value ? serializableClone(operation.value) : undefined;
    else if (operation.op === "add-dependency") {
      if (!node.dependsOn.includes(operation.dependencyId)) node.dependsOn.push(operation.dependencyId);
      node.dependsOn.sort();
    } else {
      node.dependsOn = node.dependsOn.filter((dependency) => dependency !== operation.dependencyId);
    }
  }
  validateProcPlantGeneratorGraph(graph);
  return graph;
};

export const summarizeProcPlantGeneratorGraph = (
  source: ProcPlantGeneratorGraph,
  operations: readonly ProcPlantGeneratorGraphOperation[] = [],
): ProcPlantGeneratorPreviewSummary => {
  const graph = operations.length ? applyProcPlantGeneratorGraphOperations(source, operations) : serializableClone(source);
  const order = validateProcPlantGeneratorGraph(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes = order.map((id): ProcPlantGeneratorPreviewNode => {
    const node = byId.get(id)!;
    return {
      id: node.id,
      label: node.label,
      stage: node.stage,
      enabled: node.enabled,
      seed: node.seedOverride ?? deriveProcPlantGeneratorNodeSeed(graph.seed, node.id),
      count: node.count ?? 1,
      dependencies: [...node.dependsOn].sort(),
      placement: node.placement?.mode ?? null,
      parentScope: node.parentScope?.mode ?? null,
    };
  });
  const stageCounts: Partial<Record<ProcPlantGeneratorStage, number>> = {};
  for (const stage of STAGES) {
    const count = nodes.filter((node) => node.enabled && node.stage === stage).length;
    if (count > 0) stageCounts[stage] = count;
  }
  const body = {
    contract: PROCPLANT_GENERATOR_GRAPH_CONTRACT,
    version: PROCPLANT_GENERATOR_GRAPH_VERSION,
    seed: graph.seed,
    nodeCount: nodes.length,
    enabledNodeCount: nodes.filter((node) => node.enabled).length,
    dependencyCount: nodes.reduce((sum, node) => sum + node.dependencies.length, 0),
    estimatedOperationCount: nodes.reduce((sum, node) => sum + (node.enabled ? node.count : 0), 0),
    stageCounts,
    order,
    nodes,
  };
  return { ...body, hash: fnv1a(stableJson(body)).toString(16).padStart(8, "0") };
};

export const executeProcPlantGeneratorGraph = async <TOutput = unknown>(
  source: ProcPlantGeneratorGraph,
  handlers: ProcPlantGeneratorHandlers<TOutput>,
  operations: readonly ProcPlantGeneratorGraphOperation[] = [],
): Promise<ProcPlantGeneratorExecutionResult<TOutput>> => {
  const graph = operations.length ? applyProcPlantGeneratorGraphOperations(source, operations) : serializableClone(source);
  const preview = summarizeProcPlantGeneratorGraph(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const outputs: Record<string, TOutput> = Object.create(null) as Record<string, TOutput>;
  const records: ProcPlantGeneratorExecutionResult<TOutput>["records"] = [];
  for (const nodeId of preview.order) {
    const node = byId.get(nodeId)!;
    const seed = node.seedOverride ?? deriveProcPlantGeneratorNodeSeed(graph.seed, node.id);
    if (!node.enabled) {
      records.push({ nodeId, stage: node.stage, seed, status: "disabled" });
      continue;
    }
    const handler = handlers[node.stage];
    if (!handler) throw new ProcPlantGeneratorGraphError(`no handler registered for enabled stage ${node.stage} (${node.id})`);
    const dependencies = Object.fromEntries(
      [...node.dependsOn]
        .sort()
        .filter((dependency) => Object.prototype.hasOwnProperty.call(outputs, dependency))
        .map((dependency) => [dependency, outputs[dependency]!]),
    );
    outputs[node.id] = await handler({ graph, node, seed, dependencies });
    records.push({ nodeId, stage: node.stage, seed, status: "executed" });
  }
  return { graph, preview, outputs, records };
};

export const copyProcPlantGeneratorSubgraph = (
  graph: ProcPlantGeneratorGraph,
  rootIds: readonly string[],
  includeDependencies = true,
): ProcPlantGeneratorClipboard => {
  validateProcPlantGeneratorGraph(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const selected = new Set<string>();
  const visit = (id: string) => {
    const node = byId.get(id);
    if (!node) throw new ProcPlantGeneratorGraphError(`cannot copy missing node ${id}`);
    if (selected.has(id)) return;
    selected.add(id);
    if (includeDependencies) node.dependsOn.forEach(visit);
  };
  [...new Set(rootIds)].sort().forEach(visit);
  const externalDependencies: ProcPlantGeneratorClipboard["externalDependencies"] = [];
  const nodes = topologicalProcPlantGeneratorOrder(graph)
    .filter((id) => selected.has(id))
    .map((id) => {
      const node = serializableClone(byId.get(id)!);
      for (const dependency of node.dependsOn) {
        if (!selected.has(dependency)) externalDependencies.push({ nodeId: id, dependencyId: dependency });
      }
      node.dependsOn = node.dependsOn.filter((dependency) => selected.has(dependency)).sort();
      return node;
    });
  return {
    contract: "procplants.generator-subgraph",
    version: 1,
    seed: graph.seed,
    rootIds: [...new Set(rootIds)].sort(),
    nodes,
    externalDependencies: externalDependencies.sort((a, b) =>
      a.nodeId.localeCompare(b.nodeId) || a.dependencyId.localeCompare(b.dependencyId),
    ),
  };
};

export const serializeProcPlantGeneratorSubgraph = (clipboard: ProcPlantGeneratorClipboard) =>
  `${JSON.stringify(canonicalValue(clipboard), null, 2)}\n`;

export const deserializeProcPlantGeneratorSubgraph = (contents: string): ProcPlantGeneratorClipboard => {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new ProcPlantGeneratorGraphError(`invalid generator subgraph JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object") throw new ProcPlantGeneratorGraphError("generator subgraph must be an object");
  const clipboard = value as ProcPlantGeneratorClipboard;
  if (clipboard.contract !== "procplants.generator-subgraph" || clipboard.version !== 1 || !Array.isArray(clipboard.nodes)) {
    throw new ProcPlantGeneratorGraphError("unsupported generator subgraph contract or version");
  }
  createProcPlantGeneratorGraph(clipboard.nodes, clipboard.seed);
  if (!Array.isArray(clipboard.rootIds) || !Array.isArray(clipboard.externalDependencies)) {
    throw new ProcPlantGeneratorGraphError("generator subgraph roots and external dependencies must be arrays");
  }
  return serializableClone(clipboard);
};

export const pasteProcPlantGeneratorSubgraph = (
  target: ProcPlantGeneratorGraph,
  clipboard: ProcPlantGeneratorClipboard,
  options: { idPrefix?: string; dependencyMap?: Readonly<Record<string, string>> } = {},
) => {
  validateProcPlantGeneratorGraph(target);
  const parsed = deserializeProcPlantGeneratorSubgraph(serializeProcPlantGeneratorSubgraph(clipboard));
  const graph = serializableClone(target);
  const occupied = new Set(graph.nodes.map((node) => node.id));
  const idMap: Record<string, string> = Object.create(null) as Record<string, string>;
  const prefix = slug(options.idPrefix ?? "copy");
  for (const node of [...parsed.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    let candidate = node.id;
    if (occupied.has(candidate)) {
      candidate = `${prefix}-${node.id}`;
      let suffix = 2;
      while (occupied.has(candidate)) candidate = `${prefix}${suffix++}-${node.id}`;
    }
    occupied.add(candidate);
    idMap[node.id] = candidate;
  }
  const externalByNode = new Map<string, string[]>();
  for (const edge of parsed.externalDependencies) {
    const list = externalByNode.get(edge.nodeId) ?? [];
    list.push(edge.dependencyId);
    externalByNode.set(edge.nodeId, list);
  }
  const pastedNodes = parsed.nodes.map((sourceNode) => {
    const node = serializableClone(sourceNode);
    node.id = idMap[sourceNode.id]!;
    const internal = sourceNode.dependsOn.map((dependency) => idMap[dependency]!).filter(Boolean);
    const external = (externalByNode.get(sourceNode.id) ?? [])
      .map((dependency) => options.dependencyMap?.[dependency] ?? (occupied.has(dependency) ? dependency : undefined))
      .filter((dependency): dependency is string => Boolean(dependency));
    node.dependsOn = [...new Set([...internal, ...external])].sort();
    return node;
  });
  graph.nodes.push(...pastedNodes);
  validateProcPlantGeneratorGraph(graph);
  return {
    graph,
    idMap,
    pastedRootIds: parsed.rootIds.map((id) => idMap[id]).filter((id): id is string => Boolean(id)).sort(),
  };
};
