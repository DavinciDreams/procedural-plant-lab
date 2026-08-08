import assert from "node:assert/strict";
import {
  applyProcPlantGeneratorGraphOperations,
  copyProcPlantGeneratorSubgraph,
  createProcPlantGeneratorGraph,
  createProcPlantGeneratorNodeId,
  deserializeProcPlantGeneratorSubgraph,
  executeProcPlantGeneratorGraph,
  pasteProcPlantGeneratorSubgraph,
  serializeProcPlantGeneratorSubgraph,
  summarizeProcPlantGeneratorGraph,
  validateProcPlantGeneratorGraph,
  type ProcPlantGeneratorNode,
} from "../src/procplant-generator-graph";
import {
  applyProcPlantMacroRules,
  PROCPLANT_DEFAULT_MACRO_RULES,
  validateProcPlantMacroRules,
  type ProcPlantMacroRule,
} from "../src/procplant-rules";
import { procPlantPresets } from "../src/procplants";

const ids = {
  source: createProcPlantGeneratorNodeId("source", "Genome input", "test"),
  architecture: createProcPlantGeneratorNodeId("architecture", "Trunk and axes", "test"),
  foliage: createProcPlantGeneratorNodeId("foliage", "Leaf placement", "test"),
  output: createProcPlantGeneratorNodeId("output", "Runtime package", "test"),
};
assert.equal(ids.source, createProcPlantGeneratorNodeId("source", "Genome input", "test"));
assert.notEqual(ids.source, createProcPlantGeneratorNodeId("source", "Different input", "test"));

const nodes: ProcPlantGeneratorNode[] = [
  {
    id: ids.output,
    label: "Runtime package",
    stage: "output",
    enabled: true,
    dependsOn: [ids.architecture, ids.foliage],
  },
  {
    id: ids.foliage,
    label: "Leaf placement",
    stage: "foliage",
    enabled: false,
    dependsOn: [ids.architecture],
    count: 24,
    placement: { mode: "tips", density: 0.8, jitter: 0.12 },
    parentScope: { mode: "stages", stages: ["architecture"], maxDepth: 3 },
    curve: { base: 1, tip: 0.4, curve: 1.2 },
  },
  {
    id: ids.architecture,
    label: "Trunk and axes",
    stage: "architecture",
    enabled: true,
    dependsOn: [ids.source],
    seedOverride: 99,
    count: 6,
    placement: { mode: "nodes", spacing: 0.2 },
    parentScope: { mode: "root" },
  },
  {
    id: ids.source,
    label: "Genome input",
    stage: "source",
    enabled: true,
    dependsOn: [],
    parameters: { presetId: "oakCanopy" },
  },
];

const graph = createProcPlantGeneratorGraph(nodes, 1234);
const reversedGraph = createProcPlantGeneratorGraph([...nodes].reverse(), 1234);
const preview = summarizeProcPlantGeneratorGraph(graph);
const reversedPreview = summarizeProcPlantGeneratorGraph(reversedGraph);
assert.deepEqual(preview, reversedPreview, "preview must be independent of serialized node order");
assert.equal(preview.enabledNodeCount, 3);
assert.equal(preview.estimatedOperationCount, 8);
assert.equal(preview.nodes.find((node) => node.id === ids.architecture)!.seed, 99);

