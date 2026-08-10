import assert from "node:assert/strict";
import * as THREE from "three";
import {
  addProcPlantHierarchicalWindAttributes,
  addProcPlantSwayAttribute,
  createProcPlantWindShadowMaterials,
  createProcPlantWindUniforms,
  installProcPlantWindShader,
  PROCPLANT_WIND_ANCHOR_ATTRIBUTE,
  PROCPLANT_WIND_BAND_ATTRIBUTE,
  PROCPLANT_WIND_BAND_BRANCH,
  PROCPLANT_WIND_BAND_LEAF,
  PROCPLANT_WIND_BAND_TRUNK,
} from "../src/procplant-wind";

const positions = new Float32Array([
  -0.2, 0, 0, 0.2, 0, 0, 0, 0.8, 0,
  0.5, 0.5, 0, 0.8, 0.5, 0, 0.65, 1.1, 0,
  0.6, 1.05, 0, 0.9, 1.05, 0, 0.75, 1.7, 0,
]);
const sourceSnapshot = positions.slice();
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("procplantSway", new THREE.Float32BufferAttribute([
  0, 0, 0.2,
  0.2, 0.2, 0.8,
  0.7, 0.7, 1,
], 1));
geometry.setAttribute("procplantTintable", new THREE.Uint8BufferAttribute([
  0, 0, 0,
  0, 0, 0,
  1, 1, 1,
], 1));
geometry.setAttribute("procplantBranchOrder", new THREE.Float32BufferAttribute([
  0, 0, 0,
  1, 1, 1,
  0, 0, 0,
], 1));
geometry.setAttribute("procplantBranchU", new THREE.Float32BufferAttribute([
  0, 0, 1,
  0, 0, 1,
  0, 0, 1,
], 1));
geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);

const audit = addProcPlantHierarchicalWindAttributes(geometry);
assert.deepEqual(Array.from(positions), Array.from(sourceSnapshot), "render-only attributes must not mutate canonical positions");
assert.equal(audit.vertexCount, 9);
assert.equal(audit.trunkVertices, 3);
assert.equal(audit.branchVertices, 3);
assert.equal(audit.leafVertices, 3);
assert.equal(audit.trunkComponents, 1);
assert.equal(audit.branchComponents, 1);
assert.equal(audit.leafComponents, 1);
assert.equal(audit.branchSource, "procplantBranchOrder");
assert.equal(audit.leafSource, "procplantTintable");
assert.equal(audit.attributeBytes, 9 * 13);
const band = geometry.getAttribute(PROCPLANT_WIND_BAND_ATTRIBUTE);
assert.deepEqual(Array.from(band.array), [
  PROCPLANT_WIND_BAND_TRUNK, PROCPLANT_WIND_BAND_TRUNK, PROCPLANT_WIND_BAND_TRUNK,
  PROCPLANT_WIND_BAND_BRANCH, PROCPLANT_WIND_BAND_BRANCH, PROCPLANT_WIND_BAND_BRANCH,
  PROCPLANT_WIND_BAND_LEAF, PROCPLANT_WIND_BAND_LEAF, PROCPLANT_WIND_BAND_LEAF,
]);
const anchor = geometry.getAttribute(PROCPLANT_WIND_ANCHOR_ATTRIBUTE);
for (const vertices of [[0, 1, 2], [3, 4, 5], [6, 7, 8]]) {
  const first = vertices[0]!;
  for (const vertex of vertices.slice(1)) {
    assert.deepEqual(
      [anchor.getX(vertex), anchor.getY(vertex), anchor.getZ(vertex)],
      [anchor.getX(first), anchor.getY(first), anchor.getZ(first)],
      "one anatomical component must share one stable anchor",
    );
  }
}
assert.deepEqual(addProcPlantHierarchicalWindAttributes(geometry), audit, "attribute derivation must be idempotent");
console.log("ok 1 - existing surface and branch semantics derive deterministic render-only hierarchy attributes");

