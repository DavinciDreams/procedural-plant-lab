import assert from "node:assert/strict";
import * as THREE from "three";
import {
  expandProcPlantLSystem,
  parseProcPlantLSystemTokens,
  runProcPlantLSystem,
  type ProcPlantLSystemProgram,
} from "../src/procplant-lsystem";

const parsed = parseProcPlantLSystemTokens("F(0.5,0.9)[+(0.4)F]L");
assert.deepEqual(parsed.map((token) => token.symbol), ["F", "[", "+", "F", "]", "L"]);
assert.deepEqual(parsed[0]!.parameters, [0.5, 0.9]);

const program: ProcPlantLSystemProgram = {
  contract: "procplants.lsystem",
  version: 1,
  axiom: parseProcPlantLSystemTokens("X"),
  rules: [
    {
      predecessor: "X",
      successors: [
        { weight: 3, tokens: parseProcPlantLSystemTokens("F[+X][-X]L") },
        { weight: 1, tokens: parseProcPlantLSystemTokens("F[&X]L") },
      ],
    },
  ],
  iterations: 4,
  seed: 424242,
};
const expandedA = expandProcPlantLSystem(program);
const expandedB = expandProcPlantLSystem(program);
assert.deepEqual(expandedA, expandedB);
const resultA = runProcPlantLSystem(program, { step: 0.4, angle: 0.48, radius: 0.09, tropismStrength: 0.03 });
const resultB = runProcPlantLSystem(program, { step: 0.4, angle: 0.48, radius: 0.09, tropismStrength: 0.03 });
assert.deepEqual(resultA, resultB);
assert.ok(resultA.segments.length > 8);
assert.ok(resultA.attachments.length > 2);
assert.ok(resultA.segments.some((segment) => segment.branchOrder >= 2));
for (const attachment of resultA.attachments) {
  const tangent = new THREE.Vector3().fromArray(attachment.tangent);
  const right = new THREE.Vector3().fromArray(attachment.right);
  const up = new THREE.Vector3().fromArray(attachment.up);
  assert.ok(Math.abs(tangent.dot(right)) < 1e-6);
  assert.ok(new THREE.Vector3().crossVectors(tangent, right).dot(up) > 0.999);
}

assert.throws(() => runProcPlantLSystem({ ...program, iterations: 17 }), /iterations/);
assert.throws(
  () => runProcPlantLSystem({ ...program, iterations: 8, maxTokens: 12 }),
  /exceeds/,
);
assert.throws(
  () => runProcPlantLSystem({ ...program, axiom: parseProcPlantLSystemTokens("]") }),
  /underflow/,
);

console.log("procplant L-system tests passed");
