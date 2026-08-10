import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  buildProcPlantInstancedParts,
  compileProcPlantLods,
  defaultPlantEnvironment,
  inspectProcPlantSpaceColonizationChains,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";
import {
  PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_CHAINS,
  createProcPlantChainTubeOverridePackage,
  deserializeProcPlantChainTubeOverridePackage,
  inspectProcPlantColonizationChains,
  removeProcPlantChainTubeOverride,
  serializeProcPlantChainTubeOverridePackage,
  setProcPlantChainTubeOverride,
  validateProcPlantChainTubeOverridePackage,
} from "../src/procplant-chain-tube-overrides";
import type { ProcPlantSpaceColonizationResult } from "../src/procplant-space-colonization";

const hashTemplate = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.uv0, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const node = (id: string, parentId: string | null, depth: number, childCount: number) => ({
  id,
  parentId,
  position: new THREE.Vector3(depth, depth * 0.5, -depth),
  direction: new THREE.Vector3(0, 1, 0),
  depth,
  radius: 0.2 / (depth + 1),
  childCount,
});
const synthetic: Pick<ProcPlantSpaceColonizationResult, "nodes" | "segments"> = {
  nodes: [
    node("root", null, 0, 1),
    node("a", "root", 1, 1),
    node("junction", "a", 2, 2),
    node("left", "junction", 3, 0),
    node("right", "junction", 3, 0),
  ],
  segments: [
    { id: "s0", parentSegmentId: null, startNodeId: "root", endNodeId: "a", depth: 1 },
    { id: "s1", parentSegmentId: "s0", startNodeId: "a", endNodeId: "junction", depth: 2 },
    { id: "s2", parentSegmentId: "s1", startNodeId: "junction", endNodeId: "left", depth: 3 },
    { id: "s3", parentSegmentId: "s1", startNodeId: "junction", endNodeId: "right", depth: 3 },
  ],
};

const ordered = inspectProcPlantColonizationChains("test-tree", 77, synthetic);
const shuffled = inspectProcPlantColonizationChains("test-tree", 77, {
  nodes: [...synthetic.nodes].reverse(),
  segments: [synthetic.segments[3]!, synthetic.segments[1]!, synthetic.segments[0]!, synthetic.segments[2]!],
});
assert.deepEqual(shuffled, ordered, "chain IDs, order, and signature must ignore source array order");
assert.deepEqual(ordered.chains.map((chain) => chain.nodeIds), [
  ["root", "a", "junction"],
  ["junction", "left"],
  ["junction", "right"],
]);
assert.ok(ordered.chains.every((chain) => chain.id.includes(ordered.target.graphSignature.slice(8))));

const empty = createProcPlantChainTubeOverridePackage(ordered.target);
const emptyBefore = structuredClone(empty);
const authored = setProcPlantChainTubeOverride(empty, {
  chainId: ordered.chains[1]!.id,
  radiusScale: 1.4,
  taperScale: 0.55,
  radialSegments: 7,
});
assert.deepEqual(empty, emptyBefore, "immutable editor operations must not mutate their source package");
assert.notEqual(authored, empty);
assert.notEqual(authored.target, empty.target);
const typicalSerialized = serializeProcPlantChainTubeOverridePackage(authored);
assert.ok(typicalSerialized.length < 1_024, "a typical single-chain edit must remain practical for share URLs");
assert.deepEqual(deserializeProcPlantChainTubeOverridePackage(typicalSerialized), authored);
assert.deepEqual(removeProcPlantChainTubeOverride(authored, ordered.chains[1]!.id), empty);
assert.throws(() => setProcPlantChainTubeOverride(empty, { chainId: ordered.chains[0]!.id, radiusScale: 0.24 }), /0.25\.\.4/);
assert.throws(() => setProcPlantChainTubeOverride(empty, { chainId: ordered.chains[0]!.id, taperScale: 2.01 }), /0.1\.\.2/);
assert.throws(() => setProcPlantChainTubeOverride(empty, { chainId: ordered.chains[0]!.id, radialSegments: 4.5 }), /integer/);
assert.throws(() => validateProcPlantChainTubeOverridePackage({
  ...empty,
  overrides: Array.from({ length: PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_CHAINS + 1 }, (_, index) => ({ chainId: `chain-${index}`, radiusScale: 1 })),
}), /chain cap/);
assert.throws(() => validateProcPlantChainTubeOverridePackage({
  ...authored,
  target: { ...authored.target, seed: authored.target.seed + 1 },
}, ordered), /does not match/);
assert.throws(() => validateProcPlantChainTubeOverridePackage({
  ...authored,
  overrides: [{ chainId: "unknown", radiusScale: 1 }],
}, ordered), /unknown chain/);

