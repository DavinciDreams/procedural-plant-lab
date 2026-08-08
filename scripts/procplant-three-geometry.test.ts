import assert from "node:assert/strict";
import {
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";
import {
  createProcPlantThreeGeometry,
  PROCPLANT_THREE_AO_UV_ATTRIBUTE,
  PROCPLANT_THREE_GEOMETRY_CONTRACT,
  PROCPLANT_THREE_GEOMETRY_VERSION,
  PROCPLANT_THREE_SWAY_ATTRIBUTE,
  PROCPLANT_THREE_TINTABLE_ATTRIBUTE,
  PROCPLANT_THREE_UV0_ATTRIBUTE,
} from "../src/procplant-three-geometry";

const snapshotTemplate = (template: ProcPlantTemplate) => ({
  pos: template.pos.slice(),
  nrm: template.nrm.slice(),
  uv0: template.uv0.slice(),
  col: template.col.slice(),
  tintable: template.tintable.slice(),
  sway: template.sway.slice(),
  idx: template.idx.slice(),
});

const assertSourceUnchanged = (template: ProcPlantTemplate, snapshot: ReturnType<typeof snapshotTemplate>, label: string) => {
  for (const key of ["pos", "nrm", "uv0", "col", "tintable", "sway", "idx"] as const) {
    assert.deepEqual(template[key], snapshot[key], `${label}.${key} must not be mutated`);
  }
};

const assertGroups = (template: ProcPlantTemplate, result: ReturnType<typeof createProcPlantThreeGeometry>, label: string) => {
  const { geometry, partition } = result;
  assert.equal(geometry.groups.length, partition.rangeCount);
  let cursor = 0;
  for (let range = 0; range < partition.rangeCount; range++) {
    const group = geometry.groups[range]!;
    assert.equal(group.start, cursor, `${label} groups must be contiguous`);
    assert.equal(group.start, partition.rangeIndexStarts[range]);
    assert.equal(group.count, partition.rangeIndexCounts[range]);
    assert.equal(group.materialIndex, partition.rangeSurfaceIds[range]);
    cursor += group.count;
  }
  assert.equal(cursor, template.idx.length, `${label} groups must cover the exact index buffer`);
};

const assertTangents = (result: ReturnType<typeof createProcPlantThreeGeometry>, label: string) => {
  const normal = result.geometry.getAttribute("normal");
  const tangent = result.geometry.getAttribute("tangent");
  assert.ok(tangent, `${label} must have tangents`);
  assert.equal(tangent.itemSize, 4);
  assert.equal(tangent.count, normal.count);
  for (let vertex = 0; vertex < tangent.count; vertex++) {
    const tx = tangent.getX(vertex);
    const ty = tangent.getY(vertex);
    const tz = tangent.getZ(vertex);
    const w = tangent.getW(vertex);
    assert.ok(Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz));
    assert.ok(Math.abs(Math.hypot(tx, ty, tz) - 1) < 2e-5, `${label} tangent ${vertex} must be normalized`);
    const nx = normal.getX(vertex);
    const ny = normal.getY(vertex);
    const nz = normal.getZ(vertex);
    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength > 1e-20) {
      const dot = tx * nx / normalLength + ty * ny / normalLength + tz * nz / normalLength;
      assert.ok(Math.abs(dot) < 2e-5, `${label} tangent ${vertex} must be orthogonal to its normal`);
    }
    assert.ok(w === -1 || w === 1, `${label} tangent ${vertex} handedness must be +/-1`);
  }
};

