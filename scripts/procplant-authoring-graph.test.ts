import assert from "node:assert/strict";
import { procPlantPresets } from "../src/procplants";
import {
  createProcPlantAuthoringGraph,
  previewProcPlantAuthoringGraph,
} from "../src/procplant-authoring-graph";
import { validateProcPlantGeneratorGraph } from "../src/procplant-generator-graph";

for (const presetId of ["phiFern", "oakCanopy", "floweringWallCreeper", "winterberryShrub", "hangingMoss"] as const) {
  const genome = procPlantPresets[presetId];
  const first = createProcPlantAuthoringGraph(genome, 42);
  const second = createProcPlantAuthoringGraph(genome, 42);
  assert.deepEqual(first, second, `${presetId} graph must be deterministic`);
  assert.equal(validateProcPlantGeneratorGraph(first).length, 9);
  const preview = previewProcPlantAuthoringGraph(genome, 42);
  assert.equal(preview.nodeCount, 9);
  assert.equal(preview.order.at(-1), first.nodes.find((node) => node.stage === "output")!.id);
  assert.equal(preview.nodes.find((node) => node.stage === "lod")!.count, 4);
}

const flowerPreview = previewProcPlantAuthoringGraph(procPlantPresets.floweringWallCreeper, 42);
assert.equal(flowerPreview.nodes.find((node) => node.stage === "reproductive")!.enabled, true);
const fernPreview = previewProcPlantAuthoringGraph(procPlantPresets.phiFern, 42);
assert.equal(fernPreview.nodes.find((node) => node.stage === "reproductive")!.enabled, false);
assert.notEqual(flowerPreview.hash, fernPreview.hash);

console.log("procplant authoring graph adapter tests passed");
