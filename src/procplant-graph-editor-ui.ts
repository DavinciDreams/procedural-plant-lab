import type { ProcPlantGenome } from "./procplants";
import * as authoringGraphModule from "./procplant-authoring-graph";
import * as generatorGraphModule from "./procplant-generator-graph";
import type { ProcPlantGeneratorGraphOperation } from "./procplant-generator-graph";

export { authoringGraphModule, generatorGraphModule };

export interface ProcPlantGraphEditorState {
  canonicalGraph: ReturnType<typeof authoringGraphModule.createProcPlantAuthoringGraph>;
  graph: ReturnType<typeof authoringGraphModule.createProcPlantAuthoringGraph>;
  preview: ReturnType<typeof generatorGraphModule.summarizeProcPlantGeneratorGraph>;
  applyAudit: ReturnType<typeof authoringGraphModule.applyProcPlantAuthoringGraphToGenome>;
}

export interface ProcPlantGraphEditorRenderOptions {
  container: HTMLElement;
  sourceGenome: ProcPlantGenome;
  seed: number;
  operations: readonly ProcPlantGeneratorGraphOperation[];
  onOperationsChanged: (operations: ProcPlantGeneratorGraphOperation[]) => void;
  onReset: () => void;
}

export const compileProcPlantGraphEditorState = (
  sourceGenome: ProcPlantGenome,
  seed: number,
  operations: readonly ProcPlantGeneratorGraphOperation[],
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
  };
};

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

export const renderProcPlantGraphEditor = (options: ProcPlantGraphEditorRenderOptions) => {
  const { canonicalGraph, graph, preview, applyAudit } = compileProcPlantGraphEditorState(
    options.sourceGenome,
    options.seed,
    options.operations,
  );
  const summary = document.createElement("p");
  summary.className = "graph-summary";
  summary.textContent = `${preview.enabledNodeCount}/${preview.nodeCount} stages \u00b7 ${preview.dependencyCount} dependencies \u00b7 ${preview.estimatedOperationCount.toLocaleString()} estimated operations \u00b7 ${preview.hash}`;
  summary.textContent += ` \u00b7 ${applyAudit.applied.length} compiler controls applied \u00b7 ${applyAudit.unsupported.length} preview-only changes`;

  const editorNote = document.createElement("p");
  editorNote.className = "graph-editor-note";
  editorNote.textContent = "All nine canonical stages run through built-in handlers. Supported foliage wiring consumes architecture/branch outputs; stage seed overrides project into the generator's single global seed. Controls without a monolithic compiler seam remain explicitly preview-only in the audit.";
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
  const list = document.createElement("ol");
  list.className = "graph-node-list";
  const nodeById = new Map(preview.nodes.map((node) => [node.id, node]));
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const commitOperations = (operations: ProcPlantGeneratorGraphOperation[]) => {
    let next = [...options.operations];
    for (const operation of operations) {
      next = [...next.filter((existing) => !operationMatches(existing, operation)), operation];
    }
    try {
      compileProcPlantGraphEditorState(options.sourceGenome, options.seed, next);
      editorStatus.textContent = `${operations.map((operation) => operation.op).join(" + ")} applied to the authoring graph.`;
      options.onOperationsChanged(next);
    } catch (error) {
      editorStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  const commitOperation = (operation: ProcPlantGeneratorGraphOperation) => commitOperations([operation]);

  for (const nodeId of preview.order) {
    const node = nodeById.get(nodeId);
    const graphNode = graphNodeById.get(nodeId);
    if (!node || !graphNode) continue;
    const item = document.createElement("li");
    item.dataset.nodeId = node.id;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-node";
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
      for (const other of list.querySelectorAll<HTMLElement>("li")) {
        if (other !== item) other.classList.remove("active", "dependency");
        else other.classList.remove("dependency");
      }
      if (active) {
        for (const dependency of node.dependencies) {
          list.querySelector<HTMLElement>(`li[data-node-id="${CSS.escape(dependency)}"]`)?.classList.add("dependency");
        }
      }
    });

    const nodeEditor = document.createElement("div");
    nodeEditor.className = "graph-node-editor";
    const enabledLabel = document.createElement("label");
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = graphNode.enabled;
    enabledInput.addEventListener("change", () => commitOperation({
      op: "set-enabled", nodeId: graphNode.id, value: enabledInput.checked,
    }));
    enabledLabel.append(enabledInput, " enabled");
    nodeEditor.append(enabledLabel);

    if (graphNode.count !== undefined) {
      const countLabel = document.createElement("label");
      countLabel.textContent = "count ";
      const countInput = document.createElement("input");
      countInput.type = "number";
      countInput.min = "0";
      countInput.step = "1";
      countInput.value = String(graphNode.count);
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

    if (graphNode.stage === "branching" && graphNode.parentScope?.maxDepth !== undefined) {
      const depthLabel = document.createElement("label");
      depthLabel.textContent = "parent max depth ";
      const depthInput = document.createElement("input");
      depthInput.type = "number";
      depthInput.min = "0";
      depthInput.step = "1";
      depthInput.value = String(graphNode.parentScope.maxDepth);
      depthInput.addEventListener("change", () => {
        const value = Number(depthInput.value);
        if (!Number.isInteger(value) || value < 0) {
          editorStatus.textContent = "Parent max depth must be a non-negative integer.";
          return;
        }
        commitOperation({ op: "set-parent-scope", nodeId: graphNode.id, value: { ...graphNode.parentScope!, maxDepth: value } });
      });
      depthLabel.append(depthInput);
      nodeEditor.append(depthLabel);
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

  options.container.replaceChildren(summary, editorNote, editorActions, editorStatus, list);
  options.container.dataset.hash = preview.hash;
  return { graph, preview, applyAudit };
};
