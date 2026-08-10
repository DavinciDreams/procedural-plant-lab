import assert from "node:assert/strict";
import type { ProcPlantMaterialGraph } from "../src/procplant-material-graph";
import {
  addProcPlantMaterialEditorNode,
  createProcPlantMaterialGraphEditorState,
  importProcPlantMaterialGraphEditorJson,
  redoProcPlantMaterialGraphEditor,
  removeProcPlantMaterialEditorNode,
  replaceProcPlantMaterialEditorNode,
  resetProcPlantMaterialGraphEditor,
  serializeProcPlantMaterialGraph,
  setProcPlantMaterialEditorSurfaceChannel,
  setProcPlantMaterialEditorNodeInput,
  undoProcPlantMaterialGraphEditor,
} from "../src/procplant-material-graph-editor";

const source: ProcPlantMaterialGraph = {
  contract: "procplants.material-graph",
  version: 1,
  id: "editor-test",
  textures: [],
  nodes: [
    { id: "rough", kind: "scalar", value: 0.7 },
    { id: "green", kind: "color", value: [0.1, 0.55, 0.2, 1] },
  ],
  surfaces: [{ slot: "leaf", channels: { roughness: "rough", baseColor: "green" }, doubleSided: true }],
  metadata: { z: 2, a: "stable" },
};
const snapshot = JSON.stringify(source);
const initial = createProcPlantMaterialGraphEditorState(source);
assert.equal(initial.changed, false);

const changed = replaceProcPlantMaterialEditorNode(initial, "rough", { id: "rough", kind: "scalar", value: 0.42 });
assert.equal(changed.ok, true);
if (!changed.ok) throw new Error(changed.error);
assert.equal(changed.state.changed, true);
assert.equal(changed.state.undoStack.length, 1);
assert.equal(JSON.stringify(source), snapshot, "edits must not mutate the source graph");

const undone = undoProcPlantMaterialGraphEditor(changed.state);
assert.equal(undone.compiled.contentHash, initial.compiled.contentHash);
assert.equal(redoProcPlantMaterialGraphEditor(undone).compiled.contentHash, changed.state.compiled.contentHash);
assert.equal(resetProcPlantMaterialGraphEditor(changed.state).ok, true);

const canonical = serializeProcPlantMaterialGraph({
  ...source,
  nodes: [...source.nodes].reverse(),
  metadata: { z: 2, a: "stable" },
});
assert.equal(canonical, serializeProcPlantMaterialGraph(source), "declaration order must not perturb authoring JSON");
const imported = importProcPlantMaterialGraphEditorJson(initial, canonical);
assert.equal(imported.ok, true);
assert.strictEqual(importProcPlantMaterialGraphEditorJson(initial, "{").state, initial);

const missingNode = replaceProcPlantMaterialEditorNode(initial, "missing", source.nodes[0]!);
assert.equal(missingNode.ok, false);
assert.strictEqual(missingNode.state, initial);
const missingSurface = setProcPlantMaterialEditorSurfaceChannel(initial, "missing", "roughness", "rough");
assert.equal(missingSurface.ok, false);
assert.strictEqual(missingSurface.state, initial);
const invalidBinding = setProcPlantMaterialEditorSurfaceChannel(initial, "leaf", "roughness", "missing");
assert.equal(invalidBinding.ok, false);
assert.strictEqual(invalidBinding.state, initial);

const addedColor = addProcPlantMaterialEditorNode(initial, { id: "blue", kind: "color", value: [0.1, 0.2, 0.8, 1] });
assert.equal(addedColor.ok, true);
if (!addedColor.ok) throw new Error(addedColor.error);
const invalidUnusedType = addProcPlantMaterialEditorNode(addedColor.state, {
  id: "invalidRemap", kind: "remap", input: "green", inMin: 0, inMax: 1, outMin: 0, outMax: 1,
});
assert.equal(invalidUnusedType.ok, false, "disconnected editor nodes must still be fully type checked");
assert.strictEqual(invalidUnusedType.state, addedColor.state);
const addedMix = addProcPlantMaterialEditorNode(addedColor.state, { id: "greenMix", kind: "mix", a: "green", b: "blue", factor: "rough" });
assert.equal(addedMix.ok, true);
if (!addedMix.ok) throw new Error(addedMix.error);
assert.equal(initial.graph.nodes.length, 2, "adding a node must not mutate the prior editor state");
const boundMix = setProcPlantMaterialEditorSurfaceChannel(addedMix.state, "leaf", "baseColor", "greenMix");
assert.equal(boundMix.ok, true);
if (!boundMix.ok) throw new Error(boundMix.error);
const connectedRemoval = removeProcPlantMaterialEditorNode(boundMix.state, "greenMix");
assert.equal(connectedRemoval.ok, false);
assert.match(connectedRemoval.error, /still bound/);
assert.strictEqual(connectedRemoval.state, boundMix.state);

const addedInverse = addProcPlantMaterialEditorNode(addedMix.state, { id: "inverse", kind: "one-minus", input: "rough" });
assert.equal(addedInverse.ok, true);
if (!addedInverse.ok) throw new Error(addedInverse.error);
const cycle = setProcPlantMaterialEditorNodeInput(addedInverse.state, "inverse", "input", "inverse");
assert.equal(cycle.ok, false);
assert.match(cycle.error, /cycle/);
assert.strictEqual(cycle.state, addedInverse.state, "invalid rewires must retain the exact prior state");
const addedScalar = addProcPlantMaterialEditorNode(addedInverse.state, { id: "alternateRough", kind: "scalar", value: 0.25 });
assert.equal(addedScalar.ok, true);
if (!addedScalar.ok) throw new Error(addedScalar.error);
const rewired = setProcPlantMaterialEditorNodeInput(addedScalar.state, "inverse", "input", "alternateRough");
assert.equal(rewired.ok, true);
if (!rewired.ok) throw new Error(rewired.error);
assert.equal(rewired.state.graph.nodes.find((node) => node.id === "inverse")?.kind, "one-minus");
assert.equal((rewired.state.graph.nodes.find((node) => node.id === "inverse") as { input: string }).input, "alternateRough");
const removedInverse = removeProcPlantMaterialEditorNode(rewired.state, "inverse");
assert.equal(removedInverse.ok, true, "an unbound node with no dependents can be removed safely");

console.log("procplant material graph editor state tests passed");