const environment = defaultPlantEnvironment();
for (const presetId of ["oakCanopy", "cloverGroundcover", "blueSpruce"] as const) {
  const genome = procPlantPresets[presetId];
  assert.ok(genome);
  const lods = compileProcPlantLods(genome, 0x51face, environment);
  assert.equal(lods.length, 4);
  for (const lod of lods) {
    const label = `${presetId}.lod${lod.level}`;
    const snapshot = snapshotTemplate(lod.template);
    const first = createProcPlantThreeGeometry(lod.template, { tangents: true });
    const repeated = createProcPlantThreeGeometry(lod.template, { tangents: true });
    try {
      assert.equal(first.audit.contract, PROCPLANT_THREE_GEOMETRY_CONTRACT);
      assert.equal(first.audit.version, PROCPLANT_THREE_GEOMETRY_VERSION);
      assert.equal(first.audit.attributeOwnership, "copied");
      assert.equal(first.audit.vertexCount, lod.vertices);
      assert.equal(first.audit.triangleCount, lod.triangles);
      assert.equal(first.audit.aoTextureChannel, 1);
      assert.deepEqual(first.audit, repeated.audit, `${label} audit must be deterministic`);
      assertGroups(lod.template, first, label);

      const geometry = first.geometry;
      assert.equal(geometry.getAttribute("position").count, lod.vertices);
      assert.equal(geometry.getAttribute("normal").count, lod.vertices);
      assert.equal(geometry.getAttribute("color").count, lod.vertices);
      assert.equal(geometry.getAttribute(PROCPLANT_THREE_SWAY_ATTRIBUTE).count, lod.vertices);
      assert.equal(geometry.getAttribute(PROCPLANT_THREE_TINTABLE_ATTRIBUTE).count, lod.vertices);
      const uv0 = geometry.getAttribute(PROCPLANT_THREE_UV0_ATTRIBUTE);
      const aoUv = geometry.getAttribute(PROCPLANT_THREE_AO_UV_ATTRIBUTE);
      assert.equal(uv0.itemSize, 2);
      assert.equal(uv0.count, lod.vertices);
      assert.equal(aoUv.count, lod.vertices);
      assert.strictEqual(uv0, aoUv, `${label} AO UV must reuse the UV0 BufferAttribute and GPU buffer`);
      assert.strictEqual(uv0.array, aoUv.array, `${label} AO UV must alias the copied UV0 buffer`);
      assert.deepEqual(Array.from(uv0.array), Array.from(lod.template.uv0));
      assert.notStrictEqual(geometry.getAttribute("position").array, lod.template.pos);
      assert.notStrictEqual(uv0.array, lod.template.uv0);
      assert.notStrictEqual(geometry.index!.array, lod.template.idx);
      assertTangents(first, label);
      assertSourceUnchanged(lod.template, snapshot, label);
    } finally {
      first.geometry.dispose();
      repeated.geometry.dispose();
    }
  }
}

{
  const template = compileProcPlantLods(procPlantPresets.cloverGroundcover!, 77, environment)[0]!.template;
  const snapshot = snapshotTemplate(template);
  const result = createProcPlantThreeGeometry(template, { zeroCopy: true });
  let disposals = 0;
  result.geometry.addEventListener("dispose", () => disposals++);
  assert.equal(result.audit.attributeOwnership, "borrowed");
  assert.equal(result.audit.tangents, false);
  assert.strictEqual(result.geometry.getAttribute("position").array, template.pos);
  assert.strictEqual(result.geometry.getAttribute("normal").array, template.nrm);
  assert.strictEqual(result.geometry.getAttribute("uv").array, template.uv0);
  assert.strictEqual(result.geometry.getAttribute("uv1").array, template.uv0);
  assert.strictEqual(result.geometry.getAttribute("color").array, template.col);
  assert.strictEqual(result.geometry.getAttribute(PROCPLANT_THREE_SWAY_ATTRIBUTE).array, template.sway);
  assert.strictEqual(result.geometry.getAttribute(PROCPLANT_THREE_TINTABLE_ATTRIBUTE).array, template.tintable);
  assert.strictEqual(result.geometry.index!.array, template.idx);
  result.geometry.dispose();
  assert.equal(disposals, 1);
  assertSourceUnchanged(template, snapshot, "zero-copy-disposal");
}

{
  const template = compileProcPlantLods(procPlantPresets.cloverGroundcover!, 78, environment)[3]!.template;
  const snapshot = snapshotTemplate(template);
  const result = createProcPlantThreeGeometry(template);
  const position = result.geometry.getAttribute("position");
  position.setX(0, position.getX(0) + 1);
  result.geometry.dispose();
  assertSourceUnchanged(template, snapshot, "safe-copy-disposal");
}

const valid = compileProcPlantLods(procPlantPresets.cloverGroundcover!, 79, environment)[3]!.template;
assert.throws(() => createProcPlantThreeGeometry({ ...valid, uv0: new Float32Array(0) }), /UV0 must contain/);
const nonFinite = { ...valid, uv0: valid.uv0.slice() };
nonFinite.uv0[0] = Number.NaN;
assert.throws(() => createProcPlantThreeGeometry(nonFinite), /UV0\[0\] must be finite/);
assert.throws(() => createProcPlantThreeGeometry(valid, { zeroCopy: 1 as unknown as boolean }), /zeroCopy/);
assert.throws(() => createProcPlantThreeGeometry(valid, { tangents: 1 as unknown as boolean }), /tangents/);

console.log("procplant Three.js geometry adapter tests passed");
