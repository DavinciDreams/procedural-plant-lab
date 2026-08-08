import assert from "node:assert/strict";
import {
  applyProcPlantCutoutContourEdits,
  buildProcPlantCutoutGeometry,
  getProcPlantCutoutContourIds,
  validateProcPlantCutoutContours,
  type ProcPlantCutout,
} from "../src/procplant-cutout";
import { finalizeProcPlantFreehandContourStroke } from "../src/procplant-contour-editor-ui";

const square = (id: string): ProcPlantCutout => ({
  contract: "procplants.cutout",
  version: 1,
  id,
  width: 64,
  height: 64,
  threshold: 0.5,
  contour: [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ],
  contours: [[
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ]],
  metadata: {
    pivot: { x: 0.5, y: 0 },
    attachment: { x: 0.5, y: 0 },
    bendAxis: { origin: { x: 0.5, y: 0 }, direction: { x: 0, y: 1 } },
  },
});

const original = square("leaf");
const originalJson = JSON.stringify(original);
assert.deepEqual(getProcPlantCutoutContourIds(original), ["leaf:contour:0"]);

const edited = applyProcPlantCutoutContourEdits(original, [
  { kind: "move-point", contourId: "leaf:contour:0", pointIndex: 2, point: { x: 0.82, y: 0.92 } },
  { kind: "insert-point", contourId: "leaf:contour:0", afterPointIndex: 2, point: { x: 0.48, y: 0.98 } },
  {
    kind: "add-contour",
    contourId: "leaf:hole:center",
    points: [
      { x: 0.4, y: 0.4 },
      { x: 0.4, y: 0.6 },
      { x: 0.6, y: 0.6 },
      { x: 0.6, y: 0.4 },
    ],
  },
]);
assert.equal(JSON.stringify(original), originalJson, "editing must not mutate the source cutout");
assert.equal(edited.operationsApplied, 3);
assert.deepEqual(edited.contourIds, ["leaf:contour:0", "leaf:hole:center"]);
assert.equal(edited.cutout.topology?.[1]?.role, "hole");
assert.equal(edited.cutout.contours[0]?.length, 5);
const geometry = buildProcPlantCutoutGeometry(edited.cutout);
assert.ok((geometry.index?.count ?? 0) > 0, "edited contours must remain triangulatable");
geometry.dispose();

const continued = applyProcPlantCutoutContourEdits(edited.cutout, [
  { kind: "move-point", contourId: "leaf:hole:center", pointIndex: 0, point: { x: 0.38, y: 0.4 } },
], { contourIds: edited.contourIds });
assert.equal(continued.cutout.contours[1]?.[0]?.x, 0.38, "returned stable IDs must support subsequent edits");

assert.throws(() => applyProcPlantCutoutContourEdits(original, [
  { kind: "move-point", contourId: "leaf:contour:0", pointIndex: 1, point: { x: 0.9, y: 0.9 } },
]), /zero-length edge/, "duplicate adjacent points must be rejected");
assert.throws(() => applyProcPlantCutoutContourEdits(original, [
  { kind: "move-point", contourId: "leaf:contour:0", pointIndex: 1, point: { x: 0.9, y: 1.2 } },
]), /outside normalized cutout bounds/);

const bowTie = [[
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.1 },
]];
assert.ok(validateProcPlantCutoutContours(bowTie).some((issue) => issue.code === "self-intersection"));
assert.throws(() => applyProcPlantCutoutContourEdits(original, [
  { kind: "move-point", contourId: "leaf:contour:0", pointIndex: 1, point: { x: 0.9, y: 0.9 } },
  { kind: "move-point", contourId: "leaf:contour:0", pointIndex: 2, point: { x: 0.1, y: 0.9 } },
  { kind: "move-point", contourId: "leaf:contour:0", pointIndex: 3, point: { x: 0.9, y: 0.1 } },
]), /invalid cutout contour edit/);

