import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  addProcPlantCrownSpline,
  addProcPlantCrownSplinePoint,
  removeProcPlantCrownSpline,
  removeProcPlantCrownSplinePoint,
  updateProcPlantCrownSplinePoint,
} from "../src/procplant-spline-crown";
import {
  cloneProcPlantFreeformCrown,
  deserializeProcPlantFreeformCrown,
  PROCPLANT_CROWN_MAX_SPLINES,
  PROCPLANT_FREEFORM_CROWN_CONTRACT,
  PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
  PROCPLANT_FREEFORM_CROWN_VERSION,
  sampleProcPlantCrownAttractors,
  serializeProcPlantFreeformCrown,
  validateProcPlantFreeformCrown,
  type ProcPlantFreeformCrown,
  type ProcPlantFreeformCrownV2,
} from "../src/procplant-space-colonization";
import {
  buildProcPlantTemplate,
  defaultPlantEnvironment,
  procPlantPresets,
  type ProcPlantTemplate,
} from "../src/procplants";
import { createProcPlantAuthoringGraph } from "../src/procplant-authoring-graph";

const templateHash = (template: ProcPlantTemplate) => {
  const hash = createHash("sha256");
  for (const array of [template.pos, template.nrm, template.uv0, template.col, template.tintable, template.sway, template.idx]) {
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest("hex");
};

const legacy: ProcPlantFreeformCrown = {
  contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
  version: PROCPLANT_FREEFORM_CROWN_VERSION,
  volumes: [
    { id: "left", shape: "ellipsoid", center: [-0.8, 2.4, 0], dimensions: [1.2, 1.4, 1] },
    { id: "right", shape: "box", center: [0.9, 2.8, 0], dimensions: [1.1, 1.3, 1], weight: 1.3 },
  ],
};
const emptySplineV2: ProcPlantFreeformCrownV2 = {
  contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
  version: PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
  volumes: legacy.volumes,
  splines: [],
};
assert.deepEqual(
  sampleProcPlantCrownAttractors(emptySplineV2, 256, 71).map((point) => point.toArray()),
  sampleProcPlantCrownAttractors(legacy, 256, 71).map((point) => point.toArray()),
  "V2 without splines must use the exact V1 attraction sampler",
);
assert.deepEqual(deserializeProcPlantFreeformCrown(serializeProcPlantFreeformCrown(legacy)), legacy);

const field: ProcPlantFreeformCrownV2 = {
  contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
  version: PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
  volumes: [],
  splines: [
    {
      id: "canopy-path",
      points: [
        { id: "canopy-path-point-1", position: [0, 1, 0], radius: 0.9 },
        { id: "canopy-path-point-2", position: [0, 3, 0], radius: 1.05 },
        { id: "canopy-path-point-3", position: [0, 5, 0], radius: 0.8 },
      ],
    },
    {
      id: "canopy-cutout",
      operation: "subtract",
      points: [
        { id: "canopy-cutout-point-1", position: [0, 2, 0], radius: 0.34 },
        { id: "canopy-cutout-point-2", position: [0, 4, 0], radius: 0.34 },
      ],
    },
  ],
};
const fieldBefore = JSON.stringify(field);
const sampled = sampleProcPlantCrownAttractors(field, 512, 908);
const sampledAgain = sampleProcPlantCrownAttractors(field, 512, 908);
assert.deepEqual(sampled.map((point) => point.toArray()), sampledAgain.map((point) => point.toArray()));
assert.equal(JSON.stringify(field), fieldBefore, "spline sampling must not mutate authored control points");
for (const point of sampled) {
  assert.ok(point.y >= 0.1 && point.y <= 5.9 && Math.hypot(point.x, point.z) <= 1.05 + 1e-9);
  if (point.y >= 2 && point.y <= 4) {
    assert.ok(Math.hypot(point.x, point.z) > 0.34 - 1e-9, "subtractive spline must carve the positive spline volume");
  }
}
assert.deepEqual(deserializeProcPlantFreeformCrown(serializeProcPlantFreeformCrown(field)), field);
assert.notEqual(cloneProcPlantFreeformCrown(field).splines, field.splines);

const defaults = { center: [0, 2.5, 0] as const, dimensions: [2.4, 2.2, 1.8] as const };
const added = addProcPlantCrownSpline(null, defaults);
const addedBefore = structuredClone(added);
assert.deepEqual(added.splines.map((spline) => spline.id), ["spline-1"]);
assert.deepEqual(added.splines[0]!.points.map((point) => point.id), [
  "spline-1-point-1", "spline-1-point-2", "spline-1-point-3",
]);
const withPoint = addProcPlantCrownSplinePoint(added, "spline-1");
assert.deepEqual(added, addedBefore, "immutable add must not mutate its source field");
assert.deepEqual(withPoint.splines[0]!.points.slice(0, 3), added.splines[0]!.points, "adding a point must preserve the stable prefix");
assert.equal(withPoint.splines[0]!.points[3]!.id, "spline-1-point-4");
const moved = updateProcPlantCrownSplinePoint(withPoint, "spline-1", "spline-1-point-2", {
  position: [0.3, 3.1, -0.2],
  radius: 0.72,
});
assert.deepEqual(moved.splines[0]!.points[1], {
  id: "spline-1-point-2", position: [0.3, 3.1, -0.2], radius: 0.72,
});
assert.notEqual(moved.splines[0]!.points, withPoint.splines[0]!.points);
const removedPoint = removeProcPlantCrownSplinePoint(moved, "spline-1", "spline-1-point-4");
assert.deepEqual(removedPoint.splines[0]!.points.map((point) => point.id), [
  "spline-1-point-1", "spline-1-point-2", "spline-1-point-3",
]);
const secondSpline = addProcPlantCrownSpline(removedPoint, defaults);
assert.deepEqual(secondSpline.splines.map((spline) => spline.id), ["spline-1", "spline-2"]);
const onlySecond = removeProcPlantCrownSpline(secondSpline, "spline-1")!;
assert.equal(onlySecond.version, PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION);
assert.deepEqual((onlySecond as ProcPlantFreeformCrownV2).splines.map((spline) => spline.id), ["spline-2"]);
assert.equal(removeProcPlantCrownSpline(onlySecond, "spline-2"), null);
assert.throws(() => addProcPlantCrownSpline(null, { ...defaults, operation: "subtract" }), /requires an existing additive/);
assert.throws(() => removeProcPlantCrownSplinePoint({
  ...added,
  splines: [{ ...added.splines[0]!, points: added.splines[0]!.points.slice(0, 2) }],
}, "spline-1", "spline-1-point-1"), /at least two points/);

let capped: ProcPlantFreeformCrown = added;
for (let index = 1; index < PROCPLANT_CROWN_MAX_SPLINES; index++) capped = addProcPlantCrownSpline(capped, defaults);
assert.equal((capped as ProcPlantFreeformCrownV2).splines.length, PROCPLANT_CROWN_MAX_SPLINES);
assert.throws(() => addProcPlantCrownSpline(capped, defaults), /spline cap exceeded/);
assert.ok(serializeProcPlantFreeformCrown(secondSpline).length < 2_048, "typical spline state must remain practical for share URLs");
assert.throws(() => validateProcPlantFreeformCrown({
  ...field,
  splines: [{ ...field.splines[0]!, points: [{ ...field.splines[0]!.points[0]! }, { ...field.splines[0]!.points[0]! }] }],
}), /duplicate id/);
assert.throws(() => validateProcPlantFreeformCrown({
  ...field,
  splines: [{ ...field.splines[0]!, points: field.splines[0]!.points.map((point) => ({ ...point, position: [0, 1, 0] as const })) }],
}), /nonzero centerline/);

const preset = procPlantPresets.colonizedHazelShrub!;
const seed = 807_026;
const env = defaultPlantEnvironment();
const legacyTemplate = buildProcPlantTemplate(preset, seed, env);
const noSplineGenome = structuredClone(preset);
noSplineGenome.spaceColonization!.freeform = {
  contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
  version: PROCPLANT_FREEFORM_CROWN_SPLINE_VERSION,
  volumes: [{
    id: "base-volume",
    shape: noSplineGenome.spaceColonization!.volume.shape,
    center: noSplineGenome.spaceColonization!.volume.center,
    dimensions: noSplineGenome.spaceColonization!.volume.dimensions,
  }],
  splines: [],
};
const v1EquivalentGenome = structuredClone(noSplineGenome);
v1EquivalentGenome.spaceColonization!.freeform = {
  contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
  version: PROCPLANT_FREEFORM_CROWN_VERSION,
  volumes: noSplineGenome.spaceColonization!.freeform.volumes,
};
assert.equal(
  templateHash(buildProcPlantTemplate(noSplineGenome, seed, env).template),
  templateHash(buildProcPlantTemplate(v1EquivalentGenome, seed, env).template),
  "V2 without splines must compile byte-identically to the same V1 lobe field",
);

const splineGenome = structuredClone(preset);
splineGenome.spaceColonization!.freeform = addProcPlantCrownSpline(null, {
  center: splineGenome.spaceColonization!.volume.center,
  dimensions: splineGenome.spaceColonization!.volume.dimensions,
});
const splineTemplate = buildProcPlantTemplate(splineGenome, seed, env);
const splineTemplateAgain = buildProcPlantTemplate(splineGenome, seed, env);
assert.equal(templateHash(splineTemplate.template), templateHash(splineTemplateAgain.template));
assert.notEqual(templateHash(splineTemplate.template), templateHash(legacyTemplate.template));
assert.ok(splineTemplate.graph.stems.length > 24);
const authoringGraph = createProcPlantAuthoringGraph(splineGenome, seed);
assert.deepEqual(
  authoringGraph.nodes.find((node) => node.stage === "architecture")?.parameters?.freeformCrown,
  splineGenome.spaceColonization!.freeform,
  "V2 spline fields must persist in canonical crown-template state",
);

console.log(JSON.stringify({
  sampled: sampled.length,
  splines: field.splines.length,
  legacyHash: templateHash(legacyTemplate.template),
  splineHash: templateHash(splineTemplate.template),
  splineNodes: splineTemplate.graph.stems.length,
}));
console.log("procplant spline crown tests passed");
