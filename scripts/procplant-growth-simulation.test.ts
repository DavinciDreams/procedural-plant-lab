import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createProcPlantGrowthSimulationState,
  deserializeProcPlantGrowthSimulationState,
  serializeProcPlantGrowthSimulationState,
  serializeProcPlantGrowthSimulationStepResult,
  stepProcPlantGrowthSimulation,
  type ProcPlantGrowthSimulationLightContext,
} from "../src/procplant-growth-simulation";
import type { ProcPlantAttachmentAnchor, ProcPlantGraph, ProcPlantOrgan, ProcPlantSegmentRecord, ProcPlantStemNode } from "../src/procplants";

const points = [[0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 2, 0], [-1, 1.5, 0]] as const;
const stems: ProcPlantStemNode[] = points.map(([x, y, z], index) => ({
  position: new THREE.Vector3(x, y, z),
  direction: new THREE.Vector3(0, 1, 0),
  radius: index === 0 ? 0.14 : 0.1,
  depth: 0,
  t: index / 4,
  index,
}));
const records: ProcPlantSegmentRecord[] = [
  { id: "trunk", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 1 },
  { id: "leader", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 2, depth: 0, axialStart: 1, axialEnd: 2 },
  { id: "dormant", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 3, depth: 1, axialStart: 1, axialEnd: 2 },
  { id: "shade", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 4, depth: 1, axialStart: 1, axialEnd: 2 },
];
const organs: ProcPlantOrgan[] = [
  { kind: "leaf", position: new THREE.Vector3(), direction: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0), scale: 1, t: 1 },
];
const leaf = (id: string, parentSegmentId: string): ProcPlantAttachmentAnchor => ({
  id,
  parentSegmentId,
  axialT: 1,
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 0, 1),
  kind: "leaf",
  depth: 0,
  sway: 0,
  organIndex: 0,
});
const graph: ProcPlantGraph = {
  stems,
  segments: [[0, 1], [1, 2], [1, 3], [1, 4]],
  organs,
  segmentRecords: [records[2]!, records[0]!, records[3]!, records[1]!],
  attachments: [leaf("leaf:leader", "leader"), leaf("leaf:trunk", "trunk")],
};
const graphSnapshot = graph.segmentRecords.map((record) => ({ ...record }));

let state = createProcPlantGrowthSimulationState(graph, {
  initialReserveResource: 0.3,
  initiallyDormantSegmentIds: ["dormant"],
});
assert.deepEqual(state.segments.map((segment) => segment.segmentId), ["dormant", "leader", "shade", "trunk"]);
assert.equal(state.segments.find((segment) => segment.segmentId === "dormant")!.active, false);
const serialized = serializeProcPlantGrowthSimulationState({ ...state, segments: [...state.segments].reverse() });
assert.deepEqual(deserializeProcPlantGrowthSimulationState(serialized), state, "serialization must canonicalize stable segment order");

const contexts: Array<Pick<ProcPlantGrowthSimulationLightContext, "segmentId" | "step" | "active">> = [];
const sampleLight = (context: Readonly<ProcPlantGrowthSimulationLightContext>) => {
  contexts.push({ segmentId: context.segmentId, step: context.step, active: context.active });
  const irradiance = context.segmentId === "shade" ? 0.02 : context.segmentId === "dormant" ? 0.9 : 0.8;
  return [{ direction: { x: 0.1, y: 1, z: 0 }, irradiance }];
};
const stepOptions = {
  resourceInput: 0.1,
  activationConfirmationSteps: 2,
  selfPruneConfirmationSteps: 2,
  adapter: {
    maintenanceCostPerVolume: 1,
    growthDemandPerVolume: 100,
    selfPruneLightThreshold: 0.1,
    selfPruneVigorThreshold: 0.3,
    resourceGrowth: {
      reserveFraction: 0.2,
      apicalDominance: 0.4,
      activationResourceThreshold: 0.001,
      minimumActivationLight: 0.2,
    },
  },
};

const first = stepProcPlantGrowthSimulation(graph, state, sampleLight, stepOptions);
const repeatedFirst = stepProcPlantGrowthSimulation(graph, state, () => [{
  direction: { x: 0.1, y: 1, z: 0 },
  irradiance: 0.8,
}], stepOptions);
const repeatedFirstAgain = stepProcPlantGrowthSimulation(graph, state, () => [{
  direction: { x: 0.1, y: 1, z: 0 },
  irradiance: 0.8,
}], stepOptions);
assert.equal(
  serializeProcPlantGrowthSimulationStepResult(repeatedFirst),
  serializeProcPlantGrowthSimulationStepResult({ ...repeatedFirstAgain, segments: [...repeatedFirstAgain.segments].reverse() }),
  "step results must serialize deterministically",
);
assert.equal(first.step, 0);
assert.equal(first.previousReserveResource, 0.3);
assert.equal(first.segments.find((segment) => segment.segmentId === "dormant")!.action, "hold");
assert.equal(first.segments.find((segment) => segment.segmentId === "dormant")!.activationEvidenceSteps, 1);
assert.equal(first.segments.find((segment) => segment.segmentId === "shade")!.action, "self-prune-candidate");
assert.equal(first.segments.find((segment) => segment.segmentId === "shade")!.selfPruneConfirmed, false);
state = first.state;

const second = stepProcPlantGrowthSimulation(graph, state, sampleLight, stepOptions);
assert.equal(second.previousReserveResource, first.reserveResource, "reserve must feed the next timestep");
assert.equal(second.segments.find((segment) => segment.segmentId === "dormant")!.action, "activate");
assert.equal(second.segments.find((segment) => segment.segmentId === "dormant")!.activeAfter, true);
assert.equal(second.segments.find((segment) => segment.segmentId === "shade")!.action, "self-prune-confirmed");
assert.equal(second.segments.find((segment) => segment.segmentId === "shade")!.selfPruneConfirmed, true);
state = second.state;

const third = stepProcPlantGrowthSimulation(graph, state, sampleLight, stepOptions);
assert.equal(third.step, 2);
assert.ok(third.segments.some((segment) => segment.action === "grow"));
assert.ok(third.segments.find((segment) => segment.segmentId === "dormant")!.accumulatedGrowth > 0,
  "activated segments can commit growth on later timesteps");
assert.equal(third.segments.find((segment) => segment.segmentId === "shade")!.action, "self-prune-confirmed",
  "confirmed prune advice must remain latched");
assert.ok(third.limitations.some((text) => text.includes("not calibrated")));
assert.deepEqual(graph.segmentRecords.map((record) => ({ ...record })), graphSnapshot, "simulation must not mutate the source graph");
assert.ok(contexts.every((context, index) => context.step === Math.floor(index / 4)), "light callback must receive the current step");

const changedGraph: ProcPlantGraph = {
  ...graph,
  segmentRecords: graph.segmentRecords.filter((record) => record.id !== "shade"),
};
assert.throws(() => stepProcPlantGrowthSimulation(changedGraph, third.state, sampleLight), /does not match/);
assert.throws(() => deserializeProcPlantGrowthSimulationState("{broken"), /valid JSON/);
assert.throws(() => deserializeProcPlantGrowthSimulationState('{"version":1}'), /graphSignature|segments/);
assert.throws(() => createProcPlantGrowthSimulationState(graph, { initiallyDormantSegmentIds: ["missing"] }), /missing segment/);

console.log("procplant growth-simulation tests passed");