const outOfBounds = applyProcPlantCutoutContourEdits(original, [
  { kind: "move-point", contourId: "leaf:contour:0", pointIndex: 2, point: { x: 1.05, y: 0.9 } },
], { allowOutOfBounds: true });
assert.equal(outOfBounds.issues[0]?.code, "out-of-bounds", "permissive edits must retain an explicit audit issue");

const sampledContour = finalizeProcPlantFreehandContourStroke([
  { x: 0.24, y: 0.24 }, { x: 0.35, y: 0.24 }, { x: 0.48, y: 0.24 },
  { x: 0.48, y: 0.35 }, { x: 0.48, y: 0.48 }, { x: 0.35, y: 0.48 },
  { x: 0.24, y: 0.48 }, { x: 0.24, y: 0.35 }, { x: 0.242, y: 0.242 },
]);
assert.deepEqual(sampledContour, finalizeProcPlantFreehandContourStroke([
  { x: 0.24, y: 0.24 }, { x: 0.35, y: 0.24 }, { x: 0.48, y: 0.24 },
  { x: 0.48, y: 0.35 }, { x: 0.48, y: 0.48 }, { x: 0.35, y: 0.48 },
  { x: 0.24, y: 0.48 }, { x: 0.24, y: 0.35 }, { x: 0.242, y: 0.242 },
]), "freehand sampling and simplification must be deterministic");
assert.equal(sampledContour.length, 4, "collinear samples and the near-closure point should simplify away");

const withDrawnHole = applyProcPlantCutoutContourEdits(original, [{
  kind: "add-contour",
  contourId: "leaf:drawn:hole",
  points: sampledContour,
}]);
const holeIndex = withDrawnHole.contourIds.indexOf("leaf:drawn:hole");
assert.equal(withDrawnHole.cutout.topology?.[holeIndex]?.role, "hole", "containment should classify a drawn inner contour as a hole");

const drawnIsland = finalizeProcPlantFreehandContourStroke([
  { x: 0.31, y: 0.31 }, { x: 0.41, y: 0.31 }, { x: 0.41, y: 0.41 }, { x: 0.31, y: 0.41 },
]);
const withDrawnIsland = applyProcPlantCutoutContourEdits(withDrawnHole.cutout, [{
  kind: "add-contour",
  contourId: "leaf:drawn:island",
  points: drawnIsland,
}], { contourIds: withDrawnHole.contourIds });
const islandIndex = withDrawnIsland.contourIds.indexOf("leaf:drawn:island");
assert.equal(withDrawnIsland.cutout.topology?.[islandIndex]?.role, "island", "nested containment should rebuild a drawn island");

assert.throws(() => finalizeProcPlantFreehandContourStroke([
  { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.2 },
]), /intersect/, "self-crossing freehand strokes must be rejected");
assert.throws(() => finalizeProcPlantFreehandContourStroke([
  { x: -0.1, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.5 },
]), /outside normalized cutout bounds/, "out-of-bounds freehand strokes must be rejected");
assert.throws(() => finalizeProcPlantFreehandContourStroke([
  { x: 0.5, y: 0.5 }, { x: 0.502, y: 0.5 }, { x: 0.502, y: 0.502 }, { x: 0.5, y: 0.502 },
], { minimumPointSpacing: 0.0001 }), /too small/, "tiny freehand strokes must be rejected");
const boundaryCrossing = finalizeProcPlantFreehandContourStroke([
  { x: 0.05, y: 0.45 }, { x: 0.2, y: 0.35 }, { x: 0.2, y: 0.55 },
]);
assert.throws(() => applyProcPlantCutoutContourEdits(original, [{
  kind: "add-contour", contourId: "leaf:drawn:crossing", points: boundaryCrossing,
}]), /intersects/, "the edit API must reject a freehand contour that crosses an existing boundary");

console.log("ok 1 - stable immutable direct contour editing");
console.log("ok 2 - topology and geometry rebuild after point/island operations");
console.log("ok 3 - invalid bounds, duplicates, and self-intersections are audited and rejected");
console.log("ok 4 - deterministic freehand contours rebuild island and hole topology");
console.log("ok 5 - invalid freehand strokes are rejected before editing");
console.log("1..5");
