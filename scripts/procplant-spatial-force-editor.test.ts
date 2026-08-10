import assert from "node:assert/strict";
import {
  appendProcPlantSpatialForceField,
  createProcPlantSpatialForceEditorState,
  deserializeProcPlantSpatialForceEditorState,
  moveProcPlantSpatialForceField,
  parseProcPlantSpatialForceEditorState,
  removeProcPlantSpatialForceField,
  serializeProcPlantSpatialForceEditorState,
  updateProcPlantSpatialForceField,
  applyProcPlantSpatialForceFields,
} from "../src/procplant-spatial-force-editor-ui";
import {
  buildProcPlantTemplate,
  buildProcPlantTemplateFromGraph,
  defaultPlantEnvironment,
  procPlantPresets,
} from "../src/procplants";

let state = createProcPlantSpatialForceEditorState();
for (const type of ["direction", "attract", "magnet", "repel", "avoid", "curl"] as const) {
  state = appendProcPlantSpatialForceField(state, type);
}
assert.deepEqual(state.fields.map((field) => field.type), ["direction", "attract", "magnet", "repel", "avoid", "curl"]);
assert.ok(state.fields[0]!.direction);
assert.equal(state.fields[1]!.direction, undefined);
assert.ok(state.fields[5]!.direction);
const roundTrip = deserializeProcPlantSpatialForceEditorState(serializeProcPlantSpatialForceEditorState(state));
assert.deepEqual(roundTrip, state);

const firstId = state.fields[0]!.id;
const secondId = state.fields[1]!.id;
state = moveProcPlantSpatialForceField(state, secondId, -1);
assert.deepEqual(state.fields.slice(0, 2).map((field) => field.id), [secondId, firstId]);
state = updateProcPlantSpatialForceField(state, firstId, { radius: 2.25, strength: -0.35, falloff: 3 });
assert.equal(state.fields.find((field) => field.id === firstId)!.radius, 2.25);
state = removeProcPlantSpatialForceField(state, secondId);
assert.equal(state.fields.some((field) => field.id === secondId), false);

assert.throws(() => updateProcPlantSpatialForceField(state, firstId, { radius: 0 }), /radius/);
assert.throws(() => updateProcPlantSpatialForceField(state, firstId, { strength: 2 }), /strength/);
assert.throws(() => updateProcPlantSpatialForceField(state, firstId, { direction: [0, 0, 0] }), /non-zero/);
assert.throws(() => parseProcPlantSpatialForceEditorState({ ...state, version: 2 }), /unsupported/);
assert.throws(() => deserializeProcPlantSpatialForceEditorState("{"), /JSON/);

let capped = createProcPlantSpatialForceEditorState();
for (let index = 0; index < 64; index++) capped = appendProcPlantSpatialForceField(capped, "attract");
assert.equal(capped.fields.length, 64);
assert.throws(() => appendProcPlantSpatialForceField(capped, "attract"), /cap/);

const genome = procPlantPresets.understoryShrub!;
const environment = defaultPlantEnvironment();
const canonical = buildProcPlantTemplate(genome, 77102, environment);
const canonicalPositions = Array.from(canonical.template.pos);
const target = canonical.graph.stems.at(-1)!.position;
const active = createProcPlantSpatialForceEditorState();
active.fields = [{
  contract: "procplants.spatial-force-field",
  version: 1,
  id: "field-live",
  type: "direction",
  position: [target.x, target.y, target.z],
  direction: [1, 0, 0],
  radius: 100,
  strength: 0.25,
  falloff: 1,
}];
const applied = applyProcPlantSpatialForceFields(canonical.graph, active.fields, {
  iterations: active.iterations,
  maximumDisplacement: active.maximumDisplacement,
});
assert.ok(applied.audit.affectedNodes > 0);
assert.equal(applied.audit.fieldCount, 1);
const rebuilt = buildProcPlantTemplateFromGraph(genome, applied.graph, environment);
assert.notDeepEqual(Array.from(rebuilt.template.pos), canonicalPositions, "active fields must rebuild real geometry");
const reset = applyProcPlantSpatialForceFields(canonical.graph, [], {
  iterations: active.iterations,
  maximumDisplacement: active.maximumDisplacement,
});
assert.equal(reset.graph, canonical.graph, "reset/no fields must preserve the exact canonical graph reference");
assert.deepEqual(Array.from(canonical.template.pos), canonicalPositions, "force authoring must not mutate canonical bytes");

console.log("ok 1 - all supported field modes round-trip through versioned editor JSON");
console.log("ok 2 - order, edit, removal, and hard caps validate fail closed");
console.log("ok 3 - active editor fields rebuild real graph geometry");
console.log("ok 4 - reset preserves exact canonical graph and template bytes");
console.log("1..4");
