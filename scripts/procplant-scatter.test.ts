import assert from "node:assert/strict";
import { makeEcologyBiomeMix } from "../src/biome-mix";
import { createProcPlantScatterPlan } from "../src/procplant-scatter";

const mix = makeEcologyBiomeMix("temperate-rain-forest", 612072);
const options = {
  bounds: { minX: -10, maxX: 10, minZ: -8, maxZ: 8 },
  maxPlacements: 180,
  maxCandidates: 4_000,
  densityAt: ({ normalizedX }: { normalizedX: number }) => normalizedX < 0.5 ? 0 : 1,
  heightAt: ({ x, z }: { x: number; z: number }) => Math.sin(x * 0.1) + Math.cos(z * 0.1),
};
const first = createProcPlantScatterPlan(mix, options);
const second = createProcPlantScatterPlan(mix, options);
assert.deepEqual(first, second, "scatter plan must be deterministic");
assert.equal(first.contract, "procplants.ecosystem-scatter");
assert.ok(first.placements.length > 20);
assert.ok(first.placements.every((placement) => placement.position[0] >= 0));
assert.ok(first.placements.every((placement) => Number.isFinite(placement.position[1])));
assert.equal(Object.values(first.countsByEntry).reduce((sum, value) => sum + value, 0), first.placements.length);
assert.deepEqual(first.placements.map((placement) => placement.index), first.placements.map((_, index) => index));

for (let a = 0; a < first.placements.length; a++) {
  for (let b = a + 1; b < first.placements.length; b++) {
    const left = first.placements[a]!;
    const right = first.placements[b]!;
    const distance = Math.hypot(left.position[0] - right.position[0], left.position[2] - right.position[2]);
    assert.ok(distance + 1e-9 >= Math.sqrt(left.spacing * right.spacing));
  }
}

const excluded = createProcPlantScatterPlan(mix, {
  bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
  maxPlacements: 10,
  maxCandidates: 20,
  densityAt: () => 0,
});
assert.equal(excluded.placements.length, 0);
assert.equal(excluded.rejectedByDensity, 20);
assert.throws(() => createProcPlantScatterPlan(mix, {
  bounds: { minX: 1, maxX: 1, minZ: 0, maxZ: 2 },
}), /positive area/);

console.log("procplant ecosystem scatter tests passed");
