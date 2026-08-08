# Tellus integration handoff

Updated: 2026-08-08

## Current boundary

The current Tellus default branch audited for this work is `origin/master` at `aa3942e`. The local primary checkout is older (`8b24052`); the two intervening commits are dependency/security maintenance and do not change the procedural-plant contract.

Tellus currently owns a divergent generator copy at `src/tellus-procplants.ts`. Its biome/runtime consumers include `src/tellus-procplant-biomes.ts`, `src/tellus-procplant-vegetation.ts`, `src/tellus-biome-mix.ts`, `src/tellus-procedural-assets.ts`, and `src/biome-mixer.ts`.

Default Tellus behavior must not be inferred from this repository alone:

- `phiFern` is currently routed to an external asset-store LOD2 model.
- Procedural `phiFern` and `blueSpruce` are excluded from global defaults.
- Tellus already owns its production chunk LOD, impostor, wind, culling, shadow, and asset-loading policy.
- The standalone lab now proves allocation-free per-placement LOD plus conservative clustered-frustum masking for eleven fern/ground-cover presets, but those distance bands and measurements are Procplants evidence, not a replacement for Tellus's render-pressure policy.

Therefore these Procplants improvements do not change a deployed/default Tellus biome until Tellus deliberately adopts the shared contract and updates those mappings.

## Validated integration worktree

An isolated Tellus worktree at `origin/master` (`aa3942e`) now accepts producer
contract revision 2 / fixture version 2. Its byte-identical golden fixture pins
UV0, complete bark/organ surface coverage, supported instance kinds, the runtime
LOD-selection tiers, biome asset-LOD normalization, and four representative
presets. This is an approval/provenance gate, not a claim that Tellus's vendored
generator reproduces the producer hashes.

The same worktree selectively adopted cost-only parity changes that are safe
without the future package adapter. No automatic biome mapping, asset fallback,
shadow, chunk LOD, or deployment default changed:

| Tellus preset | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Phi Fern | 6,384 tris | 312 tris | 95.1% |
| Clover Groundcover | 1,574 tris | 1,226 tris | 22.1% |
| Blue Spruce | 11,840 tris | 5,398 tris | 54.4% |
| Alpine Fir | 15,824 tris | 6,750 tris | 57.3% |

Phi Fern retains an approximately 1.45 by 1.45 local-unit footprint and Clover
approximately 1.11 by 1.29. Tellus typecheck, the full 53-test procplant
vegetation suite, the contract/cost gates, and the production build pass in that
worktree. These are source/build results; no served world or deployment was
changed or claimed.

Against a separate clean `origin/master` build at the same commit and toolchain,
the port adds only 915 raw / 280 gzip bytes to the procplant-biomes chunk
(0.59% / 0.67%). Main is identical in raw bytes, vendor-three is byte-identical,
and the other compared routes are unchanged within three gzip bytes.

## Safe adoption sequence

1. Build the reusable package with `npm run build:lib` and consume its canonical `procplants/core` surface for generator/schema/runtime contracts; use the full root entry only for authoring/export features. Do not copy `src/procplants.ts` again. The package now builds on `prepare`, keeps Vite tooling development-only, and declares the Tellus-tested Three.js `>=0.183.2 <0.184.0` peer range so the renderer owns one singleton. An immutable reviewed commit/package is still required before Tellus declares the runtime dependency.
2. Copy or generate `fixtures/tellus-procplant-contract-v2.golden.json` in Tellus CI and compare it before accepting a generator revision. This acceptance gate is implemented in the isolated Tellus worktree. In this repository, `npm run test:tellus-contract` checks drift and `npm run write:tellus-contract` regenerates the fixture after review.
3. Add a thin Tellus adapter around `ProcPlantGenome`, `buildProcPlantInstancedParts`, `compileProcPlantLods`, and `PROCPLANT_GENERATOR_CONTRACT_REVISION`. Keep Tellus-owned chunking, distance policy, shadows, wind uniforms, and asset substitutions outside the generator package.
4. The isolated Tellus worktree now exposes `maidenhairFernPatch` and `woodlandVioletCarpet` as explicit placement-only entries beside optimized `cloverGroundcover`, while keeping automatic paint/ecology mappings unchanged. Add the remaining groundcovers (`brackenFernMat`, `woodSorrelCarpet`, `woodlandAnemoneCarpet`, `creepingPhloxCarpet`, `wildStrawberryGroundcover`, `trilliumPatch`, and `horsetailColony`) only after field-density, shadow, grass-occupancy, and near/mid/far validation. Procplants has standalone pool evidence for these plus `phiFern` (73.5% fewer live biome triangles for Phi Fern and 59.4% for Clover at density 1), but Tellus must choose its own distances, shadow policy, and render-pressure response. The accessory-bearing `winterberryShrub`, `shorePineCones`, `thornyBramble`, and `epiphyticAroidRoots` should follow only after Tellus maps the new fruit/berry/cone/thorn/aerial-root instance kinds. Treat `climbingIvy`, `canopyLiana`, `floweringWallCreeper`, `hangingMoss`, and `cushionMoss` as a separate opt-in adoption: Tellus must map `mossTuft` and decide how authored static guide/support data relates to world geometry. `colonizedHazelShrub` is another opt-in backend and should be accepted only after Tellus validates its swept-tube vertex attributes and 4,898/2,457/4/2 LOD sequence. The low-cost `sugarMaple`, `weepingWillow`, `windsweptBonsai`, `deadwoodSnag`, and `twilightFantasyTree` presets are additive opt-ins and do not alter existing defaults.
5. Compare optimized procedural Phi Fern and conifers against the current external substitutions before changing defaults. Validate runtime frames and served/deployed behavior; source/build success alone is not deployment proof.
6. Treat generated UV0, baked-material GLBs, and `EXT_mesh_gpu_instancing` forest assets as separate opt-in consumer capabilities. Confirm Tellus texture/material conventions and extension support before enabling them; compact export is not evidence of Tellus runtime culling or deployment behavior.

## Contract ownership

- Procplants owns deterministic genomes, graph/attachment IR, organ prototypes, cutout/impostor atlas construction, compiled geometry/UV tiers, the generic placement LOD pool, optional density-map scatter plans, bounded instanced asset export, phyllotaxy, and generator contract revisioning.
- Tellus owns world placement, chunk lifecycle, camera/render-pressure LOD policy, shadow/reflection budgets, material integration, asset-store fallbacks, and deployment verification.
- `TellusProcPlantPackage.generatorContractRevision` is the compatibility gate. Biome mix `version: 1` and registry `version: 2` remain their existing serialized schema versions and must not be confused with the generator revision.
