# Procplants

Procplants is a procedural plant generator and Three.js demo for exploring believable, lightweight vegetation. It builds plant forms from reusable genomes, then scatters them into small biomes with deterministic seeds, phi-based placement, and environmental sliders.

The goal is to get rich foliage coverage without relying on heavy hand-authored meshes: leaves, petals, fronds, sprays, and grass blades are mostly low-triangle 2D forms with enough fold, curl, venation, and silhouette variation to read as alive.

## Try It

Use the controls to mix plant genomes and tune the biome:

- `Roll Dice` randomizes species, hybrid mix, seed, and environment sliders.
- `Auto Demo` keeps rolling new biomes for a hands-off showcase.
- `Save Link` copies a reproducible URL with the current recipe and camera.
- `Export JSON` downloads the current state, camera, stats, resolved genome, nine-stage authoring graph, and grouped trim operations.
- `Export GLB` downloads the active real geometry tier with plant sway/tint metadata and an automatic collision proxy.
- `Debug IR`, `Frames`, and `Wind Colors` visualize attachment, branch, frame, wind, and LOD contracts.
- `Trim Mode` supports click, drag-stroke, and Shift-drag lasso selection with reversible grouped graph operations.
- `Asset QA` computes exact geometry/texture budgets plus overdraw and attribute readiness on demand without adding work to initial load.
- `Graph Preview` lazily opens the nine-stage editor: highlight inputs, change supported enabled/count/curve controls, validate wiring, and see compiler-applied versus preview-only audits.
- `Growth macros` apply safe wind, wetness, snow, pruning, stylization, and biome-adaptation rules while zero preserves the authored preset.
- `Crown and swept tubes` tunes crown dimensions/density plus tube resolution, junction collars, and bark roughness. Crown Handles can add positive or subtractive lobes, select, center-drag, resize, yaw, weight positive lobes, and remove freeform ellipsoid/box lobes that change actual space-colonized branch geometry while preserving exact legacy defaults when absent.
- `Import Cutout` traces multi-island/hole leaf or frond images into optimized meshes; metadata controls retrace/repack it, while `Edit Contour` lazily opens validated drag/insert/delete point editing over the source image.
- `Bake Far Impostor` captures 16 hero views into a padded RGBA atlas and installs a live two-triangle LOD3; `Export Impostor GLB` embeds that atlas in a standalone billboard asset.
- Season, health, and maturity controls preview and persist deterministic variants.
- Stable per-organ age, health, leaf-drop, blossom/reproductive maturity, wetness, snow, and seasonal-color masks are available from PlantIR attachments for shader/export pipelines.

Good starting experiments:

- Mix `Vinca Vine` with `Meadow Flower` for viny flowering groundcover.
- Try `Echinacea Flower`, `Hibiscus Bloom`, `Daylily Flower`, `Foxglove Spike`, `Tulip Cup`, `Poppy Flower`, `Sunflower Tower`, `Lace Umbel`, and `Iris Bulb` for different flower architectures.
- Compare `Agave Succulent`, `Folded Palm`, and `Tropical Aroid` for rosette, canopy, and broadleaf forms.
- Use `Phi Fern`, `Bracken Fern Mat`, `Clover Groundcover`, `Wood Sorrel Carpet`, `Woodland Anemone Carpet`, `Creeping Phlox Carpet`, and `Wild Strawberry Groundcover` for broad, low-cost understory coverage.
- Try `Blue Spruce`, `Alpine Fir`, `Tundra Small Pine`, `Shore Pine Cones`, and `Redwood Spire` for cold-biome conifer sprays, or `Oak Canopy`, `Birch Grove`, `Acacia Umbrella`, and `Mangrove Roots` for biome tree genomes.
- Compare `Winterberry Shrub`, `Thorny Bramble`, and `Epiphytic Aroid Roots` for low-cost berries, thorns, and aerial roots attached in branch-relative frames.
- Compare `Climbing Ivy`, `Canopy Liana`, and `Flowering Wall Creeper` for guided climb/hang/wrap paths, then try `Hanging Moss` and `Cushion Moss` for six-triangle tuft coverage.
- Try `Colonized Hazel Shrub` for an opt-in space-colonized crown built from parallel-transport swept branch chains.
- Compare `Sugar Maple`, `Weeping Willow`, `Windswept Bonsai`, `Deadwood Snag`, and `Twilight Fantasy Tree` for five distinct silhouettes between 504 and 6,232 close-range triangles.
- Use low light or high crowding to see the growth response change plant shape.

