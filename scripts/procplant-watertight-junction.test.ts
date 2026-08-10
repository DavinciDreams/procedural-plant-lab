import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  auditProcPlantMeshTopology,
  createProcPlantWatertightJunctionGeometry,
  PROCPLANT_JUNCTION_CHAIN_ATTRIBUTE,
  type ProcPlantWatertightJunctionChain,
} from "../src/procplant-watertight-junction";
import {
  createProcPlantSweptTubeGeometry,
  PROCPLANT_BRANCH_AGE_ATTRIBUTE,
  PROCPLANT_BRANCH_ORDER_ATTRIBUTE,
  PROCPLANT_BRANCH_SWAY_ATTRIBUTE,
  PROCPLANT_BRANCH_U_ATTRIBUTE,
  PROCPLANT_BRANCH_V_ATTRIBUTE,
} from "../src/procplant-tube";

const junction = (
  angleDegrees = 55,
  childRadius = 0.18,
  parentRadius = 0.32,
): ProcPlantWatertightJunctionChain[] => {
  const radians = THREE.MathUtils.degToRad(angleDegrees);
  return [
    {
      id: "parent",
      role: "parent",
      samples: [
        { position: new THREE.Vector3(0, -0.72, 0), radius: 0.38, age: 0.2, branchOrder: 0 },
        { position: new THREE.Vector3(0, 0, 0), radius: parentRadius, age: 0.55, branchOrder: 0 },
      ],
    },
    {
      id: "child:left",
      role: "child",
      samples: [
        { position: new THREE.Vector3(0, 0, 0), radius: childRadius, age: 0.55, branchOrder: 1 },
        { position: new THREE.Vector3(-Math.sin(radians) * 0.62, Math.cos(radians) * 0.62, 0), radius: childRadius * 0.55, age: 1, branchOrder: 1 },
      ],
    },
    {
      id: "child:right",
      role: "child",
      samples: [
        { position: new THREE.Vector3(0, 0, 0), radius: childRadius, age: 0.55, branchOrder: 1 },
        { position: new THREE.Vector3(Math.sin(radians) * 0.62, Math.cos(radians) * 0.62, 0), radius: childRadius * 0.55, age: 1, branchOrder: 1 },
      ],
    },
  ];
};

const legacy = createProcPlantSweptTubeGeometry(junction()[0]!.samples, { radialSegments: 5, capStart: true });
const legacySnapshot = Array.from(legacy.getAttribute("position").array);
const sourceJunction = junction();
const sourceSnapshot = sourceJunction.map((chain) => chain.samples.map((sample) => ({
  position: sample.position.toArray(),
  radius: sample.radius,
  age: sample.age,
  branchOrder: sample.branchOrder,
})));
const disabled = createProcPlantWatertightJunctionGeometry(sourceJunction, {}, legacy);
assert.equal(disabled.geometry, legacy, "default/disabled junction mode must reuse exact legacy geometry");
assert.equal(disabled.audit.mode, "disabled");
assert.equal(disabled.audit.sourceGeometryReused, true);
assert.deepEqual(Array.from(legacy.getAttribute("position").array), legacySnapshot, "disabled mode must not mutate source geometry");

const first = createProcPlantWatertightJunctionGeometry(junction(), {
  enabled: true,
  cellsPerMinimumRadius: 1.5,
  maxTopologyIntersectionTests: 2_000_000,
}, legacy);
assert.equal(first.audit.mode, "watertight", JSON.stringify(first.audit, null, 2));
assert.notEqual(first.geometry, legacy);
assert.ok(first.audit.topology?.closedTwoManifold);
assert.equal(first.audit.topology?.boundaryEdges, 0);
assert.equal(first.audit.topology?.nonManifoldEdges, 0);
assert.equal(first.audit.topology?.degenerateTriangles, 0);
assert.equal(first.audit.topology?.selfIntersections, 0);
assert.equal(first.audit.topology?.intersectionCheckComplete, true);
assert.ok(first.audit.triangles > 0 && first.audit.triangles < 30_000);
assert.deepEqual(Array.from(legacy.getAttribute("position").array), legacySnapshot, "union must not mutate source geometry");
assert.deepEqual(sourceJunction.map((chain) => chain.samples.map((sample) => ({
  position: sample.position.toArray(),
  radius: sample.radius,
  age: sample.age,
  branchOrder: sample.branchOrder,
}))), sourceSnapshot, "union must not mutate chain samples");
for (const name of [
  "normal", "uv", "color", PROCPLANT_BRANCH_U_ATTRIBUTE, PROCPLANT_BRANCH_V_ATTRIBUTE,
  PROCPLANT_BRANCH_ORDER_ATTRIBUTE, PROCPLANT_BRANCH_AGE_ATTRIBUTE,
  PROCPLANT_BRANCH_SWAY_ATTRIBUTE, PROCPLANT_JUNCTION_CHAIN_ATTRIBUTE,
]) assert.ok(first.geometry!.hasAttribute(name), `missing junction attribute ${name}`);