const leafPrototype = new THREE.PlaneGeometry(0.4, 1.2, 1, 3);
leafPrototype.translate(0, 0.6, 0);
addProcPlantSwayAttribute(leafPrototype);
const leafAudit = addProcPlantHierarchicalWindAttributes(leafPrototype, { fallbackBand: PROCPLANT_WIND_BAND_LEAF });
assert.equal(leafAudit.trunkVertices, 0);
assert.equal(leafAudit.branchVertices, 0);
assert.equal(leafAudit.leafVertices, leafPrototype.getAttribute("position").count);
assert.equal(leafAudit.leafSource, "fallback");
const leafAnchor = leafPrototype.getAttribute(PROCPLANT_WIND_ANCHOR_ATTRIBUTE);
for (let vertex = 0; vertex < leafAnchor.count; vertex++) {
  assert.ok(Math.abs(leafAnchor.getY(vertex)) < 1e-6, "organ-only prototype must anchor at its local base");
}
console.log("ok 2 - an explicit organ-only fallback produces local attachment rotation without inferred plant semantics");

const uniforms = createProcPlantWindUniforms(0.25);
const legacy = installProcPlantWindShader(new THREE.MeshStandardMaterial(), uniforms);
const hierarchical = installProcPlantWindShader(new THREE.MeshStandardMaterial(), uniforms, { hierarchical: true });
assert.equal(legacy.customProgramCacheKey(), "procplant-wind-v1");
assert.equal(hierarchical.customProgramCacheKey(), "procplant-wind-v2-hierarchical");
const makeShader = () => ({
  uniforms: {} as Record<string, { value: unknown }>,
  vertexShader: "#include <common>\nvoid main(){\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}",
  fragmentShader: "void main(){}",
}) as Parameters<THREE.MeshStandardMaterial["onBeforeCompile"]>[0];
const legacyShader = makeShader();
legacy.onBeforeCompile(legacyShader, {} as THREE.WebGLRenderer);
assert.doesNotMatch(legacyShader.vertexShader, /procplantWindAnchor/);
assert.match(legacyShader.vertexShader, /procplantWindWave/);
const hierarchicalShader = makeShader();
hierarchical.onBeforeCompile(hierarchicalShader, {} as THREE.WebGLRenderer);
assert.match(hierarchicalShader.vertexShader, /attribute vec3 procplantWindAnchor/);
assert.match(hierarchicalShader.vertexShader, /procplantBranchAngle/);
assert.match(hierarchicalShader.vertexShader, /procplantLeafRippleDirection/);
assert.match(hierarchicalShader.vertexShader, /procplantBranchNormal/);
assert.strictEqual(hierarchicalShader.uniforms.procplantWindTime, uniforms.time);
assert.strictEqual(hierarchicalShader.uniforms.procplantWindStrength, uniforms.strength);

const shadows = createProcPlantWindShadowMaterials(uniforms, { hierarchical: true });
assert.equal(shadows.depth.customProgramCacheKey(), "procplant-wind-v2-hierarchical");
assert.equal(shadows.distance.customProgramCacheKey(), "procplant-wind-v2-hierarchical");
for (const shadow of [shadows.depth, shadows.distance]) {
  const shader = makeShader();
  shadow.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  assert.match(shader.vertexShader, /procplantLeafRippleDirection/);
  assert.strictEqual(shader.uniforms.procplantWindTime, uniforms.time);
  assert.strictEqual(shader.uniforms.procplantWindStrength, uniforms.strength);
  shadow.dispose();
}
console.log("ok 3 - hierarchical color, depth, and distance shaders share motion uniforms while legacy remains stable");

const partial = new THREE.BufferGeometry();
partial.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
partial.setIndex([0, 1, 2]);
partial.setAttribute(PROCPLANT_WIND_BAND_ATTRIBUTE, new THREE.Uint8BufferAttribute([0, 0, 0], 1));
assert.throws(() => addProcPlantHierarchicalWindAttributes(partial), /installed together/);
const malformed = new THREE.BufferGeometry();
malformed.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
malformed.setAttribute("procplantTintable", new THREE.Uint8BufferAttribute([1], 1));
malformed.setIndex([0, 1, 2]);
assert.throws(() => addProcPlantHierarchicalWindAttributes(malformed), /one value per vertex/);
assert.throws(
  () => addProcPlantHierarchicalWindAttributes(new THREE.BufferGeometry()),
  /requires finite vec3 positions/,
);
console.log("ok 4 - absent or partial hierarchy semantics fail closed instead of guessing corrupt motion data");

geometry.dispose();
leafPrototype.dispose();
legacy.dispose();
hierarchical.dispose();
partial.dispose();
malformed.dispose();

