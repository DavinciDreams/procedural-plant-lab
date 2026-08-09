# Procplants performance review

Updated: 2026-08-08

This report separates deterministic geometry/build evidence from live standalone-browser evidence and from downstream Tellus deployment proof.

## Production load shape

`npm run build` currently produces:

| Resource | Raw | Gzip | Load policy |
| --- | ---: | ---: | --- |
| Bootstrap entry | 0.95 kB | 0.53 kB | Initial; paints explicit loading/error state and starts the lab import |
| Lab application | 106.20 kB | 32.75 kB | Dynamic bootstrap dependency |
| Shared generator/presets | 798.83 kB | 208.61 kB | Dynamic bootstrap dependency; fetched with the lab and includes required generated UV0 |
| Styles | 5.76 kB | 1.95 kB | Initial |
| Three.js visibility/LOD adapter | 6.75 kB | 2.05 kB | Lazy after worker-backed LOD installation; live frustum-mask integration |
| Visibility cluster selector | 6.90 kB | 2.58 kB | Lazy with the visibility adapter |
| Instance LOD pool | 8.69 kB | 2.77 kB | Lazy after worker-backed LOD installation |
| Generator graph editor + authoring adapter | 46.51 kB | 13.62 kB | Lazy |
| Macro rules | 10.06 kB | 3.04 kB | Lazy; loaded only for non-zero macros |
| Cutout tracing/topology | 15.57 kB | 5.89 kB | Lazy |
| Cutout point/freehand editor | 9.49 kB | 3.71 kB | Lazy after opening the editor |
| Three.js impostor capture/runtime | 25.37 kB | 8.69 kB | Lazy after explicit bake; includes live normal/depth/season adoption and channel export |
| Grouped UV/tangent Three geometry | 4.95 kB | 2.02 kB | Lazy after explicit PBR bake or GLB authoring; default preview uploads no tangent/secondary-UV buffers |
| Live baked Three PBR adapter | 11.86 kB | 4.18 kB | Lazy after explicit PBR bake; owns color-space-correct base/ORM/normal textures |
| Impostor atlas compiler | 11.25 kB | 4.27 kB | Shared lazy chunk |
| Dense impostor placement pool | 7.66 kB | 2.75 kB | Lazy after explicit bake with a matching cohort |
| Debug, pruning, trim, and GLB authoring facade | 33.55 kB | 11.62 kB | Lazy on first authoring interaction |
| Crown-volume viewport handles | 14.74 kB | 4.35 kB | Lazy after enabling Crown Handles; includes transformed positive/subtractive lobe state/tools |
| Branch-relative organ placement overrides | 6.56 kB | 2.43 kB | Lazy after entering Place mode |
| Hero GLB spine authoring + material baking | 46.85 kB | 15.14 kB | Lazy after explicit import or material bake; loader code remains split |
| Hero manual-spine viewport editor | 10.12 kB | 3.32 kB | Lazy after enabling Spine Handles on an imported hero |
| Three GLTFLoader | 44.72 kB | 13.50 kB | Lazy with GLB import/validation |
| Three KTX2Loader | 59.47 kB | 24.24 kB | Lazy with KTX2-bearing imported GLBs; loader support is not texture encoding |
| Per-organ seasonal/material masks | 3.22 kB | 1.53 kB | Lazy on JSON export; also available from the runtime library |
| Asset QA | 6.50 kB | 2.50 kB | Lazy |
| Procplant GLB facade | 12.38 kB | 4.91 kB | Lazy |
| Three GLB exporter | 36.34 kB | 10.76 kB | Lazy |
| Meshopt encoder | 20.60 kB | 8.24 kB | Lazy and opt-in during compressed GLB export |
| EZ-tree vendor backend | 3,998.39 kB | 2,986.72 kB | Separate optional worker/backend chunk |