## Features

- Reusable genome model for grasses, ferns, flowers, tropical plants, reeds, bamboo, succulents, vines, conifers, palms, fan palms, groundcovers, umbels, bulbs, shrubs, and biome trees.
- Golden-angle phyllotaxis for leaves, flowers, stems, and biome scatter.
- Light-responsive growth: shade stretches stems, changes leaf scale, and suppresses branches.
- Procedural leaf silhouettes with curl, serration, folds, and vein relief.
- Fur-like grass as dense low-triangle blade cards.
- Hybridization between plant genomes.
- Instanced rendering for leaves, grass blades, conifer sprays, palm fronds, petals, and flower centers.
- Bounded deterministic prototype generation with instanced stems and organs, so dense previews do not regenerate every placement.
- Exact export-readiness accounting for instanced triangles, vertices, draw calls, material slots, GPU bytes, and LOD budgets.
- Stable segment/attachment IR with parent IDs, axial positions, right-handed branch frames, and sway weights.
- Four deterministic geometry LODs (full, coherently reduced, crossed card, and single card).
- A versioned renderer-independent four-tier runtime LOD contract combines normalized distance, projected height, hysteresis, and culling; runtime/Tellus packages and multi-LOD GLB extras carry the same stable tier IDs without claiming a Khronos extension.
- Worker-backed hero LOD switching with hysteresis and cached compiled geometry.
- Debug, pruning/trim, and GLB authoring tools load as one cold interaction chunk; default rendering does not execute or preload them.
- GPU vertex wind for visible and shadow passes without per-frame instance-matrix updates.
- Spiral, alternate, opposite, decussate, and configurable whorled phyllotaxy.
- Live attachment/branch/frame/wind/LOD diagnostics using static instanced and batched geometry.
- Deterministic non-mutating graph pruning with repaired ancestry and an audit result.
- Interactive segment picking, reversible graph-backed trimming, and recompilation of the edited hero plant.
- Screen-space pruning strokes and Shift-drag lassos with stable multi-selection and grouped undo.
- Opt-in viewport Place Part authoring adds regeneration-safe branch-relative leaves, reproductive/accessory organs, low-poly foliage clusters, moss tufts, and bounded one-segment child branches to graph-backed heroes with target-bound overrides, spacing/cap audits, JSON metadata, and undo-last.
- Browser-native alpha cutout tracing, deterministic multi-island/hole triangulation, direct point editing and freehand island/hole creation, atlas packing, edge-dilated mip padding, UV/pivot/attachment/bend metadata, and mesh helpers.
- Low-poly fruit, berry, cone, thorn, and aerial-root organs with branch-relative placement.
- A reusable instanced placement LOD pool with hysteresis, culling, explicit allocation-free updates, and migration statistics.
- Renderer-independent visibility clusters provide conservative storage-buffer-ready instance/cluster bounds, WebGL/WebGPU frustum planes, and allocation-stable CPU reference culling/LOD compaction for dense downstream renderers. A bounded WebGPU plan and opt-in injected-device runtime add deterministic buffer layouts, WGSL reset/classify/finalize kernels, owned/reused GPU buffers, indirect draw commands, device-limit checks, readback parity diagnostics, loss/abort handling, and idempotent disposal. A borrowed-resource draw encoder can record compute and indexed-indirect LOD draws into one caller-owned command buffer; its portable default avoids the optional `indirect-first-instance` feature, while explicit feature use is checked at runtime. The WebGL lab remains the default, and Tellus intentionally stays on its currently faster WebGL path; neither adopts this WebGPU path, and no device FPS claim is implied.
- Dense Weber-Penn tree placements migrate between real compiled LOD tiers after their worker compile completes.
- Canonical graph-backed woody cohorts also migrate asynchronously while companion plants and local-light variants stay intact.
- Eleven canonical fern/ground-cover cohorts migrate through the same allocation-free placement pool; density-1 Phi Fern and Clover measurements reduced live biome triangles by 73.5% and 59.4% respectively after the atomic worker swap.
- Four additional broad low-poly patches add maidenhair fern, woodland violet, trillium, and horsetail silhouettes at 628-1,908 close triangles with real 4/2-triangle far tiers.
- Those four bespoke broad patches also have an edited production-DAG path: cluster/support architecture, branch-relative leaves, and flower stalks use independent deterministic stage seeds while the untouched graph retains exact legacy bytes and LOD/coverage budgets. Unsupported topology, placement, and phyllotaxy edits fail closed; Tellus defaults remain opt-in.
- Typed generator-DAG, macro-rule, space-colonization, and parallel-transport swept-tube foundations for higher-level authoring tools. Edited graph-native, space-colonized, branch-module, guided-vine, bounded herbaceous/clump/bespoke-patch, and Weber-Penn plants execute through honest typed artifacts. Weber exposes real branch-soup/native-foliage artifacts and only vendor-representable controls; unsupported specialized rewires fail closed.
- A production `colonizedHazelShrub` backend using deterministic space colonization, swept tubes, real reduced LOD, and branch-relative foliage.
- Versioned freeform crowns use deterministic weighted constructive fields of up to 24 oriented ellipsoid/box lobes with positive union and subtractive cutouts, viewport add/select/center-drag/remove, per-lobe dimension/yaw/density controls, URL/JSON/genome/graph persistence, strict sampling/work caps, and exact default-geometry compatibility; global axis handles still scale the whole field.
- A deterministic target-bound nine-stage authoring-graph adapter included in JSON exports, with real typed backends, execution records, a lazy editor for mapped seeds/enabled/count/curve/parameter controls, cycle-safe wiring, and explicit unsupported audits.
- Bounded clump production adapters preserve legacy bytes and specialized LOD policy: generic clumps separate whole-shoot generation from placement, while Daylily independently seeds crown architecture, branch-relative strap foliage, and real scape/flower topology with graph attachment IR.
- Deterministic sphere/capsule/plane/box scene-guide queries provide signed clearance, attraction, repulsion, tip steering, and penetration resolution without a renderer dependency.
- Versioned spatial direction, attract/magnet, repel/avoid, and curl fields deform public plant graphs deterministically while preserving connectivity and rebuilding branch-relative frames/attachments.
- Versioned source/sink growth turns deterministic crown-occlusion probes or caller-supplied directional light into stable vigor, growth-scale, branch-activation, and de-duplicated self-prune recommendations. A graph-bound multi-step state persists reserves/growth, confirms activation and pruning with hysteresis, and serializes deterministic audits.
- Opt-in growth-topology plans bind confirmed recommendations to an exact graph/step, apply self-prunes through the existing descendant/attachment repair path, and materialize confirmed terminal `branch-tip` dormant buds as bounded deterministic child shoots with stable IDs and replacement tip anchors.
- Versioned Weber-Penn trim overrides can deterministically filter stable leaf-site/branch-tip attachment identities with target-bound serialization and explicit unsupported audits for baked branch ancestry or native-leaf geometry.
- Extended asset QA for overdraw, texture memory, UV/tangent requirements, collisions, and named engine/mobile/hero profiles.
- Deterministic 16-view RGBA hero impostor capture with padded gutters, live camera-relative LOD3 UV selection, and embedded-atlas GLB export.
- Renderer-independent aligned color/normal/depth impostor channels and deterministic seasonal view arrays preserve exact color-only compatibility while adding channel-aware gutters, hashes, UV selection, deterministic PNG encoding, and channel-set GLB packaging. After explicit Bake, the real hero LOD3 and matching dense-biome LOD3 use the enhanced normal/depth shader with allocation-stable view/season switching and shared resources; the real Chrome WebGL regression covers both hero and dense adoption.
- A reusable dense impostor pool buckets static placements by plant-local atlas view with shared resources, stable buffers, visibility/culling/view hysteresis, and at most one draw per occupied view. After an explicit hero bake, a matching same-preset/seed biome cohort uses it for live LOD3 placements without duplicating LOD0-2 geometry.
- Auto/manual imported-mesh spine fitting with bark UVs, wind weights, nearest-spine attributes, and stable anchors.
- A bounded self-contained hero-GLB importer inspects scene/mesh/material references, emits stable node/mesh provenance and world matrices, optionally bakes static matrix/TRS hierarchies into isolated positions and inverse-transpose normals, and extracts embedded PNG/JPEG/WebP/KTX2 texture bytes without a renderer dependency. The lab can import a supported GLB, auto-fit a spine, opt into lazy viewport handles to move/add/remove spine points and rebuild the authored mesh atomically, assign bark UV/wind/anchors/collars, preview procedural leaves, and export the authored hero.
- A renderer-independent hero-bark authoring contract selects one capped imported UV region or matching fitted-spine band, derives byte-tileable base/height/normal PNG resources from explicitly decoded imported PNG pixels, audits coverage/seams/work/provenance, and exposes owned base/normal pixel sources to the material baker. With no decoded pixels it emits an explicitly labeled procedural surrogate, never a scan-quality claim.
- Spine-bound imported meshes can emit stable, spaced leaf/branch/accessory attachment transforms with surface-envelope clearance and right-handed frames.
- Imported spine-bound attachment frames can drive bounded, order-independent junction-collar displacement/weight attributes or nonmutating baked surface swell.
- Deterministic indexed/non-indexed triangle-mesh queries use a bounded static BVH for exact closest points, optional signed clearance on closed meshes, and growth-obstacle projection; affine transforms and stable ties are supported.
- Deterministic foliage-card relaxation reduces organ overlap with bounded branch-relative offsets/rotations, conservative stem-capsule clearance, unresolved-collision audits, and a reference-equivalent spatial-hash broad phase for larger sets.
- Density-map ecosystem scattering with weighted biome entries, spatial-hash spacing, terrain-height hooks, and JSON-safe plans.
- A tested parametric stochastic L-system expander and 3D turtle with tropism, branch stacks, taper, and leaf frames.
- Static guide-following vines and low-poly moss presets with coarse support clearance and self-avoidance.
- Lazy GLB export with lossless UV0/TEXCOORD_0, vertex colors, sway, tintability, and contract metadata.
- A strict UV0-gated material binder maps deterministic bark/organ geometry groups to separate standards-valid glTF primitives and embeds baked base-color, ORM, normal, and emissive PNGs; absent or malformed authored UVs, mixed triangle flags, incomplete groups, and guessed slots fail before serialization.
- Bounded `EXT_mesh_gpu_instancing` export writes one selected template/LOD plus renderer-neutral TRS placements, with a scatter-entry adapter and explicit meshopt/collision composition boundaries.
- Native headless GLB output for one selected LOD or the complete LOD set, with deterministic bytes and optional bounds-box/trunk-capsule collision proxies.
- A typed deterministic material DAG validates bark/leaf PBR channels, texture roles/color spaces/transforms, procedural descriptors, constant folding, direct bindings, and explicit bake-required expressions. Its glTF planner maps lossless direct base/alpha/normal/ORM/AO/emissive bindings, while the CPU baker emits color-correct PNG and embedded glTF material bytes. Generated templates retain deterministic UV0 across every real LOD and are partitioned without index copies into explicit bark/stem and organ ranges. The lazy lab `Bake PBR Material` action downloads and installs deterministic bark/leaf base-color, packed ORM, and procedural normal resources on live wind-compatible MeshStandard materials; normal-mapped geometry gains an explicit normalized tangent frame only on this lazy path.
- Optional deterministic lossless `EXT_meshopt_compression` for GLB geometry: required mode produces real transfer savings for decoder-aware consumers, while fallback mode retains ordinary core buffers for compatibility. Texture compression and triangle simplification are intentionally separate.
- Deterministic ASCII USDA output for one real LOD or a standard four-choice `LOD` variant set, preserving topology, normals, display colors, sway/tintability primvars, typed metadata, and optional physics-enabled bounds-box/trunk-capsule collision proxies. An opt-in library path binds one explicit ready baked slot through `UsdPreviewSurface`, exports t-flipped `st`, color-correct `UsdUVTexture` base/ORM/normal/emissive inputs, and copied package-relative PNG assets. A companion deterministic USDZ writer stores the USDA default layer first and every dependency uncompressed on required 64-byte boundaries with path, entry, byte, and work caps.
- Headless atlas manifests accept bounded dependency-free PNG alpha input, including non-interlaced and Adam7 images: 1/2/4/8/16-bit grayscale, 8/16-bit RGB/gray-alpha/RGBA, and 1/2/4/8-bit indexed color, with strict native-precision grayscale/RGB or indexed `tRNS`, in addition to legacy inline masks.
- Optional bounds-box or trunk-capsule GLB collision proxies.
- Deterministic season, health, and maturity variants that never mutate authored presets.
- Standard spring/summer/autumn/winter/damaged forms can compile as separate GLB-ready LOD sets.
- Standard variants and all real LODs can also export in one deterministic multi-scene GLB, with a `procplants.variant-bundle` scene-selection manifest and no misleading Khronos extension claims.
- Tellus-compatible biome mix/package and registry-v2 export helpers.
- Reproducible URLs and JSON export for saving favorite seeds.

