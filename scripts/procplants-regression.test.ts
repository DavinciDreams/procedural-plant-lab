import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildProcPlantInstancedParts,
  buildProcPlantTemplate,
  buildProcPlantTemplateFromGraph,
  compileProcPlantLods,
  defaultPlantEnvironment,
  procPlantPhyllotaxyOrgansPerNode,
  procPlantPresets,
  resolveProcPlantPhyllotaxy,
} from "../src/procplants";
import { PROCPLANT_GENERATOR_CONTRACT_REVISION } from "../src/procplant-contract";
import {
  addProcPlantInstanceWindAttributes,
  addProcPlantSwayAttribute,
  PROCPLANT_INSTANCE_SWAY_ATTRIBUTE,
  PROCPLANT_SWAY_ATTRIBUTE,
  PROCPLANT_WIND_PHASE_ATTRIBUTE,
} from "../src/procplant-wind";
import {
  disposePreparedProcPlantGlbExport,
  prepareProcPlantGlbExport,
  PROCPLANT_GLB_EXPORT_CONTRACT,
  PROCPLANT_GLB_SWAY_ATTRIBUTE,
  PROCPLANT_TINTABLE_ATTRIBUTE,
  procPlantGlbSceneName,
  validateProcPlantLodsForGlb,
  validateProcPlantTemplateForGlb,
} from "../src/procplant-export";
import type { ProcPlantCompiledLod, ProcPlantTemplate } from "../src/procplants";
import { ProcPlantLodController } from "../src/procplant-lod";
import { createProcPlantDebugOverlay } from "../src/procplant-debug";
import { pruneProcPlantGraph } from "../src/procplant-pruning";
import {
  ecologySampleForBiome,
  normalizeBiomeMixDefinition,
  type ProcPlantBiomeMixDefinition,
} from "../src/biome-mix";
import {
  inspectProcPlantReadiness,
  PROCPLANT_EXPORT_PROFILES,
} from "../src/plant-readiness";
import {
  applyProcPlantVariant,
  procPlantVariantId,
  type ProcPlantVariantSpec,
} from "../src/plant-variants";
import {
  buildTellusProcPlantPackage,
  TELLUS_PROCPLANT_PACKAGE_CONTRACT,
  toPersistedTellusProcPlantRegistryV2,
  toTellusProcPlantBiomeMix,
} from "../src/tellus-export";
import committedTellusContractFixture from "../fixtures/tellus-procplant-contract-v2.golden.json";
import {
  buildTellusGoldenContractFixture,
  firstTellusFixtureDrift,
  TELLUS_GOLDEN_FIXTURE_PRESETS,
  TELLUS_GOLDEN_FIXTURE_SCHEMA,
  TELLUS_GOLDEN_FIXTURE_VERSION,
} from "./tellus-contract-fixture";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });
const clone = <T>(value: T): T => structuredClone(value);

const environment = defaultPlantEnvironment();

const assertFiniteBounded = (
  values: ArrayLike<number>,
  min: number,
  max: number,
  label: string,
) => {
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    assert.ok(Number.isFinite(value), `${label}[${index}] must be finite`);
    assert.ok(value >= min && value <= max, `${label}[${index}] must be in [${min}, ${max}], got ${value}`);
  }
};

const attachmentSnapshot = (presetId: string, seed: number) => {
  const genome = procPlantPresets[presetId];
  assert.ok(genome, `${presetId} preset must exist`);
  const graph = buildProcPlantInstancedParts(genome, seed, environment).graph;
  return {
    graph,
    serialized: graph.attachments.map((attachment) => ({
      id: attachment.id,
      parentSegmentId: attachment.parentSegmentId,
      axialT: attachment.axialT,
      position: attachment.position.toArray(),
      tangent: attachment.tangent.toArray(),
      right: attachment.right.toArray(),
      up: attachment.up.toArray(),
      kind: attachment.kind,
      depth: attachment.depth,
      sway: attachment.sway,
      organIndex: attachment.organIndex,
    })),
  };
};

const triangleTemplate = (triangleCount: number): ProcPlantTemplate => {
  const vertices = triangleCount * 3;
  const pos = new Float32Array(vertices * 3);
  const nrm = new Float32Array(vertices * 3);
  const uv0 = new Float32Array(vertices * 2);
  const col = new Float32Array(vertices * 3);
  const tintable = new Uint8Array(vertices);
  const sway = new Float32Array(vertices);
  const idx = new Uint32Array(vertices);
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const offset = triangle * 9;
    const x = triangle * 0.1;
    pos.set([x, 0, 0, x + 0.08, 0, 0, x, 0.12, 0], offset);
    for (let vertex = 0; vertex < 3; vertex++) {
      const index = triangle * 3 + vertex;
      nrm.set([0, 0, 1], index * 3);
      uv0.set(vertex === 0 ? [0, 0] : vertex === 1 ? [1, 0] : [0.5, 1], index * 2);
      col.set([0.2 + vertex * 0.1, 0.55, 0.18], index * 3);
      tintable[index] = triangle % 2;
      sway[index] = vertex / 2;
      idx[index] = index;
    }
  }
  return { pos, nrm, uv0, col, tintable, sway, idx };
};

const compactLodSet = (): ProcPlantCompiledLod[] =>
  ([8, 6, 4, 2] as const).map((triangles, level) => {
    const template = triangleTemplate(triangles);
    return {
      level: level as ProcPlantCompiledLod["level"],
      label: (["full", "clustered", "billboard-cross", "impostor"] as const)[level]!,
      distance: [0, 12, 28, 60][level]!,
      template,
      triangles,
      vertices: template.pos.length / 3,
    };
  });

