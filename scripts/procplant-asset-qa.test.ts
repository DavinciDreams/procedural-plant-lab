import assert from "node:assert/strict";
import { procPlantPresets } from "../src/procplants";
import {
  estimateProcPlantTextureBytes,
  inspectProcPlantAssetQa,
  PROCPLANT_ASSET_QA_PROFILES,
} from "../src/procplant-asset-qa";

const basic = inspectProcPlantAssetQa(procPlantPresets.phiFern, 42);
assert.equal(basic.profile, "tellus-realtime");
assert.equal(basic.version, 2);
assert.equal(basic.ready, true);
assert.equal(basic.attributes.sway, true);
assert.equal(basic.textures.estimatedBytes, 0);
assert.deepEqual(basic.exportContract.lodDistances, [0, 18, 42, 86]);
assert.equal(basic.exportContract.windPacking, "explicit-sway-phase");
assert.equal(basic.exportContract.metadataSchema, "procplants.runtime-package.v1");

const exactMipBytes = estimateProcPlantTextureBytes([{ id: "leaf", width: 1024, height: 512 }]);
assert.equal(exactMipBytes, Math.ceil(1024 * 512 * 4 * 4 / 3));
assert.equal(estimateProcPlantTextureBytes([{ id: "ktx", width: 1, height: 1, compressedBytes: 1234 }]), 1234);

const strict = inspectProcPlantAssetQa(procPlantPresets.phiFern, 42, undefined, "unity-urp", {
  textures: [{ id: "leaf", width: 4096, height: 4096, bytesPerChannel: 2 }],
  cutoutCoverage: 0.18,
  branchLeafIntersections: 3,
});
assert.equal(strict.ready, false);
assert.ok(strict.warnings.some((warning) => warning.includes("Texture memory")));
assert.ok(strict.warnings.some((warning) => warning.includes("UVs")));
assert.ok(strict.warnings.some((warning) => warning.includes("Tangents")));
assert.ok(strict.warnings.some((warning) => warning.includes("intersections")));
assert.ok(strict.overdraw.estimatedRatio > 1);

const supplied = inspectProcPlantAssetQa(procPlantPresets.phiFern, 42, undefined, "unity-urp", {
  providesUvs: true,
  providesTangents: true,
});
assert.ok(!supplied.warnings.some((warning) => warning.includes("required")));
assert.deepEqual(Object.keys(PROCPLANT_ASSET_QA_PROFILES).sort(), [
  "billboard-only",
  "cinema-hero",
  "mobile-low-poly",
  "tellus-realtime",
  "threejs-glb",
  "unity-urp",
  "unreal-foliage",
]);
for (const profile of Object.values(PROCPLANT_ASSET_QA_PROFILES)) {
  assert.equal(profile.exportContract.lodDistances.length, 4, `${profile.id} must define four LOD distances`);
  assert.ok(profile.exportContract.texture.maxDimension > 0, `${profile.id} must bound texture dimensions`);
  assert.ok(profile.exportContract.metadataSchema.startsWith("procplants."));
  if (profile.exportContract.billboard.enabled) {
    assert.ok(profile.exportContract.billboard.views > 0, `${profile.id} billboard profile needs capture views`);
    assert.ok(profile.exportContract.billboard.channels.includes("color"), `${profile.id} billboard profile needs color`);
  } else {
    assert.equal(profile.exportContract.billboard.views, 0);
  }
}

console.log("procplant asset QA tests passed");
