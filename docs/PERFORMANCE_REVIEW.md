# Procplants performance review

Updated: 2026-08-10

This report separates deterministic geometry/build evidence from live standalone-browser evidence and from downstream Tellus deployment proof.

## Production load shape

`npm run build` currently produces:

| Resource | Raw | Gzip | Load policy |
| --- | ---: | ---: | --- |
| Bootstrap entry | 0.95 kB | 0.53 kB | Initial; paints explicit loading/error state and starts the lab import |
| Dynamic preload helper | 1.82 kB | 0.93 kB | Initial bootstrap dependency |
| Lab application | 141.35 kB | 42.36 kB | Dynamic bootstrap dependency; includes the opt-in hierarchical-wind installation seam |
| Shared generator/presets | 852.04 kB | 224.06 kB | Dynamic bootstrap dependency; fetched with the lab and includes required generated UV0 |
| Styles | 8.40 kB | 2.47 kB | Initial |
| Enforced interactive static closure | 1,004.56 kB | 269.32 kB | Entry, helper, styles, lab, and shared presets; capped at 1.05 MB raw / 280 kB gzip by `test:startup-load` |
| Three.js visibility/LOD adapter | 6.75 kB | 2.05 kB | Lazy after worker-backed LOD installation; live frustum-mask integration |
| Visibility cluster selector | 6.90 kB | 2.58 kB | Lazy with the visibility adapter |
| `procplants/webgpu` package entry | 48.17 kB | 13.26 kB | Explicit downstream import only; includes planning, injected-device execution, and indexed-indirect encoding while remaining absent from browser startup/root/core entry graphs |
| Instance LOD pool | 8.69 kB | 2.77 kB | Lazy after worker-backed LOD installation |
| Generator graph editor + authoring adapter | 117.55 kB | 30.62 kB | Lazy; includes validated stage activation, same-stage copy/paste, placement/scope controls, and diagnostics |
| Macro rules | 10.06 kB | 3.04 kB | Lazy; loaded only for non-zero macros |
| Cutout tracing/topology | 16.31 kB | 6.15 kB | Lazy; includes authored card-normal orientation |
| Cutout point/freehand editor | 9.49 kB | 3.71 kB | Lazy after opening the editor |
| Three.js impostor capture/runtime | 25.37 kB | 8.69 kB | Lazy after explicit bake; includes live normal/depth/season adoption and channel export |
| Grouped UV/tangent Three geometry | 4.95 kB | 2.02 kB | Lazy after explicit PBR bake or GLB authoring; default preview uploads no tangent/secondary-UV buffers |
| Live baked Three PBR adapter | 11.86 kB | 4.18 kB | Lazy after explicit PBR bake; owns color-space-correct base/ORM/normal textures |
| Impostor atlas compiler | 11.25 kB | 4.27 kB | Shared lazy chunk |
| Dense impostor placement pool | 7.66 kB | 2.75 kB | Lazy after explicit bake with a matching cohort |
| Debug, pruning, trim, and GLB authoring facade | 21.22 kB | 6.73 kB | Lazy on first authoring interaction |
| Crown-volume viewport handles | 16.24 kB | 4.64 kB | Lazy after enabling Crown Handles; includes transformed positive/subtractive lobe and spline state/tools |
| Branch-relative organ placement overrides | 6.56 kB | 2.43 kB | Lazy after entering Place mode |
| Hero GLB spine authoring + material baking | 60.77 kB | 19.65 kB | Lazy after explicit import or material bake; loader code remains split |
| Hero manual-spine viewport editor | 10.12 kB | 3.32 kB | Lazy after enabling Spine Handles on an imported hero |
| Three GLTFLoader | 44.72 kB | 13.50 kB | Lazy with GLB import/validation |
| Three KTX2Loader | 59.47 kB | 24.24 kB | Lazy with KTX2-bearing imported GLBs; loader support is not texture encoding |
| Per-organ seasonal/material masks | 3.22 kB | 1.53 kB | Lazy on JSON export; also available from the runtime library |
| Asset QA | 8.79 kB | 2.90 kB | Lazy; every named profile carries explicit texture/LOD/wind/billboard/collision/metadata policy |
| Procplant GLB facade | 12.38 kB | 4.91 kB | Lazy |
| Three GLB exporter | 36.34 kB | 10.76 kB | Lazy |
| Meshopt encoder | 20.60 kB | 8.24 kB | Lazy and opt-in during compressed GLB export |
| EZ-tree vendor backend | 3,998.39 kB | 2,986.72 kB | Separate optional worker/backend chunk |

