import assert from "node:assert/strict";
import * as THREE from "three";
import {
  PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION,
  PROCPLANT_GROWTH_CALIBRATION_LIMITATIONS,
  PROCPLANT_GROWTH_CALIBRATION_PRESETS,
  createProcPlantCalibratedGraphGrowthBridge,
  evaluateProcPlantGrowthCalibration,
  resolveProcPlantGrowthCalibration,
  stepProcPlantCalibratedGrowthSimulation,
  type ProcPlantGrowthCalibrationV1,
} from "../src/procplant-growth-calibration";
import {
  createProcPlantGrowthSimulationState,
  serializeProcPlantGrowthSimulationStepResult,
  stepProcPlantGrowthSimulation,
} from "../src/procplant-growth-simulation";
import type { ProcPlantGraph, ProcPlantStemNode } from "../src/procplants";

assert.equal(Object.keys(PROCPLANT_GROWTH_CALIBRATION_PRESETS).length, 4);
for (const record of Object.values(PROCPLANT_GROWTH_CALIBRATION_PRESETS)) {
  assert.equal(record.version, PROCPLANT_GROWTH_CALIBRATION_CONTRACT_VERSION);
  assert.match(record.provenance.url, /^https:\/\/lpdaac\.usgs\.gov\//);
}

const dbf = resolveProcPlantGrowthCalibration("vnp17-deciduous-broadleaf-forest");
assert.equal(dbf.maximumLightUseEfficiencyKgCarbonPerMjApar, 0.001593);
assert.equal(dbf.specificLeafAreaSquareMetersPerKgLeafCarbon, 37.22949);
dbf.label = "detached";
assert.equal(PROCPLANT_GROWTH_CALIBRATION_PRESETS["vnp17-deciduous-broadleaf-forest"].label, "Deciduous broadleaf forest");

const full = evaluateProcPlantGrowthCalibration("vnp17-deciduous-broadleaf-forest", {
  incidentParMjPerSquareMeterPerDay: 20,
  minimumDailyTemperatureCelsius: 21.4,
  daylightVaporPressureDeficitPascal: 650,
  timestepDays: 2,
});
assert.equal(full.temperatureScalar, 1);
assert.equal(full.vaporPressureDeficitScalar, 1);
assert.equal(full.productionKgCarbonPerSquareMeterAtFullExposure, 0.001593 * 20 * 2);

const midpoint = evaluateProcPlantGrowthCalibration("vnp17-deciduous-broadleaf-forest", {
  incidentParMjPerSquareMeterPerDay: 20,
  minimumDailyTemperatureCelsius: (-6 + 21.4) / 2,
  daylightVaporPressureDeficitPascal: (650 + 3434) / 2,
});
assert.ok(Math.abs(midpoint.temperatureScalar - 0.5) < 1e-12);
assert.ok(Math.abs(midpoint.vaporPressureDeficitScalar - 0.5) < 1e-12);
assert.ok(Math.abs(midpoint.environmentalScalar - 0.25) < 1e-12);

for (const climate of [
  { incidentParMjPerSquareMeterPerDay: 20, minimumDailyTemperatureCelsius: -6, daylightVaporPressureDeficitPascal: 650 },
  { incidentParMjPerSquareMeterPerDay: 20, minimumDailyTemperatureCelsius: 21.4, daylightVaporPressureDeficitPascal: 3434 },
]) {
  assert.equal(evaluateProcPlantGrowthCalibration("vnp17-deciduous-broadleaf-forest", climate).environmentalScalar, 0);
}

const climate = {
  incidentParMjPerSquareMeterPerDay: 18,
  minimumDailyTemperatureCelsius: 10,
  daylightVaporPressureDeficitPascal: 1_100,
  timestepDays: 1,
};
const geometry = {
  metersPerSceneUnit: 0.5,
  projectedLeafAreaFactor: 0.8,
  unresolvedFoliageAreaSquareMeters: 0.002,
};
const carbonBudget = {
  maintenanceCarbonKgPerCubicMeterPerDay: 0.25,
  potentialGrowthCarbonKgPerCubicMeterPerDay: 1.5,
  minimumGrowthDemandKgCarbon: 0.0001,
  reserveFraction: 0.2,
  growthResourceThresholdKgCarbon: 0,
};
const bridge = createProcPlantCalibratedGraphGrowthBridge(
  "vnp17-deciduous-broadleaf-forest", climate, geometry, carbonBudget,
);
assert.equal(bridge.adapter.leafAreaScale, 0.2);
assert.equal(bridge.adapter.maintenanceCostPerVolume, 0.03125);
assert.equal(bridge.adapter.growthDemandPerVolume, 0.1875);
assert.equal(
  bridge.adapter.resourceGrowth!.lightUseEfficiency,
  bridge.calibration.productionKgCarbonPerSquareMeterAtFullExposure,
);
assert.equal(bridge.units.resource, "kg-carbon");
assert.equal(bridge.limitations, PROCPLANT_GROWTH_CALIBRATION_LIMITATIONS);

const points = [[0, 0, 0], [0, 1, 0], [0.5, 1.7, 0]] as const;
const stems: ProcPlantStemNode[] = points.map(([x, y, z], index) => ({
  position: new THREE.Vector3(x, y, z),
  direction: new THREE.Vector3(0, 1, 0),
  radius: 0.08,
  depth: index === 2 ? 1 : 0,
  t: index / 2,
  index,
}));
const graph: ProcPlantGraph = {
  stems,
  segments: [[0, 1], [1, 2]],
  organs: [{
    kind: "leaf",
    position: new THREE.Vector3(0.5, 1.7, 0),
    direction: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),
    scale: 0.3,
    t: 1,
  }],
  segmentRecords: [
    { id: "trunk", parentSegmentId: null, startNodeIndex: 0, endNodeIndex: 1, depth: 0, axialStart: 0, axialEnd: 1 },
    { id: "branch", parentSegmentId: "trunk", startNodeIndex: 1, endNodeIndex: 2, depth: 1, axialStart: 1, axialEnd: 1.86 },
  ],
  attachments: [{
    id: "leaf:branch",
    parentSegmentId: "branch",
    axialT: 1,
    position: new THREE.Vector3(0.5, 1.7, 0),
    tangent: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
    kind: "leaf",
    depth: 1,
    sway: 0,
    organIndex: 0,
  }],
};
const state = createProcPlantGrowthSimulationState(graph, { initialReserveResource: 0.01 });
const sampleLight = () => [{ direction: { x: 0, y: 1, z: 0 }, irradiance: 0.75 }];
const calibrated = stepProcPlantCalibratedGrowthSimulation(graph, state, sampleLight, {
  calibration: "vnp17-deciduous-broadleaf-forest",
  climate,
  geometry,
  carbonBudget,
  resourceInputKgCarbon: 0.002,
});
const manual = stepProcPlantGrowthSimulation(graph, state, sampleLight, {
  adapter: bridge.adapter,
  resourceInput: 0.002,
});
assert.equal(
  serializeProcPlantGrowthSimulationStepResult(calibrated.simulation),
  serializeProcPlantGrowthSimulationStepResult(manual),
  "the calibrated entry point must be an exact bridge into the existing simulator",
);
assert.equal(calibrated.calibration.calibrationId, "vnp17-deciduous-broadleaf-forest");
assert.ok(calibrated.simulation.grossResource > calibrated.simulation.previousReserveResource);
assert.ok(calibrated.limitations.some((line) => line.includes("not physiologically validated")));

const invalid = { ...PROCPLANT_GROWTH_CALIBRATION_PRESETS["vnp17-grassland"] } as ProcPlantGrowthCalibrationV1;
invalid.vaporPressureDeficitZeroEfficiencyPascal = invalid.vaporPressureDeficitFullEfficiencyPascal;
assert.throws(() => resolveProcPlantGrowthCalibration(invalid), /must exceed/);
assert.throws(() => evaluateProcPlantGrowthCalibration("vnp17-grassland", { ...climate, timestepDays: 32 }), /timestepDays/);
assert.throws(() => createProcPlantCalibratedGraphGrowthBridge(
  "vnp17-grassland", climate, geometry,
  { ...carbonBudget, maintenanceCarbonKgPerCubicMeterPerDay: Number.NaN },
), /maintenanceCarbon/);

console.log("procplant growth-calibration tests passed");