## Presets

Current presets include:

`furGrass`, `reedSedge`, `bambooClump`, `blueSpruce`, `alpineFir`, `redwoodSpire`, `tundraSmallPine`, `shorePineCones`, `foldedPalm`, `oakCanopy`, `birchGrove`, `acaciaUmbrella`, `mangroveRoots`, `sugarMaple`, `weepingWillow`, `windsweptBonsai`, `deadwoodSnag`, `twilightFantasyTree`, `colonizedHazelShrub`, `phiFern`, `brackenFernMat`, `maidenhairFernPatch`, `meadowFlower`, `echinaceaFlower`, `hibiscusBloom`, `daylilyFlower`, `foxgloveSpike`, `tulipCup`, `poppyFlower`, `sunflowerTower`, `cloverGroundcover`, `woodSorrelCarpet`, `woodlandAnemoneCarpet`, `creepingPhloxCarpet`, `wildStrawberryGroundcover`, `woodlandVioletCarpet`, `trilliumPatch`, `horsetailColony`, `winterberryShrub`, `thornyBramble`, `epiphyticAroidRoots`, `laceUmbel`, `irisBulb`, `agaveSucculent`, `lotusBloom`, `vincaVine`, `climbingIvy`, `canopyLiana`, `floweringWallCreeper`, `hangingMoss`, `cushionMoss`, `roseBush`, `tropicalAroid`, `fanPalmUnderstory`, `desertRosette`, and `understoryShrub`.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