const mixEntry = (
  id: string,
  presetId: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  label: id,
  source: "preset" as const,
  presetId,
  weight: 1,
  density: 0.5,
  scale: 1,
  environment: clone(environment),
  seed: 42,
  enabled: true,
  ...overrides,
});

const mixDefinition = (
  id: string,
  overrides: Partial<ProcPlantBiomeMixDefinition> = {},
): ProcPlantBiomeMixDefinition => ({
  version: 1,
  id,
  label: id,
  source: "custom",
  seed: 12345,
  density: 0.6,
  diversity: 0.75,
  targetVerticesPerChunk: 250_000,
  sample: ecologySampleForBiome("grassland"),
  entries: [mixEntry(`${id}-clover`, "cloverGroundcover")],
  ...overrides,
});

test("readiness counts real organ geometry rather than one triangle per instance", () => {
  const genome = procPlantPresets.cloverGroundcover;
  assert.ok(genome, "cloverGroundcover preset must exist");
  const built = buildProcPlantInstancedParts(genome, 731, environment);
  const readiness = inspectProcPlantReadiness(genome, 731, environment);
  const naiveTriangles = built.stems.idx.length / 3 + built.instances.length;

  assert.ok(built.instances.length > 0, "fixture must contain instanced organs");
  assert.ok(
    readiness.geometry.organTriangles > built.instances.length,
    "multi-triangle organ prototypes must cost more than their instance count",
  );
  assert.ok(
    readiness.geometry.triangles > naiveTriangles,
    "readiness must not use the legacy stemTriangles + instances estimate",
  );
  assert.equal(
    readiness.geometry.triangles,
    readiness.geometry.stemTriangles + readiness.geometry.organTriangles,
  );
});

test("public attachment IDs, parent segments, and branch-relative frames are deterministic and valid", () => {
  let parentedAttachments = 0;
  for (const presetId of ["cloverGroundcover", "blueSpruce"]) {
    const first = attachmentSnapshot(presetId, 730_031);
    const second = attachmentSnapshot(presetId, 730_031);
    assert.ok(first.serialized.length > 0, `${presetId} must expose public attachment anchors`);
    assert.deepEqual(first.serialized, second.serialized, `${presetId} must reproduce attachment IR for a stable seed`);

    const segmentIds = new Set(first.graph.segmentRecords.map((segment) => segment.id));
    assert.equal(segmentIds.size, first.graph.segmentRecords.length, `${presetId} segment IDs must be unique`);
    const attachmentIds = new Set(first.graph.attachments.map((attachment) => attachment.id));
    assert.equal(attachmentIds.size, first.graph.attachments.length, `${presetId} attachment IDs must be unique`);

    for (const segment of first.graph.segmentRecords) {
      assert.ok(segment.id.length > 0, "segment ID must not be empty");
      if (segment.parentSegmentId !== null) {
        assert.ok(segmentIds.has(segment.parentSegmentId), `${segment.id} must reference an existing parent segment`);
      }
    }

    for (const attachment of first.graph.attachments) {
      assert.ok(attachment.id.length > 0, "attachment ID must not be empty");
      if (attachment.parentSegmentId !== null) {
        parentedAttachments++;
        assert.ok(segmentIds.has(attachment.parentSegmentId), `${attachment.id} must reference an existing segment`);
      }
      assert.ok(attachment.axialT >= 0 && attachment.axialT <= 1, `${attachment.id} axialT must be normalized`);
      assertFiniteBounded(attachment.position.toArray(), -100_000, 100_000, `${attachment.id}.position`);
      assertFiniteBounded(attachment.tangent.toArray(), -1, 1, `${attachment.id}.tangent`);
      assertFiniteBounded(attachment.right.toArray(), -1, 1, `${attachment.id}.right`);
      assertFiniteBounded(attachment.up.toArray(), -1, 1, `${attachment.id}.up`);
      assert.ok(Math.abs(attachment.tangent.length() - 1) < 1e-5, `${attachment.id} tangent must be unit length`);
      assert.ok(Math.abs(attachment.right.length() - 1) < 1e-5, `${attachment.id} right must be unit length`);
      assert.ok(Math.abs(attachment.up.length() - 1) < 1e-5, `${attachment.id} up must be unit length`);
      assert.ok(Math.abs(attachment.tangent.dot(attachment.right)) < 1e-5, `${attachment.id} tangent/right must be orthogonal`);
      assert.ok(Math.abs(attachment.tangent.dot(attachment.up)) < 1e-5, `${attachment.id} tangent/up must be orthogonal`);
      assert.ok(Math.abs(attachment.right.dot(attachment.up)) < 1e-5, `${attachment.id} right/up must be orthogonal`);
      const handedness = new THREE.Vector3().crossVectors(attachment.tangent, attachment.right).dot(attachment.up);
      assert.ok(handedness > 0.999, `${attachment.id} frame must be right-handed`);
      assertFiniteBounded([attachment.sway], 0, 1.5, `${attachment.id}.sway`);
    }
  }
  assert.ok(parentedAttachments > 0, "graph-backed fixtures must expose attachments parented to generated segments");
});

