import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createProcPlantPruneTool,
  type ProcPlantNdcPoint,
} from "../src/procplant-prune-tool";
import type { ProcPlantGraph, ProcPlantSegmentRecord, ProcPlantStemNode } from "../src/procplants";

const segmentX = new Map([
  ["segment:z", -1],
  ["segment:a", 0],
  ["segment:m", 1],
]);

const makeNode = (position: THREE.Vector3, index: number): ProcPlantStemNode => ({
  position,
  direction: new THREE.Vector3(0, 1, 0),
  radius: 0.045,
  depth: 0,
  t: index % 2,
  index,
});

const createGraph = (recordOrder = ["segment:z", "segment:a", "segment:m"]): ProcPlantGraph => {
  const stems: ProcPlantStemNode[] = [];
  const segments: Array<[number, number]> = [];
  const recordsById = new Map<string, ProcPlantSegmentRecord>();
  for (const [id, x] of segmentX) {
    const startNodeIndex = stems.length;
    stems.push(makeNode(new THREE.Vector3(x, -0.7, 0), startNodeIndex));
    const endNodeIndex = stems.length;
    stems.push(makeNode(new THREE.Vector3(x, 0.7, 0), endNodeIndex));
    segments.push([startNodeIndex, endNodeIndex]);
    recordsById.set(id, {
      id,
      parentSegmentId: null,
      startNodeIndex,
      endNodeIndex,
      depth: 0,
      axialStart: 0,
      axialEnd: 1,
    });
  }
  return {
    stems,
    segments,
    organs: [],
    segmentRecords: recordOrder.map((id) => recordsById.get(id)!),
    attachments: [],
  };
};

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);
camera.updateProjectionMatrix();
camera.updateMatrixWorld(true);

const projected = (x: number, y: number) => new THREE.Vector3(x, y, 0).project(camera);
const lassoAround = (x: number): ProcPlantNdcPoint[] => {
  const bottom = projected(x, -0.7);
  const top = projected(x, 0.7);
  return [
    { x: bottom.x - 0.055, y: bottom.y - 0.055 },
    { x: bottom.x + 0.055, y: bottom.y - 0.055 },
    { x: top.x + 0.055, y: top.y + 0.055 },
    { x: top.x - 0.055, y: top.y + 0.055 },
  ];
};

{
  const tool = createProcPlantPruneTool(createGraph());
  assert.deepEqual(tool.segmentIds, ["segment:a", "segment:m", "segment:z"], "segment IDs must be stable-sorted");

  const left = projected(-1, 0);
  const center = projected(0, 0);
  assert.deepEqual(
    tool.findSegmentsFromNdcStroke([{ x: left.x, y: left.y }, { x: center.x, y: center.y }], camera, 0.002),
    ["segment:a", "segment:z"],
    "an open stroke must hit projected cylinder axes and return stable ID order",
  );
  assert.deepEqual(tool.getSelectedSegments(), [], "a find query must not mutate selection");

  assert.deepEqual(
    tool.findSegmentsFromNdcLasso([
      { x: 0.02, y: -0.02 },
      { x: 0.03, y: -0.02 },
      { x: 0.03, y: 0.02 },
      { x: 0.02, y: 0.02 },
    ], camera),
    ["segment:a"],
    "lasso overlap must include the projected cylinder radius, not only its center axis",
  );

  const strokeSelection = tool.selectSegmentsFromNdcStroke(
    [{ x: left.x, y: left.y }, { x: center.x, y: center.y }],
    camera,
    { mode: "replace", radiusNdc: 0.002 },
  );
  assert.deepEqual(strokeSelection.matchedSegmentIds, ["segment:a", "segment:z"]);
  assert.deepEqual(strokeSelection.selectedSegmentIds, ["segment:a", "segment:z"]);

  const additive = tool.selectSegmentsFromNdcLasso(lassoAround(1), camera, { mode: "additive" });
  assert.deepEqual(additive.matchedSegmentIds, ["segment:m"]);
  assert.deepEqual(additive.selectedSegmentIds, ["segment:a", "segment:m", "segment:z"]);
  assert.equal(tool.getSelectedSegment(), "segment:a", "multi-selection primary must be deterministic");

  const replacement = tool.selectSegmentsFromNdcLasso(lassoAround(-1), camera, { mode: "replace" });
  assert.deepEqual(replacement.selectedSegmentIds, ["segment:z"]);
  assert.deepEqual(tool.getSelectedSegments(), ["segment:z"]);

  const emptyAdditive = tool.selectSegmentsFromNdcStroke([], camera, { mode: "additive" });
  assert.deepEqual(emptyAdditive.matchedSegmentIds, []);
  assert.deepEqual(emptyAdditive.selectedSegmentIds, ["segment:z"], "empty additive gestures must retain selection");

  const emptyReplace = tool.selectSegmentsFromNdcLasso([], camera, { mode: "replace" });
  assert.deepEqual(emptyReplace.selectedSegmentIds, [], "empty replacement gestures must clear selection");
  tool.dispose();
}

{
  const first = createProcPlantPruneTool(createGraph(["segment:m", "segment:z", "segment:a"]));
  const second = createProcPlantPruneTool(createGraph(["segment:a", "segment:m", "segment:z"]));
  const all = [
    { x: -0.7, y: -0.5 },
    { x: 0.7, y: -0.5 },
    { x: 0.7, y: 0.5 },
    { x: -0.7, y: 0.5 },
  ];
  assert.deepEqual(
    first.findSegmentsFromNdcLasso(all, camera),
    second.findSegmentsFromNdcLasso(all, camera),
    "lasso results must not depend on graph record insertion order",
  );
  assert.deepEqual(first.findSegmentsFromNdcLasso(all, camera), ["segment:a", "segment:m", "segment:z"]);
  first.dispose();
  second.dispose();
}

{
  const tool = createProcPlantPruneTool(createGraph());
  tool.object.updateMatrixWorld(true);
  const click = tool.pickFromNdc(0, 0, camera);
  assert.equal(click?.segmentId, "segment:a", "existing click picking must remain compatible");
  assert.equal(tool.setSelectedSegment(click?.segmentId ?? null), true);
  assert.equal(tool.getSelectedSegment(), "segment:a");
  assert.deepEqual(tool.getSelectedSegments(), ["segment:a"]);
  assert.equal(tool.setSelectedSegment("missing"), false, "unknown click selections must still be rejected");
  tool.dispose();
}

console.log("procplant prune tool screen selection tests passed");
