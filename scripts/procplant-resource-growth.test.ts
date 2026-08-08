import assert from "node:assert/strict";
import {
  PROCPLANT_RESOURCE_GROWTH_CONTRACT_VERSION,
  evaluateProcPlantResourceGrowth,
  summarizeProcPlantLight,
  type ProcPlantResourceNode,
} from "../src/procplant-resource-growth";

const probe = (irradiance: number, direction = { x: 0, y: 1, z: 0 }, occlusion = 0) => ({
  direction,
  irradiance,
  occlusion,
});

const light = summarizeProcPlantLight([
  probe(1, { x: 1, y: 0, z: 0 }),
  probe(0.5, { x: 0, y: 1, z: 0 }),
  { ...probe(1, { x: 0, y: 0, z: 1 }, 1), weight: 2 },
]);
assert.equal(light.exposure, 0.375);
assert.ok(Math.abs(light.direction.x - 0.8944271909999159) < 1e-12);
assert.ok(Math.abs(light.direction.y - 0.4472135954999579) < 1e-12);
assert.equal(light.direction.z, 0);

const nodes: ProcPlantResourceNode[] = [
  {
    id: "lateral-shade",
    parentId: "root",
    budRole: "lateral",
    active: false,
    lightSamples: [probe(0.14)],
    photosyntheticArea: 0.2,
    maintenanceDemand: 0.1,
    growthDemand: 0.8,
    sinkStrength: 1,
  },
  {
    id: "leader",
    parentId: "root",
    budRole: "apical",
    active: true,
    lightSamples: [probe(0.95)],
    photosyntheticArea: 1,
    maintenanceDemand: 0.2,
    growthDemand: 1,
    sinkStrength: 1.2,
  },
  {
    id: "root",
    parentId: null,
    budRole: "apical",
    active: true,
    lightSamples: [probe(0.9)],
    photosyntheticArea: 2,
    maintenanceDemand: 0.4,
    growthDemand: 0.8,
    sinkStrength: 1,
  },
  {
    id: "lateral-sun",
    parentId: "root",
    budRole: "lateral",
    active: false,
    lightSamples: [probe(0.8)],
    photosyntheticArea: 0.8,
    maintenanceDemand: 0.1,
    growthDemand: 0.8,
    sinkStrength: 1,
  },
];

const options = {
  initialResource: 0.2,
  reserveFraction: 0.1,
  apicalDominance: 0.8,
  activationResourceThreshold: 0.1,
  growthResourceThreshold: 0.1,
};
const first = evaluateProcPlantResourceGrowth(nodes, options);
const reordered = evaluateProcPlantResourceGrowth([...nodes].reverse(), options);
assert.deepEqual(first, reordered, "allocation must not depend on input order");
assert.equal(first.version, PROCPLANT_RESOURCE_GROWTH_CONTRACT_VERSION);
assert.deepEqual(first.nodes.map((node) => node.id), ["lateral-shade", "lateral-sun", "leader", "root"]);

const byId = new Map(first.nodes.map((node) => [node.id, node]));
assert.equal(byId.get("lateral-sun")!.decision, "activate");
assert.equal(byId.get("lateral-shade")!.decision, "dormant");
assert.equal(byId.get("leader")!.decision, "grow");
assert.ok(byId.get("lateral-sun")!.growthResource > byId.get("lateral-shade")!.growthResource);
assert.ok(byId.get("lateral-sun")!.apicalSuppression > 0);
assert.equal(byId.get("leader")!.apicalSuppression, 0);

const accounted = first.maintenanceResource + first.growthResource + first.reserveResource;
assert.ok(Math.abs(accounted - first.grossResource) < 1e-10, "resource accounting must be conservative");
assert.ok(first.nodes.every((node) => Object.values(node.lightDirection).every(Number.isFinite)));

const competitionNodes = nodes.map((node) => ({
  ...node,
  active: true,
  photosyntheticArea: 0,
  maintenanceDemand: 0,
  growthDemand: 10,
}));
const withoutDominance = evaluateProcPlantResourceGrowth(competitionNodes, {
  initialResource: 1,
  reserveFraction: 0,
  apicalDominance: 0,
});
const withDominance = evaluateProcPlantResourceGrowth(competitionNodes, {
  initialResource: 1,
  reserveFraction: 0,
  apicalDominance: 1,
});
const allocated = (result: typeof withDominance, id: string) => result.nodes.find((node) => node.id === id)!.growthResource;
assert.ok(allocated(withDominance, "leader") > allocated(withoutDominance, "leader"));
assert.ok(allocated(withDominance, "lateral-sun") < allocated(withoutDominance, "lateral-sun"));

const deficit = evaluateProcPlantResourceGrowth(nodes, {
  initialResource: 0,
  lightUseEfficiency: 0,
  maintenanceSurvivalFraction: 0.5,
});
assert.ok(deficit.nodes.every((node) => node.decision === "resource-deficit"));

assert.throws(() => summarizeProcPlantLight([probe(Number.NaN)]), /irradiance/);
assert.throws(() => summarizeProcPlantLight([probe(0.5, { x: 0, y: 0, z: 0 })]), /non-zero/);
assert.throws(() => evaluateProcPlantResourceGrowth(nodes, { reserveFraction: Number.POSITIVE_INFINITY }), /reserveFraction/);
assert.throws(() => evaluateProcPlantResourceGrowth([
  { ...nodes[0]!, id: "a", parentId: "b" },
  { ...nodes[1]!, id: "b", parentId: "a" },
]), /exactly one root|cycle/);

console.log("procplant resource-growth tests passed");