The complete reusable ESM entry is 914.96 kB raw / 232.17 kB gzip transitively after adding the public grouped-surface, tangent-ready Three geometry, live baked-material, grouped GLB-binding, growth/topology, crown-light, mesh/BVH, PNG, handler-backed graph-authoring, collar, attachment-relaxation, dense/multi-channel impostor, spatial-force, organ-placement/variants, Weber-Penn trim, runtime LOD, USDA, multi-scene and instanced export, meshopt, GLB validation/hero import and spine authoring/editor, clustered visibility, WebGPU visibility planning, and constructive-crown APIs. The `procplants/core` runtime/Tellus entry is 358.68 kB raw / 83.59 kB gzip transitively: 60.8% less raw and 64.0% less gzip than the full entry, with no GLTFExporter, Three PBR/tangent adapter, meshopt encoder/decoder, GLB importer/validator, hero-spine authoring, material authoring/baking/binding graph, or LOD-worker dependency. It does include generated UV0, renderer-independent surface-partition and CPU/WebGPU visibility contracts, and compiler/runtime contracts for downstream dense vegetation. Both stable entry paths share one deterministic content-hashed compiler/Tellus chunk, and reproducibility checks cover every emitted file. The expensive EZ-tree backend is not folded into either library entry. Three.js is a peer (`>=0.183.2 <0.184.0`) tested at the same 0.183.2 runtime/0.183.1 types used by Tellus; Vite tooling is development-only and `prepare` rebuilds packed or Git installs. The final dry-run package is 434,028 bytes packed / 1,722,282 bytes unpacked across 169 entries.

After the new authoring controls were present, the explicit bootstrap makes the parser-discovered JavaScript entry 0.95 kB raw / 0.53 kB gzip instead of the previous 103.60 / 31.96 kB lab entry. It paints a real loading/error state, then Vite's dynamic-preload helper fetches the 106.20/32.75 kB lab and 798.83/208.61 kB shared generator dependency together. This improves first-paint and initial parse work; it does not claim lower total bytes before the first plant is interactive. The 4.95/2.03 kB tangent geometry adapter, 11.86/4.18 kB live PBR adapter, and 10.12/3.32 kB manual-spine editor remain lazy. A browser resource-timing assertion proves graph, material/import, tangent, macro, contour, and crown authoring chunks are absent before their first interaction.

## Geometry reductions

Close-range deterministic compiler measurements:

| Preset | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Phi Fern, full clump | 13,424 tris | 1,872 tris | 86.1% |
| Phi Fern, baked card component | 4,044 tris | 312 tris | 92.3% |
| Blue Spruce | 11,780 tris | 4,230 tris | 64.1% |
| Alpine Fir | 15,444 tris | 5,190 tris | 66.4% |
| Redwood Spire | 10,776 tris | 3,888 tris | 63.9% |

The new broad-area ground covers use cards/low-poly organs and are covered by regression budgets. Close LOD counts remain strictly decreasing and terminate at four-triangle crossed cards and two-triangle single cards.

Required UV0 adds exactly 8 bytes per vertex to in-memory templates and worker transfers. This is a deliberate geometry-memory tradeoff: every real LOD now has deterministic finite texture coordinates, swept bark retains tiling beyond one, and GLB export no longer has to invent coordinates before binding PBR maps.

The added maidenhair fern, woodland violet, trillium, and horsetail patches cover roughly 1.8-2.1 by 1.8-2.0 local units at 1,312, 1,256, 628, and 1,908 close triangles respectively. Their LOD1 tiers are 656, 658, 314, and 1,060 triangles, followed by the common 4/2-triangle far tiers.

## Live placement LOD evidence

The lab now migrates Weber-Penn trees, canonical graph-backed woody cohorts, and eleven audited fern/ground-cover presets through real compiled geometry tiers. Pools reuse fixed matrices/arrays, update only after camera movement, use hysteresis, and install atomically after worker success.

