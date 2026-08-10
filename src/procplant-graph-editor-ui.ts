import { defaultPlantEnvironment, type ProcPlantEnvironment, type ProcPlantGenome } from "./procplants";
import * as authoringGraphModule from "./procplant-authoring-graph";
import * as generatorGraphModule from "./procplant-generator-graph";
import * as productionDagModule from "./procplant-production-dag";
import type { ProcPlantGeneratorGraphOperation, ProcPlantParentScope } from "./procplant-generator-graph";
import {
  copyProcPlantGraphEditorSubgraph,
  mergeProcPlantGraphEditorOperations,
  pasteProcPlantGraphEditorSubgraph,
} from "./procplant-graph-editor-controls";

export { authoringGraphModule, generatorGraphModule };

export interface ProcPlantGraphEditorState {
  canonicalGraph: ReturnType<typeof authoringGraphModule.createProcPlantAuthoringGraph>;
  graph: ReturnType<typeof authoringGraphModule.createProcPlantAuthoringGraph>;
  preview: ReturnType<typeof generatorGraphModule.summarizeProcPlantGeneratorGraph>;
  applyAudit: ReturnType<typeof authoringGraphModule.applyProcPlantAuthoringGraphToGenome>;
  production: ReturnType<typeof productionDagModule.compileProcPlantProductionDag> | null;
}

export interface ProcPlantGraphEditorRenderOptions {
  container: HTMLElement;
  sourceGenome: ProcPlantGenome;
  seed: number;
  operations: readonly ProcPlantGeneratorGraphOperation[];
  onOperationsChanged: (operations: ProcPlantGeneratorGraphOperation[]) => void;
  onReset: () => void;
}

let graphEditorClipboardContents = "";

export const compileProcPlantGraphEditorState = (
  sourceGenome: ProcPlantGenome,
  seed: number,
  operations: readonly ProcPlantGeneratorGraphOperation[],
  environment: ProcPlantEnvironment = defaultPlantEnvironment(),
): ProcPlantGraphEditorState => {
  const canonicalGraph = authoringGraphModule.createProcPlantAuthoringGraph(sourceGenome, seed);
  const graph = operations.length
    ? generatorGraphModule.applyProcPlantGeneratorGraphOperations(canonicalGraph, operations)
    : canonicalGraph;
  return {
    canonicalGraph,
    graph,
    preview: generatorGraphModule.summarizeProcPlantGeneratorGraph(graph),
    applyAudit: authoringGraphModule.applyProcPlantAuthoringGraphToGenome(sourceGenome, graph, seed),
    production: operations.length > 0
      ? productionDagModule.compileProcPlantProductionDag(sourceGenome, graph, environment, { canonicalSeed: seed })
      : null,
  };
};

