import {
  copyProcPlantGeneratorSubgraph,
  deserializeProcPlantGeneratorSubgraph,
  serializeProcPlantGeneratorSubgraph,
  type ProcPlantGeneratorClipboard,
  type ProcPlantGeneratorGraph,
  type ProcPlantGeneratorGraphOperation,
  type ProcPlantGeneratorNode,
  type ProcPlantParentScope,
} from "./procplant-generator-graph";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const operationMatches = (
  left: ProcPlantGeneratorGraphOperation,
  right: ProcPlantGeneratorGraphOperation,
) => {
  if (left.nodeId !== right.nodeId) return false;
  const dependency = (operation: ProcPlantGeneratorGraphOperation) =>
    operation.op === "add-dependency" || operation.op === "remove-dependency" ? operation.dependencyId : null;
  const leftDependency = dependency(left);
  const rightDependency = dependency(right);
  return leftDependency !== null || rightDependency !== null
    ? leftDependency === rightDependency
    : left.op === right.op;
};

export const mergeProcPlantGraphEditorOperations = (
  current: readonly ProcPlantGeneratorGraphOperation[],
  additions: readonly ProcPlantGeneratorGraphOperation[],
) => {
  let next = [...current];
  for (const operation of additions) {
    next = [...next.filter((existing) => !operationMatches(existing, operation)), clone(operation)];
  }
  return next;
};

export const copyProcPlantGraphEditorSubgraph = (
  graph: ProcPlantGeneratorGraph,
  rootId: string,
) => serializeProcPlantGeneratorSubgraph(copyProcPlantGeneratorSubgraph(graph, [rootId], true));

const editableParameters = (
  source: ProcPlantGeneratorNode,
  target: ProcPlantGeneratorNode,
): Record<string, unknown> | undefined => {
  const sourceParameters = source.parameters ?? {};
  const targetParameters = target.parameters ?? {};
  if (source.stage === "architecture") return {
    ...targetParameters,
    apicalDominance: sourceParameters.apicalDominance,
    phyllotaxisAngle: sourceParameters.phyllotaxisAngle,
  };
  if (source.stage === "branching") return { ...targetParameters, angle: clone(sourceParameters.angle) };
  if (source.stage === "foliage") return {
    ...targetParameters,
    shape: sourceParameters.shape,
    phyllotaxy: sourceParameters.phyllotaxy,
  };
  if (source.stage === "deformation") return {
    ...targetParameters,
    windFlex: sourceParameters.windFlex,
    phototropism: sourceParameters.phototropism,
  };
  if (source.stage === "material") return {
    ...targetParameters,
    leafColorA: sourceParameters.leafColorA,
    leafColorB: sourceParameters.leafColorB,
  };
  if (source.stage === "lod") return { ...targetParameters, levels: clone(sourceParameters.levels) };
  return undefined;
};

const mapScope = (
  scope: ProcPlantParentScope | undefined,
  idMap: ReadonlyMap<string, string>,
): ProcPlantParentScope | undefined => {
  if (!scope) return undefined;
  if (scope.mode !== "nodes") return clone(scope);
  const nodeIds = scope.nodeIds.map((id) => idMap.get(id));
  if (nodeIds.some((id) => !id)) throw new Error("Copied parent scope references a node that has no compatible target stage.");
  return { ...scope, nodeIds: nodeIds as string[] };
};

/**
 * Project a serialized subgraph onto the target's existing canonical stage slots.
 * The authoring compiler intentionally rejects added/missing node identities, so
 * this preserves topology identity and only emits ordinary validated overrides.
 */
export const pasteProcPlantGraphEditorSubgraph = (
  target: ProcPlantGeneratorGraph,
  contents: string,
  targetRootId: string,
): ProcPlantGeneratorGraphOperation[] => {
  const clipboard = deserializeProcPlantGeneratorSubgraph(contents);
  if (clipboard.rootIds.length !== 1) throw new Error("Graph editor paste requires exactly one copied root node.");
  const sourceById = new Map(clipboard.nodes.map((node) => [node.id, node]));
  const sourceRoot = sourceById.get(clipboard.rootIds[0]!);
  const targetRoot = target.nodes.find((node) => node.id === targetRootId);
  if (!sourceRoot || !targetRoot) throw new Error("Copied or target root node is missing.");
  if (sourceRoot.stage !== targetRoot.stage) {
    throw new Error(`Cannot paste ${sourceRoot.stage} controls onto ${targetRoot.stage}.`);
  }

  const targetByStage = new Map<string, ProcPlantGeneratorNode>();
  for (const node of target.nodes) {
    if (targetByStage.has(node.stage)) throw new Error(`Target has multiple ${node.stage} nodes; stage projection is ambiguous.`);
    targetByStage.set(node.stage, node);
  }
  const sourceStages = new Set<string>();
  const idMap = new Map<string, string>();
  for (const node of clipboard.nodes) {
    if (sourceStages.has(node.stage)) throw new Error(`Copied subgraph has multiple ${node.stage} nodes; stage projection is ambiguous.`);
    sourceStages.add(node.stage);
    const destination = node.id === sourceRoot.id ? targetRoot : targetByStage.get(node.stage);
    if (!destination) throw new Error(`Target has no ${node.stage} stage for copied node ${node.label}.`);
    idMap.set(node.id, destination.id);
  }

  const operations: ProcPlantGeneratorGraphOperation[] = [];
  for (const source of clipboard.nodes) {
    const targetId = idMap.get(source.id)!;
    const destination = target.nodes.find((node) => node.id === targetId)!;
    if (source.stage !== "source" && source.stage !== "output") {
      operations.push(
        { op: "set-enabled", nodeId: targetId, value: source.enabled },
        { op: "set-seed", nodeId: targetId, value: source.seedOverride },
        { op: "set-count", nodeId: targetId, value: source.count },
        { op: "set-placement", nodeId: targetId, value: source.placement ? clone(source.placement) : undefined },
        { op: "set-parent-scope", nodeId: targetId, value: mapScope(source.parentScope, idMap) },
        { op: "set-curve", nodeId: targetId, value: source.curve ? clone(source.curve) : undefined },
      );
      const parameters = editableParameters(source, destination);
      if (parameters) operations.push({ op: "set-parameters", nodeId: targetId, value: parameters });
    }

    if (source.stage !== "source") {
      const dependencies = source.dependsOn.map((id) => idMap.get(id));
      if (dependencies.some((id) => !id)) throw new Error(`${source.label} has an unmapped dependency.`);
      for (const dependencyId of destination.dependsOn) {
        operations.push({ op: "remove-dependency", nodeId: targetId, dependencyId });
      }
      for (const dependencyId of dependencies as string[]) {
        operations.push({ op: "add-dependency", nodeId: targetId, dependencyId });
      }
    }
  }
  return operations;
};

export const parseProcPlantGraphEditorClipboard = (contents: string): ProcPlantGeneratorClipboard =>
  deserializeProcPlantGeneratorSubgraph(contents);
