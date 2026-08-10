# Tellus integration handoff

Updated: 2026-08-10

## Current boundary

Tellus `master` is currently `ffb3a9f`. Two clean, green draft PRs carry the Procplants integration:

- Tellus [#177](https://github.com/DavinciDreams/tellus/pull/177), commit `af47d95`, removes the 5,782-line vendored generator and pins `procplants/core` at exact SHA `e3a69da8404efb7a093d18c699c13373365578f8` through a thin contract-revision-3 adapter.
- Tellus [#178](https://github.com/DavinciDreams/tellus/pull/178), commit `0e14670`, is stacked on #177 and adopts package LOD0/LOD1/LOD2 geometry for eleven audited ground-cover cohorts.

Both PRs remain open drafts. Their CI, typecheck, and production builds pass, but neither is merged, served, or deployed. The local primary Tellus checkout is stale and dirty; use the isolated PR worktrees or a fresh worktree rather than treating it as authoritative.

Tellus remains WebGL by default because that renderer is currently faster there. WebGPU requires an explicit local opt-in and is not exercised by the ground-cover integration. Procplants' WebGPU compute and indexed-indirect evidence is a separate correctness experiment, not a Tellus runtime or performance claim.

## Ownership and default policy

Procplants owns deterministic genomes, graph/attachment IR, organ prototypes, geometry/UV tiers, generator contract revisioning, and renderer-independent LOD/visibility data. Tellus continues to own world placement, chunks, distance/render-pressure policy, shadows, materials, asset substitutions, renderer selection, and deployment verification.

The integration deliberately preserves Tellus policy:

- Automatic ecology uses a frozen Tellus-owned 13-preset allowlist.
- Nine new ground covers remain placement-only and cannot enter automatic paint/ecology mappings.
- Ground-cover cohorts do not cast or receive shadows in the validated field path.
- Phi Fern and Clover remain eligible under the existing explicit mappings; the other new varieties are opt-in.
- Package geometry costs do not override Tellus chunk, grass, shadow, or renderer policy.

## Contract revision 3

The producer and #177 use `PROCPLANT_GENERATOR_CONTRACT_REVISION === 3` and `fixtures/tellus-procplant-contract-v3.golden.json`. The acceptance fixture covers deterministic per-LOD geometry, bounds, sway, UV0, surface hashes, attachment/instance counts, and all 20 supported instance kinds including dedicated `fernFrond`.

In Procplants:

```powershell
npm run build:lib
npm run test:tellus-contract
npm run test:package-consumer
```

In Tellus #177, the tests resolve the installed `procplants/core` package and recompute the fixture evidence rather than importing the producer source tree. The adapter dispatches all 20 instance kinds exhaustively and supplies UV0 at every local renderer seam.

The exact #177 pin predates the cumulative authoring/DAG stack. Its geometry and revision-3 fixture remain compatible, but after the cumulative Procplants PR lands Tellus should pin the immutable merged SHA or a release and rerun the installed-package, contract, vegetation, cost, typecheck, and build gates.

## Geometry and field evidence

At canonical seed `612072`, current Procplants budgets are:

| Preset | LOD triangles | LOD vertices | Notes |
| --- | ---: | ---: | --- |
| Phi Fern | 352 / 264 / 4 / 2 | 1,056 / 792 / 8 / 4 | 8 `fernFrond` instances; about 1.23 by 1.61 ground coverage |
| Blue Spruce | 3,934 / 2,494 / 4 / 2 | 7,324 / 3,942 / 8 / 4 | Branch-relative conifer sprays |
| Alpine Fir | 5,190 / 3,174 / 4 / 2 | 8,388 / 4,509 / 8 / 4 | Branch-relative conifer sprays |
| Redwood Spire | 3,896 / 2,540 / 4 / 2 | 6,765 / 3,710 / 8 / 4 | Narrow conifer crown |
| Tundra Small Pine | 3,678 / 2,354 / 4 / 2 | 7,148 / 3,826 / 8 / 4 | Compact pine |
| Shore Pine | 1,596 / 1,080 / 4 / 2 | 4,692 / 3,168 / 8 / 4 | Includes package cone instances |

The Procplants `test:conifer-fern-budget` gate freezes these current vertex/triangle budgets and hashes. The frozen v2 Phi Fern was 1,872/624/4/2 triangles and 5,616/1,872/8/4 vertices, so revision 3 reduces its close tier by 81.2% while broadening the dedicated fern crown.

Tellus #178 validates eleven ground-cover cohorts through package detail, clustered, crossed-card, and omission tiers. Its deterministic field evidence is:

- 49 chunks, 180 plants, 114 renderer instances, 51,304 triangles, and 184 non-empty draws.
- 110.243 by 111.407 metres of placement coverage.
- Zero active ground-cover shadow casters, receivers, or proxies.
- A grass-coexistence chunk with 1,712 grass instances, 75,016 total triangles, and 9 draws.
- A low-FPS scheduling test that proves bounded queue work only; it is not an FPS benchmark.

These are deterministic scene-structure and cost checks. They do not instantiate a representative-device browser renderer, measure GPU time, or prove served/deployed capacity.

## Delivery sequence

1. Land the linear Procplants package/fern/declaration stack so exact SHA `e3a69da...` is reachable from `main`.
2. Publish and merge the validated cumulative Procplants integration rather than sequentially merging its many mutually conflicting draft siblings.
3. Merge Tellus #177 into `master`.
4. Retarget #178 to `master`, rerun CI, and merge it.
5. Repin Tellus to the cumulative merged Procplants SHA or immutable release and rerun installed fixture-v3 acceptance.
6. Run a controlled representative-device Tellus WebGL field test with fixed browser, power, shadow, grass, camera, and density conditions before changing any automatic variety defaults.

Do not use Procplants' standalone WebGPU result as a substitute for step 6. If Tellus revisits WebGPU later, treat renderer adoption, indirect drawing, and throughput as a separate opt-in project.

## Remaining consumer limits

- No representative-device Tellus WebGL FPS/capacity result exists yet.
- The nine new ground covers remain placement-only until that field validation is reviewed.
- Imported live KTX2 preview still needs a renderer-configured decoder.
- Compact GLB/USD/instancing output does not prove Tellus extension support, automatic consumer LOD selection, collision, or culling.
- Source/build/CI success is not deployment evidence.