The biome community authoring surface is available at
`http://127.0.0.1:5173/biome-mixer.html`.

Build a production bundle with:

```bash
npm run build
```

Build the reusable ESM library and TypeScript declarations for consumers such as Tellus with:

```bash
npm run build:lib
```

Runtime consumers can import the smaller `procplants/core` entry for compiler, readiness, variant, biome, visibility-cluster, and Tellus contract/package APIs without pulling in CLI, editor, material authoring, GLB import/export/validation, or browser-authoring surfaces. The root `procplants` entry remains the complete API.

The package treats Three.js as a peer so a renderer such as Tellus owns one shared Three singleton; the currently validated consumer range is `>=0.183.2 <0.184.0`. Git and packed-file installs run `build:lib` through the package `prepare` script, while Vite and its React plugin remain development-only build tools.

Run deterministic geometry, variant, and Tellus-contract regressions with:

```bash
npm test
```

After a production build, run the dependency-free headless Chrome UI smoke (graph editing, regeneration, lazy macro boundary) with:

```bash
npm run test:browser-smoke
npm run test:impostor-three-webgl
```

Use the headless compiler for repeatable asset-pack work:

```bash
npm run procplants -- validate ./species/oak.json
npm run procplants -- compile ./species/oak.json --profile tellus-realtime --seed 42 --out ./dist/oak.json
npm run procplants -- compile ./species/oak.json --profile tellus-realtime --seed 42 --variants 20 --out ./dist/oak-variants.json
npm run procplants -- compile-dir ./species --profile tellus-realtime --seed 42 --variants 20 --out ./dist/species
npm run procplants -- glb ./species/oak.json --profile tellus-realtime --seed 42 --lod all --collision trunk-capsule --out ./dist/oak.glb
npm run procplants -- glb ./species/oak.json --profile tellus-realtime --seed 42 --lod all --meshopt required --out ./dist/oak.meshopt.glb
npm run procplants -- validate ./dist/oak.meshopt.glb
npm run procplants -- validate "./dist/oak_*.glb"
npm run procplants -- variant-glb ./species/oak.json --profile tellus-realtime --seed 42 --lod all --collision trunk-capsule --out ./dist/oak-variants.glb
npm run procplants -- usda ./species/oak.json --profile tellus-realtime --seed 42 --lod all --collision trunk-capsule --out ./dist/oak.usda
npm run procplants -- atlas ./textures/leaves.manifest.json --out ./dist/leaves.atlas.json
npm run procplants -- atlas ./textures/leaves --size 2048 --out ./dist/leaves.atlas.json
```