The reusable dense-impostor benchmark puts 1,024 Phi-Fern-equivalent placements into plant-local atlas-view buckets: 1,916,928 full triangles become 2,048 billboard triangles (99.893% lower), and 1,024 naive card draws become at most 8 occupied-view draws. A masked 1,024-placement reference rendered 342 eligible placements as 684 triangles while excluding 682 near-tier placements, matrix-for-matrix equivalent to a filtered reference. The standalone lab now adopts this path for the current same-preset/seed cohort's LOD3 assignments after an explicit hero bake; this is not evidence of Tellus adoption.

The reusable placement LOD pool now has an optional conservative clustered max-distance broad phase. On a 10,000-placement parity grid it reduced exact square-root/LOD resolutions from 10,000 to 1,024 (89.76%) across 197 clusters while preserving placement assignments, callback order, hysteresis transitions, and every active matrix byte. The immutable cluster/index/mask metadata occupied 246,517 bytes (24.65 bytes per placement); omitting the option retains the exact legacy scan.

The standalone lab now supplies the pool with an exact conservative Three.js frustum mask through a reusable adapter. A production Phi Fern browser smoke observed 41 visibility clusters covering 76 candidate placements and kept the visible set byte-stable through the pool; its camera happened to reject no clusters, so this is adoption/lifecycle evidence rather than a claimed culling-rate benchmark.

The reusable WebGPU seam now emits bounded immutable buffer plans, WGSL reset/classify/finalize kernels, LOD-compacted instance indices, and indexed indirect draw commands with device-limit checks and a byte-exact CPU reference oracle. Tests cover dispatch ordering and parity, but no WebGPU device, render bundle, or live indirect draw is wired in the lab or Tellus yet.

Multi-channel impostors cost `width × height × 4` bytes per channel/view. At 128², color, normal, and depth together are 192 KiB per view before atlas gutters; seasons multiply that packed-atlas cost. Color-only output remains byte/hash-identical to the legacy atlas, so channels add no cost unless requested.

The real Chrome WebGL 2 smoke captured aligned 51x72 summer/winter color/normal/depth atlases through ANGLE Vulkan SwiftShader. Its alpha-tested checkerboard preserved 512 opaque and 512 transparent interior pixels; the enhanced hero, color-only hero, and dense path produced distinct stable hashes; two visible dense placements used one draw and shared the hero material; and target face/mip, viewport, scissor, clear, XR, and source-material state all restored exactly. This proves browser shader execution and standalone adoption, not Tellus material adoption or native-GPU performance.

The production browser UI smoke also baked a mixed Clover plant into six 256x256 RGBA resources, installed two normal-mapped live materials over four exact source ranges with explicit tangents, and audited 1,572,864 owned texture bytes. Its real toolbar export emitted a deterministic material-bound GLB hash and mapped both active-LOD primitives to explicit baked slots. The default path still allocates no tangent/secondary-UV GPU buffers and fetches neither Three PBR adapter before the user selects Bake.

A deterministic two-variant, four-real-LOD, bounds-collision sample with UV0 and explicit bark/organ primitives occupies 473,092 bytes as one multi-scene GLB versus 447,300 bytes as separate GLBs: 25,792 bytes (5.77%) of honest scene/root/runtime-LOD-metadata/collision-isolation overhead in exchange for one addressable asset.

Opt-in lossless `EXT_meshopt_compression` reduces grouped UV-bearing Phi Fern LOD0 from 363,304 to 142,372 bytes (60.81%), Shore Pine LOD0 from 349,560 to 144,864 bytes (58.56%), and the two-season/all-LOD Clover bundle from 473,092 to 233,976 bytes (50.54%). Tests decode every compressed buffer view byte-for-byte and load the actual CLI GLB through Three's GLTFLoader. The public `validate <asset.glb>` path repeats bounded structural/accessor/metadata checks and real decoder work on emitted required/fallback assets; fallback views are compared byte-for-byte. This is geometry compression only and makes no texture-compression claim.