const execution = await executeProcPlantGeneratorGraph<string>(graph, {
  source: ({ node, seed }) => `${node.stage}:${seed}`,
  architecture: ({ dependencies }) => `architecture<${Object.keys(dependencies).join(",")}>`,
  foliage: ({ dependencies }) => `foliage<${Object.keys(dependencies).join(",")}>`,
  output: ({ dependencies }) => `output<${Object.keys(dependencies).join(",")}>`,
});
assert.equal(execution.records.find((record) => record.nodeId === ids.foliage)!.status, "disabled");
assert.match(execution.outputs[ids.output]!, new RegExp(ids.architecture.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(execution.outputs[ids.output]!, new RegExp(ids.foliage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

const overridden = applyProcPlantGeneratorGraphOperations(graph, [
  { op: "set-enabled", nodeId: ids.foliage, value: true },
  { op: "set-count", nodeId: ids.foliage, value: 12 },
  { op: "set-placement", nodeId: ids.foliage, value: { mode: "surface", density: 0.5 } },
]);
assert.equal(overridden.nodes.find((node) => node.id === ids.foliage)!.enabled, true);
assert.equal(overridden.nodes.find((node) => node.id === ids.foliage)!.count, 12);
assert.equal(graph.nodes.find((node) => node.id === ids.foliage)!.enabled, false, "manual overrides must not mutate source");
assert.throws(
  () => applyProcPlantGeneratorGraphOperations(graph, [{ op: "add-dependency", nodeId: ids.source, dependencyId: ids.output }]),
  /dependency cycle/,
);

const clipboard = copyProcPlantGeneratorSubgraph(graph, [ids.output], false);
assert.equal(clipboard.nodes.length, 1);
assert.deepEqual(
  clipboard.externalDependencies.map((edge) => edge.dependencyId).sort(),
  [ids.architecture, ids.foliage].sort(),
);
const serialized = serializeProcPlantGeneratorSubgraph(clipboard);
assert.deepEqual(deserializeProcPlantGeneratorSubgraph(serialized), clipboard);
const pasted = pasteProcPlantGeneratorSubgraph(graph, clipboard, { idPrefix: "manual" });
assert.notEqual(pasted.idMap[ids.output], ids.output);
assert.equal(pasted.graph.nodes.length, graph.nodes.length + 1);
assert.equal(graph.nodes.length, 4, "paste must not mutate target graph");
assert.doesNotThrow(() => validateProcPlantGeneratorGraph(pasted.graph));

const sourceGenome = procPlantPresets.oakCanopy!;
const sourceSnapshot = structuredClone(sourceGenome);
const context = {
  age: 0.72,
  season: "spring" as const,
  health: 0.64,
  windExposure: 0.8,
  wetness: 0.9,
  snow: 0.45,
  pruning: 0.2,
  stylization: 0.5,
  biomeAdaptation: 0.75,
};
const applied = applyProcPlantMacroRules(sourceGenome, context);
const reverseApplied = applyProcPlantMacroRules(sourceGenome, context, [...PROCPLANT_DEFAULT_MACRO_RULES].reverse());
assert.deepEqual(applied, reverseApplied, "rule priority/name ordering must be deterministic");
assert.deepEqual(sourceGenome, sourceSnapshot, "rules must not mutate authored genome");
assert.ok(applied.changes.length > 0);
for (const ruleName of [
  "age-growth", "season-spring", "health-vigor", "wind-exposure", "wetness-response",
  "snow-load", "pruning-response", "stylization", "biome-adaptation",
]) assert.ok(applied.appliedRules.includes(ruleName), `${ruleName} must participate`);
assert.notEqual(applied.genome.nodeCount, sourceGenome.nodeCount);
assert.notEqual(applied.genome.treeRealism!.windFlex, sourceGenome.treeRealism!.windFlex);
assert.notEqual(applied.genome.lightResponse.phototropism, sourceGenome.lightResponse.phototropism);

const operationRule: ProcPlantMacroRule = {
  name: "operation-contract",
  missingPath: "error",
  actions: [
    { path: "apicalDominance", op: "set", value: 0.5 },
    { path: "apicalDominance", op: "add", value: 0.2 },
    { path: "apicalDominance", op: "multiply", value: 2 },
    { path: "apicalDominance", op: "clamp", min: 0, max: 1 },
    { path: "leaf.curl", op: "set", value: { input: "wetness", scale: 0.5, offset: 0.1 } },
  ],
};
const operationResult = applyProcPlantMacroRules(sourceGenome, { wetness: 0.8 }, [operationRule]);
assert.equal(operationResult.genome.apicalDominance, 1);
assert.equal(operationResult.genome.leaf.curl, 0.5);
assert.throws(
  () => validateProcPlantMacroRules([{ name: "unsafe", actions: [{ path: "__proto__.polluted", op: "set", value: 1 }] } as unknown as ProcPlantMacroRule]),
  /unsafe path/,
);
assert.throws(
  () => applyProcPlantMacroRules(sourceGenome, {}, [{
    name: "requires-flower",
    missingPath: "error",
    actions: [{ path: "flower.radius", op: "multiply", value: 2 }],
  }]),
  /missing numeric path/,
);

console.log("ok 1 - stable DAG IDs, validation, topological previews, and seeded execution");
console.log("ok 2 - non-mutating graph overrides and serializable copy/paste subgraphs");
console.log("ok 3 - deterministic non-mutating named environmental macro rules");
console.log("ok 4 - safe allow-listed add/multiply/set/clamp rule operations");
console.log("1..4");