The complete reusable ESM entry is 1,168,295 bytes raw / 293,615 bytes gzip transitively after adding the public grouped-surface, tangent-ready Three geometry, live baked-material, grouped GLB-binding, damage/growth/topology, crown-light, mesh/BVH, PNG, validated graph authoring, specialized typed DAG adapters, collar, attachment-relaxation, dense/multi-channel impostor, spatial-force, organ-placement/variants, Weber-Penn trim, both runtime LOD contracts, USDA, multi-scene and instanced export, meshopt, GLB validation/hero import and spine authoring/editor, clustered visibility, WebGPU visibility planning, and constructive-crown APIs. The opt-in five-tier compiler/export adds 18,554 raw / 5,183 gzip bytes to the full entry. The `procplants/core` runtime/Tellus entry remains 551,301 bytes raw / 129,227 bytes gzip transitively: 52.8% less raw and 56.0% less gzip than the full entry, with no five-tier/baked-atlas exporter, GLTFExporter, Three PBR/tangent adapter, meshopt encoder/decoder, GLB importer/validator, hero-spine authoring, material authoring/baking/binding graph, LOD-worker dependency, full-entry damaged-topology module, or injected-device WebGPU runtime. It includes generated UV0, renderer-independent surface-partition and CPU/WebGPU visibility plans, the generator/contract surface, and typed compiler/runtime contracts needed by downstream dense vegetation. The explicit `procplants/webgpu` entry is 48,174 bytes raw / 13,256 bytes gzip transitively, including the shared plan/oracle chunk; it is absent from both default browser startup and `procplants/core`. Reproducibility checks cover every emitted file. The expensive EZ-tree backend is not folded into these library entries. Three.js is a peer (`>=0.183.2 <0.184.0`) tested at the same 0.183.2 runtime/0.183.1 types used by Tellus; Vite tooling is development-only and `prepare` rebuilds packed or Git installs. The final dry-run package is 545,587 bytes packed / 2,193,669 bytes unpacked across 209 entries.

After the new authoring controls were present, the explicit bootstrap keeps the parser-discovered JavaScript entry at 0.95 kB raw / 0.53 kB gzip. It paints a real loading/error state, then Vite's dynamic-preload helper fetches the 141.35/42.36 kB lab and 852.04/224.06 kB shared generator dependency together. This improves first-paint and initial parse work; it does not claim lower total bytes before the first plant is interactive. The complete parser-discovered interactive static closure is now regression-capped and measures 1,004,561 raw / 269,324 gzip bytes. The 4.95/2.03 kB tangent geometry adapter, 11.91/4.19 kB live PBR adapter, 10.12/3.32 kB manual-spine editor, and 117.55/30.62 kB graph editor remain lazy. A browser resource-timing assertion proves graph, material/import, tangent, macro, contour, crown, vendor-tree, and WebGPU implementation chunks are absent before their first interaction.

## Geometry reductions

Canonical seed `612072` is frozen by `test:conifer-fern-budget` with exact geometry hashes:

| Preset | Current LOD triangles | Current LOD vertices | Audited earlier close tier | Close-tier reduction |
| --- | ---: | ---: | ---: | ---: |
| Phi Fern | 352 / 264 / 4 / 2 | 1,056 / 792 / 8 / 4 | 1,872 frozen v2 | 81.2% |
| Blue Spruce | 3,934 / 2,494 / 4 / 2 | 7,324 / 3,942 / 8 / 4 | 11,780 | 66.6% |
| Alpine Fir | 5,190 / 3,174 / 4 / 2 | 8,388 / 4,509 / 8 / 4 | 15,444 | 66.4% |
| Redwood Spire | 3,896 / 2,540 / 4 / 2 | 6,765 / 3,710 / 8 / 4 | 10,776 | 63.8% |
| Tundra Small Pine | 3,678 / 2,354 / 4 / 2 | 7,148 / 3,826 / 8 / 4 | not frozen | not claimed |
| Shore Pine | 1,596 / 1,080 / 4 / 2 | 4,692 / 3,168 / 8 / 4 | not frozen | not claimed |