const preset = procPlantPresets.colonizedHazelShrub!;
const seed = 807_026;
const env = defaultPlantEnvironment();
const legacy = buildProcPlantInstancedParts(preset, seed, env);
const legacyAgain = buildProcPlantInstancedParts(preset, seed, env);
assert.equal(hashTemplate(legacy.stems), hashTemplate(legacyAgain.stems));

const realSnapshot = inspectProcPlantSpaceColonizationChains(preset, seed, env);
assert.ok(realSnapshot.chains.length > 8, "real colonized preset must expose multiple maximal tube chains");
const emptyGenome = structuredClone(preset);
emptyGenome.spaceColonization!.chainTubeOverrides = createProcPlantChainTubeOverridePackage(realSnapshot.target);
const emptyCompiled = buildProcPlantInstancedParts(emptyGenome, seed, env);
assert.equal(
  hashTemplate(emptyCompiled.stems),
  hashTemplate(legacy.stems),
  "an empty, valid package must compile to the byte-identical legacy stem template",
);

const selectedChain = [...realSnapshot.chains].sort((a, b) => b.nodeIds.length - a.nodeIds.length)[0]!;
const overridePackage = setProcPlantChainTubeOverride(
  createProcPlantChainTubeOverridePackage(realSnapshot.target),
  { chainId: selectedChain.id, radiusScale: 1.6, taperScale: 0.4, radialSegments: 3 },
);
const overrideGenome = structuredClone(preset);
overrideGenome.spaceColonization!.chainTubeOverrides = overridePackage;
const overrideBefore = structuredClone(overrideGenome.spaceColonization!.chainTubeOverrides);
const compiled = buildProcPlantInstancedParts(overrideGenome, seed, env);
const compiledAgain = buildProcPlantInstancedParts(overrideGenome, seed, env);
assert.equal(hashTemplate(compiled.stems), hashTemplate(compiledAgain.stems), "authored tubes must compile deterministically");
assert.notEqual(hashTemplate(compiled.stems), hashTemplate(legacy.stems));
assert.ok(compiled.stats.stemTriangles < legacy.stats.stemTriangles, "lower selected-chain resolution must lower real stem cost");
assert.deepEqual(compiled.graph.segments, legacy.graph.segments, "tube editing must not mutate growth topology");
assert.deepEqual(overrideGenome.spaceColonization!.chainTubeOverrides, overrideBefore, "compilation must not mutate authored state");
assert.deepEqual(
  compiled.instances.map((instance) => instance.matrix.elements),
  legacy.instances.map((instance) => instance.matrix.elements),
  "tube editing must not move foliage instances",
);
const authoredLods = compileProcPlantLods(overrideGenome, seed, env);
const legacyLods = compileProcPlantLods(preset, seed, env);
assert.ok(authoredLods[0]!.triangles < legacyLods[0]!.triangles, "LOD0 must retain the selected-chain resolution edit");
assert.ok(authoredLods[1]!.triangles < authoredLods[0]!.triangles, "reduced LODs must compile without leaking LOD0 chain IDs");

const wrongSeedGenome = structuredClone(overrideGenome);
assert.throws(() => buildProcPlantInstancedParts(wrongSeedGenome, seed + 1, env), /does not match/);

console.log(JSON.stringify({
  graphSignature: realSnapshot.target.graphSignature,
  chains: realSnapshot.chains.length,
  selectedChain: selectedChain.id,
  legacyTriangles: legacy.stats.stemTriangles,
  authoredTriangles: compiled.stats.stemTriangles,
  authoredHash: hashTemplate(compiled.stems),
}));
console.log("procplant per-chain tube override tests passed");