Check the compact downstream Tellus contract fixture with:

```bash
npm run test:tellus-contract
```

## Project Structure

- `src/procplants.ts` is the generator core.
- `src/main.ts` is the standalone Three.js demo.
- `src/plant-readiness.ts` provides exact structural export QA.
- `src/procplant-wind.ts` installs the exact-compatible V1 GPU wind path and the lab's opt-in hierarchical V2 trunk/branch/leaf deformation for visible and shadow materials.
- `src/procplant-lod.ts` compiles/caches hero LODs off-thread and selects them with hysteresis.
- `src/procplant-contract.ts` defines and validates the shared runtime/Tellus/GLB LOD selection contract.
- `src/procplant-debug.ts` builds disposable, allocation-free authoring overlays.
- `src/procplant-pruning.ts` applies deterministic trim/retain operations to the public graph IR.
- `src/procplant-prune-tool.ts` maps viewport ray hits to stable segment IDs.
- `src/procplant-cutout.ts` traces alpha silhouettes and builds mip-safe deterministic atlases.
- `src/procplant-contour-editor-ui.ts` provides the lazy direct point editor for retained cutout rasters.
- `src/procplant-instance-lod-pool.ts` migrates instanced placements between real LOD geometries.
- `src/procplant-impostor.ts` composes captured RGBA views into deterministic padded impostor atlases.
- `src/procplant-impostor-channels.ts` composes aligned color/normal/depth and seasonal impostor view arrays.
- `src/procplant-impostor-image.ts` encodes deterministic channel PNGs and embeds seasonal channel sets in GLB.
- `src/procplant-impostor-three.ts` captures live Three.js views, installs textured billboards, and exports embedded-atlas GLB.
- `src/procplant-dense-impostor-pool.ts` batches dense static billboard placements into deterministic atlas-view buckets.
- `src/procplant-generator-graph.ts` defines deterministic typed generator DAGs and serializable manual operations.
- `src/procplant-authoring-graph.ts` derives a live nine-stage graph and preview from any authored genome.
- `src/procplant-production-dag.ts` executes typed graph-native, space-colonization, branch-module, guided-vine, bounded herbaceous, Weber-Penn, clump, Daylily, and bespoke broad-patch artifacts while retaining exact canonical legacy output and rejecting non-representable edits.
- `src/procplant-graph-editor-controls.ts` validates canonical stage activation/removal, same-stage settings copy/paste, and supported placement/scope controls without inventing extra-node topology.
- `src/procplant-rules.ts` applies safe environmental and authoring macro rules to allow-listed genome fields.
- `src/procplant-guide-query.ts` samples primitive scene guides, obstacle clearance, and deterministic growth-tip steering.
- `src/procplant-mesh-query.ts` builds bounded deterministic triangle BVHs for imported-mesh clearance and obstacle queries.
- `src/procplant-meshopt-compression.ts` applies bounded deterministic lossless `EXT_meshopt_compression` to eligible GLB geometry views.
- `src/procplant-glb-validation.ts` strictly validates emitted GLB structure, accessors, Procplants metadata, variant manifests, and decoded meshopt payloads/fallbacks.
- `src/procplant-hero-glb-import.ts` inspects and extracts bounded self-contained hero mesh/texture data.
- `src/procplant-hero-bark-extraction.ts` derives bounded, audited tileable bark resources from imported UV regions or fitted-spine bands.
- `src/procplant-hero-spine-editor.ts` provides immutable, undoable manual-spine state plus lazy Three.js viewport handles.
- `src/procplant-material-graph.ts` compiles renderer-independent typed surface graphs into portable binding and bake plans.
- `src/procplant-material-gltf-plan.ts` converts direct compiled bindings into standards-honest glTF PBR plans and diagnostics.
- `src/procplant-material-bake.ts` evaluates bounded material DAGs into deterministic PNG and embedded glTF resource bytes.
- `src/procplant-surface-partition.ts` classifies complete triangles into exact index-preserving bark/stem and organ draw ranges.
- `src/procplant-three-geometry.ts` adapts templates into grouped UV/tangent-ready Three.js geometry with explicit ownership.
- `src/procplant-three-material-adapter.ts` installs baked glTF PBR resources as owned, color-space-correct live Three.js materials.
- `src/procplant-uv0.ts` validates and declares the explicit generated geometry UV0 contract without synthesizing coordinates.
- `src/procplant-glb-material-binding.ts` attaches baked PBR resources only to UV0-contracted GLB primitives.
- `src/procplant-instanced-export.ts` prepares and exports bounded `EXT_mesh_gpu_instancing` cohorts from TRS or scatter records.
- `src/procplant-visibility-clusters.ts` builds GPU-ready visibility clusters and allocation-stable CPU reference selections.
- `src/procplant-three-visibility-lod-adapter.ts` applies those clusters to live Three.js camera frusta and placement LOD pools without steady-state allocation.
- `src/procplant-webgpu-visibility.ts` plans bounded visibility buffers, WGSL compute passes, LOD compaction, and indirect draw commands with a CPU reference oracle.
- `src/procplant-webgpu-visibility-runtime.ts` executes that plan on an injected WebGPU device while owning/reusing buffers and exposing opt-in readback validation.
- `src/procplant-webgpu-indirect-draw.ts` exposes allocation-stable per-LOD compacted-index bindings and records one indexed-indirect draw per LOD without taking ownership of runtime buffers.