export const renderProcPlantGraphEditor = (options: ProcPlantGraphEditorRenderOptions) => {
  const { canonicalGraph, graph, preview, applyAudit, production } = compileProcPlantGraphEditorState(
    options.sourceGenome,
    options.seed,
    options.operations,
  );
  const summary = document.createElement("p");
  summary.className = "graph-summary";
  summary.textContent = `${preview.enabledNodeCount}/${preview.nodeCount} stages \u00b7 ${preview.dependencyCount} dependencies \u00b7 ${preview.estimatedOperationCount.toLocaleString()} estimated operations \u00b7 ${preview.hash}`;
  summary.textContent += ` \u00b7 ${applyAudit.applied.length} compiler controls applied \u00b7 ${applyAudit.unsupported.length} preview-only changes`;
  if (production) summary.textContent += ` \u00b7 ${production.records.filter((record) => record.status === "executed").length} typed artifacts`;

  const editorNote = document.createElement("p");
  editorNote.className = "graph-editor-note";
  editorNote.textContent = "This authoring graph has fixed, compiler-owned stage slots. Add/remove activates or deactivates a validated slot; copy/paste projects controls onto matching stages without inventing new topology. Edited graph-native backends compile through typed artifacts, while unsupported placement, scope, dependency, and specialized-backend changes fail closed with a diagnostic.";
  const editorActions = document.createElement("div");
  editorActions.className = "graph-editor-actions";
  const resetGraphButton = document.createElement("button");
  resetGraphButton.type = "button";
  resetGraphButton.textContent = "Reset graph overrides";
  resetGraphButton.disabled = options.operations.length === 0;
  resetGraphButton.addEventListener("click", options.onReset);
  editorActions.append(resetGraphButton);
  const editorStatus = document.createElement("output");
  editorStatus.className = "graph-editor-status";
  editorStatus.setAttribute("aria-live", "polite");
  editorStatus.setAttribute("aria-atomic", "true");
  const clipboardEditor = document.createElement("fieldset");
  clipboardEditor.className = "graph-subgraph-clipboard";
  const clipboardLegend = document.createElement("legend");
  clipboardLegend.textContent = "Subgraph copy / paste";
  const clipboardLabel = document.createElement("label");
  clipboardLabel.textContent = "Validated subgraph JSON";
  const clipboardInput = document.createElement("textarea");
  clipboardInput.rows = 4;
  clipboardInput.spellcheck = false;
  clipboardInput.value = graphEditorClipboardContents;
  clipboardInput.setAttribute("aria-describedby", "graph-clipboard-help");
  clipboardInput.addEventListener("input", () => { graphEditorClipboardContents = clipboardInput.value; });
  const clipboardHelp = document.createElement("small");
  clipboardHelp.id = "graph-clipboard-help";
  clipboardHelp.textContent = "Copy a node and its dependencies, then paste onto a same-stage node in this or another species.";
  clipboardLabel.append(clipboardInput);
  clipboardEditor.append(clipboardLegend, clipboardLabel, clipboardHelp);
  const list = document.createElement("ol");
  list.className = "graph-node-list";
  const nodeById = new Map(preview.nodes.map((node) => [node.id, node]));
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const commitOperations = (operations: ProcPlantGeneratorGraphOperation[]) => {
    const next = mergeProcPlantGraphEditorOperations(options.operations, operations);
    try {
      compileProcPlantGraphEditorState(options.sourceGenome, options.seed, next);
      editorStatus.textContent = `${operations.map((operation) => operation.op).join(" + ")} applied to the authoring graph.`;
      options.onOperationsChanged(next);
    } catch (error) {
      editorStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  const commitOperation = (operation: ProcPlantGeneratorGraphOperation) => commitOperations([operation]);
  const inactiveNodes = graph.nodes.filter((node) => !node.enabled);
  if (inactiveNodes.length > 0) {
    const addNodeSelect = document.createElement("select");
    addNodeSelect.setAttribute("aria-label", "Canonical node to add");
    for (const node of inactiveNodes) {
      const option = document.createElement("option");
      option.value = node.id;
      option.textContent = `${node.label} (${node.stage})`;
      addNodeSelect.append(option);
    }
    const addNodeButton = document.createElement("button");
    addNodeButton.type = "button";
    addNodeButton.dataset.graphAction = "add-node";
    addNodeButton.textContent = "Add node";
    addNodeButton.addEventListener("click", () => commitOperation({
      op: "set-enabled", nodeId: addNodeSelect.value, value: true,
    }));
    editorActions.append(addNodeSelect, addNodeButton);
  }

  for (const nodeId of preview.order) {
    const node = nodeById.get(nodeId);
    const graphNode = graphNodeById.get(nodeId);
    if (!node || !graphNode) continue;
    const item = document.createElement("li");
    item.dataset.nodeId = node.id;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-node";
    button.setAttribute("aria-expanded", "false");
    const count = document.createElement("span");
    count.className = "graph-node-count";
    count.textContent = node.count.toLocaleString();
    const label = document.createElement("span");
    label.textContent = node.label;
    const stage = document.createElement("small");
    stage.textContent = `${node.stage}${node.placement ? ` \u00b7 ${node.placement}` : ""}`;
    button.append(label, count, stage);
    button.addEventListener("click", () => {
      const active = item.classList.toggle("active");
      button.setAttribute("aria-expanded", String(active));
      for (const other of list.querySelectorAll<HTMLElement>("li")) {
        if (other !== item) other.classList.remove("active", "dependency");
        else other.classList.remove("dependency");
      }
      for (const otherButton of list.querySelectorAll<HTMLButtonElement>(".graph-node")) {
        if (otherButton !== button) otherButton.setAttribute("aria-expanded", "false");
      }
      if (active) {
        for (const dependency of node.dependencies) {
          list.querySelector<HTMLElement>(`li[data-node-id="${CSS.escape(dependency)}"]`)?.classList.add("dependency");
        }
      }
    });

    const nodeEditor = document.createElement("div");
    nodeEditor.className = "graph-node-editor";
    nodeEditor.id = `graph-node-editor-${graphNode.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    button.setAttribute("aria-controls", nodeEditor.id);
    const nodeActions = document.createElement("div");
    nodeActions.className = "graph-node-actions";
    const copySubgraphButton = document.createElement("button");
    copySubgraphButton.type = "button";
    copySubgraphButton.dataset.graphAction = "copy-subgraph";
    copySubgraphButton.textContent = "Copy subgraph";
    copySubgraphButton.setAttribute("aria-label", `Copy ${node.label} subgraph`);
    copySubgraphButton.addEventListener("click", () => {
      try {
        graphEditorClipboardContents = copyProcPlantGraphEditorSubgraph(graph, graphNode.id);
        clipboardInput.value = graphEditorClipboardContents;
        editorStatus.textContent = `${node.label} and its dependencies copied as validated subgraph JSON.`;
      } catch (error) {
        editorStatus.textContent = error instanceof Error ? error.message : String(error);
      }
    });
    const pasteSubgraphButton = document.createElement("button");
    pasteSubgraphButton.type = "button";
    pasteSubgraphButton.dataset.graphAction = "paste-subgraph";
    pasteSubgraphButton.textContent = "Paste subgraph here";
    pasteSubgraphButton.setAttribute("aria-label", `Paste compatible subgraph onto ${node.label}`);
    pasteSubgraphButton.addEventListener("click", () => {
      try {
        const contents = clipboardInput.value.trim() || graphEditorClipboardContents;
        if (!contents) throw new Error("Copy a subgraph or paste validated subgraph JSON first.");
        graphEditorClipboardContents = contents;
        commitOperations(pasteProcPlantGraphEditorSubgraph(graph, contents, graphNode.id));
      } catch (error) {
        editorStatus.textContent = error instanceof Error ? error.message : String(error);
      }
    });
    nodeActions.append(copySubgraphButton, pasteSubgraphButton);
    if (graphNode.stage !== "source" && graphNode.stage !== "output") {
      const presenceButton = document.createElement("button");
      presenceButton.type = "button";
      presenceButton.dataset.graphAction = graphNode.enabled ? "remove-node" : "add-node";
      presenceButton.textContent = graphNode.enabled ? "Remove node" : "Add node";
      presenceButton.setAttribute("aria-label", `${graphNode.enabled ? "Remove" : "Add"} ${node.label} generator node`);
      presenceButton.addEventListener("click", () => commitOperation({
        op: "set-enabled", nodeId: graphNode.id, value: !graphNode.enabled,
      }));
      nodeActions.append(presenceButton);
    }
    nodeEditor.append(nodeActions);
    const enabledLabel = document.createElement("label");
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = graphNode.enabled;
    enabledInput.addEventListener("change", () => commitOperation({
      op: "set-enabled", nodeId: graphNode.id, value: enabledInput.checked,
    }));
    enabledLabel.append(enabledInput, " enabled");
    nodeEditor.append(enabledLabel);

    if (graphNode.placement) {
      const placementEditor = document.createElement("fieldset");
      placementEditor.className = "graph-placement-editor";
      const placementLegend = document.createElement("legend");
      placementLegend.textContent = "validated placement";
      const modesByStage: Partial<Record<typeof graphNode.stage, readonly string[]>> = {
        source: ["origin"],
        architecture: ["origin", "nodes"],
        branching: ["nodes", "tips"],
        foliage: ["nodes", "tips"],
        reproductive: ["nodes", "tips"],
        lod: ["volume"],
      };
      const placementModeLabel = document.createElement("label");
      placementModeLabel.textContent = "mode ";
      const placementMode = document.createElement("select");
      placementMode.setAttribute("aria-label", `${node.label} placement mode`);
      for (const mode of modesByStage[graphNode.stage] ?? [graphNode.placement.mode]) {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = mode;
        option.selected = graphNode.placement.mode === mode;
        placementMode.append(option);
      }
      placementMode.addEventListener("change", () => commitOperation({
        op: "set-placement",
        nodeId: graphNode.id,
        value: { ...graphNode.placement!, mode: placementMode.value as typeof graphNode.placement.mode },
      }));
      placementModeLabel.append(placementMode);
      placementEditor.append(placementLegend, placementModeLabel);
      for (const key of ["density", "spacing", "jitter", "rotation"] as const) {
        const placementLabel = document.createElement("label");
        placementLabel.textContent = `${key} `;
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.01";
        input.placeholder = "unset";
        input.value = graphNode.placement[key] === undefined ? "" : String(graphNode.placement[key]);
        input.setAttribute("aria-label", `${node.label} placement ${key}`);
        input.addEventListener("change", () => {
          const value = input.value.trim() === "" ? undefined : Number(input.value);
          if (value !== undefined && !Number.isFinite(value)) {
            editorStatus.textContent = `${key} must be finite or blank.`;
            return;
          }
          const nextPlacement = { ...graphNode.placement! };
          if (value === undefined) delete nextPlacement[key];
          else nextPlacement[key] = value;
          commitOperation({ op: "set-placement", nodeId: graphNode.id, value: nextPlacement });
        });
        placementLabel.append(input);
        placementEditor.append(placementLabel);
      }
      nodeEditor.append(placementEditor);
    }

    if (graphNode.parentScope) {
      const scopeEditor = document.createElement("fieldset");
      scopeEditor.className = "graph-scope-editor";
      const scopeLegend = document.createElement("legend");
      scopeLegend.textContent = "validated parent scope";
      const scopeModeLabel = document.createElement("label");
      scopeModeLabel.textContent = "mode ";
      const scopeMode = document.createElement("select");
      scopeMode.setAttribute("aria-label", `${node.label} parent scope mode`);
      for (const mode of ["root", "all", "tips", "nodes", "stages"] as const) {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = mode;
        option.selected = graphNode.parentScope.mode === mode;
        scopeMode.append(option);
      }
      const scopeForMode = (mode: string): ProcPlantParentScope => {
        const maxDepth = graphNode.parentScope?.maxDepth;
        if (mode === "nodes") return { mode, nodeIds: [...graphNode.dependsOn], ...(maxDepth === undefined ? {} : { maxDepth }) };
        if (mode === "stages") return {
          mode,
          stages: [...new Set(graphNode.dependsOn.map((id) => graphNodeById.get(id)!.stage))],
          ...(maxDepth === undefined ? {} : { maxDepth }),
        };
        return { mode: mode as "root" | "all" | "tips", ...(maxDepth === undefined ? {} : { maxDepth }) };
      };
      scopeMode.addEventListener("change", () => commitOperation({
        op: "set-parent-scope", nodeId: graphNode.id, value: scopeForMode(scopeMode.value),
      }));
      scopeModeLabel.append(scopeMode);
      const depthLabel = document.createElement("label");
      depthLabel.textContent = "max depth ";
      const depthInput = document.createElement("input");
      depthInput.type = "number";
      depthInput.min = "0";
      depthInput.step = "1";
      depthInput.placeholder = "unbounded";
      depthInput.value = graphNode.parentScope.maxDepth === undefined ? "" : String(graphNode.parentScope.maxDepth);
      depthInput.addEventListener("change", () => {
        const value = depthInput.value.trim() === "" ? undefined : Number(depthInput.value);
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
          editorStatus.textContent = "Parent max depth must be a non-negative integer or blank.";
          return;
        }
        const scope = scopeForMode(graphNode.parentScope!.mode);
        if (value === undefined) delete (scope as { maxDepth?: number }).maxDepth;
        else (scope as { maxDepth?: number }).maxDepth = value;
        commitOperation({ op: "set-parent-scope", nodeId: graphNode.id, value: scope });
      });
      depthLabel.append(depthInput);
      scopeEditor.append(scopeLegend, scopeModeLabel, depthLabel);
      const scopeHelp = document.createElement("small");
      scopeHelp.textContent = "nodes/stages scopes follow this node's validated dependency inputs.";
      scopeEditor.append(scopeHelp);
      nodeEditor.append(scopeEditor);
    }

    if (graphNode.count !== undefined) {
      const countLabel = document.createElement("label");
      countLabel.textContent = "count ";
      const countInput = document.createElement("input");
      countInput.type = "number";
      countInput.min = "0";
      countInput.step = "1";
      countInput.value = String(graphNode.count);
      countInput.setAttribute("aria-label", `${node.label} count`);
      countInput.addEventListener("change", () => {
        const value = Number(countInput.value);
        if (!Number.isInteger(value) || value < 0) {
          editorStatus.textContent = "Generator count must be a non-negative integer.";
          return;
        }
        commitOperation({ op: "set-count", nodeId: graphNode.id, value });
      });
      countLabel.append(countInput);
      nodeEditor.append(countLabel);
    }

    if (graphNode.enabled) {
      const seedLabel = document.createElement("label");
      seedLabel.textContent = "stage seed ";
      const seedInput = document.createElement("input");
      seedInput.type = "number";
      seedInput.min = "0";
      seedInput.max = String(0xffffffff);
      seedInput.step = "1";
      seedInput.placeholder = "derived";
      seedInput.value = graphNode.seedOverride === undefined ? "" : String(graphNode.seedOverride);
      seedInput.addEventListener("change", () => {
        const value = seedInput.value.trim() === "" ? undefined : Number(seedInput.value);
        if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
          editorStatus.textContent = "Stage seed must be a uint32 or blank for derived.";
          return;
        }
        commitOperation({ op: "set-seed", nodeId: graphNode.id, value });
      });
      seedLabel.append(seedInput);
      nodeEditor.append(seedLabel);
    }

    if (graphNode.curve) {
      const curveEditor = document.createElement("fieldset");
      curveEditor.className = "graph-curve-editor";
      const legend = document.createElement("legend");
      legend.textContent = "base / tip / exponent";
      curveEditor.append(legend);
      const curveInputs = (["base", "tip", "curve"] as const).map((field) => {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.01";
        input.min = "0";
        input.value = String(graphNode.curve![field]);
        input.setAttribute("aria-label", field === "curve" ? "curve exponent" : field);
        curveEditor.append(input);
        return input;
      });
      const piecewiseLabel = document.createElement("label");
      const piecewiseInput = document.createElement("input");
      piecewiseInput.type = "checkbox";
      piecewiseInput.checked = Boolean(graphNode.curve.points?.length);
      piecewiseLabel.append(piecewiseInput, " piecewise midpoint");
      const midpointInput = document.createElement("input");
      midpointInput.type = "number";
      midpointInput.step = "0.01";
      midpointInput.min = "0";
      midpointInput.setAttribute("aria-label", "curve midpoint value");
      midpointInput.value = String(graphNode.curve.points?.find((point) => point.t === 0.5)?.value
        ?? generatorGraphModule.evaluateProcPlantGeneratorCurve(graphNode.curve, 0.5));
      midpointInput.disabled = !piecewiseInput.checked;
      piecewiseInput.addEventListener("change", () => { midpointInput.disabled = !piecewiseInput.checked; });
      curveEditor.append(piecewiseLabel, midpointInput);
      const applyCurveButton = document.createElement("button");
      applyCurveButton.type = "button";
      applyCurveButton.textContent = "Apply curve";
      applyCurveButton.addEventListener("click", () => {
        const [base, tip, curve] = curveInputs.map((input) => Number(input.value));
        if (![base, tip, curve].every(Number.isFinite) || base < 0 || tip < 0 || curve <= 0) {
          editorStatus.textContent = "Curve base/tip must be non-negative and the exponent must be positive.";
          return;
        }
        const midpoint = Number(midpointInput.value);
        if (piecewiseInput.checked && (!Number.isFinite(midpoint) || midpoint < Math.min(base, tip) || midpoint > Math.max(base, tip))) {
          editorStatus.textContent = "The piecewise midpoint must be finite and between the endpoint values.";
          return;
        }
        commitOperation({
          op: "set-curve",
          nodeId: graphNode.id,
          value: {
            base,
            tip,
            curve,
            ...(piecewiseInput.checked ? { points: [{ t: 0, value: base }, { t: 0.5, value: midpoint }, { t: 1, value: tip }] } : {}),
          },
        });
      });
      curveEditor.append(applyCurveButton);
      nodeEditor.append(curveEditor);
    }

    const commitParameters = (parameters: Record<string, unknown>) => commitOperation({
      op: "set-parameters", nodeId: graphNode.id, value: parameters,
    });
    if (graphNode.stage === "architecture" || graphNode.stage === "deformation") {
      const parameterFields = graphNode.stage === "architecture"
        ? (["apicalDominance", "phyllotaxisAngle"] as const)
        : (["windFlex", "phototropism"] as const);
      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = "compiled stage parameters";
      fieldset.append(legend);
      for (const key of parameterFields) {
        const label = document.createElement("label");
        label.textContent = `${key} `;
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.01";
        input.value = String(graphNode.parameters?.[key]);
        input.addEventListener("change", () => {
          const value = Number(input.value);
          if (!Number.isFinite(value)) { editorStatus.textContent = `${key} must be finite.`; return; }
          commitParameters({ ...graphNode.parameters, [key]: value });
        });
        label.append(input);
        fieldset.append(label);
      }
      nodeEditor.append(fieldset);
    } else if (graphNode.stage === "branching") {
      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = "compiled branch angle";
      fieldset.append(legend);
      const angle = graphNode.parameters?.angle as Record<string, number>;
      for (const key of ["mean", "spread", "depthDecay"] as const) {
        const label = document.createElement("label");
        label.textContent = `${key} `;
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.01";
        input.value = String(angle[key]);
        input.addEventListener("change", () => {
          const value = Number(input.value);
          if (!Number.isFinite(value)) { editorStatus.textContent = `${key} must be finite.`; return; }
          commitParameters({ ...graphNode.parameters, angle: { ...angle, [key]: value } });
        });
        label.append(input);
        fieldset.append(label);
      }
      nodeEditor.append(fieldset);
    } else if (graphNode.stage === "foliage") {
      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = "compiled foliage parameters";
      fieldset.append(legend);
      const addSelect = (key: "shape" | "phyllotaxy", values: readonly string[]) => {
        const label = document.createElement("label");
        label.textContent = `${key} `;
        const select = document.createElement("select");
        for (const value of values) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          option.selected = graphNode.parameters?.[key] === value;
          select.append(option);
        }
        select.addEventListener("change", () => commitParameters({ ...graphNode.parameters, [key]: select.value }));
        label.append(select);
        fieldset.append(label);
      };
      addSelect("shape", ["lanceolate", "ovate", "cordate", "palmate", "spatulate", "fan", "linear", "round", "frond", "blade"]);
      addSelect("phyllotaxy", ["spiral", "alternate", "opposite", "decussate", "whorled"]);
      nodeEditor.append(fieldset);
    } else if (graphNode.stage === "material") {
      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = "compiled leaf colors";
      fieldset.append(legend);
      for (const key of ["leafColorA", "leafColorB"] as const) {
        const input = document.createElement("input");
        input.type = "color";
        input.setAttribute("aria-label", key);
        input.value = `#${Number(graphNode.parameters?.[key]).toString(16).padStart(6, "0")}`;
        input.addEventListener("change", () => commitParameters({ ...graphNode.parameters, [key]: Number.parseInt(input.value.slice(1), 16) }));
        fieldset.append(input);
      }
      nodeEditor.append(fieldset);
    }

    const dependencyEditor = document.createElement("div");
    dependencyEditor.className = "graph-dependency-editor";
    const dependencySelect = document.createElement("select");
    dependencySelect.setAttribute("aria-label", `Dependency for ${node.label}`);
    for (const candidateId of preview.order.filter((candidateId) => candidateId !== graphNode.id)) {
      const candidate = nodeById.get(candidateId)!;
      const option = document.createElement("option");
      option.value = candidateId;
      option.textContent = candidate.label;
      dependencySelect.append(option);
    }
    const addDependencyButton = document.createElement("button");
    addDependencyButton.type = "button";
    addDependencyButton.textContent = "Add input";
    addDependencyButton.addEventListener("click", () => commitOperation({
      op: "add-dependency", nodeId: graphNode.id, dependencyId: dependencySelect.value,
    }));
    const removeDependencyButton = document.createElement("button");
    removeDependencyButton.type = "button";
    removeDependencyButton.textContent = "Remove input";
    removeDependencyButton.addEventListener("click", () => {
      const operations: ProcPlantGeneratorGraphOperation[] = [{
        op: "remove-dependency", nodeId: graphNode.id, dependencyId: dependencySelect.value,
      }];
      if (graphNode.parentScope?.mode === "stages") {
        const removedStage = graphNodeById.get(dependencySelect.value)?.stage;
        const stages = graphNode.parentScope.stages.filter((stage) => stage !== removedStage);
        if (stages.length !== graphNode.parentScope.stages.length) {
          operations.push({ op: "set-parent-scope", nodeId: graphNode.id, value: { ...graphNode.parentScope, stages } });
        }
      }
      commitOperations(operations);
    });
    dependencyEditor.append(dependencySelect, addDependencyButton, removeDependencyButton);
    nodeEditor.append(dependencyEditor);
    item.append(button, nodeEditor);
    list.append(item);
  }

  options.container.replaceChildren(summary, editorNote, editorActions, editorStatus, clipboardEditor, list);
  options.container.dataset.hash = preview.hash;
  options.container.dataset.productionPath = production?.path ?? "legacy-canonical";
  options.container.dataset.productionArtifacts = String(production?.records.filter((record) => record.status === "executed").length ?? 0);
  return { graph, preview, applyAudit, production };
};