test("accessory-organ presets build valid attachment frames across a seed sweep", () => {
  // Branch-start nodes share their parent's position, so the segment joining them
  // has zero length and no usable tangent. Nearest-segment binding used to select
  // those segments for accessory organs, throwing on a minority of seeds; a single
  // fixed seed per preset is not enough to catch it.
  const sweepPresets = Object.entries(procPlantPresets).filter(
    ([, genome]) => (genome.accessoryOrgans?.length ?? 0) > 0,
  );
  assert.ok(sweepPresets.length > 0, "expected presets carrying accessory organs");

  let checkedFrames = 0;
  for (const [presetId, genome] of sweepPresets) {
    for (let seed = 1; seed <= 64; seed++) {
      let graph: ReturnType<typeof buildProcPlantTemplate>["graph"] | null = null;
      try {
        graph = buildProcPlantTemplate(genome, seed).graph;
      } catch (error) {
        assert.fail(
          `${presetId} seed=${seed} failed to build: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      for (const attachment of graph.attachments) {
        const label = `${presetId} seed=${seed} ${attachment.id}`;
        for (const axis of ["tangent", "right", "up"] as const) {
          const vector = attachment[axis];
          assert.ok(
            Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z),
            `${label} ${axis} must be finite`,
          );
          assert.ok(Math.abs(vector.length() - 1) < 1e-5, `${label} ${axis} must be unit length`);
        }
        const handedness = new THREE.Vector3()
          .crossVectors(attachment.tangent, attachment.right)
          .dot(attachment.up);
        assert.ok(handedness >= 0.999, `${label} frame must be right-handed`);
        checkedFrames++;
      }
    }
  }
  assert.ok(checkedFrames > 0, "seed sweep must inspect attachment frames");
});

test("phyllotaxy resolves legacy, alternate, opposite, decussate, and three-organ whorl sequences", () => {
  const base = procPlantPresets.cloverGroundcover!;
  const legacy = clone(base);
  delete legacy.phyllotaxy;
  for (const ordinal of [0, 1, 2, 7]) {
    const sample = resolveProcPlantPhyllotaxy(legacy, ordinal);
    assert.equal(sample.mode, "spiral");
    assert.equal(sample.azimuth, ordinal * legacy.phyllotaxisAngle, "legacy path must preserve exact multiplication");
    assert.equal(sample.whorlIndex, ordinal);
    assert.equal(sample.indexInWhorl, 0);
    assert.equal(sample.whorlCount, 1);
  }

  const phase = 0.125;
  const alternate = { ...clone(base), phyllotaxy: { mode: "alternate" as const, phase } };
  assert.deepEqual(
    [0, 1, 2, 3].map((ordinal) => resolveProcPlantPhyllotaxy(alternate, ordinal).azimuth),
    [phase, phase + Math.PI, phase + Math.PI * 2, phase + Math.PI * 3],
  );

  const opposite = { ...clone(base), phyllotaxy: { mode: "opposite" as const, phase } };
  assert.equal(procPlantPhyllotaxyOrgansPerNode(opposite), 2);
  assert.deepEqual(
    [0, 1].map((slot) => resolveProcPlantPhyllotaxy(opposite, 2, slot).azimuth),
    [phase, phase + Math.PI],
  );

  const decussate = { ...clone(base), phyllotaxy: { mode: "decussate" as const, phase } };
  assert.deepEqual(
    [0, 1].flatMap((node) => [0, 1].map((slot) => resolveProcPlantPhyllotaxy(decussate, node, slot).azimuth)),
    [phase, phase + Math.PI, phase + Math.PI / 2, phase + Math.PI / 2 + Math.PI],
  );

  const whorled = { ...clone(base), phyllotaxy: { mode: "whorled" as const, phase, whorlCount: 3 } };
  assert.equal(procPlantPhyllotaxyOrgansPerNode(whorled), 3);
  assert.deepEqual(
    [0, 1, 2].map((slot) => resolveProcPlantPhyllotaxy(whorled, 2, slot).azimuth),
    [
      phase + 2 * whorled.phyllotaxisAngle,
      phase + 2 * whorled.phyllotaxisAngle + Math.PI * 2 / 3,
      phase + 2 * whorled.phyllotaxisAngle + Math.PI * 4 / 3,
    ],
  );
});

test("compiled LODs contain deterministic geometry with strictly decreasing real triangle counts", () => {
  for (const presetId of ["phiFern", "blueSpruce", "cloverGroundcover"]) {
    const genome = procPlantPresets[presetId];
    assert.ok(genome, `${presetId} preset must exist`);
    const seed = 612_072;
    const first = compileProcPlantLods(genome, seed, environment);
    const repeated = compileProcPlantLods(genome, seed, environment);
    assert.equal(first.length, 4, `${presetId} must compile all four LOD levels`);

    const realTriangles = first.map((lod) => lod.template.idx.length / 3);
    for (let index = 0; index < first.length; index++) {
      const lod = first[index]!;
      assert.equal(lod.level, index, `${presetId} LOD levels must be ordered`);
      assert.ok(lod.template.pos.length > 0, `${presetId} LOD${index} must contain vertices`);
      assert.ok(lod.template.idx.length > 0, `${presetId} LOD${index} must contain indexed triangles`);
      assert.equal(lod.template.pos.length % 3, 0, `${presetId} LOD${index} positions must be xyz tuples`);
      assert.equal(lod.template.nrm.length, lod.template.pos.length, `${presetId} LOD${index} normals must align`);
      assert.equal(lod.template.uv0.length, lod.vertices * 2, `${presetId} LOD${index} UV0 tuples must align`);
      assert.equal(lod.template.col.length, lod.template.pos.length, `${presetId} LOD${index} colors must align`);
      assert.equal(lod.template.tintable.length, lod.template.pos.length / 3, `${presetId} LOD${index} tint flags must align`);
      assert.equal(lod.template.sway.length, lod.template.pos.length / 3, `${presetId} LOD${index} sway must align`);
      assert.equal(lod.template.idx.length % 3, 0, `${presetId} LOD${index} indices must form triangles`);
      assert.equal(lod.triangles, realTriangles[index], `${presetId} LOD${index} must report actual triangle count`);
      assert.equal(lod.vertices, lod.template.pos.length / 3, `${presetId} LOD${index} must report actual vertex count`);
      assert.ok(
        Array.from(lod.template.idx).every((vertexIndex) => vertexIndex < lod.vertices),
        `${presetId} LOD${index} indices must reference existing vertices`,
      );
      assertFiniteBounded(lod.template.pos, -100_000, 100_000, `${presetId}.lod${index}.position`);
      assertFiniteBounded(lod.template.nrm, -1.001, 1.001, `${presetId}.lod${index}.normal`);
      assertFiniteBounded(lod.template.uv0, 0, 100_000, `${presetId}.lod${index}.uv0`);
      assertFiniteBounded(lod.template.col, 0, 1, `${presetId}.lod${index}.color`);
      assertFiniteBounded(lod.template.sway, 0, 1.5, `${presetId}.lod${index}.sway`);
      assert.deepEqual(
        lod.template.uv0,
        repeated[index]!.template.uv0,
        `${presetId} LOD${index} UV0 must be byte-deterministic`,
      );
    }
    for (let index = 1; index < realTriangles.length; index++) {
      assert.ok(
        realTriangles[index]! < realTriangles[index - 1]!,
        `${presetId} LOD triangles must strictly decrease: ${realTriangles.join(" > ")}`,
      );
    }
  }
});

test("LOD selection uses real distances and hysteresis without rebuilding geometry", () => {
  const lods = compileProcPlantLods(procPlantPresets.phiFern!, 612_072, environment);
  const controller = new ProcPlantLodController(lods, 0, 0.1);
  assert.equal(controller.active.level, 0);
  assert.equal(controller.update(15), true, "crossing the upper hysteresis boundary must enter LOD1");
  assert.equal(controller.active.level, 1);
  assert.equal(controller.update(13), false, "remaining inside the hysteresis band must not flap");
  assert.equal(controller.active.level, 1);
  assert.equal(controller.update(12), true, "crossing the lower hysteresis boundary must return to LOD0");
  assert.equal(controller.active.level, 0);
  assert.equal(controller.update(80), true, "a large distance jump must advance through all eligible tiers");
  assert.equal(controller.active.level, 3);
});

test("debug overlays expose static IR layers, wind colors, and active LOD status", () => {
  const graph = buildProcPlantInstancedParts(procPlantPresets.cloverGroundcover!, 77, environment).graph;
  const overlay = createProcPlantDebugOverlay(graph, compactLodSet(), {
    frames: true,
    attachmentColorMode: "kind",
  });
  const childNames = new Set(overlay.root.children.map((child) => child.name));
  assert.ok(childNames.has("procplant-debug-attachments"));
  assert.ok(childNames.has("procplant-debug-branch-order"));
  assert.ok(childNames.has("procplant-debug-local-frames"));
  assert.ok(childNames.has("procplant-debug-lod-status"));
  overlay.setAttachmentColorMode("wind");
  assert.equal(overlay.setActiveLod(2), true);
  assert.equal(overlay.getLodStatus()?.label, "billboard-cross");
  overlay.setLayerVisible("frames", false);
  assert.equal(overlay.isLayerVisible("frames"), false);
  overlay.dispose();
  assert.equal(overlay.root.children.length, 0);
  assert.throws(() => overlay.setLayerVisible("frames", true), /disposed/);
});

test("pruning retains selected branches with ancestors and repairs deterministic graph indices", () => {
  const source = buildProcPlantInstancedParts(procPlantPresets.cloverGroundcover!, 612_072, environment).graph;
  const target = source.segmentRecords.at(-1);
  assert.ok(target, "pruning fixture must contain segments");
  const before = {
    stems: source.stems.map((stem) => ({ index: stem.index, position: stem.position.toArray() })),
    segmentIds: source.segmentRecords.map((segment) => segment.id),
    attachmentIds: source.attachments.map((attachment) => attachment.id),
  };
  const request = { operation: "retain", selection: { kind: "segmentIds", segmentIds: [target.id] } } as const;
  const first = pruneProcPlantGraph(source, request);
  const second = pruneProcPlantGraph(source, request);
  const keptIds = new Set(first.graph.segmentRecords.map((segment) => segment.id));
  assert.ok(keptIds.has(target.id));
  assert.ok(first.graph.segmentRecords.every((segment) => !segment.parentSegmentId || keptIds.has(segment.parentSegmentId)));
  assert.ok(first.graph.segments.every(([start, end]) => first.graph.stems[start] && first.graph.stems[end]));
  assert.ok(first.graph.attachments.every((attachment) =>
    attachment.organIndex === null || first.graph.organs[attachment.organIndex] !== undefined));
  assert.deepEqual(
    first.graph.segmentRecords.map((segment) => segment.id),
    second.graph.segmentRecords.map((segment) => segment.id),
  );
  assert.deepEqual(first.audit, second.audit);
  assert.deepEqual(before, {
    stems: source.stems.map((stem) => ({ index: stem.index, position: stem.position.toArray() })),
    segmentIds: source.segmentRecords.map((segment) => segment.id),
    attachmentIds: source.attachments.map((attachment) => attachment.id),
  }, "pruning must not mutate the source graph");
});

test("Tellus contract-v2 golden fixture is deterministic and detects compact summary drift", () => {
  const first = buildTellusGoldenContractFixture();
  assert.equal(first.schema, TELLUS_GOLDEN_FIXTURE_SCHEMA);
  assert.equal(first.fixtureVersion, TELLUS_GOLDEN_FIXTURE_VERSION);
  assert.equal(first.generatorContractRevision, PROCPLANT_GENERATOR_CONTRACT_REVISION);
  assert.deepEqual(first.presets.map((preset) => preset.presetId), [...TELLUS_GOLDEN_FIXTURE_PRESETS]);
  assert.equal(first.presets.find((preset) => preset.presetId === "weepingWillow")?.genome.backend, "branch-module-graph");
  assert.deepEqual(first.biomeNormalization.assetLodPreference, {
    valid: { input: "game-optimized", normalized: "game-optimized" },
    invalid: { input: "unsupported-lod", normalized: "game-optimized" },
  });
  for (const preset of first.presets) {
    assert.deepEqual(Object.keys(preset.instances.countsByKind), preset.instances.supportedKinds);
    assert.equal(
      Object.values(preset.instances.countsByKind).reduce((sum, count) => sum + count, 0),
      preset.instances.total,
      `${preset.presetId} instance kind counts must cover every emitted instance`,
    );
    assert.equal(preset.lodSelection.contract, "procplants.runtime-lod-selection");
    assert.equal(preset.lodSelection.version, 1);
    assert.equal(preset.lodSelection.tiers.length, 4);
    for (const lod of preset.lods) {
      assert.equal(lod.attributeLengths.pos, lod.vertices * 3);
      assert.equal(lod.attributeLengths.nrm, lod.vertices * 3);
      assert.equal(lod.attributeLengths.uv0, lod.vertices * 2);
      assert.equal(lod.attributeLengths.col, lod.vertices * 3);
      assert.equal(lod.attributeLengths.tintable, lod.vertices);
      assert.equal(lod.attributeLengths.sway, lod.vertices);
      assert.equal(lod.attributeLengths.idx, lod.triangles * 3);
      assert.equal(lod.surfacePartition.triangleCount, lod.triangles);
      assert.equal(lod.surfacePartition.indexCount, lod.attributeLengths.idx);
      assert.equal(lod.surfacePartition.groups.total,
        lod.surfacePartition.groups.barkStem + lod.surfacePartition.groups.organ);
      assert.equal(lod.surfacePartition.coverage.indices, lod.surfacePartition.indexCount);
      assert.equal(lod.surfacePartition.coverage.triangles, lod.surfacePartition.triangleCount);
      assert.equal(lod.surfacePartition.coverage.complete, true);
    }
  }
  assert.ok(
    first.presets.some((preset) => preset.instances.supportedKinds.length > 0),
    "fixture vectors must cover at least one instanced organ kind",
  );
  assert.equal(
    firstTellusFixtureDrift(committedTellusContractFixture, first),
    null,
    "committed Tellus fixture must match current contract summaries and hashes",
  );

  const drifted = clone(first);
  drifted.presets[0]!.lods[0]!.triangles++;
  assert.equal(
    firstTellusFixtureDrift(first, drifted),
    "$.presets[0].lods[0].triangles",
    "fixture comparison must identify the first changed contract field",
  );
});

test("wind-ready templates and instance attributes remain finite, bounded, and deterministic", () => {
  const built = buildProcPlantInstancedParts(procPlantPresets.cloverGroundcover!, 94_117, environment);
  assert.ok(built.stems.pos.length > 0, "wind fixture must contain stem vertices");
  assert.equal(built.stems.sway.length, built.stems.pos.length / 3, "template sway must align with vertices");
  assertFiniteBounded(built.stems.sway, 0, 1.5, "template.sway");
  assert.ok(built.instances.length > 0, "wind fixture must contain organ instances");
  assertFiniteBounded(built.instances.map((instance) => instance.sway), 0, 1.5, "instance.sway");

  const makeWindAttributes = () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(built.stems.pos.slice(), 3));
    addProcPlantSwayAttribute(geometry, built.stems.sway.slice());
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, built.instances.length);
    addProcPlantInstanceWindAttributes(
      mesh,
      built.instances.map((instance) => instance.matrix),
      built.instances.map((instance) => instance.sway),
    );
    const snapshot = {
      vertexSway: Array.from(geometry.getAttribute(PROCPLANT_SWAY_ATTRIBUTE).array),
      instanceSway: Array.from(geometry.getAttribute(PROCPLANT_INSTANCE_SWAY_ATTRIBUTE).array),
      phase: Array.from(geometry.getAttribute(PROCPLANT_WIND_PHASE_ATTRIBUTE).array),
    };
    geometry.dispose();
    material.dispose();
    return snapshot;
  };

  const first = makeWindAttributes();
  const second = makeWindAttributes();
  assert.deepEqual(first, second, "wind attributes must be stable for the same matrices and seed");
  assert.equal(first.vertexSway.length, built.stems.pos.length / 3);
  assert.equal(first.instanceSway.length, built.instances.length);
  assert.equal(first.phase.length, built.instances.length);
  assertFiniteBounded(first.vertexSway, 0, 1.5, "procplantSway");
  assertFiniteBounded(first.instanceSway, 0, 1.5, "procplantInstanceSway");
  assertFiniteBounded(first.phase, 0, Math.PI * 2, "procplantWindPhase");
});

test("GLB preparation preserves vertex color, sway, tintability, and deterministic contract metadata", () => {
  const template = triangleTemplate(3);
  assert.deepEqual(validateProcPlantTemplateForGlb(template), { vertices: 9, triangles: 3 });
  assert.equal(procPlantGlbSceneName({ name: "Oak / North<>" }), "procplant-oak-north");
  const options = {
    name: "Oak / North<>",
    genomeId: "oakCanopy",
    seed: 0xffffffff + 9,
    metadata: { biome: "temperate-rain-forest", authored: true },
  };
  const first = prepareProcPlantGlbExport(template, options);
  const second = prepareProcPlantGlbExport(template, options);
  try {
    assert.equal(first.sceneName, "procplant-oak-north");
    assert.equal(first.fileName, "procplant-oak-north.glb");
    assert.equal(first.scene.name, first.sceneName);
    assert.equal(first.meshes.length, 1);
    assert.equal(first.meshes[0]!.name, "procplant-oak-north-mesh");
    assert.deepEqual(first.scene.userData, second.scene.userData, "scene metadata must be deterministic");
    assert.equal(first.metadata.contract, PROCPLANT_GLB_EXPORT_CONTRACT);
    assert.equal(first.metadata.sourceKind, "template");
    assert.equal(first.metadata.seed, 8, "seed metadata must use its stable uint32 representation");
    assert.doesNotThrow(() => JSON.stringify(first.scene.userData), "glTF extras metadata must be JSON-safe");

    const geometry = first.meshes[0]!.geometry;
    assert.deepEqual(Array.from(geometry.getAttribute("uv").array), Array.from(template.uv0));
    assert.deepEqual(Array.from(geometry.getAttribute("color").array), Array.from(template.col));
    assert.deepEqual(Array.from(geometry.getAttribute(PROCPLANT_GLB_SWAY_ATTRIBUTE).array), Array.from(template.sway));
    assert.deepEqual(Array.from(geometry.getAttribute(PROCPLANT_TINTABLE_ATTRIBUTE).array), Array.from(template.tintable));
    assert.notStrictEqual(geometry.getAttribute("uv").array, template.uv0, "export geometry must own copied UV0 arrays");
    assert.notStrictEqual(geometry.getAttribute("color").array, template.col, "export geometry must own copied arrays");
    const materials = Array.isArray(first.meshes[0]!.material)
      ? first.meshes[0]!.material
      : [first.meshes[0]!.material];
    assert.ok(materials.every((material) => material.vertexColors));
    assert.equal(geometry.groups.length, 3, "alternating bark/organ triangles must remain exact contiguous groups");
    assert.deepEqual(first.meshes[0]!.userData.procplant.attributes, {
      uv0: "TEXCOORD_0",
      color: "COLOR_0",
      sway: "_PROCPLANTSWAY",
      tintable: "_PROCPLANTTINTABLE",
    });
  } finally {
    disposePreparedProcPlantGlbExport(first);
    disposePreparedProcPlantGlbExport(second);
  }
});

test("compiled LOD GLB preparation validates summaries and emits stable per-level nodes", () => {
  const lods = compactLodSet();
  assert.doesNotThrow(() => validateProcPlantLodsForGlb(lods));
  const prepared = prepareProcPlantGlbExport(lods, { genomeId: "contractFixture", seed: 42 });
  try {
    assert.equal(prepared.metadata.sourceKind, "compiled-lod-set");
    assert.equal(prepared.meshes.length, 4);
    assert.deepEqual(
      prepared.meshes.map((mesh) => mesh.name),
      [
        "procplant-contractfixture-lod0-full",
        "procplant-contractfixture-lod1-clustered",
        "procplant-contractfixture-lod2-billboard-cross",
        "procplant-contractfixture-lod3-impostor",
      ],
    );
    assert.deepEqual(
      prepared.meshes.map((mesh) => mesh.userData.procplant.lod.triangles),
      [8, 6, 4, 2],
    );
    for (let level = 0; level < lods.length; level++) {
      assert.deepEqual(
        Array.from(prepared.meshes[level]!.geometry.getAttribute("uv").array),
        Array.from(lods[level]!.template.uv0),
        `LOD${level} GLB preparation must preserve UV0 exactly`,
      );
    }
  } finally {
    disposePreparedProcPlantGlbExport(prepared);
  }

  const badNormals = triangleTemplate(1);
  badNormals.nrm = new Float32Array(0);
  assert.throws(() => validateProcPlantTemplateForGlb(badNormals), /nrm must align/);
  const badUvLength = triangleTemplate(1);
  badUvLength.uv0 = new Float32Array(0);
  assert.throws(() => validateProcPlantTemplateForGlb(badUvLength), /uv0 must contain/);
  const badUvValue = triangleTemplate(1);
  badUvValue.uv0[1] = Number.NaN;
  assert.throws(() => validateProcPlantTemplateForGlb(badUvValue), /uv0\[1\] must be finite/);
  const badIndex = triangleTemplate(1);
  badIndex.idx[2] = 99;
  assert.throws(() => validateProcPlantTemplateForGlb(badIndex), /missing vertex/);
  const badLods = compactLodSet();
  badLods[1] = { ...badLods[1]!, level: 0 };
  assert.throws(() => validateProcPlantLodsForGlb(badLods), /duplicated/);
});

test("GLB preparation emits optional deterministic collision proxies", () => {
  const template = triangleTemplate(3);
  const box = prepareProcPlantGlbExport(template, {
    genomeId: "collision-fixture",
    collision: { type: "bounds-box", scale: 1.1 },
  });
  const capsule = prepareProcPlantGlbExport(template, {
    genomeId: "collision-fixture",
    collision: { type: "trunk-capsule" },
  });
  try {
    assert.equal(box.collisionMeshes.length, 1);
    assert.equal(box.collisionMeshes[0]!.name, "procplant-collision-fixture-collision-bounds-box");
    assert.equal(box.collisionMeshes[0]!.visible, false);
    assert.equal(box.collisionMeshes[0]!.userData.procplantCollision.type, "bounds-box");
    assert.equal(capsule.collisionMeshes.length, 1);
    assert.equal(capsule.collisionMeshes[0]!.userData.procplantCollision.type, "trunk-capsule");
    assert.doesNotThrow(() => JSON.stringify(box.collisionMeshes[0]!.userData));
  } finally {
    disposePreparedProcPlantGlbExport(box);
    disposePreparedProcPlantGlbExport(capsule);
  }
});

test("phi fern and authored ground covers stay within close-range coverage budgets", () => {
  const budgets: Record<string, { triangles: number; instances: number }> = {
    phiFern: { triangles: 12_000, instances: 160 },
    brackenFernMat: { triangles: 10_000, instances: 128 },
    cloverGroundcover: { triangles: 8_000, instances: 128 },
    woodSorrelCarpet: { triangles: 8_000, instances: 128 },
    woodlandAnemoneCarpet: { triangles: 8_000, instances: 128 },
    creepingPhloxCarpet: { triangles: 8_000, instances: 128 },
  };

  for (const [presetId, budget] of Object.entries(budgets)) {
    const genome = procPlantPresets[presetId];
    assert.ok(genome, `${presetId} preset must exist`);
    const report = inspectProcPlantReadiness(genome, 612_072, environment);
    assert.ok(report.geometry.triangles > 0, `${presetId} must produce visible geometry`);
    assert.ok(
      report.geometry.triangles <= budget.triangles,
      `${presetId} uses ${report.geometry.triangles} triangles; budget is ${budget.triangles}`,
    );
    assert.ok(
      report.geometry.instances <= budget.instances,
      `${presetId} uses ${report.geometry.instances} instances; budget is ${budget.instances}`,
    );
    assert.ok(
      report.geometry.triangles <= PROCPLANT_EXPORT_PROFILES["tellus-realtime"].maxTriangles,
      `${presetId} must fit the Tellus realtime profile`,
    );
  }
});

test("low-poly accessory presets expose branch-relative organs within realtime budgets", () => {
  const expected: Record<string, { kind: string; minimum: number; maxTriangles: number }> = {
    wildStrawberryGroundcover: { kind: "fruit", minimum: 4, maxTriangles: 1_000 },
    winterberryShrub: { kind: "berry", minimum: 10, maxTriangles: 1_000 },
    shorePineCones: { kind: "cone", minimum: 6, maxTriangles: 2_500 },
    thornyBramble: { kind: "thorn", minimum: 14, maxTriangles: 1_000 },
    epiphyticAroidRoots: { kind: "aerialRoot", minimum: 6, maxTriangles: 1_000 },
  };
  for (const [presetId, contract] of Object.entries(expected)) {
    const genome = procPlantPresets[presetId];
    assert.ok(genome, `${presetId} preset must exist`);
    const parts = buildProcPlantInstancedParts(genome, 42, environment);
    assert.ok(parts.instances.filter((instance) => instance.kind === contract.kind).length >= contract.minimum);
    const template = buildProcPlantTemplate(genome, 42, environment).template;
    assert.ok(template.idx.length / 3 <= contract.maxTriangles, `${presetId} exceeded its low-poly budget`);
    for (const attachment of parts.graph.attachments.filter((entry) => entry.kind === contract.kind)) {
      assert.ok(attachment.parentSegmentId, `${presetId} accessory must retain branch ancestry`);
      assert.ok(attachment.right.clone().cross(attachment.up).dot(attachment.tangent) > 0.99);
    }
  }
});

test("pruned graph compilation removes selected topology and its attached organs", () => {
  const genome = procPlantPresets.thornyBramble;
  const original = buildProcPlantTemplate(genome, 42, environment);
  const selected = original.graph.segmentRecords.find((record) => record.parentSegmentId !== null);
  assert.ok(selected, "thorny bramble must expose a child segment");
  const pruned = pruneProcPlantGraph(original.graph, {
    operation: "remove",
    selection: { kind: "segmentIds", segmentIds: [selected.id] },
  });
  const compiled = buildProcPlantTemplateFromGraph(genome, pruned.graph, environment);
  assert.ok(compiled.graph.segmentRecords.length < original.graph.segmentRecords.length);
  assert.ok(compiled.template.idx.length < original.template.idx.length);
  assert.equal(compiled.stats.stems, compiled.graph.segments.length);
});

test("season and health variants are deterministic and never mutate the source genome", () => {
  const source = procPlantPresets.meadowFlower;
  assert.ok(source, "meadowFlower preset must exist");
  const before = clone(source);
  const spec: ProcPlantVariantSpec = { season: "autumn", health: 0.42, maturity: 0.68 };
  const first = applyProcPlantVariant(source, spec);
  const second = applyProcPlantVariant(source, spec);

  assert.deepEqual(first, second);
  assert.deepEqual(source, before, "variant compilation mutated the authored preset");
  assert.notStrictEqual(first, source);
  assert.notStrictEqual(first.leaf, source.leaf);
  assert.equal(first.id, procPlantVariantId(source.id, spec));
  assert.notEqual(first.leaf.colorA, source.leaf.colorA);

  const daylily = applyProcPlantVariant(procPlantPresets.daylilyFlower, { season: "spring", health: 0.9, maturity: 0.9 });
  const daylilyParts = buildProcPlantInstancedParts(daylily, 42, environment);
  assert.ok(daylilyParts.instances.some((instance) => instance.kind === "daylilyBloom"), "variant IDs must preserve authored bloom dispatch");

  const strawberry = applyProcPlantVariant(procPlantPresets.wildStrawberryGroundcover, spec);
  assert.ok((strawberry.accessoryOrgans?.[0]?.count ?? 0) < procPlantPresets.wildStrawberryGroundcover.accessoryOrgans![0]!.count);
});

test("extended biome schema preserves terrain routing, grass controls, and asset LOD data", () => {
  const raw = {
    version: 1,
    id: "terrain-meadow",
    label: "Terrain Meadow",
    source: "terrain-paint",
    terrainPaint: "grass",
    targetTerrainPaint: "flowers",
    seed: 91,
    density: 0.7,
    diversity: 0.8,
    targetVerticesPerChunk: 80_000,
    sample: ecologySampleForBiome("grassland"),
    entries: [
      mixEntry("low-grass", "furGrass", {
        grassHeight: 0.55,
        grassSpread: 1.3,
        grassLean: 0.28,
      }),
      {
        id: "fern-asset",
        label: "Fern Asset",
        source: "asset",
        asset: {
          kind: "glb",
          name: "fern.glb",
          libraryId: "fern-library-id",
          lodPreference: "lod2",
          runtimeOnly: false,
          template: {
            version: 1,
            vertexCount: 3,
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
            colors: [0.2, 0.5, 0.2, 0.2, 0.5, 0.2, 0.2, 0.5, 0.2],
            indices: [0, 1, 2],
          },
        },
        weight: 0.5,
        density: 0.4,
        scale: 1.2,
        environment: clone(environment),
        seed: 92,
        enabled: true,
      },
    ],
  };

  const normalized = normalizeBiomeMixDefinition(raw);
  assert.ok(normalized);
  assert.equal(normalized.source, "terrain-paint");
  assert.equal(normalized.terrainPaint, "grass");
  assert.equal(normalized.targetTerrainPaint, "flowers");
  assert.equal(normalized.entries[0]?.grassHeight, 0.55);
  assert.equal(normalized.entries[0]?.grassSpread, 1.3);
  assert.equal(normalized.entries[0]?.grassLean, 0.28);
  assert.equal(normalized.entries[1]?.asset?.lodPreference, "lod2");
  assert.equal(normalized.entries[1]?.asset?.template?.vertexCount, 3);

  const tellus = toTellusProcPlantBiomeMix(normalized);
  assert.equal(tellus.targetTerrainPaint, "flowers");
  assert.equal(tellus.entries[0]?.grassHeight, 0.55);
  assert.equal(tellus.entries[1]?.asset?.libraryId, "fern-library-id");
});

test("Tellus package compilation is deterministic and does not mutate its inputs", () => {
  const mix = mixDefinition("deterministic-package", {
    source: "terrain-paint",
    terrainPaint: "grass",
    targetTerrainPaint: "flowers",
    entries: [
      mixEntry("sorrel", "woodSorrelCarpet", { seed: 77 }),
      mixEntry("clover", "cloverGroundcover", { seed: 76 }),
    ],
  });
  const savedGenome = clone(procPlantPresets.meadowFlower);
  const saved = [{
    id: "saved-meadow",
    label: "Saved Meadow",
    genome: savedGenome,
    variants: [{ season: "winter", health: 0.7, maturity: 1 }] as ProcPlantVariantSpec[],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  const mixBefore = clone(mix);
  const savedBefore = clone(saved);

  const first = buildTellusProcPlantPackage(mix, saved);
  const second = buildTellusProcPlantPackage(mix, saved);

  assert.equal(first.contract, TELLUS_PROCPLANT_PACKAGE_CONTRACT);
  assert.equal(first.generatorContractRevision, PROCPLANT_GENERATOR_CONTRACT_REVISION);
  assert.equal(first.deterministic, true);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(mix, mixBefore, "Tellus compilation mutated the biome mix");
  assert.deepEqual(saved, savedBefore, "Tellus compilation mutated saved presets");
  assert.deepEqual(
    first.catalog.map((entry) => entry.id),
    [...first.catalog.map((entry) => entry.id)].sort((a, b) => a.localeCompare(b)),
    "catalog order must be stable",
  );
});

test("registry v2 routes target terrain paint and ecology indexes deterministically", () => {
  const terrainMix = mixDefinition("terrain-route", {
    source: "terrain-paint",
    terrainPaint: "grass",
    targetTerrainPaint: "flowers",
  });
  const ecologyMix = mixDefinition("ecology-route", {
    source: "ecology",
    ecologyBiome: "taiga",
    targetTerrainPaint: "snow",
    sample: ecologySampleForBiome("taiga"),
  });
  const mixes = [terrainMix, ecologyMix];
  const before = clone(mixes);
  const registry = toPersistedTellusProcPlantRegistryV2(
    "world-regression",
    mixes,
    "2026-08-07T12:00:00.000Z",
  );

  assert.equal(registry.version, 2);
  assert.equal(registry.worldId, "world-regression");
  assert.equal(registry.updatedAt, "2026-08-07T12:00:00.000Z");
  assert.equal(registry.terrainPaintMixIndexes.flowers, 0);
  assert.equal(registry.terrainPaintMixIndexes.snow, 1);
  assert.equal(registry.terrainPaintMixIndexes.grass, undefined);
  assert.equal(registry.ecologyBiomeMixIndexes.taiga, 1);
  assert.deepEqual(mixes, before, "registry compilation mutated its mixes");
  assert.deepEqual(
    registry,
    toPersistedTellusProcPlantRegistryV2("world-regression", mixes, "2026-08-07T12:00:00.000Z"),
  );
});

let passed = 0;
for (const { name, run } of tests) {
  try {
    run();
    passed++;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${name}`);
    throw error;
  }
}

console.log(`1..${tests.length}`);