The older downstream Tellus Phi implementation materialized 6,384 close triangles, but that is a different consumer path rather than the producer's frozen v2 baseline. The converged producer emits one broad eight-frond crown at 352 close triangles and roughly 1.23 by 1.61 ground coverage.

The new broad-area ground covers use cards/low-poly organs and are covered by regression budgets. Close LOD counts remain strictly decreasing and terminate at four-triangle crossed cards and two-triangle single cards.

The opt-in version-2 five-tier stack keeps those exact Phi Fern LOD0-2 bytes,
then distinguishes a four-triangle/eight-vertex baked-atlas crossed tree
impostor at LOD3 from a two-triangle/four-vertex baked billboard at LOD4. Its
16-view hemisphere WebGL smoke rendered both far tiers in two single-pass draw
calls and changed 8,957 framebuffer pixels. The deterministic 8-view headless
fixture embeds a 64x64 PNG in a 133,772-byte five-tier GLB. These are bounded
cost and render-path results; atlas memory scales with bake dimensions/views,
and no Tellus adoption or representative-device FPS is claimed.

Required UV0 adds exactly 8 bytes per vertex to in-memory templates and worker transfers. This is a deliberate geometry-memory tradeoff: every real LOD now has deterministic finite texture coordinates, swept bark retains tiling beyond one, and GLB export no longer has to invent coordinates before binding PBR maps.

The added maidenhair fern, woodland violet, trillium, and horsetail patches cover roughly 1.8-2.1 by 1.8-2.0 local units at 1,312, 1,256, 628, and 1,908 close triangles respectively. Their LOD1 tiers are 656, 658, 314, and 1,060 triangles, followed by the common 4/2-triangle far tiers.

## Live placement LOD evidence

The lab now migrates Weber-Penn trees, canonical graph-backed woody cohorts, and eleven audited fern/ground-cover presets through real compiled geometry tiers. Pools reuse fixed matrices/arrays, update only after camera movement, use hysteresis, and install atomically after worker success.

The reusable dense-impostor benchmark puts 1,024 Phi-Fern-equivalent placements into plant-local atlas-view buckets: 1,916,928 full triangles become 2,048 billboard triangles (99.893% lower), and 1,024 naive card draws become at most 8 occupied-view draws. A masked 1,024-placement reference rendered 342 eligible placements as 684 triangles while excluding 682 near-tier placements, matrix-for-matrix equivalent to a filtered reference. The standalone lab now adopts this path for the current same-preset/seed cohort's LOD3 assignments after an explicit hero bake; this is not evidence of Tellus adoption.

The reusable placement LOD pool now has an optional conservative clustered max-distance broad phase. On a 10,000-placement parity grid it reduced exact square-root/LOD resolutions from 10,000 to 1,024 (89.76%) across 197 clusters while preserving placement assignments, callback order, hysteresis transitions, and every active matrix byte. The immutable cluster/index/mask metadata occupied 246,517 bytes (24.65 bytes per placement); omitting the option retains the exact legacy scan.

The standalone lab now supplies the pool with an exact conservative Three.js frustum mask through a reusable adapter. A production Phi Fern browser smoke observed 41 visibility clusters covering 76 candidate placements and kept the visible set byte-stable through the pool; its camera happened to reject no clusters, so this is adoption/lifecycle evidence rather than a claimed culling-rate benchmark.

The reusable WebGPU seam now emits bounded immutable buffer plans, WGSL reset/classify/finalize kernels, LOD-compacted instance indices, and indexed indirect draw commands. An opt-in injected-device runtime validates device limits/features, owns and reuses the seven planned buffers, uploads views and masks, dispatches all three compute stages, exposes output/indirect buffers, supports bounded mapped readback against the CPU oracle, rebuilds only undersized buffers, handles abort/device loss, and disposes idempotently. The runtime can also encode compute into a caller-owned command encoder. A borrowed-resource indexed-draw encoder then records one 20-byte `drawIndexedIndirect` command per LOD and exposes the exact compacted-index word offset for the caller's vertex shader. Portable plans use `firstInstance=0`; non-zero base instances are opt-in and fail closed unless the device exposes `indirect-first-instance`. Deterministic fake-device tests cover command layout, shared-encoder ordering, uploads, allocation-free draw encoding, reuse/growth, feature gates, readback, caps, loss, and disposal. Chrome 151 executed the live gate on an Intel Gen12LP adapter: the three compute stages and three indexed-indirect LOD calls shared one command buffer, GPU readback matched the CPU oracle, and the offscreen target contained 21 red plus 21 green pixels for the two visible compacted instances. Live shader diagnostics also caught and removed a WGSL reserved-keyword bug in the earlier finalize kernel. This is correctness/device-execution evidence; the WebGL lab and Tellus do not adopt the path, and no throughput or FPS claim is made here.