The injected-device runtime is available from the explicit `procplants/webgpu` package entry. It is excluded from both the default browser startup graph and `procplants/core`; importing the existing plan API from the root/core entries remains supported. Tellus currently defaults to its faster WebGL renderer and does not exercise this path.
- `src/procplant-organ-placement-overrides.ts` serializes and applies target-bound branch-relative organ, cluster, moss-tuft, and bounded child-branch placements.
- `src/procplant-resource-growth.ts` allocates maintenance, reserves, and growth from directional light resources.
- `src/procplant-crown-light.ts` samples bounded deterministic stem/organ occlusion and adapts it directly to resource growth.
- `src/procplant-graph-resource-growth.ts` adapts public segment IR to vigor and self-prune recommendations.
- `src/procplant-growth-simulation.ts` persists deterministic multi-step reserve, activation, growth, and prune evidence.
- `src/procplant-growth-topology.ts` applies graph-bound confirmed self-prune and terminal dormant-bud shoot plans with exact audits.
- `src/procplant-damage-topology.ts` applies opt-in target-bound missing-organ and broken-branch topology with repaired ancestry, capped scar records, and exact healthy/no-op reuse.
- `src/procplant-weber-penn-trim.ts` serializes and audits stable attachment-level Weber-Penn trim overrides.
- `src/procplant-space-colonization.ts` supplies deterministic attraction-volume growth foundations.
- `src/procplant-spatial-force.ts` applies bounded localized force fields to public graph topology and rederives frames/attachments.
- `src/procplant-tube.ts` builds twist-stable parallel-transport swept tubes.
- `src/procplant-asset-qa.ts` adds engine/profile-specific texture, overdraw, attribute, and intersection QA.
- `src/procplant-mesh-helper.ts` auto-fits/binds imported meshes to spines and emits bark/wind/anchor attributes.
- `src/procplant-hero-spine-authoring.ts` selects imported GLB primitives by stable provenance and emits capped, audited spine-bound geometry packages.
- `src/procplant-junction-collar.ts` computes audited compact-support collar blending around imported-mesh branch anchors.
- `procplants/junction-research` is a separate opt-in package entry backed by `src/procplant-watertight-junction.ts`: it samples one straight parent plus one to three straight children as an implicit union, emits stable bark/branch attributes, and releases geometry only after closed-manifold and bounded self-intersection audits pass. Unsupported or failed candidates return the caller's exact collar geometry. It is not the production swept-tree union path: the frozen three-way fixture costs 7,388 triangles versus 45 for independent low-resolution tubes, and 3 of 9 angle/radius sweep cases currently fail closed.
- `src/procplant-foliage-relaxation.ts` relaxes public attachment/organ cards with bounded deterministic collision handling.
- `src/procplant-scatter.ts` creates deterministic density-map ecosystem placement plans.
- `src/procplant-lsystem.ts` provides parametric stochastic expansion and a 3D plant turtle.
- `src/procplant-variant-export.ts` prepares or serializes standard seasonal/damaged GLB sets.
- `src/procplant-cli.ts` provides headless single/batch JSON compilation, native GLB output, genome/GLB validation, and atlas commands.
- `src/procplant-png-alpha.ts` strictly decodes bounded non-interlaced or Adam7 packed/8/16-bit PNG masks for headless atlas builds.
- `src/procplant-export.ts` validates and lazily exports Procplant templates/LOD sets as GLB.
- `src/procplant-usd-export.ts` serializes deterministic ASCII USDA meshes, LOD variants, primvars, metadata, and conservative collision proxies.
- `src/procplant-usdz-export.ts` packages USDA plus copied PNG dependencies as bounded, deterministic, standards-aligned USDZ without claiming binary USDC.
- `src/index.ts` is the versioned public library surface.
- `src/core.ts` is the smaller runtime/Tellus library surface with stable `procplants/core` package exports.
- `src/plant-variants.ts` derives seasonal, health, and maturity forms.
- `src/procplant-organ-variants.ts` derives deterministic per-organ visibility and material masks without mutating PlantIR.
- `src/tellus-export.ts` compiles deterministic Tellus-compatible data packages.
- `src/style.css` is the demo UI.
- `docs/PRD_IMPLEMENTATION_STATUS.md` tracks implemented and remaining PRD work.
- `docs/PERFORMANCE_REVIEW.md` records current bundle, geometry, and live placement-LOD evidence.
- `docs/TELLUS_INTEGRATION.md` records the audited downstream boundary and safe adoption sequence.

The existing `procplants usda` CLI remains intentionally geometry-only: its durable input contract is a genome JSON and its I/O adapter writes text. Textured USDA/USDZ require an explicit in-memory ready material-bake bundle and binary output ownership, so they are exposed through the library API instead of guessing external files or mislabeled `.usd`/USDC bytes. `npm run test:usd-openusd` uses pinned `usd-core==26.8` through `uv` to parse and compose every all/single LOD and collision selection and to validate package storage, CRC, allowed types, default-layer order, and 64-byte payload alignment.

## Generator Output

The generator can produce a flat template:

```ts
{
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  tintable: Uint8Array;
  sway: Float32Array;
  idx: Uint32Array;
}
```

For higher-throughput scenes, `buildProcPlantInstancedParts()` returns:

- merged stem geometry as a flat template
- per-organ instance matrices and colors
- separate organ kinds for leaves, grass blades, conifer sprays, palm fronds, petals, and flower centers

This keeps dense biomes relatively cheap while preserving enough botanical variation for close-up exploration.

`buildProcPlantTemplate()` also exposes deterministic segment and attachment records. `compileProcPlantLods()` materializes four independently renderable tiers with strictly decreasing triangle counts for supported production presets.
