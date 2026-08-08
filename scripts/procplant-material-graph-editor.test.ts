import assert from "node:assert/strict";
import type { ProcPlantMaterialGraph } from "../src/procplant-material-graph";
import {
  createProcPlantMaterialGraphEditorState,
  importProcPlantMaterialGraphEditorJson,
  redoProcPlantMaterialGraphEditor,
  replaceProcPlantMaterialEditorNode,
  resetProcPlantMaterialGraphEditor,
  serializeProcPlantMaterialGraph,
  setProcPlantMaterialEditorSurfaceChannel,
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

console.log("procplant material graph editor state tests passed");
