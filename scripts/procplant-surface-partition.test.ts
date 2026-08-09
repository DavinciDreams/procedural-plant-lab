import assert from "node:assert/strict";
import {
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";
import {
  partitionProcPlantTemplateSurfaces,
  PROCPLANT_SURFACE_BARK_STEM,
  PROCPLANT_SURFACE_ORGAN,
  PROCPLANT_SURFACE_PARTITION_CONTRACT,
  PROCPLANT_SURFACE_PARTITION_VERSION,
} from "../src/procplant-surface-partition";

const snapshotTemplate = (template: ProcPlantTemplate) => ({
  pos: template.pos.slice(),
  nrm: template.nrm.slice(),
  uv0: template.uv0.slice(),
  col: template.col.slice(),
  tintable: template.tintable.slice(),
  sway: template.sway.slice(),
  idx: template.idx.slice(),
});

const assertUnchanged = (template: ProcPlantTemplate, before: ReturnType<typeof snapshotTemplate>, label: string) => {
  for (const attribute of ["pos", "nrm", "uv0", "col", "tintable", "sway", "idx"] as const) {
    assert.deepEqual(template[attribute], before[attribute], `${label}.${attribute} must not be mutated`);
  }
};

const assertExactCoverage = (template: ProcPlantTemplate, label: string) => {
  const before = snapshotTemplate(template);
  const first = partitionProcPlantTemplateSurfaces(template);
  const repeated = partitionProcPlantTemplateSurfaces(template);
  assert.equal(first.contract, PROCPLANT_SURFACE_PARTITION_CONTRACT);
  assert.equal(first.version, PROCPLANT_SURFACE_PARTITION_VERSION);
  assert.equal(first.indexCount, template.idx.length);
  assert.equal(first.triangleCount, template.idx.length / 3);
  assert.equal(first.rangeCount, first.rangeIndexStarts.length);
  assert.equal(first.rangeCount, first.rangeIndexCounts.length);
  assert.equal(first.rangeCount, first.rangeSurfaceIds.length);
  assert.equal(first.barkStemTriangles + first.organTriangles, first.triangleCount);
  assert.equal(first.sourceIndexHash, repeated.sourceIndexHash);
  assert.equal(first.contentHash, repeated.contentHash);
  assert.deepEqual(first.rangeIndexStarts, repeated.rangeIndexStarts);
  assert.deepEqual(first.rangeIndexCounts, repeated.rangeIndexCounts);
  assert.deepEqual(first.rangeSurfaceIds, repeated.rangeSurfaceIds);

  let cursor = 0;
  let coveredTriangles = 0;
  for (let range = 0; range < first.rangeCount; range++) {
    const start = first.rangeIndexStarts[range]!;
    const count = first.rangeIndexCounts[range]!;
    const surface = first.rangeSurfaceIds[range]!;
    assert.equal(start, cursor, `${label} ranges must be contiguous and non-overlapping`);
    assert.equal(start % 3, 0);
    assert.ok(count > 0);
    assert.equal(count % 3, 0);
    assert.ok(surface === PROCPLANT_SURFACE_BARK_STEM || surface === PROCPLANT_SURFACE_ORGAN);
    for (let indexOffset = start; indexOffset < start + count; indexOffset += 3) {
      const a = template.idx[indexOffset]!;
      const b = template.idx[indexOffset + 1]!;
      const c = template.idx[indexOffset + 2]!;
      assert.equal(template.tintable[a], surface);
      assert.equal(template.tintable[b], surface);
      assert.equal(template.tintable[c], surface);
      coveredTriangles++;
    }
    cursor += count;
  }
  assert.equal(cursor, template.idx.length, `${label} ranges must cover every source index exactly once`);
  assert.equal(coveredTriangles, first.triangleCount);
  assertUnchanged(template, before, label);
  return first;
};

const environment = defaultPlantEnvironment();
const representatives = [
  ["oakCanopy", "Weber-Penn"],
  ["cloverGroundcover", "groundcover"],
  ["blueSpruce", "conifer"],
] as const;

for (const [presetId, family] of representatives) {
  const genome = procPlantPresets[presetId];
  assert.ok(genome, `${presetId} must exist`);
  const lods = compileProcPlantLods(genome, 0x51face, environment);
  assert.equal(lods.length, 4, `${family} representative must compile all four real LODs`);
  for (const lod of lods) {
    const partition = assertExactCoverage(lod.template, `${presetId}.lod${lod.level}`);
    assert.equal(partition.triangleCount, lod.triangles);
  }
}

const triangleTemplate = (flags: readonly number[], indices = [0, 1, 2]): ProcPlantTemplate => ({
  pos: new Float32Array(flags.length * 3),
  nrm: new Float32Array(flags.length * 3),
  uv0: new Float32Array(flags.length * 2),
  col: new Float32Array(flags.length * 3),
  tintable: new Uint8Array(flags),
  sway: new Float32Array(flags.length),
  idx: new Uint32Array(indices),
});

{
  const template = triangleTemplate([0, 0, 0, 1, 1, 1], [0, 1, 2, 3, 4, 5, 0, 2, 1]);
  const partition = assertExactCoverage(template, "contiguous-fixture");
  assert.deepEqual(Array.from(partition.rangeIndexStarts), [0, 3, 6]);
  assert.deepEqual(Array.from(partition.rangeIndexCounts), [3, 3, 3]);
  assert.deepEqual(Array.from(partition.rangeSurfaceIds), [0, 1, 0]);
  assert.equal(partition.barkStemTriangles, 2);
  assert.equal(partition.organTriangles, 1);
}

{
  const empty = triangleTemplate([], []);
  const partition = assertExactCoverage(empty, "empty-fixture");
  assert.equal(partition.rangeCount, 0);
  assert.equal(partition.contentHash.length, 8);
}

assert.throws(
  () => partitionProcPlantTemplateSurfaces(triangleTemplate([0, 1, 0])),
  /triangle 0 mixes tintable flags 0, 1, 0/,
);
assert.throws(
  () => partitionProcPlantTemplateSurfaces(triangleTemplate([2, 2, 2])),
  /outside 0 or 1/,
);
assert.throws(
  () => partitionProcPlantTemplateSurfaces(triangleTemplate([0, 0, 0], [0, 1, 3])),
  /missing vertex/,
);
assert.throws(
  () => partitionProcPlantTemplateSurfaces({
    ...triangleTemplate([0, 0, 0]),
    tintable: new Uint8Array(2),
  }),
  /one value per vertex/,
);
assert.throws(
  () => partitionProcPlantTemplateSurfaces({
    ...triangleTemplate([0, 0, 0]),
    idx: new Uint32Array([0, 1]),
  }),
  /triangle tuples/,
);
assert.throws(
  () => partitionProcPlantTemplateSurfaces({
    ...triangleTemplate([0, 0, 0]),
    pos: new Float32Array(8),
  }),
  /xyz tuples/,
);

console.log("procplant surface partition tests passed");
