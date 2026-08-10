import assert from "node:assert/strict";
import { createProcPlantAuthoringGraph, applyProcPlantAuthoringGraphToGenome } from "../src/procplant-authoring-graph";
import {
  copyProcPlantGraphEditorSubgraph,
  mergeProcPlantGraphEditorOperations,
  pasteProcPlantGraphEditorSubgraph,
} from "../src/procplant-graph-editor-controls";
import { applyProcPlantGeneratorGraphOperations, deserializeProcPlantGeneratorSubgraph } from "../src/procplant-generator-graph";
import { compileProcPlantProductionDag } from "../src/procplant-production-dag";
import { defaultPlantEnvironment, procPlantPresets } from "../src/procplants";

const seed = 0xdecafbad;
const sourceGenome = procPlantPresets.understoryShrub!;
const targetGenome = procPlantPresets.winterberryShrub!;
const source = createProcPlantAuthoringGraph(sourceGenome, seed);
const target = createProcPlantAuthoringGraph(targetGenome, seed);
const sourceArchitecture = source.nodes.find((node) => node.stage === "architecture")!;
const targetArchitecture = target.nodes.find((node) => node.stage === "architecture")!;
const targetFoliage = target.nodes.find((node) => node.stage === "foliage")!;

const contents = copyProcPlantGraphEditorSubgraph(source, sourceArchitecture.id);
const clipboard = deserializeProcPlantGeneratorSubgraph(contents);
assert.deepEqual(clipboard.rootIds, [sourceArchitecture.id]);
assert.deepEqual(clipboard.nodes.map((node) => node.stage), ["source", "architecture"]);

const pastedOperations = pasteProcPlantGraphEditorSubgraph(target, contents, targetArchitecture.id);
const pasted = applyProcPlantGeneratorGraphOperations(target, pastedOperations);
const pastedArchitecture = pasted.nodes.find((node) => node.id === targetArchitecture.id)!;
assert.equal(pastedArchitecture.count, sourceArchitecture.count);
assert.deepEqual(pastedArchitecture.curve, sourceArchitecture.curve);
assert.equal(pasted.nodes.find((node) => node.stage === "source")!.parameters?.genomeId, targetGenome.id,
  "cross-species paste must preserve target source identity");
assert.equal(applyProcPlantAuthoringGraphToGenome(targetGenome, pasted, seed).genome.nodeCount, sourceGenome.nodeCount);
assert.doesNotThrow(() => compileProcPlantProductionDag(targetGenome, pasted, defaultPlantEnvironment(), { canonicalSeed: seed }));

const merged = mergeProcPlantGraphEditorOperations(
  [{ op: "set-count", nodeId: targetArchitecture.id, value: 99 }],
  pastedOperations,
);
assert.equal(merged.filter((operation) => operation.op === "set-count" && operation.nodeId === targetArchitecture.id).length, 1);
assert.equal((merged.find((operation) => operation.op === "set-count" && operation.nodeId === targetArchitecture.id) as { value: number }).value,
  sourceArchitecture.count);

assert.throws(
  () => pasteProcPlantGraphEditorSubgraph(target, contents, targetFoliage.id),
  /Cannot paste architecture controls onto foliage/,
);
assert.throws(
  () => pasteProcPlantGraphEditorSubgraph(target, '{"contract":"bad"}', targetArchitecture.id),
  /unsupported generator subgraph contract/,
);

const removed = applyProcPlantGeneratorGraphOperations(target, [{ op: "set-enabled", nodeId: targetFoliage.id, value: false }]);
assert.equal(removed.nodes.find((node) => node.id === targetFoliage.id)!.enabled, false);
const restored = applyProcPlantGeneratorGraphOperations(removed, [{ op: "set-enabled", nodeId: targetFoliage.id, value: true }]);
assert.deepEqual(restored, target, "canonical add/remove UI semantics must round-trip exact graph state");

console.log("ok 1 - validated subgraph JSON includes the selected root and dependencies");
console.log("ok 2 - cross-species paste projects compatible controls without changing target identity");
console.log("ok 3 - wrong-stage and malformed paste fail closed");
console.log("ok 4 - canonical add/remove activation round-trips exactly");
console.log("1..4");