const hashGeometry = (geometry: THREE.BufferGeometry) => {
  const hash = createHash("sha256");
  hash.update(Buffer.from(geometry.index!.array.buffer));
  for (const name of [
    "position", "normal", "uv", "color", PROCPLANT_BRANCH_U_ATTRIBUTE,
    PROCPLANT_BRANCH_V_ATTRIBUTE, PROCPLANT_BRANCH_ORDER_ATTRIBUTE,
    PROCPLANT_BRANCH_AGE_ATTRIBUTE, PROCPLANT_BRANCH_SWAY_ATTRIBUTE,
    PROCPLANT_JUNCTION_CHAIN_ATTRIBUTE,
  ]) hash.update(Buffer.from(geometry.getAttribute(name).array.buffer));
  return hash.digest("hex");
};
const repeated = createProcPlantWatertightJunctionGeometry(junction(), {
  enabled: true,
  cellsPerMinimumRadius: 1.5,
  maxTopologyIntersectionTests: 2_000_000,
});
assert.equal(repeated.audit.mode, "watertight");
const golden = hashGeometry(first.geometry!);
assert.equal(golden, hashGeometry(repeated.geometry!), "junction output must be byte-deterministic");
assert.equal(golden, "daaf7bed8c055a8e850e729f9cdc849da2725a43ed2b7083a51da46d3bc924d0", "bounded junction regression golden changed");

const sweepHashes = new Set<string>();
let acceptedSweepCases = 0;
let rejectedSweepCases = 0;
for (const angle of [35, 55, 75]) for (const ratio of [0.32, 0.48, 0.7]) {
  const sweepInput = junction(angle, 0.32 * ratio);
  const sweepOptions = {
    enabled: true,
    cellsPerMinimumRadius: 1.25,
    maxTopologyIntersectionTests: 2_000_000,
  } as const;
  const swept = createProcPlantWatertightJunctionGeometry(sweepInput, sweepOptions);
  const sweptAgain = createProcPlantWatertightJunctionGeometry(sweepInput, sweepOptions);
  assert.equal(swept.audit.mode, sweptAgain.audit.mode, `angle ${angle}, ratio ${ratio} acceptance must be deterministic`);
  assert.deepEqual(swept.audit.grid, sweptAgain.audit.grid);
  assert.equal(swept.audit.triangles, sweptAgain.audit.triangles);
  if (swept.audit.mode === "watertight") {
    acceptedSweepCases++;
    assert.ok(swept.audit.topology?.closedTwoManifold, `accepted angle ${angle}, ratio ${ratio} must be manifold`);
    assert.equal(hashGeometry(swept.geometry!), hashGeometry(sweptAgain.geometry!), "accepted sweep output must be deterministic");
    sweepHashes.add(hashGeometry(swept.geometry!));
    swept.geometry!.dispose();
    sweptAgain.geometry!.dispose();
  } else {
    rejectedSweepCases++;
    assert.equal(swept.geometry, null);
    assert.equal(swept.audit.diagnostics[0]?.code, "topology-validation-failed");
    assert.ok(swept.audit.topology && !swept.audit.topology.closedTwoManifold);
    assert.deepEqual(swept.audit.topology?.selfIntersectionPairs, sweptAgain.audit.topology?.selfIntersectionPairs);
  }
}
assert.ok(acceptedSweepCases > 0, "research sweep must retain at least one proven bounded vertical slice");
assert.ok(rejectedSweepCases > 0, "research sweep must retain evidence that general production union is not yet safe");
assert.equal(sweepHashes.size, acceptedSweepCases, "accepted sweep cases should produce distinct deterministic geometry");

const shallow = createProcPlantWatertightJunctionGeometry(junction(10), { enabled: true }, legacy);
assert.equal(shallow.geometry, legacy);
assert.equal(shallow.audit.mode, "fallback-collar");
assert.equal(shallow.audit.diagnostics[0]?.code, "unsupported-angle");
const oversizedGrid = createProcPlantWatertightJunctionGeometry(junction(), {
  enabled: true,
  cellsPerMinimumRadius: 8,
  maxGridCells: 10,
}, legacy);
assert.equal(oversizedGrid.geometry, legacy);
assert.equal(oversizedGrid.audit.diagnostics[0]?.code, "grid-cap-exceeded");

// The current independent-chain collar path is intentionally not a union: its
// uncapped hub rings remain boundary edges, which the prerequisite audit finds.
const parentTube = createProcPlantSweptTubeGeometry(junction()[0]!.samples, { radialSegments: 5, capStart: true, capEnd: false });
const childTube = createProcPlantSweptTubeGeometry(junction()[1]!.samples, { radialSegments: 5, capStart: false, capEnd: true });
const secondChildTube = createProcPlantSweptTubeGeometry(junction()[2]!.samples, { radialSegments: 5, capStart: false, capEnd: true });
const merge = (geometries: readonly THREE.BufferGeometry[]) => {
  const positions: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const geometry of geometries) {
    positions.push(...Array.from(geometry.getAttribute("position").array));
    indices.push(...Array.from(geometry.index!.array, (value) => Number(value) + offset));
    offset += geometry.getAttribute("position").count;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
};
const legacyPair = merge([parentTube, childTube, secondChildTube]);
const legacyAudit = auditProcPlantMeshTopology(legacyPair, { maxIntersectionTests: 100_000 });
assert.ok(legacyAudit.boundaryEdges >= 15, "independent tubes must expose open hub rings rather than pass as watertight");
assert.equal(legacyAudit.closedTwoManifold, false);
const legacyTriangles = legacyPair.index!.count / 3;
assert.ok(first.audit.triangles > legacyTriangles * 100, "implicit research candidate cost must remain explicit rather than displacing cheap collars silently");

console.log(JSON.stringify({
  golden,
  grid: first.audit.grid,
  vertices: first.geometry!.getAttribute("position").count,
  triangles: first.audit.triangles,
  legacyTriangles,
  legacyBoundaryEdges: legacyAudit.boundaryEdges,
  workItems: first.audit.workItems,
  acceptedSweepCases,
  rejectedSweepCases,
}, null, 2));
console.log("procplant watertight junction tests passed");

legacy.dispose();
first.geometry!.dispose();
repeated.geometry!.dispose();
parentTube.dispose();
childTube.dispose();
secondChildTube.dispose();
legacyPair.dispose();