Multi-channel impostors cost `width × height × 4` bytes per channel/view. At 128², color, normal, and depth together are 192 KiB per view before atlas gutters; seasons multiply that packed-atlas cost. Color-only output remains byte/hash-identical to the legacy atlas, so channels add no cost unless requested.

The real Chrome WebGL 2 smoke captured aligned 51x72 summer/winter color/normal/depth atlases through ANGLE Vulkan SwiftShader. Its alpha-tested checkerboard preserved 512 opaque and 512 transparent interior pixels; the enhanced hero, color-only hero, and dense path produced distinct stable hashes; two visible dense placements used one draw and shared the hero material; and target face/mip, viewport, scissor, clear, XR, and source-material state all restored exactly. This proves browser shader execution and standalone adoption, not Tellus material adoption or native-GPU performance.

The production browser UI smoke also baked a mixed Clover plant into six 256x256 RGBA resources, installed two normal-mapped live materials over four exact source ranges with explicit tangents, and audited 1,572,864 owned texture bytes. Its real toolbar export emitted a deterministic material-bound GLB hash and mapped both active-LOD primitives to explicit baked slots. The default path still allocates no tangent/secondary-UV GPU buffers and fetches neither Three PBR adapter before the user selects Bake.

The lab's opt-in hierarchical WebGL wind path derives two render-only attributes totaling 13 bytes per vertex. A SwiftShader WebGL2 material/shadow gate classified 77 tested vertices as leaves (1,001 attribute bytes), changed 19,779 framebuffer bytes after a wind update, changed 20,952 bytes when the shadow path was toggled, and reported no shader error. The historical V1 installer remains the default. Combined canonical templates without `branchOrder` separate stems from leaves but deliberately do not invent trunk-versus-branch bands; authored tubes with branch metadata receive the full hierarchy. This is shader correctness evidence, not representative-device FPS.

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
- These measurements prove the standalone Procplants build. Tellus owns different chunking, render-pressure, shadow, asset-substitution, renderer choice, and deployment behavior. Tellus defaults to WebGL because it is currently faster there, so its required acceptance test is a controlled WebGL field run; Procplants' opt-in WebGPU evidence is not a substitute.

## Tellus parity worktree evidence

Draft Tellus PR #177 removes the 5,782-line vendored generator, exact-pins the
Procplants package foundation, and uses a thin `procplants/core` contract-v3
adapter with UV0 and exhaustive dispatch for all 20 instance kinds. Its frozen
automatic-ecology allowlist contains the existing 13 presets, so new varieties
remain opt-in. Installed-package fixture parity, 427 tests, strict typecheck,
and the production build pass. The pin predates the cumulative authoring stack
and must be refreshed to the final merged SHA or immutable release.

Stacked draft #178 adopts package LOD0/LOD1/LOD2 geometry for eleven audited
ground-cover cohorts. The deterministic 49-chunk reference places 180 plants
as 114 renderer instances across 110.243 by 111.407 metres at 51,304 triangles
and 184 non-empty draws, with no ground-cover shadow casters, receivers, or
proxies. Its grass-coexistence case adds 1,712 grass instances at 75,016 total
triangles and 9 draws without ground-cover shadows. Nine new ground covers are
placement-only. The low-FPS queue test proves bounded scheduling, not frame
rate.

Against clean Tellus `origin/master`, #177's production JavaScript sum grew by
104,006 raw bytes (+1.09%) and 30,839 level-9 gzip bytes (+1.06%). Both Tellus
PRs are open drafts with green CI. Their tests construct deterministic Three.js
scene state but do not exercise the default browser WebGL renderer, measure GPU
time/FPS on a representative device, or prove served/deployed capacity.