Native `EXT_mesh_gpu_instancing` export writes one selected template/LOD plus TRS accessors. A 10,000-instance triangle-template GLB with explicit organ-surface metadata is 405,108 bytes (40.51 bytes per placement including geometry and container overhead), round-trips through Three GLTFLoader as one `InstancedMesh`, and preserves every float32 matrix within tolerance. It requires consumer extension support and does not claim frustum culling, indirect draws, per-instance collision, or proven meshopt composition.

At density 1 in the production build:

| Cohort | Pooled | LOD0/1/2/3 | Full biome tris | Active biome tris | Saved |
| --- | ---: | --- | ---: | ---: | ---: |
| Phi Fern | 94 | 0/4/67/23 | 235,560 | 62,402 | 173,158 (73.5%) |
| Clover Groundcover | 94 | 0/4/67/23 | 101,676 | 41,290 | 60,386 (59.4%) |

The final headless Chrome check reproduced the Phi Fern values and reported no pending hero worker. Hybrids, imported cutouts, active trim, and unsupported backends deliberately keep complete fallback geometry.

## CPU and lifecycle changes

- Dense scenes reuse at most 16 deterministic prototypes instead of rebuilding every placement.
- Stems and organs are instanced/batched with static buffer usage.
- Tree and hero LOD compilation is cancellable, worker-backed, cached, and swapped only after complete success.
- Hidden tabs pause animation work.
- Camera LOD updates avoid per-frame geometry or array allocation.
- A sub-kilobyte bootstrap paints loading/error feedback before the larger lab and generator modules parse.
- QA, graph editing, manual hero-spine handles, macro rules, cutout tracing/point/freehand editing, debug/pruning/trim tools, impostor baking/dense pooling, GLB export, loaders, and the vendor tree backend stay off the initial execution path until requested.

## Boundaries

- The hero LOD3 and matching live biome far placements use the baked atlas after an explicit 16-view bake. Other species/seeds and all sessions without a user bake keep geometric far cards; startup never captures atlases.
- Ground-cover pool savings start after the worker result; initial fallback generation still occurs so failure cannot blank the scene.
- Scattered instances only cast shadows for `tree`, `conifer`, and `palm` habits, and ground-cover LOD pools set `castShadow` false, so in shrub/vine/ground-cover scenes the hero is the only shadow caster. This reads as intentional render-pressure control but is an unannotated conditional; confirm it against the Tellus shadow budget before treating it as contract.
- These measurements prove the standalone Procplants build. Tellus owns different chunking, render-pressure, shadow, asset-substitution, and deployment behavior; the integration handoff requires opt-in runtime validation there.

## Tellus parity worktree evidence

The isolated Tellus `origin/master` worktree accepts the strengthened producer
fixture and compiles a selective cost-only parity port without changing any
automatic biome/default policy. At seed 612072, Tellus materialized Phi Fern at
352 rather than 6,384 triangles, Clover at 1,226 rather than 1,574, Blue Spruce
at 5,398 rather than 11,840, and Alpine Fir at 6,750 rather than 15,824. Phi
retains an approximately 1.23 by 1.61 footprint and Clover 1.11 by 1.29. The
Tellus typecheck, full 54-test vegetation suite, contract/cost tests, and
production build pass. This proves local source/build compatibility only; no
served world, GPU frame profile, default asset substitution, or deployment was
changed.

The final companion worktree adds placement-only Maidenhair Fern and Woodland
Violet templates at 2,112 and 2,276 close triangles (Clover remains 1,226),
keeps all three out of automatic mappings, and passes 57 focused tests. Against
the same baseline, the `tellus-procplant-biomes` chunk grows 2,198 raw bytes
(1.43%) and 508 level-9 gzip bytes (1.21%); main and shared Three.js stay
effectively byte-identical.

A byte-for-byte production-bundle comparison against a second clean
`origin/master` worktree localizes the integration cost to the procplant-biomes
chunk: 154,248 to 155,163 raw bytes (+915, 0.59%) and 42,042 to 42,322 gzip
bytes (+280, 0.67%). The main bundle is byte-identical in raw size, vendor-three
is identical, and the other compared route chunks differ by at most three gzip
bytes.
